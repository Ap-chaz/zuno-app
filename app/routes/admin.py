# app/routes/admin.py
#
# Admin Dashboard for Zuno.
#
# ALL routes here require admin role.
# Regular sellers cannot access any of these endpoints.
#
# ENDPOINTS:
# GET  /api/admin/disputes              → all open disputes
# GET  /api/admin/disputes/<id>        → dispute detail with evidence
# POST /api/admin/disputes/<id>/resolve → make final decision
# GET  /api/admin/transactions          → all transactions
# GET  /api/admin/metrics               → platform statistics
# POST /api/admin/users/<id>/verify     → approve seller verification
# POST /api/admin/users/<id>/suspend    → suspend a user account

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import mysql
from app.utils.helpers import log_transaction_action, tier_limit
from app.utils.validators import validate_required_fields
from app.utils.errors import err
from app.services.notify import notify_phone
from app.services.sms import send_sms
from app.services.escrow import settle_transaction, RELEASE, REFUND, SPLIT
from datetime import datetime, timedelta

admin_bp = Blueprint('admin', __name__)


def require_admin(f):
    """
    Decorator that checks the logged-in user is an admin.
    Applied to every route in this file.

    If a regular seller tries to access admin routes,
    they get a 403 Forbidden response.

    This is our role-based access control (RBAC) system.
    """
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        user_id = get_jwt_identity()

        cursor = mysql.connection.cursor()
        cursor.execute(
            "SELECT role, is_active FROM users WHERE id = %s",
            (user_id,)
        )
        user = cursor.fetchone()
        cursor.close()

        if not user or user['role'] != 'admin' or not user['is_active']:
            return jsonify({
                'error': 'Admin access required. '
                         'You are not authorized for this action.'
            }), 403

        return f(*args, **kwargs)
    return decorated


# ══════════════════════════════════════════════════════════════
# ENDPOINT 1 — GET ALL OPEN DISPUTES
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/disputes', methods=['GET'])
@jwt_required()
@require_admin
def get_all_disputes():
    """
    GET /api/admin/disputes
    GET /api/admin/disputes?status=ESCALATED

    Returns all disputes for admin review.
    Sorted by urgency — escalated disputes first,
    then by resolution deadline (soonest first).

    Admin uses this as their work queue.
    """
    status_filter = request.args.get('status')

    cursor = mysql.connection.cursor()

    if status_filter:
        cursor.execute("""
            SELECT
                d.*,
                t.item_name, t.amount,
                t.buyer_phone, t.buyer_name,
                u.full_name as seller_name,
                u.phone_number as seller_phone,
                u.business_name
            FROM disputes d
            JOIN transactions t ON t.id = d.transaction_id
            JOIN users u ON u.id = t.seller_id
            WHERE d.status = %s
            ORDER BY
                CASE d.status
                    WHEN 'ESCALATED' THEN 1
                    WHEN 'UNDER_REVIEW' THEN 2
                    WHEN 'EVIDENCE_COLLECTION' THEN 3
                    WHEN 'NEGOTIATING' THEN 4
                    ELSE 5
                END,
                d.resolution_deadline ASC
        """, (status_filter.upper(),))
    else:
        cursor.execute("""
            SELECT
                d.*,
                t.item_name, t.amount,
                t.buyer_phone, t.buyer_name,
                u.full_name as seller_name,
                u.phone_number as seller_phone,
                u.business_name
            FROM disputes d
            JOIN transactions t ON t.id = d.transaction_id
            JOIN users u ON u.id = t.seller_id
            WHERE d.status != 'RESOLVED'
            ORDER BY
                CASE d.status
                    WHEN 'ESCALATED' THEN 1
                    WHEN 'UNDER_REVIEW' THEN 2
                    WHEN 'EVIDENCE_COLLECTION' THEN 3
                    WHEN 'NEGOTIATING' THEN 4
                    ELSE 5
                END,
                d.resolution_deadline ASC
        """)

    disputes = cursor.fetchall()
    cursor.close()

    for dispute in disputes:
        for field in ['created_at', 'resolved_at',
                      'evidence_deadline', 'resolution_deadline']:
            if dispute.get(field):
                dispute[field] = str(dispute[field])

    return jsonify({
        'disputes': disputes,
        'total': len(disputes)
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 2 — RESOLVE DISPUTE (Admin Final Decision)
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/disputes/<int:dispute_id>/resolve', methods=['POST'])
@jwt_required()
@require_admin
def resolve_dispute(dispute_id):
    """
    Admin final decision. Money moves through the escrow service only.

    Body: { "resolution": "REFUND_BUYER" | "RELEASE_TO_SELLER" | "SPLIT",
            "admin_notes": "...(20+ chars)",
            "split_buyer_amount": 500, "split_seller_amount": 1500 }   # SPLIT only
    SPLIT: both amounts are whole shillings, total <= funds held (buyer_pays).
    """
    admin_id = get_jwt_identity()
    data = request.get_json(silent=True)

    valid, error = validate_required_fields(data, ['resolution', 'admin_notes'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')

    resolution = data['resolution']
    if resolution not in ('REFUND_BUYER', 'RELEASE_TO_SELLER', 'SPLIT'):
        return err('Resolution must be REFUND_BUYER, RELEASE_TO_SELLER, or SPLIT',
                   400, 'VALIDATION_ERROR')
    if len(str(data['admin_notes']).strip()) < 20:
        return err('Admin notes must be detailed (minimum 20 characters).',
                   400, 'VALIDATION_ERROR')

    sb = ss = None
    if resolution == 'SPLIT':
        try:
            sb = float(data.get('split_buyer_amount', 0) or 0)
            ss = float(data.get('split_seller_amount', 0) or 0)
            if sb != int(sb) or ss != int(ss) or sb < 0 or ss < 0 or sb + ss <= 0:
                raise ValueError
            sb, ss = int(sb), int(ss)
        except (TypeError, ValueError):
            return err('split_buyer_amount and split_seller_amount must be whole, '
                       'non-negative shillings with a positive total.', 400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT d.id, d.status AS dispute_status, d.transaction_id,
               t.buyer_phone, t.item_name, t.seller_id, t.buyer_pays,
               u.phone_number AS seller_phone
        FROM disputes d
        JOIN transactions t ON t.id = d.transaction_id
        JOIN users u ON u.id = t.seller_id
        WHERE d.id = %s
    """, (dispute_id,))
    dispute = cursor.fetchone()
    mysql.connection.commit()
    if not dispute:
        cursor.close()
        return err('Dispute not found', 404, 'NOT_FOUND')
    if dispute['dispute_status'] == 'RESOLVED':
        cursor.close()
        return err('This dispute is already resolved.', 400, 'BAD_STATE')

    outcome = {'REFUND_BUYER': REFUND, 'RELEASE_TO_SELLER': RELEASE, 'SPLIT': SPLIT}[resolution]
    result = settle_transaction(
        dispute['transaction_id'], outcome, ('DISPUTED',),
        triggered_by=f"ADMIN:{admin_id}", split_buyer_amount=sb, split_seller_amount=ss)
    if not result.ok:
        cursor.close()
        status = 409 if result.code in ('BAD_STATE', 'CONFLICT') else (
            400 if result.code in ('BAD_SPLIT', 'BAD_AMOUNT') else 500)
        return err(result.message, status, result.code)

    cursor.execute("""
        UPDATE disputes SET status = 'RESOLVED', resolution = %s,
            split_buyer_amount = %s, split_seller_amount = %s,
            admin_notes = %s, resolved_by = %s, resolved_at = %s
        WHERE id = %s
    """, (resolution, sb, ss, str(data['admin_notes']).strip(), admin_id,
          datetime.now(), dispute_id))
    mysql.connection.commit()
    cursor.close()

    item = dispute['item_name']

    def _tell(phone, text):
        send_sms(phone, text)
        notify_phone(phone, 'Dispute decided', text.replace('Zuno: ', '', 1), 'dispute', dispute_id)

    if resolution == 'REFUND_BUYER':
        _tell(dispute['buyer_phone'], f"Zuno: Your dispute for '{item}' was resolved in your "
                 f"favor. A full refund of Ksh {int(dispute['buyer_pays']):,} is being sent to your M-Pesa.")
        _tell(dispute['seller_phone'], f"Zuno: The dispute for '{item}' was decided in the "
                 f"buyer's favor. A strike has been noted on your account.")
    elif resolution == 'RELEASE_TO_SELLER':
        amt = sum(p['amount'] for p in result.payouts)
        _tell(dispute['seller_phone'], f"Zuno: Your dispute for '{item}' was resolved in your "
                 f"favor. Ksh {amt:,} is being sent to your M-Pesa.")
        _tell(dispute['buyer_phone'], f"Zuno: The dispute for '{item}' was decided in the "
                 f"seller's favor. No refund will be issued.")
    else:
        if sb:
            _tell(dispute['buyer_phone'], f"Zuno: Your dispute for '{item}' ended in a split "
                     f"decision. You will receive Ksh {sb:,}.")
        if ss:
            _tell(dispute['seller_phone'], f"Zuno: Your dispute for '{item}' ended in a split "
                     f"decision. You will receive Ksh {ss:,}.")

    return jsonify({
        'message': 'Dispute resolved. Payouts queued and both parties notified.',
        'dispute_id': dispute_id, 'resolution': resolution,
        'transaction_status': result.new_status,
        'payouts': result.payouts
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 3 — PLATFORM METRICS
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/metrics', methods=['GET'])
@jwt_required()
@require_admin
def get_metrics():
    """
    GET /api/admin/metrics

    Returns platform-wide statistics for the admin dashboard.
    This is what you show investors to demonstrate traction.
    """
    cursor = mysql.connection.cursor()

    # Transaction metrics
    cursor.execute("""
        SELECT
            COUNT(*) as total_transactions,
            SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END)
                as completed,
            SUM(CASE WHEN status='DISPUTED' THEN 1 ELSE 0 END)
                as disputed,
            SUM(CASE WHEN status='FUNDED' THEN 1 ELSE 0 END)
                as funded,
            SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END)
                as pending,
            SUM(CASE WHEN status='COMPLETED'
                THEN platform_fee ELSE 0 END) as total_revenue,
            SUM(CASE WHEN status IN ('FUNDED','IN_TRANSIT',
                'INSPECTION','DISPUTED')
                THEN buyer_pays ELSE 0 END) as funds_in_escrow
        FROM transactions
    """)
    txn_metrics = cursor.fetchone()

    # User metrics
    cursor.execute("""
        SELECT
            COUNT(*) as total_sellers,
            SUM(CASE WHEN is_verified=TRUE THEN 1 ELSE 0 END)
                as verified_sellers,
            SUM(CASE WHEN verification_status='PENDING'
                THEN 1 ELSE 0 END) as pending_verification
        FROM users
        WHERE role = 'seller'
    """)
    user_metrics = cursor.fetchone()

    # Dispute metrics
    cursor.execute("""
        SELECT
            COUNT(*) as total_disputes,
            SUM(CASE WHEN status='RESOLVED' THEN 1 ELSE 0 END)
                as resolved,
            SUM(CASE WHEN status='ESCALATED' THEN 1 ELSE 0 END)
                as escalated,
            SUM(CASE WHEN status NOT IN ('RESOLVED')
                THEN 1 ELSE 0 END) as open_disputes
        FROM disputes
    """)
    dispute_metrics = cursor.fetchone()

    cursor.close()

    # Format currency values
    if txn_metrics:
        txn_metrics['total_revenue'] = float(
            txn_metrics['total_revenue'] or 0
        )
        txn_metrics['funds_in_escrow'] = float(
            txn_metrics['funds_in_escrow'] or 0
        )

    return jsonify({
        'transactions': txn_metrics,
        'users': user_metrics,
        'disputes': dispute_metrics
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 4 — VERIFY SELLER
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/users/<int:user_id>/verify', methods=['POST'])
@jwt_required()
@require_admin
def verify_seller(user_id):
    """
    POST /api/admin/users/<user_id>/verify

    Admin approves or rejects a seller verification request.
    Approved sellers get the Verified Badge and move to Tier 1.

    Expected body:
    {
        "decision": "APPROVED",
        "notes": "ID documents verified successfully."
    }
    """
    data = request.get_json()

    valid, error = validate_required_fields(
        data, ['decision']
    )
    if not valid:
        return jsonify({'error': error}), 400

    if data['decision'] not in ['APPROVED', 'REJECTED']:
        return jsonify({
            'error': 'Decision must be APPROVED or REJECTED'
        }), 400

    cursor = mysql.connection.cursor()
    cursor.execute(
        "SELECT * FROM users WHERE id = %s AND role = 'seller'",
        (user_id,)
    )
    user = cursor.fetchone()

    if not user:
        cursor.close()
        return jsonify({'error': 'Seller not found'}), 404

    if data['decision'] == 'APPROVED':
        cursor.execute("""
            UPDATE users SET
                verification_status = 'VERIFIED',
                is_verified = TRUE,
                seller_tier = 1,
                verified_at = %s,
                verification_notes = %s
            WHERE id = %s
        """, (datetime.now(), data.get('notes', ''), user_id))

        send_sms(
            user['phone_number'],
            f"Zuno: Congratulations {user['full_name']}! "
            f"Your account has been verified. "
            f"You now have a Verified Seller badge and "
            f"can accept deals up to Ksh {tier_limit(1):,}. "
            f"Keep building your reputation!"
        )
    else:
        cursor.execute("""
            UPDATE users SET
                verification_status = 'REJECTED',
                verification_notes = %s
            WHERE id = %s
        """, (data.get('notes', 'Documents not accepted'), user_id))

        send_sms(
            user['phone_number'],
            f"Zuno: Your verification request was not approved. "
            f"Reason: {data.get('notes', 'Documents not accepted')}. "
            f"Please resubmit with correct documents."
        )

    mysql.connection.commit()
    cursor.close()

    return jsonify({
        'message': f"Seller verification {data['decision'].lower()}.",
        'user_id': user_id,
        'decision': data['decision']
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 5 — SUSPEND USER
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/users/<int:user_id>/suspend', methods=['POST'])
@jwt_required()
@require_admin
def suspend_user(user_id):
    """
    POST /api/admin/users/<user_id>/suspend

    Suspends a user account for policy violations.

    Expected body:
    {
        "reason": "Multiple fraudulent transactions detected",
        "days": 30
    }
    """
    data = request.get_json()

    valid, error = validate_required_fields(
        data, ['reason']
    )
    if not valid:
        return jsonify({'error': error}), 400

    try:
        suspend_days = int(data.get('days', 30))
        if not 1 <= suspend_days <= 365:
            raise ValueError
    except (TypeError, ValueError):
        return err('days must be between 1 and 365', 400, 'VALIDATION_ERROR')
    suspended_until = datetime.now() + timedelta(days=suspend_days)

    cursor = mysql.connection.cursor()
    cursor.execute(
        "SELECT * FROM users WHERE id = %s",
        (user_id,)
    )
    user = cursor.fetchone()

    if not user:
        cursor.close()
        return jsonify({'error': 'User not found'}), 404
    if user['role'] == 'admin':
        cursor.close()
        return err('Admin accounts cannot be suspended here.', 400, 'FORBIDDEN')

    cursor.execute("""
        UPDATE users SET
            is_active = FALSE,
            suspension_reason = %s,
            suspended_until = %s
        WHERE id = %s
    """, (data['reason'], suspended_until, user_id))

    mysql.connection.commit()
    cursor.close()

    send_sms(
        user['phone_number'],
        f"Zuno: Your account has been suspended for "
        f"{suspend_days} days. "
        f"Reason: {data['reason']}. "
        f"Contact support@zuno.co.ke to appeal."
    )

    return jsonify({
        'message': f"User suspended for {suspend_days} days.",
        'user_id': user_id,
        'suspended_until': str(suspended_until)
    }), 200

# ══════════════════════════════════════════════════════════════
# ENDPOINT 6 — GET PENDING KYC SUBMISSIONS
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/kyc/pending', methods=['GET'])
@jwt_required()
@require_admin
def get_pending_kyc():
    """
    GET /api/admin/kyc/pending

    Returns all KYC submissions waiting for admin review.
    Admin works through this queue to verify sellers.
    Sorted oldest first — first in, first out.
    """
    cursor = mysql.connection.cursor()

    cursor.execute("""
        SELECT
            k.id,
            k.seller_id,
            k.full_name,
            k.national_id_number,
            k.date_of_birth,
            k.id_front_url,
            k.id_back_url,
            k.selfie_url,
            k.business_name,
            k.business_type,
            k.kra_pin,
            k.status,
            k.submitted_at,
            u.phone_number,
            u.email,
            u.seller_tier,
            u.verification_status
        FROM kyc_submissions k
        JOIN users u ON u.id = k.seller_id
        WHERE k.status IN ('SUBMITTED', 'UNDER_REVIEW', 'RESUBMITTED')
        ORDER BY k.submitted_at ASC
    """)

    submissions = cursor.fetchall()
    cursor.close()

    for sub in submissions:
        if sub.get('submitted_at'):
            sub['submitted_at'] = str(sub['submitted_at'])
        if sub.get('date_of_birth'):
            sub['date_of_birth'] = str(sub['date_of_birth'])

    return jsonify({
        'pending_kyc': submissions,
        'total': len(submissions)
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 7 — REVIEW KYC SUBMISSION
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/kyc/<int:submission_id>/review', methods=['POST'])
@jwt_required()
@require_admin
def review_kyc(submission_id):
    """
    POST /api/admin/kyc/<submission_id>/review

    Admin approves or rejects a KYC submission.

    On APPROVED:
    - Seller gets Verified Badge
    - Seller tier upgrades to 1
    - Transaction limit increases to the Tier 1 cap
    - Seller can list products in catalog
    - SMS notification sent to seller

    On REJECTED:
    - Clear reason given so seller knows what to fix
    - Seller can resubmit with corrected documents
    - SMS notification sent to seller

    Expected body:
    {
        "decision": "APPROVED",
        "review_notes": "Documents verified. National ID matches selfie.",
        "rejection_reason": null
    }

    For rejection:
    {
        "decision": "REJECTED",
        "review_notes": "ID photo is blurry and unreadable.",
        "rejection_reason": "Please resubmit a clear, well-lit photo of your National ID."
    }
    """
    admin_id = get_jwt_identity()
    data = request.get_json()

    valid, error = validate_required_fields(
        data, ['decision', 'review_notes']
    )
    if not valid:
        return jsonify({'error': error}), 400

    if data['decision'] not in ['APPROVED', 'REJECTED']:
        return jsonify({
            'error': 'Decision must be APPROVED or REJECTED'
        }), 400

    # Rejection requires a reason
    if data['decision'] == 'REJECTED' and \
       not data.get('rejection_reason'):
        return jsonify({
            'error': 'rejection_reason is required when rejecting. '
                     'The seller needs to know what to fix.'
        }), 400

    cursor = mysql.connection.cursor()

    # Get the KYC submission
    cursor.execute("""
        SELECT k.*, u.phone_number, u.full_name
        FROM kyc_submissions k
        JOIN users u ON u.id = k.seller_id
        WHERE k.id = %s
    """, (submission_id,))

    submission = cursor.fetchone()

    if not submission:
        cursor.close()
        return jsonify({'error': 'KYC submission not found'}), 404

    now = datetime.now()

    if data['decision'] == 'APPROVED':
        # Update KYC submission
        cursor.execute("""
            UPDATE kyc_submissions SET
                status = 'APPROVED',
                reviewed_by = %s,
                review_notes = %s,
                reviewed_at = %s,
                approved_at = %s
            WHERE id = %s
        """, (
            admin_id,
            data['review_notes'],
            now, now,
            submission_id
        ))

        # Update user — award verified badge and increase tier
        cursor.execute("""
            UPDATE users SET
                verification_status = 'VERIFIED',
                is_verified = TRUE,
                seller_tier = 1,
                verified_at = %s,
                verification_notes = %s
            WHERE id = %s
        """, (
            now,
            data['review_notes'],
            submission['seller_id']
        ))

        mysql.connection.commit()
        cursor.close()

        # Notify seller of approval
        from app.services.sms import send_sms
        send_sms(
            submission['phone_number'],
            f"Zuno: Congratulations {submission['full_name']}! "
            f"Your KYC verification has been approved. "
            f"You now have a Verified Seller badge. "
            f"Your transaction limit is now Ksh {tier_limit(1):,}. "
            f"You can now list products in the Zuno catalog. "
            f"Keep building your reputation!"
        )
        notify_phone(submission['phone_number'], 'Identity verified',
                     'Your verification was approved. Your deal limit is now higher.', 'kyc')

        return jsonify({
            'message': f"KYC approved for {submission['full_name']}. "
                       f"Seller now has Verified Badge and Tier 1 access.",
            'submission_id': submission_id,
            'seller_id': submission['seller_id'],
            'decision': 'APPROVED'
        }), 200

    else:
        # REJECTED
        cursor.execute("""
            UPDATE kyc_submissions SET
                status = 'REJECTED',
                reviewed_by = %s,
                review_notes = %s,
                rejection_reason = %s,
                reviewed_at = %s
            WHERE id = %s
        """, (
            admin_id,
            data['review_notes'],
            data['rejection_reason'],
            now,
            submission_id
        ))

        # Update user status back to allow resubmission
        cursor.execute("""
            UPDATE users SET
                verification_status = 'REJECTED',
                verification_notes = %s
            WHERE id = %s
        """, (data['rejection_reason'], submission['seller_id']))

        mysql.connection.commit()
        cursor.close()

        # Notify seller of rejection with clear reason
        from app.services.sms import send_sms
        send_sms(
            submission['phone_number'],
            f"Zuno: Your verification was not approved. "
            f"Reason: {data['rejection_reason']} "
            f"Please resubmit with corrected documents at "
            f"POST /api/auth/kyc/submit"
        )
        notify_phone(submission['phone_number'], 'Verification not approved',
                     f"Reason: {data['rejection_reason']}. Please resubmit with corrected documents.", 'kyc')

        return jsonify({
            'message': f"KYC rejected for {submission['full_name']}. "
                       f"Seller has been notified with reason.",
            'submission_id': submission_id,
            'decision': 'REJECTED',
            'rejection_reason': data['rejection_reason']
        }), 200

# ══════════════════════════════════════════════════════════════
# ENDPOINT 8 — SET SELLER TIER (business verification → Tier 2)
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/users/<int:user_id>/tier', methods=['POST'])
@jwt_required()
@require_admin
def set_seller_tier(user_id):
    """
    Body: { "tier": 2, "notes": "Business registration + KRA PIN verified" }
    tier 1 = KYC approved, 2 = business verified. A seller must be KYC-verified
    before being moved to tier 1 or 2.
    """
    admin_id = get_jwt_identity()
    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['tier', 'notes'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    try:
        tier = int(data['tier'])
    except (TypeError, ValueError):
        return err('tier must be 1 or 2', 400, 'VALIDATION_ERROR')
    if tier not in (1, 2):
        return err('tier must be 1 or 2', 400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT id, full_name, phone_number, is_verified, seller_tier "
                   "FROM users WHERE id = %s AND role = 'seller'", (user_id,))
    user = cursor.fetchone()
    if not user:
        cursor.close()
        return err('Seller not found', 404, 'NOT_FOUND')
    if not user['is_verified']:
        cursor.close()
        return err('Seller must pass KYC verification first.', 400, 'NOT_VERIFIED')

    cursor.execute("UPDATE users SET seller_tier = %s, verification_notes = %s WHERE id = %s",
                   (tier, str(data['notes'])[:500], user_id))
    mysql.connection.commit()
    cursor.close()

    print(f"[ADMIN] {admin_id} set seller {user_id} tier {user['seller_tier']} -> {tier}")
    send_sms(user['phone_number'],
             f"Zuno: Your seller tier is now Tier {tier}. You can accept deals up to "
             f"Ksh {tier_limit(tier):,}.")
    return jsonify({'message': f"Seller moved to Tier {tier}.", 'user_id': user_id,
                    'seller_tier': tier, 'deal_limit': tier_limit(tier)}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 9 — UNSUSPEND USER
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/users/<int:user_id>/unsuspend', methods=['POST'])
@jwt_required()
@require_admin
def unsuspend_user(user_id):
    cursor = mysql.connection.cursor()
    cursor.execute("UPDATE users SET is_active = TRUE, suspension_reason = NULL, "
                   "suspended_until = NULL WHERE id = %s", (user_id,))
    found = cursor.rowcount == 1
    mysql.connection.commit()
    cursor.close()
    if not found:
        return err('User not found', 404, 'NOT_FOUND')
    return jsonify({'message': 'User reinstated.', 'user_id': user_id}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 10 — PAYOUTS (monitor and retry)
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/payouts', methods=['GET'])
@jwt_required()
@require_admin
def list_payouts():
    """GET /api/admin/payouts?status=NEEDS_REVIEW|FAILED|PENDING|PROCESSING|COMPLETED"""
    status = (request.args.get('status') or '').upper()
    cursor = mysql.connection.cursor()
    if status:
        cursor.execute("SELECT * FROM payouts WHERE status = %s ORDER BY id DESC LIMIT 200",
                       (status,))
    else:
        cursor.execute("SELECT * FROM payouts WHERE status != 'COMPLETED' "
                       "ORDER BY id DESC LIMIT 200")
    rows = cursor.fetchall()
    mysql.connection.commit()
    cursor.close()
    from datetime import date as _date
    from decimal import Decimal as _Decimal
    for r in rows:
        for k, v in list(r.items()):
            if isinstance(v, (datetime, _date)):
                r[k] = v.strftime('%Y-%m-%d %H:%M:%S') if isinstance(v, datetime) else str(v)
            elif isinstance(v, _Decimal):
                r[k] = float(v)
    return jsonify({'payouts': rows, 'total': len(rows)}), 200


@admin_bp.route('/payouts/<int:payout_id>/retry', methods=['POST'])
@jwt_required()
@require_admin
def retry_payout(payout_id):
    """
    Re-queue a FAILED or NEEDS_REVIEW payout. For NEEDS_REVIEW the admin must
    first confirm in the M-Pesa portal that the money did NOT go out:
    body { "confirmed_not_paid": true }.
    """
    data = request.get_json(silent=True) or {}
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT status FROM payouts WHERE id = %s", (payout_id,))
    row = cursor.fetchone()
    if not row:
        cursor.close()
        return err('Payout not found', 404, 'NOT_FOUND')
    if row['status'] not in ('FAILED', 'NEEDS_REVIEW'):
        cursor.close()
        return err(f"Payout is {row['status']}; only FAILED or NEEDS_REVIEW can be retried.",
                   400, 'BAD_STATE')
    if row['status'] == 'NEEDS_REVIEW' and data.get('confirmed_not_paid') is not True:
        cursor.close()
        return err('Confirm in the M-Pesa portal that this was NOT paid, then send '
                   '{"confirmed_not_paid": true}.', 400, 'CONFIRM_REQUIRED')
    cursor.execute("""
        UPDATE payouts SET status = 'PENDING', failure_reason = NULL,
               originator_conversation_id = NULL, conversation_id = NULL
        WHERE id = %s AND status IN ('FAILED','NEEDS_REVIEW')
    """, (payout_id,))
    mysql.connection.commit()
    cursor.close()
    return jsonify({'message': 'Payout re-queued.', 'payout_id': payout_id}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 11 — ALL TRANSACTIONS (admin overview)
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/transactions', methods=['GET'])
@jwt_required()
@require_admin
def admin_transactions():
    """GET /api/admin/transactions?status=DISPUTED&q=text  (latest 500)"""
    status = (request.args.get('status') or '').upper()
    q = (request.args.get('q') or '').strip()[:60]
    where, params = ['1=1'], []
    if status:
        where.append("t.status = %s"); params.append(status)
    if q:
        where.append("(t.id LIKE %s OR t.item_name LIKE %s OR t.buyer_name LIKE %s)")
        like = f"%{q}%"
        params += [like, like, like]
    cursor = mysql.connection.cursor()
    cursor.execute(f"""
        SELECT t.*, u.full_name AS seller_name, u.business_name AS seller_business
        FROM transactions t JOIN users u ON u.id = t.seller_id
        WHERE {' AND '.join(where)} ORDER BY t.created_at DESC LIMIT 500
    """, params)
    rows = cursor.fetchall()
    mysql.connection.commit()
    cursor.close()
    for r in rows:
        for k, v in list(r.items()):
            if hasattr(v, 'isoformat'):
                r[k] = v.isoformat()
    return jsonify({'transactions': rows, 'total': len(rows)}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 12 — USERS (buyers / sellers)
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/users', methods=['GET'])
@jwt_required()
@require_admin
def admin_users():
    """GET /api/admin/users?role=buyer|seller&q=text  (latest 500; never returns password hashes)"""
    role = (request.args.get('role') or '').lower()
    q = (request.args.get('q') or '').strip()[:60]
    where, params = ["u.role <> 'admin'"], []
    if role in ('buyer', 'seller'):
        where.append("u.role = %s"); params.append(role)
    if q:
        where.append("(u.full_name LIKE %s OR u.phone_number LIKE %s OR u.email LIKE %s OR u.business_name LIKE %s)")
        like = f"%{q}%"
        params += [like] * 4
    cursor = mysql.connection.cursor()
    cursor.execute(f"""
        SELECT u.id, u.full_name, u.phone_number, u.email, u.business_name, u.role, u.is_active,
               u.is_verified, u.phone_verified, u.verification_status, u.seller_tier,
               u.suspension_reason, u.suspended_until, u.created_at,
               (SELECT COUNT(*) FROM transactions t WHERE t.buyer_user_id = u.id OR t.seller_id = u.id) AS deal_count,
               (SELECT COUNT(*) FROM transactions t WHERE (t.buyer_user_id = u.id OR t.seller_id = u.id)
                  AND t.status IN ('DISPUTED','RESOLVED','REFUNDED')) AS dispute_count
        FROM users u WHERE {' AND '.join(where)} ORDER BY u.created_at DESC LIMIT 500
    """, params)
    rows = cursor.fetchall()
    mysql.connection.commit()
    cursor.close()
    for r in rows:
        for k, v in list(r.items()):
            if hasattr(v, 'isoformat'):
                r[k] = v.isoformat()
    return jsonify({'users': rows, 'total': len(rows)}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 13 — DISPUTE DETAIL (admin)
# ══════════════════════════════════════════════════════════════

@admin_bp.route('/disputes/<int:dispute_id>', methods=['GET'])
@jwt_required()
@require_admin
def admin_dispute_detail(dispute_id):
    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT d.*, t.item_name, t.amount, t.buyer_pays, t.seller_receives, t.status AS transaction_status,
               t.buyer_name, t.buyer_phone, u.full_name AS seller_name, u.business_name,
               u.phone_number AS seller_phone
        FROM disputes d JOIN transactions t ON t.id = d.transaction_id
        JOIN users u ON u.id = t.seller_id WHERE d.id = %s
    """, (dispute_id,))
    d = cursor.fetchone()
    if not d:
        cursor.close()
        return err('Dispute not found', 404, 'NOT_FOUND')
    cursor.execute("SELECT * FROM dispute_evidence WHERE dispute_id = %s ORDER BY created_at", (dispute_id,))
    evidence = cursor.fetchall()
    cursor.execute("SELECT id, sender_role, message, is_offer, offer_amount, offer_status, created_at "
                   "FROM negotiation_messages WHERE dispute_id = %s ORDER BY created_at, id", (dispute_id,))
    messages = cursor.fetchall()
    mysql.connection.commit()
    cursor.close()
    for row in [d, *evidence, *messages]:
        for k, v in list(row.items()):
            if hasattr(v, 'isoformat'):
                row[k] = v.isoformat()
    return jsonify({'dispute': d, 'evidence': evidence, 'messages': messages}), 200
