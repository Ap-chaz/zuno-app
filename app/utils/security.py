# app/utils/security.py
#
# Cryptographic security for the Zuno platform.
#
# The most important thing this file does:
# Every payment link Zuno generates contains a CRYPTOGRAPHIC SIGNATURE.
# This signature is mathematically tied to the transaction details
# using a secret key that only Zuno's server knows.
#
# Why does this matter?
# Without this, a con man could generate fake payment links that
# look identical to Zuno links but send money to his account.
# With this, any fake link fails signature verification instantly
# and is rejected before the buyer ever sees a payment page.
#
# This is the same technology banks use to secure transactions.

import hmac
import hashlib
import os
from collections import defaultdict
from datetime import datetime, timedelta
from flask import request, jsonify

# Our secret signing key — loaded from .env
# If this key is ever exposed, regenerate it immediately
def _signing_secret():
    """Read at call time (after .env is loaded) and refuse to sign with an empty key."""
    secret = os.getenv('LINK_SIGNING_SECRET', '')
    if len(secret) < 16:
        raise RuntimeError(
            'LINK_SIGNING_SECRET is missing or too short (min 16 chars). '
            'Refusing to sign payment links with a weak key.'
        )
    return secret

# In-memory store for rate limiting
# Maps IP address → list of request timestamps
_request_log = defaultdict(list)
_logged_blocks = {}


def generate_link_signature(transaction_id, seller_id, amount):
    """
    Creates a cryptographic signature for a Zuno payment link.

    HOW IT WORKS:
    1. We combine transaction details into a single string
    2. We run it through HMAC-SHA256 with our secret key
    3. The output is a unique 32-character hex string

    The critical property of HMAC-SHA256:
    Without knowing SIGNING_SECRET, it is computationally
    impossible to generate a valid signature — even if you
    know the algorithm and the inputs.

    So a con man knows the format is:
    /pay/ZNO-20260601-A3K9P?sig=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
    But he CANNOT generate a valid XXXXXXXX without our secret key.
    Every fake link he creates will fail verification.
    """
    message = f"{transaction_id}:{seller_id}:{amount}"

    signature = hmac.new(
        _signing_secret().encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    # Return first 32 characters — still 128 bits of security
    # Short enough for a clean URL, long enough to be unguessable
    return signature[:32]


def verify_link_signature(transaction_id, seller_id, amount, provided_sig):
    """
    Verifies that a payment link signature is genuine.

    Called EVERY time a buyer opens a payment link.
    If the signature doesn't match → reject immediately.

    Uses hmac.compare_digest() instead of ==
    WHY: Regular == comparison can leak timing information.
    An attacker can measure tiny differences in how long == takes
    to guess the signature one character at a time.
    compare_digest() always takes the same time, preventing this.

    Returns:
        (True, None)           if signature is valid
        (False, error_message) if signature is invalid
    """
    if not provided_sig:
        return False, "Missing security token — this link is incomplete"

    expected = generate_link_signature(transaction_id, seller_id, amount)

    if not hmac.compare_digest(expected, str(provided_sig)):
        return False, "Invalid security token — this link may be fraudulent"

    return True, None


def build_payment_link(transaction_id, seller_id, amount):
    """
    Builds a complete, cryptographically signed Zuno payment link.

    THIS IS THE ONLY FUNCTION THAT SHOULD CREATE PAYMENT LINKS.
    Never build payment links manually anywhere else in the codebase.

    Output example:
    https://zuno.co.ke/pay/ZNO-20260601-A3K9P?sig=a3f9k2p8x7q1b4d8c2e5f6g7h8i9j0k1
    """
    # The pay page lives on the FRONTEND (React app), not on the API host.
    base = os.getenv('FRONTEND_URL', 'http://localhost:3000').rstrip('/')
    sig = generate_link_signature(transaction_id, seller_id, amount)
    return f"{base}/pay/{transaction_id}?sig={sig}"


def is_rate_limited(key, max_requests=20, window_minutes=1):
    """
    Sliding-window limiter. `key` should combine the client IP and the endpoint
    so one busy endpoint cannot lock a user out of everything else.

    NOTE: state is in-process memory. That is fine for one web worker; with
    several workers or instances move this to Redis (Flask-Limiter + REDIS_URL).
    """
    now = datetime.now()
    cutoff = now - timedelta(minutes=window_minutes)

    _request_log[key] = [t for t in _request_log[key] if t > cutoff]

    if len(_request_log[key]) >= max_requests:
        return True

    _request_log[key].append(now)
    return False


def client_ip():
    """
    Real client IP. ProxyFix (applied in create_app) makes request.remote_addr
    the original client when running behind Railway/Cloudflare.
    """
    return request.remote_addr or 'unknown'


def check_rate_limit(max_requests=20, window_minutes=1, scope=None):
    """
    Call at the top of sensitive routes. Returns a 429 response when limited,
    otherwise None.

        rate_limit_error = check_rate_limit(5, 1, scope='login')
        if rate_limit_error:
            return rate_limit_error
    """
    endpoint = scope or request.endpoint or 'global'
    key = f"{client_ip()}:{endpoint}"
    if is_rate_limited(key, max_requests, window_minutes):
        # Log only the first block in each window, not every blocked request
        if key not in _logged_blocks or \
                (datetime.now() - _logged_blocks[key]) > timedelta(minutes=window_minutes):
            _logged_blocks[key] = datetime.now()
            try:
                from app.utils.helpers import log_security_event
                log_security_event(
                    event_type='RATE_LIMIT_EXCEEDED',
                    details=f"{key} exceeded rate limit",
                    ip_address=client_ip()
                )
            except Exception:
                pass
        return jsonify({
            'error': 'Too many requests. Please slow down.',
            'message': 'Too many requests. Please slow down.',
            'code': 'RATE_LIMITED',
            'status': 429
        }), 429

    return None


def add_security_headers(response):
    """
    Adds security headers to every HTTP response.

    These headers protect users from common web attacks:

    X-Content-Type-Options: Stops browsers from guessing
    content type — prevents MIME sniffing attacks.

    X-Frame-Options: Prevents your pages from being loaded
    in an iframe — stops clickjacking attacks.

    X-XSS-Protection: Enables browser's built-in XSS filter.

    Strict-Transport-Security: Forces HTTPS — prevents
    downgrade attacks. Only active in production.

    Content-Security-Policy: Controls what resources the
    browser can load — prevents XSS and data injection.
    """
    # Prevent MIME type sniffing
    response.headers['X-Content-Type-Options'] = 'nosniff'

    # Prevent clickjacking
    response.headers['X-Frame-Options'] = 'DENY'

    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"

    # Remove server version info (don't tell attackers
    # what software we are running)
    response.headers['Server'] = 'Zuno'

    # Cache control for API responses
    # API responses should never be cached by browsers
    response.headers['Cache-Control'] = (
        'no-store, no-cache, must-revalidate, max-age=0'
    )

    return response