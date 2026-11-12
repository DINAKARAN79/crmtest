import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  permissionSetFindMany: vi.fn(),
  profileObjectPermissionFindMany: vi.fn(),
  profilePermissionSetAssignmentFindMany: vi.fn(),
  profileFieldPermissionFindMany: vi.fn(),
  userPermissionAssignmentFindMany: vi.fn(),
  userPermissionSetGroupFindMany: vi.fn(),
  userDirectPermissionFindMany: vi.fn(),
  userRoleFindMany: vi.fn(),
  telephonyAgentPermissionFindUnique: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    user: { findUnique: db.userFindUnique },
    permissionSet: { findMany: db.permissionSetFindMany },
    profileObjectPermission: { findMany: db.profileObjectPermissionFindMany },
    profilePermissionSetAssignment: { findMany: db.profilePermissionSetAssignmentFindMany },
    profileFieldPermission: { findMany: db.profileFieldPermissionFindMany },
    userPermissionAssignment: { findMany: db.userPermissionAssignmentFindMany },
    userPermissionSetGroup: { findMany: db.userPermissionSetGroupFindMany },
    userDirectPermission: { findMany: db.userDirectPermissionFindMany },
    userRole: { findMany: db.userRoleFindMany },
    telephonyAgentPermission: { findUnique: db.telephonyAgentPermissionFindUnique },
  },
}));

import { EffectivePermissionService } from './effectivePermissions';

describe('effective all-leads permissions', () => {
  const user = { id: 'user-1', profileId: null, tenantId: 'tenant-1', isActive: true, isSuperAdmin: false };

  beforeEach(() => {
    vi.clearAllMocks();
    EffectivePermissionService.invalidateUserPermissionsCache(['user-1']);
    db.userFindUnique.mockResolvedValue(user);
    db.permissionSetFindMany.mockResolvedValue([]);
    db.profileObjectPermissionFindMany.mockResolvedValue([]);
    db.profilePermissionSetAssignmentFindMany.mockResolvedValue([]);
    db.profileFieldPermissionFindMany.mockResolvedValue([]);
    db.userPermissionSetGroupFindMany.mockResolvedValue([]);
    db.userDirectPermissionFindMany.mockResolvedValue([]);
    db.userRoleFindMany.mockResolvedValue([]);
    db.telephonyAgentPermissionFindUnique.mockResolvedValue(null);
  });

  it('applies object permissions from an active assigned set and requires base permissions', async () => {
    db.userPermissionAssignmentFindMany.mockResolvedValue([{
      permissionSet: {
        name: 'Lead Editors',
        expiresAt: null,
        items: [],
        objectPermissions: [{
          object: { name: 'Lead', isActive: true },
          canCreate: false,
          canRead: true,
          canUpdate: true,
          canDelete: false,
          viewAll: false,
          modifyAll: false,
          canViewAll: true,
          canEditAll: true,
        }],
      },
    }]);

    await expect(EffectivePermissionService.canViewAll('user-1', 'lead')).resolves.toBe(true);
    await expect(EffectivePermissionService.canEditAll('user-1', 'lead')).resolves.toBe(true);
    await expect(EffectivePermissionService.getLeadAllAccess('user-1')).resolves.toMatchObject({
      viewAll: true,
      editAll: true,
      sources: [{ sourceName: 'Lead Editors', canViewAll: true, canEditAll: true }],
    });
    expect(db.userPermissionAssignmentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        permissionSet: expect.objectContaining({
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        }),
      }),
    }));
  });

  it('invalidates cached effective permissions after an assignment changes', async () => {
    db.userPermissionAssignmentFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        permissionSet: {
          name: 'Lead Readers',
          expiresAt: null,
          items: [],
          objectPermissions: [{
            object: { name: 'Lead', isActive: true },
            canCreate: false,
            canRead: true,
            canUpdate: false,
            canDelete: false,
            viewAll: false,
            modifyAll: false,
            canViewAll: true,
            canEditAll: false,
          }],
        },
      }]);

    const requestOwner = {};
    await expect(EffectivePermissionService.getEffectivePermissionsCached(requestOwner, 'user-1')).resolves.toEqual([]);
    EffectivePermissionService.invalidateUserPermissionsCache(['user-1']);
    await expect(EffectivePermissionService.getEffectivePermissionsCached(requestOwner, 'user-1')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'LEAD_VIEW_ALL', sourceName: 'Lead Readers' })]),
    );
    expect(db.userPermissionAssignmentFindMany).toHaveBeenCalledTimes(2);
  });

  it('does not grant hidden fields to a View All user', async () => {
    db.userPermissionAssignmentFindMany.mockResolvedValue([{
      permissionSet: {
        name: 'Lead Readers',
        expiresAt: null,
        items: [],
        fieldPermissions: [],
        objectPermissions: [{
          object: { name: 'Lead', isActive: true },
          canCreate: false,
          canRead: true,
          canUpdate: false,
          canDelete: false,
          viewAll: false,
          modifyAll: false,
          canViewAll: true,
          canEditAll: false,
        }],
      },
    }]);

    await expect(EffectivePermissionService.canViewAll('user-1', 'lead')).resolves.toBe(true);
    await expect(EffectivePermissionService.getEffectiveFieldPermissions('user-1', 'lead-object')).resolves.toEqual([]);
  });
});
