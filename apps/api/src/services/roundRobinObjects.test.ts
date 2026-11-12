import { describe, expect, it, vi } from 'vitest';
import { ensureRoundRobinObjects } from './roundRobinObjects';

describe('ensureRoundRobinObjects', () => {
  it('creates Object Manager definitions using the live round-robin fields', async () => {
    const objects = new Map<string, { id: string }>();
    const createdFields: Array<{ objectId: string; name: string; label: string; fieldType: string; lookupObject?: string }> = [];
    const db = {
      objectDefinition: {
        findFirst: vi.fn(async ({ where }: { where: { name: string } }) => objects.get(where.name) || null),
        create: vi.fn(async ({ data }: { data: { name: string } }) => {
          const object = { id: `object-${data.name}` };
          objects.set(data.name, object);
          return object;
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      fieldDefinition: {
        createMany: vi.fn(async ({ data }: { data: typeof createdFields }) => {
          createdFields.push(...data);
          return { count: data.length };
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      pageLayout: {
        findFirst: vi.fn().mockResolvedValue({ id: 'existing-layout' }),
      },
      profile: { findMany: vi.fn().mockResolvedValue([{ id: 'admin-profile' }]) },
      role: { findFirst: vi.fn().mockResolvedValue(null) },
      profileObjectPermission: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as never;

    await ensureRoundRobinObjects(db, 'tenant-1', 'admin-1');

    expect([...objects.keys()]).toEqual(['RRQueue', 'RRQueueMember']);
    expect(createdFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectId: 'object-RRQueue', name: 'active', label: 'Active' }),
      expect.objectContaining({ objectId: 'object-RRQueue', name: 'leadSource', fieldType: 'multiPicklist' }),
      expect.objectContaining({ objectId: 'object-RRQueue', name: 'projectId', lookupObject: 'Project' }),
      expect.objectContaining({ objectId: 'object-RRQueue', name: 'category', label: 'Type', fieldType: 'multiPicklist' }),
      expect.objectContaining({ objectId: 'object-RRQueueMember', name: 'rrQueueId', lookupObject: 'RRQueue' }),
      expect.objectContaining({ objectId: 'object-RRQueueMember', name: 'userId', lookupObject: 'User' }),
      expect.objectContaining({ objectId: 'object-RRQueueMember', name: 'userType', label: 'User Type' }),
      expect.objectContaining({ objectId: 'object-RRQueueMember', name: 'lastAssignedAt', label: 'Last Assigned Time' }),
    ]));
  });
});
