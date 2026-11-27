/**
 * BaseNative-native HTTP router for the PB worker.
 *
 * Replaces itty-router with a thin layer over @basenative/router's
 * server-safe `resolveRoute`. Why hand-roll instead of pulling in
 * @basenative/middleware? PB's routing surface is small and we want
 * named-param support (`:id`) plus a single `before`/`finally` pipeline,
 * which @basenative/router already gives us via `resolveRoute`. The
 * middleware package's pipeline is more general but doesn't do path
 * matching at all.
 *
 * Handler shape:
 *   (request, env, ctx, params) => Response | Promise<Response>
 *
 * - `request` is a plain Fetch `Request` (no itty extras).
 * - `params` are matched route params (e.g. `:id` → `params.id`).
 *
 * The `before` hooks run in order and may short-circuit by returning a
 * `Response`. `finally` hooks receive the final `Response` and may
 * transform it (e.g. add security headers).
 */
import { resolveRoute, type ResolvedRoute } from '@basenative/router';

export type Handler<Env> = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
) => Response | Promise<Response>;

export type BeforeHook<Env> = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Response | void | Promise<Response | void>;

export type FinallyHook = (response: Response) => Response | Promise<Response>;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

interface Route<Env> {
  method: Method;
  path: string;
  handler: Handler<Env>;
}

export interface ApiRouterOptions<Env> {
  before?: BeforeHook<Env>[];
  finally?: FinallyHook[];
  /**
   * Catch-all handler for non-matched paths. Receives the request as a
   * fall-through (e.g. to forward to `env.ASSETS`). If omitted, returns 404.
   */
  fallback?: Handler<Env>;
}

export interface ApiRouter<Env> {
  get(path: string, handler: Handler<Env>): ApiRouter<Env>;
  post(path: string, handler: Handler<Env>): ApiRouter<Env>;
  put(path: string, handler: Handler<Env>): ApiRouter<Env>;
  patch(path: string, handler: Handler<Env>): ApiRouter<Env>;
  delete(path: string, handler: Handler<Env>): ApiRouter<Env>;
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
}

export function createApiRouter<Env>(options: ApiRouterOptions<Env> = {}): ApiRouter<Env> {
  const routes: Route<Env>[] = [];
  const before = options.before ?? [];
  const finallyHooks = options.finally ?? [];
  const fallback = options.fallback;

  function add(method: Method, path: string, handler: Handler<Env>): ApiRouter<Env> {
    routes.push({ method, path, handler });
    return router;
  }

  async function fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    let response: Response;
    try {
      // before hooks — first non-undefined Response short-circuits.
      for (const hook of before) {
        const result = await hook(request, env, ctx);
        if (result instanceof Response) {
          response = result;
          return await applyFinally(response);
        }
      }

      const url = new URL(request.url);
      const candidates = routes.filter(r => r.method === request.method);

      // resolveRoute matches only the first hit, so do per-route until match.
      // Since resolveRoute compiles each call, we keep this O(n) for PB-scale
      // route tables. If this becomes hot, hoist a precompiled list.
      for (const route of candidates) {
        const match: ResolvedRoute = resolveRoute(
          [{ path: route.path, name: route.path }],
          url.pathname,
        );
        if (match.matched) {
          response = await route.handler(request, env, ctx, match.params);
          return await applyFinally(response);
        }
      }

      // No match.
      if (fallback) {
        response = await fallback(request, env, ctx, {});
      } else {
        response = new Response('Not found', { status: 404 });
      }
      return await applyFinally(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error.';
      response = Response.json({ error: { code: 'INTERNAL', message } }, { status: 500 });
      return await applyFinally(response);
    }
  }

  async function applyFinally(response: Response): Promise<Response> {
    let out = response;
    for (const hook of finallyHooks) {
      out = await hook(out);
    }
    return out;
  }

  const router: ApiRouter<Env> = {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    patch: (p, h) => add('PATCH', p, h),
    delete: (p, h) => add('DELETE', p, h),
    fetch,
  };
  return router;
}
