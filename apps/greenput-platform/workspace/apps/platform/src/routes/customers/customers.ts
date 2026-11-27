/**
 * `/customers` — directory + create panel.
 *
 * Mirrors [CustomersComponent](apps/platform/src/app/features/customers/customers.component.ts).
 * Lists customers with search, opens a side panel for creation. The name
 * column links to `/customers/:id` (GP-003), where the record is edited.
 */

import { effect, signal, type Signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import type { ApiResponse, Customer } from '@greenput/shared/models';
import { formatPhone } from '@greenput/shared/utils';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { formatCurrency, formatRelativeTime } from '../../lib/format.js';
import { buildPanel } from '../shared/panel.js';
import { field as formField } from '../shared/field.js';
import {
  fill,
  mountTable,
  timeCell,
  type TableColumn,
} from '../shared/table.js';
import { mountPagination, DEFAULT_PER_PAGE } from '../shared/pagination.js';
import type { RouteView } from '../types.js';

type FormState = {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  preferredContact: 'email' | 'phone' | 'text';
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  company: '',
  email: '',
  phone: '',
  preferredContact: 'phone',
  street: '',
  city: '',
  state: '',
  zip: '',
  notes: '',
};

export function renderCustomersRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);

  const search = signal('');
  const showPanel = signal(false);
  const form = signal<FormState>(EMPTY_FORM);
  const submitting = signal(false);
  const submitError = signal<string | null>(null);

  const cleanups: Cleanup[] = [];

  const page = signal(1);
  const resource = createResource<ApiResponse<Customer[]>>(
    () =>
      deps.customers.list({
        page: page(),
        ...(search() ? { q: search() } : {}),
      }),
    { auto: true },
  );
  const pager = mountPagination({
    page,
    total: () => resource.data()?.meta?.total ?? 0,
    perPage: DEFAULT_PER_PAGE,
    onPage: (next) => page.set(next),
    testId: 'customers',
    label: 'Customer pages',
    noun: 'customers',
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
      'data-testid': 'customers-new',
    },
    'New customer',
  );
  cleanups.push(
    on(newButton, 'click', () => {
      form.set(EMPTY_FORM);
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
      el('h1', {}, 'Customers'),
      el('p', {}, 'Everyone you have done work for, ranked by lifetime value.'),
    ),
    newButton,
  );

  // ── toolbar ────────────────────────────────────────────────────────────
  const searchInput = el('input', {
    type: 'search',
    'data-bn-input': '',
    placeholder: 'Search by name, email, or phone…',
    'data-testid': 'customers-search',
    'aria-label': 'Search customers',
  }) as HTMLInputElement;
  cleanups.push(
    on(searchInput, 'input', () => {
      page.set(1);
      search.set(searchInput.value);
      void resource.reload();
    }),
  );
  const toolbar = el(
    'div',
    { 'data-bn-toolbar': '' },
    el('div', { 'data-bn-search': '' }, searchInput),
  );

  // ── content slots ──────────────────────────────────────────────────────
  const tableWrap = el('div', { 'data-bn-table-wrap': '' });

  const empty = el(
    'p',
    { 'data-bn-empty': '', hidden: true },
    'No customers yet. Create one to get started.',
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading customers…',
  );

  // ── create panel ───────────────────────────────────────────────────────
  const panel = buildCreatePanel({
    form,
    submitting,
    submitError,
    onSubmit: async () => {
      const f = form();
      panel.clearInvalid('firstName');
      panel.clearInvalid('lastName');
      if (!f.firstName.trim() || !f.lastName.trim()) {
        submitError.set('First and last name are required.');
        panel.focusInvalid(!f.firstName.trim() ? 'firstName' : 'lastName');
        return;
      }
      submitting.set(true);
      submitError.set(null);
      try {
        await deps.customers.create({
          firstName: f.firstName,
          lastName: f.lastName,
          ...(f.company ? { company: f.company } : {}),
          contact: {
            email: f.email,
            phone: f.phone,
            preferredContact: f.preferredContact,
          },
          address: {
            street: f.street,
            city: f.city,
            state: f.state,
            zip: f.zip,
          },
          notes: f.notes,
        });
        showPanel.set(false);
        await resource.reload();
      } catch (err) {
        submitError.set(
          err instanceof Error ? err.message : 'Could not create customer.',
        );
      } finally {
        submitting.set(false);
      }
    },
    onCancel: () => showPanel.set(false),
  });
  cleanups.push(panel.dispose);

  // ── root ───────────────────────────────────────────────────────────────
  const content = el('div', { 'data-bn-list-content': '' });
  const root = el(
    'section',
    { 'data-bn-list-route': '', 'data-bn-route': 'customers' },
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
        errorNode.textContent = `Could not load customers: ${err.message}`;

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

const COLUMNS: readonly TableColumn<Customer>[] = [
  {
    key: 'customer',
    label: 'Customer',
    value: fullName,
    href: (c) => `/customers/${c.id}`,
    cell: (c, td) =>
      fill(
        td,
        el('strong', {}, fullName(c)),
        c.company
          ? el('span', { 'data-bn-secondary': '' }, ` · ${c.company}`)
          : null,
      ),
  },
  {
    key: 'contact',
    label: 'Contact',
    value: (c) => c.contact.email || '—',
    cell: (c, td) =>
      fill(
        td,
        el('div', {}, c.contact.email || '—'),
        el(
          'div',
          { 'data-bn-secondary': '' },
          formatPhone(c.contact.phone) || '—',
        ),
      ),
  },
  {
    key: 'lifetime',
    label: 'Lifetime',
    value: (c) => formatCurrency(c.totalJobValue / 100),
    align: 'end',
    cell: (c, td) =>
      fill(
        td,
        formatCurrency(c.totalJobValue / 100),
        el(
          'span',
          { 'data-bn-secondary': '' },
          ` · ${c.jobCount} job${c.jobCount === 1 ? '' : 's'}`,
        ),
      ),
  },
  {
    key: 'lastSeen',
    label: 'Last seen',
    value: (c) => formatRelativeTime(c.updatedAt),
    cell: (c, td) =>
      fill(td, timeCell(c.updatedAt, formatRelativeTime(c.updatedAt))),
  },
];

function fullName(c: Customer): string {
  return `${c.firstName} ${c.lastName}`;
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) {
    node.removeAttribute('hidden');
  } else {
    node.setAttribute('hidden', '');
  }
}

function buildCreatePanel(args: {
  form: Signal<FormState>;
  submitting: Signal<boolean>;
  submitError: Signal<string | null>;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
}): {
  element: HTMLElement;
  dispose: Cleanup;
  focusInvalid: (key: keyof FormState) => void;
  clearInvalid: (key: keyof FormState) => void;
} {
  const fields = el('div', { 'data-bn-field-grid': '' });

  const make = (
    label: string,
    field: keyof FormState,
    type = 'text',
    placeholder?: string,
  ): HTMLElement => {
    const input = el('input', {
      type,
      'data-bn-input': '',
      'data-testid': `customers-form-${field}`,
      placeholder: placeholder ?? '',
      autocomplete: 'off',
    }) as HTMLInputElement;
    on(input, 'input', () => {
      args.form.set({ ...args.form.peek(), [field]: input.value });
    });
    return formField(label, input);
  };

  const select = el('select', {
    'data-bn-input': '',
    'data-testid': 'customers-form-preferredContact',
  }) as HTMLSelectElement;
  for (const value of ['phone', 'email', 'text'] as const) {
    select.append(el('option', { value }, value));
  }
  on(select, 'change', () => {
    args.form.set({
      ...args.form.peek(),
      preferredContact: select.value as FormState['preferredContact'],
    });
  });

  fields.append(
    make('First name', 'firstName'),
    make('Last name', 'lastName'),
    make('Company', 'company'),
    make('Email', 'email', 'email'),
    make('Phone', 'phone', 'tel'),
    formField('Preferred contact', select),
    make('Street', 'street'),
    make('City', 'city'),
    make('State', 'state'),
    make('ZIP', 'zip'),
  );

  const notes = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'customers-form-notes',
    placeholder: 'Notes (optional)',
  }) as HTMLTextAreaElement;
  on(notes, 'input', () => {
    args.form.set({ ...args.form.peek(), notes: notes.value });
  });

  const panel = buildPanel({
    title: 'New customer',
    onSubmit: args.onSubmit,
    onCancel: args.onCancel,
    submitting: args.submitting,
    submitError: args.submitError,
    body: [fields, formField('Notes', notes)],
    syncForm: () => {
      const f = args.form.peek();
      const inputs = fields.querySelectorAll('input');
      for (const input of inputs) {
        const dataAttr = input.getAttribute('data-testid') ?? '';
        const key = dataAttr.replace('customers-form-', '') as keyof FormState;
        const value = f[key];
        if (typeof value === 'string') {
          input.value = value;
        }
      }
      select.value = f.preferredContact;
      notes.value = f.notes;
    },
  });
  return {
    ...panel,
    focusInvalid: (key: keyof FormState) => {
      const input = fields.querySelector<HTMLInputElement>(
        `[data-testid="customers-form-${key}"]`,
      );
      input?.setAttribute('aria-invalid', 'true');
      input?.focus();
    },
    clearInvalid: (key: keyof FormState) => {
      fields
        .querySelector<HTMLInputElement>(
          `[data-testid="customers-form-${key}"]`,
        )
        ?.removeAttribute('aria-invalid');
    },
  };
}
