import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createSite, validateContent } from '../src/index.js';
import { esc } from '../src/escape.js';

const base = { name: 'Demo', domain: 'demo.com', source: 'demo', status: 'coming-soon', headline: 'Hello', idea: 'An idea.', theme: { accent: '#112233', ink: '#000000' } };
const fakeLeads = (calls = []) => ({
  fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/leads')) return new Response(JSON.stringify({ leads: [{ email: '<b>x@example.com</b>', name: null, interest: null, source: 'demo', created_at: '2026-11-26T19:00:00.000Z' }], stats: { total: 1, last7: 1, last1: 1, sources: 1 }, sourceList: ['demo'] }));
    return new Response(JSON.stringify({ ok: true }));
  },
});

test('every app content.json passes the kit contract', () => {
  for (const app of readdirSync('apps')) {
    const f = `apps/${app}/content.json`;
    if (!existsSync(f)) continue;
    assert.deepEqual(validateContent(JSON.parse(readFileSync(f, 'utf8'))), [], f);
  }
});

test('no owner email or other PII is committed in app config (public repo)', () => {
  for (const app of readdirSync('apps')) {
    for (const f of ['content.json', 'wrangler.toml', 'deploy.json']) {
      const p = `apps/${app}/${f}`;
      if (!existsSync(p)) continue;
      // Generic form placeholders (you@example.com, you@company.com) are allowed; real addresses are not.
      const text = readFileSync(p, 'utf8').replace(/\byou@(example|company)\.com\b/g, '');
      assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/, p);
    }
  }
});

test('todo content cannot carry invented copy; points are none or exactly 3', () => {
  assert.ok(validateContent({ ...base, todo: true }).length > 0);
  assert.ok(validateContent({ ...base, points: [{ title: 'a', body: 'b' }] }).length > 0);
  assert.deepEqual(validateContent(base), []);
});

test('escape', () => assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;'));

test('landing renders with CSP nonce, form, login link, security headers', async () => {
  const site = createSite(base);
  const r = await site.fetch(new Request('https://demo.com/'), { LEADS: fakeLeads(), TURNSTILE_SITE_KEY: 'k' });
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy');
  const nonce = /nonce-([^']+)/.exec(csp)[1];
  const body = await r.text();
  assert.match(body, new RegExp(`<style nonce="${nonce.replace(/[+/=]/g, (m) => '\\' + m)}">`));
  assert.match(body, /action="\/api\/lead"/);
  assert.match(body, /href="\/login"/);
  assert.doesNotMatch(body, /style="/, 'no inline style attributes (CSP)');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(csp, /frame-ancestors 'none'/);
});

test('form:false hides the lead form', async () => {
  const r = await createSite({ ...base, form: false }).fetch(new Request('https://demo.com/'), {});
  assert.doesNotMatch(await r.text(), /id="lead"/);
});

test('lead POST: server sets source + ip, browser cannot', async () => {
  const calls = [];
  const fd = new FormData();
  fd.set('email', 'Person@Example.com'); fd.set('consent', 'yes'); fd.set('source', 'evil'); fd.set('cf-turnstile-response', 't');
  const r = await createSite(base).fetch(new Request('https://demo.com/api/lead', { method: 'POST', body: fd, headers: { accept: 'application/json', 'cf-connecting-ip': '1.2.3.4' } }), { LEADS: fakeLeads(calls) });
  assert.equal(r.status, 200);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.source, 'demo');
  assert.equal(sent.email, 'person@example.com');
  assert.equal(sent.ip, '1.2.3.4');
});

test('lead POST rejects bad email and missing consent; no-JS gets a 303', async () => {
  const fd = new FormData(); fd.set('email', 'nope');
  const r = await createSite(base).fetch(new Request('https://demo.com/api/lead', { method: 'POST', body: fd }), { LEADS: fakeLeads() });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /error=email/);
  const fd2 = new FormData(); fd2.set('email', 'a@b.co');
  const r2 = await createSite(base).fetch(new Request('https://demo.com/api/lead', { method: 'POST', body: fd2, headers: { accept: 'application/json' } }), { LEADS: fakeLeads() });
  assert.equal((await r2.json()).error, 'consent');
});

test('private area fails closed on a real hostname without Access config', async () => {
  const env = { LEADS: fakeLeads(), DEV_ACCESS_EMAIL: 'dev@example.com' };
  const r = await createSite(base).fetch(new Request('https://demo.com/app/leads'), env);
  assert.equal(r.status, 403);
  const r2 = await createSite(base).fetch(new Request('https://demo.com/app/leads', { headers: { 'cf-access-jwt-assertion': 'a.b.c' } }), { ...env, ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com', ACCESS_AUD: 'x', OWNER_EMAILS: 'o@example.com' });
  assert.equal(r2.status, 403);
});

test('dev bypass works only on localhost, and lead data is escaped in the leads view', async () => {
  const r = await createSite(base).fetch(new Request('http://localhost:8787/app/leads'), { LEADS: fakeLeads(), DEV_ACCESS_EMAIL: 'dev@example.com' });
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /&lt;b&gt;x@example.com&lt;\/b&gt;/);
  assert.doesNotMatch(body, /<b>x@example.com<\/b>/);
});

test('accent/ink pairs meet WCAG AA in every app theme', async () => {
  const { contrast } = await import('../src/content.js');
  for (const app of readdirSync('apps')) {
    const p = `apps/${app}/content.json`;
    if (!existsSync(p)) continue;
    const t = JSON.parse(readFileSync(p, 'utf8')).theme || {};
    for (const [bg, fg] of [['accent', 'accentInk'], ['accentDark', 'accentInkDark']]) {
      if (t[bg] && t[fg]) assert.ok(contrast(t[bg], t[fg]) >= 4.5, `${app}: ${fg} on ${bg} = ${contrast(t[bg], t[fg]).toFixed(2)}`);
    }
  }
});
