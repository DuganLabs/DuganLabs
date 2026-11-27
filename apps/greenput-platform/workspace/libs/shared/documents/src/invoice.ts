import {
  generatedIdentityFor,
  generatedMarkSvg,
  GP_BASE_CSS,
  GP_PLATFORM_CSS,
  GP_TOKENS_CSS,
  SURFACE_CSS,
} from '@greenput/shared/design';
import { formatPhone } from '@greenput/shared/utils';

// ─────────────────────────────────────────────────────────────
// Invoice HTML Generator
// Generates a print-ready HTML invoice for a completed job.
// ─────────────────────────────────────────────────────────────

/**
 * Data needed to render an invoice — uses DB row shapes (snake_case).
 *
 * MONEY: every amount here is INTEGER CENTS, like every other amount in the
 * system (see the MONEY note in libs/shared/models/src/wire.ts). This file
 * used to print the raw column value with a `$` in front of it, so a $2,652.13
 * job invoiced as "$265,213.00" — 100x wrong, on a billing surface, in a
 * document a contractor sends a homeowner.
 */
export interface InvoiceJobRow {
  id: string;
  job_number: string;
  title: string;
  invoiced_at: string | null;
  paid_at: string | null;
  /** Integer cents. */
  total: number;
  notes: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface InvoiceLineItemRow {
  id: string;
  description: string;
  quantity: number;
  /** Integer cents. */
  unit_price: number;
  /** Integer cents. */
  total: number;
}

export interface InvoiceCustomerRow {
  first_name: string;
  last_name: string;
  company: string | null;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface InvoiceWorkspaceRow {
  name: string;
  /**
   * Needed only for the generated mark, and needed for it to be RIGHT: the
   * colourway is seeded on the slug, so an invoice that did not carry the slug
   * would print a different colour tile from the same contractor's micro-site
   * and share card. Nullable because `workspaces.slug` is (five rows in
   * `greenput` carry NULL); the mark then falls back to seeding on the name,
   * which is what every surface does for those rows.
   */
  slug: string | null;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  license_num: string | null;
  logo_url: string | null;
}

export interface InvoiceData {
  job: InvoiceJobRow;
  lineItems: InvoiceLineItemRow[];
  customer: InvoiceCustomerRow;
  workspace: InvoiceWorkspaceRow;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(cents: number): string {
  const dollars = (Number.isFinite(cents) ? cents : 0) / 100;
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatAddress(row: {
  street: string;
  city: string;
  state: string;
  zip: string;
}): string {
  const parts: string[] = [];
  if (row.street) parts.push(escapeHtml(row.street));
  const cityStateZip = [row.city, row.state].filter(Boolean).join(', ');
  const line2 = [cityStateZip, row.zip].filter(Boolean).join(' ');
  if (line2) parts.push(escapeHtml(line2));
  return parts.join('<br>');
}

export function generateInvoiceHtml(data: InvoiceData): string {
  const { job, lineItems, customer, workspace } = data;

  // A workspace that never uploaded a logo used to print its name as bold text
  // here. It now prints the same generated mark that appears in its micro-site
  // nav and on its share card — inline SVG, not a URL, so an invoice rendered
  // offline or mailed as an attachment still has the mark. An uploaded logo is
  // untouched: the generated one never displaces it.
  const logoBlock = workspace.logo_url
    ? `<img src="${escapeHtml(workspace.logo_url)}" alt="${escapeHtml(workspace.name)}" width="200" height="60">`
    : `<p data-bn="bn-cluster">${generatedMarkSvg(
        generatedIdentityFor(workspace),
        {
          size: 56,
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        },
      )}<strong>${escapeHtml(workspace.name)}</strong></p>`;

  const lineItemRows = lineItems
    .map(
      (li) => `
      <tr>
        <td>${escapeHtml(li.description)}</td>
        <td>${li.quantity}</td>
        <td>${formatCurrency(li.unit_price)}</td>
        <td>${formatCurrency(li.total)}</td>
      </tr>`,
    )
    .join('\n');

  const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
  const grandTotal = job.total;

  const paidStamp = job.paid_at
    ? `<p><b data-bn="bn-badge">PAID — ${formatDate(job.paid_at)}</b></p>`
    : '';

  const licenseInfo = workspace.license_num
    ? `<p data-bn="bn-note">License: ${escapeHtml(workspace.license_num)}</p>`
    : '';

  const notesBlock = job.notes
    ? `<h2>Notes</h2><p>${escapeHtml(job.notes)}</p>`
    : '';

  const article = renderInvoiceArticle({
    logoBlock,
    licenseInfo,
    paidStamp,
    notesBlock,
    lineItemRows,
    workspace,
    customer,
    job,
    subtotal,
    grandTotal,
  });
  const title = `Invoice ${escapeHtml(job.job_number)} — ${escapeHtml(workspace.name)}`;
  return `<!DOCTYPE html>
<html lang="en" data-bn-platform="ios">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${title}</title>
  <style>
${GP_PLATFORM_CSS}
${GP_TOKENS_CSS}
@layer base { ${GP_BASE_CSS} }
${SURFACE_CSS}
table { inline-size: 100%; border-collapse: collapse; }
th, td { padding: var(--gp-space-2) var(--gp-space-3); border-block-end: 1px solid var(--gp-rule); text-align: start; }
th { color: var(--gp-text-muted); font-size: var(--gp-text-xs); }
td:not(:first-child), th:not(:first-child) { text-align: end; }
@media print { [data-bn="bn-button"] { display: none; } }
  </style>
</head>
<body>
  <main id="main-content">
    <section data-bn="bn-section">${article}</section>
  </main>
</body>
</html>`;
}

/** The invoice article. The public page puts this in the site shell; the API wraps the same article in a standalone document. */
export function renderInvoiceArticle(parts: {
  logoBlock: string;
  licenseInfo: string;
  paidStamp: string;
  notesBlock: string;
  lineItemRows: string;
  workspace: InvoiceWorkspaceRow;
  customer: InvoiceCustomerRow;
  job: InvoiceJobRow;
  subtotal: number;
  grandTotal: number;
}): string {
  const {
    logoBlock,
    licenseInfo,
    paidStamp,
    notesBlock,
    lineItemRows,
    workspace,
    customer,
    job,
    subtotal,
    grandTotal,
  } = parts;
  return `<article data-bn="bn-panel" data-bn-column>
        <header>
          ${logoBlock}
          <p data-bn="bn-note">
            ${formatAddress(workspace)}<br>
            ${workspace.phone ? escapeHtml(formatPhone(workspace.phone)) + '<br>' : ''}
            ${workspace.email ? escapeHtml(workspace.email) : ''}
          </p>
          ${licenseInfo}
        </header>
        <p data-bn="bn-kicker">Invoice</p>
        <h1 data-bn="bn-large-title">INVOICE</h1>
        <dl data-bn="bn-definitions">
          <div><dt>Invoice No</dt><dd>${escapeHtml(job.job_number)}</dd></div>
          <div><dt>Date</dt><dd>${formatDate(job.invoiced_at)}</dd></div>
          <div><dt>Job</dt><dd>${escapeHtml(job.title)}</dd></div>
        </dl>
        ${paidStamp}
        <div data-bn="bn-split">
          <div>
            <p data-bn="bn-kicker">Bill To</p>
            <p><strong>${escapeHtml(customer.first_name)} ${escapeHtml(customer.last_name)}</strong></p>
            ${customer.company ? `<p>${escapeHtml(customer.company)}</p>` : ''}
            <p data-bn="bn-note">
              ${formatAddress(customer)}<br>
              ${customer.phone ? escapeHtml(formatPhone(customer.phone)) + '<br>' : ''}
              ${customer.email ? escapeHtml(customer.email) : ''}
            </p>
          </div>
          <div>
            <p data-bn="bn-kicker">Job Address</p>
            <p data-bn="bn-note">${formatAddress(job)}</p>
          </div>
        </div>
        <div data-bn="bn-scroll">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${lineItemRows || '<tr><td colspan="4">No line items</td></tr>'}
            </tbody>
          </table>
        </div>
        <dl data-bn="bn-definitions">
          <div><dt>Subtotal</dt><dd>${formatCurrency(subtotal)}</dd></div>
          <div><dt>Total Due</dt><dd><strong>${formatCurrency(grandTotal)}</strong></dd></div>
        </dl>
        ${notesBlock}
        <p data-bn="bn-note">Payment is due within 30 days of the invoice date. Please make checks payable to <strong>${escapeHtml(workspace.name)}</strong>. Thank you for your business!</p>
        <p data-bn="bn-cluster"><button type="button" data-bn="bn-button" data-variant="prominent" data-size="large" onclick="window.print()">Print / Save as PDF</button></p>
      </article>`;
}
