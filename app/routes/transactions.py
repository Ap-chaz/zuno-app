# app/routes/transactions.py
#
# The core escrow transaction engine for Zuno.
#
# A transaction can only be created from a CONFIRMED contract.
# This ensures both parties have agreed before money moves.
#
# THE TRANSACTION STATE MACHINE:
#
# PENDING → FUNDED → IN_TRANSIT → DELIVERED → INSPECTION → COMPLETED
#                                                    ↓
#                                                DISPUTED → RESOLVED
#                                                    ↓
#                                                 REFUNDED
#
# Each status change is logged to the audit trail.
# Each change triggers an SMS to both parties.
#
# ENDPOINTS:
# POST /api/transactions/create                  → create from contract
# GET  /api/transactions/<id>                    → get deal details
# GET  /api/transactions/<id>/verify-link        → verify payment link
# POST /api/transactions/<id>/ship               → seller marks shipped
# POST /api/transactions/<id>/confirm-delivery   → buyer confirms receipt
# POST /api/transactions/<id>/approve            → buyer approves in inspection
# POST /api/transactions/<id>/cancel             → cancel before funding
# GET  /api/transactions/my                      → seller's transactions

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import mysql
from app.utils.helpers import (
    generate_transaction_id,
    calculate_fees,
    log_transaction_action,
    log_security_event
)
from app.utils.security import (
    build_payment_link,
    verify_link_signature,
    check_rate_limit
)
from app.utils.validators import validate_required_fields, validate_amount
from app.utils.auth import current_user, party_role
from app.utils.errors import err
from app.services.escrow import settle_transaction, RELEASE
from app.services.notify import notify_phone
from app.services.sms import (
    send_sms,
    send_deal_funded_notification,
    send_item_shipped_notification,
    send_delivery_confirmed_notification
)
from datetime import datetime, timedelta
import os

transactions_bp = Blueprint('transactions', __name__)

INSPECTION_HOURS = int(os.getenv('INSPECTION_WINDOW_HOURS', 24))


# ══════════════════════════════════════════════════════════════
# ENDPOINT 1 — CREATE TRANSACTION
# ══════════════════════════════════════════════════════════════

@transactions_bp.route('/create', methods=['POST'])
@jwt_required()
def create_transaction():
    """
    POST /api/transactions/create

    Seller creates an escrow transaction from an AGREED contract.
    This generates the signed payment link to send to the buyer.

    WHY must a contract exist first?
    Because both parties must agree on item details and delivery
    before money moves. The contract is that agreement.

    What happens:
    1. Verify the contract exists and is AGREED
    2. Calculate fee breakdown
    3. Generate unique transaction ID
    4. Generate cryptographically signed payment link
    5. Save transaction with PENDING status
    6. Return payment link for seller to share with buyer

    Expected body:
    {
        "contract_id": 1
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json()

    valid, error = validate_required_fields(data, ['contract_id'])
    if not valid:
        return jsonify({'error': error}), 400

    cursor = mysql.connection.cursor()

    # ── Verify contract exists and belongs to this seller ─────
    cursor.execute("""
        SELECT * FROM deal_contracts
        WHERE id = %s AND seller_id = %s
    """, (data['contract_id'], user_id))

    contract = cursor.fetchone()

    if not contract:
        cursor.close()
        return jsonify({'error': 'Contract not found'}), 404

    # ── Contract must be AGREED by both parties ───────────────
    if contract['status'] != 'AGREED':
        cursor.close()
        return jsonify({
            'error': f"Cannot create transaction. "
                     f"Contract status is '{contract['status']}'. "
                     f"Buyer must confirm the contract first."
        }), 400

    # ── Check no transaction already exists for this contract ─
    cursor.execute(
        "SELECT id FROM transactions WHERE contract_id = %s",
        (data['contract_id'],)
    )
    if cursor.fetchone():
        cursor.close()
        return jsonify({
            'error': 'A transaction already exists for this contract.'
        }), 409

    # ── Calculate the full fee breakdown ──────────────────────
    fees = calculate_fees(contract['agreed_amount'])

    # ── Generate unique transaction ID ────────────────────────
    # Keep trying until we get a unique one
    # (collision probability is astronomically low but we check anyway)
    txn_id = generate_transaction_id()
    cursor.execute(
        "SELECT id FROM transactions WHERE id = %s", (txn_id,)
    )
    while cursor.fetchone():
        txn_id = generate_transaction_id()

    # ── Save transaction ──────────────────────────────────────
    cursor.execute("""
        INSERT INTO transactions (
            id, contract_id, seller_id, buyer_user_id, buyer_phone, buyer_name,
            item_name, item_description,
            amount, platform_fee, buyer_fee_share,
            seller_fee_share, buyer_pays, seller_receives,
            delivery_method, status
        ) VALUES (
            %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'PENDING'
        )
    """, (
        txn_id,
        contract['id'],
        user_id,
        contract.get('buyer_user_id'),
        contract['buyer_phone'],
        contract['buyer_name'],
        contract['item_name'],
        contract['item_description'],
        fees['amount'],
        fees['total_fee'],
        fees['buyer_fee_share'],
        fees['seller_fee_share'],
        fees['buyer_pays'],
        fees['seller_receives'],
        contract['delivery_method']
    ))
    mysql.connection.commit()

    # ── Log the creation ──────────────────────────────────────
    log_transaction_action(
        txn_id,
        action='TRANSACTION_CREATED',
        performed_by=str(user_id),
        new_value='PENDING',
        details=f"Created from contract {contract['id']}"
    )

    cursor.close()

    # ── Generate signed payment link ──────────────────────────
    # This link is cryptographically signed — cannot be forged
    payment_link = build_payment_link(
        txn_id, user_id, fees['buyer_pays']
    )

    try:
        send_sms(contract['buyer_phone'],
                 f"Zuno: '{contract['item_name']}' is ready for payment. Pay Ksh "
                 f"{int(fees['buyer_pays']):,} safely into escrow: {payment_link}")
    except Exception as e:
        print(f"[TXN] buyer SMS failed: {e}")

    return jsonify({
        'message': 'Transaction created successfully.',
        'transaction_id': txn_id,
        'payment_link': payment_link,
        'fee_breakdown': {
            'item_price': fees['amount'],
            'platform_fee': fees['total_fee'],
            'buyer_pays': fees['buyer_pays'],
            'seller_receives': fees['seller_receives'],
            'fee_note': (
                f"The {os.getenv('PLATFORM_FEE_PERCENT', 2.5)}% "
                f"platform fee is shared equally between "
                f"buyer and seller."
            )
        },
        'instruction': 'Share the payment_link with your buyer '
                       'via TikTok DM, WhatsApp, or any channel.'
    }), 201


# ══════════════════════════════════════════════════════════════
# ENDPOINT 2 — GET TRANSACTION DETAILS
# ══════════════════════════════════════════════════════════════

@transactions_bp.route('/quote', methods=['GET'])
def fee_quote():
    """GET /api/transactions/quote?amount=5000 -> the exact fee breakdown the API will charge."""
    rate_limit_error = check_rate_limit(60, 1, scope='fee_quote')
    if rate_limit_error:
        return rate_limit_error
    valid, error = validate_amount(request.args.get('amount'))
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    fees = calculate_fees(request.args.get('amount'))
    return jsonify({
        'item_price': fees['amount'], 'platform_fee': fees['total_fee'],
        'buyer_fee_share': fees['buyer_fee_share'], 'seller_fee_share': fees['seller_fee_share'],
        'buyer_pays': fees['buyer_pays'], 'seller_receives': fees['seller_receives'],
        'fee_percent': float(os.getenv('PLATFORM_FEE_PERCENT', 2.5)),
    }), 200


@transactions_bp.route('/<transaction_id>', methods=['GET'])
def get_transaction(transaction_id):
    """
    GET /api/transactions/<transaction_id>

    Returns transaction details. Public endpoint — no login needed.
    This is what the buyer sees when they open the payment link.

    We show seller reputation data so buyers can make
    informed decisions about who they are paying.
    """
    rate_limit_error = check_rate_limit()
    if rate_limit_error:
        return rate_limit_error

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT
            t.id, t.item_name, t.item_description,
            t.item_photo, t.amount, t.buyer_pays,
            t.buyer_fee_share, t.status,
            t.delivery_method, t.created_at,
            t.funded_at, t.shipped_at,
            t.inspection_ends_at,
            u.full_name as seller_name,
            u.business_name,
            u.is_verified,
            r.completion_rate,
            r.dispute_rate,
            r.average_rating,
            r.total_transactions,
            r.trust_score,
            r.trust_level
        FROM transactions t
        JOIN users u ON u.id = t.seller_id
        LEFT JOIN seller_reputation r ON r.seller_id = t.seller_id
        WHERE t.id = %s
    """, (transaction_id,))

    txn = cursor.fetchone()
    cursor.close()

    if not txn:
        # Log this — could be someone probing for valid IDs
        log_security_event(
            'INVALID_TXN_ACCESS',
            f"Access attempt on non-existent transaction: {transaction_id}",
            ip_address=request.remote_addr
        )
        return jsonify({'error': 'Transaction not found'}), 404

    # Convert timestamps to strings
    for field in ['created_at', 'funded_at', 'shipped_at',
                  'inspection_ends_at']:
        if txn.get(field):
            txn[field] = str(txn[field])

    return jsonify({'transaction': txn}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 3 — VERIFY PAYMENT LINK
# ══════════════════════════════════════════════════════════════

@transactions_bp.route('/<transaction_id>/verify-link', methods=['GET'])
def verify_payment_link(transaction_id):
    """
    GET /api/transactions/<transaction_id>/verify-link?sig=xxxx

    Called automatically when a buyer opens a payment link.
    Verifies the cryptographic signature before showing
    the payment page.

    If signature is invalid:
    → Fraud warning returned
    → Security event logged
    → Payment page never shown

    This is the anti-fraud gate that protects buyers from
    fake payment links.
    """
    rate_limit_error = check_rate_limit()
    if rate_limit_error:
        return rate_limit_error

    provided_sig = request.args.get('sig')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT id, seller_id, buyer_pays, status
        FROM transactions
        WHERE id = %s
    """, (transaction_id,))

    txn = cursor.fetchone()
    cursor.close()

    if not txn:
        log_security_event(
            'FAKE_LINK_ATTEMPT',
            f"Signature check on non-existent transaction: {transaction_id}",
            ip_address=request.remote_addr
        )
        return jsonify({
            'valid': False,
            'warning': '⚠️ This link is invalid. '
                       'Do NOT make any payment. '
                       'Report to support@zuno.co.ke'
        }), 404

    # Verify the cryptographic signature
    is_valid, error = verify_link_signature(
        transaction_id,
        txn['seller_id'],
        txn['buyer_pays'],
        provided_sig
    )

    if not is_valid:
        log_security_event(
            'INVALID_SIGNATURE',
            f"Invalid signature for transaction {transaction_id}. "
            f"Provided: {provided_sig}",
            ip_address=request.remote_addr
        )
        return jsonify({
            'valid': False,
            'warning': '⚠️ WARNING: This payment link failed our '
                       'security check. Do NOT make any payment. '
                       'Report this to support@zuno.co.ke'
        }), 403

    return jsonify({
        'valid': True,
        'transaction_id': transaction_id,
        'status': txn['status'],
        'message': 'Link verified. Safe to proceed with payment.'
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 4 — MARK AS SHIPPED (Seller)
# ══════════════════════════════════════════════════════════════

@transactions_bp.route('/<transaction_id>/ship', methods=['POST'])
@jwt_required()
def mark_shipped(transaction_id):
    """
    POST /api/transactions/<transaction_id>/ship

    Seller marks the item as shipped after payment is confirmed (status FUNDED).

    Body: { "shipping_notes": "...", "tracking_number": "...", "courier_name": "G4S" }
    """
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')
    data = request.get_json(silent=True) or {}

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM transactions WHERE id = %s AND seller_id = %s",
                   (transaction_id, user['id']))
    txn = cursor.fetchone()

    if not txn:
        cursor.close()
        return err('Transaction not found', 404, 'NOT_FOUND')

    now = datetime.now()
    # The WHERE status='FUNDED' makes this safe against double submits
    cursor.execute("""
        UPDATE transactions SET
            status = 'IN_TRANSIT', shipped_at = %s, shipping_notes = %s,
            tracking_number = %s, courier_name = %s
        WHERE id = %s AND status = 'FUNDED'
    """, (now, str(data.get('shipping_notes', ''))[:1000],
          str(data.get('tracking_number', ''))[:100],
          str(data.get('courier_name', ''))[:100], transaction_id))
    changed = cursor.rowcount == 1
    mysql.connection.commit()
    cursor.close()

    if not changed:
        return err(f"Cannot mark as shipped. Current status is '{txn['status']}'. "
                   f"Transaction must be FUNDED first.", 400, 'BAD_STATE')

    log_transaction_action(
        transaction_id, action='STATUS_CHANGED', performed_by=str(user['id']),
        old_value='FUNDED', new_value='IN_TRANSIT',
        details=f"Tracking: {data.get('tracking_number') or 'Not provided'}")

    send_item_shipped_notification(
        txn['buyer_phone'], txn['item_name'],
        data.get('tracking_number', ''), transaction_id)
    notify_phone(txn['buyer_phone'], 'Your item is on its way',
                 f"'{txn['item_name']}' was marked as shipped. Inspect it, then approve or report a problem.",
                 'transaction', transaction_id)

    return jsonify({
        'message': 'Item marked as shipped. Buyer has been notified.',
        'transaction_id': transaction_id,
        'status': 'IN_TRANSIT'
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 5 — CONFIRM DELIVERY (Buyer)
# ══════════════════════════════════════════════════════════════

@transactions_bp.route('/<transaction_id>/confirm-delivery', methods=['POST'])
@jwt_required()
def confirm_delivery(transaction_id):
    """
    POST /api/transactions/<transaction_id>/confirm-delivery

    The BUYER (logged in) confirms the item was physically received.
    This starts the inspection window (INSPECTION_WINDOW_HOURS).
    Then: approve -> funds released, dispute -> funds frozen,
    silence -> auto-release when the window ends.
    """
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM transactions WHERE id = %s", (transaction_id,))
    txn = cursor.fetchone()

    if not txn or party_role(txn, user) != 'buyer':
        cursor.close()
        # Same answer whether it doesn't exist or isn't yours
        return err('Transaction not found', 404, 'NOT_FOUND')

    now = datetime.now()
    inspection_ends = now + timedelta(hours=INSPECTION_HOURS)

    cursor.execute("""
        UPDATE transactions SET
            status = 'INSPECTION', delivered_at = %s,
            inspection_starts_at = %s, inspection_ends_at = %s
        WHERE id = %s AND status = 'IN_TRANSIT'
    """, (now, now, inspection_ends, transaction_id))
    changed = cursor.rowcount == 1
    mysql.connection.commit()

    if not changed:
        cursor.close()
        return err(f"Cannot confirm delivery. Current status is '{txn['status']}'",
                   400, 'BAD_STATE')

    cursor.execute("SELECT phone_number FROM users WHERE id = %s", (txn['seller_id'],))
    seller = cursor.fetchone()
    cursor.close()

    log_transaction_action(
        transaction_id, action='STATUS_CHANGED', performed_by=str(user['id']),
        old_value='IN_TRANSIT', new_value='INSPECTION',
        details=f"Inspection window ends at {inspection_ends}")

    if seller:
        send_sms(seller['phone_number'],
                 f"Zuno: Buyer confirmed receipt of '{txn['item_name']}'. "
                 f"The {INSPECTION_HOURS}-hour inspection window has started. "
                 f"Funds are released when the buyer approves or the window ends.")

    send_sms(txn['buyer_phone'],
             f"Zuno: You have {INSPECTION_HOURS} hours to inspect '{txn['item_name']}'. "
             f"If satisfied, approve to release payment. If there is an issue, raise a "
             f"dispute before {inspection_ends.strftime('%d %b %Y %H:%M')}.")

    return jsonify({
        'message': f"Delivery confirmed. You have {INSPECTION_HOURS} hours to inspect the item.",
        'inspection_ends_at': inspection_ends.isoformat(),
        'next_steps': {
            'approve': f"POST /api/transactions/{transaction_id}/approve",
            'dispute': "POST /api/disputes/raise"
        }
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 6 — BUYER APPROVES (Releases Funds)
# ══════════════════════════════════════════════════════════════

@transactions_bp.route('/<transaction_id>/approve', methods=['POST'])
@jwt_required()
def approve_transaction(transaction_id):
    """
    POST /api/transactions/<transaction_id>/approve

    The logged-in BUYER approves the item during the inspection window.
    This releases the escrowed funds to the seller (through the escrow service:
    atomic, one payout, paid to the seller's phone).

    Body (optional): { "rating": 5, "comment": "Great seller!" }
    """
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')
    data = request.get_json(silent=True) or {}

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM transactions WHERE id = %s", (transaction_id,))
    txn = cursor.fetchone()
    mysql.connection.commit()
    cursor.close()

    if not txn or party_role(txn, user) != 'buyer':
        return err('Transaction not found', 404, 'NOT_FOUND')

    result = settle_transaction(
        transaction_id, RELEASE, ('INSPECTION',), triggered_by=f"BUYER:{user['id']}")

    if not result.ok:
        status = 400 if result.code in ('BAD_STATE', 'CONFLICT') else 500
        return err(result.message if result.code != 'BAD_STATE'
                   else f"Cannot approve. Current status is '{txn['status']}'",
                   status, result.code)

    # Optional rating (best effort; UNIQUE(transaction_id) prevents duplicates)
    if data.get('rating'):
        try:
            score = int(data['rating'])
            if 1 <= score <= 5:
                cursor = mysql.connection.cursor()
                cursor.execute("""
                    INSERT IGNORE INTO ratings
                        (transaction_id, seller_id, buyer_phone, score, comment)
                    VALUES (%s, %s, %s, %s, %s)
                """, (transaction_id, txn['seller_id'], txn['buyer_phone'],
                      score, str(data.get('comment', ''))[:1000]))
                mysql.connection.commit()
                cursor.close()
        except (ValueError, TypeError):
            pass

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT phone_number FROM users WHERE id = %s", (txn['seller_id'],))
    seller = cursor.fetchone()
    cursor.close()
    if seller:
        send_delivery_confirmed_notification(
            seller['phone_number'], txn['item_name'], txn['seller_receives'])
        notify_phone(seller['phone_number'], 'Buyer approved the item',
                     f"Ksh {int(txn['seller_receives']):,} is being released to your M-Pesa.",
                     'transaction', f'payout:{transaction_id}')

    return jsonify({
        'message': 'Transaction approved. Funds are being released to the seller.',
        'transaction_id': transaction_id,
        'status': 'COMPLETED',
        'amount_released': int(txn['seller_receives'])
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 7 — CANCEL TRANSACTION (Seller, before payment)
# ══════════════════════════════════════════════════════════════

@transactions_bp.route('/<transaction_id>/cancel', methods=['POST'])
@jwt_required()
def cancel_transaction(transaction_id):
    """
    POST /api/transactions/<transaction_id>/cancel

    Only a PENDING (unpaid) transaction can be cancelled, by its seller.
    Once funded, the only way out is the dispute process.
    """
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM transactions WHERE id = %s AND seller_id = %s",
                   (transaction_id, user['id']))
    txn = cursor.fetchone()

    if not txn:
        cursor.close()
        return err('Transaction not found', 404, 'NOT_FOUND')

    cursor.execute("""
        UPDATE transactions SET status = 'CANCELLED', cancelled_at = %s
        WHERE id = %s AND status = 'PENDING'
    """, (datetime.now(), transaction_id))
    changed = cursor.rowcount == 1
    mysql.connection.commit()
    cursor.close()

    if not changed:
        return err(f"Cannot cancel. Status is '{txn['status']}'. Only PENDING transactions "
                   f"can be cancelled. For funded transactions please raise a dispute.",
                   400, 'BAD_STATE')

    log_transaction_action(
        transaction_id, action='TRANSACTION_CANCELLED', performed_by=str(user['id']),
        old_value='PENDING', new_value='CANCELLED')

    send_sms(txn['buyer_phone'],
             f"Zuno: The deal for '{txn['item_name']}' was cancelled by the seller. "
             f"No payment was taken. Transaction ID: {transaction_id}")
    notify_phone(txn['buyer_phone'], 'Seller cancelled the deal',
                 f"'{txn['item_name']}' was cancelled by the seller. No payment was taken.",
                 'transaction', transaction_id)

    return jsonify({'message': 'Transaction cancelled successfully.',
                    'transaction_id': transaction_id}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 8 — GET MY TRANSACTIONS (Seller AND Buyer)
# ══════════════════════════════════════════════════════════════

_TXN_TIME_FIELDS = ['created_at', 'funded_at', 'shipped_at', 'delivered_at',
                    'completed_at', 'cancelled_at', 'inspection_ends_at',
                    'inspection_starts_at']


@transactions_bp.route('/my', methods=['GET'])
@jwt_required()
def get_my_transactions():
    """
    GET /api/transactions/my
    GET /api/transactions/my?status=FUNDED&as=buyer|seller

    Transactions where the caller is the seller or the buyer. Each row carries
    `viewer_role` so the UI knows which side it is looking at.
    """
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    status_filter = request.args.get('status')
    as_role = request.args.get('as')

    where = []
    params = []
    if as_role == 'seller':
        where.append("t.seller_id = %s"); params.append(user['id'])
    elif as_role == 'buyer':
        where.append("t.buyer_user_id = %s"); params.append(user['id'])
    else:
        where.append("(t.seller_id = %s OR t.buyer_user_id = %s)")
        params += [user['id'], user['id']]
    if status_filter:
        where.append("t.status = %s"); params.append(status_filter.upper())

    cursor = mysql.connection.cursor()
    cursor.execute(f"""
        SELECT t.*, u.full_name AS seller_name, u.business_name AS seller_business
        FROM transactions t JOIN users u ON u.id = t.seller_id
        WHERE {' AND '.join(where)}
        ORDER BY t.created_at DESC
        LIMIT 500
    """, params)
    transactions = cursor.fetchall()

    # The seller's own payout state per deal (what they are owed vs already paid).
    payout_state = {}
    ids = [t['id'] for t in transactions if t['seller_id'] == user['id']]
    if ids:
        marks = ','.join(['%s'] * len(ids))
        cursor.execute(
            f"SELECT transaction_id, status FROM payouts WHERE transaction_id IN ({marks}) "
            f"AND payout_type IN ('SELLER_RELEASE','SPLIT_SELLER')", ids)
        payout_state = {r['transaction_id']: r['status'] for r in cursor.fetchall()}
    cursor.close()

    for txn in transactions:
        txn['viewer_role'] = 'seller' if txn['seller_id'] == user['id'] else 'buyer'
        if txn['id'] in payout_state:
            txn['payout_status'] = payout_state[txn['id']]
        for field in _TXN_TIME_FIELDS:
            if txn.get(field):
                txn[field] = txn[field].isoformat()
        # Internal / sensitive columns the other side does not need
        txn.pop('mpesa_checkout_id', None)

    return jsonify({'transactions': transactions, 'total': len(transactions)}), 200
