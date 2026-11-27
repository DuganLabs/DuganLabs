/**
 * Kanban board — `@basenative/components` `renderPipeline` mounted into the
 * `el()` tree, with `initPipelineDragDrop` for column moves.
 *
 * renderPipeline produces the whole board: one `<section aria-labelledby>`
 * per column with a header (escaped title plus a card count), the card
 * area, and one draggable `<article data-bn="pipeline-card">` per card with
 * escaped title / subtitle / description and a `renderBadge` status badge —
 * every data field goes through the renderer's own escaping. The `actions`
 * slot is HTML and never receives data: it holds `renderButton` markup that
 * carries only a static `data-action`; the card a click refers to is read
 * back from its `data-card-id`, and test ids are set after mount.
 *
 * Drag-and-drop and the action buttons are handled on a stable host the
 * route owns (`onCardMove`, `onCardAction`), so re-rendering the board on
 * every signal change never re-binds a listener.
 *
 * Since @basenative/components 0.11 `initPipelineDragDrop` also moves cards
 * by select-then-place: a plain click (or Enter/Space) on a card picks it
 * up, a click in a column (or arrow keys, then Enter) drops it, Escape
 * cancels, and a polite live region narrates each step. That is the
 * keyboard/touch path — the "Move to" `<select>` GreenPut used to render in
 * the actions slot is gone. The component decides "picked up" from
 * `closest('[data-card-id]')`, so a click or Enter on a Convert/Qualify
 * button inside the card would pick the card up too (and Enter would be
 * default-prevented, leaving the button keyboard-unreachable). The actions
 * slot therefore stops `click`/`keydown` from bubbling past itself (Escape
 * excepted, so it still cancels a pick), and `onCardAction` listens in the
 * capture phase so it still hears the click.
 */

import {
  initPipelineDragDrop,
  renderButton,
  renderPipeline,
  type PipelineCardMoveEvent,
} from '@basenative/components';
import { escapeText } from '@basenative/runtime/shared/escape';
import { clear, delegate, type Cleanup } from '../../lib/dom.js';
import { fromHtml } from '../../lib/html.js';
import type { BadgeVariant } from './badge.js';

export interface PipelineColumnDefinition {
  readonly id: string;
  /** Escaped by the renderer. */
  readonly title: string;
}

export interface PipelineCardAction {
  /** Static name reported through `onCardAction`; `[a-z][a-z0-9-]*`. */
  readonly action: string;
  /** Button text; escaped here before it enters the HTML slot. */
  readonly label: string;
  readonly testId: string;
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
}

export interface PipelineCardDefinition {
  readonly id: string;
  readonly columnId: string;
  /** Escaped by the renderer. */
  readonly title: string;
  /** Escaped by the renderer. */
  readonly subtitle?: string;
  /** Escaped by the renderer. */
  readonly description?: string;
  /** Emitted as `data-status`; drives the card's start-edge accent. */
  readonly status?: string;
  /** Badge text; escaped by the renderer. */
  readonly badge?: string;
  readonly badgeVariant?: BadgeVariant;
  readonly actions?: readonly PipelineCardAction[];
}

export interface MountPipelineOptions {
  /** Explicit id (prefixes every column heading id) — deterministic for tests. */
  readonly id: string;
  readonly columns: readonly PipelineColumnDefinition[];
  readonly cards: readonly PipelineCardDefinition[];
  /** Shown in a column with no cards; escaped by the renderer. */
  readonly emptyMessage?: string;
}

const ACTION_NAME = /^[a-z][a-z0-9-]*$/;

function actionMarkup(action: PipelineCardAction): string {
  if (!ACTION_NAME.test(action.action)) {
    throw new Error(`mountPipeline: invalid action name "${action.action}"`);
  }
  return renderButton(escapeText(action.label), {
    variant: action.variant ?? 'secondary',
    size: 'sm',
    attrs: `data-action="${action.action}"`,
  });
}

function cardActionsMarkup(card: PipelineCardDefinition): string {
  return card.actions?.length ? card.actions.map(actionMarkup).join('') : '';
}

/**
 * Keep the actions slot's own gestures out of the component's
 * select-then-place path (see the header comment): a click or key on a
 * button in the slot stays in the slot. Escape still bubbles so it cancels
 * a picked card even while a button has focus.
 */
function isolateActions(slot: HTMLElement): void {
  slot.addEventListener('click', (event) => event.stopPropagation());
  slot.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') event.stopPropagation();
  });
}

/** Render the board into `host`, replacing whatever was there. */
export function mountPipeline(
  host: HTMLElement,
  options: MountPipelineOptions,
): void {
  const fragment = fromHtml(
    renderPipeline({
      id: options.id,
      columns: options.columns.map(({ id, title }) => ({ id, title })),
      cards: options.cards.map((card) => ({
        id: card.id,
        columnId: card.columnId,
        title: card.title,
        ...(card.subtitle ? { subtitle: card.subtitle } : {}),
        ...(card.description ? { description: card.description } : {}),
        ...(card.status ? { status: card.status } : {}),
        ...(card.badge ? { badge: card.badge } : {}),
        ...(card.badgeVariant ? { badgeVariant: card.badgeVariant } : {}),
        ...(card.actions?.length ? { actions: cardActionsMarkup(card) } : {}),
      })),
      ...(options.emptyMessage ? { emptyMessage: options.emptyMessage } : {}),
    }),
  );

  // Test ids carry the card id, so they are set on the mounted DOM rather
  // than interpolated into the actions slot.
  const byId = new Map<string, HTMLElement>();
  for (const node of fragment.querySelectorAll<HTMLElement>(
    '[data-bn="pipeline-card"]',
  )) {
    byId.set(node.getAttribute('data-card-id') ?? '', node);
  }
  for (const card of options.cards) {
    const node = byId.get(card.id);
    for (const action of card.actions ?? []) {
      node
        ?.querySelector(`button[data-action="${action.action}"]`)
        ?.setAttribute('data-testid', action.testId);
    }
  }
  for (const slot of fragment.querySelectorAll<HTMLElement>(
    '[data-bn="pipeline-card-actions"]',
  )) {
    isolateActions(slot);
  }

  clear(host);
  host.append(fragment);
}

/**
 * Delegate clicks on a card's `[data-action]` buttons inside `host` to
 * `handler`, with the id of the card the button belongs to. Capture phase:
 * the actions slot stops the click from bubbling (so the component never
 * takes it for a pick-up), and capture is the leg of the trip that still
 * passes through `host`.
 */
export function onCardAction(
  host: HTMLElement,
  handler: (action: string, cardId: string, button: HTMLElement) => void,
): Cleanup {
  return delegate(
    host,
    'click',
    '[data-bn="pipeline-card"] button[data-action]',
    (_event, button) => {
      handler(
        button.getAttribute('data-action') ?? '',
        button.closest('[data-card-id]')?.getAttribute('data-card-id') ?? '',
        button,
      );
    },
    { capture: true },
  );
}

/**
 * Report card moves through the component's handler, bound once on `host`
 * — drag-and-drop, click-to-pick then click-to-place, and the keyboard path
 * all arrive here with the same payload. `position` is the index the card
 * should take in the target column; routes whose API keeps no ordering
 * ignore it.
 */
export function onCardMove(
  host: HTMLElement,
  handler: (move: PipelineCardMoveEvent) => void,
): Cleanup {
  return initPipelineDragDrop(host, { onCardMove: handler }).destroy;
}
