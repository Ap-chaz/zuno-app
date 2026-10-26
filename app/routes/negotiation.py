# app/routes/negotiation.py
#
# Negotiation panel: the buyer and seller talk and make settlement offers
# before (or instead of) admin arbitration.
#
# Every endpoint needs a login and only the dispute's buyer/seller can use it
# (admins can read). Your side comes from your account, never from the request.
#
# SETTLEMENT OFFERS
# An offer is "the BUYER gets back Ksh X; the seller keeps the rest".
#   buyer receives : X
#   seller receives: seller_receives - X      (seller_receives = price - seller's fee share)
#   Zuno keeps     : the platform fee
# X must be between 1 and seller_receives. For a FULL refund use admin resolution.
# Accepting an offer settles the money immediately through the escrow service.
#
# ENDPOINTS:
# POST /api/negotiation/<dispute_id>/message
# GET  /api/negotiation/<dispute_id>/messages
# POST /api/negotiation/<dispute_id>/offer
# POST /api/negotiation/<dispute_id>/offer/<offer_id>/respond

from datetime import datetime

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app import mysql
from app.routes.disputes import load_dispute_for_party
from app.services.escrow import settle_transaction, SPLIT
from app.services.notify import notify_phone
from app.services.sms import send_sms
from app.utils.auth import current_user
from app.utils.errors import err
from app.utils.security import check_rate_limit
from app.utils.validators import validate_required_fields

negotiation_bp = Blueprint('negotiation', __name__)

OPEN_STATES_BLOCKED = ('RESOLVED',)


def _notify_other_party(dispute, txn, role, text):
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT phone_number FROM users WHERE id = %s", (txn['seller_id'],))
    seller = cursor.fetchone()
    cursor.close()
    phone = (seller['phone_number'] if seller else None) if role == 'buyer' else txn['buyer_phone']
    if phone:
        send_sms(phone, f"Zuno Dispute #{dispute['id']}: {text}")
        notify_phone(phone, 'Dispute update', text, 'dispute', dispute['id'])


def _offer_bounds(txn):
    return 1, int(txn['seller_receives'])


# ══════════════════════════════════════════════════════════════
# 1 — SEND A MESSAGE
# ══════════════════════════════════════════════════════════════

@negotiation_bp.route('/<int:dispute_id>/message', methods=['POST'])
@jwt_required()
def send_message(dispute_id):
    """Body: { "message": "text" }. Visible to both parties and admins."""
    rate_limit_error = check_rate_limit(30, 1, scope='negotiation_message')
    if rate_limit_error:
        return rate_limit_error

    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    dispute, txn, role = load_dispute_for_party(dispute_id, user)
    if not dispute or role not in ('buyer', 'seller'):
        return err('Dispute not found', 404, 'NOT_FOUND')
    if dispute['status'] in OPEN_STATES_BLOCKED:
        return err('This dispute is already resolved.', 400, 'BAD_STATE')

    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['message'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    text = str(data['message']).strip()
    if len(text) > 2000:
        return err('Message is too long (max 2000 characters).', 400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        INSERT INTO negotiation_messages
            (dispute_id, sender_phone, sender_role, message, is_offer)
        VALUES (%s,%s,%s,%s,FALSE)
    """, (dispute_id, user['phone_number'], role, text))
    message_id = cursor.lastrowid
    cursor.execute("""
        UPDATE disputes SET status = 'NEGOTIATING'
        WHERE id = %s AND status IN ('OPEN','EVIDENCE_COLLECTION')
    """, (dispute_id,))
    mysql.connection.commit()
    cursor.close()

    _notify_other_party(
        dispute, txn, role,
        f"{'The buyer' if role == 'buyer' else 'The seller'} sent a new message about "
        f"'{txn['item_name']}'. Log in to Zuno to read and respond.")

    return jsonify({'message': 'Message sent successfully.',
                    'message_id': message_id, 'dispute_id': dispute_id}), 201


# ══════════════════════════════════════════════════════════════
# 2 — READ THE CONVERSATION
# ══════════════════════════════════════════════════════════════

@negotiation_bp.route('/<int:dispute_id>/messages', methods=['GET'])
@jwt_required()
def get_messages(dispute_id):
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    dispute, txn, role = load_dispute_for_party(dispute_id, user)
    if not dispute:
        return err('Dispute not found', 404, 'NOT_FOUND')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT id, dispute_id, sender_role, message, is_offer, offer_amount,
               offer_to, offer_status, created_at
        FROM negotiation_messages WHERE dispute_id = %s ORDER BY created_at ASC, id ASC
    """, (dispute_id,))
    messages = cursor.fetchall()
    cursor.close()

    for msg in messages:
        if msg.get('created_at'):
            msg['created_at'] = msg['created_at'].isoformat()
        msg['mine'] = (msg['sender_role'] == role)

    return jsonify({'dispute_id': dispute_id, 'messages': messages,
                    'total': len(messages), 'viewer_role': role}), 200


# ══════════════════════════════════════════════════════════════
# 3 — MAKE A SETTLEMENT OFFER
# ══════════════════════════════════════════════════════════════

def _insert_offer(cursor, dispute_id, user, role, amount, text):
    counterparty = 'seller' if role == 'buyer' else 'buyer'
    cursor.execute("""
        INSERT INTO negotiation_messages
            (dispute_id, sender_phone, sender_role, message, is_offer,
             offer_amount, offer_to, offer_status)
        VALUES (%s,%s,%s,%s,TRUE,%s,%s,'PENDING')
    """, (dispute_id, user['phone_number'], role, text, amount, counterparty))
    return cursor.lastrowid


@negotiation_bp.route('/<int:dispute_id>/offer', methods=['POST'])
@jwt_required()
def make_offer(dispute_id):
    """
    Body: { "offer_amount": 500, "message": "I keep the shoes if you refund me Ksh 500" }
    offer_amount = how much the BUYER gets back (whole shillings).
    """
    rate_limit_error = check_rate_limit(20, 1, scope='negotiation_offer')
    if rate_limit_error:
        return rate_limit_error

    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    dispute, txn, role = load_dispute_for_party(dispute_id, user)
    if not dispute or role not in ('buyer', 'seller'):
        return err('Dispute not found', 404, 'NOT_FOUND')
    if dispute['status'] in OPEN_STATES_BLOCKED or dispute['status'] == 'ESCALATED':
        return err('Offers can no longer be made on this dispute.', 400, 'BAD_STATE')
    if txn['status'] != 'DISPUTED':
        return err('The funds are not held for settlement any more.', 400, 'BAD_STATE')

    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['offer_amount', 'message'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')

    lo, hi = _offer_bounds(txn)
    try:
        amount = float(data['offer_amount'])
        if amount != int(amount) or not (lo <= amount <= hi):
            raise ValueError
        amount = int(amount)
    except (TypeError, ValueError):
        return err(f"Offer must be a whole number between Ksh {lo:,} and Ksh {hi:,}.",
                   400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    # A new offer supersedes this party's earlier pending offers
    cursor.execute("""
        UPDATE negotiation_messages SET offer_status = 'WITHDRAWN'
        WHERE dispute_id = %s AND is_offer = TRUE AND offer_status = 'PENDING'
          AND sender_role = %s
    """, (dispute_id, role))
    offer_id = _insert_offer(cursor, dispute_id, user, role, amount, str(data['message']).strip()[:2000])
    cursor.execute("""
        UPDATE disputes SET status = 'NEGOTIATING'
        WHERE id = %s AND status IN ('OPEN','EVIDENCE_COLLECTION')
    """, (dispute_id,))
    mysql.connection.commit()
    cursor.close()

    _notify_other_party(
        dispute, txn, role,
        f"{'The buyer' if role == 'buyer' else 'The seller'} proposed a settlement: the buyer "
        f"gets Ksh {amount:,} back for '{txn['item_name']}'. Log in to Zuno to accept or reject.")

    return jsonify({'message': 'Settlement offer sent successfully.',
                    'offer_id': offer_id, 'dispute_id': dispute_id,
                    'offer_amount': amount, 'status': 'PENDING'}), 201


# ══════════════════════════════════════════════════════════════
# 4 — ACCEPT / REJECT / COUNTER AN OFFER
# ══════════════════════════════════════════════════════════════

@negotiation_bp.route('/<int:dispute_id>/offer/<int:offer_id>/respond', methods=['POST'])
@jwt_required()
def respond_to_offer(dispute_id, offer_id):
    """
    Body: { "response": "ACCEPTED" | "REJECTED" | "COUNTERED", "counter_amount": 300 }
    Only the OTHER party (not the one who made the offer) can respond.
    ACCEPTED settles the money immediately.
    """
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    dispute, txn, role = load_dispute_for_party(dispute_id, user)
    if not dispute or role not in ('buyer', 'seller'):
        return err('Dispute not found', 404, 'NOT_FOUND')

    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['response'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    response = str(data['response']).upper()
    if response not in ('ACCEPTED', 'REJECTED', 'COUNTERED'):
        return err('Response must be ACCEPTED, REJECTED, or COUNTERED', 400, 'VALIDATION_ERROR')

    if dispute['status'] in OPEN_STATES_BLOCKED or txn['status'] != 'DISPUTED':
        return err('This dispute is already resolved.', 400, 'BAD_STATE')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT * FROM negotiation_messages
        WHERE id = %s AND dispute_id = %s AND is_offer = TRUE
    """, (offer_id, dispute_id))
    offer = cursor.fetchone()
    mysql.connection.commit()

    if not offer:
        cursor.close()
        return err('Offer not found', 404, 'NOT_FOUND')
    if offer['sender_role'] == role:
        cursor.close()
        return err('You cannot respond to your own offer.', 403, 'FORBIDDEN')

    # Claim the offer atomically: only one response can ever win
    new_offer_status = {'ACCEPTED': 'ACCEPTED', 'REJECTED': 'REJECTED',
                        'COUNTERED': 'COUNTERED'}[response]
    cursor.execute("""
        UPDATE negotiation_messages SET offer_status = %s
        WHERE id = %s AND offer_status = 'PENDING'
    """, (new_offer_status, offer_id))
    claimed = cursor.rowcount == 1
    mysql.connection.commit()
    if not claimed:
        cursor.close()
        return err(f"This offer has already been {str(offer['offer_status']).lower()}.",
                   400, 'BAD_STATE')

    # ── REJECTED ──────────────────────────────────────────────
    if response == 'REJECTED':
        cursor.close()
        return jsonify({
            'message': 'Offer rejected. The negotiation continues. You can make a counter '
                       'offer or escalate to admin.',
            'dispute_id': dispute_id,
            'next_steps': {'counter_offer': f"POST /api/negotiation/{dispute_id}/offer",
                           'escalate': f"POST /api/disputes/{dispute_id}/escalate"}}), 200

    # ── COUNTERED ─────────────────────────────────────────────
    if response == 'COUNTERED':
        lo, hi = _offer_bounds(txn)
        try:
            counter = float(data.get('counter_amount'))
            if counter != int(counter) or not (lo <= counter <= hi):
                raise ValueError
            counter = int(counter)
        except (TypeError, ValueError):
            # put the original offer back: the counter was invalid
            cursor.execute("UPDATE negotiation_messages SET offer_status = 'PENDING' WHERE id = %s",
                           (offer_id,))
            mysql.connection.commit()
            cursor.close()
            return err(f"counter_amount must be a whole number between Ksh {lo:,} and Ksh {hi:,}.",
                       400, 'VALIDATION_ERROR')
        new_id = _insert_offer(cursor, dispute_id, user, role, counter,
                               f"Counter offer: buyer gets Ksh {counter:,} back")
        mysql.connection.commit()
        cursor.close()
        _notify_other_party(dispute, txn, role,
                            f"A counter offer was made on '{txn['item_name']}': buyer gets "
                            f"Ksh {counter:,} back. Log in to Zuno to respond.")
        return jsonify({'message': 'Counter offer sent.', 'dispute_id': dispute_id,
                        'offer_id': new_id, 'counter_amount': counter}), 200

    # ── ACCEPTED: move the money ──────────────────────────────
    buyer_gets = int(offer['offer_amount'])
    seller_gets = int(txn['seller_receives']) - buyer_gets

    result = settle_transaction(
        txn['id'], SPLIT, ('DISPUTED',), triggered_by=f"NEGOTIATION:{user['id']}",
        split_buyer_amount=buyer_gets, split_seller_amount=seller_gets)

    if not result.ok:
        # Put the offer back so it is not lost
        cursor.execute("UPDATE negotiation_messages SET offer_status = 'PENDING' WHERE id = %s",
                       (offer_id,))
        mysql.connection.commit()
        cursor.close()
        return err(result.message, 409 if result.code in ('BAD_STATE', 'CONFLICT') else 500,
                   result.code)

    cursor.execute("""
        UPDATE disputes SET status = 'RESOLVED', resolution = 'SPLIT',
               split_buyer_amount = %s, split_seller_amount = %s,
               admin_notes = %s, resolved_at = %s
        WHERE id = %s
    """, (buyer_gets, seller_gets,
          f"Settled by agreement in the negotiation panel (offer #{offer_id}).",
          datetime.now(), dispute_id))
    cursor.execute("""
        UPDATE negotiation_messages SET offer_status = 'EXPIRED'
        WHERE dispute_id = %s AND is_offer = TRUE AND offer_status = 'PENDING'
    """, (dispute_id,))
    mysql.connection.commit()
    cursor.close()

    send_sms(txn['buyer_phone'],
             f"Zuno: Dispute #{dispute_id} settled. You will receive Ksh {buyer_gets:,} "
             f"on M-Pesa shortly.")
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT phone_number FROM users WHERE id = %s", (txn['seller_id'],))
    seller = cursor.fetchone()
    cursor.close()
    if seller and seller_gets > 0:
        send_sms(seller['phone_number'],
                 f"Zuno: Dispute #{dispute_id} settled. You will receive Ksh {seller_gets:,} "
                 f"on M-Pesa shortly.")

    return jsonify({
        'message': 'Settlement accepted. Dispute resolved and payouts queued.',
        'dispute_id': dispute_id, 'status': 'RESOLVED',
        'buyer_receives': buyer_gets, 'seller_receives': seller_gets
    }), 200
