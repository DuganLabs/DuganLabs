/**
 * Dashboard view (app.html). BaseNative-flavored: state lives in signals, the
 * `bind*` helpers wire signals into the static HTML, and every ledger renders
 * through `lib/table.ts` — which sits on `@basenative/components`'
 * `renderTable`/`renderSkeleton`/`renderAlert`/`renderBadge` rather than
 * building rows by hand.
 *
 * Presentation rules applied here come from
 * `docs/visual-language.md`:
 *
 *  - One precision per column, nulls included, so decimals align (§2.3).
 *  - Figures default to neutral ink; colour attaches to a *direction* or a
 *    *state*, never to a position (§3.3).
 *  - Direction is always also carried by a rendered sign or a text badge, so
 *    it survives greyscale and forced-colors (§3.4).
 *  - Exactly one emphasised row per table (§5.7).
 */
import { signal, computed } from '@basenative/runtime';
import { FILING_SHORT_LABELS, isFilingStatus } from '@pendingbusiness/core';
import { apiFetch } from './lib/auth-fetch.js';
import { errorMessage } from './lib/api-error.js';
import { bindText, bindAttr } from './lib/bind.js';
import { withSubmitting } from './lib/forms.js';
import { confirmDialog } from './lib/dialog.js';
import { bindTable, figure, identity, badge, note, text, type TableState } from './lib/table.js';
import { renderButton } from '@basenative/components';
import { escapeAttr } from '@basenative/runtime/shared/escape';
import { usd, usdOwed, usdSigned, pct, stamp, fraction, DASH } from './lib/format.js';

interface IncomeSource {
  id: number;
  label: string;
  type: 'w2' | 'se' | 'k1' | 'other';
  grossAnnual: number;
  employer: string | null;
  has401kMatch: boolean;
}
interface Liability {
  id: number;
  label: string;
  principal: number;
  rateApr: number;
  minPaymentMonthly: number;
  type: string;
  priority: number;
}
interface Situation {
  userId: number;
  filingStatus: string;
  state: string;
  incomeSources: IncomeSource[];
  liabilities: Liability[];
  fixedObligationsMonthly: number;
  liquidityFloorMonthly: number;
  kidsCount: number;
}
interface Threshold {
  name: string;
  amount: number | null;
  distance: number;
}
interface ScorpRow {
  netProfit: number;
  soleProp: { fica: number };
  scorp: { w2Portion: number; distributionPortion: number; fica: number };
  ficaSavings: number;
}
interface SituationResponse {
  situation: Situation;
  projectedMagi: number;
  stackedMarginal: number;
  nextThreshold: Threshold;
  scorpLadder: ScorpRow[];
  augusta: {
    rentalDays: number;
    dailyRate: number;
    taxFreeIncome: number;
    businessDeduction: number;
    taxBenefit: number;
  };
  ctc: { baseCredit: number; kids: number; currentAnnual: number };
  salt: { cap2026Base: number; currentAnnual: number };
}
interface Waterfall {
  grossIn: number;
  taxReserve: number;
  fixedObligations: number;
  liquidityReserve: number;
  debtAvalanche: { liabilityId: number | null; amount: number };
  discretionary: number;
  /** Positive when reserves and obligations exceed gross in; 0 otherwise. */
  shortfall: number;
}
interface ScenarioResult {
  inputs: { greenputMonthlyNet: number; oneTimeIncome?: number };
  waterfall: Waterfall;
  nextThreshold: Threshold;
  magiProjection: number;
}
interface SavedScenario {
  id: number;
  label: string;
  createdAt: string;
  inputs: ScenarioResult['inputs'];
  result: ScenarioResult;
}
interface AccountRow {
  id: number;
  institution: string | null;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  currency: string | null;
}
interface AccountsResponse {
  accounts: AccountRow[];
  totals: { cash: number; creditDebt: number; loanDebt: number };
}
interface MeResponse {
  user: { handle: string } | null;
  profile?: {
    displayName: string | null;
    filingStatus: string | null;
    state: string | null;
  } | null;
}

// ─── state signals ───────────────────────────────────────────

const me = signal<MeResponse | null>(null);
const situation = signal<SituationResponse | null>(null);
const situationError = signal<string | null>(null);
const scenario = signal<ScenarioResult | null>(null);
const savedScenarios = signal<SavedScenario[]>([]);
const savedError = signal<string | null>(null);
const savedLoaded = signal<boolean>(false);
const accountsData = signal<AccountsResponse | null>(null);
const accountsError = signal<string | null>(null);
const statusMsg = signal<string>('');
const statusState = signal<'ok' | 'error' | null>(null);

function setStatus(text_: string, state: 'ok' | 'error' | null = null): void {
  statusMsg.set(text_);
  statusState.set(state);
}

/**
 * Fold a (value, error) signal pair into the three states every ledger has to
 * render — loading, error with a retry, and ready. Error is a section-level
 * `renderAlert`, not a status line at the far end of the page.
 */
function stateOf<S, R>(
  value: S | null,
  error: string | null,
  rows: (v: S) => readonly R[],
  retry: () => void,
): TableState<R> {
  if (error) return { status: 'error', message: error, retry };
  if (value == null) return { status: 'loading' };
  return { status: 'ready', rows: rows(value) };
}

const THRESHOLDS: readonly { name: string; amount: number }[] = [
  { name: 'NIIT', amount: 250_000 },
  { name: 'CTC phaseout', amount: 400_000 },
  { name: 'SALT phaseout', amount: 505_000 },
];

/** Above this APR a liability is flagged as a caution, with a text badge. */
const HOT_APR = 0.15;
/** Annual payroll overhead an S-Corp election has to clear to be worth it. */
const SCORP_OVERHEAD = 1_500;

const TYPE_LABELS: Readonly<Record<string, string>> = {
  w2: 'W-2',
  se: 'Self-employed',
  k1: 'K-1',
  other: 'Other',
};

function liabilityLabel(id: number | null, liabilities: readonly Liability[]): string {
  if (id === null) return 'no target';
  const l = liabilities.find(x => x.id === id);
  return l ? `${l.label} @ ${pct(l.rateApr)}` : `#${id}`;
}

// ─── derived signals ─────────────────────────────────────────

const totalDebt = computed(() => {
  const s = situation();
  if (!s) return null;
  return s.situation.liabilities.reduce((sum, l) => sum + l.principal, 0);
});

const sortedLiabilities = computed<readonly Liability[]>(() => {
  const s = situation();
  if (!s) return [];
  return [...s.situation.liabilities].sort((a, b) => b.rateApr - a.rateApr);
});

// ─── header identity ─────────────────────────────────────────

/**
 * Filing-status display comes from @pendingbusiness/core, which is also where
 * the bracket tables and the DB vocabulary live. The local copy this replaces
 * carried three keys (`married_jointly`, `married_separately`,
 * `head_of_household`) that `users.filing_status` has never been able to hold
 * — its CHECK constraint permits only the five short IRS codes.
 */
function filingLabel(status: string | null | undefined): string {
  if (!status) return '';
  return isFilingStatus(status) ? FILING_SHORT_LABELS[status] : status;
}

bindText('me-line', () => {
  const m = me();
  if (!m?.user) return 'Signed in';
  const parts = [m.user.handle, filingLabel(m.profile?.filingStatus), m.profile?.state ?? ''];
  return ['Signed in', ...parts.filter(p => p.length > 0)].join(' · ');
});

/*
 * The threshold heading read a literal "2026 · MFJ" in app.html, so a user of
 * any other filing status saw a dashboard labelled with somebody else's. Both
 * meta lines now come from the situation the worker actually computed.
 *
 * (The SALT tile carried the same literal and no longer states a status at
 * all — the readout's <dt> is just "SALT cap" — so there is nothing to bind
 * there any more.)
 */
bindText('thresholds-meta', () => {
  const s = situation();
  if (!s) return DASH;
  return `2026 \u00b7 ${filingLabel(s.situation.filingStatus) || DASH}`;
});

bindText('state-meta', () => {
  const s = situation();
  if (!s) return DASH;
  return `2026 \u00b7 ${filingLabel(s.situation.filingStatus) || DASH} \u00b7 ${s.situation.state}`;
});

// ─── readout strip ───────────────────────────────────────────
// All four figures are neutral ink: a position is a fact, not a direction.
// Colour lives on the status line beneath, and only where there is a state.

bindText('stat-magi', () => {
  const s = situation();
  return s ? usd(s.projectedMagi) : DASH;
});
bindText('stat-marginal', () => {
  const s = situation();
  return s ? pct(s.stackedMarginal, 1) : DASH;
});
bindText('stat-next-name', () => {
  const s = situation();
  return s ? s.nextThreshold.name : DASH;
});

/** Headroom to the next threshold, as a 0..1 fill for the meter. */
const thresholdFill = computed(() => {
  const s = situation();
  if (!s || s.nextThreshold.amount === null) return { v: 1, state: 'crossed' as const };
  const target = s.nextThreshold.amount;
  const v = fraction(s.projectedMagi, target);
  return { v, state: v >= 0.9 ? ('caution' as const) : ('ok' as const) };
});

bindAttr('stat-next-meter', 'style', () => `--v:${thresholdFill().v.toFixed(4)}`);
bindAttr('stat-next-meter', 'data-state', () => {
  const f = thresholdFill();
  return f.state === 'ok' ? null : f.state;
});
bindText('stat-next-distance', () => {
  const s = situation();
  if (!s) return DASH;
  if (s.nextThreshold.amount === null) return 'all thresholds crossed';
  const f = thresholdFill();
  const close = f.state === 'caution' ? ' · close' : '';
  return `${usd(s.nextThreshold.distance)} of headroom${close}`;
});
bindAttr('stat-next-distance', 'data-tone', () =>
  thresholdFill().state === 'ok' ? null : 'caution',
);

bindText('stat-debt', () => {
  const v = totalDebt();
  return v == null ? DASH : usdOwed(v);
});
bindText('stat-debt-note', () => {
  const s = situation();
  if (!s) return 'across all tracked liabilities';
  const n = s.situation.liabilities.length;
  const min = s.situation.liabilities.reduce((sum, l) => sum + l.minPaymentMonthly, 0);
  return `${n} liabilities · ${usd(min)}/mo minimum`;
});

// ─── income sources ──────────────────────────────────────────

const maxGross = computed(() => {
  const s = situation();
  if (!s) return 0;
  return Math.max(0, ...s.situation.incomeSources.map(x => x.grossAnnual));
});

bindTable<IncomeSource>(
  'income-rows',
  {
    caption: 'Annual gross by source.',
    emptyMessage: 'No income sources recorded yet.',
    footLabel: 'Total',
    skeletonRows: 4,
    columns: [
      {
        key: 'label',
        label: 'Source',
        identity: true,
        width: '36%',
        cell: s => identity(s.label, s.employer ?? undefined),
      },
      {
        key: 'type',
        label: 'Type',
        width: '22%',
        cell: s => note(TYPE_LABELS[s.type] ?? s.type.toUpperCase()),
      },
      {
        key: 'grossAnnual',
        label: 'Gross / yr',
        numeric: true,
        primary: true,
        width: '26%',
        cell: s => figure(usd(s.grossAnnual), { bar: fraction(s.grossAnnual, maxGross()) }),
        foot: rows => figure(usd(rows.reduce((sum, r) => sum + r.grossAnnual, 0))),
      },
      {
        key: 'has401kMatch',
        label: '401(k)',
        width: '16%',
        cell: s => (s.has401kMatch ? badge('match', 'success') : note(DASH)),
      },
    ],
  },
  () =>
    stateOf(
      situation(),
      situationError(),
      s => s.situation.incomeSources,
      () => void loadSituation(),
    ),
);

// ─── liabilities ─────────────────────────────────────────────
// APR is the decision variable, so it gets two decimals and the caution
// badge; principal gets the magnitude bar. Exactly one row is emphasised:
// the avalanche target.

const maxPrincipal = computed(() => Math.max(0, ...sortedLiabilities().map(l => l.principal)));

bindTable<Liability>(
  'liability-rows',
  {
    caption: 'Highest APR first — the avalanche order.',
    emptyMessage: 'No liabilities tracked.',
    footLabel: 'Total',
    skeletonRows: 5,
    rowVariant: (_l, i) => (i === 0 ? 'emphasis' : undefined),
    columns: [
      {
        key: 'label',
        label: 'Liability',
        identity: true,
        width: '30%',
        cell: (l, i) => identity(l.label, `${i + 1} · ${l.type.replace(/_/g, ' ')}`),
      },
      {
        key: 'principal',
        label: 'Principal',
        numeric: true,
        primary: true,
        width: '20%',
        cell: l => figure(usdOwed(l.principal), { bar: fraction(l.principal, maxPrincipal()) }),
        foot: rows => figure(usdOwed(rows.reduce((sum, r) => sum + r.principal, 0))),
      },
      {
        key: 'rateApr',
        label: 'APR',
        numeric: true,
        width: '16%',
        cell: l => figure(pct(l.rateApr), l.rateApr >= HOT_APR ? { tone: 'caution' } : {}),
      },
      {
        key: 'minPaymentMonthly',
        label: 'Min / mo',
        numeric: true,
        width: '18%',
        cell: l => figure(usd(l.minPaymentMonthly)),
        foot: rows => figure(usd(rows.reduce((sum, r) => sum + r.minPaymentMonthly, 0))),
      },
      {
        key: 'target',
        label: 'Status',
        width: '16%',
        cell: (l, i) => {
          if (i === 0) return badge('avalanche target', 'primary');
          if (l.rateApr >= HOT_APR) return badge('over line', 'warning');
          return note(DASH);
        },
      },
    ],
  },
  () =>
    stateOf(
      situation(),
      situationError(),
      () => sortedLiabilities(),
      () => void loadSituation(),
    ),
);

// ─── tax thresholds ──────────────────────────────────────────

interface ThresholdRow {
  name: string;
  amount: number;
  crossed: boolean;
  distance: number;
}

bindTable<ThresholdRow>(
  'threshold-rows',
  {
    caption: 'Where the next dollar changes the rules.',
    emptyMessage: 'No thresholds configured.',
    skeletonRows: 3,
    rowVariant: t => (t.crossed ? 'muted' : undefined),
    columns: [
      {
        key: 'name',
        label: 'Threshold',
        identity: true,
        width: '38%',
        cell: t => identity(t.name),
      },
      {
        key: 'amount',
        label: 'Crosses at',
        numeric: true,
        width: '30%',
        cell: t => figure(usd(t.amount)),
      },
      {
        key: 'distance',
        label: 'Headroom',
        numeric: true,
        primary: true,
        width: '32%',
        cell: t =>
          t.crossed
            ? badge('crossed', 'error')
            : figure(usd(t.distance), t.distance / t.amount <= 0.1 ? { tone: 'caution' } : {}),
      },
    ],
  },
  () =>
    stateOf(
      situation(),
      situationError(),
      s =>
        THRESHOLDS.map(t => ({
          ...t,
          crossed: s.projectedMagi >= t.amount,
          distance: t.amount - s.projectedMagi,
        })),
      () => void loadSituation(),
    ),
);

// ─── S-Corp ladder ───────────────────────────────────────────
// Emphasis marks the FIRST rung that clears payroll overhead — the
// break-even. The old rule emphasised every row saving over $2,000, which
// was all four, so the whole table read as emphasised and the one useful
// row was invisible.

const scorpBreakEven = computed(() => {
  const ladder = situation()?.scorpLadder ?? [];
  return ladder.findIndex(r => r.ficaSavings > SCORP_OVERHEAD);
});

const maxScorpSaving = computed(() =>
  Math.max(0, ...(situation()?.scorpLadder ?? []).map(r => r.ficaSavings)),
);

bindTable<ScorpRow>(
  'scorp-rows',
  {
    caption: 'FICA at each rung of self-employed net profit.',
    emptyMessage: 'No ladder available.',
    skeletonRows: 4,
    rowVariant: (_r, i) => (i === scorpBreakEven() ? 'emphasis' : undefined),
    columns: [
      {
        key: 'netProfit',
        label: 'SE net / yr',
        identity: true,
        width: '26%',
        cell: (r, i) => identity(usd(r.netProfit), i === scorpBreakEven() ? 'break-even' : ''),
      },
      {
        key: 'soleProp',
        label: 'Sole prop FICA',
        numeric: true,
        width: '24%',
        cell: r => figure(usdOwed(r.soleProp.fica)),
      },
      {
        key: 'scorp',
        label: 'S-Corp FICA',
        numeric: true,
        width: '24%',
        cell: r => figure(usdOwed(r.scorp.fica)),
      },
      {
        key: 'ficaSavings',
        label: 'Saved',
        numeric: true,
        primary: true,
        width: '26%',
        cell: r =>
          figure(usdSigned(r.ficaSavings), {
            ...(r.ficaSavings > SCORP_OVERHEAD ? { tone: 'gain' as const } : {}),
            bar: fraction(r.ficaSavings, maxScorpSaving()),
          }),
      },
    ],
  },
  () =>
    stateOf(
      situation(),
      situationError(),
      s => s.scorpLadder,
      () => void loadSituation(),
    ),
);

// ─── tax levers ──────────────────────────────────────────────

bindText('augusta-income', () => {
  const s = situation();
  return s ? usd(s.augusta.taxFreeIncome) : DASH;
});
bindText('augusta-benefit', () => {
  const s = situation();
  if (!s) return DASH;
  return `${s.augusta.rentalDays} days × ${usd(s.augusta.dailyRate)} · ${usd(
    s.augusta.taxBenefit,
  )} benefit`;
});
bindAttr('augusta-benefit', 'data-tone', () => (situation() ? 'gain' : null));

bindText('ctc-current', () => {
  const s = situation();
  return s ? usd(s.ctc.currentAnnual) : DASH;
});
bindText('ctc-status', () => {
  const s = situation();
  if (!s) return DASH;
  const full = s.ctc.baseCredit * s.ctc.kids;
  if (s.ctc.currentAnnual === full) return `full · ${s.ctc.kids} × ${usd(s.ctc.baseCredit)}`;
  if (s.ctc.currentAnnual === 0) return 'fully phased out';
  return `reduced from ${usd(full)}`;
});
bindAttr('ctc-status', 'data-tone', () => {
  const s = situation();
  if (!s) return null;
  const full = s.ctc.baseCredit * s.ctc.kids;
  if (s.ctc.currentAnnual === full) return 'gain';
  return s.ctc.currentAnnual === 0 ? 'loss' : 'caution';
});

bindText('salt-current', () => {
  const s = situation();
  return s ? usd(s.salt.currentAnnual) : DASH;
});
bindText('salt-status', () => {
  const s = situation();
  if (!s) return DASH;
  return s.salt.currentAnnual === s.salt.cap2026Base
    ? `full cap · ${usd(s.salt.cap2026Base)}`
    : `reduced from ${usd(s.salt.cap2026Base)}`;
});
bindAttr('salt-status', 'data-tone', () => {
  const s = situation();
  if (!s) return null;
  return s.salt.currentAnnual === s.salt.cap2026Base ? 'gain' : 'caution';
});

// ─── waterfall ───────────────────────────────────────────────
// Every step renders its own sign, so the routing reads as an arithmetic
// with no colour at all. The residual is the one emphasised row.

interface Step {
  label: string;
  detail?: string;
  amount: number;
  /** Signed presentation: deductions render negative. */
  outflow: boolean;
  residual?: boolean;
}

const waterfallSteps = computed<readonly Step[]>(() => {
  const s = scenario();
  if (!s) return [];
  const w = s.waterfall;
  const liabilities = situation()?.situation.liabilities ?? [];
  // A month that does not cover itself has one number that matters more
  // than any other: the size of the hole. It takes the residual emphasis
  // from Discretionary (which is then a meaningless $0.00), so at most one
  // row is ever emphasised.
  const short = w.shortfall > 0;
  return [
    { label: 'Gross in', amount: w.grossIn, outflow: false },
    { label: 'Tax reserve', detail: '33% of SE net', amount: w.taxReserve, outflow: true },
    { label: 'Fixed obligations', amount: w.fixedObligations, outflow: true },
    { label: 'Liquidity floor', detail: '457(b)', amount: w.liquidityReserve, outflow: true },
    ...(short
      ? [
          {
            label: 'Shortfall',
            detail: 'this month does not cover itself',
            amount: w.shortfall,
            outflow: true,
            residual: true,
          },
        ]
      : []),
    {
      label: 'Debt avalanche',
      detail: liabilityLabel(w.debtAvalanche.liabilityId, liabilities),
      amount: w.debtAvalanche.amount,
      outflow: true,
    },
    { label: 'Discretionary', amount: w.discretionary, outflow: false, residual: !short },
  ];
});

const grossIn = computed(() => scenario()?.waterfall.grossIn ?? 0);

// Bars scale to the largest quantity in the table, not to gross in. In a
// covered month that is gross in; in a short month an outflow can exceed it,
// and scaling to gross in would draw a $5,650 obligation against $1,000 of
// income as the same full bar as one that consumed exactly the income.
const barScale = computed(() =>
  waterfallSteps().reduce((max, step) => Math.max(max, step.amount), grossIn()),
);

bindTable<Step>(
  'waterfall-rows',
  {
    // Read at render time, inside bindTable's effect, so the caption follows
    // the scenario without the primitive having to accept a signal.
    get caption(): string {
      return (scenario()?.waterfall.shortfall ?? 0) > 0
        ? 'One month of income — it does not cover the month.'
        : 'One month of income, routed.';
    },
    emptyMessage: 'Enter an amount above to route a month.',
    skeletonRows: 6,
    rowVariant: step => (step.residual ? 'emphasis' : undefined),
    columns: [
      {
        key: 'label',
        label: 'Step',
        identity: true,
        width: '55%',
        cell: step => identity(step.label, step.detail),
      },
      {
        key: 'amount',
        label: 'Amount',
        numeric: true,
        primary: true,
        width: '45%',
        // 2 dp: one specific transfer is being executed, so cents are the
        // instruction — unlike the ledgers, which sit at treasury scale.
        cell: step =>
          figure(step.outflow ? usdOwed(step.amount, 2) : usd(step.amount, 2), {
            bar: fraction(step.amount, barScale()),
          }),
      },
    ],
  },
  () => {
    if (situationError()) {
      return {
        status: 'error',
        message: situationError() ?? '',
        retry: () => void loadSituation(),
      };
    }
    if (scenario() == null) return { status: 'loading' };
    return { status: 'ready', rows: waterfallSteps() };
  },
);

bindText('wf-threshold', () => {
  const s = scenario();
  if (!s) return DASH;
  return s.nextThreshold.amount === null
    ? 'all crossed'
    : `${s.nextThreshold.name} · ${usd(s.nextThreshold.distance)} away`;
});
bindText('wf-magi', () => (scenario() ? usd(scenario()!.magiProjection) : DASH));

// ─── saved scenarios ─────────────────────────────────────────

const savedRows = document.getElementById('saved-rows');

bindTable<SavedScenario>(
  savedRows,
  {
    caption: 'Runs kept for comparison.',
    emptyMessage: 'No saved scenarios yet — run one above and press Save scenario.',
    skeletonRows: 3,
    columns: [
      {
        key: 'createdAt',
        label: 'Saved',
        identity: true,
        width: '22%',
        cell: s => identity(stamp(s.createdAt)),
      },
      {
        key: 'in',
        label: 'SE in / mo',
        numeric: true,
        width: '16%',
        cell: s => figure(usd(s.inputs.greenputMonthlyNet)),
      },
      {
        key: 'avalanche',
        label: 'To avalanche',
        numeric: true,
        width: '16%',
        cell: s => figure(usdOwed(s.result.waterfall.debtAvalanche.amount)),
      },
      {
        key: 'discretionary',
        label: 'Discretionary',
        numeric: true,
        primary: true,
        width: '16%',
        cell: s => figure(usd(s.result.waterfall.discretionary)),
      },
      {
        key: 'threshold',
        label: 'Next threshold',
        width: '18%',
        cell: s =>
          s.result.nextThreshold.amount === null
            ? badge('all crossed', 'warning')
            : text(`${s.result.nextThreshold.name} · ${usd(s.result.nextThreshold.distance)}`),
      },
      {
        key: 'actions',
        label: 'Actions',
        width: '12%',
        // A cell is an HTML string and `bindTable` rewrites the container on
        // every run, so no listener can live here — the row id rides on a
        // data attribute and one delegated click handler below picks it up.
        cell: s =>
          renderButton('Delete', {
            variant: 'destructive',
            size: 'sm',
            attrs: `data-delete-scenario="${escapeAttr(String(s.id))}" aria-label="Delete scenario saved ${escapeAttr(stamp(s.createdAt))}"`,
          }),
      },
    ],
  },
  () => {
    if (savedError()) {
      return { status: 'error', message: savedError() ?? '', retry: () => void loadSaved() };
    }
    if (!savedLoaded()) return { status: 'loading' };
    return { status: 'ready', rows: savedScenarios() };
  },
);

// Attached once, outside any effect: the table's markup is replaced on every
// render, but the container it lives in is not.
savedRows?.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>('[data-delete-scenario]');
  if (!button) return;
  const id = Number(button.dataset.deleteScenario);
  if (!Number.isInteger(id)) return;
  void deleteScenario(id, button);
});

async function deleteScenario(id: number, button: HTMLButtonElement): Promise<void> {
  const row = savedScenarios().find(s => s.id === id);
  const ok = await confirmDialog({
    title: 'Delete this scenario?',
    body: row
      ? `The run saved ${stamp(row.createdAt)} (${usd(row.inputs.greenputMonthlyNet)} SE in / mo) will be removed. This cannot be undone.`
      : 'This saved run will be removed. This cannot be undone.',
    confirmLabel: 'Delete',
    cancelLabel: 'Keep',
    destructive: true,
  });
  if (!ok) return;

  button.disabled = true;
  try {
    const res = await apiFetch(`/api/scenarios/${encodeURIComponent(String(id))}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      setStatus(`Couldn't delete scenario (HTTP ${res.status}). Try again.`, 'error');
      return;
    }
    setStatus('Scenario deleted.', 'ok');
    window.setTimeout(() => setStatus(''), 2000);
  } catch (err) {
    const message =
      err instanceof Error
        ? `Couldn't delete scenario: ${err.message}`
        : 'Network error. Try again.';
    setStatus(message, 'error');
  } finally {
    button.disabled = false;
    void loadSaved();
  }
}

// ─── scenario status ─────────────────────────────────────────

bindText('scenario-status', statusMsg);
bindAttr('scenario-status', 'data-state', () => statusState() ?? null);

// ─── connected accounts ──────────────────────────────────────
// Debt balances render negative and net into the totals row, so the table
// foots to an actual position rather than a pile of unsigned magnitudes.

const DEBT_TYPES = new Set(['credit', 'loan']);

function isDebt(a: AccountRow): boolean {
  return DEBT_TYPES.has(a.type);
}

function signedBalance(a: AccountRow): number {
  const v = a.currentBalance ?? 0;
  return isDebt(a) ? -Math.abs(v) : v;
}

bindText('accounts-cash', () => {
  const d = accountsData();
  return d && d.accounts.length ? usd(d.totals.cash) : DASH;
});
bindText('accounts-credit', () => {
  const d = accountsData();
  return d && d.accounts.length ? usdOwed(d.totals.creditDebt) : DASH;
});
bindText('accounts-loan', () => {
  const d = accountsData();
  return d && d.accounts.length ? usdOwed(d.totals.loanDebt) : DASH;
});
bindText('accounts-meta', () => {
  const d = accountsData();
  if (!d) return DASH;
  return d.accounts.length === 0 ? 'none linked' : `${d.accounts.length} linked`;
});

bindTable<AccountRow>(
  'accounts-rows',
  {
    caption: 'Balances owed render negative and net into the total.',
    emptyMessage: 'No accounts connected yet.',
    emptyAction: { href: '/settings', label: 'Connect a bank via Plaid →' },
    footLabel: 'Net position',
    skeletonRows: 4,
    columns: [
      {
        key: 'name',
        label: 'Account',
        identity: true,
        width: '34%',
        cell: a =>
          identity(
            a.name,
            [a.institution, a.mask ? `····${a.mask}` : null].filter(Boolean).join(' · '),
          ),
      },
      {
        key: 'type',
        label: 'Type',
        width: '22%',
        cell: a =>
          isDebt(a)
            ? badge(a.subtype ?? a.type, 'error')
            : note([a.type, a.subtype].filter(Boolean).join(' / ')),
      },
      {
        key: 'currentBalance',
        label: 'Current',
        numeric: true,
        primary: true,
        width: '22%',
        cell: a =>
          figure(
            a.currentBalance == null ? DASH : usd(signedBalance(a)),
            isDebt(a) ? { tone: 'loss' } : {},
          ),
        foot: rows => figure(usd(rows.reduce((sum, r) => sum + signedBalance(r), 0))),
      },
      {
        key: 'availableBalance',
        label: 'Available',
        numeric: true,
        width: '22%',
        cell: a => figure(a.availableBalance == null ? DASH : usd(a.availableBalance)),
      },
    ],
  },
  () =>
    stateOf(
      accountsData(),
      accountsError(),
      d => d.accounts,
      () => void loadAccounts(),
    ),
);

// ─── live preview (debounced) ────────────────────────────────

const form = document.getElementById('scenario-form');
const seInput = document.getElementById('greenput-input');
const otInput = document.getElementById('onetime-input');

let previewTimer: number | null = null;
function schedulePreview(): void {
  if (previewTimer) window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => {
    void runScenario(false);
  }, 250);
}

/** Mirrors the worker's postScenario cap (worker/src/routes/scenario.ts). */
const MAX_SCENARIO_INPUT = 1_000_000;

/**
 * Parses one scenario input. Blank reads as 0 (the field's empty state, not
 * a mistake); a negative, non-finite, or too-large value is a mistake and
 * returns `null` so the caller can surface it instead of silently clamping
 * to 0 (which used to preview $0.00 for e.g. "-5" with no feedback).
 */
function readAmount(el: Element | null): number | null {
  const raw = (el as HTMLInputElement | null)?.value ?? '';
  if (raw.trim() === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_SCENARIO_INPUT) return null;
  return n;
}

function markInvalid(el: Element | null, invalid: boolean): void {
  if (!(el instanceof HTMLInputElement)) return;
  if (invalid) el.setAttribute('aria-invalid', 'true');
  else el.removeAttribute('aria-invalid');
}

function readInputs(): { greenputMonthlyNet: number; oneTimeIncome: number } | null {
  const greenputMonthlyNet = readAmount(seInput);
  const oneTimeIncome = readAmount(otInput);
  markInvalid(seInput, greenputMonthlyNet === null);
  markInvalid(otInput, oneTimeIncome === null);
  if (greenputMonthlyNet === null || oneTimeIncome === null) return null;
  return { greenputMonthlyNet, oneTimeIncome };
}

async function runScenario(save: boolean): Promise<void> {
  const inputs = readInputs();
  if (!inputs) {
    setStatus(
      `Enter a non-negative amount of at most ${MAX_SCENARIO_INPUT.toLocaleString()}.`,
      'error',
    );
    return;
  }
  const { greenputMonthlyNet, oneTimeIncome } = inputs;
  // Only a deliberate Save persists a row; the debounced preview computes
  // and nothing else (the worker defaults `persist` to false as well).
  const body: Record<string, number | boolean> = { greenputMonthlyNet, persist: save };
  if (oneTimeIncome > 0) body.oneTimeIncome = oneTimeIncome;

  if (save) setStatus('Saving…');

  try {
    const res = await apiFetch('/api/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setStatus(`Couldn't run scenario (HTTP ${res.status}). Try again.`, 'error');
      return;
    }
    const data = (await res.json()) as ScenarioResult;
    scenario.set(data);
    if (save) {
      setStatus('Saved.', 'ok');
      window.setTimeout(() => setStatus(''), 2000);
      void loadSaved();
    }
  } catch (err) {
    const message =
      err instanceof Error ? `Couldn't run scenario: ${err.message}` : 'Network error. Try again.';
    setStatus(message, 'error');
  }
}

async function loadMe(): Promise<void> {
  try {
    const res = await apiFetch('/api/auth/me');
    if (!res.ok) return;
    me.set((await res.json()) as MeResponse);
  } catch {
    /* header keeps its neutral "Signed in" */
  }
}

async function loadSituation(): Promise<void> {
  situationError.set(null);
  try {
    const res = await apiFetch('/api/situation');
    if (!res.ok) throw new Error(await errorMessage(res));
    const data = (await res.json()) as SituationResponse;
    situation.set(data);
  } catch (err) {
    const detail = err instanceof Error ? err.message : '';
    /*
     * The worker's messages are complete sentences that already say what to
     * do — the 409 names the filing statuses it can actually model — so they
     * are shown as written rather than parenthesised behind a generic lead.
     * A bare status code or a network failure is all we have for the rest,
     * and that gets the generic sentence.
     */
    situationError.set(
      /[.!?]$/.test(detail)
        ? detail
        : `Couldn't load your situation${detail ? ` (${detail})` : ''}.`,
    );
  }
}

async function loadSaved(): Promise<void> {
  savedError.set(null);
  try {
    const res = await apiFetch('/api/scenarios');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { scenarios: SavedScenario[] };
    savedScenarios.set(data.scenarios);
  } catch (err) {
    const detail = err instanceof Error ? ` (${err.message})` : '';
    savedError.set(`Couldn't load saved scenarios${detail}.`);
  } finally {
    savedLoaded.set(true);
  }
}

async function loadAccounts(): Promise<void> {
  accountsError.set(null);
  try {
    const res = await apiFetch('/api/plaid/accounts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as AccountsResponse;
    accountsData.set(data);
  } catch (err) {
    const detail = err instanceof Error ? ` (${err.message})` : '';
    accountsError.set(`Couldn't load connected accounts${detail}.`);
  }
}

if (form instanceof HTMLFormElement) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    await withSubmitting(form, () => runScenario(true));
  });
}
if (seInput instanceof HTMLInputElement) seInput.addEventListener('input', schedulePreview);
if (otInput instanceof HTMLInputElement) otInput.addEventListener('input', schedulePreview);

void loadMe();
void loadSituation().then(() => void runScenario(false));
void loadSaved();
void loadAccounts();
