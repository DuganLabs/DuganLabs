/**
 * Constant-time comparison for shared secrets.
 *
 * `presented === configured` leaks the length of the common prefix through
 * timing, and comparing `.length` first leaks the secret's length outright.
 * Both sides are instead HMAC'd under a key generated fresh for this call, and
 * the resulting two 32-byte digests are compared with no early exit — so the
 * work done and the bytes compared are identical whatever the inputs are, and
 * an attacker cannot steer the digests because they do not know the key.
 *
 * Cloudflare's non-standard `crypto.subtle.timingSafeEqual` is deliberately not
 * used: it throws when the two buffers differ in length, which puts the length
 * comparison straight back, and it does not exist in the Node environment the
 * unit tests run in.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(32)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const [digestA, digestB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, encoder.encode(a)),
    crypto.subtle.sign('HMAC', key, encoder.encode(b)),
  ]);

  // HMAC-SHA-256 is always 32 bytes, so the loop below runs the same number of
  // iterations for every pair of inputs.
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);

  let diff = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= bytesA[i] ^ bytesB[i];
  }

  return diff === 0;
}
