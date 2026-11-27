/**
 * The token layer and the app stylesheets carry their rationale in CSS
 * comments, which is where a designer or a reviewer will look for it. None of
 * that needs to reach a homeowner's phone: on the micro-site the comments
 * were about 6 KB of the served stylesheet, on a page whose whole selling
 * point is its weight.
 *
 * So the prose stays in the source and is stripped at the point the sheet is
 * served or adopted. Deliberately conservative — comments and indentation
 * only. It does not touch whitespace inside a selector, a `calc()` or a
 * quoted string, because a stylesheet that ships slightly larger is a much
 * smaller problem than one that ships broken.
 */
/**
 * Cache key for a served stylesheet. FNV-1a, so a Worker can compute it
 * without a node builtin. It only has to change when the sheet changes.
 */
export function stylesheetVersion(css: string): string {
  let hash = 2166136261;
  for (let i = 0; i < css.length; i += 1) {
    hash ^= css.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function minifyCss(css: string): string {
  return (
    css
      // `/* … */`, including the multi-line rationale blocks.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Leading indentation on every line.
      .replace(/^[ \t]+/gm, '')
      // Blank lines left behind by the two passes above.
      .replace(/\n{2,}/g, '\n')
      .trim()
  );
}
