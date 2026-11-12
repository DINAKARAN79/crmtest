import { prisma } from '@dct-crm/db';
import { EffectivePermissionService } from './effectivePermissions';
import { canAccessFollowUpRecord, followUpAccessWhere } from './followUpAccess';

export type AuthUserLike = {
  id: string;
  tenantId: string;
  isSuperAdmin?: boolean;
  isAdmin?: boolean;
  profileName?: string | null;
};

export type RecordScope =
  | { type: 'ALL' }
  | { type: 'OWNER'; userId: string };

async function hasLegacyViewAll(userId: string, objectName: string): Promise<boolean> {
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissionSets: {
            include: { permissionSet: true },
          },
        },
      },
    },
  });

  for (const userRole of userRoles) {
    for (const rolePerm of userRole.role.permissionSets) {
      if (rolePerm.permissionSet.objectName === objectName) {
        const permissions = rolePerm.permissionSet.permissions as {
          viewAll?: boolean;
          modifyAll?: boolean;
        };
        if (permissions?.viewAll || permissions?.modifyAll) return true;
      }
    }
  }
  return false;
}

export async function getRecordScope(
  user: AuthUserLike,
  objectName: string,
  moduleName: string,
): Promise<RecordScope> {
  if (user.isSuperAdmin || user.isAdmin) return { type: 'ALL' };

  const permsPromise = EffectivePermissionService.getEffectivePermissionsCached(user, user.id);
  const [perms, legacy] = await Promise.all([
    permsPromise,
    hasLegacyViewAll(user.id, objectName),
  ]);

  const viewAll = EffectivePermissionService.hasPermissionIn(perms, `${moduleName}_VIEW_ALL`);
  const modifyAll = EffectivePermissionService.hasPermissionIn(perms, `${moduleName}_MODIFY_ALL`);

  if (viewAll || modifyAll || legacy) return { type: 'ALL' };
  return { type: 'OWNER', userId: user.id };
}

export async function getLeadRecordScope(user: AuthUserLike): Promise<RecordScope> {
  if (user.isSuperAdmin || user.isAdmin) return { type: 'ALL' };
  if (await EffectivePermissionService.canViewAll(user.id, 'lead')) return { type: 'ALL' };
  return { type: 'OWNER', userId: user.id };
}

/** Owners see their own leads; explicit all-record scopes are handled separately. */
export function leadScopeClause(scope: RecordScope): Record<string, unknown> | null {
  if (scope.type === 'ALL') return null;
  return { ownerId: scope.userId };
}

export async function canAccessLead(
  user: AuthUserLike,
  lead: { id: string; tenantId: string; ownerId: string | null; creatorId?: string | null },
): Promise<boolean> {
  if (!user.isSuperAdmin && lead.tenantId !== user.tenantId) return false;
  const scope = await getLeadRecordScope(user);
  if (scope.type === 'ALL') return true;
  return lead.ownerId === scope.userId;
}

export async function canEditLead(
  user: AuthUserLike,
  lead: { id: string; tenantId: string; ownerId: string | null; creatorId?: string | null },
): Promise<boolean> {
  if (!(await canAccessLead(user, lead))) return false;
  if (user.isSuperAdmin || user.isAdmin) return true;
  if (await EffectivePermissionService.canEditAll(user.id, 'lead')) return true;
  const permissions = await EffectivePermissionService.getEffectivePermissionsCached(user, user.id);
  if (EffectivePermissionService.hasPermissionIn(permissions, 'LEAD_MODIFY_ALL')) return true;
  return lead.ownerId === user.id;
}

export async function canAccessLeadId(user: AuthUserLike, leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ...(user.isSuperAdmin ? {} : { tenantId: user.tenantId }) },
    select: { id: true, tenantId: true, ownerId: true, creatorId: true },
  });
  if (!lead) return false;
  return canAccessLead(user, lead);
}

export function ownerOwnedClause(userId: string): Record<string, unknown> {
  return { ownerId: userId };
}

export async function canAccessSiteVisit(
  user: AuthUserLike,
  sv: { id: string; tenantId: string; assigneeId: string | null; creatorId: string | null; leadId: string },
): Promise<boolean> {
  if (!user.isSuperAdmin && sv.tenantId !== user.tenantId) return false;
  const scope = await getRecordScope(user, 'SiteVisit', 'SITE_VISIT');
  if (scope.type === 'ALL') return true;
  if (sv.assigneeId === scope.userId || sv.creatorId === scope.userId) return true;
  return canAccessLeadId(user, sv.leadId);
}

export async function canAccessTask(
  user: AuthUserLike,
  task: { id: string; tenantId: string; ownerId: string | null; leadId: string | null },
): Promise<boolean> {
  if (!user.isSuperAdmin && task.tenantId !== user.tenantId) return false;
  const scope = await getRecordScope(user, 'Task', 'TASK');
  if (scope.type === 'ALL') return true;
  return task.ownerId === scope.userId;
}

export async function canAccessFollowUp(
  user: AuthUserLike,
  fu: { id: string; tenantId: string; ownerId: string | null; leadId: string | null },
): Promise<boolean> {
  return canAccessFollowUpRecord(user, fu);
}

export async function canAccessActivity(
  user: AuthUserLike,
  activity: { id: string; tenantId: string; userId: string | null; leadId: string | null },
): Promise<boolean> {
  if (activity.tenantId !== user.tenantId) return false;
  const scope = await getRecordScope(user, 'Activity', 'ACTIVITY');
  if (scope.type === 'ALL') return true;
  return activity.userId === scope.userId;
}

/** Merge a base where object with an optional scope clause using AND. */
export function withScope(
  where: Record<string, unknown>,
  scopeClause: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!scopeClause) return where;
  return { AND: [where, scopeClause] };
}

export type RecordKind =
  | 'lead'
  | 'siteVisit'
  | 'task'
  | 'followUp'
  | 'activity';

const builders: Record<
  RecordKind,
  (scope: RecordScope) => Record<string, unknown> | null
> = {
  lead: leadScopeClause,
  siteVisit: (scope) => {
    if (scope.type === 'ALL') return null;
    return {
      OR: [
        { assigneeId: scope.userId },
        { creatorId: scope.userId },
        { lead: leadScopeClause(scope) },
      ],
    };
  },
  task: (scope) => {
    if (scope.type === 'ALL') return null;
    return { ownerId: scope.userId };
  },
  followUp: (scope) => {
    if (scope.type === 'ALL') return null;
    return { ownerId: scope.userId };
  },
  activity: (scope) => {
    if (scope.type === 'ALL') return null;
    return { userId: scope.userId };
  },
};

export async function getScopeClause(
  user: AuthUserLike,
  kind: RecordKind,
): Promise<Record<string, unknown> | null> {
  if (kind === 'followUp') {
    const ownerId = followUpAccessWhere(user).ownerId;
    return ownerId ? { ownerId } : null;
  }
  const meta: Record<RecordKind, { objectName: string; moduleName: string }> = {
    lead: { objectName: 'Lead', moduleName: 'LEAD' },
    siteVisit: { objectName: 'SiteVisit', moduleName: 'SITE_VISIT' },
    task: { objectName: 'Task', moduleName: 'TASK' },
    followUp: { objectName: 'FollowUp', moduleName: 'FOLLOW_UP' },
    activity: { objectName: 'Activity', moduleName: 'ACTIVITY' },
  };
  return builders[kind](await getRecordScope(user, meta[kind].objectName, meta[kind].moduleName));
}

export async function getReportRecordAccessClause(
  user: AuthUserLike,
  objectName: string,
): Promise<Record<string, unknown> | null> {
  const normalized = objectName.replace(/[\s_-]/g, '').toLowerCase();
  const kinds: Record<string, RecordKind> = {
    lead: 'lead',
    sitevisit: 'siteVisit',
    task: 'task',
    followup: 'followUp',
    activity: 'activity',
  };
  const kind = kinds[normalized];
  if (kind) return getScopeClause(user, kind);
  if (normalized === 'calldetail') {
    const scope = await getRecordScope(user, 'Activity', 'ACTIVITY');
    if (scope.type === 'ALL') return null;
    return {
      OR: [
        { ownerId: scope.userId },
        { ownerId: null, createdById: scope.userId },
      ],
    };
  }
  return null;
}

/** Apply scope into a where clause with AND (preserves existing AND arrays). */
export function applyScope(
  where: Record<string, unknown>,
  scopeClause: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!scopeClause) return where;
  const existing = where.AND;
  if (Array.isArray(existing)) {
    return { ...where, AND: [...existing, scopeClause] };
  }
  return { ...where, AND: [scopeClause] };
}

/** Force report showMe for OWNER-scoped users. Frontend cannot override. */
export async function resolveReportShowMe(
  user: AuthUserLike,
  requested: unknown,
): Promise<'all' | 'mine'> {
  const scope = await getLeadRecordScope(user);
  if (scope.type === 'OWNER') return 'mine';
  return requested === 'mine' ? 'mine' : 'all';
}