import { z } from 'zod';

const notificationEventType = z.enum([
  'new_lead',
  'job_status_change',
  'payment_received',
  'review_request',
]);

const notificationChannel = z.enum(['email', 'sms', 'push']);

const notificationPreferenceSchema = z.object({
  eventType: notificationEventType,
  channel: notificationChannel,
  enabled: z.boolean(),
});

export const UpdateNotificationPreferencesSchema = z.object({
  preferences: z
    .array(notificationPreferenceSchema)
    .min(1, 'preferences array is required'),
});

export type UpdateNotificationPreferencesInput = z.infer<
  typeof UpdateNotificationPreferencesSchema
>;
export type NotificationPreferenceEntry = z.infer<
  typeof notificationPreferenceSchema
>;
