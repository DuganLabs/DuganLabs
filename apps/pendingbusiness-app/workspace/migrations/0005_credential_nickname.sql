-- 0005_credential_nickname.sql — friendly per-credential names for the
-- passkey management UI on /account.html.
--
-- Each WebAuthn credential gets an optional human label so the user can tell
-- "MacBook Touch ID" apart from "iPhone" apart from "1Password vault" in the
-- credential list. NULL means "show a fallback like Passkey created MMM DD".

ALTER TABLE credentials ADD COLUMN nickname TEXT;
