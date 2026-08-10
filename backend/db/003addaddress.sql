-- Migration: 003_add_address.sql
-- Purpose: Add an optional `address` field to profiles.
--
-- Unlike email (required), address is nullable, so this is a single
-- safe step -- no staging needed, since NULL is a valid value for
-- every existing row from the moment the column exists.
--
-- Run once against the digitalcard database:
--   sqlcmd -S <server> -d digitalcard -i 003_add_address.sql

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('profiles') AND name = 'address'
)
BEGIN
    ALTER TABLE profiles ADD address NVARCHAR(500) NOT NULL;
END