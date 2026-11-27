import { afterEach, describe, expect, it } from 'vitest';
import { el } from '../../lib/dom.js';
import { mountTabs, type TabsMount } from './tabs.js';

function build(onChange: (id: string) => void): TabsMount {
  return mountTabs({
    id: 'view',
    active: 'list',
    tabs: [
      {
        id: 'list',
        label: 'List',
        testId: 'view-list',
        content: el('p', {}, 'list body'),
      },
      {
        id: 'board',
        label: 'Board',
        testId: 'view-board',
        content: el('p', {}, 'board body'),
      },
    ],
    onChange,
  });
}

function tab(mount: TabsMount, id: string): HTMLElement {
  return mount.element.querySelector(`[data-tab="${id}"]`) as HTMLElement;
}

function panelHidden(mount: TabsMount, id: string): boolean {
  return (mount.element.querySelector(`#view-panel-${id}`) as HTMLElement)
    .hidden;
}

describe('mountTabs', () => {
  let mount: TabsMount | null = null;
  afterEach(() => {
    mount?.dispose();
    mount?.element.remove();
    mount = null;
  });

  it('renders an accessible tablist with panels holding the given content', () => {
    mount = build(() => undefined);
    const { element } = mount;
    expect(element.getAttribute('data-bn')).toBe('tabs');
    expect(element.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = element.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('aria-controls')).toBe('view-panel-list');
    expect(tabs[0]?.getAttribute('data-testid')).toBe('view-list');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.getAttribute('tabindex')).toBe('0');
    expect(tabs[1]?.getAttribute('tabindex')).toBe('-1');
    const panels = element.querySelectorAll<HTMLElement>('[role="tabpanel"]');
    expect(panels[0]?.textContent).toBe('list body');
    expect(panels[0]?.hidden).toBe(false);
    expect(panels[1]?.textContent).toBe('board body');
    expect(panels[1]?.hidden).toBe(true);
  });

  it('applies clicks in place and reports them; select() reflects silently', () => {
    const seen: string[] = [];
    mount = build((id) => seen.push(id));
    document.body.append(mount.element);

    tab(mount, 'board').click();
    expect(seen).toEqual(['board']);
    expect(tab(mount, 'board').getAttribute('aria-selected')).toBe('true');
    expect(tab(mount, 'board').getAttribute('tabindex')).toBe('0');
    expect(tab(mount, 'list').getAttribute('tabindex')).toBe('-1');
    expect(panelHidden(mount, 'list')).toBe(true);
    expect(panelHidden(mount, 'board')).toBe(false);

    // The route owns the state and reflects it back without a report.
    mount.select('list');
    expect(seen).toEqual(['board']);
    expect(tab(mount, 'list').getAttribute('aria-selected')).toBe('true');
    expect(panelHidden(mount, 'list')).toBe(false);
    expect(panelHidden(mount, 'board')).toBe(true);
  });

  it('follows the APG keyboard pattern: arrows wrap, Home and End jump', () => {
    const seen: string[] = [];
    mount = build((id) => seen.push(id));
    document.body.append(mount.element);
    const current = mount;
    const press = (key: string): void => {
      (
        current.element.querySelector(
          '[data-bn="tab"][aria-selected="true"]',
        ) as HTMLElement
      ).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    };

    press('ArrowRight'); // list → board
    press('ArrowRight'); // board → list (wraps)
    press('End'); // → board
    press('Home'); // → list
    press('ArrowLeft'); // list → board (wraps)
    expect(seen).toEqual(['board', 'list', 'board', 'list', 'board']);
    expect(tab(mount, 'board').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab(mount, 'board'));
  });

  it('stops handling interaction after dispose', () => {
    const seen: string[] = [];
    mount = build((id) => seen.push(id));
    document.body.append(mount.element);
    mount.dispose();
    tab(mount, 'board').click();
    expect(seen).toEqual([]);
    expect(tab(mount, 'list').getAttribute('aria-selected')).toBe('true');
  });
});
