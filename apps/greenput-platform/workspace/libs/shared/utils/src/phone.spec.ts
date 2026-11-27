import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhone, toE164, maskPhone } from './phone';

describe('normalizePhone', () => {
  it('strips non-digit characters', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('+15551234567');
  });

  it('prepends +1 for 10-digit US numbers', () => {
    expect(normalizePhone('5551234567')).toBe('+15551234567');
  });

  it('handles 11-digit numbers starting with 1', () => {
    expect(normalizePhone('15551234567')).toBe('+15551234567');
  });

  it('handles +1 prefix already present', () => {
    expect(normalizePhone('+15551234567')).toBe('+15551234567');
  });

  it('returns empty string for empty input', () => {
    expect(normalizePhone('')).toBe('');
  });

  it('returns empty string for non-digit input', () => {
    expect(normalizePhone('abc')).toBe('');
  });

  it('returns digits as-is for non-standard lengths', () => {
    expect(normalizePhone('12345')).toBe('12345');
  });

  it('returns digits as-is for international numbers', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('442079460958');
  });

  it('strips dashes and formats as US number', () => {
    expect(normalizePhone('555-123-4567')).toBe('+15551234567');
  });

  it('strips dots and formats as US number', () => {
    expect(normalizePhone('555.123.4567')).toBe('+15551234567');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizePhone('   ')).toBe('');
  });

  it('handles toll-free numbers', () => {
    expect(normalizePhone('(800) 555-0100')).toBe('+18005550100');
  });

  it('handles 9-digit non-standard number as-is', () => {
    expect(normalizePhone('123456789')).toBe('123456789');
  });

  it('handles 12-digit non-standard number as-is', () => {
    expect(normalizePhone('123456789012')).toBe('123456789012');
  });
});

describe('formatPhone', () => {
  it('formats a normalized US number with +1', () => {
    expect(formatPhone('+15551234567')).toBe('(555) 123-4567');
  });

  it('formats a 10-digit US number', () => {
    expect(formatPhone('5551234567')).toBe('(555) 123-4567');
  });

  it('formats an 11-digit number starting with 1', () => {
    expect(formatPhone('15551234567')).toBe('(555) 123-4567');
  });

  it('returns input as-is for non-US numbers', () => {
    expect(formatPhone('+442079460958')).toBe('+442079460958');
  });

  it('returns input as-is for short numbers', () => {
    expect(formatPhone('12345')).toBe('12345');
  });

  it('returns input as-is for 9-digit numbers', () => {
    expect(formatPhone('123456789')).toBe('123456789');
  });

  // Restored: these four were deleted alongside the toE164 rewrite, which does
  // not touch formatPhone. All four pass against the new code — they went out
  // with the tide, not because they broke — and they are the only coverage of
  // formatPhone's dash, dot, paren and empty inputs.
  it('returns empty string for empty input', () => {
    expect(formatPhone('')).toBe('');
  });

  it('formats dashes-formatted number', () => {
    expect(formatPhone('555-123-4567')).toBe('(555) 123-4567');
  });

  it('formats already-parenthesized number idempotently', () => {
    expect(formatPhone('(555) 123-4567')).toBe('(555) 123-4567');
  });

  it('formats dots-formatted number', () => {
    expect(formatPhone('555.123.4567')).toBe('(555) 123-4567');
  });
});

/* ------------------------------------------------------------------------- *
 * toE164 — the value-level cases first, then the properties.
 *
 * The properties are the point. Everything below the divider is swept rather
 * than spot-checked, because the defect this file exists to prevent got past a
 * value-level suite that looked thorough: a table of five handsets, each of
 * whose canonical strings happened to be a fixed point, while 696,320 other
 * accepted inputs were not.
 * ------------------------------------------------------------------------- */

/** Every spelling of one handset that this function promises to converge. */
const NANP_SPELLINGS: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    '+19495550187',
    [
      '9495550187',
      '19495550187',
      '+19495550187',
      '(949) 555-0187',
      '949-555-0187',
      '949.555.0187',
      ' 949 555 0187 ',
      '+1 (949) 555-0187',
      '1-949-555-0187',
      '+1 949.555.0187',
    ],
  ],
  [
    '+15551234567',
    ['5551234567', '15551234567', '+15551234567', '(555) 123-4567'],
  ],
  ['+18005550100', ['8005550100', '(800) 555-0100', '+1 800 555 0100']],
];

/** Inputs this function refuses, and the reason it refuses them. */
const REJECTED: ReadonlyArray<readonly [string, string]> = [
  ['', 'empty'],
  ['   ', 'whitespace only'],
  ['not a phone', 'no digits'],
  ['12345', 'too short'],
  ['123456789', 'nine digits — too short, and not NANP'],
  ['1234567890123456', 'sixteen digits — longer than E.164 allows'],
  ['0495550187', 'ten digits, area code starts 0'],
  ['1495550187', 'ten digits, area code starts 1'],
  ['020 7946 0958', 'national trunk prefix, country unknown'],
  ['0044 20 7946 0958', 'international dialling prefix 00, still attached'],
  ['001 949 555 0187', 'international dialling prefix 00, still attached'],
  ['0019495550777', 'international dialling prefix 00, still attached'],
  ['011 44 20 7946 0958', 'NANP international dialling prefix 011'],
  ['0117 496 0958', 'a Bristol line — which is why 011 is never stripped'],
  ['119495550187', 'country code 1, area code starts 1'],
  ['109495550187', 'country code 1, area code starts 0'],
  ['1949555018', 'country code 1, ten digits total — wrong length'],
  ['194955501875', 'country code 1, twelve digits total — wrong length'],
  ['+298 123456', 'nine digits total — below the 11-digit floor'],
  ['00298 123456', 'and the same handset written with the prefix'],
];

describe('toE164 — values', () => {
  it('prefixes a bare 10-digit NANP number with +1', () => {
    expect(toE164('9495550187')).toBe('+19495550187');
  });

  it('ignores punctuation and whitespace', () => {
    expect(toE164('(949) 555-0187')).toBe('+19495550187');
    expect(toE164('949.555.0187')).toBe('+19495550187');
    expect(toE164(' 949 555 0187 ')).toBe('+19495550187');
  });

  it('keeps an explicit country code rather than adding another', () => {
    expect(toE164('+19495550187')).toBe('+19495550187');
    expect(toE164('19495550187')).toBe('+19495550187');
  });

  it('accepts international numbers of 11 to 15 digits', () => {
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('+81 3 1234 5678 9')).toBe('+813123456789');
  });

  it.each(REJECTED)('rejects %j — %s', (input) => {
    expect(toE164(input)).toBeNull();
  });

  it.each(NANP_SPELLINGS)(
    'collapses every spelling of %s onto one string',
    (e164, spellings) => {
      for (const spelling of spellings) {
        expect(toE164(spelling), `spelling ${JSON.stringify(spelling)}`).toBe(
          e164,
        );
      }
    },
  );

  it('gives each of those handsets its own string', () => {
    const keys = NANP_SPELLINGS.map(([e164]) => e164);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('agrees with normalizePhone on every number normalizePhone recognises', () => {
    // The two helpers coexist; where the lenient one produces E.164 the
    // strict one must produce the same string, or a value written by one and
    // read by the other misses — which is the recovery bug this replaces.
    for (const input of [
      '9495550187',
      '(949) 555-0187',
      '949-555-0187',
      '19495550187',
      '+19495550187',
      '(800) 555-0100',
    ]) {
      expect(toE164(input)).toBe(normalizePhone(input));
    }
  });

  it('is the stricter of the two — it returns null where normalizePhone guesses', () => {
    expect(normalizePhone('12345')).toBe('12345');
    expect(toE164('12345')).toBeNull();
  });
});

/* ------------------------------------------------------------------------- *
 * The properties, swept.
 * ------------------------------------------------------------------------- */

/**
 * `toE164` as it stood on main before this change, verbatim. Pinned here so
 * the narrowing property below is testable: this change must never map an
 * input to a *different* string than the old function did — only to `null`.
 * That is what makes it safe to deploy against a database the old function
 * wrote, and it is a stronger statement than "the rows we happen to have today
 * still round-trip".
 */
function theOldFunction(raw: string): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Every digit run of length 1..maxLen over `alphabet`. */
function* digitRuns(alphabet: readonly string[], maxLen: number) {
  const buf: string[] = [];
  function* walk(depth: number): Generator<string> {
    if (depth > 0) yield buf.join('');
    if (depth === maxLen) return;
    for (const c of alphabet) {
      buf.push(c);
      yield* walk(depth + 1);
      buf.pop();
    }
  }
  yield* walk(0);
}

/**
 * A deterministic pseudo-random stream of digit runs over all ten digits, at
 * lengths either side of every boundary the function has. Seeded, so a failure
 * reproduces exactly.
 */
function* randomRuns(count: number, seed = 0x2f6e2b1) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < count; i++) {
    const len = 1 + Math.floor(rnd() * 18);
    let run = '';
    for (let j = 0; j < len; j++) run += String(Math.floor(rnd() * 10));
    yield run;
  }
}

/** Everything swept below, as one stream. */
function* everyInput() {
  // Exhaustive over four digits chosen to hit every branch (0 and 1 are the
  // reserved leading digits, 2 and 9 are ordinary), to length 11 — one past
  // the NANP boundary and onto the country-code-1 length check.
  yield* digitRuns(['0', '1', '2', '9'], 11);
  // Exhaustive over ALL ten digits to length 7, so nothing short is assumed.
  yield* digitRuns(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], 7);
  // And 400k random runs over all ten digits at lengths 1..18, which reaches
  // past MAX_E164_DIGITS in both directions.
  yield* randomRuns(400_000);
}

/**
 * One pass over `everyInput()`, collecting a counterexample list per property.
 * Collected in plain JS rather than asserted per input: at ~17 million inputs,
 * calling `expect` inside the loop would take minutes, and the point of the
 * sweep is that it is cheap enough to keep running forever.
 */
function sweep() {
  const notIdempotent: string[][] = [];
  const outOfRange: string[][] = [];
  const remapped: string[][] = [];
  const unclassifiedRejection: string[] = [];
  let accepted = 0;
  let narrowed = 0;

  for (const input of everyInput()) {
    const out = toE164(input);
    const before = theOldFunction(input);

    if (out === null) {
      // Every input this refuses but the old function accepted has to fall in
      // one of the classes the docstring names, all of which the old function
      // turned into a string no carrier could dial.
      if (before !== null) {
        narrowed++;
        const d = input.replace(/\D/g, '');
        const leadingZero = d.startsWith('0');
        const badNanp =
          d.length === 10 ? d[0] === '0' || d[0] === '1' : d.startsWith('1');
        if (!leadingZero && !badNanp && unclassifiedRejection.length < 5) {
          unclassifiedRejection.push(input);
        }
      }
      continue;
    }

    accepted++;

    // Idempotence.
    const twice = toE164(out);
    if (twice !== out && notIdempotent.length < 5) {
      notIdempotent.push([input, out, String(twice)]);
    }

    // The structural range that makes idempotence hold.
    const digits = out.slice(1);
    const shaped =
      out.startsWith('+') &&
      /^[1-9][0-9]*$/.test(digits) &&
      digits.length >= 11 &&
      digits.length <= 15 &&
      (!digits.startsWith('1') ||
        (digits.length === 11 && digits[1] !== '0' && digits[1] !== '1'));
    if (!shaped && outOfRange.length < 5) outOfRange.push([input, out]);

    // Narrowing: an accepted input must mean exactly what it meant before.
    if (before !== out && remapped.length < 5) {
      remapped.push([input, String(before), out]);
    }
  }

  return {
    notIdempotent,
    outOfRange,
    remapped,
    unclassifiedRejection,
    accepted,
    narrowed,
  };
}

const SWEPT = sweep();

describe('toE164 — properties, swept over ~17 million inputs', () => {
  it('is IDEMPOTENT: toE164(toE164(x)) === toE164(x), for every x', () => {
    // The one property the product actually depends on. settings.ts:1933 and
    // recover.ts:278 normalise in the browser and POST the result; otp.ts
    // normalises again on arrival. So every output is fed back in, and a
    // non-fixed point means the Worker texts a code to a handset the caller
    // did not ask for, or 400s on a string this function just produced.
    expect(SWEPT.notIdempotent).toEqual([]);
  });

  it('swept enough accepted inputs for that to mean something', () => {
    // If a future edit makes the function reject almost everything, the
    // property above would pass vacuously. This is the tripwire for that.
    expect(SWEPT.accepted).toBeGreaterThan(2_000_000);
  });

  it('never returns a string outside its own fixed-point range', () => {
    // `+` then 11–15 digits beginning 2–9, or `+1` then a 10-digit NANP
    // number. Never `+0…`, and never a 10-digit total: a 10-digit output
    // would be re-read as a bare NANP number and collect a second `+1`. It is
    // also the exact shape migrations/012's first UPDATE rewrites, so a value
    // of that shape in workspaces.phone would be mangled by a replay.
    expect(SWEPT.outOfRange).toEqual([]);
  });

  it('is STRICTLY NARROWER than the old function — it never remaps, only rejects', () => {
    // No input is newly accepted and no accepted input changes meaning, so
    // this cannot invent a handset, cannot create a collision the old function
    // did not already have, and cannot orphan a row the old function wrote.
    expect(SWEPT.remapped).toEqual([]);
    expect(SWEPT.narrowed).toBeGreaterThan(0);
  });

  it('rejects only inputs the old function turned into an undialable string', () => {
    // `+0…` (no country code begins with 0), or a `+1` number that is not a
    // 10-digit NANP number. Nothing that was ever dialable is newly refused,
    // which is why this ships without a data migration.
    expect(SWEPT.unclassifiedRejection).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- *
 * Known limits, pinned. These are NOT fixed. They are asserted so that the
 * function's real contract stays visible and no future report claims the
 * general property again.
 * ------------------------------------------------------------------------- */

describe('toE164 — known limits, pinned on purpose', () => {
  it('still gives one handset two keys when the trunk zero is kept after the country code', () => {
    // The standard UK/German business-card form. Both are 20 characters or
    // fewer, so both pass `z.string().max(20)` and reach here intact. We
    // cannot strip the zero without knowing where the country code ends, and
    // guessing would invent a handset. The second string is not dialable.
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164('+44 (0)20 7946 0958')).toBe('+4402079460958');
    expect(toE164('+49 (0)30 12345678')).toBe('+4903012345678');
    // Same on main; unchanged by this commit.
    expect(theOldFunction('+44 (0)20 7946 0958')).toBe('+4402079460958');
  });

  it('still reads any 10-digit run as NANP, including other countries’ numbers', () => {
    // A leading `+` does not mark the digits complete, so an Oslo landline and
    // a North Carolina number collide on one key. Under the UNIQUE index on
    // users.recovery_phone, whichever binds first locks the other out.
    expect(toE164('+47 22 95 60 00')).toBe('+14722956000');
    expect(toE164('(472) 295-6000')).toBe('+14722956000');
    expect(toE164('+45 86 12 34 56')).toBe('+14586123456');
    expect(toE164('(458) 612-3456')).toBe('+14586123456');
    // A Danish number, whose national form is 8 digits, is the same misread.
    expect(toE164('+45 32 12 34 56')).toBe('+14532123456');
    // …and its dialled-out spelling is refused rather than given a second key,
    // so the two spellings are not symmetric. That is the price of refusing to
    // guess: the old function accepted both, to '+14532123456' and to
    // '+004532123456', which is two keys for one handset and neither dialable.
    expect(toE164('0045 32 12 34 56')).toBeNull();
    expect(theOldFunction('0045 32 12 34 56')).toBe('+004532123456');

    // The upside of the same rule: an American who omits the 1 converges.
    expect(toE164('+9495550777')).toBe('+19495550777');
    expect(toE164('9495550777')).toBe('+19495550777');
    // Same on main; unchanged by this commit.
    expect(theOldFunction('+47 22 95 60 00')).toBe('+14722956000');
  });

  it('cannot store a country whose numbers total fewer than 11 digits, in EITHER spelling', () => {
    // Symmetry is the point: both spellings of one handset are refused, so no
    // owner can bind one form and then be told the other is unknown. An
    // earlier attempt accepted the 00 form and rejected the + form, which is
    // the lockout this function exists to prevent.
    for (const [plus, zeros] of [
      ['+298 123456', '00298 123456'], // Faroe Islands
      ['+299 12 34 56', '00299 12 34 56'], // Greenland
      ['+376 712 345', '00376 712 345'], // Andorra
      ['+290 22158', '00290 22158'], // Saint Helena
    ]) {
      expect(toE164(plus), plus).toBeNull();
      expect(toE164(zeros), zeros).toBeNull();
    }
  });
});

describe('maskPhone', () => {
  it('reveals only the last four digits', () => {
    expect(maskPhone('+19495550187')).toContain('0187');
  });

  it('does not leak any other digit of the number', () => {
    const masked = maskPhone('+19495550187');
    expect(masked.replace(/\D/g, '')).toBe('0187');
  });

  it('never returns the number it was given', () => {
    expect(maskPhone('+19495550187')).not.toBe('+19495550187');
  });

  it('degrades safely on input too short to mask', () => {
    expect(maskPhone('12').replace(/\D/g, '')).toBe('');
    expect(maskPhone('').replace(/\D/g, '')).toBe('');
  });
});
