import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Customer,
  Job,
  ScheduleBlock,
  WorkspaceUser,
} from '@greenput/shared/models';
import { readJobsUrlState, renderJobsRoute } from './jobs.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
  type FakeFetcher,
} from '../../test/helpers.js';

const pad = (n: number): string => String(n).padStart(2, '0');
/** Local `YYYY-MM-DD` of a Date — the calendar keys its columns by it. */
function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
/** Today at `hour:00` local, so the job lands in the rendered week. */
function todayAt(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
const EMPTY_LIST = { data: [], meta: { total: 0, page: 1, perPage: 25 } };

function block(partial: Partial<ScheduleBlock>): ScheduleBlock {
  return {
    id: 'j1',
    title: 'Roof replacement',
    jobNumber: 'JOB-001',
    status: 'scheduled',
    start: new Date().toISOString(),
    end: new Date().toISOString(),
    customerId: 'c1',
    customerName: 'Jane Doe',
    location: '1 Main, Town',
    ...partial,
  };
}

/**
 * The calendar's own request. Registered before any '/api/jobs' stub because
 * the fake matches on `includes`, and '/api/jobs' would otherwise answer the
 * schedule call with a list page.
 */
function stubSchedule(fake: FakeFetcher, blocks: ScheduleBlock[]): void {
  fake.respond('/api/jobs/schedule', () => jsonResponse({ data: blocks }));
}
const WON_OPPORTUNITY = {
  id: 'o1',
  leadId: 'l1',
  customerId: 'c1',
  title: 'Panel upgrade',
  status: 'won',
  value: 120000,
  serviceType: 'Electrical',
  notes: '',
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  createdBy: 'u1',
};

function teammate(partial: Partial<WorkspaceUser>): WorkspaceUser {
  return {
    id: 'u1',
    firstName: 'Ada',
    lastName: 'Rivera',
    email: 'ada@example.com',
    role: 'owner',
    avatarInitials: 'AR',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...partial,
  };
}

function job(partial: Partial<Job>): Job {
  return {
    id: 'j1',
    opportunityId: 'o1',
    customerId: 'c1',
    jobNumber: 'JOB-001',
    title: 'Roof replacement',
    status: 'scheduled',
    address: { street: '1 Main', city: 'Town', state: 'CA', zip: '94000' },
    scheduledStart: new Date().toISOString(),
    scheduledEnd: new Date().toISOString(),
    lineItems: [],
    total: 250000,
    notes: '',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-15T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

describe('renderJobsRoute', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    window.history.replaceState(null, '', '/');
    document
      .querySelectorAll('dialog[data-bn="dialog"]')
      .forEach((node) => node.remove());
  });

  it('renders the jobs list with status badges', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/jobs', () =>
      jsonResponse({
        data: [
          job({ id: 'j1', title: 'Roof', status: 'scheduled' }),
          job({ id: 'j2', title: 'Wiring', status: 'invoiced' }),
        ],
        meta: { total: 2, page: 1, perPage: 25 },
      }),
    );
    fake.respond('/api/opportunities', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const rows = view.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const badges = view.element.querySelectorAll('tbody [data-bn="badge"]');
    expect(badges[0]?.getAttribute('data-bn-status')).toBe('scheduled');
    expect(badges[1]?.getAttribute('data-bn-status')).toBe('invoiced');
  });

  /* GP-034. A Job carries only the technician's id; the row resolves it to a
     name through the team list, and a job nobody is assigned to says so. */
  it('prints the technician on a list row, or Unassigned', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/workspace/users', () =>
      jsonResponse({
        data: [
          teammate({}),
          teammate({
            id: 'u2',
            firstName: 'Bo',
            lastName: 'Tech',
            role: 'tech',
          }),
        ],
      }),
    );
    fake.respond('/api/jobs', () =>
      jsonResponse({
        data: [
          job({ id: 'j1', title: 'Roof', assignedTo: 'u2' }),
          job({ id: 'j2', title: 'Wiring' }),
        ],
        meta: { total: 2, page: 1, perPage: 25 },
      }),
    );
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    const view = renderJobsRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const cell = (id: string) =>
      view.element.querySelector(`[data-testid="jobs-row-technician-${id}"]`)
        ?.textContent;
    expect(cell('j1')).toBe('Bo Tech');
    expect(cell('j2')).toBe('Unassigned');
    expect(
      [...view.element.querySelectorAll('thead th')].map(
        (th) => th.textContent,
      ),
    ).toContain('Technician');
  });

  it('only shows invoice button on completed jobs and paid on invoiced', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/jobs', () =>
      jsonResponse({
        data: [
          job({ id: 'j1', status: 'scheduled' }),
          job({ id: 'j2', status: 'completed' }),
          job({ id: 'j3', status: 'invoiced' }),
          job({ id: 'j4', status: 'paid' }),
        ],
        meta: { total: 4, page: 1, perPage: 25 },
      }),
    );
    fake.respond('/api/opportunities', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    expect(
      view.element.querySelector('[data-testid="jobs-invoice-j1"]'),
    ).toBeNull();
    expect(
      view.element.querySelector('[data-testid="jobs-invoice-j2"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="jobs-paid-j3"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="jobs-paid-j4"]'),
    ).toBeNull();
    // GP-047: the review request lives on the paid row, and only there.
    expect(
      view.element.querySelector('[data-testid="jobs-request-review-j4"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="jobs-request-review-j3"]'),
    ).toBeNull();
  });

  /* GP-047 / GP-008: links, not sending. Request review shows the message
     for the contractor to copy and send themselves, and records the request
     through POST /api/reviews/requests with the ids the row already had —
     nobody types a UUID (GP-015), and nothing claims it was sent. */
  it('Request review shows the message to copy and POSTs the row ids to /api/reviews/requests', async () => {
    const customer: Customer = {
      id: 'c1',
      firstName: 'Jane',
      lastName: 'Doe',
      contact: { email: '', phone: '5125550143', preferredContact: 'phone' },
      address: { street: '', city: '', state: '', zip: '' },
      notes: '',
      totalJobValue: 0,
      jobCount: 1,
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
      createdBy: 'u1',
    };
    const fake = createFakeFetch();
    fake.respond('/api/jobs', () =>
      jsonResponse({
        data: [job({ id: 'j4', status: 'paid', title: 'Roof replacement' })],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/customers/c1', () => jsonResponse({ data: customer }));
    fake.respond('/api/reviews/requests', () =>
      jsonResponse(
        {
          data: {
            id: 'rr1',
            workspaceId: 'w1',
            customerId: 'c1',
            jobId: 'j4',
            channel: 'sms',
            status: 'pending',
            createdAt: '2026-04-20T00:00:00Z',
          },
        },
        { status: 201 },
      ),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="jobs-request-review-j4"]',
      ) as HTMLElement
    ).click();
    await tick();
    await tick();

    const dialog = document.querySelector(
      'dialog[data-bn="dialog"]',
    ) as HTMLDialogElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toMatch(/Greenput does not send this for you/);
    expect(dialog?.textContent).not.toMatch(/\bsent\b/i);

    const message = (
      dialog?.querySelector(
        '[data-testid="jobs-review-message"]',
      ) as HTMLTextAreaElement
    ).value;
    expect(message).toContain('Hi Jane');
    expect(message).toContain('Roof replacement');

    (
      dialog?.querySelector('[data-testid="jobs-review-copy"]') as HTMLElement
    ).click();
    await tick();
    expect(writeText).toHaveBeenCalledWith(message);

    // The customer prefers the phone, so the default is a text message.
    expect(
      (
        dialog?.querySelector(
          '[data-testid="jobs-review-channel-sms"]',
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);

    (
      dialog?.querySelector(
        '[data-testid="jobs-review-submit"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();
    const posted = fake.calls.find(
      (call) =>
        call.method === 'POST' && call.url.includes('/api/reviews/requests'),
    );
    expect(posted?.body).toEqual({
      customerId: 'c1',
      jobId: 'j4',
      channel: 'sms',
    });
    expect(document.querySelector('dialog[data-bn="dialog"]')).toBeNull();
  });

  /* GP-007. scheduled → in_progress → completed had no control anywhere in
     the product, so the invoice button (which guards on `completed`) was
     unreachable for every job ever created. */
  it('offers Start on a scheduled job and Finish on a running one, and nothing else', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/jobs', () =>
      jsonResponse({
        data: [
          job({ id: 'j1', status: 'scheduled' }),
          job({ id: 'j2', status: 'in_progress' }),
          job({ id: 'j3', status: 'completed' }),
        ],
        meta: { total: 3, page: 1, perPage: 25 },
      }),
    );
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const q = (id: string) =>
      view.element.querySelector(`[data-testid="${id}"]`);
    expect(q('jobs-start-j1')).not.toBeNull();
    expect(q('jobs-finish-j1')).toBeNull();
    expect(q('jobs-finish-j2')).not.toBeNull();
    expect(q('jobs-start-j2')).toBeNull();
    expect(q('jobs-start-j3')).toBeNull();
    expect(q('jobs-finish-j3')).toBeNull();
  });

  it('Start PATCHes in_progress with actualStart; Finish PATCHes completed with actualEnd', async () => {
    const fake = createFakeFetch();
    fake.respond('/api/jobs', () =>
      jsonResponse({
        data: [
          job({ id: 'j1', status: 'scheduled' }),
          job({ id: 'j2', status: 'in_progress' }),
        ],
        meta: { total: 2, page: 1, perPage: 25 },
      }),
    );
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/jobs/j1', () =>
      jsonResponse({ data: job({ id: 'j1', status: 'in_progress' }) }),
    );
    fake.respond('/api/jobs/j2', () =>
      jsonResponse({ data: job({ id: 'j2', status: 'completed' }) }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector('[data-testid="jobs-start-j1"]') as HTMLElement
    ).click();
    await tick();
    const started = fake.calls.find(
      (call) => call.method === 'PATCH' && call.url.includes('/api/jobs/j1'),
    );
    expect(started).toBeDefined();
    const startBody = started?.body as { status: string; actualStart: string };
    expect(startBody.status).toBe('in_progress');
    // The Technicians report needs BOTH timestamps to show a duration.
    expect(Number.isNaN(Date.parse(startBody.actualStart))).toBe(false);

    (
      view.element.querySelector(
        '[data-testid="jobs-finish-j2"]',
      ) as HTMLElement
    ).click();
    await tick();
    const finished = fake.calls.find(
      (call) => call.method === 'PATCH' && call.url.includes('/api/jobs/j2'),
    );
    const finishBody = finished?.body as { status: string; actualEnd: string };
    expect(finishBody.status).toBe('completed');
    expect(Number.isNaN(Date.parse(finishBody.actualEnd))).toBe(false);
  });

  it('switches to calendar view and renders 7 day cells', async () => {
    const fake = createFakeFetch();
    stubSchedule(fake, []);
    fake.respond('/api/jobs', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    fake.respond('/api/opportunities', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="jobs-view-calendar"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    const days = view.element.querySelectorAll(
      '[data-bn="calendar-day-column"]',
    );
    expect(days).toHaveLength(7);
    expect(
      view.element.querySelector('[data-bn="calendar-empty"]')?.textContent,
    ).toMatch(/No jobs this week/);
  });

  it('schedules a won opportunity dropped on a calendar slot', async () => {
    const fake = createFakeFetch();
    stubSchedule(fake, []);
    fake.respond('/api/jobs', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [WON_OPPORTUNITY],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const block = view.element.querySelector('[data-testid="jobs-drag-o1"]');
    expect(block?.getAttribute('data-bn')).toBe('pipeline-block');
    expect(block?.getAttribute('draggable')).toBe('true');

    const slot = view.element.querySelector(
      '[data-bn="calendar-slot"][data-hour="10"]',
    ) as HTMLElement;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: () => JSON.stringify({ type: 'pipeline', id: 'o1' }),
        dropEffect: 'move',
      },
    });
    slot.dispatchEvent(drop);
    await tick();

    const created = fake.calls.find(
      (call) => call.method === 'POST' && call.url.includes('/api/jobs'),
    );
    expect(created).toBeDefined();
    const body = created?.body as {
      opportunityId: string;
      title: string;
      scheduledStart: string;
      scheduledEnd: string;
      status: string;
    };
    expect(body.opportunityId).toBe('o1');
    expect(body.title).toBe('Panel upgrade');
    expect(body.status).toBe('scheduled');
    const scheduledStart = new Date(body.scheduledStart);
    expect(scheduledStart.getHours()).toBe(10);
    expect(scheduledStart.getMinutes()).toBe(0);
    expect(localDate(scheduledStart)).toBe(slot.getAttribute('data-date'));
    expect(
      new Date(body.scheduledEnd).getTime() - scheduledStart.getTime(),
    ).toBe(2 * 60 * 60 * 1000);
  });

  it('names the technician on a calendar block when there is one (GP-034)', async () => {
    const start = todayAt(9);
    const end = todayAt(11);
    const fake = createFakeFetch();
    stubSchedule(fake, [
      block({
        id: 'j1',
        start: start.toISOString(),
        end: end.toISOString(),
        assignedTo: 'u2',
        assigneeName: 'Bo Tech',
      }),
      block({
        id: 'j2',
        title: 'Outlet repair',
        start: start.toISOString(),
        end: end.toISOString(),
      }),
    ]);
    fake.respond('/api/jobs', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    const view = renderJobsRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const text = (id: string) =>
      view.element.querySelector(
        `[data-bn="calendar-event"][data-event-id="${id}"]`,
      )?.textContent;
    expect(text('j1')).toContain('Roof replacement · Bo Tech');
    expect(text('j2')).toContain('Outlet repair');
    expect(text('j2')).not.toContain('·');
  });

  it('buckets UTC timestamps by local date, marks today and derives the hours', async () => {
    const start = todayAt(6);
    const end = todayAt(8);
    const fake = createFakeFetch();
    stubSchedule(fake, [
      block({ id: 'j1', start: start.toISOString(), end: end.toISOString() }),
    ]);
    fake.respond('/api/jobs', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const today = localDate(start);
    const event = view.element.querySelector(
      '[data-bn="calendar-event"][data-event-id="j1"]',
    );
    expect(
      event
        ?.closest('[data-bn="calendar-day-column"]')
        ?.getAttribute('data-date'),
    ).toBe(today);
    expect(
      view.element
        .querySelector('[data-bn="calendar-day-header"][aria-current="date"]')
        ?.getAttribute('data-date'),
    ).toBe(today);
    expect(
      view.element.querySelector(
        `[data-bn="calendar-day-column"][data-today][data-date="${today}"]`,
      ),
    ).not.toBeNull();
    // The default 7am start is widened to cover the 6am job, and no further.
    expect(
      view.element.querySelector('[data-bn="calendar-slot"][data-hour="6"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-bn="calendar-slot"][data-hour="5"]'),
    ).toBeNull();
  });

  it('supplies the drag payload for sidebar blocks through dragSource', async () => {
    const fake = createFakeFetch();
    stubSchedule(fake, []);
    fake.respond('/api/jobs', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [WON_OPPORTUNITY],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const block = view.element.querySelector(
      '[data-testid="jobs-drag-o1"]',
    ) as HTMLElement;
    expect(block.closest('[data-bn="calendar"]')).toBeNull();
    const setData = vi.fn();
    const dragstart = new Event('dragstart', { bubbles: true });
    Object.defineProperty(dragstart, 'dataTransfer', {
      value: { setData, effectAllowed: '' },
    });
    block.dispatchEvent(dragstart);

    expect(setData).toHaveBeenCalledWith(
      'text/plain',
      JSON.stringify({ type: 'pipeline', id: 'o1' }),
    );
    expect(block.hasAttribute('data-dragging')).toBe(true);
  });

  it('schedules a won deal by a click on its sidebar block, then a click on a slot (touch/keyboard, no drag)', async () => {
    const fake = createFakeFetch();
    stubSchedule(fake, []);
    fake.respond('/api/jobs', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/opportunities', () =>
      jsonResponse({
        data: [WON_OPPORTUNITY],
        meta: { total: 1, page: 1, perPage: 25 },
      }),
    );
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const block = view.element.querySelector(
      '[data-testid="jobs-drag-o1"]',
    ) as HTMLElement;
    block.click();
    expect(block.hasAttribute('data-picked')).toBe(true);
    expect(
      view.element.querySelector('[data-bn="calendar-status"]')?.textContent,
    ).toMatch(/Picked up/);

    const slot = view.element.querySelector(
      '[data-bn="calendar-slot"][data-hour="10"]',
    ) as HTMLElement;
    slot.click();
    await tick();

    expect(block.hasAttribute('data-picked')).toBe(false);
    const created = fake.calls.find(
      (call) => call.method === 'POST' && /\/api\/jobs(\?|$)/.test(call.url),
    );
    expect(created).toBeDefined();
    const body = created?.body as {
      opportunityId: string;
      scheduledStart: string;
    };
    expect(body.opportunityId).toBe('o1');
    const scheduledStart = new Date(body.scheduledStart);
    expect(scheduledStart.getHours()).toBe(10);
    expect(localDate(scheduledStart)).toBe(slot.getAttribute('data-date'));
  });

  it('reschedules a dragged job to the dropped slot keeping its duration', async () => {
    const fake = createFakeFetch();
    // The dragged event is a schedule block; the list page does not even
    // hold this job (it is 25 rows of something else in production).
    stubSchedule(fake, [
      block({
        id: 'j1',
        start: todayAt(9).toISOString(),
        end: todayAt(12).toISOString(),
      }),
    ]);
    fake.respond('/api/jobs', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const slot = view.element.querySelector(
      '[data-bn="calendar-slot"][data-hour="10"]',
    ) as HTMLElement;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: () => JSON.stringify({ type: 'event', id: 'j1' }),
        dropEffect: 'move',
      },
    });
    slot.dispatchEvent(drop);
    await tick();

    const updated = fake.calls.find(
      (call) => call.method === 'PATCH' && call.url.includes('/api/jobs/j1'),
    );
    expect(updated).toBeDefined();
    const body = updated?.body as {
      scheduledStart: string;
      scheduledEnd: string;
    };
    const scheduledStart = new Date(body.scheduledStart);
    expect(scheduledStart.getHours()).toBe(10);
    expect(localDate(scheduledStart)).toBe(slot.getAttribute('data-date'));
    expect(
      new Date(body.scheduledEnd).getTime() - scheduledStart.getTime(),
    ).toBe(3 * 60 * 60 * 1000);
    // Both the page and the week are stale after the move.
    await tick();
    const after = fake.calls.filter((c) => c.method === 'GET');
    expect(after.some((c) => c.url.includes('/api/jobs/schedule'))).toBe(true);
    expect(
      after.filter((c) => c.url.includes('/api/jobs/schedule')).length,
    ).toBeGreaterThan(1);
    expect(
      after.filter((c) => /\/api\/jobs(\?|$)/.test(c.url)).length,
    ).toBeGreaterThan(1);
  });

  /* GP-006. The calendar filtered the same 25-row page the list fetched —
     newest first, so the current week was the first thing to fall off and a
     contractor with work booked saw "No jobs this week". */
  it('shows the API message and reloads the week when a dropped slot was just taken (GP-104)', async () => {
    const fake = createFakeFetch();
    stubSchedule(fake, [
      block({
        id: 'j1',
        start: todayAt(9).toISOString(),
        end: todayAt(11).toISOString(),
      }),
    ]);
    fake.respond('/api/jobs/j1', () =>
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
    fake.respond('/api/jobs', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    const scheduleFetches = () =>
      fake.calls.filter(
        (c) => c.method === 'GET' && c.url.includes('/api/jobs/schedule'),
      ).length;
    const before = scheduleFetches();

    const slot = view.element.querySelector(
      '[data-bn="calendar-slot"][data-hour="14"]',
    ) as HTMLElement;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: () => JSON.stringify({ type: 'event', id: 'j1' }),
        dropEffect: 'move',
      },
    });
    slot.dispatchEvent(drop);
    await tick();
    await tick();

    const error = view.element.querySelector(
      '[data-testid="jobs-action-error"]',
    ) as HTMLElement;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('That time just went — pick another');
    // The week the user was looking at no longer shows that slot as free.
    expect(scheduleFetches()).toBeGreaterThan(before);
  });

  it('renders this week from /api/jobs/schedule, not from the 25-row list page', async () => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const fake = createFakeFetch();
    stubSchedule(fake, [
      block({
        id: 'week-1',
        title: 'Fence repair',
        start: todayAt(9).toISOString(),
        end: todayAt(11).toISOString(),
      }),
    ]);
    fake.respond('/api/jobs', () =>
      jsonResponse({
        data: Array.from({ length: 25 }, (_, i) =>
          job({
            id: `far-${i}`,
            title: `Far job ${i}`,
            scheduledStart: nextMonth.toISOString(),
            scheduledEnd: nextMonth.toISOString(),
          }),
        ),
        meta: { total: 40, page: 1, perPage: 25 },
      }),
    );
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    (
      view.element.querySelector(
        '[data-testid="jobs-view-calendar"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    const calendar = view.element.querySelector('[data-bn-jobs-calendar]');
    expect(
      calendar?.querySelector(
        '[data-bn="calendar-event"][data-event-id="week-1"]',
      ),
    ).not.toBeNull();
    expect(calendar?.textContent).toContain('Fence repair');
    expect(calendar?.querySelector('[data-bn="calendar-empty"]')).toBeNull();
    expect(calendar?.textContent).not.toMatch(/No jobs this week/);
    // And it asked for a window around this week, not for a page.
    const schedule = fake.calls.find((c) =>
      c.url.includes('/api/jobs/schedule'),
    );
    expect(schedule?.url).toMatch(/start=\d{4}-\d{2}-\d{2}/);
    expect(schedule?.url).toMatch(/end=\d{4}-\d{2}-\d{2}/);
  });

  it('paging the week fetches that week', async () => {
    const fake = createFakeFetch();
    stubSchedule(fake, []);
    fake.respond('/api/jobs', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    const before = fake.calls.filter((c) =>
      c.url.includes('/api/jobs/schedule'),
    ).length;

    (
      view.element.querySelector(
        '[data-testid="jobs-next-week"]',
      ) as HTMLButtonElement
    ).click();
    await tick();

    const calls = fake.calls.filter((c) =>
      c.url.includes('/api/jobs/schedule'),
    );
    expect(calls.length).toBeGreaterThan(before);
    // A day of slack before next week's Sunday: the API cuts on the date
    // string and the grid buckets by local date.
    const nextWeek = addDays(startOfWeek(new Date()), 7);
    expect(calls[calls.length - 1]?.url).toContain(
      `start=${localDate(addDays(nextWeek, -1))}`,
    );
  });

  it('pages the list: reports meta.total and asks for page 2 on Next', async () => {
    const fake = createFakeFetch();
    stubSchedule(fake, []);
    fake.respond('/api/jobs', () =>
      jsonResponse({
        data: [job({ id: 'j1' })],
        meta: { total: 60, page: 1, perPage: 25 },
      }),
    );
    fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();

    const pager = view.element.querySelector('[data-bn-pagination]');
    expect(pager?.hasAttribute('hidden')).toBe(false);
    expect(
      pager?.querySelector('[data-bn-pagination-summary]')?.textContent,
    ).toContain('60');
    (
      view.element.querySelector(
        '[data-testid="jobs-next"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    expect(
      fake.calls.some(
        (c) => /\/api\/jobs\?/.test(c.url) && /[?&]page=2(&|$)/.test(c.url),
      ),
    ).toBe(true);
  });

  /* GP-062. The dashboard's "Week view" landed on the list, and there was no
     URL that opened the calendar at all. */
  describe('the view is addressable', () => {
    function mount(url: string) {
      window.history.replaceState(null, '', url);
      const fake = createFakeFetch();
      stubSchedule(fake, []);
      fake.respond('/api/jobs', () => jsonResponse(EMPTY_LIST));
      fake.respond('/api/opportunities', () => jsonResponse(EMPTY_LIST));
      const view = renderJobsRoute(buildTestDeps({ fetch: fake.fetch }));
      dispose = view.dispose;
      document.body.append(view.element);
      return view;
    }
    function visible(root: HTMLElement, selector: string): boolean {
      const node = root.querySelector(selector);
      return node !== null && node.closest('[hidden]') === null;
    }
    /** The list panel is mounted: its tab is selected and its (empty-state)
     *  message is on screen; the calendar grid is not. */
    function expectList(root: HTMLElement): void {
      expect(
        root
          .querySelector('[data-testid="jobs-view-list"]')
          ?.getAttribute('aria-selected'),
      ).toBe('true');
      expect(visible(root, '[data-bn-empty]')).toBe(true);
      expect(visible(root, '[data-bn-jobs-calendar]')).toBe(false);
    }

    it('/jobs?view=calendar mounts the calendar and not the list', async () => {
      const view = mount('/jobs?view=calendar');
      await tick();
      await tick();
      expect(
        view.element
          .querySelector('[data-testid="jobs-view-calendar"]')
          ?.getAttribute('aria-selected'),
      ).toBe('true');
      expect(visible(view.element, '[data-bn-jobs-calendar]')).toBe(true);
      expect(visible(view.element, '[data-bn-empty]')).toBe(false);
    });

    it('/jobs mounts the list, as before', async () => {
      const view = mount('/jobs');
      await tick();
      await tick();
      expectList(view.element);
    });

    it('/jobs?view=nonsense mounts the list without complaint', async () => {
      const view = mount('/jobs?view=nonsense');
      await tick();
      await tick();
      expectList(view.element);
    });

    it('/jobs?view=calendar&week=2026-03-04 opens that week', async () => {
      const view = mount('/jobs?view=calendar&week=2026-03-04');
      await tick();
      await tick();
      // Wednesday 4 March 2026 sits in the week starting Sunday 1 March.
      expect(
        view.element.querySelector('[data-bn-week-nav] h2')?.textContent,
      ).toBe('Mar 1 – Mar 7, 2026');
      expect(
        view.element
          .querySelector('[data-bn="calendar-day-column"]')
          ?.getAttribute('data-date'),
      ).toBe('2026-03-01');
    });

    it('toggling the view rewrites the address in place', async () => {
      const view = mount('/jobs');
      await tick();
      await tick();
      const length = window.history.length;
      (
        view.element.querySelector(
          '[data-testid="jobs-view-calendar"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      expect(window.location.pathname).toBe('/jobs');
      expect(window.location.search).toMatch(
        /^\?view=calendar&week=\d{4}-\d{2}-\d{2}$/,
      );
      expect(window.history.length).toBe(length);
      (
        view.element.querySelector(
          '[data-testid="jobs-view-list"]',
        ) as HTMLButtonElement
      ).click();
      await tick();
      expect(window.location.search).toBe('');
    });
  });
});

/* GP-015. "Opportunity ID" and "Customer ID" were text boxes the contractor
   had to fill from the database; blank ones were dropped from the payload
   and the API's validator answered in zod's words. */
describe('New job picks its opportunity and customer from selects', () => {
  const OPP_ID = '77777777-7777-4777-8777-777777777777';
  const OPP_NO_CUSTOMER = '88888888-8888-4888-8888-888888888888';
  const CUSTOMER_ID = '99999999-9999-4999-8999-999999999999';
  const CUSTOMER_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OWNER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const TECH_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const OFFICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const TEAM = [
    teammate({ id: OWNER_ID, firstName: 'Dana', lastName: 'Ortiz' }),
    teammate({
      id: OFFICE_ID,
      firstName: 'Cy',
      lastName: 'Office',
      role: 'office',
    }),
    teammate({ id: TECH_ID, firstName: 'Bo', lastName: 'Tech', role: 'tech' }),
  ];

  function customer(partial: Partial<Customer>): Customer {
    return {
      id: CUSTOMER_ID,
      firstName: 'Jane',
      lastName: 'Doe',
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
      totalJobValue: 0,
      jobCount: 0,
      createdAt: '2026-04-03T00:00:00Z',
      updatedAt: '2026-04-03T00:00:00Z',
      createdBy: 'u1',
      ...partial,
    };
  }

  const WON = [
    { ...WON_OPPORTUNITY, id: OPP_ID, customerId: CUSTOMER_ID },
    {
      ...WON_OPPORTUNITY,
      id: OPP_NO_CUSTOMER,
      customerId: undefined,
      title: 'Generator install',
    },
  ];
  const CUSTOMERS = [
    customer({}),
    customer({
      id: CUSTOMER_2,
      firstName: 'Sam',
      lastName: 'Okafor',
      company: 'Okafor LLC',
    }),
  ];

  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    window.history.replaceState(null, '', '/');
  });

  function choose(select: HTMLSelectElement, value: string): void {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function openPanel(fake: FakeFetcher) {
    stubSchedule(fake, []);
    // The create POST is `/api/jobs` exactly; the list GET carries `?page=`.
    fake.respond(/\/api\/jobs$/, () =>
      jsonResponse({ data: job({ id: 'j-new' }) }, { status: 201 }),
    );
    fake.respond('/api/jobs', () => jsonResponse(EMPTY_LIST));
    fake.respond('/api/opportunities', () =>
      jsonResponse({ data: WON, meta: { total: 2, page: 1, perPage: 25 } }),
    );
    fake.respond('/api/customers', () =>
      jsonResponse({
        data: CUSTOMERS,
        meta: { total: 2, page: 1, perPage: 100 },
      }),
    );
    fake.respond('/api/workspace/users', () => jsonResponse({ data: TEAM }));
    const view = renderJobsRoute(buildTestDeps({ fetch: fake.fetch }));
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    (
      view.element.querySelector(
        '[data-testid="jobs-new"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();
    const root = view.element;
    return {
      root,
      opportunity: root.querySelector(
        '[data-testid="jobs-form-opportunityId"]',
      ) as HTMLSelectElement,
      customer: root.querySelector(
        '[data-testid="jobs-form-customerId"]',
      ) as HTMLSelectElement,
      technician: root.querySelector(
        '[data-testid="jobs-form-assignedTo"]',
      ) as HTMLSelectElement,
      title: root.querySelector(
        '[data-testid="jobs-form-title"]',
      ) as HTMLInputElement,
      submit: root.querySelector(
        '[data-testid="panel-submit"]',
      ) as HTMLButtonElement,
      error: () =>
        root.querySelector('[data-bn-error]:not([hidden])')?.textContent,
      posted: () =>
        fake.calls.find((c) => c.method === 'POST' && c.url === '/api/jobs'),
    };
  }

  it('lists won deals and customers with UUID values, both on the placeholder', async () => {
    const fake = createFakeFetch();
    const panel = await openPanel(fake);

    expect(panel.opportunity.tagName).toBe('SELECT');
    expect(panel.customer.tagName).toBe('SELECT');
    expect(
      panel.root.querySelector(`label[for="${panel.opportunity.id}"]`)
        ?.textContent,
    ).toBe('From opportunity');
    expect(
      panel.root.querySelector(`label[for="${panel.customer.id}"]`)
        ?.textContent,
    ).toBe('Customer');
    expect(
      [...panel.opportunity.options].map((o) => [o.value, o.textContent]),
    ).toEqual([
      ['', 'Choose a won opportunity'],
      [OPP_ID, 'Panel upgrade'],
      [OPP_NO_CUSTOMER, 'Generator install'],
    ]);
    expect(
      [...panel.customer.options].map((o) => [o.value, o.textContent]),
    ).toEqual([
      ['', 'Choose a customer'],
      [CUSTOMER_ID, 'Jane Doe'],
      [CUSTOMER_2, 'Sam Okafor · Okafor LLC'],
    ]);
    expect(panel.opportunity.value).toBe('');
    expect(panel.customer.value).toBe('');
    // The won deals are the calendar's own resource — one request, not two.
    expect(
      fake.calls.filter((c) => c.url.includes('/api/opportunities')).length,
    ).toBe(1);
    expect(
      fake.calls.find((c) => c.url.includes('/api/customers'))?.url,
    ).toContain('perPage=100');
  });

  it('blocks submit in its own words until both are chosen', async () => {
    const fake = createFakeFetch();
    const panel = await openPanel(fake);
    panel.title.value = 'Panel upgrade';
    panel.title.dispatchEvent(new Event('input', { bubbles: true }));

    panel.submit.click();
    await tick();
    expect(panel.error()).toBe('Choose an opportunity.');
    expect(panel.opportunity.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(panel.opportunity);
    expect(panel.posted()).toBeUndefined();

    // A deal with no customer on it yet leaves the customer to be chosen.
    choose(panel.opportunity, OPP_NO_CUSTOMER);
    panel.submit.click();
    await tick();
    expect(panel.error()).toBe('Choose a customer.');
    expect(panel.opportunity.hasAttribute('aria-invalid')).toBe(false);
    expect(panel.customer.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(panel.customer);
    expect(panel.posted()).toBeUndefined();

    choose(panel.customer, CUSTOMER_2);
    panel.submit.click();
    await tick();
    await tick();
    expect(panel.posted()?.body).toMatchObject({
      title: 'Panel upgrade',
      opportunityId: OPP_NO_CUSTOMER,
      customerId: CUSTOMER_2,
    });
  });

  it('defaults the customer from the chosen opportunity and sends both UUIDs', async () => {
    const fake = createFakeFetch();
    const panel = await openPanel(fake);
    panel.title.value = 'Panel upgrade';
    panel.title.dispatchEvent(new Event('input', { bubbles: true }));

    choose(panel.opportunity, OPP_ID);
    expect(panel.customer.value).toBe(CUSTOMER_ID);

    panel.submit.click();
    await tick();
    await tick();
    const body = panel.posted()?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      title: 'Panel upgrade',
      opportunityId: OPP_ID,
      customerId: CUSTOMER_ID,
      status: 'scheduled',
    });
    // Sent as keys, never omitted — the API requires both.
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(['opportunityId', 'customerId']),
    );
    // The deal now has a job: the sidebar's list is asked again.
    const postAt = fake.calls.findIndex((c) => c.method === 'POST');
    expect(
      fake.calls
        .slice(postAt + 1)
        .some((c) => c.url.includes('/api/opportunities')),
    ).toBe(true);
  });

  /* GP-034. The technician is optional and comes from the team list — only
     the roles the API accepts, so the office is never offered. */
  it('offers the crew as an optional Technician select and sends assignedTo only when chosen', async () => {
    const fake = createFakeFetch();
    const panel = await openPanel(fake);

    expect(panel.technician.tagName).toBe('SELECT');
    expect(
      panel.root.querySelector(`label[for="${panel.technician.id}"]`)
        ?.textContent,
    ).toBe('Technician');
    expect(panel.technician.hasAttribute('required')).toBe(false);
    expect(
      [...panel.technician.options].map((o) => [o.value, o.textContent]),
    ).toEqual([
      ['', 'Unassigned'],
      [OWNER_ID, 'Dana Ortiz'],
      [TECH_ID, 'Bo Tech'],
    ]);
    expect(panel.technician.options[0]?.disabled).toBe(false);

    panel.title.value = 'Panel upgrade';
    panel.title.dispatchEvent(new Event('input', { bubbles: true }));
    choose(panel.opportunity, OPP_ID);

    // Unassigned: the key is absent, not an empty string.
    panel.submit.click();
    await tick();
    await tick();
    const unassigned = panel.posted()?.body as Record<string, unknown>;
    expect(unassigned).toMatchObject({ opportunityId: OPP_ID });
    expect('assignedTo' in unassigned).toBe(false);

    // Assigned: the technician's UUID rides along.
    (
      panel.root.querySelector('[data-testid="jobs-new"]') as HTMLButtonElement
    ).click();
    await tick();
    await tick();
    panel.title.value = 'Generator install';
    panel.title.dispatchEvent(new Event('input', { bubbles: true }));
    choose(panel.opportunity, OPP_ID);
    choose(panel.technician, TECH_ID);
    panel.submit.click();
    await tick();
    await tick();
    const posts = fake.calls.filter(
      (c) => c.method === 'POST' && c.url === '/api/jobs',
    );
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body).toMatchObject({
      title: 'Generator install',
      assignedTo: TECH_ID,
    });
  });

  it('keeps the panel open with the API message when the slot was just taken (GP-104)', async () => {
    const fake = createFakeFetch();
    stubSchedule(fake, []);
    fake.respond(
      /\/api\/jobs$/,
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'slot_taken',
              message: 'That slot was just booked by someone else.',
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
    );
    const panel = await openPanel(fake);
    panel.title.value = 'Panel upgrade';
    panel.title.dispatchEvent(new Event('input', { bubbles: true }));
    choose(panel.opportunity, OPP_ID);
    panel.submit.click();
    await tick();
    await tick();
    expect(panel.error()).toContain('just booked');
    expect(panel.root.querySelector('[data-bn-panel]')).not.toBeNull();
  });
});

describe('readJobsUrlState', () => {
  it('reads the view and snaps the week to its Sunday', () => {
    const state = readJobsUrlState('?view=calendar&week=2026-03-04');
    expect(state.view).toBe('calendar');
    expect(localDate(state.week)).toBe('2026-03-01');
  });

  it('falls back to the list and this week on anything else', () => {
    const thisWeek = localDate(startOfWeek(new Date()));
    expect(readJobsUrlState('').view).toBe('list');
    expect(readJobsUrlState('?view=nonsense').view).toBe('list');
    expect(localDate(readJobsUrlState('?view=calendar&week=soon').week)).toBe(
      thisWeek,
    );
    expect(
      localDate(readJobsUrlState('?view=calendar&week=2026-13-99').week),
    ).toBe(thisWeek);
  });
});

// GP-008. "Send invoice" sent nothing. The action is named for what it does,
// and the link the API mints is shown for the contractor to send themselves.
describe('renderJobsRoute share links (GP-008)', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    window.history.replaceState(null, '', '/');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).clipboard;
  });

  const WORKSPACE = {
    id: 'w1',
    name: 'Reed HVAC',
    slug: 'reed-hvac',
    trade: 'HVAC',
    phone: '',
    email: '',
    address: { street: '', city: '', state: '', zip: '' },
    createdAt: '2026-01-01T00:00:00Z',
  };

  function q<T extends HTMLElement>(root: HTMLElement, id: string): T {
    const node = root.querySelector<T>(`[data-testid="${id}"]`);
    if (!node) throw new Error(`missing ${id}`);
    return node;
  }

  async function mount(configure: (fake: FakeFetcher) => void) {
    const fake = createFakeFetch();
    fake.respond('/api/opportunities', () =>
      jsonResponse({ data: [], meta: { total: 0, page: 1, perPage: 25 } }),
    );
    fake.respond('/api/workspace/users', () => jsonResponse({ data: [] }));
    configure(fake);
    // Registered last: the fake matches on `includes`, and '/api/workspace'
    // would otherwise swallow '/api/workspace/users'.
    fake.respond('/api/workspace', () => jsonResponse({ data: WORKSPACE }));
    const deps = buildTestDeps({ fetch: fake.fetch });
    const view = renderJobsRoute(deps);
    dispose = view.dispose;
    document.body.append(view.element);
    await tick();
    await tick();
    return { view, fake };
  }

  it('names the action "Mark invoiced" and shows the link the API answers with', async () => {
    const { view, fake } = await mount((f) => {
      f.respond(/\/api\/jobs\/j2\/invoice$/, () =>
        jsonResponse({
          data: job({ id: 'j2', status: 'invoiced', invoiceToken: 'tok-2' }),
          share: {
            url: 'https://reed-hvac.greenput.com/invoice/tok-2',
            message:
              'Hi Jane, here is your invoice: https://reed-hvac.greenput.com/invoice/tok-2',
          },
        }),
      );
      f.respond('/api/jobs', () =>
        jsonResponse({
          data: [job({ id: 'j2', status: 'completed' })],
          meta: { total: 1, page: 1, perPage: 25 },
        }),
      );
    });
    const button = q(view.element, 'jobs-invoice-j2');
    expect(button.textContent).toBe('Mark invoiced');
    expect(view.element.textContent).not.toContain('Send invoice');

    button.click();
    await tick();
    await tick();

    expect(
      fake.calls.some(
        (c) => c.method === 'POST' && c.url.endsWith('/api/jobs/j2/invoice'),
      ),
    ).toBe(true);
    const card = q(view.element, 'jobs-share');
    expect(card.hasAttribute('hidden')).toBe(false);
    expect(q(view.element, 'jobs-share-heading').textContent).toBe(
      'Invoice link ready to share',
    );
    expect(q<HTMLInputElement>(view.element, 'jobs-share-url').value).toBe(
      'https://reed-hvac.greenput.com/invoice/tok-2',
    );
    expect(
      q<HTMLTextAreaElement>(view.element, 'jobs-share-message').value,
    ).toContain('https://reed-hvac.greenput.com/invoice/tok-2');
  });

  it('offers "Copy invoice link" only on a job that has a token, and builds it from the workspace slug', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { view } = await mount((f) => {
      f.respond('/api/jobs', () =>
        jsonResponse({
          data: [
            job({
              id: 'j3',
              title: 'Duct run',
              status: 'invoiced',
              invoiceToken: 'tok-3',
            }),
            job({ id: 'j4', status: 'paid', invoiceToken: 'tok-4' }),
            // Invoiced before the token existed: no link to offer.
            job({ id: 'j5', status: 'invoiced' }),
          ],
          meta: { total: 3, page: 1, perPage: 25 },
        }),
      );
    });
    expect(
      view.element.querySelector('[data-testid="jobs-invoice-link-j3"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="jobs-invoice-link-j4"]'),
    ).not.toBeNull();
    expect(
      view.element.querySelector('[data-testid="jobs-invoice-link-j5"]'),
    ).toBeNull();

    q(view.element, 'jobs-invoice-link-j3').click();
    await tick();
    expect(q<HTMLInputElement>(view.element, 'jobs-share-url').value).toBe(
      'https://reed-hvac.greenput.com/invoice/tok-3',
    );
    const message = q<HTMLTextAreaElement>(
      view.element,
      'jobs-share-message',
    ).value;
    expect(message).toContain('Reed HVAC');
    expect(message).toContain('Duct run');
    expect(message).toContain('https://reed-hvac.greenput.com/invoice/tok-3');

    q(view.element, 'jobs-share-copy-message').click();
    await tick();
    expect(writeText).toHaveBeenCalledWith(message);
  });
});
