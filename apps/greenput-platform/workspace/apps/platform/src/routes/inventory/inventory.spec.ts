import { afterEach, describe, expect, it } from 'vitest';
import type { InventoryItem } from '@greenput/shared/models';
import { renderInventoryRoute } from './inventory.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

function item(partial: Partial<InventoryItem>): InventoryItem {
  return {
    id: 'i1',
    workspaceId: 'w1',
    name: 'Capacitor',
    description: '45uF run cap',
    category: 'parts',
    quantity: 12,
    minQuantity: 5,
    unitCost: 1500,
    unitPrice: 4500,
    supplier: 'Acme',
    location: 'Warehouse A',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...partial,
  };
}

describe('renderInventoryRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document
      .querySelectorAll('dialog[data-bn="dialog"]')
      .forEach((el) => el.remove());
  });

  it('renders the inventory table with stock badges', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/inventory', () =>
      jsonResponse({
        data: [
          item({ id: 'i1', name: 'Healthy', quantity: 12, minQuantity: 5 }),
          item({ id: 'i2', name: 'Low', quantity: 2, minQuantity: 5 }),
          item({ id: 'i3', name: 'Out', quantity: 0, minQuantity: 5 }),
        ],
        meta: { total: 3, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderInventoryRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    const badges = view.element.querySelectorAll('tbody [data-bn="badge"]');
    expect(badges[0]?.getAttribute('data-bn-status')).toBe('active');
    expect(badges[1]?.getAttribute('data-bn-status')).toBe('maintenance');
    expect(badges[2]?.getAttribute('data-bn-status')).toBe('lost');
  });

  it('opens the adjust modal when "Adjust" is clicked', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/inventory', () =>
      jsonResponse({
        data: [item({ id: 'i1' })],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderInventoryRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    expect(document.querySelector('dialog[data-bn="dialog"]')).toBeNull();
    (
      view.element.querySelector(
        '[data-testid="inventory-adjust-i1"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    const dialog = document.querySelector(
      'dialog[data-bn="dialog"]',
    ) as HTMLDialogElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.open).toBe(true);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(
      document.querySelector('[data-testid="inventory-adjust-type"]'),
    ).not.toBeNull();
  });

  it('reloads list when low-stock toggle is checked', async () => {
    let lastUrl = '';
    const fake = createFakeFetch();
    fake.respond(/\/api\/inventory/, () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    const captureFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      lastUrl = typeof input === 'string' ? input : input.toString();
      return fake.fetch(input, init);
    }) as typeof fetch;

    const deps = buildTestDeps({ fetch: captureFetch });
    const view = renderInventoryRoute(deps);
    dispose = view.dispose;
    await tick();
    await tick();

    const checkbox = view.element.querySelector(
      '[data-testid="inventory-low-only"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    await tick();
    expect(lastUrl).toMatch(/lowStock=true/);
  });

  /* GP-006. Every list stopped at 25 rows with no pager, so the 26th row a
     contractor entered was unreachable from that day on. */
  it('pages the list: reports meta.total and asks for page 2 on Next', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/inventory', () =>
      jsonResponse({
        data: [item({ id: 'i1' })],
        meta: { total: 60, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderInventoryRoute(deps);
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
        '[data-testid="inventory-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      fake.calls.some(
        (call) =>
          call.url.includes('/api/inventory') &&
          /[?&]page=2(&|$)/.test(call.url),
      ),
    ).toBe(true);
  });
});
