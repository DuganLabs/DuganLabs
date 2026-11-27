/**
 * `/reports` — multi-tab analytics: Revenue / Pipeline / Campaigns / Technicians.
 *
 * Mirrors [ReportsComponent](apps/platform/src/app/features/reports/reports.component.ts).
 */

import { effect, signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type { PlatformDeps } from '../../deps.js';
import type {
  CampaignReport,
  PipelineReport,
  RevenuePeriod,
  RevenueReport,
  TechnicianReport,
} from '../../api/reports.js';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, type Cleanup } from '../../lib/dom.js';
import { formatCurrency } from '../../lib/format.js';
import {
  fill,
  mountTable,
  twoLines,
  type TableColumn,
} from '../shared/table.js';
import type { RouteView } from '../types.js';

type TabName = 'revenue' | 'pipeline' | 'campaigns' | 'technicians';
type DateRange = '30d' | '90d' | '6m' | '12m';

const DATE_RANGES: ReadonlyArray<{ value: DateRange; label: string }> = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '6m', label: 'Last 6 months' },
  { value: '12m', label: 'Last 12 months' },
];

const PERIODS: ReadonlyArray<{ value: RevenuePeriod; label: string }> = [
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
];

const TABS: ReadonlyArray<{ value: TabName; label: string }> = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'technicians', label: 'Technicians' },
];

const REPORTS_SHEET = defineSheet(`
[data-bn-bar-chart] {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(3rem, 1fr));
  gap: var(--gp-space-2);
  align-items: end;
  height: 14rem;
  padding: var(--gp-space-3);
  background: var(--gp-surface);
  border-radius: var(--gp-radius-lg);
  box-shadow: var(--gp-shadow-sm);
}
[data-bn-bar] {
  display: grid;
  grid-template-rows: 1fr auto;
  gap: var(--gp-space-1);
  align-items: end;
  text-align: center;
}
[data-bn-bar] [data-bn-bar-fill] {
  background: var(--gp-primary);
  border-radius: var(--gp-radius-sm) var(--gp-radius-sm) 0 0;
  min-height: 2px;
}
[data-bn-bar] [data-bn-bar-label] {
  font-size: var(--gp-text-xs);
  color: var(--gp-text-muted);
}
[data-bn-funnel] { display: grid; gap: var(--gp-space-2); }
[data-bn-funnel-stage] {
  display: grid;
  grid-template-columns: 8rem 1fr 4rem;
  gap: var(--gp-space-3);
  align-items: center;
}
[data-bn-funnel-bar] {
  background: var(--gp-primary-tint);
  border-radius: var(--gp-radius-full);
  height: 1.25rem;
  position: relative;
  overflow: hidden;
}
[data-bn-funnel-fill] {
  background: var(--gp-primary);
  height: 100%;
  border-radius: inherit;
}
[data-bn-summary] {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--gp-space-3);
  margin-block-end: var(--gp-space-4);
}
[data-bn-summary-card] {
  background: var(--gp-surface);
  border-radius: var(--gp-radius-md);
  padding: var(--gp-space-3) var(--gp-space-4);
  box-shadow: var(--gp-shadow-sm);
  display: grid;
  gap: var(--gp-space-1);
}
[data-bn-summary-card] dt {
  font-size: var(--gp-text-xs);
  color: var(--gp-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
[data-bn-summary-card] dd {
  margin: 0;
  font-family: var(--gp-font-display);
  font-size: var(--gp-text-2xl);
}
`);

function isoDate(d: Date): string {
  const out = d.toISOString().slice(0, 10);
  return out;
}

function dateParams(range: DateRange): { from: string; to: string } {
  const to = isoDate(new Date());
  const fromDate = new Date();
  const days =
    range === '30d' ? 30 : range === '90d' ? 90 : range === '6m' ? 180 : 365;
  fromDate.setDate(fromDate.getDate() - days);
  return { from: isoDate(fromDate), to };
}

export function renderReportsRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);
  adoptSheet(REPORTS_SHEET);

  const tab = signal<TabName>('revenue');
  const range = signal<DateRange>('12m');
  const period = signal<RevenuePeriod>('month');

  const cleanups: Cleanup[] = [];

  const revenue = createResource<{ data: RevenueReport }>(
    () => deps.reports.revenue({ ...dateParams(range()), period: period() }),
    { auto: true },
  );
  const pipeline = createResource<{ data: PipelineReport }>(
    () => deps.reports.pipeline(dateParams(range())),
    { auto: true },
  );
  const campaigns = createResource<{ data: CampaignReport }>(
    () => deps.reports.campaigns(dateParams(range())),
    { auto: true },
  );
  const technicians = createResource<{ data: TechnicianReport }>(
    () => deps.reports.technicians(dateParams(range())),
    { auto: true },
  );

  // ── header ─────────────────────────────────────────────────────────────
  const rangeSelect = el('select', {
    'data-bn-input': '',
    'data-testid': 'reports-range',
    'aria-label': 'Date range',
  }) as HTMLSelectElement;
  for (const opt of DATE_RANGES) {
    rangeSelect.append(el('option', { value: opt.value }, opt.label));
  }
  rangeSelect.value = '12m';
  rangeSelect.addEventListener('change', () => {
    range.set(rangeSelect.value as DateRange);
    void revenue.reload();
    void pipeline.reload();
    void campaigns.reload();
    void technicians.reload();
  });

  const periodSelect = el('select', {
    'data-bn-input': '',
    'data-testid': 'reports-period',
    'aria-label': 'Aggregation period',
  }) as HTMLSelectElement;
  for (const opt of PERIODS) {
    periodSelect.append(el('option', { value: opt.value }, opt.label));
  }
  periodSelect.addEventListener('change', () => {
    period.set(periodSelect.value as RevenuePeriod);
    void revenue.reload();
  });

  const header = el(
    'header',
    {},
    el(
      'div',
      {},
      el('h1', {}, 'Reports'),
      el('p', {}, 'Revenue, pipeline, campaigns, and technician performance.'),
    ),
    el('div', { 'data-bn-toolbar': '' }, rangeSelect, periodSelect),
  );

  // ── tabs ───────────────────────────────────────────────────────────────
  const tabs = el('div', { 'data-bn-segmented': '', role: 'tablist' });
  function renderTabs(active: TabName): void {
    clear(tabs);
    for (const t of TABS) {
      const btn = el(
        'button',
        {
          type: 'button',
          'data-bn-button': '',
          'data-testid': `reports-tab-${t.value}`,
          role: 'tab',
          'aria-selected': active === t.value ? 'true' : 'false',
        },
        t.label,
      );
      if (active === t.value) btn.setAttribute('data-bn-active', '');
      btn.addEventListener('click', () => tab.set(t.value));
      tabs.append(btn);
    }
  }
  renderTabs('revenue');
  cleanups.push(
    effect(() => {
      renderTabs(tab());
    }).dispose,
  );

  const panel = el('div', { 'data-bn-report-panel': '' });

  cleanups.push(
    effect(() => {
      const active = tab();
      clear(panel);
      if (active === 'revenue') {
        panel.append(
          renderRevenuePanel(
            revenue.data()?.data,
            revenue.loading(),
            revenue.error(),
          ),
        );
      } else if (active === 'pipeline') {
        panel.append(
          renderPipelinePanel(
            pipeline.data()?.data,
            pipeline.loading(),
            pipeline.error(),
          ),
        );
      } else if (active === 'campaigns') {
        panel.append(
          renderCampaignsPanel(
            campaigns.data()?.data,
            campaigns.loading(),
            campaigns.error(),
          ),
        );
      } else {
        panel.append(
          renderTechniciansPanel(
            technicians.data()?.data,
            technicians.loading(),
            technicians.error(),
          ),
        );
      }
    }).dispose,
  );

  const root = el(
    'section',
    { 'data-bn-list-route': '', 'data-bn-route': 'reports' },
    header,
    tabs,
    panel,
  );

  return {
    element: root,
    dispose: () => {
      revenue.dispose();
      pipeline.dispose();
      campaigns.dispose();
      technicians.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

// ── Revenue panel ────────────────────────────────────────────────────────
function renderRevenuePanel(
  data: RevenueReport | undefined,
  loading: boolean,
  err: Error | null,
): HTMLElement {
  const wrap = el('div', {});
  if (loading && !data) {
    wrap.append(
      el('p', { 'data-bn-loading': '', role: 'status' }, 'Loading revenue…'),
    );
    return wrap;
  }
  if (err) {
    wrap.append(
      el(
        'p',
        { 'data-bn-error': '', role: 'alert' },
        `Could not load revenue: ${err.message}`,
      ),
    );
    return wrap;
  }
  if (!data) {
    wrap.append(el('p', { 'data-bn-empty': '' }, 'No revenue data.'));
    return wrap;
  }

  // Summary cards
  const summary = el(
    'dl',
    { 'data-bn-summary': '' },
    summaryCard(
      'Total revenue',
      formatCurrency(data.summary.totalRevenue / 100),
    ),
    summaryCard('Jobs', String(data.summary.jobCount)),
    summaryCard(
      'Average job',
      formatCurrency(data.summary.averageJobValue / 100),
    ),
  );
  wrap.append(summary);

  // Bar chart by period
  const max = Math.max(1, ...data.byPeriod.map((p) => p.revenue));
  const chart = el('div', {
    'data-bn-bar-chart': '',
    role: 'img',
    'aria-label': 'Revenue by period',
  });
  for (const point of data.byPeriod) {
    const heightPct = (point.revenue / max) * 100;
    chart.append(
      el(
        'div',
        { 'data-bn-bar': '' },
        el('div', {
          'data-bn-bar-fill': '',
          style: `height: ${heightPct}%`,
          title: `${formatCurrency(point.revenue / 100)} (${point.job_count} jobs)`,
        }),
        el('span', { 'data-bn-bar-label': '' }, point.period),
      ),
    );
  }
  wrap.append(chart);

  // Top customers table
  if (data.topCustomers.length) {
    const host = el('div', { 'data-bn-table-wrap': '' });
    mountTable(host, {
      columns: TOP_CUSTOMER_COLUMNS,
      rows: data.topCustomers,
    });
    wrap.append(host);
  }
  return wrap;
}

// ── Pipeline panel ───────────────────────────────────────────────────────
function renderPipelinePanel(
  data: PipelineReport | undefined,
  loading: boolean,
  err: Error | null,
): HTMLElement {
  const wrap = el('div', {});
  if (loading && !data) {
    wrap.append(
      el('p', { 'data-bn-loading': '', role: 'status' }, 'Loading pipeline…'),
    );
    return wrap;
  }
  if (err) {
    wrap.append(
      el(
        'p',
        { 'data-bn-error': '', role: 'alert' },
        `Could not load pipeline: ${err.message}`,
      ),
    );
    return wrap;
  }
  if (!data) {
    wrap.append(el('p', { 'data-bn-empty': '' }, 'No pipeline data.'));
    return wrap;
  }

  const summary = el(
    'dl',
    { 'data-bn-summary': '' },
    summaryCard('Conversion rate', `${data.conversionRate.toFixed(1)}%`),
    summaryCard(
      'Avg time to convert',
      data.avgTimeToConvert === null
        ? '—'
        : `${data.avgTimeToConvert.toFixed(1)} days`,
    ),
  );
  wrap.append(summary);

  // Funnel
  const funnelOrder = ['new', 'contacted', 'qualified', 'converted'];
  const stages = funnelOrder.map((status) => ({
    status,
    count: data.byStatus.find((s) => s.status === status)?.count ?? 0,
    label: status.charAt(0).toUpperCase() + status.slice(1),
  }));
  const max = Math.max(1, ...stages.map((s) => s.count));
  const funnel = el('div', { 'data-bn-funnel': '' });
  for (const s of stages) {
    funnel.append(
      el(
        'div',
        { 'data-bn-funnel-stage': '' },
        el('span', {}, s.label),
        el(
          'div',
          { 'data-bn-funnel-bar': '' },
          el('div', {
            'data-bn-funnel-fill': '',
            style: `width: ${(s.count / max) * 100}%`,
          }),
        ),
        el('strong', {}, String(s.count)),
      ),
    );
  }
  wrap.append(funnel);

  // Sources table
  if (data.bySource.length) {
    const host = el('div', { 'data-bn-table-wrap': '' });
    mountTable(host, { columns: SOURCE_COLUMNS, rows: data.bySource });
    wrap.append(host);
  }
  return wrap;
}

// ── Campaigns panel ──────────────────────────────────────────────────────
function renderCampaignsPanel(
  data: CampaignReport | undefined,
  loading: boolean,
  err: Error | null,
): HTMLElement {
  const wrap = el('div', {});
  if (loading && !data) {
    wrap.append(
      el('p', { 'data-bn-loading': '', role: 'status' }, 'Loading campaigns…'),
    );
    return wrap;
  }
  if (err) {
    wrap.append(
      el(
        'p',
        { 'data-bn-error': '', role: 'alert' },
        `Could not load campaigns: ${err.message}`,
      ),
    );
    return wrap;
  }
  if (!data || !data.campaigns.length) {
    wrap.append(
      el('p', { 'data-bn-empty': '' }, 'No campaigns in this date range.'),
    );
    return wrap;
  }

  const host = el('div', { 'data-bn-table-wrap': '' });
  mountTable(host, { columns: CAMPAIGN_COLUMNS, rows: data.campaigns });
  wrap.append(host);
  return wrap;
}

// ── Technicians panel ────────────────────────────────────────────────────
function renderTechniciansPanel(
  data: TechnicianReport | undefined,
  loading: boolean,
  err: Error | null,
): HTMLElement {
  const wrap = el('div', {});
  if (loading && !data) {
    wrap.append(
      el(
        'p',
        { 'data-bn-loading': '', role: 'status' },
        'Loading technicians…',
      ),
    );
    return wrap;
  }
  if (err) {
    wrap.append(
      el(
        'p',
        { 'data-bn-error': '', role: 'alert' },
        `Could not load technicians: ${err.message}`,
      ),
    );
    return wrap;
  }
  if (!data || !data.technicians.length) {
    wrap.append(el('p', { 'data-bn-empty': '' }, 'No technician data.'));
    return wrap;
  }

  const host = el('div', { 'data-bn-table-wrap': '' });
  mountTable(host, { columns: TECHNICIAN_COLUMNS, rows: data.technicians });
  wrap.append(host);
  return wrap;
}

function summaryCard(label: string, value: string): HTMLElement {
  return el(
    'div',
    { 'data-bn-summary-card': '' },
    el('dt', {}, label),
    el('dd', {}, value),
  );
}

const TOP_CUSTOMER_COLUMNS: readonly TableColumn<
  RevenueReport['topCustomers'][number]
>[] = [
  {
    key: 'customer',
    label: 'Top customer',
    value: (c) => `${c.first_name} ${c.last_name}`,
    cell: (c, td) =>
      fill(td, ...twoLines(`${c.first_name} ${c.last_name}`, c.company)),
  },
  {
    key: 'jobs',
    label: 'Jobs',
    value: (c) => String(c.job_count),
    align: 'end',
  },
  {
    key: 'revenue',
    label: 'Revenue',
    value: (c) => formatCurrency(c.revenue / 100),
    align: 'end',
  },
];

const SOURCE_COLUMNS: readonly TableColumn<
  PipelineReport['bySource'][number]
>[] = [
  { key: 'source', label: 'Source', value: (s) => s.source },
  { key: 'total', label: 'Total', value: (s) => String(s.total), align: 'end' },
  {
    key: 'qualified',
    label: 'Qualified',
    value: (s) => String(s.qualified),
    align: 'end',
  },
  {
    key: 'converted',
    label: 'Converted',
    value: (s) => String(s.converted),
    align: 'end',
  },
  {
    key: 'rate',
    label: 'Rate',
    value: (s) =>
      s.conversionRate !== undefined ? `${s.conversionRate.toFixed(1)}%` : '—',
  },
];

const CAMPAIGN_COLUMNS: readonly TableColumn<
  CampaignReport['campaigns'][number]
>[] = [
  { key: 'name', label: 'Campaign', value: (c) => c.name },
  { key: 'channel', label: 'Channel', value: (c) => c.channel },
  {
    key: 'budget',
    label: 'Budget',
    value: (c) => (c.budget === null ? '—' : formatCurrency(c.budget / 100)),
  },
  {
    key: 'spent',
    label: 'Spent',
    value: (c) => formatCurrency(c.spent / 100),
    align: 'end',
  },
  {
    key: 'leads',
    label: 'Leads',
    value: (c) => String(c.leadCount),
    align: 'end',
  },
  {
    key: 'cpl',
    label: 'Cost/lead',
    value: (c) =>
      c.costPerLead === null ? '—' : formatCurrency(c.costPerLead / 100),
  },
  {
    key: 'revenue',
    label: 'Revenue',
    value: (c) => formatCurrency(c.attributedRevenue / 100),
    align: 'end',
  },
  {
    key: 'roi',
    label: 'ROI',
    value: (c) => (c.roi === null ? '—' : `${c.roi.toFixed(1)}x`),
  },
];

const TECHNICIAN_COLUMNS: readonly TableColumn<
  TechnicianReport['technicians'][number]
>[] = [
  {
    key: 'technician',
    label: 'Technician',
    value: (t) => `${t.firstName} ${t.lastName}`,
    cell: (t, td) =>
      fill(td, ...twoLines(`${t.firstName} ${t.lastName}`, t.role)),
  },
  {
    key: 'jobs',
    label: 'Jobs',
    value: (t) => String(t.jobCount),
    align: 'end',
  },
  {
    key: 'revenue',
    label: 'Revenue',
    value: (t) => formatCurrency(t.revenue / 100),
    align: 'end',
  },
  {
    key: 'avg',
    label: 'Avg completion',
    value: (t) =>
      t.avgCompletionDays === null
        ? '—'
        : `${t.avgCompletionDays.toFixed(1)} days`,
  },
];
