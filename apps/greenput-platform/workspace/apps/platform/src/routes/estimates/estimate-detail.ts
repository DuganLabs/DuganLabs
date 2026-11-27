/**
 * `/estimates/:id` — one proposal: its fields, the line items with their
 * labor / materials split (GP-038), an edit form with the costing editor,
 * delete, Mark sent / Mark accepted, and the proposal link (GP-003, GP-008).
 *
 * The frame is `routes/shared/detail.ts`; this file is what an estimate is.
 * Edits go through `deps.estimates.update(id, patch)` with only the fields
 * that changed: title, notes, validUntil (ISO, `null` to clear), taxRate,
 * and the whole `lineItems` list in cents (`lineItemsFromRows`, the one
 * conversion). Subtotal, tax and total are never sent — the API derives
 * them, so there is one place that decides what an estimate adds up to.
 *
 * Nothing here sends anything. "Mark sent" flips the status and shows the
 * share card with the link for the contractor to pass on themselves; a
 * status that says sent must mean the contractor sent it.
 */

import { computed, signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type {
  Estimate,
  EstimateLineItem,
  Workspace,
} from '@greenput/shared/models';
import {
  proposalShareLink,
  publicSiteOrigin,
  tenantDomainForHostname,
} from '@greenput/shared/utils';
import type { PlatformDeps } from '../../deps.js';
import type { EstimatePatch } from '../../api/estimates.js';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { el, on, type Cleanup } from '../../lib/dom.js';
import { formatCurrency } from '../../lib/format.js';
import { statusBadge } from '../shared/badge.js';
import {
  canDeleteRecords,
  mountDetail,
  type DetailEditForm,
  type DetailField,
} from '../shared/detail.js';
import { field as formField } from '../shared/field.js';
import { SHARE_LINK_SHEET, mountShareLink } from '../shared/share-link.js';
import { mountTable, type TableColumn } from '../shared/table.js';
import type { RouteView } from '../types.js';
import {
  COSTING_SHEET,
  lineItemSplit,
  lineItemsFromRows,
  mountCosting,
  rowsFromLineItems,
  type CostingRow,
} from './costing.js';
import { SHARE_HEADING, STATUS_LABELS } from './estimates.js';

const ESTIMATE_DETAIL_SHEET = defineSheet(`
[data-bn-line-item-split] {
  margin: 0;
  display: grid;
  grid-template-columns: max-content auto;
  gap: var(--gp-space-1) var(--gp-space-4);
  justify-content: end;
  font-size: var(--gp-text-sm);
}
[data-bn-line-item-split] dt { color: var(--gp-text-muted); }
[data-bn-line-item-split] dd {
  margin: 0;
  text-align: end;
  font-variant-numeric: tabular-nums;
  color: var(--gp-text-strong);
}
`);

export interface EstimateDraft {
  title: string;
  /** `YYYY-MM-DD`; ISO on the wire, `null` to clear. */
  validUntil: string;
  /** A percentage, as typed. */
  taxRate: string;
  notes: string;
  rows: CostingRow[];
}

export function renderEstimateDetailRoute(
  deps: PlatformDeps,
  params: { id: string },
): RouteView {
  const { id } = params;
  adoptSheet(COSTING_SHEET);
  adoptSheet(SHARE_LINK_SHEET);
  adoptSheet(ESTIMATE_DETAIL_SHEET);
  const cleanups: Cleanup[] = [];

  const resource = createResource<{ data: Estimate }>(
    () => deps.estimates.get(id),
    { auto: true },
  );
  const row = computed<Estimate | undefined>(() => resource.data()?.data);
  // The workspace, for its public site address: "Copy proposal link" on an
  // estimate marked sent earlier builds the URL from the slug the workspace
  // record carries — never reconstructed (GP-008).
  const workspaceResource = createResource<{ data: Workspace }>(
    () => deps.workspace.get(),
    { auto: true },
  );

  const share = mountShareLink({ testId: 'estimate-detail-share' });
  cleanups.push(share.dispose);

  const markSent = async (estimate: Estimate): Promise<void> => {
    try {
      const res = await deps.estimates.send(estimate.id);
      if (res.share) share.show(res.share, SHARE_HEADING);
      else share.hide();
      detail.notify('Marked sent. Nothing was sent for you — share the link.');
    } catch (err) {
      detail.notify(
        err instanceof Error ? err.message : 'Could not mark it sent.',
      );
    }
    await resource.reload();
  };

  const markAccepted = async (estimate: Estimate): Promise<void> => {
    try {
      await deps.estimates.accept(estimate.id);
      detail.notify('Marked accepted.');
    } catch (err) {
      detail.notify(
        err instanceof Error ? err.message : 'Could not mark it accepted.',
      );
    }
    await resource.reload();
  };

  const copyProposalLink = (estimate: Estimate): void => {
    const ws = workspaceResource.data()?.data;
    const origin = ws
      ? publicSiteOrigin(ws, tenantDomainForHostname(window.location.hostname))
      : null;
    if (!ws || !origin) {
      detail.notify(
        'This workspace has no site address yet, so there is no public proposal link.',
      );
      return;
    }
    share.show(
      proposalShareLink(origin, estimate.id, {
        businessName: ws.name,
        title: estimate.title,
      }),
      SHARE_HEADING,
    );
  };

  const action = (
    label: string,
    testId: string,
    variant: 'primary' | 'secondary' | 'ghost',
    run: () => void,
  ): HTMLElement => {
    const button = el(
      'button',
      {
        type: 'button',
        'data-bn-button': '',
        'data-bn-variant': variant,
        'data-testid': testId,
      },
      label,
    );
    cleanups.push(on(button, 'click', run));
    return button;
  };

  const detail = mountDetail<Estimate, EstimateDraft>({
    id: 'estimate-detail',
    noun: 'estimate',
    back: { href: '/estimates', label: 'Estimates' },
    row,
    loading: resource.loading,
    error: resource.error,
    heading: (e) => e.title,
    subheading: (e) => e.estimateNumber,
    fields: FIELDS,
    buildEditForm: buildEstimateForm,
    onSave: async (estimate, draft) => {
      const patch = estimatePatch(estimate, draft);
      if (Object.keys(patch).length > 0) {
        await deps.estimates.update(id, patch);
      }
      await resource.reload();
    },
    canDelete: () => canDeleteRecords(deps.auth.user()?.role),
    deleteDescription: (e) =>
      `${e.estimateNumber} ${e.title} is removed. Only a draft can be deleted. This cannot be undone.`,
    onDelete: async () => {
      await deps.estimates.delete(id);
      void deps.router.navigate('/estimates');
    },
    actions: (estimate) => {
      const nodes: Node[] = [];
      if (estimate.status === 'draft') {
        nodes.push(
          // Named for what it does: it marks, and hands back a link.
          action(
            'Mark sent',
            'estimate-detail-send',
            'primary',
            () => void markSent(estimate),
          ),
        );
      }
      if (estimate.status === 'sent') {
        nodes.push(
          action(
            'Mark accepted',
            'estimate-detail-accept',
            'primary',
            () => void markAccepted(estimate),
          ),
        );
      }
      // The public proposal page answers for sent and accepted estimates
      // only (apps/tenant-site), so those are the ones that have a link.
      if (estimate.status === 'sent' || estimate.status === 'accepted') {
        nodes.push(
          action(
            'Copy proposal link',
            'estimate-detail-proposal-link',
            'secondary',
            () => copyProposalLink(estimate),
          ),
        );
      }
      return nodes;
    },
    sections: (estimate) => [share.element, lineItems(estimate)],
  });

  return {
    element: detail.element,
    dispose: () => {
      detail.dispose();
      resource.dispose();
      workspaceResource.dispose();
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

const cents = (value: number): string =>
  formatCurrency(value / 100, { cents: true });

const FIELDS: readonly DetailField<Estimate>[] = [
  {
    key: 'status',
    label: 'Status',
    value: (e) => STATUS_LABELS[e.status],
    cell: (e, dd) => {
      dd.textContent = '';
      dd.append(statusBadge(e.status, STATUS_LABELS[e.status]));
    },
  },
  { key: 'total', label: 'Total', value: (e) => cents(e.total) },
  { key: 'subtotal', label: 'Subtotal', value: (e) => cents(e.subtotal) },
  {
    key: 'tax',
    label: 'Tax',
    value: (e) => `${cents(e.taxAmount)} (${e.taxRate}%)`,
  },
  {
    key: 'validUntil',
    label: 'Valid until',
    value: (e) => (e.validUntil ? dateLabel(e.validUntil) : '—'),
  },
  {
    key: 'sent',
    label: 'Sent',
    value: (e) => (e.sentAt ? dateLabel(e.sentAt) : 'Not marked sent'),
  },
  {
    key: 'accepted',
    label: 'Accepted',
    value: (e) => (e.acceptedAt ? dateLabel(e.acceptedAt) : '—'),
  },
  {
    key: 'opportunity',
    label: 'Opportunity',
    value: () => 'Open opportunity',
    cell: (e, dd) => {
      dd.textContent = '';
      dd.append(
        el(
          'a',
          { href: `/opportunities/${e.opportunityId}` },
          'Open opportunity',
        ),
      );
    },
  },
  {
    key: 'customer',
    label: 'Customer',
    value: (e) => (e.customerId ? 'Open customer' : '—'),
    cell: (e, dd) => {
      if (!e.customerId) return;
      dd.textContent = '';
      dd.append(
        el('a', { href: `/customers/${e.customerId}` }, 'Open customer'),
      );
    },
  },
  { key: 'notes', label: 'Notes', value: (e) => e.notes || '—', span: true },
];

const LINE_ITEM_COLUMNS: readonly TableColumn<EstimateLineItem>[] = [
  {
    key: 'type',
    label: 'Type',
    value: (li) => (li.type === 'material' ? 'Material' : 'Labor'),
  },
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
    value: (li) => cents(li.unitPrice),
    align: 'end',
  },
  {
    key: 'total',
    label: 'Total',
    value: (li) => cents(li.total),
    align: 'end',
  },
];

/** The line items as the API holds them, and their labor / materials split. */
function lineItems(estimate: Estimate): HTMLElement {
  const host = el('div', {
    'data-bn-table-wrap': '',
    'data-testid': 'estimate-detail-line-items',
  });
  mountTable(host, {
    columns: LINE_ITEM_COLUMNS,
    rows: estimate.lineItems,
    caption: 'Line items',
    emptyMessage: 'No line items yet — Edit to add labor and materials.',
  });
  const split = lineItemSplit(estimate.lineItems);
  return el(
    'section',
    {
      'data-bn-detail-section': '',
      'aria-labelledby': 'estimate-detail-line-items-heading',
    },
    el('h2', { id: 'estimate-detail-line-items-heading' }, 'Line items'),
    host,
    el(
      'dl',
      { 'data-bn-line-item-split': '' },
      el('dt', {}, 'Labor'),
      el('dd', { 'data-testid': 'estimate-detail-labor' }, cents(split.labor)),
      el('dt', {}, 'Materials'),
      el(
        'dd',
        { 'data-testid': 'estimate-detail-materials' },
        cents(split.materials),
      ),
    ),
  );
}

/** `YYYY-MM-DD` for the date input, from the wire's ISO. */
function dateInputValue(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** Only what changed; line items compared by what would be sent. */
export function estimatePatch(
  estimate: Estimate,
  draft: EstimateDraft,
): EstimatePatch {
  const patch: Record<string, unknown> = {};
  if (draft.title !== estimate.title) patch['title'] = draft.title;
  if (draft.notes !== estimate.notes) patch['notes'] = draft.notes;

  const rate = draft.taxRate.trim() === '' ? 0 : Number(draft.taxRate);
  if (Number.isFinite(rate) && rate !== estimate.taxRate) {
    patch['taxRate'] = rate;
  }

  if (draft.validUntil !== dateInputValue(estimate.validUntil)) {
    patch['validUntil'] = draft.validUntil
      ? new Date(`${draft.validUntil}T00:00:00`).toISOString()
      : null;
  }

  const items = lineItemsFromRows(draft.rows);
  const before = estimate.lineItems.map(comparable);
  const after = items.map(comparable);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    patch['lineItems'] = items;
  }
  return patch as EstimatePatch;
}

/** What an edit can change about a line item — `id` and `total` are the API's. */
function comparable(li: EstimateLineItem): unknown[] {
  return [li.type, li.description, li.quantity, li.unitPrice];
}

function buildEstimateForm(estimate: Estimate): DetailEditForm<EstimateDraft> {
  const cleanups: Cleanup[] = [];
  const rows = signal<CostingRow[]>(rowsFromLineItems(estimate.lineItems));
  const taxRate = signal(String(estimate.taxRate));
  const draft = {
    title: estimate.title,
    validUntil: dateInputValue(estimate.validUntil),
    notes: estimate.notes,
  };

  const titleInput = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'estimate-detail-form-title',
    autocomplete: 'off',
  }) as HTMLInputElement;
  titleInput.value = draft.title;
  cleanups.push(
    on(titleInput, 'input', () => {
      draft.title = titleInput.value;
      titleInput.removeAttribute('aria-invalid');
    }),
  );

  const validUntilInput = el('input', {
    type: 'date',
    'data-bn-input': '',
    'data-testid': 'estimate-detail-form-validUntil',
  }) as HTMLInputElement;
  validUntilInput.value = draft.validUntil;
  cleanups.push(
    on(validUntilInput, 'input', () => {
      draft.validUntil = validUntilInput.value;
    }),
  );

  const taxInput = el('input', {
    type: 'number',
    step: '0.01',
    min: '0',
    max: '100',
    'data-bn-input': '',
    'data-testid': 'estimate-detail-form-taxRate',
  }) as HTMLInputElement;
  taxInput.value = taxRate.peek();
  cleanups.push(
    on(taxInput, 'input', () => {
      taxRate.set(taxInput.value);
    }),
  );

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'estimate-detail-form-notes',
  }) as HTMLTextAreaElement;
  notes.value = draft.notes;
  cleanups.push(
    on(notes, 'input', () => {
      draft.notes = notes.value;
    }),
  );

  const costing = mountCosting({
    rows,
    taxRate: () => Number(taxRate()) || 0,
    testId: 'estimate-detail',
  });
  cleanups.push(costing.dispose);

  const grid = el(
    'div',
    { 'data-bn-field-grid': '' },
    formField('Title', titleInput),
    formField('Valid until', validUntilInput),
    formField('Tax rate (%)', taxInput),
  );

  return {
    element: el('div', {}, grid, costing.element, formField('Notes', notes)),
    read: () => {
      if (!draft.title.trim()) {
        titleInput.setAttribute('aria-invalid', 'true');
        titleInput.focus();
        throw new Error('Title is required.');
      }
      return { ...draft, taxRate: taxRate.peek(), rows: rows.peek() };
    },
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}
