import type { NotificationEnv as Env } from './env';
import { sendEmail } from './email';
import { sendSms } from './sms';
import {
  newLeadAlert,
  jobStatusChange,
  paymentReceived,
  reviewRequest,
} from './templates';
import type { NotificationContent } from './templates';

// ── Event types ─────────────────────────────────────────────────

export type NotificationEventType =
  'new_lead' | 'job_status_change' | 'payment_received' | 'review_request';

export interface NewLeadEvent {
  type: 'new_lead';
  workspaceId: string;
  leadName: string;
  source: string;
}

export interface JobStatusChangeEvent {
  type: 'job_status_change';
  workspaceId: string;
  jobNumber: string;
  oldStatus: string;
  newStatus: string;
}

export interface PaymentReceivedEvent {
  type: 'payment_received';
  workspaceId: string;
  jobNumber: string;
  amount: number;
}

export interface ReviewRequestEvent {
  type: 'review_request';
  workspaceId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  jobTitle: string;
}

export type NotificationEvent =
  | NewLeadEvent
  | JobStatusChangeEvent
  | PaymentReceivedEvent
  | ReviewRequestEvent;

/**
 * SMS billing injected by the API (`sendContractorSms`). The shared
 * library does not import the API: with no hook, SMS is GreenPut-paid
 * and ungated (marketing contact, and any other caller that does not
 * inject one). A hook that returns `USAGE_EXHAUSTED` or `SEND_FAILED`
 * does not send, and the dispatcher delivers the same notice by email
 * so it is not dropped. Push has no transport, so email is that delivery.
 */
export interface SmsBillingHook {
  send(args: { workspaceId: string; to: string; body: string }): Promise<
    | { ok: true; sid?: string | null }
    | {
        ok: false;
        reason: 'USAGE_EXHAUSTED' | 'SEND_FAILED';
        error?: string;
      }
  >;
}

export interface DispatchNotificationOptions {
  smsBilling?: SmsBillingHook;
}

// ── Dispatcher ──────────────────────────────────────────────────

/**
 * Dispatch a notification event: resolves templates, looks up user
 * preferences, sends via the appropriate channel, and logs results.
 * `options.smsBilling` is how the API bills a contractor workspace's
 * SMS. Omit it for a message GreenPut pays.
 */
export async function dispatchNotification(
  env: Env,
  event: NotificationEvent,
  options?: DispatchNotificationOptions,
): Promise<void> {
  const content = resolveTemplate(event);

  // For review_request, send directly to the customer (not workspace users)
  if (event.type === 'review_request') {
    await sendToCustomer(env, event, content, options);
    return;
  }

  // Look up workspace users and their notification preferences
  const prefs = await env.DB.prepare(
    `SELECT np.channel, np.enabled, u.id AS user_id, u.email AS user_email
     FROM users u
     LEFT JOIN notification_preferences np
       ON np.user_id = u.id AND np.event_type = ?
     WHERE u.workspace_id = ?`,
  )
    .bind(event.type, event.workspaceId)
    .all<{
      channel: string | null;
      enabled: number | null;
      user_id: string;
      user_email: string;
    }>();

  if (!prefs.results || prefs.results.length === 0) return;

  // Group preferences by user
  const userMap = new Map<string, { email: string; channels: Set<string> }>();

  for (const row of prefs.results) {
    if (!userMap.has(row.user_id)) {
      userMap.set(row.user_id, { email: row.user_email, channels: new Set() });
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guaranteed by has() check above
    const entry = userMap.get(row.user_id)!;

    // If no preferences exist (channel is null), default to email
    if (row.channel === null) {
      entry.channels.add('email');
    } else if (row.enabled === 1) {
      entry.channels.add(row.channel);
    }
  }

  // Send notifications in parallel
  const tasks: Promise<void>[] = [];

  for (const [userId, info] of userMap) {
    if (info.channels.has('email')) {
      tasks.push(
        sendAndLog(env, {
          workspaceId: event.workspaceId,
          userId,
          channel: 'email',
          eventType: event.type,
          recipient: info.email,
          sendFn: () =>
            sendEmail(env, {
              to: info.email,
              subject: content.subject,
              html: content.html,
            }),
        }),
      );
    }

    if (info.channels.has('sms')) {
      tasks.push(
        deliverSms(env, options, {
          workspaceId: event.workspaceId,
          userId,
          eventType: event.type,
          to: info.email, // phone stored in email field for OTP users
          body: content.smsBody,
          emailAlreadyQueued: info.channels.has('email'),
          emailFallback: {
            to: info.email,
            subject: content.subject,
            html: content.html,
          },
        }),
      );
    }
  }

  await Promise.allSettled(tasks);
}

// ── Internal helpers ────────────────────────────────────────────

function resolveTemplate(event: NotificationEvent): NotificationContent {
  switch (event.type) {
    case 'new_lead':
      return newLeadAlert(event.leadName, event.source);
    case 'job_status_change':
      return jobStatusChange(event.jobNumber, event.oldStatus, event.newStatus);
    case 'payment_received':
      return paymentReceived(event.jobNumber, event.amount);
    case 'review_request':
      return reviewRequest(event.customerName, event.jobTitle);
  }
}

async function sendToCustomer(
  env: Env,
  event: ReviewRequestEvent,
  content: NotificationContent,
  options: DispatchNotificationOptions | undefined,
): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (event.customerEmail) {
    const emailAddr = event.customerEmail;
    tasks.push(
      sendAndLog(env, {
        workspaceId: event.workspaceId,
        userId: null,
        channel: 'email',
        eventType: event.type,
        recipient: emailAddr,
        sendFn: () =>
          sendEmail(env, {
            to: emailAddr,
            subject: content.subject,
            html: content.html,
          }),
      }),
    );
  }

  if (event.customerPhone) {
    const phoneNum = event.customerPhone;
    tasks.push(
      deliverSms(env, options, {
        workspaceId: event.workspaceId,
        userId: null,
        eventType: event.type,
        to: phoneNum,
        body: content.smsBody,
        emailAlreadyQueued: Boolean(event.customerEmail),
        emailFallback: event.customerEmail
          ? {
              to: event.customerEmail,
              subject: content.subject,
              html: content.html,
            }
          : null,
      }),
    );
  }

  await Promise.allSettled(tasks);
}

interface EmailFallback {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send one SMS. With a billing hook, a refusal or a send failure is logged
 * and the same notice goes out by email when that email is not already
 * queued — a lead alert whose only selected channel is SMS still arrives.
 * Without a hook the shared sender runs and a failure stays a failed SMS.
 */
async function deliverSms(
  env: Env,
  options: DispatchNotificationOptions | undefined,
  params: {
    workspaceId: string;
    userId: string | null;
    eventType: string;
    to: string;
    body: string;
    emailAlreadyQueued: boolean;
    emailFallback: EmailFallback | null;
  },
): Promise<void> {
  const hook = options?.smsBilling;
  if (!hook) {
    await sendAndLog(env, {
      workspaceId: params.workspaceId,
      userId: params.userId,
      channel: 'sms',
      eventType: params.eventType,
      recipient: params.to,
      sendFn: () => sendSms(env, { to: params.to, body: params.body }),
    });
    return;
  }

  const result = await hook.send({
    workspaceId: params.workspaceId,
    to: params.to,
    body: params.body,
  });
  if (result.ok) {
    await logNotification(env, {
      workspaceId: params.workspaceId,
      userId: params.userId,
      channel: 'sms',
      eventType: params.eventType,
      recipient: params.to,
      status: 'sent',
      error: null,
    });
    return;
  }

  await logNotification(env, {
    workspaceId: params.workspaceId,
    userId: params.userId,
    channel: 'sms',
    eventType: params.eventType,
    recipient: params.to,
    status: 'failed',
    error: result.error ?? result.reason,
  });

  if (params.emailAlreadyQueued || !params.emailFallback) return;
  const email = params.emailFallback;
  await sendAndLog(env, {
    workspaceId: params.workspaceId,
    userId: params.userId,
    channel: 'email',
    eventType: params.eventType,
    recipient: email.to,
    sendFn: () =>
      sendEmail(env, {
        to: email.to,
        subject: email.subject,
        html: email.html,
      }),
  });
}

interface SendAndLogParams {
  workspaceId: string;
  userId: string | null;
  channel: 'email' | 'sms' | 'push';
  eventType: string;
  recipient: string;
  sendFn: () => Promise<{ success: boolean; error?: string }>;
}

async function sendAndLog(env: Env, params: SendAndLogParams): Promise<void> {
  const result = await params.sendFn();
  await logNotification(env, {
    workspaceId: params.workspaceId,
    userId: params.userId,
    channel: params.channel,
    eventType: params.eventType,
    recipient: params.recipient,
    status: result.success ? 'sent' : 'failed',
    error: result.error ?? null,
  });
}

async function logNotification(
  env: Env,
  params: {
    workspaceId: string;
    userId: string | null;
    channel: 'email' | 'sms' | 'push';
    eventType: string;
    recipient: string;
    status: 'sent' | 'failed';
    error: string | null;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notification_log (id, workspace_id, user_id, channel, event_type, recipient, status, error_msg, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      params.workspaceId,
      params.userId,
      params.channel,
      params.eventType,
      params.recipient,
      params.status,
      params.error,
      new Date().toISOString(),
    )
    .run();
}
