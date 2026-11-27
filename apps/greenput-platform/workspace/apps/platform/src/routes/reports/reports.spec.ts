import { afterEach, describe, expect, it } from 'vitest';
import { renderReportsRoute } from './reports.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

const REVENUE = {
  period: 'month',
  from: '2025-04-01',
  to: '2026-04-01',
  byPeriod: [
    { period: '2026-02', revenue: 100000, job_count: 4 },
    { period: '2026-03', revenue: 150000, job_count: 6 },
  ],
  byServiceType: [],
  summary: { totalRevenue: 250000, jobCount: 10, averageJobValue: 25000 },
  topCustomers: [
    {
      id: 'c1',
      first_name: 'Alex',
      last_name: 'Reed',
      company: 'Reed Co',
      revenue: 100000,
      job_count: 4,
    },
  ],
};

const PIPELINE = {
  from: '2025-04-01',
  to: '2026-04-01',
  byStatus: [
    { status: 'new', count: 30 },
    { status: 'contacted', count: 20 },
    { status: 'qualified', count: 10 },
    { status: 'converted', count: 6 },
  ],
  bySource: [],
  conversionRate: 20,
  avgTimeToConvert: 4.5,
};

describe('renderReportsRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('defaults to revenue tab and shows summary cards', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/reports/revenue', () => jsonResponse({ data: REVENUE }));
    fake.respond('/api/reports/pipeline', () =>
      jsonResponse({ data: PIPELINE }),
    );
    fake.respond('/api/reports/campaigns', () =>
      jsonResponse({ data: { from: '', to: '', campaigns: [] } }),
    );
    fake.respond('/api/reports/technicians', () =>
      jsonResponse({ data: { from: '', to: '', technicians: [] } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderReportsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    await tick();

    expect(view.element.querySelector('[data-bn-summary]')).not.toBeNull();
    const cards = view.element.querySelectorAll('[data-bn-summary-card] dd');
    expect(cards[0]?.textContent).toBe('$2,500');
    expect(cards[1]?.textContent).toBe('10');
    expect(cards[2]?.textContent).toBe('$250');
  });

  it('switches to the pipeline tab and renders the funnel', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/reports/revenue', () => jsonResponse({ data: REVENUE }));
    fake.respond('/api/reports/pipeline', () =>
      jsonResponse({ data: PIPELINE }),
    );
    fake.respond('/api/reports/campaigns', () =>
      jsonResponse({ data: { from: '', to: '', campaigns: [] } }),
    );
    fake.respond('/api/reports/technicians', () =>
      jsonResponse({ data: { from: '', to: '', technicians: [] } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderReportsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="reports-tab-pipeline"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();

    const funnel = view.element.querySelector('[data-bn-funnel]');
    expect(funnel).not.toBeNull();
    const stages = view.element.querySelectorAll('[data-bn-funnel-stage]');
    expect(stages).toHaveLength(4);
  });
});
