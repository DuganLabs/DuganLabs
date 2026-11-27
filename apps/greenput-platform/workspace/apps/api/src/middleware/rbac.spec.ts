import { describe, it, expect } from 'vitest';
import { requireRole } from './rbac';

function makeRequest(role: string | null) {
  const req: Record<string, unknown> = {};
  if (role !== null) {
    req.user = {
      id: 'u1',
      workspaceId: 'ws1',
      email: 'u@e.com',
      role,
      firstName: 'A',
      lastName: 'B',
    };
  }
  return req as any;
}

describe('requireRole', () => {
  describe('owner-only routes', () => {
    const guard = requireRole('owner');

    it('allows owner', () => {
      expect(guard(makeRequest('owner'))).toBeUndefined();
    });

    it('rejects admin', () => {
      const res = guard(makeRequest('admin'));
      expect(res).toBeDefined();
      expect((res as Response).status).toBe(403);
    });

    it('rejects office', () => {
      const res = guard(makeRequest('office'));
      expect(res).toBeDefined();
      expect((res as Response).status).toBe(403);
    });

    it('rejects tech', () => {
      const res = guard(makeRequest('tech'));
      expect(res).toBeDefined();
      expect((res as Response).status).toBe(403);
    });
  });

  describe('admin-minimum routes', () => {
    const guard = requireRole('admin');

    it('allows owner', () => {
      expect(guard(makeRequest('owner'))).toBeUndefined();
    });

    it('allows admin', () => {
      expect(guard(makeRequest('admin'))).toBeUndefined();
    });

    it('rejects office', () => {
      const res = guard(makeRequest('office'));
      expect(res).toBeDefined();
      expect((res as Response).status).toBe(403);
    });

    it('rejects tech', () => {
      const res = guard(makeRequest('tech'));
      expect(res).toBeDefined();
      expect((res as Response).status).toBe(403);
    });
  });

  describe('office-minimum routes', () => {
    const guard = requireRole('office');

    it('allows owner', () => {
      expect(guard(makeRequest('owner'))).toBeUndefined();
    });

    it('allows admin', () => {
      expect(guard(makeRequest('admin'))).toBeUndefined();
    });

    it('allows office', () => {
      expect(guard(makeRequest('office'))).toBeUndefined();
    });

    it('rejects tech', () => {
      const res = guard(makeRequest('tech'));
      expect(res).toBeDefined();
      expect((res as Response).status).toBe(403);
    });
  });

  describe('tech-minimum routes (any authenticated user)', () => {
    const guard = requireRole('tech');

    it('allows owner', () => {
      expect(guard(makeRequest('owner'))).toBeUndefined();
    });

    it('allows admin', () => {
      expect(guard(makeRequest('admin'))).toBeUndefined();
    });

    it('allows office', () => {
      expect(guard(makeRequest('office'))).toBeUndefined();
    });

    it('allows tech', () => {
      expect(guard(makeRequest('tech'))).toBeUndefined();
    });
  });

  describe('unauthenticated requests', () => {
    it('returns 401 when no user on request', () => {
      const guard = requireRole('admin');
      const res = guard(makeRequest(null));
      expect(res).toBeDefined();
      expect((res as Response).status).toBe(401);
    });
  });
});

describe('requireRole error bodies', () => {
  it('403 response includes FORBIDDEN error code', async () => {
    const guard = requireRole('admin');
    const res = guard(makeRequest('tech')) as Response;
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('401 response includes UNAUTHORIZED error code', async () => {
    const guard = requireRole('admin');
    const res = guard(makeRequest(null)) as Response;
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('403 message mentions the required role', async () => {
    const guard = requireRole('owner');
    const res = guard(makeRequest('admin')) as Response;
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('owner');
  });
});

describe('requireRole boundary cases', () => {
  it('office cannot access owner-only route', () => {
    const guard = requireRole('owner');
    const res = guard(makeRequest('office'));
    expect((res as Response).status).toBe(403);
  });

  it('tech cannot access office-minimum route', () => {
    const guard = requireRole('office');
    const res = guard(makeRequest('tech'));
    expect((res as Response).status).toBe(403);
  });

  it('returning undefined means middleware continues (no Response returned)', () => {
    const guard = requireRole('tech');
    const result = guard(makeRequest('owner'));
    expect(result).toBeUndefined();
  });
});
