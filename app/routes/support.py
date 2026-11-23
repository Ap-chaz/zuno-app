"""
Support tickets endpoints for Zuno Admin & contact form:
GET  /api/support/tickets            -> admin: list all tickets
POST /api/support/tickets            -> public/authenticated: submit a support ticket
POST /api/support/tickets/<id>/resolve -> admin: mark ticket resolved
"""
from datetime import datetime
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app import mysql
from app.routes.admin import require_admin
from app.utils.errors import err

support_bp = Blueprint('support', __name__)


def _shape(r):
    return {
        'id': str(r['id']),
        'name': r['name'],
        'email': r['email'],
        'subject': r['subject'],
        'message': r['message'],
        'status': r['status'],
        'createdAt': r['created_at'].isoformat() if hasattr(r['created_at'], 'isoformat') else str(r['created_at']),
    }


@support_bp.route('/tickets', methods=['GET'])
@jwt_required()
@require_admin
def list_tickets():
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT * FROM support_tickets ORDER BY created_at DESC, id DESC LIMIT 200")
    rows = cursor.fetchall()
    cursor.close()
    return jsonify([_shape(r) for r in rows]), 200


@support_bp.route('/tickets', methods=['POST'])
def create_ticket():
    data = request.get_json(silent=True) or {}
    name = str(data.get('name') or '').strip()[:150]
    email = str(data.get('email') or '').strip()[:190]
    subject = str(data.get('subject') or '').strip()[:255]
    message = str(data.get('message') or '').strip()
    if not name or not email or not subject or not message:
        return err('Name, email, subject, and message are required.', 400, 'VALIDATION_ERROR')
    cursor = mysql.connection.cursor()
    cursor.execute("""
        INSERT INTO support_tickets (name, email, subject, message)
        VALUES (%s, %s, %s, %s)
    """, (name, email, subject, message))
    ticket_id = cursor.lastrowid
    mysql.connection.commit()
    cursor.execute("SELECT * FROM support_tickets WHERE id = %s", (ticket_id,))
    row = cursor.fetchone()
    cursor.close()
    return jsonify(_shape(row)), 201


@support_bp.route('/tickets/<int:ticket_id>/resolve', methods=['POST'])
@jwt_required()
@require_admin
def resolve_ticket(ticket_id):
    cursor = mysql.connection.cursor()
    cursor.execute("UPDATE support_tickets SET status = 'resolved', resolved_at = %s WHERE id = %s",
                   (datetime.now(), ticket_id))
    mysql.connection.commit()
    cursor.execute("SELECT * FROM support_tickets WHERE id = %s", (ticket_id,))
    row = cursor.fetchone()
    cursor.close()
    if not row:
        return err('Ticket not found', 404, 'NOT_FOUND')
    return jsonify(_shape(row)), 200
