import { afterEach, describe, expect, it } from 'vitest';
import { el } from '../../lib/dom.js';
import { mountPipeline, onCardAction, onCardMove } from './pipeline.js';

const COLUMNS = [
  { id: 'new', title: 'New' },
  { id: 'won', title: 'Won' },
];

function mount(host: HTMLElement): void {
  mountPipeline(host, {
    id: 'board',
    columns: COLUMNS,
    cards: [
      {
        id: 'c1',
        columnId: 'new',
        title: 'Acme <b>Corp</b>',
        subtitle: 'HVAC',
        status: 'new',
        badge: 'New',
        badgeVariant: 'primary',
      },
      {
        id: 'c2',
        columnId: 'new',
        title: 'Beta',
        description: 'Updated today',
        status: 'new',
        actions: [
          {
            action: 'convert',
            label: 'Convert <i>now</i>',
            testId: 'convert-c2',
          },
        ],
      },
    ],
    emptyMessage: 'Nothing here',
  });
}

function dropEvent(payload: unknown): Event {
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', {
    value: { getData: () => JSON.stringify(payload), dropEffect: 'move' },
  });
  return drop;
}

describe('mountPipeline', () => {
  let host: HTMLElement | null = null;
  afterEach(() => {
    host?.remove();
    host = null;
  });

  it('renders labelled columns with counts and escaped cards', () => {
    host = el('div', {});
    mount(host);
    const columns = host.querySelectorAll('[data-bn="pipeline-column"]');
    expect(columns).toHaveLength(2);
    const fresh = columns[0] as HTMLElement;
    expect(fresh.getAttribute('data-column-id')).toBe('new');
    expect(fresh.getAttribute('aria-labelledby')).toBe('board-column-new');
    expect(fresh.querySelector('#board-column-new')).not.toBeNull();
    expect(
      fresh.querySelector('[data-bn="pipeline-column-count"]')?.textContent,
    ).toBe('2');
    expect(
      columns[1]?.querySelector('[data-bn="pipeline-empty"]')?.textContent,
    ).toBe('Nothing here');

    const card = fresh.querySelector('[data-card-id="c1"]') as HTMLElement;
    expect(card.getAttribute('draggable')).toBe('true');
    expect(card.getAttribute('data-status')).toBe('new');
    expect(
      card.querySelector('[data-bn="pipeline-card-title"]')?.textContent,
    ).toBe('Acme <b>Corp</b>');
    expect(card.querySelector('b')).toBeNull();
    expect(
      card.querySelector('[data-bn="pipeline-card-subtitle"]')?.textContent,
    ).toBe('HVAC');
    const badge = card.querySelector('[data-bn="badge"]');
    expect(badge?.textContent).toBe('New');
    expect(badge?.getAttribute('data-variant')).toBe('primary');
    expect(card.querySelector('[data-bn="pipeline-card-actions"]')).toBeNull();
  });

  it('renders escaped action buttons with test ids set after mount', () => {
    host = el('div', {});
    mount(host);
    const button = host.querySelector(
      '[data-card-id="c2"] [data-bn="pipeline-card-actions"] button',
    ) as HTMLButtonElement;
    expect(button.getAttribute('data-bn')).toBe('button');
    expect(button.getAttribute('data-variant')).toBe('secondary');
    expect(button.getAttribute('data-action')).toBe('convert');
    expect(button.getAttribute('data-testid')).toBe('convert-c2');
    expect(button.textContent).toBe('Convert <i>now</i>');
    expect(button.querySelector('i')).toBeNull();
    expect(button.hasAttribute('data-id')).toBe(false);
  });

  it('rejects action names that could break out of the slot markup', () => {
    host = el('div', {});
    expect(() =>
      mountPipeline(host as HTMLElement, {
        id: 'board',
        columns: COLUMNS,
        cards: [
          {
            id: 'c1',
            columnId: 'new',
            title: 'x',
            actions: [{ action: 'a" onclick="x', label: 'L', testId: 't' }],
          },
        ],
      }),
    ).toThrow(/invalid action name/);
  });

  it('replaces the previous board on re-mount', () => {
    host = el('div', {});
    mount(host);
    mountPipeline(host, { id: 'board', columns: COLUMNS, cards: [] });
    expect(host.querySelectorAll('[data-bn="pipeline"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-bn="pipeline-card"]')).toHaveLength(0);
  });

  it('reports card actions with the owning card id', () => {
    host = el('div', {});
    document.body.append(host);
    mount(host);
    const seen: Array<[string, string]> = [];
    const off = onCardAction(host, (action, cardId) =>
      seen.push([action, cardId]),
    );
    (host.querySelector('[data-testid="convert-c2"]') as HTMLElement).click();
    off();
    (host.querySelector('[data-testid="convert-c2"]') as HTMLElement).click();
    expect(seen).toEqual([['convert', 'c2']]);
  });

  it('reports drops with the target column and a position', () => {
    host = el('div', {});
    document.body.append(host);
    mount(host);
    const moves: Array<{
      cardId: string;
      targetColumnId: string;
      position: number;
    }> = [];
    const off = onCardMove(host, (move) => moves.push(move));
    const wonCards = host.querySelector(
      '[data-column-id="won"] [data-bn="pipeline-column-cards"]',
    ) as HTMLElement;
    wonCards.dispatchEvent(dropEvent({ type: 'pipeline-card', cardId: 'c1' }));
    off();
    wonCards.dispatchEvent(dropEvent({ type: 'pipeline-card', cardId: 'c2' }));
    expect(moves).toEqual([
      { cardId: 'c1', targetColumnId: 'won', position: 0 },
    ]);
  });

  it('moves a card by a click to pick it up and a click in a column to place it', () => {
    host = el('div', {});
    document.body.append(host);
    mount(host);
    const moves: Array<{
      cardId: string;
      targetColumnId: string;
      position: number;
    }> = [];
    const off = onCardMove(host, (move) => moves.push(move));
    const card = host.querySelector('[data-card-id="c1"]') as HTMLElement;
    const status = host.querySelector(
      '[data-bn="pipeline-status"]',
    ) as HTMLElement;

    card.click();
    expect(card.hasAttribute('data-picked')).toBe(true);
    expect(status.textContent).toMatch(/Picked up Acme/);
    expect(moves).toEqual([]);

    (
      host.querySelector(
        '[data-column-id="won"] [data-bn="pipeline-column-cards"]',
      ) as HTMLElement
    ).click();
    expect(card.hasAttribute('data-picked')).toBe(false);
    expect(moves).toEqual([
      { cardId: 'c1', targetColumnId: 'won', position: 0 },
    ]);
    expect(status.textContent).toMatch(/Moved Acme .* to Won/);

    // A second click on the picked card puts it back down.
    card.click();
    card.click();
    expect(card.hasAttribute('data-picked')).toBe(false);
    expect(moves).toHaveLength(1);
    off();
  });

  it('omits the actions slot entirely when a card has no actions', () => {
    host = el('div', {});
    mountPipeline(host, {
      id: 'board',
      columns: COLUMNS,
      cards: [{ id: 'c1', columnId: 'new', title: 'Acme' }],
    });
    expect(
      host.querySelector(
        '[data-card-id="c1"] [data-bn="pipeline-card-actions"]',
      ),
    ).toBeNull();
  });

  /* components 0.11 picks a card up on any click or Enter inside it. A card's
     action buttons are inside it, so without the actions slot holding its
     own events "Convert" would pick the card up and lose Enter to the
     picker. */
  it('keeps a click or Enter on an action button from picking the card up, and lets Escape through', () => {
    host = el('div', {});
    document.body.append(host);
    mount(host);
    const seen: string[] = [];
    const offAction = onCardAction(host, (action) => seen.push(action));
    const offMove = onCardMove(host, () => seen.push('move'));
    const card = host.querySelector('[data-card-id="c2"]') as HTMLElement;
    const button = host.querySelector(
      '[data-testid="convert-c2"]',
    ) as HTMLButtonElement;

    button.click();
    expect(seen).toEqual(['convert']);
    expect(card.hasAttribute('data-picked')).toBe(false);

    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(card.hasAttribute('data-picked')).toBe(false);

    // Escape on the button still cancels a pick made elsewhere on the card.
    card.click();
    expect(card.hasAttribute('data-picked')).toBe(true);
    button.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(card.hasAttribute('data-picked')).toBe(false);
    expect(seen).toEqual(['convert']);
    offAction();
    offMove();
  });
});
