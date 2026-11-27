/**
 * Proposal page — rendered with @basenative/server and @basenative/components.
 *
 * Replaces the previous raw HTML template with BaseNative SSR, fulfilling
 * the dogfooding requirement from CLAUDE.md.
 */
import { formatPhone } from '@greenput/shared/utils';
import { renderBadge, renderTable } from '@basenative/components';
import { renderTenantShell, type WorkspaceData } from './render';
import {
  readEstimateLineItem,
  type EstimateLineItemType,
} from '@greenput/shared/models';

export interface ProposalWorkspace {
  name: string;
  phone: string;
  email: string;
  logo_url: string | null;
}

/**
 * A line item as parsed straight out of `estimates.line_items`. `type` is
 * optional here because rows written before GP-038 have none — they carry a
 * `[labor] ` / `[material] ` prefix on the description instead, and
 * `readEstimateLineItem` turns that into the Type column below. This page
 * must keep rendering those rows readably; they are not migrated.
 */
export interface ProposalLineItem {
  type?: string;
  description: string;
  quantity: number;
  /** Integer cents. */
  unitPrice: number;
  /** Integer cents. */
  total: number;
}

/** What the homeowner reads — a word, never the enum value. */
const TYPE_LABELS: Record<EstimateLineItemType, string> = {
  labor: 'Labor',
  material: 'Materials',
};

/**
 * MONEY: every amount on this page is INTEGER CENTS, the canonical unit — see
 * the MONEY note in libs/shared/models/src/wire.ts. This function used to
 * format the raw column value, so the public proposal a homeowner reads showed
 * $265,213.00 for a $2,652.13 quote once the columns became cents (and,
 * before the conversion, agreed with a seed that disagreed with every other
 * reader).
 */
const fmtCurrency = (cents: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    (Number.isFinite(cents) ? cents : 0) / 100,
  );

export function renderProposalPage(
  ws: ProposalWorkspace,
  estimate: Record<string, unknown>,
  lineItems: ProposalLineItem[],
): string {
  const title = estimate['title'] as string;
  const number = estimate['estimate_number'] as string;
  const subtotal = estimate['subtotal'] as number;
  // A PERCENTAGE (8.25 = 8.25%), not a fraction and not an amount — the unit
  // apps/api and apps/platform have always computed with. The seed wrote
  // 0.0825, so this page read "Tax (0.0825%)"; migration 023 converted it.
  const taxRate = estimate['tax_rate'] as number;
  const taxAmount = estimate['tax_amount'] as number;
  const total = estimate['total'] as number;
  const notes = estimate['notes'] as string;
  const validUntil = estimate['valid_until'] as string | null;
  const status = estimate['status'] as string;

  // Use @basenative/components renderBadge for status. The variant must be one
  // of the five components.css declares — default | primary | success |
  // warning | error. 'info' matched no rule, so a sent proposal's badge
  // rendered as bare text.
  const statusVariant: 'default' | 'primary' | 'success' | 'warning' | 'error' =
    status === 'accepted'
      ? 'success'
      : status === 'sent'
        ? 'primary'
        : status === 'rejected'
          ? 'error'
          : 'default';
  // renderBadge's content is a raw HTML slot in components 0.5.0.
  const badge = renderBadge(escapeText(status.toUpperCase()), {
    variant: statusVariant,
  });

  // Use @basenative/components renderTable for line items. The Type column
  // is the labor/material split the contractor tagged each row with (GP-038:
  // it used to arrive as a "[labor] " prefix inside the description).
  const lineItemsTable =
    lineItems.length > 0
      ? renderTable({
          columns: [
            { key: 'description', label: 'Description' },
            { key: 'type', label: 'Type' },
            { key: 'quantity', label: 'Qty' },
            { key: 'unitPrice', label: 'Unit Price' },
            { key: 'total', label: 'Total' },
          ],
          rows: lineItems.map(readEstimateLineItem).map((li) => ({
            description: li.description,
            type: TYPE_LABELS[li.type],
            quantity: li.quantity.toString(),
            unitPrice: fmtCurrency(li.unitPrice),
            total: fmtCurrency(li.total),
          })),
        })
      : '';

  const totalsContent = `
    <dl data-bn="proposal-totals">
      <div data-bn="totals-row"><dt>Subtotal</dt><dd>${fmtCurrency(subtotal)}</dd></div>
      ${taxRate > 0 ? `<div data-bn="totals-row"><dt>Tax (${taxRate}%)</dt><dd>${fmtCurrency(taxAmount)}</dd></div>` : ''}
      <div data-bn="totals-row" data-bn-grand=""><dt>Total</dt><dd>${fmtCurrency(total)}</dd></div>
    </dl>
  `;

  const phoneDisplay = ws.phone ? formatPhone(ws.phone) : '';
  const notesBlock = notes
    ? `<div data-bn="proposal-notes"><h2>Notes</h2><p>${escapeText(notes)}</p></div>`
    : '';
  const validBlock = validUntil
    ? `<p data-bn="bn-note">This proposal is valid until ${escapeText(validUntil)}</p>`
    : '';

  const shell: WorkspaceData = {
    id: 'proposal',
    name: ws.name,
    slug: 'proposal',
    trade: '',
    phone: ws.phone,
    email: ws.email,
    logo_url: ws.logo_url ?? null,
    street: '',
    city: '',
    state: '',
    zip: '',
  };

  const content = `<article data-bn="bn-panel" data-bn-column data-bn-narrow>
    <header>
      <h1 data-bn="bn-large-title">${escapeText(title)}</h1>
      ${badge}
      <p data-bn="bn-kicker">${escapeText(number)}</p>
    </header>
    <p><strong>${escapeText(ws.name)}</strong> &middot; ${escapeText(phoneDisplay)} &middot; ${escapeText(ws.email)}</p>
    ${lineItemsTable}
    ${totalsContent}
    ${notesBlock}
    ${validBlock}
  </article>`;

  return renderTenantShell(shell, {
    content,
    title: `Proposal — ${title} | ${ws.name}`,
    description: `Proposal ${number} from ${ws.name}.`,
    noindex: true,
  });
}

/** Text nodes: & < > only. Quotes stay literal, matching the old server escape. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
