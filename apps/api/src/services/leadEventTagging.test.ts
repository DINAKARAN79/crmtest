import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  buildLeadEnquiryAttributionUpdates,
  buildLeadFollowUpTagUpdates,
  buildLeadSiteVisitTagUpdates,
  classifyMatchedLeadLifecycle,
  FIELD_TAGGING_REGISTRY,
  isConfiguredLostStatus,
  mergeOperationalLeadCustomFields,
  tagLeadFollowUpEvents,
} from './leadEventTagging';

describe('Lead event tag mapping', () => {
  it('preserves first-touch attribution and updates last-touch enquiry details', () => {
    const occurredAt = new Date('2026-10-11T16:00:00.000Z');
    const result = buildLeadEnquiryAttributionUpdates(
      {
        sf_First_Source_Of_Enquiry__c: 'Referral',
        sf_First_Sub_Source__c: 'Existing Sub-source',
        sf_First_Campaign__c: 'Initial Campaign',
        sf_Custom_Note__c: 'keep',
      },
      {
        source: 'Website',
        subSource: 'Landing Page',
        campaign: 'October Campaign',
        campaignId: 'campaign-2',
        subCampaignId: 'sub-campaign-2',
        projectName: 'DCT Heights',
        occurredAt,
      },
    );

    expect(result).toMatchObject({
      sf_First_Source_Of_Enquiry__c: 'Referral',
      sf_Last_Source_Of_Enquiry__c: 'Website',
      sf_First_Sub_Source__c: 'Existing Sub-source',
      sf_Last_Sub_Source__c: 'Landing Page',
      sf_First_Campaign__c: 'Initial Campaign',
      sf_Last_Campagin__c: 'October Campaign',
      sf_Campaign__c: 'campaign-2',
      sf_Sub_Campaign_ID__c: 'sub-campaign-2',
      sf_Allocated_Project__c: 'DCT Heights',
      sf_Custom_Note__c: 'keep',
    });
  });

  it('tags a new Main Lead with the configured Fresh Lead Type', () => {
    const result = buildLeadEnquiryAttributionUpdates({}, {
      source: 'Website',
      occurredAt: new Date('2026-10-11T16:00:00.000Z'),
      lifecycleType: 'Fresh',
    });

    expect(result.sf_Lead_Type__c).toBe('Fresh');
  });

  it('increments the re-engaged count and stamps the last re-engaged date', () => {
    const result = buildLeadEnquiryAttributionUpdates(
      { sf_Re_engaged_Count__c: 2 },
      {
        source: 'Referral',
        occurredAt: new Date('2026-10-11T16:00:00.000Z'),
        lifecycleType: 'Re-Engaged',
        isReEngaged: true,
      },
    );

    expect(result).toMatchObject({
      sf_Lead_Type__c: 'Re-Engaged',
      sf_Re_engaged_Count__c: 3,
      sf_Last_Re_Engaged_Date__c: '2026-10-11T16:00:00.000Z',
    });
  });

  it('tags reopened Leads and resets only current operational tags', () => {
    const result = buildLeadEnquiryAttributionUpdates(
      {
        sf_Custom_Note__c: 'preserve this',
        sf_First_Source_Of_Enquiry__c: 'Original source',
        sf_First_Sub_Source__c: 'Original sub-source',
        sf_First_Approach_On__c: '2026-01-02T00:00:00.000Z',
        sf_First_Campaign__c: 'Original campaign',
        sf_Followup_Scheduled__c: true,
        sf_Abandoned_Date__c: '2026-01-01T00:00:00.000Z',
        sf_Is_Unqualified__c: true,
        sf_Unqualified_Date__c: '2026-01-02T00:00:00.000Z',
        sf_Unqualified_Lost_By__c: 'presales-user-id',
        sf_Unqualified_Reason__c: 'Not interested',
        sf_Is_Closed_Lost__c: true,
        sf_Closed_Lost_Date__c: '2026-01-03T00:00:00.000Z',
        sf_Closed_Lost_By__c: 'sales-user-id',
        sf_IsPushed__c: true,
        sf_Lead_Pull_Requested_By__c: 'requester-id',
        sf_Pre_sales_user__c: 'presales-user-id',
        sf_Recovery_User__c: 'recovery-user-id',
      },
      {
        source: 'Website',
        occurredAt: new Date('2026-10-11T16:00:00.000Z'),
        lifecycleType: 'Re-Opened',
        isReOpened: true,
      },
    );

    expect(result).toMatchObject({
      sf_Lead_Type__c: 'Re-Opened',
      sf_Lead_Status__c: 'New Enquiry',
      sf_Last_Re_Opened_Date__c: '2026-10-11T16:00:00.000Z',
      sf_Lead_Assigned__c: false,
      sf_Lead_Transfered__c: false,
      sf_Assigment_count__c: 0,
      sf_Site_Visit_Schedule_Date__c: null,
      sf_Site_visit_Project__c: null,
      sf_Site_Visit_Feedback__c: null,
      sf_Subject__c: null,
      sf_Last_comment__c: '',
      sf_status_change_date__c: null,
      sf_Pre_sales_user__c: null,
      sf_Recovery_User__c: null,
      sf_Pushed_On__c: null,
      sf_Pushed_By__c: null,
      sf_Abandoned_Date__c: null,
      sf_Is_Unqualified__c: false,
      sf_Unqualified_Date__c: null,
      sf_Unqualified_Lost_By__c: null,
      sf_Unqualified_Reason__c: null,
      sf_Is_Closed_Lost__c: false,
      sf_Closed_Lost_Date__c: null,
      sf_Closed_Lost_By__c: null,
      sf_IsPushed__c: false,
      sf_Lead_Pull_Requested_By__c: null,
      sf_Type_of_lead__c: 'Direct Lead',
      sf_First_Source_Of_Enquiry__c: 'Original source',
      sf_First_Sub_Source__c: 'Original sub-source',
      sf_First_Approach_On__c: '2026-01-02T00:00:00.000Z',
      sf_First_Campaign__c: 'Original campaign',
      sf_Followup_Scheduled__c: true,
      sf_Custom_Note__c: 'preserve this',
    });
    expect(result).not.toHaveProperty('sf_Next_follow_up_Date__c');
  });

  it('matches configured lost status labels exactly', () => {
    for (const status of ['Abandoned', 'Recovery - Pre Sales', 'Recovery - Sales', 'Recovery Followup']) {
      expect(isConfiguredLostStatus(status)).toBe(true);
      expect(classifyMatchedLeadLifecycle('LOST', status)).toBe('Re-Opened');
    }
    expect(isConfiguredLostStatus('recovery - pre sales')).toBe(false);
    expect(isConfiguredLostStatus('LOST')).toBe(false);
    expect(classifyMatchedLeadLifecycle('LOST', null)).toBe('Re-Opened');
    expect(classifyMatchedLeadLifecycle('NEW', 'Recovery - Sales')).toBe('Re-Opened');
    expect(classifyMatchedLeadLifecycle('NEW', null)).toBe('Re-Engaged');
  });

  it('populates initial contact tags only on Main Lead creation', () => {
    const occurredAt = new Date('2026-10-11T16:00:00.000Z');
    const result = buildLeadEnquiryAttributionUpdates({}, {
      source: 'Website',
      occurredAt,
      isLeadCreation: true,
      countryCode: '+91',
      country: 'India',
      secondaryPhone: '+919876543210',
      secondaryCountryCode: '+91',
      tertiaryPhone: '+919876543211',
      secondaryEmail: 'other@example.test',
    });
    expect(result).toMatchObject({
      sf_Country_Code__c: '+91',
      sf_Country__c: 'India',
      sf_Secondary_Phone__c: '+919876543210',
      sf_Secondary_Country_Code__c: '+91',
      sf_Tertiary_Phone__c: '+919876543211',
      sf_Secondary_Email__c: 'other@example.test',
    });
    expect(result).not.toHaveProperty('sf_First_Approach_On__c');
  });

  it('keeps operational Lead values mirrored in the custom field JSON', () => {
    const result = mergeOperationalLeadCustomFields(
      { existingCustomValue: 'preserve', source: 'WEBSITE' },
      {
        source: 'FACEBOOK',
        status: 'NEW',
        rating: 'HOT',
        description: 'Requested a viewing',
        score: 5,
      },
    );

    expect(result).toMatchObject({
      existingCustomValue: 'preserve',
      source: 'FACEBOOK',
      status: 'NEW',
      rating: 'HOT',
      description: 'Requested a viewing',
      score: 5,
    });
  });

  it('recalculates follow-up count and changes a new lead to Follow Up', () => {
    const result = buildLeadFollowUpTagUpdates(
      { sf_Lead_Status__c: 'New Enquiry', sf_Custom_Note__c: 'keep' },
      [
        { dueDate: new Date('2026-10-15T09:00:00.000Z'), isCompleted: false, status: 'SCHEDULED' },
        { dueDate: new Date('2026-10-12T09:00:00.000Z'), isCompleted: true },
        { dueDate: new Date('2026-10-13T09:00:00.000Z'), isCompleted: false, status: 'SCHEDULED' },
      ],
      undefined,
      true,
    );

    expect(result).toMatchObject({
      sf_Followup_Count__c: 3,
      sf_Followup_Scheduled__c: true,
      sf_Next_follow_up_Date__c: '2026-10-13T09:00:00.000Z',
      sf_Lead_Status__c: 'Follow Up',
      sf_Custom_Note__c: 'keep',
    });
  });

  it('clears the next follow-up date when none remain and preserves the legacy Lead status', () => {
    const result = buildLeadFollowUpTagUpdates(
      { sf_Lead_Status__c: 'Recovery - Sales', sf_Custom_Note__c: 'keep' },
      [{ dueDate: new Date('2026-10-12T09:00:00.000Z'), isCompleted: true }],
    );

    expect(result).toMatchObject({
      sf_Followup_Count__c: 1,
      sf_Followup_Scheduled__c: false,
      sf_Next_follow_up_Date__c: null,
      sf_Lead_Status__c: 'Recovery - Sales',
      sf_Custom_Note__c: 'keep',
    });
  });

  it('clears the scheduled flag, date, and count when the last FollowUp is deleted', () => {
    const result = buildLeadFollowUpTagUpdates(
      { sf_Followup_Count__c: 1, sf_Followup_Scheduled__c: true, sf_Next_follow_up_Date__c: '2026-10-12T09:00:00.000Z' },
      [],
    );

    expect(result).toMatchObject({
      sf_Followup_Count__c: 0,
      sf_Followup_Scheduled__c: false,
      sf_Next_follow_up_Date__c: null,
    });
  });

  it('does not keep missed follow-ups as the next scheduled date', () => {
    const result = buildLeadFollowUpTagUpdates(
      {},
      [
        { dueDate: new Date('2026-10-12T09:00:00.000Z'), isCompleted: false, isMissed: true, status: 'MISSED' },
        { dueDate: new Date('2026-10-13T09:00:00.000Z'), isCompleted: false, status: 'SCHEDULED' },
      ],
    );

    expect(result.sf_Followup_Scheduled__c).toBe(true);
    expect(result.sf_Next_follow_up_Date__c).toBe('2026-10-13T09:00:00.000Z');
  });

  it('does not mark system-cancelled or cancelled follow-ups as scheduled', () => {
    const result = buildLeadFollowUpTagUpdates(
      {},
      [
        {
          dueDate: new Date('2026-10-12T09:00:00.000Z'),
          isCompleted: false,
          isSystemCancelled: true,
          status: 'SCHEDULED',
        },
        {
          dueDate: new Date('2026-10-13T09:00:00.000Z'),
          isCompleted: false,
          status: 'CANCELLED',
        },
      ],
    );

    expect(result).toMatchObject({
      sf_Followup_Count__c: 2,
      sf_Followup_Scheduled__c: false,
      sf_Next_follow_up_Date__c: null,
    });

  });

  it('updates Salesforce Lead status only when a scheduled follow-up exists', () => {
    const scheduled = [{
      dueDate: new Date('2026-10-13T09:00:00.000Z'),
      isCompleted: false,
      isMissed: false,
      status: 'SCHEDULED',
    }];

    expect(buildLeadFollowUpTagUpdates({ sf_Lead_Status__c: 'New Enquiry' }, scheduled))
      .toMatchObject({ sf_Lead_Status__c: 'New Enquiry' });
    expect(buildLeadFollowUpTagUpdates({ sf_Lead_Status__c: 'New Enquiry' }, scheduled, undefined, true))
      .toMatchObject({ sf_Lead_Status__c: 'Follow Up' });
    expect(buildLeadFollowUpTagUpdates({ sf_Lead_Status__c: 'Recovery - Sales' }, scheduled))
      .toMatchObject({ sf_Lead_Status__c: 'Recovery - Sales' });
    expect(buildLeadFollowUpTagUpdates({ sf_Lead_Status__c: 'Recovery - Sales' }, scheduled, undefined, true))
      .toMatchObject({ sf_Lead_Status__c: 'Recovery Followup' });
    expect(buildLeadFollowUpTagUpdates({}, scheduled, 'NEW', true))
      .toMatchObject({ sf_Lead_Status__c: 'Follow Up' });
    expect(buildLeadFollowUpTagUpdates({ sf_Lead_Status__c: 'Follow Up' }, []))
      .toMatchObject({ sf_Lead_Status__c: 'Follow Up' });
  });

  it('recomputes moved Lead tags together with one database update', async () => {
    const executeRaw = vi.fn().mockResolvedValue(2);
    const leadFindMany = vi.fn().mockResolvedValue([
      { id: 'lead-old', customFields: {} },
      { id: 'lead-new', customFields: {} },
    ]);
    const followUpFindMany = vi.fn().mockResolvedValue([
      {
        leadId: 'lead-new',
        dueDate: new Date('2026-10-13T09:00:00.000Z'),
        isCompleted: false,
        isMissed: false,
        isSystemCancelled: false,
        status: 'SCHEDULED',
      },
    ]);
    const tx = {
      $executeRaw: executeRaw,
      lead: { findMany: leadFindMany },
      followUp: { findMany: followUpFindMany },
    } as unknown as Prisma.TransactionClient;

    await tagLeadFollowUpEvents(tx, 'tenant-1', ['lead-old', 'lead-new', 'lead-old']);

    expect(leadFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['lead-old', 'lead-new'] }, tenantId: 'tenant-1' },
      select: { id: true, customFields: true, status: true },
    });
    expect(followUpFindMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', leadId: { in: ['lead-old', 'lead-new'] } },
      select: {
        leadId: true,
        dueDate: true,
        isCompleted: true,
        isMissed: true,
        isSystemCancelled: true,
        status: true,
      },
    });
    expect(executeRaw).toHaveBeenCalledOnce();
  });

  it('tags a scheduled Site Visit and only changes feedback when supplied', () => {
    const result = buildLeadSiteVisitTagUpdates(
      { sf_Site_Visit_Feedback__c: 'previous feedback', sf_Custom_Note__c: 'keep' },
      [
        { scheduledAt: new Date('2026-10-13T09:00:00.000Z') },
        { scheduledAt: new Date('2026-10-15T09:00:00.000Z') },
      ],
      {
        scheduledAt: new Date('2026-10-15T09:00:00.000Z'),
        projectName: 'DCT Heights',
        leadStatus: 'Site Visit Scheduled',
      },
    );

    expect(result).toMatchObject({
      sf_Site_Visit_Schedule_Date__c: '2026-10-15T09:00:00.000Z',
      sf_Next_Site_visit_Date__c: '2026-10-13T09:00:00.000Z',
      sf_Site_visit_Project__c: 'DCT Heights',
      sf_Site_Visit_Feedback__c: 'previous feedback',
      sf_Lead_Status__c: 'Site Visit Scheduled',
      sf_Custom_Note__c: 'keep',
    });
  });

  it('clears scheduled dates when no scheduled visits remain and saves completion feedback', () => {
    const result = buildLeadSiteVisitTagUpdates(
      { sf_Site_visit_Project__c: 'DCT Heights', sf_Custom_Note__c: 'keep' },
      [],
      { feedback: '  Visit completed  ', leadStatus: 'Site Visit Completed' },
    );

    expect(result).toMatchObject({
      sf_Site_Visit_Schedule_Date__c: null,
      sf_Next_Site_visit_Date__c: null,
      sf_Site_Visit_Feedback__c: 'Visit completed',
      sf_Site_visit_Project__c: 'DCT Heights',
      sf_Lead_Status__c: 'Site Visit Completed',
      sf_Custom_Note__c: 'keep',
    });
  });

  it('marks only Salesforce-source-dependent mappings as unresolved instead of guessing', () => {
    expect(FIELD_TAGGING_REGISTRY.find((mapping) => mapping.salesforceField === 'Last_Re_Opened_Date__c')?.status)
      .toBe('implemented');
    expect(FIELD_TAGGING_REGISTRY.find((mapping) => mapping.salesforceField === 'First_Approach_On__c')?.status)
      .toBe('unresolved');
  });
});
