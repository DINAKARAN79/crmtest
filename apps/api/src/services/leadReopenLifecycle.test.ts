import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  applyReopenedLeadSideEffects,
  getReopenedRoundRobinUserType,
  moveScheduledChildrenToLeadOwner,
} from './leadReopenLifecycle';
import { tagLeadFollowUpEvents } from './leadEventTagging';

vi.mock('./leadEventTagging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./leadEventTagging')>();
  return { ...actual, tagLeadFollowUpEvents: vi.fn() };
});

describe('Lead re-open lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['Sales', 'Sales'],
    ['Sales Executive', 'Sales'],
    ['Channel Partner', 'Channel Partner'],
    ['Pre Sales', 'Pre Sales'],
    [null, 'Pre Sales'],
  ] as const)('maps running profile %s to %s round robin', (profileName, expected) => {
    expect(getReopenedRoundRobinUserType(profileName)).toBe(expected);
  });

  it('removes old read shares, cancels scheduled children, and recalculates follow-up tags', async () => {
    const tx = {
      recordShare: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      followUp: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      siteVisit: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as Prisma.TransactionClient;

    await applyReopenedLeadSideEffects(tx, {
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      previousCustomFields: {
        sf_Pre_sales_user__c: 'user-pre',
        sf_Recovery_User__c: 'user-recovery',
      },
    });

    expect(tx.recordShare.deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        objectName: 'Lead',
        recordId: 'lead-1',
        userId: { in: ['user-pre', 'user-recovery'] },
        accessLevel: 'READ',
      },
    });
    expect(tx.followUp.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', leadId: 'lead-1', status: 'SCHEDULED' },
      data: {
        status: 'CANCELLED',
        description: 'Cancelled by System Automation as the lead is re-opened',
        isSystemCancelled: true,
      },
    });
    expect(tx.siteVisit.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', leadId: 'lead-1', status: 'SCHEDULED' },
      data: {
        status: 'CANCELLED',
        cancellationReason: 'Cancelled by System Automation as the lead is re-opened',
        cancelledAt: expect.any(Date),
      },
    });
    expect(tagLeadFollowUpEvents).toHaveBeenCalledWith(tx, 'tenant-1', 'lead-1');
  });

  it('does not remove unrelated or edit shares when no assigned users are recorded', async () => {
    const tx = {
      recordShare: { deleteMany: vi.fn() },
      followUp: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      siteVisit: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as Prisma.TransactionClient;

    await applyReopenedLeadSideEffects(tx, {
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      previousCustomFields: { sf_Pre_sales_user__c: null, sf_Recovery_User__c: null },
    });

    expect(tx.recordShare.deleteMany).not.toHaveBeenCalled();
  });

  it('moves scheduled follow-ups and site visits when a non-recovery Lead owner changes', async () => {
    const tx = {
      followUp: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      siteVisit: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    } as unknown as Prisma.TransactionClient;

    await moveScheduledChildrenToLeadOwner(tx, {
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      newOwnerId: 'new-owner',
      leadStatus: 'NEW',
      customFields: {},
    });

    expect(tx.followUp.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', leadId: 'lead-1', status: 'SCHEDULED' },
      data: { ownerId: 'new-owner', assignedToId: 'new-owner' },
    });
    expect(tx.siteVisit.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', leadId: 'lead-1', status: 'SCHEDULED' },
      data: { assigneeId: 'new-owner' },
    });
  });

  it.each([
    ['LOST', {}],
    ['NEW', { sf_Lead_Status__c: 'Recovery - Pre Sales' }],
    ['NEW', { sf_Lead_Status__c: 'Recovery - Sales' }],
  ])('does not move scheduled children for recovery state %s', async (leadStatus, customFields) => {
    const tx = {
      followUp: { updateMany: vi.fn() },
      siteVisit: { updateMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    await moveScheduledChildrenToLeadOwner(tx, {
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      newOwnerId: 'new-owner',
      leadStatus,
      customFields,
    });

    expect(tx.followUp.updateMany).not.toHaveBeenCalled();
    expect(tx.siteVisit.updateMany).not.toHaveBeenCalled();
  });
});
