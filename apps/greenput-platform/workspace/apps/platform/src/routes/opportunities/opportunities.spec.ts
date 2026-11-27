import { afterEach, describe, expect, it } from 'vitest';
import type { Lead, Opportunity } from '@greenput/shared/models';
import {
  leadsForNewOpportunity,
  renderOpportunitiesRoute,
} from './opportunities.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

function opp(partial: Partial<Opportunity>): Opportunity {
  return {
    id: 'o1',
    leadId: 'l1',
    title: 'New roof',
    status: 'open',
    value: 500000,
    serviceType: 'Roofing',
    notes: '',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-15T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

describe('renderOpportunitiesRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('groups opportunities into kanban columns by status', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [
          opp({ id: 'o1', status: 'open' }),
          opp({ id: 'o2', status: 'won' }),
          opp({ id: 'o3', status: 'won' }),
        ],
        meta: { total: 3, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOpportunitiesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const columns = view.element.querySelectorAll(
      '[data-bn="pipeline-column"]',
    );
    expect(columns).toHaveLength(5);
    // Won column has 2 cards
    const wonHeader = view.element.querySelector(
      '#opportunities-kanban-column-won',
    );
    expect(wonHeader).not.toBeNull();
    const wonColumn = wonHeader?.closest('[data-bn="pipeline-column"]');
    expect(
      wonColumn?.querySelectorAll('[data-bn="pipeline-card"]'),
    ).toHaveLength(2);
    expect(
      wonColumn?.querySelector('[data-bn="pipeline-column-count"]')
        ?.textContent,
    ).toBe('2');
    const card = wonColumn?.querySelector('[data-card-id="o2"]');
    expect(card?.getAttribute('data-status')).toBe('won');
    expect(card?.querySelector('[data-bn="badge"]')?.textContent).toBe('Won');
    expect(
      card?.querySelector('[data-bn="badge"]')?.getAttribute('data-variant'),
    ).toBe('success');
    expect(
      card?.querySelector('[data-bn="pipeline-card-subtitle"]')?.textContent,
    ).toBe('Roofing · $5,000');
  });

  it('moves a dragged opportunity to the dropped column by changing its status', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [
          opp({ id: 'o1', status: 'open' }),
          opp({ id: 'o3', status: 'won', convertedToJobId: 'j1' }),
        ],
        meta: { total: 2, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOpportunitiesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const dropCard = (columnId: string, cardId: string): void => {
      const target = view.element.querySelector(
        `[data-bn="pipeline-column"][data-column-id="${columnId}"] [data-bn="pipeline-column-cards"]`,
      ) as Element;
      const drop = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(drop, 'dataTransfer', {
        value: {
          getData: () => JSON.stringify({ type: 'pipeline-card', cardId }),
          dropEffect: 'move',
        },
      });
      target.dispatchEvent(drop);
    };

    dropCard('negotiating', 'o1');
    await tick();
    await tick();
    const patches = fake.calls.filter((call) => call.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url).toContain('/api/opportunities/o1');
    expect(patches[0]?.body).toEqual({ status: 'negotiating' });

    // Same column and deals already converted to a job are no-ops.
    dropCard('open', 'o1');
    dropCard('lost', 'o3');
    await tick();
    expect(fake.calls.filter((call) => call.method === 'PATCH')).toHaveLength(
      1,
    );
  });

  it('moves an opportunity by a click to pick it up and a click in a column to place it (touch/keyboard, no drag)', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [opp({ id: 'o1', status: 'open' })],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOpportunitiesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const card = view.element.querySelector(
      '[data-card-id="o1"]',
    ) as HTMLElement;
    card.click();
    expect(card.hasAttribute('data-picked')).toBe(true);
    (
      view.element.querySelector(
        '[data-bn="pipeline-column"][data-column-id="negotiating"] [data-bn="pipeline-column-cards"]',
      ) as HTMLElement
    ).click();
    await tick();
    await tick();

    const patches = fake.calls.filter((call) => call.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url).toContain('/api/opportunities/o1');
    expect(patches[0]?.body).toEqual({ status: 'negotiating' });
  });

  it('computes pipeline value excluding lost opportunities', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [
          opp({ id: 'o1', status: 'open', value: 100000 }),
          opp({ id: 'o2', status: 'lost', value: 999999 }),
          opp({ id: 'o3', status: 'won', value: 200000 }),
        ],
        meta: { total: 3, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOpportunitiesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    // Pipeline: 100000 + 200000 = 300000 cents = $3,000
    const pipeline = view.element.querySelector(
      '[data-testid="opportunities-pipeline"]',
    );
    expect(pipeline?.textContent).toBe('$3,000');
  });

  it('shows convert button only on won opportunities without a job yet', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [
          opp({ id: 'o1', status: 'open' }),
          opp({ id: 'o2', status: 'won' }),
          opp({ id: 'o3', status: 'won', convertedToJobId: 'j1' }),
        ],
        meta: { total: 3, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOpportunitiesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    expect(
      view.element.querySelector('[data-testid="opportunities-convert-o2"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="opportunities-convert-o3"]'),
    ).toBeNull();
    expect(
      view.element.querySelector('[data-testid="opportunities-convert-o1"]'),
    ).toBeNull();
  });

  /* GP-037. Convert to job used to fire the API call on the click with no
     schedule, so the job was booked for the instant of the click with zero
     duration and the only correction was a desktop calendar drag. */
  describe('convert to job', () => {
    async function mountWon(fake = createFakeFetch()) {
      fake.respond('/api/opportunities/o2/convert', () =>
        jsonResponse({
          data: { jobId: 'j1', customerId: 'c1', jobNumber: 'JOB-001' },
        }),
      );
      fake.respond('/api/opportunities', () =>
        jsonResponse({
          data: [opp({ id: 'o2', status: 'won', title: 'Panel upgrade' })],
          meta: { total: 1, page: 1, perPage: 25 },
        }),
      );
      const deps = buildTestDeps({ fetch: fake.fetch });
      const view = renderOpportunitiesRoute(deps);
      dispose = view.dispose;
      document.body.append(view.element);
      await tick();
      await tick();
      return { fake, view };
    }

    const input = (view: { element: HTMLElement }, id: string) =>
      view.element.querySelector(
        `[data-testid="opportunities-convert-${id}"]`,
      ) as HTMLInputElement | null;

    const setValue = (el: HTMLInputElement, value: string): void => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const convertCalls = (fake: ReturnType<typeof createFakeFetch>) =>
      fake.calls.filter(
        (call) =>
          call.method === 'POST' &&
          call.url.includes('/api/opportunities/o2/convert'),
      );

    it('opens a schedule panel instead of converting on the click, then sends ISO start and end', async () => {
      const { fake, view } = await mountWon();

      (
        view.element.querySelector(
          '[data-bn="pipeline-card"][data-card-id="o2"] [data-testid="opportunities-convert-o2"]',
        ) as HTMLButtonElement
      ).click();
      await tick();

      // The click alone must not book anything.
      expect(convertCalls(fake)).toHaveLength(0);
      const start = input(view, 'start');
      const end = input(view, 'end');
      const title = input(view, 'title');
      expect(start).not.toBeNull();
      expect(start?.type).toBe('datetime-local');
      expect(end?.type).toBe('datetime-local');
      // Every control is labelled.
      for (const el of [start, end, title]) {
        expect(
          view.element.querySelector(`label[for="${el?.id}"]`)?.textContent,
        ).toBeTruthy();
      }
      // Prefilled: the opportunity's title, the next whole hour, two hours.
      expect(title?.value).toBe('Panel upgrade');
      const prefillStart = new Date(start?.value ?? '');
      expect(prefillStart.getMinutes()).toBe(0);
      expect(prefillStart.getTime()).toBeGreaterThan(Date.now());
      expect(prefillStart.getTime() - Date.now()).toBeLessThanOrEqual(
        60 * 60 * 1000,
      );
      expect(
        new Date(end?.value ?? '').getTime() - prefillStart.getTime(),
      ).toBe(2 * 60 * 60 * 1000);

      setValue(title as HTMLInputElement, 'Panel upgrade — Smith');
      setValue(start as HTMLInputElement, '2026-05-01T09:00');
      setValue(end as HTMLInputElement, '2026-05-01T11:00');
      (
        view.element.querySelector(
          '[data-testid="opportunities-convert-submit"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();

      const calls = convertCalls(fake);
      expect(calls).toHaveLength(1);
      const body = calls[0]?.body as {
        title: string;
        scheduledStart: string;
        scheduledEnd: string;
      };
      expect(body.title).toBe('Panel upgrade — Smith');
      expect(body.scheduledStart).toBe(
        new Date('2026-05-01T09:00').toISOString(),
      );
      expect(body.scheduledEnd).toBe(
        new Date('2026-05-01T11:00').toISOString(),
      );
      expect(
        new Date(body.scheduledEnd).getTime() -
          new Date(body.scheduledStart).getTime(),
      ).toBe(2 * 60 * 60 * 1000);
      // ISO 8601 with a zone designator — what the validator's .datetime()
      // requires and a raw datetime-local value is not.
      expect(body.scheduledStart).toMatch(/Z$/);

      // The panel closes and the list reloads.
      expect(input(view, 'start')).toBeNull();
      expect(
        fake.calls.filter(
          (call) =>
            call.method === 'GET' && call.url.includes('/api/opportunities'),
        ).length,
      ).toBeGreaterThanOrEqual(2);
    });

    it('is reachable from the list view too, not only the kanban', async () => {
      const { view } = await mountWon();
      (
        view.element.querySelector(
          '[data-testid="opportunities-view-list"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      (
        view.element.querySelector(
          '[data-testid="opportunities-convert-row-o2"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      expect(input(view, 'start')).not.toBeNull();
    });

    it('keeps the panel open with the API message when the slot was just taken (GP-104)', async () => {
      const fake = createFakeFetch();
      fake.respond('/api/opportunities/o2/convert', () =>
        jsonResponse(
          {
            error: {
              code: 'SLOT_TAKEN',
              message: 'That time just went — pick another',
            },
          },
          { status: 409 },
        ),
      );
      const { view } = await mountWon(fake);
      (
        view.element.querySelector(
          '[data-testid="opportunities-convert-o2"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      setValue(input(view, 'start') as HTMLInputElement, '2026-05-01T09:00');
      setValue(input(view, 'end') as HTMLInputElement, '2026-05-01T11:00');
      (
        view.element.querySelector(
          '[data-testid="opportunities-convert-submit"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();

      expect(convertCalls(fake)).toHaveLength(1);
      // Still open, so the user can pick another time without starting over.
      expect(input(view, 'start')).not.toBeNull();
      expect(
        view.element.querySelector('[data-bn-error]:not([hidden])')
          ?.textContent,
      ).toBe('That time just went — pick another');
    });

    it('refuses an end at or before the start and cancels without converting', async () => {
      const { fake, view } = await mountWon();
      (
        view.element.querySelector(
          '[data-testid="opportunities-convert-o2"]',
        ) as HTMLButtonElement
      ).click();
      await tick();

      setValue(input(view, 'start') as HTMLInputElement, '2026-05-01T11:00');
      setValue(input(view, 'end') as HTMLInputElement, '2026-05-01T09:00');
      (
        view.element.querySelector(
          '[data-testid="opportunities-convert-submit"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      expect(convertCalls(fake)).toHaveLength(0);
      expect(
        view.element.querySelector('[data-bn-error]:not([hidden])')
          ?.textContent,
      ).toContain('after the start');
      expect(input(view, 'end')?.getAttribute('aria-invalid')).toBe('true');

      (
        view.element.querySelector(
          '[data-testid="panel-cancel"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      expect(input(view, 'start')).toBeNull();
      expect(convertCalls(fake)).toHaveLength(0);
    });
  });

  /* GP-006. Every list stopped at 25 rows with no pager, so the 26th row a
     contractor entered was unreachable from that day on. */
  it('pages the list: reports meta.total and asks for page 2 on Next', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [opp({ id: 'o1' })],
        meta: { total: 60, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOpportunitiesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const pager = view.element.querySelector('[data-bn-pagination]');
    expect(pager).not.toBeNull();
    expect(pager?.hasAttribute('hidden')).toBe(false);
    expect(
      pager?.querySelector('[data-bn-pagination-summary]')?.textContent,
    ).toContain('60');

    (
      view.element.querySelector(
        '[data-testid="opportunities-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      fake.calls.some(
        (call) =>
          call.url.includes('/api/opportunities') &&
          /[?&]page=2(&|$)/.test(call.url),
      ),
    ).toBe(true);
  });
});

/* GP-015. The panel posted `leadId: ''` — a field it never showed — so every
   Save was a 400 with zod's wording. Now it asks. */
describe('New opportunity picks its lead from a select', () => {
  const LEAD_ID = '33333333-3333-4333-8333-333333333333';
  const LEAD_2 = '66666666-6666-4666-8666-666666666666';
  const EMPTY_LIST = { data: [], meta: { total: 0, page: 1, perPage: 25 } };

  function lead(partial: Partial<Lead>): Lead {
    return {
      id: LEAD_ID,
      firstName: 'Alex',
      lastName: 'Rivera',
      contact: {
        email: 'alex@example.com',
        phone: '5125550101',
        preferredContact: 'email',
      },
      status: 'qualified',
      source: 'website',
      notes: '',
      serviceType: 'Panel Upgrade',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-02T00:00:00Z',
      createdBy: 'u1',
      ...partial,
    };
  }

  function list(...leads: Lead[]) {
    return jsonResponse({
      data: leads,
      meta: { total: leads.length, page: 1, perPage: 100 },
    });
  }

  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  async function openPanel(fake: ReturnType<typeof createFakeFetch>) {
    // The create POST is `/api/opportunities` exactly; the list GET carries
    // `?page=`. Registered first because the fake matches on `includes`.
    fake.respond(/\/api\/opportunities$/, () =>
      jsonResponse({ data: opp({ id: 'o-new' }) }, { status: 201 }),
    );
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderOpportunitiesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    (
      view.element.querySelector(
        '[data-testid="opportunities-new"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();
    return view.element;
  }

  function control(root: HTMLElement) {
    return {
      select: root.querySelector(
        '[data-testid="opportunities-form-leadId"]',
      ) as HTMLSelectElement,
      title: root.querySelector(
        '[data-testid="opportunities-form-title"]',
      ) as HTMLInputElement,
      submit: root.querySelector(
        '[data-testid="panel-submit"]',
      ) as HTMLButtonElement,
    };
  }

  it('lists qualified leads by name with the UUID as the value, placeholder first', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads', () => list(lead({})));
    const root = await openPanel(fake);
    const { select } = control(root);

    expect(select.tagName).toBe('SELECT');
    expect(root.querySelector(`label[for="${select.id}"]`)?.textContent).toBe(
      'From lead',
    );
    expect(
      [...select.options].map((o) => [o.value, o.textContent, o.disabled]),
    ).toEqual([
      ['', 'Choose a lead', true],
      [LEAD_ID, 'Alex Rivera · Panel Upgrade', false],
    ]);
    expect(select.value).toBe('');
    const asked = fake.calls.find((c) => c.url.includes('/api/leads'));
    expect(asked?.url).toContain('status=qualified');
    expect(asked?.url).toContain('perPage=100');
  });

  it('falls back to every lead when none is qualified', async () => {
    const fake = createFakeFetch();
    fake.respond(/\/api\/leads\?.*status=qualified/, () => list());
    fake.respond('/api/leads', () =>
      list(
        lead({ status: 'new' }),
        lead({
          id: LEAD_2,
          firstName: 'Nia',
          lastName: 'Park',
          status: 'contacted',
          serviceType: '',
        }),
      ),
    );
    const root = await openPanel(fake);
    const { select } = control(root);

    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', 'Choose a lead'],
      [LEAD_ID, 'Alex Rivera · Panel Upgrade'],
      [LEAD_2, 'Nia Park'],
    ]);
    const leadCalls = fake.calls.filter((c) => c.url.includes('/api/leads'));
    expect(leadCalls.map((c) => c.url.includes('status=qualified'))).toEqual([
      true,
      false,
    ]);
  });

  it('blocks submit in its own words until a lead is chosen', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads', () => list(lead({})));
    const root = await openPanel(fake);
    const { select, title, submit } = control(root);
    title.value = 'New roof';
    title.dispatchEvent(new Event('input', { bubbles: true }));

    submit.click();
    await tick();
    expect(root.querySelector('[data-bn-error]')?.textContent).toBe(
      'Choose a lead.',
    );
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(select);
    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('sends the chosen lead as leadId', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads', () => list(lead({})));
    const root = await openPanel(fake);
    const { select, title, submit } = control(root);
    title.value = 'New roof';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    select.value = LEAD_ID;
    select.dispatchEvent(new Event('change', { bubbles: true }));

    submit.click();
    await tick();
    await tick();
    const posted = fake.calls.find((c) => c.method === 'POST');
    expect(posted?.url).toBe('/api/opportunities');
    expect(posted?.body).toMatchObject({ title: 'New roof', leadId: LEAD_ID });
    // The panel closed: the list is back.
    expect(root.querySelector('[data-bn-panel]')).toBeNull();
  });

  it('opens with the placeholder again after a lead was chosen last time', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads', () => list(lead({})));
    const root = await openPanel(fake);
    const first = control(root);
    first.select.value = LEAD_ID;
    first.select.dispatchEvent(new Event('change', { bubbles: true }));
    (
      root.querySelector('[data-testid="panel-cancel"]') as HTMLButtonElement
    ).click();
    await tick();
    (
      root.querySelector(
        '[data-testid="opportunities-new"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();
    expect(control(root).select.value).toBe('');
  });
});

describe('leadsForNewOpportunity', () => {
  it('asks for qualified leads and takes them when there are any', async () => {
    const calls: unknown[] = [];
    const qualified = { data: [{ id: 'a' } as Lead] };
    const result = await leadsForNewOpportunity({
      list: (params) => {
        calls.push(params);
        return Promise.resolve(qualified);
      },
    } as never);
    expect(result).toBe(qualified);
    expect(calls).toEqual([{ status: 'qualified', perPage: 100 }]);
  });

  it('falls back to every lead when no lead is qualified', async () => {
    const calls: unknown[] = [];
    const all = { data: [{ id: 'b' } as Lead] };
    const result = await leadsForNewOpportunity({
      list: (params: { status?: string }) => {
        calls.push(params);
        return Promise.resolve(params.status ? { data: [] } : all);
      },
    } as never);
    expect(result).toBe(all);
    expect(calls).toEqual([
      { status: 'qualified', perPage: 100 },
      { perPage: 100 },
    ]);
  });
});
