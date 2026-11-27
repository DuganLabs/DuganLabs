/**
 * Status badge — `@basenative/components` `renderBadge` mounted into the
 * `el()` tree.
 *
 * `renderBadge`'s content argument is an HTML slot (not escaped), so the
 * label is never passed through it: the badge is rendered empty and the
 * label is set with `textContent`. The domain status is kept on
 * `data-bn-status` as the app-level hook (tests, selectors); the visual
 * variant is derived from it here so every route shares one status → colour
 * mapping.
 */

import { renderBadge } from '@basenative/components';
import { elementFromHtml } from '../../lib/html.js';

export type BadgeVariant =
  'default' | 'primary' | 'success' | 'warning' | 'error';

/**
 * Domain status → badge variant. Covers every `*Status` union in
 * `@greenput/shared/models` plus the synthetic statuses routes derive
 * (inventory stock levels, plugin enablement). Unknown statuses are neutral.
 */
const STATUS_VARIANT: Readonly<Record<string, BadgeVariant>> = {
  // done / healthy
  active: 'success',
  won: 'success',
  completed: 'success',
  converted: 'success',
  paid: 'success',
  accepted: 'success',
  approved: 'success', // ChangeOrderStatus
  qualified: 'success',
  created: 'success',
  // fresh / open
  new: 'primary',
  open: 'primary',
  contacted: 'primary',
  scheduled: 'primary',
  sent: 'primary',
  updated: 'primary',
  // needs attention
  maintenance: 'warning',
  proposal_sent: 'warning',
  negotiating: 'warning',
  paused: 'warning',
  in_progress: 'warning',
  invoiced: 'warning',
  pending: 'warning',
  proposed: 'warning', // ChangeOrderStatus — waiting on the homeowner
  past_due: 'warning',
  verifying: 'warning', // CustomDomainStatus — Cloudflare DCV/cert in flight
  // stopped
  lost: 'error',
  rejected: 'error', // ChangeOrderStatus too
  declined: 'error',
  cancelled: 'error',
  canceled: 'error',
  deleted: 'error',
  failed: 'error', // CustomDomainStatus — verification/issuance failed
  // dormant
  draft: 'default',
  inactive: 'default',
  unqualified: 'default',
  expired: 'default',
  none: 'default', // CustomDomainStatus — no custom domain requested
};

export function badgeVariant(status: string): BadgeVariant {
  return STATUS_VARIANT[status] ?? 'default';
}

/**
 * Build a status badge element.
 *
 * @param status  Domain status; stored on `data-bn-status` and used to pick
 *                the variant unless one is given explicitly.
 * @param label   Visible text (any string — set via `textContent`).
 */
export function statusBadge(
  status: string,
  label: string,
  variant: BadgeVariant = badgeVariant(status),
): HTMLElement {
  const node = elementFromHtml(renderBadge('', { variant }));
  node.setAttribute('data-bn-status', status);
  node.textContent = label;
  return node;
}
