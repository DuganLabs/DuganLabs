/**
 * The convert-to-job panel (GP-037) — one definition, mounted by the
 * `/opportunities` list and by `/opportunities/:id` (GP-003).
 *
 * Converting asks for the schedule first: the job used to be booked for
 * the instant of the click with zero duration, and the only way to fix it
 * was a desktop-only calendar drag. The panel is inline, not gated behind
 * the calendar view, so it works on a phone. The API call happens on
 * submit with an explicit ISO start and end, never on the click alone; a
 * `409 SLOT_TAKEN` keeps the panel open with the API's message (§6.4).
 */

import { signal } from '@basenative/runtime';
import type { Opportunity } from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { el, on, type Cleanup } from '../../lib/dom.js';
import { nextWholeHour, toDateTimeLocal } from '../../lib/datetime.js';
import { buildPanel } from '../shared/panel.js';
import { field as formField } from '../shared/field.js';

/** The convert panel's fields; the two dates are `datetime-local` values. */
export type ConvertFormState = {
  title: string;
  scheduledStart: string;
  scheduledEnd: string;
};

/**
 * Default job length offered by the convert panel — the same two hours the
 * jobs calendar gives a dropped job and the API gives a convert without an
 * end, so every path that creates a job agrees on the duration.
 */
export const DEFAULT_JOB_DURATION_MS = 2 * 60 * 60 * 1000;

export function convertFormFor(opp: Opportunity, now: Date): ConvertFormState {
  const start = nextWholeHour(now);
  const end = new Date(start.getTime() + DEFAULT_JOB_DURATION_MS);
  return {
    title: opp.title,
    scheduledStart: toDateTimeLocal(start),
    scheduledEnd: toDateTimeLocal(end),
  };
}

export type ConvertResult = Awaited<
  ReturnType<PlatformDeps['opportunities']['convert']>
>;

export interface ConvertPanelArgs {
  /** Ran after the API answered; the caller reloads what it shows. */
  readonly onConverted: (
    result: ConvertResult,
    opportunity: Opportunity,
  ) => void | Promise<void>;
  readonly onCancel: () => void;
}

export interface ConvertPanel {
  readonly element: HTMLElement;
  /** Prefill for this opportunity (its title, the next whole hour, two hours). */
  open(opportunity: Opportunity, now?: Date): void;
  dispose(): void;
}

export function mountConvertPanel(
  deps: Pick<PlatformDeps, 'opportunities'>,
  args: ConvertPanelArgs,
): ConvertPanel {
  const form = signal<ConvertFormState>({
    title: '',
    scheduledStart: '',
    scheduledEnd: '',
  });
  const submitting = signal(false);
  const submitError = signal<string | null>(null);
  let current: Opportunity | null = null;
  const cleanups: Cleanup[] = [];

  const fields = el('div', { 'data-bn-field-grid': '' });
  const inputs = new Map<keyof ConvertFormState, HTMLInputElement>();

  const make = (
    label: string,
    key: keyof ConvertFormState,
    testId: string,
    type = 'text',
  ): HTMLElement => {
    const input = el('input', {
      type,
      required: '',
      'data-bn-input': '',
      'data-testid': `opportunities-convert-${testId}`,
    }) as HTMLInputElement;
    inputs.set(key, input);
    cleanups.push(
      on(input, 'input', () => {
        form.set({ ...form.peek(), [key]: input.value });
      }),
    );
    return formField(label, input);
  };

  fields.append(
    make('Job title', 'title', 'title'),
    make('Scheduled start', 'scheduledStart', 'start', 'datetime-local'),
    make('Scheduled end', 'scheduledEnd', 'end', 'datetime-local'),
  );

  const sync = (): void => {
    const f = form.peek();
    for (const [key, input] of inputs) input.value = f[key];
  };

  const submit = async (): Promise<void> => {
    const opportunity = current;
    if (!opportunity) return;
    const f = form.peek();
    for (const input of inputs.values()) input.removeAttribute('aria-invalid');
    const reject = (key: keyof ConvertFormState, message: string): void => {
      submitError.set(message);
      const input = inputs.get(key);
      input?.setAttribute('aria-invalid', 'true');
      input?.focus();
    };
    const start = new Date(f.scheduledStart);
    const end = new Date(f.scheduledEnd);
    if (!f.title.trim()) {
      reject('title', 'Title is required.');
      return;
    }
    if (Number.isNaN(start.getTime())) {
      reject('scheduledStart', 'Scheduled start is required.');
      return;
    }
    if (Number.isNaN(end.getTime())) {
      reject('scheduledEnd', 'Scheduled end is required.');
      return;
    }
    if (end.getTime() <= start.getTime()) {
      reject('scheduledEnd', 'Scheduled end must be after the start.');
      return;
    }
    submitting.set(true);
    submitError.set(null);
    try {
      const result = await deps.opportunities.convert(opportunity.id, {
        title: f.title.trim(),
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
      });
      await args.onConverted(result, opportunity);
    } catch (err) {
      submitError.set(
        err instanceof Error ? err.message : 'Could not convert to a job.',
      );
    } finally {
      submitting.set(false);
    }
  };

  const panel = buildPanel({
    title: 'Convert to job',
    onSubmit: submit,
    onCancel: args.onCancel,
    submitting,
    submitError,
    body: [
      el(
        'p',
        {},
        'When is the work happening? The job is booked for this window.',
      ),
      fields,
    ],
    submitLabel: 'Create job',
    submitTestId: 'opportunities-convert-submit',
    syncForm: sync,
  });

  return {
    element: panel.element,
    open(opportunity, now = new Date()) {
      current = opportunity;
      form.set(convertFormFor(opportunity, now));
      submitError.set(null);
      for (const input of inputs.values()) {
        input.removeAttribute('aria-invalid');
      }
      sync();
    },
    dispose() {
      panel.dispose();
      for (const fn of cleanups) fn();
    },
  };
}
