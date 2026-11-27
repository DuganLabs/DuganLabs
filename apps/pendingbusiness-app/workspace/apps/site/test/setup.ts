/**
 * Minimal `<dialog>` polyfill for jsdom (which still ships partial support
 * as of v25). We only need enough to drive `showModal()` / `close()` /
 * `returnValue` and `<form method="dialog">` submission in unit tests; the
 * production runtime gets real native behavior.
 *
 * Guarded on `HTMLDialogElement` existing: this file is the project's
 * global `setupFiles` entry, so it also runs for suites that opt out of the
 * default jsdom environment (styles.test.ts runs esbuild under
 * `// @vitest-environment node`, where no DOM globals exist at all).
 */

if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    show?: () => void;
    close?: (returnValue?: string) => void;
  };

  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal(this: HTMLDialogElement): void {
      this.setAttribute('open', '');
    };
  }

  if (typeof proto.show !== 'function') {
    proto.show = function show(this: HTMLDialogElement): void {
      this.setAttribute('open', '');
    };
  }

  if (typeof proto.close !== 'function') {
    proto.close = function close(this: HTMLDialogElement, returnValue?: string): void {
      this.removeAttribute('open');
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.dispatchEvent(new Event('close'));
    };
  }

  // jsdom doesn't implement the spec rule that submitting a `<form method="dialog">`
  // inside a `<dialog>` closes that dialog with returnValue=submitter.value.
  // Wire that up at the document level so any test-spawned dialog gets it.
  document.addEventListener(
    'submit',
    event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.method !== 'dialog') return;
      const dialog = form.closest('dialog');
      if (!(dialog instanceof HTMLDialogElement)) return;
      event.preventDefault();
      const submitter = (event as SubmitEvent).submitter;
      const value = submitter instanceof HTMLButtonElement ? submitter.value : '';
      dialog.close(value);
    },
    true,
  );
}
