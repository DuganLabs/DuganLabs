// ── Error Handling Middleware ─────────────────────────────────
// Wraps the top-level Worker fetch in structured error handling.
// Logs errors, tracks them in D1, and returns proper ApiError responses.

import type { Env } from '../env';
import { createRequestLogger } from '../lib/logger';
import { trackError } from '../lib/error-tracker';
import { json } from '../lib/response';

/**
 * Wraps the main router fetch with structured error handling.
 * - Generates a unique requestId, attaches it to the X-Request-ID header and to
 *   the request itself as `requestId`, so a handler answering its own 4xx can
 *   file a correlated error_logs row
 * - Logs request start/end with timing
 * - Catches unhandled errors, tracks them, and returns structured responses
 *
 * @param routerFetch - The itty-router fetch handler
 * @returns A Worker fetch handler with error handling
 */
export function withErrorHandler(
  routerFetch: (
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<Response>,
): (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> {
  return async (
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> => {
    const { logger, requestId } = createRequestLogger(request, env);
    const start = Date.now();

    // The same id this returns as X-Request-ID, put where a route handler can
    // read it: a handler that answers a 4xx itself never reaches the catch
    // below, so anything it wants to file in error_logs has to correlate with
    // the response the caller was handed some other way. Attached the way auth
    // middleware already attaches `user`/`workspaceId` to the request.
    (request as Request & { requestId?: string }).requestId = requestId;

    logger.info('Request started', {
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    try {
      const response = await routerFetch(request, env, ctx);

      const duration = Date.now() - start;
      logger.info('Request completed', {
        statusCode: response.status,
        durationMs: duration,
      });

      // A 101 carries a WebSocket and cannot be rebuilt — pass it through.
      if (response.status === 101) return response;

      // Attach requestId to all responses
      const headers = new Headers(response.headers);
      headers.set('X-Request-ID', requestId);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (err: unknown) {
      const duration = Date.now() - start;
      const url = new URL(request.url);

      // Extract user context if available
      const reqWithUser = request as Request & {
        user?: { id: string; workspaceId: string };
        workspaceId?: string;
      };

      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorStack = err instanceof Error ? err.stack : undefined;

      logger.error('Unhandled error', {
        error: errorMessage,
        stack: errorStack,
        durationMs: duration,
      });

      // Track the error in D1 (non-blocking via waitUntil)
      ctx.waitUntil(
        trackError(env, err, {
          requestId,
          userId: reqWithUser.user?.id,
          workspaceId: reqWithUser.workspaceId,
          path: url.pathname,
          method: request.method,
          statusCode: 500,
        }),
      );

      const errorResponse = json(
        { error: { code: 'INTERNAL', message: 'Internal server error' } },
        500,
      );

      const headers = new Headers(errorResponse.headers);
      headers.set('X-Request-ID', requestId);

      return new Response(errorResponse.body, {
        status: errorResponse.status,
        headers,
      });
    }
  };
}
