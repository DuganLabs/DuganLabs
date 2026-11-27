/**
 * `@basenative/fetch` — GreenPut's local alias for this package (see
 * `tsconfig.json` `paths` and the `apps/platform` Vite/Vitest `resolve.alias`)
 * now re-exports the published `@basenative/fetch` package for everything
 * except the two GreenPut-specific pieces that never went upstream:
 * `resolveGreenPutApiBase` and the signal-based `createResource`.
 *
 * NOTE: this file imports the real package via the `basenative-fetch-upstream`
 * dependency (`npm:@basenative/fetch@<version>` in the root `package.json`),
 * NOT via the bare `@basenative/fetch` specifier. The workspace alias that
 * points `@basenative/fetch` at this very file would otherwise resolve that
 * import straight back to itself. `basenative-fetch-upstream` is a pnpm/npm
 * alias for the exact same installed package — one physical dependency,
 * reached under two names.
 */
export {
  createApiClient,
  ApiError,
  isApiError,
  isApiResponse,
  isApiErrorEnvelope,
  unwrap,
  serializeQuery,
  joinUrl,
  type ApiClient,
  type ApiClientOptions,
  type ApiErrorInit,
  type RequestOptions,
  type RequestContext,
  type ResponseContext,
  type FetchImpl,
  type BaseUrlResolver,
  type ApiResponse,
  type ApiErrorEnvelope,
  type QueryParams,
  type QueryValue,
} from 'basenative-fetch-upstream';
export {
  createResource,
  type Resource,
  type ResourceOptions,
} from './resource.js';
export {
  resolveGreenPutApiBase,
  type ResolveApiBaseOptions,
} from './api-base.js';
