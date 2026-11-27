/**
 * Server-rendered page fragments, built from `@basenative/components`.
 *
 * The site's pages are static HTML copied into `dist/site`. Nothing in that
 * pipeline could call a renderer, so every form field and every button was
 * hand-written markup — `<label><span>Email</span><input type="email"></label>`
 * repeated five times — while `renderInput`, `renderSelect` and `renderButton`
 * sat unused in a package the app already depends on. Each of those helpers
 * escapes every attribute and every label it emits, wires `aria-describedby`
 * to its own help/error ids, and keeps one field shape across the whole site.
 *
 * `scripts/build.mjs` substitutes each entry here for its `<!--bn:name-->`
 * marker as the HTML is written out, so this is a render step, not a
 * framework: the `<form>` elements, their ids and every event handler stay
 * exactly where they were.
 *
 * Two presentation hints ride along on the controls, through `attrs`, because
 * the visual language needs them and no renderer option carries them:
 *
 *   data-field="xs|sm|md|lg"  the field's width. A field's width is
 *                             information — a two-letter state field is 6rem,
 *                             not 640px (visual-language §5.7).
 *   data-money                this control holds an amount, so the stylesheet
 *                             draws its `$` and caps its width.
 *
 * Both are read by `src/styles.css`, both stay on the control the package
 * rendered, and neither replaces any part of the package's markup. `data-money`
 * exists only because renderInput has no adornment slot; it goes away the day
 * one lands upstream.
 */
import { renderButton, renderInput, renderSelect } from '@basenative/components';

/**
 * Only the filing statuses the tax engine has 2026 brackets for.
 *
 * This select used to offer all five codes `users.filing_status` accepts,
 * while brackets-2026.ts and 0002_seed_warren.sql carried `mfj` and nothing
 * else — so four of the five choices led to a dashboard computed from
 * somebody else's brackets. Offering a choice the engine cannot honour is the
 * defect; the honest fix is to offer the one it can and say why, not to
 * invent four sets of tax tables.
 *
 * `@pendingbusiness/core` derives MODELLED_FILING_STATUSES from the bracket
 * tables themselves, and test/partials.test.ts asserts this list equals it —
 * so seeding brackets for another status fails the build until it is offered
 * here, and vice versa. Kept as a literal because this is a plain .mjs build
 * script and core is TypeScript; the test is what keeps the two in step.
 */
const FILING_STATUSES = [{ value: 'mfj', label: 'Married filing jointly' }];

/**
 * Storage vocabularies for income_sources.type and liabilities.type, with the
 * labels the dashboard uses. Literals for the same reason as FILING_STATUSES
 * above; test/partials.test.ts asserts each equals core's INCOME_TYPES /
 * LIABILITY_TYPES and their label maps, which schema-drift.test.ts in turn
 * ties to the CHECK constraints in migrations/0001_init.sql.
 */
const INCOME_TYPES = [
  { value: 'w2', label: 'W-2' },
  { value: 'se', label: 'Self-employed' },
  { value: 'k1', label: 'K-1' },
  { value: 'other', label: 'Other' },
];
const LIABILITY_TYPES = [
  { value: 'personal_loan', label: 'Personal loan' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'student', label: 'Student loan' },
  { value: 'cc', label: 'Credit card' },
  { value: 'other', label: 'Other' },
];

/** Bounds mirrored from the worker's write routes (household.ts, income.ts, liabilities.ts). */
const MAX_AMOUNT = 1_000_000;
const MAX_ANNUAL = 10_000_000;
const MAX_KIDS = 20;
const MAX_AUGUSTA_DAYS = 14;
const MAX_PRIORITY = 1_000;

/** Handle field: same pattern and autocomplete on both the login and enrollment forms. */
const handleField = options =>
  renderInput({
    name: 'handle',
    id: options.id,
    label: 'Handle',
    helpText: options.helpText,
    required: options.required,
    attrs:
      'autocomplete="username webauthn" spellcheck="false" pattern="[a-z0-9_-]{2,24}" data-field="sm"',
  });

export const PARTIALS = {
  'login-fields':
    handleField({
      id: 'login-handle',
      helpText: 'Optional — leave blank for usernameless sign-in.',
    }) + renderButton('Sign in with passkey', { variant: 'primary', type: 'submit' }),

  'passkey-fields':
    handleField({
      id: 'enroll-handle',
      helpText: '2–24 characters: a–z, 0–9, underscore or hyphen.',
      required: true,
    }) + renderButton('Set up passkey', { variant: 'primary', type: 'submit' }),

  'logout-button': renderButton('Log out', {
    variant: 'secondary',
    attrs: 'id="btn-logout" hidden',
  }),

  'onboarding-fields':
    renderInput({
      name: 'email',
      id: 'onboarding-email',
      type: 'email',
      label: 'Email',
      required: true,
      attrs: 'autocomplete="email" spellcheck="false" data-field="md"',
    }) +
    renderSelect({
      name: 'filingStatus',
      id: 'onboarding-filing-status',
      label: 'Filing status',
      placeholder: 'Choose…',
      required: true,
      items: FILING_STATUSES,
      helpText:
        'Only married filing jointly is modelled for 2026 so far — the other statuses need their own federal and California bracket tables before PendingBusiness can project anything for them.',
      attrs: 'data-field="md"',
    }) +
    renderInput({
      name: 'state',
      id: 'onboarding-state',
      label: 'State',
      placeholder: 'CA',
      required: true,
      attrs:
        'autocomplete="address-level1" minlength="2" maxlength="2" pattern="[A-Za-z]{2}" spellcheck="false" data-field="xs"',
    }) +
    renderButton('Continue to dashboard', { variant: 'primary', type: 'submit' }),

  'plaid-creds-fields':
    renderInput({
      name: 'clientId',
      id: 'plaid-client-id',
      label: 'Client ID',
      required: true,
      attrs: 'autocomplete="off" spellcheck="false" data-field="lg"',
    }) +
    /*
     * autocomplete="new-password" defeats Chrome's tendency to autofill the
     * user's saved pendingbusiness.com password into Plaid's secret field.
     * See git blame for the original bug.
     */
    renderInput({
      name: 'secret',
      id: 'plaid-secret',
      type: 'password',
      label: 'Secret',
      required: true,
      attrs: 'autocomplete="new-password" spellcheck="false" data-field="lg"',
    }) +
    renderSelect({
      name: 'env',
      id: 'plaid-env',
      label: 'Environment',
      helpText: 'Sandbox for testing; production connects real accounts.',
      items: [
        { value: 'sandbox', label: 'Sandbox' },
        { value: 'production', label: 'Production' },
      ],
      selected: 'sandbox',
      attrs: 'data-field="sm"',
    }) +
    renderButton('Save credentials', { variant: 'primary', type: 'submit' }),

  'connect-buttons':
    renderButton('Connect bank account…', {
      variant: 'primary',
      attrs: 'id="btn-connect" disabled',
    }) + renderButton('Sync balances', { variant: 'secondary', attrs: 'id="btn-sync"' }),

  /*
   * Household profile — the six users.* columns from
   * migrations/0006_household_profile.sql, edited on /settings. Amounts are
   * dollars per month; the salary split is entered as a percent and
   * converted to the stored fraction in src/lib/settings-forms.ts.
   */
  'household-fields':
    renderInput({
      name: 'monthlyLivingExpenses',
      id: 'household-living-expenses',
      type: 'number',
      label: 'Monthly living expenses',
      helpText:
        'Rent, utilities, insurance, groceries — everything that leaves before debt and spending. Minimum debt payments are added from Liabilities; do not count them here.',
      required: true,
      attrs: `min="0" max="${MAX_AMOUNT}" step="0.01" inputmode="decimal" data-money`,
    }) +
    renderInput({
      name: 'liquidityFloorMonthly',
      id: 'household-liquidity-floor',
      type: 'number',
      label: 'Liquidity floor, monthly',
      helpText: 'Set aside every month before anything is routed to debt.',
      required: true,
      attrs: `min="0" max="${MAX_AMOUNT}" step="0.01" inputmode="decimal" data-money`,
    }) +
    renderInput({
      name: 'kidsCount',
      id: 'household-kids',
      type: 'number',
      label: 'Children',
      helpText: 'Qualifying children for the child tax credit.',
      required: true,
      attrs: `min="0" max="${MAX_KIDS}" step="1" inputmode="numeric" data-field="xs"`,
    }) +
    renderInput({
      name: 'augustaDays',
      id: 'household-augusta-days',
      type: 'number',
      label: 'Augusta rule days',
      helpText: 'Days per year you rent your home to your business. Tax-free up to 14.',
      required: true,
      attrs: `min="0" max="${MAX_AUGUSTA_DAYS}" step="1" inputmode="numeric" data-field="xs"`,
    }) +
    renderInput({
      name: 'augustaDailyRate',
      id: 'household-augusta-rate',
      type: 'number',
      label: 'Augusta daily rate',
      helpText: 'The market rate for a day of that rental.',
      required: true,
      attrs: `min="0" max="${MAX_AMOUNT}" step="0.01" inputmode="decimal" data-money`,
    }) +
    renderInput({
      name: 'scorpSalarySplitPercent',
      id: 'household-scorp-split',
      type: 'number',
      label: 'S-Corp salary share (%)',
      helpText:
        'Share of net profit paid as W-2 salary in the S-Corp comparison; the rest is distributions. 50 is the usual starting point.',
      required: true,
      attrs: 'min="0" max="100" step="1" inputmode="numeric" data-field="xs"',
    }) +
    renderButton('Save household', {
      variant: 'primary',
      type: 'submit',
      attrs: 'id="household-save"',
    }),

  /*
   * One form each for income sources and liabilities. The same form adds a
   * row and edits one: src/settings.ts fills it from the row's Edit button
   * and keeps the id in the hidden input that sits beside the marker.
   */
  'income-fields':
    renderInput({
      name: 'label',
      id: 'income-label',
      label: 'Source',
      required: true,
      attrs: 'maxlength="120" spellcheck="false" data-field="md"',
    }) +
    renderSelect({
      name: 'type',
      id: 'income-type',
      label: 'Type',
      required: true,
      items: INCOME_TYPES,
      selected: 'w2',
      helpText: 'Only W-2 wages count toward projected MAGI on the dashboard.',
      attrs: 'data-field="sm"',
    }) +
    renderInput({
      name: 'grossAnnual',
      id: 'income-gross',
      type: 'number',
      label: 'Gross, annual',
      required: true,
      attrs: `min="0" max="${MAX_ANNUAL}" step="0.01" inputmode="decimal" data-money`,
    }) +
    renderInput({
      name: 'employer',
      id: 'income-employer',
      label: 'Employer',
      helpText: 'Optional.',
      attrs: 'maxlength="120" spellcheck="false" data-field="md"',
    }) +
    renderSelect({
      name: 'has401kMatch',
      id: 'income-401k',
      label: '401(k) match',
      items: [
        { value: '0', label: 'No' },
        { value: '1', label: 'Yes' },
      ],
      selected: '0',
      attrs: 'data-field="xs"',
    }) +
    renderButton('Save income source', {
      variant: 'primary',
      type: 'submit',
      attrs: 'id="income-save"',
    }) +
    renderButton('Cancel edit', {
      variant: 'secondary',
      type: 'button',
      attrs: 'id="income-cancel" hidden',
    }),

  'liability-fields':
    renderInput({
      name: 'label',
      id: 'liability-label',
      label: 'Liability',
      required: true,
      attrs: 'maxlength="120" spellcheck="false" data-field="md"',
    }) +
    renderSelect({
      name: 'type',
      id: 'liability-type',
      label: 'Type',
      required: true,
      items: LIABILITY_TYPES,
      selected: 'cc',
      attrs: 'data-field="sm"',
    }) +
    renderInput({
      name: 'principal',
      id: 'liability-principal',
      type: 'number',
      label: 'Principal',
      required: true,
      attrs: `min="0" max="${MAX_ANNUAL}" step="0.01" inputmode="decimal" data-money`,
    }) +
    renderInput({
      name: 'rateAprPercent',
      id: 'liability-apr',
      type: 'number',
      label: 'APR (%)',
      required: true,
      helpText: 'The avalanche pays the highest APR first.',
      attrs: 'min="0" max="100" step="0.01" inputmode="decimal" data-field="xs"',
    }) +
    renderInput({
      name: 'minPaymentMonthly',
      id: 'liability-min-payment',
      type: 'number',
      label: 'Minimum payment, monthly',
      required: true,
      helpText: 'Counted into fixed obligations on top of living expenses.',
      attrs: `min="0" max="${MAX_AMOUNT}" step="0.01" inputmode="decimal" data-money`,
    }) +
    renderInput({
      name: 'priority',
      id: 'liability-priority',
      type: 'number',
      label: 'Priority',
      value: '100',
      helpText:
        'Rows sort by priority first, then APR. Leave every row at 100 and the order is pure avalanche.',
      attrs: `min="1" max="${MAX_PRIORITY}" step="1" inputmode="numeric" data-field="xs"`,
    }) +
    renderButton('Save liability', {
      variant: 'primary',
      type: 'submit',
      attrs: 'id="liability-save"',
    }) +
    renderButton('Cancel edit', {
      variant: 'secondary',
      type: 'button',
      attrs: 'id="liability-cancel" hidden',
    }),

  'scenario-fields':
    renderInput({
      name: 'greenputMonthlyNet',
      id: 'greenput-input',
      type: 'number',
      label: 'Self\u2011employed net, monthly',
      value: '8000',
      attrs: 'min="0" max="1000000" step="500" inputmode="decimal" data-money',
    }) +
    renderInput({
      name: 'oneTimeIncome',
      id: 'onetime-input',
      type: 'number',
      label: 'One\u2011time income',
      value: '0',
      attrs: 'min="0" max="1000000" step="100" inputmode="decimal" data-money',
    }) +
    renderButton('Save scenario', {
      variant: 'primary',
      type: 'submit',
      attrs: 'id="scenario-save"',
    }),
};

const MARKER = /<!--bn:([a-z-]+)-->/g;

/**
 * Substitute every `<!--bn:name-->` marker in `html`. An unknown name is a
 * build failure rather than a silently empty page.
 */
export function renderPartials(html, file = 'page') {
  return html.replace(MARKER, (_match, name) => {
    const partial = PARTIALS[name];
    if (partial === undefined) {
      throw new Error(`${file}: unknown partial "${name}" — add it to scripts/partials.mjs`);
    }
    return partial;
  });
}
