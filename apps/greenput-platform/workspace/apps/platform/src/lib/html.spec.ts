import { describe, expect, it } from 'vitest';
import { elementFromHtml, fromHtml } from './html.js';

describe('fromHtml', () => {
  it('parses a rendered string into a fragment owned by the document', () => {
    const fragment = fromHtml('<span data-bn="badge">A</span><b>B</b>');
    expect(fragment.childNodes).toHaveLength(2);
    expect(fragment.firstElementChild?.ownerDocument).toBe(document);
    expect(fragment.firstElementChild?.getAttribute('data-bn')).toBe('badge');
  });

  it('keeps renderer-escaped text as text', () => {
    const node = elementFromHtml('<span>&lt;b&gt;x&lt;/b&gt;</span>');
    expect(node.textContent).toBe('<b>x</b>');
    expect(node.querySelector('b')).toBeNull();
  });
});

describe('elementFromHtml', () => {
  it('returns the first element of the rendered string', () => {
    const node = elementFromHtml<HTMLParagraphElement>('<p id="p">hi</p>');
    expect(node.tagName).toBe('P');
    expect(node.id).toBe('p');
  });

  it('throws when the renderer produced no element', () => {
    expect(() => elementFromHtml('')).toThrow(/no element/);
    expect(() => elementFromHtml('just text')).toThrow(/no element/);
  });
});
