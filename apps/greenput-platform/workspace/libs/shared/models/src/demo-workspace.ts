/**
 * The public demo shop (demo.greenput.com, workspace slug `demo`) is
 * never billed. It books without a card on file, is never paused for an
 * uncollected fee, records no lead fee, and no collector or booked-fee
 * charge ever charges it. Every billing chokepoint asks this one helper:
 * the tenant site's self-booking (apps/tenant-site/src/booking.ts), the
 * API's lead-receive gate (lead-billing-gate.ts), its fee recording
 * (lead-meter.ts recordLeadMeter) and its fee charge (lead-fee-billing.ts).
 */
export const DEMO_WORKSPACE_SLUG = 'demo';

export function isDemoWorkspaceSlug(slug: string | null | undefined): boolean {
  return slug === DEMO_WORKSPACE_SLUG;
}

/** Binds: workspace id. Answers `{ slug }`. */
export const WORKSPACE_SLUG_SQL = 'SELECT slug FROM workspaces WHERE id = ?';
