/* Encryption shared by the PC and the phone (same code, so they always agree).
   AES-256-GCM; key = PBKDF2-SHA256(passcode, random salt, 600,000 rounds). The passcode never leaves a device;
   GitHub only ever sees envelopes like {"v":1,"iv":"...","z":1,"ct":"..."}. Payloads are gzipped before encryption. */
(function (g) {
  const BT = (g.BT = g.BT || {});
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node && typeof window === 'undefined';
  const subtle = isNode ? require('crypto').webcrypto.subtle : g.crypto.subtle;
  const rnd = (n) => (isNode ? require('crypto').randomBytes(n) : g.crypto.getRandomValues(new Uint8Array(n)));
  const enc = new TextEncoder(), dec = new TextDecoder();
  const toB64 = (u8) => { if (isNode) return Buffer.from(u8).toString('base64'); let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); };
  const fromB64 = (b) => { if (isNode) return new Uint8Array(Buffer.from(b, 'base64')); const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const ITER = 600000;

  async function pipe(u8, Stream) { const rs = new Blob([u8]).stream().pipeThrough(new Stream('gzip')); return new Uint8Array(await new Response(rs).arrayBuffer()); }
  const gzip = (u8) => pipe(u8, CompressionStream); const gunzip = (u8) => pipe(u8, DecompressionStream);
  const HAS_GZ = typeof CompressionStream !== 'undefined';

  const Seal = {
    ITER, toB64, fromB64,
    newSalt: () => toB64(rnd(16)),
    async deriveKey(passcode, saltB64, iter) {
      const base = await subtle.importKey('raw', enc.encode(String(passcode)), 'PBKDF2', false, ['deriveKey']);
      return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: iter || ITER }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    },
    async exportKey(key) { return toB64(new Uint8Array(await subtle.exportKey('raw', key))); },
    importKey(b64) { return subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); },
    /** object -> envelope string */
    async seal(key, obj) {
      let data = enc.encode(JSON.stringify(obj)); let z = 0;
      if (HAS_GZ && data.length > 512) { data = await gzip(data); z = 1; }
      const iv = rnd(12); const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
      return JSON.stringify({ v: 1, iv: toB64(iv), z, ct: toB64(ct) });
    },
    /** envelope string -> object (throws if the key is wrong or the data was altered) */
    async open(key, envelope) {
      const e = typeof envelope === 'string' ? JSON.parse(envelope) : envelope; if (!e || e.v !== 1) throw new Error('Unknown format');
      let data = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(e.iv) }, key, fromB64(e.ct)));
      if (e.z) data = await gunzip(data);
      return JSON.parse(dec.decode(data));
    },
  };
  BT.seal = Seal;
  if (typeof module !== 'undefined' && module.exports) module.exports = Seal;
})(typeof window !== 'undefined' ? window : globalThis);
