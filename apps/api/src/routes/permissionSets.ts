import { Router, Response } from 'express';
import { prisma } from '@dct-crm/db';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/permissions';
import { EffectivePermissionService } from '../services/effectivePermissions';

const router = Router();
router.use(authenticate);

const permissionSetSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  permissionIds: z.array(z.string()),
  expiresAt: z.string().datetime().nullable().optional(),
});

const updatePermissionSetSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  permissionIds: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const objectPermissionUpdateSchema = z.object({
  canCreate: z.boolean().optional(),
  canRead: z.boolean().optional(),
  canUpdate: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  canViewAll: z.boolean().optional(),
  canEditAll: z.boolean().optional(),
  viewAll: z.boolean().optional(),
  editAll: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one permission value is required');

async function getPermissionSetUserIds(permissionSetId: string) {
  const [directAssignments, profileAssignments, groupItems] = await Promise.all([
    prisma.userPermissionAssignment.findMany({
      where: { permissionSetId },
      select: { userId: true },
    }),
    prisma.profilePermissionSetAssignment.findMany({
      where: { permissionSetId },
      select: { profileId: true },
    }),
    prisma.permissionSetGroupItem.findMany({
      where: { permissionSetId },
      select: { groupId: true },
    }),
  ]);
  const [profileUsers, groupAssignments] = await Promise.all([
    profileAssignments.length
      ? prisma.user.findMany({
          where: { profileId: { in: profileAssignments.map(({ profileId }) => profileId) } },
          select: { id: true },
        })
      : Promise.resolve([]),
    groupItems.length
      ? prisma.userPermissionSetGroup.findMany({
          where: { groupId: { in: groupItems.map(({ groupId }) => groupId) } },
          select: { userId: true },
        })
      : Promise.resolve([]),
  ]);
  return [...new Set([
    ...directAssignments.map(({ userId }) => userId),
    ...profileUsers.map(({ id }) => id),
    ...groupAssignments.map(({ userId }) => userId),
  ])];
}

router.get('/', requirePermission('PERMISSION_SET_READ'), async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, search, isActive, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = { tenantId: req.tenantId! };
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const [permissionSets, total] = await Promise.all([
      prisma.newPermissionSet.findMany({
        where,
        include: {
          items: { include: { permission: true } },
          objectPermissions: { include: { object: { select: { id: true, name: true, label: true, isActive: true } } } },
          _count: { select: { userAssignments: true } },
        },
        skip,
        take: Number(limit),
        orderBy: { [sortBy as string]: sortOrder },
      }),
      prisma.newPermissionSet.count({ where }),
    ]);

    res.json({
      success: true,
      data: permissionSets,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get permission sets error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch permission sets' });
  }
});

router.get('/:id', requirePermission('PERMISSION_SET_READ'), async (req: AuthRequest, res: Response) => {
  try {
    const permissionSet = await prisma.newPermissionSet.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
      include: {
        items: { include: { permission: true } },
        objectPermissions: { include: { object: { select: { id: true, name: true, label: true, isActive: true } } } },
        userAssignments: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true } },
          },
        },
        _count: { select: { userAssignments: true } },
      },
    });

    if (!permissionSet) {
      return res.status(404).json({ success: false, error: 'Permission Set not found' });
    }

    res.json({ success: true, data: permissionSet });
  } catch (error) {
    console.error('Get permission set error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch permission set' });
  }
});

router.post('/', requirePermission('PERMISSION_SET_CREATE'), async (req: AuthRequest, res: Response) => {
  try {
    const data = permissionSetSchema.parse(req.body);
    const permissionIds = [...new Set(data.permissionIds)];

    const existing = await prisma.newPermissionSet.findFirst({
      where: { tenantId: req.tenantId!, name: data.name },
    });

    if (existing) {
      return res.status(409).json({ success: false, error: 'Permission Set with this name already exists' });
    }

    const validPermissions = await prisma.permission.findMany({
      where: { id: { in: permissionIds }, isActive: true },
    });

    if (validPermissions.length !== permissionIds.length) {
      return res.status(422).json({ success: false, error: 'One or more invalid permission IDs' });
    }

    const permissionSet = await prisma.newPermissionSet.create({
      data: {
        tenantId: req.tenantId!,
        name: data.name,
        description: data.description,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        items: {
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      include: {
        items: { include: { permission: true } },
        objectPermissions: { include: { object: { select: { id: true, name: true, label: true, isActive: true } } } },
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: 'CREATE',
        objectType: 'NewPermissionSet',
        objectId: permissionSet.id,
        newValues: { name: data.name, permissionCount: permissionIds.length },
      },
    });

    res.status(201).json({ success: true, data: permissionSet });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Create permission set error:', error);
    res.status(500).json({ success: false, error: 'Failed to create permission set' });
  }
});

router.put('/:id', requirePermission('PERMISSION_SET_UPDATE'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.newPermissionSet.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Permission Set not found' });
    }

    const data = updatePermissionSetSchema.parse(req.body);
    const permissionIds = data.permissionIds ? [...new Set(data.permissionIds)] : undefined;

    if (data.name && data.name !== existing.name) {
      const duplicate = await prisma.newPermissionSet.findFirst({
        where: { tenantId: req.tenantId!, name: data.name, id: { not: req.params.id } },
      });
      if (duplicate) {
        return res.status(409).json({ success: false, error: 'Permission Set with this name already exists' });
      }
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;

    await prisma.$transaction(async (tx) => {
      if (permissionIds) {
        const validPermissions = await tx.permission.findMany({
          where: { id: { in: permissionIds }, isActive: true },
        });
        if (validPermissions.length !== permissionIds.length) {
          throw new Error('Invalid permission IDs');
        }

        await tx.newPermissionSetItem.deleteMany({ where: { permissionSetId: req.params.id } });
        await tx.newPermissionSetItem.createMany({
          data: permissionIds.map((permissionId) => ({ permissionSetId: req.params.id, permissionId })),
        });
      }

      if (Object.keys(updateData).length > 0) {
        await tx.newPermissionSet.update({ where: { id: req.params.id }, data: updateData });
      }
    });

    const permissionSet = await prisma.newPermissionSet.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { permission: true } } },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: 'UPDATE',
        objectType: 'NewPermissionSet',
        objectId: req.params.id,
        oldValues: existing,
        newValues: data,
      },
    });

    EffectivePermissionService.invalidateUserPermissionsCache(await getPermissionSetUserIds(req.params.id));
    res.json({ success: true, data: permissionSet });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Update permission set error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to update permission set' });
  }
});

router.get('/:id/object-permissions/:object', requirePermission('PERMISSION_SET_READ'), async (req: AuthRequest, res: Response) => {
  try {
    const permissionSet = await prisma.newPermissionSet.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
      select: { id: true },
    });
    if (!permissionSet) {
      return res.status(404).json({ success: false, error: 'Permission Set not found' });
    }

    const object = await prisma.objectDefinition.findFirst({
      where: {
        tenantId: req.tenantId!,
        name: { equals: req.params.object, mode: 'insensitive' },
      },
    });
    if (!object) {
      return res.status(404).json({ success: false, error: 'Object not found' });
    }

    const permissions = await prisma.permissionSetObjectPermission.findUnique({
      where: { permissionSetId_objectId: { permissionSetId: permissionSet.id, objectId: object.id } },
    });
    return res.json({
      success: true,
      data: {
        ...(permissions ?? {
        permissionSetId: permissionSet.id,
        objectId: object.id,
        canCreate: false,
        canRead: false,
        canUpdate: false,
        canDelete: false,
        canViewAll: false,
        canEditAll: false,
        }),
        viewAll: permissions?.canViewAll ?? false,
        editAll: permissions?.canEditAll ?? false,
      },
    });
  } catch (error) {
    console.error('Get permission set object permissions error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch object permissions' });
  }
});

router.put('/:id/object-permissions/:object', requirePermission('PERMISSION_SET_UPDATE'), async (req: AuthRequest, res: Response) => {
  try {
    const input = objectPermissionUpdateSchema.parse(req.body);
    const permissionSet = await prisma.newPermissionSet.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
      select: { id: true, name: true },
    });
    if (!permissionSet) {
      return res.status(404).json({ success: false, error: 'Permission Set not found' });
    }

    const object = await prisma.objectDefinition.findFirst({
      where: {
        tenantId: req.tenantId!,
        name: { equals: req.params.object, mode: 'insensitive' },
      },
    });
    if (!object) {
      return res.status(404).json({ success: false, error: 'Object not found' });
    }

    const existing = await prisma.permissionSetObjectPermission.findUnique({
      where: { permissionSetId_objectId: { permissionSetId: permissionSet.id, objectId: object.id } },
    });
    const values = {
      canCreate: input.canCreate ?? existing?.canCreate ?? false,
      canRead: input.canRead ?? existing?.canRead ?? false,
      canUpdate: input.canUpdate ?? existing?.canUpdate ?? false,
      canDelete: input.canDelete ?? existing?.canDelete ?? false,
      canViewAll: input.canViewAll ?? input.viewAll ?? existing?.canViewAll ?? false,
      canEditAll: input.canEditAll ?? input.editAll ?? existing?.canEditAll ?? false,
    };
    if (input.canRead === false) {
      values.canViewAll = false;
      values.canEditAll = false;
    } else if (values.canEditAll) {
      values.canViewAll = true;
      values.canRead = true;
      values.canUpdate = true;
    } else if (values.canViewAll) {
      values.canRead = true;
    }

    const broadAccessChanged =
      values.canViewAll !== (existing?.canViewAll ?? false) ||
      values.canEditAll !== (existing?.canEditAll ?? false);
    const saved = await prisma.$transaction(async (tx) => {
      const permission = await tx.permissionSetObjectPermission.upsert({
        where: { permissionSetId_objectId: { permissionSetId: permissionSet.id, objectId: object.id } },
        create: { permissionSetId: permissionSet.id, objectId: object.id, ...values },
        update: values,
      });
      if (broadAccessChanged) {
        await tx.auditLog.create({
          data: {
            tenantId: req.tenantId!,
            userId: req.user!.id,
            action: 'BROAD_RECORD_ACCESS_CHANGED',
            objectType: 'PermissionSetObjectPermission',
            objectId: permission.id,
            oldValues: {
              permissionSetId: permissionSet.id,
              permissionSetName: permissionSet.name,
              objectName: object.name,
              canViewAll: existing?.canViewAll ?? false,
              canEditAll: existing?.canEditAll ?? false,
            },
            newValues: {
              permissionSetId: permissionSet.id,
              permissionSetName: permissionSet.name,
              objectName: object.name,
              canViewAll: values.canViewAll,
              canEditAll: values.canEditAll,
            },
          },
        });
      }
      return permission;
    });

    if (broadAccessChanged) {
      console.warn('Broad lead access permission changed', {
        tenantId: req.tenantId,
        actorUserId: req.user!.id,
        permissionSetId: permissionSet.id,
        permissionSetName: permissionSet.name,
        objectName: object.name,
        oldValues: {
          canViewAll: existing?.canViewAll ?? false,
          canEditAll: existing?.canEditAll ?? false,
        },
        newValues: { canViewAll: values.canViewAll, canEditAll: values.canEditAll },
      });
    }

    EffectivePermissionService.invalidateUserPermissionsCache(await getPermissionSetUserIds(permissionSet.id));
    return res.json({ success: true, data: saved });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.errors[0].message });
    }
    console.error('Set permission set object permissions error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save object permissions' });
  }
});

router.delete('/:id', requirePermission('PERMISSION_SET_DELETE'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await prisma.newPermissionSet.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
      include: { _count: { select: { userAssignments: true } } },
    });

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Permission Set not found' });
    }

    if (existing._count.userAssignments > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete Permission Set assigned to ${existing._count.userAssignments} user(s). Remove assignments first.`,
      });
    }

    const affectedUserIds = await getPermissionSetUserIds(req.params.id);
    await prisma.$transaction(async (tx) => {
      await tx.newPermissionSetItem.deleteMany({ where: { permissionSetId: req.params.id } });
      await tx.newPermissionSet.delete({ where: { id: req.params.id } });
    });
    EffectivePermissionService.invalidateUserPermissionsCache(affectedUserIds);

    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: 'DELETE',
        objectType: 'NewPermissionSet',
        objectId: req.params.id,
        oldValues: existing,
      },
    });

    res.json({ success: true, message: 'Permission Set deleted successfully' });
  } catch (error) {
    console.error('Delete permission set error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete permission set' });
  }
});

router.post('/:id/assign', requirePermission('PERMISSION_SET_ASSIGN'), async (req: AuthRequest, res: Response) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, error: 'userIds array is required' });
    }

    const permSet = await prisma.newPermissionSet.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
    });

    if (!permSet) {
      return res.status(404).json({ success: false, error: 'Permission Set not found' });
    }

    const validUsers = await prisma.user.findMany({
      where: { id: { in: userIds }, tenantId: req.tenantId! },
      select: { id: true },
    });

    const existingAssignments = await prisma.userPermissionAssignment.findMany({
      where: { permissionSetId: req.params.id, userId: { in: userIds } },
      select: { userId: true },
    });

    const existingUserIds = new Set(existingAssignments.map((a) => a.userId));
    const newUserIds = validUsers.map((u) => u.id).filter((id) => !existingUserIds.has(id));

    if (newUserIds.length > 0) {
      await prisma.userPermissionAssignment.createMany({
        data: newUserIds.map((userId) => ({ userId, permissionSetId: req.params.id })),
      });
      EffectivePermissionService.invalidateUserPermissionsCache(newUserIds);
    }

    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: 'ASSIGN',
        objectType: 'NewPermissionSet',
        objectId: req.params.id,
        newValues: { assignedUserIds: newUserIds, skippedUserIds: Array.from(existingUserIds) },
      },
    });

    res.json({
      success: true,
      data: { assigned: newUserIds.length, alreadyAssigned: existingUserIds.size },
    });
  } catch (error) {
    console.error('Assign permission set error:', error);
    res.status(500).json({ success: false, error: 'Failed to assign permission set' });
  }
});

router.delete('/:id/assign/:userId', requirePermission('PERMISSION_SET_ASSIGN'), async (req: AuthRequest, res: Response) => {
  try {
    const permSet = await prisma.newPermissionSet.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId! },
    });

    if (!permSet) {
      return res.status(404).json({ success: false, error: 'Permission Set not found' });
    }

    const deleted = await prisma.userPermissionAssignment.deleteMany({
      where: { permissionSetId: req.params.id, userId: req.params.userId },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ success: false, error: 'Assignment not found' });
    }
    EffectivePermissionService.invalidateUserPermissionsCache([req.params.userId]);

    await prisma.auditLog.create({
      data: {
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: 'UNASSIGN',
        objectType: 'NewPermissionSet',
        objectId: req.params.id,
        oldValues: { removedUserId: req.params.userId },
      },
    });

    res.json({ success: true, message: 'Permission Set unassigned successfully' });
  } catch (error) {
    console.error('Unassign permission set error:', error);
    res.status(500).json({ success: false, error: 'Failed to unassign permission set' });
  }
});

export { router as newPermissionSetRoutes };