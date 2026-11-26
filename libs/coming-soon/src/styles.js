// One stylesheet for every DuganLabs landing, login and leads page. Inlined
// per response (it is ~6 KB) so a landing is one request: no web fonts, no
// framework, only Baseline "Widely available" CSS (custom properties, grid,
// clamp(), :focus-visible, prefers-color-scheme, prefers-reduced-motion).
// color-mix() and :has() are deliberately not used.
export const CSS = String.raw`
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-size:16px;line-height:1.5;color:var(--fg);background:var(--bg);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
:root{--bg:#fbfbfa;--surface:#ffffff;--fg:#0b0c0e;--muted:#565a63;--faint:#6b6f78;--line:rgba(12,14,18,.09);--line-strong:rgba(12,14,18,.16);
  --accent:#1d1d1f;--accent-ink:#ffffff;--accent-soft:rgba(29,29,31,.08);--ok:#11743f;--err:#b4231b;--radius:14px;--shadow:0 1px 2px rgba(12,14,18,.04),0 8px 24px -12px rgba(12,14,18,.12)}
@media (prefers-color-scheme:dark){:root{--bg:#0b0c0e;--surface:#131418;--fg:#f3f4f6;--muted:#a3a7b0;--faint:#9196a0;--line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.16);--shadow:0 1px 2px rgba(0,0,0,.4),0 12px 32px -16px rgba(0,0,0,.6);--ok:#5bd08f;--err:#ff8a80}}
a{color:inherit}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip{position:absolute;left:12px;top:-48px;background:var(--fg);color:var(--bg);padding:8px 12px;border-radius:8px;z-index:10;text-decoration:none}
.skip:focus{top:12px}
:focus-visible{outline:2px solid var(--accent-strong,var(--accent));outline-offset:3px;border-radius:6px}
.wrap{width:100%;max-width:1120px;margin:0 auto;padding:0 24px}
@media (min-width:768px){.wrap{padding:0 40px}}
/* nav */
.nav{display:flex;align-items:center;justify-content:space-between;height:72px}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:600;letter-spacing:-.01em;text-decoration:none;font-size:15px}
.mark{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:700;letter-spacing:0}
.navlink{font-size:14px;color:var(--muted);text-decoration:none;padding:8px 12px;border-radius:999px;border:1px solid var(--line)}
.navlink:hover{color:var(--fg);border-color:var(--line-strong)}
/* hero */
.hero{position:relative;padding:56px 0 40px;display:grid;gap:48px;align-items:center}
@media (min-width:960px){.hero{grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:64px;padding:88px 0 56px}}
.hero.solo{grid-template-columns:minmax(0,1fr);max-width:720px;padding-top:96px}
.glow{position:absolute;inset:-120px -40px auto -40px;height:520px;z-index:-1;pointer-events:none;
  background:radial-gradient(60% 60% at 18% 30%,var(--glow-a),transparent 70%),radial-gradient(40% 50% at 85% 20%,var(--glow-b),transparent 70%)}
.eyebrow{display:inline-flex;align-items:center;gap:8px;margin:0 0 24px;padding:6px 12px 6px 10px;border-radius:999px;border:1px solid var(--line);background:var(--surface);font-size:13px;font-weight:500;color:var(--muted);box-shadow:var(--shadow)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--accent-strong,var(--accent));box-shadow:0 0 0 4px var(--accent-soft)}
@media (prefers-reduced-motion:no-preference){.dot{animation:pulse 2.4s ease-in-out infinite}@keyframes pulse{50%{box-shadow:0 0 0 7px transparent}}}
h1{margin:0;font-size:clamp(2.4rem,1.4rem + 4.2vw,4.25rem);line-height:1.04;letter-spacing:-.035em;font-weight:650}
.lede{margin:20px 0 0;max-width:36em;font-size:clamp(1.05rem,1rem + .35vw,1.25rem);line-height:1.55;color:var(--muted)}
/* form */
.signup{margin-top:36px;max-width:520px}
.field{display:flex;gap:8px;padding:6px;border-radius:16px;background:var(--surface);border:1px solid var(--line-strong);box-shadow:var(--shadow)}
.field:focus-within{border-color:var(--accent-strong,var(--accent));box-shadow:0 0 0 4px var(--accent-soft),var(--shadow)}
.field input{flex:1;min-width:0;border:0;background:transparent;color:var(--fg);font:inherit;font-size:16px;padding:10px 12px;border-radius:10px}
.field input:focus{outline:none}
.field input::placeholder{color:var(--faint)}
.btn{appearance:none;border:0;cursor:pointer;font:inherit;font-weight:600;font-size:15px;letter-spacing:-.005em;padding:12px 18px;border-radius:11px;background:var(--accent);color:var(--accent-ink);white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px}
.btn:hover{filter:brightness(1.08)}
.btn:active{transform:translateY(1px)}
.btn[disabled]{opacity:.6;cursor:progress}
.btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line-strong)}
.consent{display:flex;gap:10px;align-items:flex-start;margin:14px 2px 0;font-size:13px;line-height:1.45;color:var(--muted)}
.consent input{margin:2px 0 0;width:16px;height:16px;accent-color:var(--accent-strong,var(--accent));flex:none}
.consent a{color:var(--fg);text-underline-offset:2px}
.status{min-height:22px;margin:12px 2px 0;font-size:14px;font-weight:500}
.status.ok{color:var(--ok)}.status.err{color:var(--err)}
.joined{display:flex;gap:12px;align-items:center;margin-top:36px;padding:16px 18px;border-radius:16px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow);max-width:520px}
.joined svg{flex:none;color:var(--ok)}
#ts{margin-top:12px}
@media (max-width:520px){.field{flex-direction:column;padding:6px}.btn{width:100%}}
/* visual */
.visual{position:relative;display:none}
@media (min-width:960px){.visual{display:block}}
.panel{border-radius:22px;padding:22px 22px 24px;background:var(--surface);border:1px solid var(--line);box-shadow:0 1px 2px rgba(12,14,18,.04),0 30px 60px -30px rgba(12,14,18,.25);}
.panel-head{display:flex;align-items:center;gap:6px;padding:2px 2px 16px}
.panel-head small{margin-left:auto;font-size:12px;font-weight:500;color:var(--faint);letter-spacing:.01em}
.panel-head i{width:10px;height:10px;border-radius:50%;background:var(--line-strong)}
.row{display:flex;align-items:center;gap:14px;padding:16px;border-radius:12px;border:1px solid var(--line);background:var(--bg)}
.row+.row{margin-top:10px}
.row .ic{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--accent-soft);color:var(--accent-strong,var(--accent));flex:none}
.row b{display:block;font-size:14px;font-weight:600;letter-spacing:-.01em}
.row span{display:block;font-size:12.5px;color:var(--muted)}
.row .tick{margin-left:auto;color:var(--ok)}
.row:nth-child(3){margin-left:20px}.row:nth-child(4){margin-left:40px}
/* points */
.points{display:grid;gap:16px;padding:8px 0 88px}
@media (min-width:768px){.points{grid-template-columns:repeat(3,minmax(0,1fr))}}
.point{padding:24px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line)}
.point .num{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--accent-soft);color:var(--accent-strong,var(--accent));font-size:13px;font-weight:700;margin-bottom:16px}
.point h2{margin:0 0 6px;font-size:16px;letter-spacing:-.01em;font-weight:600}
.point p{margin:0;color:var(--muted);font-size:15px;line-height:1.55}
main{flex:1 0 auto}
.app{flex:1 0 auto}
.nil{color:var(--faint)}
/* footer */
.foot{border-top:1px solid var(--line);padding:28px 0 40px;font-size:13px;color:var(--faint)}
.foot .wrap{display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between;align-items:center}
.foot nav{display:flex;gap:20px}
.foot a{color:var(--muted);text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:3px}.foot a:hover{color:var(--fg);text-decoration-color:currentColor}
/* auth + private */
.center{min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:24px}
.card{width:100%;max-width:400px;padding:36px 32px 28px;border-radius:20px;background:var(--surface);border:1px solid var(--line);box-shadow:0 1px 2px rgba(12,14,18,.04),0 30px 60px -30px rgba(12,14,18,.25);text-align:center}
.card .mark{width:44px;height:44px;border-radius:12px;font-size:18px;margin-bottom:20px}
.card h1{font-size:24px;letter-spacing:-.02em;line-height:1.2}
.card p{color:var(--muted);margin:10px 0 0;font-size:15px}
.card .btn{width:100%;margin-top:28px}
.card .meta{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:18px;font-size:12.5px;color:var(--faint)}
.card .back{display:inline-block;margin-top:22px;font-size:14px;color:var(--muted);text-decoration:none}
.app{min-height:100vh}
.bar{border-bottom:1px solid var(--line);background:var(--surface)}
.bar .wrap{display:flex;align-items:center;justify-content:space-between;height:60px;gap:16px}
.pill{font-size:12px;font-weight:600;padding:3px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent-strong,var(--accent))}
.who{display:flex;align-items:center;gap:14px;font-size:13px;color:var(--muted)}
.who a{color:var(--fg)}
.page{padding-top:36px;padding-bottom:64px}
.page h1{font-size:28px;letter-spacing:-.025em}
.sub{margin:6px 0 0;color:var(--muted);font-size:15px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:28px 0}
.stat{padding:18px 20px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line)}
.stat dt{font-size:13px;color:var(--muted)}
.stat dd{margin:6px 0 0;font-size:28px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:13px;padding:6px 12px;border-radius:999px;border:1px solid var(--line);text-decoration:none;color:var(--muted);background:var(--surface)}
.chip[aria-current=page]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
.search{display:flex;gap:8px}
.search input{font:inherit;font-size:14px;padding:8px 12px;border-radius:10px;border:1px solid var(--line-strong);background:var(--surface);color:var(--fg);min-width:200px}
.search .btn{padding:8px 14px;min-height:38px;font-size:14px}
.table{width:100%;border-collapse:separate;border-spacing:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;font-size:14px}
.table th{text-align:left;font-weight:500;color:var(--muted);font-size:12.5px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--bg)}
.table td{padding:13px 16px;border-bottom:1px solid var(--line);vertical-align:top}
.table tr:last-child td{border-bottom:0}
.table .src{font-size:12px;padding:2px 8px;border-radius:6px;background:var(--accent-soft)}
.table time{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.scroll{overflow-x:auto}
.empty{padding:48px 16px;text-align:center;color:var(--muted)}
.hub{display:grid;gap:12px;margin-top:28px;max-width:640px}
.hubcard{display:flex;align-items:center;gap:16px;padding:18px 20px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--line);text-decoration:none;box-shadow:var(--shadow)}
.hubcard:hover{border-color:var(--line-strong)}
.hubcard .ic{display:grid;place-items:center;width:40px;height:40px;border-radius:11px;background:var(--accent-soft);color:var(--accent-strong,var(--accent));flex:none}
.hubcard b{display:block;font-weight:600;letter-spacing:-.01em}
.hubcard span span{display:block;font-size:13.5px;color:var(--muted)}
.hubcard .go{margin-left:auto;color:var(--faint)}
.prose{max-width:680px;padding:24px 0 72px}.prose h1{font-size:32px;margin-bottom:16px}.prose p,.prose li{color:var(--muted)}
.muted{color:var(--muted)}
.todo{display:inline-block;margin-top:28px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--faint);border:1px dashed var(--line-strong);border-radius:8px;padding:6px 10px}
`;
