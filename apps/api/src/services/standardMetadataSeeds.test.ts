import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { seedLeadFieldsForTenant } from '../../../../packages/db/src/seed-lead-fields';
import { seedUnitFieldsForTenant } from '../../../../packages/db/src/seed-unit-fields';

describe('standard metadata seeders', () => {
  it('preserves existing Lead field settings, picklist values, and layout sections', async () => {
    const tx = {
      objectDefinition: {
        findFirst: vi.fn().mockResolvedValue({ id: 'lead-object', objectType: 'standard' }),
      },
      fieldDefinition: {
        findMany: vi.fn(async ({ where }: { where: { name: { in: string[] } } }) => (
          where.name.in.map((name) => ({ id: `field-${name}`, name }))
        )),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn(),
        update: vi.fn(),
      },
      picklistValue: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
      pageLayout: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'lead-layout',
          sections: [
            { name: 'Tenant Section', fields: ['tenantCustomField'] },
            { name: 'Contact Information', fields: ['tenantContactField'] },
          ],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;

    const result = await seedLeadFieldsForTenant(tx, 'tenant-id', 'user-id');

    expect(result.createdCount).toBe(0);
    expect(result.skippedCount).toBeGreaterThan(0);
    expect(tx.fieldDefinition.update).not.toHaveBeenCalled();
    expect(tx.fieldDefinition.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [],
      skipDuplicates: true,
    }));
    expect(tx.picklistValue.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
    }));

    const updatedSections = vi.mocked(tx.pageLayout.update).mock.calls[0]?.[0]?.data.sections;
    expect(updatedSections).toEqual(expect.arrayContaining([
      { name: 'Tenant Section', fields: ['tenantCustomField'] },
      expect.objectContaining({
        name: 'Contact Information',
        fields: expect.arrayContaining(['tenantContactField', 'salutation', 'firstName']),
      }),
    ]));
  });

  it('adds Unit metadata without deleting tenant fields or replacing layout sections', async () => {
    const tx = {
      objectDefinition: {
        findFirst: vi.fn().mockResolvedValue({ id: 'unit-object', isActive: true }),
      },
      fieldDefinition: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([
          { id: 'status-field', name: 'Status__c' },
          { id: 'type-field', name: 'Unit_Type__c' },
        ]),
      },
      picklistValue: { upsert: vi.fn().mockResolvedValue({}) },
      pageLayout: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'unit-layout',
          sections: [
            { name: 'Tenant Section', fields: ['tenantCustomField'] },
            { name: 'Unit Information', fields: ['tenantUnitField'] },
          ],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    } as unknown as Prisma.TransactionClient;

    const createdCount = await seedUnitFieldsForTenant(tx, 'tenant-id', 'user-id');

    expect(createdCount).toBe(0);
    expect(tx.fieldDefinition.createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
    }));
    expect(tx.picklistValue.upsert).toHaveBeenCalled();
    expect(vi.mocked(tx.picklistValue.upsert).mock.calls.every(([args]) => (
      Object.keys(args.update).length === 0
    ))).toBe(true);

    const updatedSections = vi.mocked(tx.pageLayout.update).mock.calls[0]?.[0]?.data.sections;
    expect(updatedSections).toEqual(expect.arrayContaining([
      { name: 'Tenant Section', fields: ['tenantCustomField'] },
      expect.objectContaining({
        name: 'Unit Information',
        fields: expect.arrayContaining(['tenantUnitField', 'Name']),
      }),
    ]));
  });
});
