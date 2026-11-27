import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { renderRadioGroup } from '@basenative/components';
// By relative path, not the `@greenput/shared/pricing` alias: the seed loader
// reads `seeds/pricing/` with `node:fs` and is kept out of the barrel.
import {
  loadFlattenedSeed,
  readFixture,
} from '../../../libs/shared/pricing/src/seed-loader';
import { evaluate, step, type Screen } from '@greenput/shared/pricing';
import {
  durationWords,
  renderIntakeBookedPage,
  renderIntakeCancelPage,
  WITHDRAWN_REASON_LABELS,
  isWithdrawnReason,
  renderIntakeBookingPage,
  renderIntakeIndexPage,
  renderIntakeQuotePage,
  renderIntakeScreenPage,
  withOptionHints,
} from './intake';
import type { WorkspaceData } from './render';

const SEED_DIR = join(resolve(__dirname, '..', '..', '..'), 'seeds', 'pricing');
const { rateCard, machines } = loadFlattenedSeed(SEED_DIR);
const found = machines.find((m) => m.slug === 'ev-charger-install');
if (!found) throw new Error('the EV machine is missing from seeds/pricing');
const ev = found;

const workspace: WorkspaceData = {
  id: 'ws1',
  name: 'Rivertown Electric',
  slug: 'rivertown',
  trade: 'electrical',
  phone: '512-555-0134',
  email: 'hello@rivertown.example',
  logo_url: null,
  street: '1 Main St',
  city: 'Austin',
  state: 'TX',
  zip: '78704',
};

/** The screen the EV machine is on, given these answers. */
function screenFor(answers: Record<string, unknown>): Screen {
  const walked = step(ev, rateCard, answers, {});
  if (walked.status !== 'question')
    throw new Error('expected a question, got the finished quote');
  return walked.screen;
}

describe('renderIntakeIndexPage', () => {
  it('offers one card per flow, each posting to /quote/start', () => {
    const html = renderIntakeIndexPage(workspace, [
      {
        slug: 'ev-charger-install',
        name: 'Level 2 EV charger',
        description: 'Nine questions, about two minutes.',
        vertical: 'ev_charger',
      },
    ]);
    expect(html).toContain('<form method="post" action="/quote/start"');
    expect(html).toContain('value="ev-charger-install"');
    expect(html).toContain('Level 2 EV charger');
    expect(html).toContain('Nine questions, about two minutes.');
    // Inside the tenant's own chrome.
    expect(html).toContain('Rivertown Electric');
    expect(html).toContain('data-bn="bn-site-footer"');
  });

  it('says so plainly when the contractor prices nothing instantly', () => {
    const html = renderIntakeIndexPage(workspace, []);
    expect(html).toContain('not set up for instant prices');
    expect(html).toContain('href="/contact"');
    expect(html).not.toContain('/quote/start');
  });
});

describe('renderIntakeScreenPage', () => {
  const first = screenFor({});

  it('keeps the contractor in the header and footer — monogram, area — like every other page', () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      flowName: 'Level 2 EV charger install',
      screen: first,
    });
    // The header monogram used to render as an empty black square on the
    // quote pages: renderTenantShell never passed `initials`.
    expect(html).toMatch(/data-bn="monogram"[^>]*>\s*RE\s*</);
    expect(html).toContain(' in Austin, TX');
  });

  it('asks the first question, with its help text and its reason', () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      flowName: 'Level 2 EV charger install',
      screen: first,
    });
    expect(html).toContain('Where do you want the charger?');
    expect(html).toContain('Think about where the car actually sits');
    // "Why we ask" is an accordion, not a wall of text.
    expect(html).toContain('data-bn="accordion"');
    expect(html).toContain('Why we ask');
    expect(html).toContain('Inside a garage is the simplest and cheapest case');
  });

  it('posts back to its own session, with the screen it is answering', () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      flowName: 'EV',
      screen: first,
    });
    expect(html).toContain(
      'action="/quote/s/11111111-1111-4111-8111-111111111111"',
    );
    expect(html).toContain('name="stateId" value="charger_location"');
  });

  it('renders a choice as a radio group with every option', () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: first,
    });
    expect(html).toContain('data-bn="radio-group"');
    for (const option of first.answer.options ?? []) {
      expect(html).toContain(`value="${option.value}"`);
      expect(html).toContain(option.label);
    }
  });

  it('keeps the hint the design wrote for each option, described to the input', () => {
    const speed = screenFor({ charger_location: 'attached_garage_inside' });
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: speed,
    });
    expect(html).toContain(
      'About 25-30 miles of range per hour. This is what most people get',
    );
    expect(html).toContain('data-bn="quote-hint"');
    expect(html).toContain('aria-describedby="charge_speed-32a-hint"');
    expect(html).toContain('id="charge_speed-32a-hint"');
  });

  it('re-checks the answer already given', () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: first,
      values: { charger_location: 'detached_garage' },
    });
    expect(html).toMatch(/value="detached_garage"[^>]*checked/);
  });

  it('shows the "I am not sure" ladder next to the number box on a measurement', () => {
    const distance = screenFor({
      charger_location: 'attached_garage_inside',
      charge_speed: '32a',
      charger_supply: 'have_it',
      charger_connection: 'hardwired',
      panel_location: 'garage',
      panel_photo: { status: 'missing' },
      service_size_stated: '200',
      major_loads: [],
    });
    expect(distance.stateId).toBe('wire_run__include__run_distance_ft');
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: distance,
    });
    expect(html).toContain('type="number"');
    expect(html).toContain('name="run_distance_ft__estimate"');
    expect(html).toContain('Across the garage, or the next room over');
    expect(html).toContain("we'll widen the range a little");
  });

  it('offers the file input and the safety note on the panel photo, when there is somewhere to put it', () => {
    const photo = screenFor({
      charger_location: 'attached_garage_inside',
      charge_speed: '32a',
      charger_supply: 'have_it',
      charger_connection: 'hardwired',
      panel_location: 'garage',
    });
    expect(photo.stateId).toBe('panel_check__include__panel_photo');
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: photo,
      photoUploadAvailable: true,
    });
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('Open the outer door only');
    expect(html).toContain('The panel with the door open');
    // A photo is skippable — the traversal never waits for it.
    expect(html).toContain("I'll send this later");
    expect(html).toContain('name="skip"');
    expect(html).toContain('value="unreviewed"');
  });

  it('does not offer a file input there is nowhere to store, and says why', () => {
    const photo = screenFor({
      charger_location: 'attached_garage_inside',
      charge_speed: '32a',
      charger_supply: 'have_it',
      charger_connection: 'hardwired',
      panel_location: 'garage',
    });
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: photo,
      photoUploadAvailable: false,
    });
    expect(html).not.toContain('type="file"');
    expect(html).toContain('by text or email');
    expect(html).toContain('value="missing"');
  });

  it('puts several fields on one screen for a group, and labels each one', () => {
    const contact = screenFor({
      charger_location: 'attached_garage_inside',
      charge_speed: '32a',
      charger_supply: 'have_it',
      charger_connection: 'hardwired',
      panel_location: 'garage',
      panel_photo: { status: 'missing' },
      service_size_stated: '200',
      major_loads: [],
      run_distance_ft: 25,
      route_crosses: 'same_room',
      wall_finish: 'open_framing',
      property_type: 'single_family',
      property_ownership: 'owner',
    });
    expect(contact.stateId).toBe(
      'property_and_contact__include__contact_details',
    );
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: contact,
    });
    expect(html).toContain('name="service_zip"');
    expect(html).toContain('name="first_name"');
    expect(html).toContain('name="phone"');
    expect(html).toContain('autocomplete="postal-code"');
    expect(html).toContain('autocomplete="tel"');
    // The grouped choice fields are still radio groups.
    expect(html).toContain('name="timing"');
    expect(html).toContain('name="preferred_contact"');
  });

  it('shows a rejected answer against the field that caused it', () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: first,
      fieldErrors: [
        {
          key: 'charger_location',
          message: 'Please choose one of the options.',
        },
      ],
    });
    expect(html).toContain('data-bn="alert"');
    expect(html).toContain('data-variant="error"');
    expect(html).toContain('Please choose one of the options.');
  });

  it('keeps an unfinished form out of search results', () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: first,
    });
    expect(html).toContain('name="robots" content="noindex, nofollow"');
  });

  it("shows progress against the machine's own declared length", () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: first,
    });
    expect(html).toContain('data-bn="progress"');
    expect(html).toContain('of about 9');
  });
});

describe('renderIntakeQuotePage', () => {
  const priced = {
    terminal: 'T_standard_install',
    kind: 'quote',
    path: [],
    notices: [],
    answers: {},
    title: 'Level 2 charger, wired in',
    low: 1000,
    high: 1275,
    point: 1126.98,
    spread_pct: 12,
    spread_reasons: [{ add_pct: 6, because: 'You estimated the distance' }],
    lines: [
      {
        id: 'panel_labour',
        label: 'Work at the panel',
        kind: 'labour',
        qty: 1.5,
        cost: 165,
        detail: '1.5 hr x $110/hr',
        side: 'both' as const,
      },
      {
        id: 'extra',
        label: 'If the run is harder than it looks',
        kind: 'labour',
        qty: 1,
        cost: 110,
        detail: '1 hr x $110/hr',
        side: 'high_only' as const,
      },
    ],
    conditions: ['Permit fees are included.'],
    addons: [{ id: 'surge', label: 'Whole-home surge protection', cost: 420 }],
  };

  it('leads with the range, and says the contractor honours it', () => {
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'Level 2 EV charger install',
      result: priced,
    });
    expect(html).toContain('$1,000');
    expect(html).toContain('$1,275');
    expect(html).toContain('We honour this price');
    expect(html).toContain('Level 2 charger, wired in');
  });

  it('shows one exact number, not a range, once the quote is exact (H1)', () => {
    const exact = {
      ...priced,
      low: 1126.98,
      high: 1126.98,
      stage: 'exact' as const,
      exact: 1126.98,
      exact_blockers: [],
      spread_reasons: [],
      lines: [priced.lines[0]],
    };
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'EV',
      result: exact,
    });
    const headline = html.match(/<p data-bn="quote-range"[^>]*>(.*?)<\/p>/s);
    expect(headline?.[0]).toContain('data-bn-stage="exact"');
    expect(headline?.[1]).toContain('$1,126.98');
    expect(headline?.[1]).not.toContain('to');
    expect(html).not.toMatch(/\$[\d,]+(\.\d\d)?\s*(–|-|to)\s*\$[\d,]+/);
  });

  it('marks a priced range as a range', () => {
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'EV',
      result: { ...priced, stage: 'range' as const },
    });
    expect(html).toContain('data-bn-stage="range"');
  });

  it('itemises what is in the price, and marks the high-end-only line as such', () => {
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'EV',
      result: priced,
    });
    expect(html).toContain('data-bn="table"');
    expect(html).toContain('Work at the panel');
    expect(html).toContain('$165');
    expect(html).toContain('only if it takes longer');
  });

  it('says in words why the range is as wide as it is', () => {
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'EV',
      result: priced,
    });
    expect(html).toContain('Why the range is this wide');
    expect(html).toContain('You estimated the distance');
  });

  it('shows conditions and add-ons', () => {
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'EV',
      result: priced,
    });
    expect(html).toContain('Permit fees are included.');
    expect(html).toContain('Whole-home surge protection');
    expect(html).toContain('$420');
  });

  it('shows no number at all on an outcome that refuses to quote', () => {
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'EV',
      result: {
        terminal: 'T_site_visit_required',
        kind: 'no_quote',
        path: [],
        notices: [],
        answers: {},
        low: null,
        high: null,
        refused_because: 'Uncertainty reached 34%, above the 30% ceiling.',
      },
    });
    expect(html).toContain('No price yet');
    expect(html).toContain('We need to look first');
    expect(html).toContain('above the 30% ceiling');
    expect(html).not.toMatch(/\$\d/);
  });

  it('marks an indicative band as explicitly not a quote', () => {
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'EV',
      result: {
        terminal: 'T_site_visit_required',
        kind: 'no_quote',
        path: [],
        notices: [],
        answers: {},
        low: null,
        high: null,
        indicative: { low: 800, high: 4200, not_a_quote: true },
      },
    });
    expect(html).toContain('Not a quote.');
    expect(html).toContain('$800');
    expect(html).toContain('$4,200');
  });

  it("offers the contractor's own phone and email as the next step", () => {
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'EV',
      result: priced,
    });
    expect(html).toContain('href="tel:512-555-0134"');
    expect(html).toContain('href="mailto:hello@rivertown.example"');
  });
});

// Every badge variant this file emits must be one of the five
// @basenative/components declares — default | primary | success | warning |
// error. Anything outside that set matches no [data-variant] rule and renders
// unstyled. That has shipped twice already.
describe('badge variants are declared', () => {
  const DECLARED = new Set([
    'default',
    'primary',
    'success',
    'warning',
    'error',
  ]);

  it('emits no variant the package does not style', () => {
    const kinds = [
      'quote',
      'span',
      'no_quote',
      'urgent',
      'referral',
      'invented',
    ];
    for (const kind of kinds) {
      const html = renderIntakeQuotePage(workspace, {
        flowName: 'EV',
        result: {
          terminal: 'T',
          kind,
          path: [],
          notices: [],
          answers: {},
          low: kind === 'quote' ? 100 : null,
          high: kind === 'quote' ? 200 : null,
        },
      });
      const variants = [
        ...html.matchAll(/data-bn="badge"[^>]*data-variant="([^"]+)"/g),
      ].map((m) => m[1]);
      expect(variants.length, kind).toBeGreaterThan(0);
      for (const v of variants)
        expect(DECLARED, `${kind} -> ${v}`).toContain(v);
    }
  });
});

// withOptionHints splices into markup @basenative/components produced. Pin the
// shape it depends on, so a change upstream fails here rather than silently
// dropping every hint from the form.
describe('the radio-group contract withOptionHints depends on', () => {
  const html = renderRadioGroup({
    name: 'colour',
    items: [{ value: 'red', label: 'Red' }],
  });

  it('still wraps each option in a label ending in </span></label>', () => {
    expect(html).toContain('<label data-bn="radio-label">');
    expect(html).toContain('<span>Red</span></label>');
  });

  it('still opens each input with <input data-bn="radio" and carries the value', () => {
    expect(html).toContain('<input data-bn="radio"');
    expect(html).toContain('value="red"');
  });

  it('adds the hint, the id and the aria-describedby that ties them together', () => {
    const withHints = withOptionHints(
      html,
      'colour',
      new Map([['red', 'Like a fire engine']]),
    );
    expect(withHints).toContain(
      '<small data-bn="quote-hint" id="colour-red-hint">Like a fire engine</small></span></label>',
    );
    expect(withHints).toContain('aria-describedby="colour-red-hint"');
  });

  it('leaves an option with no hint exactly as the component rendered it', () => {
    expect(withOptionHints(html, 'colour', new Map())).toBe(html);
    const other = withOptionHints(
      html,
      'colour',
      new Map([['blue', 'not this one']]),
    );
    expect(other).toBe(html);
  });

  it('escapes a hint rather than letting it close the element', () => {
    const withHints = withOptionHints(
      html,
      'colour',
      new Map([['red', '</small><script>alert(1)</script>']]),
    );
    expect(withHints).not.toContain('<script>');
    expect(withHints).toContain('&lt;script&gt;');
  });
});

// ─────────────────────────────────────────────────────────────
// The outcome the machine actually authored.
//
// Not a hand-written result object: the real troubleshooting machine is
// loaded from seeds/pricing and driven to its urgent ending, and the page is
// rendered from whatever `evaluate` returns. A fixture written from the
// renderer's point of view could not have caught this — `evaluate` carried
// `title` on `kind: 'quote'` and nothing else on any other kind, so every
// word of T_urgent_dispatch was dropped between the machine and the page and
// a homeowner who answered "there's a burning smell" was shown
// "No price yet — someone will be in touch".
// ─────────────────────────────────────────────────────────────
describe('an outcome that is not a price', () => {
  const troubleshooting = machines.find(
    (m) => m.slug === 'troubleshooting-callout',
  );
  if (!troubleshooting) {
    throw new Error(
      'the troubleshooting machine is missing from seeds/pricing',
    );
  }

  /** The one answer that reaches T_urgent_dispatch. */
  const urgentResult = evaluate(
    troubleshooting,
    rateCard,
    { symptom: 'burning_or_hot' },
    {},
  );

  const render = () =>
    renderIntakeQuotePage(workspace, {
      flowName: "Something's not working",
      result: urgentResult,
    });

  it('reaches the urgent terminal on a burning smell', () => {
    expect(urgentResult.terminal).toBe('T_urgent_dispatch');
    expect(urgentResult.kind).toBe('urgent');
  });

  it('carries the terminal copy off the machine, not just the title', () => {
    expect(urgentResult.title).toBe('Stop and read this');
    expect(urgentResult.summary).toContain('active fire or shock risk');
    expect(urgentResult.body).toContain('call 911');
    expect(urgentResult.next_step?.surface_phone_immediately).toBe(true);
  });

  it('puts the safety instructions on the page', () => {
    const html = render();
    expect(html).toContain('Stop and read this');
    expect(html).toContain('get out and call 911');
    expect(html).toContain('switch off the breaker');
  });

  it('does not offer a price pill on an outcome that brought its own words', () => {
    expect(render()).not.toContain('No price yet');
  });

  it('surfaces the phone number above the instructions, as the terminal asks', () => {
    const html = render();
    const phoneAt = html.indexOf('data-bn="quote-urgent-contact"');
    const bodyAt = html.indexOf('get out and call 911');
    expect(phoneAt).toBeGreaterThan(-1);
    expect(phoneAt).toBeLessThan(bodyAt);
  });

  it('titles the tab with the outcome, not "Your price"', () => {
    expect(render()).toContain(
      '<title>Stop and read this — Rivertown Electric',
    );
  });

  it('keeps the numbered steps of a self-check as separate paragraphs', () => {
    const selfCheck = evaluate(
      troubleshooting,
      rateCard,
      { symptom: 'gfci_trips', reset_attempted: 'tried_it_works' },
      {},
    );
    // Whichever ending that path lands on, prose must not be one run-on
    // block: the bodies in seeds/pricing are steps someone follows standing
    // at their panel.
    if (!selfCheck.body?.includes('\n\n')) return;
    const html = renderIntakeQuotePage(workspace, {
      flowName: "Something's not working",
      result: selfCheck,
    });
    const paragraphs = html.match(/data-bn="quote-prose"/g) ?? [];
    expect(paragraphs.length).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────
// The span list (GP-001). Driven off the frozen EV fixture that lands on
// T_needs_panel_review, so the two ends of the range are whatever the seed
// titles them — not a hand-written result the renderer could not disagree
// with.
// ─────────────────────────────────────────────────────────────
describe('the two ends of a spanning range', () => {
  const fixture = readFixture(
    join(SEED_DIR, 'fixtures', '02-ev-plug-in-finished-wall.json'),
  );
  const spanned = evaluate(ev, rateCard, fixture.answers, fixture.env ?? {});
  const html = renderIntakeQuotePage(workspace, {
    flowName: 'Level 2 EV charger install',
    result: spanned,
  });
  const list = html.match(/<ul data-bn="quote-spans">.*?<\/ul>/s)?.[0] ?? '';

  it('is the outcome the fixture froze', () => {
    expect(spanned.kind).toBe('span');
    expect(spanned.spans?.map((s) => s.id)).toEqual([
      'T_standard_install',
      'T_subpanel_required',
    ]);
  });

  it('names each end the way its terminal does', () => {
    expect(list).toContain('A new charger circuit from your existing panel');
    expect(list).toContain('A small extra panel, then your charger');
  });

  it('never prints a terminal id, in the list or anywhere else on the page', () => {
    expect(list).not.toContain('T_standard_install');
    expect(list).not.toContain('T_subpanel_required');
    expect(html).not.toMatch(/\bT_[a-z_]+/);
  });
});

// ── Booking (GP-103) ──────────────────────────────────────────

describe('durationWords', () => {
  it('says it the way a person would', () => {
    expect(durationWords(30)).toBe('30 minutes');
    expect(durationWords(60)).toBe('an hour');
    expect(durationWords(90)).toBe('an hour and a half');
    expect(durationWords(120)).toBe('2 hours');
    expect(durationWords(150)).toBe('2½ hours');
    expect(durationWords(135)).toBe('2 hours 15 minutes');
  });
});

describe('the price page with a booking offer', () => {
  const result = evaluate(ev, rateCard, {
    property_type: 'single_family',
    property_ownership: 'owner',
    service_zip: '78704',
    timing: 'asap',
    first_name: 'Dana',
    last_name: 'Ortiz',
    phone: '512-555-0134',
    email: 'dana@example.com',
    preferred_contact: 'text',
    charger_location: 'attached_garage_inside',
    charge_speed: '32a',
    charger_supply: 'have_it',
    charger_connection: 'hardwired',
    panel_location: 'garage',
    panel_photo: {
      status: 'reviewed',
      fields: {
        panel_capacity: 'spare_capable',
        panel_brand: 'square_d',
        panel_spaces_free: 4,
        panel_main_amps: 200,
        aluminium_branch_visible: false,
      },
    },
    service_size_stated: '200',
    major_loads: ['electric_range'],
    run_distance_ft: 30,
    route_crosses: 'across_house',
    wall_finish: 'finished_access',
  });

  it('offers to book when told it can, and says how long the work takes', () => {
    expect(result.kind).toBe('quote');
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'Level 2 EV charger install',
      result,
      booking: { sessionId: 'abc', durationMinutes: 150 },
    });
    expect(html).toContain('href="/quote/s/abc/book"');
    expect(html).toContain('data-bn-book');
    expect(html).toContain('about 2½ hours');
    expect(html).not.toContain('Someone will be in touch to book a time');
    expect(html).toContain('tel:512-555-0134');
  });

  it('keeps the card and offers nothing when not told it can', () => {
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'Level 2 EV charger install',
      result,
    });
    expect(html).not.toContain('data-bn-book');
    expect(html).toContain('Someone will be in touch to book a time');
  });
});

describe('renderIntakeBookingPage', () => {
  const result = {
    terminal: 'T_standard_install',
    kind: 'quote',
    path: [],
    notices: [],
    answers: {},
    low: 1000,
    high: 1275,
  };
  const options = {
    sessionId: 'abc',
    flowName: 'Level 2 EV charger install',
    result,
    timezone: 'America/Chicago',
    durationMinutes: 120,
    horizonDays: 30,
    slots: [
      {
        startUtc: '2027-06-02T14:00:00.000Z',
        endUtc: '2027-06-02T16:00:00.000Z',
      },
      {
        startUtc: '2027-06-02T14:30:00.000Z',
        endUtc: '2027-06-02T16:30:00.000Z',
      },
      {
        startUtc: '2027-06-03T14:00:00.000Z',
        endUtc: '2027-06-03T16:00:00.000Z',
      },
    ],
  };

  it('is one form on this origin, a fieldset per local day, a radio per slot', () => {
    const html = renderIntakeBookingPage(workspace, options);
    expect(html).toContain('<form method="post" action="/quote/s/abc/book"');
    expect(html.match(/data-bn="booking-day"/g)).toHaveLength(2);
    expect(html).toContain('<legend>Wednesday, June 2</legend>');
    expect(html).toContain('<legend>Thursday, June 3</legend>');
    expect(html.match(/name="startUtc"/g)).toHaveLength(3);
    expect(html).toContain('value="2027-06-02T14:00:00.000Z"');
    expect(html).toContain('9:00 AM – 11:00 AM');
    expect(html).toContain('9:30 AM – 11:30 AM');
    expect(html).toContain('type="submit"');
    expect(html).toContain('$1,000 to $1,275');
    expect(html).toContain('about 2 hours');
    expect(html).toContain('href="/quote/s/abc"');
    // Every radio has a label a screen reader can read.
    expect(
      html.match(/<label data-bn="booking-slot" for="slot-/g),
    ).toHaveLength(3);
  });

  it('carries the message when a slot just went', () => {
    const html = renderIntakeBookingPage(workspace, {
      ...options,
      message: 'That time just went — pick another',
    });
    expect(html).toContain('That time just went — pick another');
    expect(html).toContain('role="alert"');
  });

  it('says so, with the number, when nothing is free', () => {
    const html = renderIntakeBookingPage(workspace, { ...options, slots: [] });
    expect(html).not.toContain('name="startUtc"');
    expect(html).toContain('Nothing free just now');
    expect(html).toContain('next 30 days');
    expect(html).toContain('tel:512-555-0134');
  });
});

describe('renderIntakeBookedPage', () => {
  const options = {
    sessionId: 'abc',
    flowName: 'Level 2 EV charger install',
    result: {
      terminal: 'T_standard_install',
      kind: 'quote',
      path: [],
      notices: [],
      answers: {},
      low: 1000,
      high: 1275,
    },
    timezone: 'America/Chicago',
    job: {
      jobNumber: '#1001',
      scheduledStart: '2027-06-02T14:00:00.000Z',
      scheduledEnd: '2027-06-02T16:00:00.000Z',
    },
  };

  it('shows the slot in local time, the band, the number and the way back', () => {
    const html = renderIntakeBookedPage(workspace, options);
    expect(html).toContain("You're booked");
    expect(html).toContain('Wednesday, June 2, 9:00 AM – 11:00 AM');
    expect(html).not.toContain('(UTC)');
    expect(html).toContain('$1,000 to $1,275');
    expect(html).toContain('tel:512-555-0134');
    expect(html).toContain('#1001');
    // Change-or-cancel (GP-105): two links on the same capability, and the
    // words that say neither costs anything.
    expect(html).toContain('href="/quote/s/abc/reschedule"');
    expect(html).toContain('data-bn-reschedule');
    expect(html).toContain('href="/quote/s/abc/cancel"');
    expect(html).toContain('data-bn-cancel');
    expect(html).toContain('costs nothing');
    expect(html).toContain('change or cancel');
    expect(html).toContain('data-variant="success"');
  });

  it('labels the time as UTC when the workspace has lost its zone', () => {
    const html = renderIntakeBookedPage(workspace, {
      ...options,
      timezone: 'UTC',
    });
    expect(html).toContain('Wednesday, June 2, 2:00 PM – 4:00 PM');
    expect(html).toContain('(UTC)');
  });
});

// ── Cancel (GP-105) ───────────────────────────────────────────

describe('renderIntakeCancelPage', () => {
  const html = renderIntakeCancelPage(workspace, {
    sessionId: 'abc',
    flowName: 'Level 2 EV charger install',
    when: 'Wednesday, June 2, 9:00 AM – 11:00 AM',
  });

  it('asks the one question, on this origin, with no script in the form', () => {
    expect(html).toContain('Cancel this booking?');
    expect(html).toContain('Wednesday, June 2, 9:00 AM – 11:00 AM');
    expect(html).toContain('action="/quote/s/abc/cancel"');
    expect(html).toContain('method="post"');
    expect(html).toContain('href="/quote/s/abc/booked"');
    const formHtml = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    expect(formHtml).not.toContain('<script');
    expect(formHtml).not.toMatch(/ on[a-z]+=/);
    expect(formHtml).toContain('data-bn-field="reason"');
    for (const [value, label] of Object.entries(WITHDRAWN_REASON_LABELS)) {
      expect(formHtml).toContain(`value="${value}"`);
      expect(formHtml).toContain(label);
    }
    // Four reasons, no more: the closed set on leads.withdrawn_reason.
    expect([...formHtml.matchAll(/name="reason"/g)]).toHaveLength(4);
  });

  it('says cancelling costs nothing before it asks anything', () => {
    expect(html.indexOf('costs nothing')).toBeLessThan(html.indexOf('<form'));
  });

  it('carries the message and the selection back after a rejected submit', () => {
    const again = renderIntakeCancelPage(workspace, {
      sessionId: 'abc',
      flowName: 'Level 2 EV charger install',
      when: 'Wednesday, June 2, 9:00 AM – 11:00 AM',
      message: 'Pick a reason first',
      selected: 'other',
    });
    expect(again).toContain('Pick a reason first');
    expect(again).toMatch(/value="other"[^>]*checked/);
  });

  it('recognises exactly the closed set', () => {
    expect(isWithdrawnReason('schedule_no_longer_works')).toBe(true);
    expect(isWithdrawnReason('other')).toBe(true);
    expect(isWithdrawnReason('')).toBe(false);
    expect(isWithdrawnReason('changed_mind')).toBe(false);
    expect(isWithdrawnReason('toString')).toBe(false);
  });
});

// ── Back and Start over (GP-014) ──────────────────────────────

describe('the way back, and the way out', () => {
  const first = screenFor({});
  const third = screenFor({
    charger_location: 'attached_garage_inside',
    charge_speed: '32a',
  });

  it('offers Start over on the first screen, and no Back — there is nothing behind it', () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: first,
    });
    expect(html).toContain('Start over');
    expect(html).toContain('name="nav" value="restart" formnovalidate');
    expect(html).not.toContain('value="back"');
    expect(html).not.toContain('name="prevStateId"');
  });

  it('offers both on a later screen, as named submits of the same form', () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: third,
      prevStateId: 'charge_speed',
    });
    expect(html).toContain('name="nav" value="back" formnovalidate');
    expect(html).toContain('name="nav" value="restart" formnovalidate');
    expect(html).toContain('name="prevStateId" value="charge_speed"');
    // One form: the buttons post where the answers post, and nothing else
    // on the page is a form, so `form-action 'self'` covers them.
    expect(html.match(/<form /g)).toHaveLength(1);
    expect(html).toContain('action="/quote/s/sess"');
    // Continue first, Start over last.
    expect(html.indexOf('Continue')).toBeLessThan(html.indexOf('>Back<'));
    expect(html.indexOf('>Back<')).toBeLessThan(html.indexOf('Start over'));
    // No script does any of it.
    const formHtml = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    expect(formHtml).not.toContain('<script');
    expect(formHtml).not.toMatch(/ on[a-z]+=/);
  });

  it('escapes the previous state id like everything else off the wire', () => {
    const html = renderIntakeScreenPage(workspace, {
      sessionId: 'sess',
      flowName: 'EV',
      screen: third,
      prevStateId: '"><script>',
    });
    expect(html).not.toContain('"><script>');
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;"');
  });

  it('offers Start over on the finished price, posting to the session', () => {
    const html = renderIntakeQuotePage(workspace, {
      sessionId: 'abc',
      flowName: 'Level 2 EV charger install',
      result: evaluate(ev, rateCard, {
        property_type: 'single_family',
        property_ownership: 'owner',
        service_zip: '78704',
        timing: 'asap',
        first_name: 'Dana',
        last_name: 'Ortiz',
        phone: '512-555-0134',
        email: 'dana@example.com',
        preferred_contact: 'text',
        charger_location: 'attached_garage_inside',
        charge_speed: '32a',
        charger_supply: 'have_it',
        charger_connection: 'hardwired',
        panel_location: 'garage',
        panel_photo: { status: 'missing', fields: {} },
        service_size_stated: '200',
        major_loads: ['electric_range'],
        run_distance_ft: 30,
        route_crosses: 'across_house',
        wall_finish: 'finished_access',
      }),
    });
    expect(html).toContain(
      '<form method="post" action="/quote/s/abc" data-bn="quote-restart">',
    );
    expect(html).toContain('name="nav" value="restart" formnovalidate');
    expect(html).toContain('Start over');
    // Next to the contact buttons, after them.
    expect(html.indexOf('tel:512-555-0134')).toBeLessThan(
      html.indexOf('data-bn="quote-restart"'),
    );
  });

  it('offers no reset on a price rendered without a session to reset', () => {
    const html = renderIntakeQuotePage(workspace, {
      flowName: 'EV',
      result: evaluate(ev, rateCard, {
        property_type: 'single_family',
        property_ownership: 'owner',
        service_zip: '78704',
        timing: 'asap',
        first_name: 'Dana',
        last_name: 'Ortiz',
        phone: '512-555-0134',
        email: 'dana@example.com',
        preferred_contact: 'text',
        charger_location: 'attached_garage_inside',
        charge_speed: '32a',
        charger_supply: 'have_it',
        charger_connection: 'hardwired',
        panel_location: 'garage',
        panel_photo: { status: 'missing', fields: {} },
        service_size_stated: '200',
        major_loads: ['electric_range'],
        run_distance_ft: 30,
        route_crosses: 'across_house',
        wall_finish: 'finished_access',
      }),
    });
    expect(html).not.toContain('value="restart"');
  });
});
