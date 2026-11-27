import type { ApiClient } from '@basenative/fetch';
import type {
  NotificationChannel,
  NotificationEventType,
  NotificationPreference,
} from '@greenput/shared/models';

export type NotificationPreferenceUpdate = {
  eventType: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
};

export interface NotificationsApi {
  list(): Promise<{ data: NotificationPreference[] }>;
  update(
    preferences: NotificationPreferenceUpdate[],
  ): Promise<{ data: NotificationPreference[] }>;
}

export function createNotificationsApi(api: ApiClient): NotificationsApi {
  return {
    list: () => api.get('/api/notifications/preferences'),
    update: (preferences) =>
      api.put('/api/notifications/preferences', { preferences }),
  };
}
