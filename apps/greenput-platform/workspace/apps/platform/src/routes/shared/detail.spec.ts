import { afterEach, describe, expect, it } from 'vitest';
import { signal } from '@basenative/runtime';
import { el } from '../../lib/dom.js';
import { tick } from '../../test/helpers.js';
import {
  canDeleteRecords,
  mountDetail,
  type DetailEditForm,
  type DetailMount,
  type MountDetailOptions,
} from './detail.js';

interface Thing {
  id: string;
  name: string;
  phone: string;
}

interface Draft {
  name: string;
  phone: string;
}

function form(thing: Thing): DetailEditForm<Draft> {
  const name = el('input', { 'data-testid': 'f-name' }) as HTMLInputElement;
  const phone = el('input', { 'data-testid': 'f-phone' }) as HTMLInputElement;
  name.value = thing.name;
  phone.value = thing.phone;
  return {
    element: el('div', {}, name, phone),
    read: () => ({ name: name.value, phone: phone.value }),
    dispose: () => undefined,
  };
}

interface Harness {
  readonly mount: DetailMount;
  readonly row: ReturnType<typeof signal<Thing | undefined>>;
  readonly loading: ReturnType<typeof signal<boolean>>;
  readonly error: ReturnType<typeof signal<Error | null>>;
  readonly saved: Array<{ row: Thing; draft: Draft }>;
  readonly deleted: Thing[];
}

function build(
  overrides: Partial<MountDetailOptions<Thing, Draft>> = {},
): Harness {
  const row = signal<Thing | undefined>(undefined);
  const loading = signal(false);
  const error = signal<Error | null>(null);
  const saved: Array<{ row: Thing; draft: Draft }> = [];
  const deleted: Thing[] = [];
  const mount = mountDetail<Thing, Draft>({
    id: 'thing-detail',
    noun: 'thing',
    back: { href: '/things', label: 'Things' },
    row,
    loading,
    error,
    heading: (t) => t.name,
    fields: [
      { key: 'name', label: 'Name', value: (t) => t.name },
      {
        key: 'phone',
        label: 'Phone',
        value: (t) => t.phone,
        cell: (t, dd) => {
          dd.textContent = '';
          dd.append(el('strong', {}, `tel ${t.phone}`));
        },
      },
      { key: 'notes', label: 'Notes', value: () => 'n', span: true },
    ],
    buildEditForm: form,
    onSave: async (r, draft) => {
      saved.push({ row: r, draft });
      row.set({ ...r, ...draft });
    },
    canDelete: () => true,
    deleteDescription: (t) => `${t.name} goes away.`,
    onDelete: async (t) => {
      deleted.push(t);
    },
    ...overrides,
  });
  document.body.append(mount.element);
  return { mount, row, loading, error, saved, deleted };
}

function q<T extends Element = HTMLElement>(testid: string): T {
  const node = document.querySelector<T>(`[data-testid="${testid}"]`);
  if (!node) throw new Error(`no ${testid}`);
  return node;
}

/** Present and inside no `[hidden]` ancestor. */
function visible(testid: string): boolean {
  const node = document.querySelector(`[data-testid="${testid}"]`);
  return node !== null && node.closest('[hidden]') === null;
}

describe('mountDetail', () => {
  let mount: DetailMount | null = null;
  afterEach(() => {
    mount?.dispose();
    mount?.element.remove();
    mount = null;
    document
      .querySelectorAll('dialog[data-bn="dialog"]')
      .forEach((node) => node.remove());
  });

  it('shows the loading line until the row arrives, then the fields', async () => {
    const h = build();
    mount = h.mount;
    h.loading.set(true);
    await tick();
    expect(
      mount.element.querySelector('[data-bn-loading]')?.hasAttribute('hidden'),
    ).toBe(false);
    expect(visible('thing-detail-edit')).toBe(false);

    h.row.set({ id: 't1', name: 'Widget', phone: '555' });
    h.loading.set(false);
    await tick();
    expect(
      mount.element.querySelector('[data-bn-loading]')?.hasAttribute('hidden'),
    ).toBe(true);
    expect(q('thing-detail-heading').textContent).toBe('Widget');
    expect(q('thing-detail-back').getAttribute('href')).toBe('/things');
    expect(q('thing-detail-field-name').textContent).toBe('Widget');
    // The decorator replaced the text.
    expect(
      q('thing-detail-field-phone').querySelector('strong')?.textContent,
    ).toBe('tel 555');
    const dts = [...mount.element.querySelectorAll('dl dt')].map(
      (n) => n.textContent,
    );
    expect(dts).toEqual(['Name', 'Phone', 'Notes']);
    expect(
      mount.element
        .querySelector('[data-bn-detail-field="notes"]')
        ?.hasAttribute('data-bn-span'),
    ).toBe(true);
    expect(visible('thing-detail-edit')).toBe(true);
  });

  it('says why the row could not be loaded', async () => {
    const h = build();
    mount = h.mount;
    h.error.set(new Error('Thing not found'));
    await tick();
    const error = q('thing-detail-error');
    expect(error.hasAttribute('hidden')).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe(
      'Could not load this thing: Thing not found',
    );
  });

  it('Edit swaps the fields for a buildPanel form seeded from the row; Save calls onSave and returns to the fields', async () => {
    const h = build();
    mount = h.mount;
    h.row.set({ id: 't1', name: 'Widget', phone: '555' });
    await tick();

    q('thing-detail-edit').click();
    await tick();
    const panel = mount.element.querySelector('[data-bn-panel]');
    expect(panel).not.toBeNull();
    expect(panel?.querySelector('h2')?.textContent).toBe('Edit thing');
    expect(mount.element.querySelector('dl')?.hasAttribute('hidden')).toBe(
      true,
    );
    expect(visible('thing-detail-edit')).toBe(false);
    expect(visible('thing-detail-delete')).toBe(false);
    expect(q<HTMLInputElement>('f-phone').value).toBe('555');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('f-name');

    q<HTMLInputElement>('f-phone').value = '777';
    q('panel-submit').click();
    await tick();
    await tick();

    expect(h.saved).toEqual([
      {
        row: { id: 't1', name: 'Widget', phone: '555' },
        draft: { name: 'Widget', phone: '777' },
      },
    ]);
    expect(mount.element.querySelector('[data-bn-panel]')).toBeNull();
    expect(mount.element.querySelector('dl')?.hasAttribute('hidden')).toBe(
      false,
    );
    expect(q('thing-detail-field-phone').textContent).toBe('tel 777');
    expect(q('thing-detail-notice').textContent).toBe('Changes saved.');
    expect(visible('thing-detail-notice')).toBe(true);
  });

  it('Cancel leaves the row alone', async () => {
    const h = build();
    mount = h.mount;
    h.row.set({ id: 't1', name: 'Widget', phone: '555' });
    await tick();
    q('thing-detail-edit').click();
    await tick();
    q<HTMLInputElement>('f-phone').value = '777';
    q('panel-cancel').click();
    await tick();
    expect(h.saved).toEqual([]);
    expect(mount.element.querySelector('[data-bn-panel]')).toBeNull();
    expect(q('thing-detail-field-phone').textContent).toBe('tel 555');
  });

  it('a rejected onSave keeps the form open with the message in its banner', async () => {
    const h = build({
      onSave: () => Promise.reject(new Error('Phone is taken')),
    });
    mount = h.mount;
    h.row.set({ id: 't1', name: 'Widget', phone: '555' });
    await tick();
    q('thing-detail-edit').click();
    await tick();
    q('panel-submit').click();
    await tick();
    await tick();
    const banner = mount.element.querySelector(
      '[data-bn-panel-form] [data-bn-error]',
    );
    expect(banner?.hasAttribute('hidden')).toBe(false);
    expect(banner?.textContent).toBe('Phone is taken');
    expect(mount.element.querySelector('[data-bn-panel]')).not.toBeNull();
  });

  it('hides Delete unless canDelete says so', async () => {
    const allowed = signal(false);
    const h = build({ canDelete: () => allowed() });
    mount = h.mount;
    h.row.set({ id: 't1', name: 'Widget', phone: '555' });
    await tick();
    expect(visible('thing-detail-delete')).toBe(false);
    allowed.set(true);
    await tick();
    expect(visible('thing-detail-delete')).toBe(true);
  });

  it('Delete asks first, in an alertdialog, and confirming runs onDelete', async () => {
    const h = build();
    mount = h.mount;
    h.row.set({ id: 't1', name: 'Widget', phone: '555' });
    await tick();
    q('thing-detail-delete').click();
    await tick();
    const dialog = document.querySelector('dialog[role="alertdialog"][open]');
    expect(dialog).not.toBeNull();
    expect(
      dialog?.querySelector('#thing-detail-delete-title')?.textContent,
    ).toBe('Delete this thing?');
    expect(
      dialog?.querySelector('#thing-detail-delete-description')?.textContent,
    ).toBe('Widget goes away.');
    expect(h.deleted).toEqual([]);

    q('thing-detail-delete-confirm').click();
    await tick();
    await tick();
    expect(h.deleted).toEqual([{ id: 't1', name: 'Widget', phone: '555' }]);
    expect((dialog as HTMLDialogElement).open).toBe(false);
  });

  it("a refused delete keeps the dialog open and shows the refusal's words", async () => {
    const h = build({
      onDelete: () =>
        Promise.reject(new Error('Cannot delete customer with active jobs')),
    });
    mount = h.mount;
    h.row.set({ id: 't1', name: 'Widget', phone: '555' });
    await tick();
    q('thing-detail-delete').click();
    await tick();
    q('thing-detail-delete-confirm').click();
    await tick();
    await tick();
    const dialog = document.querySelector(
      'dialog[role="alertdialog"]',
    ) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    const error = q('thing-detail-delete-error');
    expect(error.hasAttribute('hidden')).toBe(false);
    expect(error.textContent).toBe('Cannot delete customer with active jobs');
  });

  it('renders the entity’s extra actions and sections, and hides them while editing', async () => {
    const h = build({
      actions: (t) => [
        el(
          'button',
          { type: 'button', 'data-testid': 'act' },
          `Act on ${t.name}`,
        ),
      ],
      sections: (t) => [
        el('section', { 'data-testid': 'sec' }, `More about ${t.name}`),
      ],
    });
    mount = h.mount;
    h.row.set({ id: 't1', name: 'Widget', phone: '555' });
    await tick();
    expect(q('act').textContent).toBe('Act on Widget');
    expect(q('sec').textContent).toBe('More about Widget');

    q('thing-detail-edit').click();
    await tick();
    expect(
      mount.element
        .querySelector('[data-bn-detail-custom-actions]')
        ?.hasAttribute('hidden'),
    ).toBe(true);
    expect(
      mount.element
        .querySelector('[data-bn-detail-sections]')
        ?.hasAttribute('hidden'),
    ).toBe(true);
  });

  it('dispose removes an open confirmation', async () => {
    const h = build();
    mount = h.mount;
    h.row.set({ id: 't1', name: 'Widget', phone: '555' });
    await tick();
    q('thing-detail-delete').click();
    await tick();
    expect(document.querySelector('dialog[role="alertdialog"]')).not.toBeNull();
    mount.dispose();
    mount = null;
    expect(document.querySelector('dialog[role="alertdialog"]')).toBeNull();
  });
});

describe('canDeleteRecords', () => {
  it('is the owner and admins only', () => {
    expect(canDeleteRecords('owner')).toBe(true);
    expect(canDeleteRecords('admin')).toBe(true);
    expect(canDeleteRecords('office')).toBe(false);
    expect(canDeleteRecords('tech')).toBe(false);
    expect(canDeleteRecords(undefined)).toBe(false);
  });
});
