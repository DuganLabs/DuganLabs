import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MOCK_NOTICE,
  bookingLeadPayloadSchema,
  buildContractJsonSchemas,
  contractorResultSchema,
  findContractorsOutputSchema,
  startQuoteOutputSchema,
  requestBookingInputSchema,
  type RequestBookingInput,
} from '../src/contracts.js';
import { buildLeadPayload } from '../src/server.js';
import { createProviderUnderTest } from './helpers.js';

/**
 * The contract suite — the gate of the pact.
 *
 * Parameterized by a provider factory (PROVIDER_UNDER_TEST, default
 * "mock"). Any future provider — above all the real one — must pass this
 * exact suite before it may replace the mock behind the tools. The suite
 * speaks only contracts.ts: if it is guaranteed here, it is guaranteed to
 * every caller of every provider.
 */
describe('provider contract suite', () => {
  const { provider, inspectBookings } = createProviderUnderTest();
  const notice = provider.dataMode === 'mock' ? MOCK_NOTICE : '';

  it('find_contractors output validates against the output schema', async () => {
    const data = await provider.findContractors({
      service: 'ev-charger-install',
      location: 'Irvine',
    });
    const output = findContractorsOutputSchema.parse({
      data_mode: provider.dataMode,
      notice,
      results: data.results,
      coverage_note: data.coverageNote,
    });
    expect(output.data_mode).toBe('mock');
    expect(output.results.length).toBeGreaterThan(0);
    for (const result of output.results) {
      expect(contractorResultSchema.parse(result)).toEqual(result);
      // A booked job does not wait on a business responding — the result
      // carries no response-time field.
      expect(result).not.toHaveProperty('typical_response_time');
      // Fixture discipline: mock businesses are unmistakably labeled.
      expect(result.business_name.startsWith('MOCK —')).toBe(true);
    }
  });

  it('orders results by fit and honors the certification filter', async () => {
    const data = await provider.findContractors({
      service: 'ev-charger-install',
      location: 'Irvine',
      certification: 'tesla-certified',
    });
    expect(data.results.length).toBeGreaterThan(0);
    for (const result of data.results) {
      expect(result.certifications).toContain('tesla-certified');
      expect(result.services).toContain('ev-charger-install');
    }
  });

  it('answers a ZIP query like its city', async () => {
    const data = await provider.findContractors({
      service: 'panel-upgrade',
      location: '92618',
    });
    expect(data.results.length).toBeGreaterThan(0);
  });

  it('returns the honest empty state for an uncovered area', async () => {
    const data = await provider.findContractors({
      service: 'ev-charger-install',
      location: 'Denver',
    });
    const output = findContractorsOutputSchema.parse({
      data_mode: provider.dataMode,
      notice,
      results: data.results,
      coverage_note: data.coverageNote,
    });
    expect(output.results).toEqual([]);
    // The nearest covered area is named plainly — no implied coverage.
    expect(output.coverage_note).toContain('Orange County');
    expect(output.coverage_note).toContain('Denver');
  });

  it('returns an empty state, not an error, when a covered area has no match', async () => {
    const data = await provider.findContractors({
      service: 'ev-charger-install',
      location: 'Irvine',
      certification: 'no-such-certification',
    });
    expect(data.results).toEqual([]);
    expect(data.coverageNote).toContain('covered');
  });

  it('start_quote output validates, carries the label, and has no price', async () => {
    const data = await provider.startQuote({
      service: 'panel-upgrade',
      location: 'Irvine',
    });
    const output = startQuoteOutputSchema.parse({
      data_mode: provider.dataMode,
      notice,
      service: 'panel-upgrade',
      state: 'awaiting_answers',
      price: null,
      label:
        'no price until the qualification questions are answered — then one exact quote',
      basis: data.basis,
      source_url: data.sourceUrl,
    });
    expect(output.label).toBe(
      'no price until the qualification questions are answered — then one exact quote',
    );
    expect(output.source_url).toContain('greenput.com');
    expect(output.price).toBeNull();
    // No dollar range anywhere in the contract or the provider's answer.
    expect(Object.keys(data)).not.toContain('rangeLow');
    expect(Object.keys(data)).not.toContain('rangeHigh');
  });

  it('start_quote output rejects a price or a range at open', () => {
    const base = {
      data_mode: 'mock',
      notice,
      service: 'panel-upgrade',
      state: 'awaiting_answers',
      label:
        'no price until the qualification questions are answered — then one exact quote',
      basis: 'x',
      source_url: 'https://greenput.com/pricing',
    };
    expect(() =>
      startQuoteOutputSchema.parse({ ...base, price: 1200 }),
    ).toThrow();
    const stripped = startQuoteOutputSchema.parse({
      ...base,
      price: null,
      range_low: 800,
      range_high: 2500,
    });
    expect(stripped).not.toHaveProperty('range_low');
    expect(stripped).not.toHaveProperty('range_high');
  });

  describe('request_booking grant enforcement', () => {
    const grantedAt = '2026-10-15T12:00:00.000Z';
    const baseCustomer = {
      name: 'Jamie Example',
      phone: '+1-555-0100',
      email: 'jamie@example.test',
      job_details: 'Install a 240V charger in the garage.',
    };

    it('(a) missing grant is rejected and the sink stays empty', () => {
      const parsed = requestBookingInputSchema.safeParse({
        shop_id: 'mock-suntest-electric',
        service: 'ev-charger-install',
        customer: baseCustomer,
      });
      expect(parsed.success).toBe(false);
      expect(inspectBookings()).toEqual([]);
    });

    it('(a) empty grant fields are rejected and the sink stays empty', () => {
      const parsed = requestBookingInputSchema.safeParse({
        shop_id: 'mock-suntest-electric',
        service: 'ev-charger-install',
        customer: baseCustomer,
        grant: {
          fields: [],
          purpose: 'quote-and-schedule',
          allow_network_reroute: false,
          granted_at: grantedAt,
        },
      });
      expect(parsed.success).toBe(false);
      expect(inspectBookings()).toEqual([]);
    });

    it('(b) a grant with no contact path is rejected and the sink stays empty', () => {
      const parsed = requestBookingInputSchema.safeParse({
        shop_id: 'mock-suntest-electric',
        service: 'ev-charger-install',
        customer: baseCustomer,
        grant: {
          fields: ['name', 'job_details'],
          purpose: 'quote-and-schedule',
          allow_network_reroute: false,
          granted_at: grantedAt,
        },
      });
      expect(parsed.success).toBe(false);
      expect(inspectBookings()).toEqual([]);
    });

    it('(c) happy path: only granted fields recorded; grant verbatim; reroute false', async () => {
      const input: RequestBookingInput = {
        shop_id: 'mock-suntest-electric',
        service: 'ev-charger-install',
        // email and job_details are supplied but NOT granted — they must
        // be dropped before anything is recorded.
        customer: baseCustomer,
        grant: {
          fields: ['name', 'phone'],
          purpose: 'quote-and-schedule',
          allow_network_reroute: false,
          granted_at: grantedAt,
        },
      };
      const payload = buildLeadPayload(input, 'contract-test-client');
      expect(payload.customer).toEqual({
        name: 'Jamie Example',
        phone: '+1-555-0100',
      });
      // No field is shared that was not granted — exact set equality.
      expect(Object.keys(payload.customer).sort()).toEqual(
        [...input.grant.fields].sort(),
      );
      expect(payload.grant).toEqual(input.grant);
      expect(payload.reroute_allowed).toBe(false);
      expect(payload.source).toBe('llm-app/contract-test-client');
      expect(bookingLeadPayloadSchema.parse(payload)).toEqual(payload);

      const receipt = await provider.submitBooking(payload);
      expect(receipt.confirmationRef.length).toBeGreaterThan(0);
      expect(receipt.grantId.length).toBeGreaterThan(0);
      expect(receipt.shopBusinessName).toBe('MOCK — SunTest Electric Co.');
      expect(inspectBookings()).toEqual([payload]);
    });

    it('(c) reroute flag is recorded faithfully when true', async () => {
      const before = inspectBookings().length;
      const input: RequestBookingInput = {
        shop_id: 'mock-suntest-electric',
        service: 'panel-upgrade',
        customer: { email: 'jamie@example.test' },
        grant: {
          fields: ['email'],
          purpose: 'quote-and-schedule',
          allow_network_reroute: true,
          granted_at: grantedAt,
        },
      };
      const payload = buildLeadPayload(input, 'contract-test-client');
      await provider.submitBooking(payload);
      const written = inspectBookings().at(-1);
      expect(inspectBookings().length).toBe(before + 1);
      expect(written?.reroute_allowed).toBe(true);
      expect(written?.grant).toEqual(input.grant);
      expect(written?.customer).toEqual({ email: 'jamie@example.test' });
    });

    it('(c) a granted contact path that was not supplied is a hard stop', () => {
      const input: RequestBookingInput = {
        shop_id: 'mock-suntest-electric',
        service: 'ev-charger-install',
        customer: { name: 'Jamie Example' },
        grant: {
          fields: ['name', 'phone'],
          purpose: 'quote-and-schedule',
          allow_network_reroute: false,
          granted_at: grantedAt,
        },
      };
      const before = inspectBookings().length;
      expect(() => buildLeadPayload(input, 'contract-test-client')).toThrow(
        /contact path/,
      );
      expect(inspectBookings().length).toBe(before);
    });

    it('an unknown shop_id is refused by the provider, sink untouched', async () => {
      const input: RequestBookingInput = {
        shop_id: 'mock-does-not-exist',
        service: 'ev-charger-install',
        customer: { phone: '+1-555-0100' },
        grant: {
          fields: ['phone'],
          purpose: 'quote-and-schedule',
          allow_network_reroute: false,
          granted_at: grantedAt,
        },
      };
      const before = inspectBookings().length;
      await expect(
        provider.submitBooking(buildLeadPayload(input, 'contract-test-client')),
      ).rejects.toThrow(/Unknown shop_id/);
      expect(inspectBookings().length).toBe(before);
    });
  });
});

describe('contracts/*.json match the zod schemas', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const contractsDir = join(here, '..', 'contracts');
  for (const [name, schema] of Object.entries(buildContractJsonSchemas())) {
    it(`${name}.json is current`, () => {
      const onDisk = JSON.parse(
        readFileSync(join(contractsDir, `${name}.json`), 'utf8'),
      ) as unknown;
      expect(onDisk).toEqual(schema);
    });
  }
});
