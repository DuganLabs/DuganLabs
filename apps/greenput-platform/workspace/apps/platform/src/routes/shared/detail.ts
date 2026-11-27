/**
 * Detail frame — the standard page for one record (`/leads/:id`,
 * `/customers/:id`, GP-003).
 *
 * The frame is the part every entity shares: the way back to the list, a
 * heading, a definition list of the record's fields, an Edit button that
 * swaps the list for inputs, a Delete button behind an `alertdialog`, and
 * the loading / error / notice states. The entity route owns everything
 * that differs — which fields, what the inputs are, what the patch looks
 * like, what else the page shows (a customer's job history) — and reads
 * the row itself with `createResource`, handing the frame its signals.
 *
 * Edit reuses `buildPanel()` (panel.ts) so an edit has the same
 * submitting / error / footer behaviour as a create (CLAUDE.md §10.3).
 * The inputs are built fresh from the row each time Edit is pressed, so a
 * reload while the list is showing never overwrites something half-typed.
 *
 * Delete is owner/admin only and confirms first. `onDelete` is run inside
 * the dialog, which keeps itself open and announces the error's message
 * when the call throws — so a customer with jobs is told why the API said
 * no, in the API's words, rather than watching nothing happen.
 */

import { effect, signal, type Signal } from '@basenative/runtime';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { buildPanel, type PanelMount } from './panel.js';
import { mountConfirmDialog, type ConfirmDialogMount } from './dialog.js';

export const DETAIL_ROUTE_SHEET = defineSheet(`
[data-bn-breadcrumb] a {
  display: inline-flex;
  align-items: center;
  gap: var(--gp-space-1);
  min-block-size: var(--gp-tap-min);
  color: var(--gp-text-muted);
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-medium);
  text-decoration: none;
}
[data-bn-breadcrumb] a:hover,
[data-bn-breadcrumb] a:focus-visible {
  color: var(--gp-primary);
  text-decoration: underline;
}
[data-bn-detail-actions] {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--gp-space-2);
}
[data-bn-detail-actions][hidden] { display: none; }

/* The record itself: one ruled sheet, labels above values, two columns
   once the screen allows and three on a desk. */
[data-bn-detail-fields] {
  margin: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--gp-space-4) var(--gp-space-6);
  padding: var(--gp-space-4);
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-lg);
}
[data-bn-detail-fields][hidden] { display: none; }
@media (min-width: 40rem) {
  [data-bn-detail-fields] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 64rem) {
  [data-bn-detail-fields] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
[data-bn-detail-field] {
  display: grid;
  gap: var(--gp-space-1);
  align-content: start;
}
[data-bn-detail-field][data-bn-span] { grid-column: 1 / -1; }
[data-bn-detail-field] dt {
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
  color: var(--gp-text-muted);
}
[data-bn-detail-field] dd {
  margin: 0;
  font-size: var(--gp-text-sm);
  color: var(--gp-text-strong);
  overflow-wrap: anywhere;
  white-space: pre-line;
}
[data-bn-detail-field] dd [data-bn="badge"] + [data-bn="badge"] {
  margin-inline-start: var(--gp-space-1);
}
[data-bn-detail-edit][hidden] { display: none; }

[data-bn-detail-section] {
  display: grid;
  gap: var(--gp-space-3);
}
[data-bn-detail-section] h2 {
  margin: 0;
  font-size: var(--gp-text-base);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-snug);
  color: var(--gp-text-strong);
}
`);

export interface DetailField<T> {
  /** Static key — the value's `data-testid` is `{id}-field-{key}`. */
  readonly key: string;
  readonly label: string;
  /** Plain text for the value; "—" for nothing is the caller's choice. */
  readonly value: (row: T) => string;
  /** Optional DOM decoration that replaces the value's text (a badge, a `<time>`). */
  readonly cell?: (row: T, dd: HTMLElement) => void;
  /** Take the full width of the sheet — notes, an address. */
  readonly span?: boolean;
}

/** The inputs an entity builds for Edit, and how the draft is read back. */
export interface DetailEditForm<D> {
  readonly element: HTMLElement;
  read(): D;
  dispose(): void;
}

export interface MountDetailOptions<T, D> {
  /** Static identifier; `data-bn-route`, dialog ids and test ids derive from it. */
  readonly id: string;
  /** Lower-case, for copy: "lead", "customer". */
  readonly noun: string;
  /** The list this record came from. */
  readonly back: { readonly href: string; readonly label: string };
  readonly row: Signal<T | undefined>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<Error | null>;
  readonly heading: (row: T) => string;
  readonly subheading?: (row: T) => string;
  readonly fields: readonly DetailField<T>[];
  /** Built fresh each time Edit is pressed, from the row as it is then. */
  readonly buildEditForm: (row: T) => DetailEditForm<D>;
  /**
   * Persist the draft. Throw to keep the form open with the message in its
   * error banner — validation and the API's refusal both land there.
   */
  readonly onSave: (row: T, draft: D) => Promise<void>;
  /** Read reactively; the Delete button follows it. */
  readonly canDelete: () => boolean;
  /** The question the confirmation asks — say what is lost. */
  readonly deleteDescription: (row: T) => string;
  /** Throw to keep the dialog open with the error's message — the API's words. */
  readonly onDelete: (row: T) => Promise<void>;
  /** Extra header controls for the row (a lead's lifecycle action). */
  readonly actions?: (row: T) => readonly Node[];
  /** Anything under the fields (a customer's job history). */
  readonly sections?: (row: T) => readonly Node[];
}

export interface DetailMount {
  readonly element: HTMLElement;
  /** Announce an outcome in the page's `role="status"` line. */
  notify(message: string): void;
  dispose(): void;
}

export function mountDetail<T, D>(
  options: MountDetailOptions<T, D>,
): DetailMount {
  adoptSheet(LIST_ROUTE_SHEET);
  adoptSheet(DETAIL_ROUTE_SHEET);

  const { id, noun } = options;
  const cleanups: Cleanup[] = [];
  const editing = signal(false);
  const submitting = signal(false);
  const submitError = signal<string | null>(null);

  // ── header ─────────────────────────────────────────────────────────────
  const crumb = el(
    'nav',
    { 'data-bn-breadcrumb': '', 'aria-label': 'Breadcrumb' },
    el(
      'a',
      { href: options.back.href, 'data-testid': `${id}-back` },
      `← ${options.back.label}`,
    ),
  );
  const heading = el('h1', { 'data-testid': `${id}-heading` });
  const subheading = el('p', { hidden: true });
  const editButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': `${id}-edit`,
    },
    'Edit',
  );
  const deleteButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'danger',
      'data-testid': `${id}-delete`,
      hidden: true,
    },
    'Delete',
  );
  const customActions = el('span', {
    'data-bn-detail-custom-actions': '',
    'data-bn-detail-actions': '',
  });
  const actions = el(
    'div',
    { 'data-bn-detail-actions': '', hidden: true },
    customActions,
    editButton,
    deleteButton,
  );
  const header = el('header', {}, el('div', {}, heading, subheading), actions);

  // ── states ─────────────────────────────────────────────────────────────
  const loadingNode = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    `Loading ${noun}…`,
  );
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': `${id}-error`,
    hidden: true,
  });
  const notice = el('p', {
    'data-bn-notice': '',
    role: 'status',
    'data-testid': `${id}-notice`,
    hidden: true,
  });
  const notify = (message: string): void => {
    notice.textContent = message;
    notice.removeAttribute('hidden');
  };

  // ── fields ─────────────────────────────────────────────────────────────
  const fields = el('dl', { 'data-bn-detail-fields': '', hidden: true });
  const editHost = el('div', { 'data-bn-detail-edit': '', hidden: true });
  const sections = el('div', { 'data-bn-detail-sections': '' });

  cleanups.push(
    effect(() => {
      const row = options.row();
      const isLoading = options.loading();
      const err = options.error();
      toggle(loadingNode, isLoading && row === undefined);
      toggle(errorNode, err !== null && row === undefined);
      if (err)
        errorNode.textContent = `Could not load this ${noun}: ${err.message}`;

      clear(fields);
      clear(customActions);
      clear(sections);
      if (row === undefined) {
        heading.textContent = '';
        toggle(subheading, false);
        toggle(actions, false);
        return;
      }
      heading.textContent = options.heading(row);
      const sub = options.subheading?.(row) ?? '';
      subheading.textContent = sub;
      toggle(subheading, sub !== '');
      toggle(actions, true);
      toggle(fields, !editing.peek());
      customActions.append(...(options.actions?.(row) ?? []));
      for (const field of options.fields) {
        const dd = el(
          'dd',
          { 'data-testid': `${id}-field-${field.key}` },
          field.value(row),
        );
        if (field.cell) field.cell(row, dd);
        fields.append(
          el(
            'div',
            { 'data-bn-detail-field': field.key, 'data-bn-span': field.span },
            el('dt', {}, field.label),
            dd,
          ),
        );
      }
      sections.append(...(options.sections?.(row) ?? []));
    }).dispose,
  );

  // ── edit ───────────────────────────────────────────────────────────────
  let form: DetailEditForm<D> | null = null;
  let panel: PanelMount | null = null;
  const teardownEdit = (): void => {
    panel?.dispose();
    panel = null;
    form?.dispose();
    form = null;
    clear(editHost);
  };

  const submit = async (): Promise<void> => {
    const row = options.row.peek();
    if (!row || !form || submitting.peek()) return;
    submitting.set(true);
    submitError.set(null);
    try {
      await options.onSave(row, form.read());
      editing.set(false);
      notify('Changes saved.');
    } catch (err) {
      submitError.set(
        err instanceof Error ? err.message : `Could not save this ${noun}.`,
      );
    } finally {
      submitting.set(false);
    }
  };

  // Tracks `editing` only: a reload of the row while the form is open (the
  // one `onSave` itself triggers) must not rebuild the inputs under the
  // user's hands.
  cleanups.push(
    effect(() => {
      const open = editing();
      const hasRow = options.row.peek() !== undefined;
      teardownEdit();
      if (open) {
        const row = options.row.peek();
        if (row !== undefined) {
          form = options.buildEditForm(row);
          submitError.set(null);
          panel = buildPanel({
            title: `Edit ${noun}`,
            body: [form.element],
            onSubmit: submit,
            onCancel: () => editing.set(false),
            submitting,
            submitError,
            submitLabel: 'Save changes',
          });
          editHost.append(panel.element);
          panel.element
            .querySelector<HTMLElement>('input, select, textarea')
            ?.focus();
        }
      }
      toggle(editHost, open);
      toggle(fields, hasRow && !open);
      toggle(sections, !open);
      toggle(editButton, !open);
      // The panel's own Cancel / Save are the only controls while editing.
      toggle(customActions, !open);
    }).dispose,
  );

  cleanups.push(
    on(editButton, 'click', () => {
      if (options.row.peek() === undefined) return;
      editing.set(true);
    }),
  );

  // ── delete ─────────────────────────────────────────────────────────────
  cleanups.push(
    effect(() => {
      toggle(deleteButton, options.canDelete() && !editing());
    }).dispose,
  );

  let confirm: ConfirmDialogMount | null = null;
  const teardownConfirm = (): void => {
    confirm?.dispose();
    confirm = null;
  };
  cleanups.push(
    on(deleteButton, 'click', () => {
      const row = options.row.peek();
      if (row === undefined) return;
      teardownConfirm();
      const dialog = mountConfirmDialog({
        id: `${id}-delete`,
        title: `Delete this ${noun}?`,
        description: options.deleteDescription(row),
        confirmLabel: `Delete ${noun}`,
        confirmVariant: 'danger',
        onConfirm: () => options.onDelete(row),
        onClose: teardownConfirm,
      });
      confirm = dialog;
      dialog.open();
    }),
  );

  const root = el(
    'section',
    {
      'data-bn-list-route': '',
      'data-bn-detail-route': '',
      'data-bn-route': id,
    },
    crumb,
    header,
    loadingNode,
    errorNode,
    notice,
    fields,
    editHost,
    sections,
  );

  return {
    element: root,
    notify,
    dispose: () => {
      teardownConfirm();
      teardownEdit();
      for (const fn of cleanups) fn();
    },
  };
}

/** Delete is for the owner and admins only (GP-003 step 6). */
export function canDeleteRecords(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

function toggle(node: HTMLElement, visible: boolean): void {
  if (visible) node.removeAttribute('hidden');
  else node.setAttribute('hidden', '');
}
