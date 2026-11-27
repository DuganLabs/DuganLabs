// Notification dispatch shared by the Workers (email via MailChannels, SMS
// via Twilio, per-user preferences + notification_log in D1).
export { dispatchNotification } from './dispatcher';
export type {
  NotificationEvent,
  NotificationEventType,
  NewLeadEvent,
  JobStatusChangeEvent,
  PaymentReceivedEvent,
  ReviewRequestEvent,
  SmsBillingHook,
  DispatchNotificationOptions,
} from './dispatcher';
export { sendEmail } from './email';
export type { EmailPayload, EmailResult } from './email';
export {
  sendSms,
  TWILIO_US_SMS_SEGMENT_MICRO_USD,
  MICRO_USD_PER_CENT,
  DEFAULT_USAGE_TOPUP_CENTS,
  DEFAULT_USAGE_THRESHOLD_CENTS,
} from './sms';
export type { SmsPayload, SmsResult } from './sms';
export {
  newLeadAlert,
  jobStatusChange,
  paymentReceived,
  reviewRequest,
} from './templates';
export type { NotificationContent } from './templates';
export type { NotificationEnv } from './env';
