import { afterEach, describe, expect, it } from 'vitest';
import type { Plugin } from '@greenput/shared/models';
import { renderPluginsRoute } from './plugins.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

function plugin(partial: Partial<Plugin>): Plugin {
  return {
    id: 'p1',
    name: 'Slack',
    slug: 'slack',
    description: 'Send team notifications.',
    version: '1.0.0',
    author: 'Greenput',
    category: 'communication',
    events: [],
    configSchema: {},
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('renderPluginsRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders marketplace cards by default', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/plugins/installed', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    fake.respond('/api/plugins', () =>
      jsonResponse({
        data: [
          plugin({ id: 'p1', name: 'Slack' }),
          plugin({ id: 'p2', name: 'QuickBooks' }),
        ],
        meta: { total: 2, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderPluginsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    await tick();

    const cards = view.element.querySelectorAll('[data-bn-card]');
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toMatch(/Slack/);
  });

  it('switches to installed tab and shows uninstall buttons', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/plugins/installed', () =>
      jsonResponse({
        data: [
          {
            id: 'i1',
            workspaceId: 'w1',
            pluginId: 'p1',
            config: {},
            enabled: true,
            installedAt: '2026-04-01T00:00:00Z',
            installedBy: 'u1',
            name: 'Slack',
            slug: 'slack',
            description: 'Send notifications.',
            version: '1.0.0',
            author: 'Greenput',
            category: 'communication',
            events: [],
          },
        ],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    fake.respond('/api/plugins', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderPluginsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="plugins-tab-installed"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    const uninstallBtn = view.element.querySelector(
      '[data-testid="plugins-uninstall-i1"]',
    );
    expect(uninstallBtn).not.toBeNull();
  });

  /* GP-046. No database built from this repo has a plugin row, and the
     marketplace blamed "your filters" for the empty shelf when none were set.
     The message must come from the real filter state. */
  describe('empty marketplace (GP-046)', () => {
    function mountEmpty(): ReturnType<typeof renderPluginsRoute> {
      const fake = createFakeFetch();
      fake.respond('/api/plugins/installed', () =>
        jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
      );
      fake.respond('/api/plugins', () =>
        jsonResponse({ data: [], meta: { total: 0 } }),
      );
      const view = renderPluginsRoute(buildTestDeps({ fetch: fake.fetch }));
      dispose = view.dispose;
      document.body.append(view.element);
      return view;
    }

    function emptyNode(view: { element: HTMLElement }): HTMLElement {
      const node = view.element.querySelector('[data-bn-empty]');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    }

    it('with no category and no query, says the catalogue is empty and does not blame filters', async () => {
      const view = mountEmpty();
      await tick();
      await tick();
      await tick();

      const empty = emptyNode(view);
      expect(empty.hasAttribute('hidden')).toBe(false);
      expect(empty.textContent).not.toMatch(/filters/i);
      expect(empty.textContent).toMatch(/marketplace is empty/i);
      // The extension point that does work today is one click away.
      const link = empty.querySelector(
        '[data-testid="plugins-empty-webhooks"]',
      ) as HTMLAnchorElement | null;
      expect(link?.getAttribute('href')).toBe('/settings?tab=webhooks');
    });

    it('with a category selected, blames the filters', async () => {
      const view = mountEmpty();
      await tick();
      await tick();

      (
        view.element.querySelector(
          '[data-testid="plugins-category-accounting"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      await tick();

      const empty = emptyNode(view);
      expect(empty.hasAttribute('hidden')).toBe(false);
      expect(empty.textContent).toMatch(/filters/);
      expect(empty.querySelector('a')).toBeNull();
    });

    it('with a query typed, blames the filters', async () => {
      const view = mountEmpty();
      await tick();
      await tick();

      const input = view.element.querySelector(
        '[data-testid="plugins-search"]',
      ) as HTMLInputElement;
      input.value = 'quickbooks';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await tick();
      await tick();

      expect(emptyNode(view).textContent).toMatch(/filters/);
    });
  });

  /* GP-006. Every list stopped at 25 rows with no pager, so the 26th row a
     contractor entered was unreachable from that day on. */
  it('pages the list: reports meta.total and asks for page 2 on Next', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/plugins/installed', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    fake.respond('/api/plugins', () =>
      jsonResponse({
        data: [plugin({ id: 'p1' })],
        meta: { total: 60, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderPluginsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
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
        '[data-testid="plugins-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      fake.calls.some(
        (call) =>
          call.url.includes('/api/plugins') && /[?&]page=2(&|$)/.test(call.url),
      ),
    ).toBe(true);
  });
});
