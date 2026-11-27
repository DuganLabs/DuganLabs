/**
 * `/leads` — kanban + list view of new leads with create + convert.
 *
 * Mirrors [LeadsComponent](apps/platform/src/app/features/leads/leads.component.ts).
 *
 * The kanban is @basenative/components renderPipeline: one column per
 * status, cards with the status badge and a Convert action on qualified
 * leads. Moving a card between columns — by drag, by click to pick up then
 * click to place, or by keyboard (Enter, arrows, Enter) — changes its
 * status; the API keeps no per-lead position, so the move's `position` is
 * not persisted.
 *
 * Billing lifecycle (GP-106): every card and row carries exactly one
 * lifecycle action for the lead's stage — see ./lifecycle.ts, which
 * `/leads/:id` (GP-003) shares. The first column links to that detail
 * route; the row itself carries no click handler, so the link is what a
 * keyboard reaches.
 */

import { computed, effect, signal, type Signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type {
  ApiResponse,
  Lead,
  LeadSource,
  LeadStatus,
} from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import type { LeadListParams } from '../../api/leads.js';
import { adoptSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { badgeVariant, statusBadge } from '../shared/badge.js';
import { field as formField } from '../shared/field.js';
import {
  mountPipeline,
  onCardAction,
  onCardMove,
  type PipelineCardDefinition,
} from '../shared/pipeline.js';
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
import { formatCurrency, formatRelativeTime } from '../../lib/format.js';
import { buildPanel } from '../shared/panel.js';
import { mountPagination, DEFAULT_PER_PAGE } from '../shared/pagination.js';
import type { RouteView } from '../types.js';
import {
  LIFECYCLE_LABELS,
  createLeadLifecycle,
  isLifecycleActionName,
  lifecycleAction,
  lifecycleStage,
} from './lifecycle.js';

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  preferredContact: 'email' | 'phone' | 'text';
  serviceType: string;
  estimatedValue: number;
  source: LeadSource;
  notes: string;
};

const STATUSES: readonly LeadStatus[] = [
  'new',
  'contacted',
  'qualified',
  'unqualified',
  'converted',
];

const SOURCES: readonly LeadSource[] = [
  'website',
  'referral',
  'campaign',
  'manual',
  'google',
  'nextdoor',
  'other',
];

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  unqualified: 'Unqualified',
  converted: 'Converted',
  // 'accepted'/'withdrawn' are billing-lifecycle states. The API never
  // writes them to `status` — it stamps accepted_at / withdrawn_at through
  // POST /:id/accept and /:id/withdraw, which the lifecycle actions below
  // call — so they are deliberately absent from STATUSES/KANBAN_COLUMNS/
  // DRAGGABLE_STATUSES. Present here only so this Record<LeadStatus,_>
  // stays exhaustive.
  accepted: 'Accepted',
  withdrawn: 'Withdrawn',
};

const KANBAN_COLUMNS = STATUSES.map((status) => ({
  id: status,
  title: STATUS_LABELS[status],
}));

/** Statuses a drag can set. Conversion goes through its own endpoint. */
const DRAGGABLE_STATUSES: readonly LeadStatus[] = [
  'new',
  'contacted',
  'qualified',
  'unqualified',
];

function emptyForm(): FormState {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    preferredContact: 'phone',
    serviceType: '',
    estimatedValue: 0,
    source: 'manual',
    notes: '',
  };
}

export function renderLeadsRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);

  const view = signal<'list' | 'kanban'>('list');
  const statusFilter = signal('');
  const sourceFilter = signal('');
  const search = signal('');
  const showPanel = signal(false);
  const form = signal<FormState>(emptyForm());
  const submitting = signal(false);
  const submitError = signal<string | null>(null);

  const cleanups: Cleanup[] = [];

  // The fetcher reads `page()` and the filters, so the resource re-runs by
  // itself when the pager moves; a filter change starts over from page 1.
  const page = signal(1);
  const resource = createResource<ApiResponse<Lead[]>>(
    () => {
      const params: LeadListParams = { page: page() };
      if (statusFilter()) params.status = statusFilter();
      if (sourceFilter()) params.source = sourceFilter();
      if (search()) params.q = search();
      return deps.leads.list(params);
    },
    { auto: true },
  );
  const pager = mountPagination({
    page,
    total: () => resource.data()?.meta?.total ?? 0,
    perPage: DEFAULT_PER_PAGE,
    onPage: (next) => page.set(next),
    testId: 'leads',
    label: 'Lead pages',
    noun: 'leads',
    loading: resource.loading,
  });
  cleanups.push(pager.dispose);

  const leads = computed<Lead[]>(() => resource.data()?.data ?? []);

  const convertLead = async (id: string): Promise<void> => {
    await deps.leads.convert(id);
    await resource.reload();
  };

  // ── billing lifecycle ──────────────────────────────────────────────────
  const notice = el('p', {
    'data-bn-notice': '',
    role: 'status',
    'data-testid': 'leads-notice',
    hidden: true,
  });
  const notify = (message: string): void => {
    notice.textContent = message;
    notice.removeAttribute('hidden');
  };

  const lifecycle = createLeadLifecycle(deps, {
    notify,
    reload: () => resource.reload(),
  });
  cleanups.push(lifecycle.dispose);

  /** One dispatcher for the table's row actions and the kanban's card actions. */
  const runAction = (action: string, id: string): void => {
    if (action === 'convert') {
      void convertLead(id);
      return;
    }
    const lead = leads().find((l) => l.id === id);
    if (!lead || !isLifecycleActionName(action)) return;
    lifecycle.run(action, lead);
  };

  /** Column move from the kanban: a status change, applied optimistically. */
  const moveLead = async (id: string, column: string): Promise<void> => {
    const lead = leads().find((l) => l.id === id);
    const status = DRAGGABLE_STATUSES.find((s) => s === column);
    if (!lead || !status || lead.status === status) return;
    if (!DRAGGABLE_STATUSES.includes(lead.status)) return;
    resource.mutate((current) => ({
      ...(current ?? { data: [] }),
      data: (current?.data ?? []).map((l) =>
        l.id === id ? { ...l, status } : l,
      ),
    }));
    try {
      await deps.leads.update(id, { status });
    } catch {
      // The reload below reverts the optimistic move.
    } finally {
      await resource.reload();
    }
  };

  // ── header + new button ────────────────────────────────────────────────
  const newButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'leads-new',
    },
    'New lead',
  );
  cleanups.push(
    on(newButton, 'click', () => {
      form.set(emptyForm());
      submitError.set(null);
      showPanel.set(true);
    }),
  );

  const header = el(
    'header',
    {},
    el(
      'div',
      {},
      el('h1', {}, 'Leads'),
      el('p', {}, 'Inbound prospects and the funnel they are moving through.'),
    ),
    newButton,
  );

  // ── toolbar (search + status + source + view toggle) ───────────────────
  const searchInput = el('input', {
    type: 'search',
    'data-bn-input': '',
    placeholder: 'Search leads…',
    'data-testid': 'leads-search',
    'aria-label': 'Search leads',
  }) as HTMLInputElement;
  on(searchInput, 'input', () => {
    page.set(1);
    search.set(searchInput.value);
    void resource.reload();
  });

  const statusSelect = el('select', {
    'data-bn-input': '',
    'data-testid': 'leads-status-filter',
    'aria-label': 'Filter by status',
  }) as HTMLSelectElement;
  statusSelect.append(el('option', { value: '' }, 'All statuses'));
  for (const status of STATUSES) {
    statusSelect.append(el('option', { value: status }, STATUS_LABELS[status]));
  }
  on(statusSelect, 'change', () => {
    page.set(1);
    statusFilter.set(statusSelect.value);
    void resource.reload();
  });

  const sourceSelect = el('select', {
    'data-bn-input': '',
    'data-testid': 'leads-source-filter',
    'aria-label': 'Filter by source',
  }) as HTMLSelectElement;
  sourceSelect.append(el('option', { value: '' }, 'All sources'));
  for (const source of SOURCES) {
    sourceSelect.append(
      el(
        'option',
        { value: source },
        source.charAt(0).toUpperCase() + source.slice(1),
      ),
    );
  }
  on(sourceSelect, 'change', () => {
    page.set(1);
    sourceFilter.set(sourceSelect.value);
    void resource.reload();
  });

  const toolbar = el(
    'div',
    { 'data-bn-toolbar': '' },
    el('div', { 'data-bn-search': '' }, searchInput),
    statusSelect,
    sourceSelect,
  );

  // ── content ────────────────────────────────────────────────────────────
  const tableWrap = el('div', { 'data-bn-table-wrap': '' });
  cleanups.push(onRowAction(tableWrap, runAction));

  const kanban = el('div', { 'data-bn-kanban': '' });
  cleanups.push(
    onCardAction(kanban, runAction),
    // Drag, click-to-pick then click-to-place, and the keyboard path all
    // report through this one handler.
    onCardMove(kanban, ({ cardId, targetColumnId }) => {
      void moveLead(cardId, targetColumnId);
    }),
  );

  const tabs = mountTabs({
    id: 'leads-view',
    active: view.peek(),
    tabs: [
      {
        id: 'list',
        label: 'List',
        testId: 'leads-view-list',
        content: tableWrap,
      },
      {
        id: 'kanban',
        label: 'Kanban',
        testId: 'leads-view-kanban',
        content: kanban,
      },
    ],
    onChange: (id) => view.set(id === 'kanban' ? 'kanban' : 'list'),
  });
  cleanups.push(
    tabs.dispose,
    effect(() => {
      tabs.select(view());
    }).dispose,
  );

  const empty = el(
    'p',
    { 'data-bn-empty': '', hidden: true },
    'No leads yet — capture one to get the pipeline moving.',
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading leads…',
  );

  // ── create panel ───────────────────────────────────────────────────────
  const panel = buildLeadPanel({
    form,
    submitting,
    submitError,
    onSubmit: async () => {
      const f = form();
      panel.inputs.get('firstName')?.removeAttribute('aria-invalid');
      panel.inputs.get('lastName')?.removeAttribute('aria-invalid');
      if (!f.firstName.trim() || !f.lastName.trim()) {
        submitError.set('First and last name are required.');
        const invalidKey = !f.firstName.trim() ? 'firstName' : 'lastName';
        const invalidInput = panel.inputs.get(invalidKey);
        invalidInput?.setAttribute('aria-invalid', 'true');
        invalidInput?.focus();
        return;
      }
      submitting.set(true);
      submitError.set(null);
      try {
        await deps.leads.create({
          firstName: f.firstName,
          lastName: f.lastName,
          contact: {
            email: f.email,
            phone: f.phone,
            preferredContact: f.preferredContact,
          },
          serviceType: f.serviceType,
          ...(f.estimatedValue > 0
            ? { estimatedValue: Math.round(f.estimatedValue * 100) }
            : {}),
          source: f.source,
          notes: f.notes,
          status: 'new',
        });
        showPanel.set(false);
        await resource.reload();
      } catch (err) {
        submitError.set(
          err instanceof Error ? err.message : 'Could not create lead.',
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
    { 'data-bn-list-route': '', 'data-bn-route': 'leads' },
    header,
    toolbar,
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
          loadingNode,
          errorNode,
          notice,
          empty,
          tabs.element,
          pager.element,
        );
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const list = leads();
      const isLoading = resource.loading();
      const err = resource.error();
      toggle(loadingNode, isLoading && list.length === 0);
      toggle(errorNode, err !== null);
      if (err) errorNode.textContent = `Could not load leads: ${err.message}`;
      const hasData = list.length > 0;
      toggle(empty, !isLoading && err === null && !hasData);
      toggle(kanban, hasData);
      toggle(tableWrap, hasData);

      mountTable(tableWrap, { columns: COLUMNS, rows: list });
      mountPipeline(kanban, {
        id: 'leads-kanban',
        columns: KANBAN_COLUMNS,
        cards: list.map(leadCard),
        emptyMessage: 'No leads',
      });
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

const COLUMNS: readonly TableColumn<Lead>[] = [
  {
    key: 'lead',
    label: 'Lead',
    value: fullName,
    href: (lead) => `/leads/${lead.id}`,
    cell: (lead, td) =>
      fill(
        td,
        ...twoLines(
          fullName(lead),
          lead.contact.email || lead.contact.phone || '—',
        ),
      ),
  },
  {
    key: 'status',
    label: 'Status',
    value: (lead) => STATUS_LABELS[lead.status],
    cell: (lead, td) => {
      const stage = lifecycleStage(lead);
      fill(
        td,
        statusBadge(lead.status, STATUS_LABELS[lead.status]),
        // The two terminal billing stages are not `status` values the API
        // writes, so they get their own badge beside the pipeline one.
        stage === 'accepted' || stage === 'withdrawn'
          ? statusBadge(stage, LIFECYCLE_LABELS[stage])
          : null,
      );
    },
  },
  { key: 'source', label: 'Source', value: (lead) => lead.source },
  {
    key: 'value',
    label: 'Value',
    value: (lead) =>
      lead.estimatedValue ? formatCurrency(lead.estimatedValue / 100) : '—',
  },
  {
    key: 'created',
    label: 'Created',
    value: (lead) => formatRelativeTime(lead.createdAt),
    cell: (lead, td) =>
      fill(td, timeCell(lead.createdAt, formatRelativeTime(lead.createdAt))),
  },
  {
    key: 'actions',
    label: '',
    value: () => '',
    cell: (lead, td) => {
      const lifecycle = lifecycleAction(lead);
      fill(
        td,
        lead.status === 'qualified'
          ? actionButton({
              action: 'convert',
              id: lead.id,
              label: 'Convert',
              testId: `leads-convert-${lead.id}`,
            })
          : null,
        lifecycle
          ? actionButton({
              action: lifecycle.action,
              id: lead.id,
              label: lifecycle.label,
              testId: `leads-${lifecycle.action}-${lead.id}`,
              variant: lifecycle.variant,
            })
          : null,
      );
    },
  },
];

function fullName(lead: Lead): string {
  return `${lead.firstName} ${lead.lastName}`;
}

function leadCard(lead: Lead): PipelineCardDefinition {
  const lifecycle = lifecycleAction(lead);
  const actions = [
    ...(lead.status === 'qualified'
      ? [
          {
            action: 'convert',
            label: 'Convert',
            testId: `leads-convert-${lead.id}`,
          },
        ]
      : []),
    ...(lifecycle
      ? [
          {
            action: lifecycle.action,
            label: lifecycle.label,
            testId: `leads-${lifecycle.action}-${lead.id}`,
            variant:
              lifecycle.variant === 'danger'
                ? ('destructive' as const)
                : lifecycle.variant,
          },
        ]
      : []),
  ];
  return {
    id: lead.id,
    columnId: lead.status,
    title: fullName(lead),
    subtitle: lead.serviceType || lead.source,
    ...(lead.estimatedValue
      ? { description: formatCurrency(lead.estimatedValue / 100) }
      : {}),
    status: lead.status,
    badge: STATUS_LABELS[lead.status],
    badgeVariant: badgeVariant(lead.status),
    ...(actions.length ? { actions } : {}),
  };
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}

function buildLeadPanel(args: {
  form: Signal<FormState>;
  submitting: Signal<boolean>;
  submitError: Signal<string | null>;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}): {
  element: HTMLElement;
  dispose: Cleanup;
  inputs: Map<keyof FormState, HTMLInputElement | HTMLSelectElement>;
} {
  const fields = el('div', { 'data-bn-field-grid': '' });
  const inputs = new Map<
    keyof FormState,
    HTMLInputElement | HTMLSelectElement
  >();

  const make = (
    label: string,
    field: keyof FormState,
    type = 'text',
  ): HTMLElement => {
    const input = el('input', {
      type,
      'data-bn-input': '',
      'data-testid': `leads-form-${field}`,
    }) as HTMLInputElement;
    inputs.set(field, input);
    on(input, 'input', () => {
      const next = type === 'number' ? Number(input.value) : input.value;
      args.form.set({ ...args.form.peek(), [field]: next } as FormState);
    });
    return formField(label, input);
  };

  const sourceSelect = el('select', {
    'data-bn-input': '',
    'data-testid': 'leads-form-source',
  }) as HTMLSelectElement;
  for (const value of SOURCES) {
    sourceSelect.append(el('option', { value }, value));
  }
  inputs.set('source', sourceSelect);
  on(sourceSelect, 'change', () => {
    args.form.set({
      ...args.form.peek(),
      source: sourceSelect.value as LeadSource,
    });
  });

  const contactSelect = el('select', {
    'data-bn-input': '',
    'data-testid': 'leads-form-preferredContact',
  }) as HTMLSelectElement;
  for (const value of ['phone', 'email', 'text'] as const) {
    contactSelect.append(el('option', { value }, value));
  }
  inputs.set('preferredContact', contactSelect);
  on(contactSelect, 'change', () => {
    args.form.set({
      ...args.form.peek(),
      preferredContact: contactSelect.value as FormState['preferredContact'],
    });
  });

  fields.append(
    make('First name', 'firstName'),
    make('Last name', 'lastName'),
    make('Email', 'email', 'email'),
    make('Phone', 'phone', 'tel'),
    formField('Preferred contact', contactSelect),
    make('Service type', 'serviceType'),
    make('Estimated value (USD)', 'estimatedValue', 'number'),
    formField('Source', sourceSelect),
  );

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'leads-form-notes',
  }) as HTMLTextAreaElement;
  on(notes, 'input', () => {
    args.form.set({ ...args.form.peek(), notes: notes.value });
  });

  const panel = buildPanel({
    title: 'New lead',
    onSubmit: args.onSubmit,
    onCancel: args.onCancel,
    submitting: args.submitting,
    submitError: args.submitError,
    body: [fields, formField('Notes', notes)],
    submitLabel: 'Capture lead',
    syncForm: () => {
      const f = args.form.peek();
      for (const [key, input] of inputs) {
        input.value = String(f[key] ?? '');
      }
      notes.value = f.notes;
    },
  });
  return { ...panel, inputs };
}
