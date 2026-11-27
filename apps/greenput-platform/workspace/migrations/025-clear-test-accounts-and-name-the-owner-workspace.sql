-- Clear the test debris, and give the owner's account a real workspace.
--
-- A read of `users` on 2026-09-12 found five rows, four of them mine:
--
--   verify1777258180@example.com   VerifyTest                pbkdf2, 0 passkeys
--   probe1777259867@example.com    Probe                     pbkdf2, 0 passkeys
--   deploy-check-20260911@…invalid Deploy Check (delete me)   none,  0 passkeys
--   owner@example.com            GreenPut (no slug)         none,  0 passkeys
--   demo@greenput.com              Rivertown Electric (demo)  none,  0 passkeys
--
-- Not one had ever signed in, and not one had ever enrolled a passkey. The
-- first three are artifacts of verification runs and a deploy smoke check; the
-- two pbkdf2 hashes among them were the last real passwords in the database,
-- which matters because the commit carrying this migration removes password
-- sign-in entirely.
--
-- ORDERING, same as 024: a dozen tables carry
-- `created_by TEXT NOT NULL REFERENCES users(id)` with no ON DELETE clause, so
-- deleting a user before its workspace trips them. Deleting the workspace
-- takes parent and children together through ON DELETE CASCADE.
--
-- Every statement is idempotent: re-running matches nothing.

DELETE FROM workspaces
WHERE id IN (
  SELECT workspace_id FROM users
   WHERE email IN (
     'verify1777258180@example.com',
     'probe1777259867@example.com',
     'deploy-check-20260911@example.invalid'
   )
)
AND (SELECT COUNT(*) FROM users u WHERE u.workspace_id = workspaces.id) = 1;

DELETE FROM users
WHERE email IN (
  'verify1777258180@example.com',
  'probe1777259867@example.com',
  'deploy-check-20260911@example.invalid'
);

-- The owner's own workspace was created by a smoke test: named "GreenPut",
-- with no slug, so it had no micro-site and could not be dogfooded. Name it,
-- and give it a slug so `duganlabs.greenput.com` resolves like any
-- contractor's would (the wildcard route landed in #147).
--
-- Guarded on the slug still being NULL so a rename made from Settings later is
-- never overwritten by a re-run, and on nothing else already holding the slug
-- — `idx_workspaces_slug` (migration 015) is a partial UNIQUE index and would
-- otherwise fail the whole migration.
UPDATE workspaces
SET name  = 'Dugan Labs',
    slug  = 'duganlabs',
    trade = 'general'
WHERE id IN (SELECT workspace_id FROM users WHERE email = 'owner@example.com')
  AND slug IS NULL
  AND NOT EXISTS (SELECT 1 FROM workspaces w2 WHERE w2.slug = 'duganlabs');

-- Belt and braces for the sentence above this file: after it runs, nothing in
-- `users` may hold a usable password. Every account is passkey-only, and the
-- only way back in without one is an OTP to a recovery number (§6.1).
UPDATE users SET password_hash = '' WHERE password_hash <> '';
