/* Transactions: browse, search, recategorise (and teach the app), edit, add by hand, export. */
(function (g) {
  const BT = (g.BT = g.BT || {}); BT.views = BT.views || {}; const U = BT.util; const C = BT.cats; const { h, icon, toast } = BT.ui;

  const KINDS = [['all', 'Everything'], ['living', 'Everyday spending'], ['income', 'Income'], ['bookie', 'Bookmaker'], ['ebay', 'eBay'], ['transfer', 'Own transfers'], ['saving', 'Savings'], ['need', 'Needs a category']];

  BT.views.txns = function (ctx) {
    const F = Object.assign({ month: 'all', kind: 'all', q: '', need: false }, BT.txnFilter || {}); if (F.need) { F.kind = 'need'; } BT.txnFilter = null;
    let limit = 120; const root = h('div', {}); const listBox = h('div', { class: 'card' }); const countEl = h('span', { class: 'muted small' });

    const months = [...new Set(ctx.state.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse();
    const filtered = () => {
      const q = F.q.trim().toLowerCase();
      return ctx.state.transactions.filter((t) => (F.month === 'all' || t.date.startsWith(F.month)) && (F.kind === 'all' || (F.kind === 'need' ? t.category === 'uncat' : C.group(t.category) === F.kind)) && (!q || t.desc.toLowerCase().includes(q) || C.name(t.category).toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q)))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
    };

    async function setCategory(t, v) {
      await ctx.ops([{ type: 'update', opId: U.uid(), id: t.id, patch: { category: v } }]);
      const k = C.merchantKey(t.desc);
      const same = k ? ctx.state.transactions.filter((x) => x.id !== t.id && C.merchantKey(x.desc) === k && x.category !== v).length : 0;
      drawList();
      if (k && same > 0) toast(`${same} other "${C.prettyName(t.desc)}" transaction${same > 1 ? 's' : ''} use a different category.`, { label: 'Apply to all', fn: async () => { await ctx.ops([{ type: 'rule', opId: U.uid(), pattern: k, category: v }]); drawList(); toast('Done. Future ones will be sorted automatically.'); } });
      else if (k) { await ctx.ops([{ type: 'rule', opId: U.uid(), pattern: k, category: v }]); }
    }

    function editModal(t) {
      const isNew = !t; const d = t || { date: ctx.summary.asOf || U.today(), desc: '', amount: -1000, category: 'uncat', note: '' };
      BT.ui.modal((box, close) => {
        const date = h('input', { type: 'date', value: d.date }); const desc = h('input', { type: 'text', value: d.desc, placeholder: 'e.g. Coles' }); const amt = h('input', { type: 'text', inputmode: 'decimal', value: (d.amount / 100).toFixed(2) });
        let cat = d.category; const note = h('textarea', { placeholder: 'Optional note' }, d.note || '');
        box.append(h('h2', {}, isNew ? 'Add a transaction' : 'Edit transaction'), h('div', { class: 'stack', style: 'margin-top:12px' },
          h('label', { class: 'field' }, 'Date', date), h('label', { class: 'field' }, 'Description', desc), h('label', { class: 'field' }, 'Amount (negative = money out)', amt),
          h('label', { class: 'field' }, 'Category', BT.catSelect(cat, (v) => { cat = v; })), h('label', { class: 'field' }, 'Note', note),
          h('div', { class: 'row', style: 'justify-content:space-between' }, !isNew ? h('button', { class: 'btn danger', onclick: async () => { if (await BT.ui.confirmBox('Delete this transaction?', `${t.desc}, ${U.money(t.amount)} on ${t.date}.`, 'Delete', true)) { close(); await ctx.ops([{ type: 'delete', opId: U.uid(), id: t.id }]); drawList(); toast('Deleted'); } } }, icon('trash'), 'Delete') : h('span'),
            h('div', { class: 'row' }, h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
              const cents = U.toCents(amt.value); if (!U.validISO(date.value) || !desc.value.trim() || cents == null) { toast('Check the date, description and amount.'); return; }
              close();
              if (isNew) await ctx.ops([{ type: 'add', opId: U.uid(), rows: [{ id: U.uid(), date: date.value, desc: desc.value.trim(), amount: cents, category: cat === 'uncat' ? undefined : cat, force: true, note: note.value }] }]);
              else await ctx.ops([{ type: 'update', opId: U.uid(), id: t.id, patch: { date: date.value, desc: desc.value.trim(), amount: cents, category: cat, note: note.value } }]);
              drawList(); toast('Saved');
            } }, 'Save')))));
      });
    }

    function drawList() {
      const rows = filtered(); countEl.textContent = `${rows.length.toLocaleString()} transaction${rows.length === 1 ? '' : 's'}`;
      const sum = U.sum(rows.filter((t) => C.group(t.category) === 'living').map((t) => -t.amount));
      listBox.replaceChildren();
      if (!rows.length) { listBox.append(h('div', { class: 'empty' }, ctx.state.transactions.length ? 'Nothing matches these filters.' : 'No transactions yet. Use Add to bring some in.')); return; }
      if (F.kind === 'all' || F.kind === 'living') listBox.append(h('div', { class: 'small ink2', style: 'margin-bottom:4px' }, `Everyday spending in this view: ${U.money(sum)}`));
      let lastDay = '';
      for (const t of rows.slice(0, limit)) {
        if (t.date !== lastDay) { lastDay = t.date; listBox.append(h('div', { class: 'daydiv' }, U.dateLabel(t.date) + ' ' + t.date.slice(0, 4))); }
        const grp = C.group(t.category);
        listBox.append(h('div', { class: 'tx' }, h('div', { class: 'd', title: t.desc, onclick: () => editModal(t), style: 'cursor:pointer' }, t.desc), h('div', { class: 'a num ' + (t.amount > 0 ? 'pos' : '') }, U.money(t.amount, { sign: t.amount > 0 })),
          h('div', { class: 'm' }, BT.catSelect(t.category, (v) => setCategory(t, v)), grp !== 'living' && grp !== 'income' ? h('span', { class: 'chip' }, 'not counted as spending') : null, t.category === 'uncat' ? h('span', { class: 'chip amber' }, 'needs a category') : null, t.note ? h('span', { title: t.note }, '· note') : null, h('button', { class: 'btn sm', style: 'margin-left:auto', onclick: () => editModal(t), 'aria-label': 'Edit transaction' }, 'Edit'))));
      }
      if (rows.length > limit) listBox.append(h('button', { class: 'btn', style: 'margin-top:12px', onclick: () => { limit += 150; drawList(); } }, `Show ${Math.min(150, rows.length - limit)} more`));
    }
    const debounced = BT.ui.debounce(() => { limit = 120; drawList(); }, 180);

    const monthSel = h('select', { 'aria-label': 'Month', onchange: (e) => { F.month = e.target.value; limit = 120; drawList(); } }, h('option', { value: 'all' }, 'All months'), months.map((m) => h('option', { value: m, selected: F.month === m }, U.monthLabel(m))));
    const kindSel = h('select', { 'aria-label': 'Type', onchange: (e) => { F.kind = e.target.value; limit = 120; drawList(); } }, KINDS.map(([v, l]) => h('option', { value: v, selected: F.kind === v }, l)));
    const search = h('input', { type: 'search', placeholder: 'Search merchant, category or note', value: F.q, 'aria-label': 'Search', oninput: (e) => { F.q = e.target.value; debounced(); } });
    root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Transactions'), h('div', { class: 'sub' }, countEl)),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => editModal(null) }, icon('add'), 'Add by hand'), h('button', { class: 'btn', onclick: () => { const rows = filtered(); BT.ui.download('transactions.csv', 'Date,Description,Amount,Category,Note\n' + rows.map((t) => [t.date, '"' + t.desc.replace(/"/g, '""') + '"', (t.amount / 100).toFixed(2), '"' + C.name(t.category) + '"', '"' + (t.note || '').replace(/"/g, '""') + '"'].join(',')).join('\n'), 'text/csv'); } }, icon('file'), 'Export CSV'))),
      h('div', { class: 'row wrap', style: 'margin-bottom:12px' }, h('div', { style: 'flex:1;min-width:200px' }, search), h('div', { style: 'width:160px' }, monthSel), h('div', { style: 'width:190px' }, kindSel)), listBox);
    drawList(); return root;
  };
})(window);
