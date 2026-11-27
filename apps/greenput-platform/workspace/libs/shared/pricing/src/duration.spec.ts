import { describe, expect, it } from 'vitest';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DURATION_GRANULARITY_MINUTES,
  MIN_DURATION_MINUTES,
  estimatedDurationMinutes,
} from './duration.ts';
import { evaluate } from './evaluate.ts';
import {
  listFixtureFiles,
  loadFlattenedSeed,
  readFixture,
} from './seed-loader.ts';
import type { Machine, PricedLine, SpanPart } from './types.ts';

function line(
  kind: string,
  qty: number,
  side: PricedLine['side'] = 'both',
): PricedLine {
  return {
    id: `${kind}-${qty}`,
    label: kind,
    kind,
    qty,
    cost: 1,
    detail: '',
    side,
  };
}

function part(id: string, lines: PricedLine[]): SpanPart {
  return {
    id,
    title: id,
    lines,
    point: 0,
    pointHigh: 0,
    spread: 0,
    uncapped: 0,
    cap: 0,
    reasons: [],
    low: 0,
    high: 0,
    minimum_applied: false,
  };
}

describe('estimatedDurationMinutes', () => {
  it.each([
    {
      name: 'sums labour hours',
      lines: [line('labour', 1.5), line('labour', 0.5)],
      minutes: 120,
    },
    {
      name: 'counts high_only labour',
      lines: [line('labour', 1.5), line('labour', 1, 'high_only')],
      minutes: 150,
    },
    {
      name: 'ignores every other kind',
      lines: [
        line('labour', 1),
        line('material', 40),
        line('fee', 2),
        line('adjustment', 1.2),
      ],
      minutes: 60,
    },
    {
      name: 'rounds up to the half hour',
      lines: [line('labour', 1.25)],
      minutes: 90,
    },
    {
      name: 'a whole half hour stays put',
      lines: [line('labour', 2.5)],
      minutes: 150,
    },
    { name: 'floors at 30 minutes', lines: [line('labour', 0.1)], minutes: 30 },
    { name: 'no lines at all is the floor', lines: [], minutes: 30 },
    {
      name: 'a non-positive qty is not time',
      lines: [line('labour', -2), line('labour', 0.5)],
      minutes: 30,
    },
  ])('$name', ({ lines, minutes }) => {
    expect(estimatedDurationMinutes({ lines })).toBe(minutes);
  });

  it('takes the longest part of a span', () => {
    const spans = [
      part('easy', [line('labour', 2)]),
      part('hard', [line('labour', 3), line('labour', 0.25, 'high_only')]),
    ];
    expect(estimatedDurationMinutes({ spans })).toBe(210);
  });

  it('an empty span list falls back to the lines', () => {
    expect(
      estimatedDurationMinutes({ spans: [], lines: [line('labour', 1)] }),
    ).toBe(60);
  });

  it('constants agree with the slot grid', () => {
    expect(MIN_DURATION_MINUTES).toBe(30);
    expect(DURATION_GRANULARITY_MINUTES).toBe(30);
  });
});

describe('estimatedDurationMinutes over the real engine output', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const SEED_DIR = resolve(HERE, '..', '..', '..', '..', 'seeds', 'pricing');
  const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
  const FIXTURE_DIR = join(SEED_DIR, 'fixtures');
  const fixtures = listFixtureFiles(FIXTURE_DIR).map((file) => ({
    name: basename(file),
    f: readFixture(join(FIXTURE_DIR, file)),
  }));

  it.each(fixtures)(
    '$name books a positive half-hour multiple no shorter than its labour',
    ({ f }) => {
      const machine = machines.find((m) => m.slug === f.machine) as Machine;
      const result = evaluate(machine, rateCard, f.answers, f.env ?? {});
      const minutes = estimatedDurationMinutes(result);
      expect(minutes).toBeGreaterThanOrEqual(30);
      expect(minutes % 30).toBe(0);
      const parts = result.spans?.length
        ? result.spans.map((p) => p.lines)
        : [result.lines ?? []];
      const longest = Math.max(
        ...parts.map((lines) =>
          lines
            .filter((l) => l.kind === 'labour')
            .reduce((s, l) => s + l.qty, 0),
        ),
      );
      expect(minutes).toBeGreaterThanOrEqual(longest * 60);
      // Never more than one grid step over the labour — unless the floor
      // applied because the outcome (a refusal, an urgent one) has no labour.
      if (minutes > MIN_DURATION_MINUTES) {
        expect(minutes - longest * 60).toBeLessThan(30);
      }
    },
  );
});
