#!/usr/bin/env node
/**
 * One-off maintenance script for the `plaid_credentials` singleton row:
 *
 *   - Migrates a legacy-plaintext row to encrypted-at-rest immediately,
 *     without waiting for a request to trigger the read-path migration.
 *   - Completes a key rotation by re-wrapping the row's DEK under the
 *     current KEK version, once PLAID_CREDENTIALS_KEK_CURRENT has moved
 *     (see the "Rotation path" doc comment in
 *     worker/src/crypto/plaidCredentials.ts).
 *
 * You don't strictly need this script for the migration case — any read of
 * the row (GET /api/plaid/credentials, or any /api/plaid/* route that
 * calls loadCredentials) already migrates a legacy-plaintext row on the
 * fly. This script exists to force that immediately (e.g. right after
 * deploying the encryption change) and to drive rotation, which has no
 * other trigger.
 *
 * This intentionally re-implements the same small envelope-encryption
 * primitives as worker/src/crypto/plaidCredentials.ts rather than
 * importing it, so it runs with plain `node` — no build step, no ts-node —
 * against the same wire format. If that file's format ever changes, this
 * script must change with it.
 *
 * Usage:
 *   PLAID_CREDENTIALS_KEKS='{"1":"<base64 32-byte key>"}' \
 *   PLAID_CREDENTIALS_KEK_CURRENT=1 \
 *   node worker/scripts/rewrap-plaid-credentials.mjs [--remote|--local] [--db pendingbusiness]
 *
 * --remote (default) targets the deployed D1 via `wrangler d1 execute
 * --remote` and needs CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in the
 * environment, same as any other `wrangler d1` command. --local targets
 * the local dev D1 (wrangler d1 execute --local) for testing this script
 * itself.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const mode = args.includes('--local') ? '--local' : '--remote';
const dbIndex = args.indexOf('--db');
const dbName = dbIndex !== -1 ? args[dbIndex + 1] : 'pendingbusiness';

const SCHEME = 'pbenc';
const FORMAT_VERSION = 'v1';
const PREFIX = `${SCHEME}:${FORMAT_VERSION}:`;

function base64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function parseKeks() {
  const raw = process.env.PLAID_CREDENTIALS_KEKS;
  if (!raw) throw new Error('PLAID_CREDENTIALS_KEKS is not set in the environment.');
  return JSON.parse(raw);
}

function currentVersion() {
  const v = process.env.PLAID_CREDENTIALS_KEK_CURRENT;
  if (!v) throw new Error('PLAID_CREDENTIALS_KEK_CURRENT is not set in the environment.');
  return v;
}

async function importKek(base64Key) {
  const raw = base64ToBytes(base64Key);
  if (raw.length !== 32)
    throw new Error('Each KEK must be a base64-encoded 32-byte (256-bit) AES key.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function aesEncrypt(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv, ciphertext: new Uint8Array(ct) };
}
async function aesDecrypt(key, iv, ciphertext) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(pt);
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

async function encryptField(plaintext) {
  const keks = parseKeks();
  const version = currentVersion();
  const kekB64 = keks[version];
  if (!kekB64) {
    throw new Error(
      `PLAID_CREDENTIALS_KEK_CURRENT="${version}" has no matching entry in PLAID_CREDENTIALS_KEKS.`,
    );
  }
  const kek = await importKek(kekB64);

  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey('raw', dekRaw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  const data = await aesEncrypt(dek, new TextEncoder().encode(plaintext));
  const wrap = await aesEncrypt(kek, dekRaw);

  return [
    SCHEME,
    FORMAT_VERSION,
    version,
    bytesToBase64(wrap.iv),
    bytesToBase64(wrap.ciphertext),
    bytesToBase64(data.iv),
    bytesToBase64(data.ciphertext),
  ].join(':');
}

async function rewrapField(stored) {
  const parts = stored.split(':');
  if (parts.length !== 7) throw new Error('Malformed envelope value; refusing to touch it.');
  const [, , kekVersion, wrapIvB64, wrappedDekB64, dataIvB64, ciphertextB64] = parts;
  const keks = parseKeks();
  const version = currentVersion();
  if (kekVersion === version) return stored; // already current

  const oldKekB64 = keks[kekVersion];
  if (!oldKekB64) {
    throw new Error(
      `Row is wrapped under retired version "${kekVersion}", which is missing from PLAID_CREDENTIALS_KEKS.`,
    );
  }
  const oldKek = await importKek(oldKekB64);
  const dekRaw = await aesDecrypt(oldKek, base64ToBytes(wrapIvB64), base64ToBytes(wrappedDekB64));

  const newKekB64 = keks[version];
  if (!newKekB64) {
    throw new Error(
      `PLAID_CREDENTIALS_KEK_CURRENT="${version}" has no matching entry in PLAID_CREDENTIALS_KEKS.`,
    );
  }
  const newKek = await importKek(newKekB64);
  const wrap = await aesEncrypt(newKek, dekRaw);

  return [
    SCHEME,
    FORMAT_VERSION,
    version,
    bytesToBase64(wrap.iv),
    bytesToBase64(wrap.ciphertext),
    dataIvB64,
    ciphertextB64,
  ].join(':');
}

function d1Query(sql) {
  const out = execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', dbName, mode, '--json', '--command', sql],
    {
      cwd: WORKER_DIR,
      encoding: 'utf8',
    },
  );
  const parsed = JSON.parse(out);
  const result = Array.isArray(parsed) ? parsed[0] : parsed;
  return result?.results ?? [];
}

function d1Exec(sqlFile) {
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', dbName, mode, '--file', sqlFile], {
    cwd: WORKER_DIR,
    stdio: 'inherit',
  });
}

function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main() {
  const rows = d1Query('SELECT id, client_id, secret, env FROM plaid_credentials WHERE id = 1');
  if (rows.length === 0) {
    console.log('No plaid_credentials row found — nothing to do.');
    return;
  }
  const row = rows[0];

  let newClientId = row.client_id;
  let newSecret = row.secret;
  let action = 'none';

  if (!isEncrypted(row.client_id) || !isEncrypted(row.secret)) {
    action = 'migrate (encrypt legacy plaintext)';
    newClientId = isEncrypted(row.client_id) ? row.client_id : await encryptField(row.client_id);
    newSecret = isEncrypted(row.secret) ? row.secret : await encryptField(row.secret);
  } else {
    const v = currentVersion();
    const clientIdVersion = row.client_id.split(':')[2];
    const secretVersion = row.secret.split(':')[2];
    if (clientIdVersion !== v || secretVersion !== v) {
      action = `rewrap (rotate to key version "${v}")`;
      newClientId = await rewrapField(row.client_id);
      newSecret = await rewrapField(row.secret);
    }
  }

  if (action === 'none') {
    console.log('Row is already encrypted under the current key version — nothing to do.');
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), 'pb-plaid-rewrap-'));
  const file = join(dir, 'update.sql');
  writeFileSync(
    file,
    `UPDATE plaid_credentials SET client_id = ${sqlString(newClientId)}, secret = ${sqlString(newSecret)}, updated_at = datetime('now') WHERE id = 1;\n`,
  );
  try {
    console.log(`Applying: ${action}`);
    d1Exec(file);
    console.log('Done.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
