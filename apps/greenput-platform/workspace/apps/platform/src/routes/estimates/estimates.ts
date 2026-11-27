/**
 * `/estimates` — proposal list with dynamic line-item editor + computed margin.
 *
 * Mirrors [EstimatesComponent](apps/platform/src/app/features/estimates/estimates.component.ts).
 *
 * The create panel includes the "job costing" editor from `./costing.ts` —
 * rows of { type: 'labor'|'material', description, quantity, unitPrice }
 * with subtotal, tax, grand total and estimated margin recomputing as rows
 * change — the same editor `/estimates/:id` mounts to edit (GP-003). The
 * title column links each row to its detail page.
 */

import { effect, signal, type Signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type {
  ApiResponse,
  Estimate,
  EstimateStatus,
  Opportunity,
  Workspace,
} from '@greenput/shared/models';
import {
  proposalShareLink,
  publicSiteOrigin,
  tenantDomainForHostname,
} from '@greenput/shared/utils';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { statusBadge } from '../shared/badge.js';
import {
  actionButton,
  fill,
  mountTable,
  onRowAction,
  timeCell,
  type TableColumn,
} from '../shared/table.js';
import { formatCurrency, formatRelativeTime } from '../../lib/format.js';
import { buildPanel } from '../shared/panel.js';
import { field as formField } from '../shared/field.js';
import {
  mountEntitySelect,
  type EntitySelect,
} from '../shared/entity-select.js';
import { mountPagination, DEFAULT_PER_PAGE } from '../shared/pagination.js';
import { SHARE_LINK_SHEET, mountShareLink } from '../shared/share-link.js';
import type { RouteView } from '../types.js';
import {
  COSTING_SHEET,
  lineItemsFromRows,
  mountCosting,
  type CostingRow,
} from './costing.js';

/** What the share card is headed once an estimate is marked sent. */
export const SHARE_HEADING = 'Proposal link ready to share';

type FormState = {
  title: string;
  /** Required by the API; chosen from a select, never typed (GP-015). */
  opportunityId: string;
  notes: string;
  validUntil: string;
  taxRate: number;
};

export const STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  expired: 'Expired',
};

function emptyForm(): FormState {
  return {
    title: '',
    opportunityId: '',
    notes: '',
    validUntil: '',
    taxRate: 0,
  };
}

export function renderEstimatesRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);
  adoptSheet(COSTING_SHEET);
  adoptSheet(SHARE_LINK_SHEET);

  const showPanel = signal(false);
  const form = signal<FormState>(emptyForm());
  const rows = signal<CostingRow[]>([]);
  const submitting = signal(false);
  const submitError = signal<string | null>(null);

  const cleanups: Cleanup[] = [];

  const page = signal(1);
  const resource = createResource<ApiResponse<Estimate[]>>(
    () => deps.estimates.list({ page: page() }),
    { auto: true },
  );
  const pager = mountPagination({
    page,
    total: () => resource.data()?.meta?.total ?? 0,
    perPage: DEFAULT_PER_PAGE,
    onPage: (next) => page.set(next),
    testId: 'estimates',
    label: 'Estimate pages',
    noun: 'estimates',
    loading: resource.loading,
  });
  cleanups.push(pager.dispose);

  // ── header ─────────────────────────────────────────────────────────────
  const newButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'estimates-new',
    },
    'New estimate',
  );
  cleanups.push(
    on(newButton, 'click', () => {
      form.set(emptyForm());
      rows.set([]);
      submitError.set(null);
      panel.opportunitySelect.set('');
      void panel.opportunitySelect.load();
      showPanel.set(true);
    }),
  );

  const header = el(
    'header',
    {},
    el(
      'div',
      {},
      el('h1', {}, 'Estimates'),
      el(
        'p',
        {},
        'Job-costed proposals — break down labor and materials, see margin live.',
      ),
    ),
    newButton,
  );

  // ── table ──────────────────────────────────────────────────────────────
  const tableWrap = el('div', { 'data-bn-table-wrap': '' });
  // The workspace, for its public site address: "Copy proposal link" on a
  // row marked sent earlier builds the URL from the slug the workspace record
  // carries — never reconstructed (GP-008).
  const workspaceResource = createResource<{ data: Workspace }>(
    () => deps.workspace.get(),
    { auto: true },
  );
  const actionError = signal<string | null>(null);
  const share = mountShareLink({ testId: 'estimates-share' });
  cleanups.push(share.dispose);
  cleanups.push(
    onRowAction(tableWrap, (action, id) => {
      actionError.set(null);
      if (action === 'send') {
        // Marks it sent and hands back the public proposal link. Nothing is
        // sent by anyone but the contractor, and the card says so.
        void deps.estimates
          .send(id)
          .then((res) => {
            if (res.share) share.show(res.share, SHARE_HEADING);
            else share.hide();
            return resource.reload();
          })
          .catch((err: unknown) => {
            actionError.set(
              err instanceof Error ? err.message : 'Could not mark it sent.',
            );
          });
      } else if (action === 'copy-proposal-link') {
        const estimate = (resource.data()?.data ?? []).find((e) => e.id === id);
        const ws = workspaceResource.data()?.data;
        const origin = ws
          ? publicSiteOrigin(
              ws,
              tenantDomainForHostname(window.location.hostname),
            )
          : null;
        if (!estimate || !ws || !origin) {
          actionError.set(
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
      } else if (action === 'accept') {
        void deps.estimates.accept(id).then(() => resource.reload());
      }
    }),
  );
  const actionErrorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
    'data-testid': 'estimates-action-error',
  });
  cleanups.push(
    effect(() => {
      const message = actionError();
      actionErrorNode.textContent = message ?? '';
      if (message) actionErrorNode.removeAttribute('hidden');
      else actionErrorNode.setAttribute('hidden', '');
    }).dispose,
  );
  const empty = el(
    'p',
    { 'data-bn-empty': '', hidden: true },
    'No estimates yet — create one to send a proposal.',
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading estimates…',
  );

  // ── create panel ───────────────────────────────────────────────────────
  const panel = buildEstimatePanel({
    form,
    rows,
    submitting,
    submitError,
    // GP-006: the API caps a page at 100 rows; a contractor with more open
    // deals than that sees the first hundred until paging lands.
    opportunities: () => deps.opportunities.list({ perPage: 100 }),
    onSubmit: async () => {
      const f = form();
      panel.inputs.title.removeAttribute('aria-invalid');
      panel.inputs.opportunityId.removeAttribute('aria-invalid');
      if (!f.title.trim()) {
        submitError.set('Title is required.');
        panel.inputs.title.setAttribute('aria-invalid', 'true');
        panel.inputs.title.focus();
        return;
      }
      // Said here, in the product's words: the client type is
      // `Partial<Estimate>`, so only the API's validator would otherwise
      // notice, with zod's wording.
      if (!f.opportunityId) {
        submitError.set('Choose an opportunity.');
        panel.inputs.opportunityId.setAttribute('aria-invalid', 'true');
        panel.inputs.opportunityId.focus();
        return;
      }
      submitting.set(true);
      submitError.set(null);
      try {
        // The costing rows hold DOLLARS and the wire is cents; the one
        // conversion is `lineItemsFromRows` (./costing.ts).
        const lineItems = lineItemsFromRows(rows());
        // subtotal / taxAmount / total are NOT sent: the API derives them from
        // the line items and the tax rate (and always has — the values sent
        // here were discarded), so there is one place that decides what an
        // estimate adds up to.
        await deps.estimates.create({
          title: f.title,
          opportunityId: f.opportunityId,
          notes: f.notes,
          ...(f.validUntil ? { validUntil: f.validUntil } : {}),
          taxRate: f.taxRate,
          lineItems,
        });
        showPanel.set(false);
        await resource.reload();
      } catch (err) {
        submitError.set(
          err instanceof Error ? err.message : 'Could not save estimate.',
        );
      } finally {
        submitting.set(false);
      }
    },
    onCancel: () => showPanel.set(false),
  });
  cleanups.push(panel.dispose);

  const content = el('div', {});
  const root = el(
    'section',
    { 'data-bn-list-route': '', 'data-bn-route': 'estimates' },
    header,
    content,
  );

  cleanups.push(
    effect(() => {
      const open = showPanel();
      clear(content);
      if (open) {
        content.append(panel.element);
      } else {
        content.append(
          actionErrorNode,
          share.element,
          loadingNode,
          errorNode,
          empty,
          tableWrap,
          pager.element,
        );
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const list = resource.data()?.data ?? [];
      const isLoading = resource.loading();
      const err = resource.error();
      toggle(loadingNode, isLoading && list.length === 0);
      toggle(errorNode, err !== null);
      if (err)
        errorNode.textContent = `Could not load estimates: ${err.message}`;
      const hasData = list.length > 0;
      toggle(empty, !isLoading && err === null && !hasData);
      toggle(tableWrap, hasData);
      mountTable(tableWrap, { columns: COLUMNS, rows: list });
    }).dispose,
  );

  return {
    element: root,
    dispose: () => {
      resource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

const COLUMNS: readonly TableColumn<Estimate>[] = [
  {
    key: 'title',
    label: 'Title',
    value: (e) => e.title,
    href: (e) => `/estimates/${e.id}`,
  },
  {
    key: 'status',
    label: 'Status',
    value: (e) => STATUS_LABELS[e.status],
    cell: (e, td) => fill(td, statusBadge(e.status, STATUS_LABELS[e.status])),
  },
  {
    key: 'total',
    label: 'Total',
    value: (e) => formatCurrency(e.total / 100),
    align: 'end',
  },
  {
    key: 'updated',
    label: 'Updated',
    value: (e) => formatRelativeTime(e.updatedAt),
    cell: (e, td) =>
      fill(td, timeCell(e.updatedAt, formatRelativeTime(e.updatedAt))),
  },
  {
    key: 'actions',
    label: '',
    value: () => '',
    cell: (e, td) => fill(td, estimateActions(e)),
  },
];

function estimateActions(e: Estimate): HTMLElement {
  const actions = el('div', { 'data-bn-row-actions': '' });
  if (e.status === 'draft') {
    actions.append(
      actionButton({
        action: 'send',
        id: e.id,
        // Named for what it does: it used to read "Send" and sent nothing.
        label: 'Mark sent',
        testId: `estimates-send-${e.id}`,
      }),
    );
  }
  if (e.status === 'sent') {
    actions.append(
      actionButton({
        action: 'accept',
        id: e.id,
        label: 'Mark accepted',
        testId: `estimates-accept-${e.id}`,
      }),
    );
  }
  // The public proposal page answers for sent and accepted estimates only
  // (apps/tenant-site), so those are the rows that have a link.
  if (e.status === 'sent' || e.status === 'accepted') {
    actions.append(
      actionButton({
        action: 'copy-proposal-link',
        id: e.id,
        label: 'Copy proposal link',
        variant: 'ghost',
        testId: `estimates-proposal-link-${e.id}`,
      }),
    );
  }
  return actions;
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}

function buildEstimatePanel(args: {
  form: Signal<FormState>;
  rows: Signal<CostingRow[]>;
  submitting: Signal<boolean>;
  submitError: Signal<string | null>;
  /** The opportunity list; fetched each time the panel opens. */
  opportunities: () => Promise<ApiResponse<Opportunity[]>>;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}): {
  element: HTMLElement;
  dispose: Cleanup;
  inputs: { title: HTMLInputElement; opportunityId: HTMLSelectElement };
  opportunitySelect: EntitySelect<Opportunity>;
} {
  const cleanups: Cleanup[] = [];

  const titleInput = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'estimates-form-title',
  }) as HTMLInputElement;
  on(titleInput, 'input', () => {
    args.form.set({ ...args.form.peek(), title: titleInput.value });
  });

  const opportunitySelect = mountEntitySelect<Opportunity>({
    label: 'Opportunity',
    testId: 'estimates-form-opportunityId',
    placeholder: 'Choose an opportunity',
    noun: 'opportunities',
    optionLabel: (opp) => opp.title,
    source: args.opportunities,
    emptyMessage:
      'No opportunities yet — create one on the Opportunities page first.',
    onChange: (opportunityId) => {
      args.form.set({ ...args.form.peek(), opportunityId });
    },
  });
  cleanups.push(opportunitySelect.dispose);

  const validUntilInput = el('input', {
    type: 'date',
    'data-bn-input': '',
    'data-testid': 'estimates-form-validUntil',
  }) as HTMLInputElement;
  on(validUntilInput, 'input', () => {
    args.form.set({ ...args.form.peek(), validUntil: validUntilInput.value });
  });

  const taxInput = el('input', {
    type: 'number',
    step: '0.01',
    'data-bn-input': '',
    'data-testid': 'estimates-form-taxRate',
  }) as HTMLInputElement;
  on(taxInput, 'input', () => {
    args.form.set({
      ...args.form.peek(),
      taxRate: Number(taxInput.value) || 0,
    });
  });

  const fields = el(
    'div',
    { 'data-bn-field-grid': '' },
    formField('Title', titleInput),
    opportunitySelect.element,
    formField('Valid until', validUntilInput),
    formField('Tax rate (%)', taxInput),
  );

  // ── costing rows ───────────────────────────────────────────────────────
  const costing = mountCosting({
    rows: args.rows,
    taxRate: () => args.form().taxRate,
    testId: 'estimates',
  });
  cleanups.push(costing.dispose);

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'estimates-form-notes',
  }) as HTMLTextAreaElement;
  on(notes, 'input', () => {
    args.form.set({ ...args.form.peek(), notes: notes.value });
  });

  // initial sync of form inputs
  function syncForm(): void {
    const f = args.form.peek();
    titleInput.value = f.title;
    opportunitySelect.set(f.opportunityId);
    validUntilInput.value = f.validUntil;
    taxInput.value = String(f.taxRate);
    notes.value = f.notes;
  }

  const wrapped = buildPanel({
    title: 'New estimate',
    onSubmit: args.onSubmit,
    onCancel: args.onCancel,
    submitting: args.submitting,
    submitError: args.submitError,
    body: [fields, costing.element, formField('Notes', notes)],
    submitLabel: 'Create estimate',
    syncForm,
  });

  return {
    element: wrapped.element,
    dispose: () => {
      wrapped.dispose();
      for (const fn of cleanups) fn();
    },
    inputs: { title: titleInput, opportunityId: opportunitySelect.select },
    opportunitySelect,
  };
}
