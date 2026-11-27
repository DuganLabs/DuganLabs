import { afterEach, describe, expect, it } from 'vitest';
import type { Estimate } from '@greenput/shared/models';
import { estimatePatch, renderEstimateDetailRoute } from './estimate-detail.js';
import { rowsFromLineItems } from './costing.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';
import type { PlatformDeps } from '../../deps.js';

function estimate(partial: Partial<Estimate> = {}): Estimate {
  return {
    id: 'e1',
    opportunityId: 'o1',
    customerId: 'c1',
    estimateNumber: 'EST-0001',
    title: 'Panel upgrade',
    status: 'draft',
    lineItems: [
      {
        id: 'li-a',
        type: 'labor',
        description: 'Install',
        quantity: 4,
        unitPrice: 10000,
        total: 40000,
      },
      {
        id: 'li-b',
        type: 'material',
        description: 'Panel',
        quantity: 1,
        unitPrice: 80000,
        total: 80000,
      },
    ],
    subtotal: 120000,
    taxRate: 8.25,
    taxAmount: 9900,
    total: 129900,
    notes: 'Valid 30 days.',
    validUntil: '2026-05-01T00:00:00.000Z',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

function serve(
  fake: FakeFetcher,
  initial: Estimate,
  onDelete: () => Response = () => jsonResponse({ data: { deleted: true } }),
): { current: () => Estimate } {
  let current = initial;
  fake.respond(/\/api\/workspace$/, () =>
    jsonResponse({
      data: { id: 'w1', name: 'Rivertown Electric', slug: 'rivertown' },
    }),
  );
  fake.respond(/\/api\/estimates\/e1$/, () => {
    const last = fake.calls[fake.calls.length - 1];
    if (last?.method === 'PATCH') {
      // The way the real route reads back what it wrote: totals derived.
      const body = last.body as Partial<Estimate>;
      const merged = { ...current, ...body } as Estimate;
      const subtotal = merged.lineItems.reduce(
        (sum, li) => sum + Math.round(li.quantity * li.unitPrice),
        0,
      );
      const taxAmount = Math.round(subtotal * (merged.taxRate / 100));
      current = { ...merged, subtotal, taxAmount, total: subtotal + taxAmount };
    }
    if (last?.method === 'DELETE') return onDelete();
    return jsonResponse({ data: current });
  });
  return { current: () => current };
}

function q<T extends Element = HTMLElement>(testid: string): T {
  const node = document.querySelector<T>(`[data-testid="${testid}"]`);
  if (!node) throw new Error(`no ${testid}`);
  return node;
}

function type(testid: string, value: string): void {
  const input = q<HTMLInputElement>(testid);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function signIn(deps: PlatformDeps, role: string): void {
  deps.auth.setUser({
    id: 'u1',
    email: 'dana@example.com',
    firstName: 'Dana',
    lastName: 'Ortiz',
    role,
    workspaceId: 'w1',
  });
}

describe('renderEstimateDetailRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
  });

  async function mount(
    fake: FakeFetcher,
    role = 'owner',
  ): Promise<HTMLElement> {
    history.replaceState(null, '', '/estimates/e1');
    const deps = buildTestDeps({ fetch: fake.fetch });
    signIn(deps, role);
    const view = renderEstimateDetailRoute(deps, { id: 'e1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    return view.element;
  }

  it('reads GET /api/estimates/:id and renders the fields, the typed line items and the labor / materials split', async () => {
    const fake = createFakeFetch();
    serve(fake, estimate());
    const root = await mount(fake);

    expect(fake.calls[0]).toMatchObject({
      method: 'GET',
      url: '/api/estimates/e1',
    });
    expect(q('estimate-detail-heading').textContent).toBe('Panel upgrade');
    expect(q('estimate-detail-back').getAttribute('href')).toBe('/estimates');
    expect(q('estimate-detail-field-total').textContent).toBe('$1,299.00');
    expect(q('estimate-detail-field-subtotal').textContent).toBe('$1,200.00');
    expect(q('estimate-detail-field-tax').textContent).toBe('$99.00 (8.25%)');
    expect(q('estimate-detail-field-sent').textContent).toBe('Not marked sent');
    expect(
      q('estimate-detail-field-status')
        .querySelector('[data-bn="badge"]')
        ?.getAttribute('data-bn-status'),
    ).toBe('draft');
    const items = q('estimate-detail-line-items');
    const rows = [...items.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['Labor', 'Install', '4', '$100.00', '$400.00'],
      ['Material', 'Panel', '1', '$800.00', '$800.00'],
    ]);
    expect(q('estimate-detail-labor').textContent).toBe('$400.00');
    expect(q('estimate-detail-materials').textContent).toBe('$800.00');
    expect(root.getAttribute('data-bn-route')).toBe('estimate-detail');
    // A draft offers Mark sent and nothing else.
    expect(q('estimate-detail-send')).not.toBeNull();
    expect(
      document.querySelector('[data-testid="estimate-detail-accept"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="estimate-detail-proposal-link"]'),
    ).toBeNull();
  });

  it('Edit: the costing editor holds the rows in dollars; a changed quantity and title PATCH cents and re-read the derived totals', async () => {
    const fake = createFakeFetch();
    const server = serve(fake, estimate());
    const root = await mount(fake);

    q('estimate-detail-edit').click();
    await tick();
    expect(root.querySelector('[data-bn-panel] h2')?.textContent).toBe(
      'Edit estimate',
    );
    expect(q<HTMLInputElement>('estimate-detail-row-li-a-price').value).toBe(
      '100',
    );
    expect(q<HTMLInputElement>('estimate-detail-form-taxRate').value).toBe(
      '8.25',
    );
    expect(q<HTMLInputElement>('estimate-detail-form-validUntil').value).toBe(
      '2026-05-01',
    );
    expect(q('estimate-detail-grand-total').textContent).toBe('$1,299');

    type('estimate-detail-form-title', 'Panel upgrade — 200A');
    type('estimate-detail-row-li-a-qty', '5');
    expect(q('estimate-detail-grand-total').textContent).toBe('$1,407');
    q('panel-submit').click();
    await tick();
    await tick();
    await tick();

    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/api/estimates/e1');
    expect(patch?.body).toEqual({
      title: 'Panel upgrade — 200A',
      lineItems: [
        {
          id: 'li-a',
          type: 'labor',
          description: 'Install',
          quantity: 5,
          unitPrice: 10000,
          total: 50000,
        },
        {
          id: 'li-b',
          type: 'material',
          description: 'Panel',
          quantity: 1,
          unitPrice: 80000,
          total: 80000,
        },
      ],
    });
    expect(server.current().total).toBe(140725);
    expect(root.querySelector('[data-bn-panel]')).toBeNull();
    expect(q('estimate-detail-heading').textContent).toBe(
      'Panel upgrade — 200A',
    );
    expect(q('estimate-detail-field-total').textContent).toBe('$1,407.25');
    expect(q('estimate-detail-labor').textContent).toBe('$500.00');
    expect(q('estimate-detail-notice').textContent).toBe('Changes saved.');
  });

  it('saving with nothing changed makes no PATCH at all', async () => {
    const fake = createFakeFetch();
    serve(fake, estimate());
    await mount(fake);
    q('estimate-detail-edit').click();
    await tick();
    q('panel-submit').click();
    await tick();
    await tick();
    expect(fake.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(document.querySelector('[data-bn-panel]')).toBeNull();
  });

  it("surfaces the API's refusal of a save in the form", async () => {
    const fake = createFakeFetch();
    fake.respond(/\/api\/estimates\/e1$/, () => {
      const last = fake.calls[fake.calls.length - 1];
      if (last?.method === 'PATCH') {
        return jsonResponse(
          { error: { code: 'VALIDATION', message: 'taxRate must be <= 100' } },
          { status: 400 },
        );
      }
      return jsonResponse({ data: estimate() });
    });
    const root = await mount(fake);
    q('estimate-detail-edit').click();
    await tick();
    type('estimate-detail-form-taxRate', '150');
    q('panel-submit').click();
    await tick();
    await tick();
    expect(
      root.querySelector('[data-bn-panel-form] [data-bn-error]')?.textContent,
    ).toBe('taxRate must be <= 100');
    expect(root.querySelector('[data-bn-panel]')).not.toBeNull();
  });

  it('Mark sent posts to /send, shows the share card with the link, and says nothing was sent', async () => {
    const fake = createFakeFetch();
    const server = serve(fake, estimate());
    fake.respond('/api/estimates/e1/send', () => {
      Object.assign(server.current(), {
        status: 'sent',
        sentAt: '2026-04-10T00:00:00.000Z',
      });
      return jsonResponse({
        data: server.current(),
        share: {
          url: 'https://rivertown.greenput.com/proposal/e1',
          message:
            'Hi, here is your quote: https://rivertown.greenput.com/proposal/e1',
        },
      });
    });
    await mount(fake);
    q('estimate-detail-send').click();
    await tick();
    await tick();
    await tick();
    expect(
      fake.calls.some(
        (c) => c.method === 'POST' && c.url === '/api/estimates/e1/send',
      ),
    ).toBe(true);
    expect(q('estimate-detail-share').hasAttribute('hidden')).toBe(false);
    expect(q<HTMLInputElement>('estimate-detail-share-url').value).toBe(
      'https://rivertown.greenput.com/proposal/e1',
    );
    expect(q('estimate-detail-share-heading').textContent).toBe(
      'Proposal link ready to share',
    );
    expect(q('estimate-detail-notice').textContent).toMatch(/Nothing was sent/);
    // Re-read: now sent, so Mark accepted and the link are on offer.
    expect(q('estimate-detail-field-sent').textContent).toMatch(
      /^Apr 1?\d, 2026$/,
    );
    expect(q('estimate-detail-accept')).not.toBeNull();
    expect(q('estimate-detail-proposal-link')).not.toBeNull();
  });

  it('Copy proposal link on a sent estimate builds the link from the workspace slug', async () => {
    const fake = createFakeFetch();
    serve(fake, estimate({ status: 'sent', sentAt: '2026-04-10T00:00:00Z' }));
    await mount(fake);
    q('estimate-detail-proposal-link').click();
    await tick();
    expect(q<HTMLInputElement>('estimate-detail-share-url').value).toMatch(
      /^https:\/\/rivertown\.greenput\.(com|site)\/proposal\/e1$/,
    );
  });

  it('Mark accepted posts to /accept and re-reads', async () => {
    const fake = createFakeFetch();
    const server = serve(
      fake,
      estimate({ status: 'sent', sentAt: '2026-04-10T00:00:00Z' }),
    );
    fake.respond('/api/estimates/e1/accept', () => {
      Object.assign(server.current(), {
        status: 'accepted',
        acceptedAt: '2026-04-11T00:00:00.000Z',
      });
      return jsonResponse({ data: server.current() });
    });
    await mount(fake);
    q('estimate-detail-accept').click();
    await tick();
    await tick();
    await tick();
    expect(
      fake.calls.some(
        (c) => c.method === 'POST' && c.url === '/api/estimates/e1/accept',
      ),
    ).toBe(true);
    expect(
      q('estimate-detail-field-status')
        .querySelector('[data-bn="badge"]')
        ?.getAttribute('data-bn-status'),
    ).toBe('accepted');
    expect(
      document.querySelector('[data-testid="estimate-detail-accept"]'),
    ).toBeNull();
  });

  it('Delete confirms, then DELETEs and goes back to /estimates', async () => {
    const fake = createFakeFetch();
    serve(fake, estimate());
    await mount(fake, 'owner');
    q('estimate-detail-delete').click();
    await tick();
    expect(
      document.querySelector(
        'dialog[role="alertdialog"][open] #estimate-detail-delete-title',
      )?.textContent,
    ).toBe('Delete this estimate?');
    q('estimate-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(
      fake.calls.some(
        (c) => c.method === 'DELETE' && c.url === '/api/estimates/e1',
      ),
    ).toBe(true);
    expect(window.location.pathname).toBe('/estimates');
  });

  it("shows the API's reason when a delete is refused (not a draft)", async () => {
    const fake = createFakeFetch();
    serve(fake, estimate({ status: 'sent' }), () =>
      jsonResponse(
        {
          error: {
            code: 'ERROR',
            message: 'Only draft estimates can be deleted',
          },
        },
        { status: 400 },
      ),
    );
    await mount(fake, 'admin');
    q('estimate-detail-delete').click();
    await tick();
    q('estimate-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(
      (
        document.querySelector(
          'dialog[role="alertdialog"]',
        ) as HTMLDialogElement
      ).open,
    ).toBe(true);
    expect(q('estimate-detail-delete-error').textContent).toBe(
      'Only draft estimates can be deleted',
    );
  });

  it('a tech sees no Delete button', async () => {
    const fake = createFakeFetch();
    serve(fake, estimate());
    await mount(fake, 'tech');
    expect(q('estimate-detail-delete').hasAttribute('hidden')).toBe(true);
  });

  it('says when the estimate cannot be loaded', async () => {
    const fake = createFakeFetch();
    fake.respond(/\/api\/estimates\/e1$/, () =>
      jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'Estimate not found' } },
        { status: 404 },
      ),
    );
    await mount(fake);
    expect(q('estimate-detail-error').textContent).toBe(
      'Could not load this estimate: Estimate not found',
    );
  });
});

describe('estimatePatch', () => {
  const draft = () => ({
    title: 'Panel upgrade',
    validUntil: '2026-05-01',
    taxRate: '8.25',
    notes: 'Valid 30 days.',
    rows: rowsFromLineItems(estimate().lineItems),
  });

  it('is empty when nothing changed — line items included', () => {
    expect(estimatePatch(estimate(), draft())).toEqual({});
  });

  it('sends the rate as a number, a cleared date as null, and the whole list when a row changed', () => {
    const rows = draft().rows.map((row, i) =>
      i === 1 ? { ...row, unitPrice: 750 } : row,
    );
    expect(
      estimatePatch(estimate(), {
        ...draft(),
        taxRate: '0',
        validUntil: '',
        rows,
      }),
    ).toEqual({
      taxRate: 0,
      validUntil: null,
      lineItems: [
        {
          id: 'li-a',
          type: 'labor',
          description: 'Install',
          quantity: 4,
          unitPrice: 10000,
          total: 40000,
        },
        {
          id: 'li-b',
          type: 'material',
          description: 'Panel',
          quantity: 1,
          unitPrice: 75000,
          total: 75000,
        },
      ],
    });
  });

  it('a new date is sent as ISO', () => {
    expect(
      estimatePatch(estimate(), { ...draft(), validUntil: '2026-06-01' }),
    ).toEqual({ validUntil: new Date('2026-06-01T00:00:00').toISOString() });
  });
});
