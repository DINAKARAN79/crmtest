import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  DuplicateScheduledFollowUpError,
  ensureNoDuplicateScheduledFollowUp,
  futureFollowUpError,
  getNextFollowUpNumber,
} from './followUpService';

describe('futureFollowUpError', () => {
  const now = new Date('2026-10-17T10:00:00.000Z').getTime();

  it('rejects a past or current follow-up time', () => {
    expect(futureFollowUpError('2026-10-17T09:59:00.000Z', now)).toBe('Follow-up can only be scheduled for a future date and time.');
    expect(futureFollowUpError('2026-10-17T10:00:00.000Z', now)).toBe('Follow-up can only be scheduled for a future date and time.');
  });

  it('accepts a future follow-up time', () => {
    expect(futureFollowUpError('2026-10-17T10:01:00.000Z', now)).toBeNull();
  });

  it('rejects an invalid follow-up time', () => {
    expect(futureFollowUpError('not-a-date', now)).toBe('Follow-up date and time are invalid.');
  });
});

describe('getNextFollowUpNumber', () => {
  it('creates tenant-scoped, six-digit follow-up numbers', async () => {
    const upsert = vi.fn().mockResolvedValue({ nextValue: 1 });
    const db = { sequence: { upsert } } as unknown as Prisma.TransactionClient;

    await expect(getNextFollowUpNumber(db, 'tenant-1')).resolves.toBe('FU-000001');
    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId_type: { tenantId: 'tenant-1', type: 'FOLLOW_UP' } },
      update: { nextValue: { increment: 1 } },
      create: { tenantId: 'tenant-1', type: 'FOLLOW_UP', nextValue: 1 },
    });
  });

  describe('ensureNoDuplicateScheduledFollowUp', () => {
    it('locks the Lead schedule and excludes the record being updated', async () => {
      const executeRaw = vi.fn().mockResolvedValue(1);
      const findFirst = vi.fn().mockResolvedValue(null);
      const db = {
        $executeRaw: executeRaw,
        followUp: { findFirst },
      } as unknown as Prisma.TransactionClient;

      await expect(ensureNoDuplicateScheduledFollowUp(db, {
        tenantId: 'tenant-1',
        leadId: 'lead-1',
        excludeId: 'follow-up-1',
      })).resolves.toBeUndefined();

      expect(executeRaw).toHaveBeenCalledOnce();
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          leadId: 'lead-1',
          status: 'SCHEDULED',
          id: { not: 'follow-up-1' },
        },
        select: { id: true },
      });
    });

    it('rejects another active scheduled FollowUp', async () => {
      const db = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        followUp: { findFirst: vi.fn().mockResolvedValue({ id: 'existing-follow-up' }) },
      } as unknown as Prisma.TransactionClient;

      await expect(ensureNoDuplicateScheduledFollowUp(db, {
        tenantId: 'tenant-1',
        leadId: 'lead-1',
      })).rejects.toBeInstanceOf(DuplicateScheduledFollowUpError);
    });
  });

  it('keeps numbers longer than six digits intact', async () => {
    const db = { sequence: { upsert: vi.fn().mockResolvedValue({ nextValue: 266162 }) } } as unknown as Prisma.TransactionClient;

    await expect(getNextFollowUpNumber(db, 'tenant-1')).resolves.toBe('FU-266162');
  });
});
