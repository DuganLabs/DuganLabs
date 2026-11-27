import { afterEach, describe, expect, it } from 'vitest';
import type { ChangeOrder, Job } from '@greenput/shared/models';
import { renderJobDetailRoute } from './job-detail.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';

// The job page's Change orders section: once a job exists its price moves
// only through one of these (PATCH lineItems/total answers 409
// CHANGE_ORDER_REQUIRED). Anyone proposes; office and up record the
// homeowner's yes or no, once; approving re-reads the job so the new lines
// and total show.

const JOB: Job = {
  id: 'j1',
  opportunityId: 'o1',
  customerId: 'c1',
  jobNumber: '#1001',
  title: 'Panel upgrade',
  status: 'in_progress',
  address: { street: '2 Elm St', city: 'Rivertown', state: 'TX', zip: '78702' },
  scheduledStart: '2026-04-07T14:30:00.000Z',
  scheduledEnd: '2026-04-07T16:30:00.000Z',
  lineItems: [
    {
      id: 'li-1',
      description: '200A panel replacement',
      quantity: 1,
      unitPrice: 220000,
      total: 220000,
    },
  ],
  total: 220000,
  notes: '',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  createdBy: 'u-dana',
};

function co(partial: Partial<ChangeOrder> = {}): ChangeOrder {
  return {
    id: 'co1',
    workspaceId: 'w1',
    jobId: 'j1',
    number: 'CO-1001',
    title: 'Add a surge protector',
    reason: 'Found on site',
    status: 'proposed',
    lineItems: [
      {
        id: 'l1',
        type: 'material',
        description: 'Whole-home surge protector',
        quantity: 1,
        unitPrice: 79500,
        total: 79500,
      },
    ],
    priceDelta: 79500,
    totalBefore: 220000,
    decisionNote: '',
    createdAt: '2026-04-07T15:00:00Z',
    updatedAt: '2026-04-07T15:00:00Z',
    createdBy: 'u-sam',
    ...partial,
  } as ChangeOrder;
}

function serve(
  fake: FakeFetcher,
  options: { job?: Job; orders?: ChangeOrder[] } = {},
): { posts: () => { url: string; body: unknown }[] } {
  const job = options.job ?? JOB;
  let orders = options.orders ?? [co()];
  fake.respond('/api/workspace/users', () => jsonResponse({ data: [] }));
  fake.respond(/\/api\/workspace$/, () =>
    jsonResponse({ data: { id: 'w1', name: 'Rivertown Electric', slug: 'r' } }),
  );
  fake.respond(/\/api\/jobs\/j1$/, () => jsonResponse({ data: job }));
  fake.respond(/\/api\/change-orders\/co1\/(approve|reject)$/, () => {
    const last = fake.calls[fake.calls.length - 1]!;
    const status = last.url.endsWith('approve') ? 'approved' : 'rejected';
    orders = orders.map((o) =>
      o.id === 'co1'
        ? co({ status, decidedAt: '2026-04-07T16:00:00Z', decidedBy: 'u-dana' })
        : o,
    );
    return jsonResponse({ data: orders[0] });
  });
  fake.respond(/\/api\/change-orders(\?.*)?$/, () => {
    const last = fake.calls[fake.calls.length - 1]!;
    if (last.method === 'POST') {
      const body = last.body as { title: string };
      if (body.title === 'too much credit') {
        return jsonResponse(
          {
            error: {
              code: 'NEGATIVE_TOTAL',
              message: 'That credit would take the price below zero.',
            },
          },
          { status: 422 },
        );
      }
      const created = co({ id: 'co2', number: 'CO-1002', title: body.title });
      orders = [created, ...orders];
      return jsonResponse({ data: created }, { status: 201 });
    }
    return jsonResponse({ data: orders });
  });
  return {
    posts: () =>
      fake.calls
        .filter((c) => c.method === 'POST')
        .map(({ url, body }) => ({ url, body })),
  };
}

function q<T extends Element = HTMLElement>(testid: string): T {
  const node = document.querySelector<T>(`[data-testid="${testid}"]`);
  if (!node) throw new Error(`no ${testid}`);
  return node;
}
const has = (testid: string): boolean =>
  document.querySelector(`[data-testid="${testid}"]`) !== null;

function type(testid: string, value: string): void {
  const input = q<HTMLInputElement>(testid);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await tick();
}

describe('job detail — change orders', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
  });

  async function mount(fake: FakeFetcher, role = 'owner'): Promise<void> {
    history.replaceState(null, '', '/jobs/j1');
    const deps = buildTestDeps({ fetch: fake.fetch });
    deps.auth.setUser({
      id: 'u-dana',
      email: 'dana@example.com',
      firstName: 'Dana',
      lastName: 'Ortiz',
      role,
      workspaceId: 'w1',
    });
    const view = renderJobDetailRoute(deps, { id: 'j1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await settle();
  }

  it('lists the job’s change orders with number, title, signed change and status', async () => {
    const fake = createFakeFetch();
    serve(fake, {
      orders: [
        co(),
        co({
          id: 'co0',
          number: 'CO-1000',
          title: 'Skip the trench',
          priceDelta: -15000,
          status: 'rejected',
        }),
      ],
    });
    await mount(fake);

    expect(
      fake.calls.some(
        (c) => c.method === 'GET' && c.url === '/api/change-orders?jobId=j1',
      ),
    ).toBe(true);
    const row = q('job-change-order-co1');
    expect(row.textContent).toContain('CO-1001');
    expect(row.textContent).toContain('Add a surge protector');
    expect(q('job-change-order-co1-delta').textContent).toBe('+$795.00');
    expect(q('job-change-order-co0-delta').textContent).toBe('−$150.00');
    expect(
      q('job-change-order-co1')
        .querySelector('[data-bn-status]')
        ?.getAttribute('data-bn-status'),
    ).toBe('proposed');
    // A decided one offers no buttons.
    expect(has('job-change-order-co0-approve')).toBe(false);
  });

  it('says so when there are none', async () => {
    const fake = createFakeFetch();
    serve(fake, { orders: [] });
    await mount(fake);
    expect(q('job-change-orders').textContent).toContain(
      'No change orders yet.',
    );
  });

  it('office and up approve with a note; the job is re-read so the new total shows', async () => {
    const fake = createFakeFetch();
    const api = serve(fake);
    await mount(fake, 'office');
    const jobReads = () =>
      fake.calls.filter((c) => c.method === 'GET' && c.url === '/api/jobs/j1')
        .length;
    const before = jobReads();

    type('job-change-order-co1-note', 'Homeowner said yes by phone');
    q('job-change-order-co1-approve').click();
    await settle();

    expect(api.posts()).toEqual([
      {
        url: '/api/change-orders/co1/approve',
        body: { note: 'Homeowner said yes by phone' },
      },
    ]);
    expect(jobReads()).toBeGreaterThan(before);
    expect(
      q('job-change-order-co1')
        .querySelector('[data-bn-status]')
        ?.getAttribute('data-bn-status'),
    ).toBe('approved');
    expect(has('job-change-order-co1-approve')).toBe(false);
  });

  it('reject records the no', async () => {
    const fake = createFakeFetch();
    const api = serve(fake);
    await mount(fake);
    q('job-change-order-co1-reject').click();
    await settle();
    expect(api.posts()).toEqual([
      { url: '/api/change-orders/co1/reject', body: { note: '' } },
    ]);
  });

  it('a technician can propose but not decide', async () => {
    const fake = createFakeFetch();
    serve(fake);
    await mount(fake, 'tech');
    expect(has('job-change-order-co1-approve')).toBe(false);
    expect(has('job-change-order-co1-reject')).toBe(false);
    expect(has('job-change-orders-propose')).toBe(true);
  });

  it('proposes a change: dollars typed, signed cents sent, the list re-read', async () => {
    const fake = createFakeFetch();
    const api = serve(fake);
    await mount(fake, 'tech');

    q('job-change-orders-propose').click();
    type('job-change-orders-form-title', 'Move the meter');
    type('job-change-orders-form-reason', 'Utility asked');
    type('job-change-orders-form-line-0-description', 'Relocate meter base');
    type('job-change-orders-form-line-0-quantity', '2');
    type('job-change-orders-form-line-0-unitPrice', '420.50');
    q('job-change-orders-form-add-line').click();
    type(
      'job-change-orders-form-line-1-description',
      'Credit: old base reused',
    );
    type('job-change-orders-form-line-1-unitPrice', '-100');
    q('job-change-orders-form-submit').click();
    await settle();

    expect(api.posts()).toEqual([
      {
        url: '/api/change-orders',
        body: {
          jobId: 'j1',
          title: 'Move the meter',
          reason: 'Utility asked',
          lineItems: [
            {
              type: 'labor',
              description: 'Relocate meter base',
              quantity: 2,
              unitPrice: 42050,
            },
            {
              type: 'labor',
              description: 'Credit: old base reused',
              quantity: 1,
              unitPrice: -10000,
            },
          ],
        },
      },
    ]);
    expect(has('job-change-order-co2')).toBe(true);
    expect(has('job-change-orders-form-title')).toBe(false);
  });

  it('keeps the form open and shows the API’s message when it refuses', async () => {
    const fake = createFakeFetch();
    serve(fake);
    await mount(fake);
    q('job-change-orders-propose').click();
    type('job-change-orders-form-title', 'too much credit');
    type('job-change-orders-form-line-0-description', 'Credit');
    type('job-change-orders-form-line-0-unitPrice', '-99999');
    q('job-change-orders-form-submit').click();
    await settle();
    expect(q('job-change-orders-error').textContent).toContain('below zero');
    expect(has('job-change-orders-form-title')).toBe(true);
  });

  it('checks the form before sending: a title and a described, priced line', async () => {
    const fake = createFakeFetch();
    const api = serve(fake);
    await mount(fake);
    q('job-change-orders-propose').click();
    q('job-change-orders-form-submit').click();
    await settle();
    expect(q('job-change-orders-error').textContent).toContain('title');
    type('job-change-orders-form-title', 'X');
    type('job-change-orders-form-line-0-description', 'Thing');
    type('job-change-orders-form-line-0-unitPrice', 'abc');
    q('job-change-orders-form-submit').click();
    await settle();
    expect(q('job-change-orders-error').textContent).toContain('price');
    expect(api.posts()).toEqual([]);
  });

  it('a closed job takes no new change orders', async () => {
    const fake = createFakeFetch();
    serve(fake, { job: { ...JOB, status: 'paid' } });
    await mount(fake);
    expect(has('job-change-orders-propose')).toBe(false);
    expect(q('job-change-orders').textContent).toContain(
      'closed to change orders',
    );
    expect(has('job-change-order-co1-approve')).toBe(false);
  });
});
