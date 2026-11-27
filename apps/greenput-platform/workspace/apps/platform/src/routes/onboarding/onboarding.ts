/**
 * `/onboarding` — 7-step workspace setup wizard.
 *
 * Steps 1–5 collect and review; step 5 is the one that calls
 * `/api/auth/register`. **Step 6 enrols a passkey**, and step 7 is the only
 * screen allowed to say the account is finished.
 *
 * Every answer the wizard asks for is stored (GP-039). It used to ask nine
 * steps' worth and send ten fields: the service area and radius, the team
 * size, the brand colour and a list of integrations were collected, read
 * back on the review step and discarded — two of them behind mandatory
 * gates. The team-size and integrations steps are gone (nothing consumed
 * either; none of the integrations existed). What remains reaches the
 * register body: the whole service list, the area and radius, the brand
 * colour and logo URL.
 *
 * That ordering is the point of this module. The wizard used to go straight
 * from a 201 to "You are all set!", and a Greenput account has no password —
 * so "all set" meant an account with literally no way to sign in to it. In
 * production that produced six users, zero `webauthn_credentials` rows, and
 * an owner whose only access was one session cookie with a seven-day
 * lifetime. The passkey step is not an upsell screen; it is the step where
 * the account becomes reachable.
 *
 * Two consequences worth keeping:
 *
 *   - Step 6 has no "Back". Behind it is the button that registers, and
 *     registering twice is a 409.
 *   - Step 7 reads "You are all set!" only when a credential actually
 *     exists. If enrolment was declined, skipped or impossible, it says so
 *     and names what to do instead. A congratulation is a factual claim.
 *
 * Persists to localStorage on every change so a refresh resumes mid-wizard —
 * but only within steps 1–5. See `loadStored` and the `finished` flag.
 */

import { computed, effect, signal } from '@basenative/runtime';
import {
  isWebAuthnAvailable,
  type AuthErrorKind,
} from '@basenative/auth-webauthn';
import { DEFAULT_BRAND_PRIMARY_COLOR } from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { field as formField } from '../shared/field.js';
import type { RouteView } from '../types.js';

interface OnboardingData {
  firstName: string;
  lastName: string;
  ownerEmail: string;
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  serviceTypes: string[];
  serviceArea: string;
  /** Whole miles; sent as `serviceRadiusMiles`. */
  serviceRadius: number;
  brandColor: string;
  logoUrl: string;
}

const STORAGE_KEY = 'gp_onboarding';
/**
 * Set the moment registration succeeds, cleared the moment a credential exists
 * or the owner explicitly declines one.
 *
 * The account is real from the 201 onward, so `STORAGE_KEY` (which holds the
 * form, including personal details) is deleted there — but deleting it was all
 * that happened, and a refresh on the passkey step then landed on step 1 with
 * an empty form. The person was signed in, held zero credentials, and the one
 * screen that existed to stop exactly that had vanished without a word. The
 * only forward action was refilling the form for a 409.
 *
 * This key carries no data. It only says "an account exists and still has no
 * way back into it", which is what a reload has to preserve.
 */
const PENDING_CREDENTIAL_KEY = 'gp_onboarding_needs_credential';
/** Last step the user types into — and the one whose button registers. */
const LAST_INPUT_STEP = 5;
/** Passkey enrolment: after the 201, before anything congratulates anyone. */
const PASSKEY_STEP = 6;
const TOTAL_STEPS = 7;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STEP_LABELS: Record<number, string> = {
  1: 'Your Account',
  2: 'Services',
  3: 'Service Area',
  4: 'Branding',
  5: 'Review',
  6: 'Sign-in Security',
  7: 'Complete',
};

const SERVICES: readonly string[] = [
  'HVAC',
  'Plumbing',
  'Electrical',
  'Roofing',
  'Landscaping',
  'Painting',
  'Flooring',
  'General Contracting',
  'Pest Control',
  'Cleaning',
  'Pool Service',
  'Fencing',
];

/**
 * Where the passkey step is, as far as the screen is concerned.
 *
 *   idle        nothing tried yet
 *   enrolling   the authenticator sheet is up, or should be
 *   enrolled    a credential exists — the account is reachable
 *   failed      an attempt did not work; retrying is worth offering
 *   declined    the user chose to move on without one
 *   unsupported this browser cannot create one at all
 *
 * Only `enrolled` earns a congratulation. The other five all continue, but
 * they continue to a different sentence.
 */
type PasskeyPhase =
  'idle' | 'enrolling' | 'enrolled' | 'failed' | 'declined' | 'unsupported';

/**
 * What the wizard's one primary button says on step 6, per phase.
 *
 * Exported with the message map for the same reason: this is the table that
 * decides whether someone can leave the screen, and it should be checked as a
 * table rather than by clicking through six states in a DOM.
 */
export const PASSKEY_BUTTON_LABELS: Record<PasskeyPhase, string> = {
  idle: 'Add a passkey',
  enrolling: 'Waiting for your device…',
  enrolled: 'Continue',
  failed: 'Try again',
  declined: 'Continue without a passkey',
  unsupported: 'Continue without a passkey',
};

/**
 * One true sentence per failure, each ending in what actually helps next.
 *
 * Exported so the mapping is testable as data. Asserting on the rendered
 * banner would pin today's markup; asserting on this pins the promise that
 * every classification has a sentence and none of them is "try again".
 *
 * These are enrolment-side wordings and deliberately differ from
 * `LOGIN_MESSAGES`: the user is *signed in* while reading them, which changes
 * what the right next step is. On /login the answer is "recover the account";
 * here it is "you are in, so fix this from Settings before you leave".
 */
export const PASSKEY_STEP_MESSAGES: Record<AuthErrorKind, string> = {
  'rate-limited':
    'Too many attempts from this network in the last minute. Wait a minute and try again — you are still signed in, so nothing is lost.',
  offline:
    "We couldn't reach Greenput to save the passkey. Check your connection and try again.",
  'no-credential':
    "Greenput couldn't confirm who you are, so it wouldn't save a passkey. Reload this page and try again.",
  cancelled:
    'No passkey was saved — the prompt was dismissed, or this device had nothing to offer. Try again, or use the fallback below.',
  'no-prompt':
    'No passkey prompt appeared, which usually means this device has no passkey it can create — no fingerprint reader, no Windows Hello, no security key. Try your phone, or use the fallback below.',
  unsupported:
    'This browser refused to create a passkey at all. Use the fallback below, then add one from a different browser or device.',
  server:
    'Something went wrong on our side while saving the passkey. Try again in a moment.',
  unknown:
    "The passkey wasn't saved. Try again, or use the fallback below to make sure you can still get back in.",
};

/**
 * Did `/api/auth/register` refuse because this email already has an account?
 *
 * Structural rather than `instanceof ApiError`, for the reason spelled out in
 * `libs/basenative/auth-webauthn/src/error-kind.ts`: `@basenative/fetch` is
 * reached under two names in this workspace, so an identity check can fail on
 * exactly the object it means.
 *
 * Worth singling out because it is the one registration failure with a
 * completely different remedy. It is also the failure a browser stuck on the
 * old wizard hits the moment this fix unsticks it — their data is still in
 * localStorage, "Create workspace" is the button in front of them, and their
 * account already exists.
 */
/** Give a server message a full stop, so a sentence can follow it. */
function endSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function isDuplicateAccount(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as {
    name?: unknown;
    status?: unknown;
    code?: unknown;
  };
  if (candidate.name !== 'ApiError') return false;
  return candidate.status === 409 || candidate.code === 'DUPLICATE';
}

const ONBOARDING_SHEET = defineSheet(`
[data-bn-onboarding] {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--gp-space-5);
  /* Same ink band the sign-in card sits on — onboarding is the other
     half of that first impression. */
  background-color: var(--gp-surface-ink);
  background-image: var(--gp-grid-on-ink);
}
[data-bn-onboarding-card] {
  background: var(--gp-surface);
  border-radius: var(--gp-radius-lg);
  border-block-start: 3px solid var(--gp-mark);
  padding: var(--gp-space-7);
  box-shadow: var(--gp-shadow-lg);
  width: min(36rem, 100%);
  display: grid;
  gap: var(--gp-space-5);
}
[data-bn-onboarding-card] header { display: grid; gap: var(--gp-space-2); }
[data-bn-onboarding-card] header h1 {
  font-size: var(--gp-text-2xl);
  font-weight: var(--gp-weight-black);
  letter-spacing: var(--gp-tracking-tight);
  color: var(--gp-text-strong);
  margin: 0;
}
[data-bn-onboarding-card] header p {
  margin: 0;
  color: var(--gp-text-muted);
}
[data-bn-progress] {
  display: grid;
  gap: var(--gp-space-2);
}
[data-bn-progress-bar] {
  background: var(--gp-primary-tint);
  height: 0.5rem;
  border-radius: var(--gp-radius-full);
  overflow: hidden;
}
[data-bn-progress-fill] {
  background: var(--gp-primary);
  height: 100%;
  transition: width 200ms ease;
}
[data-bn-progress] [data-bn-step-label] {
  font-size: var(--gp-text-sm);
  color: var(--gp-text-muted);
}
[data-bn-onboarding-step] {
  display: grid;
  gap: var(--gp-space-3);
}
[data-bn-onboarding-step] h2 {
  font-family: var(--gp-font-display);
  font-size: var(--gp-text-xl);
  margin: 0;
}
[data-bn-chip-grid] {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
  gap: var(--gp-space-2);
}
[data-bn-chip] {
  padding: var(--gp-space-3);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-md);
  background: var(--gp-surface);
  cursor: pointer;
  text-align: center;
  font: inherit;
  color: var(--gp-text);
  transition: border-color 120ms ease, background 120ms ease;
}
[data-bn-chip][data-bn-selected] {
  background: var(--gp-surface-sunk);
  border-color: var(--gp-primary);
  color: var(--gp-primary);
  font-weight: 600;
}
[data-bn-onboarding-actions] {
  display: flex;
  justify-content: space-between;
  gap: var(--gp-space-2);
}
[data-bn-onboarding-summary] {
  display: grid;
  gap: var(--gp-space-2);
}
[data-bn-onboarding-summary] dl {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: var(--gp-space-2);
  margin: 0;
}
[data-bn-onboarding-summary] dt {
  color: var(--gp-text-muted);
  font-size: var(--gp-text-sm);
}
[data-bn-onboarding-summary] dd {
  margin: 0;
}
[data-bn-onboarding-complete] {
  text-align: center;
  display: grid;
  gap: var(--gp-space-4);
}
[data-bn-onboarding-complete] [data-bn-check] {
  width: 4rem;
  height: 4rem;
  border-radius: var(--gp-radius-full);
  background: var(--gp-good-bg);
  color: var(--gp-success);
  display: grid;
  place-items: center;
  font-size: var(--gp-text-2xl);
  margin: 0 auto;
}
/* The same medallion, in the tone the sentence beside it has earned. A green
   tick over "you have no way to sign in" is the dead end this route shipped
   with, drawn rather than written. */
[data-bn-onboarding-complete] [data-bn-check][data-bn-tone='warn'] {
  background: var(--gp-move-bg);
  color: var(--gp-move-ink);
}
[data-bn-passkey] {
  display: grid;
  gap: var(--gp-space-3);
}
/* Every node in this pane is shown or hidden by phase, and an author sheet's
   display rule outranks the UA's [hidden] display:none — so the pane states
   the rule itself rather than trusting a stylesheet it does not own. Without
   it the fallback panel, which is display:grid below, stayed on screen through
   every phase: it sat behind "Waiting for your device" telling someone in the
   middle of enrolling that enrolment had failed. Two selectors deep, so it
   beats the single-attribute rules underneath. The [data-bn-button][hidden]
   rule in styles/list-route.ts exists for the same reason. */
[data-bn-passkey] [hidden] {
  display: none;
}
[data-bn-passkey] [data-bn-passkey-decline] {
  justify-self: start;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--gp-text-muted);
  text-decoration: underline;
  text-underline-offset: 0.2em;
  cursor: pointer;
}
[data-bn-passkey] [data-bn-passkey-decline]:hover {
  color: var(--gp-text);
}
/* The fallback is not an aside. Someone reading it has no way back into this
   account, so it gets the weight of a notice and sits on its own paper. */
[data-bn-passkey-fallback] {
  display: grid;
  gap: var(--gp-space-2);
  padding: var(--gp-space-4);
  border: 1px solid var(--gp-rule-strong);
  border-inline-start: 3px solid var(--gp-warning);
  border-radius: var(--gp-radius-md);
  background: var(--gp-surface-sunk);
}
[data-bn-passkey-fallback] h3 {
  margin: 0;
  font-size: var(--gp-text-base);
  font-weight: var(--gp-weight-bold);
}
[data-bn-passkey-fallback] ol {
  margin: 0;
  padding-inline-start: var(--gp-space-5);
  display: grid;
  gap: var(--gp-space-2);
}
[data-bn-passkey-fallback] p {
  margin: 0;
  font-size: var(--gp-text-sm);
  color: var(--gp-text-muted);
}
`);

function emptyData(): OnboardingData {
  return {
    firstName: '',
    lastName: '',
    ownerEmail: '',
    companyName: '',
    companyPhone: '',
    companyEmail: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    serviceTypes: [],
    serviceArea: '',
    serviceRadius: 25,
    // The same green schema.sql gives `branding.primary_color`, from the one
    // place it is declared — the swatch used to show a different green from
    // the one Settings showed after signup (GP-039).
    brandColor: DEFAULT_BRAND_PRIMARY_COLOR,
    logoUrl: '',
  };
}

function loadStored(): { step: number; data: OnboardingData } {
  try {
    // Checked first: once the account exists the form is irrelevant, and
    // landing anywhere but the passkey step would be offering to create an
    // account that is already there.
    if (localStorage.getItem(PENDING_CREDENTIAL_KEY)) {
      return { step: PASSKEY_STEP, data: emptyData() };
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<{
        step: number;
        data: OnboardingData;
      }>;
      const data: OnboardingData = { ...emptyData(), ...(parsed.data ?? {}) };
      // Clamp to the input steps. A stored step beyond `LAST_INPUT_STEP` is
      // not resumable by definition — those screens exist only after a
      // successful register in this same page load — and it is exactly what
      // the old build wrote: it numbered "You are all set!" step 8 and
      // persisted it, so /onboarding opened on a permanent congratulation for
      // anyone who had ever finished, on that browser, forever. `finished`
      // below stops new writes; this is what rescues the browsers that
      // already have one.
      const stored =
        typeof parsed.step === 'number' ? Math.trunc(parsed.step) : 1;
      const step = Math.min(Math.max(1, stored), LAST_INPUT_STEP);
      return { step, data };
    }
  } catch {
    // ignore
  }
  return { step: 1, data: emptyData() };
}

export function renderOnboardingRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);
  adoptSheet(ONBOARDING_SHEET);

  const initial = loadStored();
  const step = signal(initial.step);
  const data = signal<OnboardingData>(initial.data);
  const submitting = signal(false);
  const submitError = signal<{ text: string; duplicate: boolean } | null>(null);

  // Asked once, at mount. A browser either has the WebAuthn API or it does
  // not, and offering a button that cannot work is its own dead end: better
  // to open step 6 already showing the fallback than to make someone press
  // something to find out.
  const passkeyPhase = signal<PasskeyPhase>(
    isWebAuthnAvailable() ? 'idle' : 'unsupported',
  );
  const passkeyNote = signal<{ tone: 'good' | 'bad'; text: string } | null>(
    null,
  );
  /** The only thing that earns "You are all set!". */
  const hasPasskey = computed(() => passkeyPhase() === 'enrolled');

  const cleanups: Cleanup[] = [];

  const progressPercent = computed(() =>
    Math.round(((step() - 1) / (TOTAL_STEPS - 1)) * 100),
  );

  const canAdvance = computed(() => {
    const s = step();
    const d = data();
    switch (s) {
      case 1:
        return (
          d.firstName.trim().length > 0 &&
          d.lastName.trim().length > 0 &&
          EMAIL_PATTERN.test(d.ownerEmail) &&
          d.companyName.trim().length > 0
        );
      case 2:
        return d.serviceTypes.length > 0;
      // The only other gate. It is allowed to be one because the answer is
      // stored: a step must never refuse to continue over something the
      // product then throws away (GP-039 — team size did exactly that).
      case 3:
        return d.serviceArea.trim().length > 0;
      case 4:
      case 5:
        return true;
      // Steps 6 and 7 are deliberately absent: they are post-registration and
      // their primary button is driven by `passkeyPhase`, not by form
      // validity. `canAdvance` stays a statement about the *input* steps.
      default:
        return false;
    }
  });

  // ── persist to localStorage on every change ────────────────────────────
  //
  // Once registration has succeeded there is nothing left to resume, and
  // writing anything here is actively harmful: `complete()` used to call
  // `localStorage.removeItem(...)` and then `step.set(...)`, which re-ran this
  // effect one tick later and wrote the key straight back with the finished
  // step in it. The removal was real and the resurrection was silent.
  //
  // Both signals are read *before* the guard on purpose. Returning early from
  // a tracked effect before touching them would drop this effect's
  // dependencies for good, and the correctness of the write would then rest
  // on the flag never being un-set.
  let finished = false;
  cleanups.push(
    effect(() => {
      const s = step();
      const d = data();
      if (finished) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ step: s, data: d }));
      } catch {
        // ignore
      }
    }).dispose,
  );

  function update<K extends keyof OnboardingData>(
    field: K,
    value: OnboardingData[K],
  ): void {
    data.set({ ...data.peek(), [field]: value });
  }

  function toggle(field: 'serviceTypes', value: string): void {
    const current = data.peek()[field];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    data.set({ ...data.peek(), [field]: next });
  }

  function next(): void {
    if (step.peek() < TOTAL_STEPS && canAdvance()) {
      step.set(step.peek() + 1);
    }
  }
  function back(): void {
    if (step.peek() > 1) step.set(step.peek() - 1);
  }

  async function complete(): Promise<void> {
    submitting.set(true);
    submitError.set(null);
    const d = data.peek();
    try {
      await deps.api.post('/api/auth/register', {
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.ownerEmail,
        workspaceName: d.companyName,
        // `trade` is the first service, for the readers that still want one
        // string; `serviceTypes` is the whole "pick all that apply" answer.
        trade: d.serviceTypes[0] ?? 'General',
        serviceTypes: d.serviceTypes,
        phone: d.companyPhone,
        street: d.address,
        city: d.city,
        state: d.state,
        zip: d.zip,
        serviceArea: d.serviceArea,
        serviceRadiusMiles: d.serviceRadius,
        // Goes to the `branding` row, the table the micro-site reads.
        brandColor: d.brandColor,
        // Only when given: RegisterSchema wants a URL or nothing, and '' is
        // neither.
        ...(d.logoUrl.trim() ? { logoUrl: d.logoUrl.trim() } : {}),
      });

      // The session now exists and the auth store does not know it.
      //
      // This is the whole of the "Go to dashboard lands on /login" bug, and
      // the fix belongs here rather than at the navigation. `main.ts` runs
      // `checkSession()` at boot; on a browser arriving at /onboarding that
      // 401s and caches `sessionChecked = true` with `user = null`. The
      // router guard reads exactly those two signals. Registration then sets
      // a valid `gp_session` cookie — which nothing in the store ever looks
      // at again, so the guard keeps bouncing a signed-in user while
      // /dashboard loaded directly in the same browser renders fine.
      //
      // `complete()` used to call `checkSession()` on the line *above* the
      // register call, which is the one position where it can do nothing at
      // all: too early to see the new cookie, and enough to fill the cache
      // that stops it being looked for later.
      //
      // `refreshSession()` re-reads /api/auth/me unconditionally. It is also
      // how the store gets `workspaceId`, which the register response does not
      // return.
      await deps.auth.refreshSession();

      // Order matters: the flag has to be set before the step change that
      // re-runs the persist effect, or the removal below is undone one tick
      // later. See the effect for the full story.
      finished = true;
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem(PENDING_CREDENTIAL_KEY, '1');
      } catch {
        // ignore
      }
      step.set(PASSKEY_STEP);
    } catch (err) {
      submitError.set({
        text: err instanceof Error ? err.message : 'Registration failed.',
        duplicate: isDuplicateAccount(err),
      });
    } finally {
      submitting.set(false);
    }
  }

  /**
   * Enrol a passkey through the store that already ships one.
   *
   * `AuthStore.enrollPasskey()` and `WebAuthnClient.register()` have both been
   * in the tree the whole time — /settings → Security drives the latter — so
   * there is no third implementation here, just the first call from
   * onboarding. The store owns the prompt timeout, so this cannot hang.
   */
  function clearPendingCredential(): void {
    try {
      localStorage.removeItem(PENDING_CREDENTIAL_KEY);
    } catch {
      // ignore
    }
  }

  async function enroll(): Promise<void> {
    passkeyPhase.set('enrolling');
    passkeyNote.set(null);
    try {
      await deps.auth.enrollPasskey();
      // Applied unconditionally, even if the user declined while waiting: a
      // credential now exists, which is a fact about the account rather than a
      // screen state, and it is the fact every other sentence here depends on.
      passkeyPhase.set('enrolled');
      clearPendingCredential();
      passkeyNote.set({
        tone: 'good',
        text: 'Passkey saved. That is how you will sign in from now on.',
      });
    } catch (err) {
      // The raw message is a DOMException string or a bare HTTP status and is
      // not for a contractor to read. Log it, show the sentence that matches
      // what actually went wrong.
      console.error('Passkey enrolment failed:', err);
      // Do not overturn a decision the user already made while this was
      // pending. Chromium takes the better part of a minute to give up on an
      // authenticator that never answers — measured at 57s — so "I can't do
      // this right now" is a button someone can realistically press *during*
      // an attempt, and an error arriving afterwards must not undo it.
      if (passkeyPhase.peek() !== 'enrolling') return;
      passkeyPhase.set('failed');
      passkeyNote.set({
        tone: 'bad',
        text: PASSKEY_STEP_MESSAGES[deps.auth.errorKind() ?? 'unknown'],
      });
    }
  }

  /** Move on without one — eyes open, with the fallback on screen. */
  function decline(): void {
    passkeyPhase.set('declined');
    // Cleared on an explicit decline too. The marker's job is to survive a
    // RELOAD, not to trap someone on this step forever: they were shown the
    // consequence and chose, and re-opening /onboarding should not re-ask.
    // The un-enrolled account is surfaced in Settings -> Security instead,
    // which is where the fix lives.
    clearPendingCredential();
    passkeyNote.set(null);
  }

  // ── DOM ────────────────────────────────────────────────────────────────
  const heading = el('h1', {});
  const description = el('p', {});
  const progressFill = el('div', { 'data-bn-progress-fill': '' });
  const progressBar = el(
    'div',
    {
      'data-bn-progress-bar': '',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
    },
    progressFill,
  );
  const stepLabel = el('span', { 'data-bn-step-label': '' });
  const progress = el(
    'div',
    { 'data-bn-progress': '' },
    progressBar,
    stepLabel,
  );

  const stepBody = el('div', { 'data-bn-onboarding-step': '' });

  const errorText = el('span', {});
  // Shown only for a 409. Every other registration failure is worth retrying
  // with the same button; this one never is, and without somewhere to go it is
  // a wall — which is precisely what a browser resuming the old stuck wizard
  // walks into.
  const errorWayOut = el(
    'span',
    { 'data-testid': 'onboarding-error-wayout', hidden: true },
    ' Already have an account? ',
    el(
      'a',
      { href: '/login', 'data-testid': 'onboarding-error-login' },
      'Sign in',
    ),
    ", or if you can't, ",
    el(
      'a',
      { href: '/recover', 'data-testid': 'onboarding-error-recover' },
      'recover it',
    ),
    '.',
  );
  const errorBanner = el(
    'output',
    {
      'data-bn-error': '',
      role: 'alert',
      'data-testid': 'onboarding-error',
      hidden: true,
    },
    errorText,
    errorWayOut,
  );

  // ── The passkey pane (step 6) ──────────────────────────────────────────
  //
  // Built once, here, and re-attached by the step-body effect rather than
  // rebuilt by it. Its own nodes are then stable enough for the phase effects
  // below to write into by reference, which is what keeps this step out of the
  // focus-loss trap the input steps fell into: nothing on this screen
  // re-renders a subtree, so nothing destroys a node someone is using.
  const passkeyNoteNode = el('output', {
    role: 'status',
    'data-testid': 'onboarding-passkey-note',
    hidden: true,
  });
  const declineButton = el(
    'button',
    {
      type: 'button',
      'data-bn-passkey-decline': '',
      'data-testid': 'onboarding-passkey-decline',
    },
    "I can't do this right now",
  ) as HTMLButtonElement;
  const fallback = el(
    'div',
    {
      'data-bn-passkey-fallback': '',
      'data-testid': 'onboarding-passkey-fallback',
      hidden: true,
    },
    el('h3', {}, 'Then do one of these before you close this tab'),
    el(
      'ol',
      {},
      el(
        'li',
        {},
        'Add a recovery phone number — your own mobile, not the company line. ',
        el(
          'a',
          { href: '/settings', 'data-testid': 'onboarding-passkey-settings' },
          'Settings → Security',
        ),
        '. We text a code to it when you cannot sign in.',
      ),
      el(
        'li',
        {},
        'Or add a passkey from a device that can make one — a phone, or a laptop with a fingerprint reader — from the same Settings → Security screen.',
      ),
    ),
    el(
      'p',
      {},
      'Until one of those is done, the only thing signed in to this account is this browser, and that expires. There is no password on a Greenput account, so there would be nothing left to sign in with.',
    ),
  );
  const passkeyPane = el(
    'div',
    { 'data-bn-passkey': '' },
    el('h2', {}, 'Add a passkey'),
    el(
      'p',
      { 'data-testid': 'onboarding-passkey-lede' },
      'Your workspace is created and you are signed in. One thing left: set up how you get back in. A passkey uses this device — your fingerprint, your face, or its PIN. Greenput accounts have no password, so this is what signing in means.',
    ),
    passkeyNoteNode,
    declineButton,
    fallback,
  );

  // ── The done pane (step 7) ─────────────────────────────────────────────
  const doneCheck = el('div', { 'data-bn-check': '', 'aria-hidden': 'true' });
  const doneHeading = el('h2', { 'data-testid': 'onboarding-done-heading' });
  const doneBody = el('p', { 'data-testid': 'onboarding-done-body' });
  // The screen whose whole purpose is routing a credential-less owner to the
  // fix had no link to it: it named "Settings → Security" in prose and its only
  // control was "Go to dashboard". Named prominently, and only when it applies.
  const doneFixLink = el(
    'a',
    {
      href: '/settings',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'onboarding-done-settings',
      hidden: true,
    },
    'Add a passkey or recovery number',
  );
  // Signup never asks when the contractor works — the register batch has no
  // session to write availability under, and GP-039 is still deciding which
  // signup answers survive at all — so the hours live in ONE place, Settings →
  // Availability, and this is the pointer to it. Nothing can be booked until
  // that screen has been filled in (GP-101), which is worth a sentence here.
  const doneHoursLink = el(
    'a',
    {
      href: '/settings?tab=availability',
      'data-testid': 'onboarding-done-availability',
    },
    'Set your working hours',
  );
  const doneHours = el(
    'p',
    { 'data-testid': 'onboarding-done-hours' },
    'One more thing before anyone can book you: tell us when you work. ',
    doneHoursLink,
    '.',
  );
  const doneCardCopy = el(
    'p',
    { 'data-testid': 'onboarding-done-card-copy' },
    'A card on file is required before this workspace can accept or auto-book a lead. Each lead fee is charged when a job is booked — accepting a lead charges nothing. If a charge is declined, lead delivery pauses until the card is updated and the outstanding fee is collected.',
  );
  const doneCardButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-testid': 'onboarding-done-card',
    },
    'Add a card for lead fees',
  ) as HTMLButtonElement;
  const doneCardError = el('p', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': 'onboarding-done-card-error',
    hidden: true,
  });
  const donePane = el(
    'div',
    { 'data-bn-onboarding-complete': '' },
    doneCheck,
    doneHeading,
    doneBody,
    doneFixLink,
    doneHours,
    doneCardCopy,
    doneCardButton,
    doneCardError,
  );

  const backButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'onboarding-back',
    },
    'Back',
  );
  const nextButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'onboarding-next',
    },
    'Continue',
  );
  cleanups.push(
    on(doneCardButton, 'click', () => {
      void (async () => {
        doneCardButton.disabled = true;
        doneCardError.textContent = '';
        doneCardError.setAttribute('hidden', '');
        try {
          const back = `${window.location.origin}/settings?tab=billing`;
          const res = await deps.billing.paymentMethod(back);
          const url = res.data?.url;
          if (!url) {
            doneCardError.textContent =
              'Stripe did not return a link. Try again in a moment.';
            doneCardError.removeAttribute('hidden');
            return;
          }
          window.open(url, '_blank', 'noopener');
        } catch (err) {
          doneCardError.textContent =
            err instanceof Error && err.message
              ? err.message
              : 'Could not open Stripe to add a card.';
          doneCardError.removeAttribute('hidden');
        } finally {
          doneCardButton.disabled = false;
        }
      })();
    }),
    on(backButton, 'click', back),
    on(declineButton, 'click', decline),
    on(nextButton, 'click', () => {
      const s = step.peek();
      if (s === LAST_INPUT_STEP) {
        void complete();
        return;
      }
      if (s === PASSKEY_STEP) {
        // One button, six phases. `enrolling` never reaches here — the effect
        // below disables it — and the three terminal phases all mean the same
        // thing to this handler: the user has decided, move to step 7.
        const phase = passkeyPhase.peek();
        if (phase === 'idle' || phase === 'failed') {
          void enroll();
        } else if (phase !== 'enrolling') {
          step.set(TOTAL_STEPS);
        }
        return;
      }
      if (s === TOTAL_STEPS) {
        void deps.router.navigate('/dashboard');
        return;
      }
      next();
    }),
  );

  const actions = el(
    'div',
    { 'data-bn-onboarding-actions': '' },
    backButton,
    nextButton,
  );

  const card = el(
    'article',
    { 'data-bn-onboarding-card': '' },
    el('header', {}, heading, description),
    progress,
    stepBody,
    errorBanner,
    actions,
  );

  const root = el(
    'section',
    { 'data-bn-onboarding': '', 'data-bn-route': 'onboarding' },
    card,
  );

  // Sync header / progress / back button whenever step or phase changes.
  cleanups.push(
    effect(() => {
      const s = step();
      heading.textContent =
        s === TOTAL_STEPS
          ? // A claim, checked. Reaching this screen without a credential is
            // the dead end this route shipped with; saying so is the fix.
            hasPasskey()
            ? 'You are all set!'
            : 'Almost there'
          : `Step ${s} of ${TOTAL_STEPS}`;
      description.textContent = STEP_LABELS[s] ?? '';
      progressFill.setAttribute('style', `width: ${progressPercent()}%`);
      progressBar.setAttribute('aria-valuenow', String(progressPercent()));
      stepLabel.textContent = `${STEP_LABELS[s]} · ${progressPercent()}%`;

      // No way back from step 6: the button behind it is the one that
      // registers, and registering the same email twice is a 409.
      if (s === 1 || s >= PASSKEY_STEP) {
        backButton.setAttribute('hidden', '');
      } else {
        backButton.removeAttribute('hidden');
      }
    }).dispose,
  );

  // The primary button, in one place.
  //
  // Its label and disabled state used to be written by two effects — the
  // header effect, then a second one for `submitting` — and the second had no
  // else branch. So "Saving…" was a one-way door: any failed registration
  // left the only button on the screen reading "Saving…" forever while
  // nothing was saving, on a form that was ready to be resubmitted. One
  // effect, every branch terminating in a label, is the shape that cannot
  // have that bug.
  cleanups.push(
    effect(() => {
      const s = step();
      const busy = submitting();
      const phase = passkeyPhase();

      if (s === LAST_INPUT_STEP) {
        nextButton.textContent = busy
          ? 'Creating your workspace…'
          : 'Create workspace';
        nextButton.disabled = busy || !canAdvance();
        return;
      }
      if (s === PASSKEY_STEP) {
        nextButton.textContent = PASSKEY_BUTTON_LABELS[phase];
        nextButton.disabled = phase === 'enrolling';
        return;
      }
      if (s === TOTAL_STEPS) {
        nextButton.textContent = 'Go to dashboard';
        nextButton.disabled = false;
        return;
      }
      nextButton.textContent = 'Continue';
      nextButton.disabled = !canAdvance();
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const failure = submitError();
      if (failure) {
        // The server's message is a sentence fragment with no full stop
        // ("An account with this email already exists"), and the way-out
        // sentence renders immediately after it. Without this they run
        // together into one unreadable line.
        errorText.textContent = endSentence(failure.text);
        errorWayOut.hidden = !failure.duplicate;
        errorBanner.removeAttribute('hidden');
      } else {
        errorText.textContent = '';
        errorWayOut.hidden = true;
        errorBanner.setAttribute('hidden', '');
      }
    }).dispose,
  );

  // ── Passkey pane state ─────────────────────────────────────────────────
  cleanups.push(
    effect(() => {
      const phase = passkeyPhase();
      const note = passkeyNote();

      // The fallback is visible whenever a passkey is not going to happen on
      // this device — including before anything is tried, when we already
      // know the browser cannot.
      fallback.hidden = !(
        phase === 'unsupported' ||
        phase === 'declined' ||
        phase === 'failed'
      );
      // Nothing to decline once it has worked, and nothing to decline when
      // there was never an offer — but it stays through `enrolling`, on
      // purpose. A prompt that is not coming can hold that phase for the best
      // part of a minute, and a minute with the primary button disabled and no
      // other control on screen is its own dead end.
      declineButton.hidden =
        phase === 'enrolled' || phase === 'declined' || phase === 'unsupported';
      declineButton.textContent =
        phase === 'failed'
          ? 'Continue without a passkey'
          : "I can't do this right now";

      const text =
        note?.text ??
        (phase === 'unsupported'
          ? 'This browser cannot create a passkey — no fingerprint reader, no Windows Hello, no security key it can reach. That is not something this screen can fix, so do one of the two things below instead.'
          : phase === 'enrolling'
            ? 'Waiting for your device. Confirm with your fingerprint, face, or PIN.'
            : phase === 'declined'
              ? 'No passkey on this device, then. Here is what to do instead.'
              : null);
      if (text) {
        passkeyNoteNode.textContent = text;
        passkeyNoteNode.hidden = false;
      } else {
        passkeyNoteNode.textContent = '';
        passkeyNoteNode.hidden = true;
      }
      if (note?.tone === 'bad') {
        passkeyNoteNode.setAttribute('data-bn-error', '');
      } else {
        passkeyNoteNode.removeAttribute('data-bn-error');
      }
    }).dispose,
  );

  // ── Done pane copy ─────────────────────────────────────────────────────
  cleanups.push(
    effect(() => {
      const enrolled = hasPasskey();
      doneCheck.textContent = enrolled ? '✓' : '!';
      if (enrolled) {
        doneCheck.removeAttribute('data-bn-tone');
      } else {
        doneCheck.setAttribute('data-bn-tone', 'warn');
      }
      doneHeading.textContent = enrolled
        ? 'Welcome to Greenput'
        : 'Your workspace is ready — your way back in is not';
      doneBody.textContent = enrolled
        ? 'Your passkey is saved on this device. Next time, "Sign in with passkey" is all it takes.'
        : 'You are signed in now, but nothing can sign you in again yet. Add a passkey or a recovery phone number before this session expires — it is the only thing standing between you and a locked account.';
      doneFixLink.hidden = enrolled;
    }).dispose,
  );

  // Rebuild the step body only when the *step* changes. Reading `data()`
  // here (instead of `data.peek()`) was the focus-loss bug: every keystroke
  // calls `update()`, which replaces the whole `data` signal, which re-ran
  // this effect, cleared `stepBody`, and rebuilt it from scratch — destroying
  // the `<input>` the user was typing into (and its focus) on every
  // character. Fields don't need this effect to reflect their own edits
  // back to themselves; anything else on the page that must react to a data
  // change (chip highlighting, the radius label) updates its own DOM node
  // directly from the control's own event handler instead.
  cleanups.push(
    effect(() => {
      const s = step();
      clear(stepBody);
      // Steps 8 and 9 are the two panes built once above, re-attached rather
      // than rebuilt, so the phase effects can hold references into them.
      stepBody.append(
        s === PASSKEY_STEP
          ? passkeyPane
          : s === TOTAL_STEPS
            ? donePane
            : renderStepBody(s, data.peek(), update, toggle),
      );
    }).dispose,
  );

  return {
    element: root,
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}

function renderStepBody(
  s: number,
  d: OnboardingData,
  update: <K extends keyof OnboardingData>(f: K, v: OnboardingData[K]) => void,
  toggle: (field: 'serviceTypes', value: string) => void,
): HTMLElement {
  switch (s) {
    case 1:
      return renderAccountStep(d, update);
    case 2:
      return renderServicesStep(d, toggle);
    case 3:
      return renderAreaStep(d, update);
    case 4:
      return renderBrandingStep(d, update);
    case 5:
      return renderReviewStep(d);
    // 6 (passkey) and 7 (done) are prebuilt panes owned by the route — see
    // the step-body effect. They are not rebuilt on step change because their
    // contents are driven by signals the route holds references into.
    default:
      return el('div', {});
  }
}

function fieldInput(
  label: string,
  value: string,
  onChange: (v: string) => void,
  options: { type?: string; placeholder?: string; testid?: string } = {},
): HTMLElement {
  const input = el('input', {
    type: options.type ?? 'text',
    'data-bn-input': '',
    placeholder: options.placeholder ?? '',
    'data-testid': options.testid ?? '',
  }) as HTMLInputElement;
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  return formField(label, input);
}

function renderAccountStep(
  d: OnboardingData,
  update: <K extends keyof OnboardingData>(f: K, v: OnboardingData[K]) => void,
): HTMLElement {
  const grid = el(
    'div',
    { 'data-bn-field-grid': '' },
    fieldInput('First name', d.firstName, (v) => update('firstName', v), {
      testid: 'onboarding-firstName',
    }),
    fieldInput('Last name', d.lastName, (v) => update('lastName', v), {
      testid: 'onboarding-lastName',
    }),
    fieldInput('Owner email', d.ownerEmail, (v) => update('ownerEmail', v), {
      type: 'email',
      testid: 'onboarding-ownerEmail',
    }),
    fieldInput('Company name', d.companyName, (v) => update('companyName', v), {
      testid: 'onboarding-companyName',
    }),
    fieldInput(
      'Company phone',
      d.companyPhone,
      (v) => update('companyPhone', v),
      {
        type: 'tel',
        testid: 'onboarding-companyPhone',
      },
    ),
    fieldInput('Street address', d.address, (v) => update('address', v), {
      placeholder: 'Optional',
      testid: 'onboarding-address',
    }),
    fieldInput('City', d.city, (v) => update('city', v), {
      placeholder: 'Optional',
      testid: 'onboarding-city',
    }),
    fieldInput('State', d.state, (v) => update('state', v), {
      placeholder: 'Optional',
      testid: 'onboarding-state',
    }),
    fieldInput('ZIP code', d.zip, (v) => update('zip', v), {
      placeholder: 'Optional',
      testid: 'onboarding-zip',
    }),
  );
  return el(
    'div',
    {},
    el('h2', {}, 'Tell us about yourself'),
    el(
      'p',
      {},
      'We need a name and email to set up your workspace. Your business address powers your public micro-site and local search listing — you can add it later from Settings if you don’t have it handy.',
    ),
    grid,
  );
}

function renderServicesStep(
  d: OnboardingData,
  toggle: (field: 'serviceTypes', value: string) => void,
): HTMLElement {
  const grid = el('div', { 'data-bn-chip-grid': '' });
  for (const service of SERVICES) {
    const selected = d.serviceTypes.includes(service);
    const chip = el(
      'button',
      {
        type: 'button',
        'data-bn-chip': '',
        'data-testid': `onboarding-service-${service}`,
        'aria-pressed': selected ? 'true' : 'false',
      },
      service,
    );
    if (selected) chip.setAttribute('data-bn-selected', '');
    chip.addEventListener('click', () => {
      toggle('serviceTypes', service);
      const nowSelected = !chip.hasAttribute('data-bn-selected');
      chip.toggleAttribute('data-bn-selected', nowSelected);
      chip.setAttribute('aria-pressed', nowSelected ? 'true' : 'false');
    });
    grid.append(chip);
  }
  return el(
    'div',
    {},
    el('h2', {}, 'What services do you offer?'),
    el('p', {}, 'Pick all that apply.'),
    grid,
  );
}

function renderAreaStep(
  d: OnboardingData,
  update: <K extends keyof OnboardingData>(f: K, v: OnboardingData[K]) => void,
): HTMLElement {
  const radius = el('input', {
    type: 'range',
    min: '5',
    max: '100',
    step: '5',
    'data-bn-input': '',
    'data-testid': 'onboarding-serviceRadius',
  }) as HTMLInputElement;
  radius.value = String(d.serviceRadius);
  const radiusField = formField(
    `Service radius: ${d.serviceRadius} miles`,
    radius,
  );
  const radiusLabel = radiusField.querySelector('label');
  radius.addEventListener('input', () => {
    update('serviceRadius', Number(radius.value));
    if (radiusLabel) {
      radiusLabel.textContent = `Service radius: ${radius.value} miles`;
    }
  });
  return el(
    'div',
    {},
    el('h2', {}, 'Where do you operate?'),
    fieldInput(
      'Primary city / region',
      d.serviceArea,
      (v) => update('serviceArea', v),
      {
        testid: 'onboarding-serviceArea',
      },
    ),
    radiusField,
  );
}

function renderBrandingStep(
  d: OnboardingData,
  update: <K extends keyof OnboardingData>(f: K, v: OnboardingData[K]) => void,
): HTMLElement {
  const colorInput = el('input', {
    type: 'color',
    'data-bn-input': '',
    'data-testid': 'onboarding-brandColor',
  }) as HTMLInputElement;
  colorInput.value = d.brandColor;
  colorInput.addEventListener('input', () =>
    update('brandColor', colorInput.value),
  );
  return el(
    'div',
    {},
    el('h2', {}, 'Brand basics'),
    el(
      'p',
      {},
      'Optional — the colour your public site uses. You can change both later from Settings → Branding.',
    ),
    formField('Brand color', colorInput),
    fieldInput('Logo URL', d.logoUrl, (v) => update('logoUrl', v), {
      type: 'url',
      placeholder: 'https://…',
      testid: 'onboarding-logoUrl',
    }),
  );
}

function renderReviewStep(d: OnboardingData): HTMLElement {
  const summary = el(
    'dl',
    {},
    el('dt', {}, 'Owner'),
    el('dd', {}, `${d.firstName} ${d.lastName}`.trim() || '—'),
    el('dt', {}, 'Email'),
    el('dd', {}, d.ownerEmail || '—'),
    el('dt', {}, 'Company'),
    el('dd', {}, d.companyName || '—'),
    el('dt', {}, 'Services'),
    el('dd', {}, d.serviceTypes.join(', ') || '—'),
    el('dt', {}, 'Service area'),
    el(
      'dd',
      {},
      `${d.serviceArea || '—'}${d.serviceArea ? ` (${d.serviceRadius} mi radius)` : ''}`,
    ),
    // Only what is stored is read back. The review used to recite a team
    // size and an integrations list that the register call then dropped.
    el('dt', {}, 'Brand colour'),
    el('dd', {}, d.brandColor),
  );
  return el(
    'div',
    { 'data-bn-onboarding-summary': '' },
    el('h2', {}, 'Review'),
    el('p', {}, 'Looks good? Click "Create workspace" to set up your account.'),
    summary,
  );
}
