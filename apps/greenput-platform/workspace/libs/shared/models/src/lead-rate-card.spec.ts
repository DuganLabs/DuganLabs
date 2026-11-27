import { describe, expect, it } from 'vitest';
import {
  PER_LEAD_USD,
  PER_SERVICE_LEAD_USD,
  SERVICE_TO_ELECTRICAL_SERVICE,
  SERVICE_TO_VERTICAL,
  priceUsdForWorkspaceRow,
  resolveLeadRate,
} from './lead-rate-card';

// PLACEHOLDER per-lead prices for the four electrical quote services.
describe('PER_SERVICE_LEAD_USD (PLACEHOLDER electrical service prices)', () => {
  it('prices exactly the four electrical FSM services', () => {
    expect(Object.keys(PER_SERVICE_LEAD_USD).sort()).toEqual(
      [
        'circuits',
        'panel_service',
        'surge_protection',
        'troubleshooting',
      ].sort(),
    );
  });

  it('holds the placeholder values', () => {
    expect(PER_SERVICE_LEAD_USD).toEqual({
      panel_service: 90,
      circuits: 40,
      troubleshooting: 25,
      surge_protection: 20,
    });
  });

  it('every price is a positive whole dollar', () => {
    for (const price of Object.values(PER_SERVICE_LEAD_USD)) {
      expect(Number.isInteger(price)).toBe(true);
      expect(price).toBeGreaterThan(0);
    }
  });

  it('leaves the vertical card unchanged', () => {
    expect(PER_LEAD_USD.electrical).toBe(35);
    expect(PER_LEAD_USD.ev_charger).toBe(60);
  });

  it('is frozen config, not mutable at runtime', () => {
    expect(Object.isFrozen(PER_SERVICE_LEAD_USD)).toBe(true);
    expect(Object.isFrozen(SERVICE_TO_ELECTRICAL_SERVICE)).toBe(true);
  });
});

describe('resolveLeadRate for the electrical services', () => {
  it.each([
    // FSM slugs (what tenant self-booking resolves first)
    ['panel-service-upgrade', 90],
    ['circuit-outlet-addition', 40],
    ['troubleshooting-callout', 25],
    ['whole-home-surge-protection', 20],
    // Bare FSM verticals (a quote lead's leads.service_type)
    ['panel_service', 90],
    ['circuits', 40],
    ['troubleshooting', 25],
    ['surge_protection', 20],
    // FSM display names
    ['Panel replacement and service upgrade', 90],
    ['Adding an outlet or a circuit', 40],
    ["Something's not working", 25],
    ['Whole-home surge protection', 20],
    // Exact trade phrases
    ['Electrical panel upgrade', 90],
    ['Panel upgrade', 90],
    ['Electrical troubleshooting', 25],
    ['Surge protection', 20],
  ])('%s bills as electrical at $%i', (input, priceUsd) => {
    expect(resolveLeadRate(input)).toEqual({
      vertical: 'electrical',
      priceUsd,
    });
  });

  it('generic "electrical" still bills the $35 vertical rate', () => {
    expect(resolveLeadRate('electrical')).toEqual({
      vertical: 'electrical',
      priceUsd: 35,
    });
  });

  it('every service key is also an electrical vertical key', () => {
    for (const key of Object.keys(SERVICE_TO_ELECTRICAL_SERVICE)) {
      expect(SERVICE_TO_VERTICAL[key]).toBe('electrical');
    }
  });

  it('partial phrases still do not classify', () => {
    expect(resolveLeadRate('panel')).toBeNull();
    expect(resolveLeadRate('circuit')).toBeNull();
    expect(resolveLeadRate('surge')).toBeNull();
  });
});

describe('workspace override beats the placeholder service price', () => {
  const panel = { vertical: 'electrical' as const, priceUsd: 90 };

  it('the panel slug resolves to that rate', () => {
    expect(resolveLeadRate('panel-service-upgrade')).toEqual(panel);
  });

  it('no override → placeholder', () => {
    expect(
      priceUsdForWorkspaceRow(panel, {
        slug: 'shop',
        lead_fee_override_usd: null,
      }),
    ).toBe(90);
    expect(priceUsdForWorkspaceRow(panel, null)).toBe(90);
  });

  it('a stored override wins', () => {
    expect(
      priceUsdForWorkspaceRow(panel, {
        slug: 'shop',
        lead_fee_override_usd: 12,
      }),
    ).toBe(12);
  });

  it('the grandfathered pilot stays at $1', () => {
    expect(
      priceUsdForWorkspaceRow(panel, {
        slug: 'hi-power',
        lead_fee_override_usd: null,
      }),
    ).toBe(1);
  });
});
