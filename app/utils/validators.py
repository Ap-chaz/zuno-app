# app/utils/validators.py
#
# Input validation for all data coming into the Zuno API.
#
# GOLDEN RULE OF BACKEND SECURITY:
# Never trust data from the frontend. Ever.
# Even if your frontend validates the form perfectly,
# someone can bypass it and send raw requests to your API.
# The backend must ALWAYS validate independently.
#
# Every function here returns a tuple: (is_valid, error_message)
# If valid:   (True, None)
# If invalid: (False, "human readable error message")

import re


_PHONE_RE = re.compile(r'^(?:\+?254|0)([17]\d{8})$')


def normalize_phone(phone):
    """
    Converts any common Kenyan mobile format to ONE canonical form: +254XXXXXXXXX.

        0712345678     -> +254712345678
        +254712345678  -> +254712345678
        254 712 345678 -> +254712345678

    Returns None if the number is not a valid Kenyan mobile number.
    Every place that stores or compares a phone number must use this,
    otherwise "0712..." and "+254712..." look like two different people.
    """
    if phone is None:
        return None
    cleaned = re.sub(r'[\s\-()]', '', str(phone))
    match = _PHONE_RE.match(cleaned)
    if not match:
        return None
    return '+254' + match.group(1)


def same_phone(a, b):
    """True if two phone numbers are the same person's number."""
    na, nb = normalize_phone(a), normalize_phone(b)
    return na is not None and na == nb


def validate_phone(phone):
    """
    Validates a Kenyan mobile phone number.
    Accepts 07XXXXXXXX, 01XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX (spaces allowed).
    Use normalize_phone() afterwards to get the canonical stored form.
    """
    if not phone:
        return False, "Phone number is required"

    if normalize_phone(phone) is None:
        return False, "Enter a valid Kenyan phone number e.g. 0712345678"

    return True, None


def validate_amount(amount):
    """
    Validates a transaction amount.
    Must be a number between Ksh 100 and Ksh 1,000,000.

    Why a minimum of Ksh 100?
    Below this, our fee becomes negligible and not worth
    the operational overhead of running an escrow.

    Why a maximum of Ksh 1,000,000?
    Very high-value transactions need additional verification.
    We raise this limit as sellers build reputation.
    """
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return False, "Amount must be a valid number"

    if amount != int(amount):
        return False, "Amount must be a whole number of shillings"

    if amount < 100:
        return False, "Minimum transaction amount is Ksh 100"

    if amount > 1_000_000:
        return False, "Maximum transaction amount is Ksh 1,000,000"

    return True, None


def validate_password(password):
    """
    Validates password strength.
    Must be at least 8 characters with letters AND numbers.

    We deliberately keep requirements moderate —
    overly strict password rules cause people to forget
    passwords and lock themselves out.
    """
    if not password or len(password) < 8:
        return False, "Password must be at least 8 characters"

    if not re.search(r'[A-Za-z]', password):
        return False, "Password must contain at least one letter"

    if not re.search(r'\d', password):
        return False, "Password must contain at least one number"

    return True, None


def validate_required_fields(data, fields):
    """
    Checks that all required fields exist in the request data
    and are not empty strings.

    Usage:
        valid, error = validate_required_fields(
            data, ['full_name', 'phone_number', 'password']
        )

    This single function replaces writing 10 individual
    'if not data.get(field)' checks in every route.
    """
    if not data:
        return False, "Request body is empty"

    for field in fields:
        value = data.get(field)
        if value is None or str(value).strip() == '':
            readable = field.replace('_', ' ').title()
            return False, f"{readable} is required"

    return True, None


def validate_delivery_method(method):
    """
    Validates the chosen delivery method.
    Must be one of the four options Zuno supports.
    """
    valid_methods = [
        'PLATFORM_COURIER',   # Zuno arranges delivery
        'SELLER_ARRANGED',    # seller uses own courier
        'BUYER_ARRANGED',     # buyer arranges pickup
        'IN_PERSON'           # meet face to face
    ]

    if method not in valid_methods:
        return False, f"Delivery method must be one of: {', '.join(valid_methods)}"

    return True, None