/**
 * Load `seeds/pricing/` off disk.
 *
 * NODE ONLY, and deliberately not re-exported from `index.ts`: it imports
 * `node:fs`, and the Workers that import the engine must not pull that in. The
 * seed script and this library's own conformance tests import it by path.
 *
 * It exists so that "what a machine looks like once its fragments are inlined"
 * has exactly one definition, shared by the tool that validates the seed and the
 * tests that price it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inlineFragments } from './graph.ts';
import type {
  Answers,
  EnvFacts,
  Fragment,
  Machine,
  RateCard,
  Terminal,
} from './types.ts';

export interface SeedBundle {
  rateCard: RateCard;
  fragments: Record<string, Fragment>;
  sharedTerminals: Terminal[];
  /** Machines exactly as authored, fragments not yet spliced in. */
  machines: Machine[];
}

export interface Fixture {
  machine: string;
  title?: string;
  note?: string;
  answers: Answers;
  env?: EnvFacts;
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

/** Read the rate card, the fragments and every `*.fsm.json` in a seed directory. */
export function loadSeedBundle(seedDir: string): SeedBundle {
  const fragDir = join(seedDir, 'fragments');
  const rateCard = readJson<RateCard>(join(seedDir, 'rate-card.default.json'));
  const fragments: Record<string, Fragment> = {};
  let sharedTerminals: Terminal[] = [];
  for (const f of readdirSync(fragDir).filter((f) => f.endsWith('.json'))) {
    const doc = readJson<Fragment & { kind?: string; terminals?: Terminal[] }>(
      join(fragDir, f),
    );
    if (doc.kind === 'shared_terminals') sharedTerminals = doc.terminals ?? [];
    else fragments[doc.id] = doc;
  }
  const machines = readdirSync(seedDir)
    .filter((f) => f.endsWith('.fsm.json'))
    .sort()
    .map((f) => readJson<Machine>(join(seedDir, f)));
  return { rateCard, fragments, sharedTerminals, machines };
}

/** The same bundle with every machine flattened — the form a published version stores. */
export function loadFlattenedSeed(seedDir: string): {
  rateCard: RateCard;
  machines: Machine[];
} {
  const { rateCard, fragments, sharedTerminals, machines } =
    loadSeedBundle(seedDir);
  return {
    rateCard,
    machines: machines.map((m) =>
      inlineFragments(m, fragments, sharedTerminals),
    ),
  };
}

/** Fixture file names in a seed's `fixtures/` directory, expectations excluded. */
export function listFixtureFiles(fixtureDir: string): string[] {
  return readdirSync(fixtureDir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.expected.json'))
    .sort();
}

export function readFixture(path: string): Fixture {
  return readJson<Fixture>(path);
}

export function readExpectation(path: string): Record<string, unknown> {
  return readJson<Record<string, unknown>>(path);
}
