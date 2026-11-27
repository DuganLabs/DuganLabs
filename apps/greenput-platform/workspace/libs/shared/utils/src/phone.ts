/**
 * Strip non-digits from a phone string. Prepend +1 if it's a US 10-digit number.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 0) {
    return '';
  }

  // Already has country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // US 10-digit number
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Return digits as-is for non-standard lengths
  return digits;
}

/** E.164 allows at most 15 digits, country code included. */
const MAX_E164_DIGITS = 15;

/**
 * A NANP national significant number: exactly 10 digits whose area code is
 * `NXX` — no area code begins with 0 or 1, those digits being reserved for the
 * operator and for long-distance access.
 *
 * The central-office code is `NXX` too, and this deliberately does NOT check
 * it. Two of the six workspace phones on production are 555-1xx-xxxx
 * placeholders, which a correct exchange check would reject — and
 * `/api/auth/otp/recovery/start` guards the recovery channel by comparing
 * `workspaces.phone` against `toE164(input)`, so a stored number this function
 * can no longer produce is a number that guard can never match. Structural
 * plausibility is what we need here; carrier-accurate validity is not, and
 * buying it would cost those two workspaces their published-number guard.
 */
function nanp(nsn: string): string | null {
  if (nsn.length !== 10) return null;
  if (nsn[0] === '0' || nsn[0] === '1') return null;
  return `+1${nsn}`;
}

/**
 * Strict E.164 conversion: returns `+<digits>`, or `null` when the input is
 * not a phone number we are willing to store.
 *
 * `normalizePhone` above is the lenient, display-oriented one — it returns
 * bare digits for anything it does not recognise, so its output is sometimes
 * E.164 and sometimes not. That ambiguity is what broke account recovery:
 * `/api/auth/register` stored "9495550187" while `/api/auth/otp/verify`
 * looked up "+19495550187", and the two never met.
 *
 * Use this wherever a phone number is a *key* — anything a later lookup will
 * match on. Use `normalizePhone` / `formatPhone` for anything a human reads.
 *
 *   toE164('(949) 555-0187')   → '+19495550187'   NANP, 10 digits
 *   toE164('1 949 555 0187')   → '+19495550187'   NANP with country code
 *   toE164('+44 20 7946 0958') → '+442079460958'  E.164 with country code
 *   toE164('001 949 555 0187') → null             dialling prefix, not a number
 *   toE164('020 7946 0958')    → null             trunk prefix, unknown country
 *   toE164('12345')            → null
 *   toE164('')                 → null
 *
 * # IDEMPOTENCE IS THE CONTRACT
 *
 * `toE164(toE164(x)) === toE164(x)` for every input, and that is not a nicety:
 * the product composes this function with itself on the live recovery path.
 * `settings.ts` and `recover.ts` normalise in the browser and POST the RESULT;
 * `otp.ts` normalises again on what arrives. So every output of this function
 * is fed straight back into it, and any input whose output is not a fixed
 * point means the browser and the Worker disagree about which handset the
 * caller asked for — the Worker texting a verification code to a DIFFERENT
 * real number, or answering `400 INVALID_PHONE` for a string this function
 * itself just produced.
 *
 * That is why the output is always `+` followed by 11–15 digits beginning 2–9,
 * or `+1` followed by a 10-digit NANP number. Those are exactly the strings
 * this function maps to themselves. It can never return `+0…`, and it can
 * never return a total of 10 digits — a 10-digit run is claimed by the NANP
 * branch below, so a 10-digit output would collect a second `+1` on the way
 * back through. `phone.spec.ts` sweeps the property exhaustively rather than
 * spot-checking it, because spot-checking it is how it was lost once already.
 *
 * # AMBIGUOUS INPUT IS REJECTED, NOT TRANSLATED
 *
 * A digit run beginning `0` is refused outright. No country code begins with
 * `0`, so such a run is never a valid E.164 number as written — it is a number
 * with a *dialling prefix* still attached, and which prefix we cannot know:
 *
 *   `00` is the ITU-T E.123 international prefix used outside North America,
 *   `011` is the one an American dials, and a single `0` is a national trunk
 *   prefix belonging to some country we have not been told.
 *
 * Translating them needs a country-code table this library does not carry, and
 * guessing is worse than refusing. `0117 496 0958` is a Bristol line, so
 * treating a leading `011` as a prefix invents a handset. Stripping `00` and
 * treating the remainder as complete looks safe and is not: it can return a
 * 10-digit total, which re-normalises to a different country's number and
 * texts the code to a stranger, or a 7–9-digit total, which re-normalises to
 * `null`. Both were live defects. A caller who types a prefix gets
 * `INVALID_PHONE` and the UI's "Include the country code: +1 949 555 0199, or
 * +44 20 7946 0958" (RECOVER_MESSAGES['invalid-phone'] in
 * apps/platform/src/routes/recover/recover.ts, and the recovery-phone field in
 * apps/platform/src/routes/settings/settings.ts), which is an answer they can
 * act on: both remaining refusals — a leading `0` and a run shorter than 11
 * digits — are cured by a country code, and neither by an area code.
 *
 * # WHAT THIS DOES *NOT* PROMISE
 *
 * It does NOT promise that every spelling of every handset in the world maps
 * to one string. Two known cases, both pinned by tests so nobody claims
 * otherwise again, and neither fixable without a country-code table:
 *
 *  1. The trunk zero kept after the country code — the standard UK/German
 *     business-card form — is a SECOND KEY for the same handset:
 *       toE164('+44 20 7946 0958')    → '+442079460958'
 *       toE164('+44 (0)20 7946 0958') → '+4402079460958'   ← same handset
 *     We cannot strip it, because we cannot tell where the country code ends.
 *
 *  2. A leading `+` does not mark the digits as complete: a 10-digit run is
 *     read as NANP either way. So `+9495550777` (an American who left out the
 *     1) converges with `9495550777`, while `+47 22 95 60 00` (Oslo) COLLIDES
 *     with `(472) 295-6000` (North Carolina) — both become '+14722956000'.
 *     Under the UNIQUE index on `users.recovery_phone`, whichever of those two
 *     binds first locks the other out of their own handset.
 *
 * Both predate this function's current form and are unchanged by it. What is
 * true, and what recovery depends on, is (a) idempotence, above, and (b) that
 * every spelling of a NANP handset — bare, `1`-prefixed, `+1`-prefixed,
 * punctuated, spaced — converges on one string.
 */
export function toE164(raw: string): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');

  // North American Numbering Plan, written without the country code. This
  // claims the whole 10-digit space; see the second known limit above.
  if (digits.length === 10) return nanp(digits);

  // Anything else has to carry its own country code, which puts the floor at
  // 11 total digits — 10 is spoken for. A country whose numbers total fewer
  // than 11 digits therefore cannot be stored; refusing it is the honest
  // answer, since accepting it would return a string this function maps to
  // `null` on the next pass.
  if (digits.length < 11 || digits.length > MAX_E164_DIGITS) return null;

  // A dialling prefix, not a number. See above — never translated.
  if (digits.startsWith('0')) return null;

  // Country code 1 is the NANP: exactly 11 digits in total, area code NXX.
  if (digits.startsWith('1')) return nanp(digits.slice(1));

  return `+${digits}`;
}

/**
 * Mask a phone number down to what is safe to show its owner: the last four
 * digits — enough to recognise a number you already know, not enough to dial
 * one you do not. Recovery numbers are never returned in full by the API.
 *
 *   maskPhone('+19495550187') → '••• ••• 0187'
 */
export function maskPhone(phone: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '•••';
  return `••• ••• ${digits.slice(-4)}`;
}

/**
 * Format a phone number to "(555) 123-4567" for US numbers.
 * Expects normalized input (digits only or +1XXXXXXXXXX).
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  // 11 digits starting with 1 → US format
  if (digits.length === 11 && digits.startsWith('1')) {
    const area = digits.slice(1, 4);
    const prefix = digits.slice(4, 7);
    const line = digits.slice(7, 11);
    return `(${area}) ${prefix}-${line}`;
  }

  // 10 digits → US format
  if (digits.length === 10) {
    const area = digits.slice(0, 3);
    const prefix = digits.slice(3, 6);
    const line = digits.slice(6, 10);
    return `(${area}) ${prefix}-${line}`;
  }

  // Non-US: return as-is
  return phone;
}
