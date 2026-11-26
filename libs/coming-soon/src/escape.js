// Every string that reaches HTML goes through esc(). Content files are
// owner-written, but lead data shown in the leads view is not.
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
/** Tagged template: interpolations are escaped unless wrapped in raw(). */
export class Raw { constructor(s) { this.s = String(s); } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else if (v instanceof Raw) out += v.s;
    else if (v === false || v === null || v === undefined) out += '';
    else out += esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}
