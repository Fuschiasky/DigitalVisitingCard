
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('profiles') AND name = 'photo_path'
)
BEGIN
    ALTER TABLE profiles DROP COLUMN photo_path;
END