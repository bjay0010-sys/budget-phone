/* Phone start-up: setup (from the PC's link), lock screen with Face ID, auto-lock, background sync. */
(async function () {
  const { h, icon } = BT.ui; const P = BT.phoneBackend;
  BT.config = { mode: 'phone', ocrPath: 'web/vendor/ocr' };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // The setup link carries the repo and token after "#", which is never sent to any server. Remove it from the
  // address bar straight away so it does not stay in history.
  const parseLink = (txt) => { try { const h2 = String(txt).includes('#') ? String(txt).slice(String(txt).indexOf('#') + 1) : String(txt); const q = new URLSearchParams(h2.replace(/^#/, '')); if (q.get('r') && q.get('t')) return { repo: q.get('r'), token: q.get('t'), api: /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(q.get('api') || '') ? q.get('api') : null }; } catch (e) {} return null; };
  let link = parseLink(location.hash);
  const stripHash = () => { if (location.hash) history.replaceState(null, '', location.pathname + location.search); };
  const mode = await P.boot(); const faceOk = await P.faceAvailable();
  const gate = h('div', { class: 'lock' }); document.body.append(gate);
  const GLYPH = '<svg class="glyph" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 17v-4.5A6.5 6.5 0 0 1 12.5 6H17M31 6h4.5A6.5 6.5 0 0 1 42 12.5V17M42 31v4.5a6.5 6.5 0 0 1-6.5 6.5H31M17 42h-4.5A6.5 6.5 0 0 1 6 35.5V31"/><path d="M17.5 19.5v4M30.5 19.5v4M24 19v8.5a1.5 1.5 0 0 1-1.5 1.5H21.5"/><path d="M17 33.2c4.2 3.4 9.8 3.4 14 0"/></svg>';
  const orb = (tag, attrs) => { const el = h(tag, Object.assign({ class: 'orb' + (tag === 'div' ? ' static' : '') }, attrs || {})); el.innerHTML = GLYPH; return el; };
  const top = () => h('div', { class: 'top' }, h('div', { class: 'logo' }, '$'), h('b', {}, 'Budget Tracker'));
  const msgEl = h('div', { class: 'msg', role: 'status' }); const say = (t, bad) => { msgEl.textContent = t || ''; msgEl.className = 'msg' + (bad ? ' err' : ''); };
  const fine = () => h('div', { class: 'fine' }, 'Your passcode is never sent anywhere. Everything stored online is encrypted; only your devices can read it.');
  const screen = (...kids) => { say(''); gate.replaceChildren(top(), h('main', {}, ...kids, msgEl), fine()); };
  const passField = (ph) => { const inp = h('input', { type: 'password', placeholder: ph || 'Passcode', autocomplete: 'current-password', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': 'Passcode' }); const eye = h('button', { class: 'eye', type: 'button', 'aria-label': 'Show passcode', onclick: () => { const sh = inp.type === 'password'; inp.type = sh ? 'text' : 'password'; eye.textContent = sh ? 'Hide' : 'Show'; inp.focus(); } }, 'Show'); return { inp, el: h('div', { class: 'field' }, inp, eye) }; };
  const enter = (el, btn) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } });

  async function done() { stripHash(); gate.remove(); await start(); }
  async function afterUnlock() { // one-time offer for Face ID after the first passcode unlock
    if (faceOk && !P.hasFace && !(await P.faceDeclined())) return offer(); return done();
  }

  function faceScreen(auto) {
    const fb = orb('button', { type: 'button', 'aria-label': 'Unlock with Face ID' }); let busy = false;
    const go = async (silent) => { if (busy) return; busy = true; fb.disabled = true; say('');
      try { await P.faceUnlock(); say('Unlocked'); await done(); }
      catch (e) { busy = false; fb.disabled = false; const n = e && e.name; if (silent && n === 'NotAllowedError') { say('Tap the icon to unlock with Face ID.'); return; } say(n === 'NotAllowedError' ? 'Face ID was cancelled or did not match. Try again, or use your passcode.' : (e && e.message) || 'Face ID failed. Use your passcode.', true); } };
    fb.addEventListener('click', () => go(false));
    screen(h('h1', {}, 'Budget is locked'), h('p', { class: 'sub' }, 'Use Face ID to open it.'), fb, h('button', { class: 'link', type: 'button', onclick: () => passScreen() }, 'Enter passcode instead'));
    if (auto) setTimeout(() => go(true), 350);
  }
  function passScreen(err) {
    const f = passField(); const btn = h('button', { class: 'cta', type: 'submit' }, 'Unlock');
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); if (!f.inp.value) return; btn.disabled = true; say('Checking...'); try { await P.unlock(f.inp.value); await afterUnlock(); } catch (er) { btn.disabled = false; say(er.message || String(er), true); f.inp.select(); } } }, f.el, btn);
    screen(h('h1', {}, 'Enter passcode'), h('p', { class: 'sub' }, 'Your data is encrypted on this phone.'), form, P.hasFace && faceOk ? h('button', { class: 'link', type: 'button', onclick: () => faceScreen(false) }, 'Use Face ID') : null);
    if (err) say(err, true); setTimeout(() => f.inp.focus(), 60);
  }
  function setupScreen(err) {
    const f = passField('Passcode'); const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const lk = h('input', { type: 'text', placeholder: 'Paste the setup link from your PC', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Setup link', value: '' });
    const btn = h('button', { class: 'cta', type: 'submit' }, 'Set up this phone');
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); const l = link || parseLink(lk.value); if (!l) { say('That is not a setup link. On your PC: Settings, Phone, Set up a phone, then Copy link.', true); return; } btn.disabled = true; say('Checking...'); try { await P.setup({ repo: l.repo, token: l.token, passcode: f.inp.value, api: l.api }); await afterUnlock(); } catch (er) { btn.disabled = false; say(er.message || String(er), true); } } },
      link ? null : h('div', { class: 'field' }, lk), f.el, btn);
    const tip = !standalone && /iPhone|iPad/.test(navigator.userAgent) ? h('p', { class: 'tip2' }, 'Tip: tap Share, then Add to Home Screen, and finish setup from the Budget icon. The Home Screen app keeps its data separately from Safari.') : null;
    screen(h('h1', {}, 'Set up this phone'), h('p', { class: 'sub' }, link ? 'Enter the passcode you chose on your PC.' : 'On your PC: Settings, Phone, Set up a phone, then Copy link. Paste it here.'), form, tip);
    if (err) say(err, true); setTimeout(() => (link ? f.inp : lk).focus(), 60);
  }
  function offer() {
    const ob = h('button', { class: 'cta', type: 'button', onclick: async () => { ob.disabled = true; say(''); try { const m = await P.faceEnroll(); say(m === 'prf' ? 'Face ID is on.' : 'Face ID is on (screen lock only on this phone).'); setTimeout(done, 900); } catch (e) { ob.disabled = false; say(e && e.name === 'NotAllowedError' ? 'Face ID was cancelled.' : 'Could not turn on Face ID: ' + ((e && e.message) || e), true); } } }, 'Turn on Face ID');
    screen(h('h1', {}, 'Unlock with Face ID'), h('p', { class: 'sub' }, 'Open Budget with a glance. You can switch this off any time in Settings.'), orb('div'), ob, h('button', { class: 'link', type: 'button', onclick: async () => { await P.declineFace(); done(); } }, 'Not now'));
  }

  async function start() {
    await BT.start(P);
    const tick = () => { if (!document.hidden) P.syncNow(); };
    setInterval(tick, 120000); window.addEventListener('online', tick); P.syncNow();
    let hiddenAt = 0; // lock after 2 minutes away
    document.addEventListener('visibilitychange', () => { if (document.hidden) hiddenAt = Date.now(); else { if (hiddenAt && Date.now() - hiddenAt > 120000) P.lock(); else tick(); hiddenAt = 0; } });
    setTimeout(() => BT.ocr.init(BT.config.ocrPath).catch(() => {}), 5000); // fetch the reader once so it works offline later
  }
  if (link || mode === 'setup') setupScreen(); else if (P.hasFace && faceOk) faceScreen(true); else passScreen();
})();
