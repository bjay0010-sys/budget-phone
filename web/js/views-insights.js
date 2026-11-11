/* Habits & trends: what the history says about how you actually spend. Blunt on purpose. */
(function (g) {
  const BT = (g.BT = g.BT || {}); BT.views = BT.views || {}; const U = BT.util; const C = BT.cats; const { h } = BT.ui; const Ch = () => BT.charts;
  const $ = (c) => U.money(c, { round: true });

  BT.views.insights = function (ctx) {
    const s = ctx.summary; const H = s.habits; const root = h('div', {});
    root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Habits and trends'), h('div', { class: 'sub' }, `Last ${H.spanDays} days to ${U.dateLabel(s.asOf)}, plus monthly history`))));
    if (!ctx.state.transactions.length) { root.append(h('div', { class: 'card empty' }, 'Add some transactions first.')); return root; }
    const card = (title, sub, ...kids) => h('div', { class: 'card' }, h('h2', {}, title), sub ? h('div', { class: 'sub' }, sub) : h('div', { style: 'height:8px' }), ...kids);

    // 1 insights
    root.append(card('What stands out', 'Ranked by how many dollars are involved.', s.insights.length ? s.insights.map((i) => h('div', { class: 'ins ' + i.level }, h('div', { class: 'bar' }), h('div', {}, h('div', { class: 't' }, i.title), h('div', { class: 'dt' }, i.detail), i.do ? h('div', { class: 'do' }, i.do) : null))) : h('div', { class: 'empty' }, 'Nothing stands out. Either you are steady or there is not enough history yet.')));

    // 2 monthly spend
    const first = s.months.findIndex((m) => m.has); const ms = s.months.slice(Math.max(0, first));
    const grid = h('div', { class: 'grid g2 mt' });
    grid.append(card('Spending by month', s.base.ok ? 'Everyday spending. The line is your usual month.' : 'Everyday spending per month.',
      Ch().columns({ items: ms.map((m) => ({ label: U.monthLabel(m.mk, true), value: m.spend, partial: m.partial })), ref: s.base.ok ? { value: s.base.total.mean, label: 'Usual' } : null, aria: 'Spending by month', catLabel: 'Month', valueLabel: 'Spending' })));
    grid.append(card('Which days you spend', 'Average spent per day of the week. The busiest day is highlighted.',
      Ch().columns({ items: [1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: U.DOW[d], value: Math.round(H.dow[d].avg) })), emphasis: true, aria: 'Average spending by day of week', catLabel: 'Day', valueLabel: 'Average spend', seriesName: 'Average per day' })));
    root.append(grid);

    // 3 category table
    const cur = s.track; const lastMk = U.addMonths(s.asOf.slice(0, 7), -1); const lm = s.idx.months[lastMk] || { byCat: {} };
    const cats = C.CATS.filter((c) => c.group === 'living').map((c) => c.id).filter((id) => (s.base.perCat[id] && s.base.perCat[id].mean > 0) || (lm.byCat[id] || 0) > 0 || ((s.idx.months[cur.month] || { byCat: {} }).byCat[id] || 0) > 0);
    const rowsC = cats.map((id) => { const b = s.base.perCat[id]; const me = (s.idx.months[cur.month] || { byCat: {} }).byCat[id] || 0; const tr = cur.ok ? cur.cats.find((x) => x.cat === id) : null; return { id, usual: b ? b.mean : 0, last: lm.byCat[id] || 0, me, st: tr ? tr.status : null, delta: tr ? tr.delta : 0 }; }).sort((a, b) => b.usual - a.usual || b.me - a.me);
    const stChip = (st) => (st === 'over' ? h('span', { class: 'chip crit' }, 'ahead') : st === 'watch' ? h('span', { class: 'chip amber' }, 'a bit ahead') : st === 'under' ? h('span', { class: 'chip good' }, 'behind') : st === 'new' ? h('span', { class: 'chip' }, 'new') : st ? h('span', { class: 'chip' }, 'on pace') : '');
    root.append(h('div', { class: 'mt' }, card('Categories', s.base.ok ? `Your usual month is the average of ${s.base.months.length} full months (${U.monthLabel(s.base.months[0], true)} to ${U.monthLabel(s.base.months[s.base.months.length - 1], true)}).` : 'Needs two full months of history to show a usual month.',
      h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Category'), h('th', { class: 'r' }, 'Usual month'), h('th', { class: 'r' }, U.monthLabel(lastMk, true)), h('th', { class: 'r' }, U.monthLabel(cur.month, true) + ' so far'), h('th', {}, 'vs usual pace'))),
        h('tbody', {}, rowsC.map((r) => h('tr', {}, h('td', {}, C.name(r.id)), h('td', { class: 'r num' }, r.usual ? $(r.usual) : ''), h('td', { class: 'r num' }, r.last ? $(r.last) : ''), h('td', { class: 'r num' }, r.me ? $(r.me) : ''), h('td', {}, stChip(r.st))))))))));

    // 4 merchants + recurring
    const g2 = h('div', { class: 'grid g2 mt' });
    const top = H.merchants.slice(0, 8);
    g2.append(card('Where the money goes', `Top merchants by total, last ${H.spanDays} days.`, top.length ? Ch().rankedBars({ items: top.map((m) => ({ label: m.name, value: m.total, sub: `${m.n} visit${m.n > 1 ? 's' : ''} · ${C.name(m.category)}` })), aria: 'Top merchants', valueLabel: 'Total' }) : h('div', { class: 'empty' }, 'No spending in this window.')));
    const rec = H.recurring.slice(0, 12); const recYear = U.sum(H.recurring.map((r) => r.perYear));
    g2.append(card('Charges that repeat', rec.length ? `${H.recurring.length} found, costing about ${$(recYear)} a year. Cancel what you do not use.` : 'Needs at least 3 charges of a similar amount at regular intervals.',
      rec.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Charge'), h('th', { class: 'r' }, 'Amount'), h('th', {}, 'Every'), h('th', { class: 'r' }, 'Per year'))),
        h('tbody', {}, rec.map((r) => h('tr', {}, h('td', {}, r.name), h('td', { class: 'r num' }, U.money(r.amount)), h('td', {}, r.every), h('td', { class: 'r num' }, $(r.perYear))))))) : null));
    root.append(g2);

    // 5 small purchases + shape
    const g3 = h('div', { class: 'grid g2 mt' });
    const sm = H.small; const smTop = Object.entries(sm.byCat).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
    g3.append(card('Small purchases', 'Purchases under $15.', h('div', { class: 'kpi' }, h('div', { class: 'value' }, `${sm.n} purchases`), h('div', { class: 'note' }, `About ${$(sm.perMonth)} a month. Average ${sm.n ? U.money(Math.round(sm.total / sm.n)) : '$0.00'} each.`)),
      smTop.length ? h('table', { class: 'tbl', style: 'margin-top:10px' }, h('tbody', {}, smTop.map(([c, v]) => h('tr', {}, h('td', {}, C.name(c)), h('td', { class: 'r num' }, `${v.n}x`), h('td', { class: 'r num' }, $(v.total)))))) : null));
    const labels = ['Days 1 to 7', 'Days 8 to 14', 'Days 15 to 21', 'Day 22 on'];
    g3.append(card('Shape of your month', 'Share of spending by part of the month. An even month is 25% each (the last part is longer).', H.monthShape.map((v, i) => h('div', { style: 'margin:10px 0' }, h('div', { class: 'row small', style: 'justify-content:space-between' }, h('span', {}, labels[i]), h('b', { class: 'num' }, Math.round(v * 100) + '%')), h('div', { class: 'meter', style: 'margin:5px 0 0' }, h('i', { style: `width:${Math.min(100, v * 100 / 0.6)}%` }))))));
    root.append(g3);

    // 6 excluded flows
    const exRows = s.months.slice(Math.max(0, first)).filter((m) => m.bookie || m.ebay || m.saving).reverse();
    root.append(h('div', { class: 'mt' }, card('Money kept out of your spending numbers', 'Bookmaker, eBay and savings are tracked here instead. Transfers between your own accounts are ignored completely.',
      exRows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Month'), h('th', { class: 'r' }, 'Bookmaker net'), h('th', { class: 'r' }, 'eBay net'), h('th', { class: 'r' }, 'Saved or invested'))),
        h('tbody', {}, exRows.map((m) => h('tr', {}, h('td', {}, U.monthLabel(m.mk) + (m.partial ? ' (so far)' : '')), h('td', { class: 'r num ' + (m.bookie > 0 ? 'pos' : m.bookie < 0 ? 'neg' : '') }, U.money(m.bookie, { round: true, sign: true })), h('td', { class: 'r num ' + (m.ebay > 0 ? 'pos' : m.ebay < 0 ? 'neg' : '') }, U.money(m.ebay, { round: true, sign: true })), h('td', { class: 'r num' }, $(m.saving))))))) : h('div', { class: 'empty' }, 'None yet.'))));
    return root;
  };
})(window);
