import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTurnstile } from '../src/index.js';

test('turnstile fails closed without a secret or token', async () => {
  assert.equal(await verifyTurnstile({}, 'tok', '1.1.1.1', async () => { throw new Error('no call'); }), false);
  assert.equal(await verifyTurnstile({ TURNSTILE_SECRET_KEY: 's' }, '', '1.1.1.1', async () => { throw new Error('no call'); }), false);
});

test('turnstile passes only on success:true', async () => {
  const ok = async () => new Response(JSON.stringify({ success: true }));
  const no = async () => new Response(JSON.stringify({ success: false }));
  assert.equal(await verifyTurnstile({ TURNSTILE_SECRET_KEY: 's' }, 't', '', ok), true);
  assert.equal(await verifyTurnstile({ TURNSTILE_SECRET_KEY: 's' }, 't', '', no), false);
});

test('per-widget secret is chosen by the server-forwarded sitekey; unknown sitekey fails closed', async () => {
  const { secretFor } = await import('../src/index.js');
  const env = { TURNSTILE_SECRETS: JSON.stringify({ 'key-a': 'sec-a', 'key-b': 'sec-b' }) };
  assert.equal(secretFor(env, 'key-b'), 'sec-b');
  assert.equal(secretFor(env, 'nope'), '');
  assert.equal(secretFor({ ...env, TURNSTILE_SECRETS: '{bad' }, 'key-a'), '');
  let sent;
  const ok = async (_u, init) => { sent = init.body.get('secret'); return new Response(JSON.stringify({ success: true })); };
  assert.equal(await verifyTurnstile(env, 't', '', ok, 'key-a'), true);
  assert.equal(sent, 'sec-a');
  assert.equal(await verifyTurnstile(env, 't', '', ok, 'unknown'), false);
});
