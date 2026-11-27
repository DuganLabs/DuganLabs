-- @apply: per-statement
-- 033 — workspaces.service_area, service_radius_miles and service_types
-- (GP-039): the three signup answers that never left the browser.
--
-- The onboarding wizard has always asked where the contractor works (a city
-- or region and a radius in miles) and which services they offer, on a
-- "pick all that apply" grid. POST /api/auth/register stored none of it:
-- `trade` kept the first service picked and the rest were discarded, and the
-- service area and radius were read back on the review step and thrown away.
--
-- service_types is a JSON array of the whole selection, written by
-- /api/auth/register and PATCH /api/workspace. `trade` stays its first entry
-- because apps/tenant-site and the brand card still read `trade`. Every
-- workspace that exists gets '[]', not a backfill from `trade`: `trade` was
-- one of twelve wizard labels or the schema default 'electrical', and
-- promoting either to "the services this contractor offers" would be a guess
-- dressed as data. Settings → Company is where the contractor says so.
--
-- service_area and service_radius_miles are nullable for the same reason:
-- nothing was ever collected for the rows that exist, and NULL is the honest
-- value. The API omits the key when it is NULL.
--
-- Every statement below is one line because per-statement mode splits on
-- newlines.
ALTER TABLE workspaces ADD COLUMN service_area TEXT;
ALTER TABLE workspaces ADD COLUMN service_radius_miles INTEGER;
ALTER TABLE workspaces ADD COLUMN service_types TEXT NOT NULL DEFAULT '[]';
