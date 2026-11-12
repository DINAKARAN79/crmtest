import { Router, Response } from 'express';
import { prisma } from '@dct-crm/db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { invalidateCache } from '../services/metadata';
import { EffectivePermissionService } from '../services/effectivePermissions';
import { denyUnlessUserObjectAdmin } from '../services/userObjectAccess';

const router = Router();
router.use(authenticate);
router.use('/:objectName', (req: AuthRequest, res: Response, next) => {
  if (denyUnlessUserObjectAdmin(req, res)) return;
  next();
});
router.use(requirePermission('PROFILE_PERMISSION_MANAGE'));

function getPermissionValues(input: Record<string, unknown>, existing?: {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  viewAll: boolean;
  modifyAll: boolean;
}) {
  return {
    canCreate: typeof input.canCreate === 'boolean' ? input.canCreate : existing?.canCreate ?? false,
    canRead: typeof input.canRead === 'boolean' ? input.canRead : existing?.canRead ?? false,
    canUpdate: typeof input.canUpdate === 'boolean' ? input.canUpdate : existing?.canUpdate ?? false,
    canDelete: typeof input.canDelete === 'boolean' ? input.canDelete : existing?.canDelete ?? false,
    viewAll: typeof input.viewAll === 'boolean' ? input.viewAll : existing?.viewAll ?? false,
    modifyAll: typeof input.modifyAll === 'boolean' ? input.modifyAll : existing?.modifyAll ?? false,
  };
}

async function invalidateProfilePermissions(tenantId: string, profileIds: string[], objectName: string) {
  const users = await prisma.user.findMany({
    where: { tenantId, profileId: { in: profileIds } },
    select: { id: true },
  });
  EffectivePermissionService.invalidateUserPermissionsCache(users.map(({ id }) => id));
  invalidateCache(tenantId, objectName);
}

router.get('/:objectName', async (req: AuthRequest, res: Response) => {
  try {
    const object = await prisma.objectDefinition.findFirst({
      where: { tenantId: req.tenantId!, name: { equals: req.params.objectName, mode: 'insensitive' } },
    });
    if (!object) {
      return res.status(404).json({ success: false, error: 'Object not found' });
    }

    const permissions = await prisma.profileObjectPermission.findMany({
      where: { tenantId: req.tenantId!, objectId: object.id },
      include: { profile: { select: { id: true, name: true } } },
      orderBy: { profile: { name: 'asc' } },
    });
    res.json({ success: true, data: permissions });
  } catch (error) {
    console.error('Get object permissions error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch permissions' });
  }
});

router.post('/:objectName', async (req: AuthRequest, res: Response) => {
  try {
    const object = await prisma.objectDefinition.findFirst({
      where: { tenantId: req.tenantId!, name: { equals: req.params.objectName, mode: 'insensitive' } },
    });
    if (!object) {
      return res.status(404).json({ success: false, error: 'Object not found' });
    }

    const { profileId } = req.body as { profileId?: string };
    if (!profileId) {
      return res.status(400).json({ success: false, error: 'CRM Profile ID is required' });
    }
    const profile = await prisma.profile.findFirst({
      where: { id: profileId, OR: [{ tenantId: req.tenantId! }, { isGlobal: true }] },
      select: { id: true },
    });
    if (!profile) {
      return res.status(404).json({ success: false, error: 'CRM Profile not found' });
    }

    const permission = await prisma.profileObjectPermission.upsert({
      where: { profileId_objectId: { profileId, objectId: object.id } },
      create: {
        tenantId: req.tenantId!,
        profileId,
        objectId: object.id,
        ...getPermissionValues(req.body),
      },
      update: getPermissionValues(req.body),
    });

    await invalidateProfilePermissions(req.tenantId!, [profileId], object.name);
    res.json({ success: true, data: permission });
  } catch (error) {
    console.error('Set object permission error:', error);
    res.status(500).json({ success: false, error: 'Failed to set permission' });
  }
});

router.post('/:objectName/bulk', async (req: AuthRequest, res: Response) => {
  try {
    const object = await prisma.objectDefinition.findFirst({
      where: { tenantId: req.tenantId!, name: { equals: req.params.objectName, mode: 'insensitive' } },
    });
    if (!object) {
      return res.status(404).json({ success: false, error: 'Object not found' });
    }

    const { permissions } = req.body as { permissions?: Array<Record<string, unknown> & { profileId?: string }> };
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ success: false, error: 'Permissions array is required' });
    }
    if (permissions.some(({ profileId }) => typeof profileId !== 'string' || !profileId)) {
      return res.status(400).json({ success: false, error: 'Each permission requires a CRM Profile ID' });
    }

    const profileIds = [...new Set(permissions.map(({ profileId }) => profileId).filter(
      (profileId): profileId is string => typeof profileId === 'string' && profileId.length > 0,
    ))];
    const profiles = profileIds.length
      ? await prisma.profile.findMany({
        where: { id: { in: profileIds }, OR: [{ tenantId: req.tenantId! }, { isGlobal: true }] },
          select: { id: true },
        })
      : [];
    const validProfileIds = new Set(profiles.map(({ id }) => id));
    if (profileIds.some((profileId) => !validProfileIds.has(profileId))) {
      return res.status(400).json({ success: false, error: 'One or more CRM Profiles were not found in this company' });
    }
    const results = await prisma.$transaction(
      permissions.map((permission) => prisma.profileObjectPermission.upsert({
          where: {
            profileId_objectId: {
              profileId: permission.profileId!,
              objectId: object.id,
            },
          },
          create: {
            tenantId: req.tenantId!,
            profileId: permission.profileId!,
            objectId: object.id,
            ...getPermissionValues(permission),
          },
          update: getPermissionValues(permission),
        })),
    );

    if (profileIds.length) {
      await invalidateProfilePermissions(req.tenantId!, profileIds, object.name);
    }
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Bulk set permissions error:', error);
    res.status(500).json({ success: false, error: 'Failed to set permissions' });
  }
});

router.delete('/:objectName/:permissionId', async (req: AuthRequest, res: Response) => {
  try {
    const object = await prisma.objectDefinition.findFirst({
      where: { tenantId: req.tenantId!, name: { equals: req.params.objectName, mode: 'insensitive' } },
    });
    if (!object) {
      return res.status(404).json({ success: false, error: 'Object not found' });
    }

    const existing = await prisma.profileObjectPermission.findFirst({
      where: { id: req.params.permissionId, tenantId: req.tenantId!, objectId: object.id },
      select: { id: true, profileId: true },
    });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Permission not found' });
    }

    await prisma.profileObjectPermission.delete({ where: { id: existing.id } });
    await invalidateProfilePermissions(req.tenantId!, [existing.profileId], object.name);
    res.json({ success: true, message: 'Permission deleted successfully' });
  } catch (error) {
    console.error('Delete permission error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete permission' });
  }
});

export { router as objectPermissionRoutes };
