/**
 * Account page — passkey enrollment + per-credential management.
 *
 * BaseNative-flavored: a credential-list signal drives a `bindList` render,
 * `me` state lives in another signal that fans out to multiple bindings.
 * Inline rename / revoke flows still mutate the DOM imperatively because
 * they're row-local, but the canonical credential list re-renders from
 * the signal whenever it changes.
 */
import { registerPasskey, isPasskeySupported, me, logout } from '@basenative/auth-webauthn/client';
import { signal, computed } from '@basenative/runtime';
import { bindText, bindAttr, bindHidden, bindList } from './lib/bind.js';
import { apiFetch } from './lib/auth-fetch.js';
import { attachCredentialStyles } from './lib/credential-styles.js';
import { confirmDialog } from './lib/dialog.js';
import { bnBadge, bnButton } from './lib/markup.js';
import { withSubmitting } from './lib/forms.js';
import { describeAuthError } from './lib/auth-errors.js';

attachCredentialStyles();

interface MeResponse {
  user: { handle: string; role: string; isAdmin: boolean } | null;
  onboardingRequired?: boolean;
  /**
   * True only while the `users` table is empty — the one-time bootstrap of a
   * fresh database, when a signed-out visitor must still be able to enrol.
   */
  enrolmentOpen?: boolean;
}

interface Credential {
  id: string;
  nickname: string | null;
  transports: string[];
  counter: number;
  createdAt: number;
  platform: 'platform' | 'cross-device' | 'security-key' | 'unknown';
}

// ─── state signals ───────────────────────────────────────────

const meState = signal<MeResponse | null>(null);
const credentials = signal<Credential[]>([]);
const meStatusText = signal<string>('Loading…');
const meStatusState = signal<'ok' | 'error' | null>(null);
const enrollStatusText = signal<string>('');
const enrollStatusState = signal<'ok' | 'error' | null>(null);
const passkeysStatusText = signal<string>('');
const passkeysStatusState = signal<'ok' | 'error' | null>(null);

const isSignedIn = computed(() => meState()?.user != null);
const enrolmentOpen = computed(() => meState()?.enrolmentOpen === true);

// ─── element references ──────────────────────────────────────

const logoutBtn = document.getElementById('btn-logout');
const loginLink = document.getElementById('link-login');
const enrollForm = document.getElementById('passkey-form');
const passkeyList = document.getElementById('passkey-list');

// ─── DOM bindings ────────────────────────────────────────────

bindText('me-status', meStatusText);
bindAttr('me-status', 'data-state', () => meStatusState() ?? null);
bindText('enroll-status', enrollStatusText);
bindAttr('enroll-status', 'data-state', () => enrollStatusState() ?? null);
bindText('passkeys-status', passkeysStatusText);
bindAttr('passkeys-status', 'data-state', () => passkeysStatusState() ?? null);

bindHidden(
  logoutBtn,
  computed(() => !isSignedIn()),
);
bindHidden(loginLink, isSignedIn);
bindHidden(
  passkeyList,
  computed(() => !isSignedIn() || credentials().length === 0),
);

bindList<Credential>(passkeyList, credentials, c => renderCredential(c, credentials().length));

// Anonymous state: the page is public on purpose (it is where the first
// passkey ever gets enrolled), so the *content* has to know who is looking.
// A stranger sees no Dashboard / Settings links — both would bounce them to
// the landing page — and no enrolment form, which the worker refuses with
// `enrollment-closed` for any handle it does not already know. The one
// exception is bootstrap: an empty `users` table is signed-out by definition
// and must still be able to enrol, so `/api/auth/me` reports `enrolmentOpen`.
const isAnonymous = computed(() => !isSignedIn());
bindHidden('nav-app', isAnonymous);
bindHidden('nav-settings', isAnonymous);
bindHidden(
  'enroll-section',
  computed(() => !isSignedIn() && !enrolmentOpen()),
);

// ─── helpers ────────────────────────────────────────────────

function setMeStatus(text: string, state: 'ok' | 'error' | null = null): void {
  meStatusText.set(text);
  meStatusState.set(state);
}
function setEnrollStatus(text: string, state: 'ok' | 'error' | null = null): void {
  enrollStatusText.set(text);
  enrollStatusState.set(state);
}
function setPasskeysStatus(text: string, state: 'ok' | 'error' | null = null): void {
  passkeysStatusText.set(text);
  passkeysStatusState.set(state);
}

async function refreshMe(): Promise<void> {
  try {
    const data = (await me()) as MeResponse;
    meState.set(data);
    if (data.user) {
      setMeStatus(
        'Signed in as ' + [data.user.handle, data.user.role].filter(Boolean).join(' · '),
        'ok',
      );
      const input = enrollForm?.querySelector<HTMLInputElement>('input[name="handle"]');
      if (input && !input.value) input.value = data.user.handle;
      // If onboarding is required (placeholder email still set), kick them
      // to /welcome — the manager UI is meaningless until they're real.
      if (data.onboardingRequired) {
        window.location.href = '/welcome';
        return;
      }
      void refreshCredentials();
    } else {
      setMeStatus('Not signed in.');
      credentials.set([]);
    }
  } catch (err) {
    setMeStatus(err instanceof Error ? err.message : 'Failed to load session.', 'error');
  }
}

function platformLabel(p: Credential['platform'], transports: readonly string[]): string {
  switch (p) {
    case 'platform':
      return 'Device passkey';
    case 'cross-device':
      return 'Phone / cross-device';
    case 'security-key':
      return 'Security key';
    default:
      return transports.length ? transports.join(', ') : 'Passkey';
  }
}

/**
 * A passkey's kind reads as a status, not as prose — and the fallback case
 * renders a transport list that comes off the authenticator, so it goes
 * through `bnBadge`, which sets it as `textContent`.
 */
function platformVariant(p: Credential['platform']): 'success' | 'primary' | 'default' {
  if (p === 'platform') return 'success';
  if (p === 'cross-device' || p === 'security-key') return 'primary';
  return 'default';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fallbackName(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `Passkey created ${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`;
}

async function refreshCredentials(): Promise<void> {
  setPasskeysStatus('Loading…');
  try {
    const res = await apiFetch('/api/auth/credentials');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { credentials: rows } = (await res.json()) as { credentials: Credential[] };
    credentials.set(rows);
    if (!rows.length) {
      setPasskeysStatus('No passkeys yet — enroll one below.');
    } else {
      setPasskeysStatus('');
    }
  } catch (err) {
    setPasskeysStatus(err instanceof Error ? err.message : 'Failed to load passkeys.', 'error');
  }
}

function renderCredential(c: Credential, total: number): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.id = c.id;

  const displayName = c.nickname ?? fallbackName(c.createdAt);

  const head = document.createElement('header');
  const name = document.createElement('strong');
  name.textContent = displayName;

  const meta = document.createElement('small');
  const createdDate = new Date(c.createdAt * 1000);
  const time = document.createElement('time');
  time.dateTime = createdDate.toISOString();
  time.textContent = createdDate.toLocaleDateString();
  meta.append(
    bnBadge(platformLabel(c.platform, c.transports), { variant: platformVariant(c.platform) }),
    ' · added ',
    time,
  );
  head.append(name, meta);

  const actions = document.createElement('footer');
  const renameBtn = bnButton('Rename', {
    variant: 'secondary',
    ariaLabel: `Rename passkey "${displayName}"`,
    onClick: () => startRename(li, c),
  });
  const revokeBtn = bnButton('Revoke', {
    variant: 'destructive',
    ariaLabel: `Revoke passkey "${displayName}"`,
    onClick: () => revokeCredential(c, displayName, total),
  });

  actions.append(renameBtn, revokeBtn);
  li.append(head, actions);
  return li;
}

function startRename(li: HTMLLIElement, c: Credential): void {
  const head = li.querySelector<HTMLElement>('header');
  const nameEl = head?.querySelector<HTMLElement>('strong');
  if (!head || !nameEl) return;
  const current = c.nickname ?? '';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.maxLength = 64;
  input.setAttribute('aria-label', 'New passkey name');

  const save = bnButton('Save', { variant: 'primary', type: 'submit' });
  const cancel = bnButton('Cancel', { variant: 'secondary' });

  const form = document.createElement('form');
  form.append(input, save, cancel);

  // One edit at a time: the row's own Rename/Revoke stay disabled until the
  // list re-renders (finish → refreshCredentials), so a half-typed name
  // can't be revoked out from under the form or opened twice.
  for (const action of li.querySelectorAll<HTMLButtonElement>(':scope > footer button')) {
    action.disabled = true;
  }

  nameEl.replaceWith(form);
  input.focus();
  input.select();

  const finish = (): void => {
    void refreshCredentials();
  };

  // Esc cancels — Enter submits via the form's submit handler below.
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish();
    }
  });
  cancel.addEventListener('click', finish);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    save.disabled = true;
    try {
      const res = await apiFetch(`/api/auth/credentials/${encodeURIComponent(c.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: input.value.trim() || null }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setPasskeysStatus(err?.error?.message ?? `Couldn't save (HTTP ${res.status}).`, 'error');
        return;
      }
      finish();
    } finally {
      save.disabled = false;
    }
  });
}

async function revokeCredential(c: Credential, displayName: string, total: number): Promise<void> {
  const isLast = total <= 1;
  const ok = await confirmDialog({
    title: isLast ? `Revoke your only passkey?` : `Revoke "${displayName}"?`,
    body: isLast
      ? 'This is your only passkey. Revoking it will lock you out until you re-enroll on another device.'
      : 'You can re-enroll this device later.',
    confirmLabel: isLast ? 'Revoke and lock me out' : 'Revoke',
    cancelLabel: 'Keep',
    destructive: true,
  });
  if (!ok) return;

  const url = isLast
    ? `/api/auth/credentials/${encodeURIComponent(c.id)}?force=1`
    : `/api/auth/credentials/${encodeURIComponent(c.id)}`;
  const res = await apiFetch(url, { method: 'DELETE' });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    setPasskeysStatus(err?.error?.message ?? `Couldn't revoke (HTTP ${res.status}).`, 'error');
    return;
  }
  setPasskeysStatus('Passkey revoked.', 'ok');
  void refreshCredentials();
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await logout();
    await refreshMe();
  });
}

if (!isPasskeySupported()) {
  setEnrollStatus('This browser does not support passkeys.', 'error');
}

if (enrollForm instanceof HTMLFormElement) {
  enrollForm.addEventListener('submit', async event => {
    event.preventDefault();
    await withSubmitting(enrollForm, async () => {
      const data = new FormData(enrollForm);
      const handle = String(data.get('handle') ?? '')
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9_-]{2,24}$/.test(handle)) {
        setEnrollStatus('Handle must be 2-24 chars: a-z, 0-9, _, -', 'error');
        return;
      }
      setEnrollStatus('Creating passkey…');
      try {
        await registerPasskey(handle);
        setEnrollStatus('Passkey set up.', 'ok');
        // After a fresh enrollment of a NEW user, /me will report
        // onboardingRequired=true and refreshMe will redirect to /welcome.
        await refreshMe();
      } catch (err) {
        setEnrollStatus(describeAuthError(err, 'Enrollment failed.'), 'error');
      }
    });
  });
}

void refreshMe();
