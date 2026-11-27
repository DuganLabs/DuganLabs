// The documents a contractor hands a customer, rendered as HTML strings.
//
// The invoice lived in apps/api/src/lib/pdf/ and was reachable only through
// GET /api/jobs/:id/invoice, behind the contractor's own session — a URL that
// could not be given to the homeowner it was addressed to. Since GP-008 the
// public page at https://<slug>.greenput.com/invoice/<token> (apps/tenant-site)
// renders the same HTML, so the renderer sits where both Workers can import
// it. Not libs/shared/design: that library is the identity system (marks,
// palettes, share cards); this is a billing document that merely uses it.
export {
  generateInvoiceHtml,
  type InvoiceCustomerRow,
  type InvoiceData,
  type InvoiceJobRow,
  type InvoiceLineItemRow,
  type InvoiceWorkspaceRow,
} from './invoice';
