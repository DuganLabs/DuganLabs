// Per-app content contract (apps/<domain>/content.json). Validated at build
// (nx run <app>:check) and again when the Worker starts, so a malformed file
// fails CI instead of shipping a broken page.
export const CONSENT_VERSION = 'v0-draft';

const HEX = /^#[0-9a-fA-F]{6}$/;
const SOURCE = /^[a-z0-9][a-z0-9-]{1,40}$/;

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
  need(c.theme && HEX.test(c.theme.accent ?? ''), 'theme.accent: #rrggbb');
  for (const [bg, fg] of [['accent', 'accentInk'], ['accentDark', 'accentInkDark']]) {
    const t = c.theme || {};
    if (HEX.test(t[bg] ?? '') && HEX.test(t[fg] ?? '')) {
      need(contrast(t[bg], t[fg]) >= 4.5, `theme.${fg} on theme.${bg} must be >= 4.5:1 (WCAG AA)`);
    }
  }
  need(c.theme && HEX.test(c.theme.ink ?? ''), 'theme.ink: #rrggbb');
  if (c.todo) {
    // Placeholder apps: the owner has not given the idea yet. No product copy
    // is allowed, so nothing invented can ship by accident.
    need(!c.headline && !c.idea && !(c.points?.length), 'todo apps must not carry headline/idea/points');
  } else {
    need(typeof c.headline === 'string' && c.headline.length <= 90, 'headline: <= 90 chars');
    need(typeof c.idea === 'string' && c.idea.length <= 220, 'idea: one line, <= 220 chars');
    need(!c.points || (Array.isArray(c.points) && [0, 3].includes(c.points.length)), 'points: none or exactly 3 (never padded with invented copy)');
    (c.points ?? []).forEach((p, i) => {
      need(p && typeof p.title === 'string' && p.title.length <= 48, `points[${i}].title <= 48 chars`);
      need(p && typeof p.body === 'string' && p.body.length <= 160, `points[${i}].body <= 160 chars`);
    });
    if (c.visual) need(Array.isArray(c.visual.rows) && c.visual.rows.length >= 2 && c.visual.rows.length <= 4, 'visual.rows: 2-4');
  }
  need(!c.cta || (typeof c.cta === 'string' && c.cta.length <= 28), 'cta: <= 28 chars');
  need(c.form === undefined || typeof c.form === 'boolean', 'form: boolean (false = no public lead form)');
  need(!c.privateUrl || /^https:\/\/[a-z0-9.-]+\//.test(c.privateUrl), 'privateUrl: https URL of the content moved behind the login');
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
