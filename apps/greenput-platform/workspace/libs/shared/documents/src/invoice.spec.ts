import { describe, it, expect } from 'vitest';
import { generatedIdentityFor } from '@greenput/shared/design';
import {
  generateInvoiceHtml,
  InvoiceData,
  InvoiceJobRow,
  InvoiceLineItemRow,
  InvoiceCustomerRow,
  InvoiceWorkspaceRow,
} from './invoice';

// Every amount below is INTEGER CENTS, the canonical unit (see the MONEY note
// in libs/shared/models/src/wire.ts). These fixtures used to be written in
// dollars, and the assertions below agreed with them, which is how a generator
// that renders the raw column value with a `$` in front of it passed 17 tests
// while printing every real invoice 100x too high.
function makeJob(overrides: Partial<InvoiceJobRow> = {}): InvoiceJobRow {
  return {
    id: 'job-1',
    job_number: '#1001',
    title: 'Panel Upgrade',
    invoiced_at: '2026-03-15T10:00:00Z',
    paid_at: null,
    total: 250000, // $2,500.00
    notes: '',
    street: '123 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    ...overrides,
  };
}

function makeLineItems(): InvoiceLineItemRow[] {
  return [
    {
      id: 'li-1',
      description: '200A Panel',
      quantity: 1,
      unit_price: 180000, // $1,800.00
      total: 180000,
    },
    {
      id: 'li-2',
      description: 'Labor (4 hrs)',
      quantity: 4,
      unit_price: 17500, // $175.00
      total: 70000, // $700.00
    },
  ];
}

function makeCustomer(
  overrides: Partial<InvoiceCustomerRow> = {},
): InvoiceCustomerRow {
  return {
    first_name: 'Jane',
    last_name: 'Doe',
    company: null,
    email: 'jane@example.com',
    phone: '555-0100',
    street: '456 Oak Ave',
    city: 'Austin',
    state: 'TX',
    zip: '78702',
    ...overrides,
  };
}

function makeWorkspace(
  overrides: Partial<InvoiceWorkspaceRow> = {},
): InvoiceWorkspaceRow {
  return {
    name: 'Spark Electric LLC',
    slug: 'spark-electric',
    phone: '555-0200',
    email: 'info@spark.com',
    street: '789 Industrial Dr',
    city: 'Austin',
    state: 'TX',
    zip: '78703',
    license_num: 'ELEC-12345',
    logo_url: null,
    ...overrides,
  };
}

function makeInvoiceData(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    job: makeJob(),
    lineItems: makeLineItems(),
    customer: makeCustomer(),
    workspace: makeWorkspace(),
    ...overrides,
  };
}

describe('generateInvoiceHtml', () => {
  it('returns a complete HTML document', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('includes workspace name and contact info', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    expect(html).toContain('Spark Electric LLC');
    expect(html).toContain('555-0200');
    expect(html).toContain('info@spark.com');
  });

  it('includes license number when present', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    expect(html).toContain('ELEC-12345');
  });

  it('omits license section when license_num is null', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({ workspace: makeWorkspace({ license_num: null }) }),
    );
    expect(html).not.toContain('License:');
  });

  it('renders logo image when logo_url is provided', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({
        workspace: makeWorkspace({ logo_url: 'https://example.com/logo.png' }),
      }),
    );
    expect(html).toContain('<img');
    expect(html).toContain('https://example.com/logo.png');
  });

  it('draws the generated mark, not just text, when logo_url is null', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    const identity = generatedIdentityFor({
      name: 'Spark Electric LLC',
      slug: 'spark-electric',
    });
    // No <img>: the mark is inline SVG, so an invoice rendered offline or
    // attached to an email still carries it.
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
    expect(html).toContain(`fill="${identity.variant.bg}"`);
    expect(html).toContain(`>${identity.initials}</text>`);
    expect(html).toContain('Spark Electric LLC');
  });

  it('seeds the mark on the slug, the way every other surface does', () => {
    // An invoice that did not carry the slug would seed on the name and could
    // print a different tile from the same contractor's own micro-site. This
    // pair is chosen because name-seeding and slug-seeding land in different
    // buckets for it, so the assertion can tell the two apart.
    const workspace = makeWorkspace({ slug: 'spark-electric-llc' });
    const bySlug = generatedIdentityFor({
      name: workspace.name,
      slug: workspace.slug,
    });
    const byName = generatedIdentityFor({ name: workspace.name });
    expect(bySlug.variant.bg).not.toBe(byName.variant.bg);

    const html = generateInvoiceHtml(makeInvoiceData({ workspace }));
    expect(html).toContain(`fill="${bySlug.variant.bg}"`);
    expect(html).not.toContain(`fill="${byName.variant.bg}"`);
  });

  it('still degrades to a plain name for a workspace with no slug', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({ workspace: makeWorkspace({ slug: null }) }),
    );
    expect(html).toContain('<svg');
    expect(html).toContain('Spark Electric LLC');
  });

  it('escapes a hostile business name in the mark block', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({
        workspace: makeWorkspace({ name: '"><script>alert(1)</script>' }),
      }),
    );
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes customer name and contact', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    expect(html).toContain('Jane');
    expect(html).toContain('Doe');
    expect(html).toContain('jane@example.com');
    expect(html).toContain('555-0100');
  });

  it('includes company name when present', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({
        customer: makeCustomer({ company: 'Doe Enterprises' }),
      }),
    );
    expect(html).toContain('Doe Enterprises');
  });

  it('includes job number and title', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    expect(html).toContain('#1001');
    expect(html).toContain('Panel Upgrade');
  });

  it('renders line items with descriptions and amounts', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    expect(html).toContain('200A Panel');
    expect(html).toContain('Labor (4 hrs)');
    expect(html).toContain('$1,800.00');
    expect(html).toContain('$700.00');
  });

  it('shows correct subtotal from line items', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    // Subtotal = 180000c + 70000c = 250000c = $2,500.00
    expect(html).toContain('$2,500.00');
  });

  it('shows grand total from job.total', () => {
    const data = makeInvoiceData({ job: makeJob({ total: 300000 }) });
    const html = generateInvoiceHtml(data);
    expect(html).toContain('$3,000.00');
  });

  // The regression guard for the unit itself: a cents value must never be
  // printed as if it were dollars.
  it('prints cents as dollars, not as the raw number', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({ job: makeJob({ total: 265213 }) }),
    );
    expect(html).toContain('$2,652.13');
    expect(html).not.toContain('$265,213.00');
  });

  it('renders a half-dollar amount exactly', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({
        lineItems: [
          {
            id: 'li-1',
            description: 'Permit',
            quantity: 1,
            unit_price: 50,
            total: 50,
          },
        ],
      }),
    );
    expect(html).toContain('$0.50');
  });

  it('handles empty line items gracefully', () => {
    const html = generateInvoiceHtml(makeInvoiceData({ lineItems: [] }));
    expect(html).toContain('No line items');
  });

  it('shows PAID stamp when paid_at is set', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({ job: makeJob({ paid_at: '2026-03-18T14:00:00Z' }) }),
    );
    expect(html).toContain('PAID');
  });

  it('does not show PAID stamp when not paid', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    expect(html).not.toContain('PAID');
  });

  it('includes notes when present', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({ job: makeJob({ notes: 'Please pay promptly.' }) }),
    );
    expect(html).toContain('Please pay promptly.');
  });

  it('omits notes section when notes are empty', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({ job: makeJob({ notes: '' }) }),
    );
    // The notes section heading should not appear
    expect(html).not.toContain('Notes</div>');
  });

  it('includes payment terms footer', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    expect(html).toContain('Payment is due within 30 days');
  });

  it('includes print button', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    expect(html).toContain('window.print()');
    expect(html).toContain('Print / Save as PDF');
  });

  it('escapes HTML entities in user-provided strings', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({
        customer: makeCustomer({ first_name: '<script>alert("xss")</script>' }),
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('formats invoice date correctly', () => {
    const html = generateInvoiceHtml(makeInvoiceData());
    // March 15, 2026
    expect(html).toContain('March');
    expect(html).toContain('2026');
  });

  it('shows dash for missing invoiced_at date', () => {
    const html = generateInvoiceHtml(
      makeInvoiceData({ job: makeJob({ invoiced_at: null }) }),
    );
    expect(html).toContain('—');
  });

  it('renders job address separately from customer address', () => {
    const data = makeInvoiceData({
      job: makeJob({ street: '999 Work Site Rd', city: 'Dallas' }),
      customer: makeCustomer({ street: '456 Oak Ave', city: 'Austin' }),
    });
    const html = generateInvoiceHtml(data);
    expect(html).toContain('999 Work Site Rd');
    expect(html).toContain('456 Oak Ave');
    expect(html).toContain('Dallas');
    expect(html).toContain('Austin');
  });
});
