import { describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listFixtureFiles,
  loadFlattenedSeed,
  loadSeedBundle,
  readExpectation,
  readFixture,
} from './seed-loader.ts';

const REPO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const SEED_DIR = join(REPO, 'seeds', 'pricing');
const FIXTURE_DIR = join(SEED_DIR, 'fixtures');

describe('loadSeedBundle', () => {
  const bundle = loadSeedBundle(SEED_DIR);

  it('finds the five machines the design document describes', () => {
    expect(bundle.machines.map((m) => m.slug).sort()).toEqual([
      'circuit-outlet-addition',
      'ev-charger-install',
      'panel-service-upgrade',
      'troubleshooting-callout',
      'whole-home-surge-protection',
    ]);
  });

  it('separates the shared endings from the sub-graph fragments', () => {
    expect(Object.keys(bundle.fragments).sort()).toEqual([
      'panel_check',
      'property_and_contact',
      'wire_run',
    ]);
    expect(bundle.sharedTerminals.length).toBeGreaterThan(0);
  });

  it('loads the rate card with its parts list', () => {
    expect(bundle.rateCard.slug).toBeTruthy();
    expect(
      Object.keys(bundle.rateCard.materials.catalog).length,
    ).toBeGreaterThan(10);
  });
});

describe('loadFlattenedSeed', () => {
  it('leaves no fragment state behind', () => {
    const { machines } = loadFlattenedSeed(SEED_DIR);
    for (const m of machines) {
      expect(
        m.states.some((s) => s.kind === 'fragment'),
        m.slug,
      ).toBe(false);
    }
  });
});

describe('fixtures', () => {
  it('lists the inputs without their expectations', () => {
    const files = listFixtureFiles(FIXTURE_DIR);
    expect(files).toHaveLength(18);
    expect(files.every((f) => !f.endsWith('.expected.json'))).toBe(true);
    expect(files[0]).toBe('01-ev-typical.json');
  });

  it('reads a fixture and its frozen expectation', () => {
    const fx = readFixture(join(FIXTURE_DIR, '01-ev-typical.json'));
    expect(fx.machine).toBe('ev-charger-install');
    expect(fx.answers['charger_location']).toBe('attached_garage_inside');

    const exp = readExpectation(
      join(FIXTURE_DIR, '01-ev-typical.expected.json'),
    );
    expect(exp['terminal']).toBe('T_standard_install');
  });
});
