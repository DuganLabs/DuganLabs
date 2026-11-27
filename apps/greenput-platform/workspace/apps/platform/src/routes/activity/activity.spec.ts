import { afterEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '@greenput/shared/models';
import { renderActivityRoute } from './activity.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

function entry(partial: Partial<AuditEntry>): AuditEntry {
  return {
    id: '1',
    workspace_id: 'w1',
    user_id: 'u1',
    entity_type: 'lead',
    entity_id: 'l1',
    action: 'created',
    meta: null,
    created_at: new Date().toISOString(),
    first_name: 'Sam',
    last_name: 'Reed',
    ...partial,
  };
}

describe('renderActivityRoute', () => {
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders rows from /api/audit', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/audit', () =>
      jsonResponse({
        data: [
          entry({ id: '1', action: 'created', entity_type: 'lead' }),
          entry({ id: '2', action: 'completed', entity_type: 'job' }),
        ],
        meta: { total: 2, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });

    const view = renderActivityRoute(deps);
    dispose = view.dispose;

    document.body.append(view.element);
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(
      view.element.querySelector('[data-bn-pagination-summary]')?.textContent,
    ).toBe('Page 1 of 1 · 2 entries');
  });

  it('disables prev on page 1 and enables next when total > perPage', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/audit', () =>
      jsonResponse({
        data: [entry({ id: '1' })],
        meta: { total: 50, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderActivityRoute(deps);
    dispose = view.dispose;

    await tick();
    await tick();

    const prev = view.element.querySelector(
      '[data-testid="activity-prev"]',
    ) as HTMLButtonElement;
    const next = view.element.querySelector(
      '[data-testid="activity-next"]',
    ) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
  });

  it('clicking next loads page 2', async () => {
    let pageRequested = 0;
    const fake = createFakeFetch();
    fake.respond(/\/api\/audit/, () => {
      pageRequested++;
      const page = pageRequested;
      return jsonResponse({
        data: [entry({ id: `p${page}` })],
        meta: { total: 50, page, perPage: 25 },
      });
    });
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderActivityRoute(deps);
    dispose = view.dispose;

    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="activity-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();

    expect(pageRequested).toBe(2);
    expect(
      view.element.querySelector('[data-bn-pagination-summary]')?.textContent,
    ).toMatch(/Page 2 of 2/);
  });

  it('shows empty state when there are no entries', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/audit', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderActivityRoute(deps);
    dispose = view.dispose;

    await tick();
    await tick();

    const empty = view.element.querySelector('[data-bn-empty]');
    expect(empty?.hasAttribute('hidden')).toBe(false);
    expect(empty?.textContent).toBe('No activity yet.');
  });

  it('surfaces server errors inline', async () => {
    const fake = createFakeFetch();
    fake.respond(
      '/api/audit',
      () =>
        new Response(
          JSON.stringify({
            error: { code: 'oops', message: 'server fell over' },
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderActivityRoute(deps);
    dispose = view.dispose;

    await tick();
    await tick();

    const errorNode = view.element.querySelector('[data-bn-error]');
    expect(errorNode?.hasAttribute('hidden')).toBe(false);
    expect(errorNode?.textContent).toMatch(/server fell over/);
  });
});
