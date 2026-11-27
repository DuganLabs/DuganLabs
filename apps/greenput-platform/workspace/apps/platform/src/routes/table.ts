/**
 * Route table for `apps/platform`. Every route from the original Angular
 * app is represented here.
 */

export type RouteName =
  | 'login'
  | 'recover'
  | 'accept-invite'
  | 'onboarding'
  | 'dashboard'
  | 'activity'
  | 'leads'
  | 'lead-detail'
  | 'opportunities'
  | 'opportunity-detail'
  | 'customers'
  | 'customer-detail'
  | 'estimates'
  | 'estimate-detail'
  | 'campaigns'
  | 'inventory'
  | 'vehicles'
  | 'plugins'
  | 'reviews'
  | 'reports'
  | 'settings'
  | 'jobs'
  | 'job-detail'
  | 'chat-list'
  | 'chat'
  | 'not-found'
  | 'placeholder';

export interface RouteMeta {
  readonly requiresAuth?: boolean;
  readonly bareLayout?: boolean;
  readonly title?: string;
}

export interface PlatformRoute {
  readonly path: string;
  readonly name: RouteName;
  readonly meta?: RouteMeta;
}

export const ROUTE_TABLE: readonly PlatformRoute[] = [
  {
    path: '/login',
    name: 'login',
    meta: { bareLayout: true, title: 'Sign in' },
  },
  {
    // The way back in when the passkey is gone. Public by necessity: a locked
    // out owner has no session to present, which is the whole problem.
    path: '/recover',
    name: 'recover',
    meta: { bareLayout: true, title: 'Recover your account' },
  },
  {
    // Where an invited teammate lands from the link their inviter passed on
    // (GP-008). Public for the same reason /recover is: the holder has no
    // session, and this screen is how they get one and enrol a passkey.
    path: '/accept-invite/:token',
    name: 'accept-invite',
    meta: { bareLayout: true, title: 'Accept your invitation' },
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    meta: { bareLayout: true, title: 'Onboarding' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    meta: { requiresAuth: true, title: 'Today' },
  },
  {
    path: '/activity',
    name: 'activity',
    meta: { requiresAuth: true, title: 'Activity' },
  },
  {
    path: '/leads',
    name: 'leads',
    meta: { requiresAuth: true, title: 'Leads' },
  },
  {
    // One lead's own page: fields, edit, delete, lifecycle (GP-003). Every
    // `/:id` route must sit above the '/*path' catch-all at the bottom.
    path: '/leads/:id',
    name: 'lead-detail',
    meta: { requiresAuth: true, title: 'Lead' },
  },
  {
    path: '/opportunities',
    name: 'opportunities',
    meta: { requiresAuth: true, title: 'Opportunities' },
  },
  {
    path: '/opportunities/:id',
    name: 'opportunity-detail',
    meta: { requiresAuth: true, title: 'Opportunity' },
  },
  {
    path: '/customers',
    name: 'customers',
    meta: { requiresAuth: true, title: 'Customers' },
  },
  {
    path: '/customers/:id',
    name: 'customer-detail',
    meta: { requiresAuth: true, title: 'Customer' },
  },
  {
    path: '/estimates',
    name: 'estimates',
    meta: { requiresAuth: true, title: 'Estimates' },
  },
  {
    path: '/estimates/:id',
    name: 'estimate-detail',
    meta: { requiresAuth: true, title: 'Estimate' },
  },
  { path: '/jobs', name: 'jobs', meta: { requiresAuth: true, title: 'Jobs' } },
  {
    path: '/jobs/:id',
    name: 'job-detail',
    meta: { requiresAuth: true, title: 'Job' },
  },
  {
    path: '/campaigns',
    name: 'campaigns',
    meta: { requiresAuth: true, title: 'Campaigns' },
  },
  {
    path: '/inventory',
    name: 'inventory',
    meta: { requiresAuth: true, title: 'Inventory' },
  },
  {
    path: '/vehicles',
    name: 'vehicles',
    meta: { requiresAuth: true, title: 'Vehicles' },
  },
  {
    path: '/plugins',
    name: 'plugins',
    meta: { requiresAuth: true, title: 'Plugins' },
  },
  {
    path: '/reviews',
    name: 'reviews',
    meta: { requiresAuth: true, title: 'Reviews' },
  },
  {
    path: '/reports',
    name: 'reports',
    meta: { requiresAuth: true, title: 'Reports' },
  },
  {
    path: '/settings',
    name: 'settings',
    meta: { requiresAuth: true, title: 'Settings' },
  },
  {
    // The list every conversation is reached from (GP-055). Without it a
    // bare /chat fell through to the catch-all, and nothing linked to chat.
    path: '/chat',
    name: 'chat-list',
    meta: { requiresAuth: true, title: 'Messages' },
  },
  {
    path: '/chat/:id',
    name: 'chat',
    meta: { requiresAuth: true, title: 'Chat' },
  },
  { path: '/', name: 'placeholder' },
  // Catch-all — must stay last so it never shadows a real route above it.
  {
    path: '/*path',
    name: 'not-found',
    meta: { title: 'Page not found' },
  },
];

export const HOME_ROUTE = '/dashboard';
export const LOGIN_ROUTE = '/login';
