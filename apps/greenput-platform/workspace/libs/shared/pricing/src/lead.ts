import {
  attachLead,
  attributionUserId,
  type D1Like,
  type QuoteSessionRow,
} from './store.ts';
import { formatQuotePrice } from './quote-stage.ts';
import type { Answers, EvaluationResult, Machine } from './types.ts';

/**
 * The one place a finished quote becomes a lead — and the point at which it
 * becomes billable.
 *
 * This is the product's central transaction: a homeowner has answered the
 * enrichment form, seen a range, and given their contact details. Both the API
 * and the tenant site reach this through the same function so a lead created
 * from a quote always looks the same, whichever origin the form was served
 * from.
 *
 * It is deliberately forgiving. A session that reached a refusal, or that never
 * got as far as asking for a name, produces no lead and no error — there is
 * nothing to hand a contractor, and a half-finished form is not a failure.
 *
 * QUALIFICATION. A lead that reached a real price is created `qualified`, with
 * `qualified_at` stamped. That is the design's §6: "a completed traversal that
 * lands on a priced terminal IS the qualification event". It matters because
 * `POST /api/leads/:id/accept` refuses a lead that is not qualified, and so
 * does booking delivery. A quote that never sets it can never be accepted or
 * auto-booked, so the funnel this engine exists to feed would produce leads
 * that could never reach a booking — the one billable event (WS-1:
 * `recordLeadMeter()` fires at booking commit, never at accept).
 *
 * A `span` does NOT qualify: the band is real and is shown immediately, but it
 * still covers several outcomes because a photo has not been read, and the
 * review that narrows it is what qualifies. A `no_quote`, `urgent` or
 * `referral` carries no price at all — an urgent-safety lead is a real lead
 * that must reach a human fast, not a billable one.
 */

const str = (answers: Answers, key: string): string => {
  const v = answers[key];
  return typeof v === 'string' ? v.trim() : '';
};

export interface LeadFromQuote {
  leadId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface CreateLeadInput {
  db: D1Like;
  session: QuoteSessionRow;
  machine: Machine;
  answers: Answers;
  result: EvaluationResult;
  /** Injected so the caller owns id generation (and tests stay deterministic). */
  newId: () => string;
  sourceUrl?: string | null;
  now?: string;
}

/**
 * Write the lead, its raw form submission and an activity-log entry, then link
 * it back to the session. Returns null when there is nothing worth writing.
 */
export async function createLeadFromQuote(
  input: CreateLeadInput,
): Promise<LeadFromQuote | null> {
  const { db, session, machine, answers, result } = input;
  const now = input.now ?? new Date().toISOString();

  const firstName = str(answers, 'first_name');
  const lastName = str(answers, 'last_name');
  const email = str(answers, 'email');
  const phone = str(answers, 'phone');

  // No name and no way to reach them: there is no lead here.
  if (!firstName || (!email && !phone)) return null;
  if (session.lead_id) return null;

  // leads.created_by is a NOT NULL foreign key to users(id) and a homeowner is
  // not a user — see `attributionUserId`.
  const attributedTo = await attributionUserId(db, session.workspace_id);
  if (!attributedTo) return null;

  const leadId = input.newId();
  const preferred = str(answers, 'preferred_contact');
  const notes = summarise(machine, result);
  const qualified = qualifies(result);
  // The single number the pipeline's value columns want; the band itself is
  // on the session, which is the authoritative form.
  const value = estimatedValueCents(result);

  await db
    .prepare(
      `INSERT INTO leads (
         id, workspace_id, first_name, last_name, email, phone, preferred_contact,
         status, source, service_type, notes, estimated_value, qualified_at,
         created_at, updated_at, created_by
       ) VALUES (?,?,?,?,?,?,?,?,'website',?,?,?,?,?,?,?)`,
    )
    .bind(
      leadId,
      session.workspace_id,
      firstName,
      lastName,
      email,
      phone,
      preferred || (email ? 'email' : 'phone'),
      qualified ? 'qualified' : 'new',
      machine.vertical,
      notes,
      value,
      qualified ? now : null,
      now,
      now,
      attributedTo,
    )
    .run();

  // The raw answers, kept verbatim. The quote is a commitment; what was said to
  // produce it has to be recoverable without replaying the graph.
  await db
    .prepare(
      `INSERT INTO form_submissions (id, workspace_id, lead_id, form_data, source_url, ip_address, processed, created_at)
       VALUES (?,?,?,?,?,?,1,?)`,
    )
    .bind(
      input.newId(),
      session.workspace_id,
      leadId,
      JSON.stringify({
        quoteSessionId: session.id,
        flow: machine.slug,
        terminal: result.terminal,
        low: result.low,
        high: result.high,
        answers,
      }),
      input.sourceUrl ?? session.source_url,
      null,
      now,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?,?,?,'lead',?,?,?,?)`,
    )
    .bind(
      input.newId(),
      session.workspace_id,
      attributedTo,
      leadId,
      qualified ? 'qualified' : 'created',
      JSON.stringify({
        source: 'pricing_quote',
        flow: machine.slug,
        quoteSessionId: session.id,
        terminal: result.terminal,
        kind: result.kind,
        low: result.low,
        high: result.high,
        qualified,
      }),
      now,
    )
    .run();

  await attachLead(db, session.id, leadId, now);

  return { leadId, firstName, lastName, email, phone };
}

/**
 * `leads.estimated_value` for a band: the midpoint, in INTEGER CENTS
 * (CLAUDE.md §5.0.1). The band itself is in dollars — `result.low` / `high`
 * are what the homeowner was shown — so the conversion happens here, once,
 * for every writer of that column: the lead's creation and the photo review
 * that re-prices it. GP-103's booking derives `jobs.total` from the same
 * band the same way, so a lead and the job booked off it agree (GP-111).
 * Null when there is no band.
 */
export function estimatedValueCents(
  result: Pick<EvaluationResult, 'low' | 'high'>,
): number | null {
  return result.low !== null && result.high !== null
    ? Math.round(((result.low + result.high) / 2) * 100)
    : null;
}

/**
 * Did this outcome put a real price in front of the homeowner?
 *
 * `evaluate()` reports both `quote` and `quote_with_condition` as kind
 * `'quote'`; everything else — `span`, `no_quote`, `urgent`, `referral` — did
 * not, for the reasons in the header.
 */
export function qualifies(result: EvaluationResult): boolean {
  return result.kind === 'quote';
}

/** A one-line summary of the outcome, for the contractor's lead list. */
function summarise(machine: Machine, result: EvaluationResult): string {
  const price = formatQuotePrice(result);
  if (price) return `${machine.name}: quoted ${price} (${result.terminal}).`;
  const why = result.refused_because
    ? ` ${result.refused_because}`
    : ' No price was shown.';
  return `${machine.name}: ${result.terminal}.${why}`;
}
