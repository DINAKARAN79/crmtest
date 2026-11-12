import express from 'express';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  newPermissionSetFindFirst: vi.fn(),
  objectDefinitionFindFirst: vi.fn(),
  permissionFindUnique: vi.fn(),
  permissionUpsert: vi.fn(),
  auditCreate: vi.fn(),
  userAssignmentFindMany: vi.fn(),
  profileAssignmentFindMany: vi.fn(),
  groupItemFindMany: vi.fn(),
  userFindMany: vi.fn(),
  userGroupFindMany: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    newPermissionSet: { findFirst: db.newPermissionSetFindFirst },
    objectDefinition: { findFirst: db.objectDefinitionFindFirst },
    permissionSetObjectPermission: {
      findUnique: db.permissionFindUnique,
      upsert: db.permissionUpsert,
    },
    auditLog: { create: db.auditCreate },
    userPermissionAssignment: { findMany: db.userAssignmentFindMany },
    profilePermissionSetAssignment: { findMany: db.profileAssignmentFindMany },
    permissionSetGroupItem: { findMany: db.groupItemFindMany },
    user: { findMany: db.userFindMany },
    userPermissionSetGroup: { findMany: db.userGroupFindMany },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
      permissionSetObjectPermission: { upsert: db.permissionUpsert },
      auditLog: { create: db.auditCreate },
    }),
  },
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: Request, _res: ExpressResponse, next: NextFunction) => {
    Object.assign(req, { user: { id: 'admin-1' }, tenantId: 'tenant-1' });
    next();
  },
}));

vi.mock('../middleware/permissions', () => ({
  requirePermission: () => (_req: Request, _res: ExpressResponse, next: NextFunction) => next(),
}));

vi.mock('../services/effectivePermissions', () => ({
  EffectivePermissionService: { invalidateUserPermissionsCache: db.invalidate },
}));

import { newPermissionSetRoutes } from './permissionSets';

const servers: Server[] = [];

async function request(method: 'GET' | 'PUT', body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api/new-permission-sets', newPermissionSetRoutes);
  const server = app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return fetch(`http://127.0.0.1:${address.port}/api/new-permission-sets/set-1/object-permissions/Lead`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.newPermissionSetFindFirst.mockResolvedValue({ id: 'set-1', name: 'Lead Editors' });
  db.objectDefinitionFindFirst.mockResolvedValue({ id: 'lead-object', name: 'Lead' });
  db.permissionFindUnique.mockResolvedValue(null);
  db.permissionUpsert.mockImplementation(async ({ create, update }: any) => ({ id: 'object-permission-1', ...create, ...update }));
  db.auditCreate.mockResolvedValue({});
  db.userAssignmentFindMany.mockResolvedValue([{ userId: 'user-1' }]);
  db.profileAssignmentFindMany.mockResolvedValue([]);
  db.groupItemFindMany.mockResolvedValue([]);
  db.userFindMany.mockResolvedValue([]);
  db.userGroupFindMany.mockResolvedValue([]);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('Permission Set all-leads object permissions', () => {
  it('auto-enables Read, Update, and View All when Edit All is enabled and audits the grant', async () => {
    const response = await request('PUT', { canEditAll: true });
    const body = await response.json() as { data: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(db.permissionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        canRead: true,
        canUpdate: true,
        canViewAll: true,
        canEditAll: true,
      }),
    }));
    expect(db.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'BROAD_RECORD_ACCESS_CHANGED',
        objectType: 'PermissionSetObjectPermission',
        userId: 'admin-1',
        oldValues: expect.objectContaining({ canViewAll: false, canEditAll: false }),
        newValues: expect.objectContaining({ canViewAll: true, canEditAll: true }),
      }),
    }));
    expect(body.data).toMatchObject({ canRead: true, canUpdate: true, canViewAll: true, canEditAll: true });
    expect(db.invalidate).toHaveBeenCalledWith(['user-1']);
  });

  it('clears both broad grants when Read is explicitly turned off', async () => {
    db.permissionFindUnique.mockResolvedValue({
      id: 'object-permission-1',
      canCreate: false,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      canViewAll: true,
      canEditAll: true,
    });

    const response = await request('PUT', { canRead: false });

    expect(response.status).toBe(200);
    expect(db.permissionUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ canRead: false, canViewAll: false, canEditAll: false }),
    }));
  });

  it('returns viewAll and editAll aliases on GET', async () => {
    db.permissionFindUnique.mockResolvedValue({ canViewAll: true, canEditAll: false });

    const response = await request('GET');
    const body = await response.json() as { data: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ viewAll: true, editAll: false });
  });
});
