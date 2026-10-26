# ZUNO API - Phase 1 (money safety) changes

Run the tests: `pip install -r requirements.txt -r requirements-dev.txt && pytest -q`
(needs a local MySQL/MariaDB; it creates and wipes a database called `zuno_test`).

## Before you deploy
1. Back up the database, then apply `db/migrations/001_phase1_money_safety.sql` (read its comments; inspect
   duplicate payouts / phone numbers first). Fresh DB: `db/schema.sql`.
2. New required env vars (app refuses to boot without them): `SECRET_KEY`, `JWT_SECRET_KEY` (32+ chars),
   `LINK_SIGNING_SECRET`, `MPESA_CALLBACK_SECRET`; also `MPESA_CALLBACK_BASE` (public https base).
   Register the three callback URLs the app builds (STK, B2C result, B2C timeout) with Safaricom.
3. Two Railway services from this repo: web (`gunicorn run:app`) and worker (`python worker.py`).
   Never set RUN_SCHEDULER on the web service.
4. Pin real M-Pesa B2C credentials; test the whole flow in the Daraja sandbox before real money.

## What changed
- One money service (`app/services/escrow.py`): row-locked, atomic, one payout per (transaction, type), each
  payout stores the real recipient phone. Release/refund/split/auto-release/negotiation/admin all use it.
- Refunds go to the BUYER, splits pay BOTH parties, split total can never exceed the escrow.
- Safaricom callbacks: secret in URL, amount check, only PENDING can be funded, receipt unique, raw events logged,
  B2C results only touch the matching payout, timeouts re-queue, uncertain payouts -> NEEDS_REVIEW.
- Scheduler runs once (worker) with DB locks per job.
- Auth: buyers are real accounts; register takes `role` buyer|seller; phone OTP (hashed, 3 tries, 60s resend,
  single use) is required; `verify-otp` returns `{token,user}`; login takes `identifier` (phone or email),
  locks after repeated failures, suspension auto-lifts. Every money/dispute/negotiation/rating action uses the
  JWT identity - a phone number in a request body is never trusted.
- Fees are whole shillings, calculated by the API. Phones are stored as `+254XXXXXXXXX`.
- Deal limits (env): unverified 1,000 / Tier 1 50,000 / Tier 2 1,000,000. Admin: `POST /api/admin/users/<id>/tier`.
- Admin additions: `/users/<id>/unsuspend`, `GET /payouts`, `POST /payouts/<id>/retry`.

## API contract notes for the frontend (Phase 2)
- Errors currently look like `{error, message, code, status}`.
- Negotiation `offer_amount` = amount refunded to the BUYER (1..seller_receives); the seller keeps the rest.
- Rating: `POST /api/reputation/rate {transaction_id, score, comment}` with the buyer's token (no phone field).
- Contract/transaction/dispute lookups return 404 to non-parties.
