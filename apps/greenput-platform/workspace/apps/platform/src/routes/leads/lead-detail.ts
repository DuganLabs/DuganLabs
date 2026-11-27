/**
 * `/leads/:id` — one lead: its fields, an edit form, delete, and the same
 * lifecycle action the list row carries (GP-003, GP-106).
 *
 * The frame is `routes/shared/detail.ts`; this file is what a lead is.
 * The row is read with `createResource`, edits go through
 * `deps.leads.update(id, patch)` with only the fields that changed —
 * `contact` and `address` are sent nested, the shape `Lead` declares and
 * `UpdateLeadSchema` folds onto the columns (CLAUDE.md §5.0).
 */

import { computed } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import {
  LEAD_SOURCES,
  PREFERRED_CONTACTS,
  type Address,
  type ContactInfo,
  type Lead,
  type LeadSource,
  type LeadStatus,
  type PreferredContact,
} from '@greenput/shared/models';
import { formatPhone } from '@greenput/shared/utils';
import type { PlatformDeps } from '../../deps.js';
import type { LeadPatch } from '../../api/leads.js';
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
import { timeCell } from '../shared/table.js';
import type { RouteView } from '../types.js';
import {
  LIFECYCLE_LABELS,
  createLeadLifecycle,
  lifecycleAction,
  lifecycleStage,
} from './lifecycle.js';

/** The statuses a contractor may set by hand; the API stamps the rest. */
const EDITABLE_STATUSES: readonly LeadStatus[] = [
  'new',
  'contacted',
  'qualified',
  'unqualified',
  'converted',
];

const STATUS_LABELS: Readonly<Record<LeadStatus, string>> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  unqualified: 'Unqualified',
  converted: 'Converted',
  accepted: 'Accepted',
  withdrawn: 'Withdrawn',
};

const WITHDRAWN_REASON_LABELS: Readonly<Record<string, string>> = {
  schedule_no_longer_works: 'schedule no longer works',
  chose_another_provider: 'chose another provider',
  no_longer_needed: 'no longer needed',
  other: 'other',
};

export interface LeadDraft {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredContact: PreferredContact;
  street: string;
  city: string;
  state: string;
  zip: string;
  status: LeadStatus;
  source: LeadSource;
  serviceType: string;
  /** Whole dollars as typed; converted to cents on save (§5.0.1). */
  estimatedValueUsd: string;
  notes: string;
}

type TextKey = Exclude<
  keyof LeadDraft,
  'preferredContact' | 'status' | 'source'
>;

export function renderLeadDetailRoute(
  deps: PlatformDeps,
  params: { id: string },
): RouteView {
  const { id } = params;
  const cleanups: Cleanup[] = [];

  const resource = createResource<{ data: Lead }>(() => deps.leads.get(id), {
    auto: true,
  });
  const row = computed<Lead | undefined>(() => resource.data()?.data);

  const lifecycle = createLeadLifecycle(deps, {
    notify: (message) => detail.notify(message),
    reload: () => resource.reload(),
  });
  cleanups.push(lifecycle.dispose);

  const convert = async (lead: Lead): Promise<void> => {
    try {
      await deps.leads.convert(lead.id);
      detail.notify(`Converted ${fullName(lead)} to an opportunity.`);
    } catch (err) {
      detail.notify(
        `Could not convert ${fullName(lead)}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
    await resource.reload();
  };

  const detail = mountDetail<Lead, LeadDraft>({
    id: 'lead-detail',
    noun: 'lead',
    back: { href: '/leads', label: 'Leads' },
    row,
    loading: resource.loading,
    error: resource.error,
    heading: fullName,
    subheading: (lead) => lead.serviceType || `From ${lead.source}`,
    fields: FIELDS,
    buildEditForm: buildLeadForm,
    onSave: async (lead, draft) => {
      const patch = leadPatch(lead, draft);
      if (Object.keys(patch).length > 0) await deps.leads.update(id, patch);
      await resource.reload();
    },
    canDelete: () => canDeleteRecords(deps.auth.user()?.role),
    deleteDescription: (lead) =>
      `${fullName(lead)} is removed from the pipeline. This cannot be undone.`,
    onDelete: async () => {
      await deps.leads.delete(id);
      void deps.router.navigate('/leads');
    },
    actions: (lead) => {
      const nodes: Node[] = [];
      if (lead.status === 'qualified') {
        const convertBtn = el(
          'button',
          {
            type: 'button',
            'data-bn-button': '',
            'data-bn-variant': 'secondary',
            'data-testid': 'lead-detail-convert',
          },
          'Convert',
        );
        cleanups.push(on(convertBtn, 'click', () => void convert(lead)));
        nodes.push(convertBtn);
      }
      const action = lifecycleAction(lead);
      if (action) {
        const btn = el(
          'button',
          {
            type: 'button',
            'data-bn-button': '',
            'data-bn-variant': action.variant,
            'data-testid': `lead-detail-${action.action}`,
          },
          action.label,
        );
        cleanups.push(
          on(btn, 'click', () => lifecycle.run(action.action, lead)),
        );
        nodes.push(btn);
      }
      return nodes;
    },
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

function fullName(lead: Lead): string {
  return `${lead.firstName} ${lead.lastName}`;
}

function addressLine(address: Address | undefined): string {
  if (!address) return '—';
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

const FIELDS: readonly DetailField<Lead>[] = [
  {
    key: 'status',
    label: 'Status',
    value: (lead) => STATUS_LABELS[lead.status],
    cell: (lead, dd) => {
      dd.textContent = '';
      dd.append(statusBadge(lead.status, STATUS_LABELS[lead.status]));
      const stage = lifecycleStage(lead);
      if (stage === 'accepted' || stage === 'withdrawn') {
        dd.append(statusBadge(stage, LIFECYCLE_LABELS[stage]));
      }
    },
  },
  { key: 'email', label: 'Email', value: (lead) => lead.contact.email || '—' },
  {
    key: 'phone',
    label: 'Phone',
    value: (lead) => formatPhone(lead.contact.phone) || '—',
  },
  {
    key: 'preferredContact',
    label: 'Preferred contact',
    value: (lead) => lead.contact.preferredContact,
  },
  {
    key: 'serviceType',
    label: 'Service type',
    value: (l) => l.serviceType || '—',
  },
  { key: 'source', label: 'Source', value: (lead) => lead.source },
  {
    key: 'estimatedValue',
    label: 'Estimated value',
    value: (lead) =>
      lead.estimatedValue ? formatCurrency(lead.estimatedValue / 100) : '—',
  },
  {
    key: 'address',
    label: 'Service address',
    value: (lead) => addressLine(lead.address),
  },
  {
    key: 'lifecycle',
    label: 'Lifecycle',
    value: (lead) => {
      const stage = lifecycleStage(lead);
      if (stage === 'withdrawn' && lead.withdrawnAt) {
        const why = lead.withdrawnReason
          ? ` (${WITHDRAWN_REASON_LABELS[lead.withdrawnReason] ?? lead.withdrawnReason})`
          : '';
        return `Withdrawn ${dateLabel(lead.withdrawnAt)}${why}`;
      }
      if (stage === 'accepted' && lead.acceptedAt) {
        return `Accepted ${dateLabel(lead.acceptedAt)}`;
      }
      if (stage === 'qualified' && lead.qualifiedAt) {
        return `Qualified ${dateLabel(lead.qualifiedAt)}`;
      }
      return 'Not yet qualified';
    },
  },
  {
    key: 'created',
    label: 'Created',
    value: (lead) => formatRelativeTime(lead.createdAt),
    cell: (lead, dd) => {
      dd.textContent = '';
      dd.append(timeCell(lead.createdAt, formatRelativeTime(lead.createdAt)));
    },
  },
  {
    key: 'notes',
    label: 'Notes',
    value: (lead) => lead.notes || '—',
    span: true,
  },
];

/** Only what changed, nested the way `Lead` is. */
export function leadPatch(lead: Lead, draft: LeadDraft): LeadPatch {
  const patch: Record<string, unknown> = {};
  if (draft.firstName !== lead.firstName) patch['firstName'] = draft.firstName;
  if (draft.lastName !== lead.lastName) patch['lastName'] = draft.lastName;
  if (draft.status !== lead.status) patch['status'] = draft.status;
  if (draft.source !== lead.source) patch['source'] = draft.source;
  if (draft.serviceType !== lead.serviceType) {
    patch['serviceType'] = draft.serviceType;
  }
  if (draft.notes !== lead.notes) patch['notes'] = draft.notes;

  const contact: Partial<ContactInfo> = {};
  if (draft.email !== lead.contact.email) contact.email = draft.email;
  if (draft.phone !== lead.contact.phone) contact.phone = draft.phone;
  if (draft.preferredContact !== lead.contact.preferredContact) {
    contact.preferredContact = draft.preferredContact;
  }
  if (Object.keys(contact).length > 0) patch['contact'] = contact;

  const current = lead.address ?? { street: '', city: '', state: '', zip: '' };
  const address: Partial<Address> = {};
  for (const key of ['street', 'city', 'state', 'zip'] as const) {
    if (draft[key] !== current[key]) address[key] = draft[key];
  }
  if (Object.keys(address).length > 0) patch['address'] = address;

  const cents = draft.estimatedValueUsd.trim()
    ? Math.round(Number(draft.estimatedValueUsd) * 100)
    : 0;
  if (Number.isFinite(cents) && cents !== (lead.estimatedValue ?? 0)) {
    patch['estimatedValue'] = cents;
  }
  return patch as LeadPatch;
}

function buildLeadForm(lead: Lead): DetailEditForm<LeadDraft> {
  const cleanups: Cleanup[] = [];
  const draft: LeadDraft = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.contact.email,
    phone: lead.contact.phone,
    preferredContact: lead.contact.preferredContact,
    street: lead.address?.street ?? '',
    city: lead.address?.city ?? '',
    state: lead.address?.state ?? '',
    zip: lead.address?.zip ?? '',
    status: lead.status,
    source: lead.source,
    serviceType: lead.serviceType,
    estimatedValueUsd: lead.estimatedValue
      ? String(lead.estimatedValue / 100)
      : '',
    notes: lead.notes,
  };
  const inputs = new Map<
    keyof LeadDraft,
    HTMLInputElement | HTMLSelectElement
  >();

  const text = (label: string, key: TextKey, type = 'text'): HTMLElement => {
    const input = el('input', {
      type,
      'data-bn-input': '',
      'data-testid': `lead-detail-form-${key}`,
      autocomplete: 'off',
      ...(type === 'number' ? { min: '0', step: '0.01' } : {}),
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

  const select = <K extends 'preferredContact' | 'status' | 'source'>(
    label: string,
    key: K,
    values: readonly LeadDraft[K][],
    labels?: Readonly<Record<string, string>>,
  ): HTMLElement => {
    const node = el('select', {
      'data-bn-input': '',
      'data-testid': `lead-detail-form-${key}`,
    }) as HTMLSelectElement;
    for (const value of values) {
      node.append(el('option', { value }, labels?.[value] ?? value));
    }
    node.value = draft[key];
    inputs.set(key, node);
    cleanups.push(
      on(node, 'change', () => {
        draft[key] = node.value as LeadDraft[K];
      }),
    );
    return formField(label, node);
  };

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'lead-detail-form-notes',
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
    text('Email', 'email', 'email'),
    text('Phone', 'phone', 'tel'),
    select('Preferred contact', 'preferredContact', PREFERRED_CONTACTS),
    select('Status', 'status', EDITABLE_STATUSES, STATUS_LABELS),
    select('Source', 'source', LEAD_SOURCES),
    text('Service type', 'serviceType'),
    text('Estimated value (USD)', 'estimatedValueUsd', 'number'),
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
