# app/routes/disputes.py
#
# Dispute system for Zuno.
#
# Either the buyer OR the seller of a transaction can raise a dispute while the
# deal is active. Once raised:
#   - transaction status -> DISPUTED (funds frozen: nothing can release or refund them
#     except the escrow service called by an admin resolution or an accepted settlement)
#   - both parties negotiate; either can submit evidence (48h) and escalate
#   - an admin makes the final decision (/api/admin/disputes/<id>/resolve)
#
# EVERY endpoint requires a login. Who you are comes from the token; whether you
# may touch this dispute comes from your relationship to the transaction.
#
# ENDPOINTS:
# POST /api/disputes/raise                 -> raise a dispute
# GET  /api/disputes/<id>                  -> details (parties/admin)
# POST /api/disputes/<id>/evidence         -> submit evidence by URL we issued
# POST /api/disputes/<id>/evidence/upload  -> upload an evidence file (multipart)
# GET  /api/disputes/<id>/evidence         -> list evidence (parties/admin)
# POST /api/disputes/<id>/escalate         -> escalate to admin
# GET  /api/disputes/my                    -> my disputes

import os
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app import mysql
from app.utils.auth import current_user, party_role
from app.utils.errors import err
from app.utils.helpers import log_transaction_action
from app.utils.security import check_rate_limit
from app.utils.validators import validate_required_fields
from app.services.notify import notify_phone
from app.services.sms import send_dispute_notification, send_sms

disputes_bp = Blueprint('disputes', __name__)

EVIDENCE_WINDOW_HOURS = 48
RESOLUTION_WINDOW_HOURS = 72

DISPUTE_CATEGORIES = [
    'ITEM_NOT_RECEIVED', 'ITEM_NOT_AS_DESCRIBED', 'ITEM_DAMAGED',
    'WRONG_ITEM', 'DELIVERY_ISSUE', 'CONTRACT_BREACH', 'OTHER'
]
DISPUTABLE_STATUSES = ('FUNDED', 'IN_TRANSIT', 'DELIVERED', 'INSPECTION')
_TIME_FIELDS = ['created_at', 'resolved_at', 'evidence_deadline', 'resolution_deadline']


def load_dispute_for_party(dispute_id, user):
    """
    Returns (dispute, txn, role) if `user` is the buyer/seller/admin of this
    dispute's transaction, else (None, None, None). Callers answer 404 on None
    so dispute ids cannot be probed.
    """
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM disputes WHERE id = %s", (dispute_id,))
    dispute = cursor.fetchone()
    txn = None
    if dispute:
        cursor.execute("SELECT * FROM transactions WHERE id = %s", (dispute['transaction_id'],))
        txn = cursor.fetchone()
    mysql.connection.commit()
    cursor.close()
    if not dispute or not txn:
        return None, None, None
    role = party_role(txn, user)
    if role is None:
        return None, None, None
    return dispute, txn, role


def _iso(row, fields):
    for f in fields:
        if row.get(f):
            row[f] = row[f].isoformat()


# ══════════════════════════════════════════════════════════════
# 1 — RAISE A DISPUTE
# ══════════════════════════════════════════════════════════════

@disputes_bp.route('/raise', methods=['POST'])
@jwt_required()
def raise_dispute():
    """
    POST /api/disputes/raise

    Body:
    {
        "transaction_id": "ZNO-20260825-AXK3J8QD",
        "category": "ITEM_NOT_AS_DESCRIBED",
        "description": "The shoes I received are size 41 not 42 as agreed.",   (min 30 chars)
        "preferred_resolution": "FULL_REFUND"                                  (optional)
    }

    Your side (buyer/seller) is worked out from your account, not from the request.
    """
    rate_limit_error = check_rate_limit(10, 1, scope='disputes_raise')
    if rate_limit_error:
        return rate_limit_error

    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['transaction_id', 'category', 'description'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')

    if data['category'] not in DISPUTE_CATEGORIES:
        return err(f"Category must be one of: {', '.join(DISPUTE_CATEGORIES)}",
                   400, 'VALIDATION_ERROR')

    description = str(data['description']).strip()
    if len(description) < 30:
        return err('Please describe the issue in more detail (minimum 30 characters). '
                   'Be specific about what went wrong.', 400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM transactions WHERE id = %s", (data['transaction_id'],))
    txn = cursor.fetchone()

    role = party_role(txn, user) if txn else None
    if role not in ('buyer', 'seller'):
        mysql.connection.commit()
        cursor.close()
        return err('Transaction not found', 404, 'NOT_FOUND')

    if txn['status'] not in DISPUTABLE_STATUSES:
        mysql.connection.commit()
        cursor.close()
        return err(f"Cannot raise dispute. Transaction status is '{txn['status']}'. "
                   f"Disputes can only be raised on active transactions.",
                   400, 'BAD_STATE')

    now = datetime.now()
    evidence_deadline = now + timedelta(hours=EVIDENCE_WINDOW_HOURS)
    resolution_deadline = evidence_deadline + timedelta(hours=RESOLUTION_WINDOW_HOURS)

    try:
        # Freeze first, guarded by status: if the buyer approved a millisecond ago
        # (status no longer disputable) this affects 0 rows and nothing is created.
        placeholders = ','.join(['%s'] * len(DISPUTABLE_STATUSES))
        cursor.execute(
            f"UPDATE transactions SET status = 'DISPUTED' "
            f"WHERE id = %s AND status IN ({placeholders})",
            (txn['id'], *DISPUTABLE_STATUSES))
        if cursor.rowcount != 1:
            mysql.connection.rollback()
            cursor.close()
            return err('This transaction just changed state. Refresh and try again.',
                       409, 'CONFLICT')

        cursor.execute("""
            INSERT INTO disputes (
                transaction_id, raised_by_phone, raised_by_user_id, raised_by_role,
                category, description, preferred_resolution,
                status, evidence_deadline, resolution_deadline
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,'OPEN',%s,%s)
        """, (txn['id'], user['phone_number'], user['id'], role, data['category'],
              description, str(data.get('preferred_resolution', 'FULL_REFUND'))[:30],
              evidence_deadline, resolution_deadline))
        dispute_id = cursor.lastrowid
        mysql.connection.commit()
    except Exception as e:
        # UNIQUE(transaction_id): a dispute already exists
        mysql.connection.rollback()
        cursor.close()
        print(f"[DISPUTE] raise failed: {e}")
        return err('A dispute already exists for this transaction.', 409, 'DISPUTE_EXISTS')

    cursor.execute("SELECT phone_number FROM users WHERE id = %s", (txn['seller_id'],))
    seller = cursor.fetchone()
    cursor.close()

    log_transaction_action(
        txn['id'], action='DISPUTE_RAISED', performed_by=str(user['id']),
        old_value=txn['status'], new_value='DISPUTED',
        details=f"Category: {data['category']}. Dispute ID: {dispute_id}. By: {role}")

    other_phone = seller['phone_number'] if role == 'buyer' else txn['buyer_phone']
    send_dispute_notification(user['phone_number'], txn['id'], role)
    send_dispute_notification(other_phone, txn['id'], 'seller' if role == 'buyer' else 'buyer')
    notify_phone(other_phone, 'Dispute opened',
                 f"A dispute was opened on '{txn['item_name']}'. Open it to reply or make an offer.",
                 'dispute', dispute_id)
    notify_phone(user['phone_number'], 'Dispute filed',
                 f"Your dispute on '{txn['item_name']}' is open. We'll tell you when the other side replies.",
                 'dispute', dispute_id)

    return jsonify({
        'message': 'Dispute raised successfully. Both parties have been notified.',
        'dispute_id': dispute_id,
        'status': 'OPEN',
        'evidence_deadline': evidence_deadline.isoformat(),
        'resolution_deadline': resolution_deadline.isoformat(),
        'next_steps': {
            'negotiate': f"POST /api/negotiation/{dispute_id}/message",
            'submit_evidence': f"POST /api/disputes/{dispute_id}/evidence",
            'escalate': f"POST /api/disputes/{dispute_id}/escalate"
        }
    }), 201


# ══════════════════════════════════════════════════════════════
# 2 — GET DISPUTE DETAILS
# ══════════════════════════════════════════════════════════════

@disputes_bp.route('/<int:dispute_id>', methods=['GET'])
@jwt_required()
def get_dispute(dispute_id):
    """Details of one dispute. Only its buyer, seller or an admin can read it."""
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    dispute, txn, role = load_dispute_for_party(dispute_id, user)
    if not dispute:
        return err('Dispute not found', 404, 'NOT_FOUND')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT u.full_name AS seller_name, u.business_name AS seller_business,
               u.phone_number AS seller_phone
        FROM users u WHERE u.id = %s
    """, (txn['seller_id'],))
    seller = cursor.fetchone() or {}
    cursor.close()

    dispute.update({
        'item_name': txn['item_name'], 'amount': txn['amount'],
        'buyer_name': txn['buyer_name'], 'delivery_method': txn['delivery_method'],
        'seller_name': seller.get('seller_name'),
        'seller_business': seller.get('seller_business'),
        'transaction_status': txn['status'],
        'viewer_role': role
    })
    # Phone numbers are shared only with admins
    if role == 'admin':
        dispute['buyer_phone'] = txn['buyer_phone']
        dispute['seller_phone'] = seller.get('seller_phone')
    _iso(dispute, _TIME_FIELDS)

    return jsonify({'dispute': dispute}), 200


# ══════════════════════════════════════════════════════════════
# 3 — SUBMIT EVIDENCE
# ══════════════════════════════════════════════════════════════

def _evidence_allowed(dispute):
    if dispute['status'] == 'RESOLVED':
        return 'This dispute has already been resolved.'
    if datetime.now() > dispute['evidence_deadline']:
        return ('Evidence submission window has closed. '
                'The dispute is now under admin review.')
    return None


def _is_our_upload_url(url):
    """Only accept files that WE uploaded to OUR Cloudinary account."""
    cloud = os.getenv('CLOUDINARY_CLOUD_NAME', '')
    return bool(cloud) and str(url).startswith(f"https://res.cloudinary.com/{cloud}/")


def _save_evidence(dispute_id, user, role, evidence_type, file_url, description):
    cursor = mysql.connection.cursor()
    cursor.execute("""
        INSERT INTO dispute_evidence (
            dispute_id, submitted_by_phone, submitted_by_role,
            evidence_type, file_url, description
        ) VALUES (%s,%s,%s,%s,%s,%s)
    """, (dispute_id, user['phone_number'], role, evidence_type, file_url,
          str(description or '')[:2000]))
    cursor.execute("""
        UPDATE disputes SET status = 'EVIDENCE_COLLECTION'
        WHERE id = %s AND status = 'OPEN'
    """, (dispute_id,))
    mysql.connection.commit()
    cursor.close()


@disputes_bp.route('/<int:dispute_id>/evidence', methods=['POST'])
@jwt_required()
def submit_evidence(dispute_id):
    """
    POST /api/disputes/<id>/evidence
    Body: { "evidence_type": "photo|screenshot|document|tracking",
            "file_url": "<url returned by the upload endpoint>", "description": "..." }
    """
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    dispute, txn, role = load_dispute_for_party(dispute_id, user)
    if not dispute or role not in ('buyer', 'seller'):
        return err('Dispute not found', 404, 'NOT_FOUND')

    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['evidence_type', 'file_url'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    if data['evidence_type'] not in ('photo', 'screenshot', 'document', 'tracking'):
        return err('evidence_type must be: photo, screenshot, document, or tracking',
                   400, 'VALIDATION_ERROR')
    if not _is_our_upload_url(data['file_url']):
        return err('Evidence files must be uploaded through Zuno '
                   '(POST /api/disputes/<id>/evidence/upload).', 400, 'INVALID_FILE_URL')

    problem = _evidence_allowed(dispute)
    if problem:
        return err(problem, 400, 'EVIDENCE_CLOSED')

    _save_evidence(dispute_id, user, role, data['evidence_type'],
                   data['file_url'], data.get('description'))
    return jsonify({'message': 'Evidence submitted successfully.',
                    'dispute_id': dispute_id}), 201


ALLOWED_EVIDENCE_MIME = {'image/jpeg', 'image/png', 'image/webp', 'application/pdf'}


@disputes_bp.route('/<int:dispute_id>/evidence/upload', methods=['POST'])
@jwt_required()
def upload_evidence(dispute_id):
    """
    POST /api/disputes/<id>/evidence/upload      (multipart/form-data)
    Fields: file (jpeg/png/webp/pdf), evidence_type, description (optional)
    Uploads to Cloudinary and records the evidence in one step.
    """
    rate_limit_error = check_rate_limit(10, 1, scope='evidence_upload')
    if rate_limit_error:
        return rate_limit_error

    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    dispute, txn, role = load_dispute_for_party(dispute_id, user)
    if not dispute or role not in ('buyer', 'seller'):
        return err('Dispute not found', 404, 'NOT_FOUND')

    problem = _evidence_allowed(dispute)
    if problem:
        return err(problem, 400, 'EVIDENCE_CLOSED')

    upload = request.files.get('file')
    if not upload:
        return err('Attach a file in the "file" field.', 400, 'VALIDATION_ERROR')
    if upload.mimetype not in ALLOWED_EVIDENCE_MIME:
        return err('Only JPG, PNG, WEBP or PDF files are accepted.', 400, 'INVALID_FILE_TYPE')

    evidence_type = request.form.get('evidence_type', 'photo')
    if evidence_type not in ('photo', 'screenshot', 'document', 'tracking'):
        return err('evidence_type must be: photo, screenshot, document, or tracking',
                   400, 'VALIDATION_ERROR')

    from app.services.upload import upload_dispute_evidence
    result = upload_dispute_evidence(upload, dispute_id, user['id'])
    if not result['success']:
        return err('Upload failed. Please try again.', 502, 'UPLOAD_FAILED')

    _save_evidence(dispute_id, user, role, evidence_type, result['url'],
                   request.form.get('description'))
    return jsonify({'message': 'Evidence uploaded successfully.',
                    'dispute_id': dispute_id, 'file_url': result['url']}), 201


# ══════════════════════════════════════════════════════════════
# 4 — GET ALL EVIDENCE
# ══════════════════════════════════════════════════════════════

@disputes_bp.route('/<int:dispute_id>/evidence', methods=['GET'])
@jwt_required()
def get_evidence(dispute_id):
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    dispute, txn, role = load_dispute_for_party(dispute_id, user)
    if not dispute:
        return err('Dispute not found', 404, 'NOT_FOUND')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT id, dispute_id, submitted_by_role, evidence_type, file_url,
               description, created_at
        FROM dispute_evidence WHERE dispute_id = %s ORDER BY created_at ASC
    """, (dispute_id,))
    evidence = cursor.fetchall()
    cursor.close()

    for item in evidence:
        _iso(item, ['created_at'])

    return jsonify({
        'dispute_id': dispute_id,
        'buyer_evidence': [e for e in evidence if e['submitted_by_role'] == 'buyer'],
        'seller_evidence': [e for e in evidence if e['submitted_by_role'] == 'seller'],
        'total': len(evidence)
    }), 200


# ══════════════════════════════════════════════════════════════
# 5 — ESCALATE TO ADMIN
# ══════════════════════════════════════════════════════════════

@disputes_bp.route('/<int:dispute_id>/escalate', methods=['POST'])
@jwt_required()
def escalate_dispute(dispute_id):
    """Either party can hand the dispute to Zuno's arbitration team."""
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    dispute, txn, role = load_dispute_for_party(dispute_id, user)
    if not dispute or role not in ('buyer', 'seller'):
        return err('Dispute not found', 404, 'NOT_FOUND')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        UPDATE disputes SET status = 'ESCALATED'
        WHERE id = %s AND status NOT IN ('RESOLVED', 'ESCALATED')
    """, (dispute_id,))
    changed = cursor.rowcount == 1
    mysql.connection.commit()

    if not changed:
        cursor.close()
        msg = ('This dispute is already resolved.' if dispute['status'] == 'RESOLVED'
               else 'This dispute is already escalated to admin.')
        return err(msg, 400, 'BAD_STATE')

    cursor.execute("SELECT phone_number FROM users WHERE id = %s", (txn['seller_id'],))
    seller = cursor.fetchone()
    cursor.close()

    for phone in [txn['buyer_phone'], seller['phone_number'] if seller else None]:
        if phone:
            send_sms(phone,
                     f"Zuno: Your dispute for '{txn['item_name']}' has been escalated to our "
                     f"arbitration team. We will review all evidence and decide within "
                     f"{RESOLUTION_WINDOW_HOURS} hours. Dispute ID: {dispute_id}")
            notify_phone(phone, 'Dispute sent to ZUNO',
                         f"Your dispute on '{txn['item_name']}' is with our team. We decide within {RESOLUTION_WINDOW_HOURS} hours.",
                         'dispute', dispute_id)

    return jsonify({
        'message': 'Dispute escalated to admin arbitration. Both parties notified.',
        'dispute_id': dispute_id, 'status': 'ESCALATED'
    }), 200


# ══════════════════════════════════════════════════════════════
# 6 — GET MY DISPUTES
# ══════════════════════════════════════════════════════════════

@disputes_bp.route('/my', methods=['GET'])
@jwt_required()
def get_my_disputes():
    """
    GET /api/disputes/my
    Disputes on transactions where the caller is the buyer or the seller.
    (No phone parameter any more: you only ever see your own.)
    """
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT d.id, d.transaction_id, d.raised_by_role, d.category, d.description,
               d.preferred_resolution, d.status, d.resolution,
               d.split_buyer_amount, d.split_seller_amount, d.evidence_deadline,
               d.resolution_deadline, d.resolved_at, d.created_at, d.admin_notes,
               t.item_name, t.amount
        FROM disputes d
        JOIN transactions t ON t.id = d.transaction_id
        WHERE t.seller_id = %s OR t.buyer_user_id = %s
        ORDER BY d.created_at DESC LIMIT 200
    """, (user['id'], user['id']))
    disputes = cursor.fetchall()
    cursor.close()

    for d in disputes:
        _iso(d, _TIME_FIELDS)

    return jsonify({'disputes': disputes, 'total': len(disputes)}), 200
