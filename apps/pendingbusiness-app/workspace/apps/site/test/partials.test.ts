// @vitest-environment node
//
// The page fragments are built by @basenative/components' renderInput /
// renderSelect / renderButton and substituted into the static HTML at build
// time (scripts/partials.mjs, wired into scripts/build.mjs). These tests pin
// the contract that matters to the rest of the app: the ids and names the
// TypeScript views query, the form semantics the browser needs, and the
// accessibility wiring the package gives for free.
import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
// @ts-expect-error — plain ESM build script, no declaration file.
import { PARTIALS, renderPartials } from '../scripts/partials.mjs';
import {
  FILING_LABELS,
  FILING_STATUSES,
  INCOME_TYPES,
  INCOME_TYPE_LABELS,
  LIABILITY_TYPES,
  LIABILITY_TYPE_LABELS,
  MODELLED_FILING_STATUSES,
} from '@pendingbusiness/core';

const partials = PARTIALS as Record<string, string>;
const SRC = resolve(process.cwd(), 'src');

describe('partial substitution', () => {
  it('replaces a known marker and leaves the rest of the page alone', () => {
    const out = renderPartials('<form id="x"><!--bn:logout-button--></form>') as string;
    expect(out.startsWith('<form id="x">')).toBe(true);
    expect(out).toContain('data-bn="button"');
    expect(out).not.toContain('<!--bn:');
  });

  it('fails the build on an unknown marker instead of emitting an empty page', () => {
    expect(() => renderPartials('<!--bn:nope-->', 'x.html')).toThrow(/unknown partial "nope"/);
  });

  it('every marker used by a page has a partial, and every partial is used', async () => {
    const pages = (await readdir(SRC)).filter(f => f.endsWith('.html'));
    const used = new Set<string>();
    for (const page of pages) {
      const html = await readFile(resolve(SRC, page), 'utf8');
      for (const m of html.matchAll(/<!--bn:([a-z-]+)-->/g)) used.add(m[1]!);
    }
    for (const name of used) expect(Object.keys(partials)).toContain(name);
    for (const name of Object.keys(partials)) expect([...used]).toContain(name);
  });
});

describe('form fields', () => {
  it('keeps every id and name the views query', () => {
    const all = Object.values(partials).join('');
    for (const id of [
      'login-handle',
      'enroll-handle',
      'onboarding-email',
      'onboarding-filing-status',
      'onboarding-state',
      'plaid-client-id',
      'plaid-secret',
      'plaid-env',
      'greenput-input',
      'onetime-input',
      'scenario-save',
      'btn-logout',
      'btn-connect',
      'btn-sync',
      'household-living-expenses',
      'household-liquidity-floor',
      'household-kids',
      'household-augusta-days',
      'household-augusta-rate',
      'household-scorp-split',
      'household-save',
      'income-label',
      'income-type',
      'income-gross',
      'income-employer',
      'income-401k',
      'income-save',
      'income-cancel',
      'liability-label',
      'liability-type',
      'liability-principal',
      'liability-apr',
      'liability-min-payment',
      'liability-priority',
      'liability-save',
      'liability-cancel',
    ]) {
      expect(all).toContain(`id="${id}"`);
    }
    for (const name of [
      'handle',
      'email',
      'filingStatus',
      'state',
      'clientId',
      'secret',
      'env',
      'greenputMonthlyNet',
      'oneTimeIncome',
      'monthlyLivingExpenses',
      'liquidityFloorMonthly',
      'kidsCount',
      'augustaDays',
      'augustaDailyRate',
      'scorpSalarySplitPercent',
      'label',
      'type',
      'grossAnnual',
      'employer',
      'has401kMatch',
      'principal',
      'rateAprPercent',
      'minPaymentMonthly',
      'priority',
    ]) {
      expect(all).toContain(`name="${name}"`);
    }
  });

  it('labels every control — renderInput/renderSelect emit <label for>', () => {
    const all = Object.values(partials).join('');
    for (const m of all.matchAll(/<input data-bn="input"[^>]*\bid="([^"]+)"/g)) {
      expect(all).toContain(`<label for="${m[1]}">`);
    }
    for (const m of all.matchAll(/<select data-bn="select"[^>]*\bid="([^"]+)"/g)) {
      expect(all).toContain(`<label for="${m[1]}">`);
    }
  });

  it('keeps the browser-behaviour attributes the hand-written markup carried', () => {
    expect(partials['login-fields']).toContain('autocomplete="username webauthn"');
    expect(partials['login-fields']).toContain('pattern="[a-z0-9_-]{2,24}"');
    // Not `required` on login: the handle is optional for usernameless flows.
    expect(partials['login-fields']).not.toMatch(/<input[^>]*\srequired/);
    expect(partials['passkey-fields']).toMatch(/<input[^>]*\srequired/);
    // Chrome autofills a saved site password into Plaid's secret without this.
    expect(partials['plaid-creds-fields']).toContain('autocomplete="new-password"');
    expect(partials['plaid-creds-fields']).toContain('type="password"');
    // Both amount fields ask for a numeric keypad; which of the two hints is
    // used is a design call (cents are legal here), so assert the property.
    for (const m of partials['scenario-fields']!.matchAll(/<input[^>]*>/g)) {
      expect(m[0]).toMatch(/inputmode="(numeric|decimal)"/);
    }
    expect(partials['onboarding-fields']).toContain('pattern="[A-Za-z]{2}"');
  });

  /*
   * Presentation hints the visual language needs and no renderer option
   * carries, so they ride on the control through `attrs`. styles.test.ts
   * checks the other half — that the stylesheet declares a rule for each.
   */
  it('carries a width hint on every control whose width is not the default', () => {
    for (const [name, id] of [
      ['login-fields', 'login-handle'],
      ['passkey-fields', 'enroll-handle'],
      ['onboarding-fields', 'onboarding-state'],
      ['plaid-creds-fields', 'plaid-client-id'],
    ] as const) {
      const control = new RegExp(`<(?:input|select)[^>]*\\bid="${id}"[^>]*>`).exec(partials[name]!);
      expect(control?.[0], `${name} / ${id}`).toMatch(/data-field="(xs|sm|md|lg)"/);
    }
  });

  it('marks both scenario amounts as currency so the $ adornment is drawn', () => {
    const money = [...partials['scenario-fields']!.matchAll(/<input[^>]*data-money[^>]*>/g)];
    expect(money).toHaveLength(2);
  });

  it('wires the field hints through helpText, so aria-describedby points at them', () => {
    for (const [name, id] of [
      ['login-fields', 'login-handle'],
      ['passkey-fields', 'enroll-handle'],
      ['plaid-creds-fields', 'plaid-env'],
      ['onboarding-fields', 'onboarding-filing-status'],
    ] as const) {
      expect(partials[name], name).toContain(`<span data-bn="field-help" id="${id}-help">`);
      expect(partials[name], name).toContain(`aria-describedby="${id}-help"`);
    }
  });

  /*
   * The test this replaces asserted the select contained all five codes
   * `users.filing_status` accepts. That is what the select did contain, and
   * it was the bug: brackets-2026.ts carries `mfj` and nothing else, so four
   * of those five choices led to a dashboard computed from someone else's
   * brackets. Pinning the list recorded the defect instead of catching it.
   *
   * The property that actually matters is that the set offered equals the set
   * the engine can compute — asserted in both directions against
   * MODELLED_FILING_STATUSES, which core derives from the bracket tables
   * rather than declaring. Publish 2026 brackets for another status and this
   * fails until the option is added; add an option with no brackets behind it
   * and this fails too.
   */
  it('offers exactly the filing statuses the tax engine has brackets for', () => {
    const select = partials['onboarding-fields']!;
    const offered = [...select.matchAll(/<option value="([^"]*)"/g)]
      .map(m => m[1]!)
      .filter(v => v !== '');

    expect(new Set(offered)).toEqual(new Set(MODELLED_FILING_STATUSES));
    expect(offered, 'no duplicate options').toHaveLength(new Set(offered).size);
  });

  it('never offers a status the DB would reject', () => {
    const select = partials['onboarding-fields']!;
    const offered = [...select.matchAll(/<option value="([^"]*)"/g)]
      .map(m => m[1]!)
      .filter(v => v !== '');
    for (const value of offered) {
      expect(FILING_STATUSES, `${value} must satisfy the filing_status CHECK`).toContain(value);
    }
  });

  it('labels each offered status with the shared label, not a local copy', () => {
    const select = partials['onboarding-fields']!;
    for (const status of MODELLED_FILING_STATUSES) {
      expect(select).toContain(`>${FILING_LABELS[status]}</option>`);
    }
  });

  it('keeps the placeholder, and says why the list is short', () => {
    const select = partials['onboarding-fields']!;
    expect(select).toMatch(/<option value="" disabled selected>Choose…<\/option>/);
    // A one-item select with no explanation reads as a broken form.
    expect(select).toMatch(/aria-describedby="onboarding-filing-status-help"/);
    expect(select).toMatch(/id="onboarding-filing-status-help"/);
  });

  it('gives every form exactly one submit button', () => {
    for (const name of [
      'login-fields',
      'passkey-fields',
      'onboarding-fields',
      'plaid-creds-fields',
      'scenario-fields',
      'household-fields',
      'income-fields',
      'liability-fields',
    ]) {
      const submits = [...partials[name]!.matchAll(/type="submit"/g)];
      expect(submits, name).toHaveLength(1);
    }
  });

  it('keeps the connect button disabled until credentials are configured', () => {
    expect(partials['connect-buttons']).toMatch(
      /id="btn-connect"[^>]*disabled|disabled[^>]*id="btn-connect"/,
    );
  });

  it('keeps the logout button hidden until the session resolves', () => {
    expect(partials['logout-button']).toContain('hidden');
  });

  /*
   * PB-025. The household form is the only place the six users.* columns
   * from 0006_household_profile.sql can be entered, and its bounds are the
   * worker's bounds (routes/household.ts HOUSEHOLD_BOUNDS) as `min`/`max`/
   * `step` on the controls — src/lib/settings-forms.ts validates from those
   * attributes, so these are the numbers a person is held to before a 400.
   */
  it('household controls carry the worker’s bounds', () => {
    const html = partials['household-fields']!;
    const control = (id: string) =>
      new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0] ?? '';
    for (const id of [
      'household-living-expenses',
      'household-liquidity-floor',
      'household-augusta-rate',
    ]) {
      expect(control(id), id).toMatch(/min="0"/);
      expect(control(id), id).toMatch(/max="1000000"/);
      expect(control(id), id).toContain('data-money');
    }
    expect(control('household-kids')).toMatch(/min="0" max="20" step="1"/);
    expect(control('household-augusta-days')).toMatch(/min="0" max="14" step="1"/);
    // Entered as a percent; stored as a fraction 0–1.
    expect(control('household-scorp-split')).toMatch(/min="0" max="100" step="1"/);
    for (const m of html.matchAll(/<input[^>]*>/g)) {
      expect(m[0]).toMatch(/type="number"/);
      expect(m[0]).toMatch(/\srequired/);
    }
  });

  it('offers exactly the income and liability types the DB permits, labelled as the dashboard labels them', () => {
    const offered = (name: string, select: string) =>
      [
        ...(
          new RegExp(`<select[^>]*\\bid="${select}"[\\s\\S]*?</select>`).exec(
            partials[name]!,
          )?.[0] ?? ''
        ).matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g),
      ].map(m => [m[1]!, m[2]!] as const);

    const income = offered('income-fields', 'income-type');
    expect(new Set(income.map(([v]) => v))).toEqual(new Set(INCOME_TYPES));
    for (const [value, label] of income) {
      expect(label).toBe(INCOME_TYPE_LABELS[value as keyof typeof INCOME_TYPE_LABELS]);
    }

    const liability = offered('liability-fields', 'liability-type');
    expect(new Set(liability.map(([v]) => v))).toEqual(new Set(LIABILITY_TYPES));
    for (const [value, label] of liability) {
      expect(label).toBe(LIABILITY_TYPE_LABELS[value as keyof typeof LIABILITY_TYPE_LABELS]);
    }
  });

  it('keeps the cancel-edit buttons hidden until a row is being edited, and off the submit path', () => {
    for (const name of ['income-fields', 'liability-fields']) {
      const cancel = /<button[^>]*id="(?:income|liability)-cancel"[^>]*>/.exec(
        partials[name]!,
      )?.[0];
      expect(cancel, name).toBeDefined();
      expect(cancel).toContain('hidden');
      expect(cancel).toContain('type="button"');
    }
  });
});
