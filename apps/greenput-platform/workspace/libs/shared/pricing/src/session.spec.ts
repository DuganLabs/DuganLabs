import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coerceScreenAnswers,
  estimateKeyFor,
  photoStatusKeyFor,
  step,
} from './session.ts';
import { evaluate } from './evaluate.ts';
import {
  listFixtureFiles,
  loadFlattenedSeed,
  readFixture,
} from './seed-loader.ts';
import type { Answers, AnswerSpec, Machine, State } from './types.ts';

const REPO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const SEED_DIR = join(REPO, 'seeds', 'pricing');
const FIXTURE_DIR = join(SEED_DIR, 'fixtures');

const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const ev = machines.find((m) => m.slug === 'ev-charger-install') as Machine;

describe('step', () => {
  it('opens an EV quote on the charger-location screen', () => {
    const s = step(ev, rateCard, {});
    expect(s.status).toBe('question');
    if (s.status !== 'question') throw new Error('unreachable');
    expect(s.screen.stateId).toBe('charger_location');
    expect(s.screen.ask?.question).toBe('Where do you want the charger?');
    expect(s.screen.answer.type).toBe('choice');
    expect(s.screen.typicalTotal).toBe(9);
  });

  it('advances one screen at a time, and never re-asks an answered one', () => {
    const answers: Answers = {};
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      const s = step(ev, rateCard, answers);
      if (s.status === 'complete') break;
      expect(seen).not.toContain(s.screen.stateId);
      seen.push(s.screen.stateId);
      // Answer with whatever the fixture would have said.
      const fixture = readFixture(join(FIXTURE_DIR, '01-ev-typical.json'));
      const coerced = coerceScreenAnswers(
        {
          id: s.screen.stateId,
          kind: 'question',
          answer: s.screen.answer,
        } as State,
        fixtureInputFor(s.screen.stateId, fixture.answers, s.screen.answer),
      );
      expect(
        coerced.ok,
        `${s.screen.stateId}: ${JSON.stringify(coerced)}`,
      ).toBe(true);
      if (!coerced.ok) break;
      Object.assign(answers, coerced.answers);
    }
    expect(seen.length).toBeGreaterThan(5);
  });

  it('ends on the same price the one-shot evaluator produces', () => {
    const fixture = readFixture(join(FIXTURE_DIR, '01-ev-typical.json'));
    const s = step(ev, rateCard, fixture.answers, fixture.env ?? {});
    expect(s.status).toBe('complete');
    if (s.status !== 'complete') throw new Error('unreachable');
    const direct = evaluate(ev, rateCard, fixture.answers, fixture.env ?? {});
    expect(s.result.low).toBe(direct.low);
    expect(s.result.high).toBe(direct.high);
    expect(s.result.terminal).toBe(direct.terminal);
  });

  it('finishes every fixture without ever pausing on an answered screen', () => {
    for (const file of listFixtureFiles(FIXTURE_DIR)) {
      const fixture = readFixture(join(FIXTURE_DIR, file));
      const machine = machines.find(
        (m) => m.slug === fixture.machine,
      ) as Machine;
      const s = step(machine, rateCard, fixture.answers, fixture.env ?? {});
      expect(s.status, file).toBe('complete');
    }
  });
});

/** Build the form input a screen would have received, from a fixture's answers. */
function fixtureInputFor(
  stateId: string,
  answers: Answers,
  spec: { type: string; key?: string; fields?: Array<{ key: string }> },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys =
    spec.type === 'group'
      ? (spec.fields ?? []).map((f) => f.key)
      : [spec.key as string];
  for (const key of keys) {
    const value = answers[key];
    if (spec.type === 'photo') {
      out[photoStatusKeyFor(key)] = 'unreviewed';
      out[key] = value ?? { status: 'missing' };
    } else if (value && typeof value === 'object' && 'estimated' in value) {
      out[estimateKeyFor(key)] = String((value as { value: number }).value);
    } else {
      out[key] = value;
    }
  }
  void stateId;
  return out;
}

describe('coerceScreenAnswers', () => {
  const choiceSpec: AnswerSpec = {
    type: 'choice',
    key: 'colour',
    options: [
      { value: 'red', label: 'Red' },
      { value: 'blue', label: 'Blue' },
    ],
  };
  const choice: State = {
    id: 'c',
    kind: 'question',
    answer: choiceSpec,
    next: [],
  };

  it('accepts a listed option and rejects anything else', () => {
    expect(coerceScreenAnswers(choice, { colour: 'red' })).toEqual({
      ok: true,
      answers: { colour: 'red' },
    });
    const bad = coerceScreenAnswers(choice, { colour: 'chartreuse' });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('unreachable');
    expect(bad.errors[0].key).toBe('colour');
  });

  it('falls back to a declared default rather than erroring on silence', () => {
    const withDefault: State = {
      ...choice,
      answer: { ...choiceSpec, default: 'blue' },
    };
    expect(coerceScreenAnswers(withDefault, {})).toEqual({
      ok: true,
      answers: { colour: 'blue' },
    });
  });

  it('keeps a multi-choice answer as an array, dropping values nothing declared', () => {
    const multi: State = {
      id: 'm',
      kind: 'question',
      answer: {
        type: 'multi_choice',
        key: 'loads',
        options: [
          { value: 'dryer', label: 'Dryer' },
          { value: 'ac', label: 'AC' },
        ],
      },
      next: [],
    };
    expect(
      coerceScreenAnswers(multi, { loads: ['dryer', 'invented'] }),
    ).toEqual({
      ok: true,
      answers: { loads: ['dryer'] },
    });
    // "None of these" is a real answer, and must be recorded so the screen
    // does not ask again.
    expect(coerceScreenAnswers(multi, {})).toEqual({
      ok: true,
      answers: { loads: [] },
    });
  });

  it('marks a ladder answer estimated, and a typed one not', () => {
    const measure: State = {
      id: 'd',
      kind: 'question',
      answer: {
        type: 'measurement',
        key: 'run_distance_ft',
        min: 1,
        max: 400,
        estimate_options: [
          { value: 35, label: 'Across the garage', estimated: true },
        ],
      },
      next: [],
    };
    expect(coerceScreenAnswers(measure, { run_distance_ft: '25' })).toEqual({
      ok: true,
      answers: { run_distance_ft: 25 },
    });
    expect(
      coerceScreenAnswers(measure, {
        [estimateKeyFor('run_distance_ft')]: '35',
      }),
    ).toEqual({
      ok: true,
      answers: { run_distance_ft: { value: 35, estimated: true } },
    });
  });

  it('rejects a measurement outside the range the screen declares', () => {
    const measure: State = {
      id: 'd',
      kind: 'question',
      answer: { type: 'measurement', key: 'ft', min: 1, max: 400 },
      next: [],
    };
    expect(coerceScreenAnswers(measure, { ft: '900' }).ok).toBe(false);
    expect(coerceScreenAnswers(measure, { ft: 'about forty' }).ok).toBe(false);
  });

  it('validates the contact group field by field', () => {
    const group: State = {
      id: 'g',
      kind: 'question',
      answer: {
        type: 'group',
        fields: [
          {
            key: 'service_zip',
            type: 'zip',
            label: 'ZIP code',
            required: true,
          },
          {
            key: 'first_name',
            type: 'text',
            label: 'First name',
            required: true,
          },
          {
            key: 'last_name',
            type: 'text',
            label: 'Last name',
            required: false,
          },
          { key: 'email', type: 'email', label: 'Email', required: false },
          {
            key: 'phone',
            type: 'phone',
            label: 'Mobile number',
            required: true,
          },
        ],
      },
      next: [],
    };
    const ok = coerceScreenAnswers(group, {
      service_zip: '78704',
      first_name: 'Dana',
      last_name: '',
      email: '',
      phone: '512-555-0134',
    });
    expect(ok).toEqual({
      ok: true,
      answers: {
        service_zip: '78704',
        first_name: 'Dana',
        last_name: '',
        email: '',
        phone: '512-555-0134',
      },
    });

    const bad = coerceScreenAnswers(group, {
      service_zip: '787',
      first_name: '',
      phone: '123',
      email: 'not-an-email',
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('unreachable');
    expect(bad.errors.map((e) => e.key).sort()).toEqual([
      'email',
      'first_name',
      'phone',
      'service_zip',
    ]);
  });

  it('records a skipped photo as a real answer, so the form moves on', () => {
    const photo: State = {
      id: 'p',
      kind: 'question',
      answer: {
        type: 'photo',
        key: 'panel_photo',
        skippable: true,
        interpretation: { status_key: 'photo_status', fields: {} },
      },
      next: [],
    };
    expect(coerceScreenAnswers(photo, {})).toEqual({
      ok: true,
      answers: { panel_photo: { status: 'missing', fields: {} } },
    });
    expect(
      coerceScreenAnswers(photo, {
        [photoStatusKeyFor('panel_photo')]: 'unreviewed',
      }),
    ).toEqual({
      ok: true,
      answers: { panel_photo: { status: 'unreviewed', fields: {} } },
    });
  });

  it('keeps a structured photo answer but reduces it to presence', () => {
    const photo: State = {
      id: 'p',
      kind: 'question',
      answer: {
        type: 'photo',
        key: 'panel_photo',
        interpretation: { status_key: 'photo_status', fields: {} },
      },
      next: [],
    };
    // What the upload path hands back: a file is with us, nothing read yet.
    expect(
      coerceScreenAnswers(photo, {
        panel_photo: { status: 'unreviewed', photos: [{ url: '/x.jpg' }] },
      }),
    ).toEqual({
      ok: true,
      answers: { panel_photo: { status: 'unreviewed', fields: {} } },
    });
  });

  it('refuses a verdict, or fields, asserted by whoever sent the request', () => {
    const photo: State = {
      id: 'p',
      kind: 'question',
      answer: {
        type: 'photo',
        key: 'panel_photo',
        interpretation: {
          status_key: 'photo_status',
          fields: {
            panel_capacity: {
              type: 'enum',
              default_when_missing: 'unknown',
            },
          },
        },
      },
      next: [],
    };

    // The attack this closes: `panel_capacity: 'spare_capable'` is the cheap
    // path, and it is a licensed electrician's reading of an image — not
    // something a form post gets to declare about its own panel. Both the
    // status and the fields are dropped; the server's row supplies them.
    expect(
      coerceScreenAnswers(photo, {
        panel_photo: {
          status: 'reviewed',
          fields: { panel_capacity: 'spare_capable' },
        },
      }),
    ).toEqual({
      ok: true,
      answers: { panel_photo: { status: 'missing', fields: {} } },
    });

    expect(
      coerceScreenAnswers(photo, {
        [photoStatusKeyFor('panel_photo')]: 'reviewed',
      }),
    ).toEqual({
      ok: true,
      answers: { panel_photo: { status: 'missing', fields: {} } },
    });
  });
});
