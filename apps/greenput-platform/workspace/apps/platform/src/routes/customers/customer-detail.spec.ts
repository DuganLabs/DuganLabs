import { afterEach, describe, expect, it } from 'vitest';
import type { Customer, Job } from '@greenput/shared/models';
import { customerPatch, renderCustomerDetailRoute } from './customer-detail.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';
import type { PlatformDeps } from '../../deps.js';

function job(partial: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    opportunityId: 'o1',
    customerId: 'c1',
    jobNumber: '#1001',
    title: 'Panel upgrade',
    status: 'scheduled',
    address: { street: '1 Main', city: 'Town', state: 'CA', zip: '94000' },
    scheduledStart: '2026-04-07T09:30:00Z',
    scheduledEnd: '2026-04-07T11:30:00Z',
    lineItems: [],
    total: 265213,
    notes: '',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

function customer(partial: Partial<Customer> = {}): Customer {
  return {
    id: 'c1',
    firstName: 'Jane',
    lastName: 'Doe',
    company: 'Doe & Co',
    contact: {
      email: 'jane@example.com',
      phone: '5125550143',
      preferredContact: 'phone',
    },
    address: {
      street: '2 Elm St',
      city: 'Rivertown',
      state: 'TX',
      zip: '78702',
    },
    notes: '',
    totalJobValue: 850000,
    jobCount: 2,
    jobs: [
      job(),
      job({
        id: 'j2',
        jobNumber: '#1002',
        title: 'EV charger',
        status: 'paid',
        total: 120000,
      }),
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-04-03T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

/** GET answers the current row; a PATCH merges its body in; DELETE answers as told. */
function serve(
  fake: FakeFetcher,
  initial: Customer,
  onDelete: () => Response = () => jsonResponse({ data: { deleted: true } }),
): { current: () => Customer } {
  let current = initial;
  fake.respond(/\/api\/customers\/c1$/, () => {
    const last = fake.calls[fake.calls.length - 1];
    if (last?.method === 'PATCH') {
      const body = last.body as Partial<Customer>;
      current = {
        ...current,
        ...body,
        contact: { ...current.contact, ...(body.contact ?? {}) },
        address: { ...current.address, ...(body.address ?? {}) },
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

describe('renderCustomerDetailRoute', () => {
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
    history.replaceState(null, '', '/customers/c1');
    const deps = buildTestDeps({ fetch: fake.fetch });
    signIn(deps, role);
    const view = renderCustomerDetailRoute(deps, { id: 'c1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    return view.element;
  }

  it('reads GET /api/customers/:id and renders the heading, the fields and the job history', async () => {
    const fake = createFakeFetch();
    serve(fake, customer());
    const root = await mount(fake);

    expect(fake.calls[0]).toMatchObject({
      method: 'GET',
      url: '/api/customers/c1',
    });
    expect(q('customer-detail-heading').textContent).toBe('Jane Doe');
    expect(root.querySelector('header p')?.textContent).toBe('Doe & Co');
    expect(q('customer-detail-back').getAttribute('href')).toBe('/customers');
    expect(q('customer-detail-field-email').textContent).toBe(
      'jane@example.com',
    );
    expect(q('customer-detail-field-phone').textContent).toBe('(512) 555-0143');
    expect(q('customer-detail-field-address').textContent).toBe(
      '2 Elm St\nRivertown, TX 78702',
    );
    expect(q('customer-detail-field-lifetime').textContent).toBe(
      '$8,500 · 2 jobs',
    );
    expect(q('customer-detail-field-consent').textContent).toBe('Not given');

    const rows = q('customer-detail-jobs').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('#1001');
    expect(rows[0]?.textContent).toContain('Panel upgrade');
    expect(rows[0]?.querySelector('[data-bn="badge"]')?.textContent).toBe(
      'Scheduled',
    );
    expect(rows[0]?.textContent).toMatch(/\$2,652/);
    expect(rows[1]?.querySelector('[data-bn="badge"]')?.textContent).toBe(
      'Paid',
    );
  });

  it('shows an honest empty job history', async () => {
    const fake = createFakeFetch();
    serve(fake, customer({ jobs: [], jobCount: 0, totalJobValue: 0 }));
    await mount(fake);
    expect(q('customer-detail-jobs').textContent).toContain('No jobs yet.');
  });

  it('Edit, change the phone, save: PATCHes { contact: { phone } } and re-reads', async () => {
    const fake = createFakeFetch();
    const server = serve(fake, customer());
    const root = await mount(fake);

    q('customer-detail-edit').click();
    await tick();
    expect(root.querySelector('[data-bn-panel] h2')?.textContent).toBe(
      'Edit customer',
    );
    expect(q<HTMLInputElement>('customer-detail-form-phone').value).toBe(
      '5125550143',
    );
    expect(q<HTMLInputElement>('customer-detail-form-company').value).toBe(
      'Doe & Co',
    );
    // The job history is out of the way while editing.
    expect(
      root.querySelector('[data-bn-detail-sections]')?.hasAttribute('hidden'),
    ).toBe(true);

    type('customer-detail-form-phone', '5125550199');
    q('panel-submit').click();
    await tick();
    await tick();
    await tick();

    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/api/customers/c1');
    expect(patch?.body).toEqual({ contact: { phone: '5125550199' } });
    expect(server.current().contact.phone).toBe('5125550199');
    const patchIndex = patch ? fake.calls.indexOf(patch) : -1;
    expect(
      fake.calls
        .slice(patchIndex + 1)
        .some((c) => c.method === 'GET' && c.url === '/api/customers/c1'),
    ).toBe(true);
    expect(root.querySelector('[data-bn-panel]')).toBeNull();
    expect(q('customer-detail-field-phone').textContent).toBe('(512) 555-0199');
    expect(q('customer-detail-notice').textContent).toBe('Changes saved.');
  });

  it('a moved address goes as one nested address patch', async () => {
    const fake = createFakeFetch();
    serve(fake, customer());
    await mount(fake);
    q('customer-detail-edit').click();
    await tick();
    type('customer-detail-form-street', '9 Birch Ave');
    type('customer-detail-form-zip', '78703');
    q('panel-submit').click();
    await tick();
    await tick();
    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({
      address: { street: '9 Birch Ave', zip: '78703' },
    });
  });

  it('refuses an empty name before any request is made', async () => {
    const fake = createFakeFetch();
    serve(fake, customer());
    const root = await mount(fake);
    q('customer-detail-edit').click();
    await tick();
    type('customer-detail-form-lastName', '');
    q('panel-submit').click();
    await tick();
    await tick();
    expect(fake.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(
      root.querySelector('[data-bn-panel-form] [data-bn-error]')?.textContent,
    ).toBe('First and last name are required.');
  });

  it('Delete confirms, DELETEs, and goes back to /customers', async () => {
    const fake = createFakeFetch();
    serve(fake, customer());
    await mount(fake, 'admin');
    q('customer-detail-delete').click();
    await tick();
    const dialog = document.querySelector('dialog[role="alertdialog"][open]');
    expect(
      dialog?.querySelector('#customer-detail-delete-description')?.textContent,
    ).toContain('cannot be deleted');
    q('customer-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(
      fake.calls.some(
        (c) => c.method === 'DELETE' && c.url === '/api/customers/c1',
      ),
    ).toBe(true);
    expect(window.location.pathname).toBe('/customers');
  });

  it('Message opens the room that already exists for this customer — nothing is created', async () => {
    const fake = createFakeFetch();
    serve(fake, customer());
    fake.respond('/api/chat/rooms', () =>
      jsonResponse({
        data: [
          {
            id: 'room-9',
            name: 'Jane Doe',
            entityType: 'customer',
            entityId: 'c1',
            createdBy: 'u1',
            createdAt: '2026-09-14T00:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, perPage: 50 },
      }),
    );
    await mount(fake);
    q('customer-detail-message').click();
    await tick();
    await tick();
    const lookup = fake.calls.find((c) => c.url.startsWith('/api/chat/rooms'));
    expect(lookup?.method).toBe('GET');
    expect(lookup?.url).toContain('entityType=customer');
    expect(lookup?.url).toContain('entityId=c1');
    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(window.location.pathname).toBe('/chat/room-9');
  });

  it('Message creates the room, named after the customer, when there is none yet', async () => {
    const fake = createFakeFetch();
    serve(fake, customer());
    fake.respond('/api/chat/rooms', () => {
      const last = fake.calls[fake.calls.length - 1];
      if (last?.method === 'POST') {
        return jsonResponse(
          {
            data: {
              id: 'room-new',
              ...(last.body as Record<string, unknown>),
              createdBy: 'u1',
              createdAt: '2026-09-14T00:00:00.000Z',
            },
          },
          { status: 201 },
        );
      }
      return jsonResponse({
        data: [],
        meta: { total: 0, page: 1, perPage: 50 },
      });
    });
    await mount(fake);
    q('customer-detail-message').click();
    await tick();
    await tick();
    const post = fake.calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/chat/rooms');
    expect(post?.body).toEqual({
      name: 'Jane Doe',
      entityType: 'customer',
      entityId: 'c1',
    });
    expect(window.location.pathname).toBe('/chat/room-new');
  });

  it('office staff see no Delete button', async () => {
    const fake = createFakeFetch();
    serve(fake, customer());
    await mount(fake, 'office');
    expect(q('customer-detail-delete').hasAttribute('hidden')).toBe(true);
  });

  it('a customer with active jobs cannot be deleted, and the dialog says so in the API’s words', async () => {
    const fake = createFakeFetch();
    serve(fake, customer(), () =>
      jsonResponse(
        {
          error: {
            code: 'ERROR',
            message: 'Cannot delete customer with active jobs',
          },
        },
        { status: 400 },
      ),
    );
    await mount(fake, 'owner');
    q('customer-detail-delete').click();
    await tick();
    q('customer-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(
      (
        document.querySelector(
          'dialog[role="alertdialog"]',
        ) as HTMLDialogElement
      ).open,
    ).toBe(true);
    expect(q('customer-detail-delete-error').textContent).toBe(
      'Cannot delete customer with active jobs',
    );
    expect(window.location.pathname).not.toBe('/customers');
  });
});

describe('customerPatch', () => {
  it('sends only what changed, nested', () => {
    const current = customer();
    expect(
      customerPatch(current, {
        firstName: 'Jane',
        lastName: 'Doe-Smith',
        company: '',
        email: 'jane@example.com',
        phone: '5125550143',
        preferredContact: 'text',
        street: '2 Elm St',
        city: 'Rivertown',
        state: 'TX',
        zip: '78702',
        notes: 'Gate code 1234',
      }),
    ).toEqual({
      lastName: 'Doe-Smith',
      company: '',
      notes: 'Gate code 1234',
      contact: { preferredContact: 'text' },
    });
  });
});
