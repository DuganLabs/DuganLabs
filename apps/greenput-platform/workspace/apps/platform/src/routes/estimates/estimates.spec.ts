import { afterEach, describe, expect, it } from 'vitest';
import {
  readEstimateLineItem,
  type Estimate,
  type Opportunity,
} from '@greenput/shared/models';
import { renderEstimatesRoute } from './estimates.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';

function estimate(partial: Partial<Estimate>): Estimate {
  return {
    id: 'e1',
    opportunityId: 'o1',
    estimateNumber: 'EST-001',
    title: 'Roof replacement',
    status: 'draft',
    subtotal: 100000,
    taxAmount: 8000,
    taxRate: 8,
    total: 108000,
    notes: '',
    lineItems: [],
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-15T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

const OPP_ID = '44444444-4444-4444-8444-444444444444';
const OPP_2 = '55555555-5555-4555-8555-555555555555';

function opp(partial: Partial<Opportunity>): Opportunity {
  return {
    id: OPP_ID,
    leadId: 'l1',
    title: 'Rewire kitchen',
    status: 'open',
    value: 500000,
    serviceType: 'Electrical',
    notes: '',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-15T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

const EMPTY_LIST = { data: [], meta: { total: 0, page: 1, perPage: 25 } };

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('renderEstimatesRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders the estimates list with status + total', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/estimates', () =>
      jsonResponse({
        data: [estimate({ id: 'e1', title: 'Roof replacement' })],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderEstimatesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toMatch(/Roof replacement/);
    expect(rows[0]?.textContent).toMatch(/\$1,080/);
  });

  it('shows "Send" only for drafts and "Mark accepted" only for sent', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/estimates', () =>
      jsonResponse({
        data: [
          estimate({ id: 'e1', status: 'draft' }),
          estimate({ id: 'e2', status: 'sent' }),
          estimate({ id: 'e3', status: 'accepted' }),
        ],
        meta: { total: 3, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderEstimatesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    expect(
      view.element.querySelector('[data-testid="estimates-send-e1"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="estimates-send-e2"]'),
    ).toBeNull();
    expect(
      view.element.querySelector('[data-testid="estimates-accept-e2"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="estimates-send-e3"]'),
    ).toBeNull();
    expect(
      view.element.querySelector('[data-testid="estimates-accept-e3"]'),
    ).toBeNull();
  });

  it('computes margin reactively as labor + material rows are added', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/estimates', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [opp({})],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderEstimatesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="estimates-new"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    // Add labor row $400 (4 * 100)
    (
      document.querySelector(
        '[data-testid="estimates-add-labor"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    const laborQty = document.querySelector(
      '[data-testid^="estimates-row-"][data-testid$="-qty"]',
    ) as HTMLInputElement;
    const laborPrice = document.querySelector(
      '[data-testid^="estimates-row-"][data-testid$="-price"]',
    ) as HTMLInputElement;
    laborQty.value = '4';
    laborQty.dispatchEvent(new Event('input', { bubbles: true }));
    laborPrice.value = '100';
    laborPrice.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    // Add material row $200
    (
      document.querySelector(
        '[data-testid="estimates-add-material"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    const matQtys = document.querySelectorAll(
      '[data-testid^="estimates-row-"][data-testid$="-qty"]',
    );
    const matPrices = document.querySelectorAll(
      '[data-testid^="estimates-row-"][data-testid$="-price"]',
    );
    const matQty = matQtys[1] as HTMLInputElement;
    const matPrice = matPrices[1] as HTMLInputElement;
    matQty.value = '2';
    matQty.dispatchEvent(new Event('input', { bubbles: true }));
    matPrice.value = '100';
    matPrice.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    await tick();

    // Subtotal: 600. Tax 0%. Grand: 600. Margin = (600-200)/600 = 66.7%
    const total = document.querySelector(
      '[data-testid="estimates-grand-total"]',
    );
    const margin = document.querySelector('[data-testid="estimates-margin"]');
    expect(total?.textContent).toBe('$600');
    expect(margin?.textContent).toBe('66.7%');

    // …and saving it sends CENTS, the canonical unit. The price boxes hold
    // dollars, and this panel was the one create form in the platform that did
    // not multiply by 100 before sending, so a $600 estimate was stored as 600
    // cents and came back as $6.00.
    (
      document.querySelector(
        '[data-testid="estimates-form-title"]',
      ) as HTMLInputElement
    ).value = 'Rewire';
    document
      .querySelector('[data-testid="estimates-form-title"]')
      ?.dispatchEvent(new Event('input', { bubbles: true }));
    choose(
      document.querySelector(
        '[data-testid="estimates-form-opportunityId"]',
      ) as HTMLSelectElement,
      OPP_ID,
    );
    await tick();

    fake.respond(/\/api\/estimates$/, () =>
      jsonResponse({ data: estimate({}) }, { status: 201 }),
    );
    (
      document.querySelector(
        '[data-testid="panel-submit"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();

    const posted = fake.calls.find((c) => c.method === 'POST');
    expect(posted).toBeDefined();
    const body = posted?.body as {
      opportunityId: string;
      lineItems: { unitPrice: number; total: number }[];
      subtotal?: number;
    };
    expect(body.opportunityId).toBe(OPP_ID);
    expect(body.lineItems.map((li) => [li.unitPrice, li.total])).toEqual([
      [10000, 40000], // 4 x $100.00
      [10000, 20000], // 2 x $100.00
    ]);
    // The API derives the totals from the line items; sending its own copy is
    // how two numbers that must agree get a chance not to.
    expect('subtotal' in body).toBe(false);
  });

  /* GP-038. The row's labor/material tag was glued onto the description as
     "[labor] …" because the wire had no `type`, and the customer's proposal
     printed the bracket. */
  it("sends each row's type as its own field and the description untouched", async () => {
    const fake = createFakeFetch();
    fake.respond('/api/estimates', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [opp({})],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderEstimatesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    (
      view.element.querySelector(
        '[data-testid="estimates-new"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    (
      document.querySelector(
        '[data-testid="estimates-add-labor"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    (
      document.querySelector(
        '[data-testid="estimates-add-material"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    const descs = [
      ...document.querySelectorAll<HTMLInputElement>(
        '[data-testid^="estimates-row-"][data-testid$="-desc"]',
      ),
    ];
    expect(descs).toHaveLength(2);
    const texts = ['Replace service panel', '200A breaker'];
    descs.forEach((input, i) => {
      input.value = texts[i] ?? '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tick();

    const title = document.querySelector(
      '[data-testid="estimates-form-title"]',
    ) as HTMLInputElement;
    title.value = 'Panel upgrade';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    choose(
      document.querySelector(
        '[data-testid="estimates-form-opportunityId"]',
      ) as HTMLSelectElement,
      OPP_ID,
    );
    await tick();
    fake.respond(/\/api\/estimates$/, () =>
      jsonResponse({ data: estimate({}) }, { status: 201 }),
    );
    (
      document.querySelector(
        '[data-testid="panel-submit"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();

    const posted = fake.calls.find((c) => c.method === 'POST');
    const body = posted?.body as {
      lineItems: { type: string; description: string }[];
    };
    expect(body.lineItems.map((li) => [li.type, li.description])).toEqual([
      ['labor', 'Replace service panel'],
      ['material', '200A breaker'],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/\[(labor|material)\]/);
  });

  it('reads an estimate stored before the change through the shared helper', () => {
    // Rows this editor wrote before GP-038 are not migrated; whoever reads
    // them (the API, the proposal page) lifts the prefix into `type`.
    const legacy = {
      id: 'li-old',
      description: '[material] 200A breaker',
      quantity: 1,
      unitPrice: 45000,
      total: 45000,
    };
    expect(readEstimateLineItem(legacy)).toEqual({
      id: 'li-old',
      type: 'material',
      description: '200A breaker',
      quantity: 1,
      unitPrice: 45000,
      total: 45000,
    });
    // …and what this editor sends now round-trips unchanged.
    const fresh = {
      id: 'li-new',
      type: 'labor' as const,
      description: 'Replace service panel',
      quantity: 4,
      unitPrice: 17500,
      total: 70000,
    };
    expect(readEstimateLineItem(fresh)).toEqual(fresh);
  });

  /* GP-015. "Opportunity ID" was a text box; the only way to fill it was to
     read a UUID out of the database. */
  describe('New estimate picks its opportunity from a select', () => {
    async function openPanel(fake: ReturnType<typeof createFakeFetch>) {
      const deps = buildTestDeps({ fetch: fake.fetch });
      const view = renderEstimatesRoute(deps);
      dispose = view.dispose;
      document.body.append(view.element);
      await tick();
      await tick();
      (
        view.element.querySelector(
          '[data-testid="estimates-new"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();
      return view.element;
    }

    it('lists opportunities by title with the UUID as the value, placeholder first', async () => {
      const fake = createFakeFetch();
      fake.respond('/api/estimates', () => jsonResponse(EMPTY_LIST));
      fake.respond('/api/opportunities', () =>
        jsonResponse({
          data: [opp({}), opp({ id: OPP_2, title: 'Panel upgrade' })],
          meta: { total: 2, page: 1, perPage: 25 },
        }),
      );
      const root = await openPanel(fake);

      const select = root.querySelector(
        '[data-testid="estimates-form-opportunityId"]',
      ) as HTMLSelectElement;
      expect(select.tagName).toBe('SELECT');
      expect(root.querySelector(`label[for="${select.id}"]`)?.textContent).toBe(
        'Opportunity',
      );
      expect(
        [...select.options].map((o) => [o.value, o.textContent, o.disabled]),
      ).toEqual([
        ['', 'Choose an opportunity', true],
        [OPP_ID, 'Rewire kitchen', false],
        [OPP_2, 'Panel upgrade', false],
      ]);
      expect(select.value).toBe('');
      // Fetched when the panel opened, at the API's page cap.
      const listed = fake.calls.find((c) =>
        c.url.includes('/api/opportunities'),
      );
      expect(listed?.url).toContain('perPage=100');
    });

    it('blocks submit in its own words until an opportunity is chosen, then sends the UUID', async () => {
      const fake = createFakeFetch();
      fake.respond('/api/estimates', () => jsonResponse(EMPTY_LIST));
      fake.respond('/api/opportunities', () =>
        jsonResponse({
          data: [opp({})],
          meta: { total: 1, page: 1, perPage: 25 },
        }),
      );
      const root = await openPanel(fake);
      const title = root.querySelector(
        '[data-testid="estimates-form-title"]',
      ) as HTMLInputElement;
      title.value = 'Kitchen rewire';
      title.dispatchEvent(new Event('input', { bubbles: true }));
      const select = root.querySelector(
        '[data-testid="estimates-form-opportunityId"]',
      ) as HTMLSelectElement;
      const submit = root.querySelector(
        '[data-testid="panel-submit"]',
      ) as HTMLButtonElement;

      submit.click();
      await tick();
      expect(root.querySelector('[data-bn-error]')?.textContent).toBe(
        'Choose an opportunity.',
      );
      expect(select.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(select);
      expect(fake.calls.some((c) => c.method === 'POST')).toBe(false);

      fake.respond(/\/api\/estimates$/, () =>
        jsonResponse({ data: estimate({}) }, { status: 201 }),
      );
      choose(select, OPP_ID);
      submit.click();
      await tick();
      await tick();
      const posted = fake.calls.find((c) => c.method === 'POST');
      expect(posted?.url).toBe('/api/estimates');
      expect((posted?.body as { opportunityId: string }).opportunityId).toBe(
        OPP_ID,
      );
      expect(select.hasAttribute('aria-invalid')).toBe(false);
    });
  });

  /* GP-006. Every list stopped at 25 rows with no pager, so the 26th row a
     contractor entered was unreachable from that day on. */
  it('pages the list: reports meta.total and asks for page 2 on Next', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/estimates', () =>
      jsonResponse({
        data: [estimate({ id: 'e1' })],
        meta: { total: 60, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderEstimatesRoute(deps);
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
        '[data-testid="estimates-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      fake.calls.some(
        (call) =>
          call.url.includes('/api/estimates') &&
          /[?&]page=2(&|$)/.test(call.url),
      ),
    ).toBe(true);
  });
});

// GP-008. "Send" sent nothing; the public proposal page existed and nothing
// linked to it. The action is named for what it does, and every sent or
// accepted row offers the link — built from the workspace record's slug.
describe('renderEstimatesRoute share links (GP-008)', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).clipboard;
  });

  const WORKSPACE = {
    id: 'w1',
    name: 'Reed HVAC',
    slug: 'reed-hvac',
    trade: 'HVAC',
    phone: '',
    email: '',
    address: { street: '', city: '', state: '', zip: '' },
    createdAt: '2026-01-01T00:00:00Z',
  };

  function q<T extends HTMLElement>(root: HTMLElement, id: string): T {
    const node = root.querySelector<T>(`[data-testid="${id}"]`);
    if (!node) throw new Error(`missing ${id}`);
    return node;
  }

  async function mount(configure: (fake: FakeFetcher) => void) {
    const fake = createFakeFetch();
    configure(fake);
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderEstimatesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    return { view, fake };
  }

  it('names the action "Mark sent" and shows the link the API answers with', async () => {
    const { view, fake } = await mount((f) => {
      f.respond(/\/api\/estimates\/e1\/send$/, () =>
        jsonResponse({
          data: estimate({ id: 'e1', status: 'sent' }),
          share: {
            url: 'https://reed-hvac.greenput.com/proposal/e1',
            message:
              'Hi Jane, here is your quote: https://reed-hvac.greenput.com/proposal/e1',
          },
        }),
      );
      f.respond('/api/estimates', () =>
        jsonResponse({
          data: [estimate({ id: 'e1', status: 'draft' })],
          meta: { total: 1, page: 1, perPage: 25 },
        }),
      );
    });
    const button = q(view.element, 'estimates-send-e1');
    expect(button.textContent).toBe('Mark sent');

    button.click();
    await tick();
    await tick();
    expect(
      fake.calls.some(
        (c) => c.method === 'POST' && c.url.endsWith('/api/estimates/e1/send'),
      ),
    ).toBe(true);
    expect(q(view.element, 'estimates-share').hasAttribute('hidden')).toBe(
      false,
    );
    expect(q(view.element, 'estimates-share-heading').textContent).toBe(
      'Proposal link ready to share',
    );
    expect(q<HTMLInputElement>(view.element, 'estimates-share-url').value).toBe(
      'https://reed-hvac.greenput.com/proposal/e1',
    );
  });

  it('"Copy proposal link" yields exactly https://<slug>.greenput.com/proposal/<id> for the seeded workspace slug', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { view } = await mount((f) => {
      f.respond('/api/estimates', () =>
        jsonResponse({
          data: [
            estimate({ id: 'e1', status: 'draft' }),
            estimate({ id: 'e2', title: 'Furnace swap', status: 'sent' }),
            estimate({ id: 'e3', status: 'accepted' }),
          ],
          meta: { total: 3, page: 1, perPage: 25 },
        }),
      );
    });
    expect(
      view.element.querySelector('[data-testid="estimates-proposal-link-e1"]'),
    ).toBeNull();
    expect(
      view.element.querySelector('[data-testid="estimates-proposal-link-e2"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="estimates-proposal-link-e3"]'),
    ).not.toBeNull();

    q(view.element, 'estimates-proposal-link-e2').click();
    await tick();
    expect(q<HTMLInputElement>(view.element, 'estimates-share-url').value).toBe(
      'https://reed-hvac.greenput.com/proposal/e2',
    );
    q(view.element, 'estimates-share-copy-url').click();
    await tick();
    expect(writeText).toHaveBeenCalledWith(
      'https://reed-hvac.greenput.com/proposal/e2',
    );
    const message = q<HTMLTextAreaElement>(
      view.element,
      'estimates-share-message',
    ).value;
    expect(message).toContain('Reed HVAC');
    expect(message).toContain('Furnace swap');
  });
});
