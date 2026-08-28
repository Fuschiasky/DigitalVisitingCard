-- Migration: 006_optional_phone_primary.sql
-- Purpose: Make phone_primary optional, treated the same as phone_2/phone_3.
--
-- This is safe to run as a single step (unlike tightening a column to
-- NOT NULL): every existing row already has a value in phone_primary,
-- so relaxing the constraint doesn't require backfilling anything.
--
-- Run once against the digitalcard database:
--   sqlcmd -S <server> -d digitalcard -i 006_optional_phone_primary.sql

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('profiles') AND name = 'phone_primary' AND is_nullable = 0
)
BEGIN
    ALTER TABLE profiles ALTER COLUMN phone_primary NVARCHAR(30) NULL;
END