import { describe, it, expect, vi } from 'vitest';
import { brandingRouter } from './branding';

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
  const req = new Request(`https://api.greenput.com/api/branding${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = workspaceId;
  (req as unknown as Record<string, unknown>)['user'] = {
    id: 'user-1',
    role: 'owner',
  };
  return req;
}

describe('brandingRouter', () => {
  it('exports brandingRouter with fetch', () => {
    expect(brandingRouter).toBeDefined();
    expect(typeof brandingRouter.fetch).toBe('function');
  });
});

describe('GET /api/branding', () => {
  it('returns 200 with default branding when none exists', async () => {
    const env = makeEnv();
    const res = await brandingRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { primaryColor: string } };
    expect(body.data.primaryColor).toBe('#10b981');
  });

  it('returns 200 with existing branding', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: 'br-1',
      workspace_id: 'ws-1',
      primary_color: '#ff0000',
      secondary_color: '#000000',
      accent_color: '#ffffff',
      font_family: 'Inter',
    });
    const res = await brandingRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { primaryColor: string } };
    expect(body.data.primaryColor).toBe('#ff0000');
  });
});

describe('PATCH /api/branding', () => {
  it('returns 400 when body is empty', async () => {
    const env = makeEnv();
    const res = await brandingRouter.fetch(
      makeReq('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid hex color', async () => {
    const env = makeEnv();
    const res = await brandingRouter.fetch(
      makeReq('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryColor: 'red' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 when updating existing branding', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'br-1' }) // existence check
      .mockResolvedValueOnce({ id: 'br-1', primary_color: '#ff5733' }); // updated fetch
    const res = await brandingRouter.fetch(
      makeReq('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryColor: '#ff5733' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns 200 and inserts branding when none exists', async () => {
    const env = makeEnv();
    // first() returns null = no existing branding, then null for updated fetch too
    const res = await brandingRouter.fetch(
      makeReq('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryColor: '#10b981' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('branding schema validation', () => {
  it('rejects empty body', async () => {
    const { UpdateBrandingSchema } =
      await import('@greenput/shared/validators');
    expect(UpdateBrandingSchema.safeParse({}).success).toBe(false);
  });

  it('accepts valid hex colors', async () => {
    const { UpdateBrandingSchema } =
      await import('@greenput/shared/validators');
    expect(
      UpdateBrandingSchema.safeParse({ primaryColor: '#ff5733' }).success,
    ).toBe(true);
    expect(
      UpdateBrandingSchema.safeParse({ accentColor: '#3b82f6' }).success,
    ).toBe(true);
  });

  it('rejects invalid hex colors', async () => {
    const { UpdateBrandingSchema } =
      await import('@greenput/shared/validators');
    expect(
      UpdateBrandingSchema.safeParse({ primaryColor: 'red' }).success,
    ).toBe(false);
    expect(
      UpdateBrandingSchema.safeParse({ primaryColor: '#f00' }).success,
    ).toBe(false);
  });

  it('accepts nullable logoUrl and valid URL', async () => {
    const { UpdateBrandingSchema } =
      await import('@greenput/shared/validators');
    expect(UpdateBrandingSchema.safeParse({ logoUrl: null }).success).toBe(
      true,
    );
    expect(
      UpdateBrandingSchema.safeParse({
        logoUrl: 'https://example.com/logo.png',
      }).success,
    ).toBe(true);
    expect(
      UpdateBrandingSchema.safeParse({ logoUrl: 'not-a-url' }).success,
    ).toBe(false);
  });

  it('accepts secondaryColor and accentColor', async () => {
    const { UpdateBrandingSchema } =
      await import('@greenput/shared/validators');
    expect(
      UpdateBrandingSchema.safeParse({ secondaryColor: '#1f2937' }).success,
    ).toBe(true);
    expect(
      UpdateBrandingSchema.safeParse({ accentColor: '#3b82f6' }).success,
    ).toBe(true);
  });

  it('accepts fontFamily field', async () => {
    const { UpdateBrandingSchema } =
      await import('@greenput/shared/validators');
    expect(
      UpdateBrandingSchema.safeParse({ fontFamily: 'Inter' }).success,
    ).toBe(true);
  });

  it('rejects empty string fontFamily', async () => {
    const { UpdateBrandingSchema } =
      await import('@greenput/shared/validators');
    expect(UpdateBrandingSchema.safeParse({ fontFamily: '' }).success).toBe(
      false,
    );
  });

  it('accepts null customDomain', async () => {
    const { UpdateBrandingSchema } =
      await import('@greenput/shared/validators');
    expect(UpdateBrandingSchema.safeParse({ customDomain: null }).success).toBe(
      true,
    );
  });
});

describe('PATCH /api/branding additional cases', () => {
  it('returns 200 when updating multiple colors at once', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'br-1' })
      .mockResolvedValueOnce({
        id: 'br-1',
        primary_color: '#ff5733',
        secondary_color: '#1f2937',
      });
    const res = await brandingRouter.fetch(
      makeReq('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryColor: '#ff5733',
          secondaryColor: '#1f2937',
        }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns 200 when updating fontFamily', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'br-1' })
      .mockResolvedValueOnce({ id: 'br-1', font_family: 'Roboto' });
    const res = await brandingRouter.fetch(
      makeReq('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fontFamily: 'Roboto' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns updated branding in response body', async () => {
    const env = makeEnv();
    (env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'br-1' })
      .mockResolvedValueOnce({
        id: 'br-1',
        primary_color: '#aabbcc',
        secondary_color: '#000000',
        accent_color: '#ffffff',
        font_family: 'Inter',
      });
    const res = await brandingRouter.fetch(
      makeReq('/', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryColor: '#aabbcc' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { primaryColor: string } };
    expect(body.data.primaryColor).toBe('#aabbcc');
  });
});
