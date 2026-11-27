/// <reference types="@cloudflare/workers-types" />

/**
 * The slice of a Worker's bindings the notification lib needs. Any Worker
 * with a D1 binding can dispatch (apps/api and apps/marketing both do).
 * EMAIL_FROM and the TWILIO_* secrets are optional: without them the
 * senders log to the console instead of calling the provider.
 */
export interface NotificationEnv {
  DB: D1Database;
  EMAIL_FROM?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
}
