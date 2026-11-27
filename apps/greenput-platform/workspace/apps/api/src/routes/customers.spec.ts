import { describe, it, expect, vi } from 'vitest';
import { customersRouter } from './customers';

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

function makeReq(
  path: string,
  init: RequestInit = {},
  workspaceId = 'ws-1',
  userId = 'user-1',
) {
  const req = new Request(
    `https://api.greenput.com/api/customers${path}`,
    init,
  );
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: userId,
    role: 'owner',
  };
  return req;
}

describe('customersRouter', () => {
  it('exports customersRouter with fetch', () => {
    expect(customersRouter).toBeDefined();
    expect(typeof customersRouter.fetch).toBe('function');
  });
});

describe('GET /api/customers', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await customersRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns customers list', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [{ id: 'cust-1', first_name: 'Jane', last_name: 'Smith' }],
    });
    const res = await customersRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('supports search query param', async () => {
    const env = makeEnv();
    const res = await customersRouter.fetch(makeReq('/?q=smith'), env);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/customers/:id', () => {
  it('returns 404 when customer not found', async () => {
    const env = makeEnv();
    const res = await customersRouter.fetch(makeReq('/cust-not-found'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with customer and job history', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'cust-1',
      first_name: 'Jane',
      last_name: 'Smith',
    });
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [{ id: 'job-1', title: 'Panel Upgrade' }],
    });
    const res = await customersRouter.fetch(makeReq('/cust-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; jobs: unknown[] };
    };
    expect(body.data.id).toBe('cust-1');
    expect(Array.isArray(body.data.jobs)).toBe(true);
  });
});

describe('POST /api/customers', () => {
  it('returns 400 when required fields are missing', async () => {
    const env = makeEnv();
    const res = await customersRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'no name' }),
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
      id: 'cust-new',
      first_name: 'Jane',
      last_name: 'Smith',
    });
    const res = await customersRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: 'Jane', lastName: 'Smith' }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe('cust-new');
  });
});

describe('PATCH /api/customers/:id', () => {
  it('returns 404 when customer not found', async () => {
    const env = makeEnv();
    const res = await customersRouter.fetch(
      makeReq('/cust-not-found', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '555-1234' }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful update', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'cust-1' })
      .mockResolvedValueOnce({ id: 'cust-1', phone: '555-9876' });
    const res = await customersRouter.fetch(
      makeReq('/cust-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '555-9876' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid consentMethod', async () => {
    const env = makeEnv();
    const res = await customersRouter.fetch(
      makeReq('/cust-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consentMethod: 'invalid' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/customers/:id', () => {
  it('returns 404 when customer not found', async () => {
    const env = makeEnv();
    const res = await customersRouter.fetch(
      makeReq('/cust-not-found', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when customer has active jobs', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'cust-1' })
      .mockResolvedValueOnce({ cnt: 2 });
    const res = await customersRouter.fetch(
      makeReq('/cust-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 when customer is deleted', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'cust-1' })
      .mockResolvedValueOnce({ cnt: 0 });
    const res = await customersRouter.fetch(
      makeReq('/cust-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('customers schema validation', () => {
  it('validates required fields', async () => {
    const { CreateCustomerSchema } =
      await import('@greenput/shared/validators');
    expect(CreateCustomerSchema.safeParse({}).success).toBe(false);
    expect(
      CreateCustomerSchema.safeParse({ firstName: 'Jane', lastName: 'Smith' })
        .success,
    ).toBe(true);
  });

  it('defaults preferredContact to phone', async () => {
    const { CreateCustomerSchema } =
      await import('@greenput/shared/validators');
    const result = CreateCustomerSchema.safeParse({
      firstName: 'Jane',
      lastName: 'Smith',
    });
    if (result.success) expect(result.data.preferredContact).toBe('phone');
  });

  it('accepts valid consentMethod values', async () => {
    const { UpdateCustomerSchema } =
      await import('@greenput/shared/validators');
    for (const method of ['form', 'verbal', 'email']) {
      expect(
        UpdateCustomerSchema.safeParse({ consentMethod: method }).success,
      ).toBe(true);
    }
  });

  it('accepts partial PATCH updates', async () => {
    const { UpdateCustomerSchema } =
      await import('@greenput/shared/validators');
    expect(UpdateCustomerSchema.safeParse({ phone: '555-0001' }).success).toBe(
      true,
    );
    expect(UpdateCustomerSchema.safeParse({ notes: 'vip' }).success).toBe(true);
  });
});
