/**
 * Shared create/edit form — body, error banner, footer with cancel + submit.
 *
 * `buildPanelForm()` is the form alone; it is what a modal dialog
 * (routes/shared/dialog.ts, chrome from @basenative/components) shows.
 * `buildPanel()` wraps it in the inline `<aside data-bn-panel>` with a
 * heading and close button that every list route's "New X" flow uses.
 *
 * Routes pass arbitrary body nodes plus an optional `syncForm` callback that
 * re-applies the current signal values to the inputs whenever the panel
 * re-mounts.
 */

import { effect, type Signal } from '@basenative/runtime';
import { el, on, type Cleanup } from '../../lib/dom.js';

export interface BuildPanelFormArgs {
  readonly body: HTMLElement[];
  readonly onSubmit: () => Promise<void>;
  readonly onCancel: () => void;
  readonly submitting: Signal<boolean>;
  readonly submitError: Signal<string | null>;
  /** Called once on mount to seed inputs from signal state. */
  readonly syncForm?: () => void;
  readonly submitLabel?: string;
  /** `data-testid` for the submit button; defaults to `panel-submit`. */
  readonly submitTestId?: string;
}

export interface BuildPanelArgs extends BuildPanelFormArgs {
  readonly title: string;
}

export interface PanelMount {
  readonly element: HTMLElement;
  dispose(): void;
}

export function buildPanelForm(args: BuildPanelFormArgs): PanelMount {
  const cleanups: Cleanup[] = [];

  const errorBanner = el('output', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });

  const submitBtn = el(
    'button',
    {
      type: 'submit',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': args.submitTestId ?? 'panel-submit',
    },
    args.submitLabel ?? 'Save',
  );

  const cancelBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'panel-cancel',
    },
    'Cancel',
  );

  const form = el(
    'form',
    { 'data-bn-panel-form': '', novalidate: '' },
    ...args.body,
    errorBanner,
    el('footer', { 'data-bn-form-footer': '' }, cancelBtn, submitBtn),
  );

  cleanups.push(
    on(form, 'submit', (event) => {
      event.preventDefault();
      void args.onSubmit();
    }),
    on(cancelBtn, 'click', () => args.onCancel()),
  );

  cleanups.push(
    effect(() => {
      const busy = args.submitting();
      submitBtn.disabled = busy;
      submitBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
      submitBtn.textContent = busy ? 'Saving…' : (args.submitLabel ?? 'Save');
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const message = args.submitError();
      if (message) {
        errorBanner.textContent = message;
        errorBanner.removeAttribute('hidden');
      } else {
        errorBanner.textContent = '';
        errorBanner.setAttribute('hidden', '');
      }
    }).dispose,
  );

  if (args.syncForm) args.syncForm();

  return {
    element: form,
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}

export function buildPanel(args: BuildPanelArgs): PanelMount {
  const form = buildPanelForm(args);

  const closeBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'ghost',
      'aria-label': 'Close',
    },
    '×',
  );
  const offClose = on(closeBtn, 'click', () => args.onCancel());

  const heading = el('h2', {}, args.title);
  const panel = el(
    'aside',
    { 'data-bn-panel': '', 'aria-labelledby': 'panel-title' },
    el('header', {}, heading, closeBtn),
    form.element,
  );
  heading.id = 'panel-title';

  return {
    element: panel,
    dispose: () => {
      offClose();
      form.dispose();
    },
  };
}
