/// <reference types="@cloudflare/workers-types" />
import type { LeadWithdrawnReason } from '@greenput/shared/models';

/**
 * Withdrawing a lead — the one definition of what that does to the money.
 *
 * `POST /api/leads/:id/withdraw` (the contractor's staff, scoped to their
 * workspace) and the tenant site's `POST /quote/s/:id/cancel` (the homeowner,
 * holding only the session capability that booked the job) both come here,
 * so the two paths cannot drift on the rules that matter (GP-105):
 *
 *   - Before booking nothing was billed, so withdrawing bills nothing.
 *   - After booking the fee STANDS at any distance (Canonical Model v14:
 *     "Cancel after booking: the fee stands at any distance — a booked job
 *     was delivered, and the platform bills booked jobs."). A `pending`
 *     lead_meter_events row stays `pending` and collectible (via
 *     `chargePendingLeadFees`); an invoiced row is untouched. Withdrawal
 *     never marks a row `waived` and never deletes one.
 *   - GP-105's old rule — after acceptance the pending row is marked
 *     `waived`, unconditionally, platform-wide — is RETIRED (2026-10-25,
 *     WS-1). It was written for the dead acceptance-trigger model; once
 *     WS-1 moved the fee trigger to booking commit, every meter row is a
 *     booking fee, so waiving on withdraw silently un-billed booked jobs
 *     whose charge was still pending.
 *   - The only reversal of a lead fee anywhere is `refundLeadFee`
 *     (`apps/api/src/lib/lead-fee-billing.ts`), for proven fraud or
 *     platform fault with a recorded reason (FR-1.4).
 *   - Idempotent and one-way: a second withdrawal changes nothing.
 *
 * Every write lands in ONE `db.batch()`, and the caller may put statements of
 * its own in the same transaction (`alongside`): the tenant site cancels the
 * job and frees its `job_slots` rows there, so the slot and the lead move
 * together or not at all. Two withdrawals racing each other are settled by
 * the guarded lead UPDATE — the audit row is keyed on THIS call's
 * `withdrawn_at` stamp, so the loser writes none.
 *
 * The reason is recorded, never adjudicated; the fee outcome does not depend
 * on which one was given. `workspace_id` scopes every statement: the staff
 * route passes the authenticated workspace, the tenant site passes the
 * session row's, and neither ever takes it from input.
 */

/**
 * What a withdrawal did to the lead's meter row. `waived` is kept because
 * historical `activity_log` rows carry it; `withdrawLead` no longer
 * produces it since WS-1.
 */
export type MeterEventAdjustment = 'none' | 'waived' | 'left_unchanged';

export interface WithdrawLeadInput {
  workspaceId: string;
  leadId: string;
  /** From the closed set on `leads.withdrawn_reason`, validated by the caller. */
  reason?: LeadWithdrawnReason | null;
  /** ISO timestamp; also the key that ties the audit row to this call. */
  now: string;
  /**
   * `users(id)` for the activity_log row: the staff user on the API, the
   * workspace's attribution user on the tenant site (a homeowner is not a
   * user). Null writes the row unattributed, which the column allows.
   */
  actorUserId: string | null;
  newId: () => string;
  /**
   * Statements that must commit in the same transaction as the withdrawal.
   * Run even when the lead is already withdrawn — cancelling a job a second
   * time is still a cancellation — but not when the lead is not found.
   */
  alongside?: readonly D1PreparedStatement[];
}

export interface WithdrawLeadOutcome {
  kind: 'withdrawn' | 'already_withdrawn' | 'not_found';
  /** The lead row as it now is; null only for `not_found`. */
  lead: Record<string, unknown> | null;
  meterEventAdjustment: MeterEventAdjustment;
}

const SELECT_LEAD = 'SELECT * FROM leads WHERE id = ? AND workspace_id = ?';

export async function withdrawLead(
  db: D1Database,
  input: WithdrawLeadInput,
): Promise<WithdrawLeadOutcome> {
  const { workspaceId, leadId, now } = input;
  const alongside = input.alongside ?? [];

  const lead = await db
    .prepare(SELECT_LEAD)
    .bind(leadId, workspaceId)
    .first<Record<string, unknown>>();
  if (!lead)
    return { kind: 'not_found', lead: null, meterEventAdjustment: 'none' };

  if (lead['withdrawn_at']) {
    // Already withdrawn: whatever meter adjustment was needed already
    // happened, and it is not revisited.
    if (alongside.length > 0) await db.batch([...alongside]);
    return { kind: 'already_withdrawn', lead, meterEventAdjustment: 'none' };
  }

  const reason = input.reason ?? null;

  const results = await db.batch([
    ...alongside,
    // Guarded by `withdrawn_at IS NULL`: of two concurrent withdrawals
    // exactly one sees `changes: 1`, and only that one's stamp is `now`.
    db
      .prepare(
        `UPDATE leads SET withdrawn_at = ?, withdrawn_reason = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND withdrawn_at IS NULL`,
      )
      .bind(now, reason, now, leadId, workspaceId),
    // The audit row, written only by the call that won, saying what happened
    // to the fee: computed in the same transaction from the rows as they now
    // are, so it cannot disagree with them. No meter row means nothing was
    // billed ('none'); a row — pending or invoiced — was left exactly as it
    // was ('left_unchanged'), because the fee stands.
    db
      .prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
         SELECT ?, ?, ?, 'lead', ?, 'withdrawn',
                json_object(
                  'meterEventAdjustment',
                  CASE
                    WHEN NOT EXISTS (SELECT 1 FROM lead_meter_events WHERE lead_id = ? AND workspace_id = ?) THEN 'none'
                    ELSE 'left_unchanged'
                  END,
                  'reason', ?
                ),
                ?
         WHERE EXISTS (SELECT 1 FROM leads WHERE id = ? AND withdrawn_at = ?)`,
      )
      .bind(
        input.newId(),
        workspaceId,
        input.actorUserId,
        leadId,
        leadId,
        workspaceId,
        reason,
        now,
        leadId,
        now,
      ),
  ]);

  const changesOf = (index: number): number =>
    results[alongside.length + index]?.meta?.changes ?? 0;

  const updated = await db
    .prepare('SELECT * FROM leads WHERE id = ?')
    .bind(leadId)
    .first<Record<string, unknown>>();

  if (changesOf(0) === 0) {
    // Lost the race to another withdrawal; that one did the adjusting.
    return {
      kind: 'already_withdrawn',
      lead: updated ?? lead,
      meterEventAdjustment: 'none',
    };
  }

  // The fee stands, so the adjustment is read off the meter row as it now
  // is: no row — nothing was billed; a row, pending or invoiced — it was
  // left unchanged and a pending one stays collectible.
  const meterRow = await db
    .prepare(
      'SELECT status FROM lead_meter_events WHERE lead_id = ? AND workspace_id = ?',
    )
    .bind(leadId, workspaceId)
    .first<{ status: string }>();
  const meterEventAdjustment: MeterEventAdjustment = meterRow
    ? 'left_unchanged'
    : 'none';

  return { kind: 'withdrawn', lead: updated ?? lead, meterEventAdjustment };
}
