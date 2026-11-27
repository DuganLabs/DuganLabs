/**
 * The consent record — GreenPut's persisted answer to "did this consumer
 * agree, to what, when, and who may use it" (gap analysis C2: intake
 * captured homeowner PII and SMS went out over Twilio with zero consent
 * artifacts in code).
 *
 * The record's shape is the MCP booking-grant model (apps/mcp/src/
 * contracts.ts), persisted: a grant names ONE grantee workspace, the
 * exact fields that may be shared/used, a single purpose, whether the
 * network pool may reroute, and when it was granted. Revocation is a
 * timestamp on the same row — the record of what was agreed is never
 * deleted, only ended.
 *
 * Two text versions exist because two different acts create records:
 *
 * - INTAKE (the pricing-quote form): the homeowner typed their contact
 *   details into the shop's own intake to get a quote and be contacted
 *   about it, and picked how (preferred_contact). The record documents
 *   that share: fields are exactly the ones the lead carries.
 * - FORM (the simple contact/public forms): an explicit checkbox under
 *   the words in CONSENT_TEXT_FORM_V1. No checkbox, no record — and the
 *   send check below treats "no record" as "no send".
 *
 * The messaging rule this module exists to enforce: a consumer-facing
 * SMS may be sent only when an ACTIVE (unrevoked) record exists for that
 * workspace + phone whose fields include 'phone'. `guardedSendSms` in
 * the API layer wraps the Twilio sender with exactly that check.
 */

/** The grant-model field names (apps/mcp booking_grant.json). */
export const CONSENT_FIELDS = [
  'name',
  'phone',
  'email',
  'service_address',
  'job_details',
  'photos',
] as const;
export type ConsentField = (typeof CONSENT_FIELDS)[number];

/** The only purpose a v1 grant can be issued for (MCP contract). */
export const CONSENT_PURPOSE = 'quote-and-schedule' as const;

export const CONSENT_TEXT_INTAKE_V1 =
  "Provided at the shop's online quote form so the shop can quote and " +
  'schedule the requested work and contact the consumer about that ' +
  'request by their chosen channel (phone, text, or email).';

export const CONSENT_TEXT_FORM_V1 =
  'I agree that this business may contact me about my request by phone, ' +
  'text message, and email. Message and data rates may apply. Reply ' +
  'STOP to opt out of texts. Consent is not a condition of purchase.';

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(query: string): D1StatementLike;
}

export interface ConsentRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly leadId: string | null;
  /** Cross-workspace consumer identity (item 6); null until linked. */
  readonly consumerId: string | null;
  readonly consumerPhone: string;
  readonly consumerEmail: string;
  readonly fields: readonly ConsentField[];
  readonly purpose: typeof CONSENT_PURPOSE;
  readonly allowNetworkReroute: boolean;
  readonly source: string;
  readonly consentText: string;
  readonly grantedAt: string;
  readonly revokedAt: string | null;
  readonly revokeSource: string | null;
}

export interface RecordConsentInput {
  readonly db: D1Like;
  readonly newId: () => string;
  readonly workspaceId: string;
  readonly leadId?: string | null;
  readonly consumerId?: string | null;
  readonly consumerPhone?: string;
  readonly consumerEmail?: string;
  readonly fields: readonly ConsentField[];
  /** 'intake_quote' | 'tenant_site_form' | 'public_form' | 'manual_entry' | 'mcp_booking' */
  readonly source: string;
  readonly consentText: string;
  readonly allowNetworkReroute?: boolean;
  readonly now?: string;
}

function isConsentField(value: string): value is ConsentField {
  return (CONSENT_FIELDS as readonly string[]).includes(value);
}

/**
 * Persist a consent record. Validates against the grant model: fields
 * must be grant fields, at least one field must be named, and a contact
 * path must exist (the MCP contract's rule: phone or email among the
 * fields, with the matching identifier actually present).
 */
export async function recordConsent(
  input: RecordConsentInput,
): Promise<ConsentRecord> {
  const fields = [...new Set(input.fields)];
  for (const f of fields) {
    if (!isConsentField(f)) {
      throw new Error(`Unknown consent field: ${f}`);
    }
  }
  if (fields.length === 0) {
    throw new Error('A consent record must name at least one field.');
  }
  const phone = (input.consumerPhone ?? '').trim();
  const email = (input.consumerEmail ?? '').trim().toLowerCase();
  const hasPhonePath = fields.includes('phone') && phone.length > 0;
  const hasEmailPath = fields.includes('email') && email.length > 0;
  if (!hasPhonePath && !hasEmailPath) {
    throw new Error(
      'A consent record needs a contact path: phone or email in its fields, with the identifier present.',
    );
  }

  const id = input.newId();
  const grantedAt = input.now ?? new Date().toISOString();
  await input.db
    .prepare(
      `INSERT INTO consent_records
         (id, workspace_id, lead_id, consumer_id, consumer_phone, consumer_email,
          fields, purpose, allow_network_reroute, source, consent_text,
          granted_at, revoked_at, revoke_source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
    .bind(
      id,
      input.workspaceId,
      input.leadId ?? null,
      input.consumerId ?? null,
      phone,
      email,
      JSON.stringify(fields),
      CONSENT_PURPOSE,
      input.allowNetworkReroute ? 1 : 0,
      input.source,
      input.consentText,
      grantedAt,
      grantedAt,
    )
    .run();

  return {
    id,
    workspaceId: input.workspaceId,
    leadId: input.leadId ?? null,
    consumerId: input.consumerId ?? null,
    consumerPhone: phone,
    consumerEmail: email,
    fields,
    purpose: CONSENT_PURPOSE,
    allowNetworkReroute: input.allowNetworkReroute ?? false,
    source: input.source,
    consentText: input.consentText,
    grantedAt,
    revokedAt: null,
    revokeSource: null,
  };
}

interface ConsentRow {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  consumer_id: string | null;
  consumer_phone: string;
  consumer_email: string;
  fields: string;
  purpose: string;
  allow_network_reroute: number;
  source: string;
  consent_text: string;
  granted_at: string;
  revoked_at: string | null;
  revoke_source: string | null;
}

function toRecord(row: ConsentRow): ConsentRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.fields);
  } catch {
    parsed = [];
  }
  const fields = Array.isArray(parsed)
    ? parsed.filter(
        (f): f is ConsentField => typeof f === 'string' && isConsentField(f),
      )
    : [];
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    leadId: row.lead_id,
    consumerId: row.consumer_id,
    consumerPhone: row.consumer_phone,
    consumerEmail: row.consumer_email,
    fields,
    purpose: CONSENT_PURPOSE,
    allowNetworkReroute: row.allow_network_reroute === 1,
    source: row.source,
    consentText: row.consent_text,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    revokeSource: row.revoke_source,
  };
}

export interface FindConsentInput {
  readonly db: D1Like;
  readonly workspaceId: string;
  readonly consumerPhone?: string;
  readonly consumerEmail?: string;
  readonly leadId?: string;
}

/**
 * The consumer's active (unrevoked) consent record for a workspace,
 * matched by lead, phone, or email — most recent grant wins. Null when
 * no active record exists; callers that send must treat null as NO.
 */
export async function findActiveConsent(
  input: FindConsentInput,
): Promise<ConsentRecord | null> {
  const clauses: string[] = ['workspace_id = ?', 'revoked_at IS NULL'];
  const binds: unknown[] = [input.workspaceId];
  const identity: string[] = [];
  if (input.leadId) {
    identity.push('lead_id = ?');
    binds.push(input.leadId);
  }
  if (input.consumerPhone?.trim()) {
    identity.push('consumer_phone = ?');
    binds.push(input.consumerPhone.trim());
  }
  if (input.consumerEmail?.trim()) {
    identity.push('consumer_email = ?');
    binds.push(input.consumerEmail.trim().toLowerCase());
  }
  if (identity.length === 0) return null;
  clauses.push(`(${identity.join(' OR ')})`);

  const row = await input.db
    .prepare(
      `SELECT * FROM consent_records WHERE ${clauses.join(' AND ')}
       ORDER BY granted_at DESC LIMIT 1`,
    )
    .bind(...binds)
    .first<ConsentRow>();
  return row ? toRecord(row) : null;
}

/**
 * May this workspace send this consumer an SMS about their request?
 * True only with an active record whose granted fields include 'phone'
 * for that exact number. Anything else — no record, revoked, email-only
 * grant — is a no.
 */
export async function hasSmsConsent(
  db: D1Like,
  workspaceId: string,
  consumerPhone: string,
): Promise<boolean> {
  const record = await findActiveConsent({
    db,
    workspaceId,
    consumerPhone,
  });
  return record !== null && record.fields.includes('phone');
}

/**
 * Revoke every active record matching the identity in the workspace
 * (STOP semantics: any revocation ends all messaging consent there).
 * Returns how many records were revoked.
 */
export async function revokeConsent(
  db: D1Like,
  input: {
    workspaceId: string;
    consumerPhone?: string;
    consumerEmail?: string;
    leadId?: string;
    revokeSource: string;
    now?: string;
  },
): Promise<number> {
  const active = await findAllActive(db, input);
  const now = input.now ?? new Date().toISOString();
  let revoked = 0;
  for (const record of active) {
    await db
      .prepare(
        `UPDATE consent_records SET revoked_at = ?, revoke_source = ?
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .bind(now, input.revokeSource, record.id)
      .run();
    revoked += 1;
  }
  return revoked;
}

async function findAllActive(
  db: D1Like,
  input: {
    workspaceId: string;
    consumerPhone?: string;
    consumerEmail?: string;
    leadId?: string;
  },
): Promise<ConsentRecord[]> {
  const identity: string[] = [];
  const binds: unknown[] = [input.workspaceId];
  if (input.leadId) {
    identity.push('lead_id = ?');
    binds.push(input.leadId);
  }
  if (input.consumerPhone?.trim()) {
    identity.push('consumer_phone = ?');
    binds.push(input.consumerPhone.trim());
  }
  if (input.consumerEmail?.trim()) {
    identity.push('consumer_email = ?');
    binds.push(input.consumerEmail.trim().toLowerCase());
  }
  if (identity.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT * FROM consent_records
       WHERE workspace_id = ? AND revoked_at IS NULL AND (${identity.join(' OR ')})
       ORDER BY granted_at DESC`,
    )
    .bind(...binds)
    .all<ConsentRow>();
  return (results ?? []).map(toRecord);
}
