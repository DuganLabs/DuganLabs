import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Helpers to build a minimal D1-like mock ─────────────────

interface MockStatement {
  bind: (...args: unknown[]) => MockStatement;
  first: <T>() => Promise<T | null>;
  all: () => Promise<{ results: unknown[] }>;
  run: () => Promise<void>;
}

function mockStatement(result: unknown = null): MockStatement {
  const stmt: MockStatement = {
    bind: () => stmt,
    first: () => Promise.resolve(result as ReturnType<typeof stmt.first>),
    all: () =>
      Promise.resolve({ results: Array.isArray(result) ? result : [] }),
    run: () => Promise.resolve(),
  };
  return stmt;
}

function createMockEnv(prepareResults: unknown[] = []) {
  let callIndex = 0;
  return {
    DB: {
      prepare: vi.fn(() => {
        const result = prepareResults[callIndex] ?? null;
        callIndex++;
        return mockStatement(result);
      }),
    },
    SESSIONS: {} as KVNamespace,
    CHAT_ROOM: {} as DurableObjectNamespace,
    ENVIRONMENT: 'test',
  };
}

function buildRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request {
  const url = `https://api.greenput.com${path}`;
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

describe('public routes', () => {
  it('exports publicRouter', async () => {
    const mod = await import('./public');
    expect(mod.publicRouter).toBeDefined();
    expect(typeof mod.publicRouter.fetch).toBe('function');
  });

  describe('POST /api/public/leads', () => {
    it('returns 400 for invalid JSON', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv();
      const req = new Request('https://api.greenput.com/api/public/leads', {
        method: 'POST',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: { code: string } };
      expect(data.error.code).toBe('BAD_REQUEST');
    });

    it('returns 201 silently when honeypot is filled', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv();
      const req = buildRequest('POST', '/api/public/leads', {
        slug: 'demo',
        firstName: 'Bot',
        lastName: 'Spam',
        email: 'bot@spam.com',
        website: 'http://spam.com', // honeypot filled
      });
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(201);
      // DB should NOT have been called
      expect(env.DB.prepare).not.toHaveBeenCalled();
    });

    it('returns 400 when slug is missing', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv();
      const req = buildRequest('POST', '/api/public/leads', {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      });
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(400);
    });

    it('returns 400 when firstName is missing', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv();
      const req = buildRequest('POST', '/api/public/leads', {
        slug: 'demo',
        lastName: 'Doe',
        email: 'jane@example.com',
      });
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(400);
    });

    it('returns 400 when neither email nor phone provided', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv();
      const req = buildRequest('POST', '/api/public/leads', {
        slug: 'demo',
        firstName: 'Jane',
        lastName: 'Doe',
      });
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: { message: string } };
      expect(data.error.message).toBe('Email or phone is required');
    });

    it('returns 400 for invalid email format', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv();
      const req = buildRequest('POST', '/api/public/leads', {
        slug: 'demo',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'not-an-email',
      });
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: { message: string } };
      expect(data.error.message).toBe('Invalid email address');
    });

    it('returns 404 when workspace slug not found', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv([null]); // workspace query returns null
      const req = buildRequest('POST', '/api/public/leads', {
        slug: 'nonexistent',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      });
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(404);
    });

    it('returns 201 on successful submission', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv([
        { id: 'ws-1' }, // workspace lookup
        { id: 'owner-1' }, // owner lookup
        undefined, // lead insert
        undefined, // form_submissions insert
        undefined, // activity_log insert
      ]);
      const req = buildRequest('POST', '/api/public/leads', {
        slug: 'demo',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        serviceType: 'Electrical',
        notes: 'Need panel upgrade',
      });
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(201);
      const data = (await res.json()) as { data: { message: string } };
      expect(data.data.message).toContain('Thank you');
    });

    it('does not fire a lead meter event at creation — billing only happens at booking', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv([
        { id: 'ws-1' },
        { id: 'owner-1' },
        undefined,
        undefined,
        undefined,
      ]);
      const req = buildRequest('POST', '/api/public/leads', {
        slug: 'demo',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        serviceType: 'HVAC tune-up',
      });
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(201);
      const calls = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls;
      expect(
        calls.some((call) => String(call[0]).includes('lead_meter_events')),
      ).toBe(false);
    });

    it('accepts phone-only submissions (no email)', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv([
        { id: 'ws-1' },
        { id: 'owner-1' },
        undefined,
        undefined,
        undefined,
      ]);
      const req = buildRequest('POST', '/api/public/leads', {
        slug: 'demo',
        firstName: 'John',
        lastName: 'Smith',
        phone: '555-123-4567',
      });
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/public/workspace/:slug', () => {
    it('returns 404 for unknown slug', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv([null]);
      const req = buildRequest('GET', '/api/public/workspace/nonexistent');
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(404);
    });

    it('returns workspace info for valid slug', async () => {
      const { publicRouter } = await import('./public');
      const env = createMockEnv([
        { name: 'Sparky Electric', trade: 'Electrical', phone: '555-999-0000' },
      ]);
      const req = buildRequest('GET', '/api/public/workspace/sparky');
      const res = await publicRouter.fetch(req, env);
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        data: { name: string; trade: string; phone: string };
      };
      expect(data.data.name).toBe('Sparky Electric');
      expect(data.data.trade).toBe('Electrical');
      expect(data.data.phone).toBe('555-999-0000');
    });
  });
});
