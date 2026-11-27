-- 012 — normalise workspaces.phone to E.164 for rows already in the database.
--
-- `/api/auth/register` stored the company phone exactly as the contractor
-- typed it ("9495550187", "(949) 555-0187") while every consumer that had to
-- MATCH on a phone number normalised first. Same number, two spellings, and a
-- lookup between them silently missed. The write side is fixed in
-- apps/api/src/routes/auth.ts (toE164 at the point of storage); this is the
-- rows that were written before it was.
--
-- Applied as ONE unit, not per-statement: these are UPDATEs, so there is no
-- "already applied" statement to skip past, and the two should either both
-- land or neither.
--
-- Conservative on purpose. Only two shapes are touched:
--
--   * exactly 10 digits          → +1 prefix (NANP written without it)
--   * exactly 11 digits, leading 1 → + prefix (NANP with it)
--
-- Anything else is left exactly as it is. An 11-digit number that does not
-- start with 1 is more likely a typo than a genuine international line, and a
-- migration is the wrong place to guess; the application layer normalises it
-- on the next write. Any row whose punctuation does not reduce to digits is
-- skipped too, by the GLOB guard — the failure mode is "left alone", never
-- "mangled".
--
-- Both statements are idempotent: the final predicate compares against the
-- value that would be written, so a second run matches nothing.
--
-- ROW COUNTS, counted with these exact predicates against the live databases
-- (SELECT only) on 2026-09-11:
--
--   greenput          7 workspaces — 6 match the 10-digit rule, 0 match the
--                     11-digit rule, 1 has an empty phone and is untouched.
--   greenput-staging  1 workspace  — 1 matches the 10-digit rule.
--
-- No row is deleted, none is skipped by a new constraint (these are UPDATEs,
-- not a table rebuild), and no row's digits change — only its punctuation.
-- "(512) 555-0142" becomes "+15125550142"; "9495550187" becomes
-- "+19495550187".

-- 10 digits, no country code → +1XXXXXXXXXX
UPDATE workspaces
SET phone = '+1' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', '')
WHERE phone <> ''
  AND LENGTH(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', '')) = 10
  AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', '') NOT GLOB '*[^0-9]*'
  AND phone <> '+1' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', '');

-- 11 digits beginning with 1 → +1XXXXXXXXXX
UPDATE workspaces
SET phone = '+' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', '')
WHERE phone <> ''
  AND LENGTH(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', '')) = 11
  AND SUBSTR(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', ''), 1, 1) = '1'
  AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', '') NOT GLOB '*[^0-9]*'
  AND phone <> '+' || REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', ''), '.', ''), '+', '');
