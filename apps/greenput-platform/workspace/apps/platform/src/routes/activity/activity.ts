/**
 * `/activity` — paginated audit log.
 *
 * Mirrors the Angular [ActivityComponent](apps/platform/src/app/features/activity/activity.component.ts).
 * Loads pages of audit entries from `/api/audit`, renders a semantic table,
 * and pages it with the shared pager (routes/shared/pagination.ts).
 */

import { signal, effect } from '@basenative/runtime';
import type { AuditEntry } from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { el, type Cleanup } from '../../lib/dom.js';
import { statusBadge } from '../shared/badge.js';
import {
  fill,
  mountTable,
  timeCell,
  type TableColumn,
} from '../shared/table.js';
import { mountPagination } from '../shared/pagination.js';
import { formatRelativeTime } from '../../lib/format.js';
import type { RouteView } from '../types.js';

const PER_PAGE = 25;

const SHEET = defineSheet(`
[data-bn-route='activity'] {
  display: grid;
  gap: var(--gp-space-5);
  padding: var(--gp-space-6);
  max-width: 70rem;
  margin: 0 auto;
}
[data-bn-route='activity'] header h1 {
  font-family: var(--gp-font-display);
  font-size: var(--gp-text-3xl);
  margin: 0 0 var(--gp-space-1);
}
[data-bn-route='activity'] header p { margin: 0; color: var(--gp-text-muted); }

[data-bn-table-wrap] {
  background: var(--gp-surface);
  border-radius: var(--gp-radius-lg);
  box-shadow: var(--gp-shadow-sm);
  overflow: hidden;
}
[data-bn-table-wrap] tbody tr:last-child td { border-bottom: none; }

[data-bn-button][data-bn-variant='secondary'] {
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule-strong);
  border-radius: var(--gp-radius-md);
  padding: var(--gp-space-2) var(--gp-space-4);
  color: var(--gp-text);
  cursor: pointer;
}
[data-bn-button][data-bn-variant='secondary']:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
[data-bn-empty], [data-bn-loading], [data-bn-error] {
  padding: var(--gp-space-5);
  text-align: center;
  color: var(--gp-text-muted);
}
[data-bn-error] { color: var(--gp-danger); }
`);

export function renderActivityRoute(deps: PlatformDeps): RouteView {
  adoptSheet(SHEET);

  const page = signal(1);
  const total = signal(0);
  const entries = signal<AuditEntry[]>([]);
  const loading = signal(false);
  const errorMessage = signal<string | null>(null);

  const tableWrap = el('div', { 'data-bn-table-wrap': '' });
  const empty = el(
    'p',
    { 'data-bn-empty': '', hidden: true },
    'No activity yet.',
  );
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading…',
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });

  const pagination = mountPagination({
    page,
    total,
    perPage: PER_PAGE,
    onPage: (next) => void load(next),
    testId: 'activity',
    label: 'Activity pages',
    loading,
  });

  const root = el(
    'section',
    { 'data-bn-route': 'activity', 'data-testid': 'activity-route' },
    el(
      'header',
      {},
      el('h1', {}, 'Activity'),
      el('p', {}, 'Every action across your workspace, newest first.'),
    ),
    loadingNode,
    errorNode,
    empty,
    tableWrap,
    pagination.element,
  );

  const cleanups: Cleanup[] = [pagination.dispose];

  async function load(targetPage: number): Promise<void> {
    loading.set(true);
    errorMessage.set(null);
    try {
      const res = await deps.audit.list({
        page: targetPage,
        perPage: PER_PAGE,
      });
      entries.set(res.data);
      total.set(res.meta?.total ?? res.data.length);
      page.set(targetPage);
    } catch (err) {
      errorMessage.set(
        err instanceof Error ? err.message : 'Failed to load activity.',
      );
    } finally {
      loading.set(false);
    }
  }

  cleanups.push(
    effect(() => {
      const isLoading = loading();
      const err = errorMessage();
      const list = entries();

      toggle(loadingNode, isLoading && list.length === 0);
      toggle(errorNode, err !== null);
      if (err) errorNode.textContent = err;

      const showEmpty = !isLoading && err === null && list.length === 0;
      toggle(empty, showEmpty);
      toggle(tableWrap, list.length > 0);

      mountTable(tableWrap, { columns: COLUMNS, rows: list });
    }).dispose,
  );

  void load(1);

  return {
    element: root,
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}

const COLUMNS: readonly TableColumn<AuditEntry>[] = [
  {
    key: 'when',
    label: 'When',
    value: (entry) => formatRelativeTime(entry.created_at),
    cell: (entry, td) =>
      fill(
        td,
        timeCell(entry.created_at, formatRelativeTime(entry.created_at)),
      ),
  },
  { key: 'who', label: 'Who', value: actorName },
  {
    key: 'action',
    label: 'Action',
    value: actionLabel,
    cell: (entry, td) =>
      fill(td, statusBadge(entry.action, actionLabel(entry))),
  },
  { key: 'entity', label: 'Entity', value: (entry) => entry.entity_type },
];

function actorName(entry: AuditEntry): string {
  return entry.first_name && entry.last_name
    ? `${entry.first_name} ${entry.last_name}`
    : 'System';
}

function actionLabel(entry: AuditEntry): string {
  return entry.action.replace(/_/g, ' ');
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}
