import { afterEach, describe, expect, it } from 'vitest';
import type { Opportunity } from '@greenput/shared/models';
import {
  DEFAULT_JOB_DURATION_MS,
  convertFormFor,
  mountConvertPanel,
} from './convert.js';
import {
  buildTestDeps,
  createFakeFetch,
  jsonResponse,
  tick,
} from '../../test/helpers.js';

function opp(partial: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'o2',
    leadId: 'l1',
    title: 'Panel upgrade',
    status: 'won',
    value: 250000,
    serviceType: 'Electrical',
    notes: '',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    createdBy: 'u1',
    ...partial,
  };
}

function q<T extends Element = HTMLElement>(testid: string): T {
  const node = document.querySelector<T>(`[data-testid="${testid}"]`);
  if (!node) throw new Error(`no ${testid}`);
  return node;
}

function setValue(testid: string, value: string): void {
  const input = q<HTMLInputElement>(testid);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('convertFormFor', () => {
  it('prefills the title, the next whole hour and a two-hour window', () => {
    const now = new Date(2026, 4, 1, 9, 17);
    const form = convertFormFor(opp(), now);
    expect(form.title).toBe('Panel upgrade');
    expect(form.scheduledStart).toBe('2026-05-01T10:00');
    expect(form.scheduledEnd).toBe('2026-05-01T12:00');
    expect(DEFAULT_JOB_DURATION_MS).toBe(2 * 60 * 60 * 1000);
  });
});

describe('mountConvertPanel', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
  });

  function mount(fake = createFakeFetch()) {
    const deps = buildTestDeps({ fetch: fake.fetch });
    const converted: unknown[] = [];
    let cancelled = 0;
    const panel = mountConvertPanel(deps, {
      onConverted: (result) => {
        converted.push(result);
      },
      onCancel: () => {
        cancelled += 1;
      },
    });
    dispose = panel.dispose;
    document.body.append(panel.element);
    return { fake, panel, converted, cancelled: () => cancelled };
  }

  it('open() prefills the inputs, and submit posts ISO start and end for that opportunity', async () => {
    const { fake, panel, converted } = mount();
    fake.respond('/api/opportunities/o2/convert', () =>
      jsonResponse({
        data: { jobId: 'j9', customerId: 'c1', jobNumber: '#1009' },
      }),
    );
    panel.open(opp(), new Date(2026, 4, 1, 9, 17));
    expect(q<HTMLInputElement>('opportunities-convert-title').value).toBe(
      'Panel upgrade',
    );
    expect(q<HTMLInputElement>('opportunities-convert-start').value).toBe(
      '2026-05-01T10:00',
    );
    expect(q<HTMLInputElement>('opportunities-convert-start').type).toBe(
      'datetime-local',
    );

    setValue('opportunities-convert-title', 'Panel upgrade — Smith');
    setValue('opportunities-convert-start', '2026-05-01T09:00');
    setValue('opportunities-convert-end', '2026-05-01T11:00');
    q('opportunities-convert-submit').click();
    await tick();
    await tick();

    const call = fake.calls.find((c) => c.method === 'POST');
    expect(call?.url).toBe('/api/opportunities/o2/convert');
    expect(call?.body).toEqual({
      title: 'Panel upgrade — Smith',
      scheduledStart: new Date('2026-05-01T09:00').toISOString(),
      scheduledEnd: new Date('2026-05-01T11:00').toISOString(),
    });
    expect(converted).toHaveLength(1);
  });

  it('refuses an end at or before the start without posting', async () => {
    const { fake, panel, converted } = mount();
    panel.open(opp());
    setValue('opportunities-convert-start', '2026-05-01T11:00');
    setValue('opportunities-convert-end', '2026-05-01T11:00');
    q('opportunities-convert-submit').click();
    await tick();
    expect(fake.calls).toHaveLength(0);
    expect(converted).toHaveLength(0);
    expect(
      document.querySelector('[data-bn-panel-form] [data-bn-error]')
        ?.textContent,
    ).toBe('Scheduled end must be after the start.');
    expect(q('opportunities-convert-end').getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it("keeps the panel open with the API's message when the slot is taken", async () => {
    const { fake, panel, converted } = mount();
    fake.respond('/api/opportunities/o2/convert', () =>
      jsonResponse(
        {
          error: {
            code: 'SLOT_TAKEN',
            message: 'That time just went — pick another',
          },
        },
        { status: 409 },
      ),
    );
    panel.open(opp());
    q('opportunities-convert-submit').click();
    await tick();
    await tick();
    expect(converted).toHaveLength(0);
    expect(
      document.querySelector('[data-bn-panel-form] [data-bn-error]')
        ?.textContent,
    ).toBe('That time just went — pick another');
  });

  it('Cancel reports to the caller', () => {
    const { panel, cancelled } = mount();
    panel.open(opp());
    q('panel-cancel').click();
    expect(cancelled()).toBe(1);
  });
});
