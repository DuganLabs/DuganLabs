/**
 * Dependency container — single composition root for the BaseNative app.
 *
 * Wires `@basenative/fetch.createApiClient` to GreenPut's API base resolver,
 * builds the `@basenative/auth-webauthn` store on top of it, instantiates
 * the GreenPut-specific resource APIs, and creates the guarded router.
 *
 * Tests construct deps with their own `fetch` mock; production calls
 * `createDeps()` once from `main.ts`.
 */

import {
  createApiClient,
  resolveGreenPutApiBase,
  type ApiClient,
} from '@basenative/fetch';
import { createAuthStore, type AuthStore } from '@basenative/auth-webauthn';
import { createRouter, type RouteDefinition } from '@basenative/router';
import { withGuards, type GuardedRouter } from '@basenative/router/guards';
import { createDashboardApi, type DashboardApi } from './api/dashboard.js';
import { createAuditApi, type AuditApi } from './api/audit.js';
import {
  createAvailabilityApi,
  type AvailabilityApi,
} from './api/availability.js';
import { createCustomersApi, type CustomersApi } from './api/customers.js';
import { createVehiclesApi, type VehiclesApi } from './api/vehicles.js';
import { createCampaignsApi, type CampaignsApi } from './api/campaigns.js';
import { createPluginsApi, type PluginsApi } from './api/plugins.js';
import { createReviewsApi, type ReviewsApi } from './api/reviews.js';
import {
  createOpportunitiesApi,
  type OpportunitiesApi,
} from './api/opportunities.js';
import { createLeadsApi, type LeadsApi } from './api/leads.js';
import { createInventoryApi, type InventoryApi } from './api/inventory.js';
import { createEstimatesApi, type EstimatesApi } from './api/estimates.js';
import { createReportsApi, type ReportsApi } from './api/reports.js';
import { createWorkspaceApi, type WorkspaceApi } from './api/workspace.js';
import { createBrandingApi, type BrandingApi } from './api/branding.js';
import {
  createCustomDomainApi,
  type CustomDomainApi,
} from './api/custom-domain.js';
import { createApiKeysApi, type ApiKeysApi } from './api/api-keys.js';
import { createWebhooksApi, type WebhooksApi } from './api/webhooks.js';
import {
  createNotificationsApi,
  type NotificationsApi,
} from './api/notifications.js';
import { createBillingApi, type BillingApi } from './api/billing.js';
import { createJobsApi, type JobsApi } from './api/jobs.js';
import {
  createChangeOrdersApi,
  type ChangeOrdersApi,
} from './api/change-orders.js';
import { createChatApi, type ChatApi } from './api/chat.js';
import { createRecoveryApi, type RecoveryApi } from './api/recovery.js';
import {
  createInvitationsApi,
  type InvitationsApi,
} from './api/invitations.js';
import { appDocumentHref } from '@greenput/shared/utils';
import { ROUTE_TABLE, LOGIN_ROUTE, HOME_ROUTE } from './routes/table.js';

export interface PlatformDeps {
  readonly api: ApiClient;
  readonly auth: AuthStore;
  readonly router: GuardedRouter;
  readonly dashboard: DashboardApi;
  readonly audit: AuditApi;
  readonly customers: CustomersApi;
  readonly vehicles: VehiclesApi;
  readonly campaigns: CampaignsApi;
  readonly plugins: PluginsApi;
  readonly reviews: ReviewsApi;
  readonly opportunities: OpportunitiesApi;
  readonly leads: LeadsApi;
  readonly inventory: InventoryApi;
  readonly estimates: EstimatesApi;
  readonly reports: ReportsApi;
  readonly workspace: WorkspaceApi;
  readonly availability: AvailabilityApi;
  readonly branding: BrandingApi;
  readonly customDomain: CustomDomainApi;
  readonly apiKeys: ApiKeysApi;
  readonly webhooks: WebhooksApi;
  readonly notifications: NotificationsApi;
  readonly billing: BillingApi;
  readonly jobs: JobsApi;
  readonly changeOrders: ChangeOrdersApi;
  readonly chat: ChatApi;
  readonly recovery: RecoveryApi;
  readonly invitations: InvitationsApi;
}

export interface CreateDepsOptions {
  /** Override fetch (tests). */
  readonly fetch?: typeof fetch;
  /** Override base URL resolution (tests / SSR). */
  readonly baseUrl?: string;
  /** Skip guard registration (tests). */
  readonly skipGuards?: boolean;
}

export function createDeps(options: CreateDepsOptions = {}): PlatformDeps {
  const baseUrl = options.baseUrl ?? resolveGreenPutApiBase();
  const api = options.fetch
    ? createApiClient({ baseUrl, fetch: options.fetch })
    : createApiClient({ baseUrl });

  const router = withGuards(
    createRouter(ROUTE_TABLE as unknown as RouteDefinition[]),
  );

  const auth = createAuthStore({
    api,
    redirectAfterLogin: () => {
      void router.navigate(HOME_ROUTE);
    },
    redirectAfterLogout: () => {
      void router.navigate(LOGIN_ROUTE);
    },
  });

  if (!options.skipGuards) {
    router.beforeEach(async ({ to }) => {
      if (typeof location !== 'undefined') {
        const documents = appDocumentHref(
          location.hostname,
          location.pathname,
          location.search,
        );
        if (documents) {
          location.replace(documents);
          return new Promise(() => {
            /* The browser is leaving for the contractor's site. */
          });
        }
      }
      const route = ROUTE_TABLE.find((r) => r.name === to.name);
      if (!route?.meta?.requiresAuth) return;
      if (!auth.sessionChecked()) {
        await auth.checkSession();
      }
      if (!auth.isAuthenticated()) {
        return { redirect: LOGIN_ROUTE };
      }
      return;
    });
  }

  return {
    api,
    auth,
    router,
    dashboard: createDashboardApi(api),
    audit: createAuditApi(api),
    customers: createCustomersApi(api),
    vehicles: createVehiclesApi(api),
    campaigns: createCampaignsApi(api),
    plugins: createPluginsApi(api),
    reviews: createReviewsApi(api),
    opportunities: createOpportunitiesApi(api),
    leads: createLeadsApi(api),
    inventory: createInventoryApi(api),
    estimates: createEstimatesApi(api),
    reports: createReportsApi(api),
    workspace: createWorkspaceApi(api),
    availability: createAvailabilityApi(api),
    branding: createBrandingApi(api),
    customDomain: createCustomDomainApi(api),
    apiKeys: createApiKeysApi(api),
    webhooks: createWebhooksApi(api),
    notifications: createNotificationsApi(api),
    billing: createBillingApi(api),
    jobs: createJobsApi(api),
    changeOrders: createChangeOrdersApi(api),
    chat: createChatApi(api),
    recovery: createRecoveryApi(api),
    invitations: createInvitationsApi(api),
  };
}
