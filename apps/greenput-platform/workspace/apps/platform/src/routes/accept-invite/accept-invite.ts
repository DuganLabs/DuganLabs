/**
 * `/accept-invite/:token` — where an invited teammate lands (GP-008).
 *
 * The link is the invitation: the owner created it in Settings → Team and
 * passed it on by hand, because nothing here sends mail. This screen shows
 * who it is for, and one button does the whole way in — burn the token for a
 * session, then enrol a passkey under that session, then go to the dashboard.
 *
 * Passkey enrolment can fail after the session exists (no authenticator, the
 * prompt dismissed). That is said plainly: the teammate IS signed in, has NO
 * passkey, and must add one from Settings → Security before the session ends
 * — because once it does, an account with no passkey and no recovery number
 * has no door at all.
 */

import { signal, effect } from '@basenative/runtime';
import type { InvitationPreview } from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet } from '../../styles/sheet.js';
import { el, on, type Cleanup } from '../../lib/dom.js';
import { AUTH_CARD_SHEET, buildAuthCard } from '../shared/auth-card.js';
import type { RouteView } from '../types.js';

type Phase =
  'loading' | 'ready' | 'accepting' | 'enrolling' | 'enrol-failed' | 'invalid';

/** Why the invitation cannot be used, in terms this screen can act on. */
export type InviteFailure = 'used' | 'expired' | 'enrolled' | 'missing';

export function classifyInviteError(err: unknown): InviteFailure {
  if (typeof err !== 'object' || err === null) return 'missing';
  const code = (err as { code?: unknown }).code;
  if (code === 'INVITE_USED') return 'used';
  if (code === 'INVITE_EXPIRED') return 'expired';
  if (code === 'ALREADY_ENROLLED') return 'enrolled';
  return 'missing';
}

export const INVITE_MESSAGES: Record<InviteFailure, string> = {
  used: 'This invitation has already been used. Sign in with the passkey that was created, or ask a teammate with owner or admin access to invite you again.',
  expired:
    'This invitation has expired. Ask a teammate with owner or admin access to invite you again.',
  enrolled: 'This account already has a passkey. Sign in with it instead.',
  missing:
    'This invitation link is not valid. Ask a teammate with owner or admin access to invite you again.',
};

export const ENROL_FAILED_MESSAGE =
  'You are signed in, but no passkey was created. Add one from Settings → Security before this session ends — without a passkey there is no way back into this account.';

export function renderAcceptInviteRoute(
  deps: PlatformDeps,
  params: { token: string },
): RouteView {
  adoptSheet(AUTH_CARD_SHEET);

  const phase = signal<Phase>('loading');
  const failure = signal<InviteFailure | null>(null);
  const preview = signal<InvitationPreview | null>(null);

  const { root, card } = buildAuthCard({
    heading: 'Greenput',
    lede: 'You have been invited to join a team.',
    testId: 'accept-invite',
  });

  const who = el('p', { 'data-testid': 'accept-invite-who' });
  const errorBanner = el('output', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': 'accept-invite-error',
    hidden: true,
  });
  const liveStatus = el('p', {
    'data-bn-sr-only': '',
    role: 'status',
    'aria-live': 'polite',
  });
  const button = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'accept-invite-submit',
      disabled: true,
    },
    'Accept and create a passkey',
  );
  const settingsLink = el(
    'a',
    {
      href: '/settings?tab=security',
      'data-testid': 'accept-invite-settings-link',
      hidden: true,
    },
    'Go to Settings → Security',
  );
  const footer = el(
    'footer',
    { 'data-bn-auth-footer': '' },
    el('a', { href: '/login' }, 'Already have a passkey? Sign in'),
  );

  card.append(
    who,
    errorBanner,
    liveStatus,
    el('div', { 'data-bn-auth-actions': '' }, button, settingsLink),
    footer,
  );

  const cleanups: Cleanup[] = [];

  cleanups.push(
    effect(() => {
      const p = preview();
      const current = phase();
      const f = failure();

      who.textContent = p
        ? `Hi ${p.firstName}, you have been invited to join ${p.workspaceName}. Create a passkey to finish — it is how you will sign in.`
        : current === 'loading'
          ? 'Checking your invitation…'
          : '';

      if (current === 'invalid' && f) {
        errorBanner.textContent = INVITE_MESSAGES[f];
        errorBanner.removeAttribute('hidden');
      } else if (current === 'enrol-failed') {
        errorBanner.textContent = ENROL_FAILED_MESSAGE;
        errorBanner.removeAttribute('hidden');
      } else {
        errorBanner.textContent = '';
        errorBanner.setAttribute('hidden', '');
      }

      const busy = current === 'accepting' || current === 'enrolling';
      const usable = current === 'ready';
      button.disabled = !usable;
      button.hidden = current === 'invalid' || current === 'enrol-failed';
      if (busy) {
        button.setAttribute('aria-busy', 'true');
        button.textContent =
          current === 'accepting' ? 'Accepting…' : 'Creating your passkey…';
        liveStatus.textContent =
          current === 'accepting'
            ? 'Accepting your invitation…'
            : 'Waiting for your passkey…';
      } else {
        button.removeAttribute('aria-busy');
        button.textContent = 'Accept and create a passkey';
        liveStatus.textContent = '';
      }
      settingsLink.hidden = current !== 'enrol-failed';
    }).dispose,
  );

  cleanups.push(
    on(button, 'click', async () => {
      if (phase.peek() !== 'ready') return;
      phase.set('accepting');
      try {
        await deps.invitations.accept(params.token);
      } catch (err) {
        failure.set(classifyInviteError(err));
        phase.set('invalid');
        return;
      }
      // The cookie is set; make the store (and the router guard) see it.
      await deps.auth.refreshSession();
      phase.set('enrolling');
      try {
        await deps.auth.enrollPasskey();
      } catch {
        phase.set('enrol-failed');
        return;
      }
      void deps.router.navigate('/dashboard');
    }),
  );

  void deps.invitations
    .preview(params.token)
    .then((res) => {
      preview.set(res.data);
      phase.set('ready');
    })
    .catch((err: unknown) => {
      failure.set(classifyInviteError(err));
      phase.set('invalid');
    });

  return {
    element: root,
    dispose: () => {
      deps.auth.clearError();
      for (const fn of cleanups) fn();
    },
  };
}
