import { describe, expect, it } from 'vitest';
import { createApiClient } from '@basenative/fetch';
import type { WorkspaceAvailability } from '@greenput/shared/models';
import { createAvailabilityApi } from './availability.js';
import { createFakeFetch, jsonResponse } from '../test/helpers.js';

const EMPTY: WorkspaceAvailability = {
  bookingLeadHours: 24,
  bookingHorizonDays: 30,
  travelBufferMinutes: 30,
  concurrentJobs: 1,
  bookable: false,
  week: [],
  exceptions: [],
};

describe('createAvailabilityApi', () => {
  it('GETs /api/availability', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/availability', () => jsonResponse({ data: EMPTY }));
    const api = createAvailabilityApi(
      createApiClient({ baseUrl: '', fetch: fake.fetch }),
    );
    const { data } = await api.get();
    expect(data.bookable).toBe(false);
    expect(fake.calls).toEqual([
      { url: '/api/availability', method: 'GET', body: null },
    ]);
  });

  it('PUTs the whole replacement to /api/availability', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/availability', () =>
      jsonResponse({ data: { ...EMPTY, bookable: true } }),
    );
    const api = createAvailabilityApi(
      createApiClient({ baseUrl: '', fetch: fake.fetch }),
    );
    const input = {
      timezone: 'America/Chicago',
      bookingLeadHours: 24,
      bookingHorizonDays: 30,
      travelBufferMinutes: 30,
      concurrentJobs: 1,
      week: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        isOpen: weekday !== 0,
        opensAt: '08:00',
        closesAt: '17:00',
      })),
      exceptions: [{ date: '2026-12-25', isOpen: false, reason: 'Christmas' }],
    };
    const { data } = await api.update(input);
    expect(data.bookable).toBe(true);
    expect(fake.calls[0]?.method).toBe('PUT');
    expect(fake.calls[0]?.url).toBe('/api/availability');
    expect(fake.calls[0]?.body).toEqual(input);
  });
});
