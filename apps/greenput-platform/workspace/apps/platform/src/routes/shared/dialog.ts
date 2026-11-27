/**
 * Modal dialog — `@basenative/components` `renderDialog` mounted into the
 * `el()` tree and driven through the native `<dialog>` API.
 *
 * renderDialog produces `<dialog data-bn="dialog" aria-modal="true">`
 * labelled by its own title (`aria-labelledby` → `{id}-title`), with a
 * header (escaped title plus a labelled close button), a body slot and a
 * footer slot. Body and footer are HTML slots, so the body is rendered empty
 * and the app appends its own DOM. `showModal()` supplies the focus trap,
 * Escape handling, focus restore and the `::backdrop` scrim; every way the
 * dialog closes (Escape, the close button, `close()`) ends in the native
 * `close` event, which is reported through `onClose` so the route's signal
 * stays the source of truth.
 *
 * `mountConfirmDialog` is the `role="alertdialog"` variant: a question, an
 * optional live body (a price line, say), Cancel and Confirm. It exists for
 * the two lead transitions that are money (GP-106) — nothing that charges a
 * contractor may run on a single click.
 */

import { renderDialog } from '@basenative/components';
import { delegate, el, on, type Cleanup } from '../../lib/dom.js';
import { elementFromHtml } from '../../lib/html.js';

export interface MountDialogOptions {
  /** Static identifier (also prefixes the title id); never user data. */
  readonly id: string;
  /** Escaped by the renderer. */
  readonly title: string;
  /**
   * Escaped by the renderer; rendered first in the body as
   * `<p id="{id}-description">` and named by `aria-describedby`.
   */
  readonly description?: string;
  readonly body: readonly Node[];
  /** Appended to a `[data-bn="dialog-footer"]` slot when given. */
  readonly footer?: readonly Node[];
  readonly size?: 'sm' | 'default' | 'lg';
  /**
   * `alertdialog` for an interruption that needs an answer (money, an
   * irreversible step); assistive tech announces it as such. Default `dialog`.
   */
  readonly role?: 'dialog' | 'alertdialog';
  /** Called once each time the dialog closes, whatever the cause. */
  readonly onClose: () => void;
}

export interface DialogMount {
  readonly element: HTMLDialogElement;
  /** Append to `parent` (default `document.body`) if needed and open modally. */
  open(parent?: Element): void;
  close(): void;
  /** Remove listeners and the element; does not report a close. */
  dispose(): void;
}

const FOCUSABLE =
  'input, select, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function mountDialog(options: MountDialogOptions): DialogMount {
  const element = elementFromHtml<HTMLDialogElement>(
    renderDialog({
      id: options.id,
      title: options.title,
      ...(options.description ? { description: options.description } : {}),
      content: '',
      size: options.size ?? 'default',
      ...(options.role === 'alertdialog'
        ? { attrs: 'role="alertdialog"' }
        : {}),
    }),
  );
  element.querySelector('[data-bn="dialog-body"]')?.append(...options.body);
  if (options.footer?.length) {
    element.append(
      el('div', { 'data-bn': 'dialog-footer' }, ...options.footer),
    );
  }

  function close(): void {
    if (element.open) element.close();
  }

  const cleanups: Cleanup[] = [
    delegate(element, 'click', '[data-bn="dialog-close"]', () => close()),
    on(element, 'close', () => options.onClose()),
  ];

  return {
    element,
    open(parent: Element = document.body): void {
      if (!element.isConnected) parent.append(element);
      if (element.open) return;
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
      // showModal() otherwise leaves focus on the first focusable element in
      // the dialog — the header's × close button — forcing keyboard users to
      // tab past it every time. Move it to the first focusable field in the
      // body instead, or, for a body with none (a confirmation), the first
      // footer control — which `mountConfirmDialog` orders as Cancel, so the
      // safe answer is the one under the keyboard.
      const firstField =
        element
          .querySelector('[data-bn="dialog-body"]')
          ?.querySelector<HTMLElement>(FOCUSABLE) ??
        element
          .querySelector('[data-bn="dialog-footer"]')
          ?.querySelector<HTMLElement>(FOCUSABLE);
      firstField?.focus();
    },
    close,
    dispose(): void {
      for (const fn of cleanups) fn();
      if (element.open) element.close();
      element.remove();
    },
  };
}

// ── Confirmation (alertdialog) ─────────────────────────────────────────

export interface MountConfirmDialogOptions {
  /** Static identifier; never user data. Test ids derive from it. */
  readonly id: string;
  /** Escaped by the renderer. */
  readonly title: string;
  /** The question, escaped; becomes the dialog's accessible description. */
  readonly description: string;
  /** Extra nodes under the question — e.g. a live price line. */
  readonly body?: readonly Node[];
  readonly confirmLabel: string;
  /** Default "Cancel". */
  readonly cancelLabel?: string;
  /** `danger` for an irreversible step; default `primary`. */
  readonly confirmVariant?: 'primary' | 'danger';
  /**
   * Runs on Confirm with both buttons disabled. Resolve to close the dialog;
   * throw to keep it open with the error's message announced inside it.
   */
  readonly onConfirm: () => void | Promise<void>;
  /** Called once each time the dialog closes, whatever the cause. */
  readonly onClose: () => void;
}

export interface ConfirmDialogMount extends DialogMount {
  /**
   * Gate Confirm — e.g. keep it disabled until the figure it commits the
   * user to is on screen. Starts enabled.
   */
  setConfirmEnabled(enabled: boolean): void;
}

export function mountConfirmDialog(
  options: MountConfirmDialogOptions,
): ConfirmDialogMount {
  const errorNode = el('p', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': `${options.id}-error`,
    hidden: true,
  });
  const cancelButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': `${options.id}-cancel`,
    },
    options.cancelLabel ?? 'Cancel',
  ) as HTMLButtonElement;
  const confirmButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': options.confirmVariant ?? 'primary',
      'data-testid': `${options.id}-confirm`,
    },
    options.confirmLabel,
  ) as HTMLButtonElement;

  let enabled = true;
  let busy = false;
  function sync(): void {
    confirmButton.disabled = !enabled || busy;
    cancelButton.disabled = busy;
    if (busy) confirmButton.setAttribute('aria-busy', 'true');
    else confirmButton.removeAttribute('aria-busy');
  }

  const dialog = mountDialog({
    id: options.id,
    title: options.title,
    description: options.description,
    body: [...(options.body ?? []), errorNode],
    footer: [cancelButton, confirmButton],
    size: 'sm',
    role: 'alertdialog',
    onClose: options.onClose,
  });

  const cleanups: Cleanup[] = [
    on(cancelButton, 'click', () => dialog.close()),
    on(confirmButton, 'click', () => {
      if (busy || !enabled) return;
      busy = true;
      sync();
      errorNode.setAttribute('hidden', '');
      void (async () => {
        try {
          await options.onConfirm();
          busy = false;
          sync();
          dialog.close();
        } catch (err) {
          busy = false;
          sync();
          errorNode.textContent =
            err instanceof Error ? err.message : 'Something went wrong.';
          errorNode.removeAttribute('hidden');
          confirmButton.focus();
        }
      })();
    }),
  ];

  return {
    ...dialog,
    setConfirmEnabled(next: boolean): void {
      enabled = next;
      sync();
    },
    dispose(): void {
      for (const fn of cleanups) fn();
      dialog.dispose();
    },
  };
}
