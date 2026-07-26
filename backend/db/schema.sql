-- Digital Card Database Schema
-- MS SQL Server 2022

-- ─────────────────────────────────────────────
--  Admins
-- ─────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='admins' AND xtype='U')
CREATE TABLE admins (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  username      NVARCHAR(64)  NOT NULL UNIQUE,
  password_hash NVARCHAR(255) NOT NULL,
  created_at    DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  last_login    DATETIME2     NULL
);

CREATE INDEX idx_admins_username ON admins(username);

-- ─────────────────────────────────────────────
--  Profiles
-- ─────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='profiles' AND xtype='U')
CREATE TABLE profiles (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  slug          CHAR(36)      NOT NULL UNIQUE,
  first_name    NVARCHAR(100) NOT NULL,
  last_name     NVARCHAR(100) NOT NULL,
  designation   NVARCHAR(200) NOT NULL,
  phone_primary NVARCHAR(30)  NOT NULL,
  phone_2       NVARCHAR(30)  NULL,
  phone_3       NVARCHAR(30)  NULL,
  photo_path    NVARCHAR(500) NULL,
  created_by    INT           NOT NULL,
  created_at    DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  updated_at    DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  is_active     TINYINT       NOT NULL DEFAULT 1,
  CONSTRAINT fk_profiles_created_by FOREIGN KEY (created_by) REFERENCES admins(id)
);

CREATE INDEX idx_profiles_slug      ON profiles(slug);
CREATE INDEX idx_profiles_is_active ON profiles(is_active);

-- ─────────────────────────────────────────────
--  Trigger: auto-update updated_at on profile change
-- ─────────────────────────────────────────────
IF OBJECT_ID('trg_profiles_updated_at', 'TR') IS NOT NULL DROP TRIGGER trg_profiles_updated_at;
GO
CREATE TRIGGER trg_profiles_updated_at
ON profiles
AFTER UPDATE
AS
  UPDATE profiles
  SET updated_at = GETUTCDATE()
  FROM profiles p
  INNER JOIN inserted i ON p.id = i.id;
GO

-- ─────────────────────────────────────────────
--  Refresh tokens
-- ─────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='refresh_tokens' AND xtype='U')
CREATE TABLE refresh_tokens (
  id         INT IDENTITY(1,1) PRIMARY KEY,
  admin_id   INT           NOT NULL,
  token_hash NVARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME2     NOT NULL,
  created_at DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
  CONSTRAINT fk_rt_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

CREATE INDEX idx_rt_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_rt_admin_id   ON refresh_tokens(admin_id);

-- ─────────────────────────────────────────────
--  Audit log
-- ─────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='audit_log' AND xtype='U')
CREATE TABLE audit_log (
  id         BIGINT IDENTITY(1,1) PRIMARY KEY,
  admin_id   INT           NULL,
  action     NVARCHAR(100) NOT NULL,
  target_id  INT           NULL,
  detail     NVARCHAR(MAX) NULL,
  ip_address NVARCHAR(45)  NULL,
  created_at DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);

CREATE INDEX idx_audit_admin_id  ON audit_log(admin_id);
CREATE INDEX idx_audit_target_id ON audit_log(target_id);
CREATE INDEX idx_audit_created   ON audit_log(created_at);