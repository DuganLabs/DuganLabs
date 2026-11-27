import type { Env } from '../env';
import { hasSmsConsent, type D1Like } from '@greenput/shared/consent';
import { sendContractorSms } from './usage-balance';

/**
 * The consent check ahead of a consumer-facing Twilio send: no active
 * consent record for this workspace + phone, no send. This is the ONLY
 * sanctioned way for API code to text a consumer (homeowner) — internal
 * sends (account-recovery OTP to the owner's own number, the GP-110
 * teammate fallback) are separate, already-guarded paths and do not go
 * through here. The send itself reserves the workspace's prepaid SMS
 * balance when Stripe is configured (usage-balance.ts). OTP does not.
 */
export type GuardedSmsResult =
  | { readonly sent: true }
  | {
      readonly sent: false;
      readonly reason: 'NO_CONSENT' | 'SEND_FAILED' | 'USAGE_EXHAUSTED';
      readonly error?: string;
    };

export async function sendConsumerSms(
  env: Env,
  params: {
    workspaceId: string;
    to: string;
    body: string;
  },
): Promise<GuardedSmsResult> {
  const allowed = await hasSmsConsent(
    env.DB as unknown as D1Like,
    params.workspaceId,
    params.to,
  );
  if (!allowed) return { sent: false, reason: 'NO_CONSENT' };

  const result = await sendContractorSms(env, {
    workspaceId: params.workspaceId,
    to: params.to,
    body: params.body,
  });
  if (!result.ok) {
    if (result.reason === 'USAGE_EXHAUSTED') {
      return { sent: false, reason: 'USAGE_EXHAUSTED' };
    }
    return { sent: false, reason: 'SEND_FAILED', error: result.error };
  }
  return { sent: true };
}
