import type { NotificationEnv as Env } from './env';

/**
 * Twilio's published US long-code outbound SMS list price, per segment,
 * in micro-USD (1 USD = 1_000_000). Carrier fees are not in this number;
 * a status-callback Price reconciles them. Cents cannot represent $0.0083.
 */
export const TWILIO_US_SMS_SEGMENT_MICRO_USD = 8300;

/** 1 cent = 10_000 micro-USD. Top-ups are Stripe charges, so they stay in cents. */
export const MICRO_USD_PER_CENT = 10_000;

/** Default auto top-up. $10 is above Stripe's $0.50 minimum. */
export const DEFAULT_USAGE_TOPUP_CENTS = 1000;

/** Default balance that triggers a top-up. $2. */
export const DEFAULT_USAGE_THRESHOLD_CENTS = 200;

export interface SmsPayload {
  to: string;
  body: string;
  /**
   * Twilio status callback. Omit it when the URL cannot be signed
   * (anything other than production or staging).
   */
  statusCallback?: string;
}

export interface SmsResult {
  success: boolean;
  error?: string;
  /** Twilio MessageSid when the API returned one. */
  sid?: string;
}

/**
 * Send an SMS via Twilio REST API.
 * Falls back to console.log when Twilio credentials are not configured.
 */
export async function sendSms(
  env: Env,
  payload: SmsPayload,
): Promise<SmsResult> {
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !env.TWILIO_AUTH_TOKEN ||
    !env.TWILIO_FROM_NUMBER
  ) {
    console.log(`[SMS-DEV] To: ${payload.to} | Body: ${payload.body}`);
    return { success: true };
  }

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const twilioAuth = btoa(
      `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
    );

    const formBody = new URLSearchParams({
      To: payload.to,
      From: env.TWILIO_FROM_NUMBER,
      Body: payload.body,
    });
    if (payload.statusCallback) {
      formBody.set('StatusCallback', payload.statusCallback);
    }

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Twilio SMS failed:', response.status, text);
      return { success: false, error: `Twilio ${response.status}: ${text}` };
    }

    let sid: string | undefined;
    try {
      const data = (await response.json()) as { sid?: unknown };
      if (typeof data.sid === 'string' && data.sid.length > 0) sid = data.sid;
    } catch {
      sid = undefined;
    }
    return { success: true, sid };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown SMS error';
    console.error('SMS send error:', message);
    return { success: false, error: message };
  }
}
