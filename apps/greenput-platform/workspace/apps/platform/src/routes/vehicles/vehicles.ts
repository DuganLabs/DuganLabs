/**
 * `/vehicles` — fleet directory with status badges and inline status changes.
 *
 * Mirrors [VehiclesComponent](apps/platform/src/app/features/vehicles/vehicles.component.ts).
 */

import { effect, signal, type Signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type {
  ApiResponse,
  Vehicle,
  VehicleStatus,
} from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { statusBadge } from '../shared/badge.js';
import { buildPanel } from '../shared/panel.js';
import { field as formField } from '../shared/field.js';
import { mountPagination, DEFAULT_PER_PAGE } from '../shared/pagination.js';
import type { RouteView } from '../types.js';

type FormState = {
  name: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  vin: string;
  status: VehicleStatus;
  mileage: number;
  notes: string;
};

const STATUS_LABELS: Record<VehicleStatus, string> = {
  active: 'Active',
  maintenance: 'In Maintenance',
  inactive: 'Inactive',
};

function emptyForm(): FormState {
  return {
    name: '',
    make: '',
    model: '',
    year: new Date().getFullYear(),
    licensePlate: '',
    vin: '',
    status: 'active',
    mileage: 0,
    notes: '',
  };
}

export function renderVehiclesRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);

  const showPanel = signal(false);
  const form = signal<FormState>(emptyForm());
  const submitting = signal(false);
  const submitError = signal<string | null>(null);

  const cleanups: Cleanup[] = [];

  const page = signal(1);
  const resource = createResource<ApiResponse<Vehicle[]>>(
    () => deps.vehicles.list({ page: page() }),
    { auto: true },
  );
  const pager = mountPagination({
    page,
    total: () => resource.data()?.meta?.total ?? 0,
    perPage: DEFAULT_PER_PAGE,
    onPage: (next) => page.set(next),
    testId: 'vehicles',
    label: 'Vehicle pages',
    noun: 'vehicles',
    loading: resource.loading,
  });
  cleanups.push(pager.dispose);

  // ── header + new button ────────────────────────────────────────────────
  const newButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'vehicles-new',
    },
    'Add vehicle',
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
      el('h1', {}, 'Vehicles'),
      el('p', {}, 'Trucks and equipment in your fleet, with current status.'),
    ),
    newButton,
  );

  // ── grid ───────────────────────────────────────────────────────────────
  const grid = el('div', { 'data-bn-card-grid': '' });
  const empty = el(
    'p',
    { 'data-bn-empty': '', hidden: true },
    'No vehicles yet. Add one to track its status and mileage.',
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading vehicles…',
  );

  // ── panel ──────────────────────────────────────────────────────────────
  const panel = buildVehiclePanel({
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
        await deps.vehicles.create({
          name: f.name,
          make: f.make,
          model: f.model,
          year: f.year,
          licensePlate: f.licensePlate,
          ...(f.vin ? { vin: f.vin } : {}),
          status: f.status,
          mileage: f.mileage,
          notes: f.notes,
        });
        showPanel.set(false);
        await resource.reload();
      } catch (err) {
        submitError.set(
          err instanceof Error ? err.message : 'Could not save vehicle.',
        );
      } finally {
        submitting.set(false);
      }
    },
    onCancel: () => showPanel.set(false),
  });
  cleanups.push(panel.dispose);

  // ── content slot toggling ──────────────────────────────────────────────
  const content = el('div', {});
  const root = el(
    'section',
    { 'data-bn-list-route': '', 'data-bn-route': 'vehicles' },
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
        content.append(loadingNode, errorNode, empty, grid, pager.element);
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
        errorNode.textContent = `Could not load vehicles: ${err.message}`;

      const hasData = list.length > 0;
      toggle(empty, !isLoading && err === null && !hasData);
      toggle(grid, hasData);
      renderCards(
        grid,
        list,
        async (id, status) => {
          await deps.vehicles.update(id, { status });
          await resource.reload();
        },
        async (id) => {
          await deps.vehicles.delete(id);
          await resource.reload();
        },
      );
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

function renderCards(
  grid: HTMLElement,
  vehicles: Vehicle[],
  onStatus: (id: string, status: VehicleStatus) => Promise<void>,
  onDelete: (id: string) => Promise<void>,
): void {
  clear(grid);
  for (const v of vehicles) {
    const select = el('select', {
      'data-bn-input': '',
      'aria-label': `Status for ${v.name}`,
    }) as HTMLSelectElement;
    for (const status of ['active', 'maintenance', 'inactive'] as const) {
      const opt = el('option', { value: status }, STATUS_LABELS[status]);
      if (status === v.status) opt.setAttribute('selected', '');
      select.append(opt);
    }
    select.value = v.status;
    select.addEventListener('change', () => {
      void onStatus(v.id, select.value as VehicleStatus);
    });

    const deleteBtn = el(
      'button',
      {
        type: 'button',
        'data-bn-button': '',
        'data-bn-variant': 'ghost',
      },
      'Remove',
    );
    deleteBtn.addEventListener('click', () => {
      void onDelete(v.id);
    });

    const card = el(
      'article',
      { 'data-bn-card': '' },
      el(
        'header',
        {},
        el('span', { 'data-bn-vehicle-icon': '', 'aria-hidden': 'true' }, '🚐'),
        el(
          'div',
          {},
          el('h2', {}, v.name),
          el('p', {}, `${v.year} ${v.make} ${v.model}`.trim()),
        ),
        statusBadge(v.status, STATUS_LABELS[v.status]),
      ),
      el(
        'dl',
        { 'data-bn-vehicle-meta': '' },
        el('dt', {}, 'License'),
        el('dd', {}, v.licensePlate || '—'),
        el('dt', {}, 'Mileage'),
        el('dd', {}, `${v.mileage.toLocaleString('en-US')} mi`),
      ),
      el('footer', {}, select, deleteBtn),
    );
    grid.append(card);
  }
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}

function buildVehiclePanel(args: {
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
      'data-testid': `vehicles-form-${field}`,
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
    'data-testid': 'vehicles-form-status',
  }) as HTMLSelectElement;
  for (const value of ['active', 'maintenance', 'inactive'] as const) {
    statusSelect.append(el('option', { value }, STATUS_LABELS[value]));
  }
  inputs.set('status', statusSelect);
  on(statusSelect, 'change', () => {
    args.form.set({
      ...args.form.peek(),
      status: statusSelect.value as VehicleStatus,
    });
  });

  fields.append(
    make('Name', 'name'),
    make('Make', 'make'),
    make('Model', 'model'),
    make('Year', 'year', 'number'),
    make('License plate', 'licensePlate'),
    make('VIN', 'vin'),
    formField('Status', statusSelect),
    make('Mileage', 'mileage', 'number'),
  );

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'vehicles-form-notes',
    placeholder: 'Notes (optional)',
  }) as HTMLTextAreaElement;
  on(notes, 'input', () => {
    args.form.set({ ...args.form.peek(), notes: notes.value });
  });

  const panel = buildPanel({
    title: 'Add vehicle',
    onSubmit: args.onSubmit,
    onCancel: args.onCancel,
    submitting: args.submitting,
    submitError: args.submitError,
    body: [fields, formField('Notes', notes)],
    submitLabel: 'Add vehicle',
    syncForm: () => {
      const f = args.form.peek();
      for (const [key, input] of inputs) {
        const value = f[key];
        input.value = String(value ?? '');
      }
      notes.value = f.notes;
    },
  });
  return { ...panel, inputs };
}
