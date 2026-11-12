import { describe, expect, it } from 'vitest';
import { crmDateRangeBounds, crmLocalDateTimeToDate } from '@dct-crm/shared';
import { getGreLeadStatus, greDraftSchema, greLocationSchema, greRegistrationLeadType, greSubmissionSchema, hasActiveGreSiteVisit, normalizePhone, normalizeStoredPhone, parseGreSiteVisitDateTime, phoneCheckSchema, phoneSearchVariants, selectScheduledVisitToComplete, shouldCreateGreRelatedSource, submissionsQuerySchema } from './gre';

describe('GRE phone validation and matching', () => {
  it('does not classify a GRE source as Re-Engaged for an active lead with a scheduled visit', () => {
    const activeLead = { status: 'SITE_VISIT_SCHEDULED', scheduledSiteVisits: [{ id: 'visit-1' }] };

    expect(hasActiveGreSiteVisit(activeLead)).toBe(true);
    expect(shouldCreateGreRelatedSource(activeLead)).toBe(false);
    expect(greRegistrationLeadType(true, undefined, hasActiveGreSiteVisit(activeLead))).toBe('ADDITIONAL');
    expect(greRegistrationLeadType(true, 'RE_ENGAGED', hasActiveGreSiteVisit(activeLead))).toBe('ADDITIONAL');
  });

  it('keeps re-engagement for leads without an active scheduled visit, including lost leads', () => {
    expect(hasActiveGreSiteVisit({ status: 'LOST', scheduledSiteVisits: [{ id: 'visit-1' }] })).toBe(false);
    expect(shouldCreateGreRelatedSource({ status: 'LOST', scheduledSiteVisits: [{ id: 'visit-1' }] })).toBe(true);
    expect(shouldCreateGreRelatedSource(null)).toBe(true);
    expect(greRegistrationLeadType(true)).toBe('RE_ENGAGED');
    expect(greRegistrationLeadType(true, undefined, hasActiveGreSiteVisit({
      status: 'LOST',
      scheduledSiteVisits: [{ id: 'visit-1' }],
    }))).toBe('RE_ENGAGED');
  });

  it('selects the scheduled Site Visit closest to the GRE completion time', () => {
    const target = new Date('2026-10-07T14:20:00.000Z');
    const visits = [
      { id: 'later', scheduledAt: new Date('2026-10-07T15:00:00.000Z') },
      { id: 'closest', scheduledAt: new Date('2026-10-07T14:15:00.000Z') },
      { id: 'earlier', scheduledAt: new Date('2026-10-07T13:00:00.000Z') },
    ];
    expect(selectScheduledVisitToComplete(visits, target)?.id).toBe('closest');
    expect(selectScheduledVisitToComplete([], target)).toBeNull();
  });

  it('moves an existing Lead to Site Visit Happened when GRE completes a visit', () => {
    expect(getGreLeadStatus(true)).toBe('SITE_VISIT_HAPPENED');
    expect(getGreLeadStatus(false)).toBe('NEW');
    expect(getGreLeadStatus(false, 'PROSPECT')).toBe('PROSPECT');
    expect(getGreLeadStatus(true, 'NEW')).toBe('SITE_VISIT_HAPPENED');
    expect(getGreLeadStatus(true, 'INCOMING')).toBe('SITE_VISIT_HAPPENED');
    expect(getGreLeadStatus(true, 'PROSPECT')).toBe('SITE_VISIT_HAPPENED');
    expect(getGreLeadStatus(true, 'SITE_VISIT_SCHEDULED')).toBe('SITE_VISIT_HAPPENED');
    expect(getGreLeadStatus(false, 'SITE_VISIT_SCHEDULED')).toBe('SITE_VISIT_SCHEDULED');
    expect(getGreLeadStatus(true, 'LOST')).toBe('LOST');
    expect(getGreLeadStatus(true, 'BOOKED')).toBe('BOOKED');
  });

  it('converts and filters tenant-local calendar dates while keeping UTC timestamps', () => {
    expect(crmLocalDateTimeToDate('2026-07-01', '09:00', 'America/New_York').toISOString())
      .toBe('2026-07-01T13:00:00.000Z');
    const range = crmDateRangeBounds('2026-07-01', '2026-07-01', 'America/New_York');
    expect(range).toEqual({
      gte: new Date('2026-07-01T04:00:00.000Z'),
      lt: new Date('2026-07-02T04:00:00.000Z'),
    });

  });

  it('validates GRE visit date/time against the tenant-local current minute', () => {
    const now = new Date('2026-11-12T06:11:45.000Z');
    expect(parseGreSiteVisitDateTime('2026-11-12', '11:41', 'Asia/Kolkata', now)?.toISOString())
      .toBe('2026-11-12T06:11:00.000Z');
    expect(parseGreSiteVisitDateTime('2026-11-12', '11:42', 'Asia/Kolkata', now)).toBeNull();
    expect(parseGreSiteVisitDateTime('2026-02-30', '10:00', 'Asia/Kolkata', now)).toBeNull();
  });

  it('accepts national phone input with a separate country code', () => {
    expect(phoneCheckSchema.safeParse({ countryCode: '+91', phone: '98765 43210' }).success).toBe(true);
    expect(normalizePhone('+91', '98765 43210')).toBe('+919876543210');
  });

  it('accepts and normalizes an optional alternate phone number', () => {
    const parsed = phoneCheckSchema.safeParse({
      countryCode: '+91',
      phone: '98765 43210',
      alternatePhone: '91234 56789',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(normalizePhone(parsed.data.countryCode, parsed.data.alternatePhone || '')).toBe('+919123456789');
    }
    expect(phoneCheckSchema.safeParse({
      countryCode: '+91',
      phone: '98765 43210',
      alternatePhone: 'not a phone',
    }).success).toBe(false);
  });

  it('normalizes international phone input without assuming India', () => {
    expect(normalizePhone('+1', '(415) 555-0132')).toBe('+14155550132');
    expect(normalizePhone('+44', '07700 900123')).toBe('+447700900123');
  });

  it('rejects phone values containing non-phone text', () => {
    expect(phoneCheckSchema.safeParse({ countryCode: '+91', phone: 'call me 9876543210' }).success).toBe(false);
    expect(normalizePhone('+91', 'letters only')).toBe(null);
  });

  it('does not interpret a legacy ten-digit number as an international match', () => {
    expect(normalizeStoredPhone('4155550132', '+1')).toBe(null);
    expect(normalizeStoredPhone('9876543210', '+91')).toBe('+919876543210');
  });

  it('searches canonical, national, and original forms without scanning every lead', () => {
    expect(phoneSearchVariants('+14155550132', '+1', '(415) 555-0132')).toEqual([
      '+14155550132',
      '14155550132',
      '4155550132',
      '04155550132',
      '+4155550132',
      '(415) 555-0132',
    ]);
  });

  it('accepts blank optional select values from the public form', () => {
    const result = greDraftSchema.safeParse({
      lead: { gender: '', projectId: '' },
      siteVisit: { required: false, projectId: '' },
      company: { industry: '' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts only the GRE user reading and ignores client project coordinates', () => {
    expect(greLocationSchema.safeParse({
      latitude: 13.003789,
      longitude: 80.262671,
      accuracy: 12,
      capturedAt: '2026-10-16T08:39:30.000Z',
    }).success).toBe(true);
    expect(greLocationSchema.safeParse({
      latitude: 13.003789,
      longitude: 80.262671,
      accuracy: 12,
      capturedAt: '2026-10-16T08:39:30.000Z',
      projectLatitude: 13.0294519,
      projectLongitude: 80.1952235,
      distanceMeters: 0,
    }).success).toBe(false);
    expect(greLocationSchema.safeParse({}).success).toBe(false);
  });

  it('requires a project, date, and time to submit a GRE Site Visit', () => {
    expect(greSubmissionSchema.safeParse({
      siteVisit: { required: true, projectId: 'project-1', date: '2026-10-01', time: '11:00' },
    }).success).toBe(true);
    expect(greSubmissionSchema.safeParse({
      siteVisit: { required: false, projectId: '', date: '', time: '' },
    }).success).toBe(false);
  });

  it('validates GRE submission filters and caps results at 100', () => {
    expect(submissionsQuerySchema.safeParse({
      phone: '+91 9876543210',
      projectId: 'project-1',
      from: '2026-10-01',
      to: '2026-10-31',
      leadStatus: 'SITE_VISIT_HAPPENED',
      siteVisitStatus: 'SCHEDULED',
      existingLead: 'true',
      limit: '100',
    }).success).toBe(true);
    expect(submissionsQuerySchema.safeParse({ leadStatus: '2' }).success).toBe(true);
    expect(submissionsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(submissionsQuerySchema.safeParse({ from: '2026-13-40' }).success).toBe(false);
    expect(submissionsQuerySchema.safeParse({ siteVisitStatus: 'PLANNED' }).success).toBe(false);
  });
});
