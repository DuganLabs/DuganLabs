import { describe, it, expect, vi } from 'vitest';
import { inventoryRouter } from './inventory';

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
  const req = new Request(
    `https://api.greenput.com/api/inventory${path}`,
    init,
  );
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: 'user-1',
    role: 'owner',
  };
  return req;
}

describe('inventoryRouter', () => {
  it('exports inventoryRouter with fetch', () => {
    expect(inventoryRouter).toBeDefined();
    expect(typeof inventoryRouter.fetch).toBe('function');
  });
});

describe('GET /api/inventory', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns inventory items when present', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'inv-1',
          name: '14 AWG Wire',
          quantity: 100,
          category: 'electrical',
        },
      ],
    });
    const res = await inventoryRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('supports category filter', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(
      makeReq('/?category=electrical'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('supports search query param', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(makeReq('/?q=wire'), env);
    expect(res.status).toBe(200);
  });

  it('supports lowStock filter', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(makeReq('/?lowStock=true'), env);
    expect(res.status).toBe(200);
  });

  it('respects pagination params and returns meta', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 50 });
    const res = await inventoryRouter.fetch(
      makeReq('/?page=2&perPage=10'),
      env,
    );
    const body = (await res.json()) as {
      meta: { page: number; perPage: number; total: number };
    };
    expect(body.meta.page).toBe(2);
    expect(body.meta.perPage).toBe(10);
    expect(body.meta.total).toBe(50);
  });

  it('caps perPage at 100', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(makeReq('/?perPage=999'), env);
    const body = (await res.json()) as { meta: { perPage: number } };
    expect(body.meta.perPage).toBe(100);
  });
});

describe('GET /api/inventory/low-stock', () => {
  it('returns 200 with low-stock items list', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(makeReq('/low-stock'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('supports pagination for low-stock', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(
      makeReq('/low-stock?page=1&perPage=50'),
      env,
    );
    const body = (await res.json()) as {
      meta: { page: number; perPage: number };
    };
    expect(body.meta.page).toBe(1);
    expect(body.meta.perPage).toBe(50);
  });
});

describe('GET /api/inventory/:id', () => {
  it('returns 404 when item not found', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(makeReq('/inv-999'), env);
    expect(res.status).toBe(404);
  });

  it('returns item with transactions when found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'inv-1',
      name: 'Circuit Breaker',
      quantity: 50,
      category: 'electrical',
    });
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [{ id: 'tx-1', type: 'purchase', quantity: 50 }],
    });
    const res = await inventoryRouter.fetch(makeReq('/inv-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; transactions: unknown[] };
    };
    expect(body.data.id).toBe('inv-1');
    expect(Array.isArray(body.data.transactions)).toBe(true);
  });
});

describe('POST /api/inventory', () => {
  it('returns 400 when name is missing', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'electrical' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is empty string', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('creates item and returns 201', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'inv-new',
      name: '14 AWG Wire',
      quantity: 0,
      category: 'general',
    });
    const res = await inventoryRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '14 AWG Wire' }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe('14 AWG Wire');
  });

  it('accepts full item payload', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'inv-full',
      name: 'Circuit Breaker 20A',
      quantity: 50,
    });
    const res = await inventoryRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Circuit Breaker 20A',
          sku: 'CBK-20A',
          category: 'electrical',
          quantity: 50,
          minQuantity: 5,
          unitCost: 1500,
          unitPrice: 2500,
          supplier: 'Acme Electric',
          location: 'Warehouse A',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/inventory/:id', () => {
  it('returns 404 when item not found', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(
      makeReq('/inv-999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 20 }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when body is empty object', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(
      makeReq('/inv-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful update', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'inv-1' })
      .mockResolvedValueOnce({ id: 'inv-1', name: 'Updated', quantity: 20 });
    const res = await inventoryRouter.fetch(
      makeReq('/inv-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: 20 }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/inventory/:id', () => {
  it('returns 404 when item not found', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(
      makeReq('/inv-999', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 and deleted: true on success', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'inv-1' });
    const res = await inventoryRouter.fetch(
      makeReq('/inv-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('POST /api/inventory/:id/transaction', () => {
  it('returns 400 when type is invalid', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(
      makeReq('/inv-1/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'invalid', quantity: 5 }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when quantity is zero', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(
      makeReq('/inv-1/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'purchase', quantity: 0 }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when item not found', async () => {
    const env = makeEnv();
    const res = await inventoryRouter.fetch(
      makeReq('/inv-999/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'purchase', quantity: 5 }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when usage exceeds current stock', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'inv-1',
      quantity: 3,
    });
    const res = await inventoryRouter.fetch(
      makeReq('/inv-1/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'usage', quantity: 5 }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('returns 201 with transactionId and newQuantity on purchase', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'inv-1',
      quantity: 10,
    });
    const res = await inventoryRouter.fetch(
      makeReq('/inv-1/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'purchase', quantity: 5 }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { transactionId: string; newQuantity: number };
    };
    expect(body.data.transactionId).toBeTruthy();
    expect(body.data.newQuantity).toBe(15);
  });

  it('subtracts quantity for usage transaction', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'inv-1',
      quantity: 10,
    });
    const res = await inventoryRouter.fetch(
      makeReq('/inv-1/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'usage', quantity: 3 }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { newQuantity: number } };
    expect(body.data.newQuantity).toBe(7);
  });

  it('accepts adjustment type with signed quantity', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'inv-1',
      quantity: 10,
    });
    const res = await inventoryRouter.fetch(
      makeReq('/inv-1/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'adjustment', quantity: 5 }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { newQuantity: number } };
    expect(body.data.newQuantity).toBe(15);
  });
});
