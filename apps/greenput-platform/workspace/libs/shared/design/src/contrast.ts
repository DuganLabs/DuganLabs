/**
 * WCAG 2.x relative-luminance and contrast maths, plus a resolver that reads
 * the actual `--gp-*` declarations out of `GP_TOKENS_CSS`.
 *
 * This exists so accessibility is a computed property of the palette rather
 * than a claim about it: `tokens.spec.ts` resolves every documented pairing
 * through here and fails the build if one drops below its threshold.
 */

/** Extracts `--name: value` declarations from a CSS text block. Later declarations win. */
export function parseCustomProperties(css: string): Map<string, string> {
  return collectCustomProperties(css, true);
}

/**
 * The first declaration of each name. Used for the kit sheet, which
 * redeclares every colour for dark, contrast and macOS later in the file.
 */
export function parseFirstCustomProperties(css: string): Map<string, string> {
  return collectCustomProperties(css, false);
}

function collectCustomProperties(
  css: string,
  overwrite: boolean,
): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const [, name, value] = m;
    if (name === undefined || value === undefined) continue;
    if (!overwrite && out.has(name)) continue;
    out.set(name, value.replace(/!important/gi, '').trim());
  }
  return out;
}

/**
 * Follows `var(--a)` chains until a literal `#rrggbb` is reached. Throws on a
 * dangling reference or a non-hex terminal so a typo in the token layer is a
 * test failure rather than a silently-transparent colour in production.
 */
export function resolveColor(
  name: string,
  props: Map<string, string>,
  seen: ReadonlySet<string> = new Set(),
): string {
  if (seen.has(name)) {
    throw new Error(`Cyclic custom property reference at ${name}`);
  }
  const raw = props.get(name);
  if (raw === undefined) {
    throw new Error(`Unknown custom property ${name}`);
  }
  const cleaned = raw.replace(/!important/gi, '').trim();
  const varMatch = /^var\((--[a-z0-9-]+)\)$/i.exec(cleaned);
  const alias = varMatch?.[1];
  if (alias !== undefined) {
    return resolveColor(alias, props, new Set([...seen, name]));
  }
  const hex = literalHex(cleaned);
  if (hex === null) {
    throw new Error(`${name} is not a plain colour (got "${raw}")`);
  }
  return hex;
}

/**
 * `#rrggbb` or `rgb()` / `rgba()`. A partial alpha is composited on white,
 * which is the light ground the pairing table measures against.
 */
function literalHex(raw: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase();
  const rgb =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
      raw,
    );
  if (rgb === null) return null;
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
  const channels = [rgb[1], rgb[2], rgb[3]].map((channel) => {
    const value = Number(channel);
    return Math.round(value * alpha + 255 * (1 - alpha));
  });
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
