import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, newId } from '../lib/response';
import { entityArray } from '../lib/serialize';
import { WIRE_NOTIFICATION_PREFERENCE } from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import { UpdateNotificationPreferencesSchema } from '@greenput/shared/validators';

export const notificationPreferencesRouter = Router({
  base: '/api/notifications',
});

interface PreferenceInput {
  eventType: string;
  channel: string;
  enabled: boolean;
}

// GET /api/notifications/preferences — list current user's preferences
notificationPreferencesRouter.get(
  '/preferences',
  async (req: IRequest, env: Env) => {
    const user = (req as unknown as { user: { id: string } }).user;

    const result = await env.DB.prepare(
      'SELECT id, user_id, event_type, channel, enabled FROM notification_preferences WHERE user_id = ?',
    )
      .bind(user.id)
      .all<Record<string, unknown>>();

    // Was mapped by hand here — the one endpoint that already did the right
    // thing, and the reason its shape was right while every list endpoint's
    // was wrong. Now it goes through the same contract as the rest.
    return entityArray(WIRE_NOTIFICATION_PREFERENCE, result.results);
  },
);

// PUT /api/notifications/preferences — replace preferences for current user
notificationPreferencesRouter.put(
  '/preferences',
  validate(UpdateNotificationPreferencesSchema),
  async (req: IRequest, env: Env) => {
    const user = (req as unknown as { user: { id: string } }).user;
    const { preferences } = (
      req as unknown as { validatedBody: { preferences: PreferenceInput[] } }
    ).validatedBody;

    // Delete existing preferences and insert new ones in a batch
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare(
        'DELETE FROM notification_preferences WHERE user_id = ?',
      ).bind(user.id),
    ];

    for (const pref of preferences) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO notification_preferences (id, user_id, event_type, channel, enabled) VALUES (?, ?, ?, ?, ?)',
        ).bind(
          newId(),
          user.id,
          pref.eventType,
          pref.channel,
          pref.enabled ? 1 : 0,
        ),
      );
    }

    await env.DB.batch(stmts);

    return json({ data: { updated: true } });
  },
);
