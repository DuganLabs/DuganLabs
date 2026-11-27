import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId } from '../lib/response';
import {
  CONSENT_TEXT_FORM_V1,
  recordConsent,
  type ConsentField,
  type D1Like as ConsentD1Like,
} from '@greenput/shared/consent';

export const publicRouter = Router({ base: '/api/public' });

interface PublicLeadBody {
  slug: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  serviceType?: string;
  notes?: string;
  /** Honeypot field — must be empty */
  website?: string;
  sourceUrl?: string;
  /**
   * The form's consent checkbox, asserted by the submitting form: the
   * consumer agreed to CONSENT_TEXT_FORM_V1. Recorded verbatim as a
   * consent_records row when true; absent/false records nothing, and
   * no consumer SMS may be sent to this lead without a record.
   */
  consent?: { granted?: boolean; allowNetworkReroute?: boolean };
}

// POST /api/public/leads — Accept lead from public form submission
publicRouter.post('/leads', async (req: IRequest, env: Env) => {
  let body: PublicLeadBody;
  try {
    body = await (req as unknown as Request).json();
  } catch {
    return error('Invalid JSON body', 400, 'BAD_REQUEST');
  }

  // Honeypot spam filter — if the hidden field is filled, silently reject
  if (body.website) {
    // Return 201 to not reveal the honeypot to bots
    return json(
      { data: { message: 'Thank you! We will be in touch soon.' } },
      201,
    );
  }

  // Validate required fields
  if (!body.slug || typeof body.slug !== 'string') {
    return error('Workspace slug is required', 400, 'VALIDATION_ERROR');
  }
  if (
    !body.firstName ||
    typeof body.firstName !== 'string' ||
    body.firstName.trim().length === 0
  ) {
    return error('First name is required', 400, 'VALIDATION_ERROR');
  }
  if (
    !body.lastName ||
    typeof body.lastName !== 'string' ||
    body.lastName.trim().length === 0
  ) {
    return error('Last name is required', 400, 'VALIDATION_ERROR');
  }

  const email = body.email?.trim() ?? '';
  const phone = body.phone?.trim() ?? '';

  if (!email && !phone) {
    return error('Email or phone is required', 400, 'VALIDATION_ERROR');
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return error('Invalid email address', 400, 'VALIDATION_ERROR');
  }

  // Resolve workspace by slug
  const workspace = await env.DB.prepare(
    'SELECT id FROM workspaces WHERE slug = ? LIMIT 1',
  )
    .bind(body.slug)
    .first<{ id: string }>();

  if (!workspace) {
    return notFound('Workspace');
  }

  // Find the workspace owner to use as created_by
  const owner = await env.DB.prepare(
    "SELECT id FROM users WHERE workspace_id = ? AND role = 'owner' LIMIT 1",
  )
    .bind(workspace.id)
    .first<{ id: string }>();

  if (!owner) {
    return error('Workspace is not configured', 500, 'INTERNAL');
  }

  const now = new Date().toISOString();
  const leadId = newId();
  const submissionId = newId();
  const firstName = body.firstName.trim();
  const lastName = body.lastName.trim();
  const serviceType = body.serviceType?.trim() ?? '';
  const notes = body.notes?.trim() ?? '';
  const sourceUrl = body.sourceUrl?.trim() ?? null;
  const ipAddress =
    (req as unknown as Request).headers.get('cf-connecting-ip') ?? null;

  // Insert lead record
  await env.DB.prepare(
    `
    INSERT INTO leads (
      id, workspace_id, first_name, last_name, email, phone, preferred_contact,
      status, source, service_type, notes, created_at, updated_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `,
  )
    .bind(
      leadId,
      workspace.id,
      firstName,
      lastName,
      email,
      phone,
      email ? 'email' : 'phone',
      'new',
      'website',
      serviceType,
      notes,
      now,
      now,
      owner.id,
    )
    .run();

  // Insert form_submissions record (raw form data)
  await env.DB.prepare(
    `
    INSERT INTO form_submissions (id, workspace_id, lead_id, form_data, source_url, ip_address, processed, created_at)
    VALUES (?,?,?,?,?,?,1,?)
  `,
  )
    .bind(
      submissionId,
      workspace.id,
      leadId,
      JSON.stringify({
        firstName,
        lastName,
        email,
        phone,
        serviceType,
        notes,
      }),
      sourceUrl,
      ipAddress,
      now,
    )
    .run();

  // Log activity
  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
    VALUES (?, ?, ?, 'lead', ?, 'created', ?, ?)
  `,
  )
    .bind(
      newId(),
      workspace.id,
      owner.id,
      leadId,
      JSON.stringify({ source: 'website', formSubmissionId: submissionId }),
      now,
    )
    .run();

  // Consent capture: the form asserted the checkbox. Fields are exactly
  // what the consumer handed over; a failure here must not fail the lead
  // the consumer asked for, so it is logged, not thrown.
  if (body.consent?.granted === true) {
    try {
      const fields: ConsentField[] = ['name', 'job_details'];
      if (phone) fields.push('phone');
      if (email) fields.push('email');
      await recordConsent({
        db: env.DB as unknown as ConsentD1Like,
        newId,
        workspaceId: workspace.id,
        leadId,
        consumerPhone: phone,
        consumerEmail: email,
        fields,
        source: 'public_form',
        consentText: CONSENT_TEXT_FORM_V1,
        // The grant model's separate opt-in: off unless the consumer
        // turned it on. Without it the lead can never enter the pool.
        allowNetworkReroute: body.consent.allowNetworkReroute === true,
        now,
      });
    } catch (err) {
      console.error('public lead consent capture failed', {
        workspaceId: workspace.id,
        leadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return json(
    { data: { message: 'Thank you! We will be in touch soon.' } },
    201,
  );
});

// ── Booking deposit confirmation — REMOVED (WS-0, PRD v1.5) ──
// GET /api/public/deposits/:token and POST …/:token/session used to
// serve the homeowner's card-confirmation page on the tenant site.
// The booking-deposit model was revoked on 2026-10-20 (canonical
// model: "No deposit at booking. Ever."), so both endpoints are gone:
// no public surface may report a deposit's status or hand out an
// intent's client_secret, and the session endpoint's retry path can no
// longer re-open a deposit either. Requests to either path fall
// through to the router's 404. The engine in lib/deposits.ts stays
// dormant for rows that already exist (settlement + webhook
// reconciliation only).

// GET /api/public/workspace/:slug — Return basic public workspace info
publicRouter.get('/workspace/:slug', async (req: IRequest, env: Env) => {
  const slug = req.params?.['slug'];
  if (!slug) {
    return error('Slug is required', 400, 'VALIDATION_ERROR');
  }

  const workspace = await env.DB.prepare(
    `SELECT name, trade, phone FROM workspaces WHERE slug = ? LIMIT 1`,
  )
    .bind(slug)
    .first<{ name: string; trade: string; phone: string }>();

  if (!workspace) {
    return notFound('Workspace');
  }

  return json({ data: workspace });
});
