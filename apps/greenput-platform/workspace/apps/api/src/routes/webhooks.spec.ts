import { describe, it, expect, vi } from 'vitest';
import { webhooksRouter } from './webhooks';

function makeEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    },
    SESSIONS: {},
    ENVIRONMENT: 'development',
  };
}

function makeReq(path: string, init: RequestInit = {}, workspaceId = 'ws-1') {
  const req = new Request(`https://api.greenput.com/api/webhooks${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: 'user-1',
    role: 'owner',
  };
  return req;
}

describe('webhooksRouter', () => {
  it('exports webhooksRouter with fetch', () => {
    expect(webhooksRouter).toBeDefined();
    expect(typeof webhooksRouter.fetch).toBe('function');
  });
});

describe('GET /api/webhooks', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await webhooksRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns webhooks list', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'wh-1',
          url: 'https://example.com/hook',
          events: '["lead.created"]',
          active: 1,
        },
      ],
    });
    const res = await webhooksRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });
});

describe('GET /api/webhooks/:id', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await webhooksRouter.fetch(makeReq('/wh-not-found'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with webhook when found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'wh-1',
      url: 'https://example.com/hook',
      active: 1,
    });
    const res = await webhooksRouter.fetch(makeReq('/wh-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe('wh-1');
  });

  it('includes deliveries array in response', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'wh-1',
      url: 'https://example.com/hook',
      active: 1,
    });
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'del-1',
          event_type: 'lead.created',
          status_code: 200,
          attempts: 1,
        },
      ],
    });
    const res = await webhooksRouter.fetch(makeReq('/wh-1'), env);
    const body = (await res.json()) as { data: { deliveries: unknown[] } };
    expect(Array.isArray(body.data.deliveries)).toBe(true);
  });
});

describe('POST /api/webhooks', () => {
  it('returns 400 when url is missing', async () => {
    const env = makeEnv();
    const res = await webhooksRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: ['lead.created'] }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when events array is empty', async () => {
    const env = makeEnv();
    const res = await webhooksRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/hook', events: [] }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 201 on successful creation', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'wh-new',
      url: 'https://example.com/hook',
      active: 1,
    });
    const res = await webhooksRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com/hook',
          events: ['lead.created'],
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('returns 400 for invalid URL string', async () => {
    const env = makeEnv();
    const res = await webhooksRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-url', events: ['lead.created'] }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/webhooks/:id', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await webhooksRouter.fetch(
      makeReq('/wh-not-found', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful update', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'wh-1' })
      .mockResolvedValueOnce({ id: 'wh-1', active: 0 });
    const res = await webhooksRouter.fetch(
      makeReq('/wh-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/webhooks/:id', () => {
  it('returns 404 when not found', async () => {
    const env = makeEnv();
    const res = await webhooksRouter.fetch(
      makeReq('/wh-not-found', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 when deleted', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'wh-1' });
    const res = await webhooksRouter.fetch(
      makeReq('/wh-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it('logs deletion to activity_log (2 run calls)', async () => {
    const env = makeEnv();
    const runMock = vi.fn().mockResolvedValue({});
    const firstMock = vi.fn().mockResolvedValue({ id: 'wh-1' });
    env.DB.prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: firstMock,
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: runMock,
      }),
    });
    await webhooksRouter.fetch(makeReq('/wh-1', { method: 'DELETE' }), env);
    expect(runMock).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/webhooks/:id/test', () => {
  it('returns 404 when webhook not found', async () => {
    const env = makeEnv();
    const res = await webhooksRouter.fetch(
      makeReq('/wh-not-found/test', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with sent:true when webhook found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'wh-1',
      url: 'https://example.com/hook',
      secret: 'abc123',
      events: '["lead.created"]',
    });
    const res = await webhooksRouter.fetch(
      makeReq('/wh-1/test', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { sent: boolean } };
    expect(body.data.sent).toBe(true);
  });
});

describe('webhooks schema validation', () => {
  it('validates required fields', async () => {
    const { CreateWebhookSchema } = await import('@greenput/shared/validators');
    expect(CreateWebhookSchema.safeParse({}).success).toBe(false);
    expect(
      CreateWebhookSchema.safeParse({
        url: 'https://example.com',
        events: ['lead.created'],
      }).success,
    ).toBe(true);
  });

  it('rejects invalid URL', async () => {
    const { CreateWebhookSchema } = await import('@greenput/shared/validators');
    expect(
      CreateWebhookSchema.safeParse({
        url: 'not-a-url',
        events: ['lead.created'],
      }).success,
    ).toBe(false);
  });

  it('accepts wildcard event', async () => {
    const { CreateWebhookSchema } = await import('@greenput/shared/validators');
    expect(
      CreateWebhookSchema.safeParse({
        url: 'https://example.com',
        events: ['*'],
      }).success,
    ).toBe(true);
  });

  it('accepts partial PATCH updates', async () => {
    const { UpdateWebhookSchema } = await import('@greenput/shared/validators');
    expect(UpdateWebhookSchema.safeParse({ active: false }).success).toBe(true);
    expect(UpdateWebhookSchema.safeParse({}).success).toBe(false);
  });
});
