WITH role_profile_permissions AS (
  SELECT
    u."profileId",
    op."tenantId",
    op."objectId",
    BOOL_OR(op."canCreate") AS "canCreate",
    BOOL_OR(op."canRead") AS "canRead",
    BOOL_OR(op."canUpdate") AS "canUpdate",
    BOOL_OR(op."canDelete") AS "canDelete",
    BOOL_OR(op."viewAll") AS "viewAll",
    BOOL_OR(op."modifyAll") AS "modifyAll"
  FROM "ObjectPermission" op
  JOIN "UserRole" ur ON ur."roleId" = op."roleId"
  JOIN "User" u ON u."id" = ur."userId"
  JOIN "Profile" p ON p."id" = u."profileId" AND p."tenantId" = op."tenantId"
  WHERE u."profileId" IS NOT NULL
    AND u."tenantId" = op."tenantId"
  GROUP BY u."profileId", op."tenantId", op."objectId"
)
INSERT INTO "ProfileObjectPermission" (
  "id",
  "tenantId",
  "profileId",
  "objectId",
  "canCreate",
  "canRead",
  "canUpdate",
  "canDelete",
  "viewAll",
  "modifyAll",
  "createdAt",
  "updatedAt"
)
SELECT
  'migrated-role-' || md5(rpp."profileId" || ':' || rpp."objectId"),
  rpp."tenantId",
  rpp."profileId",
  rpp."objectId",
  rpp."canCreate",
  rpp."canRead",
  rpp."canUpdate",
  rpp."canDelete",
  rpp."viewAll",
  rpp."modifyAll",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM role_profile_permissions rpp
ON CONFLICT ("profileId", "objectId") DO UPDATE
SET
  "canCreate" = "ProfileObjectPermission"."canCreate" OR EXCLUDED."canCreate",
  "canRead" = "ProfileObjectPermission"."canRead" OR EXCLUDED."canRead",
  "canUpdate" = "ProfileObjectPermission"."canUpdate" OR EXCLUDED."canUpdate",
  "canDelete" = "ProfileObjectPermission"."canDelete" OR EXCLUDED."canDelete",
  "viewAll" = "ProfileObjectPermission"."viewAll" OR EXCLUDED."viewAll",
  "modifyAll" = "ProfileObjectPermission"."modifyAll" OR EXCLUDED."modifyAll",
  "updatedAt" = CURRENT_TIMESTAMP;
