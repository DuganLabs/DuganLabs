import type { Env } from '../env';
import { newId } from './response';
import { quoteLeadFee } from './lead-meter';
import { assertCanReceiveLeads } from './lead-billing-gate';
import { resolveLeadRate } from './lead-rate-card';
import {
  findActiveConsent,
  recordConsent,
  type ConsentRecord,
  type D1Like,
} from '@greenput/shared/consent';

/**
 * The network pool mechanism (gap analysis C1: "the data model cannot
 * move a lead between workspaces"). Three pieces:
 *
 * 1. CROSS-WORKSPACE IDENTITY — `consumers`: one row per person, matched
 *    by phone, then email. Resolved lazily from a lead the first time it
 *    is offered; existing consent records for that person + workspace
 *    are linked to the row (consumer_id).
 * 2. THE GRANT — a lead may be offered ONLY under the consumer's
 *    reroute consent: an active consent record for the offering
 *    workspace whose allow_network_reroute is set (the MCP grant
 *    model's separate opt-in — off unless the consumer turned it on).
 *    On acceptance a NEW consent record grants the receiving workspace
 *    the same fields, sourced 'pool_offer', so the receiver's right to
 *    hold and message the consumer is itself on record.
 * 3. THE REASSIGNMENT PATH — acceptance re-points leads.workspace_id to
 *    the receiver, writes lead_transfers, and stamps accepted_at. It
 *    does NOT bill (WS-1, canonical model v14): a pool accept is a lead
 *    transfer, not a booking — no job, no slot, no booking exists here.
 *    The receiver bills when the lead books into their schedule via
 *    schedule-aware delivery, at the rate-card rate for the lead's
 *    service, under the meter's UNIQUE(lead_id, workspace_id). The
 *    priceUsd/vertical on the result are that future booking's quoted
 *    rate (quoteLeadFee), kept on the response shape for existing
 *    consumers. An already-accepted lead can never be offered, so a
 *    transfer can never carry a second shop's claim on the same lead.
 */

export interface Consumer {
  readonly id: string;
  readonly phone: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

/** Find-or-create the consumer row for a person, and link their grants. */
export async function resolveConsumer(
  env: Env,
  workspaceId: string,
  person: {
    phone: string;
    email: string;
    firstName: string;
    lastName: string;
  },
): Promise<Consumer> {
  const db = env.DB;
  const phone = person.phone.trim();
  const email = person.email.trim().toLowerCase();

  let row = phone
    ? await db
        .prepare('SELECT * FROM consumers WHERE phone = ?')
        .bind(phone)
        .first<Record<string, unknown>>()
    : null;
  if (!row && email) {
    row = await db
      .prepare('SELECT * FROM consumers WHERE email = ?')
      .bind(email)
      .first<Record<string, unknown>>();
  }

  let consumer: Consumer;
  if (row) {
    consumer = {
      id: String(row['id']),
      phone: String(row['phone'] ?? ''),
      email: String(row['email'] ?? ''),
      firstName: String(row['first_name'] ?? ''),
      lastName: String(row['last_name'] ?? ''),
    };
    // Backfill identifiers the row was missing (matched by email, now
    // we know the phone too) so later matches hit the first index.
    if (phone && !consumer.phone) {
      await db
        .prepare(
          "UPDATE consumers SET phone = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(phone, consumer.id)
        .run();
      consumer = { ...consumer, phone };
    }
    if (email && !consumer.email) {
      await db
        .prepare(
          "UPDATE consumers SET email = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(email, consumer.id)
        .run();
      consumer = { ...consumer, email };
    }
  } else {
    const id = newId();
    await db
      .prepare(
        `INSERT INTO consumers (id, phone, email, first_name, last_name)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, phone, email, person.firstName, person.lastName)
      .run();
    consumer = {
      id,
      phone,
      email,
      firstName: person.firstName,
      lastName: person.lastName,
    };
  }

  // Link this workspace's existing grants for the person to the row.
  await db
    .prepare(
      `UPDATE consent_records SET consumer_id = ?
       WHERE workspace_id = ? AND consumer_id IS NULL
         AND ((? <> '' AND consumer_phone = ?) OR (? <> '' AND consumer_email = ?))`,
    )
    .bind(consumer.id, workspaceId, phone, phone, email, email)
    .run();

  return consumer;
}

export type OfferFailure =
  | 'LEAD_NOT_FOUND'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_IS_SELF'
  | 'LEAD_ACCEPTED'
  | 'LEAD_WITHDRAWN'
  | 'ALREADY_OFFERED'
  | 'NO_REROUTE_CONSENT';

export type OfferResult =
  | { readonly ok: true; readonly offerId: string; readonly consumerId: string }
  | { readonly ok: false; readonly reason: OfferFailure };

export async function offerLead(
  env: Env,
  params: {
    leadId: string;
    fromWorkspaceId: string;
    toWorkspaceId: string;
    now?: Date;
  },
): Promise<OfferResult> {
  const db = env.DB;
  const now = (params.now ?? new Date()).toISOString();

  const lead = await db
    .prepare('SELECT * FROM leads WHERE id = ? AND workspace_id = ?')
    .bind(params.leadId, params.fromWorkspaceId)
    .first<Record<string, unknown>>();
  if (!lead) return { ok: false, reason: 'LEAD_NOT_FOUND' };
  if (params.toWorkspaceId === params.fromWorkspaceId) {
    return { ok: false, reason: 'TARGET_IS_SELF' };
  }
  const target = await db
    .prepare('SELECT id FROM workspaces WHERE id = ?')
    .bind(params.toWorkspaceId)
    .first<{ id: string }>();
  if (!target) return { ok: false, reason: 'TARGET_NOT_FOUND' };
  if (lead['accepted_at']) return { ok: false, reason: 'LEAD_ACCEPTED' };
  if (lead['withdrawn_at']) return { ok: false, reason: 'LEAD_WITHDRAWN' };

  const open = await db
    .prepare(
      `SELECT id FROM lead_offers WHERE lead_id = ? AND status = 'offered' LIMIT 1`,
    )
    .bind(params.leadId)
    .first<{ id: string }>();
  if (open) return { ok: false, reason: 'ALREADY_OFFERED' };

  const consumer = await resolveConsumer(env, params.fromWorkspaceId, {
    phone: String(lead['phone'] ?? ''),
    email: String(lead['email'] ?? ''),
    firstName: String(lead['first_name'] ?? ''),
    lastName: String(lead['last_name'] ?? ''),
  });

  // The reroute grant: active consent for THIS workspace, for THIS
  // consumer, with the network-reroute opt-in set. Anything less — no
  // record, revoked, or reroute left off — and the lead cannot move.
  const grant = await findActiveConsent({
    db: db as unknown as D1Like,
    workspaceId: params.fromWorkspaceId,
    consumerPhone: consumer.phone || undefined,
    consumerEmail: consumer.email || undefined,
    leadId: params.leadId,
  });
  if (!grant || !grant.allowNetworkReroute) {
    return { ok: false, reason: 'NO_REROUTE_CONSENT' };
  }

  const offerId = newId();
  await db
    .prepare(
      `INSERT INTO lead_offers
         (id, lead_id, consumer_id, from_workspace_id, to_workspace_id, status, offered_at)
       VALUES (?, ?, ?, ?, ?, 'offered', ?)`,
    )
    .bind(
      offerId,
      params.leadId,
      consumer.id,
      params.fromWorkspaceId,
      params.toWorkspaceId,
      now,
    )
    .run();

  return { ok: true, offerId, consumerId: consumer.id };
}

export type AcceptFailure =
  | 'OFFER_NOT_FOUND'
  | 'OFFER_NOT_OPEN'
  | 'LEAD_GONE'
  | 'UNMAPPED_SERVICE'
  | 'CARD_REQUIRED'
  | 'DELIVERY_PAUSED';

export type AcceptResult =
  | {
      readonly ok: true;
      readonly leadId: string;
      readonly priceUsd: number;
      readonly vertical: string;
    }
  | { readonly ok: false; readonly reason: AcceptFailure };

/**
 * Accept an offer: the lead moves to the receiver, atomically in
 * effect — the guarded offer UPDATE is the race arbiter (exactly one
 * acceptance wins), and every later step is keyed on having won it.
 * No fee bills here; the fee fires when the lead books (WS-1).
 */
export async function acceptLeadOffer(
  env: Env,
  params: { offerId: string; toWorkspaceId: string; now?: Date },
): Promise<AcceptResult> {
  const db = env.DB;
  const now = (params.now ?? new Date()).toISOString();

  const offer = await db
    .prepare('SELECT * FROM lead_offers WHERE id = ? AND to_workspace_id = ?')
    .bind(params.offerId, params.toWorkspaceId)
    .first<Record<string, unknown>>();
  if (!offer) return { ok: false, reason: 'OFFER_NOT_FOUND' };
  if (offer['status'] !== 'offered') {
    return { ok: false, reason: 'OFFER_NOT_OPEN' };
  }

  const lead = await db
    .prepare('SELECT * FROM leads WHERE id = ?')
    .bind(String(offer['lead_id']))
    .first<Record<string, unknown>>();
  if (
    !lead ||
    String(lead['workspace_id']) !== String(offer['from_workspace_id']) ||
    lead['accepted_at'] ||
    lead['withdrawn_at']
  ) {
    return { ok: false, reason: 'LEAD_GONE' };
  }

  // Rate check BEFORE any mutation (the lead-meter rule): an unmapped
  // service must fail loudly, not move a lead whose eventual booking
  // could never be priced.
  const rate = resolveLeadRate(String(lead['service_type'] ?? ''));
  if (!rate) return { ok: false, reason: 'UNMAPPED_SERVICE' };

  const receive = await assertCanReceiveLeads(env, params.toWorkspaceId);
  if (!receive.ok) return { ok: false, reason: receive.code };

  const won = await db
    .prepare(
      `UPDATE lead_offers SET status = 'accepted', responded_at = ?
       WHERE id = ? AND status = 'offered'`,
    )
    .bind(now, params.offerId)
    .run();
  if ((won.meta?.changes ?? 0) === 0) {
    return { ok: false, reason: 'OFFER_NOT_OPEN' };
  }

  const fromWorkspaceId = String(offer['from_workspace_id']);
  const consumerId = String(offer['consumer_id']);
  const leadId = String(offer['lead_id']);

  // The move.
  await db
    .prepare(
      `UPDATE leads SET workspace_id = ?, accepted_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL`,
    )
    .bind(params.toWorkspaceId, now, now, leadId, fromWorkspaceId)
    .run();

  await db
    .prepare(
      `INSERT INTO lead_transfers
         (id, lead_id, offer_id, consumer_id, from_workspace_id, to_workspace_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId(),
      leadId,
      params.offerId,
      consumerId,
      fromWorkspaceId,
      params.toWorkspaceId,
      now,
    )
    .run();

  // The receiver's own grant record: same fields the consumer granted
  // the originator, sourced from the pool offer, linked to the consumer.
  const originGrant: ConsentRecord | null = await findActiveConsent({
    db: db as unknown as D1Like,
    workspaceId: fromWorkspaceId,
    leadId,
  });
  if (originGrant) {
    await recordConsent({
      db: db as unknown as D1Like,
      newId,
      workspaceId: params.toWorkspaceId,
      leadId,
      consumerId,
      consumerPhone: String(lead['phone'] ?? ''),
      consumerEmail: String(lead['email'] ?? ''),
      fields: originGrant.fields,
      source: 'pool_offer',
      consentText: originGrant.consentText,
      allowNetworkReroute: originGrant.allowNetworkReroute,
      now,
    });
  }

  // No billing on a pool accept (WS-1): the accept moves the lead and
  // nothing else — no job, no slot, no booking. The receiver's fee
  // fires at booking commit (schedule-aware delivery) under
  // (lead_id, receiver workspace). priceUsd/vertical stay on the
  // result as the quoted rate that booking will bill, resolved the
  // same way the meter resolves it (rate card, then workspace
  // override) — the rate check above guarantees it resolves.
  const quoted = await quoteLeadFee(
    env,
    params.toWorkspaceId,
    String(lead['service_type'] ?? ''),
  );

  return {
    ok: true,
    leadId,
    priceUsd: quoted?.priceUsd ?? rate.priceUsd,
    vertical: quoted?.vertical ?? rate.vertical,
  };
}

export async function declineLeadOffer(
  env: Env,
  params: { offerId: string; toWorkspaceId: string; now?: Date },
): Promise<{ ok: boolean; reason?: 'OFFER_NOT_FOUND' | 'OFFER_NOT_OPEN' }> {
  const now = (params.now ?? new Date()).toISOString();
  const offer = await env.DB.prepare(
    'SELECT id, status FROM lead_offers WHERE id = ? AND to_workspace_id = ?',
  )
    .bind(params.offerId, params.toWorkspaceId)
    .first<{ id: string; status: string }>();
  if (!offer) return { ok: false, reason: 'OFFER_NOT_FOUND' };
  if (offer.status !== 'offered') {
    return { ok: false, reason: 'OFFER_NOT_OPEN' };
  }
  await env.DB.prepare(
    `UPDATE lead_offers SET status = 'declined', responded_at = ?
     WHERE id = ? AND status = 'offered'`,
  )
    .bind(now, params.offerId)
    .run();
  return { ok: true };
}
