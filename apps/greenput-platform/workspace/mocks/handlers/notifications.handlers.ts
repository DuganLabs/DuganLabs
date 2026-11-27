import { http, HttpResponse } from 'msw';
import { createDefaultPreferences } from '../data/notifications.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getNotificationPreferencesSuccess = http.get(
  '*/api/notification-preferences',
  async () => {
    return HttpResponse.json({ data: createDefaultPreferences() });
  },
);

export const updateNotificationPreferencesSuccess = http.put(
  '*/api/notification-preferences',
  async () => {
    return HttpResponse.json({ data: createDefaultPreferences() });
  },
);

// ── Error handlers ──────────────────────────────────────────

export const getNotificationPreferencesError500 = http.get(
  '*/api/notification-preferences',
  async () => {
    return HttpResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  },
);

// ── Default export ──────────────────────────────────────────

export const notificationHandlers = [
  getNotificationPreferencesSuccess,
  updateNotificationPreferencesSuccess,
];
