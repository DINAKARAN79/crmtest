import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  objectFindFirst: vi.fn(),
  profileFindFirst: vi.fn(),
  profilePermissionFindMany: vi.fn(),
  profilePermissionUpsert: vi.fn(),
  userFindMany: vi.fn(),
}));

const permissionService = vi.hoisted(() => ({
  invalidateUserPermissionsCache: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    objectDefinition: { findFirst: database.objectFindFirst },
    profile: { findFirst: database.profileFindFirst },
    profileObjectPermission: {
      findMany: database.profilePermissionFindMany,
      upsert: database.profilePermissionUpsert,
    },
    user: { findMany: database.userFindMany },
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: ExpressResponse, next: NextFunction) => {
    Object.assign(req, { user: { id: 'admin-1', tenantId: 'tenant-1' }, tenantId: 'tenant-1' });
    next();
  },
}));

vi.mock('../middleware/permissions', () => ({
  requirePermission: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
}));

vi.mock('../services/userObjectAccess', () => ({
  denyUnlessUserObjectAdmin: () => false,
}));

vi.mock('../services/metadata', () => ({
  invalidateCache: vi.fn(),
}));

vi.mock('../services/effectivePermissions', () => ({
  EffectivePermissionService: permissionService,
}));

import { objectPermissionRoutes } from './objectPermissions';

const servers: Server[] = [];

async function request(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api/object-permissions', objectPermissionRoutes);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  database.objectFindFirst.mockResolvedValue({ id: 'object-1', name: 'Lead' });
  database.profileFindFirst.mockResolvedValue({ id: 'profile-1' });
  database.profilePermissionFindMany.mockResolvedValue([]);
  database.profilePermissionUpsert.mockResolvedValue({
    id: 'permission-1',
    profileId: 'profile-1',
    canCreate: true,
  });
  database.userFindMany.mockResolvedValue([{ id: 'user-1' }]);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('CRM profile object permissions', () => {
  it('lists permissions associated with CRM profiles', async () => {
    const profilePermission = {
      profileId: 'profile-1',
      profile: { id: 'profile-1', name: 'Pre Sales' },
    };
    database.profilePermissionFindMany.mockResolvedValue([profilePermission]);

    const response = await request('/api/object-permissions/Lead');
    const body = await response.json() as { data: unknown[] };

    expect(response.status).toBe(200);
    expect(body.data).toEqual([profilePermission]);
    expect(database.profilePermissionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', objectId: 'object-1' },
      include: { profile: { select: { id: true, name: true } } },
    }));
  });

  it('saves permission flags by CRM profile and invalidates assigned users', async () => {
    const response = await request('/api/object-permissions/Lead', 'POST', {
      profileId: 'profile-1',
      canCreate: true,
      canRead: true,
      canUpdate: false,
      canDelete: false,
    });

    expect(response.status).toBe(200);
    expect(database.profilePermissionUpsert).toHaveBeenCalledWith({
      where: { profileId_objectId: { profileId: 'profile-1', objectId: 'object-1' } },
      create: {
        tenantId: 'tenant-1',
        profileId: 'profile-1',
        objectId: 'object-1',
        canCreate: true,
        canRead: true,
        canUpdate: false,
        canDelete: false,
        viewAll: false,
        modifyAll: false,
      },
      update: {
        canCreate: true,
        canRead: true,
        canUpdate: false,
        canDelete: false,
        viewAll: false,
        modifyAll: false,
      },
    });
    expect(permissionService.invalidateUserPermissionsCache).toHaveBeenCalledWith(['user-1']);
  });

  it('rejects a profile outside the current tenant', async () => {
    database.profileFindFirst.mockResolvedValue(null);

    const response = await request('/api/object-permissions/Lead', 'POST', {
      profileId: 'foreign-profile',
      canRead: true,
    });
    const body = await response.json() as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('CRM Profile not found');
    expect(database.profilePermissionUpsert).not.toHaveBeenCalled();
  });
});
