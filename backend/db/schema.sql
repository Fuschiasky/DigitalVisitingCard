-- ProfileLink Database Schema
-- MySQL 8.0+
-- Run: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS digitalcard
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE digitalcard;

-- ─────────────────────────────────────────────
--  Admins
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login    DATETIME,
  INDEX idx_username (username)
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────
--  Profiles
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug          CHAR(36)     NOT NULL UNIQUE,          -- UUID v4
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  designation   VARCHAR(200) NOT NULL,
  phone_primary VARCHAR(30)  NOT NULL,
  phone_2       VARCHAR(30),
  phone_3       VARCHAR(30),
  photo_path    VARCHAR(500),                          -- NULL = use initials placeholder
  created_by    INT UNSIGNED NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,

  INDEX idx_slug      (slug),
  INDEX idx_is_active (is_active),
  FOREIGN KEY fk_created_by (created_by) REFERENCES admins(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────
--  Refresh tokens  (short list; pruned on login)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id   INT UNSIGNED NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME     NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_token_hash (token_hash),
  FOREIGN KEY fk_rt_admin (admin_id) REFERENCES admins(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ─────────────────────────────────────────────
--  Audit log  (immutable — no DELETE granted)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id   INT UNSIGNED,
  action     VARCHAR(100) NOT NULL,
  target_id  INT UNSIGNED,
  detail     JSON,
  ip_address VARCHAR(45),
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_admin_id  (admin_id),
  INDEX idx_target_id (target_id),
  INDEX idx_created   (created_at)
) ENGINE=InnoDB;
