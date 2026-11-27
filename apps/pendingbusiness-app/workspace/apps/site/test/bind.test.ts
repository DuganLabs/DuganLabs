import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '@basenative/runtime';
import { bindText, bindAttr, bindHidden, bindList, td, tr } from '../src/lib/bind.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('bindText', () => {
  it('writes the signal value into an element by id', () => {
    document.body.innerHTML = '<div id="t"></div>';
    const s = signal('hello');
    bindText('t', s);
    expect(document.getElementById('t')?.textContent).toBe('hello');
    s.set('world');
    expect(document.getElementById('t')?.textContent).toBe('world');
  });

  it('accepts an Element directly', () => {
    const el = document.createElement('div');
    document.body.append(el);
    bindText(el, signal('x'));
    expect(el.textContent).toBe('x');
  });

  it('accepts a plain getter (computed-style)', () => {
    document.body.innerHTML = '<div id="t"></div>';
    const a = signal(2);
    bindText('t', () => `x${a()}`);
    expect(document.getElementById('t')?.textContent).toBe('x2');
    a.set(3);
    expect(document.getElementById('t')?.textContent).toBe('x3');
  });

  it('no-ops when the target id is missing', () => {
    expect(() => bindText('nope', signal('x'))).not.toThrow();
  });
});

describe('bindAttr', () => {
  it('sets an attribute when the value is non-null', () => {
    document.body.innerHTML = '<div id="t"></div>';
    const s = signal<string | null>('error');
    bindAttr('t', 'data-state', s);
    expect(document.getElementById('t')?.getAttribute('data-state')).toBe('error');
    s.set('ok');
    expect(document.getElementById('t')?.getAttribute('data-state')).toBe('ok');
  });

  it('removes the attribute when the value becomes null', () => {
    document.body.innerHTML = '<div id="t" data-state="error"></div>';
    const s = signal<string | null>('error');
    bindAttr('t', 'data-state', s);
    s.set(null);
    expect(document.getElementById('t')?.hasAttribute('data-state')).toBe(false);
  });
});

describe('bindHidden', () => {
  it('toggles the hidden attribute from a boolean signal', () => {
    document.body.innerHTML = '<button id="b">x</button>';
    const s = signal(true);
    bindHidden('b', s);
    expect(document.getElementById('b')?.hasAttribute('hidden')).toBe(true);
    s.set(false);
    expect(document.getElementById('b')?.hasAttribute('hidden')).toBe(false);
  });
});

describe('bindList', () => {
  it('renders one node per item', () => {
    document.body.innerHTML = '<ul id="l"></ul>';
    const items = signal<readonly string[]>(['a', 'b', 'c']);
    bindList('l', items, item => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    });
    expect(document.querySelectorAll('#l > li')).toHaveLength(3);
    expect(document.querySelectorAll('#l > li')[1]?.textContent).toBe('b');
  });

  it('renders the empty fallback when items is []', () => {
    document.body.innerHTML = '<ul id="l"></ul>';
    const items = signal<readonly string[]>([]);
    bindList(
      'l',
      items,
      item => {
        const li = document.createElement('li');
        li.textContent = String(item);
        return li;
      },
      () => {
        const li = document.createElement('li');
        li.textContent = 'empty';
        return li;
      },
    );
    const lis = document.querySelectorAll('#l > li');
    expect(lis).toHaveLength(1);
    expect(lis[0]?.textContent).toBe('empty');
  });

  it('re-renders when the list signal updates', () => {
    document.body.innerHTML = '<ul id="l"></ul>';
    const items = signal<readonly string[]>(['a']);
    bindList('l', items, item => {
      const li = document.createElement('li');
      li.textContent = item;
      return li;
    });
    expect(document.querySelectorAll('#l > li')).toHaveLength(1);
    items.set(['a', 'b']);
    expect(document.querySelectorAll('#l > li')).toHaveLength(2);
  });
});

describe('td()', () => {
  it('creates a <td> with text content', () => {
    const cell = td('hello');
    expect(cell.tagName).toBe('TD');
    expect(cell.textContent).toBe('hello');
    expect(cell.dataset.bn).toBeUndefined();
  });

  it('marks numeric cells with data-bn="num"', () => {
    const cell = td('$42', { num: true });
    expect(cell.dataset.bn).toBe('num');
  });

  it('sets colSpan when given', () => {
    const cell = td('—', { colSpan: 5 });
    expect(cell.colSpan).toBe(5);
  });

  it('stores the column label as data-label for the stacked mobile layout', () => {
    const cell = td('$210,000', { num: true, label: 'Gross / yr' });
    expect(cell.dataset.label).toBe('Gross / yr');
    expect(cell.getAttribute('data-label')).toBe('Gross / yr');
  });

  it('omits data-label when no label is given', () => {
    expect(td('x').hasAttribute('data-label')).toBe(false);
  });
});

describe('tr()', () => {
  it('builds a <tr> from cells', () => {
    const row = tr(td('a'), td('b'), td('1', { num: true }));
    expect(row.tagName).toBe('TR');
    expect(row.children).toHaveLength(3);
    expect(row.children[2]?.getAttribute('data-bn')).toBe('num');
  });
});
