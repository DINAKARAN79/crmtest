ALTER TABLE "NewPermissionSet"
ADD COLUMN "expires_at" TIMESTAMP(3);

ALTER TABLE "PermissionSetObjectPermission"
ADD COLUMN "can_view_all" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "can_edit_all" BOOLEAN NOT NULL DEFAULT false;
