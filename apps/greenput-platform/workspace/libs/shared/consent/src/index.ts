// The persisted consent record, mapped to the MCP booking-grant model:
// one grantee workspace, exact fields, one purpose, a timestamp, and
// revocation on the same row. Capture in intake/forms, check before any
// consumer SMS, revoke on STOP or request.
export {
  CONSENT_FIELDS,
  CONSENT_PURPOSE,
  CONSENT_TEXT_FORM_V1,
  CONSENT_TEXT_INTAKE_V1,
  findActiveConsent,
  hasSmsConsent,
  recordConsent,
  revokeConsent,
} from './consent';
export type {
  ConsentField,
  ConsentRecord,
  D1Like,
  FindConsentInput,
  RecordConsentInput,
} from './consent';
