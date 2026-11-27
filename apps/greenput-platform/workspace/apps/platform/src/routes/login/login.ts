/**
 * `/login` — passkey-only sign-in.
 *
 *   - On mount: kick off conditional mediation so saved passkeys appear
 *     in the browser autofill dropdown.
 *   - "Sign in with passkey" button: explicit modal credential picker.
 *   - Errors from the auth store render inline — and say what actually
 *     happened.
 *
 * That last part used to be one sentence for every failure: "We couldn't
 * start passkey sign-in. Check your connection and try again." It was wrong
 * more often than it was right. The most damaging case was the rate limit:
 * this route fires login/options on every mount, `authRateLimit` allows five
 * requests a minute per IP across all of /api/auth/*, and a contractor who
 * cannot get in reloads — which is the one action guaranteed to keep them
 * locked out, and is exactly what that copy told them to do.
 *
 * `deps.auth.errorKind()` carries the classification now; this route owns the
 * sentence for each kind and nothing else.
 */

import { effect } from '@basenative/runtime';
import type { AuthErrorKind } from '@basenative/auth-webauthn';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet } from '../../styles/sheet.js';
import { el, on, type Cleanup } from '../../lib/dom.js';
import { AUTH_CARD_SHEET, buildAuthCard } from '../shared/auth-card.js';
import type { RouteView } from '../types.js';

/**
 * One true sentence per failure, each ending in the action that actually
 * helps. Exported so the mapping can be tested as data rather than by
 * scraping the rendered banner.
 */
export const LOGIN_MESSAGES: Record<AuthErrorKind, string> = {
  // NOT "reloading this page counts as another attempt". It did when
  // login/options shared the 5-a-minute credential bucket; #122 moved it onto
  // the general 60-a-minute one, because fetching the options is not a
  // submission and /login fires it on every mount. Verified: the auth bucket
  // fully spent, login/options still 200. Telling a locked-out contractor not
  // to reload is telling them not to do the one harmless thing.
  'rate-limited':
    'Too many sign-in attempts from this network. Wait a minute, then try again — or use the recovery link below if you cannot wait.',
  offline: "We couldn't reach Greenput. Check your connection and try again.",
  'no-credential':
    "That passkey isn't recognised. If you set Greenput up on another device, try there — or recover your account below.",
  cancelled:
    'No passkey was offered. Either the prompt was dismissed, or this device has no Greenput passkey saved — recover your account below to add one.',
  'no-prompt':
    'This device never showed a passkey prompt, so it probably has no passkey to offer. Try the device you set Greenput up on, or recover your account below.',
  unsupported:
    'This browser cannot use passkeys. Try a recent Chrome, Safari, Edge or Firefox — or recover your account below.',
  server: 'Something went wrong on our side. Try again in a moment.',
  unknown: "Sign-in didn't work. Try again, or recover your account below.",
};

export function renderLoginRoute(deps: PlatformDeps): RouteView {
  adoptSheet(AUTH_CARD_SHEET);

  const { root, card } = buildAuthCard({
    heading: 'Greenput',
    lede: 'Sign in with your passkey to continue.',
    testId: 'login',
  });

  const button = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'login-passkey-button',
    },
    'Sign in with passkey',
  );

  const errorBanner = el('output', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': 'login-error',
    hidden: true,
  });

  // Waiting for a passkey prompt is the one slow moment on this screen, and
  // the button's own label change is not announced. This is.
  const liveStatus = el('p', {
    'data-bn-sr-only': '',
    role: 'status',
    'aria-live': 'polite',
  });

  const footer = el(
    'footer',
    { 'data-bn-auth-footer': '' },
    // The un-brick door. It has to be on this screen and it has to be
    // reachable without a session, because someone whose passkey is gone has
    // neither. It sits above the signup link on purpose: an owner who cannot
    // get in must not conclude that making a second account is the answer.
    el(
      'a',
      { href: '/recover', 'data-testid': 'login-recover-link' },
      "Can't use your passkey?",
    ),
    el(
      'span',
      {},
      'New to Greenput? ',
      el('a', { href: '/onboarding' }, 'Create an account'),
    ),
  );

  card.append(
    errorBanner,
    liveStatus,
    el('div', { 'data-bn-auth-actions': '' }, button),
    footer,
  );

  const cleanups: Cleanup[] = [];

  cleanups.push(
    effect(() => {
      const message = deps.auth.error();
      const kind = deps.auth.errorKind();
      if (message) {
        // `message` is whatever the transport surfaced (often a bare "Not
        // Found" or a DOMException string) and is not for end users. Log it
        // for debugging; show the sentence that matches what went wrong.
        console.error('Passkey sign-in failed:', message);
        errorBanner.textContent = LOGIN_MESSAGES[kind ?? 'unknown'];
        errorBanner.removeAttribute('hidden');
      } else {
        errorBanner.textContent = '';
        errorBanner.setAttribute('hidden', '');
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const busy = deps.auth.loading();
      if (busy) {
        button.setAttribute('data-bn-busy', '');
        button.setAttribute('disabled', '');
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Signing in…';
        liveStatus.textContent = 'Waiting for your passkey…';
      } else {
        button.removeAttribute('data-bn-busy');
        button.removeAttribute('disabled');
        button.removeAttribute('aria-busy');
        button.textContent = 'Sign in with passkey';
        liveStatus.textContent = '';
      }
    }).dispose,
  );

  cleanups.push(
    on(button, 'click', () => {
      void deps.auth.loginWithPasskey();
    }),
  );

  void deps.auth.startConditionalPasskey();

  return {
    element: root,
    dispose: () => {
      deps.auth.abortConditionalPasskey();
      deps.auth.clearError();
      for (const fn of cleanups) fn();
    },
  };
}
