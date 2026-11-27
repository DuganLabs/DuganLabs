/**
 * View tabs — `@basenative/components` `renderTabs` mounted into the `el()`
 * tree and driven by its `initTabs`.
 *
 * renderTabs produces the tablist (real `<button role="tab">` elements wired
 * with aria-controls / aria-labelledby and a roving tabindex) and one
 * `<div role="tabpanel">` per tab. Panel content is an HTML slot, so panels
 * are rendered empty and the app appends its own DOM into each panel after
 * mount. initTabs supplies the WAI-ARIA APG tabs behaviour — click, arrow
 * keys, Home / End, automatic activation — flipping aria-selected / hidden /
 * the roving tabindex in place and reporting user-driven changes through
 * `onChange`, so a route keeps its `view` signal as the source of truth and
 * reflects it back with `select()` from an effect (silent, and a no-op when
 * the DOM already agrees).
 */

import { initTabs, renderTabs } from '@basenative/components';
import { elementFromHtml } from '../../lib/html.js';

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  readonly testId?: string;
  /** Panel content; appended into the rendered tabpanel. */
  readonly content: Node;
}

export interface MountTabsOptions {
  /** Explicit id (prefixes every tab and panel id) — deterministic for tests. */
  readonly id: string;
  readonly tabs: readonly TabDefinition[];
  readonly active: string;
  readonly variant?: 'default' | 'pills';
  /** Reports user-driven changes only; `select()` never fires it. */
  readonly onChange: (id: string) => void;
}

export interface TabsMount {
  readonly element: HTMLElement;
  /** Reflect the active tab in the DOM (aria-selected, hidden, tabindex). */
  select(id: string): void;
  dispose(): void;
}

export function mountTabs(options: MountTabsOptions): TabsMount {
  const element = elementFromHtml(
    renderTabs({
      id: options.id,
      tabs: options.tabs.map(({ id, label }) => ({ id, label })),
      activeTab: options.active,
      variant: options.variant ?? 'pills',
    }),
  );
  const buttons = [
    ...element.querySelectorAll<HTMLButtonElement>('[data-bn="tab"]'),
  ];
  for (const tab of options.tabs) {
    const button = buttons.find((b) => b.getAttribute('data-tab') === tab.id);
    if (button && tab.testId) button.setAttribute('data-testid', tab.testId);
    element
      .querySelector<HTMLElement>(
        `[data-bn="tab-panel"][aria-labelledby="${options.id}-tab-${tab.id}"]`,
      )
      ?.append(tab.content);
  }

  const controller = initTabs(element, {
    onChange: (id) => options.onChange(id),
  });
  controller.select(options.active);

  return {
    element,
    select: (id) => {
      controller.select(id);
    },
    dispose: () => controller.destroy(),
  };
}
