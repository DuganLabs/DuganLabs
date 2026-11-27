/**
 * `/inventory` — items table with low-stock badge + transactions modal.
 *
 * Mirrors [InventoryComponent](apps/platform/src/app/features/inventory/inventory.component.ts).
 */

import { effect, signal, type Signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type {
  ApiResponse,
  InventoryItem,
  InventoryTransactionType,
} from '@greenput/shared/models';
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
  twoLines,
  type TableColumn,
} from '../shared/table.js';
import { formatCurrency } from '../../lib/format.js';
import { buildPanel, buildPanelForm } from '../shared/panel.js';
import { field as formField } from '../shared/field.js';
import { mountDialog, type DialogMount } from '../shared/dialog.js';
import { mountPagination, DEFAULT_PER_PAGE } from '../shared/pagination.js';
import type { RouteView } from '../types.js';

type CreateForm = {
  name: string;
  sku: string;
  description: string;
  category: string;
  quantity: number;
  minQuantity: number;
  unitCost: number;
  unitPrice: number;
  supplier: string;
  location: string;
};

type AdjustForm = {
  type: InventoryTransactionType;
  quantity: number;
  notes: string;
};

const ADJUST_TYPES: readonly {
  value: InventoryTransactionType;
  label: string;
}[] = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'usage', label: 'Usage' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'return', label: 'Return' },
];

function emptyCreateForm(): CreateForm {
  return {
    name: '',
    sku: '',
    description: '',
    category: 'general',
    quantity: 0,
    minQuantity: 0,
    unitCost: 0,
    unitPrice: 0,
    supplier: '',
    location: '',
  };
}

function emptyAdjustForm(): AdjustForm {
  return { type: 'purchase', quantity: 1, notes: '' };
}

export function renderInventoryRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);

  const search = signal('');
  const showLowOnly = signal(false);
  const showCreate = signal(false);
  const adjustingItem = signal<InventoryItem | null>(null);
  const createForm = signal<CreateForm>(emptyCreateForm());
  const adjustForm = signal<AdjustForm>(emptyAdjustForm());
  const submitting = signal(false);
  const submitError = signal<string | null>(null);

  const cleanups: Cleanup[] = [];

  const page = signal(1);
  const resource = createResource<ApiResponse<InventoryItem[]>>(
    () => {
      const params: { page: number; q?: string; lowStock?: boolean } = {
        page: page(),
      };
      if (search()) params.q = search();
      if (showLowOnly()) params.lowStock = true;
      return deps.inventory.list(params);
    },
    { auto: true },
  );
  const pager = mountPagination({
    page,
    total: () => resource.data()?.meta?.total ?? 0,
    perPage: DEFAULT_PER_PAGE,
    onPage: (next) => page.set(next),
    testId: 'inventory',
    label: 'Inventory pages',
    noun: 'items',
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
      'data-testid': 'inventory-new',
    },
    'Add item',
  );
  cleanups.push(
    on(newButton, 'click', () => {
      createForm.set(emptyCreateForm());
      submitError.set(null);
      showCreate.set(true);
    }),
  );

  const header = el(
    'header',
    {},
    el(
      'div',
      {},
      el('h1', {}, 'Inventory'),
      el(
        'p',
        {},
        'Parts and materials with stock levels and transaction history.',
      ),
    ),
    newButton,
  );

  // ── toolbar ────────────────────────────────────────────────────────────
  const searchInput = el('input', {
    type: 'search',
    'data-bn-input': '',
    placeholder: 'Search by name or SKU…',
    'data-testid': 'inventory-search',
    'aria-label': 'Search inventory',
  }) as HTMLInputElement;
  on(searchInput, 'input', () => {
    page.set(1);
    search.set(searchInput.value);
    void resource.reload();
  });

  const lowToggle = el(
    'label',
    { 'data-bn-checkbox': '' },
    el('input', {
      type: 'checkbox',
      'data-testid': 'inventory-low-only',
    }),
    el('span', {}, 'Low stock only'),
  );
  const lowCheckbox = lowToggle.querySelector('input') as HTMLInputElement;
  on(lowCheckbox, 'change', () => {
    page.set(1);
    showLowOnly.set(lowCheckbox.checked);
    void resource.reload();
  });

  const toolbar = el(
    'div',
    { 'data-bn-toolbar': '' },
    el('div', { 'data-bn-search': '' }, searchInput),
    lowToggle,
  );

  // ── table ──────────────────────────────────────────────────────────────
  const tableWrap = el('div', { 'data-bn-table-wrap': '' });
  cleanups.push(
    onRowAction(tableWrap, (action, id) => {
      if (action !== 'adjust') return;
      const item = (resource.data()?.data ?? []).find((i) => i.id === id);
      if (item) adjustingItem.set(item);
    }),
  );
  const empty = el(
    'p',
    { 'data-bn-empty': '', hidden: true },
    'No inventory yet — add your first item.',
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading inventory…',
  );

  // ── create panel ───────────────────────────────────────────────────────
  const createPanel = buildCreatePanel({
    form: createForm,
    submitting,
    submitError,
    onSubmit: async () => {
      const f = createForm();
      createPanel.inputs.get('name')?.removeAttribute('aria-invalid');
      if (!f.name.trim()) {
        submitError.set('Name is required.');
        const nameInput = createPanel.inputs.get('name');
        nameInput?.setAttribute('aria-invalid', 'true');
        nameInput?.focus();
        return;
      }
      submitting.set(true);
      submitError.set(null);
      try {
        await deps.inventory.create({
          name: f.name,
          ...(f.sku ? { sku: f.sku } : {}),
          description: f.description,
          category: f.category,
          quantity: f.quantity,
          minQuantity: f.minQuantity,
          unitCost: Math.round(f.unitCost * 100),
          unitPrice: Math.round(f.unitPrice * 100),
          supplier: f.supplier,
          location: f.location,
        });
        showCreate.set(false);
        await resource.reload();
      } catch (err) {
        submitError.set(
          err instanceof Error ? err.message : 'Could not save item.',
        );
      } finally {
        submitting.set(false);
      }
    },
    onCancel: () => showCreate.set(false),
  });
  cleanups.push(createPanel.dispose);

  // ── adjust modal ───────────────────────────────────────────────────────
  let adjustDialog: DialogMount | null = null;
  let adjustDispose: Cleanup | null = null;

  function teardownAdjust(): void {
    adjustDispose?.();
    adjustDispose = null;
    adjustDialog?.dispose();
    adjustDialog = null;
  }

  cleanups.push(
    effect(() => {
      const item = adjustingItem();
      if (!item) {
        teardownAdjust();
        return;
      }
      teardownAdjust();
      adjustForm.set(emptyAdjustForm());

      const typeSelect = el('select', {
        'data-bn-input': '',
        'data-testid': 'inventory-adjust-type',
      }) as HTMLSelectElement;
      for (const opt of ADJUST_TYPES) {
        typeSelect.append(el('option', { value: opt.value }, opt.label));
      }
      on(typeSelect, 'change', () => {
        adjustForm.set({
          ...adjustForm.peek(),
          type: typeSelect.value as InventoryTransactionType,
        });
      });

      const qtyInput = el('input', {
        type: 'number',
        'data-bn-input': '',
        'data-testid': 'inventory-adjust-qty',
        min: '1',
      }) as HTMLInputElement;
      qtyInput.value = String(adjustForm.peek().quantity);
      on(qtyInput, 'input', () => {
        adjustForm.set({
          ...adjustForm.peek(),
          quantity: Number(qtyInput.value),
        });
      });

      const notesInput = el('textarea', {
        'data-bn-input': '',
        'data-testid': 'inventory-adjust-notes',
        placeholder: 'Optional notes',
      }) as HTMLTextAreaElement;
      on(notesInput, 'input', () => {
        adjustForm.set({ ...adjustForm.peek(), notes: notesInput.value });
      });

      const form = buildPanelForm({
        body: [
          el(
            'p',
            { 'data-bn-secondary': '' },
            `Current stock: ${item.quantity}${item.minQuantity ? ` (min ${item.minQuantity})` : ''}`,
          ),
          formField('Type', typeSelect),
          formField('Quantity', qtyInput),
          formField('Notes', notesInput),
        ],
        submitting,
        submitError,
        submitLabel: 'Record adjustment',
        onSubmit: async () => {
          const f = adjustForm.peek();
          qtyInput.removeAttribute('aria-invalid');
          if (f.quantity <= 0) {
            submitError.set('Quantity must be at least 1.');
            qtyInput.setAttribute('aria-invalid', 'true');
            qtyInput.focus();
            return;
          }
          submitting.set(true);
          submitError.set(null);
          try {
            await deps.inventory.adjust(item.id, {
              type: f.type,
              quantity: f.quantity,
              ...(f.notes ? { notes: f.notes } : {}),
            });
            adjustingItem.set(null);
            await resource.reload();
          } catch (err) {
            submitError.set(
              err instanceof Error ? err.message : 'Could not adjust stock.',
            );
          } finally {
            submitting.set(false);
          }
        },
        onCancel: () => adjustingItem.set(null),
      });
      adjustDispose = form.dispose;
      adjustDialog = mountDialog({
        id: 'inventory-adjust',
        title: `Adjust ${item.name}`,
        body: [form.element],
        size: 'lg',
        onClose: () => adjustingItem.set(null),
      });
      adjustDialog.open();
    }).dispose,
  );

  // ── content slot ───────────────────────────────────────────────────────
  const content = el('div', {});
  const root = el(
    'section',
    { 'data-bn-list-route': '', 'data-bn-route': 'inventory' },
    header,
    toolbar,
    content,
  );

  cleanups.push(
    effect(() => {
      const open = showCreate();
      clear(content);
      if (open) {
        content.append(createPanel.element);
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
        errorNode.textContent = `Could not load inventory: ${err.message}`;
      const hasData = list.length > 0;
      toggle(empty, !isLoading && err === null && !hasData);
      toggle(tableWrap, hasData);
      mountTable(tableWrap, { columns: COLUMNS, rows: list });
    }).dispose,
  );

  return {
    element: root,
    dispose: () => {
      teardownAdjust();
      resource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

const COLUMNS: readonly TableColumn<InventoryItem>[] = [
  {
    key: 'item',
    label: 'Item',
    value: (item) => item.name,
    cell: (item, td) => fill(td, ...twoLines(item.name, item.description)),
  },
  { key: 'sku', label: 'SKU', value: (item) => item.sku ?? '—' },
  {
    key: 'stock',
    label: 'Stock',
    value: stockLabel,
    cell: (item, td) =>
      fill(td, statusBadge(stockStatus(item), stockLabel(item))),
  },
  {
    key: 'price',
    label: 'Unit price',
    value: (item) => formatCurrency(item.unitPrice / 100),
    align: 'end',
  },
  {
    key: 'actions',
    label: '',
    value: () => '',
    cell: (item, td) =>
      fill(
        td,
        actionButton({
          action: 'adjust',
          id: item.id,
          label: 'Adjust',
          testId: `inventory-adjust-${item.id}`,
        }),
      ),
  },
];

/** Synthetic stock status: out of stock → lost, below minimum → maintenance. */
function stockStatus(item: InventoryItem): string {
  if (item.quantity === 0) return 'lost';
  if (item.quantity < item.minQuantity) return 'maintenance';
  return 'active';
}

function stockLabel(item: InventoryItem): string {
  if (item.quantity === 0) return 'Out of stock';
  if (item.quantity < item.minQuantity) return `Low (${item.quantity})`;
  return String(item.quantity);
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}

function buildCreatePanel(args: {
  form: Signal<CreateForm>;
  submitting: Signal<boolean>;
  submitError: Signal<string | null>;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}): {
  element: HTMLElement;
  dispose: Cleanup;
  inputs: Map<keyof CreateForm, HTMLInputElement>;
} {
  const fields = el('div', { 'data-bn-field-grid': '' });
  const inputs = new Map<keyof CreateForm, HTMLInputElement>();

  const make = (
    label: string,
    field: keyof CreateForm,
    type = 'text',
  ): HTMLElement => {
    const input = el('input', {
      type,
      'data-bn-input': '',
      'data-testid': `inventory-form-${field}`,
    }) as HTMLInputElement;
    inputs.set(field, input);
    on(input, 'input', () => {
      const next = type === 'number' ? Number(input.value) : input.value;
      args.form.set({ ...args.form.peek(), [field]: next } as CreateForm);
    });
    return formField(label, input);
  };

  fields.append(
    make('Name', 'name'),
    make('SKU', 'sku'),
    make('Category', 'category'),
    make('Quantity', 'quantity', 'number'),
    make('Minimum quantity', 'minQuantity', 'number'),
    make('Unit cost (USD)', 'unitCost', 'number'),
    make('Unit price (USD)', 'unitPrice', 'number'),
    make('Supplier', 'supplier'),
    make('Location', 'location'),
  );

  const description = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'inventory-form-description',
    placeholder: 'Description',
  }) as HTMLTextAreaElement;
  on(description, 'input', () => {
    args.form.set({ ...args.form.peek(), description: description.value });
  });

  const panel = buildPanel({
    title: 'New inventory item',
    onSubmit: args.onSubmit,
    onCancel: args.onCancel,
    submitting: args.submitting,
    submitError: args.submitError,
    body: [fields, formField('Description', description)],
    submitLabel: 'Add item',
    syncForm: () => {
      const f = args.form.peek();
      for (const [key, input] of inputs) {
        input.value = String(f[key] ?? '');
      }
      description.value = f.description;
    },
  });
  return { ...panel, inputs };
}
