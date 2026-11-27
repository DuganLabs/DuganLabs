/**
 * Resolves the GreenPut API base URL from the current `window.location`.
 * Returns an empty string in non-browser contexts (the caller should pass an
 * SSR fallback in that case). Mirrors the logic that has lived inside
 * `apps/platform/src/app/shared/services/api.service.ts` and
 * `webauthn.service.ts` so it can be shared across the migrated stack.
 */
export interface ResolveApiBaseOptions {
  /**
   * Optional override for the hostname lookup — primarily used in tests.
   */
  readonly hostname?: string;
}

export function resolveGreenPutApiBase(
  options: ResolveApiBaseOptions = {},
): string {
  const hostname =
    options.hostname ??
    (typeof window !== 'undefined' && window.location
      ? window.location.hostname
      : '');

  if (!hostname) return '';
  if (hostname.endsWith('.greenput.com')) return 'https://api.greenput.com';
  if (hostname.endsWith('.greenput.site')) return 'https://api.greenput.site';
  if (hostname.endsWith('.pages.dev')) {
    return 'https://greenput-api.greenput.workers.dev';
  }
  return '';
}
