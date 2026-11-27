/**
 * `/api/auth/otp/*` — the account-recovery channel.
 *
 * This is the way back in when the passkey is gone: the phone is lost, the
 * laptop was replaced, the credential was never enrolled in the first place.
 * It is NOT a second signup door and it is NOT a second login for convenience.
 *
 * ── What it binds to, and why that is the whole design ──────────────────
 *
 * A code is only ever sent to `users.recovery_phone`: the owner's PERSONAL
 * number, bound to their account after an OTP to that number proved they hold
 * it.
 *
 * It is deliberately not `workspaces.phone`. The workspace phone is the
 * company line — GreenPut prints it on the contractor's own micro-site and
 * hands it out from /api/public/workspace/:slug. Sending a sign-in code there
 * would mean anyone who can load a contractor's public website can read the
 * code that signs them in as that contractor. That is not account recovery,
 * it is account takeover with a "Send code" button, and it is what this
 * endpoint used to do (it matched `w.phone = ?` OR `u.email = ?`).
 *
 * ── Why verify can no longer create an account ──────────────────────────
 *
 * `/verify` used to fall through to creating a workspace and a user when the
 * phone matched nothing. That branch is deleted, for four reasons:
 *
 *   1. It wrote its three rows as three separate `.run()` calls. `/register`
 *      was moved to a single D1 batch precisely so a half-failed signup
 *      cannot leave an orphan workspace behind — production is still carrying
 *      one from before that fix. This was the same bug, uncorrected, in a
 *      second place.
 *   2. It stored the phone number in `users.email`. Every other consumer of
 *      that column treats it as an email address — `LoginSchema` validates it
 *      as one, invites send to it. A row whose email is "+19495550199" is a
 *      landmine for all of them.
 *   3. It skipped everything `/register` does: no trial dates, no address, no
 *      activity_log row. Two signup paths that disagree about what an account
 *      is will drift, and the quiet one wins by accident.
 *   4. An authentication endpoint should have one outcome. "Prove you hold
 *      this number and I will sign you into the account bound to it" is
 *      auditable. "…or else I will create one" is a different endpoint
 *      wearing the same URL.
 *
 * Signup has exactly one door: POST /api/auth/register.
 *
 * ── Enumeration and abuse ───────────────────────────────────────────────
 *
 * `/send` answers `{sent:true}` whether or not a code went out, so the
 * response cannot be used to test whether a number has a GreenPut account.
 * A code is only generated when a recovery number actually matches, so the
 * endpoint cannot be used to fire SMS at arbitrary phones either. When the
 * send is suppressed the reason is logged to the Worker tail — invisible to
 * the caller, one `wrangler tail` line away for whoever is debugging a
 * mistyped number.
 *
 * Codes are single-use, expire in 5 minutes, and are burned after 5 wrong
 * guesses so the 6-digit space cannot be walked from rotating IPs.
 */

import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, newId } from '../lib/response';
import { createSession } from '../lib/session';
import { validate } from '../middleware/validate';
import {
  OtpSendSchema,
  OtpVerifySchema,
  SetRecoveryPhoneSchema,
  ConfirmRecoveryPhoneSchema,
} from '@greenput/shared/validators';
import { toE164, maskPhone } from '@greenput/shared/utils';

export const otpRouter = Router({ base: '/api/auth/otp' });

const OTP_TTL_SECONDS = 300; // 5 minutes
const MAX_ATTEMPTS = 5;

interface UserRow {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
}

function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1_000_000).padStart(6, '0');
}

/**
 * Constant-time-ish comparison of two 6-digit codes. `===` on strings can
 * short-circuit on the first differing character; the difference is not
 * remotely exploitable over a network at this length, but there is no reason
 * to write the version that leaks.
 */
function codesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** KV key for a pending code. Scoped by purpose so a recovery-enrolment code
 *  can never be replayed as a sign-in code, or the other way round. */
function codeKey(purpose: 'signin' | 'enroll', subject: string): string {
  return `otp:${purpose}:${subject}`;
}

/**
 * Durable send quotas for /recovery/start, in KV rather than the in-memory
 * rate limiter.
 *
 * /recovery/start texts a code to a number the CALLER TYPED. That is inherent —
 * proving possession means sending to the claimed number — so the control is
 * not "never send to a number you do not own", it is "you cannot do it often,
 * and nobody can be targeted".
 *
 * The in-memory limiter cannot hold this line: its Map resets on every worker
 * cold start and is per-isolate, so an attacker gets a fresh budget by waiting
 * or by landing on another isolate. At 10/min/IP that was 14,400 SMS a day per
 * IP once Twilio is configured, aimed at any handset, billed to us.
 *
 * Two counters, both in KV, both expiring with their window:
 *   - per CALLER, so one account cannot be a cannon;
 *   - per DESTINATION across all callers, so one person cannot be targeted by
 *     rotating accounts.
 */
const RECOVERY_SEND_WINDOW_SECONDS = 3600;
const RECOVERY_SENDS_PER_USER = 5;
const RECOVERY_SENDS_PER_NUMBER = 3;

async function bumpQuota(
  env: Env,
  key: string,
  limit: number,
): Promise<boolean> {
  const raw = await env.SESSIONS.get(key);
  const used = raw ? Number.parseInt(raw, 10) || 0 : 0;
  if (used >= limit) return false;
  // The TTL is not refreshed on each bump: the window starts at the first send
  // and runs for an hour, so a caller cannot hold a counter open indefinitely
  // by sending at the limit.
  await env.SESSIONS.put(key, String(used + 1), {
    expirationTtl: RECOVERY_SEND_WINDOW_SECONDS,
  });
  return true;
}

function attemptsKey(key: string): string {
  return `${key}:attempts`;
}

/**
 * Can this deployment actually text anyone?
 *
 * A deployment property, not a user property — it says nothing about whether
 * an account exists, so it is safe to return to anyone. It exists because the
 * product was claiming otherwise: with no Twilio credentials, /recover said "a
 * six-digit code is on its way", onboarding's fallback said the same, and the
 * un-brick instructions pointed at a channel whose only reader was
 * `wrangler tail`. Every one of those sentences was false in production.
 */
function smsConfigured(env: Env): boolean {
  return Boolean(
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER,
  );
}

async function sendSms(
  env: Env,
  phone: string,
  code: string,
  context: string,
): Promise<Response | null> {
  if (!smsConfigured(env)) {
    // No Twilio configured. The code goes to the Worker tail instead of a
    // handset — which is what makes this path usable in development, and the
    // last-resort channel for whoever holds `wrangler tail` in production.
    console.log(`[OTP] ${context} code for ${maskPhone(phone)}: ${code}`);
    return null;
  }

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const twilioAuth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);

  const smsBody = new URLSearchParams({
    To: phone,
    From: env.TWILIO_FROM_NUMBER,
    Body: `Your Greenput verification code is: ${code}. It expires in 5 minutes. Greenput will never ask you for this code.`,
  });

  const smsRes = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${twilioAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: smsBody.toString(),
  });

  if (!smsRes.ok) {
    console.error('Twilio SMS failed:', await smsRes.text());
    return error('Failed to send verification code', 500, 'SMS_FAILED');
  }
  return null;
}

/**
 * Check a submitted code against the stored one, counting failures.
 *
 * Returns `'ok'`, `'invalid'` (no code stored, expired, or wrong), or
 * `'locked'` (too many wrong guesses — the code has been burned and a new one
 * must be requested). A correct code is consumed on the way out, so it cannot
 * be replayed.
 */
async function consumeCode(
  env: Env,
  key: string,
  submitted: string,
): Promise<'ok' | 'invalid' | 'locked'> {
  const stored = await env.SESSIONS.get(key);
  if (!stored) return 'invalid';

  const attempts = Number((await env.SESSIONS.get(attemptsKey(key))) ?? '0');

  if (!codesMatch(stored, submitted)) {
    const used = attempts + 1;
    // Count first, then decide. This used to check `attempts >= MAX_ATTEMPTS`
    // BEFORE incrementing, so five wrong guesses were all accepted and the
    // lock fired on the sixth — one more than the docstring promises, and one
    // more than the number the guessing budget was sized around.
    if (used >= MAX_ATTEMPTS) {
      await env.SESSIONS.delete(key);
      await env.SESSIONS.delete(attemptsKey(key));
      return 'locked';
    }
    await env.SESSIONS.put(attemptsKey(key), String(used), {
      expirationTtl: OTP_TTL_SECONDS,
    });
    return 'invalid';
  }

  await env.SESSIONS.delete(key);
  await env.SESSIONS.delete(attemptsKey(key));
  return 'ok';
}

/** The one lookup this whole file is built around. */
function findByRecoveryPhone(env: Env, phone: string): Promise<UserRow | null> {
  return env.DB.prepare(
    'SELECT id, workspace_id, email, role, first_name, last_name FROM users WHERE recovery_phone = ? LIMIT 1',
  )
    .bind(phone)
    .first<UserRow>();
}

// ── POST /api/auth/otp/send — start recovery ────────────────────────────

otpRouter.post(
  '/send',
  validate(OtpSendSchema),
  async (req: IRequest, env: Env) => {
    const body = (req as unknown as { validatedBody: { phone: string } })
      .validatedBody;

    const phone = toE164(body.phone);
    if (!phone) {
      return error(
        'That does not look like a phone number we can text.',
        400,
        'INVALID_PHONE',
      );
    }

    const user = await findByRecoveryPhone(env, phone);

    // Same answer either way: the response must not tell a caller whether a
    // number has an account, and no SMS is fired at a number that does not.
    if (!user) {
      console.log(
        `[OTP] No account has ${maskPhone(phone)} as its recovery number — send suppressed.`,
      );
      return json({
        data: { sent: true, delivery: smsConfigured(env) ? 'sms' : 'log' },
      });
    }

    const code = generateOtp();
    const key = codeKey('signin', phone);
    await env.SESSIONS.put(key, code, { expirationTtl: OTP_TTL_SECONDS });
    await env.SESSIONS.delete(attemptsKey(key));

    // A failed send is logged and swallowed, NOT returned. Answering 500 here
    // while an unmatched number answers 200 would hand back exactly the
    // distinction the identical-response rule exists to hide — a live account
    // enumeration oracle, available for as long as Twilio is unhappy. The
    // caller simply gets no code and can try again; the reason is in the tail.
    const failure = await sendSms(env, phone, code, 'Sign-in');
    if (failure) {
      console.error(
        `[OTP] Sign-in code for ${maskPhone(phone)} could not be sent.`,
      );
    }

    return json({
      data: { sent: true, delivery: smsConfigured(env) ? 'sms' : 'log' },
    });
  },
);

// ── POST /api/auth/otp/verify — finish recovery, create a session ───────

otpRouter.post(
  '/verify',
  validate(OtpVerifySchema),
  async (req: IRequest, env: Env) => {
    const body = (
      req as unknown as { validatedBody: { phone: string; code: string } }
    ).validatedBody;

    const phone = toE164(body.phone);
    if (!phone) {
      return error(
        'That does not look like a phone number we can text.',
        400,
        'INVALID_PHONE',
      );
    }

    const outcome = await consumeCode(env, codeKey('signin', phone), body.code);
    if (outcome === 'locked') {
      return error(
        'Too many incorrect codes. Request a new one.',
        429,
        'OTP_LOCKED',
      );
    }
    if (outcome !== 'ok') {
      return error('Invalid or expired verification code', 401, 'INVALID_OTP');
    }

    // A code only exists for a number that had an account when /send ran. If
    // the account went away in between, this is an authentication failure,
    // not a signup opportunity.
    const user = await findByRecoveryPhone(env, phone);
    if (!user) {
      return error(
        'No Greenput account uses this number for recovery.',
        401,
        'NO_RECOVERY_ACCOUNT',
      );
    }

    const session = await createSession(env, {
      id: user.id,
      workspaceId: user.workspace_id,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
    });

    await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), user.id)
      .run();

    const response = json({
      data: {
        user: {
          id: user.id,
          workspaceId: user.workspace_id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
        },
      },
    });

    const headers = new Headers(response.headers);
    headers.append('Set-Cookie', session.cookie);

    return new Response(response.body, { status: 200, headers });
  },
);

// ── Managing your own recovery number (all require a session) ──────────
//
// Registered with `requireAuth` in apps/api/src/index.ts, ahead of the
// /api/auth/otp/* catch-all, the same way webauthn's register/* routes are.

// GET /api/auth/otp/recovery — is one set, and which one (masked)?
otpRouter.get('/recovery', async (req: IRequest, env: Env) => {
  const session = (req as unknown as { user?: { id: string } }).user;
  if (!session) return error('Unauthorized', 401, 'UNAUTHORIZED');

  const row = await env.DB.prepare(
    'SELECT recovery_phone FROM users WHERE id = ?',
  )
    .bind(session.id)
    .first<{ recovery_phone: string | null }>();

  // Masked, never whole. A live session is not a reason to hand back the
  // owner's personal mobile number in plain text.
  return json({
    data: {
      configured: Boolean(row?.recovery_phone),
      masked: row?.recovery_phone ? maskPhone(row.recovery_phone) : null,
    },
  });
});

// POST /api/auth/otp/recovery/start — text a code to a candidate number
otpRouter.post(
  '/recovery/start',
  validate(SetRecoveryPhoneSchema),
  async (req: IRequest, env: Env) => {
    const session = (req as unknown as { user?: { id: string } }).user;
    if (!session) return error('Unauthorized', 401, 'UNAUTHORIZED');

    const body = (req as unknown as { validatedBody: { phone: string } })
      .validatedBody;
    const phone = toE164(body.phone);
    if (!phone) {
      return error(
        'That does not look like a phone number we can text.',
        400,
        'INVALID_PHONE',
      );
    }

    // The guard that makes the whole design hold. Nothing stops an owner from
    // typing their company number here, and if we accepted it the recovery
    // channel would be published on their own micro-site again — the exact
    // hole this feature exists to close.
    //
    // Checked across EVERY workspace, not just the caller's. It used to join
    // on u.id = ?, which refused only your own business line: workspace B
    // could bind workspace A's published number as its personal recovery
    // channel, and the panel would then tell B "use a number only you carry —
    // not your business line, which is published on your website" about a
    // number published on someone else's. Any published number is public to
    // everyone, so the question is about the number, not about who is asking.
    const published = await env.DB.prepare(
      'SELECT 1 AS hit FROM workspaces WHERE phone = ? LIMIT 1',
    )
      .bind(phone)
      .first<{ hit: number }>();

    if (published) {
      return error(
        'That number is published on a Greenput business website, so anyone could use it to sign in. Use a personal number only you carry.',
        400,
        'PHONE_IS_PUBLIC',
      );
    }

    // NOT a uniqueness check here, deliberately. Answering 409 for a number
    // already registered to someone else — before the caller has proved
    // anything — turns this endpoint into an oracle for "which personal mobile
    // numbers have a Greenput account", queryable by any signed-in user. The
    // check moved to /recovery/confirm, where the caller has demonstrated they
    // hold the handset and so learns nothing they did not already know.

    // Quotas before the send, not after: the point is to not place the call.
    const withinUserQuota = await bumpQuota(
      env,
      `quota:recovery:user:${session.id}`,
      RECOVERY_SENDS_PER_USER,
    );
    if (!withinUserQuota) {
      return error(
        'Too many verification codes requested. Try again in an hour.',
        429,
        'RECOVERY_SEND_QUOTA',
      );
    }

    const withinNumberQuota = await bumpQuota(
      env,
      `quota:recovery:number:${phone}`,
      RECOVERY_SENDS_PER_NUMBER,
    );
    if (!withinNumberQuota) {
      // Same shape as the per-user refusal on purpose: a different code here
      // would say "somebody else has been texting this number", which is its
      // own small oracle.
      return error(
        'Too many verification codes requested. Try again in an hour.',
        429,
        'RECOVERY_SEND_QUOTA',
      );
    }

    const code = generateOtp();
    // Keyed by user AND number: a code proves possession of one specific
    // number, so it must not be usable to confirm a different one.
    const key = codeKey('enroll', `${session.id}:${phone}`);
    await env.SESSIONS.put(key, code, { expirationTtl: OTP_TTL_SECONDS });
    await env.SESSIONS.delete(attemptsKey(key));

    const failure = await sendSms(env, phone, code, 'Recovery-number');
    if (failure) return failure;

    return json({
      data: { sent: true, delivery: smsConfigured(env) ? 'sms' : 'log' },
    });
  },
);

// POST /api/auth/otp/recovery/confirm — prove it, then store it
otpRouter.post(
  '/recovery/confirm',
  validate(ConfirmRecoveryPhoneSchema),
  async (req: IRequest, env: Env) => {
    const session = (req as unknown as { user?: { id: string } }).user;
    if (!session) return error('Unauthorized', 401, 'UNAUTHORIZED');

    const body = (
      req as unknown as { validatedBody: { phone: string; code: string } }
    ).validatedBody;
    const phone = toE164(body.phone);
    if (!phone) {
      return error(
        'That does not look like a phone number we can text.',
        400,
        'INVALID_PHONE',
      );
    }

    const outcome = await consumeCode(
      env,
      codeKey('enroll', `${session.id}:${phone}`),
      body.code,
    );
    if (outcome === 'locked') {
      return error(
        'Too many incorrect codes. Request a new one.',
        429,
        'OTP_LOCKED',
      );
    }
    if (outcome !== 'ok') {
      return error('Invalid or expired verification code', 401, 'INVALID_OTP');
    }

    // Uniqueness is checked HERE rather than at /recovery/start. The database
    // enforces it either way (partial UNIQUE on recovery_phone); the question
    // is who gets told. At start, a 409 tells any signed-in caller whether a
    // number they typed belongs to some other Greenput account — an
    // enumeration oracle over personal mobile numbers. By this line the caller
    // has read a code we texted to the handset, so they hold it, and the
    // answer tells them nothing they could not already discover.
    const taken = await findByRecoveryPhone(env, phone);
    if (taken && taken.id !== session.id) {
      return error(
        'That number is already the recovery number for another Greenput account.',
        409,
        'PHONE_TAKEN',
      );
    }

    await env.DB.prepare(
      'UPDATE users SET recovery_phone = ?, updated_at = ? WHERE id = ?',
    )
      .bind(phone, new Date().toISOString(), session.id)
      .run();

    return json({
      data: { configured: true, masked: maskPhone(phone) },
    });
  },
);

// DELETE /api/auth/otp/recovery — drop the recovery channel
otpRouter.delete('/recovery', async (req: IRequest, env: Env) => {
  const session = (req as unknown as { user?: { id: string } }).user;
  if (!session) return error('Unauthorized', 401, 'UNAUTHORIZED');

  await env.DB.prepare(
    'UPDATE users SET recovery_phone = NULL, updated_at = ? WHERE id = ?',
  )
    .bind(new Date().toISOString(), session.id)
    .run();

  return json({ data: { configured: false, masked: null } });
});
