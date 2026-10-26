-- Run once on an existing database (Workbench: paste, then the lightning button).
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'transaction',
  title VARCHAR(120) NOT NULL,
  body VARCHAR(400) NOT NULL,
  related_id VARCHAR(60) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_notif_user (user_id, is_read, created_at)
);
