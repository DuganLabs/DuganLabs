import { afterEach, describe, expect, it } from 'vitest';
import { createResource } from '@basenative/fetch';
import { mountEntitySelect, type EntityList } from './entity-select.js';
import { tick } from '../../test/helpers.js';

type Row = { id: string; name: string };

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function rows(...names: string[]): EntityList<Row> {
  return {
    data: names.map((name, i) => ({ id: i === 0 ? A : B, name })),
  };
}

describe('mountEntitySelect', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
  });

  function mount(
    source: (() => Promise<EntityList<Row>>) | ReturnType<typeof shared>,
    onChange?: (id: string, item: Row | undefined) => void,
  ) {
    const control = mountEntitySelect<Row>({
      label: 'Customer',
      testId: 'pick-customer',
      placeholder: 'Choose a customer',
      noun: 'customers',
      optionLabel: (row) => row.name,
      source,
      ...(onChange ? { onChange } : {}),
    });
    dispose = control.dispose;
    document.body.append(control.element);
    return control;
  }

  function shared(list: EntityList<Row>) {
    return createResource<EntityList<Row>>(() => Promise.resolve(list), {
      auto: false,
    });
  }

  it('is a labelled <select> with a disabled placeholder chosen by default', () => {
    const control = mount(() => Promise.resolve(rows()));
    const label = control.element.querySelector('label');
    expect(label?.textContent).toBe('Customer');
    expect(label?.getAttribute('for')).toBe(control.select.id);
    expect(control.select.getAttribute('data-testid')).toBe('pick-customer');
    expect(control.select.hasAttribute('data-bn-input')).toBe(true);
    expect(control.select.className).toBe('');
    const first = control.select.options[0];
    expect(first?.value).toBe('');
    expect(first?.disabled).toBe(true);
    expect(first?.textContent).toBe('Choose a customer');
    expect(control.value()).toBe('');
    expect(control.selected()).toBeUndefined();
  });

  it('an optional select keeps its placeholder choosable and is not required (GP-034)', async () => {
    const control = mountEntitySelect<Row>({
      label: 'Technician',
      testId: 'pick-tech',
      placeholder: 'Unassigned',
      noun: 'technicians',
      optionLabel: (row) => row.name,
      source: () => Promise.resolve(rows('Bo', 'Cy')),
      optional: true,
    });
    dispose = control.dispose;
    document.body.append(control.element);
    await control.load();
    await tick();
    expect(control.select.hasAttribute('required')).toBe(false);
    const first = control.select.options[0];
    expect(first?.value).toBe('');
    expect(first?.disabled).toBe(false);
    expect(first?.textContent).toBe('Unassigned');
    // Choose someone, then nobody again.
    control.select.value = A;
    control.select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(control.value()).toBe(A);
    control.select.value = '';
    control.select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(control.value()).toBe('');
    expect(control.selected()).toBeUndefined();
  });

  it('lists the rows by label with the UUID as the option value after load()', async () => {
    const control = mount(() =>
      Promise.resolve(rows('Jane Doe', 'Sam Okafor')),
    );
    await control.load();
    await tick();
    const options = [...control.select.options].map((o) => [
      o.value,
      o.textContent,
    ]);
    expect(options).toEqual([
      ['', 'Choose a customer'],
      [A, 'Jane Doe'],
      [B, 'Sam Okafor'],
    ]);
    // Loading finished quietly: no status line, nothing pre-selected.
    expect(
      control.element
        .querySelector('[data-bn-entity-select-status]')
        ?.hasAttribute('hidden'),
    ).toBe(true);
    expect(control.value()).toBe('');
  });

  it('says it is loading, then goes quiet', async () => {
    let resolve: (list: EntityList<Row>) => void = () => undefined;
    const control = mount(
      () =>
        new Promise<EntityList<Row>>((r) => {
          resolve = r;
        }),
    );
    const pending = control.load();
    await tick();
    const status = control.element.querySelector(
      '[data-bn-entity-select-status]',
    );
    expect(status?.hasAttribute('hidden')).toBe(false);
    expect(status?.textContent).toBe('Loading customers…');
    expect(control.select.getAttribute('aria-busy')).toBe('true');
    // Still reachable while it loads — never disabled.
    expect(control.select.disabled).toBe(false);
    resolve(rows('Jane Doe'));
    await pending;
    await tick();
    expect(status?.hasAttribute('hidden')).toBe(true);
    expect(control.select.getAttribute('aria-busy')).toBe('false');
    expect(control.select.options.length).toBe(2);
  });

  it('shows the error in the status line as an alert and keeps the placeholder', async () => {
    const control = mount(() => Promise.reject(new Error('Unauthorized')));
    await control.load();
    await tick();
    const status = control.element.querySelector(
      '[data-bn-entity-select-status]',
    );
    expect(status?.textContent).toBe('Could not load customers: Unauthorized');
    expect(status?.getAttribute('role')).toBe('alert');
    expect(status?.getAttribute('data-bn-tone')).toBe('error');
    expect(control.select.options.length).toBe(1);
    expect(control.value()).toBe('');
  });

  it('says when the list is empty', async () => {
    const control = mount(() => Promise.resolve(rows()));
    await control.load();
    await tick();
    const status = control.element.querySelector(
      '[data-bn-entity-select-status]',
    );
    expect(status?.hasAttribute('hidden')).toBe(false);
    expect(status?.textContent).toBe('No customers yet.');
    expect(status?.getAttribute('role')).toBe('status');
  });

  it('reports a choice through onChange with the row, and value() reads it back', async () => {
    const seen: Array<[string, Row | undefined]> = [];
    const control = mount(
      () => Promise.resolve(rows('Jane Doe', 'Sam Okafor')),
      (id, row) => seen.push([id, row]),
    );
    await control.load();
    await tick();
    control.select.value = B;
    control.select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(seen).toEqual([[B, { id: B, name: 'Sam Okafor' }]]);
    expect(control.value()).toBe(B);
    expect(control.selected()?.name).toBe('Sam Okafor');
  });

  it('set() chooses a row now or once the list arrives, and "" returns to the placeholder', async () => {
    const control = mount(() =>
      Promise.resolve(rows('Jane Doe', 'Sam Okafor')),
    );
    // Before the list is here the placeholder stays; the id is remembered.
    control.set(B);
    expect(control.value()).toBe('');
    await control.load();
    await tick();
    expect(control.value()).toBe(B);
    control.set('');
    expect(control.value()).toBe('');
    expect(control.select.selectedIndex).toBe(0);
    control.set(A);
    expect(control.value()).toBe(A);
  });

  it('keeps the choice across a reload of the list', async () => {
    const control = mount(() =>
      Promise.resolve(rows('Jane Doe', 'Sam Okafor')),
    );
    await control.load();
    await tick();
    control.select.value = A;
    control.select.dispatchEvent(new Event('change', { bubbles: true }));
    await control.load();
    await tick();
    expect(control.value()).toBe(A);
  });

  it('reads a shared resource the route owns and leaves its lifetime alone', async () => {
    const resource = shared(rows('Jane Doe'));
    const control = mount(resource);
    expect(control.select.options.length).toBe(1);
    await resource.reload();
    await tick();
    expect(control.select.options.length).toBe(2);
    // load() is a no-op for a shared resource: nothing fetches twice.
    await control.load();
    control.dispose();
    dispose = null;
    // Still usable by its owner after the select is gone.
    await resource.reload();
    expect(resource.data()?.data.length).toBe(1);
    resource.dispose();
  });
});
