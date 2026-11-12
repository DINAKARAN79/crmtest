import { describe, expect, it } from 'vitest';
import {
  createCondition,
  validateFilterTree,
  validateReportRequest,
  parseFilterExpression,
  canAccessReportForUser,
  canAccessDashboardForUser,
  canViewDashboardByProfile,
  canViewDashboardFromProfileHomepage,
  canViewEmbeddedDashboardReport,
  canAccessReportFolderForUser,
} from './report-engine';

describe('createCondition', () => {
  it('keeps string operators for string fields', () => {
    expect(createCondition({ type: 'string', label: 'Name', path: 'name' }, 'startsWith', 'John')).toEqual({
      startsWith: 'John',
      mode: 'insensitive',
    });
  });

  it('falls back to exact matches for numeric fields when string-like operators are used', () => {
    expect(createCondition({ type: 'number', label: 'Amount', path: 'amount' }, 'startsWith', '10')).toEqual({
      equals: 10,
    });
  });

  it('avoids invalid date objects for blank date filters', () => {
    expect(createCondition({ type: 'date', label: 'Expected Close Date', path: 'expectedCloseDate' }, 'notEquals', '')).toEqual({
      not: null,
    });
  });

  it('interprets custom report date ranges in the tenant timezone', () => {
    expect(createCondition(
      { type: 'date', label: 'Created Date', path: 'createdAt' },
      'customRange',
      { start: '2026-07-01', end: '2026-07-01' },
      'America/New_York',
    )).toEqual({
      gte: new Date('2026-07-01T04:00:00.000Z'),
      lt: new Date('2026-07-02T04:00:00.000Z'),
    });
  });
});

describe('report validation', () => {
  it('parses nested filter logic with current filter numbers', () => {
    expect(parseFilterExpression('1 AND (2 OR 3)', 3)).toEqual({
      type: 'AND',
      conditions: [
        { filterIndex: 0 },
        { type: 'OR', conditions: [{ filterIndex: 1 }, { filterIndex: 2 }] },
      ],
    });
    expect(() => parseFilterExpression('1 AND (2', 2)).toThrow(/parenthesis/i);
  });

  it('rejects invalid field and operator combinations', () => {
    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'Lead',
      columns: ['status'],
      filters: [{ field: 'amount', operator: 'contains', value: '1000' }],
    })).toThrow(/Invalid operator|Unknown report field/i);
  });

  it('supports Lead Interest as a report column and filter', () => {
    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'Lead',
      columns: ['leadInterest'],
      filters: [{ field: 'leadInterest', operator: 'equals', value: 'HOT' }],
    })).not.toThrow();
  });

  it('rejects invalid custom date ranges', () => {
    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'Lead',
      columns: ['createdAt'],
      filters: [{ field: 'createdAt', operator: 'customRange', value: { start: '2026-08-20', end: '2026-08-10' } }],
    })).toThrow(/Custom date range start must be before end/i);
  });

  it('rejects filter trees deeper than the maximum allowed depth', () => {
    let deepTree: any = { type: 'AND', conditions: [{ type: 'Condition', field: 'status', operator: 'equals', value: 'NEW' }] };
    for (let index = 0; index < 6; index += 1) {
      deepTree = { type: 'AND', conditions: [deepTree] };
    }

    expect(() => validateFilterTree(deepTree)).toThrow(/Filter depth exceeded/i);
  });

  it('accepts project, booking, call, task, and round-robin report columns', () => {
    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'Project',
      columns: ['name', 'city', 'totalUnits'],
    })).not.toThrow();

    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'Booking',
      columns: ['bookingNumber', 'status', 'projectName', 'ownerName', 'bookingAmount'],
    })).not.toThrow();

    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'CallDetail',
      columns: ['name', 'callType', 'duration', 'leadName', 'ownerName'],
    })).not.toThrow();

    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'FollowUp',
      columns: ['followUpNumber', 'title', 'status', 'ownerName'],
      groupBy: 'status',
    })).not.toThrow();

    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'Lead',
      columns: ['ownerName', 'rrQueueName', 'count'],
      rowGroups: ['ownerName', 'rrQueueName'],
    })).not.toThrow();

    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'RRQueueMember',
      columns: ['userName', 'queueName', 'currentLeadCount'],
    })).not.toThrow();
  });

  it('accepts the virtual count column used by summary reports', () => {
    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'Lead',
      columns: ['status', 'count'],
      groupBy: 'status',
    })).not.toThrow();
  });

  it('still rejects unknown non-virtual columns', () => {
    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'Lead',
      columns: ['status', 'notARealField'],
    })).toThrow(/Unknown report column/i);
  });

  it('limits grouping axes to two fields and prevents cross-axis duplicates', () => {
    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'Lead',
      columns: ['status'],
      rowGroups: ['status', 'source', 'createdAt'],
    })).toThrow(/up to 2 row groupings/i);

    expect(() => validateReportRequest({
      tenantId: 'tenant-1',
      objectName: 'Lead',
      columns: ['status'],
      rowGroups: ['status'],
      columnGroups: ['status'],
    })).toThrow(/both rows and columns/i);
  });

  it('grants access only to own or shared reports when the user has report permissions', () => {
    expect(canAccessReportForUser({
      createdBy: 'user-1',
      isShared: false,
      tenantId: 'tenant-1',
    }, {
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
    }, ['REPORT_VIEW'])).toBe(true);

    expect(canAccessReportForUser({
      createdBy: 'user-2',
      isShared: true,
      tenantId: 'tenant-1',
    }, {
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
    }, ['REPORT_VIEW'])).toBe(true);

    expect(canAccessReportForUser({
      createdBy: 'user-2',
      isShared: false,
      tenantId: 'tenant-1',
    }, {
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
    }, ['REPORT_VIEW'])).toBe(false);
  });

  it('grants access to dashboards only for their owner or default dashboards with dashboard permissions', () => {
    expect(canAccessDashboardForUser({
      createdBy: 'user-1',
      isDefault: false,
      tenantId: 'tenant-1',
    }, {
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
    }, ['DASHBOARD_READ'])).toBe(true);

    expect(canAccessDashboardForUser({
      createdBy: 'user-2',
      isDefault: true,
      tenantId: 'tenant-1',
    }, {
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
    }, ['DASHBOARD_READ'])).toBe(true);

    expect(canAccessDashboardForUser({
      createdBy: 'user-2',
      isDefault: false,
      tenantId: 'tenant-1',
    }, {
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
    }, ['DASHBOARD_READ'])).toBe(false);
  });

  it('lets Dashboard Read users view shared dashboards but not other users’ private dashboards', () => {
    const user = { id: 'user-1', tenantId: 'tenant-1', isSuperAdmin: false };
    expect(canAccessDashboardForUser({
      createdBy: 'user-2',
      visibility: 'SHARED',
      tenantId: 'tenant-1',
    }, user, ['DASHBOARD_READ'])).toBe(true);

    expect(canAccessDashboardForUser({
      createdBy: 'user-2',
      visibility: 'PRIVATE',
      tenantId: 'tenant-1',
    }, user, ['DASHBOARD_READ'])).toBe(false);
  });

  it('grants dashboard view access to users whose profile the dashboard is shared with', () => {
    expect(canViewDashboardByProfile('profile-1', ['profile-1'])).toBe(true);
    expect(canViewDashboardByProfile('profile-2', ['profile-1'])).toBe(false);
    expect(canViewDashboardByProfile(undefined, ['profile-1'])).toBe(false);
  });

  it('grants embedded dashboard access only when an assigned homepage contains its widget', () => {
    expect(canViewDashboardFromProfileHomepage('dashboard-1', [[
      { id: 'dashboard-dashboard-1', x: 0, y: 0, width: 900, height: 500 },
    ]])).toBe(true);
    expect(canViewDashboardFromProfileHomepage('dashboard-1', [[
      { id: 'dashboard-dashboard-2', x: 0, y: 0, width: 900, height: 500 },
    ]])).toBe(false);
    expect(canViewDashboardFromProfileHomepage('dashboard-1', [null, ['report-1']])).toBe(false);
  });

  it('allows report-read users to view reports explicitly embedded in an accessible dashboard', () => {
    const layout = [{ id: 'widget-1', config: { reportId: 'report-1' } }];
    expect(canViewEmbeddedDashboardReport(
      'report-1',
      layout,
      'tenant-1',
      'tenant-1',
      'tenant-1',
      ['REPORT_READ'],
    )).toBe(true);
    expect(canViewEmbeddedDashboardReport(
      'report-2',
      layout,
      'tenant-1',
      'tenant-1',
      'tenant-1',
      ['REPORT_READ'],
    )).toBe(false);
    expect(canViewEmbeddedDashboardReport(
      'report-1',
      layout,
      'tenant-1',
      'tenant-1',
      'tenant-2',
      ['REPORT_READ'],
    )).toBe(false);
    expect(canViewEmbeddedDashboardReport(
      'report-1',
      layout,
      'tenant-1',
      'tenant-1',
      'tenant-1',
      ['DASHBOARD_READ'],
    )).toBe(false);
  });

  it('grants access to folders only for their owner or shared folders when the user has report permissions', () => {
    expect(canAccessReportFolderForUser({
      createdBy: 'user-1',
      isShared: false,
      tenantId: 'tenant-1',
    }, {
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
    }, ['REPORT_VIEW'])).toBe(true);

    expect(canAccessReportFolderForUser({
      createdBy: 'user-2',
      isShared: true,
      tenantId: 'tenant-1',
    }, {
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
    }, ['REPORT_VIEW'])).toBe(true);

    expect(canAccessReportFolderForUser({
      createdBy: 'user-2',
      isShared: false,
      tenantId: 'tenant-1',
    }, {
      id: 'user-1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
    }, ['REPORT_VIEW'])).toBe(false);
  });
});
