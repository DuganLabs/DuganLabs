/**
 * `/opportunities` — kanban + list view of the sales pipeline.
 *
 * Mirrors [OpportunitiesComponent](apps/platform/src/app/features/opportunities/opportunities.component.ts).
 *
 * The kanban is @basenative/components renderPipeline: one column per
 * status, cards with the status badge and a Convert action on won deals
 * without a job yet. Moving a card between columns — by drag, by click to
 * pick up then click to place, or by keyboard (Enter, arrows, Enter) —
 * changes its status; the API keeps no per-opportunity position, so the
 * move's `position` is not persisted.
 *
 * Convert to job opens the schedule panel from `./convert.ts` (GP-037) —
 * the one definition `/opportunities/:id` mounts too (GP-003). The title
 * column links each row to its detail page.
 */

import { computed, effect, signal, type Signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type {
  ApiResponse,
  Lead,
  Opportunity,
  OpportunityStatus,
} from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { badgeVariant, statusBadge } from '../shared/badge.js';
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
import type { RouteView } from '../types.js';
import { mountConvertPanel } from './convert.js';

type FormState = {
  title: string;
  /** The lead this deal came from — required; see leadsForNewOpportunity. */
  leadId: string;
  status: OpportunityStatus;
  value: number;
  serviceType: string;
  notes: string;
};

export const STATUS_LABELS: Record<OpportunityStatus, string> = {
  open: 'Open',
  proposal_sent: 'Proposal Sent',
  negotiating: 'Negotiating',
  won: 'Won',
  lost: 'Lost',
};

const COLUMNS: readonly OpportunityStatus[] = [
  'open',
  'proposal_sent',
  'negotiating',
  'won',
  'lost',
];

const KANBAN_COLUMNS = COLUMNS.map((status) => ({
  id: status,
  title: STATUS_LABELS[status],
}));

function emptyForm(): FormState {
  return {
    title: '',
    leadId: '',
    status: 'open',
    value: 0,
    serviceType: '',
    notes: '',
  };
}

/** What a lead is called in the From lead select. */
export function leadLabel(lead: Lead): string {
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  return lead.serviceType ? `${name} · ${lead.serviceType}` : name;
}

/**
 * The leads New opportunity can be built on. Qualified leads first — that
 * is the pipeline step an opportunity follows — but a contractor who never
 * uses Qualify has none, so an empty answer falls back to every lead rather
 * than an empty select. `perPage: 100` is the API's cap (GP-006); a
 * contractor with more leads than that sees the first hundred until paging
 * lands.
 */
export async function leadsForNewOpportunity(
  leads: PlatformDeps['leads'],
): Promise<ApiResponse<Lead[]>> {
  const qualified = await leads.list({ status: 'qualified', perPage: 100 });
  if (qualified.data.length > 0) return qualified;
  return leads.list({ perPage: 100 });
}

export function renderOpportunitiesRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);

  const view = signal<'kanban' | 'list'>('kanban');
  const showPanel = signal(false);
  const showConvert = signal<string | null>(null);
  const form = signal<FormState>(emptyForm());
  const submitting = signal(false);
  const submitError = signal<string | null>(null);

  const cleanups: Cleanup[] = [];

  const page = signal(1);
  const resource = createResource<ApiResponse<Opportunity[]>>(
    () => deps.opportunities.list({ page: page() }),
    { auto: true },
  );
  const pager = mountPagination({
    page,
    total: () => resource.data()?.meta?.total ?? 0,
    perPage: DEFAULT_PER_PAGE,
    onPage: (next) => page.set(next),
    testId: 'opportunities',
    label: 'Opportunity pages',
    noun: 'opportunities',
    loading: resource.loading,
  });
  cleanups.push(pager.dispose);

  const opportunities = computed<Opportunity[]>(
    () => resource.data()?.data ?? [],
  );

  // ── convert-to-job panel ───────────────────────────────────────────────
  // `showConvert` holds the id of the opportunity being converted and is the
  // panel's open state; the panel itself (./convert.ts) posts on submit with
  // an explicit start and end, never on the click alone.
  const convertPanel = mountConvertPanel(deps, {
    onConverted: async (result) => {
      showConvert.set(null);
      if (result.data.jobId) await resource.reload();
    },
    onCancel: () => showConvert.set(null),
  });
  cleanups.push(convertPanel.dispose);

  const convertToJob = (id: string): void => {
    const opp = opportunities().find((o) => o.id === id);
    if (!opp) return;
    convertPanel.open(opp);
    showConvert.set(id);
  };

  /** Column move from the kanban: a status change, applied optimistically. */
  const moveOpportunity = async (id: string, column: string): Promise<void> => {
    const opp = opportunities().find((o) => o.id === id);
    const status = COLUMNS.find((s) => s === column);
    if (!opp || !status || opp.status === status || opp.convertedToJobId) {
      return;
    }
    resource.mutate((current) => ({
      ...(current ?? { data: [] }),
      data: (current?.data ?? []).map((o) =>
        o.id === id ? { ...o, status } : o,
      ),
    }));
    try {
      await deps.opportunities.update(id, { status });
    } catch {
      // The reload below reverts the optimistic move.
    } finally {
      await resource.reload();
    }
  };

  const totalPipeline = computed(() => {
    return opportunities()
      .filter((o) => o.status !== 'lost')
      .reduce((sum, o) => sum + (o.value ?? 0), 0);
  });
  const wonThisMonth = computed(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    return opportunities()
      .filter((o) => o.status === 'won' && new Date(o.updatedAt) >= start)
      .reduce((sum, o) => sum + (o.value ?? 0), 0);
  });

  // ── header + new button ────────────────────────────────────────────────
  const newButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'opportunities-new',
    },
    'New opportunity',
  );
  cleanups.push(
    on(newButton, 'click', () => {
      form.set(emptyForm());
      submitError.set(null);
      panel.leadSelect.set('');
      void panel.leadSelect.load();
      showPanel.set(true);
    }),
  );

  const header = el(
    'header',
    {},
    el(
      'div',
      {},
      el('h1', {}, 'Opportunities'),
      el('p', {}, 'Deals in flight, from proposal sent to closed-won.'),
    ),
    newButton,
  );

  // ── KPI strip ──────────────────────────────────────────────────────────
  const pipelineStat = el(
    'strong',
    { 'data-testid': 'opportunities-pipeline' },
    '$0',
  );
  const wonStat = el('strong', { 'data-testid': 'opportunities-won' }, '$0');
  const stats = el(
    'div',
    { 'data-bn-toolbar': '' },
    el(
      'div',
      { 'data-bn-stat': '' },
      el('span', {}, 'Pipeline value'),
      pipelineStat,
    ),
    el(
      'div',
      { 'data-bn-stat': '' },
      el('span', {}, 'Won this month'),
      wonStat,
    ),
  );
  cleanups.push(
    effect(() => {
      pipelineStat.textContent = formatCurrency(totalPipeline() / 100);
      wonStat.textContent = formatCurrency(wonThisMonth() / 100);
    }).dispose,
  );

  // ── view toggle ────────────────────────────────────────────────────────
  const kanban = el('div', { 'data-bn-kanban': '' });
  cleanups.push(
    onCardAction(kanban, (action, id) => {
      if (action === 'convert') convertToJob(id);
    }),
    // Drag, click-to-pick then click-to-place, and the keyboard path all
    // report through this one handler.
    onCardMove(kanban, ({ cardId, targetColumnId }) => {
      void moveOpportunity(cardId, targetColumnId);
    }),
  );
  const tableWrap = el('div', { 'data-bn-table-wrap': '' });
  cleanups.push(
    onRowAction(tableWrap, (action, id) => {
      if (action === 'convert') convertToJob(id);
    }),
  );
  const tabs = mountTabs({
    id: 'opportunities-view',
    active: view.peek(),
    tabs: [
      {
        id: 'kanban',
        label: 'Kanban',
        testId: 'opportunities-view-kanban',
        content: kanban,
      },
      {
        id: 'list',
        label: 'List',
        testId: 'opportunities-view-list',
        content: tableWrap,
      },
    ],
    onChange: (id) => view.set(id === 'list' ? 'list' : 'kanban'),
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
    'No opportunities yet — convert a qualified lead to get started.',
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading opportunities…',
  );

  // ── create panel ───────────────────────────────────────────────────────
  const panel = buildOpportunityPanel({
    form,
    submitting,
    submitError,
    leads: () => leadsForNewOpportunity(deps.leads),
    onSubmit: async () => {
      const f = form();
      panel.inputs.get('title')?.removeAttribute('aria-invalid');
      panel.leadSelect.select.removeAttribute('aria-invalid');
      if (!f.title.trim()) {
        submitError.set('Title is required.');
        const titleInput = panel.inputs.get('title');
        titleInput?.setAttribute('aria-invalid', 'true');
        titleInput?.focus();
        return;
      }
      // Checked here, in the product's words, because the client type is
      // `Partial<Opportunity>` and only the API's validator would otherwise
      // notice — with zod's wording, about a field the panel never showed.
      if (!f.leadId) {
        submitError.set('Choose a lead.');
        panel.leadSelect.select.setAttribute('aria-invalid', 'true');
        panel.leadSelect.select.focus();
        return;
      }
      submitting.set(true);
      submitError.set(null);
      try {
        await deps.opportunities.create({
          title: f.title,
          leadId: f.leadId,
          status: f.status,
          value: Math.round(f.value * 100),
          serviceType: f.serviceType,
          notes: f.notes,
        });
        showPanel.set(false);
        await resource.reload();
      } catch (err) {
        submitError.set(
          err instanceof Error ? err.message : 'Could not save opportunity.',
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
    { 'data-bn-list-route': '', 'data-bn-route': 'opportunities' },
    header,
    stats,
    content,
  );

  cleanups.push(
    effect(() => {
      const open = showPanel();
      const converting = showConvert();
      clear(content);
      if (converting) {
        content.append(convertPanel.element);
      } else if (open) {
        content.append(panel.element);
      } else {
        content.append(
          loadingNode,
          errorNode,
          empty,
          tabs.element,
          pager.element,
        );
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const list = opportunities();
      const isLoading = resource.loading();
      const err = resource.error();
      toggle(loadingNode, isLoading && list.length === 0);
      toggle(errorNode, err !== null);
      if (err)
        errorNode.textContent = `Could not load opportunities: ${err.message}`;
      const hasData = list.length > 0;
      toggle(empty, !isLoading && err === null && !hasData);
      toggle(kanban, hasData);
      toggle(tableWrap, hasData);
      mountPipeline(kanban, {
        id: 'opportunities-kanban',
        columns: KANBAN_COLUMNS,
        cards: list.map(opportunityCard),
        emptyMessage: 'No deals',
      });
      mountTable(tableWrap, { columns: TABLE_COLUMNS, rows: list });
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

function opportunityCard(opp: Opportunity): PipelineCardDefinition {
  const value = formatCurrency(opp.value / 100);
  return {
    id: opp.id,
    columnId: opp.status,
    title: opp.title,
    subtitle: opp.serviceType ? `${opp.serviceType} · ${value}` : value,
    description: `Updated ${formatRelativeTime(opp.updatedAt)}`,
    status: opp.status,
    badge: STATUS_LABELS[opp.status],
    badgeVariant: badgeVariant(opp.status),
    ...(opp.status === 'won' && !opp.convertedToJobId
      ? {
          actions: [
            {
              action: 'convert',
              label: 'Convert to job',
              testId: `opportunities-convert-${opp.id}`,
            },
          ],
        }
      : {}),
  };
}

const TABLE_COLUMNS: readonly TableColumn<Opportunity>[] = [
  {
    key: 'title',
    label: 'Title',
    value: (opp) => opp.title,
    href: (opp) => `/opportunities/${opp.id}`,
  },
  {
    key: 'status',
    label: 'Status',
    value: (opp) => STATUS_LABELS[opp.status],
    cell: (opp, td) =>
      fill(td, statusBadge(opp.status, STATUS_LABELS[opp.status])),
  },
  {
    key: 'value',
    label: 'Value',
    value: (opp) => formatCurrency(opp.value / 100),
    align: 'end',
  },
  {
    key: 'updated',
    label: 'Last update',
    value: (opp) => formatRelativeTime(opp.updatedAt),
    cell: (opp, td) =>
      fill(td, timeCell(opp.updatedAt, formatRelativeTime(opp.updatedAt))),
  },
  {
    key: 'actions',
    label: '',
    value: () => '',
    cell: (opp, td) =>
      fill(
        td,
        opp.status === 'won' && !opp.convertedToJobId
          ? actionButton({
              action: 'convert',
              id: opp.id,
              label: 'Convert',
              testId: `opportunities-convert-row-${opp.id}`,
            })
          : null,
      ),
  },
];

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}

function buildOpportunityPanel(args: {
  form: Signal<FormState>;
  submitting: Signal<boolean>;
  submitError: Signal<string | null>;
  /** The From lead list; fetched each time the panel opens. */
  leads: () => Promise<ApiResponse<Lead[]>>;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}): {
  element: HTMLElement;
  dispose: Cleanup;
  inputs: Map<keyof FormState, HTMLInputElement | HTMLSelectElement>;
  leadSelect: EntitySelect<Lead>;
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
      'data-testid': `opportunities-form-${field}`,
    }) as HTMLInputElement;
    inputs.set(field, input);
    on(input, 'input', () => {
      const next = type === 'number' ? Number(input.value) : input.value;
      args.form.set({ ...args.form.peek(), [field]: next } as FormState);
    });
    return formField(label, input);
  };

  const statusSelect = el('select', {
    'data-bn-input': '',
    'data-testid': 'opportunities-form-status',
  }) as HTMLSelectElement;
  for (const value of COLUMNS) {
    statusSelect.append(el('option', { value }, STATUS_LABELS[value]));
  }
  inputs.set('status', statusSelect);
  on(statusSelect, 'change', () => {
    args.form.set({
      ...args.form.peek(),
      status: statusSelect.value as OpportunityStatus,
    });
  });

  const leadSelect = mountEntitySelect<Lead>({
    label: 'From lead',
    testId: 'opportunities-form-leadId',
    placeholder: 'Choose a lead',
    noun: 'leads',
    optionLabel: leadLabel,
    source: args.leads,
    emptyMessage: 'No leads yet — add one on the Leads page first.',
    onChange: (leadId) => {
      args.form.set({ ...args.form.peek(), leadId });
    },
  });

  fields.append(
    make('Title', 'title'),
    leadSelect.element,
    formField('Status', statusSelect),
    make('Value (USD)', 'value', 'number'),
    make('Service type', 'serviceType'),
  );

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'opportunities-form-notes',
  }) as HTMLTextAreaElement;
  on(notes, 'input', () => {
    args.form.set({ ...args.form.peek(), notes: notes.value });
  });

  const panel = buildPanel({
    title: 'New opportunity',
    onSubmit: args.onSubmit,
    onCancel: args.onCancel,
    submitting: args.submitting,
    submitError: args.submitError,
    body: [fields, formField('Notes', notes)],
    submitLabel: 'Create opportunity',
    syncForm: () => {
      const f = args.form.peek();
      for (const [key, input] of inputs) {
        input.value = String(f[key] ?? '');
      }
      leadSelect.set(f.leadId);
      notes.value = f.notes;
    },
  });
  return {
    element: panel.element,
    dispose: () => {
      panel.dispose();
      leadSelect.dispose();
    },
    inputs,
    leadSelect,
  };
}
