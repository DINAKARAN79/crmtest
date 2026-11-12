import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  auditLogFindFirst: vi.fn(),
  rrQueueHistoryFindFirst: vi.fn(),
  siteVisitFindFirst: vi.fn(),
  userRoleFindMany: vi.fn(),
  canViewAll: vi.fn(),
  canEditAll: vi.fn(),
}));

vi.mock('@dct-crm/db', () => ({
  prisma: {
    auditLog: { findFirst: db.auditLogFindFirst },
    rRQueueHistory: { findFirst: db.rrQueueHistoryFindFirst },
    siteVisit: { findFirst: db.siteVisitFindFirst },
    userRole: { findMany: db.userRoleFindMany },
  },
}));

vi.mock('./effectivePermissions', () => ({
  EffectivePermissionService: {
    getEffectivePermissionsCached: vi.fn().mockResolvedValue([]),
    hasPermissionIn: vi.fn().mockReturnValue(false),
    canViewAll: db.canViewAll,
    canEditAll: db.canEditAll,
  },
}));

import {
  canAccessLead,
  canEditLead,
  getLeadRecordScope,
  getReportRecordAccessClause,
  getScopeClause,
  leadScopeClause,
} from './recordAccess';

describe('owner-scoped record access', () => {
  const user = { id: 'user-a', tenantId: 'tenant-a' };
  const lead = { id: 'lead-a', tenantId: 'tenant-a', ownerId: 'other-user' };

  beforeEach(() => {
    vi.clearAllMocks();
    db.auditLogFindFirst.mockResolvedValue(null);
    db.rrQueueHistoryFindFirst.mockResolvedValue(null);
    db.siteVisitFindFirst.mockResolvedValue(null);
    db.userRoleFindMany.mockResolvedValue([]);
    db.canViewAll.mockResolvedValue(false);
    db.canEditAll.mockResolvedValue(false);
  });

  it('limits owner-scoped lead queries to leads owned by the current user', () => {
    expect(leadScopeClause({ type: 'OWNER', userId: user.id })).toEqual({ ownerId: user.id });
  });

  it('allows the lead owner to read and edit, but does not grant handoff users access', async () => {
    await expect(canAccessLead(user, { ...lead, ownerId: user.id })).resolves.toBe(true);
    await expect(canEditLead(user, { ...lead, ownerId: user.id })).resolves.toBe(true);

    db.auditLogFindFirst.mockResolvedValue({ id: 'push-log' });

    await expect(canAccessLead(user, lead)).resolves.toBe(false);
    await expect(canEditLead(user, lead)).resolves.toBe(false);
  });

  it('does not grant a scheduled site-visit assignee access to another owner lead', async () => {
    db.siteVisitFindFirst.mockResolvedValue({ id: 'scheduled-visit' });

    await expect(canAccessLead(user, lead)).resolves.toBe(false);
    await expect(canEditLead(user, lead)).resolves.toBe(false);
  });

  it('does not grant a recorded SVC/Sales recipient access to another owner’s lead', async () => {
    db.rrQueueHistoryFindFirst.mockResolvedValue({ id: 'assignment' });

    await expect(canAccessLead(user, lead)).resolves.toBe(false);
    await expect(canEditLead(user, lead)).resolves.toBe(false);
  });

  it('does not grant access to users without a handoff or active site-visit share', async () => {
    await expect(canAccessLead(user, lead)).resolves.toBe(false);
    await expect(canEditLead(user, lead)).resolves.toBe(false);
  });

  it('keeps ordinary users owner-scoped', async () => {
    await expect(getLeadRecordScope(user)).resolves.toEqual({ type: 'OWNER', userId: user.id });
  });

  it('lets View All read every tenant lead but does not permit editing', async () => {
    db.canViewAll.mockResolvedValue(true);

    await expect(getLeadRecordScope(user)).resolves.toEqual({ type: 'ALL' });
    await expect(canAccessLead(user, lead)).resolves.toBe(true);
    await expect(canEditLead(user, lead)).resolves.toBe(false);
  });

  it('lets Edit All update any lead when base read/update permissions are effective', async () => {
    db.canViewAll.mockResolvedValue(true);
    db.canEditAll.mockResolvedValue(true);

    await expect(canAccessLead(user, lead)).resolves.toBe(true);
    await expect(canEditLead(user, lead)).resolves.toBe(true);
  });

  it('does not let all-leads grants cross tenant boundaries', async () => {
    db.canViewAll.mockResolvedValue(true);
    db.canEditAll.mockResolvedValue(true);

    await expect(canAccessLead(user, { ...lead, tenantId: 'other-tenant' })).resolves.toBe(false);
    await expect(canEditLead(user, { ...lead, tenantId: 'other-tenant' })).resolves.toBe(false);
  });

  it('keeps task and activity scopes owner-based even when the user can view all leads', async () => {
    db.canViewAll.mockResolvedValue(true);

    await expect(getScopeClause(user, 'activity')).resolves.toEqual({ userId: user.id });
    await expect(getScopeClause(user, 'task')).resolves.toEqual({ ownerId: user.id });
  });

  it('scopes Call Detail reports to the call owner', async () => {
    await expect(getReportRecordAccessClause(user, 'Call Detail')).resolves.toEqual({
      OR: [
        { ownerId: user.id },
        { ownerId: null, createdById: user.id },
      ],
    });
  });
});
