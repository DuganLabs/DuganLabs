export function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function error(message: string, status = 400, code?: string): Response {
  return json({ error: { code: code ?? 'ERROR', message } }, status);
}

export function notFound(resource = 'Resource'): Response {
  return error(`${resource} not found`, 404, 'NOT_FOUND');
}

export function unauthorized(): Response {
  return error('Unauthorized', 401, 'UNAUTHORIZED');
}

export function forbidden(): Response {
  return error('Forbidden', 403, 'FORBIDDEN');
}

/** Generate a UUID v4 compatible with Cloudflare Workers */
export function newId(): string {
  return crypto.randomUUID();
}

/** Build a session cookie string with environment-aware Domain and SameSite */
export function buildSessionCookie(
  token: string,
  env: { ENVIRONMENT: string },
  maxAge: number,
): string {
  const parts = [`gp_session=${token}`, 'HttpOnly', 'Secure', 'Path=/'];
  parts.push(`Max-Age=${maxAge}`);

  if (env.ENVIRONMENT === 'production') {
    parts.push('Domain=.greenput.com');
    parts.push('SameSite=Lax');
  } else if (env.ENVIRONMENT === 'staging') {
    parts.push('Domain=.greenput.site');
    parts.push('SameSite=Lax');
  } else {
    // development / preview: no Domain (localhost), Lax is fine
    parts.push('SameSite=Lax');
  }

  return parts.join('; ');
}

/** Paginate a D1 query — returns { data, meta } */
export function paginate(url: URL): {
  limit: number;
  offset: number;
  page: number;
} {
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const perPage = Math.min(
    100,
    parseInt(url.searchParams.get('perPage') ?? '25', 10),
  );
  return { limit: perPage, offset: (page - 1) * perPage, page };
}
