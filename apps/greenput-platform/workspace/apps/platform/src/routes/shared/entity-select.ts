/**
 * Shared "pick a row" control (GP-015): a labelled `<select>` whose options
 * come from a list endpoint — the row's human label as the text, its UUID as
 * the value. The New opportunity, New job and New estimate panels used to ask
 * for the linked row as a free-text UUID (or, for opportunities, not at all),
 * so every save was a 400 unless the id had been copied out of the database.
 *
 * The first option is a disabled placeholder that is selected by default, so
 * nothing is chosen by accident and `value()` is `''` until the user picks.
 * The route decides what an empty value means on submit and says so in its
 * own words, the way its title check already does.
 *
 * `source` is either a fetch this control owns — run on `load()`, typically
 * when the panel opens, so the list is fresh each time — or a `Resource` the
 * route already keeps for another reason (the jobs calendar's won deals), in
 * which case the route owns its lifetime and `load()` is a no-op.
 *
 * Styling hooks are `data-bn-*` only; the control is a real `<select>` with
 * a `<label>` (CLAUDE.md rule 15).
 */

import { effect } from '@basenative/runtime';
import { createResource, type Resource } from '@basenative/fetch';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { field } from './field.js';

/** What a list endpoint answers: `ApiResponse<T[]>` minus the meta we ignore. */
export interface EntityList<T> {
  readonly data: T[];
}

export interface EntitySelectArgs<T extends { readonly id: string }> {
  readonly label: string;
  readonly testId: string;
  /** The disabled first option — what the user reads before choosing. */
  readonly placeholder: string;
  /** Plural noun for the loading / empty / error lines: "leads". */
  readonly noun: string;
  /** What each option says. */
  readonly optionLabel: (item: T) => string;
  /** A list fetch this control owns, or a resource the route shares. */
  readonly source: (() => Promise<EntityList<T>>) | Resource<EntityList<T>>;
  /** Shown instead of the loading line when the list came back empty. */
  readonly emptyMessage?: string;
  /**
   * Nothing chosen is a valid answer: the placeholder stays selectable (so a
   * choice can be undone) and the select is not `required`. The job's
   * technician is one — "Unassigned" is what a job starts as (GP-034).
   */
  readonly optional?: boolean;
  readonly onChange?: (id: string, item: T | undefined) => void;
}

export interface EntitySelect<T> {
  /** The `[data-bn-field]` wrapper: label, select and status line. */
  readonly element: HTMLElement;
  readonly select: HTMLSelectElement;
  /** The chosen UUID, or `''` while the placeholder is selected. */
  value(): string;
  /** The chosen row, if it is in the list. */
  selected(): T | undefined;
  /**
   * Choose `id` (or `''` for the placeholder). Remembered across reloads, so
   * an id set before the list arrives is selected once it does.
   */
  set(id: string): void;
  /** Fetch (or refetch) an owned source. A shared resource is left alone. */
  load(): Promise<void>;
  dispose(): void;
}

const ENTITY_SELECT_SHEET = defineSheet(`
[data-bn-entity-select-status] {
  margin: 0;
  font-size: var(--gp-text-xs);
  color: var(--gp-text-muted);
}
[data-bn-entity-select-status][data-bn-tone='error'] {
  color: var(--gp-dead-ink);
}
`);

export function mountEntitySelect<T extends { readonly id: string }>(
  args: EntitySelectArgs<T>,
): EntitySelect<T> {
  adoptSheet(ENTITY_SELECT_SHEET);

  const owned = typeof args.source === 'function';
  const resource: Resource<EntityList<T>> = owned
    ? createResource(args.source as () => Promise<EntityList<T>>, {
        auto: false,
      })
    : (args.source as Resource<EntityList<T>>);

  const select = el('select', {
    'data-bn-input': '',
    'data-bn-entity-select': '',
    'data-testid': args.testId,
    ...(args.optional ? {} : { required: '' }),
  }) as HTMLSelectElement;
  const placeholder = el(
    'option',
    {
      value: '',
      selected: '',
      ...(args.optional ? {} : { disabled: '' }),
    },
    args.placeholder,
  ) as HTMLOptionElement;
  select.append(placeholder);

  const status = el('p', {
    'data-bn-entity-select-status': '',
    role: 'status',
    hidden: true,
  });

  const element = field(args.label, select);
  status.id = `${select.id}-status`;
  select.setAttribute('aria-describedby', status.id);
  element.append(status);

  let current = '';
  let items: T[] = [];

  /** Re-select `current` if the list has it; otherwise the placeholder. */
  function apply(): void {
    if (current && items.some((item) => item.id === current)) {
      select.value = current;
    } else {
      select.selectedIndex = 0;
    }
  }

  function rebuild(): void {
    clear(select);
    select.append(placeholder);
    for (const item of items) {
      select.append(el('option', { value: item.id }, args.optionLabel(item)));
    }
    apply();
  }

  function say(text: string | null, tone: 'error' | null = null): void {
    if (text === null) {
      status.textContent = '';
      status.setAttribute('hidden', '');
      status.removeAttribute('data-bn-tone');
      status.setAttribute('role', 'status');
      return;
    }
    status.textContent = text;
    status.removeAttribute('hidden');
    if (tone) status.setAttribute('data-bn-tone', tone);
    else status.removeAttribute('data-bn-tone');
    status.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  }

  const cleanups: Cleanup[] = [];

  cleanups.push(
    effect(() => {
      const list = resource.data()?.data;
      const loading = resource.loading();
      const err = resource.error();
      items = list ?? [];
      rebuild();
      select.setAttribute('aria-busy', loading ? 'true' : 'false');
      if (loading) {
        say(`Loading ${args.noun}…`);
      } else if (err) {
        say(`Could not load ${args.noun}: ${err.message}`, 'error');
      } else if (list && items.length === 0) {
        say(args.emptyMessage ?? `No ${args.noun} yet.`);
      } else {
        say(null);
      }
    }).dispose,
  );

  cleanups.push(
    on(select, 'change', () => {
      current = select.value;
      args.onChange?.(current, selected());
    }),
  );

  function selected(): T | undefined {
    const id = select.value;
    return id ? items.find((item) => item.id === id) : undefined;
  }

  return {
    element,
    select,
    value: () => select.value,
    selected,
    set(id) {
      current = id;
      apply();
    },
    async load() {
      if (!owned) return;
      await resource.reload();
    },
    dispose() {
      for (const fn of cleanups) fn();
      if (owned) resource.dispose();
    },
  };
}
