import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  type NotificationChannel,
  type NotificationEventType,
  type NotificationPreference,
} from '@greenput/shared/models';

// These unions and this interface used to be re-declared here, which is how a
// pact fixture drifts from the response it claims to describe. Both come from
// the one place shared types live (CLAUDE.md §2.4), and the endpoint serializes
// through the same contract (WIRE_NOTIFICATION_PREFERENCE).
export type { NotificationChannel, NotificationEventType };
export type NotificationPreferenceFixture = NotificationPreference;

export function createNotificationPreference(
  overrides: Partial<NotificationPreference> = {},
): NotificationPreference {
  return {
    id: 'pref-1',
    userId: 'usr-1',
    eventType: 'new_lead',
    channel: 'email',
    enabled: true,
    ...overrides,
  };
}

export function createDefaultPreferences(): NotificationPreference[] {
  let id = 0;
  return NOTIFICATION_EVENT_TYPES.flatMap((eventType) =>
    NOTIFICATION_CHANNELS.map((channel) =>
      createNotificationPreference({
        id: `pref-${++id}`,
        eventType,
        channel,
        enabled: channel === 'email',
      }),
    ),
  );
}
