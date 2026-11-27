import { afterEach, describe, expect, it } from 'vitest';
import { el } from '../../lib/dom.js';
import { tick } from '../../test/helpers.js';
import {
  mountConfirmDialog,
  mountDialog,
  type ConfirmDialogMount,
  type DialogMount,
} from './dialog.js';

describe('mountDialog', () => {
  let mount: DialogMount | null = null;
  afterEach(() => {
    mount?.dispose();
    mount = null;
  });

  it('renders a labelled modal <dialog> holding the body nodes', () => {
    mount = mountDialog({
      id: 'test-dialog',
      title: 'Adjust <b>x</b>',
      body: [el('p', { 'data-testid': 'body' }, 'body')],
      onClose: () => undefined,
    });
    const { element } = mount;
    expect(element.tagName).toBe('DIALOG');
    expect(element.getAttribute('data-bn')).toBe('dialog');
    expect(element.getAttribute('aria-modal')).toBe('true');
    expect(element.getAttribute('aria-labelledby')).toBe('test-dialog-title');
    expect(element.querySelector('#test-dialog-title')?.textContent).toBe(
      'Adjust <b>x</b>',
    );
    expect(element.querySelector('#test-dialog-title b')).toBeNull();
    expect(
      element.querySelector('[data-bn="dialog-body"] [data-testid="body"]'),
    ).not.toBeNull();
    expect(element.querySelector('[data-bn="dialog-close"]')).not.toBeNull();
  });

  it('opens in the document as a modal and reports the close button', async () => {
    let closed = 0;
    mount = mountDialog({
      id: 'test-dialog',
      title: 'T',
      body: [],
      onClose: () => {
        closed += 1;
      },
    });
    mount.open();
    expect(mount.element.isConnected).toBe(true);
    expect(mount.element.open).toBe(true);

    (
      mount.element.querySelector('[data-bn="dialog-close"]') as HTMLElement
    ).click();
    await tick();
    expect(mount.element.open).toBe(false);
    expect(closed).toBe(1);
  });

  it('dispose removes the element without reporting a close', async () => {
    let closed = 0;
    const dialog = mountDialog({
      id: 'test-dialog',
      title: 'T',
      body: [],
      onClose: () => {
        closed += 1;
      },
    });
    dialog.open();
    dialog.dispose();
    await tick();
    expect(dialog.element.isConnected).toBe(false);
    expect(closed).toBe(0);
  });
});

describe('mountConfirmDialog', () => {
  let mount: ConfirmDialogMount | null = null;
  afterEach(() => {
    mount?.dispose();
    mount = null;
  });

  function build(
    onConfirm: () => void | Promise<void>,
    onClose: () => void = () => undefined,
  ): ConfirmDialogMount {
    mount = mountConfirmDialog({
      id: 'confirm-x',
      title: 'Accept lead?',
      description: 'This records the lead fee.',
      body: [el('p', { 'data-testid': 'price' }, '$60')],
      confirmLabel: 'Accept — $60',
      confirmVariant: 'danger',
      onConfirm,
      onClose,
    });
    return mount;
  }

  it('is an alertdialog described by its question, with Cancel and Confirm', () => {
    const { element } = build(() => undefined);
    expect(element.getAttribute('role')).toBe('alertdialog');
    expect(element.getAttribute('aria-modal')).toBe('true');
    expect(element.getAttribute('aria-labelledby')).toBe('confirm-x-title');
    expect(element.getAttribute('aria-describedby')).toBe(
      'confirm-x-description',
    );
    expect(element.querySelector('#confirm-x-description')?.textContent).toBe(
      'This records the lead fee.',
    );
    expect(
      element.querySelector('[data-bn="dialog-body"] [data-testid="price"]')
        ?.textContent,
    ).toBe('$60');
    const footer = element.querySelector('[data-bn="dialog-footer"]');
    const buttons = footer?.querySelectorAll('button') ?? [];
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual([
      'Cancel',
      'Accept — $60',
    ]);
    expect(
      footer
        ?.querySelector('[data-testid="confirm-x-confirm"]')
        ?.getAttribute('data-bn-variant'),
    ).toBe('danger');
  });

  it('opens with focus on Cancel, and Cancel closes without confirming', async () => {
    let confirmed = 0;
    let closed = 0;
    const dialog = build(
      () => {
        confirmed += 1;
      },
      () => {
        closed += 1;
      },
    );
    dialog.open();
    expect(document.activeElement?.getAttribute('data-testid')).toBe(
      'confirm-x-cancel',
    );
    (
      dialog.element.querySelector(
        '[data-testid="confirm-x-cancel"]',
      ) as HTMLElement
    ).click();
    await tick();
    expect(dialog.element.open).toBe(false);
    expect(confirmed).toBe(0);
    expect(closed).toBe(1);
  });

  it('Confirm runs onConfirm once, then closes', async () => {
    let confirmed = 0;
    const dialog = build(async () => {
      confirmed += 1;
      await tick();
    });
    dialog.open();
    const confirm = dialog.element.querySelector(
      '[data-testid="confirm-x-confirm"]',
    ) as HTMLButtonElement;
    confirm.click();
    // Busy while the promise is out: a second click cannot double-submit.
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    confirm.click();
    await tick();
    await tick();
    expect(confirmed).toBe(1);
    expect(dialog.element.open).toBe(false);
  });

  it('a rejected onConfirm keeps the dialog open and announces the message', async () => {
    const dialog = build(() => Promise.reject(new Error('Not qualified')));
    dialog.open();
    (
      dialog.element.querySelector(
        '[data-testid="confirm-x-confirm"]',
      ) as HTMLButtonElement
    ).click();
    await tick();
    await tick();
    expect(dialog.element.open).toBe(true);
    const error = dialog.element.querySelector(
      '[data-testid="confirm-x-error"]',
    );
    expect(error?.hasAttribute('hidden')).toBe(false);
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toBe('Not qualified');
    expect(
      (
        dialog.element.querySelector(
          '[data-testid="confirm-x-confirm"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('setConfirmEnabled(false) gates Confirm until the figure is known', () => {
    let confirmed = 0;
    const dialog = build(() => {
      confirmed += 1;
    });
    dialog.setConfirmEnabled(false);
    dialog.open();
    const confirm = dialog.element.querySelector(
      '[data-testid="confirm-x-confirm"]',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    confirm.click();
    expect(confirmed).toBe(0);
    dialog.setConfirmEnabled(true);
    expect(confirm.disabled).toBe(false);
  });
});
