/**
 * `/campaigns` — marketing campaign list with status badges + ROI summary.
 *
 * Mirrors [CampaignsComponent](apps/platform/src/app/features/campaigns/campaigns.component.ts).
 */

import { effect, signal, type Signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type {
  ApiResponse,
  Campaign,
  CampaignChannel,
  CampaignStatus,
} from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { statusBadge } from '../shared/badge.js';
import {
  fill,
  mountTable,
  twoLines,
  type TableColumn,
} from '../shared/table.js';
import { formatCurrency } from '../../lib/format.js';
import { buildPanel } from '../shared/panel.js';
import { field as formField } from '../shared/field.js';
import { mountPagination, DEFAULT_PER_PAGE } from '../shared/pagination.js';
import type { RouteView } from '../types.js';

type FormState = {
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  targetArea: string;
  budget: number;
  startDate: string;
  endDate: string;
  notes: string;
};

const CHANNELS: readonly CampaignChannel[] = [
  'email',
  'sms',
  'postcard',
  'social',
  'google',
];

const STATUSES: readonly CampaignStatus[] = [
  'draft',
  'active',
  'paused',
  'completed',
];

const CHANNEL_LABEL: Record<CampaignChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  postcard: 'Postcard',
  social: 'Social',
  google: 'Google Ads',
};

function emptyForm(): FormState {
  return {
    name: '',
    channel: 'email',
    status: 'draft',
    targetArea: '',
    budget: 0,
    startDate: '',
    endDate: '',
    notes: '',
  };
}

export function renderCampaignsRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);

  const channelFilter = signal('');
  const showPanel = signal(false);
  const form = signal<FormState>(emptyForm());
  const submitting = signal(false);
  const submitError = signal<string | null>(null);

  const cleanups: Cleanup[] = [];

  const page = signal(1);
  const resource = createResource<ApiResponse<Campaign[]>>(
    () =>
      deps.campaigns.list({
        page: page(),
        ...(channelFilter() ? { channel: channelFilter() } : {}),
      }),
    { auto: true },
  );
  const pager = mountPagination({
    page,
    total: () => resource.data()?.meta?.total ?? 0,
    perPage: DEFAULT_PER_PAGE,
    onPage: (next) => page.set(next),
    testId: 'campaigns',
    label: 'Campaign pages',
    noun: 'campaigns',
    loading: resource.loading,
  });
  cleanups.push(pager.dispose);

  const newButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'campaigns-new',
    },
    'New campaign',
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
      el('h1', {}, 'Campaigns'),
      el(
        'p',
        {},
        'Marketing efforts across email, SMS, postcard, and digital channels.',
      ),
    ),
    newButton,
  );

  // Channel filter (segmented control)
  const filterBar = el('div', { 'data-bn-segmented': '', role: 'tablist' });
  function renderFilterButtons(active: string): void {
    clear(filterBar);
    const all = makeFilterButton('All channels', '', active === '', () => {
      page.set(1);
      channelFilter.set('');
      void resource.reload();
    });
    filterBar.append(all);
    for (const ch of CHANNELS) {
      const btn = makeFilterButton(CHANNEL_LABEL[ch], ch, active === ch, () => {
        page.set(1);
        channelFilter.set(ch);
        void resource.reload();
      });
      filterBar.append(btn);
    }
  }
  renderFilterButtons('');
  cleanups.push(
    effect(() => {
      renderFilterButtons(channelFilter());
    }).dispose,
  );

  const tableWrap = el('div', { 'data-bn-table-wrap': '' });
  const empty = el(
    'p',
    { 'data-bn-empty': '', hidden: true },
    'No campaigns yet — start one to track lead attribution.',
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading campaigns…',
  );

  const panel = buildCampaignPanel({
    form,
    submitting,
    submitError,
    onSubmit: async () => {
      const f = form();
      panel.inputs.get('name')?.removeAttribute('aria-invalid');
      if (!f.name.trim()) {
        submitError.set('Name is required.');
        const nameInput = panel.inputs.get('name');
        nameInput?.setAttribute('aria-invalid', 'true');
        nameInput?.focus();
        return;
      }
      submitting.set(true);
      submitError.set(null);
      try {
        await deps.campaigns.create({
          name: f.name,
          channel: f.channel,
          status: f.status,
          ...(f.targetArea ? { targetArea: f.targetArea } : {}),
          ...(f.budget > 0 ? { budget: Math.round(f.budget * 100) } : {}),
          startDate: f.startDate || new Date().toISOString(),
          ...(f.endDate ? { endDate: f.endDate } : {}),
          notes: f.notes,
          leadsGenerated: 0,
        });
        showPanel.set(false);
        await resource.reload();
      } catch (err) {
        submitError.set(
          err instanceof Error ? err.message : 'Could not save campaign.',
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
    { 'data-bn-list-route': '', 'data-bn-route': 'campaigns' },
    header,
    filterBar,
    content,
  );

  cleanups.push(
    effect(() => {
      const open = showPanel();
      clear(content);
      if (open) {
        content.append(panel.element);
      } else {
        content.append(loadingNode, errorNode, empty, tableWrap, pager.element);
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
        errorNode.textContent = `Could not load campaigns: ${err.message}`;
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

function makeFilterButton(
  label: string,
  value: string,
  active: boolean,
  onClick: () => void,
): HTMLElement {
  const btn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-testid': `campaigns-filter-${value || 'all'}`,
      role: 'tab',
      'aria-selected': active ? 'true' : 'false',
    },
    label,
  );
  if (active) btn.setAttribute('data-bn-active', '');
  btn.addEventListener('click', onClick);
  return btn;
}

const COLUMNS: readonly TableColumn<Campaign>[] = [
  {
    key: 'name',
    label: 'Campaign',
    value: (c) => c.name,
    cell: (c, td) => fill(td, ...twoLines(c.name, c.targetArea)),
  },
  {
    key: 'channel',
    label: 'Channel',
    value: (c) => CHANNEL_LABEL[c.channel] ?? c.channel,
  },
  {
    key: 'status',
    label: 'Status',
    value: (c) => c.status,
    cell: (c, td) => fill(td, statusBadge(c.status, c.status)),
  },
  // Two counts, two labels (GP-034): what the contractor typed, and the
  // leads that actually cite the campaign — the number /reports uses.
  {
    key: 'leadsEntered',
    label: 'Leads (entered)',
    value: (c) => String(c.leadsGenerated),
    align: 'end',
  },
  {
    key: 'leadsTracked',
    label: 'Leads (tracked)',
    value: (c) => String(c.leadCount),
    align: 'end',
  },
  { key: 'cpl', label: 'Cost / lead', value: costPerLead },
];

/** Spent over the TRACKED count, so this and /reports divide by one number. */
function costPerLead(c: Campaign): string {
  return c.spent && c.leadCount
    ? `${formatCurrency(c.spent / c.leadCount / 100)}/lead`
    : '—';
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}

function buildCampaignPanel(args: {
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
      'data-testid': `campaigns-form-${field}`,
    }) as HTMLInputElement;
    inputs.set(field, input);
    on(input, 'input', () => {
      const next = type === 'number' ? Number(input.value) : input.value;
      args.form.set({ ...args.form.peek(), [field]: next } as FormState);
    });
    return formField(label, input);
  };

  const channelSelect = el('select', {
    'data-bn-input': '',
    'data-testid': 'campaigns-form-channel',
  }) as HTMLSelectElement;
  for (const value of CHANNELS) {
    channelSelect.append(el('option', { value }, CHANNEL_LABEL[value]));
  }
  inputs.set('channel', channelSelect);
  on(channelSelect, 'change', () => {
    args.form.set({
      ...args.form.peek(),
      channel: channelSelect.value as CampaignChannel,
    });
  });

  const statusSelect = el('select', {
    'data-bn-input': '',
    'data-testid': 'campaigns-form-status',
  }) as HTMLSelectElement;
  for (const value of STATUSES) {
    statusSelect.append(el('option', { value }, value));
  }
  inputs.set('status', statusSelect);
  on(statusSelect, 'change', () => {
    args.form.set({
      ...args.form.peek(),
      status: statusSelect.value as CampaignStatus,
    });
  });

  fields.append(
    make('Name', 'name'),
    formField('Channel', channelSelect),
    formField('Status', statusSelect),
    make('Target area', 'targetArea'),
    make('Budget (USD)', 'budget', 'number'),
    make('Start date', 'startDate', 'date'),
    make('End date', 'endDate', 'date'),
  );

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'campaigns-form-notes',
  }) as HTMLTextAreaElement;
  on(notes, 'input', () => {
    args.form.set({ ...args.form.peek(), notes: notes.value });
  });

  const panel = buildPanel({
    title: 'New campaign',
    onSubmit: args.onSubmit,
    onCancel: args.onCancel,
    submitting: args.submitting,
    submitError: args.submitError,
    body: [fields, formField('Notes', notes)],
    submitLabel: 'Create campaign',
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
