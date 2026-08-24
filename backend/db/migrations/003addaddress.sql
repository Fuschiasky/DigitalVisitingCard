IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('profiles') AND name = 'address'
)
BEGIN
    ALTER TABLE profiles ADD address NVARCHAR(500) NOT NULL;
END