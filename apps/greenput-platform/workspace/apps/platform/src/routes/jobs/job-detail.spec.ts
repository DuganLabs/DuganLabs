import { afterEach, describe, expect, it } from 'vitest';
import type { Job, WorkspaceUser } from '@greenput/shared/models';
import { jobPatch, renderJobDetailRoute, scheduleLabel } from './job-detail.js';
import { toDateTimeLocal } from '../../lib/datetime.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';
import type { PlatformDeps } from '../../deps.js';

const START = new Date(2026, 3, 7, 9, 30).toISOString();
const END = new Date(2026, 3, 7, 11, 30).toISOString();

const TEAM: WorkspaceUser[] = [
  {
    id: 'u-dana',
    firstName: 'Dana',
    lastName: 'Ortiz',
    email: 'dana@example.com',
    role: 'owner',
    avatarInitials: 'DO',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'u-sam',
    firstName: 'Sam',
    lastName: 'Lee',
    email: 'sam@example.com',
    role: 'tech',
    avatarInitials: 'SL',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'u-office',
    firstName: 'Pat',
    lastName: 'Desk',
    email: 'pat@example.com',
    role: 'office',
    avatarInitials: 'PD',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

function job(partial: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    opportunityId: 'o1',
    customerId: 'c1',
    jobNumber: '#1001',
    title: 'Panel upgrade',
    status: 'scheduled',
    address: {
      street: '2 Elm St',
      city: 'Rivertown',
      state: 'TX',
      zip: '78702',
    },
    scheduledStart: START,
    scheduledEnd: END,
    lineItems: [
      {
        id: 'li-1',
        description: '200A panel replacement',
        quantity: 1,
        unitPrice: 220000,
        total: 220000,
      },
    ],
    total: 265213,
    notes: 'Gate code 1234.',
    assignedTo: 'u-sam',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'u-dana',
    ...partial,
  };
}

/**
 * One handler for `/api/jobs/j1`: the GET answers with the current row, a
 * PATCH merges its body in (the way the real route reads back what it
 * wrote), a DELETE answers as told. The team and the workspace are the
 * other two reads the page makes.
 */
function serve(
  fake: FakeFetcher,
  initial: Job,
  options: {
    onDelete?: () => Response;
    onPatch?: () => Response | null;
  } = {},
): { current: () => Job } {
  let current = initial;
  fake.respond('/api/workspace/users', () => jsonResponse({ data: TEAM }));
  fake.respond(/\/api\/workspace$/, () =>
    jsonResponse({
      data: { id: 'w1', name: 'Rivertown Electric', slug: 'rivertown' },
    }),
  );
  fake.respond(/\/api\/jobs\/j1$/, () => {
    const last = fake.calls[fake.calls.length - 1];
    if (last?.method === 'PATCH') {
      const refused = options.onPatch?.();
      if (refused) return refused;
      const body = last.body as Partial<Job> & { assignedTo?: string | null };
      const { assignedTo, address, ...rest } = body;
      current = {
        ...current,
        ...rest,
        address: { ...current.address, ...(address ?? {}) },
      };
      if (assignedTo === null) delete current.assignedTo;
      else if (assignedTo) current.assignedTo = assignedTo;
    }
    if (last?.method === 'DELETE') {
      return options.onDelete?.() ?? jsonResponse({ data: { deleted: true } });
    }
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

function choose(testid: string, value: string): void {
  const select = q<HTMLSelectElement>(testid);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function signIn(deps: PlatformDeps, role: string): void {
  deps.auth.setUser({
    id: 'u-dana',
    email: 'dana@example.com',
    firstName: 'Dana',
    lastName: 'Ortiz',
    role,
    workspaceId: 'w1',
  });
}

describe('renderJobDetailRoute', () => {
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
    history.replaceState(null, '', '/jobs/j1');
    const deps = buildTestDeps({ fetch: fake.fetch });
    signIn(deps, role);
    const view = renderJobDetailRoute(deps, { id: 'j1' });
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    return view.element;
  }

  it('reads GET /api/jobs/:id and renders the fields, the technician by name and the line items', async () => {
    const fake = createFakeFetch();
    serve(fake, job());
    const root = await mount(fake);

    expect(fake.calls[0]).toMatchObject({ method: 'GET', url: '/api/jobs/j1' });
    expect(q('job-detail-heading').textContent).toBe('Panel upgrade');
    expect(q('job-detail-back').getAttribute('href')).toBe('/jobs');
    expect(q('job-detail-field-jobNumber').textContent).toBe('#1001');
    expect(q('job-detail-field-technician').textContent).toBe('Sam Lee');
    expect(
      q('job-detail-field-scheduled')
        .querySelector('time')
        ?.getAttribute('datetime'),
    ).toBe(START);
    expect(q('job-detail-field-scheduled').textContent).toBe(
      scheduleLabel({ scheduledStart: START, scheduledEnd: END }),
    );
    expect(q('job-detail-field-address').textContent).toBe(
      '2 Elm St\nRivertown, TX 78702',
    );
    expect(q('job-detail-field-total').textContent).toBe('$2,652.13');
    expect(
      q('job-detail-field-customer').querySelector('a')?.getAttribute('href'),
    ).toBe('/customers/c1');
    expect(
      q('job-detail-field-status')
        .querySelector('[data-bn="badge"]')
        ?.getAttribute('data-bn-status'),
    ).toBe('scheduled');
    const items = q('job-detail-line-items');
    expect(items.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(items.textContent).toContain('200A panel replacement');
    expect(items.textContent).toContain('$2,200.00');
    expect(root.getAttribute('data-bn-route')).toBe('job-detail');
    // No invoice yet, no link to copy.
    expect(
      document.querySelector('[data-testid="job-detail-invoice-link"]'),
    ).toBeNull();
  });

  it('Message opens the room that already exists for this job — nothing is created', async () => {
    const fake = createFakeFetch();
    serve(fake, job());
    fake.respond('/api/chat/rooms', () =>
      jsonResponse({
        data: [
          {
            id: 'room-7',
            name: '#1001 Panel upgrade',
            entityType: 'job',
            entityId: 'j1',
            createdBy: 'u-dana',
            createdAt: '2026-09-14T00:00:00.000Z',
          },
        ],
        meta: { total: 1, page: 1, perPage: 50 },
      }),
    );
    await mount(fake);
    q('job-detail-message').click();
    await tick();
    await tick();
    const lookup = fake.calls.find((c) => c.url.startsWith('/api/chat/rooms'));
    expect(lookup?.method).toBe('GET');
    expect(lookup?.url).toContain('entityType=job');
    expect(lookup?.url).toContain('entityId=j1');
    expect(fake.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(window.location.pathname).toBe('/chat/room-7');
  });

  it('Message creates the room, named "#1001 Panel upgrade", when there is none yet', async () => {
    const fake = createFakeFetch();
    serve(fake, job());
    fake.respond('/api/chat/rooms', () => {
      const last = fake.calls[fake.calls.length - 1];
      if (last?.method === 'POST') {
        return jsonResponse(
          {
            data: {
              id: 'room-new',
              ...(last.body as Record<string, unknown>),
              createdBy: 'u-dana',
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
    q('job-detail-message').click();
    await tick();
    await tick();
    const post = fake.calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({
      name: '#1001 Panel upgrade',
      entityType: 'job',
      entityId: 'j1',
    });
    expect(window.location.pathname).toBe('/chat/room-new');
  });

  it('an unassigned job says so', async () => {
    const fake = createFakeFetch();
    const unassigned = job();
    delete unassigned.assignedTo;
    serve(fake, unassigned);
    await mount(fake);
    expect(q('job-detail-field-technician').textContent).toBe('Unassigned');
  });

  it.each([
    ['scheduled', ['scheduled', 'in_progress', 'completed', 'cancelled']],
    ['completed', ['in_progress', 'completed']],
    ['invoiced', ['invoiced']],
    ['paid', ['paid']],
    ['cancelled', ['scheduled', 'cancelled']],
  ] as const)(
    'Edit: a %s job offers only the statuses the API accepts by PATCH',
    async (status, expected) => {
      const fake = createFakeFetch();
      serve(fake, job({ status }));
      await mount(fake);
      q('job-detail-edit').click();
      await tick();
      await tick();
      const select = q<HTMLSelectElement>('job-detail-form-status');
      expect([...select.options].map((o) => o.value)).toEqual(expected);
      expect(select.value).toBe(status);
    },
  );

  it('Edit: reschedule, reassign and start the job — one PATCH with ISO times, the technician and the stamped actualStart', async () => {
    const fake = createFakeFetch();
    const server = serve(fake, job());
    const root = await mount(fake);

    q('job-detail-edit').click();
    await tick();
    await tick();
    expect(root.querySelector('[data-bn-panel] h2')?.textContent).toBe(
      'Edit job',
    );
    const startInput = q<HTMLInputElement>('job-detail-form-scheduledStart');
    expect(startInput.type).toBe('datetime-local');
    expect(startInput.value).toBe(toDateTimeLocal(new Date(START)));
    // The technician select lists the assignable roles only, current one chosen.
    const tech = q<HTMLSelectElement>('job-detail-form-assignedTo');
    expect([...tech.options].map((o) => o.value)).toEqual([
      '',
      'u-dana',
      'u-sam',
    ]);
    expect(tech.value).toBe('u-sam');

    const newStart = new Date(2026, 3, 8, 13, 0);
    const newEnd = new Date(2026, 3, 8, 15, 0);
    type('job-detail-form-scheduledStart', toDateTimeLocal(newStart));
    type('job-detail-form-scheduledEnd', toDateTimeLocal(newEnd));
    choose('job-detail-form-assignedTo', 'u-dana');
    choose('job-detail-form-status', 'in_progress');
    q('panel-submit').click();
    await tick();
    await tick();
    await tick();

    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe('/api/jobs/j1');
    const body = patch?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      scheduledStart: newStart.toISOString(),
      scheduledEnd: newEnd.toISOString(),
      assignedTo: 'u-dana',
      status: 'in_progress',
    });
    expect(typeof body['actualStart']).toBe('string');
    expect(Object.keys(body).sort()).toEqual([
      'actualStart',
      'assignedTo',
      'scheduledEnd',
      'scheduledStart',
      'status',
    ]);
    expect(server.current().scheduledStart).toBe(newStart.toISOString());
    // Re-read: the new schedule and technician render.
    expect(root.querySelector('[data-bn-panel]')).toBeNull();
    expect(
      q('job-detail-field-scheduled')
        .querySelector('time')
        ?.getAttribute('datetime'),
    ).toBe(newStart.toISOString());
    expect(q('job-detail-field-technician').textContent).toBe('Dana Ortiz');
    expect(q('job-detail-notice').textContent).toBe('Changes saved.');
  });

  it('unassigning sends assignedTo: null; the address goes nested', async () => {
    const fake = createFakeFetch();
    serve(fake, job());
    await mount(fake);
    q('job-detail-edit').click();
    await tick();
    await tick();
    choose('job-detail-form-assignedTo', '');
    type('job-detail-form-zip', '78703');
    q('panel-submit').click();
    await tick();
    await tick();
    const patch = fake.calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({
      assignedTo: null,
      address: { zip: '78703' },
    });
  });

  it('saving with nothing changed makes no PATCH at all', async () => {
    const fake = createFakeFetch();
    serve(fake, job());
    await mount(fake);
    q('job-detail-edit').click();
    await tick();
    q('panel-submit').click();
    await tick();
    await tick();
    expect(fake.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(document.querySelector('[data-bn-panel]')).toBeNull();
  });

  it('refuses an end at or before the start before any request is made', async () => {
    const fake = createFakeFetch();
    serve(fake, job());
    const root = await mount(fake);
    q('job-detail-edit').click();
    await tick();
    type('job-detail-form-scheduledEnd', toDateTimeLocal(new Date(START)));
    q('panel-submit').click();
    await tick();
    await tick();
    expect(fake.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(
      root.querySelector('[data-bn-panel-form] [data-bn-error]')?.textContent,
    ).toBe('Scheduled end must be after the start.');
    expect(q('job-detail-form-scheduledEnd').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it("a 409 SLOT_TAKEN keeps the form open with the API's message", async () => {
    const fake = createFakeFetch();
    serve(fake, job(), {
      onPatch: () =>
        jsonResponse(
          {
            error: {
              code: 'SLOT_TAKEN',
              message: 'That time just went — pick another',
            },
          },
          { status: 409 },
        ),
    });
    const root = await mount(fake);
    q('job-detail-edit').click();
    await tick();
    type(
      'job-detail-form-scheduledStart',
      toDateTimeLocal(new Date(2026, 3, 8, 8, 0)),
    );
    type(
      'job-detail-form-scheduledEnd',
      toDateTimeLocal(new Date(2026, 3, 8, 10, 0)),
    );
    q('panel-submit').click();
    await tick();
    await tick();
    expect(root.querySelector('[data-bn-panel]')).not.toBeNull();
    expect(
      root.querySelector('[data-bn-panel-form] [data-bn-error]')?.textContent,
    ).toBe('That time just went — pick another');
  });

  it('Copy invoice link on an invoiced job with a token shows the share card', async () => {
    const fake = createFakeFetch();
    serve(
      fake,
      job({
        status: 'invoiced',
        invoicedAt: '2026-04-09T00:00:00Z',
        invoiceToken: 'tok-123',
      }),
    );
    await mount(fake);
    expect(q('job-detail-field-invoicing').textContent).toMatch(/^Invoiced /);
    q('job-detail-invoice-link').click();
    await tick();
    const card = q('job-detail-share');
    expect(card.hasAttribute('hidden')).toBe(false);
    expect(q<HTMLInputElement>('job-detail-share-url').value).toMatch(
      /^https:\/\/rivertown\.greenput\.(com|site)\/invoice\/tok-123$/,
    );
    expect(q('job-detail-share-heading').textContent).toBe(
      'Invoice link ready to share',
    );
  });

  it('Delete is for the owner and admins, confirms, then DELETEs and goes back to /jobs', async () => {
    const fake = createFakeFetch();
    serve(fake, job());
    await mount(fake, 'admin');
    q('job-detail-delete').click();
    await tick();
    expect(
      document.querySelector(
        'dialog[role="alertdialog"][open] #job-detail-delete-title',
      )?.textContent,
    ).toBe('Delete this job?');
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);
    q('job-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(
      fake.calls.some((c) => c.method === 'DELETE' && c.url === '/api/jobs/j1'),
    ).toBe(true);
    expect(window.location.pathname).toBe('/jobs');
  });

  it('a tech sees no Delete button', async () => {
    const fake = createFakeFetch();
    serve(fake, job());
    await mount(fake, 'tech');
    expect(q('job-detail-delete').hasAttribute('hidden')).toBe(true);
    expect(q('job-detail-edit').hasAttribute('hidden')).toBe(false);
  });

  it("shows the API's reason when a delete is refused", async () => {
    const fake = createFakeFetch();
    serve(fake, job(), {
      onDelete: () =>
        jsonResponse(
          {
            error: { code: 'ERROR', message: 'FOREIGN KEY constraint failed' },
          },
          { status: 500 },
        ),
    });
    await mount(fake);
    q('job-detail-delete').click();
    await tick();
    q('job-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(
      (
        document.querySelector(
          'dialog[role="alertdialog"]',
        ) as HTMLDialogElement
      ).open,
    ).toBe(true);
    expect(q('job-detail-delete-error').textContent).toBe(
      'FOREIGN KEY constraint failed',
    );
    expect(window.location.pathname).toBe('/jobs/j1');
  });

  it('says when the job cannot be loaded', async () => {
    const fake = createFakeFetch();
    fake.respond(/\/api\/jobs\/j1$/, () =>
      jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'Job not found' } },
        { status: 404 },
      ),
    );
    await mount(fake);
    expect(q('job-detail-error').textContent).toBe(
      'Could not load this job: Job not found',
    );
  });
});

describe('jobPatch', () => {
  const now = new Date('2026-04-08T15:00:00.000Z');
  const draft = () => ({
    title: 'Panel upgrade',
    status: 'scheduled' as const,
    street: '2 Elm St',
    city: 'Rivertown',
    state: 'TX',
    zip: '78702',
    scheduledStart: toDateTimeLocal(new Date(START)),
    scheduledEnd: toDateTimeLocal(new Date(END)),
    assignedTo: 'u-sam',
    notes: 'Gate code 1234.',
  });

  it('is empty when nothing changed', () => {
    expect(jobPatch(job(), draft(), now)).toEqual({});
  });

  it('sends the schedule as ISO, the address nested, and null to unassign', () => {
    const newStart = new Date(2026, 3, 8, 13, 0);
    expect(
      jobPatch(
        job(),
        {
          ...draft(),
          scheduledStart: toDateTimeLocal(newStart),
          street: '3 Oak Ave',
          assignedTo: '',
        },
        now,
      ),
    ).toEqual({
      scheduledStart: newStart.toISOString(),
      address: { street: '3 Oak Ave' },
      assignedTo: null,
    });
  });

  it('stamps actualEnd with a move to completed, and leaves one already there alone', () => {
    expect(jobPatch(job(), { ...draft(), status: 'completed' }, now)).toEqual({
      status: 'completed',
      actualEnd: now.toISOString(),
    });
    expect(
      jobPatch(
        job({ actualEnd: '2026-04-07T18:00:00.000Z' }),
        { ...draft(), status: 'completed' },
        now,
      ),
    ).toEqual({ status: 'completed' });
    expect(jobPatch(job(), { ...draft(), status: 'cancelled' }, now)).toEqual({
      status: 'cancelled',
    });
  });
});
