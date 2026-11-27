// Per-app content contract (apps/<domain>/content.json). Validated at build
// (nx run <app>:check) and again when the Worker starts, so a malformed file
// fails CI instead of shipping a broken page.
import { icons } from './icons.js';

export const CONSENT_VERSION = 'v1';

const HEX = /^#[0-9a-fA-F]{6}$/;
const SOURCE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const HTTPS_URL = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i;
const MONOGRAM = /^[A-Za-z0-9]{1,3}$/;
const ICON_NAMES = new Set(Object.keys(icons));
const OPTIONAL_THEME_HEX = ['accentInk', 'accentStrong', 'accentDark', 'accentInkDark', 'accentStrongDark'];

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

export function validateContent(c) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(c && typeof c === 'object', 'content must be an object');
  if (errors.length) return errors;
  need(typeof c.name === 'string' && c.name.length > 0 && c.name.length <= 40, 'name: 1-40 chars');
  need(typeof c.domain === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(c.domain), 'domain: bare hostname');
  need(SOURCE.test(c.source ?? ''), 'source: lowercase slug (the lead source tag)');
  need(['coming-soon', 'private-beta'].includes(c.status), 'status: coming-soon | private-beta');
  const t = c.theme && typeof c.theme === 'object' ? c.theme : null;
  need(t && HEX.test(t.accent ?? ''), 'theme.accent: #rrggbb');
  if (t) {
    need(t.ink === undefined, 'theme.ink is unused and must be removed');
    for (const key of OPTIONAL_THEME_HEX) {
      if (t[key] !== undefined) need(HEX.test(t[key]), `theme.${key}: #rrggbb`);
    }
    if (HEX.test(t.accent ?? '')) {
      const ink = HEX.test(t.accentInk ?? '') ? t.accentInk : '#ffffff';
      need(contrast(t.accent, ink) >= 4.5, `theme.accentInk (${ink}) on theme.accent (${t.accent}) must be >= 4.5:1 (WCAG AA)`);
    }
    if (HEX.test(t.accentDark ?? '')) {
      const inkDark = HEX.test(t.accentInkDark ?? '') ? t.accentInkDark : (HEX.test(t.accentInk ?? '') ? t.accentInk : '#ffffff');
      need(contrast(t.accentDark, inkDark) >= 4.5, `theme.accentInkDark (${inkDark}) on theme.accentDark (${t.accentDark}) must be >= 4.5:1 (WCAG AA)`);
    }
  }
  if (c.todo) {
    // Placeholder apps: the owner has not given the idea yet. No product copy
    // is allowed, so nothing invented can ship by accident.
    need(!c.headline && !c.idea && !(c.points?.length), 'todo apps must not carry headline/idea/points');
  } else {
    need(typeof c.headline === 'string' && c.headline.length > 0 && c.headline.length <= 90, 'headline: 1-90 chars');
    need(typeof c.idea === 'string' && c.idea.length > 0 && c.idea.length <= 220, 'idea: one line, 1-220 chars');
    need(c.headline?.trim() !== 'TODO' && c.idea?.trim() !== 'TODO', 'headline/idea must not be literal "TODO" (use todo: true instead)');
    need(!c.points || (Array.isArray(c.points) && [0, 3].includes(c.points.length)), 'points: none or exactly 3 (never padded with invented copy)');
    (c.points ?? []).forEach((p, i) => {
      need(p && typeof p.title === 'string' && p.title.length > 0 && p.title.length <= 48 && p.title.trim() !== 'TODO', `points[${i}].title: 1-48 chars (not "TODO")`);
      need(p && typeof p.body === 'string' && p.body.length > 0 && p.body.length <= 160 && p.body.trim() !== 'TODO', `points[${i}].body: 1-160 chars (not "TODO")`);
      if (p?.icon !== undefined) need(ICON_NAMES.has(p.icon), `points[${i}].icon: unknown icon "${p.icon}"`);
    });
    if (c.visual !== undefined) {
      need(Array.isArray(c.visual?.rows) && c.visual.rows.length >= 2 && c.visual.rows.length <= 4, 'visual.rows: 2-4');
      (c.visual?.rows ?? []).forEach((r, i) => {
        need(r && typeof r.title === 'string' && r.title.length > 0 && r.title.length <= 60, `visual.rows[${i}].title: 1-60 chars`);
        if (r?.detail !== undefined) need(typeof r.detail === 'string' && r.detail.length <= 100, `visual.rows[${i}].detail: <= 100 chars`);
        if (r?.icon !== undefined) need(ICON_NAMES.has(r.icon), `visual.rows[${i}].icon: unknown icon "${r.icon}"`);
      });
    }
  }
  need(!c.cta || (typeof c.cta === 'string' && c.cta.length <= 28), 'cta: <= 28 chars');
  need(c.form === undefined || typeof c.form === 'boolean', 'form: boolean (false = no public lead form)');
  need(c.privateUrl === undefined || HTTPS_URL.test(c.privateUrl), 'privateUrl: https URL of the content moved behind the login');
  need(c.privateLabel === undefined || (typeof c.privateLabel === 'string' && c.privateLabel.length > 0 && c.privateLabel.length <= 48), 'privateLabel: 1-48 chars');
  need(c.parentUrl === undefined || HTTPS_URL.test(c.parentUrl), 'parentUrl: https URL');
  need(c.monogram === undefined || (typeof c.monogram === 'string' && MONOGRAM.test(c.monogram)), 'monogram: 1-3 alphanumeric chars');
  need(!c.eyebrow || (typeof c.eyebrow === 'string' && c.eyebrow.length <= 32), 'eyebrow: <= 32 chars');
  need(c.noindex === undefined || typeof c.noindex === 'boolean', 'noindex: boolean');
  need(c.parentLabel === undefined || typeof c.parentLabel === 'string', 'parentLabel: string ("" hides it)');
  need(!c.placeholder || (typeof c.placeholder === 'string' && c.placeholder.length <= 40), 'placeholder: <= 40 chars');
  need(!c.leadsScope || ['self', 'all'].includes(c.leadsScope), 'leadsScope: self | all');
  return errors;
}

export function assertContent(c) {
  const errors = validateContent(c);
  if (errors.length) throw new Error(`content.json for ${c?.domain ?? '?'} is invalid:\n- ${errors.join('\n- ')}`);
  return c;
}
