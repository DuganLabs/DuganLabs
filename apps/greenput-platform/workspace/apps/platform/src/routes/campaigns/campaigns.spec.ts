import { afterEach, describe, expect, it } from 'vitest';
import type { Campaign } from '@greenput/shared/models';
import { renderCampaignsRoute } from './campaigns.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

function campaign(partial: Partial<Campaign>): Campaign {
  return {
    id: 'c1',
    name: 'Spring HVAC',
    status: 'active',
    channel: 'email',
    leadsGenerated: 12,
    leadCount: 3,
    spent: 24000,
    startDate: '2026-03-01',
    notes: '',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

describe('renderCampaignsRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders rows with badge, both lead counts, and cost-per-lead over the tracked count', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/campaigns', () =>
      jsonResponse({
        data: [campaign({ id: 'c1', name: 'Spring HVAC' })],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderCampaignsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toMatch(/Spring HVAC/);
    expect(
      view.element
        .querySelector('[data-bn="badge"]')
        ?.getAttribute('data-bn-status'),
    ).toBe('active');
    // GP-034: the typed count and the counted leads are two columns with two
    // labels, and Cost/lead divides by the counted one — 24000 cents / 3
    // tracked leads = $80, not 24000 / 12 entered = $20.
    const header = view.element.querySelector('thead')?.textContent ?? '';
    expect(header).toContain('Leads (entered)');
    expect(header).toContain('Leads (tracked)');
    const cells = [...(rows[0]?.querySelectorAll('td') ?? [])].map(
      (td) => td.textContent?.trim() ?? '',
    );
    expect(cells).toContain('12');
    expect(cells).toContain('3');
    expect(rows[0]?.textContent).toMatch(/\$80\/lead/);
    expect(rows[0]?.textContent).not.toMatch(/\$20\/lead/);
  });

  it('filters by channel when a segmented button is clicked', async () => {
    let lastUrl = '';
    const fake = createFakeFetch();
    fake.respond(/\/api\/campaigns/, () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    const captureFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      lastUrl = typeof input === 'string' ? input : input.toString();
      return fake.fetch(input, init);
    }) as typeof fetch;

    const deps = buildTestDeps({ fetch: captureFetch });
    const view = renderCampaignsRoute(deps);
    dispose = view.dispose;
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="campaigns-filter-sms"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();

    expect(lastUrl).toMatch(/channel=sms/);
  });

  /* GP-006. Every list stopped at 25 rows with no pager, so the 26th row a
     contractor entered was unreachable from that day on. */
  it('pages the list: reports meta.total and asks for page 2 on Next', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/campaigns', () =>
      jsonResponse({
        data: [campaign({ id: 'c1' })],
        meta: { total: 60, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderCampaignsRoute(deps);
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
        '[data-testid="campaigns-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      fake.calls.some(
        (call) =>
          call.url.includes('/api/campaigns') &&
          /[?&]page=2(&|$)/.test(call.url),
      ),
    ).toBe(true);
  });
});
