# app/utils/auth.py
#
# Who is calling, and what are they allowed to do on THIS transaction/dispute?
#
# Rule: a phone number typed into a request body is NEVER proof of identity.
# Identity comes from the JWT; the relationship to the deal comes from the
# database (transactions.seller_id / transactions.buyer_user_id).

from flask_jwt_extended import get_jwt_identity
from app import mysql
from app.utils.validators import same_phone


def current_user():
    """Full user row for the logged-in caller (active accounts only), or None."""
    user_id = get_jwt_identity()
    if not user_id:
        return None
    cursor = mysql.connection.cursor()
    cursor.execute("""
        SELECT id, full_name, phone_number, email, role, is_active,
               is_verified, phone_verified, seller_tier
        FROM users WHERE id = %s
    """, (user_id,))
    user = cursor.fetchone()
    cursor.close()
    if not user or not user['is_active']:
        return None
    return user


def party_role(txn, user):
    """
    How is `user` related to this transaction row?
    Returns 'admin', 'seller', 'buyer', or None (a stranger).

    Buyer match: the transaction is bound to the buyer's user id. Older rows
    created before buyer accounts existed have buyer_user_id NULL; for those we
    accept a user whose PHONE-VERIFIED account number equals buyer_phone.
    """
    if not user:
        return None
    if user['role'] == 'admin':
        return 'admin'
    if txn['seller_id'] == user['id']:
        return 'seller'
    if txn.get('buyer_user_id') is not None:
        return 'buyer' if txn['buyer_user_id'] == user['id'] else None
    if user.get('phone_verified') and same_phone(txn['buyer_phone'], user['phone_number']):
        return 'buyer'
    return None
