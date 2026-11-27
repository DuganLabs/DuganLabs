import { describe, it, expect, vi, afterEach } from 'vitest';
import { customDomainRouter } from './custom-domains';

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
    },
    ENVIRONMENT: 'development',
    ...overrides,
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  {
    workspaceId = 'ws-1',
    role = 'owner',
  }: { workspaceId?: string; role?: string } = {},
) {
  const req = new Request(
    `https://api.greenput.com/api/custom-domain${path}`,
    init,
  );
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: 'user-1',
    role,
  };
  return req;
}

const ROW_NONE = {
  custom_hostname: null,
  custom_domain_status: 'none',
  custom_domain_verification_method: null,
  custom_domain_verification_token: null,
  custom_domain_cf_hostname_id: null,
  custom_domain_failure_reason: null,
  custom_domain_requested_at: null,
  custom_domain_verified_at: null,
  custom_domain_last_checked_at: null,
  custom_domain_setup_fee_paid_at: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('customDomainRouter', () => {
  it('exports customDomainRouter with fetch', () => {
    expect(customDomainRouter).toBeDefined();
    expect(typeof customDomainRouter.fetch).toBe('function');
  });
});

describe('GET /api/custom-domain', () => {
  it('returns the default "none" state and the shared CNAME target', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(ROW_NONE);
    const res = await customDomainRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; cnameTarget: string };
    };
    expect(body.data.status).toBe('none');
    expect(body.data.cnameTarget).toBe('fallback.greenput.com');
  });

  it('uses CUSTOM_DOMAIN_FALLBACK_ORIGIN when configured', async () => {
    const env = makeEnv({
      CUSTOM_DOMAIN_FALLBACK_ORIGIN: 'domains.greenput.com',
    });
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(ROW_NONE);
    const res = await customDomainRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: { cnameTarget: string } };
    expect(body.data.cnameTarget).toBe('domains.greenput.com');
  });

  it('returns 404 when the workspace row is missing entirely', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(null);
    const res = await customDomainRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(404);
  });

  it('surfaces the pending hostname and the CNAME as the verification value', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      ...ROW_NONE,
      custom_hostname: 'www.acme.com',
      custom_domain_status: 'pending',
      custom_domain_verification_method: 'cname',
    });
    const res = await customDomainRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as {
      data: { hostname: string; verificationValue: string };
    };
    expect(body.data.hostname).toBe('www.acme.com');
    expect(body.data.verificationValue).toBe('fallback.greenput.com');
  });
});

describe('POST /api/custom-domain', () => {
  it('requires admin or owner', async () => {
    const env = makeEnv();
    const res = await customDomainRouter.fetch(
      makeReq(
        '/',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostname: 'www.acme.com' }),
        },
        { role: 'tech' },
      ),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('rejects an invalid hostname', async () => {
    const env = makeEnv();
    const res = await customDomainRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: 'not a domain' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects a domain already claimed by another workspace', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({ id: 'ws-2' }); // claimedBy check
    const res = await customDomainRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: 'www.acme.com' }),
      }),
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DOMAIN_TAKEN');
  });

  it('records the request as "pending" with cloudflareConfigured:false when Cloudflare credentials are absent', async () => {
    const env = makeEnv(); // no CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null) // claimedBy check: not claimed
      .mockResolvedValueOnce({
        ...ROW_NONE,
        custom_hostname: 'www.acme.com',
        custom_domain_status: 'pending',
      }); // fetchDomainRow after the UPDATE

    const res = await customDomainRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: 'www.acme.com' }),
      }),
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { status: string; cloudflareConfigured: boolean };
    };
    expect(body.data.status).toBe('pending');
    expect(body.data.cloudflareConfigured).toBe(false);
  });

  it('creates the Cloudflare custom hostname and records "verifying" when configured', async () => {
    const env = makeEnv({
      CLOUDFLARE_API_TOKEN: 'test-token',
      CLOUDFLARE_ZONE_ID: 'zone-1',
    });
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null) // claimedBy check
      .mockResolvedValueOnce({
        ...ROW_NONE,
        custom_hostname: 'www.acme.com',
        custom_domain_status: 'verifying',
        custom_domain_cf_hostname_id: 'cf-id-1',
      });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          errors: [],
          result: {
            id: 'cf-id-1',
            hostname: 'www.acme.com',
            status: 'pending',
            ssl: { status: 'pending_validation', method: 'http' },
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await customDomainRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: 'www.acme.com' }),
      }),
      env,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { status: string; cloudflareConfigured: boolean };
    };
    expect(body.data.status).toBe('verifying');
    expect(body.data.cloudflareConfigured).toBe(true);
  });

  it('returns 422 with the Cloudflare error message when Cloudflare rejects the hostname', async () => {
    const env = makeEnv({
      CLOUDFLARE_API_TOKEN: 'test-token',
      CLOUDFLARE_ZONE_ID: 'zone-1',
    });
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(null); // claimedBy check

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          success: false,
          errors: [{ code: 1406, message: 'Duplicate custom hostname found' }],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await customDomainRouter.fetch(
      makeReq('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: 'www.acme.com' }),
      }),
      env,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('Duplicate custom hostname found');
  });
});

describe('POST /api/custom-domain/recheck', () => {
  it('requires admin or owner', async () => {
    const env = makeEnv();
    const res = await customDomainRouter.fetch(
      makeReq('/recheck', { method: 'POST' }, { role: 'office' }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when no domain is configured', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(ROW_NONE);
    const res = await customDomainRouter.fetch(
      makeReq('/recheck', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns a note without calling Cloudflare when never provisioned', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      ...ROW_NONE,
      custom_hostname: 'www.acme.com',
      custom_domain_status: 'pending',
      custom_domain_cf_hostname_id: null,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await customDomainRouter.fetch(
      makeReq('/recheck', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = (await res.json()) as { data: { note?: string } };
    expect(body.data.note).toMatch(/not yet registered/i);
  });

  it('flips status to active once Cloudflare reports the cert active', async () => {
    const env = makeEnv({
      CLOUDFLARE_API_TOKEN: 'test-token',
      CLOUDFLARE_ZONE_ID: 'zone-1',
    });
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ...ROW_NONE,
        custom_hostname: 'www.acme.com',
        custom_domain_status: 'verifying',
        custom_domain_cf_hostname_id: 'cf-id-1',
      })
      .mockResolvedValueOnce({
        ...ROW_NONE,
        custom_hostname: 'www.acme.com',
        custom_domain_status: 'active',
        custom_domain_cf_hostname_id: 'cf-id-1',
        custom_domain_verified_at: '2026-09-10T00:00:00.000Z',
      });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          errors: [],
          result: {
            id: 'cf-id-1',
            hostname: 'www.acme.com',
            status: 'active',
            ssl: { status: 'active', method: 'http' },
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await customDomainRouter.fetch(
      makeReq('/recheck', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('active');
  });
});

describe('DELETE /api/custom-domain', () => {
  it('requires admin or owner', async () => {
    const env = makeEnv();
    const res = await customDomainRouter.fetch(
      makeReq('/', { method: 'DELETE' }, { role: 'tech' }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when no domain is configured', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(ROW_NONE);
    const res = await customDomainRouter.fetch(
      makeReq('/', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('clears the domain fields', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      ...ROW_NONE,
      custom_hostname: 'www.acme.com',
      custom_domain_status: 'active',
      custom_domain_cf_hostname_id: null,
    });
    const res = await customDomainRouter.fetch(
      makeReq('/', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe('PATCH /api/custom-domain/setup-fee', () => {
  it('requires admin or owner', async () => {
    const env = makeEnv();
    const res = await customDomainRouter.fetch(
      makeReq(
        '/setup-fee',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paid: true }),
        },
        { role: 'tech' },
      ),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('records a paid timestamp', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({
      ...ROW_NONE,
      custom_domain_setup_fee_paid_at: '2026-09-10T00:00:00.000Z',
    });
    const res = await customDomainRouter.fetch(
      makeReq('/setup-fee', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: true }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { setupFeePaidAt: string | null };
    };
    expect(body.data.setupFeePaidAt).toBe('2026-09-10T00:00:00.000Z');
  });

  it('clears the paid timestamp when paid:false', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce(ROW_NONE);
    const res = await customDomainRouter.fetch(
      makeReq('/setup-fee', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: false }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { setupFeePaidAt: string | null };
    };
    expect(body.data.setupFeePaidAt).toBe(null);
  });
});
