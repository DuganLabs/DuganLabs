import { afterEach, describe, expect, it } from 'vitest';
import type { Lead } from '@greenput/shared/models';
import { renderLeadsRoute } from './leads.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

function dropCard(target: Element, cardId: string): void {
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', {
    value: {
      getData: () => JSON.stringify({ type: 'pipeline-card', cardId }),
      dropEffect: 'move',
    },
  });
  target.dispatchEvent(drop);
}

function columnCards(root: Element, columnId: string): Element {
  return root.querySelector(
    `[data-bn="pipeline-column"][data-column-id="${columnId}"] [data-bn="pipeline-column-cards"]`,
  ) as Element;
}

function lead(partial: Partial<Lead>): Lead {
  return {
    id: 'l1',
    firstName: 'Alex',
    lastName: 'Reed',
    contact: {
      email: 'alex@reed.com',
      phone: '5551234567',
      preferredContact: 'phone',
    },
    status: 'new',
    source: 'website',
    notes: '',
    serviceType: 'HVAC',
    estimatedValue: 250000,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

describe('renderLeadsRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders the leads table with status badges + value', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads', () =>
      jsonResponse({
        data: [
          lead({ id: 'l1', firstName: 'Alex', status: 'new' }),
          lead({ id: 'l2', firstName: 'Bea', status: 'qualified' }),
        ],
        meta: { total: 2, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLeadsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const badges = view.element.querySelectorAll('tbody [data-bn="badge"]');
    expect(badges[0]?.getAttribute('data-bn-status')).toBe('new');
    expect(badges[1]?.getAttribute('data-bn-status')).toBe('qualified');
    expect(rows[0]?.textContent).toMatch(/\$2,500/);
  });

  it('only shows convert button on qualified leads', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads', () =>
      jsonResponse({
        data: [
          lead({ id: 'l1', status: 'new' }),
          lead({ id: 'l2', status: 'qualified' }),
          lead({ id: 'l3', status: 'converted' }),
        ],
        meta: { total: 3, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLeadsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    expect(
      view.element.querySelector('[data-testid="leads-convert-l1"]'),
    ).toBeNull();
    expect(
      view.element.querySelector('[data-testid="leads-convert-l2"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="leads-convert-l3"]'),
    ).toBeNull();
  });

  it('switches to kanban view and groups by status', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads', () =>
      jsonResponse({
        data: [
          lead({ id: 'l1', status: 'new' }),
          lead({ id: 'l2', status: 'new' }),
          lead({ id: 'l3', status: 'qualified' }),
        ],
        meta: { total: 3, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLeadsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="leads-view-kanban"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    const columns = view.element.querySelectorAll(
      '[data-bn="pipeline-column"]',
    );
    expect(columns).toHaveLength(5);
    const newColumn = view.element.querySelector(
      '[data-bn="pipeline-column"][data-column-id="new"]',
    );
    expect(newColumn?.getAttribute('aria-labelledby')).toBe(
      'leads-kanban-column-new',
    );
    expect(
      newColumn?.querySelector('[data-bn="pipeline-column-count"]')
        ?.textContent,
    ).toBe('2');
    expect(
      newColumn?.querySelectorAll('[data-bn="pipeline-card"]'),
    ).toHaveLength(2);
    const card = newColumn?.querySelector('[data-card-id="l1"]');
    expect(card?.getAttribute('data-status')).toBe('new');
    expect(card?.querySelector('[data-bn="badge"]')?.textContent).toBe('New');
    expect(
      card?.querySelector('[data-bn="badge"]')?.getAttribute('data-variant'),
    ).toBe('primary');
    // No "Convert" action on a "new" card — only its lifecycle action
    // (Qualify, GP-106). Moving it between stages without a drag is the
    // component's own click-to-pick / keyboard path, not a control here.
    expect(
      Array.from(card?.querySelectorAll('button[data-action]') ?? []).map((b) =>
        b.getAttribute('data-action'),
      ),
    ).toEqual(['qualify']);
    expect(
      columnCards(view.element, 'qualified').querySelector(
        '[data-card-id="l3"] [data-testid="leads-convert-l3"]',
      ),
    ).not.toBeNull();
  });

  it('converts a qualified lead from its kanban card action', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads/l2/convert', () =>
      jsonResponse({ data: { opportunityId: 'o1' } }),
    );
    fake.respond('/api/leads', () =>
      jsonResponse({
        data: [lead({ id: 'l2', status: 'qualified' })],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLeadsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-bn="pipeline-card"][data-card-id="l2"] [data-testid="leads-convert-l2"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    expect(
      fake.calls.some(
        (call) =>
          call.method === 'POST' && call.url.includes('/api/leads/l2/convert'),
      ),
    ).toBe(true);
  });

  it('moves a dragged lead to the dropped column by changing its status', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads', () =>
      jsonResponse({
        data: [
          lead({ id: 'l1', status: 'new' }),
          lead({ id: 'l2', status: 'converted' }),
        ],
        meta: { total: 2, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLeadsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    dropCard(columnCards(view.element, 'contacted'), 'l1');
    await tick();
    await tick();

    const patches = fake.calls.filter((call) => call.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url).toContain('/api/leads/l1');
    expect(patches[0]?.body).toEqual({ status: 'contacted' });

    // Same column, the Converted column, and converted leads are no-ops.
    dropCard(columnCards(view.element, 'new'), 'l1');
    dropCard(columnCards(view.element, 'converted'), 'l1');
    dropCard(columnCards(view.element, 'new'), 'l2');
    await tick();
    expect(fake.calls.filter((call) => call.method === 'PATCH')).toHaveLength(
      1,
    );
  });

  it('moves a lead by a click to pick it up and a click in a column to place it (touch/keyboard, no drag)', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads', () =>
      jsonResponse({
        data: [lead({ id: 'l1', status: 'new' })],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLeadsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="leads-view-kanban"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    const card = view.element.querySelector(
      '[data-card-id="l1"]',
    ) as HTMLElement;
    card.click();
    expect(card.hasAttribute('data-picked')).toBe(true);
    (columnCards(view.element, 'qualified') as HTMLElement).click();
    await tick();
    await tick();

    const patches = fake.calls.filter((call) => call.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url).toContain('/api/leads/l1');
    expect(patches[0]?.body).toEqual({ status: 'qualified' });
  });

  /* GP-006. Every list stopped at 25 rows with no pager, so the 26th row a
     contractor entered was unreachable from that day on. */
  it('pages the list: reports meta.total and asks for page 2 on Next', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/leads', () =>
      jsonResponse({
        data: [lead({ id: 'l1' })],
        meta: { total: 60, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderLeadsRoute(deps);
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
        '[data-testid="leads-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      fake.calls.some(
        (call) =>
          call.url.includes('/api/leads') && /[?&]page=2(&|$)/.test(call.url),
      ),
    ).toBe(true);
  });

  /* GP-106. The billing lifecycle had no interface: a contractor could not
     qualify, accept or withdraw a lead, and nothing stated the fee before
     the click that charges them. */
  describe('billing lifecycle (GP-106)', () => {
    const LIFECYCLE = ['qualify', 'accept', 'withdraw'];
    const Q = '2026-04-02T00:00:00Z';
    const A = '2026-04-03T00:00:00Z';
    const W = '2026-04-04T00:00:00Z';

    function fourStages(): Lead[] {
      return [
        lead({ id: 'l-new', firstName: 'Nia', status: 'new' }),
        lead({
          id: 'l-qualified',
          firstName: 'Quinn',
          status: 'qualified',
          qualifiedAt: Q,
        }),
        lead({
          id: 'l-accepted',
          firstName: 'Ash',
          status: 'qualified',
          qualifiedAt: Q,
          acceptedAt: A,
        }),
        lead({
          id: 'l-withdrawn',
          firstName: 'Wren',
          status: 'qualified',
          qualifiedAt: Q,
          acceptedAt: A,
          withdrawnAt: W,
        }),
      ];
    }

    async function mount(leads: Lead[]): Promise<{
      fake: ReturnType<typeof createFakeFetch>;
      root: HTMLElement;
    }> {
      const fake = createFakeFetch();
      fake.respond(/\/api\/leads\/[^/]+\/fee$/, () =>
        jsonResponse({
          data: { leadId: 'l-qualified', vertical: 'hvac', priceUsd: 60 },
        }),
      );
      fake.respond(/\/api\/leads(\?|$)/, () =>
        jsonResponse({
          data: leads,
          meta: { total: leads.length, page: 1, perPage: 25 },
        }),
      );
      const view = renderLeadsRoute(buildTestDeps({ fetch: fake.fetch }));
      dispose = view.dispose;
      document.body.append(view.element);
      await tick();
      await tick();
      return { fake, root: view.element };
    }

    function lifecycleActionsIn(scope: Element | null): string[] {
      return Array.from(scope?.querySelectorAll('button[data-action]') ?? [])
        .map((b) => b.getAttribute('data-action') ?? '')
        .filter((a) => LIFECYCLE.includes(a));
    }

    function alertDialog(): HTMLDialogElement {
      const dialog = document.querySelector(
        'dialog[role="alertdialog"][open]',
      ) as HTMLDialogElement | null;
      if (!dialog) throw new Error('no open alertdialog');
      return dialog;
    }

    function posts(fake: ReturnType<typeof createFakeFetch>): string[] {
      return fake.calls.filter((c) => c.method === 'POST').map((c) => c.url);
    }

    it('renders exactly one lifecycle action per stage, in the list and on the card', async () => {
      const { root } = await mount(fourStages());

      const rows = Array.from(root.querySelectorAll('tbody tr'));
      expect(rows).toHaveLength(4);
      expect(rows.map(lifecycleActionsIn)).toEqual([
        ['qualify'],
        ['accept'],
        ['withdraw'],
        [],
      ]);
      // Convert is a pipeline action, not a lifecycle one — a qualified
      // lead keeps it alongside Accept.
      expect(
        rows[1]?.querySelector('[data-testid="leads-convert-l-qualified"]'),
      ).not.toBeNull();
      // The two terminal stages are timestamps, not status values, so the
      // list says so beside the pipeline badge.
      expect(
        rows[2]?.querySelector('[data-bn="badge"][data-bn-status="accepted"]')
          ?.textContent,
      ).toBe('Accepted');
      expect(
        rows[3]?.querySelector('[data-bn="badge"][data-bn-status="withdrawn"]')
          ?.textContent,
      ).toBe('Withdrawn');

      const cards = ['l-new', 'l-qualified', 'l-accepted', 'l-withdrawn'].map(
        (id) =>
          root.querySelector(`[data-bn="pipeline-card"][data-card-id="${id}"]`),
      );
      expect(cards.map(lifecycleActionsIn)).toEqual([
        ['qualify'],
        ['accept'],
        ['withdraw'],
        [],
      ]);
      for (const card of cards) {
        for (const button of card?.querySelectorAll('button[data-action]') ??
          []) {
          expect(button.textContent?.trim()).not.toBe('');
        }
      }
    });

    it('Qualify posts to /api/leads/<id>/qualify and needs no confirmation', async () => {
      const { fake, root } = await mount(fourStages());
      fake.respond('/api/leads/l-new/qualify', () =>
        jsonResponse({ data: fourStages()[0] }),
      );
      (
        root.querySelector(
          'tbody [data-testid="leads-qualify-l-new"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();
      expect(document.querySelector('dialog[open]')).toBeNull();
      expect(posts(fake)).toEqual(['/api/leads/l-new/qualify']);
      expect(
        root.querySelector('[data-testid="leads-notice"]')?.textContent,
      ).toContain('Qualified Nia');
    });

    it('Accept states the fee before the click, then posts to /api/leads/<id>/accept on confirm', async () => {
      const { fake, root } = await mount(fourStages());
      fake.respond('/api/leads/l-qualified/accept', () =>
        jsonResponse({
          data: {
            lead: fourStages()[1],
            // WS-1: accept bills nothing — the fee fires at booking.
            meterEvent: null,
            alreadyAccepted: false,
            charge: null,
          },
        }),
      );

      (
        root.querySelector(
          'tbody [data-testid="leads-accept-l-qualified"]',
        ) as HTMLButtonElement
      ).click();
      const dialog = alertDialog();
      const confirm = dialog.querySelector(
        '[data-testid="leads-accept-confirm"]',
      ) as HTMLButtonElement;
      // The fee is not on screen yet, so Confirm is not clickable yet.
      expect(confirm.disabled).toBe(true);
      expect(posts(fake)).toEqual([]);
      await tick();
      await tick();

      // Whole dollars (§5.0.1), stated before the click.
      const fee = dialog.querySelector('[data-testid="leads-accept-fee"]');
      expect(fee?.textContent).toContain('$60');
      expect(fee?.textContent).not.toContain('$0.60');
      expect(fee?.textContent).toContain('hvac');
      expect(confirm.disabled).toBe(false);
      expect(posts(fake)).toEqual([]);

      confirm.click();
      await tick();
      await tick();
      await tick();
      expect(posts(fake)).toEqual(['/api/leads/l-qualified/accept']);
      expect(document.querySelector('dialog[open]')).toBeNull();
      const notice = root.querySelector('[data-testid="leads-notice"]');
      expect(notice?.hasAttribute('hidden')).toBe(false);
      expect(notice?.textContent).toContain('Accepted Quinn');
      expect(notice?.textContent).toContain('$60');
    });

    it('Cancel in the Accept dialog posts nothing', async () => {
      const { fake, root } = await mount(fourStages());
      (
        root.querySelector(
          'tbody [data-testid="leads-accept-l-qualified"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      const dialog = alertDialog();
      (
        dialog.querySelector(
          '[data-testid="leads-accept-cancel"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      expect(document.querySelector('dialog[open]')).toBeNull();
      expect(posts(fake)).toEqual([]);
    });

    it('alreadyAccepted renders as already accepted — never as a second charge', async () => {
      const { fake, root } = await mount(fourStages());
      fake.respond('/api/leads/l-qualified/accept', () =>
        jsonResponse({
          data: {
            lead: fourStages()[2],
            meterEvent: null,
            alreadyAccepted: true,
          },
        }),
      );
      (
        root.querySelector(
          'tbody [data-testid="leads-accept-l-qualified"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();
      (
        alertDialog().querySelector(
          '[data-testid="leads-accept-confirm"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();
      await tick();
      const text =
        root.querySelector('[data-testid="leads-notice"]')?.textContent ?? '';
      expect(text).toContain('already accepted');
      expect(text).toContain('no new charge');
      expect(text).not.toMatch(/\$/);
    });

    it('Withdraw confirms in an alertdialog, then posts to /api/leads/<id>/withdraw', async () => {
      const { fake, root } = await mount(fourStages());
      fake.respond('/api/leads/l-accepted/withdraw', () =>
        jsonResponse({
          data: {
            lead: fourStages()[3],
            meterEventAdjustment: 'left_unchanged',
          },
        }),
      );
      (
        root.querySelector(
          'tbody [data-testid="leads-withdraw-l-accepted"]',
        ) as HTMLButtonElement
      ).click();
      const dialog = alertDialog();
      expect(dialog.getAttribute('aria-describedby')).toBe(
        'leads-withdraw-description',
      );
      expect(posts(fake)).toEqual([]);
      (
        dialog.querySelector(
          '[data-testid="leads-withdraw-confirm"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();
      await tick();
      expect(posts(fake)).toEqual(['/api/leads/l-accepted/withdraw']);
      // No reason picked, no reason sent.
      expect(
        fake.calls.find((c) => c.url.endsWith('/withdraw'))?.body,
      ).toBeNull();
      expect(
        root.querySelector('[data-testid="leads-notice"]')?.textContent,
      ).toContain('lead fee stands');
    });

    it('Withdraw sends the reason picked in the dialog, from the closed set (GP-105)', async () => {
      const { fake, root } = await mount(fourStages());
      fake.respond('/api/leads/l-accepted/withdraw', () =>
        jsonResponse({
          data: {
            lead: fourStages()[3],
            meterEventAdjustment: 'left_unchanged',
          },
        }),
      );
      (
        root.querySelector(
          'tbody [data-testid="leads-withdraw-l-accepted"]',
        ) as HTMLButtonElement
      ).click();
      const dialog = alertDialog();
      const select = dialog.querySelector(
        '[data-testid="leads-withdraw-reason"]',
      ) as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.value)).toEqual([
        '',
        'schedule_no_longer_works',
        'chose_another_provider',
        'no_longer_needed',
        'other',
      ]);
      // Labelled, so it is reachable by name.
      expect(dialog.querySelector(`label[for="${select.id}"]`)).not.toBeNull();
      select.value = 'chose_another_provider';
      (
        dialog.querySelector(
          '[data-testid="leads-withdraw-confirm"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();
      await tick();
      expect(fake.calls.find((c) => c.url.endsWith('/withdraw'))?.body).toEqual(
        { reason: 'chose_another_provider' },
      );
    });

    it('a rejected Accept keeps the dialog open with the API message, and charges nothing', async () => {
      const { fake, root } = await mount(fourStages());
      fake.respond('/api/leads/l-qualified/accept', () =>
        jsonResponse(
          {
            error: { code: 'NOT_QUALIFIED', message: 'Lead must be qualified' },
          },
          { status: 400 },
        ),
      );
      (
        root.querySelector(
          'tbody [data-testid="leads-accept-l-qualified"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();
      const dialog = alertDialog();
      (
        dialog.querySelector(
          '[data-testid="leads-accept-confirm"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();
      await tick();
      expect(dialog.open).toBe(true);
      expect(
        dialog.querySelector('[data-testid="leads-accept-error"]')?.textContent,
      ).toContain('qualified');
      expect(
        root
          .querySelector('[data-testid="leads-notice"]')
          ?.hasAttribute('hidden'),
      ).toBe(true);
    });
  });
});
