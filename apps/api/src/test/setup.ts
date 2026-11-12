import { vi } from 'vitest';

vi.mock('@dct-crm/db', () => ({
  seedLeadFieldsForTenant: vi.fn().mockResolvedValue({ createdCount: 0, skippedCount: 0 }),
  seedSalesforceMetadataForTenant: vi.fn().mockResolvedValue({
    leadCount: 0,
    enquiryCount: 0,
    siteVisitCount: 0,
    taskCount: 0,
  }),
  seedUnitFieldsForTenant: vi.fn().mockResolvedValue(0),
  prisma: {
    tenant: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    lead: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    siteVisit: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    project: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    unit: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    task: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    followUp: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    activity: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    role: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    userRole: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
    permissionSet: { findMany: vi.fn() },
    $transaction: vi.fn((fns: any[]) => Promise.all(fns)),
    $disconnect: vi.fn(),
  },
}));
