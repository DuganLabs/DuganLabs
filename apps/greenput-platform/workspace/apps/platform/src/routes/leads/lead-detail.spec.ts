import { afterEach, describe, expect, it } from 'vitest';
import type { Lead } from '@greenput/shared/models';
import { leadPatch, renderLeadDetailRoute } from './lead-detail.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';
import type { PlatformDeps } from '../../deps.js';

function lead(partial: Partial<Lead> = {}): Lead {
  return {
    id: 'l1',
    firstName: 'Alex',
    lastName: 'Reed',
    contact: {
      email: 'alex@reed.com',
      phone: '5551234567',
      preferredContact: 'phone',
    },
    address: { street: '1 Main', city: 'Town', state: 'CA', zip: '94000' },
    status: 'new',
    source: 'website',
    notes: 'Called twice.',
    serviceType: 'HVAC',
    estimatedValue: 250000,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

/**
 * One handler for `/api/leads/l1`: the GET answers with the current row,
 * a PATCH merges its body into that row (the way the real route reads back
 * what it wrote), and a DELETE answers as told.
 */
function serve(
  fake: FakeFetcher,
  initial: Lead,
  onDelete: () => Response = () => jsonResponse({ data: { deleted: true } }),
): { current: () => Lead } {
  let current = initial;
  fake.respond(/\/api\/leads\/l1$/, () => {
    const last = fake.calls[fake.calls.length - 1];
    if (last?.method === 'PATCH') {
      const body = last.body as Partial<Lead>;
      current = {
        ...current,
        ...body,
        contact: { ...current.contact, ...(body.contact ?? {}) },
        address: {
          ...(current.address ?? { street: '', city: '', state: '', zip: '' }),
          ...(body.address ?? {}),
        },
      };
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

describe('renderLeadDetailRoute', () => {
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
    history.replaceState(null, '', '/leads/l1');
    const deps = buildTestDeps({ fetch: fake.fetch });
    signIn(deps, role);
    const view = renderLeadDetailRoute(deps, { id: 'l1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    return view.element;
  }

  it('reads GET /api/leads/:id and renders the heading and the fields', async () => {
    const fake = createFakeFetch();
    serve(fake, lead());
    const root = await mount(fake);

    expect(fake.calls[0]).toMatchObject({
      method: 'GET',
      url: '/api/leads/l1',
    });
    expect(q('lead-detail-heading').textContent).toBe('Alex Reed');
    expect(q('lead-detail-back').getAttribute('href')).toBe('/leads');
    expect(q('lead-detail-field-email').textContent).toBe('alex@reed.com');
    expect(q('lead-detail-field-phone').textContent).toBe('(555) 123-4567');
    expect(q('lead-detail-field-estimatedValue').textContent).toBe('$2,500');
    expect(q('lead-detail-field-address').textContent).toBe(
      '1 Main\nTown, CA 94000',
    );
    expect(q('lead-detail-field-notes').textContent).toBe('Called twice.');
    expect(
      q('lead-detail-field-status')
        .querySelector('[data-bn="badge"]')
        ?.getAttribute('data-bn-status'),
    ).toBe('new');
    expect(root.getAttribute('data-bn-route')).toBe('lead-detail');
  });

  it('keeps the lifecycle action: a new lead offers Qualify, which posts to the API', async () => {
    const fake = createFakeFetch();
    serve(fake, lead());
    fake.respond('/api/leads/l1/qualify', () =>
      jsonResponse({ data: lead({ qualifiedAt: '2026-04-02T00:00:00Z' }) }),
    );
    await mount(fake);

    expect(
      document.querySelector('[data-testid="lead-detail-convert"]'),
    ).toBeNull();
    q('lead-detail-qualify').click();
    await tick();
    await tick();
    expect(
      fake.calls.some(
        (c) => c.method === 'POST' && c.url === '/api/leads/l1/qualify',
      ),
    ).toBe(true);
    expect(q('lead-detail-notice').textContent).toBe('Qualified Alex Reed.');
  });

  it('a qualified lead offers Convert and Accept', async () => {
    const fake = createFakeFetch();
    serve(
      fake,
      lead({ status: 'qualified', qualifiedAt: '2026-04-02T00:00:00Z' }),
    );
    await mount(fake);
    expect(q('lead-detail-convert')).not.toBeNull();
    expect(q('lead-detail-accept')).not.toBeNull();
    expect(q('lead-detail-field-lifecycle').textContent).toMatch(/^Qualified /);
  });

  it('Edit, change the phone, save: PATCHes only the nested contact change and re-reads', async () => {
    const fake = createFakeFetch();
    const server = serve(fake, lead());
    const root = await mount(fake);

    q('lead-detail-edit').click();
    await tick();
    expect(root.querySelector('[data-bn-panel] h2')?.textContent).toBe(
      'Edit lead',
    );
    expect(q<HTMLInputElement>('lead-detail-form-phone').value).toBe(
      '5551234567',
    );
    expect(
      q<HTMLInputElement>('lead-detail-form-estimatedValueUsd').value,
    ).toBe('2500');
    expect(q<HTMLSelectElement>('lead-detail-form-status').value).toBe('new');

    type('lead-detail-form-phone', '5559998888');
    q('panel-submit').click();
    await tick();
    await tick();
    await tick();

    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/api/leads/l1');
    expect(patch?.body).toEqual({ contact: { phone: '5559998888' } });
    expect(server.current().contact.phone).toBe('5559998888');
    // Re-read after the save: the new value is what renders.
    const patchIndex = patch ? fake.calls.indexOf(patch) : -1;
    expect(
      fake.calls
        .slice(patchIndex + 1)
        .some((c) => c.method === 'GET' && c.url === '/api/leads/l1'),
    ).toBe(true);
    expect(root.querySelector('[data-bn-panel]')).toBeNull();
    expect(q('lead-detail-field-phone').textContent).toBe('(555) 999-8888');
    expect(q('lead-detail-notice').textContent).toBe('Changes saved.');
  });

  it('saving with nothing changed makes no PATCH at all', async () => {
    const fake = createFakeFetch();
    serve(fake, lead());
    await mount(fake);
    q('lead-detail-edit').click();
    await tick();
    q('panel-submit').click();
    await tick();
    await tick();
    expect(fake.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(document.querySelector('[data-bn-panel]')).toBeNull();
  });

  it('refuses an empty name before any request is made', async () => {
    const fake = createFakeFetch();
    serve(fake, lead());
    const root = await mount(fake);
    q('lead-detail-edit').click();
    await tick();
    type('lead-detail-form-firstName', '   ');
    q('panel-submit').click();
    await tick();
    await tick();
    expect(fake.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(
      root.querySelector('[data-bn-panel-form] [data-bn-error]')?.textContent,
    ).toBe('First and last name are required.');
    expect(q('lead-detail-form-firstName').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it("surfaces the API's refusal of a save in the form", async () => {
    const fake = createFakeFetch();
    let current = lead();
    fake.respond(/\/api\/leads\/l1$/, () => {
      const last = fake.calls[fake.calls.length - 1];
      if (last?.method === 'PATCH') {
        return jsonResponse(
          { error: { code: 'VALIDATION', message: 'Invalid email' } },
          { status: 400 },
        );
      }
      return jsonResponse({ data: current });
    });
    const root = await mount(fake);
    q('lead-detail-edit').click();
    await tick();
    type('lead-detail-form-email', 'nope');
    q('panel-submit').click();
    await tick();
    await tick();
    expect(
      root.querySelector('[data-bn-panel-form] [data-bn-error]')?.textContent,
    ).toBe('Invalid email');
    expect(root.querySelector('[data-bn-panel]')).not.toBeNull();
    current = lead();
  });

  it('Delete is for the owner and admins, confirms, then DELETEs and goes back to /leads', async () => {
    const fake = createFakeFetch();
    serve(fake, lead());
    await mount(fake, 'owner');
    q('lead-detail-delete').click();
    await tick();
    const dialog = document.querySelector('dialog[role="alertdialog"][open]');
    expect(
      dialog?.querySelector('#lead-detail-delete-title')?.textContent,
    ).toBe('Delete this lead?');
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);

    q('lead-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(
      fake.calls.some(
        (c) => c.method === 'DELETE' && c.url === '/api/leads/l1',
      ),
    ).toBe(true);
    expect(window.location.pathname).toBe('/leads');
  });

  it('a tech sees no Delete button', async () => {
    const fake = createFakeFetch();
    serve(fake, lead());
    await mount(fake, 'tech');
    expect(q('lead-detail-delete').hasAttribute('hidden')).toBe(true);
    expect(q('lead-detail-edit').hasAttribute('hidden')).toBe(false);
  });

  it("shows the API's reason when a delete is refused", async () => {
    const fake = createFakeFetch();
    serve(fake, lead(), () =>
      jsonResponse(
        { error: { code: 'ERROR', message: 'Lead is already converted' } },
        { status: 400 },
      ),
    );
    await mount(fake, 'admin');
    q('lead-detail-delete').click();
    await tick();
    q('lead-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(
      (
        document.querySelector(
          'dialog[role="alertdialog"]',
        ) as HTMLDialogElement
      ).open,
    ).toBe(true);
    expect(q('lead-detail-delete-error').textContent).toBe(
      'Lead is already converted',
    );
  });

  it('says when the lead cannot be loaded', async () => {
    const fake = createFakeFetch();
    fake.respond(/\/api\/leads\/l1$/, () =>
      jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'Lead not found' } },
        { status: 404 },
      ),
    );
    await mount(fake);
    expect(q('lead-detail-error').textContent).toBe(
      'Could not load this lead: Lead not found',
    );
    expect(q('lead-detail-edit').closest('[hidden]')).not.toBeNull();
  });
});

describe('leadPatch', () => {
  it('sends only what changed, nested, with the value in cents', () => {
    const current = lead();
    const draft = {
      firstName: 'Alex',
      lastName: 'Reed',
      email: 'alex@reed.com',
      phone: '5551234567',
      preferredContact: 'email' as const,
      street: '1 Main',
      city: 'Town',
      state: 'CA',
      zip: '94001',
      status: 'contacted' as const,
      source: 'website' as const,
      serviceType: 'HVAC',
      estimatedValueUsd: '3100.50',
      notes: 'Called twice.',
    };
    expect(leadPatch(current, draft)).toEqual({
      status: 'contacted',
      contact: { preferredContact: 'email' },
      address: { zip: '94001' },
      estimatedValue: 310050,
    });
  });

  it('is empty when nothing changed', () => {
    const current = lead();
    expect(
      leadPatch(current, {
        firstName: 'Alex',
        lastName: 'Reed',
        email: 'alex@reed.com',
        phone: '5551234567',
        preferredContact: 'phone',
        street: '1 Main',
        city: 'Town',
        state: 'CA',
        zip: '94000',
        status: 'new',
        source: 'website',
        serviceType: 'HVAC',
        estimatedValueUsd: '2500',
        notes: 'Called twice.',
      }),
    ).toEqual({});
  });
});
