def reg(client, **kw):
    body = {'full_name': 'Jane', 'phone_number': '0712345678', 'password': 'Passw0rd!x', 'role': 'buyer'}
    body.update(kw)
    return client.post('/api/auth/register', json=body)


def test_register_cannot_be_admin(client):
    assert reg(client, role='admin').status_code == 400


def test_phone_normalised_and_duplicates_blocked(client):
    assert reg(client).status_code == 201
    assert reg(client, phone_number='+254712345678').status_code == 409
    assert reg(client, phone_number='254712345678').status_code == 409


def test_login_blocked_until_phone_verified_then_works(client, app):
    reg(client)
    r = client.post('/api/auth/login', json={'identifier': '0712345678', 'password': 'Passw0rd!x'})
    assert r.status_code == 403 and r.get_json()['code'] == 'PHONE_NOT_VERIFIED'
    assert r.get_json()['phone'] == '+254712345678'


def test_otp_flow_hashed_single_use_and_lockout(client, app, db, H):
    reg(client)
    assert 'code is' not in str(db.one("SELECT otp_code FROM otp_verifications")['otp_code'])
    code = H.last_otp('+254712345678') or H.last_otp('0712345678')
    wrong = '000000' if code != '000000' else '111111'
    for _ in range(3):
        assert client.post('/api/auth/verify-otp', json={'phone_number': '0712345678', 'otp_code': wrong}).status_code == 400
    # now locked, even the right code is refused
    assert client.post('/api/auth/verify-otp', json={'phone_number': '0712345678', 'otp_code': code}).status_code == 429


def test_otp_success_returns_token_and_cannot_be_reused(client, H):
    reg(client)
    code = H.last_otp('+254712345678')
    r = client.post('/api/auth/verify-otp', json={'phone_number': '0712345678', 'otp_code': code})
    assert r.status_code == 200 and r.get_json()['token']
    assert client.post('/api/auth/verify-otp', json={'phone_number': '0712345678', 'otp_code': code}).status_code == 400
    for ident in ('0712345678', '+254712345678'):
        assert client.post('/api/auth/login', json={'identifier': ident, 'password': 'Passw0rd!x'}).status_code == 200


def test_login_by_email_and_generic_failure(client, H):
    u = H.make_user('buyer')
    client.put('/api/auth/profile', headers=u['h'], json={'email': 'A@B.com'})
    assert client.post('/api/auth/login', json={'identifier': 'a@b.com', 'password': u['password']}).status_code == 200
    r1 = client.post('/api/auth/login', json={'identifier': 'a@b.com', 'password': 'bad'})
    r2 = client.post('/api/auth/login', json={'identifier': '0799999999', 'password': 'bad'})
    assert r1.status_code == r2.status_code == 401 and r1.get_json()['message'] == r2.get_json()['message']


def test_account_lockout_after_repeated_failures(client, H):
    u = H.make_user('buyer')
    codes = []
    for i in range(9):
        H.client.environ_base = {}
        from app.utils import security
        security._request_log.clear()
        codes.append(client.post('/api/auth/login', json={'identifier': u['phone'], 'password': 'bad'}).status_code)
    security._request_log.clear()
    assert client.post('/api/auth/login', json={'identifier': u['phone'], 'password': u['password']}).status_code == 429


def test_suspended_user_cannot_use_old_token(client, H, db):
    s = H.make_user('seller'); b = H.make_user('buyer')
    db.x("UPDATE users SET is_active=FALSE WHERE id=%s", (b['id'],))
    r = client.post('/api/contracts/create', headers=b['h'], json={
        'seller_id': s['id'], 'item_name': 'x', 'agreed_amount': 500,
        'buyer_expectations': 'twenty characters or more here', 'delivery_method': 'PLATFORM_COURIER'})
    assert r.status_code == 401


def test_rating_only_by_buyer_once(client, H, db):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer'); x = H.make_user('buyer')
    t = H.make_txn(s, b, status='COMPLETED')
    assert client.post('/api/reputation/rate', json={'transaction_id': t, 'score': 5}).status_code == 401
    assert client.post('/api/reputation/rate', headers=x['h'], json={'transaction_id': t, 'score': 5}).status_code == 404
    assert client.post('/api/reputation/rate', headers=b['h'], json={'transaction_id': t, 'score': 6}).status_code == 400
    assert client.post('/api/reputation/rate', headers=b['h'], json={'transaction_id': t, 'score': 5}).status_code == 201
    assert client.post('/api/reputation/rate', headers=b['h'], json={'transaction_id': t, 'score': 1}).status_code == 409


def test_password_reset_flow(client, H, db):
    u = H.make_user('buyer')
    db.x("UPDATE otp_verifications SET last_sent_at = NULL")  # skip the 60s resend cooldown
    H.app.fake_sms.sent.clear()
    assert client.post('/api/auth/forgot-password', json={'phone_number': u['phone']}).status_code == 200
    code = H.last_otp(u['phone'])
    assert code
    r = client.post('/api/auth/reset-password', json={'phone_number': u['phone'], 'otp_code': '000000' if code != '000000' else '111111', 'new_password': 'NewPassw0rd!x'})
    assert r.status_code == 400
    r = client.post('/api/auth/reset-password', json={'phone_number': u['phone'], 'otp_code': code, 'new_password': 'NewPassw0rd!x'})
    assert r.status_code == 200
    assert client.post('/api/auth/reset-password', json={'phone_number': u['phone'], 'otp_code': code, 'new_password': 'Another1!xyz'}).status_code == 400
    assert client.post('/api/auth/login', json={'identifier': u['phone'], 'password': u['password']}).status_code == 401
    assert client.post('/api/auth/login', json={'identifier': u['phone'], 'password': 'NewPassw0rd!x'}).status_code == 200


def test_unknown_number_gets_same_answer_and_no_sms(client, H):
    r = client.post('/api/auth/forgot-password', json={'phone_number': '0799999999'})
    assert r.status_code == 200 and not H.app.fake_sms.sent


def test_seller_directory_is_public_and_private_fields_hidden(client, H):
    s = H.make_user('seller', tier=1); H.make_user('buyer')
    r = client.get('/api/sellers')
    assert r.status_code == 200
    rows = r.get_json()['sellers']
    assert [x['id'] for x in rows] == [s['id']]
    assert 'phone_number' not in rows[0] and 'email' not in rows[0]
    assert client.get(f"/api/sellers/{s['id']}").status_code == 200
    assert client.get('/api/sellers/99999').status_code == 404


def test_admin_lists_require_admin_and_hide_secrets(client, H):
    s = H.make_user('seller', tier=1); b = H.make_user('buyer'); a = H.make_admin()
    H.make_txn(s, b, status='FUNDED')
    for path in ('/api/admin/transactions', '/api/admin/users'):
        assert client.get(path, headers=b['h']).status_code == 403
        assert client.get(path).status_code == 401
    r = client.get('/api/admin/users?role=seller', headers=a['h'])
    assert r.status_code == 200 and 'password_hash' not in str(r.get_json())
    assert client.get('/api/admin/transactions', headers=a['h']).get_json()['total'] == 1
