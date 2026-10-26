"""
In-app notifications (the bell). Best-effort: a failure here must never break a payment,
a dispute or a delivery, so every call swallows its own errors.

Call these AFTER the caller's own commit, because each insert commits itself.
"""
import logging

from app import mysql

log = logging.getLogger(__name__)


def notify_user(user_id, title, body, type='transaction', related_id=None):
    if not user_id:
        return
    try:
        cursor = mysql.connection.cursor()
        cursor.execute("""
            INSERT INTO notifications (user_id, type, title, body, related_id)
            VALUES (%s, %s, %s, %s, %s)
        """, (user_id, type, str(title)[:120], str(body)[:400],
              str(related_id) if related_id is not None else None))
        mysql.connection.commit()
        cursor.close()
    except Exception:
        log.exception('notification insert failed')


def notify_phone(phone, title, body, type='transaction', related_id=None):
    """Same, for callers that only have a phone number."""
    if not phone:
        return
    try:
        cursor = mysql.connection.cursor()
        cursor.execute("SELECT id FROM users WHERE phone_number = %s AND is_active = 1 LIMIT 1", (phone,))
        row = cursor.fetchone()
        cursor.close()
        if row:
            notify_user(row['id'], title, body, type, related_id)
    except Exception:
        log.exception('notification lookup failed')
