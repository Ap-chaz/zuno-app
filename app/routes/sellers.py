# app/routes/sellers.py
#
# Public seller directory: lets a buyer find the seller they want to start a deal with.
# Only active, phone-verified sellers are listed; nothing private (phone, email, id docs) is returned.
#
# GET /api/sellers?q=&limit=      -> { sellers: [...], total }
# GET /api/sellers/<id>           -> { seller: {...} }

from flask import Blueprint, request, jsonify
from app import mysql
from app.utils.errors import err
from app.utils.helpers import tier_limit
from app.utils.security import check_rate_limit

sellers_bp = Blueprint('sellers', __name__)

_COLUMNS = """
    u.id, u.full_name, u.business_name, u.bio, u.profile_photo, u.is_verified,
    u.seller_tier, u.created_at,
    COALESCE(r.average_rating, 0)       AS average_rating,
    COALESCE(r.total_ratings, 0)        AS total_ratings,
    COALESCE(r.completed_transactions, 0) AS completed_transactions,
    COALESCE(r.trust_score, 0)          AS trust_score,
    COALESCE(r.trust_level, 'NEW')      AS trust_level,
    COALESCE(r.is_visible_in_search, TRUE) AS visible
"""


def _public(row):
    row['display_name'] = row.get('business_name') or row['full_name']
    row['deal_limit'] = tier_limit(row['seller_tier'])
    row['average_rating'] = float(row['average_rating'])
    row['trust_score'] = float(row['trust_score'])
    row.pop('visible', None)
    if row.get('created_at'):
        row['created_at'] = row['created_at'].isoformat()
    return row


@sellers_bp.route('', methods=['GET'])
def list_sellers():
    rate_limit_error = check_rate_limit(60, 1, scope='sellers_list')
    if rate_limit_error:
        return rate_limit_error

    q = (request.args.get('q') or '').strip()[:60]
    try:
        limit = max(1, min(int(request.args.get('limit', 50)), 100))
    except ValueError:
        limit = 50

    where = ["u.role = 'seller'", "u.is_active = TRUE", "u.phone_verified = TRUE",
             "COALESCE(r.is_visible_in_search, TRUE) = TRUE"]
    params = []
    if q:
        where.append("(u.full_name LIKE %s OR u.business_name LIKE %s)")
        like = f"%{q}%"
        params += [like, like]

    cursor = mysql.connection.cursor()
    cursor.execute(f"""
        SELECT {_COLUMNS}
        FROM users u LEFT JOIN seller_reputation r ON r.seller_id = u.id
        WHERE {' AND '.join(where)}
        ORDER BY u.is_verified DESC, r.trust_score DESC, u.id ASC
        LIMIT %s
    """, (*params, limit))
    rows = [_public(r) for r in cursor.fetchall()]
    mysql.connection.commit()
    cursor.close()
    return jsonify({'sellers': rows, 'total': len(rows)}), 200


@sellers_bp.route('/<int:seller_id>', methods=['GET'])
def get_seller(seller_id):
    cursor = mysql.connection.cursor()
    cursor.execute(f"""
        SELECT {_COLUMNS}
        FROM users u LEFT JOIN seller_reputation r ON r.seller_id = u.id
        WHERE u.id = %s AND u.role = 'seller' AND u.is_active = TRUE AND u.phone_verified = TRUE
    """, (seller_id,))
    row = cursor.fetchone()
    mysql.connection.commit()
    cursor.close()
    if not row:
        return err('Seller not found', 404, 'NOT_FOUND')
    return jsonify({'seller': _public(row)}), 200
