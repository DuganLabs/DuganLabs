import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, newId } from '../lib/response';
import { entity } from '../lib/serialize';
import {
  DEFAULT_BRAND_PRIMARY_COLOR,
  WIRE_BRANDING,
} from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import { UpdateBrandingSchema } from '@greenput/shared/validators';

export const brandingRouter = Router({ base: '/api/branding' });

// GET /api/branding
brandingRouter.get('/', async (req: IRequest, env: Env) => {
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;

  let branding = await env.DB.prepare(
    'SELECT * FROM branding WHERE workspace_id = ?',
  )
    .bind(workspaceId)
    .first<Record<string, unknown>>();

  if (!branding) {
    // Return defaults when no branding row exists yet
    branding = {
      id: null,
      workspace_id: workspaceId,
      logo_url: null,
      favicon_url: null,
      primary_color: DEFAULT_BRAND_PRIMARY_COLOR,
      secondary_color: '#1f2937',
      accent_color: '#3b82f6',
      font_family: 'system-ui',
      custom_domain: null,
      email_footer: '',
      updated_at: null,
    };
  }

  return entity(WIRE_BRANDING, branding);
});

// PATCH /api/branding
brandingRouter.patch(
  '/',
  validate(UpdateBrandingSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as Record<string, unknown>).workspaceId as string;
    const user = (req as Record<string, unknown>).user as { id: string };
    const body = (req as Record<string, unknown>).validatedBody as Record<
      string,
      unknown
    >;

    const now = new Date().toISOString();

    const existing = await env.DB.prepare(
      'SELECT id FROM branding WHERE workspace_id = ?',
    )
      .bind(workspaceId)
      .first<{ id: string }>();

    const camelToSnake: Record<string, string> = {
      logoUrl: 'logo_url',
      faviconUrl: 'favicon_url',
      primaryColor: 'primary_color',
      secondaryColor: 'secondary_color',
      accentColor: 'accent_color',
      fontFamily: 'font_family',
      customDomain: 'custom_domain',
      emailFooter: 'email_footer',
    };

    if (existing) {
      // Update existing branding row
      const allowed = [
        'logo_url',
        'favicon_url',
        'primary_color',
        'secondary_color',
        'accent_color',
        'font_family',
        'custom_domain',
        'email_footer',
      ];

      const sets: string[] = ['updated_at = ?'];
      const vals: unknown[] = [now];

      for (const [key, val] of Object.entries(body)) {
        const col = camelToSnake[key] ?? key;
        if (allowed.includes(col)) {
          sets.push(`${col} = ?`);
          vals.push(val);
        }
      }

      vals.push(workspaceId);

      await env.DB.prepare(
        `UPDATE branding SET ${sets.join(', ')} WHERE workspace_id = ?`,
      )
        .bind(...vals)
        .run();
    } else {
      // Insert new branding row with provided values + defaults
      const id = newId();
      const defaults: Record<string, unknown> = {
        logo_url: null,
        favicon_url: null,
        primary_color: DEFAULT_BRAND_PRIMARY_COLOR,
        secondary_color: '#1f2937',
        accent_color: '#3b82f6',
        font_family: 'system-ui',
        custom_domain: null,
        email_footer: '',
      };

      // Override defaults with provided values
      for (const [key, val] of Object.entries(body)) {
        const col = camelToSnake[key] ?? key;
        if (col in defaults) {
          defaults[col] = val;
        }
      }

      await env.DB.prepare(
        `
        INSERT INTO branding (
          id, workspace_id, logo_url, favicon_url,
          primary_color, secondary_color, accent_color,
          font_family, custom_domain, email_footer, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `,
      )
        .bind(
          id,
          workspaceId,
          defaults['logo_url'],
          defaults['favicon_url'],
          defaults['primary_color'],
          defaults['secondary_color'],
          defaults['accent_color'],
          defaults['font_family'],
          defaults['custom_domain'],
          defaults['email_footer'],
          now,
        )
        .run();
    }

    // Log activity
    await env.DB.prepare(
      `
      INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
      VALUES (?, ?, ?, 'branding', ?, 'updated', ?)
    `,
    )
      .bind(newId(), workspaceId, user.id, workspaceId, now)
      .run();

    const updated = await env.DB.prepare(
      'SELECT * FROM branding WHERE workspace_id = ?',
    )
      .bind(workspaceId)
      .first<Record<string, unknown>>();

    return entity(WIRE_BRANDING, updated);
  },
);
