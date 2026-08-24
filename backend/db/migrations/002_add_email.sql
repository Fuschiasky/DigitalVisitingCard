
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('profiles') AND name = 'email'
)
BEGIN
    ALTER TABLE profiles ADD email NVARCHAR(255) NULL;
END
GO
