import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import {
  attributionUserId,
  coerceScreenAnswers,
  completeSession,
  createLeadFromQuote,
  createSession,
  effectiveAnswers,
  isPanelPhotoEnabled,
  isPhotoStatus,
  listPendingReviews,
  listPublishedFlows,
  listSessionEvents,
  loadFlow,
  loadFlowByVersion,
  loadSession,
  PhotoError,
  readPhoto,
  recordScreen,
  resolvePhotoReview,
  ReviewNotFoundError,
  sessionEnv,
  quoteStageOf,
  step,
  storePanelPhoto,
  type D1Like,
  type EvaluationResult,
  type Json,
  type LoadedFlow,
  type QuoteSessionRow,
  type Screen,
  type SessionStep,
} from '@greenput/shared/pricing';
import {
  CONSENT_TEXT_INTAKE_V1,
  recordConsent,
  type ConsentField,
  type D1Like as ConsentD1Like,
} from '@greenput/shared/consent';

/**
 * Persist the intake consent grant for a lead a finished quote just
 * created (libs/shared/consent): the homeowner gave this workspace their
 * contact details at its quote form to be quoted, scheduled, and
 * contacted about the request. Fields are exactly what the lead
 * carries. A failure is logged by the caller alongside lead failures —
 * the quote the homeowner saw must not disappear over a consent write.
 */
export async function recordIntakeConsent(
  db: D1Like,
  workspaceId: string,
  lead: { leadId: string; email: string; phone: string },
  answers: Record<string, unknown>,
): Promise<void> {
  const fields: ConsentField[] = ['name', 'job_details'];
  if (lead.phone) fields.push('phone');
  if (lead.email) fields.push('email');
  const zip = answers['service_zip'];
  const street = answers['street'];
  if (
    (typeof zip === 'string' && zip.trim()) ||
    (typeof street === 'string' && street.trim())
  ) {
    fields.push('service_address');
  }
  await recordConsent({
    db: db as unknown as ConsentD1Like,
    newId,
    workspaceId,
    leadId: lead.leadId,
    consumerPhone: lead.phone,
    consumerEmail: lead.email,
    fields,
    source: 'intake_quote',
    consentText: CONSENT_TEXT_INTAKE_V1,
  });
}

/**
 * The enrichment form, over HTTP.
 *
 * Two routers, because the form has two audiences. The homeowner filling it in
 * is not logged in and never will be — `publicIntakeRouter` follows the same
 * unauthenticated, workspace-by-slug shape as `routes/public.ts`. The
 * contractor reading what came of it is authenticated and workspace-scoped like
 * every other route here.
 *
 * A session id is a capability: anyone holding one can continue that form. It
 * is a v4 UUID, it is never listed by any public endpoint, and it carries no
 * contractor data — the same trade-off the customer-portal magic links make,
 * and the only one that lets a homeowner finish a form on their phone after
 * closing the tab.
 */

// ── Public: the homeowner's side ─────────────────────────────

export const publicIntakeRouter = Router({ base: '/api/public/intake' });

interface StartBody {
  /** Workspace slug, as on the tenant site. */
  slug?: string;
  /** Flow slug, e.g. "ev-charger-install". */
  flow?: string;
  sourceUrl?: string;
}

interface AnswerBody {
  /** The screen being answered. Rejected if it is not the screen we are on. */
  stateId?: string;
  input?: Record<string, unknown>;
}

/** What a screen looks like on the wire. */
function screenPayload(screen: Screen) {
  return {
    stateId: screen.stateId,
    ask: screen.ask ?? null,
    answer: screen.answer,
    index: screen.index,
    typicalTotal: screen.typicalTotal,
  };
}

/** What a finished quote looks like on the wire. */
function quotePayload(session: QuoteSessionRow, result: EvaluationResult) {
  return {
    sessionId: session.id,
    status: 'complete' as const,
    quote: {
      terminal: result.terminal,
      kind: result.kind,
      title: result.title ?? null,
      low: result.low,
      high: result.high,
      // H1: no price → range → one exact number.
      stage: quoteStageOf(result),
      exact: result.exact ?? null,
      exactBlockers: result.exact_blockers ?? [],
      lines: result.lines ?? [],
      spreadPct: result.spread_pct ?? null,
      spreadReasons: result.spread_reasons ?? [],
      minimumApplied: result.minimum_applied ?? false,
      addons: result.addons ?? [],
      conditions: result.conditions ?? [],
      refusedBecause: result.refused_because ?? null,
      indicative: result.indicative ?? null,
      spans: (result.spans ?? []).map((s) => ({
        id: s.id,
        low: s.low,
        high: s.high,
      })),
    },
  };
}

function stepPayload(session: QuoteSessionRow, walked: SessionStep) {
  if (walked.status === 'complete') return quotePayload(session, walked.result);
  return {
    sessionId: session.id,
    status: 'question' as const,
    screen: screenPayload(walked.screen),
  };
}

async function resolveWorkspace(
  env: Env,
  slug: string,
): Promise<{ id: string } | null> {
  return env.DB.prepare('SELECT id FROM workspaces WHERE slug = ? LIMIT 1')
    .bind(slug)
    .first<{ id: string }>();
}

// GET /api/public/intake/flows?slug=acme — what this tenant can quote
publicIntakeRouter.get('/flows', async (req: IRequest, env: Env) => {
  const url = new URL((req as unknown as Request).url);
  const slug = url.searchParams.get('slug')?.trim() ?? '';
  if (!slug)
    return error('Workspace slug is required', 400, 'VALIDATION_ERROR');

  const workspace = await resolveWorkspace(env, slug);
  if (!workspace) return notFound('Workspace');

  const flows = await listPublishedFlows(
    env.DB as unknown as D1Like,
    workspace.id,
  );
  return json({
    data: flows.map((f) => ({
      slug: f.slug,
      name: f.name,
      vertical: f.vertical,
      description: f.description,
    })),
  });
});

// POST /api/public/intake/sessions — start a form and get its first screen
publicIntakeRouter.post('/sessions', async (req: IRequest, env: Env) => {
  let body: StartBody;
  try {
    body = await (req as unknown as Request).json();
  } catch {
    return error('Invalid JSON body', 400, 'BAD_REQUEST');
  }

  const slug = body.slug?.trim() ?? '';
  const flowSlug = body.flow?.trim() ?? '';
  if (!slug)
    return error('Workspace slug is required', 400, 'VALIDATION_ERROR');
  if (!flowSlug) return error('Flow slug is required', 400, 'VALIDATION_ERROR');

  const workspace = await resolveWorkspace(env, slug);
  if (!workspace) return notFound('Workspace');

  const db = env.DB as unknown as D1Like;
  const flow = await loadFlow(db, workspace.id, flowSlug);
  if (!flow) return notFound('Flow');

  const session = await createSession(db, {
    id: newId(),
    workspaceId: workspace.id,
    flow,
    sourceUrl: body.sourceUrl?.trim() || null,
  });

  const walked = step(flow.machine, flow.rateCard, {}, {});
  return json({ data: stepPayload(session, walked) }, 201);
});

/** Load a session and the exact machine version it was started on. */
async function loadSessionAndFlow(
  env: Env,
  sessionId: string,
): Promise<{ session: QuoteSessionRow; flow: LoadedFlow } | null> {
  const db = env.DB as unknown as D1Like;
  const session = await loadSession(db, sessionId);
  if (!session) return null;
  const flow = await loadFlowByVersion(
    db,
    session.fsm_version_id,
    session.rate_card_version_id,
  );
  if (!flow) return null;
  return { session, flow };
}

// GET /api/public/intake/sessions/:id — the screen this form is on
publicIntakeRouter.get('/sessions/:id', async (req: IRequest, env: Env) => {
  const found = await loadSessionAndFlow(env, req.params['id']);
  if (!found) return notFound('Quote session');
  const { session, flow } = found;

  const walked = step(
    flow.machine,
    flow.rateCard,
    await effectiveAnswers(env.DB as unknown as D1Like, session),
    sessionEnv(session),
  );
  return json({ data: stepPayload(session, walked) });
});

// POST /api/public/intake/sessions/:id/answers — answer a screen and advance
publicIntakeRouter.post(
  '/sessions/:id/answers',
  async (req: IRequest, env: Env) => {
    let body: AnswerBody;
    try {
      body = await (req as unknown as Request).json();
    } catch {
      return error('Invalid JSON body', 400, 'BAD_REQUEST');
    }

    const found = await loadSessionAndFlow(env, req.params['id']);
    if (!found) return notFound('Quote session');
    const { session, flow } = found;

    if (session.status !== 'in_progress') {
      return error(
        'This quote is already finished',
        409,
        'SESSION_ALREADY_COMPLETE',
      );
    }

    const db = env.DB as unknown as D1Like;
    const answers = await effectiveAnswers(db, session);
    const env_ = sessionEnv(session);
    const before = step(flow.machine, flow.rateCard, answers, env_);
    if (before.status !== 'question') {
      // Nothing left to ask: finish rather than accept an answer for no screen.
      return json({ data: await finish(db, session, flow) });
    }

    // The screen the client thinks it is answering must be the one we are on.
    // Without this, a stale tab or a double submit writes an answer under the
    // wrong keys and silently changes the price.
    if (body.stateId && body.stateId !== before.screen.stateId) {
      return error(
        `This form has moved on — it is on "${before.screen.stateId}", not "${body.stateId}"`,
        409,
        'STALE_SCREEN',
      );
    }

    const state = {
      id: before.screen.stateId,
      kind: 'question' as const,
      answer: before.screen.answer,
      next: [],
    };
    const coerced = coerceScreenAnswers(state, body.input ?? {});
    if (!coerced.ok) {
      // `field` names the offending answer key so a client can focus it; the
      // screen itself is unchanged, so a client that wants it back re-reads
      // GET /sessions/:id.
      return json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: coerced.errors[0].message,
            field: coerced.errors[0].key,
          },
        },
        400,
      );
    }

    const merged = { ...answers, ...coerced.answers };
    const after = step(flow.machine, flow.rateCard, merged, env_);
    const updated = await recordScreen(db, session, {
      fromStateId: before.screen.stateId,
      toStateId:
        after.status === 'question'
          ? after.screen.stateId
          : after.result.terminal,
      submitted: body.input ?? {},
      answers: coerced.answers,
      eventId: newId(),
    });

    if (after.status === 'complete') {
      return json({ data: await finish(db, updated, flow) });
    }
    return json({ data: stepPayload(updated, after) });
  },
);

/**
 * POST /api/public/intake/sessions/:id/photo — attach the panel photo.
 *
 * `multipart/form-data`, because the thing being sent is a file off a phone.
 * The upload IS the answer to the photo screen: storing it opens a review row,
 * and `effectiveAnswers()` overlays that row as `{status: 'unreviewed'}`, so
 * the traversal moves on without the client ever asserting anything about the
 * panel. Skipping the photo is the ordinary answers endpoint with
 * `{panel_photo: {status: 'missing'}}`.
 *
 * Gated on `intake_panel_photo`, and 404 rather than 403 while it is off —
 * dark means undiscoverable, not "forbidden, come back later".
 */
publicIntakeRouter.post(
  '/sessions/:id/photo',
  async (req: IRequest, env: Env) => {
    const db = env.DB as unknown as D1Like;
    const found = await loadSessionAndFlow(env, req.params['id']);
    if (!found) return notFound('Quote session');
    const { session, flow } = found;

    if (!(await isPanelPhotoEnabled(env.DB, { sessionId: session.id }))) {
      return notFound('Photo upload');
    }
    if (!env.FILES) {
      return error(
        'Photo uploads are not available on this deployment',
        503,
        'PHOTO_STORAGE_UNAVAILABLE',
      );
    }
    if (session.status !== 'in_progress') {
      return error(
        'This quote is already finished',
        409,
        'SESSION_ALREADY_COMPLETE',
      );
    }

    const before = step(
      flow.machine,
      flow.rateCard,
      await effectiveAnswers(db, session),
      sessionEnv(session),
    );
    if (before.status !== 'question' || before.screen.answer.type !== 'photo') {
      return error(
        'This form is not asking for a photo right now',
        409,
        'NOT_A_PHOTO_SCREEN',
      );
    }
    const answerKey = before.screen.answer.key as string;

    let form: FormData;
    try {
      form = await (req as unknown as Request).formData();
    } catch {
      return error('Send the photo as multipart/form-data', 400, 'BAD_REQUEST');
    }
    const candidate =
      form.get('file') ?? form.get(answerKey) ?? form.get('photo');
    if (!candidate || typeof candidate === 'string') {
      return error(
        `Attach the photo as a file field named "file"`,
        400,
        'VALIDATION_ERROR',
      );
    }

    const attributedTo = await attributionUserId(db, session.workspace_id);
    if (!attributedTo) {
      return error('This workspace has no users', 500, 'INTERNAL');
    }

    let stored;
    try {
      stored = await storePanelPhoto({
        bucket: env.FILES,
        db,
        workspaceId: session.workspace_id,
        sessionId: session.id,
        answerKey,
        vertical: flow.fsm.vertical,
        file: candidate as File,
        // files.uploaded_by is NOT NULL → users(id); a homeowner is not one.
        uploadedBy: attributedTo,
        newId,
      });
    } catch (err) {
      if (err instanceof PhotoError)
        return error(err.message, err.status, err.code);
      throw err;
    }

    // The photo answers the screen. Record the move so the event log still
    // shows the route taken, with the file — never the bytes — as the input.
    const after = step(
      flow.machine,
      flow.rateCard,
      await effectiveAnswers(db, session),
      sessionEnv(session),
    );
    const updated = await recordScreen(db, session, {
      fromStateId: before.screen.stateId,
      toStateId:
        after.status === 'question'
          ? after.screen.stateId
          : after.result.terminal,
      submitted: {
        [answerKey]: {
          fileId: stored.fileId,
          filename: stored.filename,
          contentType: stored.contentType,
          size: stored.size,
          status: stored.reading.status,
        },
      },
      answers: {},
      eventId: newId(),
    });

    if (after.status === 'complete') {
      return json({ data: await finish(db, updated, flow) }, 201);
    }
    return json(
      {
        data: {
          ...stepPayload(updated, after),
          photo: {
            fileId: stored.fileId,
            filename: stored.filename,
            size: stored.size,
            status: stored.reading.status,
            // The seam's honest report: nothing has read this image yet.
            interpretedBy: stored.reading.method,
          },
        },
      },
      201,
    );
  },
);

// GET /api/public/intake/sessions/:id/quote — the range, once there is one
publicIntakeRouter.get(
  '/sessions/:id/quote',
  async (req: IRequest, env: Env) => {
    const found = await loadSessionAndFlow(env, req.params['id']);
    if (!found) return notFound('Quote session');
    const { session, flow } = found;

    const walked = step(
      flow.machine,
      flow.rateCard,
      await effectiveAnswers(env.DB as unknown as D1Like, session),
      sessionEnv(session),
    );
    if (walked.status !== 'complete') {
      return error('This quote is not finished yet', 409, 'SESSION_INCOMPLETE');
    }
    return json({ data: quotePayload(session, walked.result) });
  },
);

/**
 * Freeze the outcome and, if the form got as far as asking who they are, hand
 * the contractor a lead. Idempotent: completing an already-complete session
 * re-reads the same numbers and writes no second lead.
 */
async function finish(
  db: D1Like,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<ReturnType<typeof quotePayload>> {
  const walked = step(
    flow.machine,
    flow.rateCard,
    await effectiveAnswers(db, session),
    sessionEnv(session),
  );
  if (walked.status !== 'complete') {
    throw new Error('finish() called on a session that has screens left');
  }

  let current = session;
  if (session.status !== 'completed') {
    current = await completeSession(db, session, walked.result);
  }

  try {
    const lead = await createLeadFromQuote({
      db,
      session: current,
      machine: flow.machine,
      answers: walked.result.answers,
      result: walked.result,
      newId,
    });
    if (lead) {
      await recordIntakeConsent(
        db,
        current.workspace_id,
        lead,
        walked.result.answers,
      );
    }
  } catch (err) {
    // A quote the homeowner has already seen must not disappear because the
    // lead write failed. Log it and return the price.
    console.error('intake: lead creation failed', {
      workspaceId: current.workspace_id,
      sessionId: current.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return quotePayload(current, walked.result);
}

// ── Contractor-facing: what came of it ───────────────────────

export const intakeRouter = Router({ base: '/api/intake' });

const workspaceOf = (req: IRequest): string =>
  (req as unknown as { workspaceId: string }).workspaceId;

// GET /api/intake/flows — the flows this workspace's site is offering
intakeRouter.get('/flows', async (req: IRequest, env: Env) => {
  const flows = await listPublishedFlows(
    env.DB as unknown as D1Like,
    workspaceOf(req),
  );
  return json({
    data: flows.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      vertical: f.vertical,
      description: f.description,
      /** NULL workspace_id means this is a Greenput template, not their own. */
      isTemplate: f.workspace_id === null,
    })),
  });
});

// GET /api/intake/sessions — every form started on this workspace's site
intakeRouter.get('/sessions', async (req: IRequest, env: Env) => {
  const url = new URL((req as unknown as Request).url);
  const { limit, offset, page } = paginate(url);
  const status = url.searchParams.get('status');

  const where = ['s.workspace_id = ?'];
  const binds: unknown[] = [workspaceOf(req)];
  if (status) {
    where.push('s.status = ?');
    binds.push(status);
  }
  const clause = where.join(' AND ');

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM pricing_quote_sessions s WHERE ${clause}`,
  )
    .bind(...binds)
    .first<{ n: number }>();

  const rows = await env.DB.prepare(
    `SELECT s.id, s.status, s.terminal_id, s.quote_low, s.quote_high, s.lead_id,
            s.started_at, s.updated_at, s.completed_at, s.current_state_id,
            f.slug AS flow_slug, f.name AS flow_name, f.vertical
     FROM pricing_quote_sessions s
     JOIN pricing_fsms f ON f.id = s.fsm_id
     WHERE ${clause}
     ORDER BY s.started_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<Record<string, unknown>>();

  return json({
    data: rows.results ?? [],
    meta: { total: total?.n ?? 0, page, perPage: limit },
  });
});

// GET /api/intake/sessions/:id — one form, its answers, its route and its price
intakeRouter.get('/sessions/:id', async (req: IRequest, env: Env) => {
  const db = env.DB as unknown as D1Like;
  const session = await loadSession(db, req.params['id']);
  // Scoped by workspace, not just by id: a session id from another workspace
  // must read as absent, not as forbidden.
  if (!session || session.workspace_id !== workspaceOf(req)) {
    return notFound('Quote session');
  }

  const flow = await loadFlowByVersion(
    db,
    session.fsm_version_id,
    session.rate_card_version_id,
  );
  if (!flow) return error('This flow version is missing', 500, 'INTERNAL');

  const answers = await effectiveAnswers(db, session);
  const walked = step(
    flow.machine,
    flow.rateCard,
    answers,
    sessionEnv(session),
  );
  const events = await listSessionEvents(db, session.id);

  return json({
    data: {
      id: session.id,
      status: session.status,
      flow: {
        slug: flow.fsm.slug,
        name: flow.fsm.name,
        vertical: flow.fsm.vertical,
        versionNumber: flow.version.version_number,
      },
      leadId: session.lead_id,
      answers,
      currentStateId: session.current_state_id,
      startedAt: session.started_at,
      completedAt: session.completed_at,
      quote:
        walked.status === 'complete'
          ? quotePayload(session, walked.result).quote
          : null,
      nextScreen:
        walked.status === 'question' ? screenPayload(walked.screen) : null,
      events: events.map((e) => ({
        seq: e.seq,
        from: e.from_state_id,
        to: e.to_state_id,
        input: JSON.parse(e.input) as unknown,
        createdAt: e.created_at,
      })),
    },
  });
});

// ── The review queue: closing "widen until a human confirms" ──
//
// A spanning quote is a promise that a person will look at the photo and
// narrow it. These three routes are that person's surface: what is waiting,
// the image itself, and the verdict. Everything about what a verdict may do
// to a price lives in `resolvePhotoReview()` — including the rule that a
// reading which escapes the range already shown never reprices silently.

interface ReviewBody {
  status?: string;
  fields?: Record<string, Json>;
}

// GET /api/intake/reviews — panel photos still waiting on a human
intakeRouter.get('/reviews', async (req: IRequest, env: Env) => {
  const url = new URL((req as unknown as Request).url);
  const { limit } = paginate(url);
  const reviews = await listPendingReviews(
    env.DB as unknown as D1Like,
    workspaceOf(req),
    limit,
  );
  return json({
    data: reviews,
    meta: { total: reviews.length, page: 1, perPage: limit },
  });
});

// GET /api/intake/reviews/:id/photo — the image, streamed from R2
intakeRouter.get('/reviews/:id/photo', async (req: IRequest, env: Env) => {
  if (!env.FILES) {
    return error(
      'Photo storage is not available on this deployment',
      503,
      'PHOTO_STORAGE_UNAVAILABLE',
    );
  }
  const row = await env.DB.prepare(
    `SELECT f.r2_key, f.content_type, f.filename
       FROM pricing_photo_reviews r
       JOIN files f ON f.id = r.file_id
      WHERE r.id = ? AND r.workspace_id = ?`,
  )
    .bind(req.params['id'], workspaceOf(req))
    .first<{ r2_key: string; content_type: string; filename: string }>();
  if (!row) return notFound('Photo review');

  const object = await readPhoto(env.FILES, row.r2_key);
  if (!object) return notFound('Photo');

  return new Response(object.body, {
    headers: {
      'Content-Type': object.contentType || row.content_type,
      // A homeowner's panel is not a public asset and must never be cached by
      // anything between R2 and the contractor looking at it.
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${row.filename.replace(/"/g, '')}"`,
    },
  });
});

// POST /api/intake/reviews/:id — what the electrician read off the photo
intakeRouter.post('/reviews/:id', async (req: IRequest, env: Env) => {
  let body: ReviewBody;
  try {
    body = await (req as unknown as Request).json();
  } catch {
    return error('Invalid JSON body', 400, 'BAD_REQUEST');
  }

  const status = String(body.status ?? '').trim();
  if (!isPhotoStatus(status) || status === 'missing') {
    return error(
      'status must be one of: reviewed, unreadable, unreviewed',
      400,
      'VALIDATION_ERROR',
    );
  }
  const fields =
    body.fields &&
    typeof body.fields === 'object' &&
    !Array.isArray(body.fields)
      ? body.fields
      : {};
  if (status !== 'reviewed' && Object.keys(fields).length > 0) {
    return error(
      'Only a reviewed photo carries fields',
      400,
      'VALIDATION_ERROR',
    );
  }

  const user = (req as unknown as { user: { id: string } }).user;
  try {
    const outcome = await resolvePhotoReview({
      db: env.DB as unknown as D1Like,
      reviewId: req.params['id'],
      workspaceId: workspaceOf(req),
      status,
      fields,
      reviewedBy: user.id,
      newId,
    });
    return json({ data: reviewOutcomePayload(outcome) });
  } catch (err) {
    if (err instanceof ReviewNotFoundError) return notFound('Photo review');
    throw err;
  }
});

/** What one resolved review looks like on the wire. */
function reviewOutcomePayload(
  outcome: Awaited<ReturnType<typeof resolvePhotoReview>>,
) {
  const base = {
    reviewId: outcome.review.id,
    sessionId: outcome.session.id,
    answerKey: outcome.review.answer_key,
    status: outcome.review.status,
    outcome: outcome.kind,
  };
  if (outcome.kind === 'pending') {
    return {
      ...base,
      // Ops beat the homeowner to it. Their price will already be the narrow
      // one when they finish — nothing else to do.
      message: 'Recorded. This form is not finished, so there is no range yet.',
      quote: null,
    };
  }
  if (outcome.kind === 'requires_call') {
    return {
      ...base,
      message: outcome.reason,
      shown: outcome.shown,
      revealed: outcome.revealed,
      quote: quotePayload(outcome.session, outcome.result).quote,
      quoteApplied: false,
    };
  }
  if (outcome.kind === 'unchanged') {
    return {
      ...base,
      message: 'Recorded. The range is unchanged.',
      shown: outcome.shown,
      quote: quotePayload(outcome.session, outcome.result).quote,
      quoteApplied: true,
    };
  }
  return {
    ...base,
    message: 'The range has been narrowed and the lead updated.',
    shown: outcome.shown,
    revealed: outcome.revealed,
    qualified: outcome.qualified,
    leadId: outcome.leadId,
    quote: quotePayload(outcome.session, outcome.result).quote,
    quoteApplied: true,
  };
}
