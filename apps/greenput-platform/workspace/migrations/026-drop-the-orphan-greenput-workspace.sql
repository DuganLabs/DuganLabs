-- Migration 026: drop the orphan "GreenPut" workspace.
--
-- Production carries a workspace named "GreenPut" with no slug and NO users
-- (id 1a73c108-…). It is the leak the signup batch in apps/api/src/routes/
-- auth.ts now prevents: a workspace row that committed before its users
-- insert failed. Nothing can sign into it, nothing references it, and it
-- shares a name with the product — which is exactly how it would get pointed
-- at by mistake (GP-005 nearly did: the contact form's slug lookup would
-- have found "a GreenPut workspace" and then failed on WORKSPACE_NOT_READY
-- because the row has nobody to attribute a lead to).
--
-- Deletes every workspace that has no slug AND no users. A real workspace
-- always has its owner; the demo tenant has `demo` and its owner; the
-- owner's own workspace has `duganlabs` and its owner (migration 025). The
-- children cascade (ON DELETE CASCADE on workspace_id throughout schema.sql),
-- and there is no `created_by` to orphan because there were never any users
-- to create anything.
DELETE FROM workspaces
WHERE slug IS NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.workspace_id = workspaces.id);
