/**
 * `/jobs` — list/calendar of scheduled work with invoice + paid actions.
 *
 * Mirrors [JobsComponent](apps/platform/src/app/features/jobs/jobs.component.ts).
 *
 *   list view     — table grouped by status with invoice/paid action buttons,
 *                   and Request review on a paid job (GP-047)
 *   calendar view — @basenative/components renderCalendar week grid; "won"
 *                   opportunities are renderPipelineBlock cards in a sidebar,
 *                   dropped onto an hour slot to schedule a two-hour job
 *                   there, and existing jobs can be dragged to reschedule
 *
 * Drag-and-drop is the component's initCalendarDragDrop, bound on the
 * calendar host with the layout as its `dragSource` so the sidebar blocks
 * (outside the calendar element) still supply a drag payload. Every drop
 * lands in `scheduleFromDrop` with the slot's local `datetime`.
 *
 * Two resources, on purpose. The list pages `GET /api/jobs` (25 rows, newest
 * first) and the calendar fetches its own week from `GET /api/jobs/schedule`.
 * They used to share one signal, so any week whose jobs sat on page 2 of the
 * list rendered as a week with no work (GP-006).
 *
 * The view is addressable: `/jobs?view=calendar&week=YYYY-MM-DD` mounts the
 * calendar on that week, anything else mounts the list. Toggling rewrites the
 * address with `replaceState` so a reload keeps what is on screen (GP-062).
 */

import { computed, effect, signal, type Signal } from '@basenative/runtime';
import {
  initCalendarDragDrop,
  renderCalendar,
  renderPipelineBlock,
  type CalendarDropEvent,
} from '@basenative/components';
import { createResource, type Resource } from '@basenative/fetch';
import type {
  ApiResponse,
  Customer,
  Job,
  JobStatus,
  Opportunity,
  ReviewRequestChannel,
  ScheduleBlock,
  Workspace,
  WorkspaceUser,
} from '@greenput/shared/models';
import {
  invoiceShareLink,
  publicSiteOrigin,
  tenantDomainForHostname,
} from '@greenput/shared/utils';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { isSlotTaken } from '../../lib/slot-taken.js';
import { elementFromHtml, fromHtml } from '../../lib/html.js';
import { statusBadge } from '../shared/badge.js';
import { mountTabs } from '../shared/tabs.js';
import {
  actionButton,
  fill,
  mountTable,
  onRowAction,
  timeCell,
  twoLines,
  type TableColumn,
} from '../shared/table.js';
import { formatCurrency } from '../../lib/format.js';
import {
  buildPanel,
  buildPanelForm,
  type PanelMount,
} from '../shared/panel.js';
import { field as formField } from '../shared/field.js';
import { mountDialog, type DialogMount } from '../shared/dialog.js';
import {
  mountEntitySelect,
  type EntitySelect,
} from '../shared/entity-select.js';
import { mountPagination, DEFAULT_PER_PAGE } from '../shared/pagination.js';
import { SHARE_LINK_SHEET, mountShareLink } from '../shared/share-link.js';
import type { RouteView } from '../types.js';

type FormState = {
  title: string;
  /** Both required by the API; chosen from selects, never typed (GP-015). */
  opportunityId: string;
  customerId: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  scheduledStart: string;
  scheduledEnd: string;
  notes: string;
  /** The technician's user id, or '' for unassigned (GP-034). */
  assignedTo: string;
};

/** What the share card is headed once a job is invoiced. Never "sent". */
export const SHARE_HEADING = 'Invoice link ready to share';

export const STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const JOBS_SHEET = defineSheet(`
/* The dispatcher: a "ready to schedule" rail on the left and the week grid
   on the right. The rail is deliberately narrow — it holds won work waiting
   for a slot, and its job is to be a place to drag *from*, not a second
   list to read. */
[data-bn-jobs-layout] {
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr);
  gap: var(--gp-space-4);
  align-items: start;
}
[data-bn-jobs-sidebar] {
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-lg);
  padding: var(--gp-space-3);
  display: grid;
  gap: var(--gp-space-2);
  align-content: start;
  position: sticky;
  inset-block-start: var(--gp-space-4);
}
[data-bn-jobs-sidebar] h2 {
  margin: 0 0 var(--gp-space-1);
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  text-transform: uppercase;
  letter-spacing: var(--gp-tracking-label);
  color: var(--gp-text-muted);
}
[data-bn-jobs-sidebar] [data-bn="pipeline-card"] {
  cursor: grab;
  border: 1px solid var(--gp-rule);
  border-inline-start: 3px solid var(--gp-good-line);
  border-radius: var(--gp-radius-md);
  background: var(--gp-surface);
}
[data-bn-jobs-sidebar] [data-bn="pipeline-card"]:active { cursor: grabbing; }

/* Week header: the range is the heading, the controls sit on the same
   baseline so the week reads as one line of chrome rather than a toolbar. */
[data-bn-week-nav] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gp-space-3);
  padding-block-end: var(--gp-space-3);
  margin-block-end: var(--gp-space-3);
  border-block-end: 1px solid var(--gp-rule);
}
[data-bn-week-nav] h2 {
  margin: 0;
  font-size: var(--gp-text-lg);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-snug);
  color: var(--gp-text-strong);
}
[data-bn-week-nav] [data-bn-toolbar] { gap: var(--gp-space-1); }
[data-bn-week-nav] [data-bn-button] {
  min-block-size: var(--gp-control-h-sm);
  padding-inline: var(--gp-space-3);
}

/* The grid itself is @basenative/components renderCalendar; it already reads
   the bridged --bn-* palette, so a scheduled block is slate, work in motion
   is copper and money in is green — the same four families as the badges.
   Only the container chrome and the day/hour rhythm are set here. */
[data-bn-jobs-calendar] {
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-lg);
  overflow: hidden;
}
[data-bn-jobs-calendar] [data-bn="calendar-day-header"] {
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
  background: var(--gp-surface-sunk);
}
[data-bn-jobs-calendar] [data-bn="calendar-time-label"] {
  font-size: var(--gp-text-2xs);
  font-variant-numeric: tabular-nums;
  color: var(--gp-text-muted);
}
[data-bn-jobs-calendar] [data-bn="calendar-event"] {
  border-radius: var(--gp-radius-sm);
  font-size: var(--gp-text-xs);
}
[data-bn-jobs-calendar] [data-bn="calendar-event-title"] {
  font-weight: var(--gp-weight-semibold);
}

@media (max-width: 60rem) {
  [data-bn-jobs-layout] { grid-template-columns: 1fr; }
  [data-bn-jobs-sidebar] { position: static; }
  [data-bn-week-nav] { flex-wrap: wrap; }
  /* Below 60rem the week grid scrolls sideways inside its own container
     rather than pushing the document wide. */
  [data-bn-jobs-calendar] { overflow-x: auto; }
  [data-bn-jobs-calendar] [data-bn="calendar-grid"] { min-width: 46rem; }
}
`);

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
const pad = (n: number): string => String(n).padStart(2, '0');

/** Local `YYYY-MM-DD` — the calendar keys its day columns by local date. */
function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const TWO_HOURS = 2 * 60 * 60 * 1000;

/** What a customer is called in the New job Customer select. */
export function customerLabel(customer: Customer): string {
  const name = `${customer.firstName} ${customer.lastName}`.trim();
  return customer.company ? `${name} · ${customer.company}` : name;
}

/** What a teammate is called in the Technician select and the list. */
export function userLabel(user: WorkspaceUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.email;
}

/**
 * The roles a job can be assigned to — the same three the Technicians
 * report counts, and the ones `POST /api/jobs` accepts (GP-034).
 */
const ASSIGNABLE_ROLES: ReadonlySet<WorkspaceUser['role']> = new Set([
  'owner',
  'admin',
  'tech',
]);

export function isAssignable(user: WorkspaceUser): boolean {
  return ASSIGNABLE_ROLES.has(user.role);
}

type JobsView = 'list' | 'calendar';

/**
 * The route's URL state. Read once at render time — the route is re-rendered
 * on navigation, so there is nothing to subscribe to. `?view=calendar` mounts
 * the calendar; anything else (absent, unrecognised) mounts the list. `week`
 * is a local `YYYY-MM-DD` and snaps to the start of its week; a missing or
 * unparseable value falls back to this week.
 */
export function readJobsUrlState(search: string): {
  view: JobsView;
  week: Date;
} {
  const params = new URLSearchParams(search);
  const view: JobsView =
    params.get('view') === 'calendar' ? 'calendar' : 'list';
  const raw = params.get('week') ?? '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return { view, week: startOfWeek(new Date()) };
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const parsed = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  // `new Date()` rolls an out-of-range month or day forward instead of
  // rejecting it, so a date only counts if it reads back as written.
  const roundTrips =
    parsed.getFullYear() === year &&
    parsed.getMonth() + 1 === month &&
    parsed.getDate() === day;
  if (!roundTrips) return { view, week: startOfWeek(new Date()) };
  return { view, week: startOfWeek(parsed) };
}

/** The query string for a view + week; empty for the default list. */
export function jobsUrlSearch(view: JobsView, week: Date): string {
  if (view !== 'calendar') return '';
  return `?view=calendar&week=${localDate(week)}`;
}

function emptyForm(): FormState {
  const now = new Date();
  const start = new Date(now);
  start.setHours(9, 0, 0, 0);
  const end = new Date(now);
  end.setHours(11, 0, 0, 0);
  const fmt = (d: Date): string => d.toISOString().slice(0, 16);
  return {
    title: '',
    opportunityId: '',
    customerId: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    scheduledStart: fmt(start),
    scheduledEnd: fmt(end),
    notes: '',
    assignedTo: '',
  };
}

export function renderJobsRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);
  adoptSheet(JOBS_SHEET);
  adoptSheet(SHARE_LINK_SHEET);

  const initial = readJobsUrlState(window.location.search);
  const view = signal<JobsView>(initial.view);
  const weekStart = signal<Date>(initial.week);
  const page = signal(1);
  const showPanel = signal(false);
  const form = signal<FormState>(emptyForm());
  const submitting = signal(false);
  const submitError = signal<string | null>(null);
  const actionError = signal<string | null>(null);

  const cleanups: Cleanup[] = [];

  // The list: one page of `GET /api/jobs`. The fetcher reads `page()`, so
  // the resource re-runs by itself when the pager moves it.
  const jobsResource = createResource<ApiResponse<Job[]>>(
    () => deps.jobs.list({ page: page() }),
    { auto: true },
  );
  // The calendar: the shown week from `GET /api/jobs/schedule`, keyed on
  // `weekStart` — paging weeks fetches weeks. A day of slack either side,
  // because the API cuts on the date string and the grid buckets by local
  // date; the effect below trims to the exact week.
  const scheduleResource = createResource<{ data: ScheduleBlock[] }>(
    () => {
      const start = weekStart();
      return deps.jobs.schedule(
        localDate(addDays(start, -1)),
        localDate(addDays(start, 7)),
      );
    },
    { auto: true },
  );
  const wonOppsResource = createResource<ApiResponse<Opportunity[]>>(
    () => deps.opportunities.list({ status: 'won' }),
    { auto: true },
  );
  // The team, so a list row can print its technician's name: a Job carries
  // only `assignedTo` (GP-034). Unfiltered — a teammate whose role changed
  // since they were assigned still has a name.
  const usersResource = createResource<{ data: WorkspaceUser[] }>(
    () => deps.workspace.listUsers(),
    { auto: true },
  );
  // The workspace, for its public site address: a "Copy invoice link" on a
  // row invoiced earlier builds the same URL the API answered at the time,
  // from the slug the workspace record carries — never reconstructed (GP-008).
  const workspaceResource = createResource<{ data: Workspace }>(
    () => deps.workspace.get(),
    { auto: true },
  );
  const userNames = computed<ReadonlyMap<string, string>>(
    () =>
      new Map(
        (usersResource.data()?.data ?? []).map((u) => [u.id, userLabel(u)]),
      ),
  );

  const jobs = computed<Job[]>(() => jobsResource.data()?.data ?? []);
  const total = computed<number>(() => jobsResource.data()?.meta?.total ?? 0);
  const blocks = computed<ScheduleBlock[]>(
    () => scheduleResource.data()?.data ?? [],
  );

  /** A job changed: both the page and the week may look different now. */
  function reloadAll(): Promise<unknown> {
    return Promise.all([jobsResource.reload(), scheduleResource.reload()]);
  }

  // ── header ─────────────────────────────────────────────────────────────
  const newButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'jobs-new',
    },
    'New job',
  );
  cleanups.push(
    on(newButton, 'click', () => {
      form.set(emptyForm());
      submitError.set(null);
      panel.opportunitySelect.set('');
      panel.customerSelect.set('');
      panel.technicianSelect.set('');
      void panel.customerSelect.load();
      void panel.technicianSelect.load();
      showPanel.set(true);
    }),
  );

  const header = el(
    'header',
    {},
    el(
      'div',
      {},
      el('h1', {}, 'Jobs'),
      el('p', {}, 'Scheduled work, invoicing, and the calendar dispatcher.'),
    ),
    newButton,
  );

  // ── view toggle ────────────────────────────────────────────────────────
  // ── list view ──────────────────────────────────────────────────────────
  const tableWrap = el('div', { 'data-bn-table-wrap': '' });
  // ── request a review (GP-047) ──────────────────────────────────────────
  // Greenput sends nothing (GP-008: links, not sending — no provider). The
  // dialog shows the message for the contractor to copy and send from their
  // own phone or email, and records the request as `pending`; the product
  // never says "sent" about something the contractor has to send.
  let reviewDialog: DialogMount | null = null;
  let reviewForm: PanelMount | null = null;
  const reviewSubmitting = signal(false);
  const reviewError = signal<string | null>(null);

  function closeReviewDialog(): void {
    reviewForm?.dispose();
    reviewForm = null;
    reviewDialog?.dispose();
    reviewDialog = null;
  }

  async function openReviewRequest(jobId: string): Promise<void> {
    const job = jobs.peek().find((row) => row.id === jobId);
    if (!job) return;
    // The row carries the customer's id, not their name; the message
    // greets them by it.
    const { data: customer } = await deps.customers.get(job.customerId);
    closeReviewDialog();
    reviewError.set(null);

    const message = reviewRequestMessage(customer.firstName, job.title);
    const textarea = el('textarea', {
      'data-bn-input': '',
      'data-testid': 'jobs-review-message',
      readonly: true,
      rows: '4',
    }) as HTMLTextAreaElement;
    textarea.value = message;

    const copyButton = el(
      'button',
      {
        type: 'button',
        'data-bn-button': '',
        'data-bn-variant': 'secondary',
        'data-testid': 'jobs-review-copy',
      },
      'Copy message',
    );
    on(copyButton, 'click', () => {
      void copyText(message).then((copied) => {
        copyButton.textContent = copied
          ? 'Copied'
          : 'Select the message above and copy it';
      });
    });

    let channel: ReviewRequestChannel =
      customer.contact.preferredContact === 'email' ? 'email' : 'sms';
    const channelInput = (
      value: ReviewRequestChannel,
      label: string,
    ): HTMLElement => {
      const input = el('input', {
        type: 'radio',
        name: 'jobs-review-channel',
        value,
        'data-testid': `jobs-review-channel-${value}`,
      }) as HTMLInputElement;
      input.checked = channel === value;
      on(input, 'change', () => {
        if (input.checked) channel = value;
      });
      return el('label', {}, input, ` ${label}`);
    };
    const channels = el(
      'fieldset',
      { 'data-bn-field': '' },
      el('legend', {}, 'How will you send it?'),
      channelInput('sms', 'Text message'),
      channelInput('email', 'Email'),
    );

    reviewForm = buildPanelForm({
      body: [formField('Message', textarea), copyButton, channels],
      submitting: reviewSubmitting,
      submitError: reviewError,
      submitLabel: 'Record request',
      submitTestId: 'jobs-review-submit',
      onSubmit: async () => {
        reviewSubmitting.set(true);
        reviewError.set(null);
        try {
          await deps.reviews.request(job.customerId, job.id, channel);
          closeReviewDialog();
        } catch (err) {
          reviewError.set(
            err instanceof Error
              ? err.message
              : 'Could not record the request.',
          );
        } finally {
          reviewSubmitting.set(false);
        }
      },
      onCancel: closeReviewDialog,
    });
    reviewDialog = mountDialog({
      id: 'jobs-request-review',
      title: 'Request a review',
      description:
        'Greenput does not send this for you. Copy the message, send it from your own phone or email, and record the request here — it stays pending until the customer leaves a review.',
      body: [reviewForm.element],
      size: 'lg',
      onClose: closeReviewDialog,
    });
    reviewDialog.open();
  }

  cleanups.push(
    onRowAction(tableWrap, (action, id) => {
      actionError.set(null);
      if (action === 'review') {
        void openReviewRequest(id).catch((err: unknown) => {
          actionError.set(
            err instanceof Error
              ? err.message
              : 'Could not open the review request.',
          );
        });
      } else if (action === 'start' || action === 'finish') {
        void deps.jobs
          .update(id, jobTransition(action))
          .then(reloadAll)
          .catch((err: unknown) => {
            actionError.set(
              err instanceof Error ? err.message : `Could not ${action} job.`,
            );
          });
      } else if (action === 'invoice') {
        void deps.jobs
          .invoice(id)
          .then((res) => {
            // The API mints the token and hands back the link; nothing was
            // sent, and the card says so. No `share` means the workspace has
            // no site address yet — the row still went to Invoiced.
            if (res.share) share.show(res.share, SHARE_HEADING);
            else share.hide();
            return reloadAll();
          })
          .catch((err: unknown) => {
            actionError.set(
              err instanceof Error ? err.message : 'Could not invoice job.',
            );
          });
      } else if (action === 'copy-invoice-link') {
        const job = jobs().find((j) => j.id === id);
        const ws = workspaceResource.data()?.data;
        const origin = ws
          ? publicSiteOrigin(
              ws,
              tenantDomainForHostname(window.location.hostname),
            )
          : null;
        if (!job?.invoiceToken || !ws || !origin) {
          actionError.set(
            'This workspace has no site address yet, so there is no public invoice link.',
          );
          return;
        }
        share.show(
          invoiceShareLink(origin, job.invoiceToken, {
            businessName: ws.name,
            jobTitle: job.title,
          }),
          SHARE_HEADING,
        );
      } else if (action === 'paid') {
        void deps.jobs
          .markPaid(id)
          .then(reloadAll)
          .catch((err: unknown) => {
            actionError.set(
              err instanceof Error
                ? err.message
                : 'Could not mark job as paid.',
            );
          });
      }
    }),
  );

  const empty = el(
    'p',
    { 'data-bn-empty': '', hidden: true },
    'No jobs yet — convert a won opportunity or drag one onto the calendar.',
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  // Surfaces row-action and calendar drag/drop failures. Rendered above the
  // List/Calendar tabs (not inside `listView`) so it stays visible whichever
  // tab is active when the failure happens.
  const actionErrorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
    'data-testid': 'jobs-action-error',
  });
  // The invoice link, once a job is marked invoiced (GP-008). Above the
  // tabs, beside the error line, for the same reason.
  const share = mountShareLink({ testId: 'jobs-share' });
  cleanups.push(share.dispose);
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading jobs…',
  );
  const pager = mountPagination({
    page,
    total,
    perPage: DEFAULT_PER_PAGE,
    onPage: (next) => page.set(next),
    testId: 'jobs',
    label: 'Job pages',
    noun: 'jobs',
    loading: jobsResource.loading,
  });
  cleanups.push(pager.dispose);

  // ── calendar view ──────────────────────────────────────────────────────
  const weekTitle = el('h2', {});
  const prevWeekBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'jobs-prev-week',
    },
    'Previous',
  );
  const nextWeekBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'jobs-next-week',
    },
    'Next',
  );
  const todayBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'ghost',
      'data-testid': 'jobs-today',
    },
    'Today',
  );
  cleanups.push(
    on(prevWeekBtn, 'click', () =>
      weekStart.set(addDays(weekStart.peek(), -7)),
    ),
    on(nextWeekBtn, 'click', () => weekStart.set(addDays(weekStart.peek(), 7))),
    on(todayBtn, 'click', () => weekStart.set(startOfWeek(new Date()))),
  );

  const weekNav = el(
    'div',
    { 'data-bn-week-nav': '' },
    weekTitle,
    el('div', { 'data-bn-toolbar': '' }, todayBtn, prevWeekBtn, nextWeekBtn),
  );

  const sidebar = el('aside', { 'data-bn-jobs-sidebar': '' });
  const calendarHost = el('div', { 'data-bn-jobs-calendar': '' });
  const calendarLayout = el(
    'div',
    { 'data-bn-jobs-layout': '' },
    sidebar,
    calendarHost,
  );

  function scheduleFromDrop(drop: CalendarDropEvent): void {
    // `datetime` is the slot's local `YYYY-MM-DDTHH:MM`, minute snapped.
    const start = new Date(drop.datetime);
    actionError.set(null);
    if (drop.sourceType === 'pipeline') {
      const opp = (wonOppsResource.data()?.data ?? []).find(
        (o) => o.id === drop.eventId,
      );
      if (!opp) return;
      void deps.jobs
        .create({
          title: opp.title,
          opportunityId: opp.id,
          ...(opp.customerId ? { customerId: opp.customerId } : {}),
          scheduledStart: start.toISOString(),
          scheduledEnd: new Date(start.getTime() + TWO_HOURS).toISOString(),
          total: opp.value,
          status: 'scheduled',
        })
        .then(() => {
          void reloadAll();
          void wonOppsResource.reload();
        })
        .catch((err: unknown) => {
          actionError.set(
            err instanceof Error ? err.message : 'Could not schedule job.',
          );
          // GP-104: the slot went to someone else while this week was on
          // screen — the message says so, and the week is stale.
          if (isSlotTaken(err)) void scheduleResource.reload();
        });
      return;
    }
    // The dragged event is one of the week's schedule blocks, not a row of
    // the list page — the two no longer hold the same jobs.
    const block = blocks().find((b) => b.id === drop.eventId);
    if (!block) return;
    const duration = Math.max(
      new Date(block.end).getTime() - new Date(block.start).getTime(),
      TWO_HOURS / 2,
    );
    void deps.jobs
      .update(block.id, {
        scheduledStart: start.toISOString(),
        scheduledEnd: new Date(start.getTime() + duration).toISOString(),
      })
      .then(reloadAll)
      .catch((err: unknown) => {
        actionError.set(
          err instanceof Error ? err.message : 'Could not reschedule job.',
        );
        if (isSlotTaken(err)) void scheduleResource.reload();
      });
  }
  // The calendar host hears its own drags and drops; the layout is the
  // dragSource so the sidebar blocks (outside [data-bn="calendar"]) supply a
  // payload too. Since components 0.11 the same handler also hears
  // click-to-pick then click-to-place (a click on an event or sidebar block
  // picks it up, a click on a slot drops it, Escape cancels) and the
  // keyboard path (Enter/Space, arrows, Enter) — nothing on an event or block
  // has a click of its own to fight it. Drops snap to the quarter hour.
  cleanups.push(
    initCalendarDragDrop(calendarHost, {
      onDrop: scheduleFromDrop,
      dragSource: calendarLayout,
      snapMinutes: 15,
    }).destroy,
  );

  const listView = el(
    'div',
    {},
    loadingNode,
    errorNode,
    empty,
    tableWrap,
    pager.element,
  );
  const calendarView = el('div', {}, weekNav, calendarLayout);
  const tabs = mountTabs({
    id: 'jobs-view',
    active: view.peek(),
    tabs: [
      {
        id: 'list',
        label: 'List',
        testId: 'jobs-view-list',
        content: listView,
      },
      {
        id: 'calendar',
        label: 'Calendar',
        testId: 'jobs-view-calendar',
        content: calendarView,
      },
    ],
    onChange: (id) => view.set(id === 'calendar' ? 'calendar' : 'list'),
  });
  cleanups.push(
    tabs.dispose,
    effect(() => {
      tabs.select(view());
    }).dispose,
    // Keep the address bar honest: a view toggle or a week change is not a
    // navigation (no back-button step), so replaceState, not pushState.
    effect(() => {
      const search = jobsUrlSearch(view(), weekStart());
      const { pathname, hash } = window.location;
      const next = `${pathname}${search}${hash}`;
      if (window.location.search !== search) {
        window.history.replaceState(window.history.state, '', next);
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const start = weekStart();
      const end = addDays(start, 6);
      weekTitle.textContent = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const opps = wonOppsResource.data()?.data ?? [];
      clear(sidebar);
      sidebar.append(el('h2', {}, 'Drag won deals'));
      if (opps.length === 0) {
        sidebar.append(
          el(
            'p',
            { 'data-bn-secondary': '' },
            'No won opportunities yet — close a deal to schedule a job.',
          ),
        );
        return;
      }
      for (const opp of opps) {
        if (opp.convertedToJobId) continue;
        const block = elementFromHtml(
          renderPipelineBlock({
            id: opp.id,
            title: opp.title,
            subtitle: formatCurrency(opp.value / 100),
            status: 'won',
          }),
        );
        block.setAttribute('data-testid', `jobs-drag-${opp.id}`);
        sidebar.append(block);
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const start = weekStart();
      const weekEnd = addDays(start, 7);
      const weekBlocks = blocks().filter((block) => {
        const from = new Date(block.start);
        return from >= start && from < weekEnd;
      });
      clear(calendarHost);
      calendarHost.append(
        fromHtml(
          renderCalendar({
            id: 'jobs-calendar',
            startDate: localDate(start),
            // UTC ISO timestamps as the API returns them: the component
            // buckets and positions them by local date and hour, marks today
            // from `now`, and derives the hour range from the week's events.
            events: weekBlocks.map((block) => ({
              id: block.id,
              // Who is doing it, when someone is (GP-034).
              title: block.assigneeName
                ? `${block.title} · ${block.assigneeName}`
                : block.title,
              start: block.start,
              end: block.end,
              status: block.status,
            })),
            now: new Date(),
            emptyMessage:
              'No jobs this week — drag a won deal onto a slot to schedule one.',
          }),
        ),
      );
    }).dispose,
  );

  // ── create panel ───────────────────────────────────────────────────────
  const panel = buildJobPanel({
    form,
    submitting,
    submitError,
    // The calendar sidebar's won deals are the same list: one fetch, one
    // resource, and a deal scheduled from either place leaves both.
    opportunities: wonOppsResource,
    // GP-006: the API caps a page at 100 rows; a contractor with more
    // customers than that sees the first hundred until paging lands.
    customers: () => deps.customers.list({ perPage: 100 }),
    // Only the roles the API will accept; the office is not on the van.
    technicians: async () => {
      const { data } = await deps.workspace.listUsers();
      return { data: data.filter(isAssignable) };
    },
    onSubmit: async () => {
      const f = form();
      panel.inputs.get('title')?.removeAttribute('aria-invalid');
      panel.opportunitySelect.select.removeAttribute('aria-invalid');
      panel.customerSelect.select.removeAttribute('aria-invalid');
      const reject = (
        control: HTMLElement | undefined,
        message: string,
      ): void => {
        submitError.set(message);
        control?.setAttribute('aria-invalid', 'true');
        control?.focus();
      };
      if (!f.title.trim()) {
        reject(panel.inputs.get('title'), 'Title is required.');
        return;
      }
      // The API requires both ids; said here in the product's words rather
      // than by zod, about a field the panel now actually shows.
      if (!f.opportunityId) {
        reject(panel.opportunitySelect.select, 'Choose an opportunity.');
        return;
      }
      if (!f.customerId) {
        reject(panel.customerSelect.select, 'Choose a customer.');
        return;
      }
      submitting.set(true);
      submitError.set(null);
      try {
        await deps.jobs.create({
          title: f.title,
          opportunityId: f.opportunityId,
          customerId: f.customerId,
          address: {
            street: f.street,
            city: f.city,
            state: f.state,
            zip: f.zip,
          },
          scheduledStart: new Date(f.scheduledStart).toISOString(),
          scheduledEnd: new Date(f.scheduledEnd).toISOString(),
          notes: f.notes,
          status: 'scheduled',
          // Omitted, not '', when unassigned: the API wants a UUID or nothing.
          ...(f.assignedTo ? { assignedTo: f.assignedTo } : {}),
        });
        showPanel.set(false);
        await reloadAll();
        // The deal now has a job; the sidebar and the select both drop it.
        void wonOppsResource.reload();
      } catch (err) {
        submitError.set(
          err instanceof Error ? err.message : 'Could not save job.',
        );
        // GP-104: keep the panel open with the API's message and refresh
        // the week behind it, which no longer shows that slot as free.
        if (isSlotTaken(err)) void scheduleResource.reload();
      } finally {
        submitting.set(false);
      }
    },
    onCancel: () => showPanel.set(false),
  });
  cleanups.push(panel.dispose);

  // ── content slot ───────────────────────────────────────────────────────
  const content = el('div', {});
  const root = el(
    'section',
    { 'data-bn-list-route': '', 'data-bn-route': 'jobs' },
    header,
    actionErrorNode,
    share.element,
    content,
  );

  cleanups.push(
    effect(() => {
      const open = showPanel();
      clear(content);
      if (open) {
        content.append(panel.element);
        return;
      }
      content.append(tabs.element);
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const message = actionError();
      toggleAttr(actionErrorNode, message === null, 'hidden');
      if (message) actionErrorNode.textContent = message;
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const list = jobs();
      const isLoading = jobsResource.loading();
      const err = jobsResource.error();
      toggleAttr(loadingNode, !(isLoading && list.length === 0), 'hidden');
      toggleAttr(errorNode, err === null, 'hidden');
      if (err) errorNode.textContent = `Could not load jobs: ${err.message}`;
      const hasData = list.length > 0;
      toggleAttr(empty, isLoading || err !== null || hasData, 'hidden');
      toggleAttr(tableWrap, !hasData, 'hidden');

      const names = userNames();
      mountTable(tableWrap, {
        columns: jobColumns((job) =>
          job.assignedTo ? names.get(job.assignedTo) : undefined,
        ),
        rows: list,
      });
    }).dispose,
  );

  return {
    element: root,
    dispose: () => {
      closeReviewDialog();
      jobsResource.dispose();
      scheduleResource.dispose();
      wonOppsResource.dispose();
      usersResource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

/**
 * The list's columns. `assigneeName` resolves a job's technician to a name
 * from the team list; an assigned job whose teammate has not loaded (or is
 * gone) shows the same "Unassigned" as one nobody has — the calendar's
 * block, fed by the API's own join, is the authoritative view.
 */
function jobColumns(
  assigneeName: (job: Job) => string | undefined,
): readonly TableColumn<Job>[] {
  return [
    {
      key: 'job',
      label: 'Job',
      value: (job) => job.title,
      href: (job) => `/jobs/${job.id}`,
      cell: (job, td) => fill(td, ...twoLines(job.title, job.jobNumber)),
    },
    {
      key: 'status',
      label: 'Status',
      value: (job) => STATUS_LABELS[job.status],
      cell: (job, td) =>
        fill(td, statusBadge(job.status, STATUS_LABELS[job.status])),
    },
    {
      key: 'technician',
      label: 'Technician',
      value: (job) => assigneeName(job) ?? 'Unassigned',
      cell: (job, td) => {
        const name = assigneeName(job);
        td.setAttribute('data-testid', `jobs-row-technician-${job.id}`);
        fill(td, name ?? el('span', { 'data-bn-secondary': '' }, 'Unassigned'));
      },
    },
    {
      key: 'scheduled',
      label: 'Scheduled',
      value: scheduledLabel,
      cell: (job, td) =>
        fill(td, timeCell(job.scheduledStart, scheduledLabel(job))),
    },
    {
      key: 'total',
      label: 'Total',
      value: (job) => formatCurrency(job.total / 100),
      align: 'end',
    },
    {
      key: 'actions',
      label: '',
      value: () => '',
      cell: (job, td) => fill(td, jobActions(job)),
    },
  ];
}

/**
 * The PATCH that moves a job along. `actualStart` / `actualEnd` are written
 * with the status, not left for later: the Technicians report computes a
 * job's duration from the pair and shows nothing for a job missing either,
 * so a status-only transition would leave that report empty forever.
 */
export function jobTransition(
  action: 'start' | 'finish',
  now: Date = new Date(),
): Partial<Job> {
  return action === 'start'
    ? { status: 'in_progress', actualStart: now.toISOString() }
    : { status: 'completed', actualEnd: now.toISOString() };
}

function scheduledLabel(job: Job): string {
  return new Date(job.scheduledStart).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/* The row's next step, and only the next step. A job walks scheduled →
   in_progress → completed → invoiced → paid; until GP-007 the first two
   arrows had no control anywhere in the product, so nothing could ever
   reach the invoice button that guards on `completed`. */
function jobActions(job: Job): HTMLElement {
  const actions = el('div', { 'data-bn-row-actions': '' });
  if (job.status === 'scheduled') {
    actions.append(
      actionButton({
        action: 'start',
        id: job.id,
        label: 'Start',
        testId: `jobs-start-${job.id}`,
      }),
    );
  }
  if (job.status === 'in_progress') {
    actions.append(
      actionButton({
        action: 'finish',
        id: job.id,
        label: 'Finish',
        testId: `jobs-finish-${job.id}`,
      }),
    );
  }
  if (job.status === 'completed') {
    actions.append(
      actionButton({
        action: 'invoice',
        // Named for what it does. It used to read "Send invoice" and sent
        // nothing; now it marks the job and hands back a link to share.
        id: job.id,
        label: 'Mark invoiced',
        testId: `jobs-invoice-${job.id}`,
      }),
    );
  }
  if (job.status === 'invoiced') {
    actions.append(
      actionButton({
        action: 'paid',
        id: job.id,
        label: 'Mark paid',
        testId: `jobs-paid-${job.id}`,
      }),
    );
  }
  // The one place with both ids on screen (GP-047): a paid job names its
  // customer, so no one types a UUID to ask for a review.
  if (job.status === 'paid') {
    actions.append(
      actionButton({
        action: 'review',
        id: job.id,
        label: 'Request review',
        testId: `jobs-request-review-${job.id}`,
      }),
    );
  }
  // Only a job with a token has a public page; one invoiced before the token
  // existed has none, and offers no link rather than a broken one.
  if (
    (job.status === 'invoiced' || job.status === 'paid') &&
    job.invoiceToken
  ) {
    actions.append(
      actionButton({
        action: 'copy-invoice-link',
        id: job.id,
        label: 'Copy invoice link',
        variant: 'ghost',
        testId: `jobs-invoice-link-${job.id}`,
      }),
    );
  }
  return actions;
}

/**
 * The message a contractor sends to ask for a review. Greenput never sends
 * it (GP-008: links, not sending); it is shown to copy, and the request is
 * recorded as pending.
 */
export function reviewRequestMessage(
  customerFirstName: string,
  jobTitle: string,
): string {
  const name = customerFirstName.trim() || 'there';
  return `Hi ${name}, thanks for choosing us for your ${jobTitle}. Would you leave us a quick review? Just reply with a few words about how it went.`;
}

/** Best effort: the clipboard is absent outside a secure context. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function toggleAttr(node: HTMLElement, on: boolean, attr: string): void {
  if (on) node.setAttribute(attr, '');
  else node.removeAttribute(attr);
}

function buildJobPanel(args: {
  form: Signal<FormState>;
  submitting: Signal<boolean>;
  submitError: Signal<string | null>;
  /** Won deals, shared with the calendar sidebar. */
  opportunities: Resource<ApiResponse<Opportunity[]>>;
  /** The Customer list; fetched each time the panel opens. */
  customers: () => Promise<ApiResponse<Customer[]>>;
  /** The assignable teammates; fetched each time the panel opens (GP-034). */
  technicians: () => Promise<{ data: WorkspaceUser[] }>;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}): {
  element: HTMLElement;
  dispose: Cleanup;
  inputs: Map<keyof FormState, HTMLInputElement>;
  opportunitySelect: EntitySelect<Opportunity>;
  customerSelect: EntitySelect<Customer>;
  technicianSelect: EntitySelect<WorkspaceUser>;
} {
  const fields = el('div', { 'data-bn-field-grid': '' });
  const inputs = new Map<keyof FormState, HTMLInputElement>();

  const customerSelect = mountEntitySelect<Customer>({
    label: 'Customer',
    testId: 'jobs-form-customerId',
    placeholder: 'Choose a customer',
    noun: 'customers',
    optionLabel: customerLabel,
    source: args.customers,
    emptyMessage: 'No customers yet — add one on the Customers page first.',
    onChange: (customerId) => {
      args.form.set({ ...args.form.peek(), customerId });
    },
  });
  const opportunitySelect = mountEntitySelect<Opportunity>({
    label: 'From opportunity',
    testId: 'jobs-form-opportunityId',
    placeholder: 'Choose a won opportunity',
    noun: 'won opportunities',
    optionLabel: (opp) => opp.title,
    source: args.opportunities,
    emptyMessage: 'No won opportunities yet — close a deal to schedule a job.',
    onChange: (opportunityId, opp) => {
      // The deal's customer is the job's customer — the same default the
      // calendar drop applies. Still a select, so it can be changed.
      const customerId = opp?.customerId ?? args.form.peek().customerId;
      args.form.set({ ...args.form.peek(), opportunityId, customerId });
      if (opp?.customerId) customerSelect.set(opp.customerId);
    },
  });
  const technicianSelect = mountEntitySelect<WorkspaceUser>({
    label: 'Technician',
    testId: 'jobs-form-assignedTo',
    placeholder: 'Unassigned',
    noun: 'technicians',
    optionLabel: userLabel,
    source: args.technicians,
    optional: true,
    emptyMessage: 'No technicians yet — invite your crew under Settings.',
    onChange: (assignedTo) => {
      args.form.set({ ...args.form.peek(), assignedTo });
    },
  });
  const make = (
    label: string,
    field: keyof FormState,
    type = 'text',
  ): HTMLElement => {
    const input = el('input', {
      type,
      'data-bn-input': '',
      'data-testid': `jobs-form-${field}`,
    }) as HTMLInputElement;
    inputs.set(field, input);
    on(input, 'input', () => {
      args.form.set({ ...args.form.peek(), [field]: input.value });
    });
    return formField(label, input);
  };

  fields.append(
    make('Title', 'title'),
    opportunitySelect.element,
    customerSelect.element,
    technicianSelect.element,
    make('Street', 'street'),
    make('City', 'city'),
    make('State', 'state'),
    make('ZIP', 'zip'),
    make('Scheduled start', 'scheduledStart', 'datetime-local'),
    make('Scheduled end', 'scheduledEnd', 'datetime-local'),
  );
  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'jobs-form-notes',
  }) as HTMLTextAreaElement;
  on(notes, 'input', () => {
    args.form.set({ ...args.form.peek(), notes: notes.value });
  });

  const panel = buildPanel({
    title: 'New job',
    onSubmit: args.onSubmit,
    onCancel: args.onCancel,
    submitting: args.submitting,
    submitError: args.submitError,
    body: [fields, formField('Notes', notes)],
    submitLabel: 'Schedule job',
    syncForm: () => {
      const f = args.form.peek();
      for (const [key, input] of inputs) input.value = f[key];
      opportunitySelect.set(f.opportunityId);
      customerSelect.set(f.customerId);
      technicianSelect.set(f.assignedTo);
      notes.value = f.notes;
    },
  });
  return {
    element: panel.element,
    dispose: () => {
      panel.dispose();
      opportunitySelect.dispose();
      customerSelect.dispose();
      technicianSelect.dispose();
    },
    inputs,
    opportunitySelect,
    customerSelect,
    technicianSelect,
  };
}
