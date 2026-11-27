import { afterEach, describe, expect, it } from 'vitest';
import type { Vehicle } from '@greenput/shared/models';
import { renderVehiclesRoute } from './vehicles.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

function vehicle(partial: Partial<Vehicle>): Vehicle {
  return {
    id: 'v1',
    workspaceId: 'w1',
    name: 'Truck 1',
    make: 'Ford',
    model: 'F-250',
    year: 2024,
    licensePlate: 'GP-001',
    status: 'active',
    mileage: 12345,
    notes: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('renderVehiclesRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders one card per vehicle with the status badge', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/vehicles', () =>
      jsonResponse({
        data: [
          vehicle({ id: 'v1', name: 'Truck 1', status: 'active' }),
          vehicle({ id: 'v2', name: 'Van 2', status: 'maintenance' }),
        ],
        meta: { total: 2, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderVehiclesRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const cards = view.element.querySelectorAll('[data-bn-card]');
    expect(cards).toHaveLength(2);
    const badges = view.element.querySelectorAll('[data-bn="badge"]');
    expect(badges[0]?.getAttribute('data-bn-status')).toBe('active');
    expect(badges[1]?.getAttribute('data-bn-status')).toBe('maintenance');
  });

  it('opens the create panel and lets you fill the name field', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/vehicles', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderVehiclesRoute(deps);
    dispose = view.dispose;
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="vehicles-new"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    const input = view.element.querySelector(
      '[data-testid="vehicles-form-name"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'Truck 9';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(input.value).toBe('Truck 9');
  });

  /* GP-006. Every list stopped at 25 rows with no pager, so the 26th row a
     contractor entered was unreachable from that day on. */
  it('pages the list: reports meta.total and asks for page 2 on Next', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/vehicles', () =>
      jsonResponse({
        data: [vehicle({ id: 'v1' })],
        meta: { total: 60, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderVehiclesRoute(deps);
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
        '[data-testid="vehicles-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      fake.calls.some(
        (call) =>
          call.url.includes('/api/vehicles') &&
          /[?&]page=2(&|$)/.test(call.url),
      ),
    ).toBe(true);
  });
});
