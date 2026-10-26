# app/routes/payments.py
#
# Payment endpoints for Zuno.
#
# ENDPOINTS:
# POST /api/payments/initiate                       -> buyer (JWT) triggers STK Push
# POST /api/payments/hook/stk/<secret>        -> Safaricom: STK result
# POST /api/payments/hook/b2c/result/<secret>      -> Safaricom: payout result
# POST /api/payments/hook/b2c/timeout/<secret>     -> Safaricom: payout queue timeout
# GET  /api/payments/status/<txn_id>                -> buyer/seller (JWT) polls status
#
# THE SAFARICOM CALLBACKS ARE THE MOST SENSITIVE ENDPOINTS ON THE PLATFORM.
# They are unauthenticated by nature (Safaricom has no login), so we protect them with:
#   1. a long random secret in the URL path (MPESA_CALLBACK_SECRET) - requests
#      without it get a plain 404,
#   2. state checks (only a PENDING transaction can become FUNDED),
#   3. amount checks (what Safaricom says was paid must equal buyer_pays),
#   4. database uniqueness (payment_reference is UNIQUE, so replays do nothing),
#   5. a raw copy of every callback in mpesa_events for reconciliation.

import hmac
import json
import os
from datetime import datetime

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app import mysql
from app.utils.auth import current_user, party_role
from app.utils.errors import err
from app.utils.helpers import log_transaction_action, log_security_event
from app.utils.security import check_rate_limit
from app.utils.validators import validate_required_fields, normalize_phone
from app.services.mpesa import initiate_stk_push, query_stk_status
import time
from app.services.notify import notify_phone
from app.services.sms import (
    send_deal_funded_notification,
    send_funds_released_notification,
    send_refund_notification,
    send_sms
)

payments_bp = Blueprint('payments', __name__)

ACK = {'ResultCode': 0, 'ResultDesc': 'Accepted'}
MAX_PAYOUT_ATTEMPTS = 3


def _secret_ok(provided):
    expected = os.getenv('MPESA_CALLBACK_SECRET', '')
    return len(expected) >= 16 and hmac.compare_digest(expected, str(provided))


def _store_event(kind, reference, payload):
    """Keep the raw Safaricom payload so any dispute with Safaricom can be reconciled."""
    try:
        cursor = mysql.connection.cursor()
        cursor.execute(
            "INSERT INTO mpesa_events (kind, reference, payload) VALUES (%s,%s,%s)",
            (kind, reference, json.dumps(payload)[:60000] if payload is not None else '{}'))
        mysql.connection.commit()
        cursor.close()
    except Exception as e:
        print(f"[MPESA EVENT] could not store {kind}: {e}")


# ══════════════════════════════════════════════════════════════
# ENDPOINT 1 - INITIATE PAYMENT (STK Push)
# ══════════════════════════════════════════════════════════════

@payments_bp.route('/initiate', methods=['POST'])
@jwt_required()
def initiate_payment():
    """
    POST /api/payments/initiate        (Authorization: Bearer <buyer token>)

    Body: { "transaction_id": "ZNO-...", "mpesa_phone": "0712345678" (optional) }

    Only the BUYER of this transaction can start the payment. The amount is
    always read from the database - never from the request.
    `mpesa_phone` lets the buyer pay from a different M-Pesa line; it defaults
    to their account phone.
    """
    rate_limit_error = check_rate_limit(5, 1, scope='payments_initiate')
    if rate_limit_error:
        return rate_limit_error

    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    data = request.get_json(silent=True) or {}
    valid, error = validate_required_fields(data, ['transaction_id'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM transactions WHERE id = %s", (data['transaction_id'],))
    txn = cursor.fetchone()
    cursor.close()

    if not txn:
        return err('Transaction not found', 404, 'NOT_FOUND')

    if party_role(txn, user) != 'buyer':
        return err('Only the buyer of this transaction can pay for it', 403, 'FORBIDDEN')

    if txn['status'] != 'PENDING':
        return err(f"This transaction cannot be paid. Status is '{txn['status']}'",
                   400, 'BAD_STATE')

    pay_phone = normalize_phone(data.get('mpesa_phone') or user['phone_number'])
    if not pay_phone:
        return err('Enter a valid Kenyan M-Pesa number', 400, 'VALIDATION_ERROR')

    # A second tap while the first request is still in flight (or just finished) must not send
    # a second PIN prompt to the buyer's phone.
    now = time.time()
    if now - _last_push.get(txn['id'], 0) < PUSH_COOLDOWN_SECONDS:
        return err('A payment request was just sent. Check your phone and enter your M-Pesa PIN.',
                   429, 'ALREADY_SENT')
    cursor = mysql.connection.cursor()
    cursor.execute(
        "SELECT COUNT(*) AS n FROM mpesa_events WHERE kind = 'STK_REQUEST' "
        "AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.transaction_id')) = %s "
        "AND created_at > NOW() - INTERVAL %s SECOND", (txn['id'], PUSH_COOLDOWN_SECONDS))
    recent = cursor.fetchone()['n']
    cursor.close()
    if recent:
        return err('A payment request was just sent. Check your phone and enter your M-Pesa PIN.',
                   429, 'ALREADY_SENT')
    _last_push[txn['id']] = now

    result = initiate_stk_push(
        phone_number=pay_phone,
        amount=txn['buyer_pays'],
        transaction_id=txn['id'],
        description="Zuno escrow payment"
    )

    if not result['success']:
        _last_push.pop(txn['id'], None)      # nothing was sent, so let them try again straight away
        return err(result['message'], 502, 'MPESA_ERROR')

    checkout_id = result['checkout_request_id']
    cursor = mysql.connection.cursor()
    cursor.execute("UPDATE transactions SET mpesa_checkout_id = %s WHERE id = %s",
                   (checkout_id, txn['id']))
    # Remember EVERY checkout id for this transaction, so a late callback from an
    # earlier push (buyer tapped Pay twice) can still be matched and not lost.
    cursor.execute(
        "INSERT INTO mpesa_events (kind, reference, payload) VALUES ('STK_REQUEST', %s, %s)",
        (checkout_id, json.dumps({'transaction_id': txn['id'],
                                  'amount': int(txn['buyer_pays']),
                                  'phone': pay_phone})))
    mysql.connection.commit()
    cursor.close()

    log_transaction_action(
        txn['id'], action='STK_PUSH_SENT', performed_by=str(user['id']),
        details=f"Checkout ID: {checkout_id}")

    return jsonify({
        'message': result['message'],
        'transaction_id': txn['id'],
        'amount': int(txn['buyer_pays']),
        'instruction': 'Check your phone and enter your M-Pesa PIN to complete payment.'
    }), 200


def _find_txn_for_checkout(cursor, checkout_id):
    """Match a callback to its transaction via every checkout id we ever issued."""
    cursor.execute(
        "SELECT payload FROM mpesa_events WHERE kind = 'STK_REQUEST' AND reference = %s "
        "ORDER BY id DESC LIMIT 1", (checkout_id,))
    event = cursor.fetchone()
    txn_id = None
    if event:
        try:
            txn_id = json.loads(event['payload']).get('transaction_id')
        except (ValueError, TypeError, AttributeError):
            txn_id = None
    if txn_id:
        cursor.execute("SELECT * FROM transactions WHERE id = %s", (txn_id,))
        txn = cursor.fetchone()
        if txn:
            return txn
    cursor.execute("SELECT * FROM transactions WHERE mpesa_checkout_id = %s", (checkout_id,))
    return cursor.fetchone()


# ══════════════════════════════════════════════════════════════
# ENDPOINT 2 - M-PESA STK CALLBACK (Safaricom calls this)
# ══════════════════════════════════════════════════════════════

def _fund_transaction(cursor, txn, mpesa_ref, amount_paid):
    """
    Atomic, replay-safe PENDING -> FUNDED. Used by the Safaricom callback and by the
    status check that asks Safaricom directly. Closes the cursor.
    """
    try:
        cursor.execute("""
            UPDATE transactions SET
                status = 'FUNDED',
                payment_reference = %s,
                amount_paid = %s,
                funded_at = %s
            WHERE id = %s AND status = 'PENDING'
        """, (mpesa_ref, amount_paid, datetime.now(), txn['id']))
        funded_now = cursor.rowcount == 1
        mysql.connection.commit()
    except Exception as e:
        # UNIQUE(payment_reference) violation = replay of a receipt already used
        mysql.connection.rollback()
        cursor.close()
        log_security_event('MPESA_DUPLICATE_RECEIPT', f"{mpesa_ref} on {txn['id']}: {e}")
        return False

    if not funded_now:
        # Already funded. If it was funded from a status check (placeholder reference),
        # the real M-Pesa receipt arriving now replaces the placeholder.
        if str(txn.get('payment_reference') or '').startswith('QRY-') and not mpesa_ref.startswith('QRY-'):
            try:
                cursor.execute("UPDATE transactions SET payment_reference = %s WHERE id = %s",
                               (mpesa_ref, txn['id']))
                mysql.connection.commit()
            except Exception:
                mysql.connection.rollback()
            cursor.close()
            return False
        cursor.close()
        # Money arrived for a transaction that is not PENDING (cancelled, expired,
        # already funded). If it is already funded with this same receipt it is a replay.
        if txn['payment_reference'] != mpesa_ref:
            log_security_event(
                'MPESA_PAYMENT_ON_NON_PENDING',
                f"Txn {txn['id']} is {txn['status']}; received ref {mpesa_ref} "
                f"Ksh {amount_paid}. NEEDS MANUAL REFUND.")
        return False

    cursor.execute("SELECT phone_number FROM users WHERE id = %s", (txn['seller_id'],))
    seller = cursor.fetchone()
    cursor.close()

    log_transaction_action(
        txn['id'], action='PAYMENT_RECEIVED', performed_by='MPESA_CALLBACK',
        old_value='PENDING', new_value='FUNDED',
        details=f"M-Pesa Ref: {mpesa_ref}, Amount: Ksh {amount_paid}")

    if seller:
        send_deal_funded_notification(
            seller['phone_number'], txn['item_name'], txn['seller_receives'], txn['id'])
        notify_phone(seller['phone_number'], 'Payment received in escrow',
                     f"Ksh {int(txn['buyer_pays']):,} is held for '{txn['item_name']}'. You can ship it now.",
                     'transaction', txn['id'])
    return True


PUSH_COOLDOWN_SECONDS = 20
_last_push = {}    # transaction id -> time we last asked Safaricom to prompt the buyer
_last_query = {}   # transaction id -> time of last direct ask to Safaricom


def _reconcile_pending(txn):
    """
    The buyer is waiting and the callback has not arrived: ask Safaricom directly.
    Throttled to once per 10s per transaction. Only a definite PAID funds the deal.
    Returns the fresh transaction row if its state changed, else None.
    """
    checkout_id = txn.get('mpesa_checkout_id')
    if txn['status'] != 'PENDING' or not checkout_id:
        return None
    now = time.time()
    if now - _last_query.get(txn['id'], 0) < 10:
        return None
    _last_query[txn['id']] = now

    outcome = query_stk_status(checkout_id)
    if outcome['state'] == 'PAID':
        # We asked for exactly buyer_pays, so that is what Safaricom charged.
        ref = f"QRY-{checkout_id[-20:]}"
        _fund_transaction(mysql.connection.cursor(), txn, ref, int(txn['buyer_pays']))
    elif outcome['state'] == 'FAILED':
        _store_event('STK_FAILED', txn['id'],
                     {'code': 'QUERY', 'reason': outcome['reason'][:200], 'checkout_id': checkout_id})
    else:
        return None
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM transactions WHERE id = %s", (txn['id'],))
    fresh = cursor.fetchone()
    cursor.close()
    return fresh


@payments_bp.route('/hook/stk/<secret>', methods=['POST'])
def mpesa_callback(secret):
    """Safaricom reports the result of an STK Push. Always answers 200 once authenticated."""
    if not _secret_ok(secret):
        return jsonify({'error': 'Not found'}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify(ACK), 200

    try:
        stk = data['Body']['stkCallback']
        result_code = int(stk['ResultCode'])
        checkout_id = stk['CheckoutRequestID']
    except (KeyError, TypeError, ValueError):
        _store_event('STK_CALLBACK_INVALID', None, data)
        return jsonify(ACK), 200

    _store_event('STK_CALLBACK', checkout_id, data)

    cursor = mysql.connection.cursor()
    txn = _find_txn_for_checkout(cursor, checkout_id)
    if not txn:
        cursor.close()
        log_security_event('MPESA_UNMATCHED_CALLBACK',
                           f"No transaction for checkout {checkout_id}")
        return jsonify(ACK), 200

    # ── Payment FAILED / CANCELLED by the buyer ───────────────
    if result_code != 0:
        cursor.close()
        _store_event('STK_FAILED', txn['id'],
                     {'code': result_code, 'reason': str(stk.get('ResultDesc', ''))[:200],
                      'checkout_id': checkout_id})
        log_transaction_action(
            txn['id'], action='PAYMENT_FAILED', performed_by='MPESA_CALLBACK',
            details=f"ResultCode: {result_code}, Reason: {stk.get('ResultDesc', '')}")
        return jsonify(ACK), 200

    # ── Payment SUCCEEDED: read what Safaricom says was paid ──
    items = (stk.get('CallbackMetadata') or {}).get('Item', [])
    metadata = {i.get('Name'): i.get('Value') for i in items}
    mpesa_ref = str(metadata.get('MpesaReceiptNumber', '')).strip()
    try:
        amount_paid = int(round(float(metadata.get('Amount', 0))))
    except (TypeError, ValueError):
        amount_paid = 0

    if not mpesa_ref:
        cursor.close()
        log_security_event('MPESA_CALLBACK_NO_RECEIPT', f"Checkout {checkout_id}")
        return jsonify(ACK), 200

    expected = int(txn['buyer_pays'])

    # Wrong amount: do NOT fund. Leave for manual reconciliation (money was taken).
    if amount_paid != expected:
        cursor.close()
        log_security_event(
            'MPESA_AMOUNT_MISMATCH',
            f"Txn {txn['id']} ref {mpesa_ref}: paid {amount_paid}, expected {expected}. "
            f"NEEDS MANUAL RECONCILIATION / REFUND.")
        log_transaction_action(
            txn['id'], action='PAYMENT_AMOUNT_MISMATCH', performed_by='MPESA_CALLBACK',
            details=f"Ref {mpesa_ref}: paid {amount_paid}, expected {expected}")
        return jsonify(ACK), 200

    _fund_transaction(cursor, txn, mpesa_ref, amount_paid)
    return jsonify(ACK), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 3 - B2C RESULT (payout result)
# ══════════════════════════════════════════════════════════════

def _find_payout(cursor, originator_id, conversation_id):
    cursor.execute("""
        SELECT * FROM payouts
        WHERE status = 'PROCESSING'
          AND ( (originator_conversation_id = %s AND %s <> '')
             OR (conversation_id = %s AND %s <> '') )
        LIMIT 1
    """, (originator_id or '', originator_id or '', conversation_id or '', conversation_id or ''))
    return cursor.fetchone()


@payments_bp.route('/hook/b2c/result/<secret>', methods=['POST'])
def b2c_result(secret):
    """Safaricom reports the final result of ONE payout. Only that payout is touched."""
    if not _secret_ok(secret):
        return jsonify({'error': 'Not found'}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify(ACK), 200

    try:
        result = data['Result']
        result_code = int(result['ResultCode'])
        conversation_id = result.get('ConversationID', '')
        originator_id = result.get('OriginatorConversationID', '')
    except (KeyError, TypeError, ValueError):
        _store_event('B2C_RESULT_INVALID', None, data)
        return jsonify(ACK), 200

    _store_event('B2C_RESULT', originator_id or conversation_id, data)

    cursor = mysql.connection.cursor()
    payout = _find_payout(cursor, originator_id, conversation_id)

    if not payout:
        cursor.close()
        log_security_event('MPESA_UNMATCHED_B2C',
                           f"No PROCESSING payout for {originator_id}/{conversation_id}")
        return jsonify(ACK), 200

    if result_code == 0:
        params = {p.get('Key'): p.get('Value')
                  for p in (result.get('ResultParameters') or {}).get('ResultParameter', [])}
        receipt = str(params.get('TransactionReceipt', '') or result.get('TransactionID', ''))
        cursor.execute("""
            UPDATE payouts SET status = 'COMPLETED', mpesa_reference = %s, completed_at = %s
            WHERE id = %s AND status = 'PROCESSING'
        """, (receipt, datetime.now(), payout['id']))
        mysql.connection.commit()
        cursor.close()

        log_transaction_action(
            payout['transaction_id'], action='PAYOUT_COMPLETED', performed_by='MPESA_CALLBACK',
            details=f"{payout['payout_type']} Ksh {int(payout['amount']):,} ref {receipt}")

        if payout['payout_type'] in ('SELLER_RELEASE', 'SPLIT_SELLER'):
            send_funds_released_notification(payout['mpesa_number'], payout['amount'], receipt)
            notify_phone(payout['mpesa_number'], 'Money sent to your M-Pesa',
                         f"Ksh {int(payout['amount']):,} was paid out. Ref {receipt}.",
                         'transaction', f"payout:{payout['transaction_id']}")
        else:
            send_refund_notification(payout['mpesa_number'], payout['amount'], 'your order')
            notify_phone(payout['mpesa_number'], 'Refund sent',
                         f"Ksh {int(payout['amount']):,} was refunded to your M-Pesa. Ref {receipt}.",
                         'transaction', f"payout:{payout['transaction_id']}")
    else:
        reason = str(result.get('ResultDesc', 'Unknown error'))[:500]
        cursor.execute("""
            UPDATE payouts SET status = 'FAILED', failure_reason = %s
            WHERE id = %s AND status = 'PROCESSING'
        """, (reason, payout['id']))
        mysql.connection.commit()
        cursor.close()
        log_transaction_action(
            payout['transaction_id'], action='PAYOUT_FAILED', performed_by='MPESA_CALLBACK',
            details=f"{payout['payout_type']}: {reason}")
        log_security_event('PAYOUT_FAILED',
                           f"Payout {payout['id']} ({payout['transaction_id']}): {reason}")

    return jsonify(ACK), 200


@payments_bp.route('/hook/b2c/timeout/<secret>', methods=['POST'])
def b2c_timeout(secret):
    """
    Safaricom could not process the payout request in time: it was NOT sent.
    Put it back in the queue a limited number of times, then hand it to a human.
    """
    if not _secret_ok(secret):
        return jsonify({'error': 'Not found'}), 404

    data = request.get_json(silent=True) or {}
    result = data.get('Result', data)
    originator_id = result.get('OriginatorConversationID', '')
    conversation_id = result.get('ConversationID', '')
    _store_event('B2C_TIMEOUT', originator_id or conversation_id, data)

    cursor = mysql.connection.cursor()
    payout = _find_payout(cursor, originator_id, conversation_id)
    if payout:
        new_status = 'PENDING' if payout['attempts'] < MAX_PAYOUT_ATTEMPTS else 'NEEDS_REVIEW'
        cursor.execute(
            "UPDATE payouts SET status = %s, failure_reason = 'Queue timeout' "
            "WHERE id = %s AND status = 'PROCESSING'", (new_status, payout['id']))
        mysql.connection.commit()
    cursor.close()
    return jsonify(ACK), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 4 - CHECK PAYMENT STATUS
# ══════════════════════════════════════════════════════════════

@payments_bp.route('/status/<transaction_id>', methods=['GET'])
@jwt_required()
def check_payment_status(transaction_id):
    """Buyer or seller of the transaction (or an admin) polls this after the STK push."""
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM transactions WHERE id = %s", (transaction_id,))
    txn = cursor.fetchone()

    if not txn or party_role(txn, user) is None:
        cursor.close()
        # Same answer for "does not exist" and "not yours": no probing of IDs
        return err('Transaction not found', 404, 'NOT_FOUND')

    if txn['status'] == 'PENDING':
        cursor.close()
        txn = _reconcile_pending(txn) or txn
        cursor = mysql.connection.cursor()

    # Latest failed attempt (only if it is newer than the latest push), so the
    # buyer's screen can stop waiting and say why.
    cursor.execute(
        "SELECT payload, id FROM mpesa_events WHERE kind = 'STK_FAILED' AND reference = %s "
        "ORDER BY id DESC LIMIT 1", (txn['id'],))
    failed = cursor.fetchone()
    cursor.execute(
        "SELECT MAX(id) AS last_id FROM mpesa_events WHERE kind = 'STK_REQUEST' "
        "AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.transaction_id')) = %s", (txn['id'],))
    pushed = cursor.fetchone()
    cursor.close()
    last_failure = None
    if failed and pushed and pushed['last_id'] and failed['id'] > pushed['last_id']:
        try:
            last_failure = json.loads(failed['payload']).get('reason')
        except (ValueError, TypeError):
            last_failure = 'Payment was not completed.'

    paid_states = ('FUNDED', 'IN_TRANSIT', 'DELIVERED', 'INSPECTION',
                   'COMPLETED', 'DISPUTED', 'RESOLVED', 'REFUNDED')
    return jsonify({
        'transaction_id': txn['id'],
        'status': txn['status'],
        'payment_reference': txn['payment_reference'],
        'funded_at': str(txn['funded_at']) if txn.get('funded_at') else None,
        'is_paid': txn['status'] in paid_states and txn['funded_at'] is not None,
        'last_failure': last_failure
    }), 200
