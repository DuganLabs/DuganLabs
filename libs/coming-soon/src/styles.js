// One stylesheet for every DuganLabs landing, login and leads page. Inlined
// per response (~7 KB) so a landing is one request: no web fonts, no framework,
// only Baseline "Widely available" CSS (custom properties, grid, clamp(),
// :focus-visible, clip-path, 100svh, prefers-color-scheme, prefers-reduced-motion,
// forced-colors). Aligned with BaseNative semantic token tiers.
export const CSS = String.raw`
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100svh;overflow-x:clip;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-size:1rem;line-height:1.5;color:var(--fg);background:var(--bg);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
:root{--bg:#fbfbfa;--surface:#ffffff;--fg:#0b0c0e;--muted:#565a63;--faint:#656972;--line:rgba(12,14,18,.1);--line-strong:rgba(12,14,18,.22);--control-border:#71757f;
  --accent:#1d1d1f;--accent-ink:#ffffff;--accent-strong:#1d1d1f;--accent-soft:rgba(29,29,31,.08);--ok:#11743f;--err:#b4231b;--radius:14px;--shadow:0 1px 2px rgba(12,14,18,.04),0 8px 24px -12px rgba(12,14,18,.12);
  --bn-bg:var(--bg);--bn-surface:var(--surface);--bn-fg:var(--fg);--bn-muted:var(--muted);--bn-accent:var(--accent);--bn-accent-ink:var(--accent-ink);--bn-border:var(--control-border)}
@media (prefers-color-scheme:dark){:root{--bg:#0b0c0e;--surface:#131418;--fg:#f3f4f6;--muted:#a3a7b0;--faint:#9499a3;--line:rgba(255,255,255,.09);--line-strong:rgba(255,255,255,.22);--control-border:#8b909b;--shadow:0 1px 2px rgba(0,0,0,.4),0 12px 32px -16px rgba(0,0,0,.6);--ok:#5bd08f;--err:#ff8a80}}
a{color:inherit}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.skip{position:fixed;inset-block-start:12px;inset-inline-start:12px;background:var(--fg);color:var(--bg);padding:.5rem .875rem;border-radius:8px;z-index:100;text-decoration:none;font-weight:600;font-size:.875rem}
.skip:not(:focus):not(:focus-visible){position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
:focus-visible{outline:2px solid var(--accent-strong,var(--accent));outline-offset:3px}
main:focus{outline:none}
.wrap{width:100%;max-width:1120px;margin:0 auto;padding-inline:max(24px,env(safe-area-inset-left,0px)) max(24px,env(safe-area-inset-right,0px))}
@media (min-width:768px){.wrap{padding-inline:max(40px,env(safe-area-inset-left,0px)) max(40px,env(safe-area-inset-right,0px))}}
/* nav */
.nav{display:flex;align-items:center;justify-content:space-between;min-height:72px;gap:16px}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:600;letter-spacing:-.01em;text-decoration:none;font-size:.9375rem;min-height:44px}
.mark{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-size:.8125rem;font-weight:700;letter-spacing:0;flex:none}
.navlink{display:inline-flex;align-items:center;min-height:44px;font-size:.875rem;color:var(--muted);text-decoration:none;padding:0 16px;border-radius:999px;border:1px solid var(--control-border)}
.navlink:hover{color:var(--fg);border-color:var(--fg)}
/* hero */
.hero{position:relative;padding:56px 0 40px;display:grid;gap:48px;align-items:center}
@media (min-width:960px){.hero{grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:64px;padding:88px 0 56px}}
.hero.solo{grid-template-columns:minmax(0,1fr);max-width:720px;padding-top:64px}
@media (min-width:960px){.hero.solo{padding-top:96px}}
.glow{position:absolute;inset:-120px 0 auto 0;height:520px;z-index:-1;pointer-events:none;
  background:radial-gradient(60% 60% at 18% 30%,var(--glow-a),transparent 70%),radial-gradient(40% 50% at 85% 20%,var(--glow-b),transparent 70%)}
.eyebrow{display:inline-flex;align-items:center;gap:8px;margin:0 0 24px;padding:6px 12px 6px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);font-size:.8125rem;font-weight:500;color:var(--muted);box-shadow:var(--shadow)}
.dot{position:relative;width:8px;height:8px;border-radius:50%;background:var(--accent-strong,var(--accent));flex:none}
.dot::after{content:"";position:absolute;inset:-4px;border-radius:50%;background:var(--accent-soft);opacity:.9;pointer-events:none}
@media (prefers-reduced-motion:no-preference){.dot::after{animation:pulse 2.4s ease-in-out infinite}@keyframes pulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.55);opacity:0}}}
h1{margin:0;font-size:clamp(2.25rem,1.4rem + 4vw,4.25rem);line-height:1.05;letter-spacing:-.035em;font-weight:650}
.lede{margin:20px 0 0;max-width:36em;font-size:clamp(1.05rem,1rem + .35vw,1.25rem);line-height:1.55;color:var(--muted)}
/* form */
.signup{margin-top:36px;max-width:520px}
.field{display:flex;gap:8px;padding:6px;border-radius:16px;background:var(--surface);border:1px solid var(--control-border);box-shadow:var(--shadow)}
.field:focus-within{border-color:var(--accent-strong,var(--accent));outline:2px solid var(--accent-strong,var(--accent));outline-offset:2px}
.field input{flex:1;min-width:0;border:0;background:transparent;color:var(--fg);font:inherit;font-size:max(1rem,1em);padding:10px 12px;border-radius:10px;min-height:44px}
.field input:focus{outline:none}
.field input::placeholder{color:var(--faint)}
.field input[aria-invalid=true]{color:var(--fg)}
.btn{appearance:none;border:1px solid transparent;cursor:pointer;font:inherit;font-weight:600;font-size:.9375rem;letter-spacing:-.005em;padding:10px 18px;border-radius:11px;background:var(--accent);color:var(--accent-ink);white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px}
.btn:hover:not([disabled]){filter:brightness(1.08)}
@media (prefers-color-scheme:dark){.btn:hover:not([disabled]){filter:brightness(.92)}}
.btn:active:not([disabled]){transform:translateY(1px)}
.btn[disabled]{opacity:.6;cursor:progress}
.btn.ghost{background:transparent;color:var(--fg);border-color:var(--control-border)}
.btn.ghost:hover:not([disabled]){filter:none;border-color:var(--fg)}
.consent{display:flex;gap:10px;align-items:flex-start;margin:14px 2px 0;font-size:.875rem;line-height:1.45;color:var(--muted)}
.consent input{margin:0;width:24px;height:24px;min-width:24px;min-height:24px;accent-color:var(--accent-strong,var(--accent));flex:none;cursor:pointer}
.consent-text{padding-top:2px}
.consent-text label{cursor:pointer}
.consent a{color:var(--fg);text-underline-offset:3px}
.status{min-height:1.5rem;margin:12px 2px 0;font-size:.875rem;font-weight:500}
.status.ok{color:var(--ok)}.status.err{color:var(--err)}
.joined{display:flex;gap:12px;align-items:center;margin-top:36px;padding:16px 18px;border-radius:16px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow);max-width:520px}
.joined svg{flex:none;color:var(--ok)}
#ts{margin-top:12px}
@media (max-width:520px){.field{flex-direction:column;padding:6px}.field .btn{width:100%}}
/* visual */
.visual{position:relative;display:none}
@media (min-width:960px){.visual{display:block}}
.panel{border-radius:22px;padding:22px 22px 24px;background:var(--surface);border:1px solid var(--line);box-shadow:0 1px 2px rgba(12,14,18,.04),0 30px 60px -30px rgba(12,14,18,.25)}
.panel-head{display:flex;align-items:center;gap:6px;padding:2px 2px 16px}
.panel-head small{margin-inline-start:auto;font-size:.75rem;font-weight:500;color:var(--faint);letter-spacing:.01em}
.panel-head i{width:10px;height:10px;border-radius:50%;background:var(--line-strong)}
.row{display:flex;align-items:center;gap:14px;padding:16px;border-radius:12px;border:1px solid var(--line);background:var(--bg)}
.row+.row{margin-top:10px}
.row .ic{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--accent-soft);color:var(--accent-strong,var(--accent));flex:none}
.row b{display:block;font-size:.875rem;font-weight:600;letter-spacing:-.01em}
.row span{display:block;font-size:.8125rem;color:var(--muted)}
.row .tick{margin-inline-start:auto;color:var(--ok)}
.row:nth-child(3){margin-inline-start:16px}.row:nth-child(4){margin-inline-start:32px}.row:nth-child(5){margin-inline-start:48px}
/* points */
.points{display:grid;gap:16px;padding:8px 0 88px}
@media (min-width:768px){.points{grid-template-columns:repeat(3,minmax(0,1fr))}}
.point{padding:24px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line)}
.point .num{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--accent-soft);color:var(--accent-strong,var(--accent));font-size:.8125rem;font-weight:700;margin-bottom:16px}
.point h2{margin:0 0 6px;font-size:1rem;letter-spacing:-.01em;font-weight:600}
.point p{margin:0;color:var(--muted);font-size:.9375rem;line-height:1.55}
main{flex:1 0 auto}
.app{flex:1 0 auto;min-height:100vh;min-height:100svh}
.nil{color:var(--faint)}
/* footer */
.foot{border-top:1px solid var(--line);padding:24px 0 max(36px,env(safe-area-inset-bottom,0px));font-size:.8125rem;color:var(--faint)}
.foot .wrap{display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between;align-items:center}
.foot nav{display:flex;flex-wrap:wrap;gap:8px 20px}
.foot a{display:inline-flex;align-items:center;min-height:32px;color:var(--muted);text-decoration:underline;text-decoration-color:var(--line-strong);text-underline-offset:3px}
.foot a:hover{color:var(--fg);text-decoration-color:currentColor}
/* auth + private */
.center{min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:24px}
.card{width:100%;max-width:400px;padding:36px 32px 28px;border-radius:20px;background:var(--surface);border:1px solid var(--line);box-shadow:0 1px 2px rgba(12,14,18,.04),0 30px 60px -30px rgba(12,14,18,.25);text-align:center}
.card .mark{width:44px;height:44px;border-radius:12px;font-size:1.125rem;margin-bottom:20px}
.card h1{font-size:1.5rem;letter-spacing:-.02em;line-height:1.2}
.card p{color:var(--muted);margin:10px 0 0;font-size:.9375rem}
.card .btn{width:100%;margin-top:28px}
.card .meta{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:18px;font-size:.8125rem;color:var(--faint)}
.card .back{display:inline-flex;align-items:center;min-height:44px;margin-top:14px;padding:0 8px;font-size:.875rem;color:var(--muted);text-decoration:none}
.card .back:hover{color:var(--fg)}
.bar{border-bottom:1px solid var(--line);background:var(--surface)}
.bar .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;min-height:60px;padding-block:8px;gap:8px 16px}
.pill{font-size:.75rem;font-weight:600;padding:3px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent-strong,var(--accent))}
.who{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;font-size:.875rem;color:var(--muted)}
.who a{display:inline-flex;align-items:center;min-height:44px;color:var(--fg)}
.back-link{display:inline-flex;align-items:center;min-height:44px;margin-bottom:8px;font-size:.875rem;color:var(--muted);text-decoration:none}
.back-link:hover{color:var(--fg)}
.page{padding-top:32px;padding-bottom:64px}
.page h1{font-size:1.75rem;letter-spacing:-.025em}
.sub{margin:6px 0 0;color:var(--muted);font-size:.9375rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:28px 0}
.stat{padding:18px 20px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line)}
.stat dt{font-size:.8125rem;color:var(--muted)}
.stat dd{margin:6px 0 0;font-size:1.75rem;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tools{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;min-height:44px;font-size:.875rem;padding:0 14px;border-radius:999px;border:1px solid var(--control-border);text-decoration:none;color:var(--muted);background:var(--surface)}
.chip[aria-current=page]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.tools search{flex:1 1 280px;max-width:480px}
.search{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.search input{font:inherit;font-size:max(1rem,1em);padding:8px 12px;border-radius:10px;border:1px solid var(--control-border);background:var(--surface);color:var(--fg);flex:1 1 160px;min-width:0;min-height:44px}
.search .btn{padding:8px 14px;min-height:44px;font-size:.875rem}
.table{width:100%;border-collapse:separate;border-spacing:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;font-size:.875rem}
.table th{text-align:start;font-weight:500;color:var(--muted);font-size:.8125rem;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--bg)}
.table td{padding:13px 16px;border-bottom:1px solid var(--line);vertical-align:top}
.table tr:last-child td{border-bottom:0}
.table .src{font-size:.75rem;padding:2px 8px;border-radius:6px;background:var(--accent-soft)}
.table time{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:var(--radius)}
.empty{padding:48px 16px;text-align:center;color:var(--muted)}
.hub{display:grid;gap:12px;margin-top:28px;max-width:640px}
.hubcard{display:flex;align-items:center;gap:16px;padding:18px 20px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line);text-decoration:none;box-shadow:var(--shadow);min-height:44px}
.hubcard:hover{border-color:var(--control-border)}
.hubcard .ic{display:grid;place-items:center;width:40px;height:40px;border-radius:11px;background:var(--accent-soft);color:var(--accent-strong,var(--accent));flex:none}
.hubcard b{display:block;font-weight:600;letter-spacing:-.01em}
.hubcard span span{display:block;font-size:.875rem;color:var(--muted)}
.hubcard .go{margin-inline-start:auto;color:var(--faint)}
.prose{max-width:680px;padding:24px 0 72px}.prose h1{font-size:2rem;margin-bottom:16px}.prose p,.prose li{color:var(--muted)}
.muted{color:var(--muted)}
.todo{display:inline-block;margin-top:28px;font-size:.75rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--faint);border:1px dashed var(--control-border);border-radius:8px;padding:6px 10px}
@media (pointer:coarse){.foot a{min-height:44px}.consent input{width:28px;height:28px;min-width:28px;min-height:28px}}
@media (forced-colors:active){:focus-visible,.field:focus-within{outline:2px solid Highlight;outline-offset:3px}.btn,.chip[aria-current=page]{border:1px solid ButtonText}.field,.search input,.navlink,.chip,.btn.ghost{border-color:CanvasText}}
`;
