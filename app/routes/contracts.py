# app/routes/contracts.py
#
# Deal Contracts — the formal agreement between buyer and seller
# before any money moves on Zuno.
#
# FLOW:
# 1. Buyer creates contract → states expectations + delivery method
# 2. Seller gets SMS notification
# 3. Seller reviews → confirms or rejects
# 4. If confirmed → transaction can be created and funded
#
# ENDPOINTS:
# POST /api/contracts/create              → buyer creates contract
# GET  /api/contracts/<id>               → view contract details
# POST /api/contracts/<id>/confirm       → seller confirms
# POST /api/contracts/<id>/reject        → seller rejects
# GET  /api/contracts/my                 → seller sees all their contracts

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import mysql
from app.utils.validators import (
    validate_required_fields,
    validate_phone,
    validate_amount,
    validate_delivery_method
)
from app.services.notify import notify_phone
from app.services.sms import send_sms
from app.utils.auth import current_user
from app.utils.errors import err
from app.utils.helpers import tier_limit
from app.utils.security import check_rate_limit
from datetime import datetime, timedelta
import os

contracts_bp = Blueprint('contracts', __name__)

# How many hours the seller has to respond to a contract
CONTRACT_EXPIRY_HOURS = int(os.getenv('CONTRACT_EXPIRY_HOURS', 48))


# ══════════════════════════════════════════════════════════════
# ENDPOINT 1 — CREATE CONTRACT (Buyer, logged in)
# ══════════════════════════════════════════════════════════════

@contracts_bp.route('/create', methods=['POST'])
@jwt_required()
def create_contract():
    """
    POST /api/contracts/create        (Authorization: Bearer <buyer token>)

    The BUYER starts a deal by proposing a contract to a seller.
    The buyer's identity (id, phone) comes from their account - NOT from the
    request body - so nobody can open contracts "as" someone else's number.

    Body:
    {
        "seller_id": 1,
        "item_name": "Nike Air Max Size 42",
        "item_description": "As shown in TikTok video",       (optional)
        "agreed_amount": 3000,                                  (whole shillings)
        "buyer_expectations": "Size 42, black/white, brand new with box and receipt",
        "delivery_method": "PLATFORM_COURIER",
        "pickup_location": "Westlands Nairobi",                 (optional)
        "delivery_location": "Kilimani Nairobi",                (optional)
        "buyer_name": "John Kamau"                              (optional, defaults to account name)
    }
    """
    rate_limit_error = check_rate_limit(10, 1, scope='contracts_create')
    if rate_limit_error:
        return rate_limit_error

    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')
    if not user['phone_verified']:
        return err('Verify your phone number before starting a deal.', 403, 'PHONE_NOT_VERIFIED')

    data = request.get_json(silent=True)

    valid, error = validate_required_fields(data, [
        'seller_id', 'item_name', 'agreed_amount',
        'buyer_expectations', 'delivery_method'
    ])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')

    valid, error = validate_amount(data['agreed_amount'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')

    valid, error = validate_delivery_method(data['delivery_method'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')

    if len(str(data['buyer_expectations']).strip()) < 20:
        return err('Please describe your expectations in more detail - minimum 20 '
                   'characters. Be specific about size, color, condition, accessories etc.',
                   400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT id, full_name, business_name, phone_number,
               is_active, seller_tier, role
        FROM users WHERE id = %s
    """, (data['seller_id'],))
    seller = cursor.fetchone()

    if not seller or seller['role'] != 'seller':
        cursor.close()
        return err('Seller not found', 404, 'NOT_FOUND')

    if not seller['is_active']:
        cursor.close()
        return err('This seller account is currently unavailable', 400, 'SELLER_UNAVAILABLE')

    if seller['id'] == user['id']:
        cursor.close()
        return err('You cannot start a deal with yourself', 400, 'SELF_DEAL')

    # Deal-size limit by the seller's verification tier (configurable via env)
    max_amount = tier_limit(seller['seller_tier'])
    if float(data['agreed_amount']) > max_amount:
        cursor.close()
        return err(f"This seller's current verification level allows a maximum deal of "
                   f"Ksh {max_amount:,}. The seller must complete verification to accept "
                   f"higher value deals.", 400, 'TIER_LIMIT_EXCEEDED')

    expires_at = datetime.now() + timedelta(hours=CONTRACT_EXPIRY_HOURS)
    buyer_name = str(data.get('buyer_name') or user['full_name']).strip()

    cursor.execute("""
        INSERT INTO deal_contracts (
            seller_id, buyer_user_id, buyer_phone, buyer_name,
            item_name, item_description, agreed_amount,
            buyer_expectations, delivery_method,
            pickup_location, delivery_location,
            status, expires_at
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'SELLER_REVIEWING',%s)
    """, (
        seller['id'], user['id'], user['phone_number'], buyer_name,
        str(data['item_name']).strip()[:255],
        str(data.get('item_description', '')).strip(),
        int(float(data['agreed_amount'])),
        str(data['buyer_expectations']).strip(),
        data['delivery_method'],
        str(data.get('pickup_location', ''))[:255],
        str(data.get('delivery_location', ''))[:255],
        expires_at
    ))
    contract_id = cursor.lastrowid
    mysql.connection.commit()
    cursor.close()

    send_sms(
        seller['phone_number'],
        f"Zuno: New deal request from {buyer_name} for '{data['item_name']}' at "
        f"Ksh {int(float(data['agreed_amount'])):,}. Contract ID: {contract_id}. "
        f"Log in to Zuno to review and respond. You have {CONTRACT_EXPIRY_HOURS} hours."
    )
    notify_phone(seller['phone_number'], 'New deal request',
                 f"{buyer_name} wants to buy '{data['item_name']}' for Ksh {int(float(data['agreed_amount'])):,}. Respond within {CONTRACT_EXPIRY_HOURS} hours.",
                 'transaction', f'contract:{contract_id}')

    return jsonify({
        'message': f'Contract sent to seller. They have {CONTRACT_EXPIRY_HOURS} hours to confirm.',
        'contract_id': contract_id,
        'expires_at': expires_at.isoformat(),
        'next_step': 'Wait for seller confirmation before payment.'
    }), 201


# ══════════════════════════════════════════════════════════════
# ENDPOINT 2 — GET CONTRACT DETAILS (the two parties, or an admin)
# ══════════════════════════════════════════════════════════════

@contracts_bp.route('/<int:contract_id>', methods=['GET'])
@jwt_required()
def get_contract(contract_id):
    """
    GET /api/contracts/<contract_id>

    Visible only to the buyer and seller on the contract (and admins).
    Everyone else gets 404, so contract ids cannot be probed.
    """
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT c.*, u.full_name AS seller_full_name, u.business_name,
               u.is_verified, u.seller_tier
        FROM deal_contracts c
        JOIN users u ON u.id = c.seller_id
        WHERE c.id = %s
    """, (contract_id,))
    contract = cursor.fetchone()
    cursor.close()

    allowed = contract and (
        user['role'] == 'admin'
        or contract['seller_id'] == user['id']
        or contract['buyer_user_id'] == user['id'])
    if not allowed:
        return err('Contract not found', 404, 'NOT_FOUND')

    for field in ['created_at', 'updated_at', 'expires_at', 'seller_confirmed_at']:
        if contract.get(field):
            contract[field] = contract[field].isoformat()
    contract['viewer_role'] = 'seller' if contract['seller_id'] == user['id'] else \
        ('buyer' if contract['buyer_user_id'] == user['id'] else 'admin')

    return jsonify({'contract': contract}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 3 — SELLER CONFIRMS CONTRACT
# ══════════════════════════════════════════════════════════════

@contracts_bp.route('/<int:contract_id>/confirm', methods=['POST'])
@jwt_required()
def confirm_contract(contract_id):
    """
    POST /api/contracts/<contract_id>/confirm

    Seller confirms they can meet the buyer's expectations.
    This is the seller's digital agreement to the deal terms.

    After this:
    - Contract status → AGREED
    - Buyer receives SMS notification
    - Buyer can now proceed to create and fund the transaction

    Requires seller to be logged in.

    Expected body:
    {
        "seller_confirmation": "Confirmed. I have the exact item,
         size 42 black/white Nike Air Max, brand new with box
         and original receipt as shown in my video."
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json()

    # Seller must provide a confirmation statement
    if not data or not data.get('seller_confirmation', '').strip():
        return jsonify({
            'error': 'Please provide your confirmation statement '
                     'describing exactly what you will deliver.'
        }), 400

    cursor = mysql.connection.cursor()

    # Verify this contract belongs to the logged-in seller
    cursor.execute("""
        SELECT * FROM deal_contracts
        WHERE id = %s AND seller_id = %s
    """, (contract_id, user_id))

    contract = cursor.fetchone()

    if not contract:
        cursor.close()
        return jsonify({'error': 'Contract not found'}), 404

    # Can only confirm a contract that is awaiting review
    if contract['status'] != 'SELLER_REVIEWING':
        cursor.close()
        return jsonify({
            'error': f"Cannot confirm a contract with "
                     f"status '{contract['status']}'"
        }), 400

    # Check contract has not expired
    if datetime.now() > contract['expires_at']:
        cursor.execute(
            "UPDATE deal_contracts SET status='EXPIRED' WHERE id=%s",
            (contract_id,)
        )
        mysql.connection.commit()
        cursor.close()
        return jsonify({
            'error': 'This contract has expired. '
                     'The buyer must create a new one.'
        }), 400

    # Confirm the contract
    cursor.execute("""
        UPDATE deal_contracts SET
            status = 'AGREED',
            seller_confirmation = %s,
            seller_confirmed_at = %s,
            delivery_method_agreed = TRUE
        WHERE id = %s AND status = 'SELLER_REVIEWING'
    """, (
        data['seller_confirmation'].strip(),
        datetime.now(),
        contract_id
    ))
    changed = cursor.rowcount == 1
    mysql.connection.commit()
    cursor.close()
    if not changed:
        return err('This contract is no longer awaiting your response.', 409, 'CONFLICT')

    # Notify buyer that seller has confirmed
    send_sms(
        contract['buyer_phone'],
        f"Zuno: Great news! The seller confirmed your deal for "
        f"'{contract['item_name']}' at Ksh {float(contract['agreed_amount']):,.0f}. "
        f"You can now proceed to payment. "
        f"Contract ID: {contract_id}"
    )
    notify_phone(contract['buyer_phone'], 'Seller accepted your deal',
                 f"'{contract['item_name']}' is agreed. You can now pay into escrow.",
                 'transaction', f'contract:{contract_id}')

    return jsonify({
        'message': 'Contract confirmed successfully. '
                   'Buyer has been notified to proceed with payment.',
        'contract_id': contract_id,
        'status': 'AGREED'
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 4 — SELLER REJECTS CONTRACT
# ══════════════════════════════════════════════════════════════

@contracts_bp.route('/<int:contract_id>/reject', methods=['POST'])
@jwt_required()
def reject_contract(contract_id):
    """
    POST /api/contracts/<contract_id>/reject

    Seller rejects the contract because they cannot meet
    the buyer's expectations. No money ever moved so
    there is nothing to refund.

    Expected body:
    {
        "reason": "I only have size 41 available, not size 42."
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json()

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT * FROM deal_contracts
        WHERE id = %s AND seller_id = %s
    """, (contract_id, user_id))

    contract = cursor.fetchone()

    if not contract:
        cursor.close()
        return jsonify({'error': 'Contract not found'}), 404

    if contract['status'] != 'SELLER_REVIEWING':
        cursor.close()
        return jsonify({
            'error': f"Cannot reject a contract with "
                     f"status '{contract['status']}'"
        }), 400

    data = data or {}
    reason = str(data.get('reason') or 'Seller cannot meet requirements').strip()

    cursor.execute("""
        UPDATE deal_contracts SET
            status = 'REJECTED',
            seller_confirmation = %s
        WHERE id = %s AND status = 'SELLER_REVIEWING'
    """, (reason, contract_id))
    mysql.connection.commit()
    cursor.close()

    # Notify buyer of rejection
    send_sms(
        contract['buyer_phone'],
        f"Zuno: The seller has declined your deal request for "
        f"'{contract['item_name']}'. "
        f"Reason: {reason}. "
        f"No money was taken. You can contact another seller."
    )
    notify_phone(contract['buyer_phone'], 'Seller declined your deal',
                 f"'{contract['item_name']}' was declined: {reason[:150]}. No money was taken.",
                 'transaction', f'contract:{contract_id}')

    return jsonify({
        'message': 'Contract rejected. Buyer has been notified.',
        'contract_id': contract_id,
        'status': 'REJECTED'
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 5 — GET MY CONTRACTS (Seller)
# ══════════════════════════════════════════════════════════════

@contracts_bp.route('/my', methods=['GET'])
@jwt_required()
def get_my_contracts():
    """
    GET /api/contracts/my
    GET /api/contracts/my?status=SELLER_REVIEWING&as=seller|buyer

    Contracts where the caller is the seller (incoming requests) or the buyer
    (requests they sent). Each row carries `viewer_role`.
    """
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')
    status_filter = request.args.get('status')
    as_role = request.args.get('as')

    where, params = [], []
    if as_role == 'seller':
        where.append("seller_id = %s"); params.append(user['id'])
    elif as_role == 'buyer':
        where.append("buyer_user_id = %s"); params.append(user['id'])
    else:
        where.append("(seller_id = %s OR buyer_user_id = %s)")
        params += [user['id'], user['id']]
    if status_filter:
        where.append("status = %s"); params.append(status_filter.upper())

    cursor = mysql.connection.cursor()
    cursor.execute(f"""
        SELECT * FROM deal_contracts
        WHERE {' AND '.join(where)}
        ORDER BY created_at DESC LIMIT 500
    """, params)
    contracts = cursor.fetchall()
    cursor.close()

    for contract in contracts:
        contract['viewer_role'] = 'seller' if contract['seller_id'] == user['id'] else 'buyer'
        for field in ['created_at', 'updated_at', 'expires_at', 'seller_confirmed_at']:
            if contract.get(field):
                contract[field] = contract[field].isoformat()

    return jsonify({'contracts': contracts, 'total': len(contracts)}), 200
