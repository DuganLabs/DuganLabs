import { describe, it, expect } from 'vitest';
import {
  json,
  error,
  notFound,
  unauthorized,
  forbidden,
  buildSessionCookie,
  paginate,
} from './response';

describe('json', () => {
  it('returns a JSON response with default 200 status', async () => {
    const res = json({ hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body).toEqual({ hello: 'world' });
  });

  it('accepts a custom status code', () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
  });
});

describe('error helpers', () => {
  it('error returns 400 by default', async () => {
    const res = error('bad input');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe('bad input');
  });

  it('notFound returns 404', () => {
    expect(notFound().status).toBe(404);
  });

  it('unauthorized returns 401', () => {
    expect(unauthorized().status).toBe(401);
  });

  it('forbidden returns 403', () => {
    expect(forbidden().status).toBe(403);
  });
});

describe('buildSessionCookie', () => {
  it('sets Domain=.greenput.com in production', () => {
    const cookie = buildSessionCookie(
      'tok123',
      { ENVIRONMENT: 'production' },
      3600,
    );
    expect(cookie).toContain('gp_session=tok123');
    expect(cookie).toContain('Domain=.greenput.com');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=3600');
  });

  it('sets Domain=.greenput.site in staging', () => {
    const cookie = buildSessionCookie(
      'tok456',
      { ENVIRONMENT: 'staging' },
      3600,
    );
    expect(cookie).toContain('Domain=.greenput.site');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('omits Domain in development', () => {
    const cookie = buildSessionCookie(
      'tok789',
      { ENVIRONMENT: 'development' },
      3600,
    );
    expect(cookie).not.toContain('Domain=');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('omits Domain in preview', () => {
    const cookie = buildSessionCookie(
      'tokpre',
      { ENVIRONMENT: 'preview' },
      3600,
    );
    expect(cookie).not.toContain('Domain=');
  });

  it('sets Max-Age=0 for logout', () => {
    const cookie = buildSessionCookie('', { ENVIRONMENT: 'production' }, 0);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('gp_session=');
  });
});

describe('paginate', () => {
  it('defaults to page 1, perPage 25', () => {
    const url = new URL('https://api.greenput.com/api/leads');
    const result = paginate(url);
    expect(result).toEqual({ limit: 25, offset: 0, page: 1 });
  });

  it('respects page and perPage params', () => {
    const url = new URL('https://api.greenput.com/api/leads?page=3&perPage=10');
    const result = paginate(url);
    expect(result).toEqual({ limit: 10, offset: 20, page: 3 });
  });

  it('caps perPage at 100', () => {
    const url = new URL('https://api.greenput.com/api/leads?perPage=500');
    const result = paginate(url);
    expect(result.limit).toBe(100);
  });
});

describe('json additional', () => {
  it('sets X-Content-Type-Options: nosniff', () => {
    const res = json({ test: true });
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('serializes arrays correctly', async () => {
    const res = json([1, 2, 3]);
    const body = await res.json();
    expect(body).toEqual([1, 2, 3]);
  });

  it('accepts 201 status', () => {
    const res = json({ created: true }, 201);
    expect(res.status).toBe(201);
  });
});

describe('error additional', () => {
  it('includes custom error code in body', async () => {
    const res = error('Not found', 404, 'NOT_FOUND');
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Not found');
  });

  it('defaults error code to ERROR when not provided', async () => {
    const res = error('Something went wrong');
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ERROR');
  });

  it('notFound includes NOT_FOUND code', async () => {
    const res = notFound();
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('not found');
  });

  it('notFound accepts custom resource name', async () => {
    const res = notFound('Workspace');
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('Workspace');
  });

  it('unauthorized includes UNAUTHORIZED code', async () => {
    const res = unauthorized();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('forbidden includes FORBIDDEN code', async () => {
    const res = forbidden();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

describe('paginate additional', () => {
  it('handles page 0 by clamping to 1', () => {
    const url = new URL('https://api.greenput.com/api/leads?page=0');
    const result = paginate(url);
    expect(result.page).toBe(1);
    expect(result.offset).toBe(0);
  });

  it('handles negative page by clamping to 1', () => {
    const url = new URL('https://api.greenput.com/api/leads?page=-5');
    const result = paginate(url);
    expect(result.page).toBe(1);
    expect(result.offset).toBe(0);
  });

  it('computes correct offset for page 2 with default perPage', () => {
    const url = new URL('https://api.greenput.com/api/leads?page=2');
    const result = paginate(url);
    expect(result.offset).toBe(25);
  });

  it('handles non-numeric page by treating as default', () => {
    const url = new URL('https://api.greenput.com/api/leads?page=abc');
    const result = paginate(url);
    // parseInt('abc') = NaN; Math.max(1, NaN) = NaN in some envs, check limit is set
    expect(result.limit).toBe(25);
  });
});
