import { html, raw, esc } from './escape.js';
import { CSS } from './styles.js';
import { icon } from './icons.js';
import { CONSENT_VERSION } from './content.js';

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Per-app theme as CSS custom properties, light + dark. */
function themeVars(t) {
  const dark = t.accentDark ?? t.accent;
  const ink = t.accentInk ?? '#ffffff';
  const inkDark = t.accentInkDark ?? ink;
  const strong = t.accentStrong ?? t.accent;
  const strongDark = t.accentStrongDark ?? dark;
  return `:root{--accent:${t.accent};--accent-ink:${ink};--accent-strong:${strong};--accent-soft:${rgba(strong, 0.1)};--glow-a:${rgba(t.accent, 0.13)};--glow-b:${rgba(t.accent, 0.07)}}
@media (prefers-color-scheme:dark){:root{--accent:${dark};--accent-ink:${inkDark};--accent-strong:${strongDark};--accent-soft:${rgba(strongDark, 0.16)};--glow-a:${rgba(dark, 0.18)};--glow-b:${rgba(dark, 0.08)}}}`;
}

export const monogram = (c) => (c.monogram ?? c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 1)).toUpperCase();

export function layout(c, { title, description, nonce, body, path = '/', noindex = false, bodyClass = '', scripts = '' }) {
  const pageUrl = `https://${c.domain}${path}`;
  return '<!doctype html>' + html`<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${noindex ? raw('<meta name="robots" content="noindex, nofollow">') : ''}
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fbfbfa">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0c0e">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
${noindex ? '' : html`<link rel="canonical" href="${pageUrl}">`}
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="https://${c.domain}/og.svg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<style nonce="${nonce}">${raw(CSS)}${raw(themeVars(c.theme))}</style>
</head>
<body${bodyClass ? html` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">Skip to content</a>
${body}
${raw(scripts)}
</body>
</html>`.s;
}

function nav(c, { login = true } = {}) {
  return html`<header class="wrap nav">
  <a class="brand" href="/"><span class="mark" aria-hidden="true">${monogram(c)}</span><span>${c.name}</span></a>
  ${login ? html`<a class="navlink" href="/login">Log in</a>` : ''}
</header>`;
}

function footer(c) {
  const year = new Date().getUTCFullYear();
  const parent = c.source === 'duganlabs' || c.parentLabel === ''
    ? ''
    : c.parentLabel ? html` · <a href="${c.parentUrl ?? 'https://duganlabs.com'}">${c.parentLabel}</a>` : html` · A <a href="https://duganlabs.com">DuganLabs</a> project`;
  return html`<footer class="foot"><div class="wrap">
  <span>© ${year} ${c.name}${parent}</span>
  <nav aria-label="Footer"><a href="/privacy">Privacy</a><a href="/login">Log in</a></nav>
</div></footer>`;
}

const STATUS_LABEL = { 'coming-soon': 'Coming soon', 'private-beta': 'Private beta' };
const eyebrow = (c) => c.eyebrow ?? STATUS_LABEL[c.status];

function signupForm(c, env, state) {
  const cta = c.cta ?? (c.status === 'private-beta' ? 'Request access' : 'Get early access');
  const consent = c.todo
    ? `Email me when ${c.domain} launches. No spam; unsubscribe anytime.`
    : `Email me about ${c.name}. No spam; unsubscribe anytime.`;
  if (state.joined) return joined(c);
  const err = state.error ? ERRORS[state.error] ?? ERRORS.server : '';
  const emailInvalid = state.error === 'email';
  const consentInvalid = state.error === 'consent';
  return html`<form id="lead" class="signup" method="post" action="/api/lead" data-sitekey="${env.TURNSTILE_SITE_KEY ?? ''}" novalidate>
  <div class="field">
    <label class="sr-only" for="email">Email address</label>
    <input id="email" name="email" type="email" inputmode="email" autocomplete="email" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="${c.placeholder ?? 'you@example.com'}" required maxlength="254" aria-describedby="status"${emailInvalid ? raw(' aria-invalid="true"') : ''}>
    <button class="btn" type="submit">${cta}</button>
  </div>
  <input type="hidden" name="consent_version" value="${CONSENT_VERSION}">
  <div class="consent">
    <input id="consent" type="checkbox" name="consent" value="yes" required aria-describedby="status"${consentInvalid ? raw(' aria-invalid="true"') : ''}>
    <span class="consent-text"><label for="consent">${consent}</label> <a href="/privacy">Privacy policy</a>.</span>
  </div>
  <div id="ts"></div>
  <p id="status" class="status${err ? ' err' : ''}" role="${err ? 'alert' : 'status'}" aria-live="${err ? 'assertive' : 'polite'}">${err}</p>
</form>
<template id="joined-tpl">${joined(c)}</template>`;
}

function joined(c) {
  return html`<div class="joined" role="status" tabindex="-1">${raw(icon('check', 22))}<div><strong>You're on the list.</strong><br><span class="muted">We'll email you when ${c.name} opens up.</span></div></div>`;
}

export const ERRORS = {
  email: 'Please enter a valid email address.',
  consent: 'Please tick the box so we can email you.',
  verify: 'We could not verify you are human. Please try again (JavaScript is required).',
  rate: 'Too many attempts. Please try again in a few minutes.',
  server: 'Something went wrong on our side. Please try again.',
};

function visual(c) {
  if (!c.visual?.rows?.length) return '';
  return html`<div class="visual" aria-hidden="true"><div class="panel">
  <div class="panel-head"><i></i><i></i><i></i><small>${c.name}</small></div>
  ${c.visual.rows.map((r) => html`<div class="row"><span class="ic">${raw(icon(r.icon, 18))}</span><div><b>${r.title}</b><span>${r.detail ?? ''}</span></div><span class="tick">${raw(icon('check', 16))}</span></div>`)}
</div></div>`;
}

export function landing(c, env, { nonce, state = {} }) {
  const todo = !!c.todo;
  const hasForm = c.form !== false;
  const title = todo ? `${c.domain} · Coming soon` : c.headline === c.name ? c.name : `${c.name} · ${c.headline}`;
  const description = todo ? `${c.domain} is coming soon.` : c.idea;
  const hero = todo
    ? html`<section class="hero solo" aria-labelledby="h">
  <div><p class="eyebrow"><span class="dot" aria-hidden="true"></span>${eyebrow(c)}</p>
  <h1 id="h">${c.domain}</h1>
  <p class="lede">Something new is on the way. Leave your email and you'll hear first when it opens.</p>
  ${hasForm ? signupForm(c, env, state) : ''}
  <p class="todo">TODO(owner): product idea not provided yet. No copy is invented here.</p></div>
</section>`
    : html`<section class="hero${c.visual ? '' : ' solo'}" aria-labelledby="h">
  <div><p class="eyebrow"><span class="dot" aria-hidden="true"></span>${eyebrow(c)}</p>
  <h1 id="h">${c.headline}</h1>
  <p class="lede">${c.idea}</p>
  ${hasForm ? signupForm(c, env, state) : ''}</div>
  ${visual(c)}
</section>`;
  const points = todo || !c.points?.length ? '' : html`<section class="points" aria-label="What ${c.name} does">
  ${c.points.map((p, i) => html`<article class="point"><span class="num" aria-hidden="true">${p.icon ? raw(icon(p.icon, 16)) : String(i + 1)}</span><h2>${p.title}</h2><p>${p.body}</p></article>`)}
</section>`;
  const body = html`<div class="glow" aria-hidden="true"></div>
${nav(c)}
<main id="main" tabindex="-1" class="wrap">${hero}${points}</main>
${footer(c)}`;
  return layout(c, {
    title,
    description,
    nonce,
    body,
    path: '/',
    noindex: todo || !!c.noindex,
    scripts: hasForm ? `<script nonce="${esc(nonce)}">${CLIENT}</script>` : '',
  });
}

export function login(c, { nonce }) {
  const body = html`<main id="main" tabindex="-1" class="center"><div class="card">
  <span class="mark" aria-hidden="true">${monogram(c)}</span>
  <h1>Private access</h1>
  <p>This area of ${c.name} is restricted to its owner. Continue to verify your identity.</p>
  <a class="btn" href="/app/">${raw(icon('lock', 16))}<span>Continue to sign in</span></a>
  <div class="meta">${raw(icon('shield', 14))}<span>Secured by Cloudflare Access</span></div>
  <a class="back" href="/">← Back to ${c.name}</a>
</div></main>`;
  return layout(c, { title: `Log in · ${c.name}`, description: `Private access to ${c.name}.`, nonce, body, path: '/login', noindex: true });
}

export function privacy(c, { nonce }) {
  const content = c.form === false
    ? html`<p>${c.name} does not collect visitor email addresses or run a public signup form.</p>
  <p>Standard server logs may record technical request metadata to keep the service reliable and protected against abuse.</p>`
    : html`<p>When you join the ${c.name} list we store the email address you give us, the optional details you add, which site you signed up on, the time, and a one-way hash of your IP address used only to stop abuse.</p>
  <p>We use it only to tell you about ${c.name}. We do not sell or share it. Every email has an unsubscribe link, and you can ask us to delete your details at any time.</p>
  <p>To leave the list, use the unsubscribe link in any email we send, or reply to it and ask us to delete your details.</p>
  <p>Spam protection is provided by Cloudflare Turnstile.</p>`;
  const body = html`${nav(c)}<main id="main" tabindex="-1" class="wrap prose">
  <h1>Privacy</h1>
  ${content}
</main>${footer(c)}`;
  return layout(c, { title: `Privacy · ${c.name}`, description: `How ${c.name} handles your data.`, nonce, body, path: '/privacy', noindex: true });
}

export function message(c, { nonce, title, text, status = 'Not found', path = '/' }) {
  const body = html`<main id="main" tabindex="-1" class="center"><div class="card">
  <span class="mark" aria-hidden="true">${monogram(c)}</span>
  <h1>${title}</h1><p>${text}</p>
  <a class="back" href="/">← Back to ${c.name}</a>
</div></main>`;
  return layout(c, { title: `${status} · ${c.name}`, description: text, nonce, body, path, noindex: true });
}

export function hub(c, { nonce, email, total }) {
  const card = (href, ic, title, text, ext = false) => html`<a class="hubcard" href="${href}"${ext ? raw(' rel="noopener"') : ''}><span class="ic">${raw(icon(ic, 18))}</span><span><b>${title}</b><span>${text}</span></span><span class="go">${raw(icon('arrow', 16))}</span></a>`;
  const body = html`<div class="app">
<header class="bar"><div class="wrap">
  <a class="brand" href="/app/"><span class="mark" aria-hidden="true">${monogram(c)}</span><span>${c.name}</span><span class="pill">Private</span></a>
  <div class="who"><span>${email}</span><a href="/cdn-cgi/access/logout">Sign out</a></div>
</div></header>
<main id="main" tabindex="-1" class="wrap page">
  <h1>Welcome back</h1>
  <p class="sub">Only you can see this. The public sees the coming-soon page.</p>
  <div class="hub">
    ${c.form === false && c.leadsScope !== 'all' ? '' : card('/app/leads', 'inbox', 'Leads', `${total} signup${total === 1 ? '' : 's'} from the coming-soon page${c.leadsScope === 'all' ? 's' : ''}`)}
    ${c.privateUrl ? card(c.privateUrl, 'lock', `Open ${c.privateLabel ?? 'the current site'}`, new URL(c.privateUrl).host + ' · behind the same login', true) : ''}
    ${card('/', 'spark', 'View public page', c.domain)}
  </div>
</main></div>`;
  return layout(c, { title: `Private · ${c.name}`, description: 'Private area.', nonce, body, path: '/app/', noindex: true });
}

const fmt = (iso) => {
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
};

export function leadsView(c, { nonce, data, email, source, q, sources }) {
  const scopeAll = c.leadsScope === 'all';
  const qs = (s) => {
    const p = new URLSearchParams({ ...(s ? { source: s } : {}), ...(q ? { q } : {}) }).toString();
    return p ? `?${p}` : '';
  };
  const nil = raw('<span class="nil"><span aria-hidden="true">—</span><span class="sr-only">None</span></span>');
  const chips = scopeAll
    ? html`<nav class="chips" aria-label="Filter by site">
  <a class="chip" href="/app/leads${q ? `?q=${encodeURIComponent(q)}` : ''}"${!source ? raw(' aria-current="page"') : ''}>All</a>
  ${sources.map((s) => html`<a class="chip" href="/app/leads${qs(s)}"${s === source ? raw(' aria-current="page"') : ''}>${s}</a>`)}
</nav>`
    : html`<span class="sub">Signups on ${c.domain}</span>`;
  const rows = data.leads.length
    ? data.leads.map((l) => html`<tr><td>${l.email}</td><td>${l.name || nil}</td><td>${l.interest || nil}</td><td><span class="src">${l.source}</span></td><td><time datetime="${l.created_at}">${fmt(l.created_at)}</time></td></tr>`)
    : [html`<tr><td colspan="5" class="empty">No signups yet.</td></tr>`];
  const body = html`<div class="app">
<header class="bar"><div class="wrap">
  <a class="brand" href="/app/"><span class="mark" aria-hidden="true">${monogram(c)}</span><span>${c.name}</span><span class="pill">Private</span></a>
  <div class="who"><span>${email}</span><a href="/cdn-cgi/access/logout">Sign out</a></div>
</div></header>
<main id="main" tabindex="-1" class="wrap page">
  <a class="back-link" href="/app/">← Private hub</a>
  <h1>Leads</h1>
  <p class="sub">Interest captured by the coming-soon pages. Times are Pacific.</p>
  <dl class="stats">
    <div class="stat"><dt>Total signups</dt><dd>${data.stats.total}</dd></div>
    <div class="stat"><dt>Last 7 days</dt><dd>${data.stats.last7}</dd></div>
    <div class="stat"><dt>Last 24 hours</dt><dd>${data.stats.last1}</dd></div>
    <div class="stat"><dt>Sites with signups</dt><dd>${data.stats.sources}</dd></div>
  </dl>
  <div class="tools">
    ${chips}
    <search>
      <form class="search" method="get" action="/app/leads">
        ${source ? html`<input type="hidden" name="source" value="${source}">` : ''}
        <label class="sr-only" for="q">Search leads</label>
        <input id="q" name="q" type="search" value="${q ?? ''}" placeholder="Search email or name" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="search">
        <button class="btn ghost" type="submit">Search</button>
        <a class="btn ghost" href="/app/leads.csv${qs(source)}">Export CSV</a>
      </form>
    </search>
  </div>
  <div class="scroll" tabindex="0" role="region" aria-label="Leads table"><table class="table">
    <caption class="sr-only">Leads, newest first</caption>
    <thead><tr><th scope="col">Email</th><th scope="col">Name</th><th scope="col">Interested in</th><th scope="col">Site</th><th scope="col">Signed up</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</main></div>`;
  return layout(c, { title: `Leads · ${c.name}`, description: 'Private leads view.', nonce, body, path: '/app/leads', noindex: true });
}

// Progressive enhancement for the lead form. Turnstile's script is loaded
// only when someone starts filling the form, so the landing itself makes no
// third-party request. Without JS, validation and redirects work via 303;
// Turnstile verification requires JS when TURNSTILE_SITE_KEY is configured.
const CLIENT = `(()=>{const f=document.getElementById('lead');if(!f)return;const s=document.getElementById('status');const em=f.email;const co=f.consent;const key=f.dataset.sitekey;let wid,ready;
const say=(msg,isErr)=>{s.className=isErr?'status err':'status';s.setAttribute('role',isErr?'alert':'status');s.setAttribute('aria-live',isErr?'assertive':'polite');s.textContent=msg};
const load=()=>ready||(ready=new Promise((res,rej)=>{if(!key){res();return}window.__ts=()=>{wid=turnstile.render('#ts',{sitekey:key,action:'lead',appearance:'interaction-only'});res()};const sc=document.createElement('script');sc.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__ts&render=explicit';sc.async=true;sc.onerror=()=>{ready=null;rej(new Error('verify'))};document.head.append(sc)}));
const token=()=>new Promise((res,rej)=>{if(!key){res('');return}let n=0;const t=setInterval(()=>{const v=turnstile.getResponse(wid);if(v){clearInterval(t);res(v)}else if(++n>150){clearInterval(t);rej(new Error('verify'))}},100)});
em.addEventListener('input',()=>{em.removeAttribute('aria-invalid');if(s.classList.contains('err'))say('',false)});
co.addEventListener('change',()=>{co.removeAttribute('aria-invalid');if(s.classList.contains('err'))say('',false)});
f.addEventListener('focusin',()=>{load().catch(()=>{})},{once:true});
f.addEventListener('submit',async(e)=>{e.preventDefault();em.removeAttribute('aria-invalid');co.removeAttribute('aria-invalid');say('',false);
if(!em.value||!em.checkValidity()){em.setAttribute('aria-invalid','true');say(${JSON.stringify(ERRORS.email)},true);em.focus();return}
if(!co.checked){co.setAttribute('aria-invalid','true');say(${JSON.stringify(ERRORS.consent)},true);co.focus();return}
const b=f.querySelector('button[type="submit"]');b.disabled=true;say('Sending…',false);
try{await load();const tk=await token();const fd=new FormData(f);if(tk)fd.set('cf-turnstile-response',tk);
const r=await fetch(f.action,{method:'POST',body:fd,headers:{accept:'application/json'}});const j=await r.json().catch(()=>({}));
if(r.ok&&j.ok){const tpl=document.getElementById('joined-tpl');f.replaceWith(tpl.content.cloneNode(true));document.querySelector('.joined').focus();return}
if(j.error==='email')em.setAttribute('aria-invalid','true');if(j.error==='consent')co.setAttribute('aria-invalid','true');
say(j.message||${JSON.stringify(ERRORS.server)},true);if(key&&wid!==undefined)turnstile.reset(wid)}
catch{say(${JSON.stringify(ERRORS.verify)},true)}finally{b.disabled=false}});})();`;
