-- Migration: 002_add_email.sql
-- Purpose: Add a required `email` field to profiles.
--
-- Adding a NOT NULL column directly fails if the table already has
-- rows (there's no value to backfill them with). This migration adds
-- the column as nullable first, so it's safe to run immediately on a
-- live database, and stops short of the final NOT NULL step.
--
-- Run once against the digitalcard database:
--   sqlcmd -S <server> -d digitalcard -i 002_add_email.sql
--
-- ── Step 1 (safe to run now) ──
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('profiles') AND name = 'email'
)
BEGIN
    ALTER TABLE profiles ADD email NVARCHAR(255) NULL;
END
GO

-- ── Step 2 (run this ONLY after every existing profile row has a
--    real email value — check with the query below first) ──
--
--    SELECT slug, first_name, last_name FROM profiles WHERE email IS NULL;
--
--    Update those rows (via the admin panel, or directly) before
--    proceeding, then uncomment and run:
--
-- ALTER TABLE profiles ALTER COLUMN email NVARCHAR(255) NOT NULL;