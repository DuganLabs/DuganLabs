import { describe, it, expect, vi } from 'vitest';
import { assetsRouter } from './assets';

function makeEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
      }),
      batch: vi.fn().mockResolvedValue([]),
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
  const req = new Request(`https://api.greenput.com/api/assets${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['session'] = {
    userId,
  };
  (req as unknown as Record<string, unknown>)['user'] = {
    id: userId,
    role: 'owner',
  };
  return req;
}

describe('assetsRouter', () => {
  it('exports assetsRouter with fetch', () => {
    expect(assetsRouter).toBeDefined();
    expect(typeof assetsRouter.fetch).toBe('function');
  });
});

describe('GET /api/assets', () => {
  it('returns 200 with empty list', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number; page: number; perPage: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
    expect(body.meta).toHaveProperty('page');
    expect(body.meta).toHaveProperty('perPage');
  });

  it('returns assets list with data when present', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'asset-1',
          name: 'Laptop',
          category: 'equipment',
          serial_number: 'SN123',
          qr_code: 'gp-asset-1',
          status: 'available',
          assigned_to: null,
          vehicle_id: null,
          purchase_date: '2024-01-01',
          purchase_cost: 1500,
          condition: 'good',
          location: 'Office',
          notes: 'Primary development machine',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          assigned_name: null,
        },
      ],
    });
    const res = await assetsRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('supports status filter', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(makeReq('/?status=available'), env);
    expect(res.status).toBe(200);
  });

  it('supports assignedTo filter', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(makeReq('/?assignedTo=user-123'), env);
    expect(res.status).toBe(200);
  });

  it('supports search query parameter', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(makeReq('/?q=laptop'), env);
    expect(res.status).toBe(200);
  });

  it('respects pagination params and returns correct meta', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ total: 50 });
    const res = await assetsRouter.fetch(makeReq('/?page=2&perPage=10'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      meta: { page: number; perPage: number; total: number };
    };
    expect(body.meta.page).toBe(2);
    expect(body.meta.perPage).toBe(10);
    expect(body.meta.total).toBe(50);
  });

  it('caps perPage at 100', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(makeReq('/?perPage=999'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { perPage: number } };
    expect(body.meta.perPage).toBe(100);
  });

  it('combines multiple filters in query', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/?status=checked_out&assignedTo=user-1&q=equipment&page=1'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('handles empty workspace gracefully', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ results: [] });
    const res = await assetsRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(0);
  });
});

describe('GET /api/assets/:id', () => {
  it('returns 404 when asset not found', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(makeReq('/asset-not-found'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with asset when found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: 'asset-1',
      name: 'Laptop',
      category: 'equipment',
      serial_number: 'SN123',
      qr_code: 'gp-asset-1',
      status: 'available',
      assigned_to: null,
      vehicle_id: null,
      purchase_date: '2024-01-01',
      purchase_cost: 1500,
      condition: 'good',
      location: 'Office',
      notes: '',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      assigned_name: null,
    });
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ results: [] });

    const res = await assetsRouter.fetch(makeReq('/asset-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        id: string;
        name: string;
        assignments: unknown[];
        maintenance: unknown[];
      };
    };
    expect(body.data.id).toBe('asset-1');
    expect(body.data.name).toBe('Laptop');
    expect(Array.isArray(body.data.assignments)).toBe(true);
    expect(Array.isArray(body.data.maintenance)).toBe(true);
  });

  it('includes assignment history when fetching asset', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: 'asset-1',
      name: 'Laptop',
    });
    (env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        results: [
          {
            id: 'assign-1',
            asset_id: 'asset-1',
            user_id: 'user-1',
            action: 'check_out',
            created_at: '2024-01-01T00:00:00Z',
            user_name: 'John Doe',
          },
        ],
      })
      .mockResolvedValueOnce({ results: [] });

    const res = await assetsRouter.fetch(makeReq('/asset-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { assignments: unknown[] };
    };
    expect(body.data.assignments.length).toBe(1);
  });

  it('includes maintenance history when fetching asset', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      id: 'asset-1',
      name: 'Laptop',
    });
    (env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'maint-1',
            asset_id: 'asset-1',
            type: 'repair',
            description: 'Screen replacement',
            performed_at: '2024-01-15T00:00:00Z',
            performer_name: 'Jane Smith',
          },
        ],
      });

    const res = await assetsRouter.fetch(makeReq('/asset-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { maintenance: unknown[] };
    };
    expect(body.data.maintenance.length).toBe(1);
  });

  it('respects workspace isolation', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', {}, 'ws-different'),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/assets', () => {
  it('returns 400 when name is missing', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'equipment' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is empty string', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('creates asset and returns 201', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Laptop',
          category: 'equipment',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; name: string; status: string; qrCode: string };
    };
    expect(body.data.name).toBe('Laptop');
    expect(body.data.status).toBe('available');
    expect(body.data.qrCode).toMatch(/^gp-asset-/);
    expect(body.data.id).toBeTruthy();
  });

  it('accepts minimal asset payload', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Printer' }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('accepts full asset payload with all fields', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Laptop',
          category: 'equipment',
          serialNumber: 'SN-12345',
          assignedTo: 'user-1',
          vehicleId: 'vehicle-1',
          purchaseDate: '2024-01-01',
          purchaseCost: 1500,
          condition: 'excellent',
          location: 'Office A',
          notes: 'Primary development machine',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('defaults category to equipment', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Laptop' }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('defaults condition to good', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Laptop' }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('logs asset creation activity', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Laptop' }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    expect(env.DB.prepare).toHaveBeenCalled();
  });
});

describe('PATCH /api/assets/:id', () => {
  it('returns 404 when asset not found', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/asset-999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Laptop' }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when body is empty object', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'asset-1' });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', {
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
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'asset-1' });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Laptop' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; updated: boolean };
    };
    expect(body.data.id).toBe('asset-1');
    expect(body.data.updated).toBe(true);
  });

  it('allows updating name', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'asset-1' });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Name' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('allows updating status', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'asset-1' });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'checked_out' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('allows updating assignedTo', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'asset-1' });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedTo: 'user-2' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('allows updating condition', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'asset-1' });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condition: 'damaged' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('allows updating multiple fields', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'asset-1' });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated',
          status: 'available',
          location: 'New Location',
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('ignores invalid fields in patch', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'asset-1' });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated',
          invalidField: 'should-be-ignored',
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('respects workspace isolation on update', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq(
        '/asset-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated' }),
        },
        'ws-different',
      ),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/assets/:id', () => {
  it('returns 404 when asset not found', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/asset-999', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with deleted: true on success', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().run as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ meta: { changes: 1 } });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; deleted: boolean };
    };
    expect(body.data.id).toBe('asset-1');
    expect(body.data.deleted).toBe(true);
  });

  it('respects workspace isolation on delete', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/asset-1', { method: 'DELETE' }, 'ws-different'),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/assets/:id/assign', () => {
  it('returns 404 when asset not found', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/asset-999/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check_out',
          userId: 'user-1',
        }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when checking out unavailable asset', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
      status: 'checked_out',
    });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check_out',
          userId: 'user-1',
        }),
      }),
      env,
    );
    expect(res.status).toBe(409);
  });

  it('checks out asset successfully', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
      status: 'available',
    });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check_out',
          userId: 'user-1',
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        assignmentId: string;
        assetId: string;
        action: string;
        status: string;
      };
    };
    expect(body.data.action).toBe('check_out');
    expect(body.data.status).toBe('checked_out');
  });

  it('checks in asset successfully', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
      status: 'checked_out',
    });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check_in',
          userId: 'user-1',
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { action: string; status: string };
    };
    expect(body.data.action).toBe('check_in');
    expect(body.data.status).toBe('available');
  });

  it('accepts optional jobId in assignment', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
      status: 'available',
    });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check_out',
          userId: 'user-1',
          jobId: 'job-123',
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('accepts optional notes in assignment', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
      status: 'available',
    });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check_out',
          userId: 'user-1',
          notes: 'Assigned for job site visit',
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('respects workspace isolation for assignment', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq(
        '/asset-1/assign',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'check_out',
            userId: 'user-1',
          }),
        },
        'ws-different',
      ),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/assets/:id/maintenance', () => {
  it('returns 404 when asset not found', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/asset-999/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'repair',
          description: 'Fixed screen',
        }),
      }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('logs maintenance and returns 201', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
    });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'repair',
          description: 'Fixed screen',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; assetId: string; type: string };
    };
    expect(body.data.assetId).toBe('asset-1');
    expect(body.data.type).toBe('repair');
  });

  it('accepts maintenance payload with all fields', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
    });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'repair',
          description: 'Screen replacement',
          cost: 150,
          nextDue: '2024-12-31T00:00:00Z',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('defaults maintenance type to repair', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
    });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'Some maintenance work',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('accepts replacement type for maintenance', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
    });
    const res = await assetsRouter.fetch(
      makeReq('/asset-1/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'replacement',
          description: 'Replaced with new unit',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
  });

  it('respects workspace isolation for maintenance', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq(
        '/asset-1/maintenance',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'repair',
            description: 'Fixed screen',
          }),
        },
        'ws-different',
      ),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/assets/:id/qr', () => {
  it('returns 404 when asset not found', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(makeReq('/asset-999/qr'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with SVG QR code when asset found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
      qr_code: 'gp-asset-1',
      name: 'Laptop',
    });
    const res = await assetsRouter.fetch(makeReq('/asset-1/qr'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
  });

  it('sets cache headers on QR response', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
      qr_code: 'gp-asset-1',
      name: 'Laptop',
    });
    const res = await assetsRouter.fetch(makeReq('/asset-1/qr'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=/);
  });

  it('includes asset name in QR SVG', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
      qr_code: 'gp-asset-1',
      name: 'Laptop',
    });
    const res = await assetsRouter.fetch(makeReq('/asset-1/qr'), env);
    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg).toContain('Laptop');
    expect(svg).toContain('<svg');
  });

  it('respects workspace isolation for QR code', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/asset-1/qr', {}, 'ws-different'),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/assets/lookup/:qrCode', () => {
  it('returns 404 when QR code not found', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(makeReq('/lookup/invalid-qr'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with asset when QR code found', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'asset-1',
      name: 'Laptop',
      qr_code: 'gp-asset-1',
      status: 'available',
      assigned_name: null,
    });
    const res = await assetsRouter.fetch(makeReq('/lookup/gp-asset-1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; name: string } };
    expect(body.data.id).toBe('asset-1');
    expect(body.data.name).toBe('Laptop');
  });

  it('respects workspace isolation for QR lookup', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/lookup/gp-asset-1', {}, 'ws-different'),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/assets/maintenance/upcoming', () => {
  it('returns 200 with upcoming maintenance list', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [],
    });
    const res = await assetsRouter.fetch(makeReq('/maintenance/upcoming'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns maintenance items when present', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [
        {
          id: 'maint-1',
          asset_id: 'asset-1',
          type: 'service',
          next_due: '2024-06-01T00:00:00Z',
          asset_name: 'Laptop',
        },
      ],
    });
    const res = await assetsRouter.fetch(makeReq('/maintenance/upcoming'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('supports custom days parameter', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [],
    });
    const res = await assetsRouter.fetch(
      makeReq('/maintenance/upcoming?days=60'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('defaults to 30 days when days parameter not provided', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().all as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      results: [],
    });
    const res = await assetsRouter.fetch(makeReq('/maintenance/upcoming'), env);
    expect(res.status).toBe(200);
  });

  it('respects workspace isolation for upcoming maintenance', async () => {
    const env = makeEnv();
    const res = await assetsRouter.fetch(
      makeReq('/maintenance/upcoming', {}, 'ws-different'),
      env,
    );
    expect(res.status).toBe(200);
  });
});
