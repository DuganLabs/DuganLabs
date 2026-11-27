-- @apply: per-statement
-- 001 — workspaces.slug: per-tenant subdomain label.
ALTER TABLE workspaces ADD COLUMN slug TEXT;
