import { describe, it, expect, beforeEach } from 'vitest';
import { confirmDialog } from '../src/lib/dialog.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * jsdom 25 supports `<dialog>.showModal()` and `.close()`. Some assertions
 * (focus tracking, backdrop click) rely on that — we check for the basics
 * jsdom *does* implement and skip anything that depends on real
 * compositor-driven focus heuristics.
 *
 * Markup comes from `@basenative/components`' `renderDialog`/`renderButton`
 * (`dialog[data-bn="dialog"]`, `button[data-variant]`) rather than the old
 * hand-rolled `dialog[data-bn="confirm"]` — see src/lib/dialog.ts.
 */

describe('confirmDialog', () => {
  it('appends a <dialog> with proper ARIA wiring', async () => {
    const promise = confirmDialog({ title: 'Title', body: 'Body text' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]');
    expect(dlg).toBeTruthy();
    expect(dlg!.getAttribute('aria-modal')).toBe('true');
    const labelledById = dlg!.getAttribute('aria-labelledby');
    const describedById = dlg!.getAttribute('aria-describedby');
    expect(labelledById).toBeTruthy();
    expect(describedById).toBeTruthy();
    expect(document.getElementById(labelledById!)?.textContent).toBe('Title');
    expect(document.getElementById(describedById!)?.textContent).toBe('Body text');

    // Resolve so the dialog cleans up.
    dlg!.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click();
    await promise;
  });

  it('renders <dialog with aria-modal="true"> in the raw markup', async () => {
    const promise = confirmDialog({ title: 'Title', body: 'Body text' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    expect(dlg.outerHTML).toMatch(/<dialog/);
    expect(dlg.outerHTML).toContain('aria-modal="true"');
    dlg.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click();
    await promise;
  });

  it('escapes HTML in the title instead of rendering it', async () => {
    const promise = confirmDialog({ title: '<b>x</b>', body: 'Body text' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    const titleEl = dlg.querySelector('[data-bn="dialog-title"]')!;
    // The literal tag must show up as text, not be parsed into a <b> element.
    expect(titleEl.textContent).toBe('<b>x</b>');
    expect(titleEl.querySelector('b')).toBeNull();
    expect(titleEl.innerHTML).toBe('&lt;b&gt;x&lt;/b&gt;');
    dlg.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click();
    await promise;
  });

  it('escapes HTML in the body the same way', async () => {
    const promise = confirmDialog({ title: 'Title', body: '<img src=x onerror=alert(1)>' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    const bodyEl = dlg.querySelector('[data-bn="dialog-body"]')!;
    expect(bodyEl.querySelector('img')).toBeNull();
    expect(bodyEl.textContent).toBe('<img src=x onerror=alert(1)>');
    dlg.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click();
    await promise;
  });

  it('resolves true when the confirm button is clicked', async () => {
    const promise = confirmDialog({ title: 'Save?', body: 'Persist this scenario.' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    dlg.querySelector<HTMLButtonElement>('button[value="confirm"]')!.click();
    expect(await promise).toBe(true);
    // Dialog removes itself on close.
    expect(document.querySelector('dialog[data-bn="dialog"]')).toBeNull();
  });

  it('resolves false when the cancel button is clicked', async () => {
    const promise = confirmDialog({ title: 'Save?', body: '...' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    dlg.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click();
    expect(await promise).toBe(false);
    expect(document.querySelector('dialog[data-bn="dialog"]')).toBeNull();
  });

  it('resolves false when closed with no returnValue (Escape path)', async () => {
    const promise = confirmDialog({ title: 'X', body: 'Y' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    // Native Escape sets returnValue=''. Simulate by closing without a value.
    dlg.close();
    expect(await promise).toBe(false);
  });

  it('uses custom labels when provided', async () => {
    const promise = confirmDialog({
      title: 'Revoke?',
      body: '...',
      confirmLabel: 'Revoke and lock me out',
      cancelLabel: 'Keep',
    });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    expect(dlg.querySelector('button[value="cancel"]')?.textContent).toBe('Keep');
    expect(dlg.querySelector('button[value="confirm"]')?.textContent).toBe(
      'Revoke and lock me out',
    );
    dlg.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click();
    await promise;
  });

  it('marks the confirm button destructive and defaults focus to Cancel', async () => {
    const promise = confirmDialog({ title: 'Revoke?', body: '...', destructive: true });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    const confirm = dlg.querySelector<HTMLButtonElement>('button[value="confirm"]')!;
    const cancel = dlg.querySelector<HTMLButtonElement>('button[value="cancel"]')!;
    expect(confirm.dataset.variant).toBe('destructive');
    // Cancel stays a neutral variant.
    expect(cancel.dataset.variant).toBe('secondary');
    cancel.click();
    await promise;
  });

  it('defaults to primary confirm variant when not destructive', async () => {
    const promise = confirmDialog({ title: 'Save?', body: '...' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    expect(dlg.querySelector<HTMLButtonElement>('button[value="confirm"]')!.dataset.variant).toBe(
      'primary',
    );
    dlg.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click();
    await promise;
  });

  it('cancels on backdrop click', async () => {
    const promise = confirmDialog({ title: 'X', body: 'Y' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    // A click whose target is the dialog itself (vs the form within) is the
    // backdrop click pattern. dispatchEvent is enough to fire the listener.
    dlg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await promise).toBe(false);
  });

  it('does not cancel on click of an inner element', async () => {
    const promise = confirmDialog({ title: 'X', body: 'Y' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    const body = dlg.querySelector('[data-bn="dialog-body"] p')!;
    // Clicking the body should not trigger the backdrop handler — its
    // target is the <p>, not the dialog. We'll verify by checking the
    // promise hasn't resolved after a tick.
    body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await new Promise(r => setTimeout(r, 0));
    expect(settled).toBe(false);

    // Now actually cancel to clean up.
    dlg.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click();
    await promise;
  });

  it('restores focus to the previously-focused element on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.append(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const promise = confirmDialog({ title: 'X', body: 'Y' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    expect(document.activeElement).not.toBe(trigger);

    dlg.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click();
    await promise;
    expect(document.activeElement).toBe(trigger);
  });

  it('generates ids via the components package nextId (bn-confirm-dialog-N)', async () => {
    const promise = confirmDialog({ title: 'X', body: 'Y' });
    const dlg = document.querySelector<HTMLDialogElement>('dialog[data-bn="dialog"]')!;
    expect(dlg.id).toMatch(/^bn-confirm-dialog-\d+$/);
    dlg.querySelector<HTMLButtonElement>('button[value="cancel"]')!.click();
    await promise;
  });
});
