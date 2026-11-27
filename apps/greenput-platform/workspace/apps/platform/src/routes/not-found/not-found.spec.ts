import { afterEach, describe, expect, it } from 'vitest';
import { renderNotFoundRoute } from './not-found.js';

describe('renderNotFoundRoute', () => {
  let dispose: (() => void) | null = null;

  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it('renders a message and a link back to the dashboard', () => {
    const view = renderNotFoundRoute();
    dispose = view.dispose;
    document.body.append(view.element);

    expect(view.element.querySelector('h1')?.textContent).toMatch(
      /couldn't find that page/i,
    );
    const link = view.element.querySelector('a[href="/dashboard"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toMatch(/dashboard/i);
  });
});
