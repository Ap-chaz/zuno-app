"""
GET   /api/notifications?page=&pageSize=   -> { data: [...], total, unread }
PATCH /api/notifications/<id>              -> mark one read
POST  /api/notifications/mark-all-read
POST  /api/notifications/send              -> admin only: announce to every active user
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app import mysql
from app.utils.auth import current_user
from app.utils.errors import err

notifications_bp = Blueprint('notifications', __name__)


def _shape(r):
    return {
        'id': str(r['id']), 'title': r['title'], 'body': r['body'], 'type': r['type'],
        'read': bool(r['is_read']), 'createdAt': r['created_at'].isoformat(),
        'relatedId': r['related_id'],
    }


@notifications_bp.route('', methods=['GET'])
@jwt_required()
def list_notifications():
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')
    try:
        page = max(1, int(request.args.get('page', 1)))
        size = min(100, max(1, int(request.args.get('pageSize', 50))))
    except ValueError:
        page, size = 1, 50
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT COUNT(*) AS n, COALESCE(SUM(is_read = 0), 0) AS u "
                   "FROM notifications WHERE user_id = %s", (user['id'],))
    counts = cursor.fetchone()
    cursor.execute("""
        SELECT * FROM notifications WHERE user_id = %s
        ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s
    """, (user['id'], size, (page - 1) * size))
    rows = cursor.fetchall()
    cursor.close()
    return jsonify({'data': [_shape(r) for r in rows], 'total': int(counts['n']),
                    'unread': int(counts['u'])}), 200


@notifications_bp.route('/<int:notification_id>', methods=['PATCH'])
@jwt_required()
def mark_read(notification_id):
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')
    cursor = mysql.connection.cursor()
    cursor.execute("UPDATE notifications SET is_read = 1 WHERE id = %s AND user_id = %s",
                   (notification_id, user['id']))
    mysql.connection.commit()
    cursor.close()
    return jsonify({'ok': True}), 200


@notifications_bp.route('/mark-all-read', methods=['POST'])
@jwt_required()
def mark_all_read():
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')
    cursor = mysql.connection.cursor()
    cursor.execute("UPDATE notifications SET is_read = 1 WHERE user_id = %s AND is_read = 0",
                   (user['id'],))
    mysql.connection.commit()
    cursor.close()
    return jsonify({'ok': True}), 200


@notifications_bp.route('/send', methods=['POST'])
@jwt_required()
def send_announcement():
    user = current_user()
    if not user:
        return err('Account not found or suspended', 401, 'UNAUTHENTICATED')
    if user['role'] != 'admin':
        return err('Admin access required', 403, 'FORBIDDEN')
    data = request.get_json(silent=True) or {}
    title = str(data.get('title', '')).strip()
    body = str(data.get('body', '')).strip()
    ntype = data.get('type') if data.get('type') in ('system', 'transaction', 'dispute', 'kyc') else 'system'
    if not title or not body:
        return err('Title and message are required.', 400, 'VALIDATION')
    cursor = mysql.connection.cursor()
    cursor.execute("""
        INSERT INTO notifications (user_id, type, title, body)
        SELECT id, %s, %s, %s FROM users WHERE is_active = 1
    """, (ntype, title[:120], body[:400]))
    sent = cursor.rowcount
    mysql.connection.commit()
    cursor.close()
    return jsonify({'id': 'broadcast', 'title': title, 'body': body, 'type': ntype,
                    'read': False, 'createdAt': __import__('datetime').datetime.now().isoformat(),
                    'sent_to': sent}), 201
