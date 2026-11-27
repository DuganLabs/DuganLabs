-- Delete the owner's discarded test account.
--
-- `owner@example.com` was a hand-made test signup from before the product
-- had a real signup path. It carried a cleartext password (`not-a-real-password`)
-- that the login route would have silently re-hashed on the next sign-in, so
-- the credential stayed live; it owned `ws-001` ("Green Electric Co.",
-- slug `green-electric`) alone, with nothing in it but seed rows.
--
-- Two statements, in this order, on purpose:
--
--   1. Drop the whole workspace when that account is its ONLY member. Every
--      workspace-scoped table is `ON DELETE CASCADE`, so this takes the leads,
--      jobs and customers with it — which matters, because a dozen tables
--      carry `created_by TEXT NOT NULL REFERENCES users(id)` with no ON DELETE
--      clause. Deleting the user first would trip those; deleting the
--      workspace removes parent and children together.
--   2. Delete the account itself, which covers the case where the workspace
--      had other members and so must survive. A no-op after (1).
--
-- Both are idempotent: re-running matches nothing.
DELETE FROM workspaces
WHERE id IN (SELECT workspace_id FROM users WHERE email = 'owner@example.com')
  AND (SELECT COUNT(*) FROM users u WHERE u.workspace_id = workspaces.id) = 1;

DELETE FROM users WHERE email = 'owner@example.com';
