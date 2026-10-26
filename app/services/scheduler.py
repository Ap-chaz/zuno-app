# app/services/scheduler.py
#
# Background jobs for Zuno.
#
# JOBS
#   auto_complete_expired_inspections  every 10 min  inspection window over -> release to seller
#   expire_old_contracts               every hour    seller never answered   -> EXPIRED
#   process_pending_payouts            every 2 min   send queued M-Pesa B2C payouts / refunds
#   flag_stuck_payouts                 every 15 min  payouts with no result   -> NEEDS_REVIEW
#   lift_expired_suspensions           every hour    suspended_until passed   -> account active again
#
# WHERE THEY RUN
# Run jobs in exactly ONE process. With `gunicorn --workers 2` every worker used to start
# its own scheduler, so every job ran twice. Now:
#   - the web service does NOT start jobs (RUN_SCHEDULER unset/false)
#   - a separate worker service runs `python worker.py`
# As a second safety net every job takes a MySQL named lock (GET_LOCK), so even
# if two schedulers ever run, only one executes a given job at a time.

import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.schedulers.blocking import BlockingScheduler

MAX_PAYOUT_ATTEMPTS = 3


@contextmanager
def job_lock(name):
    """Yields True if this process got the named lock, False if another holds it."""
    from app import mysql
    cursor = mysql.connection.cursor()
    cursor.execute("SELECT GET_LOCK(%s, 0) AS got", (f"zuno_job_{name}",))
    got = cursor.fetchone()['got'] == 1
    try:
        yield got
    finally:
        if got:
            cursor.execute("SELECT RELEASE_LOCK(%s)", (f"zuno_job_{name}",))
        cursor.close()


# ── 1. Auto-release after the inspection window ───────────────

def auto_complete_expired_inspections(app):
    """
    Buyer received the item, had INSPECTION_WINDOW_HOURS to approve or dispute,
    and did neither -> release to the seller. Goes through the same escrow
    service as a manual approval, so it cannot double-pay.
    """
    with app.app_context():
        from app import mysql
        from app.services.escrow import settle_transaction, RELEASE
        from app.services.sms import send_sms

        with job_lock('auto_complete') as got:
            if not got:
                return
            cursor = mysql.connection.cursor()
            cursor.execute("""
                SELECT t.id, t.buyer_phone, t.item_name, t.seller_receives,
                       u.phone_number AS seller_phone
                FROM transactions t
                JOIN users u ON u.id = t.seller_id
                WHERE t.status = 'INSPECTION' AND t.inspection_ends_at <= %s
                LIMIT 100
            """, (datetime.now(),))
            expired = cursor.fetchall()
            mysql.connection.commit()
            cursor.close()

            for txn in expired:
                result = settle_transaction(
                    txn['id'], RELEASE, ('INSPECTION',), triggered_by='SYSTEM:AUTO_COMPLETE')
                if not result.ok:
                    print(f"[SCHEDULER] skip {txn['id']}: {result.message}")
                    continue
                send_sms(txn['buyer_phone'],
                         f"Zuno: Your inspection window for '{txn['item_name']}' has ended. "
                         f"Funds were released to the seller. Transaction ID: {txn['id']}")
                send_sms(txn['seller_phone'],
                         f"Zuno: Inspection window ended for '{txn['item_name']}'. "
                         f"Ksh {int(txn['seller_receives']):,} is being sent to your M-Pesa. "
                         f"Transaction ID: {txn['id']}")
                print(f"[SCHEDULER] Auto-completed {txn['id']}")


# ── 2. Expire unanswered contracts ────────────────────────────

def expire_old_contracts(app):
    with app.app_context():
        from app import mysql
        from app.services.sms import send_sms

        with job_lock('expire_contracts') as got:
            if not got:
                return
            cursor = mysql.connection.cursor()
            cursor.execute("""
                SELECT id, buyer_phone, item_name FROM deal_contracts
                WHERE status = 'SELLER_REVIEWING' AND expires_at <= %s
            """, (datetime.now(),))
            expired = cursor.fetchall()

            for contract in expired:
                cursor.execute("""
                    UPDATE deal_contracts SET status = 'EXPIRED'
                    WHERE id = %s AND status = 'SELLER_REVIEWING'
                """, (contract['id'],))
                changed = cursor.rowcount == 1
                mysql.connection.commit()
                if changed:
                    send_sms(contract['buyer_phone'],
                             f"Zuno: Your deal request for '{contract['item_name']}' expired "
                             f"because the seller did not respond in time. "
                             f"Contract ID: {contract['id']}")
            cursor.close()


# ── 3. Send queued payouts ────────────────────────────────────

def process_pending_payouts(app):
    """
    Claims each PENDING payout atomically (PENDING -> PROCESSING with a fresh
    OriginatorConversationID) and sends it to the phone stored ON THE PAYOUT ROW
    (seller for releases, buyer for refunds).
    """
    with app.app_context():
        from app import mysql
        from app.services.mpesa import send_b2c_payment

        with job_lock('payouts') as got:
            if not got:
                return
            cursor = mysql.connection.cursor()
            cursor.execute(
                "SELECT id FROM payouts WHERE status = 'PENDING' ORDER BY id LIMIT 20")
            ids = [r['id'] for r in cursor.fetchall()]
            mysql.connection.commit()

            for payout_id in ids:
                originator_id = str(uuid.uuid4())
                cursor.execute("""
                    UPDATE payouts SET
                        status = 'PROCESSING',
                        attempts = attempts + 1,
                        processing_started_at = %s,
                        originator_conversation_id = %s,
                        conversation_id = NULL
                    WHERE id = %s AND status = 'PENDING'
                """, (datetime.now(), originator_id, payout_id))
                claimed = cursor.rowcount == 1
                mysql.connection.commit()
                if not claimed:
                    continue

                cursor.execute("SELECT * FROM payouts WHERE id = %s", (payout_id,))
                payout = cursor.fetchone()
                mysql.connection.commit()

                result = send_b2c_payment(
                    phone_number=payout['mpesa_number'],
                    amount=payout['amount'],
                    transaction_id=payout['transaction_id'],
                    remarks=f"Zuno {payout['payout_type']} {payout['transaction_id']}",
                    originator_conversation_id=originator_id)

                if result['success']:
                    cursor.execute("""
                        UPDATE payouts SET conversation_id = %s,
                               originator_conversation_id = COALESCE(%s, originator_conversation_id)
                        WHERE id = %s
                    """, (result.get('conversation_id'),
                          result.get('originator_conversation_id'), payout_id))
                    print(f"[PAYOUT] #{payout_id} accepted by M-Pesa "
                          f"({payout['payout_type']} Ksh {int(payout['amount']):,})")
                elif result.get('retryable') and payout['attempts'] < MAX_PAYOUT_ATTEMPTS:
                    cursor.execute(
                        "UPDATE payouts SET status = 'PENDING', failure_reason = %s WHERE id = %s",
                        (result['message'][:500], payout_id))
                    print(f"[PAYOUT] #{payout_id} will retry: {result['message']}")
                elif result.get('uncertain') or result.get('retryable'):
                    # We cannot be sure it was NOT sent: never auto-retry, a human checks M-Pesa.
                    cursor.execute(
                        "UPDATE payouts SET status = 'NEEDS_REVIEW', failure_reason = %s WHERE id = %s",
                        (result['message'][:500], payout_id))
                    print(f"[PAYOUT] #{payout_id} NEEDS REVIEW: {result['message']}")
                else:
                    cursor.execute(
                        "UPDATE payouts SET status = 'FAILED', failure_reason = %s WHERE id = %s",
                        (result['message'][:500], payout_id))
                    print(f"[PAYOUT FAILED] #{payout_id}: {result['message']}")
                mysql.connection.commit()
            cursor.close()


# ── 4. Payouts that never got a result ────────────────────────

def flag_stuck_payouts(app):
    """
    PROCESSING for too long means we crashed mid-send or Safaricom never called back.
    We do NOT auto-resend (that could pay twice). A human checks the M-Pesa
    statement, then retries from the admin panel.
    """
    with app.app_context():
        from app import mysql
        with job_lock('stuck_payouts') as got:
            if not got:
                return
            cursor = mysql.connection.cursor()
            cursor.execute("""
                UPDATE payouts SET status = 'NEEDS_REVIEW',
                       failure_reason = 'No result from M-Pesa - check statement before retrying'
                WHERE status = 'PROCESSING'
                  AND ( (conversation_id IS NULL AND processing_started_at < %s)
                     OR (processing_started_at < %s) )
            """, (datetime.now() - timedelta(minutes=15), datetime.now() - timedelta(hours=6)))
            n = cursor.rowcount
            mysql.connection.commit()
            cursor.close()
            if n:
                print(f"[SCHEDULER] {n} payout(s) moved to NEEDS_REVIEW")


# ── 5. Lift finished suspensions ──────────────────────────────

def lift_expired_suspensions(app):
    with app.app_context():
        from app import mysql
        with job_lock('suspensions') as got:
            if not got:
                return
            cursor = mysql.connection.cursor()
            cursor.execute("""
                UPDATE users SET is_active = TRUE, suspension_reason = NULL, suspended_until = NULL
                WHERE is_active = FALSE AND suspended_until IS NOT NULL AND suspended_until <= %s
            """, (datetime.now(),))
            mysql.connection.commit()
            cursor.close()


# ── Wiring ────────────────────────────────────────────────────

def _add_jobs(scheduler, app):
    scheduler.add_job(auto_complete_expired_inspections, args=[app], trigger='interval',
                      minutes=10, id='auto_complete_inspections', replace_existing=True)
    scheduler.add_job(expire_old_contracts, args=[app], trigger='interval',
                      hours=1, id='expire_contracts', replace_existing=True)
    scheduler.add_job(process_pending_payouts, args=[app], trigger='interval',
                      minutes=2, id='process_payouts', replace_existing=True)
    scheduler.add_job(flag_stuck_payouts, args=[app], trigger='interval',
                      minutes=15, id='flag_stuck_payouts', replace_existing=True)
    scheduler.add_job(lift_expired_suspensions, args=[app], trigger='interval',
                      hours=1, id='lift_suspensions', replace_existing=True)


def start_scheduler(app):
    """Single-process/dev mode: background scheduler inside the web process."""
    scheduler = BackgroundScheduler()
    _add_jobs(scheduler, app)
    scheduler.start()
    print("[SCHEDULER] Background jobs started (in-process)")
    return scheduler


def run_blocking(app):
    """Worker mode: `python worker.py` runs the jobs in their own process."""
    scheduler = BlockingScheduler()
    _add_jobs(scheduler, app)
    print("[SCHEDULER] Worker started")
    scheduler.start()
