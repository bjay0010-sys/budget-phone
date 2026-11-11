/* Phone backend. Same interface as the PC backend, but the data lives on the phone as ENCRYPTED envelopes in
   IndexedDB (the key exists only in memory after you type the passcode), and changes travel to the PC through
   the private GitHub repo, encrypted. Works offline: saves queue up and are sent when there is a connection. */
(function (g) {
  const BT = (g.BT = g.BT || {}); const Seal = BT.seal; const L = BT.ledger; const U = BT.util;

  // ------------------------------------------------------------------ tiny IndexedDB key/value store
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('budget-phone', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function kvGet(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); }
  async function kvSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  async function kvDel(k) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  async function kvClear() { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }

  const b64 = (s) => { const u = new TextEncoder().encode(s); return Seal.toB64(u); };
  const blank = () => ({ transactions: [], rules: [], settings: {}, reviews: {}, appliedOps: [] });

  const P = {
    mode: 'phone', key: null, cfg: null, state: blank(), pending: [], token: null, error: null, syncing: false, lastPull: 0, _onChange: null,

    /** 'setup' if this phone has never been set up, else 'locked'. */
    async boot() { this.cfg = (await kvGet('cfg')) || null; const f = await kvGet('face'); this.hasFace = !!f; this.faceMode = f ? f.mode : null; return this.cfg ? 'locked' : 'setup'; },

    // ---- Face ID / passkey ----------------------------------------------------------------------------------
    // Same approach as Uni Hub. A passkey held by the phone (Face ID) is created for this site. If the browser can
    // hand back a secret from it (the WebAuthn "PRF" extension), that secret wraps the data key, so the key is only
    // recoverable with Face ID. If not, Face ID acts as a lock on the screen only (the key is kept on the phone, which
    // iOS already encrypts). The passcode always works.
    hasFace: false, faceMode: null,
    async faceAvailable() { try { return !!(window.PublicKeyCredential && navigator.credentials && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; } },
    async faceAssert(rec) {
      const a = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, userVerification: 'required', timeout: 60000,
        allowCredentials: [{ type: 'public-key', id: Seal.fromB64(rec.cid), transports: ['internal'] }], extensions: { prf: { eval: { first: Seal.fromB64(rec.salt) } } } } });
      const ext = a.getClientExtensionResults ? a.getClientExtensionResults() : {};
      return ext.prf && ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : null;
    },
    wrapKey: (prf, usage) => crypto.subtle.importKey('raw', prf.slice(0, 32), { name: 'AES-GCM' }, false, usage),
    async faceEnroll() {
      if (!this.key) throw new Error('Unlock with the passcode first.');
      const raw = Seal.fromB64(await Seal.exportKey(this.key)); const salt = crypto.getRandomValues(new Uint8Array(32));
      const cred = await navigator.credentials.create({ publicKey: { rp: { name: 'Budget', id: location.hostname }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'budget', displayName: 'Budget Tracker' },
        challenge: crypto.getRandomValues(new Uint8Array(32)), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000, extensions: { prf: {} } } });
      const rec = { cid: Seal.toB64(new Uint8Array(cred.rawId)), salt: Seal.toB64(salt), mode: 'gate' };
      let prf = null; try { prf = await this.faceAssert(rec); } catch (e) { prf = null; }
      if (prf) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.wrapKey(prf, ['encrypt']), raw)); rec.wrapped = Seal.toB64(ct); rec.iv = Seal.toB64(iv); rec.mode = 'prf'; }
      else rec.parked = Seal.toB64(raw);
      await kvSet('face', rec); this.hasFace = true; this.faceMode = rec.mode; return rec.mode;
    },
    async faceUnlock() {
      const rec = await kvGet('face'); if (!rec) throw new Error('Face ID is not set up.'); const prf = await this.faceAssert(rec); let raw;
      if (rec.mode === 'prf') { if (!prf) throw new Error('Face ID did not return the key. Use your passcode.'); raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Seal.fromB64(rec.iv) }, await this.wrapKey(prf, ['decrypt']), Seal.fromB64(rec.wrapped))); }
      else { if (!rec.parked) throw new Error('Use the passcode this time.'); raw = Seal.fromB64(rec.parked); }
      const key = await Seal.importKey(Seal.toB64(raw)); const c = this.cfg;
      try { await Seal.open(key, c.check); } catch (e) { throw new Error('Face ID is out of date (the passcode was changed). Use the passcode.'); }
      this.key = key; this.token = (await Seal.open(key, c.tokenEnv)).t; await this.rebuild();
    },
    async faceOff() { await kvDel('face'); await kvSet('facedecl', 1); this.hasFace = false; this.faceMode = null; },
    async faceDeclined() { return !!(await kvGet('facedecl')); },
    async declineFace() { await kvSet('facedecl', 1); },

    get api() { return (this.cfg && this.cfg.api) || 'https://api.github.com'; },

    async gh(method, path, { body, raw } = {}) {
      const res = await fetch(this.api + path, { method, headers: Object.assign({ Authorization: 'Bearer ' + this.token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
      if (res.status === 404) return { status: 404 };
      if (!res.ok) { const e = new Error(res.status === 401 ? 'GitHub rejected the access token. Set this phone up again.' : res.status === 403 ? 'GitHub refused the request (token permissions or rate limit).' : 'GitHub error ' + res.status); e.status = res.status; throw e; }
      return { status: res.status, data: raw ? await res.text() : await res.json() };
    },

    /** First-time setup from the link made on the PC, or typed by hand. */
    async setup({ repo, token, passcode, api }) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !token) throw new Error('The setup link is incomplete. Make a new one on your PC.');
      if (!passcode) throw new Error('Enter your passcode.');
      this.cfg = { repo, api: api || null }; this.token = token;
      let meta; try { const r = await this.gh('GET', `/repos/${repo}/contents/meta.json`, { raw: true }); if (r.status === 404) throw new Error('Nothing is set up in that repository yet. Connect your PC first.'); meta = JSON.parse(r.data); } catch (e) { this.cfg = null; this.token = null; throw e.status ? e : new Error(e.message === 'Failed to fetch' ? 'No connection. Try again when you are online.' : e.message); }
      const key = await Seal.deriveKey(passcode, meta.salt, meta.iter);
      try { await Seal.open(key, meta.check); } catch (e) { this.cfg = null; this.token = null; throw new Error('That passcode does not match the one set on your PC.'); }
      this.key = key; this.cfg = { repo, api: api || null, salt: meta.salt, iter: meta.iter, check: meta.check, tokenEnv: await Seal.seal(key, { t: token }) };
      await kvSet('cfg', this.cfg); await this.rebuild(); this.syncNow().catch(() => {});
    },

    async unlock(passcode) {
      const c = this.cfg; const key = await Seal.deriveKey(passcode, c.salt, c.iter);
      try { await Seal.open(key, c.check); } catch (e) { throw new Error('Wrong passcode.'); }
      this.key = key; this.token = (await Seal.open(key, c.tokenEnv)).t; await this.rebuild();
    },

    /** state = last snapshot from the PC + anything saved here that the PC has not confirmed yet. */
    async rebuild() {
      const snap = await kvGet('snap'); const st = snap ? await Seal.open(this.key, snap.env) : blank(); st.appliedOps = st.appliedOps || [];
      const applied = new Set(st.appliedOps); const list = (await kvGet('pending')) || []; const keep = [];
      for (const p of list) {
        const payload = await Seal.open(this.key, p.env);
        if (payload.ops.every((o) => applied.has(o.opId))) continue; // the PC has it
        keep.push(p); for (const op of payload.ops) L.applyOp(st, op);
      }
      this.pending = keep; await kvSet('pending', keep); this.state = st; this.lastPull = (snap && snap.pulledAt) || 0;
    },

    // ---- backend interface used by the shared UI ----
    async load() { const s = this.state; return { transactions: s.transactions, rules: s.rules, settings: s.settings, reviews: s.reviews }; },
    async ops(ops) {
      for (const o of ops) o.opId = o.opId || U.uid();
      const results = ops.map((o) => { try { return L.applyOp(this.state, o); } catch (e) { return { applied: false, error: e.message }; } });
      const payload = { opId: U.uid(), ops, from: 'phone', at: Date.now() };
      this.pending.push({ id: payload.opId, env: await Seal.seal(this.key, payload), sent: false }); await kvSet('pending', this.pending);
      this.flush().catch(() => {}); return { results, queued: true };
    },
    saveSettings(patch) { return this.ops([{ type: 'settings', patch }]); },
    saveReview(week, text) { return this.ops([{ type: 'review', week, text }]); },

    // ---- sync ----
    async flush() {
      for (const p of this.pending.filter((x) => !x.sent)) {
        const r = await this.gh('PUT', `/repos/${this.cfg.repo}/contents/inbox/${p.id}.enc`, { body: { message: 'upload', content: b64(p.env) } }).catch((e) => { if (e.status === 422) return { status: 422 }; throw e; });
        p.sent = true; await kvSet('pending', this.pending);
      }
    },
    async pullSnapshot() {
      const dir = await this.gh('GET', `/repos/${this.cfg.repo}/contents/`); if (!Array.isArray(dir.data)) return false;
      const f = dir.data.find((x) => x.name === 'snapshot.enc'); this.lastPull = Date.now(); if (!f) return false;
      const snap = await kvGet('snap'); if (snap && snap.sha === f.sha) { await kvSet('snap', Object.assign({}, snap, { pulledAt: this.lastPull })); return false; }
      const raw = await this.gh('GET', `/repos/${this.cfg.repo}/contents/snapshot.enc`, { raw: true });
      await kvSet('snap', { env: raw.data, sha: f.sha, pulledAt: this.lastPull }); await this.rebuild(); return true;
    },
    async syncNow() {
      if (this.syncing || !this.key) return; this.syncing = true;
      try { await this.flush(); const changed = await this.pullSnapshot(); this.error = null; if (changed && this._onChange) this._onChange(); }
      catch (e) { this.error = /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? null : e.message; if (e.status === 401) this.error = e.message; }
      finally { this.syncing = false; }
    },
    async status() { return { lastPull: this.lastPull, pending: this.pending.filter((p) => !p.sent).length, sent: this.pending.filter((p) => p.sent).length, error: this.error }; },
    onChange(cb) { this._onChange = cb; },
    lock() { location.reload(); },
    async signOut() { await kvClear(); location.reload(); },
  };
  BT.phoneBackend = P;
})(window);
