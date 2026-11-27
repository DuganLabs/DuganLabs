import type { Env } from '../env.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function postWaitlist(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON.');
  }

  if (typeof body !== 'object' || body === null) {
    return jsonError(400, 'INVALID_BODY', 'Expected { email, name }.');
  }
  const { email, name } = body as { email?: unknown; name?: unknown };

  if (typeof email !== 'string' || !EMAIL.test(email.trim())) {
    return jsonError(400, 'INVALID_EMAIL', 'A valid email is required.', 'email');
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return jsonError(400, 'INVALID_NAME', 'Name is required.', 'name');
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();
  const source = request.headers.get('Referer') ?? 'direct';

  try {
    await env.DB.prepare('INSERT INTO waitlist (email, name, source) VALUES (?, ?, ?)')
      .bind(cleanEmail, cleanName, source)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return jsonError(409, 'ALREADY_ON_LIST', 'That email is already on the waitlist.', 'email');
    }
    return jsonError(500, 'DB_ERROR', 'Failed to save to waitlist.');
  }

  return Response.json({ ok: true, email: cleanEmail });
}

function jsonError(status: number, code: string, message: string, field?: string): Response {
  const body: Record<string, unknown> = { error: { code, message } };
  if (field) (body.error as Record<string, unknown>).field = field;
  return Response.json(body, { status });
}
