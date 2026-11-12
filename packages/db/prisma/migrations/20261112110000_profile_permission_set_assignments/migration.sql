CREATE TABLE IF NOT EXISTS "ProfilePermissionSetAssignment" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "permissionSetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfilePermissionSetAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProfilePermissionSetAssignment_profileId_permissionSetId_key"
ON "ProfilePermissionSetAssignment"("profileId", "permissionSetId");

CREATE INDEX IF NOT EXISTS "ProfilePermissionSetAssignment_profileId_idx"
ON "ProfilePermissionSetAssignment"("profileId");

CREATE INDEX IF NOT EXISTS "ProfilePermissionSetAssignment_permissionSetId_idx"
ON "ProfilePermissionSetAssignment"("permissionSetId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ProfilePermissionSetAssignment_profileId_fkey'
          AND conrelid = '"ProfilePermissionSetAssignment"'::regclass
    ) THEN
        ALTER TABLE "ProfilePermissionSetAssignment"
        ADD CONSTRAINT "ProfilePermissionSetAssignment_profileId_fkey"
        FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ProfilePermissionSetAssignment_permissionSetId_fkey'
          AND conrelid = '"ProfilePermissionSetAssignment"'::regclass
    ) THEN
        ALTER TABLE "ProfilePermissionSetAssignment"
        ADD CONSTRAINT "ProfilePermissionSetAssignment_permissionSetId_fkey"
        FOREIGN KEY ("permissionSetId") REFERENCES "NewPermissionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
