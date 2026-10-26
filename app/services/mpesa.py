# app/services/mpesa.py
#
# Safaricom Daraja API Integration for Zuno.
#
# This file handles ALL communication with Safaricom's M-Pesa API.
# It has two main functions:
#
# 1. STK PUSH — Send a payment request to buyer's phone
#    Buyer sees M-Pesa popup, enters PIN, pays.
#    Safaricom calls our callback URL to confirm.
#
# 2. B2C PAYMENT — Send money to seller's M-Pesa
#    Called after buyer approves the transaction.
#    Money goes directly to seller's M-Pesa number.
#
# HOW DARAJA AUTHENTICATION WORKS:
# Every API call needs a temporary access token.
# We get this token by sending our Consumer Key + Secret
# to Safaricom. The token expires after 1 hour.
# We request a fresh one for each payment.

import requests
import base64
import os
import time
from datetime import datetime

# Never let a slow Safaricom call hang a worker forever
HTTP_TIMEOUT = 20

# OAuth tokens last ~1h; reuse for 50 minutes instead of fetching one per call
_token_cache = {'token': None, 'expires_at': 0}


def get_access_token():
    """
    Gets a temporary access token from Safaricom.

    Every M-Pesa API call requires this token.
    It works like a temporary password that expires
    after 1 hour.

    HOW IT WORKS:
    1. We combine Consumer Key and Consumer Secret
    2. We encode them in Base64 format
    3. We send them to Safaricom's OAuth endpoint
    4. Safaricom returns a token we use in API calls

    Returns the access token string or None if it fails.
    """
    if _token_cache['token'] and time.time() < _token_cache['expires_at']:
        return _token_cache['token']

    consumer_key = os.getenv('MPESA_CONSUMER_KEY')
    consumer_secret = os.getenv('MPESA_CONSUMER_SECRET')
    environment = os.getenv('MPESA_ENVIRONMENT', 'sandbox')

    # Choose the right URL based on environment
    if environment == 'production':
        url = 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    else:
        url = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'

    # Encode credentials in Base64
    # This is the format Safaricom requires
    credentials = f"{consumer_key}:{consumer_secret}"
    encoded = base64.b64encode(credentials.encode()).decode()

    try:
        response = requests.get(
            url,
            headers={'Authorization': f'Basic {encoded}'},
            timeout=HTTP_TIMEOUT
        )
        result = response.json()
        token = result.get('access_token')

        if not token:
            print(f"[MPESA] Failed to get token: {result}")
            return None

        _token_cache['token'] = token
        _token_cache['expires_at'] = time.time() + 50 * 60
        print("[MPESA] Access token obtained successfully")
        return token

    except Exception as e:
        print(f"[MPESA] Token error: {str(e)}")
        return None


def generate_password():
    """
    Generates the M-Pesa STK Push password.

    Safaricom requires a password built from:
    Shortcode + Passkey + Current Timestamp

    All combined and encoded in Base64.
    This password is only valid for the exact timestamp used.
    """
    shortcode = os.getenv('MPESA_SHORTCODE')
    passkey = os.getenv('MPESA_PASSKEY')

    # Timestamp format required by Safaricom: YYYYMMDDHHmmss
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')

    # Combine and encode
    raw = f"{shortcode}{passkey}{timestamp}"
    password = base64.b64encode(raw.encode()).decode()

    return password, timestamp


def initiate_stk_push(phone_number, amount, transaction_id, description):
    """
    Sends a payment request (STK Push) to the buyer's phone.

    STK Push = SIM Toolkit Push
    This makes a payment popup appear on the buyer's M-Pesa
    app asking them to enter their PIN to pay.

    FLOW:
    1. We call this function with buyer's phone and amount
    2. Safaricom sends a popup to buyer's phone
    3. Buyer enters their M-Pesa PIN
    4. Safaricom processes the payment
    5. Safaricom calls our callback URL with the result
    6. Our callback handler (in payments.py) processes the result

    Args:
        phone_number   : buyer's phone e.g. "0712345678"
        amount         : amount in KES e.g. 3037.50
        transaction_id : our Zuno transaction ID
        description    : what shows on buyer's M-Pesa prompt

    Returns dict with:
        success: True/False
        checkout_request_id: ID to track this payment
        message: description of what happened
    """
    # Get access token first
    token = get_access_token()
    if not token:
        return {
            'success': False,
            'message': 'Failed to connect to M-Pesa. Please try again.'
        }

    # Format phone number to 254XXXXXXXXX
    phone = _format_phone(phone_number)
    if not phone:
        return {
            'success': False,
            'message': 'Invalid phone number format.'
        }

    shortcode = os.getenv('MPESA_SHORTCODE')
    callback_url = stk_callback_url()
    environment = os.getenv('MPESA_ENVIRONMENT', 'sandbox')
    # Sandbox only: Safaricom's simulator can't reach real phones, so tests use their
    # fixed test line (254708374149). Never applied in production.
    if environment != 'production' and os.getenv('MPESA_SANDBOX_PHONE'):
        phone = _format_phone(os.getenv('MPESA_SANDBOX_PHONE')) or phone
    password, timestamp = generate_password()

    # Money is stored in whole shillings (see calculate_fees), so this is exact.
    amount_int = int(amount)
    if amount_int != float(amount):
        return {'success': False, 'message': 'Amount must be whole shillings.'}

    # API endpoint
    if environment == 'production':
        url = 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
    else:
        url = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest'

    # Build the request payload
    payload = {
        # Business shortcode receiving the payment
        'BusinessShortCode': shortcode,

        # Generated password
        'Password': password,

        # Current timestamp
        'Timestamp': timestamp,

        # Always "CustomerPayBillOnline" for STK Push
        'TransactionType': 'CustomerPayBillOnline',

        # Amount buyer will pay
        'Amount': amount_int,

        # Buyer's phone number
        'PartyA': phone,

        # Your business shortcode (same as BusinessShortCode)
        'PartyB': shortcode,

        # Phone to receive confirmation SMS (buyer's phone)
        'PhoneNumber': phone,

        # Where Safaricom sends the payment result
        'CallBackURL': callback_url,

        # Reference shown on buyer's M-Pesa
        # Keep it short — max 12 characters
        'AccountReference': f"ZNO{transaction_id[-8:]}",

        # Description shown on buyer's phone
        'TransactionDesc': description[:20]
    }

    try:
        response = requests.post(
            url,
            json=payload,
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json'
            },
            timeout=HTTP_TIMEOUT
        )

        result = response.json()
        print(f"[MPESA STK] Response: {result}")

        # ResponseCode "0" means the push was sent successfully
        # It does NOT mean the buyer has paid yet
        if result.get('ResponseCode') == '0':
            return {
                'success': True,
                'checkout_request_id': result.get('CheckoutRequestID'),
                'message': 'Payment request sent to your phone. '
                           'Please enter your M-Pesa PIN.'
            }
        else:
            return {
                'success': False,
                'message': result.get('ResponseDescription',
                                      'Payment request failed.')
            }

    except Exception as e:
        print(f"[MPESA STK ERROR] {str(e)}")
        return {
            'success': False,
            'message': 'M-Pesa service temporarily unavailable.'
        }


def send_b2c_payment(phone_number, amount, transaction_id, remarks,
                     originator_conversation_id=None):
    """
    Sends money to an M-Pesa number (B2C BusinessPayment).
    Used for seller payouts AND buyer refunds - `phone_number` is whoever
    should receive the money, decided by the payout row, not guessed here.

    Returns dict:
        success: True if Safaricom ACCEPTED the request (result comes later by callback)
        conversation_id / originator_conversation_id: to match the result callback
        retryable: True only when we are SURE nothing was sent (no token, bad
                   network before the request left, Safaricom 5xx/busy) so the
                   caller may safely queue it again.
    """
    token = get_access_token()
    if not token:
        return {'success': False, 'retryable': True,
                'message': 'Failed to connect to M-Pesa.'}

    phone = _format_phone(phone_number)
    if not phone:
        return {'success': False, 'retryable': False,
                'message': 'Invalid phone number.'}

    environment = os.getenv('MPESA_ENVIRONMENT', 'sandbox')
    # Sandbox only: Safaricom's simulator can only pay its own test line.
    if environment != 'production' and os.getenv('MPESA_SANDBOX_PHONE'):
        phone = _format_phone(os.getenv('MPESA_SANDBOX_PHONE')) or phone

    # Payouts can come from a different shortcode than payments (sandbox: 600982).
    shortcode = os.getenv('MPESA_B2C_SHORTCODE') or os.getenv('MPESA_SHORTCODE')
    initiator = os.getenv('MPESA_B2C_INITIATOR')
    security_credential = os.getenv('MPESA_B2C_SECURITY_CREDENTIAL')

    amount_int = int(amount)
    if amount_int != float(amount) or amount_int <= 0:
        return {'success': False, 'retryable': False,
                'message': 'Payout amount must be a positive whole number.'}

    if environment == 'production':
        url = 'https://api.safaricom.co.ke/mpesa/b2c/v3/paymentrequest'
    else:
        url = 'https://sandbox.safaricom.co.ke/mpesa/b2c/v3/paymentrequest'

    payload = {
        'OriginatorConversationID': originator_conversation_id,
        'InitiatorName': initiator,
        'SecurityCredential': security_credential,
        'CommandID': 'BusinessPayment',
        'Amount': amount_int,
        'PartyA': shortcode,
        'PartyB': phone,
        'Remarks': remarks[:100],
        'ResultURL': b2c_result_url(),
        'QueueTimeOutURL': b2c_timeout_url(),
        'Occasion': f"Zuno {transaction_id}"[:100]
    }

    try:
        response = requests.post(
            url,
            json=payload,
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json'
            },
            timeout=HTTP_TIMEOUT
        )
    except requests.exceptions.ConnectTimeout:
        # Request never reached Safaricom
        return {'success': False, 'retryable': True,
                'message': 'Could not reach M-Pesa.'}
    except requests.exceptions.ConnectionError:
        return {'success': False, 'retryable': True,
                'message': 'Could not reach M-Pesa.'}
    except requests.exceptions.RequestException as e:
        # Read timeout etc: the request MAY have been processed. Do not auto-retry.
        print(f"[MPESA B2C ERROR] {str(e)}")
        return {'success': False, 'retryable': False, 'uncertain': True,
                'message': 'M-Pesa did not confirm the request. Check before retrying.'}

    try:
        result = response.json()
    except ValueError:
        result = {}
    print(f"[MPESA B2C] Response: {result}")

    if result.get('ResponseCode') == '0':
        return {
            'success': True,
            'conversation_id': result.get('ConversationID'),
            'originator_conversation_id': result.get('OriginatorConversationID')
                                           or originator_conversation_id,
            'message': f"Payout of Ksh {amount_int} accepted by M-Pesa"
        }

    if response.status_code >= 500:
        return {'success': False, 'retryable': False, 'uncertain': True,
                'message': 'M-Pesa server error. Check before retrying.'}

    return {'success': False, 'retryable': False,
            'message': result.get('ResponseDescription')
                       or result.get('errorMessage') or 'Payout rejected.'}


def _base_callback():
    """Public base of the API, e.g. https://api.zuno.co.ke/api/payments"""
    base = os.getenv('MPESA_CALLBACK_BASE') or os.getenv('BASE_URL', 'http://localhost:5000')
    base = base.rstrip('/')
    return base if base.endswith('/api/payments') else f"{base}/api/payments"


def _callback_secret():
    secret = os.getenv('MPESA_CALLBACK_SECRET', '')
    if len(secret) < 16:
        raise RuntimeError('MPESA_CALLBACK_SECRET is missing or too short (min 16 chars).')
    return secret


def stk_callback_url():
    return f"{_base_callback()}/hook/stk/{_callback_secret()}"


def b2c_result_url():
    return f"{_base_callback()}/hook/b2c/result/{_callback_secret()}"


def b2c_timeout_url():
    return f"{_base_callback()}/hook/b2c/timeout/{_callback_secret()}"


def _format_phone(phone):
    """Any Kenyan format -> 254XXXXXXXXX (what Daraja wants), or None."""
    from app.utils.validators import normalize_phone
    normalized = normalize_phone(phone)
    return normalized[1:] if normalized else None


def query_stk_status(checkout_request_id):
    """
    Ask Safaricom what happened to an STK push (used when the callback is late or lost).

    Returns {'state': 'PAID' | 'FAILED' | 'PENDING' | 'UNKNOWN', 'reason': str}.
    UNKNOWN means we could not find out; the caller must keep waiting, never guess.
    """
    token = get_access_token()
    if not token:
        return {'state': 'UNKNOWN', 'reason': 'no token'}
    password, timestamp = generate_password()
    environment = os.getenv('MPESA_ENVIRONMENT', 'sandbox')
    host = 'api' if environment == 'production' else 'sandbox'
    try:
        response = requests.post(
            f'https://{host}.safaricom.co.ke/mpesa/stkpushquery/v1/query',
            json={'BusinessShortCode': os.getenv('MPESA_SHORTCODE'), 'Password': password,
                  'Timestamp': timestamp, 'CheckoutRequestID': checkout_request_id},
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
            timeout=HTTP_TIMEOUT)
        result = response.json()
    except (requests.RequestException, ValueError) as e:
        return {'state': 'UNKNOWN', 'reason': str(e)}
    print(f"[MPESA STK QUERY] {result}")
    # Safaricom answers an error body while the push is still being processed.
    if result.get('errorCode'):
        return {'state': 'PENDING' if 'processed' in str(result.get('errorMessage', '')).lower()
                else 'UNKNOWN', 'reason': str(result.get('errorMessage', ''))}
    try:
        code = int(result.get('ResultCode'))
    except (TypeError, ValueError):
        return {'state': 'UNKNOWN', 'reason': 'unreadable response'}
    desc = str(result.get('ResultDesc', ''))
    return {'state': 'PAID' if code == 0 else 'FAILED', 'reason': desc}
