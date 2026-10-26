-- ZUNO API schema (reconstructed from the SQL in app/, plus Phase 1 money-safety changes).
-- For a FRESH database. For an existing database use db/migrations/001_phase1_money_safety.sql.
-- Verify against your live schema before running anything in production.

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  email VARCHAR(190) NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash VARCHAR(255) NOT NULL,
  business_name VARCHAR(190) NULL,
  bio TEXT NULL,
  profile_photo VARCHAR(500) NULL,
  role ENUM('buyer','seller','admin') NOT NULL DEFAULT 'seller',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status ENUM('UNVERIFIED','PENDING','VERIFIED','REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
  seller_tier TINYINT NOT NULL DEFAULT 0,
  national_id VARCHAR(50) NULL,
  id_document_url VARCHAR(500) NULL,
  verified_at DATETIME NULL,
  verification_notes TEXT NULL,
  suspension_reason TEXT NULL,
  suspended_until DATETIME NULL,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_phone (phone_number),
  UNIQUE KEY uq_users_email (email)
);

CREATE TABLE IF NOT EXISTS seller_reputation (
  seller_id INT PRIMARY KEY,
  total_transactions INT NOT NULL DEFAULT 0,
  completed_transactions INT NOT NULL DEFAULT 0,
  cancelled_transactions INT NOT NULL DEFAULT 0,
  disputed_transactions INT NOT NULL DEFAULT 0,
  completion_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  cancellation_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  dispute_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  late_delivery_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  avg_response_time_minutes INT NULL,
  total_ratings INT NOT NULL DEFAULT 0,
  average_rating DECIMAL(3,2) NOT NULL DEFAULT 0,
  trust_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  trust_level VARCHAR(20) NOT NULL DEFAULT 'NEW',
  is_visible_in_search BOOLEAN NOT NULL DEFAULT TRUE,
  visibility_penalty_reason VARCHAR(255) NULL,
  strike_count INT NOT NULL DEFAULT 0,
  FOREIGN KEY (seller_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS otp_verifications (
  phone_number VARCHAR(20) PRIMARY KEY,
  otp_code VARCHAR(100) NOT NULL,          -- stores a hash since Phase 1
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  verified_at DATETIME NULL,
  last_sent_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  email VARCHAR(190) NOT NULL,
  token VARCHAR(100) NOT NULL,
  expires_at DATETIME NOT NULL,
  verified_at DATETIME NULL,
  UNIQUE KEY uq_email_ver_user (user_id),
  UNIQUE KEY uq_email_ver_token (token)
);

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  seller_id INT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  national_id_number VARCHAR(50) NOT NULL,
  date_of_birth DATE NULL,
  id_front_url VARCHAR(500) NULL,
  id_back_url VARCHAR(500) NULL,
  selfie_url VARCHAR(500) NULL,
  business_name VARCHAR(190) NULL,
  business_type VARCHAR(30) NULL DEFAULT 'INDIVIDUAL',
  kra_pin VARCHAR(30) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT NULL,
  review_notes TEXT NULL,
  rejection_reason TEXT NULL,
  approved_at DATETIME NULL,
  UNIQUE KEY uq_kyc_seller (seller_id)
);

CREATE TABLE IF NOT EXISTS deal_contracts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  seller_id INT NOT NULL,
  buyer_user_id INT NULL,
  buyer_phone VARCHAR(20) NOT NULL,
  buyer_name VARCHAR(150) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  item_description TEXT NULL,
  agreed_amount DECIMAL(12,2) NOT NULL,
  buyer_expectations TEXT NOT NULL,
  delivery_method VARCHAR(30) NOT NULL,
  delivery_method_agreed BOOLEAN NOT NULL DEFAULT FALSE,
  pickup_location VARCHAR(255) NULL,
  delivery_location VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SELLER_REVIEWING',
  seller_confirmation TEXT NULL,
  seller_confirmed_at DATETIME NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_contract_seller (seller_id),
  KEY ix_contract_buyer (buyer_user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(40) PRIMARY KEY,
  contract_id INT NOT NULL,
  seller_id INT NOT NULL,
  buyer_user_id INT NULL,
  buyer_phone VARCHAR(20) NOT NULL,
  buyer_name VARCHAR(150) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  item_description TEXT NULL,
  item_photo VARCHAR(500) NULL,
  amount DECIMAL(12,2) NOT NULL,
  platform_fee DECIMAL(12,2) NOT NULL,
  buyer_fee_share DECIMAL(12,2) NOT NULL,
  seller_fee_share DECIMAL(12,2) NOT NULL,
  buyer_pays DECIMAL(12,2) NOT NULL,
  seller_receives DECIMAL(12,2) NOT NULL,
  delivery_method VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  mpesa_checkout_id VARCHAR(100) NULL,
  payment_reference VARCHAR(50) NULL,
  amount_paid DECIMAL(12,2) NULL,
  shipping_notes TEXT NULL,
  tracking_number VARCHAR(100) NULL,
  courier_name VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  funded_at DATETIME NULL,
  shipped_at DATETIME NULL,
  delivered_at DATETIME NULL,
  inspection_starts_at DATETIME NULL,
  inspection_ends_at DATETIME NULL,
  completed_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  UNIQUE KEY uq_txn_contract (contract_id),
  UNIQUE KEY uq_txn_payment_ref (payment_reference),
  KEY ix_txn_checkout (mpesa_checkout_id),
  KEY ix_txn_seller (seller_id),
  KEY ix_txn_buyer (buyer_user_id),
  KEY ix_txn_status (status)
);

CREATE TABLE IF NOT EXISTS payouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  seller_id INT NOT NULL,                  -- the seller on the transaction (kept for reporting)
  transaction_id VARCHAR(40) NOT NULL,
  payout_type ENUM('SELLER_RELEASE','BUYER_REFUND','SPLIT_SELLER','SPLIT_BUYER') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  mpesa_number VARCHAR(20) NOT NULL,       -- the ACTUAL recipient phone
  status ENUM('PENDING','PROCESSING','COMPLETED','FAILED','NEEDS_REVIEW') NOT NULL DEFAULT 'PENDING',
  originator_conversation_id VARCHAR(100) NULL,
  conversation_id VARCHAR(100) NULL,
  mpesa_reference VARCHAR(50) NULL,        -- M-Pesa receipt once completed
  failure_reason TEXT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processing_started_at DATETIME NULL,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_payout_txn_type (transaction_id, payout_type),
  KEY ix_payout_status (status),
  KEY ix_payout_conv (conversation_id),
  KEY ix_payout_orig (originator_conversation_id)
);

CREATE TABLE IF NOT EXISTS mpesa_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(30) NOT NULL,               -- STK_CALLBACK, B2C_RESULT, B2C_TIMEOUT
  reference VARCHAR(100) NULL,
  payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ratings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id VARCHAR(40) NOT NULL,
  seller_id INT NOT NULL,
  buyer_phone VARCHAR(20) NOT NULL,
  score TINYINT NOT NULL,
  comment TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rating_txn (transaction_id)
);

CREATE TABLE IF NOT EXISTS disputes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id VARCHAR(40) NOT NULL,
  raised_by_phone VARCHAR(20) NOT NULL,
  raised_by_user_id INT NULL,
  raised_by_role VARCHAR(10) NOT NULL,
  category VARCHAR(40) NOT NULL,
  description TEXT NOT NULL,
  preferred_resolution VARCHAR(30) NULL,
  status VARCHAR(25) NOT NULL DEFAULT 'OPEN',
  resolution VARCHAR(25) NULL,
  split_buyer_amount DECIMAL(12,2) NULL,
  split_seller_amount DECIMAL(12,2) NULL,
  admin_notes TEXT NULL,
  resolved_by INT NULL,
  resolved_at DATETIME NULL,
  evidence_deadline DATETIME NOT NULL,
  resolution_deadline DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dispute_txn (transaction_id)
);

CREATE TABLE IF NOT EXISTS dispute_evidence (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dispute_id INT NOT NULL,
  submitted_by_phone VARCHAR(20) NOT NULL,
  submitted_by_role VARCHAR(10) NOT NULL,
  evidence_type VARCHAR(20) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_evidence_dispute (dispute_id)
);

CREATE TABLE IF NOT EXISTS negotiation_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dispute_id INT NOT NULL,
  sender_phone VARCHAR(20) NOT NULL,
  sender_role VARCHAR(10) NOT NULL,
  message TEXT NOT NULL,
  is_offer BOOLEAN NOT NULL DEFAULT FALSE,
  offer_amount DECIMAL(12,2) NULL,
  offer_to VARCHAR(10) NULL,
  offer_status VARCHAR(12) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_neg_dispute (dispute_id)
);

CREATE TABLE IF NOT EXISTS transaction_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id VARCHAR(40) NOT NULL,
  action VARCHAR(40) NOT NULL,
  performed_by VARCHAR(60) NULL,
  old_value VARCHAR(40) NULL,
  new_value VARCHAR(40) NULL,
  details TEXT NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_log_txn (transaction_id)
);

CREATE TABLE IF NOT EXISTS security_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(40) NOT NULL,
  details TEXT NULL,
  ip_address VARCHAR(45) NULL,
  user_phone VARCHAR(20) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_catalog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  seller_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  price DECIMAL(12,2) NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'General',
  photos TEXT NULL,
  external_link VARCHAR(500) NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- In-app notifications (the bell). One row per user per event.
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'transaction',   -- transaction | dispute | kyc | system
  title VARCHAR(120) NOT NULL,
  body VARCHAR(400) NOT NULL,
  related_id VARCHAR(60) NULL,                        -- transaction id, or dispute id for type=dispute
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_notif_user (user_id, is_read, created_at)
);
