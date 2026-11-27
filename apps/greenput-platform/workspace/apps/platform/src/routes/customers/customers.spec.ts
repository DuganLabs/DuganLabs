import { afterEach, describe, expect, it } from 'vitest';
import type { Customer } from '@greenput/shared/models';
import { renderCustomersRoute } from './customers.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

function customer(partial: Partial<Customer>): Customer {
  return {
    id: 'c1',
    firstName: 'Alex',
    lastName: 'Reed',
    contact: {
      email: 'alex@reed.com',
      phone: '5551234567',
      preferredContact: 'phone',
    },
    address: { street: '1 Main', city: 'Town', state: 'CA', zip: '94000' },
    notes: '',
    totalJobValue: 250000,
    jobCount: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

describe('renderCustomersRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders the customer table with formatted lifetime value', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/customers', () =>
      jsonResponse({
        data: [customer({ id: 'c1', firstName: 'Alex', lastName: 'Reed' })],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderCustomersRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toMatch(/Alex Reed/);
    expect(rows[0]?.textContent).toMatch(/\$2,500/);
    expect(rows[0]?.textContent).toMatch(/3 jobs/);
  });

  it('toggles the create panel on "New customer" click', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/customers', () =>
      jsonResponse({
        data: [],
        meta: { total: 0, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderCustomersRoute(deps);
    dispose = view.dispose;
    await tick();
    await tick();

    expect(view.element.querySelector('[data-bn-panel]')).toBeNull();
    (
      view.element.querySelector(
        '[data-testid="customers-new"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(view.element.querySelector('[data-bn-panel]')).not.toBeNull();
  });

  it('reloads list when search changes', async () => {
    let lastQuery: string | undefined;
    const fake = createFakeFetch();
    fake.respond(/\/api\/customers/, () =>
      jsonResponse({
        data: [],
        meta: { total: 0, page: 1, perPage: 25 },
      }),
    );
    // Override fetch impl to capture query string
    const innerFetch = fake.fetch;
    const captureFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const match = url.match(/[?&]q=([^&]*)/);
      lastQuery = match ? decodeURIComponent(match[1] ?? '') : undefined;
      return innerFetch(input, init);
    }) as typeof fetch;
    const deps = buildTestDeps({ fetch: captureFetch });
    const view = renderCustomersRoute(deps);
    dispose = view.dispose;
    await tick();
    await tick();

    const search = view.element.querySelector(
      '[data-testid="customers-search"]',
    ) as HTMLInputElement;
    search.value = 'reed';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    await tick();

    expect(lastQuery).toBe('reed');
  });

  /* GP-006. Every list stopped at 25 rows with no pager, so the 26th row a
     contractor entered was unreachable from that day on. */
  it('pages the list: reports meta.total and asks for page 2 on Next', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/customers', () =>
      jsonResponse({
        data: [customer({ id: 'c1' })],
        meta: { total: 60, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderCustomersRoute(deps);
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
        '[data-testid="customers-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      fake.calls.some(
        (call) =>
          call.url.includes('/api/customers') &&
          /[?&]page=2(&|$)/.test(call.url),
      ),
    ).toBe(true);
  });
});
