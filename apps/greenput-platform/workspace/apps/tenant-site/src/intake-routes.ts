import {
  attributionUserId,
  coerceScreenAnswers,
  completeSession,
  createLeadFromQuote,
  createSession,
  effectiveAnswers,
  isPanelPhotoEnabled,
  listPublishedFlows,
  listSessionEvents,
  loadFlow,
  loadFlowByVersion,
  loadSession,
  PhotoError,
  previousStateId,
  recordScreen,
  restartSession,
  rewindTo,
  sessionEnv,
  step,
  storePanelPhoto,
  undoneInputFor,
  type Answers,
  type D1Like,
  type FieldError,
  type LoadedFlow,
  type EvaluationResult,
  type QuoteSessionRow,
  type Screen,
} from '@greenput/shared/pricing';
import { SLOT_TAKEN_MESSAGE } from '@greenput/shared/scheduling';
import {
  CONSENT_TEXT_INTAKE_V1,
  recordConsent,
  type ConsentField,
  type D1Like as ConsentD1Like,
} from '@greenput/shared/consent';
import {
  bookQuotedJob,
  cancelQuotedJob,
  findBookedJob,
  findCancelledBooking,
  jobDurationMinutes,
  offerSlots,
  rescheduleQuotedJob,
  type BookedJob,
  type SlotOffer,
} from './booking';
import type { Env } from './env';
import {
  bookingWhen,
  isWithdrawnReason,
  renderIntakeBookedPage,
  renderIntakeBookingPage,
  renderIntakeCancelPage,
  renderIntakeIndexPage,
  renderIntakeQuotePage,
  renderIntakeScreenPage,
} from './intake';
import { renderTenantErrorShell, type WorkspaceData } from './render';

/**
 * The quote form's request handling.
 *
 * Three routes, all on the tenant's own origin — which is not an accident. The
 * tenant site's CSP is `connect-src 'self'` and `form-action 'self'`, so a form
 * that posted to `api.greenput.com` would be blocked by the browser before it
 * left the page. Posting here instead means the form works with JavaScript
 * turned off, on a phone with one bar, standing in a garage.
 *
 *   GET  /quote            the list of jobs this contractor prices instantly
 *   POST /quote/start      begins a session, then 303 to the first screen
 *   GET  /quote/s/:id      the screen the form is on, the finished price, or
 *                          — once booked — the confirmation
 *   POST /quote/s/:id      answers that screen and moves on — or, with
 *                          nav=back / nav=restart, steps back a screen or
 *                          starts the form over on the same id (GP-014)
 *   GET  /quote/s/:id/book   the times this quote can be booked for (GP-103)
 *   POST /quote/s/:id/book   books one of them, then 303 to the confirmation
 *   GET  /quote/s/:id/booked the confirmation
 *   GET  /quote/s/:id/reschedule  the times the booking could move to (GP-105)
 *   POST /quote/s/:id/reschedule  moves it, in one batch, then 303 to /booked
 *   GET  /quote/s/:id/cancel      the reason question and the one button
 *   POST /quote/s/:id/cancel      cancels the job (the booking's lead fee stands —
 *                                 WS-1), 303 to the price
 *
 * POST-redirect-GET throughout, so a refresh never re-submits an answer. The
 * one exception is a rejected answer, which is re-rendered in place with the
 * message attached to the field that caused it — and a slot that was taken
 * between the page being shown and the form being sent, which re-renders the
 * picker with the times that are still free.
 *
 * Every screen is the same URL and the screen shown is derived from what is
 * stored, so the browser's own Back button cannot move the form: it re-GETs
 * the furthest question. Going back is therefore a write — `rewindTo` in the
 * pricing store, which rebuilds the answers from the surviving events and
 * appends one row saying so — and the form's own Back control is a named
 * submit that asks for it. Start over is the same shape (`restartSession`).
 * Neither touches a BOOKED session: once a job is on the calendar the
 * capability URL is the booking, and both moves redirect to the confirmation.
 *
 * The session id is the capability: a v4 UUID that was never listed and
 * carries no contractor data. Booking rides the same one, so a homeowner who
 * closed the tab can come back to their price AND to their booking without an
 * account — and change or cancel it (GP-105). No lead id or job id ever
 * crosses to the browser: the session maps to both server-side, and the
 * workspace every write is scoped to is the session row's, never input.
 */

export type QuoteResponse =
  | { kind: 'html'; status: number; html: string }
  | { kind: 'redirect'; location: string }
  | { kind: 'none' };

const NOT_A_QUOTE_PATH: QuoteResponse = { kind: 'none' };

export function isQuotePath(pathname: string): boolean {
  return pathname === '/quote' || pathname.startsWith('/quote/');
}

/**
 * Handle a quote-form request, or return `{kind:'none'}` if the path is not one
 * of ours. The caller owns the Response, so security headers stay in one place.
 */
export async function handleQuoteRequest(
  request: Request,
  env: Env,
  workspace: WorkspaceData,
): Promise<QuoteResponse> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/quote';
  const db = env.DB as unknown as D1Like;

  if (path === '/quote' && request.method === 'GET') {
    const flows = (await listPublishedFlows(db, workspace.id)).map((f) => ({
      slug: f.slug,
      name: f.name,
      description: f.description,
      vertical: f.vertical,
    }));
    // `?flow=<slug>` is a shareable deep link to one flow (a page about EV
    // chargers linking straight to that quote). It only narrows the list:
    // a GET may be followed by a crawler or a link preview, so it never
    // creates a session — the homeowner still presses the one Start, which
    // POSTs to /quote/start like every other card. A slug this tenant does
    // not publish falls back to the full list rather than a dead end.
    const wanted = url.searchParams.get('flow')?.trim();
    const only = wanted ? flows.find((f) => f.slug === wanted) : undefined;
    return {
      kind: 'html',
      status: 200,
      html: renderIntakeIndexPage(workspace, only ? [only] : flows, {
        showAllLink: Boolean(only) && flows.length > 1,
      }),
    };
  }

  if (path === '/quote/start' && request.method === 'POST') {
    const form = await request.formData();
    const flowSlug = String(form.get('flow') ?? '').trim();
    const flow = flowSlug ? await loadFlow(db, workspace.id, flowSlug) : null;
    if (!flow) {
      return notFound(workspace, 'We could not find that quote form.');
    }

    const session = await createSession(db, {
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      flow,
      sourceUrl: request.headers.get('referer'),
    });
    return { kind: 'redirect', location: `/quote/s/${session.id}` };
  }

  const match =
    /^\/quote\/s\/([0-9a-fA-F-]{36})(?:\/(book|booked|reschedule|cancel))?$/.exec(
      path,
    );
  if (!match) return NOT_A_QUOTE_PATH;
  const sessionId = match[1];
  const action = match[2];

  const loaded = await loadSessionFor(db, sessionId, workspace.id);
  if (!loaded) {
    return notFound(
      workspace,
      'This quote link is not valid any more. You can start a new one from the quote page.',
    );
  }
  const { session, flow } = loaded;

  if (action === 'book') {
    if (request.method === 'GET') {
      return renderBooking(env, workspace, session, flow);
    }
    if (request.method === 'POST') {
      return submitBooking(request, env, workspace, session, flow);
    }
    return NOT_A_QUOTE_PATH;
  }
  if (action === 'booked') {
    if (request.method !== 'GET') return NOT_A_QUOTE_PATH;
    return renderBooked(env, workspace, session, flow);
  }
  if (action === 'reschedule') {
    if (request.method === 'GET') {
      return renderReschedule(env, workspace, session, flow);
    }
    if (request.method === 'POST') {
      return submitReschedule(request, env, workspace, session, flow);
    }
    return NOT_A_QUOTE_PATH;
  }
  if (action === 'cancel') {
    if (request.method === 'GET') {
      return renderCancel(env, workspace, session, flow);
    }
    if (request.method === 'POST') {
      return submitCancel(request, env, workspace, session, flow);
    }
    return NOT_A_QUOTE_PATH;
  }

  if (request.method === 'GET') {
    return renderCurrent(workspace, session, flow, env);
  }
  if (request.method !== 'POST') return NOT_A_QUOTE_PATH;

  return submitScreen(request, env, workspace, session, flow);
}

// ── Pieces ────────────────────────────────────────────────────

/**
 * Still the contractor's site (GP-040): nav, footer, phone, and the two ways
 * out — the quote page the message names, and home. Every session route,
 * booking and cancellation included, 404s through here.
 */
function notFound(workspace: WorkspaceData, message: string): QuoteResponse {
  return {
    kind: 'html',
    status: 404,
    html: renderTenantErrorShell(workspace, {
      title: 'Quote not found',
      message,
      actions: [
        { href: '/quote', label: 'Start a new quote' },
        { href: '/', label: 'Back to home' },
      ],
    }),
  };
}

async function loadSessionFor(
  db: D1Like,
  sessionId: string,
  workspaceId: string,
): Promise<{ session: QuoteSessionRow; flow: LoadedFlow } | null> {
  const session = await loadSession(db, sessionId);
  // Scoped to the tenant whose site this is: a session id from another
  // contractor's site reads as absent here, not as someone else's form.
  if (!session || session.workspace_id !== workspaceId) return null;
  const flow = await loadFlowByVersion(
    db,
    session.fsm_version_id,
    session.rate_card_version_id,
  );
  if (!flow) return null;
  return { session, flow };
}

/**
 * True when this deployment can take a panel photo at all: a bucket to put it
 * in, and the flag that opens the review queue behind it turned on. Both, or
 * the form offers no file input and says so — a photo stored with nowhere to
 * be read is worse than no photo, because the range never narrows and nobody
 * knows why.
 */
async function photoStoreAvailable(
  env: Env,
  sessionId: string,
): Promise<boolean> {
  if (!env.INTAKE_PHOTOS) return false;
  return isPanelPhotoEnabled(env.DB, { sessionId });
}

async function renderCurrent(
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
  env: Env,
  fieldErrors?: FieldError[],
  pending?: Answers,
): Promise<QuoteResponse> {
  // The screen comes from what is STORED, never from what was just rejected.
  // Merging a rejected answer in would make the walk think the screen had been
  // answered and step straight past the thing the homeowner has to fix.
  const answers = await effectiveAnswers(env.DB as unknown as D1Like, session);
  const walked = step(
    flow.machine,
    flow.rateCard,
    answers,
    sessionEnv(session),
  );

  if (walked.status === 'complete') {
    // Once booked, the capability URL IS the booking: the confirmation, not
    // the price with an offer to book it again.
    const booked = await findBookedJob(env.DB, session);
    if (booked) {
      return renderBookedFor(
        env,
        workspace,
        session,
        flow,
        walked.result,
        booked,
      );
    }
    const offer = await offerSlots(
      env.DB,
      workspace.id,
      walked.result,
      new Date(),
    );
    // A cancelled booking (GP-105) is the price page again, saying so, with
    // the offer to book another time.
    const cancelled = await findCancelledBooking(env.DB, session);
    return {
      kind: 'html',
      status: 200,
      html: renderIntakeQuotePage(workspace, {
        sessionId: session.id,
        flowName: flow.fsm.name,
        result: walked.result,
        // An offer with nothing in it is not an offer: the contractor is
        // booked to the horizon, and the card with their number says more
        // than a picker with no times would.
        booking:
          offer && offer.slots.length > 0
            ? { sessionId: session.id, durationMinutes: offer.durationMinutes }
            : undefined,
        cancelled: cancelled
          ? {
              when: bookingWhen(
                cancelled,
                await workspaceTimezone(env, workspace.id),
              ),
            }
          : undefined,
      }),
    };
  }

  // Where Back goes, and what to show on a screen they stepped back to,
  // both come from the event log — never from the browser's claim.
  const events = await listSessionEvents(
    env.DB as unknown as D1Like,
    session.id,
  );
  return {
    kind: 'html',
    status: fieldErrors && fieldErrors.length > 0 ? 422 : 200,
    html: renderIntakeScreenPage(workspace, {
      sessionId: session.id,
      flowName: flow.fsm.name,
      screen: walked.screen,
      // What they typed wins for redisplay, so a rejected screen comes back
      // with their own words in it rather than blank. On a screen they went
      // back to, what they had chosen is shown again so one mis-tap is a
      // one-tap fix — shown, not stored: the rewind took it out of the
      // answers, and only a Continue puts an answer back.
      values: {
        ...answers,
        ...recalledAnswers(flow, events, walked.screen.stateId),
        ...(pending ?? {}),
      },
      fieldErrors,
      photoUploadAvailable: await photoStoreAvailable(env, session.id),
      prevStateId: previousStateId(events),
    }),
  };
}

/** The undone answer for a screen, through the same coercion it was stored by. */
function recalledAnswers(
  flow: LoadedFlow,
  events: Awaited<ReturnType<typeof listSessionEvents>>,
  stateId: string,
): Answers {
  const input = undoneInputFor(events, stateId);
  const state = flow.machine.states.find((s) => s.id === stateId);
  if (!input || !state) return {};
  const coerced = coerceScreenAnswers(state, input);
  return coerced.ok ? coerced.answers : {};
}

async function submitScreen(
  request: Request,
  env: Env,
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<QuoteResponse> {
  const db = env.DB as unknown as D1Like;
  const form = await request.formData();

  // Back and Start over, before anything else reads the form: before the
  // finished-session redirect (the price page offers Start over), and before
  // the stale-tab guard below, which would otherwise swallow a Back from a
  // screen the session has moved past as a stale submission.
  const nav = String(form.get('nav') ?? '');
  if (nav === 'back' || nav === 'restart') {
    return navigate(nav, form, env, session, flow);
  }

  if (session.status !== 'in_progress') {
    return { kind: 'redirect', location: `/quote/s/${session.id}` };
  }

  const answers = await effectiveAnswers(db, session);
  const facts = sessionEnv(session);
  const before = step(flow.machine, flow.rateCard, answers, facts);
  if (before.status === 'complete') {
    await finish(db, session, flow);
    return { kind: 'redirect', location: `/quote/s/${session.id}` };
  }

  // A stale tab must not write an answer under the wrong keys. If the screen
  // the browser submitted is not the screen this session is on, send it back to
  // look at where it actually is.
  const submittedState = String(form.get('stateId') ?? '');
  if (submittedState && submittedState !== before.screen.stateId) {
    return { kind: 'redirect', location: `/quote/s/${session.id}` };
  }

  const input = await collectInput(form, before.screen, env, session, flow);
  const coerced = coerceScreenAnswers(
    {
      id: before.screen.stateId,
      kind: 'question',
      answer: before.screen.answer,
      next: [],
    },
    input,
  );

  if (!coerced.ok) {
    return renderCurrent(
      workspace,
      session,
      flow,
      env,
      coerced.errors,
      toPending(input),
    );
  }

  const merged = { ...answers, ...coerced.answers };
  const after = step(flow.machine, flow.rateCard, merged, facts);
  const updated = await recordScreen(db, session, {
    fromStateId: before.screen.stateId,
    toStateId:
      after.status === 'question'
        ? after.screen.stateId
        : after.result.terminal,
    // The raw submission, minus the photo bytes — the keys stay, so the event
    // log still records that a photo was attached and what it was called.
    submitted: redact(input),
    answers: coerced.answers,
    eventId: crypto.randomUUID(),
  });

  if (after.status === 'complete') await finish(db, updated, flow);
  return { kind: 'redirect', location: `/quote/s/${session.id}` };
}

/**
 * Step back a screen, or start over (GP-014). Always a redirect to the
 * session's own URL, whatever happened: the GET renders whichever screen the
 * stored answers now reach, or the confirmation if the job is booked.
 *
 * A booked session is never rewound or reset. The price was booked as
 * shown; changing the answers under a job on the calendar would make the
 * confirmation describe work nobody priced. The confirmation page is where
 * a booked homeowner changes things, and it has its own two controls.
 *
 * `prevStateId` is the hidden field the screen carried, and `rewindTo`
 * re-checks it against the session's own event log — an unknown value is a
 * no-op, and so is Back from anywhere but a screen.
 */
async function navigate(
  nav: 'back' | 'restart',
  form: FormData,
  env: Env,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<QuoteResponse> {
  if (await findBookedJob(env.DB, session)) return backToQuote(session);
  const db = env.DB as unknown as D1Like;
  if (nav === 'restart') {
    await restartSession(db, session, { eventId: crypto.randomUUID() });
  } else if (session.status === 'in_progress') {
    await rewindTo(db, session, String(form.get('prevStateId') ?? ''), {
      machine: flow.machine,
      eventId: crypto.randomUUID(),
    });
  }
  return backToQuote(session);
}

/**
 * Turn the submitted form into the shape `coerceScreenAnswers` reads.
 *
 * Checkbox groups arrive as repeated keys, so they are collected into arrays.
 * A photo screen is handled here because it is the one field whose value is
 * produced by a side effect rather than by the browser.
 */
async function collectInput(
  form: FormData,
  screen: Screen,
  env: Env,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    if (NAVIGATION_FIELDS.has(key)) continue;
    const values = form.getAll(key).filter((v) => typeof v === 'string');
    if (values.length === 0) continue;
    input[key] = values.length > 1 ? values : values[0];
  }

  if (screen.answer.type !== 'photo') return input;

  const key = screen.answer.key as string;
  const skipped = form.get('skip') !== null;
  const files = form
    .getAll(key)
    .filter(
      (v): v is File =>
        typeof v !== 'string' && v instanceof File && v.size > 0,
    );

  // The traversal never waits for a photo, so a skipped one — or one this
  // deployment cannot store — is a real answer of `missing`, not an error.
  if (
    skipped ||
    files.length === 0 ||
    !env.INTAKE_PHOTOS ||
    !(await photoStoreAvailable(env, session.id))
  ) {
    input[key] = { status: 'missing' };
    return input;
  }

  const db = env.DB as unknown as D1Like;
  const uploadedBy = await attributionUserId(db, session.workspace_id);
  if (!uploadedBy) {
    input[key] = { status: 'missing' };
    return input;
  }

  const stored: Array<{ fileId: string; filename: string; size: number }> = [];
  for (const file of files) {
    try {
      const put = await storePanelPhoto({
        bucket: env.INTAKE_PHOTOS,
        db,
        workspaceId: session.workspace_id,
        sessionId: session.id,
        answerKey: key,
        vertical: flow.fsm.vertical,
        file,
        // files.uploaded_by is NOT NULL → users(id) and a homeowner is not a
        // user; the workspace owner carries it, as for the lead itself.
        uploadedBy,
        newId: () => crypto.randomUUID(),
      });
      stored.push({
        fileId: put.fileId,
        filename: put.filename,
        size: put.size,
      });
    } catch (err) {
      // A photo we could not take is not a form the homeowner has to fight.
      // It becomes a `missing` answer: a wider range, and an honest one.
      console.error('tenant-site panel photo upload failed', {
        workspaceId: session.workspace_id,
        sessionId: session.id,
        code: err instanceof PhotoError ? err.code : 'UNKNOWN',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Presence only. The verdict that moves the price is the server's, read off
  // `pricing_photo_reviews` by `effectiveAnswers()` — never asserted here.
  input[key] =
    stored.length > 0
      ? { status: 'unreviewed', photos: stored }
      : { status: 'missing' };
  return input;
}

/**
 * Form fields that steer the form rather than answer it. Never coerced as
 * answers, never stored in an event's input.
 */
const NAVIGATION_FIELDS: ReadonlySet<string> = new Set(['nav', 'prevStateId']);

/** What a re-rendered screen should show back to the homeowner. */
function toPending(input: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      key.endsWith('__estimate') ||
      key === 'stateId' ||
      key === 'skip' ||
      NAVIGATION_FIELDS.has(key)
    )
      continue;
    out[key] = value;
  }
  return out;
}

/** Strip anything large or binary before the raw submission is stored. */
function redact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'stateId') continue;
    out[key] = value;
  }
  return out;
}

// ── Booking (GP-103) ──────────────────────────────────────────

/**
 * The finished outcome of a session, or null while it is still being
 * answered. Booking reads the walk, never the stored quote columns, so a
 * photo review that narrowed the band (or moved it to a refusal) is what
 * gets booked — the same path `renderCurrent` shows.
 */
async function completedResult(
  db: D1Like,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<EvaluationResult | null> {
  if (session.status !== 'completed') return null;
  const walked = step(
    flow.machine,
    flow.rateCard,
    await effectiveAnswers(db, session),
    sessionEnv(session),
  );
  return walked.status === 'complete' ? walked.result : null;
}

const backToQuote = (session: QuoteSessionRow): QuoteResponse => ({
  kind: 'redirect',
  location: `/quote/s/${session.id}`,
});

async function renderBooking(
  env: Env,
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<QuoteResponse> {
  const db = env.DB as unknown as D1Like;
  const result = await completedResult(db, session, flow);
  if (!result) return backToQuote(session);
  if (await findBookedJob(env.DB, session)) {
    return { kind: 'redirect', location: `/quote/s/${session.id}/booked` };
  }
  // Not priced, or not bookable: the price page says what happens instead.
  // Never an empty picker.
  const offer = await offerSlots(env.DB, workspace.id, result, new Date());
  if (!offer) return backToQuote(session);
  return pickerResponse(workspace, session, flow, result, offer, 200);
}

function pickerResponse(
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
  result: EvaluationResult,
  offer: SlotOffer,
  status: number,
  message?: string,
  reschedule?: { when: string },
): QuoteResponse {
  return {
    kind: 'html',
    status,
    html: renderIntakeBookingPage(workspace, {
      sessionId: session.id,
      flowName: flow.fsm.name,
      result,
      timezone: offer.timezone,
      durationMinutes: offer.durationMinutes,
      horizonDays: offer.horizonDays,
      slots: offer.slots,
      message,
      reschedule,
    }),
  };
}

async function submitBooking(
  request: Request,
  env: Env,
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<QuoteResponse> {
  const db = env.DB as unknown as D1Like;
  const result = await completedResult(db, session, flow);
  if (!result) return backToQuote(session);
  if (await findBookedJob(env.DB, session)) {
    return { kind: 'redirect', location: `/quote/s/${session.id}/booked` };
  }
  const now = new Date();
  const offer = await offerSlots(env.DB, workspace.id, result, now);
  if (!offer) return backToQuote(session);

  const form = await request.formData();
  const startUtc = String(form.get('startUtc') ?? '').trim();
  // The slot must be one we are offering RIGHT NOW — not one from a page
  // that sat open overnight, and not an arbitrary instant. A stale slot and
  // a taken one read the same to the homeowner, so they get the same words.
  if (!offer.slots.some((slot) => slot.startUtc === startUtc)) {
    return pickerResponse(
      workspace,
      session,
      flow,
      result,
      offer,
      422,
      SLOT_TAKEN_MESSAGE,
    );
  }

  const booked = await bookQuotedJob({
    db: env.DB,
    session,
    flow,
    result,
    startUtc,
    durationMinutes: offer.durationMinutes,
    newId: () => crypto.randomUUID(),
    now,
  });

  if (booked.kind === 'taken') {
    // Lost the race. Re-offer from the rows as they now are, so the slot
    // that went is already gone from the page.
    const fresh = await offerSlots(env.DB, workspace.id, result, now);
    return pickerResponse(
      workspace,
      session,
      flow,
      result,
      fresh ?? { ...offer, slots: [] },
      409,
      SLOT_TAKEN_MESSAGE,
    );
  }
  if (
    booked.kind === 'no_lead' ||
    booked.kind === 'unbillable' ||
    booked.kind === 'cannot_receive'
  ) {
    // no_lead: a priced session without a lead means the lead write failed
    // when the quote was frozen (logged then). There is nobody to book for,
    // and pretending otherwise would book nothing.
    // unbillable: the flow's service has no per-lead rate in the shared
    // rate card, so the booking could not bill its fee (WS-1). An operator
    // adds the service to the card; until then the homeowner calls, and
    // nothing is booked for free.
    // cannot_receive: the shop has no card on file, or an earlier lead fee
    // failed to collect — the API's lead-billing gate would refuse this
    // booking too, so the homeowner calls instead.
    console.error(
      booked.kind === 'no_lead'
        ? 'tenant-site booking has no lead to book for'
        : booked.kind === 'unbillable'
          ? 'tenant-site booking has no lead rate for its service'
          : 'tenant-site booking refused by the lead-billing gate',
      {
        workspaceId: workspace.id,
        sessionId: session.id,
        ...(booked.kind === 'unbillable' ? { service: booked.service } : {}),
        ...(booked.kind === 'cannot_receive' ? { code: booked.code } : {}),
      },
    );
    return pickerResponse(
      workspace,
      session,
      flow,
      result,
      offer,
      409,
      `We couldn't take this booking online${
        workspace.phone ? ` — please call ${workspace.phone}` : ''
      }.`,
    );
  }
  return { kind: 'redirect', location: `/quote/s/${session.id}/booked` };
}

async function renderBooked(
  env: Env,
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<QuoteResponse> {
  const result = await completedResult(
    env.DB as unknown as D1Like,
    session,
    flow,
  );
  if (!result) return backToQuote(session);
  const booked = await findBookedJob(env.DB, session);
  if (!booked) return backToQuote(session);
  return renderBookedFor(env, workspace, session, flow, result, booked);
}

/**
 * The zone a booking was picked in. Read directly rather than through the
 * booking policy: a contractor who has since closed their calendar still
 * has this job, and the homeowner still needs to read the time.
 */
async function workspaceTimezone(
  env: Env,
  workspaceId: string,
): Promise<string> {
  const row = await env.DB.prepare(
    'SELECT timezone FROM workspaces WHERE id = ?',
  )
    .bind(workspaceId)
    .first<{ timezone: string | null }>();
  return row?.timezone || 'UTC';
}

async function renderBookedFor(
  env: Env,
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
  result: EvaluationResult,
  booked: BookedJob,
): Promise<QuoteResponse> {
  return {
    kind: 'html',
    status: 200,
    html: renderIntakeBookedPage(workspace, {
      sessionId: session.id,
      flowName: flow.fsm.name,
      result,
      timezone: await workspaceTimezone(env, workspace.id),
      job: {
        jobNumber: booked.jobNumber,
        scheduledStart: booked.scheduledStart,
        scheduledEnd: booked.scheduledEnd,
      },
    }),
  };
}

// ── Change or cancel (GP-105) ─────────────────────────────────

const toBooked = (session: QuoteSessionRow): QuoteResponse => ({
  kind: 'redirect',
  location: `/quote/s/${session.id}/booked`,
});

/**
 * What a reschedule needs: the finished quote, the job it booked, and the
 * times that job could move to — its own half-hours counted as free, and
 * sized by the length actually on the calendar. Null in any state where
 * there is nothing to move, and the caller sends them to the right page.
 */
async function rescheduleContext(
  env: Env,
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
  now: Date,
): Promise<
  | {
      kind: 'ok';
      result: EvaluationResult;
      booked: BookedJob;
      offer: SlotOffer;
      when: string;
    }
  | { kind: 'not_priced' }
  | { kind: 'not_booked' }
  | { kind: 'not_bookable' }
> {
  const db = env.DB as unknown as D1Like;
  const result = await completedResult(db, session, flow);
  if (!result) return { kind: 'not_priced' };
  const booked = await findBookedJob(env.DB, session);
  if (!booked) return { kind: 'not_booked' };
  const offer = await offerSlots(env.DB, workspace.id, result, now, {
    excludeJobId: booked.id,
    durationMinutes: jobDurationMinutes(booked),
  });
  if (!offer) return { kind: 'not_bookable' };
  const when = bookingWhen(booked, await workspaceTimezone(env, workspace.id));
  return { kind: 'ok', result, booked, offer, when };
}

async function renderReschedule(
  env: Env,
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<QuoteResponse> {
  const ctx = await rescheduleContext(
    env,
    workspace,
    session,
    flow,
    new Date(),
  );
  if (ctx.kind === 'not_priced' || ctx.kind === 'not_booked') {
    return backToQuote(session);
  }
  // The contractor has since closed their calendar: the confirmation page
  // carries their number, and the booking stands.
  if (ctx.kind === 'not_bookable') return toBooked(session);
  return pickerResponse(
    workspace,
    session,
    flow,
    ctx.result,
    ctx.offer,
    200,
    undefined,
    { when: ctx.when },
  );
}

async function submitReschedule(
  request: Request,
  env: Env,
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<QuoteResponse> {
  const now = new Date();
  const ctx = await rescheduleContext(env, workspace, session, flow, now);
  if (ctx.kind === 'not_priced' || ctx.kind === 'not_booked') {
    return backToQuote(session);
  }
  if (ctx.kind === 'not_bookable') return toBooked(session);
  const { result, booked, offer, when } = ctx;

  const form = await request.formData();
  const startUtc = String(form.get('startUtc') ?? '').trim();
  // As for a first booking: the slot must be one on offer RIGHT NOW. Their
  // current booking is untouched either way.
  if (!offer.slots.some((slot) => slot.startUtc === startUtc)) {
    return pickerResponse(
      workspace,
      session,
      flow,
      result,
      offer,
      422,
      SLOT_TAKEN_MESSAGE,
      { when },
    );
  }

  const moved = await rescheduleQuotedJob({
    db: env.DB,
    session,
    job: booked,
    startUtc,
    durationMinutes: offer.durationMinutes,
    newId: () => crypto.randomUUID(),
    now,
  });
  if (moved.kind === 'taken') {
    // Lost the race; the batch rolled back and the old time is still theirs.
    const fresh = await offerSlots(env.DB, workspace.id, result, now, {
      excludeJobId: booked.id,
      durationMinutes: jobDurationMinutes(booked),
    });
    return pickerResponse(
      workspace,
      session,
      flow,
      result,
      fresh ?? { ...offer, slots: [] },
      409,
      SLOT_TAKEN_MESSAGE,
      { when },
    );
  }
  return toBooked(session);
}

async function renderCancel(
  env: Env,
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
  status = 200,
  message?: string,
  selected?: string,
): Promise<QuoteResponse> {
  const booked = await findBookedJob(env.DB, session);
  // Nothing booked, nothing to cancel: the price page says where things are.
  if (!booked) return backToQuote(session);
  return {
    kind: 'html',
    status,
    html: renderIntakeCancelPage(workspace, {
      sessionId: session.id,
      flowName: flow.fsm.name,
      when: bookingWhen(booked, await workspaceTimezone(env, workspace.id)),
      message,
      selected,
    }),
  };
}

async function submitCancel(
  request: Request,
  env: Env,
  workspace: WorkspaceData,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<QuoteResponse> {
  const booked = await findBookedJob(env.DB, session);
  if (!booked) return backToQuote(session);

  const form = await request.formData();
  const reason = String(form.get('reason') ?? '').trim();
  // The closed set on leads.withdrawn_reason, enforced here because a
  // migrated database has no CHECK on the column. Not adjudicated: any of
  // them cancels, and none of them costs anything.
  if (!isWithdrawnReason(reason)) {
    return renderCancel(
      env,
      workspace,
      session,
      flow,
      422,
      'Pick a reason first',
      reason,
    );
  }

  await cancelQuotedJob({
    db: env.DB,
    session,
    job: booked,
    reason,
    newId: () => crypto.randomUUID(),
    now: new Date(),
  });
  return backToQuote(session);
}

/**
 * Freeze the outcome and hand the contractor a lead. A quote the homeowner has
 * already been shown must not disappear because the lead write failed, so the
 * failure is logged and the price still renders.
 */
async function finish(
  db: D1Like,
  session: QuoteSessionRow,
  flow: LoadedFlow,
): Promise<void> {
  const walked = step(
    flow.machine,
    flow.rateCard,
    await effectiveAnswers(db, session),
    sessionEnv(session),
  );
  if (walked.status !== 'complete') return;

  const completed =
    session.status === 'completed'
      ? session
      : await completeSession(db, session, walked.result);

  try {
    const lead = await createLeadFromQuote({
      db,
      session: completed,
      machine: flow.machine,
      answers: walked.result.answers,
      result: walked.result,
      newId: () => crypto.randomUUID(),
    });
    if (lead) {
      // The intake consent grant (libs/shared/consent): contact details
      // given to this workspace at its quote form, for quote-and-schedule.
      const fields: ConsentField[] = ['name', 'job_details'];
      if (lead.phone) fields.push('phone');
      if (lead.email) fields.push('email');
      const zip = walked.result.answers['service_zip'];
      if (typeof zip === 'string' && zip.trim()) {
        fields.push('service_address');
      }
      await recordConsent({
        db: db as unknown as ConsentD1Like,
        newId: () => crypto.randomUUID(),
        workspaceId: completed.workspace_id,
        leadId: lead.leadId,
        consumerPhone: lead.phone,
        consumerEmail: lead.email,
        fields,
        source: 'intake_quote',
        consentText: CONSENT_TEXT_INTAKE_V1,
      });
    }
  } catch (err) {
    console.error('tenant-site quote lead creation failed', {
      workspaceId: completed.workspace_id,
      sessionId: completed.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
