import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import { leadsRouter } from '../routes/leads';
import {
  recordLeadMeter,
  summarizeWorkspaceMeter,
  UnmappedLeadServiceError,
} from './lead-meter';
import {
  PER_LEAD_USD,
  priceUsdForWorkspace,
  resolveLeadRate,
} from './lead-rate-card';

const ROOT = resolve(__dirname, '../../../..');

describe('resolveLeadRate (explicit service→vertical map)', () => {
  it.each([
    // FSM slugs — the canonical service keys.
    ['ev-charger-install', 'ev_charger', 60],
    ['panel-service-upgrade', 'electrical', 90],
    ['circuit-outlet-addition', 'electrical', 40],
    ['troubleshooting-callout', 'electrical', 25],
    ['whole-home-surge-protection', 'electrical', 20],
    // FSM display names and exact trade phrases.
    ['EV charger install', 'ev_charger', 60],
    ['Tesla Wall Connector install', 'ev_charger', 60],
    ['Drain cleaning', 'drain_cleaning', 15],
    ['Plumbing repair', 'plumbing', 45],
    ['HVAC tune-up', 'hvac', 60],
    ['Air conditioning install', 'hvac', 60],
    ['Furnace replacement', 'hvac', 60],
    ['Solar panel install', 'solar', 110],
    ['Roofing repair', 'roofing', 95],
    ['Fence install', 'fence', 25],
    ['Electrical panel upgrade', 'electrical', 90],
    // A quote lead's bare FSM vertical (PLACEHOLDER service prices).
    ['troubleshooting', 'electrical', 25],
    ['Electrical', 'electrical', 35],
    // Case and surrounding whitespace are not classification.
    ['  HVAC  ', 'hvac', 60],
  ])('maps %s → %s at $%i', (input, vertical, priceUsd) => {
    expect(resolveLeadRate(input)).toEqual({ vertical, priceUsd });
  });

  it.each([
    // The substring traps the old inferVertical fell for: 'ev' inside
    // "evaluation"/"level", 'charger' inside a Tesla phrase it had never
    // seen, partial phrases. None of these are explicit map keys.
    'Service evaluation',
    'Level 2 charger consultation',
    'Tesla charger',
    'Drain snake',
    'Photovoltaic system',
    'Random odd job',
    'Pony grooming',
    '',
    '   ',
  ])('does NOT classify %j — unmapped is null, never a silent $0', (input) => {
    expect(resolveLeadRate(input)).toBeNull();
  });
});

describe('priceUsdForWorkspace', () => {
  const electrical = { vertical: 'electrical' as const, priceUsd: 35 };

  it('keeps the rate card when the workspace has no override', () => {
    expect(
      priceUsdForWorkspace(electrical, {
        slug: 'rivertown',
        leadFeeOverrideUsd: null,
      }),
    ).toBe(35);
    expect(PER_LEAD_USD.electrical).toBe(35);
  });

  it('grandfather hi-power at $1 without changing the card', () => {
    expect(
      priceUsdForWorkspace(electrical, {
        slug: 'hi-power',
        leadFeeOverrideUsd: null,
      }),
    ).toBe(1);
    expect(PER_LEAD_USD.electrical).toBe(35);
    expect(PER_LEAD_USD.ev_charger).toBe(60);
  });

  it('a stored override wins over the slug map', () => {
    expect(
      priceUsdForWorkspace(electrical, {
        slug: 'hi-power',
        leadFeeOverrideUsd: 4,
      }),
    ).toBe(4);
    expect(
      priceUsdForWorkspace(electrical, {
        slug: 'other-shop',
        leadFeeOverrideUsd: 7,
      }),
    ).toBe(7);
  });

  it('ignores a negative or non-finite stored override', () => {
    expect(
      priceUsdForWorkspace(electrical, {
        slug: 'other-shop',
        leadFeeOverrideUsd: -3,
      }),
    ).toBe(35);
    expect(
      priceUsdForWorkspace(electrical, {
        slug: 'hi-power',
        leadFeeOverrideUsd: Number.NaN,
      }),
    ).toBe(1);
  });
});

describe('PER_LEAD_USD', () => {
  it('lists the 8 billing verticals, all positively priced', () => {
    expect(Object.keys(PER_LEAD_USD).sort()).toEqual(
      [
        'ev_charger',
        'electrical',
        'plumbing',
        'hvac',
        'solar',
        'roofing',
        'fence',
        'drain_cleaning',
      ].sort(),
    );
    for (const price of Object.values(PER_LEAD_USD)) {
      expect(price).toBeGreaterThan(0);
    }
  });

  it("has no 'other' bucket — unmapped services fail instead of billing $0", () => {
    expect(PER_LEAD_USD).not.toHaveProperty('other');
  });
});

describe('recordLeadMeter', () => {
  function mockEnv(
    changes = 1,
    workspace: {
      slug: string | null;
      lead_fee_override_usd: number | null;
    } | null = { slug: null, lead_fee_override_usd: null },
  ) {
    const run = vi.fn().mockResolvedValue({ meta: { changes } });
    const first = vi.fn().mockResolvedValue(workspace);
    const bind = vi.fn().mockReturnValue({ run, first });
    const prepare = vi.fn().mockReturnValue({ bind });
    return { env: { DB: { prepare } } as never, prepare, bind };
  }

  it('inserts a pending event with the rate-card price', async () => {
    const { env, prepare, bind } = mockEnv();

    const ev = await recordLeadMeter(env, {
      workspaceId: 'ws-1',
      leadId: 'lead-1',
      serviceType: 'EV charger install',
    });

    expect(ev.vertical).toBe('ev_charger');
    expect(ev.priceUsd).toBe(60);
    expect(ev.status).toBe('pending');
    expect(ev.inserted).toBe(true);
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lead_meter_events'),
    );
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT(lead_id, workspace_id) DO NOTHING'),
    );
    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      'ws-1',
      'lead-1',
      'ev_charger',
      'EV charger install',
      60,
      null,
      null,
      0,
    );
  });

  it('a priority booking halves the resolved price and is marked (FR-1.3)', async () => {
    const { env, bind } = mockEnv();

    const ev = await recordLeadMeter(env, {
      workspaceId: 'ws-1',
      leadId: 'lead-1',
      serviceType: 'EV charger install',
      jobId: 'job-1',
      deliveryId: 'delivery-1',
      priority: true,
    });

    expect(ev.priceUsd).toBe(30); // 50% of the $60 EV rate
    expect(ev.priority).toBe(true);
    expect(ev.jobId).toBe('job-1');
    expect(ev.deliveryId).toBe('delivery-1');
    expect(bind).toHaveBeenCalledWith(
      expect.any(String),
      'ws-1',
      'lead-1',
      'ev_charger',
      'EV charger install',
      30,
      'job-1',
      'delivery-1',
      1,
    );
  });

  it('throws UnmappedLeadServiceError for an unmapped service — no $0 event', async () => {
    const { env, prepare } = mockEnv();

    await expect(
      recordLeadMeter(env, {
        workspaceId: 'ws-1',
        leadId: 'lead-2',
        serviceType: 'Pony grooming',
      }),
    ).rejects.toBeInstanceOf(UnmappedLeadServiceError);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('reports inserted: false when a conflicting row already exists', async () => {
    const { env } = mockEnv(0);

    const ev = await recordLeadMeter(env, {
      workspaceId: 'ws-1',
      leadId: 'lead-1',
      serviceType: 'Plumbing',
    });
    expect(ev.inserted).toBe(false);
  });

  describe('idempotency against the real schema', () => {
    function makeDb() {
      const sqlite = createSqliteD1({
        files: [
          resolve(ROOT, 'schema.sql'),
          resolve(ROOT, 'scripts/preview/seed.sql'),
        ],
        // The seeded shop is renamed off `demo`, which is never billed.
        sql: [
          `UPDATE workspaces SET slug = 'seed-shop' WHERE id = '00000000-0000-4000-8000-000000000001';`,
        ],
      });
      return { env: { DB: sqlite.db } as unknown as Env, sqlite };
    }

    it('UNIQUE(lead_id, workspace_id) blocks a second billing row for the same lead at the same shop, but bills a different shop (FR-1.2)', async () => {
      const { env, sqlite } = makeDb();
      const DEMO_WORKSPACE = '00000000-0000-4000-8000-000000000001';
      const OTHER_WORKSPACE = crypto.randomUUID();
      const leadId = crypto.randomUUID();
      const now = new Date().toISOString();
      sqlite.raw
        .prepare(
          `INSERT INTO workspaces (id, name, slug, email) VALUES (?, 'Other Shop', 'other-shop-meter', 'other@example.com')`,
        )
        .run(OTHER_WORKSPACE);
      // Insert a lead directly — recordLeadMeter itself doesn't touch leads.
      sqlite.raw
        .prepare(
          `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, service_type, created_at, updated_at, created_by)
           VALUES (?, ?, 'Jane', 'Doe', 'qualified', 'manual', 'HVAC tune-up', ?, ?, (SELECT id FROM users WHERE workspace_id = ? LIMIT 1))`,
        )
        .run(leadId, DEMO_WORKSPACE, now, now, DEMO_WORKSPACE);

      const first = await recordLeadMeter(env, {
        workspaceId: DEMO_WORKSPACE,
        leadId,
        serviceType: 'HVAC tune-up',
      });
      const second = await recordLeadMeter(env, {
        workspaceId: DEMO_WORKSPACE,
        leadId,
        serviceType: 'HVAC tune-up',
      });
      // An eject-and-rebook at a DIFFERENT shop is a new booking and
      // bills that shop its own fee.
      const otherShop = await recordLeadMeter(env, {
        workspaceId: OTHER_WORKSPACE,
        leadId,
        serviceType: 'HVAC tune-up',
      });

      expect(first.priceUsd).toBe(60);
      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      expect(otherShop.inserted).toBe(true);
      expect(otherShop.priceUsd).toBe(60);
      expect(
        sqlite
          .rows('lead_meter_events')
          .filter((r) => (r as { lead_id: string }).lead_id === leadId),
      ).toHaveLength(2);
      sqlite.close();
    });

    it('a priority booking stores the halved price and the priority flag (FR-1.3)', async () => {
      const { env, sqlite } = makeDb();
      const DEMO_WORKSPACE = '00000000-0000-4000-8000-000000000001';
      const leadId = crypto.randomUUID();
      const now = new Date().toISOString();
      sqlite.raw
        .prepare(
          `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, service_type, created_at, updated_at, created_by)
           VALUES (?, ?, 'Jane', 'Doe', 'qualified', 'manual', 'electrical', ?, ?, (SELECT id FROM users WHERE workspace_id = ? LIMIT 1))`,
        )
        .run(leadId, DEMO_WORKSPACE, now, now, DEMO_WORKSPACE);

      const ev = await recordLeadMeter(env, {
        workspaceId: DEMO_WORKSPACE,
        leadId,
        serviceType: 'electrical',
        priority: true,
      });
      // $35 electrical halves to exactly $17.50 — price_usd is REAL.
      expect(ev.priceUsd).toBe(17.5);
      const row = sqlite
        .rows('lead_meter_events')
        .find((r) => (r as { lead_id: string }).lead_id === leadId) as {
        price_usd: number;
        priority: number;
      };
      expect(row.price_usd).toBe(17.5);
      expect(row.priority).toBe(1);
      sqlite.close();
    });

    it('bills slug hi-power $1 and a stored override ahead of the card', async () => {
      const { env, sqlite } = makeDb();
      const owner = '00000000-0000-4000-8000-000000000002';
      const hiPower = crypto.randomUUID();
      const custom = crypto.randomUUID();
      const now = new Date().toISOString();
      sqlite.raw
        .prepare(
          `INSERT INTO workspaces (id, name, slug, email) VALUES (?, 'Hi Power Electric', 'hi-power', 'pilot@example.com')`,
        )
        .run(hiPower);
      sqlite.raw
        .prepare(
          `INSERT INTO workspaces (id, name, slug, email, lead_fee_override_usd) VALUES (?, 'Other Shop', 'other-shop', 'other@example.com', 7)`,
        )
        .run(custom);

      const insertLead = (workspaceId: string) => {
        const leadId = crypto.randomUUID();
        sqlite.raw
          .prepare(
            `INSERT INTO leads (id, workspace_id, first_name, last_name, status, source, service_type, created_at, updated_at, created_by)
             VALUES (?, ?, 'Jane', 'Doe', 'qualified', 'manual', 'electrical', ?, ?, ?)`,
          )
          .run(leadId, workspaceId, now, now, owner);
        return leadId;
      };

      const hiLead = insertLead(hiPower);
      const feeReq = new Request(
        `https://api.greenput.com/api/leads/${hiLead}/fee`,
      );
      (feeReq as unknown as Record<string, unknown>)['workspaceId'] = hiPower;
      const feeRes = await leadsRouter.fetch(feeReq, env);
      const fee = (await feeRes.json()) as {
        data: { priceUsd: number; vertical: string };
      };
      expect(feeRes.status).toBe(200);
      expect(fee.data).toEqual({
        leadId: hiLead,
        vertical: 'electrical',
        priceUsd: 1,
        receive: { ok: true },
      });

      const hi = await recordLeadMeter(env, {
        workspaceId: hiPower,
        leadId: hiLead,
        serviceType: 'electrical',
      });
      const overridden = await recordLeadMeter(env, {
        workspaceId: custom,
        leadId: insertLead(custom),
        serviceType: 'electrical',
      });

      expect(hi.priceUsd).toBe(1);
      expect(hi.vertical).toBe('electrical');
      expect(overridden.priceUsd).toBe(7);
      expect(PER_LEAD_USD.electrical).toBe(35);
      sqlite.close();
    });
  });
});

describe('summarizeWorkspaceMeter', () => {
  it('aggregates pending vs invoiced by vertical', async () => {
    const all = vi.fn().mockResolvedValue({
      results: [
        { vertical: 'plumbing', status: 'pending', cnt: 3, total_usd: 135 },
        { vertical: 'plumbing', status: 'invoiced', cnt: 1, total_usd: 45 },
        { vertical: 'hvac', status: 'pending', cnt: 2, total_usd: 120 },
        {
          vertical: 'drain_cleaning',
          status: 'pending',
          cnt: 1,
          total_usd: 15,
        },
      ],
    });
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { DB: { prepare } } as never;

    const sum = await summarizeWorkspaceMeter(env, 'ws-1');
    expect(sum.pendingCount).toBe(6);
    expect(sum.pendingUsd).toBe(270);
    expect(sum.invoicedCount).toBe(1);
    expect(sum.invoicedUsd).toBe(45);
    expect(sum.perVertical.plumbing).toEqual({ count: 3, pendingUsd: 135 });
    expect(sum.perVertical.hvac).toEqual({ count: 2, pendingUsd: 120 });
    expect(sum.perVertical.drain_cleaning).toEqual({
      count: 1,
      pendingUsd: 15,
    });
    expect(sum.perVertical.solar).toEqual({ count: 0, pendingUsd: 0 });
  });

  it('zero rows = zero everything', async () => {
    const all = vi.fn().mockResolvedValue({ results: [] });
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const env = { DB: { prepare } } as never;
    const sum = await summarizeWorkspaceMeter(env, 'ws-1');
    expect(sum.pendingCount).toBe(0);
    expect(sum.invoicedCount).toBe(0);
  });
});
