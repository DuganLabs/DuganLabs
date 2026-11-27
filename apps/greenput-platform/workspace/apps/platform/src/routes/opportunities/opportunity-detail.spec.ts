import { afterEach, describe, expect, it } from 'vitest';
import type { Opportunity } from '@greenput/shared/models';
import {
  opportunityPatch,
  renderOpportunityDetailRoute,
} from './opportunity-detail.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';
import type { PlatformDeps } from '../../deps.js';

function opp(partial: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'o1',
    leadId: 'l1',
    customerId: 'c1',
    title: 'Panel upgrade',
    status: 'open',
    value: 250000,
    serviceType: 'Electrical',
    notes: 'Wants it before summer.',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

function serve(
  fake: FakeFetcher,
  initial: Opportunity,
  onDelete: () => Response = () => jsonResponse({ data: { deleted: true } }),
): { current: () => Opportunity } {
  let current = initial;
  fake.respond(/\/api\/opportunities\/o1$/, () => {
    const last = fake.calls[fake.calls.length - 1];
    if (last?.method === 'PATCH') {
      current = { ...current, ...(last.body as Partial<Opportunity>) };
    }
    if (last?.method === 'DELETE') return onDelete();
    return jsonResponse({ data: current });
  });
  return { current: () => current };
}

function q<T extends Element = HTMLElement>(testid: string): T {
  const node = document.querySelector<T>(`[data-testid="${testid}"]`);
  if (!node) throw new Error(`no ${testid}`);
  return node;
}

function type(testid: string, value: string): void {
  const input = q<HTMLInputElement>(testid);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function signIn(deps: PlatformDeps, role: string): void {
  deps.auth.setUser({
    id: 'u1',
    email: 'dana@example.com',
    firstName: 'Dana',
    lastName: 'Ortiz',
    role,
    workspaceId: 'w1',
  });
}

describe('renderOpportunityDetailRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
  });

  async function mount(
    fake: FakeFetcher,
    role = 'owner',
  ): Promise<HTMLElement> {
    history.replaceState(null, '', '/opportunities/o1');
    const deps = buildTestDeps({ fetch: fake.fetch });
    signIn(deps, role);
    const view = renderOpportunityDetailRoute(deps, { id: 'o1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    return view.element;
  }

  it('reads GET /api/opportunities/:id and renders the heading and the fields', async () => {
    const fake = createFakeFetch();
    serve(fake, opp());
    const root = await mount(fake);

    expect(fake.calls[0]).toMatchObject({
      method: 'GET',
      url: '/api/opportunities/o1',
    });
    expect(q('opportunity-detail-heading').textContent).toBe('Panel upgrade');
    expect(q('opportunity-detail-back').getAttribute('href')).toBe(
      '/opportunities',
    );
    expect(q('opportunity-detail-field-value').textContent).toBe('$2,500.00');
    expect(q('opportunity-detail-field-serviceType').textContent).toBe(
      'Electrical',
    );
    expect(
      q('opportunity-detail-field-lead')
        .querySelector('a')
        ?.getAttribute('href'),
    ).toBe('/leads/l1');
    expect(
      q('opportunity-detail-field-customer')
        .querySelector('a')
        ?.getAttribute('href'),
    ).toBe('/customers/c1');
    expect(q('opportunity-detail-field-job').textContent).toBe(
      'Not yet converted',
    );
    expect(q('opportunity-detail-field-notes').textContent).toBe(
      'Wants it before summer.',
    );
    expect(
      q('opportunity-detail-field-status')
        .querySelector('[data-bn="badge"]')
        ?.getAttribute('data-bn-status'),
    ).toBe('open');
    expect(root.getAttribute('data-bn-route')).toBe('opportunity-detail');
    // Not won: nothing to convert.
    expect(
      document.querySelector('[data-testid="opportunity-detail-convert"]'),
    ).toBeNull();
  });

  it('Edit, change the value and status, save: PATCHes cents and re-reads', async () => {
    const fake = createFakeFetch();
    const server = serve(fake, opp());
    const root = await mount(fake);

    q('opportunity-detail-edit').click();
    await tick();
    // The convert panel is a `[data-bn-panel]` too, mounted hidden — the
    // edit form is the one inside the frame's edit host.
    expect(
      root.querySelector('[data-bn-detail-edit] [data-bn-panel] h2')
        ?.textContent,
    ).toBe('Edit opportunity');
    expect(q<HTMLInputElement>('opportunity-detail-form-valueUsd').value).toBe(
      '2500',
    );
    type('opportunity-detail-form-valueUsd', '3100.50');
    const status = q<HTMLSelectElement>('opportunity-detail-form-status');
    status.value = 'negotiating';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    q('panel-submit').click();
    await tick();
    await tick();
    await tick();

    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/api/opportunities/o1');
    expect(patch?.body).toEqual({ value: 310050, status: 'negotiating' });
    expect(server.current().value).toBe(310050);
    expect(
      root.querySelector('[data-bn-detail-edit] [data-bn-panel]'),
    ).toBeNull();
    expect(q('opportunity-detail-field-value').textContent).toBe('$3,100.50');
    expect(q('opportunity-detail-notice').textContent).toBe('Changes saved.');
  });

  it('refuses an empty title before any request is made', async () => {
    const fake = createFakeFetch();
    serve(fake, opp());
    const root = await mount(fake);
    q('opportunity-detail-edit').click();
    await tick();
    type('opportunity-detail-form-title', ' ');
    q('panel-submit').click();
    await tick();
    expect(fake.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(
      root.querySelector('[data-bn-panel-form] [data-bn-error]')?.textContent,
    ).toBe('Title is required.');
  });

  it("surfaces the API's refusal of a save in the form", async () => {
    const fake = createFakeFetch();
    fake.respond(/\/api\/opportunities\/o1$/, () => {
      const last = fake.calls[fake.calls.length - 1];
      if (last?.method === 'PATCH') {
        return jsonResponse(
          { error: { code: 'VALIDATION', message: 'value must be >= 0' } },
          { status: 400 },
        );
      }
      return jsonResponse({ data: opp() });
    });
    const root = await mount(fake);
    q('opportunity-detail-edit').click();
    await tick();
    type('opportunity-detail-form-valueUsd', '-5');
    q('panel-submit').click();
    await tick();
    await tick();
    expect(
      root.querySelector('[data-bn-panel-form] [data-bn-error]')?.textContent,
    ).toBe('value must be >= 0');
    expect(
      root.querySelector('[data-bn-detail-edit] [data-bn-panel]'),
    ).not.toBeNull();
  });

  it('a won deal without a job offers Convert: the panel opens, posts the schedule, and the page reloads with the job', async () => {
    const fake = createFakeFetch();
    const server = serve(fake, opp({ status: 'won' }));
    fake.respond('/api/opportunities/o1/convert', () => {
      const won = server.current();
      Object.assign(won, { convertedToJobId: 'j9' });
      return jsonResponse({
        data: { jobId: 'j9', customerId: 'c1', jobNumber: '#1009' },
      });
    });
    await mount(fake);

    expect(q('opportunity-detail-convert-panel').hasAttribute('hidden')).toBe(
      true,
    );
    q('opportunity-detail-convert').click();
    await tick();
    expect(q('opportunity-detail-convert-panel').hasAttribute('hidden')).toBe(
      false,
    );
    expect(q<HTMLInputElement>('opportunities-convert-title').value).toBe(
      'Panel upgrade',
    );
    // The click alone booked nothing.
    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false);

    type('opportunities-convert-start', '2026-05-01T09:00');
    type('opportunities-convert-end', '2026-05-01T11:00');
    q('opportunities-convert-submit').click();
    await tick();
    await tick();
    await tick();

    const posted = fake.calls.find((c) => c.method === 'POST');
    expect(posted?.url).toBe('/api/opportunities/o1/convert');
    expect(posted?.body).toEqual({
      title: 'Panel upgrade',
      scheduledStart: new Date('2026-05-01T09:00').toISOString(),
      scheduledEnd: new Date('2026-05-01T11:00').toISOString(),
    });
    expect(q('opportunity-detail-notice').textContent).toBe(
      'Converted Panel upgrade to job #1009.',
    );
    expect(q('opportunity-detail-convert-panel').hasAttribute('hidden')).toBe(
      true,
    );
    // Re-read: the deal now links to its job and offers no second Convert.
    expect(
      q('opportunity-detail-field-job')
        .querySelector('a')
        ?.getAttribute('href'),
    ).toBe('/jobs/j9');
    expect(
      document.querySelector('[data-testid="opportunity-detail-convert"]'),
    ).toBeNull();
  });

  it("a taken slot keeps the convert panel open with the API's message", async () => {
    const fake = createFakeFetch();
    serve(fake, opp({ status: 'won' }));
    fake.respond('/api/opportunities/o1/convert', () =>
      jsonResponse(
        {
          error: {
            code: 'SLOT_TAKEN',
            message: 'That time just went — pick another',
          },
        },
        { status: 409 },
      ),
    );
    await mount(fake);
    q('opportunity-detail-convert').click();
    await tick();
    q('opportunities-convert-submit').click();
    await tick();
    await tick();
    expect(q('opportunity-detail-convert-panel').hasAttribute('hidden')).toBe(
      false,
    );
    expect(
      q('opportunity-detail-convert-panel').querySelector('[data-bn-error]')
        ?.textContent,
    ).toBe('That time just went — pick another');
  });

  it('Delete confirms, then DELETEs and goes back to /opportunities', async () => {
    const fake = createFakeFetch();
    serve(fake, opp());
    await mount(fake, 'owner');
    q('opportunity-detail-delete').click();
    await tick();
    expect(
      document.querySelector(
        'dialog[role="alertdialog"][open] #opportunity-detail-delete-title',
      )?.textContent,
    ).toBe('Delete this opportunity?');
    q('opportunity-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(
      fake.calls.some(
        (c) => c.method === 'DELETE' && c.url === '/api/opportunities/o1',
      ),
    ).toBe(true);
    expect(window.location.pathname).toBe('/opportunities');
  });

  it('a tech sees no Delete button', async () => {
    const fake = createFakeFetch();
    serve(fake, opp());
    await mount(fake, 'tech');
    expect(q('opportunity-detail-delete').hasAttribute('hidden')).toBe(true);
  });

  it("shows the API's reason when a delete is refused (a deal with a job)", async () => {
    const fake = createFakeFetch();
    serve(fake, opp({ status: 'won', convertedToJobId: 'j9' }), () =>
      jsonResponse(
        { error: { code: 'ERROR', message: 'FOREIGN KEY constraint failed' } },
        { status: 500 },
      ),
    );
    await mount(fake, 'admin');
    q('opportunity-detail-delete').click();
    await tick();
    q('opportunity-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(
      (
        document.querySelector(
          'dialog[role="alertdialog"]',
        ) as HTMLDialogElement
      ).open,
    ).toBe(true);
    expect(q('opportunity-detail-delete-error').textContent).toBe(
      'FOREIGN KEY constraint failed',
    );
    expect(window.location.pathname).toBe('/opportunities/o1');
  });

  it('says when the opportunity cannot be loaded', async () => {
    const fake = createFakeFetch();
    fake.respond(/\/api\/opportunities\/o1$/, () =>
      jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'Opportunity not found' } },
        { status: 404 },
      ),
    );
    await mount(fake);
    expect(q('opportunity-detail-error').textContent).toBe(
      'Could not load this opportunity: Opportunity not found',
    );
  });
});

describe('opportunityPatch', () => {
  const draft = () => ({
    title: 'Panel upgrade',
    status: 'open' as const,
    valueUsd: '2500',
    serviceType: 'Electrical',
    notes: 'Wants it before summer.',
  });

  it('is empty when nothing changed', () => {
    expect(opportunityPatch(opp(), draft())).toEqual({});
  });

  it('sends only what changed, with the value in cents', () => {
    expect(
      opportunityPatch(opp(), {
        ...draft(),
        valueUsd: '3100.50',
        serviceType: 'HVAC',
        notes: '',
      }),
    ).toEqual({ value: 310050, serviceType: 'HVAC', notes: '' });
    expect(opportunityPatch(opp(), { ...draft(), valueUsd: '' })).toEqual({
      value: 0,
    });
  });
});
