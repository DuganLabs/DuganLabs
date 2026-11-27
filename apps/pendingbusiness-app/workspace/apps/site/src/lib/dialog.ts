/**
 * Native `<dialog>`-based confirm, rendered with `@basenative/components`
 * (`renderDialog` / `renderButton`) instead of hand-rolled DOM building.
 * Returns true if the user confirmed, false if they cancelled (Cancel
 * button, backdrop click, or Escape).
 *
 * Why native `<dialog>` instead of `window.confirm()`:
 *  - Modal focus trapping is built in (focus stays inside the dialog).
 *  - Escape closes by default with returnValue=''.
 *  - We can style it (the OS confirm() is unstyleable).
 *  - Screen readers announce role=dialog with the title automatically.
 *
 * Accessibility wiring comes from `renderDialog` itself (0.7.0+): the
 * `title` is rendered as `<h2 id="{id}-title">` with `aria-labelledby`
 * on the `<dialog>`, and `description` as an escaped
 * `<p data-bn="dialog-description" id="{id}-description">` with
 * `aria-describedby`. The plain-text body goes through `description`
 * rather than the unescaped `content` HTML slot, so `body` is never
 * trusted as markup.
 *
 * Focus management: we restore focus to the previously-focused element
 * on close, so keyboard users land back where they were.
 */
import { nextId, renderButton, renderDialog } from '@basenative/components';

export interface ConfirmOpts {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * If true, the confirm button is styled destructive and Cancel gets
   * default focus (safer default for irreversible actions like revoke /
   * delete).
   */
  destructive?: boolean;
}

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const cancelHtml = renderButton(opts.cancelLabel ?? 'Cancel', {
    variant: 'secondary',
    type: 'submit',
    attrs: 'value="cancel"',
  });
  const confirmHtml = renderButton(opts.confirmLabel ?? 'Confirm', {
    variant: opts.destructive ? 'destructive' : 'primary',
    type: 'submit',
    attrs: 'value="confirm"',
  });

  const html = renderDialog({
    id: nextId('confirm-dialog'),
    title: opts.title,
    description: opts.body,
    footer: `<form method="dialog">${cancelHtml}${confirmHtml}</form>`,
    modal: true,
    closable: false,
  });

  const template = document.createElement('template');
  template.innerHTML = html;
  const dialog = template.content.firstElementChild as HTMLDialogElement;
  document.body.append(dialog);

  const cancelBtn = dialog.querySelector<HTMLButtonElement>('button[value="cancel"]')!;
  const confirmBtn = dialog.querySelector<HTMLButtonElement>('button[value="confirm"]')!;

  // Backdrop click cancels — native <dialog> doesn't do this on its own.
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close('cancel');
  });

  const closed = new Promise<boolean>(resolve => {
    dialog.addEventListener(
      'close',
      () => {
        // Empty returnValue happens on Escape; treat as cancel.
        resolve(dialog.returnValue === 'confirm');
      },
      { once: true },
    );
  });

  dialog.showModal();
  // Default focus: Cancel for destructive prompts, Confirm otherwise.
  (opts.destructive ? cancelBtn : confirmBtn).focus();

  return closed.finally(() => {
    dialog.remove();
    previouslyFocused?.focus();
  });
}
