/**
 * The Household, Income sources and Liabilities sections of /settings
 * (PB-025) — the page as it is served, with the partials rendered in — and
 * the form helpers that read and fill them (src/lib/settings-forms.ts).
 *
 * The forms are exercised against the real rendered markup, not a fixture
 * shaped like the reader, so renaming a control in scripts/partials.mjs
 * without updating the reader fails here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// @ts-expect-error — plain ESM build script, no declaration file.
import { renderPartials } from '../scripts/partials.mjs';
import {
  editingId,
  fillHouseholdForm,
  fillIncomeForm,
  fillLiabilityForm,
  fractionToPercent,
  markInvalid,
  percentToFraction,
  readHouseholdForm,
  readIncomeForm,
  readLiabilityForm,
} from '../src/lib/settings-forms.js';

const SRC = resolve(process.cwd(), 'src');

let page = '';
beforeEach(async () => {
  if (!page)
    page = renderPartials(await readFile(resolve(SRC, 'settings.html'), 'utf8'), 'settings.html');
  document.body.innerHTML = new DOMParser().parseFromString(page, 'text/html').body.innerHTML;
});

function form(id: string): HTMLFormElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLFormElement)) throw new Error(`no <form id="${id}">`);
  return el;
}
function set(f: HTMLFormElement, name: string, value: string): void {
  (f.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value = value;
}

const PROFILE = {
  monthlyLivingExpenses: 1200,
  liquidityFloorMonthly: 500,
  kidsCount: 1,
  augustaDays: 10,
  augustaDailyRate: 425.5,
  scorpSalarySplit: 0.6,
};

describe('settings page structure', () => {
  it('has a section for each of household, income sources and liabilities, built like the existing ones', () => {
    for (const [heading, formId, statusId] of [
      ['household-heading', 'household-form', 'household-status'],
      ['income-heading', 'income-form', 'income-status'],
      ['liabilities-heading', 'liability-form', 'liabilities-status'],
    ] as const) {
      const section = document.querySelector(`section[aria-labelledby="${heading}"]`);
      expect(section, heading).not.toBeNull();
      expect(section?.querySelector(`h2#${heading}`), `${heading} h2`).not.toBeNull();
      // Status line lives in the heading, like the Plaid credentials section.
      expect(section?.querySelector(`h2 > output#${statusId}[aria-live]`), statusId).not.toBeNull();
      const f = section?.querySelector(`form#${formId}`);
      expect(f, formId).not.toBeNull();
      expect(f?.getAttribute('novalidate')).not.toBeNull();
      expect(f?.querySelector('button[type="submit"]'), `${formId} submit`).not.toBeNull();
    }
    expect(page).not.toContain('<!--bn:');
  });

  it('puts the person’s own numbers before the integrations', () => {
    const headings = [...document.querySelectorAll('main > section > h2')].map(h =>
      h.firstChild?.textContent?.trim(),
    );
    expect(headings.slice(0, 3)).toEqual(['Household', 'Income sources', 'Liabilities']);
    expect(headings).toContain('Plaid credentials');
  });

  it('the income and liability forms carry a hidden id so one form adds and edits', () => {
    for (const id of ['income-form', 'liability-form']) {
      const hidden = form(id).elements.namedItem('id');
      expect(hidden, id).toBeInstanceOf(HTMLInputElement);
      expect((hidden as HTMLInputElement).type).toBe('hidden');
      expect(editingId(form(id))).toBeNull();
    }
  });

  it('labels every control in the three forms', () => {
    for (const id of ['household-form', 'income-form', 'liability-form']) {
      for (const el of form(id).querySelectorAll('input:not([type="hidden"]), select')) {
        expect(document.querySelector(`label[for="${el.id}"]`), `${id} / ${el.id}`).not.toBeNull();
      }
    }
  });
});

describe('household form', () => {
  it('round-trips a profile, showing the salary split as a percent', () => {
    const f = form('household-form');
    fillHouseholdForm(f, PROFILE);
    expect((f.elements.namedItem('scorpSalarySplitPercent') as HTMLInputElement).value).toBe('60');
    expect((f.elements.namedItem('monthlyLivingExpenses') as HTMLInputElement).value).toBe('1200');
    const read = readHouseholdForm(f);
    expect(read).toEqual({ ok: true, body: PROFILE });
  });

  it('refuses a blank required field by its visible label', () => {
    const f = form('household-form');
    fillHouseholdForm(f, PROFILE);
    set(f, 'kidsCount', '');
    const read = readHouseholdForm(f);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.field).toBe('kidsCount');
      expect(read.message).toBe('Children is required.');
    }
  });

  it('holds each control to its own min/max/step — the worker’s bounds', () => {
    const f = form('household-form');
    const cases: Array<[string, string, RegExp]> = [
      [
        'monthlyLivingExpenses',
        '-1',
        /Monthly living expenses must be a number between 0 and 1,000,000\./,
      ],
      ['monthlyLivingExpenses', '1000001', /between 0 and 1,000,000/],
      ['kidsCount', '1.5', /Children must be a whole number between 0 and 20\./],
      ['augustaDays', '15', /Augusta rule days must be a whole number between 0 and 14\./],
      [
        'scorpSalarySplitPercent',
        '150',
        /S-Corp salary share \(%\) must be a whole number between 0 and 100\./,
      ],
      // A number input sanitises non-numeric text to '', so it reads as blank.
      ['augustaDailyRate', 'abc', /Augusta daily rate is required\./],
    ];
    for (const [name, value, message] of cases) {
      fillHouseholdForm(f, PROFILE);
      set(f, name, value);
      const read = readHouseholdForm(f);
      expect(read.ok, `${name}=${value}`).toBe(false);
      if (!read.ok) {
        expect(read.field).toBe(name);
        expect(read.message).toMatch(message);
      }
    }
  });

  it('marks the control a worker error names, translating the stored name to the entered one', () => {
    const f = form('household-form');
    const el = markInvalid(f, 'scorpSalarySplit');
    expect(el?.id).toBe('household-scorp-split');
    expect(el?.getAttribute('aria-invalid')).toBe('true');
    expect(markInvalid(f, null)).toBeNull();
    expect(f.querySelector('[aria-invalid]')).toBeNull();
  });
});

describe('percent ↔ fraction', () => {
  it('converts without float noise in either direction', () => {
    expect(fractionToPercent(0.0899)).toBe(8.99);
    expect(fractionToPercent(0.07)).toBe(7);
    expect(percentToFraction(8.99)).toBe(0.0899);
    expect(percentToFraction(24)).toBe(0.24);
    expect(percentToFraction(percentToFraction(50) * 100)).toBe(0.5);
  });
});

describe('income form', () => {
  const ROW = {
    id: 7,
    userId: 1,
    label: 'Consulting',
    type: 'se' as const,
    grossAnnual: 40000,
    employer: null,
    has401kMatch: false,
  };

  it('reads an add: blank employer is null, the 401(k) select is a boolean', () => {
    const f = form('income-form');
    set(f, 'label', '  Consulting ');
    set(f, 'type', 'se');
    set(f, 'grossAnnual', '40000');
    set(f, 'has401kMatch', '1');
    expect(readIncomeForm(f)).toEqual({
      ok: true,
      body: {
        label: 'Consulting',
        type: 'se',
        grossAnnual: 40000,
        employer: null,
        has401kMatch: true,
      },
    });
    expect(editingId(f)).toBeNull();
  });

  it('fills a row for editing and resets to add mode with null', () => {
    const f = form('income-form');
    fillIncomeForm(f, { ...ROW, employer: 'Acme', has401kMatch: true });
    expect(editingId(f)).toBe(7);
    expect(readIncomeForm(f)).toEqual({
      ok: true,
      body: {
        label: 'Consulting',
        type: 'se',
        grossAnnual: 40000,
        employer: 'Acme',
        has401kMatch: true,
      },
    });
    fillIncomeForm(f, null);
    expect(editingId(f)).toBeNull();
    expect((f.elements.namedItem('label') as HTMLInputElement).value).toBe('');
  });

  it('requires a label and a gross figure', () => {
    const f = form('income-form');
    const blank = readIncomeForm(f);
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.message).toBe('Source is required.');
    set(f, 'label', 'x');
    const noGross = readIncomeForm(f);
    expect(noGross.ok).toBe(false);
    if (!noGross.ok) expect(noGross.field).toBe('grossAnnual');
  });
});

describe('liability form', () => {
  const ROW = {
    id: 3,
    userId: 1,
    label: 'Card',
    type: 'cc' as const,
    principal: 4000,
    rateApr: 0.2399,
    minPaymentMonthly: 120,
    priority: 100,
  };

  it('shows the APR as a percent and stores it as a fraction', () => {
    const f = form('liability-form');
    fillLiabilityForm(f, ROW);
    expect((f.elements.namedItem('rateAprPercent') as HTMLInputElement).value).toBe('23.99');
    expect(editingId(f)).toBe(3);
    expect(readLiabilityForm(f)).toEqual({
      ok: true,
      body: {
        label: 'Card',
        type: 'cc',
        principal: 4000,
        rateApr: 0.2399,
        minPaymentMonthly: 120,
        priority: 100,
      },
    });
  });

  it('defaults a new row’s priority to 100 and refuses an APR over 100%', () => {
    const f = form('liability-form');
    fillLiabilityForm(f, null);
    expect((f.elements.namedItem('priority') as HTMLInputElement).value).toBe('100');
    set(f, 'label', 'Loan');
    set(f, 'principal', '1000');
    set(f, 'rateAprPercent', '240');
    set(f, 'minPaymentMonthly', '10');
    const read = readLiabilityForm(f);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.field).toBe('rateAprPercent');
      expect(read.message).toMatch(/APR \(%\) must be a number between 0 and 100\./);
    }
    expect(markInvalid(f, 'rateApr')?.id).toBe('liability-apr');
  });
});
