-- 001_phase1_money_safety.sql
-- For an EXISTING Zuno database. BACK UP FIRST. Run once, statement by statement
-- (MySQL has no "ADD COLUMN IF NOT EXISTS"; MariaDB does - remove nothing, just skip
-- statements that error with "Duplicate column / key").
-- db/schema.sql is the authoritative shape of a fresh database; compare it with yours.

-- ── users ────────────────────────────────────────────────────
ALTER TABLE users MODIFY role ENUM('buyer','seller','admin') NOT NULL DEFAULT 'seller';
ALTER TABLE users ADD COLUMN phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN failed_logins INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until DATETIME NULL;
-- Everyone who already got past OTP (status moved off UNVERIFIED) counts as phone-verified.
UPDATE users SET phone_verified = TRUE WHERE verification_status <> 'UNVERIFIED' OR is_verified = TRUE;
-- Existing seller phones into the canonical +254XXXXXXXXX form (check duplicates first!):
--   SELECT phone_number, COUNT(*) FROM users GROUP BY phone_number HAVING COUNT(*) > 1;
UPDATE users SET phone_number = CONCAT('+254', SUBSTRING(phone_number, 2)) WHERE phone_number REGEXP '^0[17][0-9]{8}$';
UPDATE users SET phone_number = CONCAT('+', phone_number) WHERE phone_number REGEXP '^254[17][0-9]{8}$';
-- Seller tiers: tier 1 now allows Ksh 50,000, tier 2 Ksh 1,000,000 (env TIER*_MAX_KES).

-- ── otp ──────────────────────────────────────────────────────
ALTER TABLE otp_verifications MODIFY otp_code VARCHAR(100) NOT NULL;
ALTER TABLE otp_verifications ADD COLUMN last_sent_at DATETIME NULL;
DELETE FROM otp_verifications;   -- old plain-text codes are no longer valid

-- ── transactions ─────────────────────────────────────────────
ALTER TABLE transactions ADD COLUMN buyer_user_id INT NULL;
ALTER TABLE transactions ADD KEY ix_txn_buyer (buyer_user_id);
ALTER TABLE transactions ADD COLUMN payment_reference VARCHAR(50) NULL;
ALTER TABLE transactions ADD COLUMN amount_paid DECIMAL(12,2) NULL;
ALTER TABLE transactions ADD UNIQUE KEY uq_txn_payment_ref (payment_reference);
ALTER TABLE transactions ADD KEY ix_txn_checkout (mpesa_checkout_id);
ALTER TABLE deal_contracts ADD COLUMN buyer_user_id INT NULL;
ALTER TABLE deal_contracts ADD KEY ix_contract_buyer (buyer_user_id);

-- ── payouts (the important one) ──────────────────────────────
ALTER TABLE payouts ADD COLUMN payout_type ENUM('SELLER_RELEASE','BUYER_REFUND','SPLIT_SELLER','SPLIT_BUYER') NOT NULL DEFAULT 'SELLER_RELEASE';
ALTER TABLE payouts MODIFY status ENUM('PENDING','PROCESSING','COMPLETED','FAILED','NEEDS_REVIEW') NOT NULL DEFAULT 'PENDING';
ALTER TABLE payouts ADD COLUMN originator_conversation_id VARCHAR(100) NULL;
ALTER TABLE payouts ADD COLUMN conversation_id VARCHAR(100) NULL;
ALTER TABLE payouts ADD COLUMN mpesa_reference VARCHAR(50) NULL;
ALTER TABLE payouts ADD COLUMN failure_reason TEXT NULL;
ALTER TABLE payouts ADD COLUMN attempts INT NOT NULL DEFAULT 0;
ALTER TABLE payouts ADD COLUMN processing_started_at DATETIME NULL;
-- Old rows may contain duplicate payouts per transaction. Inspect before adding the key:
--   SELECT transaction_id, COUNT(*) FROM payouts GROUP BY transaction_id HAVING COUNT(*) > 1;
ALTER TABLE payouts ADD UNIQUE KEY uq_payout_txn_type (transaction_id, payout_type);
ALTER TABLE payouts ADD KEY ix_payout_status (status);
ALTER TABLE payouts ADD KEY ix_payout_conv (conversation_id);
ALTER TABLE payouts ADD KEY ix_payout_orig (originator_conversation_id);

-- ── ratings ──────────────────────────────────────────────────
ALTER TABLE ratings ADD UNIQUE KEY uq_rating_txn (transaction_id);

-- ── new tables: copy `mpesa_events` (and any other CREATE TABLE not in your DB) from schema.sql ──
