/**
 * The same `{ error: { code, message } }` envelope `apps/api` answers with, so
 * a crawler or a curl that lands on a refusal here reads the same shape it
 * would read from any other Greenput Worker.
 */
export function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

export function error(message: string, status = 400, code?: string): Response {
  return json({ error: { code: code ?? 'ERROR', message } }, status);
}

export function notFound(resource = 'Resource'): Response {
  return error(`${resource} not found`, 404, 'NOT_FOUND');
}
