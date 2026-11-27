/**
 * Passkey login flow. Calls into @basenative/auth-webauthn/client.
 *
 * On success, redirects to the page the user was trying to reach (per the
 * `?next=` query param set by lib/auth-fetch.ts when a 401 redirected
 * them here), falling back to /app (the authenticated dashboard).
 *
 * BaseNative-flavored: the status line is driven by a signal + bindText.
 */
import { loginPasskey, isPasskeySupported } from '@basenative/auth-webauthn/client';
import { signal } from '@basenative/runtime';
import { bindText, bindAttr } from './lib/bind.js';
import { resolveNextPath } from './lib/auth-fetch.js';
import { withSubmitting } from './lib/forms.js';
import { describeAuthError } from './lib/auth-errors.js';

const status = signal<string>('');
const statusState = signal<'ok' | 'error' | null>(null);

bindText('login-status', status);
bindAttr('login-status', 'data-state', () => statusState() ?? null);

function setStatus(text: string, state: 'ok' | 'error' | null = null): void {
  status.set(text);
  statusState.set(state);
}

const form = document.getElementById('login-form');

if (!isPasskeySupported()) {
  setStatus('This browser does not support passkeys.', 'error');
}

if (form instanceof HTMLFormElement) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    await withSubmitting(form, async () => {
      const data = new FormData(form);
      const handle = String(data.get('handle') ?? '')
        .trim()
        .toLowerCase();
      setStatus('Waiting for passkey…');
      try {
        await loginPasskey(handle);
        setStatus('Signed in. Redirecting…', 'ok');
        window.location.href = resolveNextPath();
      } catch (err) {
        setStatus(describeAuthError(err, 'Sign-in failed.'), 'error');
      }
    });
  });
}
