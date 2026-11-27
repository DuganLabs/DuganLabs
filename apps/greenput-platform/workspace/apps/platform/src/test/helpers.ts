/**
 * Test helpers — build a fake `PlatformDeps` against a stub `fetch` so we
 * can render routes inside happy-dom without touching network.
 */

import { createApiClient } from '@basenative/fetch';
import {
  createAuthStore,
  type WebAuthnClient,
} from '@basenative/auth-webauthn';
import { createRouter, type RouteDefinition } from '@basenative/router';
import { withGuards } from '@basenative/router/guards';
import { createDashboardApi } from '../api/dashboard.js';
import { createAuditApi } from '../api/audit.js';
import { createAvailabilityApi } from '../api/availability.js';
import { createCustomersApi } from '../api/customers.js';
import { createVehiclesApi } from '../api/vehicles.js';
import { createCampaignsApi } from '../api/campaigns.js';
import { createPluginsApi } from '../api/plugins.js';
import { createReviewsApi } from '../api/reviews.js';
import { createOpportunitiesApi } from '../api/opportunities.js';
import { createLeadsApi } from '../api/leads.js';
import { createInventoryApi } from '../api/inventory.js';
import { createEstimatesApi } from '../api/estimates.js';
import { createReportsApi } from '../api/reports.js';
import { createWorkspaceApi } from '../api/workspace.js';
import { createBrandingApi } from '../api/branding.js';
import { createCustomDomainApi } from '../api/custom-domain.js';
import { createApiKeysApi } from '../api/api-keys.js';
import { createWebhooksApi } from '../api/webhooks.js';
import { createNotificationsApi } from '../api/notifications.js';
import { createBillingApi } from '../api/billing.js';
import { createJobsApi } from '../api/jobs.js';
import { createChangeOrdersApi } from '../api/change-orders.js';
import { createChatApi } from '../api/chat.js';
import { createRecoveryApi } from '../api/recovery.js';
import { createInvitationsApi } from '../api/invitations.js';
import { ROUTE_TABLE } from '../routes/table.js';
import type { PlatformDeps } from '../deps.js';

export interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

export interface FakeFetcher {
  readonly fetch: typeof fetch;
  readonly calls: FetchCall[];
  respond(
    matcher: string | RegExp,
    response: Response | (() => Response),
  ): void;
}

export function createFakeFetch(): FakeFetcher {
  const calls: FetchCall[] = [];
  const handlers: Array<{
    matcher: string | RegExp;
    respond: () => Response;
  }> = [];

  function fetchImpl(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    let body: unknown = init?.body ?? null;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // leave as string
      }
    }
    calls.push({ url, method, body });

    for (const { matcher, respond } of handlers) {
      const matched =
        typeof matcher === 'string' ? url.includes(matcher) : matcher.test(url);
      if (matched) return Promise.resolve(respond());
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          error: { code: 'unhandled', message: `No stub for ${method} ${url}` },
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    );
  }

  return {
    fetch: fetchImpl as typeof fetch,
    calls,
    respond(matcher, response) {
      const respond =
        typeof response === 'function' ? response : () => response;
      handlers.push({ matcher, respond });
    },
  };
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

export interface BuildDepsOptions {
  readonly fetch: typeof fetch;
  readonly skipGuards?: boolean;
  /**
   * Stand in for the passkey client.
   *
   * happy-dom has no `navigator.credentials`, so the real client cannot be
   * driven in a unit test — and the parts worth unit-testing are the *route's*
   * reactions to each outcome, not SimpleWebAuthn. The end-to-end path is
   * covered separately against a CDP virtual authenticator.
   */
  readonly webauthn?: WebAuthnClient;
}

export function buildTestDeps(options: BuildDepsOptions): PlatformDeps {
  const api = createApiClient({ baseUrl: '', fetch: options.fetch });
  const router = withGuards(
    createRouter(ROUTE_TABLE as unknown as RouteDefinition[]),
  );
  const auth = options.webauthn
    ? createAuthStore({ api, webauthn: options.webauthn })
    : createAuthStore({ api });
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

export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A `WebAuthnClient` whose `register()` does whatever the test needs, and
 * records that it was called.
 */
export interface FakeWebAuthn extends WebAuthnClient {
  readonly registerCalls: number[];
}

export function createFakeWebAuthn(
  register: () => Promise<void> = () => Promise.resolve(),
): FakeWebAuthn {
  const registerCalls: number[] = [];
  return {
    registerCalls,
    register() {
      registerCalls.push(Date.now());
      return register();
    },
    authenticate() {
      return Promise.reject(new Error('not used'));
    },
    authenticateConditional() {
      return Promise.reject(new Error('not used'));
    },
    abortConditional() {
      // no-op
    },
  };
}

/**
 * Make `isWebAuthnAvailable()` true (or false) for the duration of a test.
 * It reads `window.PublicKeyCredential` and nothing else, so this is the whole
 * of the capability as far as the app is concerned. Returns the undo.
 */
export function setWebAuthnAvailable(available: boolean): () => void {
  const key = 'PublicKeyCredential';
  const target = globalThis as unknown as Record<string, unknown>;
  const had = key in target;
  const previous = target[key];
  if (available) {
    target[key] = class FakePublicKeyCredential {};
  } else {
    delete target[key];
  }
  return () => {
    if (had) target[key] = previous;
    else delete target[key];
  };
}
