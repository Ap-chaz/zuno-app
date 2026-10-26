# app/utils/helpers.py
#
# Shared utility functions used across the entire Zuno backend.
# The principle here is DRY — Don't Repeat Yourself.
# Instead of writing the same logic in 10 different places,
# we write it once here and import it wherever needed.

import secrets
import string
import os
import math
from datetime import datetime
from app import mysql


def generate_transaction_id():
    """
    Generates a unique Zuno transaction ID.

    Format: ZNO-YYYYMMDD-XXXXX
    Example: ZNO-20260601-K3P9A

    Why this format?
    - ZNO prefix identifies it as a Zuno transaction
    - Date part makes it human-readable and sortable
    - Random 5-char suffix prevents collisions
    - Easy to read aloud over the phone for support calls
    """
    date_part = datetime.now().strftime('%Y%m%d')
    # secrets (not random) so IDs cannot be predicted; 8 chars = ~2.8 trillion options
    alphabet = string.ascii_uppercase + string.digits
    random_part = ''.join(secrets.choice(alphabet) for _ in range(8))
    return f"ZNO-{date_part}-{random_part}"


def calculate_fees(amount):
    """
    Calculates the financial breakdown for a Zuno transaction in WHOLE shillings.

    M-Pesa only moves whole shillings, so every number here is an integer.
    That way what we store, what we show, what Safaricom charges and what
    the callback reports are always identical.

    Rules:
      total_fee       = round(amount * PLATFORM_FEE_PERCENT / 100)
      buyer_fee_share = ceil(total_fee * BUYER_FEE_SHARE_PERCENT / 100)
      seller_fee_share = total_fee - buyer_fee_share
      buyer_pays      = amount + buyer_fee_share
      seller_receives = amount - seller_fee_share

    Example - Ksh 3,000 at 2.5% split 50/50:
      total_fee 75, buyer share 38, seller share 37
      buyer pays 3,038, seller receives 2,963, Zuno keeps 75
    """
    fee_percent = float(os.getenv('PLATFORM_FEE_PERCENT', 2.5))
    buyer_share_percent = float(os.getenv('BUYER_FEE_SHARE_PERCENT', 50))

    amount = int(round(float(amount)))

    total_fee = int(math.floor(amount * fee_percent / 100 + 0.5))
    buyer_fee = int(math.ceil(total_fee * buyer_share_percent / 100))
    seller_fee = total_fee - buyer_fee

    return {
        'amount': amount,
        'total_fee': total_fee,
        'buyer_fee_share': buyer_fee,
        'seller_fee_share': seller_fee,
        'buyer_pays': amount + buyer_fee,
        'seller_receives': amount - seller_fee
    }


def tier_limit(tier):
    """
    Maximum deal size (KES) for a seller tier. Configurable via env:
      TIER0_MAX_KES (unverified)        default 1,000
      TIER1_MAX_KES (KYC approved)      default 50,000
      TIER2_MAX_KES (business verified) default 1,000,000
    """
    limits = {
        0: int(os.getenv('TIER0_MAX_KES', 1000)),
        1: int(os.getenv('TIER1_MAX_KES', 50000)),
        2: int(os.getenv('TIER2_MAX_KES', 1000000)),
    }
    return limits.get(int(tier or 0), limits[0])


def log_transaction_action(transaction_id, action, performed_by,
                            old_value=None, new_value=None,
                            details=None, ip_address=None):
    """
    Records every action taken on every transaction to the audit log.

    WHY THIS MATTERS:
    In a financial platform, you need a complete record of everything
    that happened and when. If a seller claims "I never got paid" or
    a buyer says "I never confirmed delivery", this log is your proof.

    This is also required for regulatory compliance — financial
    regulators require transaction audit trails.

    Call this function EVERY time a transaction status changes.
    No exceptions. Every. Single. Time.

    Args:
        transaction_id : which transaction this is about
        action         : what happened  e.g. "STATUS_CHANGED"
        performed_by   : who did it     e.g. "0712345678" or "SYSTEM"
        old_value      : what it was before  e.g. "FUNDED"
        new_value      : what it is now      e.g. "SHIPPED"
        details        : any extra context
        ip_address     : where the request came from
    """
    cursor = mysql.connection.cursor()
    cursor.execute("""
        INSERT INTO transaction_logs
            (transaction_id, action, performed_by,
             old_value, new_value, details, ip_address)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """, (transaction_id, action, performed_by,
          old_value, new_value, details, ip_address))
    mysql.connection.commit()
    cursor.close()


def format_phone_for_mpesa(phone):
    """
    Converts any Kenyan phone number format to 254XXXXXXXXX
    which is the format Safaricom's M-Pesa API requires.

    Handles all common formats Kenyan users type:
        0712345678    → 254712345678
        +254712345678 → 254712345678
        254712345678  → 254712345678  (already correct)

    Returns None if the format is completely unrecognizable.
    """
    if not phone:
        return None

    phone = str(phone).strip().replace(' ', '').replace('-', '')

    if phone.startswith('+254'):
        return phone[1:]          # remove the + sign
    elif phone.startswith('0'):
        return '254' + phone[1:]  # replace leading 0 with 254
    elif phone.startswith('254') and len(phone) == 12:
        return phone              # already in correct format

    return None  # unrecognized — caller must handle this


def log_security_event(event_type, details,
                        ip_address=None, user_phone=None):
    """
    Records suspicious or security-relevant activity.

    Used for:
    - Failed payment link signature verifications (possible fraud)
    - Rate limit violations (possible bot/attack)
    - Access attempts on non-existent transactions
    - Failed login attempts

    This table is reviewed regularly to detect fraud patterns.
    """
    cursor = mysql.connection.cursor()
    cursor.execute("""
        INSERT INTO security_logs
            (event_type, details, ip_address, user_phone)
        VALUES (%s, %s, %s, %s)
    """, (event_type, details, ip_address, user_phone))
    mysql.connection.commit()
    cursor.close()