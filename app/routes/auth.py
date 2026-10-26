# app/routes/auth.py
#
# Authentication endpoints for Zuno.
# These are the first routes every seller interacts with.
#
# ENDPOINTS IN THIS FILE:
#
# POST /api/auth/register        → Create a new seller account
# POST /api/auth/send-otp        → Send OTP to phone for verification
# POST /api/auth/verify-otp      → Verify the OTP code entered
# POST /api/auth/login           → Login (phone or email) and receive JWT token
# GET  /api/auth/profile         → Get logged-in user's profile
# PUT  /api/auth/profile         → Update profile details
#
# SECURITY NOTES:
# - Passwords are NEVER stored in plain text — always hashed with bcrypt
# - Login errors use generic messages — never reveal if phone exists
# - JWT tokens expire after 24 hours
# - OTP codes expire after 10 minutes and max 3 attempts

from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token,
    jwt_required,
    get_jwt_identity
)
from app import mysql, bcrypt
from app.utils.validators import (
    validate_phone,
    validate_password,
    validate_required_fields,
    normalize_phone
)
from app.utils.errors import err
from app.utils.helpers import tier_limit
from app.utils.security import check_rate_limit
from app.services.sms import send_otp
from datetime import datetime, timedelta
import hmac
import hashlib
import os
import secrets

OTP_MAX_ATTEMPTS = 3
OTP_COOLDOWN_SECONDS = 60
LOGIN_MAX_FAILS = 8

auth_bp = Blueprint('auth', __name__)


# ══════════════════════════════════════════════════════════════
# ENDPOINT 1 — REGISTER (buyer or seller)
# ══════════════════════════════════════════════════════════════

@auth_bp.route('/register', methods=['POST'])
def register():
    """
    POST /api/auth/register
    Body: { "full_name", "phone_number", "password",
            "role": "buyer" | "seller" (default seller),
            "business_name"?, "email"? }
    The phone must be verified (OTP) before login. "admin" can never be
    self-assigned.
    """
    rate_limit_error = check_rate_limit(10, 1, scope='register')
    if rate_limit_error:
        return rate_limit_error

    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['full_name', 'phone_number', 'password'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')

    valid, error = validate_phone(data['phone_number'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    phone = normalize_phone(data['phone_number'])

    valid, error = validate_password(data['password'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')

    role = str(data.get('role') or 'seller').lower()
    if role not in ('buyer', 'seller'):
        return err("role must be 'buyer' or 'seller'", 400, 'VALIDATION_ERROR')

    email = (data.get('email') or '').strip().lower() or None
    if email and ('@' not in email or len(email) > 190):
        return err('Enter a valid email address', 400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT id FROM users WHERE phone_number = %s OR (%s IS NOT NULL AND email = %s)",
                   (phone, email, email))
    if cursor.fetchone():
        cursor.close()
        return err('An account with this phone number or email already exists', 409, 'CONFLICT')

    password_hash = bcrypt.generate_password_hash(data['password']).decode('utf-8')
    try:
        cursor.execute("""
            INSERT INTO users (full_name, phone_number, email, password_hash,
                               business_name, role)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (str(data['full_name']).strip()[:150], phone, email, password_hash,
              (data.get('business_name') or None) if role == 'seller' else None, role))
        user_id = cursor.lastrowid
        if role == 'seller':
            cursor.execute("INSERT INTO seller_reputation (seller_id) VALUES (%s)", (user_id,))
        mysql.connection.commit()
    except Exception as e:
        mysql.connection.rollback()
        cursor.close()
        print(f"[AUTH] register failed: {e}")
        return err('An account with these details already exists', 409, 'CONFLICT')
    cursor.close()

    _generate_and_send_otp(phone)

    if email:
        from app.services.email import send_verification_email
        send_verification_email(user_id, email, data['full_name'])

    return jsonify({
        'message': 'Account created. Enter the code we sent by SMS to verify your phone.',
        'user_id': user_id, 'role': role, 'next_step': 'verify_phone'
    }), 201


# ══════════════════════════════════════════════════════════════
# ENDPOINT 2 — SEND / RESEND OTP
# ══════════════════════════════════════════════════════════════

@auth_bp.route('/send-otp', methods=['POST'])
def send_otp_endpoint():
    """
    Body: { "phone_number" }. Only registered numbers get an SMS (prevents SMS
    bombing of arbitrary numbers); the reply is identical either way. One code
    per 60 seconds.
    """
    rate_limit_error = check_rate_limit(5, 1, scope='send_otp')
    if rate_limit_error:
        return rate_limit_error

    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['phone_number'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    valid, error = validate_phone(data['phone_number'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    phone = normalize_phone(data['phone_number'])

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT id FROM users WHERE phone_number = %s", (phone,))
    exists = cursor.fetchone()
    cursor.close()
    if exists:
        sent = _generate_and_send_otp(phone)
        if sent == 'COOLDOWN':
            return err('Please wait a minute before requesting another code.', 429, 'RATE_LIMITED')

    return jsonify({'message': 'If this number is registered, a verification code was sent.',
                    'expires_in': '10 minutes'}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 3 — VERIFY OTP (marks phone verified, returns a login token)
# ══════════════════════════════════════════════════════════════

def _user_payload(user):
    return {
        'id': user['id'], 'full_name': user['full_name'],
        'phone_number': user['phone_number'], 'email': user['email'],
        'business_name': user['business_name'], 'role': user['role'],
        'is_verified': bool(user['is_verified']),
        'phone_verified': bool(user['phone_verified']),
        'verification_status': user['verification_status'],
        'seller_tier': user['seller_tier'],
    }


@auth_bp.route('/verify-otp', methods=['POST'])
def verify_otp():
    """
    Body: { "phone_number", "otp_code" }
    Max 3 wrong attempts per code, 10 min expiry, single use.
    On success sets users.phone_verified and returns { token, user }.
    """
    rate_limit_error = check_rate_limit(10, 1, scope='verify_otp')
    if rate_limit_error:
        return rate_limit_error

    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['phone_number', 'otp_code'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    phone = normalize_phone(data['phone_number'])
    if not phone:
        return err('Enter a valid Kenyan phone number', 400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM otp_verifications WHERE phone_number = %s", (phone,))
    rec = cursor.fetchone()

    if not rec or rec['verified_at'] is not None:
        cursor.close()
        return err('No active verification code. Please request a new one.', 400, 'OTP_INVALID')
    if rec['attempts'] >= OTP_MAX_ATTEMPTS:
        cursor.close()
        return err('Too many incorrect attempts. Please request a new code.', 429, 'OTP_LOCKED')
    if datetime.now() > rec['expires_at']:
        cursor.close()
        return err('Verification code has expired. Please request a new one.', 400, 'OTP_EXPIRED')

    if not hmac.compare_digest(rec['otp_code'], _hash_otp(phone, str(data['otp_code']).strip())):
        cursor.execute("UPDATE otp_verifications SET attempts = attempts + 1 "
                       "WHERE phone_number = %s", (phone,))
        mysql.connection.commit()
        cursor.close()
        left = max(OTP_MAX_ATTEMPTS - (rec['attempts'] + 1), 0)
        return err(f"Incorrect code. {left} attempts remaining.", 400, 'OTP_INVALID')

    # Single use: only one request can flip verified_at from NULL
    cursor.execute("UPDATE otp_verifications SET verified_at = %s "
                   "WHERE phone_number = %s AND verified_at IS NULL", (datetime.now(), phone))
    if cursor.rowcount != 1:
        mysql.connection.rollback()
        cursor.close()
        return err('This code was already used.', 400, 'OTP_INVALID')
    # verification_status stays UNVERIFIED: it only moves when KYC documents are submitted
    cursor.execute("UPDATE users SET phone_verified = TRUE WHERE phone_number = %s", (phone,))
    mysql.connection.commit()
    cursor.execute("SELECT * FROM users WHERE phone_number = %s", (phone,))
    user = cursor.fetchone()
    cursor.close()
    if not user:
        return err('Account not found', 404, 'NOT_FOUND')

    return jsonify({'message': 'Phone number verified.',
                    'token': create_access_token(identity=str(user['id'])),
                    'user': _user_payload(user)}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 4 — LOGIN (phone or email + password)
# ══════════════════════════════════════════════════════════════

@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Body: { "identifier": "0712345678 | me@x.com", "password" }
    (phone_number / email are accepted as aliases of identifier.)
    Same generic error for unknown account and wrong password. Locks out after
    repeated failures per account for 15 minutes.
    """
    rate_limit_error = check_rate_limit(10, 1, scope='login')
    if rate_limit_error:
        return rate_limit_error

    data = request.get_json(silent=True) or {}
    identifier = str(data.get('identifier') or data.get('phone_number')
                     or data.get('email') or '').strip()
    password = data.get('password')
    if not identifier or not password:
        return err('identifier and password are required', 400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    if '@' in identifier:
        cursor.execute("SELECT * FROM users WHERE email = %s", (identifier.lower(),))
    else:
        phone = normalize_phone(identifier)
        cursor.execute("SELECT * FROM users WHERE phone_number = %s", (phone,))
    user = cursor.fetchone()

    bad = err('Invalid credentials', 401, 'INVALID_CREDENTIALS')
    if not user:
        cursor.close()
        # burn comparable time so account existence is not obvious
        bcrypt.generate_password_hash(str(password))
        return bad

    if user.get('locked_until') and user['locked_until'] > datetime.now():
        cursor.close()
        return err('Too many failed attempts. Try again in a few minutes.', 429, 'ACCOUNT_LOCKED')

    if not bcrypt.check_password_hash(user['password_hash'], str(password)):
        cursor.execute("""
            UPDATE users SET
                   locked_until = IF(failed_logins + 1 >= %s, %s, locked_until),
                   failed_logins = IF(failed_logins + 1 >= %s, 0, failed_logins + 1)
            WHERE id = %s
        """, (LOGIN_MAX_FAILS, datetime.now() + timedelta(minutes=15), LOGIN_MAX_FAILS, user['id']))
        mysql.connection.commit()
        cursor.close()
        return bad

    # Suspension: lifts itself once suspended_until has passed
    if not user['is_active']:
        until = user.get('suspended_until')
        if until and until < datetime.now():
            cursor.execute("UPDATE users SET is_active = TRUE, suspension_reason = NULL, "
                           "suspended_until = NULL WHERE id = %s", (user['id'],))
            mysql.connection.commit()
        else:
            cursor.close()
            return err('Your account has been suspended. Contact support@zuno.co.ke',
                       403, 'SUSPENDED')

    if not user['phone_verified']:
        cursor.close()
        _generate_and_send_otp(user['phone_number'])
        # Only reached with the correct password, so returning the number is safe.
        return jsonify({'error': 'Verify your phone number first. We sent you a new code.',
                        'message': 'Verify your phone number first. We sent you a new code.',
                        'code': 'PHONE_NOT_VERIFIED', 'status': 403,
                        'phone': user['phone_number']}), 403

    cursor.execute("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = %s",
                   (user['id'],))
    mysql.connection.commit()
    cursor.close()

    return jsonify({'message': 'Login successful',
                    'token': create_access_token(identity=str(user['id'])),
                    'user': _user_payload(user)}), 200


# ══════════════════════════════════════════════════════════════
# PASSWORD RESET (SMS code)
# ══════════════════════════════════════════════════════════════

@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    """Body: { "phone_number" }. Always answers the same way; only registered numbers get a code."""
    rate_limit_error = check_rate_limit(5, 1, scope='forgot_password')
    if rate_limit_error:
        return rate_limit_error
    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['phone_number'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    phone = normalize_phone(data['phone_number'])
    if not phone:
        return err('Enter the Kenyan phone number linked to your account', 400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT id FROM users WHERE phone_number = %s", (phone,))
    exists = cursor.fetchone()
    cursor.close()
    if exists:
        _generate_and_send_otp(phone)
    return jsonify({'message': 'If this number is registered, a reset code was sent.'}), 200


@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    """Body: { "phone_number", "otp_code", "new_password" }. The code is single use."""
    rate_limit_error = check_rate_limit(10, 1, scope='reset_password')
    if rate_limit_error:
        return rate_limit_error
    data = request.get_json(silent=True)
    valid, error = validate_required_fields(data, ['phone_number', 'otp_code', 'new_password'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')
    phone = normalize_phone(data['phone_number'])
    if not phone:
        return err('Enter a valid Kenyan phone number', 400, 'VALIDATION_ERROR')
    valid, error = validate_password(data['new_password'])
    if not valid:
        return err(error, 400, 'VALIDATION_ERROR')

    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM otp_verifications WHERE phone_number = %s", (phone,))
    rec = cursor.fetchone()
    if not rec or rec['verified_at'] is not None or datetime.now() > rec['expires_at']:
        cursor.close()
        return err('That code is not valid any more. Request a new one.', 400, 'OTP_INVALID')
    if rec['attempts'] >= OTP_MAX_ATTEMPTS:
        cursor.close()
        return err('Too many incorrect attempts. Request a new code.', 429, 'OTP_LOCKED')
    if not hmac.compare_digest(rec['otp_code'], _hash_otp(phone, str(data['otp_code']).strip())):
        cursor.execute("UPDATE otp_verifications SET attempts = attempts + 1 WHERE phone_number = %s", (phone,))
        mysql.connection.commit()
        cursor.close()
        return err('Incorrect code.', 400, 'OTP_INVALID')

    cursor.execute("UPDATE otp_verifications SET verified_at = %s WHERE phone_number = %s AND verified_at IS NULL",
                   (datetime.now(), phone))
    if cursor.rowcount != 1:
        mysql.connection.rollback()
        cursor.close()
        return err('That code was already used.', 400, 'OTP_INVALID')
    new_hash = bcrypt.generate_password_hash(data['new_password']).decode('utf-8')
    # Proving the code also proves the phone; unlock a locked-out account too.
    cursor.execute("UPDATE users SET password_hash = %s, phone_verified = TRUE, failed_logins = 0, "
                   "locked_until = NULL WHERE phone_number = %s", (new_hash, phone))
    mysql.connection.commit()
    cursor.close()
    return jsonify({'message': 'Password updated. You can log in now.'}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 5 — GET PROFILE
# ══════════════════════════════════════════════════════════════

@auth_bp.route('/profile', methods=['GET'])
@jwt_required()
def get_profile():
    """
    GET /api/auth/profile

    Returns the full profile of the currently logged-in seller,
    including their reputation metrics and trust score.

    Requires: Authorization: Bearer <token> in request headers.

    @jwt_required() decorator does the work —
    if no valid token is provided, Flask automatically
    returns a 401 error before our code even runs.
    """
    # get_jwt_identity() reads the user info we stored in the token
    # get_jwt_identity() now returns a string user ID
    user_id = get_jwt_identity()
    
    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT
            u.id, u.full_name, u.phone_number, u.email,
            u.business_name, u.bio, u.profile_photo,
            u.role, u.is_verified, u.verification_status,
            u.seller_tier, u.phone_verified, u.email_verified, u.created_at,
            r.completion_rate, r.cancellation_rate,
            r.dispute_rate, r.late_delivery_rate,
            r.average_rating, r.total_transactions,
            r.trust_score, r.trust_level,
            r.is_visible_in_search, r.strike_count
        FROM users u
        LEFT JOIN seller_reputation r ON r.seller_id = u.id
        WHERE u.id = %s
    """, (user_id,))

    user = cursor.fetchone()
    cursor.close()

    if not user:
        return jsonify({'error': 'User not found'}), 404

    # Convert datetime to string for JSON serialization
    if user.get('created_at'):
        user['created_at'] = str(user['created_at'])

    return jsonify({'user': user}), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 6 — UPDATE PROFILE
# ══════════════════════════════════════════════════════════════

@auth_bp.route('/profile', methods=['PUT'])
@jwt_required()
def update_profile():
    """
    PUT /api/auth/profile

    Updates the logged-in seller's profile information.
    Only allows updating safe fields —
    phone number and role cannot be changed here.

    Expected request body (all fields optional):
    {
        "full_name": "Jane Muthoni Kamau",
        "business_name": "Jane's Fashion House",
        "bio": "Premium fashion seller based in Nairobi",
        "email": "jane@gmail.com"
    }
    """
    user_id = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    # Only allow these fields to be updated
    # Never allow phone_number, role, or is_verified
    # to be changed through this endpoint
    allowed_fields = ['full_name', 'business_name', 'bio', 'email']
    updates = {}

    for field in allowed_fields:
        if field in data and data[field] is not None:
            updates[field] = str(data[field]).strip()

    if not updates:
        return jsonify({'error': 'No valid fields to update'}), 400

    # Build dynamic SQL update statement
    # This safely handles any combination of fields being updated
    set_clause = ', '.join([f"{field} = %s" for field in updates.keys()])
    values = list(updates.values()) + [user_id]
    if 'email' in updates:
        updates['email'] = updates['email'].lower() or None
        if updates['email'] and '@' not in updates['email']:
            return err('Enter a valid email address', 400, 'VALIDATION_ERROR')
        set_clause = ', '.join([f"{field} = %s" for field in updates.keys()]) + ', email_verified = FALSE'
        values = list(updates.values()) + [user_id]
    cursor = mysql.connection.cursor()
    try:
        cursor.execute(
            f"UPDATE users SET {set_clause} WHERE id = %s",
            values
        )
        mysql.connection.commit()
    except Exception:
        mysql.connection.rollback()
        cursor.close()
        return err('That email is already in use.', 409, 'CONFLICT')
    cursor.close()

    return jsonify({
        'message': 'Profile updated successfully'
    }), 200


def get_current_user():
    """
    Helper function that fetches the full user record
    for whoever is currently logged in.
    
    Since we now store only the user ID in the JWT token,
    we use this function whenever we need the full user
    details (phone number, role, tier etc.) inside a
    protected route.
    
    Usage in any protected route:
        user = get_current_user()
        if not user:
            return jsonify({'error': 'User not found'}), 404
    """
    user_id = get_jwt_identity()
    
    cursor = mysql.connection.cursor()
    cursor.execute(
        "SELECT * FROM users WHERE id = %s AND is_active = TRUE",
        (user_id,)
    )
    user = cursor.fetchone()
    cursor.close()
    
    return user


# ══════════════════════════════════════════════════════════════
# ENDPOINT 7 — VERIFY EMAIL
# ══════════════════════════════════════════════════════════════

@auth_bp.route('/verify-email', methods=['POST'])
def verify_email():
    """
    POST /api/auth/verify-email
    
    Called when a user clicks the verification link in their email.
    The frontend extracts the token from the URL and sends it here.
    
    Expected request body:
    {
        "token": "a3F9k2P8x7Q1b4D8c2E5f6G7h8I9j0K1L2M3n4O5"
    }
    """
    data = request.get_json()
    
    if not data or not data.get('token'):
        return jsonify({'error': 'Verification token is required'}), 400
    
    token = data['token'].strip()
    
    cursor = mysql.connection.cursor()
    
    # Find the verification record for this token
    cursor.execute("""
        SELECT ev.*, u.full_name, u.email as user_email
        FROM email_verifications ev
        JOIN users u ON u.id = ev.user_id
        WHERE ev.token = %s
    """, (token,))
    
    record = cursor.fetchone()
    
    # ── Token not found ───────────────────────────────────────
    if not record:
        cursor.close()
        return jsonify({
            'error': 'Invalid verification link. '
                     'Please request a new one.'
        }), 404
    
    # ── Token already used ────────────────────────────────────
    if record['verified_at'] is not None:
        cursor.close()
        return jsonify({
            'error': 'This link has already been used. '
                     'Your email is already verified.'
        }), 400
    
    # ── Token expired ─────────────────────────────────────────
    if datetime.now() > record['expires_at']:
        cursor.close()
        return jsonify({
            'error': 'This verification link has expired. '
                     'Please request a new one.'
        }), 400
    
    now = datetime.now()
    
    # ── Mark token as used ────────────────────────────────────
    cursor.execute("""
        UPDATE email_verifications
        SET verified_at = %s
        WHERE token = %s
    """, (now, token))
    
    # ── Mark user's email as verified ─────────────────────────
    cursor.execute("""
        UPDATE users
        SET email_verified = TRUE
        WHERE id = %s
    """, (record['user_id'],))
    
    mysql.connection.commit()
    cursor.close()
    
    # Send welcome email now that verification is complete
    from app.services.email import send_welcome_email
    send_welcome_email(record['email'], record['full_name'])
    
    return jsonify({
        'message': 'Email verified successfully. Welcome to Zuno!',
        'next_step': 'login'
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 8 — RESEND VERIFICATION EMAIL
# ══════════════════════════════════════════════════════════════

@auth_bp.route('/resend-verification-email', methods=['POST'])
def resend_verification_email():
    """
    POST /api/auth/resend-verification-email
    
    Resends the email verification link.
    Used when the original email expired or was not received.
    
    Expected request body:
    {
        "email": "jane@gmail.com"
    }
    """
    data = request.get_json()
    
    if not data or not data.get('email'):
        return jsonify({'error': 'Email address is required'}), 400
    
    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT id, full_name, email, email_verified
        FROM users
        WHERE email = %s
    """, (data['email'].strip().lower(),))
    
    user = cursor.fetchone()
    cursor.close()
    
    # Always return success even if email not found
    # This prevents attackers from discovering which
    # emails are registered on the platform
    if not user:
        return jsonify({
            'message': 'If that email is registered, '
                       'a verification link has been sent.'
        }), 200
    
    if user['email_verified']:
        return jsonify({
            'message': 'This email is already verified. '
                       'You can log in normally.'
        }), 200
    
    # Send new verification email
    from app.services.email import send_verification_email
    send_verification_email(user['id'], user['email'], user['full_name'])
    
    return jsonify({
        'message': 'If that email is registered, '
                   'a verification link has been sent.'
    }), 200


# ══════════════════════════════════════════════════════════════
# ENDPOINT 9 — SUBMIT KYC DOCUMENTS
# ══════════════════════════════════════════════════════════════

@auth_bp.route('/kyc/submit', methods=['POST'])
@jwt_required()
def submit_kyc():
    """
    POST /api/auth/kyc/submit

    Seller submits KYC documents for verification.
    Accepts multipart/form-data with document uploads.

    This endpoint handles real file uploads.
    Files are uploaded directly to Cloudinary.

    Required form fields:
        national_id_number : e.g. "12345678"
        full_name          : legal name as on ID
        id_front           : photo file of ID front
        selfie             : photo file of selfie holding ID

    Optional form fields:
        id_back            : photo file of ID back
        date_of_birth      : e.g. "1995-06-15"
        business_name      : business trading name
        business_type      : INDIVIDUAL / SMALL_BUSINESS / COMPANY
        kra_pin            : KRA tax PIN
    """
    user_id = get_jwt_identity()

    # For file uploads we use request.form and request.files
    # NOT request.get_json() — JSON cannot carry files
    form = request.form
    files = request.files

    # Validate required form fields
    if not form.get('national_id_number'):
        return jsonify({'error': 'National ID number is required'}), 400

    if not form.get('full_name'):
        return jsonify({'error': 'Full name as on ID is required'}), 400

    # Validate required files
    if 'id_front' not in files:
        return jsonify({
            'error': 'Front photo of National ID is required'
        }), 400

    if 'selfie' not in files:
        return jsonify({
            'error': 'Selfie holding your ID is required'
        }), 400

    cursor = mysql.connection.cursor()

    # Check current verification status
    cursor.execute(
        "SELECT verification_status, full_name, phone_number "
        "FROM users WHERE id = %s",
        (user_id,)
    )
    user = cursor.fetchone()

    if not user:
        cursor.close()
        return jsonify({'error': 'User not found'}), 404

    # Already verified — no need to resubmit
    if user['verification_status'] == 'VERIFIED':
        cursor.close()
        return jsonify({
            'message': 'Your account is already verified.',
            'status': 'VERIFIED'
        }), 200

    # Upload documents to Cloudinary
    from app.services.upload import upload_id_document

    # Upload ID front
    id_front_result = upload_id_document(
        files['id_front'],
        user_id,
        'id_front'
    )
    if not id_front_result['success']:
        cursor.close()
        return jsonify({
            'error': 'Failed to upload ID photo. Please try again.'
        }), 500

    # Upload selfie
    selfie_result = upload_id_document(
        files['selfie'],
        user_id,
        'selfie'
    )
    if not selfie_result['success']:
        cursor.close()
        return jsonify({
            'error': 'Failed to upload selfie. Please try again.'
        }), 500

    # Upload ID back if provided
    id_back_url = None
    if 'id_back' in files:
        id_back_result = upload_id_document(
            files['id_back'],
            user_id,
            'id_back'
        )
        if id_back_result['success']:
            id_back_url = id_back_result['url']

    # Check if submission already exists
    cursor.execute(
        "SELECT id FROM kyc_submissions WHERE seller_id = %s",
        (user_id,)
    )
    existing = cursor.fetchone()

    if existing:
        # Update existing submission (resubmission after rejection)
        cursor.execute("""
            UPDATE kyc_submissions SET
                full_name = %s,
                national_id_number = %s,
                date_of_birth = %s,
                id_front_url = %s,
                id_back_url = %s,
                selfie_url = %s,
                business_name = %s,
                business_type = %s,
                kra_pin = %s,
                status = 'RESUBMITTED',
                submitted_at = %s,
                reviewed_at = NULL,
                reviewed_by = NULL,
                review_notes = NULL,
                rejection_reason = NULL
            WHERE seller_id = %s
        """, (
            form.get('full_name').strip(),
            form.get('national_id_number').strip(),
            form.get('date_of_birth', None),
            id_front_result['url'],
            id_back_url,
            selfie_result['url'],
            form.get('business_name', None),
            form.get('business_type', 'INDIVIDUAL'),
            form.get('kra_pin', None),
            datetime.now(),
            user_id
        ))
    else:
        # New submission
        cursor.execute("""
            INSERT INTO kyc_submissions (
                seller_id, full_name, national_id_number,
                date_of_birth, id_front_url, id_back_url,
                selfie_url, business_name, business_type, kra_pin
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            user_id,
            form.get('full_name').strip(),
            form.get('national_id_number').strip(),
            form.get('date_of_birth', None),
            id_front_result['url'],
            id_back_url,
            selfie_result['url'],
            form.get('business_name', None),
            form.get('business_type', 'INDIVIDUAL'),
            form.get('kra_pin', None)
        ))

    # Update user verification status to PENDING
    cursor.execute("""
        UPDATE users SET
            verification_status = 'PENDING',
            national_id = %s,
            id_document_url = %s,
            business_name = COALESCE(%s, business_name)
        WHERE id = %s
    """, (
        form.get('national_id_number').strip(),
        id_front_result['url'],
        form.get('business_name', None),
        user_id
    ))

    mysql.connection.commit()
    cursor.close()

    # Notify all admins via SMS
    _notify_admins_of_kyc(user['full_name'], user['phone_number'])

    return jsonify({
        'message': 'KYC documents submitted successfully. '
                   'Our team will review within 24-48 hours.',
        'status': 'PENDING',
        'documents_uploaded': {
            'id_front': '✅ Uploaded',
            'id_back': '✅ Uploaded' if id_back_url else '⚠️ Not provided',
            'selfie': '✅ Uploaded'
        },
        'next_steps': [
            'Wait for admin review (24-48 hours)',
            'You will receive an SMS with the decision',
            'Once approved you get the Verified Seller badge',
            f'Your transaction limit increases to Ksh {tier_limit(1):,}'
        ]
    }), 200


@auth_bp.route('/kyc/status', methods=['GET'])
@jwt_required()
def get_kyc_status():
    """
    GET /api/auth/kyc/status

    Returns the seller's current KYC status.
    Sellers use this to track their verification progress.
    """
    user_id = get_jwt_identity()

    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT
            k.status,
            k.submitted_at,
            k.reviewed_at,
            k.rejection_reason,
            k.review_notes,
            u.verification_status,
            u.is_verified,
            u.seller_tier
        FROM users u
        LEFT JOIN kyc_submissions k ON k.seller_id = u.id
        WHERE u.id = %s
    """, (user_id,))

    result = cursor.fetchone()
    cursor.close()

    if not result:
        return jsonify({'error': 'User not found'}), 404

    # Convert timestamps
    for field in ['submitted_at', 'reviewed_at']:
        if result.get(field):
            result[field] = str(result[field])

    # Build status message based on current state
    status_messages = {
        'UNVERIFIED': 'You have not submitted KYC documents yet.',
        'PENDING': 'Your documents are awaiting review.',
        'SUBMITTED': 'Your documents have been submitted.',
        'UNDER_REVIEW': 'An admin is currently reviewing your documents.',
        'RESUBMITTED': 'Your resubmission is awaiting review.',
        'VERIFIED': 'Your account is fully verified. ✅',
        'REJECTED': 'Your verification was rejected. '
                    'Please review the reason and resubmit.'
    }

    current_status = result.get('status') or result['verification_status']
    message = status_messages.get(current_status, 'Status unknown')

    return jsonify({
        'kyc_status': current_status,
        'message': message,
        'is_verified': result['is_verified'],
        'seller_tier': result['seller_tier'],
        'submitted_at': result.get('submitted_at'),
        'reviewed_at': result.get('reviewed_at'),
        'rejection_reason': result.get('rejection_reason'),
        'review_notes': result.get('review_notes'),
        'deal_limit': tier_limit(result['seller_tier']),
        'tier_benefits': {
            0: f"Max deal: Ksh {tier_limit(0):,}",
            1: f"Max deal: Ksh {tier_limit(1):,} + Verified Badge",
            2: f"Max deal: Ksh {tier_limit(2):,} + Full access"
        }.get(result['seller_tier'], 'Unknown tier')
    }), 200


def _notify_admins_of_kyc(seller_name, seller_phone):
    """
    Private helper — notifies all admin accounts
    when a new KYC submission arrives.
    """
    from app.services.sms import send_sms
    from app import mysql

    cursor = mysql.connection.cursor()
    cursor.execute(
        "SELECT phone_number FROM users WHERE role = 'admin' AND is_active = TRUE"
    )
    admins = cursor.fetchall()
    cursor.close()

    for admin in admins:
        send_sms(
            admin['phone_number'],
            f"Zuno KYC: New verification submission from "
            f"{seller_name} ({seller_phone}). "
            f"Log in to review at /api/admin/kyc/pending"
        )

# ══════════════════════════════════════════════════════════════
# PRIVATE HELPER FUNCTION
# ══════════════════════════════════════════════════════════════

def _hash_otp(phone, code):
    """Codes are stored as HMAC(secret, phone:code), never in plain text."""
    key = (os.getenv('JWT_SECRET_KEY') or 'dev').encode()
    return hmac.new(key, f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def _generate_and_send_otp(phone_number):
    """
    Create a fresh 6-digit code (CSPRNG), store only its hash, SMS it.
    Returns True when sent, False on SMS failure, 'COOLDOWN' if one was sent
    in the last 60 seconds.
    """
    phone = normalize_phone(phone_number) or phone_number
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT last_sent_at FROM otp_verifications WHERE phone_number = %s", (phone,))
    prev = cursor.fetchone()
    if prev and prev.get('last_sent_at') and \
            datetime.now() - prev['last_sent_at'] < timedelta(seconds=OTP_COOLDOWN_SECONDS):
        mysql.connection.commit()
        cursor.close()
        return 'COOLDOWN'

    otp_code = f"{secrets.randbelow(900000) + 100000}"
    now = datetime.now()
    cursor.execute("""
        INSERT INTO otp_verifications (phone_number, otp_code, expires_at, attempts, last_sent_at)
        VALUES (%s, %s, %s, 0, %s)
        ON DUPLICATE KEY UPDATE otp_code = VALUES(otp_code), expires_at = VALUES(expires_at),
                                attempts = 0, verified_at = NULL, last_sent_at = VALUES(last_sent_at)
    """, (phone, _hash_otp(phone, otp_code), now + timedelta(minutes=10), now))
    mysql.connection.commit()
    cursor.close()
    return send_otp(phone, otp_code)
