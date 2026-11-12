import type { Prisma } from '@prisma/client';
import { asCustomFieldObject, tagLeadFollowUpEvents } from './leadEventTagging';

type Db = Prisma.TransactionClient;

export const REOPENED_FOLLOW_UP_CANCELLATION_REASON =
  'Cancelled by System Automation as the lead is re-opened';

export const REOPENED_SITE_VISIT_CANCELLATION_REASON =
  'Cancelled by System Automation as the lead is re-opened';

export function getReopenedRoundRobinUserType(profileName?: string | null) {
  const profile = profileName?.trim().toLowerCase();
  if (profile === 'sales' || profile?.startsWith('sales ')) return 'Sales' as const;
  if (profile === 'channel partner') return 'Channel Partner' as const;
  return 'Pre Sales' as const;
}

export async function moveScheduledChildrenToLeadOwner(
  tx: Db,
  params: {
    tenantId: string;
    leadId: string;
    newOwnerId: string;
    leadStatus: string;
    customFields: Prisma.JsonValue | null;
  },
): Promise<void> {
  const legacyStatus = asCustomFieldObject(params.customFields).sf_Lead_Status__c;
  if (
    params.leadStatus === 'LOST'
    || legacyStatus === 'Recovery - Pre Sales'
    || legacyStatus === 'Recovery - Sales'
  ) return;

  await tx.followUp.updateMany({
    where: { tenantId: params.tenantId, leadId: params.leadId, status: 'SCHEDULED' },
    data: { ownerId: params.newOwnerId, assignedToId: params.newOwnerId },
  });
  await tx.siteVisit.updateMany({
    where: { tenantId: params.tenantId, leadId: params.leadId, status: 'SCHEDULED' },
    data: { assigneeId: params.newOwnerId },
  });
}

export async function applyReopenedLeadSideEffects(
  tx: Db,
  params: {
    tenantId: string;
    leadId: string;
    previousCustomFields: Prisma.JsonValue | null;
  },
): Promise<void> {
  const previousFields = asCustomFieldObject(params.previousCustomFields);
  const oldShareUserIds = [
    previousFields.sf_Pre_sales_user__c,
    previousFields.sf_Recovery_User__c,
  ].filter((userId): userId is string => typeof userId === 'string' && Boolean(userId.trim()));
  const uniqueShareUserIds = [...new Set(oldShareUserIds.map((userId) => userId.trim()))];

  if (uniqueShareUserIds.length) {
    await tx.recordShare.deleteMany({
      where: {
        tenantId: params.tenantId,
        objectName: 'Lead',
        recordId: params.leadId,
        userId: { in: uniqueShareUserIds },
        accessLevel: 'READ',
      },
    });
  }

  await tx.followUp.updateMany({
    where: { tenantId: params.tenantId, leadId: params.leadId, status: 'SCHEDULED' },
    data: {
      status: 'CANCELLED',
      description: REOPENED_FOLLOW_UP_CANCELLATION_REASON,
      isSystemCancelled: true,
    },
  });
  await tx.siteVisit.updateMany({
    where: { tenantId: params.tenantId, leadId: params.leadId, status: 'SCHEDULED' },
    data: {
      status: 'CANCELLED',
      cancellationReason: REOPENED_SITE_VISIT_CANCELLATION_REASON,
      cancelledAt: new Date(),
    },
  });

  await tagLeadFollowUpEvents(tx, params.tenantId, params.leadId);
}
