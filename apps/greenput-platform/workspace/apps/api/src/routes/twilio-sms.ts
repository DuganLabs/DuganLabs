import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { error, json } from '../lib/response';
import {
  reconcileSmsPrice,
  twilioSmsStatusCallbackUrl,
  verifyTwilioSignature,
} from '../lib/usage-balance';

export const twilioSmsWebhookRouter = Router({
  base: '/api/webhooks/twilio',
});

/**
 * Twilio status callback for contractor SMS. No session: the signature
 * is the authorisation. The URL that was signed is the canonical host
 * for this environment, not whatever Host the request arrived on.
 * A missing Price (queued, sent) is a no-op. OTP does not set a callback.
 */
twilioSmsWebhookRouter.post('/sms', async (req: IRequest, env: Env) => {
  if (!env.TWILIO_AUTH_TOKEN) {
    return error('SMS webhooks are not configured', 503, 'SMS_NOT_CONFIGURED');
  }
  const canonical = twilioSmsStatusCallbackUrl(env);
  if (!canonical) {
    return error('SMS webhooks are not configured', 503, 'SMS_NOT_CONFIGURED');
  }
  const signature = req.headers.get('X-Twilio-Signature') ?? '';
  const params = new URLSearchParams(await req.text());
  const valid = await verifyTwilioSignature(
    canonical,
    params,
    signature,
    env.TWILIO_AUTH_TOKEN,
  );
  if (!valid) return error('Invalid signature', 403, 'INVALID_SIGNATURE');

  const sid = params.get('MessageSid') ?? '';
  if (sid) {
    await reconcileSmsPrice(env, {
      messageSid: sid,
      price: params.get('Price'),
      priceUnit: params.get('PriceUnit'),
    });
  }
  return json({ received: true });
});
