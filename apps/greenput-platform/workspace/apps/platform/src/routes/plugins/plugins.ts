/**
 * `/plugins` — marketplace + installed tabs with category filter and search.
 *
 * Mirrors [PluginsComponent](apps/platform/src/app/features/plugins/plugins.component.ts).
 */

import { effect, signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type {
  ApiResponse,
  Plugin,
  PluginCategory,
} from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import type { InstalledPluginRow } from '../../api/plugins.js';
import { adoptSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { statusBadge } from '../shared/badge.js';
import { mountPagination, DEFAULT_PER_PAGE } from '../shared/pagination.js';
import type { RouteView } from '../types.js';

const CATEGORIES: readonly PluginCategory[] = [
  'general',
  'communication',
  'accounting',
  'scheduling',
  'marketing',
  'analytics',
];

export function renderPluginsRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);

  const view = signal<'marketplace' | 'installed'>('marketplace');
  const category = signal<string>('');
  const search = signal('');
  const installing = signal<Set<string>>(new Set());

  const cleanups: Cleanup[] = [];

  const page = signal(1);
  const marketplace = createResource<ApiResponse<Plugin[]>>(
    () => {
      const params: { page: number; category?: string; q?: string } = {
        page: page(),
      };
      if (category()) params.category = category();
      if (search()) params.q = search();
      return deps.plugins.list(params);
    },
    { auto: true },
  );
  // The marketplace pages; the installed tab is one workspace's handful and
  // the pager hides itself there.
  const pager = mountPagination({
    page,
    total: () =>
      view() === 'marketplace' ? (marketplace.data()?.meta?.total ?? 0) : 0,
    perPage: DEFAULT_PER_PAGE,
    onPage: (next) => page.set(next),
    testId: 'plugins',
    label: 'Plugin pages',
    noun: 'plugins',
    loading: marketplace.loading,
  });
  cleanups.push(pager.dispose);
  const installed = createResource<ApiResponse<InstalledPluginRow[]>>(
    () => deps.plugins.installed(),
    { auto: true },
  );

  const newButton = el(
    'span',
    {},
    `${installed.data()?.data.length ?? 0} installed`,
  );

  const header = el(
    'header',
    {},
    el(
      'div',
      {},
      el('h1', {}, 'Plugins'),
      el(
        'p',
        {},
        'Marketplace integrations and the plugins you have installed.',
      ),
    ),
    newButton,
  );

  // ── view tabs ──────────────────────────────────────────────────────────
  const tabs = el('div', { 'data-bn-segmented': '', role: 'tablist' });
  function renderTabs(active: 'marketplace' | 'installed'): void {
    clear(tabs);
    for (const value of ['marketplace', 'installed'] as const) {
      const btn = el(
        'button',
        {
          type: 'button',
          'data-bn-button': '',
          'data-testid': `plugins-tab-${value}`,
          role: 'tab',
          'aria-selected': active === value ? 'true' : 'false',
        },
        value === 'marketplace' ? 'Marketplace' : 'Installed',
      );
      if (active === value) btn.setAttribute('data-bn-active', '');
      btn.addEventListener('click', () => view.set(value));
      tabs.append(btn);
    }
  }
  renderTabs('marketplace');
  cleanups.push(
    effect(() => {
      renderTabs(view());
      newButton.textContent = `${installed.data()?.data.length ?? 0} installed`;
    }).dispose,
  );

  // ── search + category filter (marketplace only) ────────────────────────
  const searchInput = el('input', {
    type: 'search',
    'data-bn-input': '',
    placeholder: 'Search plugins…',
    'data-testid': 'plugins-search',
    'aria-label': 'Search plugins',
  }) as HTMLInputElement;
  on(searchInput, 'input', () => {
    page.set(1);
    search.set(searchInput.value);
    void marketplace.reload();
  });

  const categoryBar = el('div', { 'data-bn-segmented': '', role: 'tablist' });
  function renderCategoryBar(active: string): void {
    clear(categoryBar);
    const all = makeFilterButton('All', '', active === '', () => {
      page.set(1);
      category.set('');
      void marketplace.reload();
    });
    categoryBar.append(all);
    for (const cat of CATEGORIES) {
      const btn = makeFilterButton(
        cat.charAt(0).toUpperCase() + cat.slice(1),
        cat,
        active === cat,
        () => {
          page.set(1);
          category.set(active === cat ? '' : cat);
          void marketplace.reload();
        },
      );
      categoryBar.append(btn);
    }
  }
  renderCategoryBar('');
  cleanups.push(
    effect(() => {
      renderCategoryBar(category());
    }).dispose,
  );

  const filterRow = el(
    'div',
    { 'data-bn-toolbar': '' },
    el('div', { 'data-bn-search': '' }, searchInput),
  );

  // ── content ────────────────────────────────────────────────────────────
  const grid = el('div', { 'data-bn-card-grid': '' });
  const empty = el('p', { 'data-bn-empty': '', hidden: true });
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading plugins…',
  );

  const root = el(
    'section',
    { 'data-bn-list-route': '', 'data-bn-route': 'plugins' },
    header,
    tabs,
    filterRow,
    categoryBar,
    loadingNode,
    errorNode,
    empty,
    grid,
    pager.element,
  );

  cleanups.push(
    effect(() => {
      const mode = view();
      filterRow.toggleAttribute('hidden', mode !== 'marketplace');
      categoryBar.toggleAttribute('hidden', mode !== 'marketplace');

      const isLoading =
        mode === 'marketplace' ? marketplace.loading() : installed.loading();
      const err =
        mode === 'marketplace' ? marketplace.error() : installed.error();
      const installedRows = installed.data()?.data ?? [];
      const installedIds = new Set(installedRows.map((r) => r.pluginId));
      const list =
        mode === 'marketplace'
          ? (marketplace.data()?.data ?? [])
          : installedRows;

      toggle(loadingNode, isLoading && list.length === 0);
      toggle(errorNode, err !== null);
      if (err) errorNode.textContent = `Could not load plugins: ${err.message}`;

      const hasData = list.length > 0;
      toggle(empty, !isLoading && err === null && !hasData);
      if (mode === 'marketplace') {
        fillMarketplaceEmpty(empty, category() !== '' || search() !== '');
      } else {
        empty.textContent = 'No plugins installed yet — visit the marketplace.';
      }
      toggle(grid, hasData);

      clear(grid);
      const inflight = installing();
      if (mode === 'marketplace') {
        for (const plugin of list as Plugin[]) {
          grid.append(
            renderMarketplaceCard(
              plugin,
              installedIds.has(plugin.id),
              inflight.has(plugin.id),
              async () => {
                const next = new Set(inflight);
                next.add(plugin.id);
                installing.set(next);
                try {
                  await deps.plugins.install(plugin.id);
                  await installed.reload();
                } finally {
                  const after = new Set(installing.peek());
                  after.delete(plugin.id);
                  installing.set(after);
                }
              },
            ),
          );
        }
      } else {
        for (const row of list as InstalledPluginRow[]) {
          grid.append(
            renderInstalledCard(row, async () => {
              // row.id is the INSTALLATION id (WIRE_INSTALLED_PLUGIN maps
              // plugin_installations.id); the endpoint resolves by plugin_id.
              await deps.plugins.uninstall(row.pluginId);
              await installed.reload();
            }),
          );
        }
      }
    }).dispose,
  );

  return {
    element: root,
    dispose: () => {
      marketplace.dispose();
      installed.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

/**
 * GP-046. The catalogue has no rows in any database built from this repo, and
 * the marketplace used to say "No plugins match your filters" to a contractor
 * who had set none — reading as broken search rather than an empty shelf.
 * Blame the filters only when one is actually set; otherwise say the room is
 * empty and point at Settings → Webhooks, the extension point that works
 * today. No plugins are seeded to paper over this: a listing for an
 * integration that does nothing is the same gap GP-039 has at signup.
 */
function fillMarketplaceEmpty(node: HTMLElement, filtered: boolean): void {
  clear(node);
  if (filtered) {
    node.textContent = 'No plugins match your filters.';
    return;
  }
  node.append(
    'The plugin marketplace is empty — integrations are coming. To connect your own tools today, use ',
    el(
      'a',
      {
        href: '/settings?tab=webhooks',
        'data-testid': 'plugins-empty-webhooks',
      },
      'Settings → Webhooks',
    ),
    '.',
  );
}

function makeFilterButton(
  label: string,
  value: string,
  active: boolean,
  onClick: () => void,
): HTMLElement {
  const btn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-testid': `plugins-category-${value || 'all'}`,
      role: 'tab',
      'aria-selected': active ? 'true' : 'false',
    },
    label,
  );
  if (active) btn.setAttribute('data-bn-active', '');
  btn.addEventListener('click', onClick);
  return btn;
}

function renderMarketplaceCard(
  plugin: Plugin,
  isInstalled: boolean,
  isInstalling: boolean,
  onInstall: () => Promise<void>,
): HTMLElement {
  const button = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': isInstalled ? 'secondary' : 'primary',
      'data-testid': `plugins-install-${plugin.id}`,
      disabled: isInstalled || isInstalling,
    },
    isInstalled ? 'Installed' : isInstalling ? 'Installing…' : 'Install',
  );
  if (!isInstalled && !isInstalling) {
    button.addEventListener('click', () => {
      void onInstall();
    });
  }

  return el(
    'article',
    { 'data-bn-card': '' },
    el(
      'header',
      {},
      el('span', { 'data-bn-plugin-icon': '', 'aria-hidden': 'true' }, '🧩'),
      el(
        'div',
        {},
        el('h2', {}, plugin.name),
        el('p', {}, `${plugin.author} · v${plugin.version}`),
      ),
      statusBadge('active', plugin.category),
    ),
    el('p', {}, plugin.description),
    el('footer', {}, button),
  );
}

function renderInstalledCard(
  row: InstalledPluginRow,
  onUninstall: () => Promise<void>,
): HTMLElement {
  const button = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'ghost',
      'data-testid': `plugins-uninstall-${row.id}`,
    },
    'Uninstall',
  );
  button.addEventListener('click', () => {
    void onUninstall();
  });

  return el(
    'article',
    { 'data-bn-card': '' },
    el(
      'header',
      {},
      el('span', { 'data-bn-plugin-icon': '', 'aria-hidden': 'true' }, '✓'),
      el(
        'div',
        {},
        el('h2', {}, row.name),
        el('p', {}, `${row.author} · v${row.version}`),
      ),
      statusBadge(
        row.enabled ? 'active' : 'inactive',
        row.enabled ? 'Enabled' : 'Disabled',
      ),
    ),
    el('p', {}, row.description),
    el('footer', {}, button),
  );
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}
