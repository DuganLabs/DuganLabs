import { afterEach, describe, expect, it } from 'vitest';
import { clear, delegate, el, on } from './dom.js';

describe('el', () => {
  it('sets string attributes, boolean attributes and skips nullish ones', () => {
    const node = el('button', {
      type: 'button',
      hidden: true,
      disabled: false,
      title: null,
    });
    expect(node.getAttribute('type')).toBe('button');
    expect(node.hasAttribute('hidden')).toBe(true);
    expect(node.hasAttribute('disabled')).toBe(false);
    expect(node.hasAttribute('title')).toBe(false);
  });

  it('stamps Apple 27 control names onto GreenPut buttons, fields and switches', () => {
    const primary = el('button', {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
    });
    expect(primary.getAttribute('data-bn')).toBe('bn-button');
    expect(primary.getAttribute('data-variant')).toBe('prominent');
    expect(primary.getAttribute('data-size')).toBe('large');
    expect(primary.getAttribute('data-label')).toBe('title');

    const danger = el('button', {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'danger',
      'data-bn-size': 'sm',
    });
    expect(danger.getAttribute('data-variant')).toBe('prominent');
    expect(danger.getAttribute('data-destructive')).toBe('true');
    expect(danger.getAttribute('data-size')).toBe('medium');

    const ghost = el('button', {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'quiet',
    });
    expect(ghost.getAttribute('data-variant')).toBe('borderless');

    const field = el('input', { 'data-bn-input': '' });
    expect(field.getAttribute('data-bn')).toBe('bn-field-control');

    const toggle = el('label', { 'data-bn-toggle': '' });
    expect(toggle.getAttribute('data-bn')).toBe('bn-switch');

    const kept = el('a', { 'data-bn': 'button', 'data-bn-button': '' });
    expect(kept.getAttribute('data-bn')).toBe('button');
    expect(kept.hasAttribute('data-variant')).toBe(false);
  });

  it('appends text and node children, skipping falsy ones', () => {
    const node = el('p', {}, 'a', null, el('b', {}, 'b'), false, undefined);
    expect(node.childNodes).toHaveLength(2);
    expect(node.textContent).toBe('ab');
  });
});

describe('clear', () => {
  it('removes every child', () => {
    const node = el('div', {}, 'a', el('span'));
    clear(node);
    expect(node.childNodes).toHaveLength(0);
  });
});

describe('on', () => {
  it('returns a cleanup that removes the listener', () => {
    const node = el('button', { type: 'button' });
    let count = 0;
    const off = on(node, 'click', () => {
      count += 1;
    });
    node.click();
    off();
    node.click();
    expect(count).toBe(1);
  });
});

describe('delegate', () => {
  let root: HTMLElement | null = null;
  afterEach(() => {
    root?.remove();
    root = null;
  });

  it('invokes the handler with the matched ancestor inside the container', () => {
    root = el(
      'div',
      {},
      el(
        'button',
        { type: 'button', 'data-action': 'go' },
        el('span', {}, 'inner'),
      ),
      el('button', { type: 'button' }, 'other'),
    );
    document.body.append(root);
    const seen: string[] = [];
    const off = delegate(root, 'click', '[data-action]', (_event, match) => {
      seen.push(match.getAttribute('data-action') ?? '');
    });

    (root.querySelector('span') as HTMLElement).click();
    (root.lastElementChild as HTMLElement).click();
    expect(seen).toEqual(['go']);

    off();
    (root.querySelector('span') as HTMLElement).click();
    expect(seen).toEqual(['go']);
  });

  it('ignores matches outside the container', () => {
    const outer = el('section', { 'data-action': 'outer' });
    root = el('div', {}, el('button', { type: 'button' }, 'x'));
    outer.append(root);
    document.body.append(outer);
    let calls = 0;
    delegate(root, 'click', '[data-action]', () => {
      calls += 1;
    });
    (root.firstElementChild as HTMLElement).click();
    expect(calls).toBe(0);
    outer.remove();
  });
});
