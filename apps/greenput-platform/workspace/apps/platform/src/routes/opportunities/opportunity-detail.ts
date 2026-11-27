/**
 * `/opportunities/:id` — one deal: its fields, an edit form, delete, and
 * the same Convert the kanban card and list row carry (GP-003).
 *
 * The frame is `routes/shared/detail.ts`; this file is what an opportunity
 * is. Edits go through `deps.opportunities.update(id, patch)` with only the
 * fields that changed — `value` in cents (§5.0.1) from the dollars typed.
 * Convert mounts the one convert panel (`./convert.ts`) under the fields;
 * a `409 SLOT_TAKEN` keeps it open with the API's message.
 *
 * Delete asks first and then says what the API said: a deal with a job
 * (`jobs.opportunity_id ON DELETE RESTRICT`) is refused by the database,
 * and the refusal's message is the one the dialog shows.
 */

import { computed } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import {
  OPPORTUNITY_STATUSES,
  type Opportunity,
  type OpportunityStatus,
} from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
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
import { mountConvertPanel } from './convert.js';
import { STATUS_LABELS } from './opportunities.js';

export interface OpportunityDraft {
  title: string;
  status: OpportunityStatus;
  /** Whole dollars as typed; converted to cents on save (§5.0.1). */
  valueUsd: string;
  serviceType: string;
  notes: string;
}

type TextKey = Exclude<keyof OpportunityDraft, 'status'>;

export function renderOpportunityDetailRoute(
  deps: PlatformDeps,
  params: { id: string },
): RouteView {
  const { id } = params;
  const cleanups: Cleanup[] = [];

  const resource = createResource<{ data: Opportunity }>(
    () => deps.opportunities.get(id),
    { auto: true },
  );
  const row = computed<Opportunity | undefined>(() => resource.data()?.data);

  // ── convert ────────────────────────────────────────────────────────────
  // Mounted once under the fields and shown on demand; the frame hides
  // every section while Edit is open, so the two never overlap.
  const convertHost = el('div', {
    'data-bn-detail-section': '',
    'data-testid': 'opportunity-detail-convert-panel',
    hidden: true,
  });
  const convertPanel = mountConvertPanel(deps, {
    onConverted: async (result, opp) => {
      toggle(convertHost, false);
      detail.notify(`Converted ${opp.title} to job ${result.data.jobNumber}.`);
      await resource.reload();
    },
    onCancel: () => toggle(convertHost, false),
  });
  convertHost.append(convertPanel.element);
  cleanups.push(convertPanel.dispose);

  const detail = mountDetail<Opportunity, OpportunityDraft>({
    id: 'opportunity-detail',
    noun: 'opportunity',
    back: { href: '/opportunities', label: 'Opportunities' },
    row,
    loading: resource.loading,
    error: resource.error,
    heading: (opp) => opp.title,
    subheading: (opp) => opp.serviceType,
    fields: FIELDS,
    buildEditForm: buildOpportunityForm,
    onSave: async (opp, draft) => {
      const patch = opportunityPatch(opp, draft);
      if (Object.keys(patch).length > 0) {
        await deps.opportunities.update(id, patch);
      }
      await resource.reload();
    },
    canDelete: () => canDeleteRecords(deps.auth.user()?.role),
    deleteDescription: (opp) =>
      `${opp.title} is removed from the pipeline. A deal that already has a job cannot be deleted. This cannot be undone.`,
    onDelete: async () => {
      await deps.opportunities.delete(id);
      void deps.router.navigate('/opportunities');
    },
    actions: (opp) => {
      if (opp.status !== 'won' || opp.convertedToJobId) return [];
      const button = el(
        'button',
        {
          type: 'button',
          'data-bn-button': '',
          'data-bn-variant': 'primary',
          'data-testid': 'opportunity-detail-convert',
        },
        'Convert to job',
      );
      cleanups.push(
        on(button, 'click', () => {
          convertPanel.open(opp);
          toggle(convertHost, true);
          convertHost
            .querySelector<HTMLElement>('input, select, textarea')
            ?.focus();
        }),
      );
      return [button];
    },
    sections: () => [convertHost],
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

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) node.removeAttribute('hidden');
  else node.setAttribute('hidden', '');
}

const FIELDS: readonly DetailField<Opportunity>[] = [
  {
    key: 'status',
    label: 'Status',
    value: (opp) => STATUS_LABELS[opp.status],
    cell: (opp, dd) => {
      dd.textContent = '';
      dd.append(statusBadge(opp.status, STATUS_LABELS[opp.status]));
    },
  },
  {
    key: 'value',
    label: 'Value',
    value: (opp) => formatCurrency(opp.value / 100, { cents: true }),
  },
  {
    key: 'serviceType',
    label: 'Service type',
    value: (opp) => opp.serviceType || '—',
  },
  {
    key: 'lead',
    label: 'Lead',
    value: () => 'Open lead',
    cell: (opp, dd) => {
      dd.textContent = '';
      dd.append(el('a', { href: `/leads/${opp.leadId}` }, 'Open lead'));
    },
  },
  {
    key: 'customer',
    label: 'Customer',
    value: (opp) => (opp.customerId ? 'Open customer' : '—'),
    cell: (opp, dd) => {
      if (!opp.customerId) return;
      dd.textContent = '';
      dd.append(
        el('a', { href: `/customers/${opp.customerId}` }, 'Open customer'),
      );
    },
  },
  {
    key: 'job',
    label: 'Job',
    value: (opp) => (opp.convertedToJobId ? 'Open job' : 'Not yet converted'),
    cell: (opp, dd) => {
      if (!opp.convertedToJobId) return;
      dd.textContent = '';
      dd.append(el('a', { href: `/jobs/${opp.convertedToJobId}` }, 'Open job'));
    },
  },
  {
    key: 'proposal',
    label: 'Proposal',
    value: (opp) =>
      opp.proposalSentAt ? `Sent ${dateLabel(opp.proposalSentAt)}` : 'Not sent',
  },
  {
    key: 'closed',
    label: 'Closed',
    value: (opp) => (opp.closedAt ? dateLabel(opp.closedAt) : 'Open'),
  },
  {
    key: 'updated',
    label: 'Last update',
    value: (opp) => formatRelativeTime(opp.updatedAt),
    cell: (opp, dd) => {
      dd.textContent = '';
      dd.append(timeCell(opp.updatedAt, formatRelativeTime(opp.updatedAt)));
    },
  },
  {
    key: 'notes',
    label: 'Notes',
    value: (opp) => opp.notes || '—',
    span: true,
  },
];

/** Only what changed, with the value in cents. */
export function opportunityPatch(
  opp: Opportunity,
  draft: OpportunityDraft,
): Partial<Opportunity> {
  const patch: Partial<Opportunity> = {};
  if (draft.title !== opp.title) patch.title = draft.title;
  if (draft.status !== opp.status) patch.status = draft.status;
  if (draft.serviceType !== opp.serviceType) {
    patch.serviceType = draft.serviceType;
  }
  if (draft.notes !== opp.notes) patch.notes = draft.notes;
  const cents = draft.valueUsd.trim()
    ? Math.round(Number(draft.valueUsd) * 100)
    : 0;
  if (Number.isFinite(cents) && cents !== opp.value) patch.value = cents;
  return patch;
}

function buildOpportunityForm(
  opp: Opportunity,
): DetailEditForm<OpportunityDraft> {
  const cleanups: Cleanup[] = [];
  const draft: OpportunityDraft = {
    title: opp.title,
    status: opp.status,
    valueUsd: opp.value ? String(opp.value / 100) : '',
    serviceType: opp.serviceType,
    notes: opp.notes,
  };
  const inputs = new Map<keyof OpportunityDraft, HTMLInputElement>();

  const text = (label: string, key: TextKey, type = 'text'): HTMLElement => {
    const input = el('input', {
      type,
      'data-bn-input': '',
      'data-testid': `opportunity-detail-form-${key}`,
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

  const status = el('select', {
    'data-bn-input': '',
    'data-testid': 'opportunity-detail-form-status',
  }) as HTMLSelectElement;
  for (const value of OPPORTUNITY_STATUSES) {
    status.append(el('option', { value }, STATUS_LABELS[value]));
  }
  status.value = draft.status;
  cleanups.push(
    on(status, 'change', () => {
      draft.status = status.value as OpportunityStatus;
    }),
  );

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'opportunity-detail-form-notes',
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
    text('Value (USD)', 'valueUsd', 'number'),
    text('Service type', 'serviceType'),
  );

  return {
    element: el('div', {}, grid, formField('Notes', notes)),
    read: () => {
      if (!draft.title.trim()) {
        const input = inputs.get('title');
        input?.setAttribute('aria-invalid', 'true');
        input?.focus();
        throw new Error('Title is required.');
      }
      return { ...draft };
    },
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}
