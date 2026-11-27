import { describe, it, expect } from 'vitest';
import {
  FILING_STATUSES,
  FILING_LABELS,
  FILING_SHORT_LABELS,
  MODELLED_FILING_STATUSES,
  bracketsFor,
  isFilingStatus,
  isModelled,
} from '../src/index.js';
import type { FilingStatus } from '../src/types.js';

/**
 * The defect: onboarding offered five filing statuses and the bracket tables
 * carried one, so four of the five silently resolved to MFJ brackets, an MFJ
 * SALT cap and an MFJ-labelled dashboard.
 *
 * These assert the invariant rather than today's answer: whatever
 * `MODELLED_FILING_STATUSES` contains, every member of it must have complete
 * bracket data and every non-member must have none. Publishing 2026 brackets
 * for another status changes the contents and keeps these passing; adding a
 * status to the list without brackets does not.
 */

describe('the storage vocabulary', () => {
  it('is exactly the set the users.filing_status CHECK constraint permits', () => {
    // migrations/0001_init.sql: CHECK (filing_status IN ('single','mfj','mfs','hoh','qw'))
    expect(new Set(FILING_STATUSES)).toEqual(new Set(['single', 'mfj', 'mfs', 'hoh', 'qw']));
  });

  it('labels every status it accepts, in both lengths', () => {
    for (const status of FILING_STATUSES) {
      expect(FILING_LABELS[status], `long label for ${status}`).toBeTruthy();
      expect(FILING_SHORT_LABELS[status], `short label for ${status}`).toBeTruthy();
    }
    expect(Object.keys(FILING_LABELS).sort()).toEqual([...FILING_STATUSES].sort());
    expect(Object.keys(FILING_SHORT_LABELS).sort()).toEqual([...FILING_STATUSES].sort());
  });

  it('recognises its own members and nothing else', () => {
    for (const status of FILING_STATUSES) expect(isFilingStatus(status)).toBe(true);
    for (const other of ['married_jointly', 'head_of_household', 'MFJ', '', null, 7]) {
      expect(isFilingStatus(other), String(other)).toBe(false);
    }
  });
});

describe('what the tax engine can actually compute', () => {
  it('is a subset of the storage vocabulary — never a status the DB rejects', () => {
    for (const status of MODELLED_FILING_STATUSES) {
      expect(FILING_STATUSES, status).toContain(status);
    }
  });

  it('is non-empty — the app is unusable otherwise', () => {
    expect(MODELLED_FILING_STATUSES.length).toBeGreaterThan(0);
  });

  it('holds exactly the statuses with a complete federal + state bracket pair', () => {
    for (const status of FILING_STATUSES) {
      const brackets = bracketsFor(status);
      const listed = MODELLED_FILING_STATUSES.includes(status);
      expect(listed, `${status}: listed as modelled`).toBe(brackets !== null);
      expect(isModelled(status), `${status}: isModelled agrees`).toBe(listed);
    }
  });

  it('never hands back a bracket table belonging to another filing status', () => {
    for (const status of FILING_STATUSES) {
      const brackets = bracketsFor(status);
      if (!brackets) continue;
      for (const bracket of [...brackets.federal, ...brackets.state]) {
        expect(bracket.filingStatus, `${status} bracket`).toBe(status);
      }
    }
  });

  it('returns null — not a fallback — for a status with no brackets', () => {
    const unmodelled = FILING_STATUSES.filter(s => !MODELLED_FILING_STATUSES.includes(s));
    for (const status of unmodelled) {
      expect(bracketsFor(status), status).toBeNull();
    }
  });

  it('gives each modelled status a complete, ordered, gapless bracket ladder', () => {
    for (const status of MODELLED_FILING_STATUSES) {
      const brackets = bracketsFor(status)!;
      for (const [name, table] of [
        ['federal', brackets.federal],
        ['state', brackets.state],
      ] as const) {
        expect(table.length, `${status} ${name} is empty`).toBeGreaterThan(0);
        expect(table[0]!.floor, `${status} ${name} starts at 0`).toBe(0);
        expect(table[table.length - 1]!.ceiling, `${status} ${name} top is open`).toBeNull();
        for (let i = 1; i < table.length; i++) {
          expect(table[i]!.floor, `${status} ${name} bracket ${i} is contiguous`).toBe(
            table[i - 1]!.ceiling,
          );
          expect(table[i]!.rate, `${status} ${name} rates ascend`).toBeGreaterThan(
            table[i - 1]!.rate,
          );
        }
      }
    }
  });
});

describe('the guard callers rely on', () => {
  it('narrows an unknown string safely', () => {
    const fromDb: unknown = 'mfj';
    if (isFilingStatus(fromDb)) {
      const status: FilingStatus = fromDb;
      expect(bracketsFor(status)).not.toBeNull();
    } else {
      throw new Error('mfj should narrow');
    }
  });
});
