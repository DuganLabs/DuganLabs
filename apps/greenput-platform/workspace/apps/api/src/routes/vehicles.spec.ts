import { describe, it, expect, vi } from 'vitest';
import { vehiclesRouter } from './vehicles';

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
  const req = new Request(`https://api.greenput.com/api/vehicles${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: userId,
    role: 'owner',
  };
  return req;
}

describe('vehiclesRouter', () => {
  it('exports vehiclesRouter with fetch', () => {
    expect(vehiclesRouter).toBeDefined();
    expect(typeof vehiclesRouter.fetch).toBe('function');
  });
});

describe('GET /api/vehicles', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await vehiclesRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns vehicles list', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'veh-1',
          name: 'Service Van 1',
          make: 'Ford',
          model: 'Transit',
          status: 'active',
        },
      ],
    });
    const res = await vehiclesRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('supports status filter param', async () => {
    const env = makeEnv();
    const res = await vehiclesRouter.fetch(makeReq('/?status=active'), env);
    expect(res.status).toBe(200);
  });

  it('supports search query param', async () => {
    const env = makeEnv();
    const res = await vehiclesRouter.fetch(makeReq('/?q=ford'), env);
    expect(res.status).toBe(200);
  });

  it('respects pagination params', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 50 });
    const res = await vehiclesRouter.fetch(makeReq('/?page=2&perPage=10'), env);
    const body = (await res.json()) as {
      meta: { page: number; perPage: number };
    };
    expect(body.meta.page).toBe(2);
    expect(body.meta.perPage).toBe(10);
  });
});

describe('GET /api/vehicles/:id', () => {
  it('returns 404 when vehicle not found', async () => {
    const env = makeEnv();
    const res = await vehiclesRouter.fetch(makeReq('/veh-not-found'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with vehicle when found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'veh-1',
      name: 'Service Van 1',
      make: 'Ford',
      model: 'Transit',
      status: 'active',
    });
    const res = await vehiclesRouter.fetch(makeReq('/veh-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe('veh-1');
  });
});

describe('POST /api/vehicles', () => {
  it('returns 400 when name is missing', async () => {
    const env = makeEnv();
    const res = await vehiclesRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ make: 'Ford' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status', async () => {
    const env = makeEnv();
    const res = await vehiclesRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Van 1', status: 'broken' }),
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
      id: 'veh-new',
      name: 'Service Van 1',
      make: 'Ford',
      status: 'active',
    });
    const res = await vehiclesRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Service Van 1',
          make: 'Ford',
          model: 'Transit',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe('Service Van 1');
  });
});

describe('PATCH /api/vehicles/:id', () => {
  it('returns 404 when vehicle not found', async () => {
    const env = makeEnv();
    const res = await vehiclesRouter.fetch(
      makeReq('/veh-not-found', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'maintenance' }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when no valid fields are provided', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'veh-1' });
    const res = await vehiclesRouter.fetch(
      makeReq('/veh-1', {
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
      .mockResolvedValueOnce({ id: 'veh-1' })
      .mockResolvedValueOnce({ id: 'veh-1', mileage: 99000, status: 'active' });
    const res = await vehiclesRouter.fetch(
      makeReq('/veh-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mileage: 99000 }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { mileage: number } };
    expect(body.data.mileage).toBe(99000);
  });
});

describe('DELETE /api/vehicles/:id', () => {
  it('returns 404 when vehicle not found', async () => {
    const env = makeEnv();
    const res = await vehiclesRouter.fetch(
      makeReq('/veh-not-found', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 when vehicle is deleted', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'veh-1' });
    const res = await vehiclesRouter.fetch(
      makeReq('/veh-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('vehicles schema validation', () => {
  it('accepts all valid statuses', async () => {
    const { CreateVehicleSchema } = await import('@greenput/shared/validators');
    const statuses = ['active', 'inactive', 'maintenance'];
    for (const status of statuses) {
      const result = CreateVehicleSchema.safeParse({ name: 'Van', status });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid status', async () => {
    const { CreateVehicleSchema } = await import('@greenput/shared/validators');
    const result = CreateVehicleSchema.safeParse({
      name: 'Van',
      status: 'broken',
    });
    expect(result.success).toBe(false);
  });

  it('defaults status to active', async () => {
    const { CreateVehicleSchema } = await import('@greenput/shared/validators');
    const result = CreateVehicleSchema.safeParse({ name: 'Van' });
    if (result.success) expect(result.data.status).toBe('active');
  });

  it('accepts partial PATCH updates', async () => {
    const { UpdateVehicleSchema } = await import('@greenput/shared/validators');
    expect(
      UpdateVehicleSchema.safeParse({ status: 'maintenance' }).success,
    ).toBe(true);
    expect(UpdateVehicleSchema.safeParse({ mileage: 50000 }).success).toBe(
      true,
    );
  });

  it('rejects empty PATCH body', async () => {
    const { UpdateVehicleSchema } = await import('@greenput/shared/validators');
    expect(UpdateVehicleSchema.safeParse({}).success).toBe(false);
  });
});
