import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notificationPreferencesRouter } from './notification-preferences';

function makeEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: [] }),
          run: vi.fn().mockResolvedValue({}),
        }),
      }),
      batch: vi.fn().mockResolvedValue([]),
    },
    SESSIONS: {} as KVNamespace,
    CHAT_ROOM: {} as DurableObjectNamespace,
    ENVIRONMENT: 'development',
  };
}

function makeRequest(
  method: string,
  path: string,
  body?: unknown,
): Request & { user: { id: string }; workspaceId: string } {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  const req = new Request(`https://api.greenput.com${path}`, init);
  // Attach user context as the auth middleware would
  (req as unknown as Record<string, unknown>).user = {
    id: 'u1',
    role: 'owner',
  };
  (req as unknown as Record<string, unknown>).workspaceId = 'w1';
  return req as unknown as Request & {
    user: { id: string };
    workspaceId: string;
  };
}

describe('notification-preferences routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should export notificationPreferencesRouter', () => {
    expect(notificationPreferencesRouter).toBeDefined();
  });

  it('GET /preferences should return user preferences', async () => {
    const env = makeEnv();
    const allMock = vi.fn().mockResolvedValue({
      results: [
        { id: 'p1', event_type: 'new_lead', channel: 'email', enabled: 1 },
        { id: 'p2', event_type: 'new_lead', channel: 'sms', enabled: 0 },
      ],
    });
    env.DB.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ all: allMock }),
    });

    const req = makeRequest('GET', '/api/notifications/preferences');
    const res = await notificationPreferencesRouter.fetch(req, env);
    const json = await res.json<{
      data: Array<{ eventType: string; channel: string; enabled: boolean }>;
    }>();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.data[0].eventType).toBe('new_lead');
    expect(json.data[0].enabled).toBe(true);
    expect(json.data[1].enabled).toBe(false);
  });

  it('PUT /preferences should validate and save preferences', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/api/notifications/preferences', {
      preferences: [
        { eventType: 'new_lead', channel: 'email', enabled: true },
        { eventType: 'payment_received', channel: 'sms', enabled: false },
      ],
    });

    const res = await notificationPreferencesRouter.fetch(req, env);
    const json = await res.json<{ data: { updated: boolean } }>();

    expect(res.status).toBe(200);
    expect(json.data.updated).toBe(true);
    expect(env.DB.batch).toHaveBeenCalled();
  });

  it('PUT /preferences should reject missing preferences array', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/api/notifications/preferences', {});

    const res = await notificationPreferencesRouter.fetch(req, env);

    expect(res.status).toBe(400);
  });

  it('PUT /preferences should reject invalid event type', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/api/notifications/preferences', {
      preferences: [
        { eventType: 'invalid_event', channel: 'email', enabled: true },
      ],
    });

    const res = await notificationPreferencesRouter.fetch(req, env);

    expect(res.status).toBe(400);
  });

  it('PUT /preferences should reject invalid channel', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/api/notifications/preferences', {
      preferences: [
        { eventType: 'new_lead', channel: 'carrier_pigeon', enabled: true },
      ],
    });

    const res = await notificationPreferencesRouter.fetch(req, env);

    expect(res.status).toBe(400);
  });

  it('PUT /preferences should reject entries missing required fields', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/api/notifications/preferences', {
      preferences: [{ eventType: 'new_lead' }],
    });

    const res = await notificationPreferencesRouter.fetch(req, env);

    expect(res.status).toBe(400);
  });

  it('GET /preferences returns empty array when no preferences stored', async () => {
    const env = makeEnv();
    const req = makeRequest('GET', '/api/notifications/preferences');
    const res = await notificationPreferencesRouter.fetch(req, env);
    expect(res.status).toBe(200);
    const json = await res.json<{ data: unknown[] }>();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data).toHaveLength(0);
  });

  it('PUT /preferences returns 400 for empty preferences array', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/api/notifications/preferences', {
      preferences: [],
    });
    const res = await notificationPreferencesRouter.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it('PUT /preferences calls batch with delete + one insert per preference', async () => {
    const env = makeEnv();
    const req = makeRequest('PUT', '/api/notifications/preferences', {
      preferences: [
        { eventType: 'new_lead', channel: 'email', enabled: true },
        { eventType: 'job_status_change', channel: 'sms', enabled: false },
      ],
    });
    await notificationPreferencesRouter.fetch(req, env);
    // 1 DELETE + 2 INSERTs = 3 statements
    const batchArgs = (env.DB.batch as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(batchArgs).toHaveLength(3);
  });
});
