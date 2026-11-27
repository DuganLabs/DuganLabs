/**
 * App shell — the Greenput chrome around every route.
 *
 * Two shapes, one set of links:
 *
 *   ≥64rem  a fixed sidebar down the left, grouped into "the work / the
 *           money / the business". Fourteen destinations fit on fourteen
 *           lines, the active item takes the accent, and the content pane
 *           gets the full height of the viewport.
 *   <64rem  a material bar at the top (mark, route name, account) and a
 *           tab bar at the bottom holding Today / Jobs / Leads / More.
 *           The bottom bar is the point: a phone in one hand in a van is
 *           held low, and the top-right hamburger it replaces was the
 *           furthest pixel from the thumb.
 *
 * "More" opens a sheet from the bottom with every destination, which is
 * also where the rail's grouping is repeated.
 *
 * The shell is hidden entirely on routes whose `meta.bareLayout === true`
 * (login, recover, onboarding).
 */

import { effect, signal } from '@basenative/runtime';
import {
  GP_ICON_CLOSE,
  GP_ICON_MENU,
  greenputMark,
} from '@greenput/shared/design';
import type { PlatformDeps } from '../deps.js';
import { adoptSheet, defineSheet } from '../styles/sheet.js';
import { clear, el, on, type Cleanup } from '../lib/dom.js';
import {
  NAV_GROUP_LABELS,
  NAV_GROUP_ORDER,
  NAV_ITEMS,
  QUICK_NAV_ITEMS,
  type NavItem,
} from './nav-items.js';
import { ROUTE_TABLE, type RouteName } from '../routes/table.js';
import { renderLoginRoute } from '../routes/login/login.js';
import { renderRecoverRoute } from '../routes/recover/recover.js';
import { renderAcceptInviteRoute } from '../routes/accept-invite/accept-invite.js';
import { renderDashboardRoute } from '../routes/dashboard/dashboard.js';
import { renderActivityRoute } from '../routes/activity/activity.js';
import { renderCustomersRoute } from '../routes/customers/customers.js';
import { renderCustomerDetailRoute } from '../routes/customers/customer-detail.js';
import { renderVehiclesRoute } from '../routes/vehicles/vehicles.js';
import { renderCampaignsRoute } from '../routes/campaigns/campaigns.js';
import { renderPluginsRoute } from '../routes/plugins/plugins.js';
import { renderReviewsRoute } from '../routes/reviews/reviews.js';
import { renderOpportunitiesRoute } from '../routes/opportunities/opportunities.js';
import { renderOpportunityDetailRoute } from '../routes/opportunities/opportunity-detail.js';
import { renderLeadsRoute } from '../routes/leads/leads.js';
import { renderLeadDetailRoute } from '../routes/leads/lead-detail.js';
import { renderInventoryRoute } from '../routes/inventory/inventory.js';
import { renderEstimatesRoute } from '../routes/estimates/estimates.js';
import { renderEstimateDetailRoute } from '../routes/estimates/estimate-detail.js';
import { renderReportsRoute } from '../routes/reports/reports.js';
import { renderOnboardingRoute } from '../routes/onboarding/onboarding.js';
import { renderSettingsRoute } from '../routes/settings/settings.js';
import { renderJobsRoute } from '../routes/jobs/jobs.js';
import { renderJobDetailRoute } from '../routes/jobs/job-detail.js';
import { renderChatRoute } from '../routes/chat/chat.js';
import { renderChatListRoute } from '../routes/chat/chat-list.js';
import { renderNotFoundRoute } from '../routes/not-found/not-found.js';
import type { RouteRender, RouteView } from '../routes/types.js';
import type { PlatformDeps as Deps } from '../deps.js';

const SHEET = defineSheet(`
/* Phone: material bar / route / tab bar. The sheet is fixed, so it claims
   no track of its own. */
[data-bn-shell] {
  min-height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-columns: minmax(0, 1fr);
  background: var(--gp-bg);
}

/* ── Chrome ─────────────────────────────────────────────────────────────
   Header, sidebar and tab bar share the kit's material: a solid surface,
   a hairline, and a short frost blur. The active item is the accent. */
[data-bn-shell-header],
[data-bn-shell-rail],
[data-bn-shell-thumbbar] {
  background: var(--gp-surface);
  color: var(--gp-text);
  border-color: var(--gp-rule);
  backdrop-filter: blur(var(--bn-plat-glass-frost-regular));
  -webkit-font-smoothing: antialiased;
}

[data-bn-shell-header] {
  block-size: var(--gp-shell-h);
  padding-inline: var(--gp-space-3);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--gp-space-3);
  position: sticky;
  inset-block-start: 0;
  z-index: var(--gp-z-shell);
  border-block-end: 1px solid var(--gp-rule);
}
[data-bn-shell-brand] {
  display: inline-flex;
  align-items: center;
  gap: var(--gp-space-2);
  color: var(--gp-text);
  text-decoration: none;
  font-weight: var(--gp-weight-bold);
  font-size: var(--gp-text-base);
  letter-spacing: var(--gp-tracking-tight);
  padding-block: var(--gp-space-2);
}
[data-bn-shell-brand] svg { flex: none; }
[data-bn-shell-title] {
  min-width: 0;
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-semibold);
  color: var(--gp-text-muted);
  text-align: end;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Desktop rail ─────────────────────────────────────────────────────── */
[data-bn-shell-rail] { display: none; }
[data-bn-shell-rail] menu {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 1px;
}
[data-bn-nav-group-label] {
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
  color: var(--gp-text-subtle);
  padding: var(--gp-space-5) var(--gp-space-3) var(--gp-space-2);
}
[data-bn-nav-group]:first-of-type [data-bn-nav-group-label] {
  padding-block-start: var(--gp-space-3);
}

/* One link style for the rail and the sheet. Flat until it matters: the
   active row takes a green left rule and the leaf-green label, so which page
   you are on survives sunlight and a dirty screen. */
[data-bn-shell-rail] a,
[data-bn-shell-sheet] a {
  display: flex;
  align-items: center;
  gap: var(--gp-space-3);
  min-block-size: var(--gp-tap-min);
  padding: var(--gp-space-2) var(--gp-space-3);
  border-inline-start: 3px solid transparent;
  color: var(--gp-text-muted);
  text-decoration: none;
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-medium);
  transition: background var(--gp-motion-1), color var(--gp-motion-1);
}
[data-bn-shell-rail] a svg,
[data-bn-shell-sheet] a svg {
  inline-size: 1.25rem;
  block-size: 1.25rem;
  flex: none;
  opacity: 0.85;
}
[data-bn-shell-rail] a:hover,
[data-bn-shell-sheet] a:hover {
  background: var(--gp-surface-sunk);
  color: var(--gp-text);
}
[data-bn-shell-rail] a[data-bn-active],
[data-bn-shell-sheet] a[data-bn-active] {
  background: var(--gp-surface-sunk);
  border-inline-start-color: var(--gp-mark);
  color: var(--gp-primary-text);
  font-weight: var(--gp-weight-semibold);
}
[data-bn-shell-rail] a[data-bn-active] svg,
[data-bn-shell-sheet] a[data-bn-active] svg { opacity: 1; }
[data-bn-shell-rail] a:focus-visible,
[data-bn-shell-sheet] a:focus-visible,
[data-bn-shell-thumbbar] a:focus-visible,
[data-bn-shell-header] :focus-visible {
  outline: 2px solid var(--gp-focus);
  outline-offset: -2px;
}

/* ── Account block ────────────────────────────────────────────────────── */
[data-bn-shell-account] {
  display: flex;
  align-items: center;
  gap: var(--gp-space-2);
}
[data-bn-avatar] {
  inline-size: 2rem;
  block-size: 2rem;
  margin: 0;
  border-radius: var(--gp-radius-md);
  background: var(--gp-green-800);
  color: var(--gp-primary-text);
  display: grid;
  place-items: center;
  font-size: var(--gp-text-xs);
  font-weight: var(--gp-weight-bold);
  letter-spacing: 0.02em;
}
[data-bn-shell-header] [data-bn-button][data-bn-variant='ghost'],
[data-bn-shell-rail] [data-bn-button][data-bn-variant='ghost'] {
  background: transparent;
  border: none;
  color: var(--gp-text-subtle);
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-medium);
  min-block-size: var(--gp-tap-min);
  padding-inline: var(--gp-space-2);
  border-radius: var(--gp-radius-md);
}
[data-bn-shell-header] [data-bn-button][data-bn-variant='ghost']:hover,
[data-bn-shell-rail] [data-bn-button][data-bn-variant='ghost']:hover {
  color: var(--gp-text);
  background: var(--gp-surface-sunk);
}

/* ── Phone thumb bar ──────────────────────────────────────────────────── */
[data-bn-shell-thumbbar] {
  position: sticky;
  inset-block-end: 0;
  z-index: var(--gp-z-shell);
  border-block-start: 1px solid var(--gp-rule);
  padding-block-end: env(safe-area-inset-bottom, 0);
}
[data-bn-shell-thumbbar] menu {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
}
[data-bn-shell-thumbbar] a,
[data-bn-shell-thumbbar] button {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 2px;
  min-block-size: 3.25rem;
  inline-size: 100%;
  background: none;
  border: 0;
  border-block-start: 2px solid transparent;
  color: var(--gp-text-subtle);
  text-decoration: none;
  font-size: var(--gp-text-2xs);
  font-weight: var(--gp-weight-semibold);
  letter-spacing: 0.01em;
}
[data-bn-shell-thumbbar] svg { inline-size: 1.375rem; block-size: 1.375rem; }
[data-bn-shell-thumbbar] a[data-bn-active] {
  color: var(--gp-primary-text);
  border-block-start-color: var(--gp-mark);
}
[data-bn-shell-thumbbar] button:focus-visible {
  outline: 2px solid var(--gp-focus);
  outline-offset: -2px;
}

/* ── "More" sheet ─────────────────────────────────────────────────────── */
[data-bn-shell-sheet] {
  position: fixed;
  inset: 0;
  z-index: var(--gp-z-overlay);
  display: grid;
  grid-template-rows: 1fr auto;
  background: var(--gp-scrim);
}
[data-bn-shell-sheet][hidden] { display: none; }
[data-bn-shell-sheet] > [data-bn-sheet-scrim] { cursor: default; }
[data-bn-shell-sheet] > nav {
  background: var(--gp-surface);
  border-block-start: 2px solid var(--gp-mark);
  max-block-size: 82dvh;
  overflow-y: auto;
  padding-block-end: calc(var(--gp-space-4) + env(safe-area-inset-bottom, 0px));
  animation: gp-sheet-in var(--gp-motion-3);
}
@keyframes gp-sheet-in {
  from { transform: translateY(8%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
[data-bn-sheet-head] {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--gp-space-3);
  padding: var(--gp-space-3) var(--gp-space-3) 0 var(--gp-space-4);
}
[data-bn-sheet-head] [data-bn="bn-grabber"] {
  grid-column: 1 / -1;
  justify-self: center;
  margin-block-end: var(--gp-space-2);
}
[data-bn-sheet-head] h2 {
  font-size: var(--gp-text-sm);
  font-weight: var(--gp-weight-bold);
  letter-spacing: var(--gp-tracking-label);
  text-transform: uppercase;
  color: var(--gp-text-subtle);
}
[data-bn-sheet-close] {
  display: grid;
  place-items: center;
  min-inline-size: var(--gp-tap-min);
  min-block-size: var(--gp-tap-min);
  background: none;
  border: 0;
  color: var(--gp-text-muted);
  border-radius: var(--gp-radius-md);
}
[data-bn-sheet-close] svg { inline-size: 1.25rem; block-size: 1.25rem; }
[data-bn-shell-sheet] menu {
  list-style: none;
  margin: 0;
  padding: 0 0 var(--gp-space-2);
  display: grid;
}

@media (min-width: 64rem) {
  [data-bn-shell] {
    grid-template-rows: 1fr;
    grid-template-columns: 14rem minmax(0, 1fr);
  }
  [data-bn-shell-header],
  [data-bn-shell-thumbbar] { display: none; }
  [data-bn-shell-rail] {
    display: grid;
    grid-template-rows: auto 1fr auto;
    position: sticky;
    inset-block-start: 0;
    block-size: 100dvh;
    overflow-y: auto;
    border-inline-end: 1px solid var(--gp-rule);
  }
  [data-bn-rail-brand] {
    display: flex;
    align-items: center;
    gap: var(--gp-space-2);
    padding: var(--gp-space-4) var(--gp-space-4) var(--gp-space-2);
    color: var(--gp-text);
    text-decoration: none;
    font-size: var(--gp-text-lg);
    font-weight: var(--gp-weight-black);
    letter-spacing: var(--gp-tracking-tight);
  }
  [data-bn-rail-foot] {
    display: grid;
    gap: var(--gp-space-1);
    padding: var(--gp-space-3);
    border-block-start: 1px solid var(--gp-rule);
  }
  [data-bn-rail-foot] [data-bn-shell-account] { justify-content: start; }
  [data-bn-rail-foot] [data-bn-user-name] {
    position: static;
    inline-size: auto;
    block-size: auto;
    margin: 0;
    clip-path: none;
    font-size: var(--gp-text-sm);
    font-weight: var(--gp-weight-semibold);
    color: var(--gp-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  [data-bn-rail-foot] [data-bn-button] { justify-content: flex-start; }
}

main[data-bn-main] {
  display: block;
  width: 100%;
  min-width: 0;
}

[data-bn-route-error] {
  padding: var(--gp-space-9) var(--gp-gutter);
  text-align: center;
  color: var(--gp-danger);
  font-weight: var(--gp-weight-medium);
}
`);

type ParamRouteRender = (
  deps: Deps,
  params: Record<string, string>,
) => RouteView;

const ROUTE_RENDERERS: Partial<Record<RouteName, RouteRender>> = {
  login: renderLoginRoute,
  recover: renderRecoverRoute,
  onboarding: renderOnboardingRoute,
  dashboard: renderDashboardRoute,
  activity: renderActivityRoute,
  customers: renderCustomersRoute,
  vehicles: renderVehiclesRoute,
  campaigns: renderCampaignsRoute,
  plugins: renderPluginsRoute,
  reviews: renderReviewsRoute,
  opportunities: renderOpportunitiesRoute,
  leads: renderLeadsRoute,
  inventory: renderInventoryRoute,
  estimates: renderEstimatesRoute,
  reports: renderReportsRoute,
  settings: renderSettingsRoute,
  jobs: renderJobsRoute,
  'chat-list': renderChatListRoute,
  'not-found': renderNotFoundRoute,
};

const PARAM_ROUTE_RENDERERS: Partial<Record<RouteName, ParamRouteRender>> = {
  chat: (deps, params) => renderChatRoute(deps, { id: params['id'] ?? '' }),
  'lead-detail': (deps, params) =>
    renderLeadDetailRoute(deps, { id: params['id'] ?? '' }),
  'customer-detail': (deps, params) =>
    renderCustomerDetailRoute(deps, { id: params['id'] ?? '' }),
  'job-detail': (deps, params) =>
    renderJobDetailRoute(deps, { id: params['id'] ?? '' }),
  'opportunity-detail': (deps, params) =>
    renderOpportunityDetailRoute(deps, { id: params['id'] ?? '' }),
  'estimate-detail': (deps, params) =>
    renderEstimateDetailRoute(deps, { id: params['id'] ?? '' }),
  'accept-invite': (deps, params) =>
    renderAcceptInviteRoute(deps, { token: params['token'] ?? '' }),
};

export interface ShellMount {
  readonly element: HTMLElement;
  dispose(): void;
}

export function renderShell(deps: PlatformDeps): ShellMount {
  adoptSheet(SHEET);

  const skipLink = el(
    'a',
    { href: '#main-content', 'data-bn-skip-link': '' },
    'Skip to main content',
  );

  // Every route's link is tracked here — the rail, the thumb bar and the
  // sheet each render the same NAV_ITEMS as independent anchors, so a
  // route's active state has to be applied to every anchor representing it.
  const navAnchors = new Map<string, HTMLAnchorElement[]>();

  function trackAnchor(route: string, anchor: HTMLAnchorElement): void {
    const existing = navAnchors.get(route);
    if (existing) existing.push(anchor);
    else navAnchors.set(route, [anchor]);
  }

  function navLink(item: NavItem, testIdPrefix: string): HTMLAnchorElement {
    const platformControl =
      testIdPrefix === 'shell-quick-nav'
        ? 'bn-tab'
        : testIdPrefix === 'shell-nav'
          ? 'bn-sidebar-item'
          : null;
    const link = el(
      'a',
      {
        href: item.route,
        'data-bn-nav-item': item.route,
        ...(platformControl ? { 'data-bn': platformControl } : {}),
        'data-testid': `${testIdPrefix}-${item.route.slice(1)}`,
      },
      htmlFragment(item.icon),
      el('span', {}, item.label),
    );
    trackAnchor(item.route, link);
    return link;
  }

  function groupedNav(testIdPrefix: string): HTMLElement[] {
    return NAV_GROUP_ORDER.map((group) => {
      const list = el('menu', {});
      for (const item of NAV_ITEMS.filter((i) => i.group === group)) {
        list.append(el('li', {}, navLink(item, testIdPrefix)));
      }
      const headingId = `${testIdPrefix}-group-${group}`;
      return el(
        'section',
        { 'data-bn-nav-group': group, 'aria-labelledby': headingId },
        el(
          'h2',
          { 'data-bn-nav-group-label': '', id: headingId },
          NAV_GROUP_LABELS[group],
        ),
        list,
      );
    });
  }

  // ── Account ────────────────────────────────────────────────────────────
  // The rail (desktop) and the header (phone) each host their own avatar
  // node; both are driven by the one `deps.auth` effect below rather than
  // being cloned, so neither can go stale.
  const avatar = el('figure', { 'data-bn-avatar': '', 'aria-hidden': 'true' });
  const headerAvatar = el('figure', {
    'data-bn-avatar': '',
    'aria-hidden': 'true',
  });
  const userName = el('span', {
    'data-bn-user-name': '',
    'data-bn-sr-only': '',
  });

  function signOutButton(testId: string): HTMLButtonElement {
    return el(
      'button',
      {
        type: 'button',
        'data-bn-button': '',
        'data-bn-variant': 'ghost',
        'data-testid': testId,
      },
      'Sign out',
    ) as HTMLButtonElement;
  }
  // Two buttons because the rail and the sheet are both in the DOM at once
  // and one element cannot be in two places.
  const railLogout = signOutButton('shell-logout');
  const sheetLogout = signOutButton('shell-sheet-logout');
  const logoutButtons = [railLogout, sheetLogout];

  const account = el(
    'aside',
    { 'data-bn-shell-account': '', 'aria-label': 'Account' },
    avatar,
    userName,
  );
  const headerAccount = el(
    'aside',
    { 'data-bn-shell-account': '', 'aria-label': 'Account' },
    headerAvatar,
  );

  // ── Desktop rail ───────────────────────────────────────────────────────
  const railBrand = el(
    'a',
    { href: '/dashboard', 'data-bn-rail-brand': '' },
    htmlFragment(greenputMark({ size: 26 })),
    el('span', {}, 'Greenput'),
  );
  const railNav = el(
    'nav',
    { 'data-bn-rail-nav': '', 'aria-label': 'Primary' },
    ...groupedNav('shell-nav'),
  );
  const railFoot = el('div', { 'data-bn-rail-foot': '' }, account, railLogout);
  const rail = el(
    'div',
    { 'data-bn-shell-rail': '', 'data-bn': 'bn-sidebar' },
    railBrand,
    railNav,
    railFoot,
  );

  // ── Phone header ───────────────────────────────────────────────────────
  const headerBrand = el(
    'a',
    { href: '/dashboard', 'data-bn-shell-brand': '' },
    htmlFragment(greenputMark({ size: 22 })),
    el('span', {}, 'Greenput'),
  );
  const headerTitle = el('span', { 'data-bn-shell-title': '' });
  const header = el(
    'header',
    { 'data-bn-shell-header': '' },
    headerBrand,
    headerTitle,
    headerAccount,
  );

  // ── Phone thumb bar ────────────────────────────────────────────────────
  const moreButton = el(
    'button',
    {
      type: 'button',
      'data-bn-shell-menu-toggle': '',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-controls': 'shell-more-sheet',
      'data-testid': 'shell-menu-toggle',
    },
    htmlFragment(GP_ICON_MENU),
    el('span', {}, 'More'),
  );
  const thumbList = el('menu', {});
  for (const item of QUICK_NAV_ITEMS) {
    thumbList.append(el('li', {}, navLink(item, 'shell-quick-nav')));
  }
  thumbList.append(el('li', {}, moreButton));
  const thumbBar = el(
    'nav',
    {
      'data-bn-shell-thumbbar': '',
      'data-bn': 'bn-tab-bar',
      'aria-label': 'Quick navigation',
    },
    thumbList,
  );

  // ── "More" sheet ───────────────────────────────────────────────────────
  const sheetOpen = signal(false);
  const sheetClose = el(
    'button',
    { type: 'button', 'data-bn-sheet-close': '', 'aria-label': 'Close menu' },
    htmlFragment(GP_ICON_CLOSE),
  );
  const sheetScrim = el('div', { 'data-bn-sheet-scrim': '' });
  const sheetNav = el(
    'nav',
    { 'aria-label': 'All sections', 'data-bn': 'bn-sheet' },
    el(
      'div',
      { 'data-bn-sheet-head': '' },
      el('span', { 'data-bn': 'bn-grabber', 'aria-hidden': 'true' }),
      el('h2', { id: 'shell-more-heading' }, 'Go to'),
      sheetClose,
    ),
    ...groupedNav('shell-mobile-nav'),
    el('div', { 'data-bn-rail-foot': '' }, sheetLogout),
  );
  const sheet = el(
    'div',
    {
      'data-bn-shell-sheet': '',
      id: 'shell-more-sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'shell-more-heading',
      hidden: true,
    },
    sheetScrim,
    sheetNav,
  );

  const main = el('main', { id: 'main-content', 'data-bn-main': '' });

  const shellRoot = el(
    'div',
    { 'data-bn-shell': '' },
    header,
    rail,
    main,
    thumbBar,
    sheet,
  );

  // Bare wrapper holds either the full shell or just the bare main slot.
  const root = el('div', { 'data-bn-app-root': '' });

  const cleanups: Cleanup[] = [];
  let currentView: RouteView | null = null;
  let currentRouteName: string | null = null;
  let currentParamsKey = '';
  let bareMainNode: HTMLElement | null = null;

  function applyLayout(bare: boolean): HTMLElement {
    if (bare) {
      if (!bareMainNode || !bareMainNode.isConnected) {
        clear(root);
        // Same id as the shell's <main>: the skip link is rendered on the
        // bare layout too, and without a target axe flags both the dangling
        // skip link and the content that then sits outside any landmark.
        bareMainNode = el('main', {
          id: 'main-content',
          'data-bn-main': '',
          'data-bn-bare': '',
        });
        root.append(skipLink, bareMainNode);
      }
      return bareMainNode;
    }
    bareMainNode = null;
    if (!shellRoot.isConnected) {
      clear(root);
      root.append(skipLink, shellRoot);
    }
    return main;
  }

  function disposeView(): void {
    if (currentView) {
      currentView.dispose();
      currentView = null;
    }
  }

  function mountView(slot: HTMLElement, view: RouteView): void {
    clear(slot);
    slot.append(view.element);
    currentView = view;
  }

  function showError(slot: HTMLElement, message: string): void {
    clear(slot);
    slot.append(el('p', { 'data-bn-route-error': '', role: 'alert' }, message));
  }

  cleanups.push(
    effect(() => {
      const match = deps.router.currentRoute();
      const routeName = match.name as RouteName | null;
      const route = ROUTE_TABLE.find((r) => r.name === routeName);

      const bare = route?.meta?.bareLayout === true;
      const slot = applyLayout(bare);

      if (route?.meta?.title) {
        document.title = `${route.meta.title} · Greenput`;
        headerTitle.textContent = route.meta.title;
      } else {
        document.title = 'Greenput';
        headerTitle.textContent = '';
      }

      const paramsKey = JSON.stringify(match.params);
      if (currentRouteName === routeName && currentParamsKey === paramsKey) {
        return;
      }
      currentRouteName = routeName;
      currentParamsKey = paramsKey;
      disposeView();

      if (!routeName) {
        // No match yet (very first paint or unknown route) — leave slot empty.
        return;
      }

      if (route?.name === 'placeholder') {
        // Root path — redirect to dashboard. Guard runs again when needed.
        void deps.router.navigate('/dashboard', { replace: true });
        return;
      }

      const paramRenderer = PARAM_ROUTE_RENDERERS[routeName];
      const renderer = ROUTE_RENDERERS[routeName];
      if (!paramRenderer && !renderer) {
        showError(slot, `Route '${routeName}' is not yet migrated.`);
        return;
      }

      try {
        const view = paramRenderer
          ? paramRenderer(deps, match.params)
          : renderer
            ? renderer(deps)
            : null;
        if (!view) {
          showError(slot, `Route '${routeName}' is not yet migrated.`);
          return;
        }
        mountView(slot, view);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to render route.';
        showError(slot, message);
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const path = deps.router.pathname();
      for (const [route, links] of navAnchors) {
        for (const link of links) {
          if (path.startsWith(route)) {
            link.setAttribute('data-bn-active', '');
            link.setAttribute('aria-current', 'page');
          } else {
            link.removeAttribute('data-bn-active');
            link.removeAttribute('aria-current');
          }
        }
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const user = deps.auth.user();
      if (user) {
        const initials = deps.auth.initials();
        avatar.textContent = initials;
        headerAvatar.textContent = initials;
        userName.textContent = deps.auth.displayName();
        avatar.removeAttribute('hidden');
        headerAvatar.removeAttribute('hidden');
        for (const button of logoutButtons) button.removeAttribute('hidden');
      } else {
        avatar.textContent = '';
        headerAvatar.textContent = '';
        userName.textContent = '';
        avatar.setAttribute('hidden', '');
        headerAvatar.setAttribute('hidden', '');
        for (const button of logoutButtons) button.setAttribute('hidden', '');
      }
    }).dispose,
  );

  for (const button of logoutButtons) {
    cleanups.push(
      on(button, 'click', () => {
        void deps.auth.logout();
      }),
    );
  }

  cleanups.push(
    effect(() => {
      const open = sheetOpen();
      moreButton.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) sheet.removeAttribute('hidden');
      else sheet.setAttribute('hidden', '');
    }).dispose,
  );

  cleanups.push(
    on(moreButton, 'click', () => {
      sheetOpen.set(!sheetOpen.peek());
    }),
  );
  cleanups.push(
    on(sheetClose, 'click', () => {
      sheetOpen.set(false);
      moreButton.focus();
    }),
  );
  cleanups.push(
    on(sheetScrim, 'click', () => {
      sheetOpen.set(false);
    }),
  );
  cleanups.push(
    on(document, 'keydown', (event) => {
      if (event.key === 'Escape' && sheetOpen.peek()) {
        sheetOpen.set(false);
        moreButton.focus();
      }
    }),
  );
  cleanups.push(
    effect(() => {
      deps.router.pathname();
      sheetOpen.set(false);
    }).dispose,
  );

  cleanups.push(
    on(root, 'click', (event) => {
      const anchor = (event.target as Element | null)?.closest?.(
        'a[href]',
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('/') || href.startsWith('//')) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const ev = event as MouseEvent;
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      event.preventDefault();
      void deps.router.navigate(href);
    }),
  );

  return {
    element: root,
    dispose: () => {
      disposeView();
      for (const fn of cleanups) fn();
    },
  };
}

function htmlFragment(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}
