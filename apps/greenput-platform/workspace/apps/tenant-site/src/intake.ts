import {
  renderAccordion,
  renderAlert,
  renderBadge,
  renderCheckbox,
  renderInput,
  renderProgress,
  renderRadioGroup,
  renderTable,
} from '@basenative/components';
import { renderBnButton } from '@basenative/platform';
import {
  escapeHtml,
  renderTenantShell,
  tenantOriginFor,
  type WorkspaceData,
} from './render';
import type { LeadWithdrawnReason } from '@greenput/shared/models';
import type {
  AnswerSpec,
  EvaluationResult,
  FieldError,
  GroupField,
  PricedLine,
  Screen,
} from '@greenput/shared/pricing';
import { formatQuotePrice, quoteStageOf } from '@greenput/shared/pricing';
import {
  groupSlotsByLocalDay,
  localDayLabel,
  slotLabel,
  type Slot,
} from '@greenput/shared/scheduling';

/**
 * The consumer-facing quote form.
 *
 * Server-rendered, one screen per request, POST-redirect-GET. No client
 * JavaScript at all: the tenant site's CSP is `connect-src 'self'` and
 * `form-action 'self'`, and a homeowner standing in their garage on a bad
 * connection should not need a bundle to download before they can answer "where
 * do you want the charger?".
 *
 * Markup comes from `@basenative/components` wherever the package has an
 * equivalent — radio groups, checkboxes, inputs, buttons, alerts, badges,
 * cards, tables, progress and the accordion. The one thing it cannot express is
 * a per-option hint, and every choice screen in `seeds/pricing` has one; see
 * `withOptionHints` below.
 */

// ── Badge variants ────────────────────────────────────────────
// MUST be one of @basenative/components' five declared badge variants —
// default | primary | success | warning | error. Anything outside that set
// matches no [data-variant] CSS rule and renders unstyled; that has shipped
// twice already (proposal status, asset condition). `intake.spec.ts` asserts
// every variant this file emits is in the set.
type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error';

const OUTCOME_BADGES: Record<string, { variant: BadgeVariant; label: string }> =
  {
    quote: { variant: 'success', label: 'We honour this price' },
    span: {
      variant: 'primary',
      label: 'Range — narrows once we see your panel',
    },
    no_quote: { variant: 'warning', label: 'We need to look first' },
    urgent: { variant: 'error', label: 'Safety first' },
    referral: { variant: 'warning', label: 'Not our job' },
  };

const FALLBACK_BADGE: { variant: BadgeVariant; label: string } = {
  variant: 'warning',
  label: 'We need to look first',
};

export interface IntakeFlowSummary {
  slug: string;
  name: string;
  description: string;
  vertical: string;
}

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** The form field a measurement screen posts its "I'm not sure" ladder under. */
const estimateField = (key: string) => `${key}__estimate`;
/** The form field a photo screen posts its status under. */
const photoStatusField = (key: string) => `${key}__status`;

/**
 * Add a per-option hint to a `renderRadioGroup`'s own output.
 *
 * The component has no hint slot, and every choice screen in `seeds/pricing`
 * carries one — "About 25-30 miles of range per hour", "A big three-prong-plus-
 * round plug, like an electric range". Dropping them would gut the form: the
 * hints are where the design does its explaining.
 *
 * Rather than hand-roll the markup, the hint is spliced into what the component
 * produced, so the component keeps ownership of the fieldset, the legend, the
 * ids, the checked state and the escaping. `intake.spec.ts` pins the shape this
 * depends on, so a change in the package fails a test here rather than silently
 * dropping every hint.
 */
export function withOptionHints(
  html: string,
  name: string,
  hints: Map<string, string>,
): string {
  if (hints.size === 0) return html;
  const segments = html.split('</label>');
  return segments
    .map((segment, index) => {
      if (index === segments.length - 1) return segment;
      const value = /<input data-bn="radio"[^>]*value="([^"]*)"/.exec(
        segment,
      )?.[1];
      const hint =
        value === undefined ? undefined : hints.get(unescapeAttr(value));
      if (!hint) return `${segment}</label>`;
      const hintId = `${name}-${value}-hint`;
      return (
        segment
          .replace(
            '<input data-bn="radio"',
            `<input aria-describedby="${escapeHtml(hintId)}" data-bn="radio"`,
          )
          .replace(
            /<\/span>$/,
            `<small data-bn="quote-hint" id="${escapeHtml(hintId)}">${escapeHtml(hint)}</small></span>`,
          ) + '</label>'
      );
    })
    .join('');
}

/** The component escapes option values into the attribute; read them back. */
function unescapeAttr(v: string): string {
  return v
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// ── One field ─────────────────────────────────────────────────

interface FieldContext {
  values: Record<string, unknown>;
  errors: Map<string, string>;
  /** False when no photo store is configured, which hides the file input. */
  photoUploadAvailable: boolean;
}

const stringValue = (ctx: FieldContext, key: string): string => {
  const v = ctx.values[key];
  if (v === undefined || v === null) return '';
  if (typeof v === 'object' && 'value' in v)
    return String((v as { value: unknown }).value);
  return String(v);
};

function renderChoice(
  key: string,
  spec: AnswerSpec | GroupField,
  label: string | undefined,
  ctx: FieldContext,
): string {
  const options = spec.options ?? [];
  const hints = new Map<string, string>();
  for (const o of options) {
    const hint = typeof o['hint'] === 'string' ? (o['hint'] as string) : '';
    if (hint) hints.set(o.value, hint);
  }
  const group = renderRadioGroup({
    name: key,
    label,
    items: options.map((o) => ({ value: o.value, label: o.label })),
    selected: stringValue(ctx, key) || String(spec.default ?? ''),
    attrs: `data-bn-field="${escapeHtml(key)}"`,
  });
  return withOptionHints(group, key, hints) + fieldError(key, ctx);
}

function renderMultiChoice(
  key: string,
  spec: AnswerSpec,
  ctx: FieldContext,
  legend?: string,
): string {
  const chosen = new Set(
    Array.isArray(ctx.values[key]) ? (ctx.values[key] as string[]) : [],
  );
  const boxes = (spec.options ?? [])
    .map((o) =>
      renderCheckbox({
        name: key,
        id: `${key}-${o.value}`,
        value: o.value,
        label: o.label,
        checked: chosen.has(o.value),
      }),
    )
    .join('');
  return (
    `<fieldset data-bn="quote-checkboxes" data-bn-field="${escapeHtml(key)}">` +
    (legend ? `<legend>${escapeHtml(legend)}</legend>` : '') +
    boxes +
    `</fieldset>` +
    fieldError(key, ctx)
  );
}

function renderMeasurement(
  key: string,
  spec: AnswerSpec | GroupField,
  label: string | undefined,
  ctx: FieldContext,
): string {
  const unit = typeof spec.unit === 'string' ? spec.unit : '';
  const current = ctx.values[key];
  const estimated =
    current !== null &&
    typeof current === 'object' &&
    (current as { estimated?: unknown }).estimated === true;

  const input = renderInput({
    name: key,
    id: key,
    type: 'number',
    label: label ?? `How many ${unit}?`,
    value: estimated ? '' : stringValue(ctx, key),
    error: ctx.errors.get(key) ?? '',
    attrs: [
      spec.min !== undefined ? `min="${escapeHtml(String(spec.min))}"` : '',
      spec.max !== undefined ? `max="${escapeHtml(String(spec.max))}"` : '',
      spec.step !== undefined ? `step="${escapeHtml(String(spec.step))}"` : '',
      'inputmode="numeric"',
    ]
      .filter(Boolean)
      .join(' '),
  });

  const ladder = spec.estimate_options ?? [];
  if (ladder.length === 0) return input;

  // Picking a rung stores `{value, estimated: true}`, and estimating costs six
  // points of spread — which the result page says out loud.
  const ladderGroup = renderRadioGroup({
    name: estimateField(key),
    label: "Not sure? Pick the closest — we'll widen the range a little",
    items: ladder.map((o) => ({ value: String(o.value), label: o.label })),
    selected: estimated ? stringValue(ctx, key) : '',
    attrs: `data-bn-field="${escapeHtml(estimateField(key))}"`,
  });

  return `${input}<div data-bn="quote-ladder">${ladderGroup}</div>`;
}

function renderPhoto(key: string, spec: AnswerSpec, ctx: FieldContext): string {
  const shots = (spec.shots ?? [])
    .map(
      (s) =>
        `<li><strong>${escapeHtml(s.label)}</strong>${
          s.guidance ? ` <span>${escapeHtml(s.guidance)}</span>` : ''
        }</li>`,
    )
    .join('');

  const safety = spec.safety_note
    ? renderAlert(escapeHtml(spec.safety_note), { variant: 'warning' })
    : '';

  if (!ctx.photoUploadAvailable) {
    // No photo store is configured, so do not offer something that cannot
    // work. The traversal never waits for the photo — the price is produced
    // either way, with a wider range that says why.
    return (
      safety +
      `<input type="hidden" name="${escapeHtml(photoStatusField(key))}" value="missing">` +
      renderAlert(
        'We can take your panel photo by text or email once we have your number — this site is not set up to receive it here yet.',
        { variant: 'warning' },
      )
    );
  }

  return (
    safety +
    (shots ? `<ul data-bn="quote-shots">${shots}</ul>` : '') +
    `<input type="hidden" name="${escapeHtml(photoStatusField(key))}" value="unreviewed">` +
    `<label data-bn="quote-file"><span>Add your photos</span>` +
    `<input data-bn="input" type="file" name="${escapeHtml(key)}" accept="image/*" capture="environment" multiple></label>` +
    fieldError(key, ctx)
  );
}

function renderTextish(field: GroupField, ctx: FieldContext): string {
  const type =
    field.type === 'email'
      ? 'email'
      : field.type === 'phone'
        ? 'tel'
        : field.type === 'zip'
          ? 'text'
          : 'text';
  const autocomplete: Record<string, string> = {
    first_name: 'given-name',
    last_name: 'family-name',
    email: 'email',
    phone: 'tel',
    service_zip: 'postal-code',
  };
  return renderInput({
    name: field.key,
    id: field.key,
    type,
    label: field.label ?? field.key,
    value: stringValue(ctx, field.key),
    required: field.required !== false,
    error: ctx.errors.get(field.key) ?? '',
    attrs: [
      autocomplete[field.key]
        ? `autocomplete="${escapeHtml(autocomplete[field.key])}"`
        : '',
      field.type === 'zip' ? 'inputmode="numeric" maxlength="10"' : '',
    ]
      .filter(Boolean)
      .join(' '),
  });
}

function fieldError(key: string, ctx: FieldContext): string {
  const message = ctx.errors.get(key);
  if (!message) return '';
  return `<p data-bn="field-error" id="${escapeHtml(key)}-error">${escapeHtml(message)}</p>`;
}

/** Every control a screen needs, in the order the machine declares them. */
export function renderScreenFields(screen: Screen, ctx: FieldContext): string {
  const spec = screen.answer;
  if (spec.type === 'group') {
    return (spec.fields ?? [])
      .map((field) => {
        if (field.type === 'choice')
          return renderChoice(field.key, field, field.label, ctx);
        if (field.type === 'measurement')
          return renderMeasurement(field.key, field, field.label, ctx);
        return renderTextish(field, ctx);
      })
      .join('');
  }
  const key = spec.key as string;
  if (spec.type === 'choice') return renderChoice(key, spec, undefined, ctx);
  if (spec.type === 'multi_choice')
    return renderMultiChoice(key, spec, ctx, spec.label);
  if (spec.type === 'measurement')
    return renderMeasurement(key, spec, undefined, ctx);
  if (spec.type === 'photo') return renderPhoto(key, spec, ctx);
  return '';
}

/**
 * Submit and link controls on the shared surface. `attrs` carries the
 * named-submit contract (nav, skip, formnovalidate) the route branches on.
 */
function bnButton(
  label: string,
  options: {
    href?: string;
    type?: 'submit' | 'button';
    variant?: 'prominent' | 'bordered' | 'borderless';
    destructive?: boolean;
    attrs?: string;
  } = {},
): string {
  const html = renderBnButton(label, {
    href: options.href,
    type: options.type ?? 'button',
    variant: options.variant ?? 'prominent',
    size: 'large',
    destructive: options.destructive,
  });
  if (!options.attrs) return html;
  return html.replace(/<(button|a) /, `<$1 ${options.attrs} `);
}

function glassPanel(headerHtml: string, body: string, footer = ''): string {
  const actions = footer ? `<div data-bn="bn-cluster">${footer}</div>` : '';
  return `<article data-bn="bn-panel"><header>${headerHtml}</header>${body}${actions}</article>`;
}

function pageColumn(inner: string, narrow = false, attrs = ''): string {
  const width = narrow ? ' data-bn-narrow' : '';
  return `<section data-bn="bn-section"${attrs}><article data-bn-column${width}>${inner}</article></section>`;
}

// ── Pages ─────────────────────────────────────────────────────

/** `/quote` — which of the contractor's jobs do you want a price for? */
export function renderIntakeIndexPage(
  workspace: WorkspaceData,
  flows: IntakeFlowSummary[],
  options: { showAllLink?: boolean } = {},
): string {
  const body =
    flows.length === 0
      ? glassPanel(
          '<h2>No instant prices yet</h2>',
          `<p>We're not set up for instant prices just yet. <a href="/contact">Send us a message</a> and we'll get straight back to you.</p>`,
        )
      : `<ul data-bn="bn-card-grid">${flows
          .map(
            (flow) =>
              `<li data-bn="bn-info-card"><header><h2>${escapeHtml(flow.name)}</h2></header>` +
              (flow.description
                ? `<p>${escapeHtml(flow.description)}</p>`
                : '') +
              `<form method="post" action="/quote/start">` +
              `<input type="hidden" name="flow" value="${escapeHtml(flow.slug)}">` +
              bnButton('Get a price', { type: 'submit' }) +
              `</form></li>`,
          )
          .join('')}</ul>` +
        (options.showAllLink
          ? `<p><a href="/quote">See every instant price</a></p>`
          : '');

  const content = pageColumn(`
    <p data-bn="bn-kicker">Instant price</p>
    <h1 id="quote-heading" data-bn="bn-large-title">Get a real price</h1>
    <p data-bn="bn-lead">A few questions, a couple of minutes, and a price at the end — not a call-back.</p>
    ${body}
  `);

  return renderTenantShell(workspace, {
    content,
    title: `Get a price — ${escapeHtml(workspace.name)}`,
    description: `Answer a few questions and get a real price from ${workspace.name}.`,
    canonicalUrl: `${tenantOriginFor(workspace)}/quote`,
  });
}

export interface IntakeScreenOptions {
  sessionId: string;
  flowName: string;
  screen: Screen;
  /** Answers already given, so a re-rendered screen keeps what was typed. */
  values?: Record<string, unknown>;
  fieldErrors?: FieldError[];
  photoUploadAvailable?: boolean;
  /**
   * The screen a Back control returns to — the one the session's most recent
   * surviving answer left, read off the event log by the route (GP-014).
   * Absent on the first screen, where no Back is offered.
   */
  prevStateId?: string | null;
}

/** `/quote/s/:id` — one screen of the form. */
export function renderIntakeScreenPage(
  workspace: WorkspaceData,
  options: IntakeScreenOptions,
): string {
  const { screen } = options;
  const ctx: FieldContext = {
    values: options.values ?? {},
    errors: new Map((options.fieldErrors ?? []).map((e) => [e.key, e.message])),
    photoUploadAvailable: options.photoUploadAvailable ?? false,
  };

  const asked = screen.index;
  const total = Math.max(screen.typicalTotal, asked);
  const isPhoto = screen.answer.type === 'photo';

  const progress =
    total > 0
      ? `<div data-bn="quote-progress">${renderProgress({
          value: asked,
          max: total,
          label: `Question ${asked} of about ${total}`,
        })}<p>Question ${asked} of about ${total}</p></div>`
      : '';

  const summary =
    ctx.errors.size > 0
      ? renderAlert(
          `<strong>Have another look at this one.</strong> ${escapeHtml(
            [...ctx.errors.values()][0],
          )}`,
          { variant: 'error' },
        )
      : '';

  const why = screen.ask?.why
    ? renderAccordion({
        id: `why-${escapeHtml(screen.stateId)}`,
        items: [
          {
            title: 'Why we ask',
            content: `<p>${escapeHtml(String(screen.ask.why))}</p>`,
          },
        ],
      })
    : '';

  const skip =
    isPhoto && screen.answer.skippable
      ? bnButton(screen.answer.skip_label ?? "I'll send this later", {
          type: 'submit',
          variant: 'borderless',
          attrs: 'name="skip" value="1"',
        })
      : '';

  // Back and Start over are named submits on the SAME form, not links: the
  // form already posts to this origin under `form-action 'self'`, so a named
  // button keeps the whole thing POST-redirect-GET with no script and no new
  // route. `formnovalidate` on both, or Back would trip the required-field
  // check on the screen the homeowner is trying to leave. Back only when
  // there is somewhere to go back to; Start over always, and last.
  const prevStateId = options.prevStateId ?? '';
  const back = prevStateId
    ? bnButton('Back', {
        type: 'submit',
        variant: 'bordered',
        attrs: 'name="nav" value="back" formnovalidate',
      })
    : '';
  const startOver = renderStartOver();

  const content = pageColumn(
    `
    <p data-bn="bn-kicker">${escapeHtml(options.flowName)}</p>
    ${progress}
    <h1 id="quote-question" data-bn="bn-large-title">${escapeHtml(screen.ask?.question ?? '')}</h1>
    ${screen.ask?.help ? `<p data-bn="bn-lead">${escapeHtml(String(screen.ask.help))}</p>` : ''}
    ${summary}
    <form method="post" action="/quote/s/${escapeHtml(options.sessionId)}"${
      isPhoto ? ' enctype="multipart/form-data"' : ''
    } data-bn="quote-form">
      <input type="hidden" name="stateId" value="${escapeHtml(screen.stateId)}">
      ${prevStateId ? `<input type="hidden" name="prevStateId" value="${escapeHtml(prevStateId)}">` : ''}
      ${renderScreenFields(screen, ctx)}
      <div data-bn="bn-cluster">
        ${bnButton('Continue', { type: 'submit' })}
        ${back}
        ${skip}
        ${startOver}
      </div>
    </form>
    ${why}
    <p data-bn="bn-note">Keep this page's address — you can come back to it later and pick up where you left off.</p>
  `,
    true,
  );

  return renderTenantShell(workspace, {
    content,
    title: `${screen.ask?.question ?? options.flowName} — ${workspace.name}`,
    description: `Step ${asked} of your ${options.flowName} price from ${workspace.name}.`,
    // A half-finished form is not a page anyone should land on from search.
    noindex: true,
  });
}

/**
 * The "Start over" control: the least prominent thing in whichever row it sits
 * in. A named submit, so the route can tell it from an answer before it reads
 * one (`submitScreen` branches on `nav` first). `formnovalidate` because the
 * screen being abandoned may have required fields.
 */
function renderStartOver(): string {
  return bnButton('Start over', {
    type: 'submit',
    variant: 'borderless',
    attrs: 'name="nav" value="restart" formnovalidate data-bn-restart',
  });
}

export interface IntakeQuoteOptions {
  flowName: string;
  result: EvaluationResult;
  /**
   * The session this price belongs to. When set, the "What happens next"
   * card offers "Start over" — the same reset the screens offer, posting
   * `nav=restart` to `/quote/s/:id` — so a homeowner can price a second job
   * on the link they were told to keep (GP-014).
   */
  sessionId?: string;
  /**
   * Set when this session can book itself (GP-103): the outcome is priced
   * AND the workspace has said when it works. Absent, the page keeps the
   * "someone will be in touch" card — most tenants are in that state on the
   * day booking ships, and an empty picker is worse than an honest card.
   */
  booking?: { sessionId: string; durationMinutes: number };
  /**
   * Set when this session's most recent booking was cancelled (GP-105): the
   * page says so, says nothing is owed, and offers the price to book again.
   */
  cancelled?: { when: string };
}

/** `/quote/s/:id` once the form is done — the price, and what is in it. */
/**
 * Authored body copy as paragraphs.
 *
 * The bodies in seeds/pricing are plain text with blank lines between
 * paragraphs, and several are numbered lists a homeowner is meant to work
 * through standing at their panel ("1. Find every outlet with TEST and RESET
 * buttons…"). Collapsing that to one run-on paragraph loses the steps, so
 * split on blank lines. Escaped, then wrapped — never interpolated as markup.
 */
export function renderProse(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map(
      (para) =>
        `<p data-bn="quote-prose">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

export function renderIntakeQuotePage(
  workspace: WorkspaceData,
  options: IntakeQuoteOptions,
): string {
  const { result } = options;
  const badge = OUTCOME_BADGES[result.kind] ?? FALLBACK_BADGE;
  const priced = result.low !== null && result.high !== null;

  // The terminal's own copy. Every one of these used to be thrown away for
  // any outcome that was not a priced quote, which is how a homeowner who
  // answered "I can smell burning" was shown "No price yet — someone will be
  // in touch" instead of the machine's actual words: get out, call 911,
  // switch the breaker off, do not wait for a price.
  const summary = result.summary
    ? `<p data-bn="quote-summary">${escapeHtml(result.summary)}</p>`
    : '';
  const body = result.body ? renderProse(result.body) : '';
  const urgent = result.kind === 'urgent';
  const hasCopy = Boolean(result.summary || result.body);

  // "No price yet" is worth saying when a price was the point and we could
  // not give one. Next to "Stop and read this" it is noise, so an outcome
  // that brought its own words does not get the empty price pill.
  // H1: once the contractor has confirmed the work order and nothing is left
  // to guess, the quote is one exact number — shown alone, never as a range.
  const stage = quoteStageOf(result);
  const headline = !priced
    ? null
    : stage === 'exact' && typeof result.exact === 'number'
      ? `<p data-bn="quote-range" data-bn-stage="exact">${escapeHtml(
          formatQuotePrice(result) as string,
        )}</p>`
      : `<p data-bn="quote-range" data-bn-stage="range">${escapeHtml(money(result.low as number))} <span>to</span> ${escapeHtml(
          money(result.high as number),
        )}</p>`;
  const headlineHtml = headline
    ? headline
    : hasCopy
      ? ''
      : `<p data-bn="quote-range" data-bn-unpriced>No price yet</p>`;

  const reason = result.refused_because
    ? renderAlert(escapeHtml(result.refused_because), { variant: 'warning' })
    : '';

  const indicative = result.indicative
    ? renderAlert(
        `<strong>Not a quote.</strong> Jobs like this usually land between ${escapeHtml(
          money(result.indicative.low),
        )} and ${escapeHtml(money(result.indicative.high))}. We'll confirm after a look.`,
        { variant: 'warning' },
      )
    : '';

  const spread = result.spread_reasons?.length
    ? `<details data-bn="quote-spread"><summary>Why the range is this wide</summary><ul>${result.spread_reasons
        .map((r) => `<li>${escapeHtml(String(r.because ?? ''))}</li>`)
        .join('')}</ul></details>`
    : '';

  const lines = (result.lines ?? []).length
    ? renderTable<PricedLine & Record<string, unknown>>({
        caption: "What's in the price",
        columns: [
          {
            key: 'label',
            label: 'Item',
            render: (value, row) =>
              `${escapeHtml(String(value))}${
                row.side === 'high_only'
                  ? ' <small data-bn="quote-hint">only if it takes longer</small>'
                  : ''
              }`,
          },
          {
            key: 'cost',
            label: 'Amount',
            render: (value) => escapeHtml(money(Number(value))),
          },
        ],
        rows: (result.lines ?? []) as Array<
          PricedLine & Record<string, unknown>
        >,
      })
    : '';

  // Each end of the span, named the way its own terminal names it. The id
  // never reaches the page: `T_subpanel_required` is a thing to say to an
  // engineer, not to someone deciding whether they can afford their garage.
  const spans = (result.spans ?? []).length
    ? `<ul data-bn="quote-spans">${(result.spans ?? [])
        .map(
          (s) =>
            `<li><span>${escapeHtml(s.title)}</span><strong>${escapeHtml(
              money(s.low),
            )} – ${escapeHtml(money(s.high))}</strong></li>`,
        )
        .join('')}</ul>`
    : '';

  const conditions = (result.conditions ?? [])
    .map((c) => renderAlert(escapeHtml(c), { variant: 'warning' }))
    .join('');

  const addons = (result.addons ?? []).length
    ? `<div data-bn="quote-addons"><h3>While we're there</h3><ul>${(
        result.addons ?? []
      )
        .map(
          (a) =>
            `<li>${escapeHtml(a.label)} — <strong>${escapeHtml(money(a.cost))}</strong>${
              a.placeholder
                ? ' <small data-bn="quote-hint">indicative</small>'
                : ''
            }</li>`,
        )
        .join('')}</ul></div>`
    : '';

  // What the terminal says to do next. The CTAs are the authored wording for
  // an action the site cannot yet perform end to end (there is no booking
  // endpoint), so they are rendered as the offer they are, next to the
  // contractor's real phone number — not as buttons that go nowhere.
  const nextStep = result.next_step;
  const nextStepBlock = nextStep
    ? `<div data-bn="quote-next-step">${[
        nextStep.cta
          ? `<p data-bn="quote-next-cta"><strong>${escapeHtml(nextStep.cta)}</strong></p>`
          : '',
        nextStep.cost_promise
          ? `<p data-bn="quote-cost-promise">${escapeHtml(nextStep.cost_promise)}</p>`
          : '',
        nextStep.alt_cta
          ? `<p data-bn="quote-alt-cta">Or: ${escapeHtml(nextStep.alt_cta)}</p>`
          : '',
      ]
        .filter(Boolean)
        .join('')}</div>`
    : '';

  const contact = [
    workspace.phone
      ? bnButton(`Call ${workspace.phone}`, {
          href: `tel:${workspace.phone}`,
        })
      : '',
    workspace.email
      ? bnButton('Email us', {
          href: `mailto:${workspace.email}`,
          variant: 'bordered',
        })
      : '',
  ]
    .filter(Boolean)
    .join('');

  // Start over sits after the contact buttons, in its own form: this page
  // has no form of its own, and the control must POST (it changes the
  // session) to the same URL the screens post to.
  const startOver = options.sessionId
    ? `<form method="post" action="/quote/s/${escapeHtml(options.sessionId)}" data-bn="quote-restart">${renderStartOver()}</form>`
    : '';
  const nextFooter = contact + startOver;

  // On an urgent outcome the number goes above the fold, before the body
  // text that tells the reader to switch a breaker off and stop using the
  // circuit. The terminal asks for this explicitly with
  // next_step.surface_phone_immediately.
  const urgentContact =
    (urgent || nextStep?.surface_phone_immediately) && contact
      ? `<div data-bn="quote-urgent-contact">${contact}</div>`
      : '';

  // The booking offer. Only a priced outcome on a bookable workspace gets
  // it; the caller decides that, this page only renders what it is handed.
  const booking = priced && options.booking ? options.booking : undefined;
  const bookingCard = booking
    ? glassPanel(
        '<h2>Book a time</h2>',
        `<p>This price is yours to book. The work takes about ${escapeHtml(
          durationWords(booking.durationMinutes),
        )} — pick a time that suits you and ${escapeHtml(workspace.name)} will be there.</p>`,
        bnButton('Book a time', {
          href: `/quote/s/${booking.sessionId}/book`,
          attrs: 'data-bn-book',
        }) +
          (workspace.phone
            ? bnButton(`Or call ${workspace.phone}`, {
                href: `tel:${workspace.phone}`,
                variant: 'bordered',
              })
            : ''),
      )
    : '';

  // The cancelled state (GP-105). The price is still theirs; the slot is
  // not. Nothing was charged to anyone, and the page says so in those words.
  const cancelledNotice = options.cancelled
    ? renderAlert(
        `<strong>Your booking for ${escapeHtml(
          options.cancelled.when,
        )} is cancelled.</strong> Nothing is owed. This price is still yours — ${
          booking ? 'book another time below' : 'get in touch'
        } whenever suits.`,
        { variant: 'info' },
      ).replace(
        '<div data-bn="alert"',
        '<div data-bn="alert" data-bn-cancelled',
      )
    : '';

  const nextCard = glassPanel(
    '<h2>What happens next</h2>',
    nextStepBlock ||
      (booking
        ? `<p>We've sent this to ${escapeHtml(workspace.name)} along with your answers. Book a time above, or get in touch. If anything on site turns out differently from what you told us, we'll talk to you before we change a thing.</p>`
        : priced
          ? `<p>We've sent this to ${escapeHtml(workspace.name)} along with your answers. Someone will be in touch to book a time. If anything on site turns out differently from what you told us, we'll talk to you before we change a thing.</p>`
          : `<p>We've sent your answers to ${escapeHtml(workspace.name)}. Someone will be in touch to arrange a look, and you'll get a price after that.</p>`),
    nextFooter,
  );

  const content = pageColumn(
    `
    <p data-bn="bn-kicker">${escapeHtml(options.flowName)}</p>
    <h1 id="quote-result-heading" data-bn="bn-large-title">${escapeHtml(result.title ?? 'Your price')}</h1>
    <p data-bn="quote-badge">${renderBadge(escapeHtml(badge.label), { variant: badge.variant })}</p>
    ${cancelledNotice}
    ${summary}
    ${urgentContact}
    ${body}
    ${headlineHtml}
    ${reason}
    ${indicative}
    ${spread}
    ${spans}
    ${conditions}
    ${lines}
    ${addons}
    ${bookingCard}
    ${nextCard}
  `,
    true,
    ` data-bn="quote-result"${urgent ? ' data-bn-urgent' : ''}`,
  );

  return renderTenantShell(workspace, {
    content,
    // An urgent or refused outcome is not "your price", and the tab title is
    // the first thing read back on a phone.
    title: `${result.title ?? 'Your price'} — ${workspace.name}`,
    description: `Your ${options.flowName} price from ${workspace.name}.`,
    noindex: true,
  });
}

// ── Booking (GP-103) ──────────────────────────────────────────

/** "2 hours", "an hour and a half", "30 minutes" — for the offer copy. */
export function durationWords(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return hours === 1 ? 'an hour' : `${hours} hours`;
  if (rest === 30)
    return hours === 1 ? 'an hour and a half' : `${hours}½ hours`;
  return `${hours} hours ${rest} minutes`;
}

function priceBand(result: EvaluationResult): string {
  return result.low !== null && result.high !== null
    ? `${money(result.low)} to ${money(result.high)}`
    : '';
}

export interface IntakeBookingOptions {
  sessionId: string;
  flowName: string;
  result: EvaluationResult;
  /** The workspace's IANA zone — every label on the page is in it. */
  timezone: string;
  durationMinutes: number;
  horizonDays: number;
  slots: readonly Slot[];
  /** "That time just went — pick another", after a lost race. */
  message?: string;
  /**
   * Moving an existing booking (GP-105): the form posts to `/reschedule`,
   * the page names the time they have now, and nothing changes until they
   * pick a new one.
   */
  reschedule?: { when: string };
}

/**
 * `/quote/s/:id/book` — every time the job could start, grouped by local
 * day, as one form with no JavaScript in it. With `reschedule`, the same
 * page as `/quote/s/:id/reschedule`. Each slot is a radio input;
 * one submit books the checked one. Radios rather than a button per slot
 * because a page of thirty submit buttons is thirty ways to book the wrong
 * one with a thumb, and a radio group is the pattern the form already uses.
 */
export function renderIntakeBookingPage(
  workspace: WorkspaceData,
  options: IntakeBookingOptions,
): string {
  const { result, timezone } = options;
  const days = groupSlotsByLocalDay(options.slots, timezone);

  const notice = options.message
    ? renderAlert(`<strong>${escapeHtml(options.message)}</strong>`, {
        variant: 'warning',
      })
    : '';

  const contact = workspace.phone
    ? bnButton(`Call ${workspace.phone}`, {
        href: `tel:${workspace.phone}`,
        variant: 'bordered',
      })
    : '';

  const moving = options.reschedule;
  const action = moving ? 'reschedule' : 'book';
  const keep = moving
    ? bnButton('Keep my current time', {
        href: `/quote/s/${options.sessionId}/booked`,
        variant: 'bordered',
      })
    : bnButton('Back to your price', {
        href: `/quote/s/${options.sessionId}`,
        variant: 'bordered',
      });

  const picker =
    days.length === 0
      ? glassPanel(
          '<h2>Nothing free just now</h2>',
          `<p>${escapeHtml(workspace.name)} is booked up for the next ${escapeHtml(
            String(options.horizonDays),
          )} days. Give them a call and they'll find you a time.${
            moving ? ' Your current booking stands until then.' : ''
          }</p>`,
          contact + (moving ? keep : ''),
        )
      : `<form method="post" action="/quote/s/${escapeHtml(options.sessionId)}/${action}" data-bn="booking-form">
      ${days
        .map(
          (day) =>
            `<fieldset data-bn="booking-day" id="day-${escapeHtml(day.date)}">
        <legend>${escapeHtml(day.label)}</legend>
        <div data-bn="booking-slots">${day.slots
          .map((slot) => {
            const id = `slot-${escapeHtml(slot.startUtc.replace(/[^0-9A-Za-z]/g, ''))}`;
            return `<label data-bn="booking-slot" for="${id}"><input data-bn="radio" type="radio" id="${id}" name="startUtc" value="${escapeHtml(
              slot.startUtc,
            )}" required><span>${escapeHtml(slot.label)}</span></label>`;
          })
          .join('')}</div>
      </fieldset>`,
        )
        .join('')}
      <div data-bn="quote-actions">
        ${bnButton(moving ? 'Move to this time' : 'Book this time', { type: 'submit' })}
        ${keep}
      </div>
    </form>`;

  const help = moving
    ? `You're booked for <strong data-bn="booking-current">${escapeHtml(
        moving.when,
      )}</strong>. Moving it costs nothing, and nothing changes until you pick a new time. The work takes about ${escapeHtml(
        durationWords(options.durationMinutes),
      )}. Times are shown in ${escapeHtml(workspace.name)}'s local time.`
    : `Your price is <strong>${escapeHtml(priceBand(result))}</strong>. The work takes about ${escapeHtml(
        durationWords(options.durationMinutes),
      )}. Times are shown in ${escapeHtml(workspace.name)}'s local time.`;

  const content = pageColumn(
    `
    <p data-bn="bn-kicker">${escapeHtml(options.flowName)}</p>
    <h1 id="booking-heading" data-bn="bn-large-title">${moving ? 'Pick a new time' : 'Pick a time'}</h1>
    <p data-bn="bn-lead">${help}</p>
    ${notice}
    ${picker}
  `,
    true,
  ).replace(
    '<section data-bn="bn-section">',
    `<section data-bn="bn-section" data-bn-booking${moving ? ' data-bn-reschedule' : ''}>`,
  );

  return renderTenantShell(workspace, {
    content,
    title: `${moving ? 'Pick a new time' : 'Pick a time'} — ${workspace.name}`,
    description: `Book your ${options.flowName} with ${workspace.name}.`,
    noindex: true,
  });
}

export interface IntakeBookedOptions {
  sessionId: string;
  flowName: string;
  result: EvaluationResult;
  timezone: string;
  job: {
    jobNumber: string;
    scheduledStart: string;
    scheduledEnd: string;
  };
}

/** "Tuesday, June 2, 9:00 AM – 11:00 AM" — a booking's time, in the zone it was picked in. */
export function bookingWhen(
  job: { scheduledStart: string; scheduledEnd: string },
  timezone: string,
): string {
  return `${localDayLabel(job.scheduledStart, timezone)}, ${slotLabel(
    { startUtc: job.scheduledStart, endUtc: job.scheduledEnd },
    timezone,
  )}`;
}

/**
 * `/quote/s/:id/booked` — the slot in local time, the price band, the
 * contractor's number, and the two things a homeowner can do next with
 * the same capability URL (GP-105): move the time, or cancel. Both cost
 * nothing, and the page says so in those words.
 */
export function renderIntakeBookedPage(
  workspace: WorkspaceData,
  options: IntakeBookedOptions,
): string {
  const { job, timezone } = options;
  const when = bookingWhen(job, timezone);

  const contact = [
    workspace.phone
      ? bnButton(`Call ${workspace.phone}`, {
          href: `tel:${workspace.phone}`,
        })
      : '',
    workspace.email
      ? bnButton('Email us', {
          href: `mailto:${workspace.email}`,
          variant: 'bordered',
        })
      : '',
  ]
    .filter(Boolean)
    .join('');

  const content = pageColumn(
    `
    <p data-bn="bn-kicker">${escapeHtml(options.flowName)}</p>
    <h1 id="booked-heading" data-bn="bn-large-title">You're booked</h1>
    <p data-bn="quote-badge">${renderBadge('Confirmed', { variant: 'success' })}</p>
    <dl data-bn="bn-definitions">
      <div><dt>When</dt><dd data-bn="booking-when">${escapeHtml(when)}${
        timezone === 'UTC' ? ' <small data-bn="quote-hint">(UTC)</small>' : ''
      }</dd></div>
      <div><dt>Price</dt><dd data-bn="booking-price">${escapeHtml(priceBand(options.result))}</dd></div>
      <div><dt>Who</dt><dd>${escapeHtml(workspace.name)}${
        workspace.phone
          ? ` — <a href="tel:${escapeHtml(workspace.phone)}">${escapeHtml(workspace.phone)}</a>`
          : ''
      }</dd></div>
      <div><dt>Job</dt><dd>${escapeHtml(job.jobNumber)}</dd></div>
    </dl>
    ${glassPanel(
      '<h2>Need to change or cancel?</h2>',
      `<p>Plans change. Moving this booking to another time, or cancelling it, costs nothing — and you don't need an account. Keep this page's address: it is yours, and it is where you do both. If anything on site turns out differently from what you told us, we'll talk to you before we change a thing.</p>`,
      bnButton('Pick a different time', {
        href: `/quote/s/${options.sessionId}/reschedule`,
        variant: 'bordered',
        attrs: 'data-bn-reschedule',
      }) +
        bnButton('Cancel this booking', {
          href: `/quote/s/${options.sessionId}/cancel`,
          variant: 'borderless',
          attrs: 'data-bn-cancel',
        }) +
        contact,
    )}
  `,
    true,
  );

  return renderTenantShell(workspace, {
    content,
    title: `You're booked — ${workspace.name}`,
    description: `Your ${options.flowName} is booked with ${workspace.name}.`,
    noindex: true,
  });
}

// ── Cancel (GP-105) ───────────────────────────────────────────

/**
 * The words a homeowner picks from. Typed against the closed set on
 * `leads.withdrawn_reason`, so adding a reason to LEAD_WITHDRAWN_REASONS
 * without a label here — or a label without a reason — fails to compile.
 * The order is the order on the page.
 */
export const WITHDRAWN_REASON_LABELS: Readonly<
  Record<LeadWithdrawnReason, string>
> = {
  schedule_no_longer_works: 'The time no longer works for me',
  chose_another_provider: "I've gone with someone else",
  no_longer_needed: "I don't need the work done any more",
  other: 'Something else',
};

export function isWithdrawnReason(value: string): value is LeadWithdrawnReason {
  return Object.prototype.hasOwnProperty.call(WITHDRAWN_REASON_LABELS, value);
}

export interface IntakeCancelOptions {
  sessionId: string;
  flowName: string;
  /** The booking being cancelled, in the contractor's zone. */
  when: string;
  /** "Pick a reason first", when the form came back without one. */
  message?: string;
  selected?: string;
}

/**
 * `/quote/s/:id/cancel` — one question and one button. The reason is
 * recorded for the owner, never used against the homeowner: the fee the
 * contractor would have paid is waived whichever one is picked, and the page
 * says cancelling costs nothing before it asks anything. A separate page
 * rather than a button on the confirmation, so a thumb cannot cancel a job
 * by landing on the wrong control.
 */
export function renderIntakeCancelPage(
  workspace: WorkspaceData,
  options: IntakeCancelOptions,
): string {
  const notice = options.message
    ? renderAlert(`<strong>${escapeHtml(options.message)}</strong>`, {
        variant: 'warning',
      })
    : '';
  const reasons = renderRadioGroup({
    name: 'reason',
    label: 'Why are you cancelling?',
    items: (Object.keys(WITHDRAWN_REASON_LABELS) as LeadWithdrawnReason[]).map(
      (value) => ({ value, label: WITHDRAWN_REASON_LABELS[value] }),
    ),
    selected: options.selected ?? '',
    attrs: 'data-bn-field="reason"',
  });

  const content = pageColumn(
    `
    <p data-bn="bn-kicker">${escapeHtml(options.flowName)}</p>
    <h1 id="cancel-heading" data-bn="bn-large-title">Cancel this booking?</h1>
    <p data-bn="bn-lead">You're booked for <strong data-bn="booking-current">${escapeHtml(
      options.when,
    )}</strong>. Cancelling costs nothing — you won't be charged, and neither will ${escapeHtml(
      workspace.name,
    )}. Your price stays yours if you change your mind later.</p>
    ${notice}
    <form method="post" action="/quote/s/${escapeHtml(options.sessionId)}/cancel" data-bn="cancel-form">
      ${reasons}
      <p data-bn="bn-note">This only tells ${escapeHtml(
        workspace.name,
      )} why. It doesn't change anything about the cancellation.</p>
      <div data-bn="bn-cluster">
        ${bnButton('Cancel this booking', { type: 'submit', destructive: true })}
        ${bnButton('Keep my booking', {
          href: `/quote/s/${options.sessionId}/booked`,
          variant: 'bordered',
        })}
      </div>
    </form>
  `,
    true,
  ).replace(
    '<section data-bn="bn-section">',
    '<section data-bn="bn-section" data-bn-cancel>',
  );

  return renderTenantShell(workspace, {
    content,
    title: `Cancel this booking? — ${workspace.name}`,
    description: `Cancel your ${options.flowName} booking with ${workspace.name}.`,
    noindex: true,
  });
}

// ── Styles ────────────────────────────────────────────────────
// Appended to the tenant stylesheet served at /css/styles.css. No CSS classes:
// every hook is a data-bn attribute, and every value comes from the --gp-*
// tokens libs/shared/design serves — which is the vocabulary render.ts's
// tenantStyles actually defines.
//
// Two things were wrong with this block and neither fix worked alone.
//
// 1. It was wrapped in `@layer components { ... }` while tenantStyles is
//    unlayered. Unlayered CSS beats layered CSS regardless of specificity, so
//    every rule here lost any property collision with the tenant sheet —
//    including `[data-bn="quote-screen"] [data-bn="container"]
//    {max-inline-size:38rem}`, which computed 1088px (the tenant --tenant-max)
//    at every width, giving a one-question-per-screen form a 1048px measure on
//    desktop. The wrapper is gone: both halves now sit unlayered in source
//    order, which is how tenantStyles is already authored.
//
// 2. It was written against apps/marketing's *private* alias vocabulary
//    (--space-N, --border-subtle, --surface-elevated, --text-primary,
//    --radius-*, --font-*, --brand-dark, --brand-subtle, --max-width). The
//    tenant sheet defines none of those — 19 of the 20 custom properties this
//    block referenced resolved to nothing, so the quote form rendered with no
//    padding, no card surfaces, no vertical rhythm, and a progress bar with no
//    visible track. Measured, not inferred: `[data-bn="quote-screen"]` computed
//    `padding: 0px` against a declared `48px 24px`, `[data-bn="radio-label"]`
//    computed `background-color: rgba(0,0,0,0)` against a declared elevated
//    surface, and `[data-bn="accordion-header"]` was 22px tall because its
//    `padding-block` evaluated to nothing. An unresolvable var() takes its
//    whole declaration with it, and says nothing while doing so.
export const intakeStyles = `
/* Form controls the shared surface does not own: radios, the photo
   field, the price table, and the slot picker. Page chrome is bn-section,
   bn-panel, bn-info-card and bn-button. */
[data-bn="quote-progress"]{display:flex;flex-direction:column;gap:var(--gp-space-1);margin-block-end:var(--gp-space-4)}
[data-bn="quote-progress"] p{font-size:var(--gp-text-xs);color:var(--gp-text-muted)}
[data-bn="progress"]{inline-size:100%;block-size:var(--gp-space-2);border-radius:var(--gp-radius-full);overflow:hidden;border:none;background:var(--gp-rule);accent-color:var(--brand-primary)}
[data-bn="progress"]::-webkit-progress-bar{background:var(--gp-rule)}
[data-bn="progress"]::-webkit-progress-value{background:var(--brand-primary)}
[data-bn="progress"]::-moz-progress-bar{background:var(--brand-primary)}

[data-bn="quote-form"]{display:flex;flex-direction:column;gap:var(--gp-space-6);margin-block-start:var(--gp-space-6)}
[data-bn="radio-group"],[data-bn="quote-checkboxes"]{display:flex;flex-direction:column;gap:var(--gp-space-2);border:none;padding:0;margin:0;min-inline-size:0}
[data-bn="radio-group"]>legend,[data-bn="quote-checkboxes"]>legend{font-weight:var(--gp-weight-semibold);margin-block-end:var(--gp-space-2);padding:0}
[data-bn="radio-label"],[data-bn="checkbox-label"]{display:flex;gap:var(--gp-space-3);align-items:flex-start;padding:var(--gp-space-4);background:var(--gp-glass-fill);border:1px solid var(--gp-glass-edge);border-radius:var(--gp-radius-md);box-shadow:var(--gp-shadow-glass);cursor:pointer;min-block-size:var(--gp-tap-min);min-inline-size:0}
[data-bn="radio-label"]:hover,[data-bn="checkbox-label"]:hover{border-color:var(--brand-primary)}
[data-bn="radio-label"]:has(:checked),[data-bn="checkbox-label"]:has(:checked){border-color:var(--brand-primary);background:var(--gp-primary-tint);color:var(--gp-primary-hover)}
[data-bn="radio-label"] input,[data-bn="checkbox-label"] input{margin-block-start:var(--gp-space-1);inline-size:var(--gp-space-4);block-size:var(--gp-space-4);flex-shrink:0;accent-color:var(--brand-primary)}
[data-bn="radio-label"]>span,[data-bn="checkbox-label"]>span{display:flex;flex-direction:column;gap:var(--gp-space-1);font-weight:var(--gp-weight-medium);min-inline-size:0;overflow-wrap:break-word}
[data-bn="quote-hint"]{font-size:var(--gp-text-xs);font-weight:var(--gp-weight-regular);color:var(--gp-text-muted);line-height:var(--gp-leading-normal)}
[data-bn="quote-ladder"]{margin-block-start:var(--gp-space-4);padding-block-start:var(--gp-space-4);border-block-start:1px dashed var(--gp-rule)}

[data-bn="field"]{display:flex;flex-direction:column;gap:var(--gp-space-2);min-inline-size:0}
[data-bn="field"]>label{font-weight:var(--gp-weight-semibold);font-size:var(--gp-text-sm)}
[data-bn="input"]{inline-size:100%;max-inline-size:100%;min-inline-size:0;padding:var(--gp-space-3) var(--gp-space-4);background:var(--gp-glass-fill);border:1px solid var(--gp-glass-edge);border-radius:var(--gp-radius-md);color:var(--gp-text);font-family:inherit;font-size:var(--gp-text-base);min-block-size:var(--gp-tap-min)}
[data-bn="input"]:focus{outline:none;border-color:var(--brand-primary)}
[data-bn="input"][aria-invalid="true"]{border-color:var(--gp-danger)}
[data-bn="field-error"],[data-bn="field"] [data-bn="field-error"]{color:var(--gp-dead-ink);font-size:var(--gp-text-xs)}
[data-bn="field-help"]{color:var(--gp-text-muted);font-size:var(--gp-text-xs)}

[data-bn="quote-file"]{display:flex;flex-direction:column;gap:var(--gp-space-2);font-weight:var(--gp-weight-semibold)}
[data-bn="quote-shots"]{display:flex;flex-direction:column;gap:var(--gp-space-2);color:var(--gp-text-muted);font-size:var(--gp-text-sm)}
[data-bn="quote-shots"] strong{color:var(--gp-text-strong);display:block}

[data-bn="bn-cluster"] [data-bn-restart]{margin-inline-start:auto}
[data-bn="quote-restart"]{display:contents}

/* default | primary | success | warning | error and nothing else. 'info' was
   emitted in three places and declared in none, so the "Not a quote" notice
   and every price condition rendered as base chrome — a box with body text in
   it. The call sites now ask for 'warning', which is what a caveat is. */
[data-bn="alert"]{padding:var(--gp-space-4);border-radius:var(--gp-radius-lg);border:1px solid var(--gp-rule);background:var(--gp-surface);font-size:var(--gp-text-sm)}
[data-bn="alert"][data-variant="warning"]{border-color:var(--gp-warning);background:var(--gp-copper-50)}
[data-bn="alert"][data-variant="error"]{border-color:var(--gp-danger);background:var(--gp-dead-bg)}
[data-bn="alert"][data-variant="success"]{border-color:var(--brand-primary);background:var(--gp-primary-tint);color:var(--gp-primary-hover)}

/* 22px tall before: the declared padding-block resolved to nothing, so the
   disclosure trigger was just the line box of its own label. */
[data-bn="accordion"]{margin-block-start:var(--gp-space-6)}
[data-bn="accordion-header"]{display:flex;align-items:center;min-block-size:var(--gp-tap-min);cursor:pointer;font-weight:var(--gp-weight-semibold);font-size:var(--gp-text-sm);color:var(--brand-primary);padding-block:var(--gp-space-2)}
[data-bn="accordion-content"]{color:var(--gp-text-muted);font-size:var(--gp-text-sm);padding-block-end:var(--gp-space-3)}
[data-bn="quote-resume"]{margin-block-start:var(--gp-space-7);font-size:var(--gp-text-xs);color:var(--gp-text-muted)}

[data-bn="quote-badge"]{margin-block-end:var(--gp-space-3)}
[data-bn="badge"]{display:inline-block;padding:var(--gp-space-1) var(--gp-space-3);border-radius:var(--gp-radius-full);font-size:var(--gp-text-xs);font-weight:var(--gp-weight-bold);text-transform:uppercase;letter-spacing:var(--gp-tracking-label);background:var(--gp-surface-muted);color:var(--gp-text-strong)}
[data-bn="badge"][data-variant="primary"]{background:var(--gp-primary-tint);color:var(--gp-primary-hover)}
[data-bn="badge"][data-variant="success"]{background:var(--brand-primary);color:var(--gp-primary-fg)}
[data-bn="badge"][data-variant="warning"]{background:var(--gp-copper-100);color:var(--gp-copper-700)}
[data-bn="badge"][data-variant="error"]{background:var(--gp-brick-100);color:var(--gp-brick-700)}

[data-bn="quote-range"]{font-family:var(--gp-font-sans);font-size:var(--gp-text-display);font-weight:var(--gp-weight-black);color:var(--brand-primary);margin-block-end:var(--gp-space-4);line-height:var(--gp-leading-tight);overflow-wrap:break-word}
[data-bn="quote-range"] span{font-size:.4em;color:var(--gp-text-muted)}
[data-bn="quote-range"][data-bn-unpriced]{color:var(--gp-text-muted);font-size:var(--gp-text-2xl)}
[data-bn="quote-spread"],[data-bn="quote-spans"]{margin-block:var(--gp-space-4);color:var(--gp-text-muted);font-size:var(--gp-text-sm)}
[data-bn="quote-spread"] summary{display:flex;align-items:center;min-block-size:var(--gp-tap-min);cursor:pointer;font-weight:var(--gp-weight-semibold);color:var(--brand-primary)}
[data-bn="quote-spread"] ul{padding-inline-start:var(--gp-space-6);list-style:disc}
[data-bn="quote-spans"] li{display:flex;justify-content:space-between;gap:var(--gp-space-4);padding-block:var(--gp-space-2);border-block-end:1px solid var(--gp-rule)}
[data-bn="quote-addons"]{margin-block:var(--gp-space-6)}
[data-bn="quote-addons"] h3{font-size:var(--gp-text-base);margin-block-end:var(--gp-space-2)}
[data-bn="quote-addons"] li{padding-block:var(--gp-space-1);color:var(--gp-text-muted)}

[data-bn="table-container"]{overflow-x:auto;overscroll-behavior-x:contain;margin-block:var(--gp-space-6);border:1px solid var(--gp-rule);border-radius:var(--gp-radius-lg)}
[data-bn="table"]{inline-size:100%;border-collapse:collapse;font-size:var(--gp-text-sm)}
[data-bn="table"] caption{text-align:start;font-weight:var(--gp-weight-bold);padding:var(--gp-space-4) var(--gp-space-4) var(--gp-space-2)}
[data-bn="table"] th,[data-bn="table"] td{text-align:start;padding:var(--gp-space-2) var(--gp-space-4);border-block-start:1px solid var(--gp-rule)}
[data-bn="table"] th{font-size:var(--gp-text-xs);text-transform:uppercase;letter-spacing:var(--gp-tracking-label);color:var(--gp-text-muted)}
[data-bn="table"] td:last-child,[data-bn="table"] th:last-child{text-align:end;white-space:nowrap}
/* The terminal's own words. Every outcome authors a summary, most author a
   body, and until 2026-09-12 the page rendered neither — including the one
   that says to get out of the house. The summary reads as a lead; the body
   reads as prose, because several of them are numbered steps a homeowner
   works through standing at the panel. */
[data-bn="quote-summary"]{font-size:var(--gp-text-lg);color:var(--gp-text-strong);margin-block-end:var(--gp-space-4);max-inline-size:60ch}
[data-bn="quote-prose"]{color:var(--gp-text);margin-block-end:var(--gp-space-4);max-inline-size:60ch;line-height:var(--gp-leading-loose)}
[data-bn="quote-next-step"] p{margin-block-end:var(--gp-space-2)}
[data-bn="quote-next-cta"]{color:var(--gp-text-strong)}
[data-bn="quote-cost-promise"],[data-bn="quote-alt-cta"]{color:var(--gp-text-muted)}
/* An urgent outcome puts the phone number above the body text that tells the
   reader to stop using the circuit, so it cannot be scrolled past. */
[data-bn="quote-urgent-contact"]{display:flex;flex-wrap:wrap;gap:var(--gp-space-3);margin-block:var(--gp-space-4) var(--gp-space-6)}
[data-bn="quote-result"][data-bn-urgent] h1{color:var(--gp-dead-ink)}
/* Booking (GP-103): a day per fieldset, a radio per slot, one submit. */
[data-bn="booking-form"]{display:flex;flex-direction:column;gap:var(--gp-space-6);margin-block-start:var(--gp-space-6)}
[data-bn="booking-day"]{border:none;padding:0;margin:0;min-inline-size:0}
[data-bn="booking-day"]>legend{font-weight:var(--gp-weight-bold);margin-block-end:var(--gp-space-3);padding:0}
[data-bn="booking-slots"]{display:grid;gap:var(--gp-space-2);grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))}
[data-bn="booking-slot"]{display:flex;gap:var(--gp-space-2);align-items:center;padding:var(--gp-space-3);background:var(--gp-glass-fill);border:1px solid var(--gp-glass-edge);border-radius:var(--gp-radius-md);box-shadow:var(--gp-shadow-glass);cursor:pointer;min-block-size:var(--gp-tap-min);font-weight:var(--gp-weight-medium);font-size:var(--gp-text-sm)}
[data-bn="booking-slot"]:hover{border-color:var(--brand-primary)}
[data-bn="booking-slot"]:has(:checked){border-color:var(--brand-primary);background:var(--gp-primary-tint);color:var(--gp-primary-hover)}
[data-bn="booking-slot"] input{accent-color:var(--brand-primary);flex-shrink:0}
[data-bn="booking-when"]{font-size:var(--gp-text-lg)}
`;
