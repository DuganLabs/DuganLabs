import { z } from 'zod';
import { dispatchNotification } from '@greenput/shared/notifications';
import type { Env } from './env.js';
import { renderMarketingPage } from './index.js';
import {
  EMPTY_CONTACT_FORM,
  type ContactContext,
  type ContactFormValues,
} from './page-data.js';
import { securityHeaders } from './security.js';

// Greenput's own workspace — the owner's real one in production ("Dugan
// Labs", named by migration 025), seeded everywhere else by
// scripts/seed/duganlabs-workspace.sql. It was 'greenput' for months, and no
// workspace with that slug has ever existed in any database, so every
// submission answered the "email us instead" 500 (GP-005).
const DEFAULT_WORKSPACE_SLUG = 'duganlabs';

const ContactSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().min(1).max(255),
  company: z.string().trim().max(200).optional().default(''),
  trade: z.string().trim().max(100).optional().default(''),
  message: z.string().trim().min(1).max(5000),
  website: z.string().trim().optional().default(''), // honeypot
});

export type ContactSubmission = z.infer<typeof ContactSchema>;

export interface ContactValidationError {
  field: string;
  message: string;
}

const FIELD_MESSAGES: Record<string, string> = {
  firstName: 'Please enter your first name.',
  lastName: 'Please enter your last name.',
  email: 'Please enter a valid email address.',
  company: 'Please keep the company name under 200 characters.',
  trade: 'Please choose a trade from the list.',
  message: 'Please tell us what you are looking for (up to 5,000 characters).',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContact(
  raw: unknown,
):
  | { ok: true; data: ContactSubmission }
  | { ok: false; error: ContactValidationError } {
  const parsed = ContactSchema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? 'firstName');
    return {
      ok: false,
      error: {
        field,
        message:
          FIELD_MESSAGES[field] ?? 'Please check the form and try again.',
      },
    };
  }
  if (!EMAIL_PATTERN.test(parsed.data.email)) {
    return {
      ok: false,
      error: { field: 'email', message: FIELD_MESSAGES.email },
    };
  }
  return { ok: true, data: parsed.data };
}

export class ContactPersistError extends Error {
  constructor(
    readonly code: 'WORKSPACE_MISSING' | 'WORKSPACE_NOT_READY',
    message: string,
  ) {
    super(message);
    this.name = 'ContactPersistError';
  }
}

export interface ContactRequestMeta {
  sourceUrl: string | null;
  ipAddress: string | null;
}

export interface PersistedContact {
  leadId: string;
  workspaceId: string;
}

/**
 * Writes the submission using the platform's lead model so it appears in the
 * Leads route of the Greenput-owned workspace as a "website" lead. The lead
 * row is the one that must succeed; form_submissions (raw payload) and
 * activity_log are best-effort and only logged on failure.
 */
export async function persistContactLead(
  env: Env,
  data: ContactSubmission,
  meta: ContactRequestMeta,
): Promise<PersistedContact> {
  const slug = env.CONTACT_WORKSPACE_SLUG || DEFAULT_WORKSPACE_SLUG;

  const workspace = await env.DB.prepare(
    'SELECT id FROM workspaces WHERE slug = ? LIMIT 1',
  )
    .bind(slug)
    .first<{ id: string }>();
  if (!workspace) {
    throw new ContactPersistError(
      'WORKSPACE_MISSING',
      `workspace with slug "${slug}" does not exist (set CONTACT_WORKSPACE_SLUG or create it)`,
    );
  }

  // leads.created_by is a NOT NULL foreign key to users(id): attribute the
  // website lead to the workspace owner (falling back to the most senior member).
  const attributedTo = await env.DB.prepare(
    `SELECT id FROM users WHERE workspace_id = ?
     ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
     LIMIT 1`,
  )
    .bind(workspace.id)
    .first<{ id: string }>();
  if (!attributedTo) {
    throw new ContactPersistError(
      'WORKSPACE_NOT_READY',
      `workspace "${slug}" (${workspace.id}) has no users to attribute the lead to`,
    );
  }

  const now = new Date().toISOString();
  const leadId = crypto.randomUUID();
  const submissionId = crypto.randomUUID();
  const notes = data.company
    ? `Company: ${data.company}\n\n${data.message}`
    : data.message;

  await env.DB.prepare(
    `INSERT INTO leads (
       id, workspace_id, first_name, last_name, email, phone, preferred_contact,
       status, source, service_type, notes, created_at, updated_at, created_by
     ) VALUES (?, ?, ?, ?, ?, '', 'email', 'new', 'website', ?, ?, ?, ?, ?)`,
  )
    .bind(
      leadId,
      workspace.id,
      data.firstName,
      data.lastName,
      data.email,
      data.trade,
      notes,
      now,
      now,
      attributedTo.id,
    )
    .run();

  try {
    await env.DB.prepare(
      `INSERT INTO form_submissions (id, workspace_id, lead_id, form_data, source_url, ip_address, processed, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    )
      .bind(
        submissionId,
        workspace.id,
        leadId,
        JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          company: data.company,
          trade: data.trade,
          message: data.message,
        }),
        meta.sourceUrl,
        meta.ipAddress,
        now,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?, ?, ?, 'lead', ?, 'created', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        workspace.id,
        attributedTo.id,
        leadId,
        JSON.stringify({
          source: 'marketing_site',
          formSubmissionId: submissionId,
        }),
        now,
      )
      .run();
  } catch (err) {
    // The lead itself is saved; losing the audit rows must not fail the user.
    console.error('marketing contact audit rows failed', {
      leadId,
      workspaceId: workspace.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { leadId, workspaceId: workspace.id };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...securityHeaders() },
  });
}

/**
 * True when the caller is a browser navigating the form itself — no
 * JavaScript — and so needs the rendered page back, not a JSON body it would
 * display as text (GP-004). The site's own fetch() says what it wants
 * explicitly (`X-Requested-With: fetch`, `Accept: application/json`), and an
 * explicit signal beats sniffing: a browser's `Accept: text/html` counts only
 * when nothing asked for JSON.
 */
export function wantsHtml(request: Request): boolean {
  if (request.headers.get('x-requested-with')?.toLowerCase() === 'fetch') {
    return false;
  }
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

/**
 * The contact page rendered in a post-submission state. A POST's response is
 * one visitor's, so it is never cacheable.
 */
function htmlResponse(
  nonce: string,
  status: number,
  state: Partial<ContactContext>,
): Response {
  return new Response(renderMarketingPage('contact', nonce, state), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...securityHeaders(nonce),
    },
  });
}

/** The typed values to echo back into the form — never the honeypot. */
function formValuesFrom(fields: Record<string, string>): ContactFormValues {
  const values = { ...EMPTY_CONTACT_FORM };
  for (const key of Object.keys(values) as (keyof ContactFormValues)[]) {
    values[key] = fields[key] ?? '';
  }
  return values;
}

export const CONTACT_SAVE_FAILED_MESSAGE =
  "We couldn't save your message just now. Please try again in a moment.";

/**
 * POST /contact — validates, persists, then notifies the workspace users.
 *
 * Answers in the shape the caller asked for: JSON for the page's own fetch(),
 * the rendered page for a form the browser submitted without JavaScript
 * (see wantsHtml). Validation and the honeypot behave identically on both.
 */
export async function handleContactForm(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  nonce: string,
): Promise<Response> {
  const html = wantsHtml(request);

  let fields: Record<string, string>;
  try {
    const formData = await request.formData();
    fields = Object.fromEntries(
      [...formData.entries()].map(([key, value]) => [key, String(value)]),
    );
  } catch {
    const message = 'Please check the form and try again.';
    return html
      ? htmlResponse(nonce, 400, { formError: message })
      : jsonResponse(
          { ok: false, error: { code: 'BAD_REQUEST', message } },
          400,
        );
  }

  const validated = validateContact(fields);
  if (validated.ok === false) {
    return html
      ? htmlResponse(nonce, 422, {
          formError: validated.error.message,
          invalidField: validated.error.field,
          form: formValuesFrom(fields),
        })
      : jsonResponse(
          {
            ok: false,
            error: { code: 'VALIDATION_ERROR', ...validated.error },
          },
          400,
        );
  }

  const success = (): Response =>
    html
      ? htmlResponse(nonce, 200, { submitted: true })
      : jsonResponse({ ok: true });

  // Honeypot: pretend success so bots learn nothing.
  if (validated.data.website) {
    return success();
  }

  let persisted: PersistedContact;
  try {
    persisted = await persistContactLead(env, validated.data, {
      sourceUrl: request.headers.get('referer') ?? request.url,
      ipAddress: request.headers.get('cf-connecting-ip'),
    });
  } catch (err) {
    console.error('marketing contact submission failed', {
      code: err instanceof ContactPersistError ? err.code : 'INTERNAL',
      error: err instanceof Error ? err.message : String(err),
    });
    return html
      ? htmlResponse(nonce, 500, {
          formError: CONTACT_SAVE_FAILED_MESSAGE,
          form: formValuesFrom(fields),
        })
      : jsonResponse(
          {
            ok: false,
            error: { code: 'INTERNAL', message: CONTACT_SAVE_FAILED_MESSAGE },
          },
          500,
        );
  }

  // The row is written; notify after the response so a mail provider outage
  // never turns a saved submission into a user-facing error.
  ctx.waitUntil(
    dispatchNotification(env, {
      type: 'new_lead',
      workspaceId: persisted.workspaceId,
      leadName: `${validated.data.firstName} ${validated.data.lastName}`,
      source: 'website',
    }).catch((err: unknown) => {
      console.error('marketing contact notification failed', {
        leadId: persisted.leadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }),
  );

  return success();
}
