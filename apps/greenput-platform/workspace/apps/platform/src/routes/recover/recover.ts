/**
 * `/recover` — the way back into an account when the passkey is gone.
 *
 * Two steps on one card, both built once and toggled with `hidden`. Nothing
 * here rebuilds a form body in an effect: onboarding lost input focus on
 * every keystroke doing exactly that, and a screen where a contractor is
 * typing a six-digit code against a five-minute timer is the worst possible
 * place to repeat it.
 *
 * The number this asks for is the PERSONAL one bound to the account in
 * Settings → Security, never the business line. The copy says so, because a
 * contractor who types their company number and gets nothing deserves to know
 * why rather than to conclude the product is broken.
 */

import { signal, effect } from '@basenative/runtime';
import type { AuthUser } from '@basenative/auth-webauthn';
import { toE164 } from '@greenput/shared/utils';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet } from '../../styles/sheet.js';
import { el, on, type Cleanup } from '../../lib/dom.js';
import { field as formField } from '../shared/field.js';
import { AUTH_CARD_SHEET, buildAuthCard } from '../shared/auth-card.js';
import type { RouteView } from '../types.js';

type Step = 'phone' | 'code';

/** What went wrong, in terms this screen can say something true about. */
export type RecoverFailure =
  | 'invalid-phone'
  | 'rate-limited'
  | 'offline'
  | 'bad-code'
  | 'locked'
  | 'no-account'
  | 'server'
  | 'unknown';

/**
 * Map a thrown value from the recovery API onto a failure this screen can
 * explain. Exported because the mapping is the part worth testing — it is the
 * same class of bug as /login's single "check your connection" message.
 */
export function classifyRecoverError(err: unknown): RecoverFailure {
  // Structural rather than `instanceof ApiError`: `@basenative/fetch` is
  // reached under two names in this workspace, so an identity check can fail
  // on exactly the object we mean. See libs/basenative/auth-webauthn's
  // error-kind.ts, which takes the same line for the same reason.
  if (typeof err !== 'object' || err === null) return 'unknown';
  const e = err as { name?: unknown; status?: unknown; code?: unknown };
  if (e.name !== 'ApiError' || typeof e.status !== 'number') return 'unknown';

  const status = e.status;
  const code = typeof e.code === 'string' ? e.code : '';

  if (status === 429) {
    // Two different 429s reach here and they need different advice: the
    // route-level IP limiter ("wait a minute") and the per-code attempt
    // lockout ("that code is dead, get a new one").
    return code === 'OTP_LOCKED' ? 'locked' : 'rate-limited';
  }
  if (status === 0) return 'offline';
  if (status === 400 && code === 'INVALID_PHONE') return 'invalid-phone';
  if (code === 'NO_RECOVERY_ACCOUNT') return 'no-account';
  if (status === 401) return 'bad-code';
  if (status >= 500) return 'server';
  return 'unknown';
}

/**
 * The sentence shown for each failure. Every one of these is true of the
 * thing that actually happened, and says what to do next.
 */
export const RECOVER_MESSAGES: Record<RecoverFailure, string> = {
  'invalid-phone':
    'That does not look like a phone number. Include the country code: +1 949 555 0199, or +44 20 7946 0958.',
  'rate-limited':
    'Too many attempts from this network. Wait a minute, then try once more — reloading the page will not help.',
  offline: "We couldn't reach Greenput. Check your connection and try again.",
  'bad-code':
    'That code is wrong or has expired. Codes last five minutes — request a new one.',
  locked:
    'Too many incorrect codes, so that one has been cancelled. Request a new code to try again.',
  'no-account': 'No Greenput account uses this number for recovery.',
  server: 'Something went wrong on our side. Try again in a moment.',
  unknown: 'That did not work. Try again, or request a new code.',
};

export function renderRecoverRoute(deps: PlatformDeps): RouteView {
  adoptSheet(AUTH_CARD_SHEET);

  const step = signal<Step>('phone');
  const busy = signal(false);
  const failure = signal<RecoverFailure | null>(null);
  /** The E.164 number the code was sent to, once step 1 succeeds. */
  let sentTo = '';

  const { root, card } = buildAuthCard({
    heading: 'Greenput',
    lede: 'Signing in another way, when your passkey is not available.',
    testId: 'recover',
  });

  // ── Step 1: the number ────────────────────────────────────────────────
  const phoneInput = el('input', {
    type: 'tel',
    name: 'recovery-phone',
    autocomplete: 'tel',
    inputmode: 'tel',
    placeholder: '(949) 555-0199',
    'data-testid': 'recover-phone-input',
  }) as HTMLInputElement;

  const sendButton = el(
    'button',
    {
      type: 'submit',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'recover-send',
    },
    'Send me a code',
  ) as HTMLButtonElement;

  const phoneStep = el(
    'form',
    { 'data-bn-auth-step': 'phone', novalidate: '' },
    el(
      'p',
      {},
      'Enter the personal mobile number on your Greenput account. This is not your business number — your business number is on your website, so we never send sign-in codes there.',
    ),
    formField('Personal mobile number', phoneInput, 'recover-phone'),
    el('div', { 'data-bn-auth-actions': '' }, sendButton),
  );

  // ── Step 2: the code ──────────────────────────────────────────────────
  const codeInput = el('input', {
    type: 'text',
    name: 'one-time-code',
    // Lets iOS and Android offer the code straight from the SMS.
    autocomplete: 'one-time-code',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    maxlength: '6',
    'data-bn-code': '',
    'data-testid': 'recover-code-input',
  }) as HTMLInputElement;

  const verifyButton = el(
    'button',
    {
      type: 'submit',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'recover-verify',
    },
    'Sign in',
  ) as HTMLButtonElement;

  const resendButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'quiet',
      'data-testid': 'recover-resend',
    },
    'Send a new code',
  ) as HTMLButtonElement;

  const startOverButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'quiet',
      'data-testid': 'recover-start-over',
    },
    'Use a different number',
  ) as HTMLButtonElement;

  // Deliberately does not say "we sent you a code": the API answers the same
  // whether or not that number is on an account, so claiming one was sent
  // would be a guess — and, said confidently, would turn this screen into a
  // way to find out who has a Greenput account.
  const sentNotice = el(
    'p',
    { 'data-bn-notice': '', 'data-testid': 'recover-sent-notice' },
    'If that number is on a Greenput account, a six-digit code is on its way. It expires in five minutes.',
  );

  const codeStep = el(
    'form',
    { 'data-bn-auth-step': 'code', novalidate: '', hidden: true },
    sentNotice,
    formField('Six-digit code', codeInput, 'recover-code'),
    el(
      'div',
      { 'data-bn-auth-actions': '' },
      verifyButton,
      resendButton,
      startOverButton,
    ),
  );

  const errorBanner = el('output', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': 'recover-error',
    hidden: true,
  });

  const liveStatus = el('p', {
    'data-bn-sr-only': '',
    role: 'status',
    'aria-live': 'polite',
  });

  const footer = el(
    'footer',
    { 'data-bn-auth-footer': '' },
    el('a', { href: '/login' }, 'Back to sign in'),
    el(
      'span',
      {},
      'No recovery number on file? Ask a teammate with owner or admin access to invite you again.',
    ),
  );

  card.append(errorBanner, liveStatus, phoneStep, codeStep, footer);

  const cleanups: Cleanup[] = [];

  // One effect, depending only on step() — never on the field values. This is
  // the rule that keeps the inputs from being torn out from under a typist.
  cleanups.push(
    effect(() => {
      const current = step();
      phoneStep.hidden = current !== 'phone';
      codeStep.hidden = current !== 'code';
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const isBusy = busy();
      for (const button of [
        sendButton,
        verifyButton,
        resendButton,
        startOverButton,
      ]) {
        button.disabled = isBusy;
        if (isBusy) button.setAttribute('data-bn-busy', '');
        else button.removeAttribute('data-bn-busy');
      }
      sendButton.textContent = isBusy ? 'Sending…' : 'Send me a code';
      verifyButton.textContent = isBusy ? 'Checking…' : 'Sign in';
      liveStatus.textContent = isBusy ? 'Working…' : '';
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const kind = failure();
      if (kind) {
        errorBanner.textContent = RECOVER_MESSAGES[kind];
        errorBanner.hidden = false;
      } else {
        errorBanner.textContent = '';
        errorBanner.hidden = true;
      }
    }).dispose,
  );

  async function requestCode(phoneRaw: string): Promise<boolean> {
    const phone = toE164(phoneRaw);
    if (!phone) {
      failure.set('invalid-phone');
      return false;
    }

    busy.set(true);
    failure.set(null);
    try {
      const res = await deps.recovery.sendCode(phone);
      // Whether this deployment can send SMS at all is a property of the
      // deployment, identical for every caller, so saying it reveals nothing
      // about who has an account — and not saying it meant this screen
      // promised a text that no configured provider was going to send.
      if (res.data.delivery === 'log') {
        sentNotice.textContent =
          'This deployment has no SMS provider configured, so no text will arrive. The code is written to the Worker log — whoever runs Greenput can read it with `wrangler tail greenput-api`.';
        sentNotice.setAttribute('data-bn-tone', 'warn');
      }
      sentTo = phone;
      return true;
    } catch (err) {
      failure.set(classifyRecoverError(err));
      return false;
    } finally {
      busy.set(false);
    }
  }

  cleanups.push(
    on(phoneStep, 'submit', (event) => {
      event.preventDefault();
      void (async () => {
        if (await requestCode(phoneInput.value)) {
          step.set('code');
          codeInput.value = '';
          codeInput.focus();
        }
      })();
    }),
  );

  cleanups.push(
    on(codeStep, 'submit', (event) => {
      event.preventDefault();
      void (async () => {
        const code = codeInput.value.replace(/\D/g, '');
        if (code.length !== 6) {
          failure.set('bad-code');
          return;
        }

        busy.set(true);
        failure.set(null);
        try {
          const res = await deps.recovery.verifyCode(sentTo, code);
          const user = res.data.user as AuthUser;
          // The verify response carries workspaceId, so the store can be
          // hydrated from it directly — no second round trip to /me before
          // the route guard will let us through.
          deps.auth.setUser(user);
          await deps.router.navigate('/dashboard', { replace: true });
        } catch (err) {
          failure.set(classifyRecoverError(err));
        } finally {
          busy.set(false);
        }
      })();
    }),
  );

  cleanups.push(
    on(resendButton, 'click', () => {
      void (async () => {
        if (await requestCode(sentTo)) codeInput.value = '';
      })();
    }),
  );

  cleanups.push(
    on(startOverButton, 'click', () => {
      sentTo = '';
      failure.set(null);
      step.set('phone');
      phoneInput.focus();
    }),
  );

  return {
    element: root,
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}
