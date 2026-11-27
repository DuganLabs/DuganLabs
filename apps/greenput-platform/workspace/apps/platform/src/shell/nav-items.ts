/**
 * Primary nav metadata.
 *
 * Fifteen destinations is too many for one row of a top bar, and the old
 * single-letter "icons" ("D Dashboard", "Σ Reports") read as scaffolding. So
 * the nav is grouped the way a contractor's day is: the work in front of you,
 * the money, then the business behind it. Each group gets a heading in the
 * rail and the drawer, which turns a flat list of fifteen into three lists
 * of five — scannable at arm's length.
 *
 * `quick` marks the destinations that reach the thumb bar on a phone: the
 * three a tech actually opens standing next to a van.
 */

import { GP_ICONS } from '@greenput/shared/design';

export type NavGroup = 'work' | 'money' | 'business';

export interface NavItem {
  readonly route: string;
  readonly label: string;
  /** Inline SVG markup, drawn on one 24-unit grid (see `GP_ICONS`). */
  readonly icon: string;
  readonly group: NavGroup;
  /** Shown in the phone thumb bar. */
  readonly quick?: boolean;
}

export const NAV_GROUP_LABELS: Readonly<Record<NavGroup, string>> = {
  work: 'The work',
  money: 'The money',
  business: 'The business',
};

export const NAV_GROUP_ORDER: readonly NavGroup[] = [
  'work',
  'money',
  'business',
];

export const NAV_ITEMS: readonly NavItem[] = [
  {
    route: '/dashboard',
    label: 'Today',
    icon: GP_ICONS.dashboard,
    group: 'work',
    quick: true,
  },
  {
    route: '/jobs',
    label: 'Jobs',
    icon: GP_ICONS.jobs,
    group: 'work',
    quick: true,
  },
  {
    route: '/leads',
    label: 'Leads',
    icon: GP_ICONS.leads,
    group: 'work',
    quick: true,
  },
  {
    route: '/opportunities',
    label: 'Opportunities',
    icon: GP_ICONS.opportunities,
    group: 'work',
  },
  {
    route: '/customers',
    label: 'Customers',
    icon: GP_ICONS.customers,
    group: 'work',
  },
  {
    // The crew's conversations (GP-055): the list at /chat, each room
    // reached from a customer or a job as much as from here.
    route: '/chat',
    label: 'Messages',
    icon: GP_ICONS.chat,
    group: 'work',
  },
  {
    route: '/estimates',
    label: 'Estimates',
    icon: GP_ICONS.estimates,
    group: 'money',
  },
  {
    route: '/reports',
    label: 'Reports',
    icon: GP_ICONS.reports,
    group: 'money',
  },
  {
    route: '/campaigns',
    label: 'Campaigns',
    icon: GP_ICONS.campaigns,
    group: 'money',
  },
  {
    route: '/reviews',
    label: 'Reviews',
    icon: GP_ICONS.reviews,
    group: 'money',
  },
  {
    route: '/inventory',
    label: 'Inventory',
    icon: GP_ICONS.inventory,
    group: 'business',
  },
  {
    route: '/vehicles',
    label: 'Vehicles',
    icon: GP_ICONS.vehicles,
    group: 'business',
  },
  {
    route: '/activity',
    label: 'Activity',
    icon: GP_ICONS.activity,
    group: 'business',
  },
  {
    route: '/plugins',
    label: 'Plugins',
    icon: GP_ICONS.plugins,
    group: 'business',
  },
  {
    route: '/settings',
    label: 'Settings',
    icon: GP_ICONS.settings,
    group: 'business',
  },
];

export const QUICK_NAV_ITEMS: readonly NavItem[] = NAV_ITEMS.filter(
  (item) => item.quick === true,
);
