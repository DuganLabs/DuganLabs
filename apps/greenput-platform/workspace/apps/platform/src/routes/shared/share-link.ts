/**
 * The "link ready to share" card (GP-008).
 *
 * Nothing in the product sends mail or SMS yet. "Mark invoiced", "Mark sent"
 * and "Invite teammate" each hand back a `ShareLink` — a public URL and a
 * message with it in — and this is the one place it is shown: the URL in a
 * field the contractor can select, a Copy button for it, a Copy button for
 * the whole message, and a status line that says what the clipboard did.
 *
 * The copy is deliberate: it says the link is READY, and that nothing was
 * sent. A card that read "Invoice sent" over a link nobody has opened would
 * be the lie this ticket exists to remove.
 */

import type { ShareLink } from '@greenput/shared/models';
import { defineSheet } from '../../styles/sheet.js';
import { el, on, type Cleanup } from '../../lib/dom.js';

export const SHARE_LINK_SHEET = defineSheet(`
/* The card mounts hidden and a display rule would beat the attribute
   (CLAUDE.md §10.4) — without this line every jobs and estimates list
   opened with an empty share card at the top. */
[data-bn-share-link][hidden] {
  display: none;
}
[data-bn-share-link] {
  display: grid;
  gap: var(--gp-space-3);
  padding: var(--gp-space-4);
  margin-block-end: var(--gp-space-4);
  background: var(--gp-surface);
  border: 1px solid var(--gp-rule);
  border-inline-start: 3px solid var(--gp-good-line);
  border-radius: var(--gp-radius-lg);
}
[data-bn-share-link] h3 {
  margin: 0;
  font-size: var(--gp-text-base);
  font-weight: var(--gp-weight-bold);
}
[data-bn-share-link] p { margin: 0; }
[data-bn-share-link] input,
[data-bn-share-link] textarea {
  inline-size: 100%;
  font: inherit;
  font-size: var(--gp-text-sm);
  padding: var(--gp-space-2) var(--gp-space-3);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-md);
  background: var(--gp-surface-sunken, var(--gp-surface));
  color: var(--gp-text);
}
[data-bn-share-link] textarea { min-block-size: 5rem; resize: vertical; }
[data-bn-share-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gp-space-2);
  align-items: center;
}
`);

export interface ShareLinkMount {
  readonly element: HTMLElement;
  /** Show the card for this link, under this heading. */
  show(link: ShareLink, heading: string): void;
  hide(): void;
  dispose(): void;
}

export interface ShareLinkOptions {
  /** Prefix for every `data-testid` inside the card. */
  readonly testId: string;
}

/** What the status line says after each copy attempt. */
export const SHARE_COPY_STATUS = {
  url: 'Link copied. Paste it into your own email or text message.',
  message: 'Message copied. Paste it into your own email or text message.',
  failed:
    'Could not copy automatically — select the text and copy it yourself.',
} as const;

export function mountShareLink(options: ShareLinkOptions): ShareLinkMount {
  const cleanups: Cleanup[] = [];
  const { testId } = options;

  const heading = el('h3', { 'data-testid': `${testId}-heading` });
  const lede = el(
    'p',
    { 'data-bn-secondary': '' },
    'Nothing has been sent. Copy the link or the message below and send it yourself.',
  );
  const urlInput = el('input', {
    type: 'url',
    readonly: true,
    'aria-label': 'Link to share',
    'data-testid': `${testId}-url`,
  }) as HTMLInputElement;
  const messageInput = el('textarea', {
    readonly: true,
    'aria-label': 'Message to share',
    'data-testid': `${testId}-message`,
  }) as HTMLTextAreaElement;
  const copyUrlBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': `${testId}-copy-url`,
    },
    'Copy link',
  );
  const copyMessageBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': `${testId}-copy-message`,
    },
    'Copy message',
  );
  const status = el('output', {
    role: 'status',
    'aria-live': 'polite',
    'data-testid': `${testId}-status`,
  });
  const expiry = el('p', {
    'data-bn-secondary': '',
    'data-testid': `${testId}-expires`,
    hidden: true,
  });

  const element = el(
    'section',
    { 'data-bn-share-link': '', 'data-testid': testId, hidden: true },
    heading,
    lede,
    urlInput,
    el('div', { 'data-bn-share-actions': '' }, copyUrlBtn, copyMessageBtn),
    messageInput,
    expiry,
    status,
  );

  async function copy(
    text: string,
    field: HTMLInputElement | HTMLTextAreaElement,
    okText: string,
  ): Promise<void> {
    try {
      const clipboard =
        typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clipboard) throw new Error('no clipboard');
      await clipboard.writeText(text);
      status.textContent = okText;
    } catch {
      status.textContent = SHARE_COPY_STATUS.failed;
      field.focus();
      field.select();
    }
  }

  cleanups.push(
    on(copyUrlBtn, 'click', () => {
      void copy(urlInput.value, urlInput, SHARE_COPY_STATUS.url);
    }),
    on(copyMessageBtn, 'click', () => {
      void copy(messageInput.value, messageInput, SHARE_COPY_STATUS.message);
    }),
  );

  return {
    element,
    show(link, headingText) {
      heading.textContent = headingText;
      urlInput.value = link.url;
      messageInput.value = link.message;
      status.textContent = '';
      if (link.expiresAt) {
        expiry.textContent = `This link works once and expires ${formatExpiry(link.expiresAt)}.`;
        expiry.removeAttribute('hidden');
      } else {
        expiry.textContent = '';
        expiry.setAttribute('hidden', '');
      }
      element.removeAttribute('hidden');
    },
    hide() {
      element.setAttribute('hidden', '');
    },
    dispose() {
      for (const fn of cleanups) fn();
    },
  };
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
