/**
 * `/customers/:id` — one customer: contact and service address, an edit
 * form, delete, the job history `GET /api/customers/:id` carries (GP-003),
 * and Message, which opens the conversation about this customer (GP-055).
 *
 * The frame is `routes/shared/detail.ts`; this file is what a customer is.
 * Edits go through `deps.customers.update(id, patch)` with only the fields
 * that changed — `contact` and `address` nested, as `Customer` declares
 * them and `UpdateCustomerSchema` folds them (CLAUDE.md §5.0).
 *
 * Delete asks first and then says what the API said: a customer with
 * active jobs is refused server-side, and the refusal's message is the
 * one the dialog shows.
 */

import { computed } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import {
  PREFERRED_CONTACTS,
  type Address,
  type ContactInfo,
  type Customer,
  type Job,
  type PreferredContact,
} from '@greenput/shared/models';
import { formatPhone } from '@greenput/shared/utils';
import type { PlatformDeps } from '../../deps.js';
import type { CustomerPatch } from '../../api/customers.js';
import { el, on, type Cleanup } from '../../lib/dom.js';
import { formatCurrency, formatRelativeTime } from '../../lib/format.js';
import { statusBadge } from '../shared/badge.js';
import {
  canDeleteRecords,
  mountDetail,
  type DetailEditForm,
  type DetailField,
} from '../shared/detail.js';
import { field as formField } from '../shared/field.js';
import { messageAction } from '../shared/conversation.js';
import {
  fill,
  mountTable,
  timeCell,
  twoLines,
  type TableColumn,
} from '../shared/table.js';
import type { RouteView } from '../types.js';

export interface CustomerDraft {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  preferredContact: PreferredContact;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
}

type TextKey = Exclude<keyof CustomerDraft, 'preferredContact'>;

export function renderCustomerDetailRoute(
  deps: PlatformDeps,
  params: { id: string },
): RouteView {
  const { id } = params;
  const cleanups: Cleanup[] = [];

  const resource = createResource<{ data: Customer }>(
    () => deps.customers.get(id),
    { auto: true },
  );
  const row = computed<Customer | undefined>(() => resource.data()?.data);

  const detail = mountDetail<Customer, CustomerDraft>({
    id: 'customer-detail',
    noun: 'customer',
    back: { href: '/customers', label: 'Customers' },
    row,
    loading: resource.loading,
    error: resource.error,
    heading: fullName,
    subheading: (c) => c.company ?? '',
    fields: FIELDS,
    buildEditForm: buildCustomerForm,
    onSave: async (customer, draft) => {
      const patch = customerPatch(customer, draft);
      if (Object.keys(patch).length > 0) {
        await deps.customers.update(id, patch);
      }
      await resource.reload();
    },
    canDelete: () => canDeleteRecords(deps.auth.user()?.role),
    deleteDescription: (c) =>
      `${fullName(c)} and their contact details are removed. Their jobs are kept, and a customer with active jobs cannot be deleted.`,
    onDelete: async () => {
      await deps.customers.delete(id);
      void deps.router.navigate('/customers');
    },
    // Message: the room about this customer, opened or started (GP-055).
    actions: (customer) => {
      const action = messageAction({
        deps,
        subject: {
          entityType: 'customer',
          entityId: id,
          name: fullName(customer),
        },
        testId: 'customer-detail-message',
        onError: (message) => detail.notify(message),
      });
      cleanups.push(action.dispose);
      return [action.element];
    },
    sections: (customer) => [jobHistory(customer.jobs ?? [])],
  });

  return {
    element: detail.element,
    dispose: () => {
      detail.dispose();
      resource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

function fullName(c: Customer): string {
  return `${c.firstName} ${c.lastName}`;
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

/** `in_progress` → `In progress`. */
function statusLabel(status: string): string {
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const FIELDS: readonly DetailField<Customer>[] = [
  { key: 'email', label: 'Email', value: (c) => c.contact.email || '—' },
  {
    key: 'phone',
    label: 'Phone',
    value: (c) => formatPhone(c.contact.phone) || '—',
  },
  {
    key: 'preferredContact',
    label: 'Preferred contact',
    value: (c) => c.contact.preferredContact,
  },
  { key: 'company', label: 'Company', value: (c) => c.company || '—' },
  {
    key: 'address',
    label: 'Service address',
    value: (c) => addressLine(c.address),
  },
  {
    key: 'lifetime',
    label: 'Lifetime value',
    // The stored counters are only advanced by the paid path, so a customer
    // whose jobs are all still open would read "$0 · 0 jobs" beside a job
    // history that plainly disagrees. Read the history the API just sent
    // when it is the larger number; the counters stay authoritative once
    // history has aged out of the detail read.
    value: (c) => {
      const jobs = c.jobs ?? [];
      const count = Math.max(c.jobCount, jobs.length);
      const value = Math.max(
        c.totalJobValue,
        jobs.reduce((sum, j) => sum + (j.total ?? 0), 0),
      );
      return `${formatCurrency(value / 100)} · ${count} job${count === 1 ? '' : 's'}`;
    },
  },
  {
    key: 'consent',
    label: 'Marketing consent',
    value: (c) =>
      c.consentGivenAt
        ? `Given ${dateLabel(c.consentGivenAt)}${
            c.consentMethod ? ` (${c.consentMethod})` : ''
          }`
        : 'Not given',
  },
  {
    key: 'since',
    label: 'Customer since',
    value: (c) => formatRelativeTime(c.createdAt),
    cell: (c, dd) => {
      dd.textContent = '';
      dd.append(timeCell(c.createdAt, formatRelativeTime(c.createdAt)));
    },
  },
  { key: 'notes', label: 'Notes', value: (c) => c.notes || '—', span: true },
];

const JOB_COLUMNS: readonly TableColumn<Job>[] = [
  {
    key: 'job',
    label: 'Job',
    value: (job) => `${job.jobNumber} ${job.title}`,
    cell: (job, td) => fill(td, ...twoLines(job.jobNumber, job.title)),
  },
  {
    key: 'status',
    label: 'Status',
    value: (job) => statusLabel(job.status),
    cell: (job, td) =>
      fill(td, statusBadge(job.status, statusLabel(job.status))),
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    value: (job) => dateLabel(job.scheduledStart),
    cell: (job, td) =>
      fill(td, timeCell(job.scheduledStart, dateLabel(job.scheduledStart))),
  },
  {
    key: 'total',
    label: 'Total',
    value: (job) => formatCurrency(job.total / 100),
    align: 'end',
  },
];

/** The customer's jobs, newest first as the API orders them. */
function jobHistory(jobs: readonly Job[]): HTMLElement {
  const host = el('div', {
    'data-bn-table-wrap': '',
    'data-testid': 'customer-detail-jobs',
  });
  mountTable(host, {
    columns: JOB_COLUMNS,
    rows: jobs,
    caption: 'Job history',
    emptyMessage: 'No jobs yet.',
  });
  return el(
    'section',
    {
      'data-bn-detail-section': '',
      'aria-labelledby': 'customer-detail-jobs-heading',
    },
    el('h2', { id: 'customer-detail-jobs-heading' }, 'Job history'),
    host,
  );
}

/** Only what changed, nested the way `Customer` is. */
export function customerPatch(
  customer: Customer,
  draft: CustomerDraft,
): CustomerPatch {
  const patch: Record<string, unknown> = {};
  if (draft.firstName !== customer.firstName)
    patch['firstName'] = draft.firstName;
  if (draft.lastName !== customer.lastName) patch['lastName'] = draft.lastName;
  if (draft.company !== (customer.company ?? ''))
    patch['company'] = draft.company;
  if (draft.notes !== customer.notes) patch['notes'] = draft.notes;

  const contact: Partial<ContactInfo> = {};
  if (draft.email !== customer.contact.email) contact.email = draft.email;
  if (draft.phone !== customer.contact.phone) contact.phone = draft.phone;
  if (draft.preferredContact !== customer.contact.preferredContact) {
    contact.preferredContact = draft.preferredContact;
  }
  if (Object.keys(contact).length > 0) patch['contact'] = contact;

  const address: Partial<Address> = {};
  for (const key of ['street', 'city', 'state', 'zip'] as const) {
    if (draft[key] !== customer.address[key]) address[key] = draft[key];
  }
  if (Object.keys(address).length > 0) patch['address'] = address;

  return patch as CustomerPatch;
}

function buildCustomerForm(customer: Customer): DetailEditForm<CustomerDraft> {
  const cleanups: Cleanup[] = [];
  const draft: CustomerDraft = {
    firstName: customer.firstName,
    lastName: customer.lastName,
    company: customer.company ?? '',
    email: customer.contact.email,
    phone: customer.contact.phone,
    preferredContact: customer.contact.preferredContact,
    street: customer.address.street,
    city: customer.address.city,
    state: customer.address.state,
    zip: customer.address.zip,
    notes: customer.notes,
  };
  const inputs = new Map<keyof CustomerDraft, HTMLInputElement>();

  const text = (label: string, key: TextKey, type = 'text'): HTMLElement => {
    const input = el('input', {
      type,
      'data-bn-input': '',
      'data-testid': `customer-detail-form-${key}`,
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

  const preferred = el('select', {
    'data-bn-input': '',
    'data-testid': 'customer-detail-form-preferredContact',
  }) as HTMLSelectElement;
  for (const value of PREFERRED_CONTACTS) {
    preferred.append(el('option', { value }, value));
  }
  preferred.value = draft.preferredContact;
  cleanups.push(
    on(preferred, 'change', () => {
      draft.preferredContact = preferred.value as PreferredContact;
    }),
  );

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'customer-detail-form-notes',
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
    text('First name', 'firstName'),
    text('Last name', 'lastName'),
    text('Company', 'company'),
    text('Email', 'email', 'email'),
    text('Phone', 'phone', 'tel'),
    formField('Preferred contact', preferred),
    text('Street', 'street'),
    text('City', 'city'),
    text('State', 'state'),
    text('ZIP', 'zip'),
  );

  return {
    element: el('div', {}, grid, formField('Notes', notes)),
    read: () => {
      const invalidKey = !draft.firstName.trim()
        ? 'firstName'
        : !draft.lastName.trim()
          ? 'lastName'
          : null;
      if (invalidKey) {
        const input = inputs.get(invalidKey);
        input?.setAttribute('aria-invalid', 'true');
        input?.focus();
        throw new Error('First and last name are required.');
      }
      return { ...draft };
    },
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}
