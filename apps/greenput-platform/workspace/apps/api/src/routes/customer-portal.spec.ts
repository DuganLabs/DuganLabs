import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Env ──────────────────────────────────────────────────

interface MockD1Result {
  results: Record<string, unknown>[];
  meta: Record<string, unknown>;
  success: boolean;
}

function createMockEnv() {
  const kvStore = new Map<string, string>();

  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({
          results: [],
          meta: {},
          success: true,
        } as MockD1Result),
        run: vi.fn().mockResolvedValue({ meta: {}, success: true }),
      }),
    },
    SESSIONS: {
      get: vi.fn((key: string) => Promise.resolve(kvStore.get(key) ?? null)),
      put: vi.fn((key: string, value: string) => {
        kvStore.set(key, value);
        return Promise.resolve();
      }),
      delete: vi.fn((key: string) => {
        kvStore.delete(key);
        return Promise.resolve();
      }),
    },
    ENVIRONMENT: 'development',
    _kvStore: kvStore,
  };
}

// ── Import after mocks ────────────────────────────────────────

// We test the router by calling .fetch() directly with constructed Requests

import { portalRouter } from './customer-portal';

describe('customer-portal routes', () => {
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    env = createMockEnv();
    vi.clearAllMocks();
  });

  function makeRequest(
    method: string,
    path: string,
    options?: { body?: unknown; cookie?: string },
  ): Request {
    const url = `http://localhost:8787/api/portal${path}`;
    const headers = new Headers();
    if (options?.cookie) {
      headers.set('cookie', options.cookie);
    }
    if (options?.body) {
      headers.set('content-type', 'application/json');
    }
    return new Request(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  }

  async function fetchPortal(
    method: string,
    path: string,
    options?: { body?: unknown; cookie?: string },
  ): Promise<Response> {
    const req = makeRequest(method, path, options);
    return portalRouter.fetch(
      req,
      env as unknown as Parameters<typeof portalRouter.fetch>[1],
    );
  }

  describe('POST /api/portal/magic-link', () => {
    it('should return success even if customer is not found (prevents enumeration)', async () => {
      const response = await fetchPortal('POST', '/magic-link', {
        body: { email: 'nonexistent@example.com' },
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as Record<string, unknown>;
      expect(data).toEqual({ data: { sent: true } });
    });

    it('should return error if email is missing', async () => {
      const response = await fetchPortal('POST', '/magic-link', {
        body: {},
      });

      expect(response.status).toBe(400);
    });

    it('should create a portal token when customer exists', async () => {
      const mockCustomer = {
        id: 'cust-1',
        workspace_id: 'ws-1',
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
      };

      const mockPrepare = env.DB.prepare as ReturnType<typeof vi.fn>;
      const firstCall = vi.fn().mockResolvedValue(mockCustomer);
      const runCall = vi.fn().mockResolvedValue({ meta: {}, success: true });

      let callCount = 0;
      mockPrepare.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { bind: vi.fn().mockReturnValue({ first: firstCall }) };
        }
        return { bind: vi.fn().mockReturnValue({ run: runCall }) };
      });

      const response = await fetchPortal('POST', '/magic-link', {
        body: { email: 'jane@example.com' },
      });

      expect(response.status).toBe(200);
      expect(runCall).toHaveBeenCalled();
    });
  });

  describe('GET /api/portal/verify', () => {
    it('should return error when token is missing', async () => {
      const response = await fetchPortal('GET', '/verify');

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: { code: string } };
      expect(data.error.code).toBe('MISSING_TOKEN');
    });

    it('should return error when token is invalid', async () => {
      const mockPrepare = env.DB.prepare as ReturnType<typeof vi.fn>;
      mockPrepare.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      });

      const response = await fetchPortal('GET', '/verify?token=invalid-token');

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: { code: string } };
      expect(data.error.code).toBe('INVALID_TOKEN');
    });

    it('should return error when token is expired', async () => {
      const mockRecord = {
        id: 'pt-1',
        customer_id: 'cust-1',
        workspace_id: 'ws-1',
        token: 'valid-token',
        expires_at: new Date(Date.now() - 60000).toISOString(), // expired
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
      };

      const mockPrepare = env.DB.prepare as ReturnType<typeof vi.fn>;
      mockPrepare.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(mockRecord),
        }),
      });

      const response = await fetchPortal('GET', '/verify?token=valid-token');

      expect(response.status).toBe(400);
      const data = (await response.json()) as { error: { code: string } };
      expect(data.error.code).toBe('TOKEN_EXPIRED');
    });

    it('should create session and return customer data for valid token', async () => {
      const mockRecord = {
        id: 'pt-1',
        customer_id: 'cust-1',
        workspace_id: 'ws-1',
        token: 'valid-token',
        expires_at: new Date(Date.now() + 600000).toISOString(), // 10 min from now
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
      };

      const mockPrepare = env.DB.prepare as ReturnType<typeof vi.fn>;
      let callCount = 0;
      mockPrepare.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue(mockRecord),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ meta: {}, success: true }),
          }),
        };
      });

      const response = await fetchPortal('GET', '/verify?token=valid-token');

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        data: { customer: Record<string, unknown> };
      };
      expect(data.data.customer.id).toBe('cust-1');
      expect(data.data.customer.email).toBe('jane@example.com');

      // Check Set-Cookie header
      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).toContain('gp_portal=');

      // Check session was stored in KV
      expect(env.SESSIONS.put).toHaveBeenCalled();
    });
  });

  describe('GET /api/portal/jobs', () => {
    it('should return 401 without portal session', async () => {
      const response = await fetchPortal('GET', '/jobs');
      expect(response.status).toBe(401);
    });

    it('should return jobs for authenticated customer', async () => {
      // Set up portal session
      const session = {
        customerId: 'cust-1',
        workspaceId: 'ws-1',
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
      };
      env._kvStore.set('portal:test-session', JSON.stringify(session));

      const mockJobs = [
        {
          id: 'job-1',
          job_number: 'J-1001',
          title: 'Panel Upgrade',
          status: 'scheduled',
          scheduled_start: '2026-04-01T09:00:00Z',
          scheduled_end: '2026-04-01T17:00:00Z',
          total: 2500,
        },
      ];

      const mockPrepare = env.DB.prepare as ReturnType<typeof vi.fn>;
      let callCount = 0;
      mockPrepare.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: mockJobs }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ total: 1 }),
          }),
        };
      });

      const response = await fetchPortal('GET', '/jobs', {
        cookie: 'gp_portal=test-session',
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        data: unknown[];
        meta: { total: number };
      };
      expect(data.data).toHaveLength(1);
      expect(data.meta.total).toBe(1);
    });
  });

  describe('GET /api/portal/jobs/:id', () => {
    it('should return 401 without portal session', async () => {
      const response = await fetchPortal('GET', '/jobs/job-1');
      expect(response.status).toBe(401);
    });

    it('should return 404 for non-existent job', async () => {
      const session = {
        customerId: 'cust-1',
        workspaceId: 'ws-1',
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
      };
      env._kvStore.set('portal:test-session', JSON.stringify(session));

      const mockPrepare = env.DB.prepare as ReturnType<typeof vi.fn>;
      mockPrepare.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      });

      const response = await fetchPortal('GET', '/jobs/nonexistent', {
        cookie: 'gp_portal=test-session',
      });

      expect(response.status).toBe(404);
    });

    it('should return job with line items', async () => {
      const session = {
        customerId: 'cust-1',
        workspaceId: 'ws-1',
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
      };
      env._kvStore.set('portal:test-session', JSON.stringify(session));

      const mockJob = {
        id: 'job-1',
        job_number: 'J-1001',
        title: 'Panel Upgrade',
        status: 'scheduled',
        total: 2500,
      };
      const mockLineItems = [
        {
          id: 'li-1',
          description: 'Labor',
          quantity: 8,
          unit_price: 150,
          total: 1200,
        },
        {
          id: 'li-2',
          description: 'Materials',
          quantity: 1,
          unit_price: 1300,
          total: 1300,
        },
      ];

      const mockPrepare = env.DB.prepare as ReturnType<typeof vi.fn>;
      let callCount = 0;
      mockPrepare.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue(mockJob),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: mockLineItems }),
          }),
        };
      });

      const response = await fetchPortal('GET', '/jobs/job-1', {
        cookie: 'gp_portal=test-session',
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        data: { lineItems: unknown[] };
      };
      expect(data.data.lineItems).toHaveLength(2);
    });
  });

  describe('GET /api/portal/estimates', () => {
    it('should return 401 without portal session', async () => {
      const response = await fetchPortal('GET', '/estimates');
      expect(response.status).toBe(401);
    });

    it('should return estimates for authenticated customer', async () => {
      const session = {
        customerId: 'cust-1',
        workspaceId: 'ws-1',
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
      };
      env._kvStore.set('portal:test-session', JSON.stringify(session));

      const mockEstimates = [
        {
          id: 'est-1',
          estimate_number: 'E-1001',
          title: 'Kitchen Rewire',
          status: 'sent',
          total: 3200,
        },
      ];

      const mockPrepare = env.DB.prepare as ReturnType<typeof vi.fn>;
      let callCount = 0;
      mockPrepare.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: mockEstimates }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ total: 1 }),
          }),
        };
      });

      const response = await fetchPortal('GET', '/estimates', {
        cookie: 'gp_portal=test-session',
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        data: unknown[];
        meta: { total: number };
      };
      expect(data.data).toHaveLength(1);
    });
  });

  describe('GET /api/portal/invoices', () => {
    it('should return 401 without portal session', async () => {
      const response = await fetchPortal('GET', '/invoices');
      expect(response.status).toBe(401);
    });

    it('should return invoiced/paid jobs', async () => {
      const session = {
        customerId: 'cust-1',
        workspaceId: 'ws-1',
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
      };
      env._kvStore.set('portal:test-session', JSON.stringify(session));

      const mockInvoices = [
        {
          id: 'job-2',
          job_number: 'J-1002',
          title: 'Outlet Repair',
          status: 'paid',
          total: 350,
          invoiced_at: '2026-03-10T00:00:00Z',
          paid_at: '2026-03-15T00:00:00Z',
        },
      ];

      const mockPrepare = env.DB.prepare as ReturnType<typeof vi.fn>;
      let callCount = 0;
      mockPrepare.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: mockInvoices }),
            }),
          };
        }
        return {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ total: 1 }),
          }),
        };
      });

      const response = await fetchPortal('GET', '/invoices', {
        cookie: 'gp_portal=test-session',
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        data: unknown[];
        meta: { total: number };
      };
      expect(data.data).toHaveLength(1);
    });
  });
});
