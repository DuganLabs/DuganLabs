/**
 * Minimal DOM helpers — keeps route templates declarative without pulling
 * in a full templating engine. All output is HTMLElement so routes return
 * `{ element, dispose }` and the shell mounts them directly.
 */

export type Cleanup = () => void;

export interface Mount {
  readonly element: HTMLElement;
  dispose(): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<Record<string, string | boolean | null | undefined>> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (value === true) {
      node.setAttribute(key, '');
      continue;
    }
    node.setAttribute(key, String(value));
  }
  stampPlatformControl(node);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

/**
 * Map GreenPut control hooks onto `@basenative/platform` names so the
 * Apple 27 sheet can paint them. An author-supplied `data-bn` wins.
 */
function stampPlatformControl(node: HTMLElement): void {
  if (node.hasAttribute('data-bn')) return;
  if (node.hasAttribute('data-bn-button')) {
    const variant = node.getAttribute('data-bn-variant');
    node.setAttribute('data-bn', 'bn-button');
    node.setAttribute(
      'data-size',
      node.getAttribute('data-bn-size') === 'sm' ? 'medium' : 'large',
    );
    if (!node.hasAttribute('data-label'))
      node.setAttribute('data-label', 'title');
    if (variant === 'primary') {
      node.setAttribute('data-variant', 'prominent');
    } else if (variant === 'danger') {
      node.setAttribute('data-variant', 'prominent');
      node.setAttribute('data-destructive', 'true');
    } else if (variant === 'ghost' || variant === 'quiet') {
      node.setAttribute('data-variant', 'borderless');
    } else {
      node.setAttribute('data-variant', 'bordered');
    }
    return;
  }
  if (node.hasAttribute('data-bn-input')) {
    node.setAttribute('data-bn', 'bn-field-control');
    return;
  }
  if (node.hasAttribute('data-bn-toggle')) {
    node.setAttribute('data-bn', 'bn-switch');
    return;
  }
  if (node.hasAttribute('data-bn-segmented')) {
    node.setAttribute('data-bn', 'bn-segmented');
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function on<K extends keyof HTMLElementEventMap>(
  target: EventTarget,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): Cleanup {
  target.addEventListener(type, handler as EventListener, options);
  return () =>
    target.removeEventListener(type, handler as EventListener, options);
}

/**
 * Event delegation on a stable container: `handler` runs when the event's
 * target (or an ancestor of it, still inside `container`) matches `selector`.
 * Used for every `@basenative/components` mount so re-rendering a component's
 * children never re-binds listeners.
 */
export function delegate<K extends keyof HTMLElementEventMap>(
  container: Element,
  type: K,
  selector: string,
  handler: (event: HTMLElementEventMap[K], match: HTMLElement) => void,
  options?: AddEventListenerOptions,
): Cleanup {
  return on(
    container,
    type,
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const match = target.closest<HTMLElement>(selector);
      if (match && container.contains(match)) handler(event, match);
    },
    options,
  );
}
