/**
 * /welcome — multi-tenant onboarding form.
 *
 * Reached automatically after a new passkey enrollment whose users-row was
 * synthesized with the `@placeholder.invalid` email by pbUsers.create. The
 * form collects the three values that placeholder hard-codes (email,
 * filing_status, state), POSTs them to /api/auth/onboarding, then sends
 * the user to the dashboard.
 *
 * If the user is already onboarded (real email), /api/auth/me will report
 * onboardingRequired=false and we redirect away — the welcome page is a
 * one-shot. Existing users like Warren never see it.
 */
import { me } from '@basenative/auth-webauthn/client';
import { signal } from '@basenative/runtime';
import { bindText, bindAttr } from './lib/bind.js';
import { apiFetch, DEFAULT_SIGNED_IN_PATH, navigateNow } from './lib/auth-fetch.js';
import { withSubmitting } from './lib/forms.js';

interface MeResponse {
  user: { handle: string } | null;
  onboardingRequired?: boolean;
}

const status = signal<string>('');
const statusState = signal<'ok' | 'error' | null>(null);

bindText('onboarding-status', status);
bindAttr('onboarding-status', 'data-state', () => statusState() ?? null);

function setStatus(text: string, state: 'ok' | 'error' | null = null): void {
  status.set(text);
  statusState.set(state);
}

const form = document.getElementById('onboarding-form');

async function bootstrap(): Promise<void> {
  try {
    const data = (await me()) as MeResponse;
    if (!data.user) {
      navigateNow('/login');
      return;
    }
    if (!data.onboardingRequired) {
      navigateNow(DEFAULT_SIGNED_IN_PATH);
      return;
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Failed to load session.', 'error');
  }
}

if (form instanceof HTMLFormElement) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    await withSubmitting(form, async () => {
      const data = new FormData(form);
      const body = {
        email: String(data.get('email') ?? '').trim(),
        filingStatus: String(data.get('filingStatus') ?? ''),
        state: String(data.get('state') ?? '')
          .trim()
          .toUpperCase(),
      };
      setStatus('Saving…');
      const res = await apiFetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setStatus('Saved. Loading dashboard…', 'ok');
        window.location.href = DEFAULT_SIGNED_IN_PATH;
        return;
      }
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setStatus(err?.error?.message ?? `Couldn't save (HTTP ${res.status}).`, 'error');
    });
  });
}

void bootstrap();
