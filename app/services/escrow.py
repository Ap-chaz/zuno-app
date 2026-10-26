# app/services/escrow.py
#
# THE ONLY PLACE THAT DECIDES WHERE ESCROWED MONEY GOES.
#
# Every path that releases, refunds or splits funds calls settle_transaction():
#   - buyer approves            -> RELEASE
#   - inspection window expires -> RELEASE   (scheduler)
#   - admin resolves a dispute  -> RELEASE / REFUND / SPLIT
#   - negotiation offer accepted -> SPLIT
#
# Guarantees:
#   1. Atomic: the status change and the payout rows are one DB transaction.
#   2. Single-shot: the row is locked (SELECT ... FOR UPDATE) and the status
#      is re-checked, so approve + auto-release + double-click can never both win.
#   3. Idempotent at the database level: payouts has UNIQUE(transaction_id,
#      payout_type), so even a bug cannot create a second payout of the same kind.
#   4. Correct recipient: every payout row stores the ACTUAL phone to pay.

from datetime import datetime
from app import mysql
from app.utils.helpers import log_transaction_action
from app.utils.validators import normalize_phone

RELEASE = 'RELEASE'   # all of seller_receives -> seller          => COMPLETED
REFUND = 'REFUND'     # all of buyer_pays      -> buyer           => REFUNDED
SPLIT = 'SPLIT'       # agreed amounts to both                    => RESOLVED

_OUTCOME_STATUS = {RELEASE: 'COMPLETED', REFUND: 'REFUNDED', SPLIT: 'RESOLVED'}


class SettleResult:
    def __init__(self, ok, message, new_status=None, payouts=None, txn=None, code=None):
        self.ok = ok
        self.message = message
        self.new_status = new_status
        self.payouts = payouts or []
        self.txn = txn
        self.code = code

    def __iter__(self):  # allows: ok, message = settle_transaction(...)
        yield self.ok
        yield self.message


def settle_transaction(transaction_id, outcome, from_statuses, triggered_by,
                       split_buyer_amount=None, split_seller_amount=None):
    """
    Move escrowed funds. Returns a SettleResult; never raises for business
    rule failures (wrong state, bad amounts) so callers can return a clean error.

    from_statuses : tuple of statuses the transaction must currently be in.
    """
    if outcome not in _OUTCOME_STATUS:
        return SettleResult(False, f"Unknown outcome '{outcome}'", code='BAD_OUTCOME')

    conn = mysql.connection
    cursor = conn.cursor()
    try:
        # Lock the row. A concurrent settle blocks here, then sees the new status.
        cursor.execute("SELECT * FROM transactions WHERE id = %s FOR UPDATE",
                       (transaction_id,))
        txn = cursor.fetchone()
        if not txn:
            conn.rollback()
            return SettleResult(False, "Transaction not found", code='NOT_FOUND')

        if txn['status'] not in from_statuses:
            conn.rollback()
            return SettleResult(
                False,
                f"Cannot settle: transaction is '{txn['status']}', "
                f"expected one of {', '.join(from_statuses)}.",
                code='BAD_STATE', txn=txn)

        cursor.execute("SELECT phone_number FROM users WHERE id = %s", (txn['seller_id'],))
        seller = cursor.fetchone()
        seller_phone = normalize_phone(seller['phone_number']) if seller else None
        buyer_phone = normalize_phone(txn['buyer_phone'])

        # Work out who gets what
        payouts = []   # (payout_type, amount, phone)
        if outcome == RELEASE:
            payouts.append(('SELLER_RELEASE', int(txn['seller_receives']), seller_phone))
        elif outcome == REFUND:
            payouts.append(('BUYER_REFUND', int(txn['buyer_pays']), buyer_phone))
        else:
            sb = int(split_buyer_amount or 0)
            ss = int(split_seller_amount or 0)
            if sb < 0 or ss < 0 or (sb + ss) <= 0:
                conn.rollback()
                return SettleResult(False, "Split amounts must be positive.", code='BAD_SPLIT')
            if sb + ss > int(txn['buyer_pays']):
                conn.rollback()
                return SettleResult(
                    False,
                    f"Split total (Ksh {sb + ss:,}) exceeds the funds held "
                    f"(Ksh {int(txn['buyer_pays']):,}).",
                    code='BAD_SPLIT')
            if sb:
                payouts.append(('SPLIT_BUYER', sb, buyer_phone))
            if ss:
                payouts.append(('SPLIT_SELLER', ss, seller_phone))

        for ptype, amount, phone in payouts:
            if not phone:
                conn.rollback()
                return SettleResult(False, f"No valid M-Pesa number for {ptype}.",
                                    code='NO_RECIPIENT')
            if amount <= 0:
                conn.rollback()
                return SettleResult(False, "Payout amount must be positive.",
                                    code='BAD_AMOUNT')

        new_status = _OUTCOME_STATUS[outcome]
        now = datetime.now()

        # Status change with its own guard (belt and braces with the row lock)
        placeholders = ','.join(['%s'] * len(from_statuses))
        cursor.execute(
            f"UPDATE transactions SET status = %s, completed_at = %s "
            f"WHERE id = %s AND status IN ({placeholders})",
            (new_status, now, transaction_id, *from_statuses))
        if cursor.rowcount != 1:
            conn.rollback()
            return SettleResult(False, "Transaction changed state; try again.",
                                code='CONFLICT')

        for ptype, amount, phone in payouts:
            cursor.execute("""
                INSERT INTO payouts
                    (seller_id, transaction_id, payout_type, amount, mpesa_number, status)
                VALUES (%s, %s, %s, %s, %s, 'PENDING')
            """, (txn['seller_id'], transaction_id, ptype, amount, phone))

        conn.commit()
    except Exception as e:  # includes IntegrityError from the UNIQUE payout key
        conn.rollback()
        print(f"[ESCROW] settle failed for {transaction_id}: {e}")
        return SettleResult(False, "Could not settle this transaction safely.",
                            code='DB_ERROR')
    finally:
        cursor.close()

    # After commit: audit log + reputation (failures here must not undo the money move)
    try:
        log_transaction_action(
            transaction_id,
            action={RELEASE: 'FUNDS_RELEASED', REFUND: 'BUYER_REFUNDED',
                    SPLIT: 'FUNDS_SPLIT'}[outcome],
            performed_by=str(triggered_by),
            old_value=txn['status'],
            new_value=new_status,
            details="; ".join(f"{t}: Ksh {a:,} -> {p}" for t, a, p in payouts))
    except Exception as e:
        print(f"[ESCROW] audit log failed for {transaction_id}: {e}")

    try:
        from app.services.trust_score import update_reputation_metrics
        update_reputation_metrics(txn['seller_id'])
    except Exception as e:
        print(f"[ESCROW] reputation update failed: {e}")

    return SettleResult(True, "Funds settled", new_status=new_status,
                        payouts=[{'type': t, 'amount': a, 'phone': p} for t, a, p in payouts],
                        txn=txn)
