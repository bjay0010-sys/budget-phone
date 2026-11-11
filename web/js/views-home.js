/* Home: am I on track this month, measured against your own history. */
(function (g) {
  const BT = (g.BT = g.BT || {}); BT.views = BT.views || {}; const U = BT.util; const C = BT.cats; const { h, icon } = BT.ui; const F = () => BT.fmt;

  const VERDICT = {
    on: ['check', 'On track'], under: ['check', 'Under your usual pace'], watch: ['alert', 'Slightly ahead of pace'], over: ['alert', 'Ahead of your usual pace'],
  };

  function staleBanner(ctx, s) {
    if (s.staleDays != null && s.staleDays >= 3) return h('div', { class: 'banner mt', role: 'alert' }, icon('alert'), h('div', {}, h('b', {}, `Your latest transaction is ${s.staleDays} days old. `), 'Everything below is as of ' + U.dateLabel(s.asOf) + ', so recent spending is missing. ', h('a', { href: '#/add' }, 'Add a screenshot')));
    return null;
  }

  function onboarding(ctx) {
    return h('div', { class: 'card' }, h('h2', {}, 'Start with your history'),
      h('p', { class: 'ink2', style: 'margin:6px 0 12px' }, 'The app judges this month against your own past months, so it needs a few months of transactions first. The fastest, most accurate way is the CSV statement from ubank (app: account, settings icon, Statements, CSV). Drop several in at once.'),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: () => ctx.nav('add') }, icon('add'), 'Add CSV history or screenshots')));
  }

  function hero(ctx, s) {
    const t = s.track; const m = BT.fmt;
    if (!t.ok) {
      const have = s.base.months.length;
      return h('div', { class: 'card' }, h('h2', {}, 'Not enough history to judge your pace yet'),
        h('p', { class: 'ink2', style: 'margin:6px 0 10px' }, `Spent so far in ${U.monthLabel(t.month)}: ${m.mr(t.spent)}. To say whether that is on track, the app needs at least 2 full past months (you have ${have}).`),
        s.base.notes.length ? h('p', { class: 'muted small' }, s.base.notes.join(' ')) : null,
        h('button', { class: 'btn primary', style: 'margin-top:10px', onclick: () => ctx.nav('add') }, icon('add'), 'Import more history'));
    }
    const [ic, label] = VERDICT[t.status]; const pct = t.pct;
    const monthTotal = Math.max(t.usual, 1); const fill = Math.min(1.3, t.spent / monthTotal); const tick = Math.min(1.3, t.expected / monthTotal); const scale = 1.3;
    const word = t.delta >= 0 ? 'above' : 'below';
    const left = h('div', {},
      h('span', { class: 'verdict ' + t.status }, icon(ic), label),
      h('div', { class: 'figure' }, m.mr(t.spent), h('small', {}, `  spent by day ${t.day}`)),
      h('p', { class: 'ink2' }, `Usual by now: ${m.mr(t.expected)} (past months ranged ${m.mr(t.range[0])} to ${m.mr(t.range[1])}). `, h('b', {}, `${m.mr(Math.abs(t.delta))}${pct != null ? ` (${Math.abs(Math.round(pct * 100))}%)` : ''} ${word}.`)),
      h('div', { class: 'meter', role: 'img', 'aria-label': `Spent ${m.mr(t.spent)} of a usual month of ${m.mr(t.usual)}` }, h('i', { class: t.status === 'over' ? 'over' : t.status === 'watch' ? 'watch' : '', style: `width:${(fill / scale) * 100}%` }), h('b', { style: `left:${(tick / scale) * 100}%`, title: 'Where you usually are by today' })),
      h('p', { class: 'small ink2' }, `On pace for ${m.mr(t.projected)} this month, if the rest goes as usual. A usual month is ${m.mr(t.usual)}.`),
      s.base.notes.length ? h('p', { class: 'tiny muted', style: 'margin-top:6px' }, s.base.notes.join(' ')) : null);
    const days = t.daysInMonth; const day = t.day; const cur = []; { const idx = s.idx.months[t.month]; let acc = 0; const daily = new Array(days).fill(0); if (idx) for (const a of Object.values(idx.catDaily)) for (let i = 0; i < a.length; i++) daily[i] += a[i]; for (let d = 0; d < days; d++) { acc += daily[d]; cur.push(acc); } }
    const chart = BT.charts.cumulativeChart({ days, day, current: cur, usual: s.base.cumTotal.slice(0, days), range: s.base.cumRange.slice(0, days), monthLabel: U.monthLabel(t.month, true) });
    return h('div', { class: 'card hero' }, left, chart);
  }

  function kpis(ctx, s) {
    const t = s.track; const m = BT.fmt; const cur = s.idx.months[t.month] || { income: 0, bookie: 0, ebay: 0 }; const hb = s.habits;
    const sign = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
    const tile = (label, value, note, cls) => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value ' + (cls || '') }, value), h('div', { class: 'note' }, note));
    const sr = hb.savings && hb.savings.rate != null ? hb.savings.rate : null;
    return h('div', { class: 'grid g4 mt' },
      tile('Income this month', m.mr(cur.income), 'Pay and other money in', ''),
      tile('Savings rate', sr == null ? 'n/a' : Math.round(sr * 100) + '%', sr == null ? 'Needs 2 full months with income' : `Average of the last ${hb.savings.months} full months`, sr != null ? sign(sr) : ''),
      tile('Bookmaker net', U.money(cur.bookie, { round: true, sign: true }), 'This month. Not counted as spending', sign(cur.bookie)),
      tile('eBay net', U.money(cur.ebay, { round: true, sign: true }), 'Sales minus stock, fees, postage', sign(cur.ebay)));
  }

  function variance(ctx, s) {
    const t = s.track;
    if (!t.ok) {
      const items = Object.entries((s.idx.months[t.month] || { byCat: {} }).byCat).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, v]) => ({ label: C.name(c), value: v }));
      return h('div', { class: 'card' }, h('h2', {}, `Where ${U.monthLabel(t.month, true)} is going`), h('div', { class: 'sub' }, 'Spending so far by category'), items.length ? BT.charts.rankedBars({ items, aria: 'Spending by category this month', valueLabel: 'Spent' }) : h('div', { class: 'empty' }, 'No spending yet this month.'));
    }
    const items = t.cats.filter((c) => Math.abs(c.delta) >= 500).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8).map((c) => ({ label: C.name(c.cat), delta: c.delta, spent: c.spent, expected: c.expected }));
    return h('div', { class: 'card' }, h('h2', {}, 'Where you are ahead or behind'), h('div', { class: 'sub' }, `Each category against where you usually are by day ${t.day}`),
      items.length ? BT.charts.divergingBars({ items }) : h('div', { class: 'empty' }, 'Every category is within a few dollars of your usual pace.'));
  }

  function attention(ctx, s) {
    const top = s.insights.slice(0, 3);
    return h('div', { class: 'card' }, h('h2', {}, 'Worth your attention'), h('div', { class: 'sub' }, 'Ranked by dollars'),
      top.length ? top.map((i) => h('div', { class: 'ins ' + i.level }, h('div', { class: 'bar' }), h('div', {}, h('div', { class: 't' }, i.title), h('div', { class: 'dt' }, i.detail), i.do ? h('div', { class: 'do' }, i.do) : null))) : h('div', { class: 'empty' }, 'Nothing stands out yet. Add more history.'),
      h('a', { href: '#/insights', class: 'small', style: 'display:inline-block;margin-top:8px' }, 'All habits and trends'));
  }

  function review(ctx, s) {
    const wk = U.weekStart(s.asOf); const saved = (ctx.state.reviews || {})[wk] || '';
    const ta = h('textarea', { placeholder: 'What did you learn this week? What will you do differently?', 'aria-label': 'Weekly review notes' }, saved);
    return h('div', { class: 'card' }, h('h2', {}, 'Weekly review'), h('div', { class: 'sub' }, 'The app asks. You answer, in your own words. Notes are saved for the week starting ' + U.dateLabel(wk) + '.'),
      h('ul', { style: 'margin:0 0 12px;padding-left:18px' }, s.prompts.map((p) => h('li', { style: 'margin:4px 0' }, p))), ta,
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: async () => { await ctx.backend.saveReview(wk, ta.value); await ctx.load(); BT.ui.toast('Saved'); } }, 'Save notes')));
  }

  BT.views.home = function (ctx) {
    const s = ctx.summary; const root = h('div', {}); const name = ctx.settings.name;
    root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, name ? `Hi ${name}` : 'Home'), h('div', { class: 'sub' }, s.idx.last ? `${U.monthLabel(s.asOf.slice(0, 7))} · data through ${U.dateLabel(s.asOf)}` : 'No transactions yet')),
      h('button', { class: 'btn primary', onclick: () => ctx.nav('add') }, icon('add'), 'Add transactions')));
    if (!ctx.state.transactions.length) { root.append(onboarding(ctx)); return root; }
    const sb = staleBanner(ctx, s); if (sb) root.append(sb);
    const uncat = ctx.state.transactions.filter((t) => t.category === 'uncat').length;
    if (uncat) root.append(h('div', { class: 'banner info mt' }, icon('info'), h('div', {}, `${uncat} transaction${uncat > 1 ? 's' : ''} ${uncat > 1 ? 'still need a category. Until they have one they count' : 'still needs a category. Until it has one it counts'} as everyday spending. `, h('a', { href: '#/txns?need=1', onclick: () => { BT.txnFilter = { need: true }; } }, 'Sort them out'))));
    root.append(h('div', { class: 'mt' }, hero(ctx, s)), kpis(ctx, s), h('div', { class: 'grid g21 mt' }, variance(ctx, s), attention(ctx, s)), h('div', { class: 'mt' }, review(ctx, s)));
    return root;
  };
})(window);
