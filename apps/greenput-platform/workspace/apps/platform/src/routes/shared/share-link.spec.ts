import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHARE_COPY_STATUS, mountShareLink } from './share-link.js';
import { tick } from '../../test/helpers.js';

function q<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const node = root.querySelector<T>(`[data-testid="${id}"]`);
  if (!node) throw new Error(`missing ${id}`);
  return node;
}

import { SHARE_LINK_SHEET } from './share-link.js';

describe('share-link sheet', () => {
  it('lets the hidden attribute win over the grid display', () => {
    // display: grid on the card would otherwise beat [hidden], and every
    // list route mounts the card hidden until a link exists.
    const rules = Array.from(SHARE_LINK_SHEET.cssRules).map((r) => r.cssText);
    expect(rules).toContainEqual(
      expect.stringMatching(
        /^\[data-bn-share-link\]\[hidden\]\s*\{\s*display:\s*none/,
      ),
    );
  });
});

describe('mountShareLink', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).clipboard;
  });

  function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  it('starts hidden and shows the URL, the message and the heading it is given', () => {
    const mount = mountShareLink({ testId: 'share' });
    dispose = mount.dispose;
    document.body.append(mount.element);
    expect(mount.element.hasAttribute('hidden')).toBe(true);

    mount.show(
      { url: 'https://demo.greenput.com/invoice/t1', message: 'Hi: link' },
      'Invoice link ready to share',
    );
    expect(mount.element.hasAttribute('hidden')).toBe(false);
    expect(q(mount.element, 'share-heading').textContent).toBe(
      'Invoice link ready to share',
    );
    expect(q<HTMLInputElement>(mount.element, 'share-url').value).toBe(
      'https://demo.greenput.com/invoice/t1',
    );
    expect(q<HTMLTextAreaElement>(mount.element, 'share-message').value).toBe(
      'Hi: link',
    );
    // It says nothing was sent, and never says it was.
    expect(mount.element.textContent).toContain('Nothing has been sent');
    expect(mount.element.textContent).not.toMatch(/\bsent\b(?! *\.)/i);
    expect(q(mount.element, 'share-expires').hasAttribute('hidden')).toBe(true);
  });

  it('copies the link and the message to the clipboard and says so', async () => {
    const writeText = stubClipboard();
    const mount = mountShareLink({ testId: 'share' });
    dispose = mount.dispose;
    document.body.append(mount.element);
    mount.show({ url: 'https://x/y', message: 'the message https://x/y' }, 'h');

    q(mount.element, 'share-copy-url').click();
    await tick();
    expect(writeText).toHaveBeenLastCalledWith('https://x/y');
    expect(q(mount.element, 'share-status').textContent).toBe(
      SHARE_COPY_STATUS.url,
    );

    q(mount.element, 'share-copy-message').click();
    await tick();
    expect(writeText).toHaveBeenLastCalledWith('the message https://x/y');
    expect(q(mount.element, 'share-status').textContent).toBe(
      SHARE_COPY_STATUS.message,
    );
  });

  it('falls back to selecting the text when the clipboard refuses', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    const mount = mountShareLink({ testId: 'share' });
    dispose = mount.dispose;
    document.body.append(mount.element);
    mount.show({ url: 'https://x/y', message: 'm' }, 'h');

    q(mount.element, 'share-copy-url').click();
    await tick();
    expect(q(mount.element, 'share-status').textContent).toBe(
      SHARE_COPY_STATUS.failed,
    );
    expect(document.activeElement).toBe(q(mount.element, 'share-url'));
  });

  it('states the expiry for a single-use link', () => {
    const mount = mountShareLink({ testId: 'share' });
    dispose = mount.dispose;
    mount.show(
      { url: 'u', message: 'm', expiresAt: '2026-09-20T12:00:00.000Z' },
      'Invite link ready to share',
    );
    const expires = q(mount.element, 'share-expires');
    expect(expires.hasAttribute('hidden')).toBe(false);
    expect(expires.textContent).toMatch(
      /works once and expires September 2\d, 2026/,
    );
    mount.hide();
    expect(mount.element.hasAttribute('hidden')).toBe(true);
  });
});
