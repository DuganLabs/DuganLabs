/**
 * `/jobs/:id` — one job: its schedule, technician, status, address and
 * line items, an edit form, delete, the invoice link once one exists
 * (GP-003, GP-008), and Message, which opens the conversation about this
 * job (GP-055).
 *
 * The frame is `routes/shared/detail.ts`; this file is what a job is. The
 * row is read with `createResource`, edits go through
 * `deps.jobs.update(id, patch)` with only the fields that changed —
 * `address` nested, the two schedule fields as UTC ISO built from the
 * `datetime-local` inputs, `assignedTo: null` to unassign (GP-034), and
 * `actualStart` / `actualEnd` stamped alongside a status moved to
 * in_progress / completed so the Technicians report can time the job.
 *
 * A new schedule rebooks the job's `job_slots` server-side in one batch
 * (GP-104); when every lane is taken the API answers 409 `SLOT_TAKEN` and
 * the form stays open showing its message. Line items are read-only here:
 * once a job exists its price moves only through a change order — the
 * section under the line items (`./job-change-orders.ts`) proposes one,
 * and office and up record the homeowner's answer.
 */

import { computed } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import {
  JOB_STATUSES,
  canPatchJobStatus,
  type Address,
  type Job,
  type JobLineItem,
  type JobStatus,
  type Workspace,
  type WorkspaceUser,
} from '@greenput/shared/models';
import {
  invoiceShareLink,
  publicSiteOrigin,
  tenantDomainForHostname,
} from '@greenput/shared/utils';
import type { PlatformDeps } from '../../deps.js';
import type { JobPatch } from '../../api/jobs.js';
import { adoptSheet } from '../../styles/sheet.js';
import { el, on, type Cleanup } from '../../lib/dom.js';
import { formatCurrency } from '../../lib/format.js';
import { dateTimeLocalToIso, toDateTimeLocal } from '../../lib/datetime.js';
import { statusBadge } from '../shared/badge.js';
import {
  canDeleteRecords,
  mountDetail,
  type DetailEditForm,
  type DetailField,
} from '../shared/detail.js';
import { field as formField } from '../shared/field.js';
import { mountEntitySelect } from '../shared/entity-select.js';
import { messageAction } from '../shared/conversation.js';
import { SHARE_LINK_SHEET, mountShareLink } from '../shared/share-link.js';
import { mountTable, timeCell, type TableColumn } from '../shared/table.js';
import { mountJobChangeOrders } from './job-change-orders.js';
import type { RouteView } from '../types.js';
import {
  SHARE_HEADING,
  STATUS_LABELS,
  isAssignable,
  userLabel,
} from './jobs.js';

export interface JobDraft {
  title: string;
  status: JobStatus;
  street: string;
  city: string;
  state: string;
  zip: string;
  /** `datetime-local` values; ISO on the wire. */
  scheduledStart: string;
  scheduledEnd: string;
  /** The technician's user id, or '' for unassigned (GP-034). */
  assignedTo: string;
  notes: string;
}

type TextKey = Exclude<keyof JobDraft, 'status' | 'assignedTo'>;

export function renderJobDetailRoute(
  deps: PlatformDeps,
  params: { id: string },
): RouteView {
  const { id } = params;
  adoptSheet(SHARE_LINK_SHEET);
  const cleanups: Cleanup[] = [];

  const resource = createResource<{ data: Job }>(() => deps.jobs.get(id), {
    auto: true,
  });
  const row = computed<Job | undefined>(() => resource.data()?.data);

  // The team, so the Technician field can print a name: a Job carries only
  // `assignedTo` (GP-034). Unfiltered — a teammate whose role changed since
  // they were assigned still has a name.
  const usersResource = createResource<{ data: WorkspaceUser[] }>(
    () => deps.workspace.listUsers(),
    { auto: true },
  );
  const userNames = computed<ReadonlyMap<string, string>>(
    () =>
      new Map(
        (usersResource.data()?.data ?? []).map((u) => [u.id, userLabel(u)]),
      ),
  );
  // The workspace, for its public site address: "Copy invoice link" builds
  // the same URL the API answered when the job was invoiced, from the slug
  // the workspace record carries — never reconstructed (GP-008).
  const workspaceResource = createResource<{ data: Workspace }>(
    () => deps.workspace.get(),
    { auto: true },
  );

  const changeOrders = mountJobChangeOrders({
    deps,
    jobId: id,
    onApplied: () => resource.reload(),
  });
  cleanups.push(changeOrders.dispose);

  const share = mountShareLink({ testId: 'job-detail-share' });
  cleanups.push(share.dispose);

  const copyInvoiceLink = (job: Job): void => {
    const ws = workspaceResource.data()?.data;
    const origin = ws
      ? publicSiteOrigin(ws, tenantDomainForHostname(window.location.hostname))
      : null;
    if (!job.invoiceToken || !ws || !origin) {
      detail.notify(
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
  };

  const fields: readonly DetailField<Job>[] = [
    {
      key: 'status',
      label: 'Status',
      value: (job) => STATUS_LABELS[job.status],
      cell: (job, dd) => {
        dd.textContent = '';
        dd.append(statusBadge(job.status, STATUS_LABELS[job.status]));
      },
    },
    { key: 'jobNumber', label: 'Job number', value: (job) => job.jobNumber },
    {
      key: 'technician',
      label: 'Technician',
      value: (job) =>
        (job.assignedTo ? userNames().get(job.assignedTo) : undefined) ??
        'Unassigned',
    },
    {
      key: 'scheduled',
      label: 'Scheduled',
      value: scheduleLabel,
      cell: (job, dd) => {
        dd.textContent = '';
        dd.append(timeCell(job.scheduledStart, scheduleLabel(job)));
      },
    },
    {
      key: 'customer',
      label: 'Customer',
      value: () => 'Open customer',
      cell: (job, dd) => {
        dd.textContent = '';
        dd.append(
          el('a', { href: `/customers/${job.customerId}` }, 'Open customer'),
        );
      },
    },
    {
      key: 'opportunity',
      label: 'Opportunity',
      value: () => 'Open opportunity',
      cell: (job, dd) => {
        dd.textContent = '';
        dd.append(
          el(
            'a',
            { href: `/opportunities/${job.opportunityId}` },
            'Open opportunity',
          ),
        );
      },
    },
    {
      key: 'address',
      label: 'Service address',
      value: (job) => addressLine(job.address),
    },
    {
      key: 'total',
      label: 'Total',
      value: (job) => formatCurrency(job.total / 100, { cents: true }),
    },
    {
      key: 'invoicing',
      label: 'Invoicing',
      value: (job) => {
        if (job.paidAt) return `Paid ${dateLabel(job.paidAt)}`;
        if (job.invoicedAt) return `Invoiced ${dateLabel(job.invoicedAt)}`;
        return 'Not yet invoiced';
      },
    },
    {
      key: 'notes',
      label: 'Notes',
      value: (job) => job.notes || '—',
      span: true,
    },
  ];

  const detail = mountDetail<Job, JobDraft>({
    id: 'job-detail',
    noun: 'job',
    back: { href: '/jobs', label: 'Jobs' },
    row,
    loading: resource.loading,
    error: resource.error,
    heading: (job) => job.title,
    subheading: (job) => job.jobNumber,
    fields,
    buildEditForm: (job) =>
      buildJobForm(job, async () => {
        const { data } = await deps.workspace.listUsers();
        return { data: data.filter(isAssignable) };
      }),
    onSave: async (job, draft) => {
      const patch = jobPatch(job, draft);
      if (Object.keys(patch).length > 0) await deps.jobs.update(id, patch);
      await resource.reload();
    },
    canDelete: () => canDeleteRecords(deps.auth.user()?.role),
    deleteDescription: (job) =>
      `${job.jobNumber} ${job.title} and its line items are removed and its calendar time is freed. This cannot be undone.`,
    onDelete: async () => {
      await deps.jobs.delete(id);
      void deps.router.navigate('/jobs');
    },
    actions: (job) => {
      // Message: the room about this job, opened or started (GP-055).
      const message = messageAction({
        deps,
        subject: {
          entityType: 'job',
          entityId: id,
          name: `${job.jobNumber} ${job.title}`,
        },
        testId: 'job-detail-message',
        onError: (text) => detail.notify(text),
      });
      cleanups.push(message.dispose);
      // Only a job with a token has a public page; one invoiced before the
      // token existed has none, and offers no link rather than a broken one.
      if (
        !(job.status === 'invoiced' || job.status === 'paid') ||
        !job.invoiceToken
      ) {
        return [message.element];
      }
      const button = el(
        'button',
        {
          type: 'button',
          'data-bn-button': '',
          'data-bn-variant': 'secondary',
          'data-testid': 'job-detail-invoice-link',
        },
        'Copy invoice link',
      );
      cleanups.push(on(button, 'click', () => copyInvoiceLink(job)));
      return [message.element, button];
    },
    sections: (job) => {
      changeOrders.setJob(job);
      return [share.element, lineItems(job.lineItems), changeOrders.element];
    },
  });

  return {
    element: detail.element,
    dispose: () => {
      detail.dispose();
      resource.dispose();
      usersResource.dispose();
      workspaceResource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

function addressLine(address: Address): string {
  const line1 = address.street.trim();
  const line2 = [address.city, address.state].filter(Boolean).join(', ');
  const line3 = [line2, address.zip].filter(Boolean).join(' ');
  return [line1, line3].filter(Boolean).join('\n') || '—';
}

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Apr 7, 2026, 9:30 AM – 11:30 AM"; the end carries its date when it differs. */
export function scheduleLabel(
  job: Pick<Job, 'scheduledStart' | 'scheduledEnd'>,
): string {
  const start = new Date(job.scheduledStart);
  const end = new Date(job.scheduledEnd);
  if (Number.isNaN(start.getTime())) return '—';
  const day: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  const time: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
  };
  const from = start.toLocaleString('en-US', { ...day, ...time });
  if (Number.isNaN(end.getTime())) return from;
  const sameDay = start.toDateString() === end.toDateString();
  const to = end.toLocaleString('en-US', sameDay ? time : { ...day, ...time });
  return `${from} – ${to}`;
}

const LINE_ITEM_COLUMNS: readonly TableColumn<JobLineItem>[] = [
  { key: 'description', label: 'Description', value: (li) => li.description },
  {
    key: 'quantity',
    label: 'Qty',
    value: (li) => String(li.quantity),
    align: 'end',
  },
  {
    key: 'unitPrice',
    label: 'Unit price',
    value: (li) => formatCurrency(li.unitPrice / 100, { cents: true }),
    align: 'end',
  },
  {
    key: 'total',
    label: 'Total',
    value: (li) => formatCurrency(li.total / 100, { cents: true }),
    align: 'end',
  },
];

/** The job's line items, read-only: the invoice prints exactly these. */
function lineItems(items: readonly JobLineItem[]): HTMLElement {
  const host = el('div', {
    'data-bn-table-wrap': '',
    'data-testid': 'job-detail-line-items',
  });
  mountTable(host, {
    columns: LINE_ITEM_COLUMNS,
    rows: items,
    caption: 'Line items',
    emptyMessage: 'No line items.',
  });
  return el(
    'section',
    {
      'data-bn-detail-section': '',
      'aria-labelledby': 'job-detail-line-items-heading',
    },
    el('h2', { id: 'job-detail-line-items-heading' }, 'Line items'),
    host,
  );
}

const iso = (value: string): string => new Date(value).toISOString();

/**
 * Only what changed, nested the way `Job` is. A status moved to
 * in_progress / completed stamps `actualStart` / `actualEnd` when the job
 * has none, the same PATCH the list row's Start / Finish make.
 */
export function jobPatch(
  job: Job,
  draft: JobDraft,
  now: Date = new Date(),
): JobPatch {
  const patch: Record<string, unknown> = {};
  if (draft.title !== job.title) patch['title'] = draft.title;
  if (draft.notes !== job.notes) patch['notes'] = draft.notes;
  if (draft.status !== job.status) {
    patch['status'] = draft.status;
    if (draft.status === 'in_progress' && !job.actualStart) {
      patch['actualStart'] = now.toISOString();
    }
    if (draft.status === 'completed' && !job.actualEnd) {
      patch['actualEnd'] = now.toISOString();
    }
  }

  const start = dateTimeLocalToIso(draft.scheduledStart);
  if (start && start !== iso(job.scheduledStart)) {
    patch['scheduledStart'] = start;
  }
  const end = dateTimeLocalToIso(draft.scheduledEnd);
  if (end && end !== iso(job.scheduledEnd)) patch['scheduledEnd'] = end;

  if (draft.assignedTo !== (job.assignedTo ?? '')) {
    patch['assignedTo'] = draft.assignedTo || null;
  }

  const address: Partial<Address> = {};
  for (const key of ['street', 'city', 'state', 'zip'] as const) {
    if (draft[key] !== job.address[key]) address[key] = draft[key];
  }
  if (Object.keys(address).length > 0) patch['address'] = address;

  return patch as JobPatch;
}

function buildJobForm(
  job: Job,
  technicians: () => Promise<{ data: WorkspaceUser[] }>,
): DetailEditForm<JobDraft> {
  const cleanups: Cleanup[] = [];
  const draft: JobDraft = {
    title: job.title,
    status: job.status,
    street: job.address.street,
    city: job.address.city,
    state: job.address.state,
    zip: job.address.zip,
    scheduledStart: toDateTimeLocal(new Date(job.scheduledStart)),
    scheduledEnd: toDateTimeLocal(new Date(job.scheduledEnd)),
    assignedTo: job.assignedTo ?? '',
    notes: job.notes,
  };
  const inputs = new Map<
    keyof JobDraft,
    HTMLInputElement | HTMLSelectElement
  >();

  const text = (label: string, key: TextKey, type = 'text'): HTMLElement => {
    const input = el('input', {
      type,
      'data-bn-input': '',
      'data-testid': `job-detail-form-${key}`,
      autocomplete: 'off',
    }) as HTMLInputElement;
    input.value = draft[key];
    inputs.set(key, input);
    cleanups.push(
      on(input, 'input', () => {
        draft[key] = input.value;
        input.removeAttribute('aria-invalid');
      }),
    );
    return formField(label, input);
  };

  const status = el('select', {
    'data-bn-input': '',
    'data-testid': 'job-detail-form-status',
  }) as HTMLSelectElement;
  // Only the moves the API's transition table accepts by PATCH, in the
  // canonical order; invoiced / paid come from their own actions.
  for (const value of JOB_STATUSES) {
    if (!canPatchJobStatus(job.status, value)) continue;
    status.append(el('option', { value }, STATUS_LABELS[value]));
  }
  status.value = draft.status;
  inputs.set('status', status);
  cleanups.push(
    on(status, 'change', () => {
      draft.status = status.value as JobStatus;
    }),
  );

  const technician = mountEntitySelect<WorkspaceUser>({
    label: 'Technician',
    testId: 'job-detail-form-assignedTo',
    placeholder: 'Unassigned',
    noun: 'technicians',
    optionLabel: userLabel,
    source: technicians,
    optional: true,
    emptyMessage: 'No technicians yet — invite your crew under Settings.',
    onChange: (assignedTo) => {
      draft.assignedTo = assignedTo;
    },
  });
  technician.set(draft.assignedTo);
  void technician.load();
  cleanups.push(technician.dispose);

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'job-detail-form-notes',
  }) as HTMLTextAreaElement;
  notes.value = draft.notes;
  cleanups.push(
    on(notes, 'input', () => {
      draft.notes = notes.value;
    }),
  );

  const grid = el(
    'div',
    { 'data-bn-field-grid': '' },
    text('Title', 'title'),
    formField('Status', status),
    technician.element,
    text('Scheduled start', 'scheduledStart', 'datetime-local'),
    text('Scheduled end', 'scheduledEnd', 'datetime-local'),
    text('Street', 'street'),
    text('City', 'city'),
    text('State', 'state'),
    text('ZIP', 'zip'),
  );

  const reject = (key: keyof JobDraft, message: string): never => {
    const input = inputs.get(key);
    input?.setAttribute('aria-invalid', 'true');
    input?.focus();
    throw new Error(message);
  };

  return {
    element: el('div', {}, grid, formField('Notes', notes)),
    read: () => {
      if (!draft.title.trim()) reject('title', 'Title is required.');
      const start = dateTimeLocalToIso(draft.scheduledStart);
      const end = dateTimeLocalToIso(draft.scheduledEnd);
      if (!start) reject('scheduledStart', 'Scheduled start is required.');
      if (!end) reject('scheduledEnd', 'Scheduled end is required.');
      if (start && end && Date.parse(end) <= Date.parse(start)) {
        reject('scheduledEnd', 'Scheduled end must be after the start.');
      }
      return { ...draft };
    },
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}
