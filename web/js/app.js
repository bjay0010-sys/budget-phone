/* App shell: state, routing, theme. Views live in views-*.js and are given a shared context.
   The same code runs on the PC (backend = local server) and on the phone (backend = encrypted local copy + sync). */
(function (g) {
  const BT = (g.BT = g.BT || {}); const U = BT.util; const { h, icon, toast } = BT.ui;
  BT.views = BT.views || {};

  const DEFAULT_SETTINGS = { name: '', savingsGoalPct: 10, baselineMonths: 6, pagesUrl: '' };
  const ROUTES = [['home', 'Home', 'home'], ['add', 'Add', 'add'], ['txns', 'Transactions', 'list'], ['insights', 'Habits', 'chart'], ['settings', 'Settings', 'gear']];

  const ctx = {
    backend: null, state: null, rev: 0, _sumRev: -1, _sum: null, route: 'home', main: null,
    get summary() { if (this._sumRev !== this.rev) { this._sum = BT.an.summarise(this.state.transactions, { settings: this.settings }); this._sumRev = this.rev; } return this._sum; },
    get settings() { return Object.assign({}, DEFAULT_SETTINGS, this.state ? this.state.settings : {}); },
    get rules() { return this.state ? this.state.rules : []; },
    isIncomeDesc(d) { const c = BT.cats.categorise(d, -1, this.rules); return BT.cats.group(c.category) === 'income'; },
    async load() { this.state = await this.backend.load(); this.rev++; },
    /** Apply ops on the backend, then refresh. */
    async ops(ops) { const r = await this.backend.ops(ops); await this.load(); return r; },
    async saveSettings(patch) { await this.backend.saveSettings(patch); await this.load(); },
    nav(r) { if (location.hash !== '#/' + r) location.hash = '#/' + r; else this.render(); },
    toast,
  };
  BT.ctx = ctx;

  // Look preferences are per device (saved in this browser): theme, text size, density.
  function applyTheme() {
    const t = localStorage.getItem('bt-theme') || 'auto'; const el = document.documentElement;
    if (t === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', t);
    const fs = parseFloat(localStorage.getItem('bt-fs')) || 1; el.style.zoom = fs === 1 ? '' : String(fs);
    if (localStorage.getItem('bt-dens') === 'compact') el.setAttribute('data-density', 'compact'); else el.removeAttribute('data-density');
  }
  BT.setTheme = (t) => { localStorage.setItem('bt-theme', t); applyTheme(); ctx.render(); };
  BT.setLook = (key, val) => { localStorage.setItem(key, val); applyTheme(); ctx.render(); };
  BT.applyLook = applyTheme;

  ctx.render = function () {
    const r = (location.hash.replace(/^#\//, '') || 'home').split('?')[0]; const route = ROUTES.some((x) => x[0] === r) ? r : 'home'; ctx.route = route;
    document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('on', a.dataset.route === route));
    ctx.main.replaceChildren(); window.scrollTo(0, 0);
    try { ctx.main.append(BT.views[route](ctx)); } catch (e) { console.error(e); ctx.main.append(h('div', { class: 'card' }, h('h2', {}, 'Something went wrong drawing this page'), h('p', { class: 'muted small' }, String(e && e.message || e)))); }
  };

  BT.start = async function (backend) {
    ctx.backend = backend; applyTheme();
    const root = document.getElementById('app'); root.replaceChildren();
    const nav = h('nav', { class: 'nav' }, ROUTES.map(([id, label, ic]) => h('a', { 'data-route': id, onclick: () => ctx.nav(id), role: 'link', tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter') ctx.nav(id); } }, icon(ic), label)));
    const side = h('aside', { class: 'side' }, h('div', { class: 'brand' }, h('div', { class: 'logo' }, '$'), h('div', {}, h('b', {}, 'Budget ', h('span', {}, 'Tracker')), h('small', {}, 'Personal finance'))), nav, h('div', { class: 'foot muted tiny', id: 'syncfoot' }));
    ctx.main = h('main', { id: 'main' });
    const tabs = h('nav', { class: 'tabbar' }, ROUTES.map(([id, label, ic]) => h('a', { 'data-route': id, onclick: () => ctx.nav(id) }, icon(ic), label)));
    root.append(side, ctx.main, tabs);
    try { await ctx.load(); } catch (e) { ctx.main.append(h('div', { class: 'card' }, h('h2', {}, 'Could not load your data'), h('p', { class: 'muted' }, String(e.message || e)))); return; }
    window.addEventListener('hashchange', () => ctx.render());
    // changes made behind our back (e.g. phone uploads applied by the sync loop): never redraw a page you may be editing
    if (backend.onChange) backend.onChange(async () => { await ctx.load(); if (ctx.route === 'home' || ctx.route === 'insights') ctx.render(); else if (ctx.route === 'txns') toast('New transactions arrived.', { label: 'Refresh', fn: () => ctx.render() }); });
    ctx.render();
  };

  // shared formatting helpers for views
  BT.fmt = { m: (c, o) => U.money(c, o), mr: (c) => U.money(c, { round: true }), pct: (x) => (x == null ? '' : (x >= 0 ? '+' : '') + Math.round(x * 100) + '%') };
})(window);
