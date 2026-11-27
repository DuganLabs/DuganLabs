/**
 * `/dashboard` — a day's work, not a grid of numbers.
 *
 * The old dashboard opened on four KPI cards and an activity feed: four
 * facts on a laptop, one and a half on a phone, and nothing a contractor
 * standing next to a van could act on. This one is ordered the way the day
 * is:
 *
 *   1. The run sheet — every job scheduled for today, in time order, with
 *      the address and the status. This is the page's reason to exist, so
 *      it is the first thing under the masthead and it gets the most room.
 *   2. Needs you — the small number of things that are stuck: work finished
 *      but not invoiced, invoices sent but not paid. Each is one line with a
 *      count, a value and a way in.
 *   3. This month — the four figures, kept, but as a ruled strip rather than
 *      four floating cards. Same information, a sixth of the height.
 *   4. Recent activity — what just happened, compact.
 *
 * `/api/dashboard/stats` still drives 3 and 4. The run sheet and "needs you"
 * are derived from the existing `/api/jobs` list — no new endpoint — and
 * fail independently, so a schedule that will not load never takes the
 * month's figures down with it.
 */

import { effect } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import { GP_ICONS, GP_ICON_PIN } from '@greenput/shared/design';
import type {
  ActivityEntry,
  ApiResponse,
  DashboardStats,
  Job,
} from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, type Cleanup } from '../../lib/dom.js';
import { fromHtml } from '../../lib/html.js';
import { formatCurrency, formatRelativeTime } from '../../lib/format.js';
import { statusBadge } from '../shared/badge.js';
import { actionButton, onRowAction } from '../shared/table.js';
import { jobTransition } from '../jobs/jobs.js';
import type { RouteView } from '../types.js';

const SHEET = defineSheet(`
[data-bn-route='dashboard'] {
  display: grid;
  gap: var(--gp-space-6);
  padding: var(--gp-space-5) var(--gp-gutter) var(--gp-space-10);
  max-width: var(--gp-pane-max);
  margin: 0 auto;
  align-content: start;
}
[data-bn-route='dashboard'] [data-bn-route-header] { border-block-end: none; }
[data-bn-day] {
  display: block;
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
  color: var(--gp-text-muted);
  margin: 0 0 var(--gp-space-1);
}
[data-bn-route='dashboard'] h1 {
  font-size: var(--gp-text-3xl);
  font-weight: var(--gp-weight-black);
  letter-spacing: var(--gp-tracking-tight);
  color: var(--gp-text-strong);
  margin: 0;
}

/* ── Section chrome. A section is a sheet with a ruled caption, never a
   floating card in a sea of grey. */
[data-bn-panel-section] {
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-lg);
  overflow: hidden;
}
[data-bn-panel-section] > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gp-space-3);
  padding: var(--gp-space-3) var(--gp-space-4);
  background: var(--gp-surface-sunk);
  border-block-end: 1px solid var(--gp-rule);
}
[data-bn-panel-section] > header h2 {
  margin: 0;
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
  color: var(--gp-text-muted);
}
[data-bn-section-count] {
  font-size: var(--gp-text-xs);
  font-weight: var(--gp-weight-semibold);
  color: var(--gp-text-muted);
  font-variant-numeric: tabular-nums;
}

/* ── The run sheet ──────────────────────────────────────────────────────
   A time gutter down the left, then the job. Rows are ruled and 1px apart
   rather than carded and 16px apart, so a full day fits one phone screen.
   The status rule on the start edge repeats the badge's colour so the shape
   of the day reads before any word does. */
[data-bn-runsheet] { list-style: none; margin: 0; padding: 0; }
[data-bn-run-item] {
  display: grid;
  grid-template-columns: 4.25rem minmax(0, 1fr) auto;
  gap: var(--gp-space-1) var(--gp-space-3);
  align-items: center;
  padding: var(--gp-space-3) var(--gp-space-4);
  border-block-end: 1px solid var(--gp-rule);
  border-inline-start: 3px solid var(--gp-null-line);
}
[data-bn-run-item]:last-child { border-block-end: none; }
[data-bn-run-item][data-bn-tone='move'] { border-inline-start-color: var(--gp-move-line); }
[data-bn-run-item][data-bn-tone='good'] { border-inline-start-color: var(--gp-good-line); }
[data-bn-run-item][data-bn-tone='idle'] { border-inline-start-color: var(--gp-idle-line); }
[data-bn-run-item][data-bn-tone='dead'] { border-inline-start-color: var(--gp-dead-line); }
[data-bn-run-time] {
  grid-row: span 2;
  display: grid;
  gap: 1px;
  font-variant-numeric: tabular-nums;
  font-weight: var(--gp-weight-bold);
  font-size: var(--gp-text-base);
  letter-spacing: var(--gp-tracking-snug);
  color: var(--gp-text-strong);
}
[data-bn-run-time] small {
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-medium);
  color: var(--gp-text-muted);
}
[data-bn-run-title] {
  margin: 0;
  font-size: var(--gp-text-base);
  font-weight: var(--gp-weight-semibold);
  letter-spacing: var(--gp-tracking-snug);
  color: var(--gp-text-strong);
  overflow-wrap: anywhere;
}
[data-bn-run-meta] {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gp-space-1) var(--gp-space-3);
  margin: 0;
  font-size: var(--gp-text-xs);
  color: var(--gp-text-muted);
}
[data-bn-run-meta] span { display: inline-flex; align-items: center; gap: 0.25rem; }
[data-bn-run-meta] svg { inline-size: 0.875rem; block-size: 0.875rem; opacity: 0.75; }
[data-bn-run-item] > [data-bn="badge"] { grid-row: span 2; }
/* The next step for the job, on the sheet a contractor has open on site:
   Start on a scheduled job, Finish on one that is running. */
[data-bn-run-item] > [data-bn-row-actions] { grid-column: 2 / -1; display: flex; gap: 0.5rem; }
[data-bn-run-error] { color: var(--gp-dead-line); font-size: var(--gp-text-sm); margin: 0.5rem 0 0; }
@media (max-width: 30rem) {
  [data-bn-run-item] { grid-template-columns: 3.75rem minmax(0, 1fr); }
  [data-bn-run-item] > [data-bn="badge"] { grid-row: auto; grid-column: 2; justify-self: start; }
}

/* ── Needs you ──────────────────────────────────────────────────────────
   Three ruled rows at most. A count, what it is, what it is worth. */
[data-bn-needs] { list-style: none; margin: 0; padding: 0; }
[data-bn-need-item] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--gp-space-3);
  padding: var(--gp-space-3) var(--gp-space-4);
  border-block-end: 1px solid var(--gp-rule);
  min-block-size: var(--gp-tap-min);
  text-decoration: none;
  color: inherit;
}
[data-bn-need-item]:last-child { border-block-end: none; }
[data-bn-need-item]:hover { background: var(--gp-ink-25); }
[data-bn-need-count] {
  font-size: var(--gp-text-xl);
  font-weight: var(--gp-weight-black);
  letter-spacing: var(--gp-tracking-tight);
  font-variant-numeric: tabular-nums;
  color: var(--gp-text-strong);
  min-inline-size: 1.5rem;
}
[data-bn-need-item][data-bn-tone='move'] [data-bn-need-count] { color: var(--gp-move-ink); }
[data-bn-need-item][data-bn-tone='good'] [data-bn-need-count] { color: var(--gp-good-ink); }
[data-bn-need-label] { font-size: var(--gp-text-sm); color: var(--gp-text); }
[data-bn-need-value] {
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-semibold);
  color: var(--gp-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ── The month ──────────────────────────────────────────────────────────
   The four figures the old dashboard spent a full screen on, as one ruled
   strip. Two up on a phone, four up from 40rem. */
[data-bn-kpi-grid] {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
}
@media (min-width: 40rem) {
  [data-bn-kpi-grid] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
[data-bn-kpi-card] {
  display: grid;
  gap: var(--gp-space-1);
  align-content: start;
  padding: var(--gp-space-4);
  border-inline-end: 1px solid var(--gp-rule);
  border-block-end: 1px solid var(--gp-rule);
}
[data-bn-kpi-card]:nth-child(2n) { border-inline-end: none; }
@media (min-width: 40rem) {
  [data-bn-kpi-card] { border-block-end: none; }
  [data-bn-kpi-card]:nth-child(2n) { border-inline-end: 1px solid var(--gp-rule); }
  [data-bn-kpi-card]:last-child { border-inline-end: none; }
}
[data-bn-kpi-card] dt {
  font-size: var(--gp-text-2xs);
  color: var(--gp-text-muted);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
}
[data-bn-kpi-card] [data-bn-kpi-value] {
  margin: 0;
  font-size: var(--gp-text-2xl);
  font-weight: var(--gp-weight-black);
  letter-spacing: var(--gp-tracking-tight);
  font-variant-numeric: tabular-nums;
  color: var(--gp-text-strong);
  line-height: var(--gp-leading-tight);
}
[data-bn-kpi-card] [data-bn-kpi-meta] {
  margin: 0;
  font-size: var(--gp-text-xs);
  color: var(--gp-text-muted);
}
[data-bn-kpi-card] [data-bn-trend='up'] { color: var(--gp-good-ink); font-weight: var(--gp-weight-semibold); }
[data-bn-kpi-card] [data-bn-trend='down'] { color: var(--gp-dead-ink); font-weight: var(--gp-weight-semibold); }

/* ── Lower deck ─────────────────────────────────────────────────────────*/
[data-bn-deck] {
  display: grid;
  gap: var(--gp-space-6);
}
@media (min-width: 60rem) {
  [data-bn-deck] { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}

[data-bn-activity-list] { list-style: none; margin: 0; padding: 0; }
[data-bn-activity-item] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--gp-space-3);
  padding: var(--gp-space-2) var(--gp-space-4);
  border-block-end: 1px solid var(--gp-rule);
  font-size: var(--gp-text-sm);
  min-block-size: 2.75rem;
}
[data-bn-activity-item]:last-child { border-block-end: none; }
[data-bn-activity-item] [data-bn-activity-marker] {
  inline-size: 0.4375rem;
  block-size: 0.4375rem;
  border-radius: var(--gp-radius-full);
  background: var(--gp-mark);
  align-self: center;
}
[data-bn-activity-item] time {
  color: var(--gp-text-muted);
  font-size: var(--gp-text-xs);
  white-space: nowrap;
}

[data-bn-route='dashboard'] [data-bn-empty],
[data-bn-route='dashboard'] [data-bn-loading] {
  border: none;
  background: none;
  padding: var(--gp-space-6) var(--gp-space-4);
  text-align: start;
  font-size: var(--gp-text-sm);
}
[data-bn-route='dashboard'] [data-bn-error] { margin: var(--gp-space-3); }
`);

const KPI_DEFS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  // Accessible name for the card as a whole — visible `label` above is a
  // longer description, but assistive tech and E2E tests key off this
  // shorter, stable name (matches the pre-migration Angular markup).
  readonly ariaLabel: string;
  readonly format: (stats: DashboardStats) => string;
  readonly meta: (stats: DashboardStats) => string | null;
  readonly trend?: (stats: DashboardStats) => 'up' | 'down' | null;
}> = [
  {
    key: 'leads',
    label: 'Leads',
    ariaLabel: 'New leads',
    format: (s) => String(s.leads.thisMonth),
    meta: (s) =>
      s.leads.growth === null
        ? null
        : `${s.leads.growth >= 0 ? '+' : ''}${s.leads.growth}% vs last month`,
    trend: (s) =>
      s.leads.growth === null ? null : s.leads.growth >= 0 ? 'up' : 'down',
  },
  {
    key: 'jobs',
    label: 'Active jobs',
    ariaLabel: 'Active jobs',
    format: (s) => String(s.jobs.active),
    meta: (s) => `${s.jobs.dueThisWeek} due this week`,
  },
  {
    key: 'revenue',
    label: 'Revenue',
    ariaLabel: 'Revenue',
    // /100 like every other money read in this file (see the job rows and the
    // unpaid/running totals below). /api/dashboard/stats computes this as
    // SUM(jobs.total), and jobs.total is integer cents once migration 023 has
    // run — without the divide this tile is the one place the 100x error
    // survives the move to cents.
    format: (s) => formatCurrency(s.revenue.thisMonth / 100),
    meta: (s) =>
      s.revenue.growth === null
        ? null
        : `${s.revenue.growth >= 0 ? '+' : ''}${s.revenue.growth}% vs last month`,
    trend: (s) =>
      s.revenue.growth === null ? null : s.revenue.growth >= 0 ? 'up' : 'down',
  },
  {
    key: 'conversion',
    label: 'Conversion',
    ariaLabel: 'Conversion rate',
    format: (s) => `${Math.round(s.conversion.rate)}%`,
    meta: () => 'rolling 30 days',
  },
];

/** Job status → the four signal families (see the visual language doc). */
const JOB_TONE: Readonly<Record<string, string>> = {
  scheduled: 'idle',
  in_progress: 'move',
  invoiced: 'move',
  completed: 'good',
  paid: 'good',
  cancelled: 'dead',
};

const JOB_STATUS_LABELS: Readonly<Record<string, string>> = {
  scheduled: 'Scheduled',
  in_progress: 'On site',
  completed: 'Done',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

function section(
  hook: string,
  title: string,
  trailing: HTMLElement | null,
  body: HTMLElement,
): HTMLElement {
  const headingId = `dash-${hook}`;
  return el(
    'section',
    { 'data-bn-panel-section': '', 'aria-labelledby': headingId },
    el(
      'header',
      {},
      el('h2', { id: headingId }, title),
      trailing ?? el('span', { 'data-bn-section-count': '' }),
    ),
    body,
  );
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isToday(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function renderDashboardRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);
  adoptSheet(SHEET);

  const now = new Date();

  const greeting = el('p', {}, 'Welcome back.');
  const heading = el('h1', {}, 'Today');
  const dayLine = el(
    'span',
    { 'data-bn-day': '' },
    now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }),
  );
  const header = el(
    'header',
    { 'data-bn-route-header': '' },
    el('div', {}, dayLine, heading, greeting),
    el(
      'a',
      {
        // The calendar, not the list: /jobs reads `?view=calendar` (GP-062).
        href: '/jobs?view=calendar',
        'data-bn-button': '',
        'data-bn-variant': 'secondary',
        'data-testid': 'dashboard-open-calendar',
      },
      fromHtml(GP_ICONS.jobs),
      'Week view',
    ),
  );

  // ── Run sheet ──────────────────────────────────────────────────────────
  const runList = el('ul', { 'data-bn-runsheet': '' });
  const runCount = el('span', { 'data-bn-section-count': '' }, '—');
  const runError = el('p', {
    'data-bn-run-error': '',
    role: 'alert',
    hidden: '',
  });
  const runSection = section(
    'runsheet',
    "Today's run sheet",
    runCount,
    runList,
    runError,
  );

  // ── Needs you ──────────────────────────────────────────────────────────
  const needsList = el('ul', { 'data-bn-needs': '' });
  const needsSection = section('needs', 'Needs you', null, needsList);

  // ── This month ─────────────────────────────────────────────────────────
  const kpiGrid = el('dl', { 'data-bn-kpi-grid': '' });
  const kpiNodes = KPI_DEFS.map((def) => {
    const valueNode = el('dd', { 'data-bn-kpi-value': '' }, '—');
    // A `dd` (not a `span`) so each card is a valid `dl` group: one `dt`
    // followed by one or more `dd` (axe definition-list).
    const metaNode = el('dd', { 'data-bn-kpi-meta': '' });
    const card = el(
      'div',
      {
        'data-bn-kpi-card': '',
        'data-bn-kpi': def.key,
        'aria-label': def.ariaLabel,
      },
      el('dt', {}, def.label),
      valueNode,
      metaNode,
    );
    kpiGrid.append(card);
    return { def, card, valueNode, metaNode };
  });
  const monthSection = section('month', 'This month', null, kpiGrid);

  // ── Activity ───────────────────────────────────────────────────────────
  const activityList = el('ul', { 'data-bn-activity-list': '' });
  const activityCard = section(
    'activity',
    'Recent activity',
    el('a', { href: '/activity', 'data-bn-section-count': '' }, 'All activity'),
    activityList,
  );
  activityCard.setAttribute('data-bn-activity-card', '');

  const status = el('p', { 'data-bn-loading': '', role: 'status' }, 'Loading…');

  const root = el(
    'section',
    { 'data-bn-route': 'dashboard', 'data-testid': 'dashboard-route' },
    header,
    status,
    runSection,
    el('div', { 'data-bn-deck': '' }, needsSection, activityCard),
    monthSection,
  );

  greeting.textContent = greetingFor(deps.auth.user()?.firstName ?? '');

  const resource = createResource<DashboardStats>(
    () => deps.dashboard.stats(),
    {
      auto: true,
    },
  );

  // The run sheet rides on the existing jobs list rather than a new endpoint.
  // It fails on its own: a schedule that will not load leaves the month's
  // figures and the activity feed untouched.
  const jobsResource = createResource<ApiResponse<Job[]>>(
    () => deps.jobs.list({ perPage: 100 }),
    { auto: true },
  );

  const cleanups: Cleanup[] = [];

  cleanups.push(
    effect(() => {
      const stats = resource.data();
      const error = resource.error();
      const loading = resource.loading();

      if (loading && !stats) {
        status.removeAttribute('hidden');
        status.textContent = 'Loading dashboard…';
        return;
      }
      if (error && !stats) {
        status.setAttribute('data-bn-error', '');
        status.removeAttribute('data-bn-loading');
        status.textContent = 'Could not load dashboard. Try refreshing.';
        return;
      }
      status.setAttribute('hidden', '');

      if (!stats) return;
      for (const { def, valueNode, metaNode, card } of kpiNodes) {
        valueNode.textContent = def.format(stats);
        const metaText = def.meta(stats);
        metaNode.textContent = metaText ?? '';
        const trend = def.trend?.(stats) ?? null;
        if (trend) {
          metaNode.setAttribute('data-bn-trend', trend);
        } else {
          metaNode.removeAttribute('data-bn-trend');
        }
        card.removeAttribute('aria-busy');
      }

      renderActivity(activityList, stats.activity);
    }).dispose,
  );

  /* Start / Finish from the run sheet. The badge and the "needs
     attention" counts re-render from the reloaded list, so the row a
     technician just started reads "On site" without leaving the page. */
  cleanups.push(
    onRowAction(runList, (action, id) => {
      if (action !== 'start' && action !== 'finish') return;
      runError.setAttribute('hidden', '');
      void deps.jobs
        .update(id, jobTransition(action))
        .then(() => jobsResource.reload())
        .catch((err: unknown) => {
          runError.textContent =
            err instanceof Error ? err.message : `Could not ${action} job.`;
          runError.removeAttribute('hidden');
        });
    }),
  );

  cleanups.push(
    effect(() => {
      const payload = jobsResource.data();
      const error = jobsResource.error();
      const loading = jobsResource.loading();

      if (loading && !payload) {
        renderRunPlaceholder(runList, 'Loading today…');
        renderRunPlaceholder(needsList, 'Loading…');
        return;
      }
      if (error && !payload) {
        runCount.textContent = '';
        renderRunPlaceholder(
          runList,
          'Could not load the schedule. Try refreshing.',
        );
        renderRunPlaceholder(needsList, 'Could not load open work.');
        return;
      }
      const jobs = payload?.data ?? [];
      renderRunSheet(runList, runCount, jobs, now);
      renderNeeds(needsList, jobs);
    }).dispose,
  );

  return {
    element: root,
    dispose: () => {
      resource.dispose();
      jobsResource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

function renderRunPlaceholder(list: HTMLElement, message: string): void {
  clear(list);
  list.append(el('li', { 'data-bn-loading': '' }, message));
}

function renderRunSheet(
  list: HTMLElement,
  count: HTMLElement,
  jobs: readonly Job[],
  now: Date,
): void {
  clear(list);
  const today = jobs
    .filter(
      (job) =>
        isToday(job.scheduledStart, now) ||
        (job.status === 'in_progress' && !isToday(job.scheduledStart, now)),
    )
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));

  count.textContent =
    today.length === 0 ? 'Nothing booked' : `${today.length} on the board`;

  if (today.length === 0) {
    list.append(
      el(
        'li',
        { 'data-bn-empty': '' },
        'Nothing on the board today. Open the week view to schedule work.',
      ),
    );
    return;
  }

  for (const job of today) {
    const tone = JOB_TONE[job.status] ?? 'idle';
    const label = JOB_STATUS_LABELS[job.status] ?? job.status;
    const where = [job.address?.street, job.address?.city]
      .filter(Boolean)
      .join(', ');
    list.append(
      el(
        'li',
        { 'data-bn-run-item': '', 'data-bn-tone': tone },
        el(
          'span',
          { 'data-bn-run-time': '' },
          clock(job.scheduledStart),
          el('small', {}, clock(job.scheduledEnd)),
        ),
        el('p', { 'data-bn-run-title': '' }, job.title),
        statusBadge(job.status, label),
        runActions(job),
        el(
          'p',
          { 'data-bn-run-meta': '' },
          el('span', {}, job.jobNumber),
          where
            ? el('span', {}, fromHtml(GP_ICON_PIN), where)
            : el('span', {}, ''),
          el('span', {}, formatCurrency(job.total / 100)),
        ),
      ),
    );
  }
}

/** The one control a job on the sheet needs: its next step (GP-007). */
function runActions(job: Job): HTMLElement {
  const actions = el('div', { 'data-bn-row-actions': '' });
  if (job.status === 'scheduled') {
    actions.append(
      actionButton({
        action: 'start',
        id: job.id,
        label: 'Start',
        variant: 'primary',
        testId: `run-start-${job.id}`,
      }),
    );
  } else if (job.status === 'in_progress') {
    actions.append(
      actionButton({
        action: 'finish',
        id: job.id,
        label: 'Finish',
        variant: 'primary',
        testId: `run-finish-${job.id}`,
      }),
    );
  }
  return actions;
}

function renderNeeds(list: HTMLElement, jobs: readonly Job[]): void {
  clear(list);
  const toInvoice = jobs.filter((j) => j.status === 'completed');
  const unpaid = jobs.filter((j) => j.status === 'invoiced');
  const running = jobs.filter((j) => j.status === 'in_progress');

  const rows: Array<{
    count: number;
    label: string;
    value: string;
    tone: string;
    href: string;
  }> = [];
  if (toInvoice.length > 0) {
    rows.push({
      count: toInvoice.length,
      label: 'finished, not invoiced',
      value: formatCurrency(
        toInvoice.reduce((sum, j) => sum + j.total, 0) / 100,
      ),
      tone: 'good',
      href: '/jobs',
    });
  }
  if (unpaid.length > 0) {
    rows.push({
      count: unpaid.length,
      label: 'invoiced, awaiting payment',
      value: formatCurrency(unpaid.reduce((sum, j) => sum + j.total, 0) / 100),
      tone: 'move',
      href: '/jobs',
    });
  }
  if (running.length > 0) {
    rows.push({
      count: running.length,
      label: 'on site right now',
      value: formatCurrency(running.reduce((sum, j) => sum + j.total, 0) / 100),
      tone: 'move',
      href: '/jobs',
    });
  }

  if (rows.length === 0) {
    list.append(
      el('li', { 'data-bn-empty': '' }, 'Nothing waiting on you. Good day.'),
    );
    return;
  }

  for (const row of rows) {
    list.append(
      el(
        'li',
        {},
        el(
          'a',
          { href: row.href, 'data-bn-need-item': '', 'data-bn-tone': row.tone },
          el('strong', { 'data-bn-need-count': '' }, String(row.count)),
          el('span', { 'data-bn-need-label': '' }, row.label),
          el('span', { 'data-bn-need-value': '' }, row.value),
        ),
      ),
    );
  }
}

function renderActivity(list: HTMLElement, entries: ActivityEntry[]): void {
  clear(list);
  if (entries.length === 0) {
    list.append(
      el(
        'li',
        { 'data-bn-empty': '' },
        'No activity yet. Add a lead to get started.',
      ),
    );
    return;
  }
  for (const entry of entries) {
    const actor =
      entry.first_name && entry.last_name
        ? `${entry.first_name} ${entry.last_name}`
        : 'System';
    const item = el(
      'li',
      { 'data-bn-activity-item': '' },
      el('span', { 'data-bn-activity-marker': '', 'aria-hidden': 'true' }),
      el(
        'span',
        { 'data-bn-activity-text': '' },
        `${capitalize(entry.entity_type)} ${entry.action} by ${actor}`,
      ),
      el(
        'time',
        { datetime: entry.created_at },
        formatRelativeTime(entry.created_at),
      ),
    );
    list.append(item);
  }
}

function greetingFor(name: string): string {
  if (!name) return 'Welcome back.';
  return `Welcome back, ${name}.`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
