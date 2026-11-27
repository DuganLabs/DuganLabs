import type { Env } from '../../env';
import { newId } from '../response';

// ── Types ────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'lead.created'
  | 'lead.updated'
  | 'lead.deleted'
  | 'lead.converted'
  | 'opportunity.created'
  | 'opportunity.updated'
  | 'opportunity.deleted'
  | 'opportunity.converted'
  | 'job.created'
  | 'job.updated'
  | 'job.deleted'
  | 'job.status_changed'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'campaign.created'
  | 'campaign.updated'
  | 'campaign.deleted'
  | 'payment.received'
  | 'test.ping';

export interface WebhookPayload {
  id: string;
  event: WebhookEventType;
  timestamp: string;
  workspace_id: string;
  data: unknown;
}

interface WebhookRow {
  id: string;
  url: string;
  secret: string;
  events: string;
}

// ── HMAC signing ─────────────────────────────────────────────────

/**
 * Sign a payload string with a secret using HMAC-SHA256.
 * Returns a hex-encoded signature.
 */
export async function signPayload(
  payload: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Dispatcher ───────────────────────────────────────────────────

/**
 * Dispatch webhook events to all active subscriptions that match the event type.
 *
 * This function is designed to be used with `ctx.waitUntil()` so it does not
 * block the main request. It queries for matching webhooks, fires HTTP
 * requests with HMAC-signed payloads, and records each delivery attempt.
 */
export async function dispatchWebhooks(
  env: Env,
  workspaceId: string,
  eventType: WebhookEventType,
  data: unknown,
): Promise<void> {
  const webhooks = await env.DB.prepare(
    `SELECT id, url, secret, events
     FROM webhooks
     WHERE workspace_id = ? AND active = 1`,
  )
    .bind(workspaceId)
    .all<WebhookRow>();

  if (!webhooks.results || webhooks.results.length === 0) return;

  // Filter webhooks that subscribe to this event type
  const matching = webhooks.results.filter((wh) => {
    const events: string[] = JSON.parse(wh.events) as string[];
    return events.includes(eventType) || events.includes('*');
  });

  if (matching.length === 0) return;

  const payload: WebhookPayload = {
    id: newId(),
    event: eventType,
    timestamp: new Date().toISOString(),
    workspace_id: workspaceId,
    data,
  };

  const payloadStr = JSON.stringify(payload);

  const deliveries = matching.map((wh) =>
    deliverWebhook(env, wh, payloadStr, eventType),
  );

  await Promise.allSettled(deliveries);
}

/**
 * Deliver a single webhook: sign the payload, POST it, and record the result.
 */
async function deliverWebhook(
  env: Env,
  webhook: WebhookRow,
  payloadStr: string,
  eventType: WebhookEventType,
): Promise<void> {
  const deliveryId = newId();
  const now = new Date().toISOString();
  let statusCode: number | null = null;
  let responseBody: string | null;

  try {
    const signature = await signPayload(payloadStr, webhook.secret);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Greenput-Signature': signature,
        'X-Greenput-Event': eventType,
        'X-Greenput-Delivery': deliveryId,
        'User-Agent': 'Greenput-Webhooks/1.0',
      },
      body: payloadStr,
      signal: AbortSignal.timeout(10_000),
    });

    statusCode = response.status;
    responseBody = await response.text().catch(() => null);
    // Truncate response body to avoid storing huge payloads
    if (responseBody && responseBody.length > 4096) {
      responseBody = responseBody.slice(0, 4096);
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Unknown delivery error';
    responseBody = message;
  }

  await env.DB.prepare(
    `INSERT INTO webhook_deliveries
       (id, webhook_id, event_type, payload, status_code, response_body, attempts, delivered_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(
      deliveryId,
      webhook.id,
      eventType,
      payloadStr,
      statusCode,
      responseBody,
      statusCode !== null ? now : null,
      now,
    )
    .run();
}
