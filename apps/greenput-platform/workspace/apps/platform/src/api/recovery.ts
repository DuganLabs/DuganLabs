import type { ApiClient } from '@basenative/fetch';
import type { AuthUser } from '@basenative/auth-webauthn';

/**
 * `/api/auth/otp/*` — account recovery by one-time code, and management of
 * the personal number that channel is bound to.
 *
 * `sendCode` always resolves when the request itself succeeded. It does NOT
 * mean an SMS went out: the API answers identically whether or not a GreenPut
 * account uses that number, so this endpoint cannot be used to test who has
 * an account. The screen has to say "if that number is on file" rather than
 * "code sent", and it does.
 */
export interface RecoveryApi {
  /** Ask for a sign-in code. Resolves whether or not a code was actually sent. */
  sendCode(
    phone: string,
  ): Promise<{ data: { sent: boolean; delivery: SmsDelivery } }>;
  /** Exchange a code for a session. */
  verifyCode(
    phone: string,
    code: string,
  ): Promise<{ data: { user: AuthUser } }>;
  /** Is a recovery number set on this account, and which one (masked)? */
  status(): Promise<{ data: RecoveryStatus }>;
  /** Text a code to a candidate personal number. */
  startBinding(
    phone: string,
  ): Promise<{ data: { sent: boolean; delivery: SmsDelivery } }>;
  /** Prove the number and store it. */
  confirmBinding(
    phone: string,
    code: string,
  ): Promise<{ data: RecoveryStatus }>;
  /** Remove the recovery number. */
  clear(): Promise<{ data: RecoveryStatus }>;
  /**
   * How many passkeys this account has.
   *
   * Lives here rather than on the auth store because every caller asks it for
   * the same reason the recovery number exists: to know how many ways back in
   * there are before removing one of them.
   */
  passkeyCount(): Promise<{ data: { count: number } }>;
}

/**
 * How a code actually reaches someone on THIS deployment. `'log'` means no SMS
 * provider is configured and the code goes to the Worker tail — a property of
 * the deployment, not of any account, so it is safe to show.
 */
export type SmsDelivery = 'sms' | 'log';

export interface RecoveryStatus {
  readonly configured: boolean;
  /** Last four digits only — the API never returns the whole number. */
  readonly masked: string | null;
}

export function createRecoveryApi(api: ApiClient): RecoveryApi {
  return {
    passkeyCount: () => api.get('/api/auth/webauthn/credentials'),
    sendCode: (phone) => api.post('/api/auth/otp/send', { phone }),
    verifyCode: (phone, code) =>
      api.post('/api/auth/otp/verify', { phone, code }),
    status: () => api.get('/api/auth/otp/recovery'),
    startBinding: (phone) =>
      api.post('/api/auth/otp/recovery/start', { phone }),
    confirmBinding: (phone, code) =>
      api.post('/api/auth/otp/recovery/confirm', { phone, code }),
    clear: () => api.delete('/api/auth/otp/recovery'),
  };
}
