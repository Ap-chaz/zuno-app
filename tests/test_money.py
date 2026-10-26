import json, threading
from app.services.escrow import settle_transaction, RELEASE, REFUND, SPLIT


def cb(client, secret, checkout, amount, receipt='RCP1', code=0):
    body = {'Body': {'stkCallback': {'MerchantRequestID': 'm', 'CheckoutRequestID': checkout,
            'ResultCode': code, 'ResultDesc': 'ok',
            'CallbackMetadata': {'Item': [{'Name': 'Amount', 'Value': amount},
                                          {'Name': 'MpesaReceiptNumber', 'Value': receipt}]}}}}
    return client.post(f'/api/payments/hook/stk/{secret}', json=body)


SECRET = 'test-callback-secret-0123456789'


def setup_pending(H, db, amount=1000):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='PENDING', amount=amount)
    db.x("INSERT INTO mpesa_events (kind, reference, payload) VALUES ('STK_REQUEST','CK1',%s)",
         (json.dumps({'transaction_id': t}),))
    return s, b, t


# ── Safaricom callback hardening ─────────────────────────────
def test_callback_wrong_secret_rejected(client, H, db):
    s, b, t = setup_pending(H, db)
    assert cb(client, 'nope', 'CK1', 1013).status_code == 404
    assert db.one("SELECT status FROM transactions WHERE id=%s", (t,))['status'] == 'PENDING'


def test_callback_funds_once_and_replay_is_harmless(client, H, db):
    s, b, t = setup_pending(H, db)
    assert cb(client, SECRET, 'CK1', 1013).status_code == 200
    row = db.one("SELECT status, payment_reference FROM transactions WHERE id=%s", (t,))
    assert row == {'status': 'FUNDED', 'payment_reference': 'RCP1'}
    cb(client, SECRET, 'CK1', 1013)  # replay
    assert db.one("SELECT status FROM transactions WHERE id=%s", (t,))['status'] == 'FUNDED'


def test_callback_wrong_amount_does_not_fund(client, H, db):
    s, b, t = setup_pending(H, db)
    cb(client, SECRET, 'CK1', 1)
    assert db.one("SELECT status FROM transactions WHERE id=%s", (t,))['status'] == 'PENDING'


def test_callback_failure_code_does_not_fund(client, H, db):
    s, b, t = setup_pending(H, db)
    cb(client, SECRET, 'CK1', 1013, code=1032)
    assert db.one("SELECT status FROM transactions WHERE id=%s", (t,))['status'] == 'PENDING'


def test_receipt_cannot_fund_two_transactions(client, H, db):
    s, b, t = setup_pending(H, db)
    t2 = H.make_txn(s, b, status='PENDING')
    db.x("INSERT INTO mpesa_events (kind, reference, payload) VALUES ('STK_REQUEST','CK2',%s)",
         (json.dumps({'transaction_id': t2}),))
    cb(client, SECRET, 'CK1', 1013, receipt='SAME')
    cb(client, SECRET, 'CK2', 1013, receipt='SAME')
    assert db.one("SELECT status FROM transactions WHERE id=%s", (t2,))['status'] == 'PENDING'


# ── Settlement: who gets what ────────────────────────────────
def test_release_pays_seller_exactly_once(app, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='INSPECTION')
    with app.app_context():
        r1 = settle_transaction(t, RELEASE, ('INSPECTION',), 'test')
        r2 = settle_transaction(t, RELEASE, ('INSPECTION',), 'test')
    assert r1.ok and not r2.ok
    p = db.q("SELECT payout_type, amount, mpesa_number FROM payouts WHERE transaction_id=%s", (t,))
    assert len(p) == 1 and p[0]['payout_type'] == 'SELLER_RELEASE'
    assert int(p[0]['amount']) == 988 and p[0]['mpesa_number'] == s['phone']


def test_refund_goes_to_buyer_phone_not_seller(app, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='DISPUTED')
    with app.app_context():
        assert settle_transaction(t, REFUND, ('DISPUTED',), 'test').ok
    p = db.one("SELECT * FROM payouts WHERE transaction_id=%s", (t,))
    assert p['payout_type'] == 'BUYER_REFUND' and p['mpesa_number'] == b['phone']
    assert int(p['amount']) == 1013


def test_split_pays_both_and_cannot_exceed_escrow(app, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='DISPUTED')
    with app.app_context():
        bad = settle_transaction(t, SPLIT, ('DISPUTED',), 't', split_buyer_amount=600, split_seller_amount=600)
        assert not bad.ok
        ok = settle_transaction(t, SPLIT, ('DISPUTED',), 't', split_buyer_amount=300, split_seller_amount=700)
        assert ok.ok
    rows = {p['payout_type']: p for p in db.q("SELECT * FROM payouts WHERE transaction_id=%s", (t,))}
    assert rows['SPLIT_BUYER']['mpesa_number'] == b['phone'] and int(rows['SPLIT_BUYER']['amount']) == 300
    assert rows['SPLIT_SELLER']['mpesa_number'] == s['phone'] and int(rows['SPLIT_SELLER']['amount']) == 700


def test_concurrent_settlements_only_one_wins(app, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='INSPECTION')
    results = []
    def go(outcome):
        with app.app_context():
            results.append(settle_transaction(t, outcome, ('INSPECTION',), 'race').ok)
    th = [threading.Thread(target=go, args=(o,)) for o in (RELEASE, REFUND, RELEASE, REFUND)]
    [x.start() for x in th]; [x.join() for x in th]
    assert results.count(True) == 1
    assert db.one("SELECT COUNT(*) c FROM payouts WHERE transaction_id=%s", (t,))['c'] == 1


# ── Buyer actions need the real buyer ────────────────────────
def test_stranger_cannot_approve_or_pay(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer'); x = H.make_user('buyer')
    t = H.make_txn(s, b, status='INSPECTION')
    assert client.post(f'/api/transactions/{t}/approve', headers=x['h']).status_code in (403, 404)
    assert client.post(f'/api/transactions/{t}/approve', headers=s['h']).status_code in (403, 404)
    assert client.post(f'/api/transactions/{t}/approve').status_code == 401
    assert db.one("SELECT status FROM transactions WHERE id=%s", (t,))['status'] == 'INSPECTION'
    t2 = H.make_txn(s, b, status='PENDING')
    assert client.post('/api/payments/initiate', json={'transaction_id': t2}, headers=x['h']).status_code == 403


def test_buyer_approve_releases_once(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='INSPECTION')
    assert client.post(f'/api/transactions/{t}/approve', headers=b['h']).status_code == 200
    assert client.post(f'/api/transactions/{t}/approve', headers=b['h']).status_code >= 400
    assert db.one("SELECT COUNT(*) c FROM payouts WHERE transaction_id=%s", (t,))['c'] == 1


# ── Disputes, negotiation, admin ─────────────────────────────
def raise_dispute(client, H, db, buyer, t):
    r = client.post('/api/disputes/raise', headers=buyer['h'], json={
        'transaction_id': t, 'category': 'ITEM_NOT_AS_DESCRIBED',
        'description': 'The item is not what was agreed in the contract at all.'})
    assert r.status_code in (200, 201), r.get_json()
    return db.one("SELECT id FROM disputes WHERE transaction_id=%s", (t,))['id']


def test_negotiation_accept_pays_both_correctly(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='INSPECTION')
    d = raise_dispute(client, H, db, b, t)
    r = client.post(f'/api/negotiation/{d}/offer', headers=b['h'], json={'offer_amount': 300, 'message': 'refund 300'})
    assert r.status_code == 201, r.get_json()
    oid = r.get_json()['offer_id']
    # the offerer cannot accept their own offer; a stranger cannot either
    assert client.post(f'/api/negotiation/{d}/offer/{oid}/respond', headers=b['h'], json={'response': 'ACCEPTED'}).status_code == 403
    x = H.make_user('buyer')
    assert client.post(f'/api/negotiation/{d}/offer/{oid}/respond', headers=x['h'], json={'response': 'ACCEPTED'}).status_code == 404
    r = client.post(f'/api/negotiation/{d}/offer/{oid}/respond', headers=s['h'], json={'response': 'ACCEPTED'})
    assert r.status_code == 200, r.get_json()
    rows = {p['payout_type']: p for p in db.q("SELECT * FROM payouts WHERE transaction_id=%s", (t,))}
    assert int(rows['SPLIT_BUYER']['amount']) == 300 and rows['SPLIT_BUYER']['mpesa_number'] == b['phone']
    assert int(rows['SPLIT_SELLER']['amount']) == 688 and rows['SPLIT_SELLER']['mpesa_number'] == s['phone']
    assert db.one("SELECT status FROM transactions WHERE id=%s", (t,))['status'] == 'RESOLVED'
    # cannot accept twice
    assert client.post(f'/api/negotiation/{d}/offer/{oid}/respond', headers=s['h'], json={'response': 'ACCEPTED'}).status_code == 400


def test_negotiation_offer_bounds(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='INSPECTION')
    d = raise_dispute(client, H, db, b, t)
    for bad in (0, -5, 99999, 12.5, 'abc'):
        assert client.post(f'/api/negotiation/{d}/offer', headers=b['h'], json={'offer_amount': bad, 'message': 'x'}).status_code == 400


def test_admin_resolve_requires_admin_and_splits_both(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer'); a = H.make_admin()
    t = H.make_txn(s, b, status='INSPECTION')
    d = raise_dispute(client, H, db, b, t)
    body = {'resolution': 'SPLIT', 'admin_notes': 'Evidence supports a partial refund of the item.',
            'split_buyer_amount': 400, 'split_seller_amount': 600}
    assert client.post(f'/api/admin/disputes/{d}/resolve', headers=s['h'], json=body).status_code == 403
    assert client.post(f'/api/admin/disputes/{d}/resolve', headers=a['h'], json={**body, 'split_seller_amount': 900}).status_code == 400
    assert client.post(f'/api/admin/disputes/{d}/resolve', headers=a['h'], json=body).status_code == 200
    assert client.post(f'/api/admin/disputes/{d}/resolve', headers=a['h'], json=body).status_code == 400
    assert db.one("SELECT COUNT(*) c FROM payouts WHERE transaction_id=%s", (t,))['c'] == 2


def test_admin_refund_goes_to_buyer(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer'); a = H.make_admin()
    t = H.make_txn(s, b, status='INSPECTION')
    d = raise_dispute(client, H, db, b, t)
    r = client.post(f'/api/admin/disputes/{d}/resolve', headers=a['h'],
                    json={'resolution': 'REFUND_BUYER', 'admin_notes': 'Seller sent the wrong item, clear evidence.'})
    assert r.status_code == 200
    p = db.one("SELECT * FROM payouts WHERE transaction_id=%s", (t,))
    assert p['mpesa_number'] == b['phone'] and int(p['amount']) == 1013


# ── Tiers ────────────────────────────────────────────────────
def test_tier_limits_and_admin_upgrade(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer'); a = H.make_admin()
    mk = lambda amt: client.post('/api/contracts/create', headers=b['h'], json={
        'seller_id': s['id'], 'item_name': 'TV', 'agreed_amount': amt,
        'buyer_expectations': 'A 55 inch TV, boxed, with warranty', 'delivery_method': 'PLATFORM_COURIER'})
    assert mk(50000).status_code == 201
    assert mk(50001).status_code == 400
    assert client.post(f'/api/admin/users/{s["id"]}/tier', headers=s['h'], json={'tier': 2, 'notes': 'x'}).status_code == 403
    assert client.post(f'/api/admin/users/{s["id"]}/tier', headers=a['h'], json={'tier': 2, 'notes': 'Business docs verified'}).status_code == 200
    assert mk(191311).status_code == 201
    assert mk(1000001).status_code == 400


# ── B2C payout results touch only their own payout ───────────
def test_b2c_result_completes_only_matching_payout(app, client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='DISPUTED')
    with app.app_context():
        assert settle_transaction(t, SPLIT, ('DISPUTED',), 'x', split_buyer_amount=300, split_seller_amount=700).ok
    db.x("UPDATE payouts SET status='PROCESSING', originator_conversation_id=CONCAT('O-', payout_type), "
         "conversation_id=CONCAT('C-', payout_type)")
    body = {'Result': {'ResultCode': 0, 'OriginatorConversationID': 'O-SPLIT_BUYER',
            'ConversationID': 'C-SPLIT_BUYER',
            'ResultParameters': {'ResultParameter': [{'Key': 'TransactionReceipt', 'Value': 'ABC123'}]}}}
    assert client.post(f'/api/payments/hook/b2c/result/{SECRET}', json=body).status_code == 200
    st = {p['payout_type']: p['status'] for p in db.q("SELECT payout_type, status FROM payouts")}
    assert st == {'SPLIT_BUYER': 'COMPLETED', 'SPLIT_SELLER': 'PROCESSING'}
    # unknown ids and wrong secret change nothing
    client.post(f'/api/payments/hook/b2c/result/{SECRET}', json={'Result': {'ResultCode': 0, 'OriginatorConversationID': 'zzz'}})
    assert client.post('/api/payments/hook/b2c/result/bad', json=body).status_code == 404
    st2 = {p['payout_type']: p['status'] for p in db.q("SELECT payout_type, status FROM payouts")}
    assert st2 == st


def test_fee_quote_matches_what_a_deal_is_charged(client):
    r = client.get('/api/transactions/quote?amount=1000')
    assert r.status_code == 200
    q = r.get_json()
    assert (q['buyer_pays'], q['seller_receives']) == (1013, 988)
    assert client.get('/api/transactions/quote?amount=5').status_code == 400


# ── Status check asks Safaricom when the callback never arrives ──
def _pending_with_checkout(H, db):
    s, b, t = setup_pending(H, db)
    db.x("UPDATE transactions SET mpesa_checkout_id='CK1' WHERE id=%s", (t,))
    return s, b, t


def test_status_check_funds_when_safaricom_says_paid(client, H, db, monkeypatch):
    from app.routes import payments
    payments._last_query.clear()
    monkeypatch.setattr(payments, 'query_stk_status', lambda c: {'state': 'PAID', 'reason': 'ok'})
    s, b, t = _pending_with_checkout(H, db)
    r = client.get(f'/api/payments/status/{t}', headers=b['h'])
    assert r.status_code == 200 and r.get_json()['is_paid'] is True
    assert db.one("SELECT status FROM transactions WHERE id=%s", (t,))['status'] == 'FUNDED'
    # the real receipt arriving later replaces the placeholder, no false alarm
    cb(client, SECRET, 'CK1', 1013, receipt='REAL1')
    row = db.one("SELECT status, payment_reference FROM transactions WHERE id=%s", (t,))
    assert row == {'status': 'FUNDED', 'payment_reference': 'REAL1'}


def test_status_check_unknown_or_pending_never_funds(client, H, db, monkeypatch):
    from app.routes import payments
    for state in ('UNKNOWN', 'PENDING'):
        payments._last_query.clear()
        monkeypatch.setattr(payments, 'query_stk_status', lambda c, st=state: {'state': st, 'reason': ''})
        s, b, t = _pending_with_checkout(H, db)
        r = client.get(f'/api/payments/status/{t}', headers=b['h'])
        assert r.get_json()['is_paid'] is False
        assert db.one("SELECT status FROM transactions WHERE id=%s", (t,))['status'] == 'PENDING'


def test_status_check_reports_failure(client, H, db, monkeypatch):
    from app.routes import payments
    payments._last_query.clear()
    monkeypatch.setattr(payments, 'query_stk_status', lambda c: {'state': 'FAILED', 'reason': 'Request cancelled by user'})
    s, b, t = _pending_with_checkout(H, db)
    r = client.get(f'/api/payments/status/{t}', headers=b['h']).get_json()
    assert r['is_paid'] is False and 'cancelled' in r['last_failure'].lower()


def test_my_transactions_shows_sellers_payout_state(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='COMPLETED')
    db.x("INSERT INTO payouts (seller_id, transaction_id, payout_type, amount, mpesa_number, status) "
         "VALUES (%s,%s,'SELLER_RELEASE',988,'254700000000','COMPLETED')", (s['id'], t))
    rows = client.get('/api/transactions/my', headers=s['h']).get_json()['transactions']
    assert rows[0]['payout_status'] == 'COMPLETED'
    # the buyer does not see the seller's payout state
    rows = client.get('/api/transactions/my', headers=b['h']).get_json()['transactions']
    assert 'payout_status' not in rows[0]


# ── In-app notifications ─────────────────────────────────────
def test_dispute_notifies_both_sides_and_only_their_own(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer'); other = H.make_user('buyer')
    t = H.make_txn(s, b, status='INSPECTION')
    d = raise_dispute(client, H, db, b, t)
    seller_list = client.get('/api/notifications', headers=s['h']).get_json()
    assert seller_list['unread'] >= 1
    n = seller_list['data'][0]
    assert n['type'] == 'dispute' and n['relatedId'] == str(d) and n['read'] is False
    assert client.get('/api/notifications', headers=other['h']).get_json()['total'] == 0


def test_notification_mark_read_is_per_user(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer')
    t = H.make_txn(s, b, status='INSPECTION')
    raise_dispute(client, H, db, b, t)
    nid = client.get('/api/notifications', headers=s['h']).get_json()['data'][0]['id']
    client.patch(f'/api/notifications/{nid}', headers=b['h'], json={'read': True})   # not theirs
    assert client.get('/api/notifications', headers=s['h']).get_json()['unread'] >= 1
    client.patch(f'/api/notifications/{nid}', headers=s['h'], json={'read': True})
    client.post('/api/notifications/mark-all-read', headers=s['h'])
    assert client.get('/api/notifications', headers=s['h']).get_json()['unread'] == 0


def test_only_admin_can_announce(client, H, db):
    s = H.make_user('seller', tier=1)
    assert client.post('/api/notifications/send', headers=s['h'],
                       json={'title': 'x', 'body': 'y'}).status_code == 403
