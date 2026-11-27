import { describe, expect, it } from 'vitest';
import { renderProposalPage } from './proposal.js';

const WORKSPACE = {
  name: 'Reed & Sons HVAC',
  // Stored form is E.164; a pre-formatted fixture would hide a missing
  // formatter because it formats to itself.
  phone: '+15125550142',
  email: 'hello@reed-hvac.example',
};

// Amounts are INTEGER CENTS, the canonical unit (see the MONEY note in
// libs/shared/models/src/wire.ts). `tax_rate` is a percentage.
const ESTIMATE: Record<string, unknown> = {
  title: 'Furnace <replacement>',
  estimate_number: 'EST-0042',
  subtotal: 100000, // $1,000.00
  tax_rate: 8.5,
  tax_amount: 8500, // $85.00
  total: 108500, // $1,085.00
  notes: 'Includes "premium" filter & thermostat',
  valid_until: '2026-10-01',
  status: 'sent',
};

const LINE_ITEMS = [
  {
    type: 'material',
    description: 'Furnace unit <90k BTU>',
    quantity: 1,
    unitPrice: 80000, // $800.00
    total: 80000,
  },
  {
    type: 'labor',
    description: 'Install',
    quantity: 4,
    unitPrice: 5000,
    total: 20000,
  },
];

describe('renderProposalPage escaping contract', () => {
  const html = renderProposalPage(WORKSPACE, ESTIMATE, LINE_ITEMS);

  it('escapes plain values exactly once', () => {
    // Text nodes escape & < > only; quotes are escaped in attributes alone.
    expect(html).toContain(
      '<h1 data-bn="bn-large-title">Furnace &lt;replacement&gt;</h1>',
    );
    expect(html).toContain('data-bn="bn-panel"');
    expect(html).toContain('data-bn="bn-site-footer"');
    expect(html).toContain('<strong>Reed &amp; Sons HVAC</strong>');
    expect(html).toContain('Includes "premium" filter &amp; thermostat');
    expect(html).not.toContain('&amp;amp;');
    expect(html).not.toContain('&amp;lt;');
  });

  it('inserts rendered component markup unescaped', () => {
    expect(html).toContain(
      '<span data-bn="badge" data-variant="primary">SENT</span>',
    );
    expect(html).toContain('<table data-bn="table">');
    expect(html).toContain('<dl data-bn="proposal-totals">');
    expect(html).not.toContain('&lt;table');
    expect(html).not.toContain('[object Object]');
  });

  it('prints the phone number formatted, not as raw E.164 (GP-041)', () => {
    expect(html).toContain(
      '<strong>Reed &amp; Sons HVAC</strong> &middot; (512) 555-0142 &middot;',
    );
    // The shell's tel: href keeps the stored E.164. The reading line does not.
    expect(html).not.toMatch(
      /<strong>Reed &amp; Sons HVAC<\/strong> &middot; \+15125550142/,
    );
  });

  it('prints nothing for the phone when the workspace has none', () => {
    const silent = renderProposalPage(
      { ...WORKSPACE, phone: '' },
      ESTIMATE,
      LINE_ITEMS,
    );
    expect(silent).not.toContain('(512) 555-0142');
    expect(silent).toContain(
      '<strong>Reed &amp; Sons HVAC</strong> &middot;  &middot;',
    );
  });

  it('escapes line-item text inside the table', () => {
    expect(html).toContain(
      '<td data-label="Description">Furnace unit &lt;90k BTU&gt;</td>',
    );
  });

  it('prints cents as dollars — this page is a billing surface', () => {
    expect(html).toContain('$1,000.00'); // subtotal
    expect(html).toContain('$85.00'); // tax
    expect(html).toContain('$1,085.00'); // total
    expect(html).toContain('$800.00'); // line item
    expect(html).toContain('Tax (8.5%)');
    // The failure this guards: the raw column value with a $ in front of it.
    expect(html).not.toContain('$108,500.00');
    expect(html).not.toContain('Tax (0.085%)');
  });

  it('is noindexed — a per-customer link, not a public marketing page', () => {
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
  });
});

/* GP-038. The estimate editor tagged each row labor or material but the wire
   had no field for it, so the tag rode inside the description and the
   homeowner read "[labor] Replace service panel". */
describe('renderProposalPage line item types', () => {
  it('renders a Type column with the human word for each row', () => {
    const html = renderProposalPage(WORKSPACE, ESTIMATE, LINE_ITEMS);
    expect(html).toContain('<th scope="col">Type</th>');
    expect(html).toContain(
      '<td data-label="Description">Furnace unit &lt;90k BTU&gt;</td><td data-label="Type">Materials</td>',
    );
    expect(html).toContain(
      '<td data-label="Description">Install</td><td data-label="Type">Labor</td>',
    );
    // The word, not the enum value.
    expect(html).not.toMatch(/<td[^>]*>(labor|material)<\/td>/);
  });

  it('reads a row stored before the change: no bracket, still typed', () => {
    const html = renderProposalPage(WORKSPACE, ESTIMATE, [
      {
        description: '[labor] Replace service panel',
        quantity: 4,
        unitPrice: 17500,
        total: 70000,
      },
      {
        description: '[material] 200A breaker',
        quantity: 1,
        unitPrice: 45000,
        total: 45000,
      },
    ]);
    expect(html).toContain(
      '<td data-label="Description">Replace service panel</td><td data-label="Type">Labor</td>',
    );
    expect(html).toContain(
      '<td data-label="Description">200A breaker</td><td data-label="Type">Materials</td>',
    );
    expect(html).not.toContain('[labor]');
    expect(html).not.toContain('[material]');
  });

  it('never prints a bracketed type tag, whatever the row looks like', () => {
    for (const items of [
      LINE_ITEMS,
      [
        {
          description: '[labor] Rough-in',
          quantity: 1,
          unitPrice: 1,
          total: 1,
        },
      ],
      [{ description: 'Permit', quantity: 1, unitPrice: 25000, total: 25000 }],
    ]) {
      const html = renderProposalPage(WORKSPACE, ESTIMATE, items);
      expect(html).not.toMatch(/\[(labor|material)\]/);
    }
  });

  it('calls an untagged legacy row Labor', () => {
    const html = renderProposalPage(WORKSPACE, ESTIMATE, [
      { description: 'Permit', quantity: 1, unitPrice: 25000, total: 25000 },
    ]);
    expect(html).toContain(
      '<td data-label="Description">Permit</td><td data-label="Type">Labor</td>',
    );
  });
});
