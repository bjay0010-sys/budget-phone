/* Add: pick screenshots and/or CSV files -> read them on this device -> review -> save.
   Nothing is saved until the person presses Save. Doubtful rows are highlighted and explained. */
(function (g) {
  const BT = (g.BT = g.BT || {}); BT.views = BT.views || {}; const U = BT.util; const C = BT.cats; const L = BT.ledger; const { h, icon } = BT.ui;

  BT.catSelect = function (val, onchange, cls) {
    const byGroup = {}; for (const c of C.CATS) (byGroup[c.group] = byGroup[c.group] || []).push(c);
    return h('select', { class: cls || '', 'aria-label': 'Category', onchange: (e) => onchange(e.target.value) },
      Object.keys(C.GROUPS).filter((k) => byGroup[k]).map((k) => h('optgroup', { label: C.GROUPS[k] }, byGroup[k].map((c) => h('option', { value: c.id, selected: c.id === val }, c.name)))));
  };

  BT.views.add = function (ctx) {
    const root = h('div', {});
    const S = { stage: 'pick', files: [], rows: [], refDate: U.today(), msg: '', progress: 0, remember: true, limit: 80, newRules: new Map(), over: false };
    const money = (c) => U.money(c);

    // -------------------------------------------------------------- reading
    async function process(fileList) {
      const files = [...fileList]; if (!files.length) return;
      S.stage = 'reading'; S.files = []; S.rows = []; S.progress = 0; draw();
      let shot = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i]; const entry = { name: f.name, kind: 'image', url: null, rows: 0, warnings: [], error: null, mapping: null };
        S.files.push(entry); S.msg = `Reading ${i + 1} of ${files.length}: ${f.name}`; S.progress = i / files.length; draw();
        try {
          const head = new Uint8Array(await f.slice(0, 600).arrayBuffer()); const fmt = BT.importers.sniff(f.name, f.type, head);
          if (fmt !== 'image') {
            // CSV, Excel, PDF, OFX/QFX, QIF, plain text: read the file itself (no picture reading unless a PDF page is a picture)
            const r = await BT.importers.readFile(f, { ref: S.refDate, isIncomeDesc: (d) => ctx.isIncomeDesc(d),
              onStatus: (m) => { S.msg = m; draw(); }, onProgress: (p) => { S.progress = (i + p) / files.length; drawProgress(); } });
            entry.kind = r.kind; entry.mapping = r.mapping && Object.keys(r.mapping).length ? r.mapping : null; entry.warnings = r.warnings || []; entry.skipped = r.skipped; if (r.error) entry.error = r.error;
            const sh = shot++; const dates = r.rows.map((x) => x.date).filter(Boolean).sort(); const fallback = dates.length ? dates[0] : S.refDate;
            for (const row of r.rows) { if (!row.date) { row.date = fallback; row.flags = (row.flags || []).concat(['date was not visible: guessed']); row.lowConf = true; } S.rows.push(mk(row, sh, i)); }
            entry.rows = r.rows.length;
          } else {
            entry.url = URL.createObjectURL(f);
            S.msg = 'Starting the screenshot reader (first time takes a few seconds)...'; draw();
            await BT.ocr.init(BT.config.ocrPath);
            S.msg = `Reading ${i + 1} of ${files.length}: ${f.name}`; draw();
            const r = await BT.ocr.readScreenshot(f, { ref: S.refDate, isIncomeDesc: (d) => ctx.isIncomeDesc(d) }, (p) => { S.progress = (i + p) / files.length; drawProgress(); });
            entry.warnings = r.warnings; const base = shot; shot += 10;
            const dates = r.rows.map((x) => x.date).filter(Boolean); const fallback = dates.length ? dates.sort()[0] : S.refDate;
            for (const row of r.rows) { if (!row.date) { row.date = fallback; row.flags = (row.flags || []).concat(['date was not visible: guessed']); row.lowConf = true; } S.rows.push(mk(row, base + (row.strip || 0), i)); }
            entry.rows = r.rows.length;
          }
        } catch (e) { console.error(e); entry.error = 'Could not read this file: ' + (e.message || e); }
      }
      S.progress = 1; recompute(true); S.stage = 'review'; draw();
    }

    function mk(row, shot, file) {
      return { rid: U.uid(), shot, file, date: row.date, desc: row.desc, amount: row.amount, pending: !!row.pending, flags: row.flags || [], lowConf: !!row.lowConf, signSource: row.signSource, kind: row.kind, include: true, catManual: null, category: 'uncat', dup: false, force: false };
    }

    function recompute(first) {
      for (const r of S.rows) if (!r.catManual) r.category = C.categorise(r.desc, r.amount, ctx.rules).category;
      L.planMerge(ctx.state.transactions, S.rows);
      if (first) for (const r of S.rows) r.include = !r.dup && !r.pending;
      else for (const r of S.rows) { if (r.dup && !r.force) r.include = false; }
    }

    // -------------------------------------------------------------- drawing
    function drawProgress() { const p = root.querySelector('.prog > i'); if (p) p.style.width = Math.round(S.progress * 100) + '%'; }

    function pasteCard() {
      const ta = h('textarea', { rows: 4, placeholder: 'Paste transactions here, one per line, e.g.\n12 Nov 2026  Woolworths Officer  -$42.35\nor rows copied from a spreadsheet or your bank\'s website', style: 'width:100%;font:inherit;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:inherit;resize:vertical' });
      return h('div', { class: 'card' }, h('h2', {}, 'Or paste text'), h('div', { class: 'sub' }, 'Copied from a web page, an email or a spreadsheet.'), ta,
        h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn sm', onclick: () => { const t = ta.value.trim(); if (!t) return; process([new File([t], 'pasted text.txt', { type: 'text/plain' })]); } }, 'Read pasted text')));
    }

    function pick() {
      const input = h('input', { type: 'file', multiple: true, accept: 'image/*,.pdf,application/pdf,.csv,.tsv,.txt,.xlsx,.ofx,.qfx,.qif,text/*', class: 'hide', onchange: (e) => process(e.target.files) });
      const dz = h('div', { class: 'drop' + (S.over ? ' over' : ''), tabindex: 0, role: 'button', 'aria-label': 'Choose screenshots or statement files',
        onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); },
        ondragover: (e) => { e.preventDefault(); dz.classList.add('over'); }, ondragleave: () => dz.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); process(e.dataTransfer.files); } },
        icon('add'), h('div', { class: 'big' }, BT.config.mode === 'phone' ? 'Choose screenshots or files' : 'Drop screenshots or statement files here'), h('div', { class: 'ink2 small' }, BT.config.mode === 'phone' ? 'Photos, or PDF / CSV / Excel files from the Files app. Read on this phone, never uploaded.' : 'Screenshots, PDF, CSV, Excel, OFX/QFX, QIF or text. Several at once is fine. Everything is read on this computer.'), input);
      const date = h('input', { type: 'date', value: S.refDate, onchange: (e) => { S.refDate = e.target.value || U.today(); } });
      return h('div', { class: 'stack' }, dz,
        h('div', { class: 'card' }, h('div', { class: 'row wrap' }, h('label', { class: 'field', style: 'max-width:240px' }, 'Screenshots were taken on', date), h('div', { class: 'small ink2 grow', style: 'min-width:220px' }, 'Only matters when the app shows "Today" or "Yesterday" instead of a date.'))),
        pasteCard(),
        h('div', { class: 'card' }, h('h2', {}, 'Tips for accurate reading'), h('ul', { class: 'ink2 small', style: 'margin:8px 0 0;padding-left:18px' },
          h('li', {}, 'For history, use a statement file from ubank (CSV, PDF, Excel or OFX). They are read exactly, whereas a screenshot can be misread.'),
          h('li', {}, 'PDFs with real text are read exactly. A PDF that is only a picture goes through the screenshot reader, so check those more carefully.'),
          h('li', {}, 'Screenshots: scroll so that dates and amounts are both visible, and overlap them a little. Overlaps are detected, not double counted.'),
          h('li', {}, 'Full brightness and no banners over the list gives the best result. Dark mode works.'))));
    }

    function reading() {
      return h('div', { class: 'card' }, h('h2', {}, 'Reading'), h('p', { class: 'ink2', style: 'margin:6px 0 12px' }, h('span', { class: 'spin' }), '  ', S.msg), h('div', { class: 'prog' }, h('i', { style: `width:${Math.round(S.progress * 100)}%` })),
        h('p', { class: 'tiny muted', style: 'margin-top:10px' }, 'This happens on this device. Nothing is sent anywhere.'));
    }

    function rowEl(r) {
      const flagged = r.lowConf || r.flags.length || r.dup;
      const amtIn = h('input', { type: 'text', inputmode: 'decimal', value: (r.amount / 100).toFixed(2), 'aria-label': 'Amount (negative is spending)', class: 'num', onchange: (e) => { const c = U.toCents(e.target.value); if (c != null) { r.amount = c; r.flags = r.flags.filter((x) => !/sign|minus|direction|digits/.test(x)); r.lowConf = false; recompute(); draw(); } } });
      const why = r.dup ? `${r.dupReason === 'already saved' ? 'Already saved' : 'Also appears in another screenshot'}. Tick the box to add it anyway.` : [...(r.pending ? ['Pending: not final yet, so not included'] : []), ...r.flags].join(' · ');
      return h('div', { class: 'rv-row' + (flagged && !r.dup ? ' flag' : '') + (r.dup ? ' dup' : '') },
        h('div', { class: 'c1' }, h('input', { type: 'checkbox', checked: r.include, 'aria-label': 'Include', onchange: (e) => { r.include = e.target.checked; if (r.dup) r.force = r.include; if (r.pending) { /* user override */ } draw(true); } })),
        h('div', { class: 'c2' }, h('input', { type: 'date', value: r.date, 'aria-label': 'Date', onchange: (e) => { if (U.validISO(e.target.value)) { r.date = e.target.value; r.flags = r.flags.filter((x) => !/date/.test(x)); recompute(); draw(); } } })),
        h('div', { class: 'c3' }, h('input', { type: 'text', value: r.desc, 'aria-label': 'Description', onchange: (e) => { r.desc = e.target.value.trim() || r.desc; recompute(); draw(); } })),
        h('div', { class: 'c4 row', style: 'gap:4px' }, amtIn, h('button', { class: 'btn sm', title: 'Flip between money out and money in', 'aria-label': 'Flip sign', onclick: () => { r.amount = -r.amount; r.flags = r.flags.filter((x) => !/sign|minus|direction/.test(x)); recompute(); draw(); } }, '±')),
        h('div', { class: 'c5' }, BT.catSelect(r.category, (v) => { r.catManual = v; r.category = v; const k = C.merchantKey(r.desc); if (k) S.newRules.set(k, v); draw(true); })),
        why ? h('div', { class: 'why' }, why) : null);
    }

    function merchantGroups() {
      const m = new Map();
      for (const r of S.rows) { if (!r.include || r.category !== 'uncat') continue; const k = C.merchantKey(r.desc) || r.desc.toLowerCase(); let o = m.get(k); if (!o) m.set(k, (o = { key: k, name: C.prettyName(r.desc), n: 0, total: 0, rows: [] })); o.n++; o.total += r.amount; o.rows.push(r); }
      return [...m.values()].sort((a, b) => b.n - a.n || a.total - b.total);
    }

    function review() {
      const inc = S.rows.filter((r) => r.include); const dups = S.rows.filter((r) => r.dup && !r.force); const pend = S.rows.filter((r) => r.pending);
      const flagged = S.rows.filter((r) => !r.dup && (r.lowConf || r.flags.length) && !r.pending);
      const groups = merchantGroups();
      const out = h('div', { class: 'stack' });
      // files summary
      out.append(h('div', { class: 'card' }, h('div', { class: 'row wrap', style: 'justify-content:space-between' }, h('h2', {}, 'Check before saving'), h('button', { class: 'btn sm', onclick: () => { S.stage = 'pick'; draw(); } }, 'Start over')),
        h('div', { class: 'small ink2', style: 'margin:6px 0 10px' }, `${S.rows.length} transactions read. ${inc.length} will be added, ${dups.length} look like duplicates and are skipped${pend.length ? `, ${pend.length} pending are left out` : ''}.`),
        S.files.map((f) => h('div', { class: 'small', style: 'margin:4px 0' },
          h('b', {}, f.name), f.error ? h('span', { class: 'chip crit', style: 'margin-left:8px' }, f.error) : h('span', { class: 'muted' }, `  ${f.rows} rows`),
          f.mapping ? h('div', { class: 'tiny muted' }, 'Columns used: ' + Object.entries(f.mapping).map(([k, v]) => `${k} = ${v}`).join(', ') + (f.skipped ? `. ${f.skipped} non-transaction lines skipped.` : '')) : null,
          f.warnings.map((w) => h('div', { class: 'tiny', style: 'color:var(--amber-ink)' }, w)))),
        S.files.some((f) => f.url) ? h('div', { class: 'row wrap', style: 'margin-top:10px' }, S.files.filter((f) => f.url).map((f) => h('img', { src: f.url, alt: 'Screenshot ' + f.name, style: 'height:84px;border-radius:8px;border:1px solid var(--border);cursor:zoom-in', onclick: () => BT.ui.modal((box) => { box.style.width = 'min(560px,100%)'; box.append(h('img', { src: f.url, alt: f.name, style: 'width:100%;border-radius:10px' })); }) }))) : null));

      if (groups.length) out.append(h('div', { class: 'card' }, h('h2', {}, `${groups.length} merchant${groups.length > 1 ? 's' : ''} the app does not recognise`), h('div', { class: 'sub' }, 'Choose once per merchant. It is remembered for next time and applied to every matching row.'),
        groups.slice(0, 14).map((gr) => h('div', { class: 'row', style: 'padding:6px 0;border-bottom:1px solid var(--grid)' }, h('div', { class: 'grow' }, h('div', { style: 'font-weight:600' }, gr.name), h('div', { class: 'tiny muted' }, `${gr.n} transaction${gr.n > 1 ? 's' : ''}, ${money(gr.total)}`)),
          h('div', { style: 'width:180px' }, BT.catSelect('uncat', (v) => { for (const r of gr.rows) { r.catManual = v; r.category = v; } S.newRules.set(gr.key, v); draw(true); })))),
        groups.length > 14 ? h('div', { class: 'tiny muted', style: 'margin-top:8px' }, `${groups.length - 14} more are in the list below, or you can fix them later in Transactions.`) : null));

      if (flagged.length) out.append(h('div', { class: 'card' }, h('h2', {}, `${flagged.length} row${flagged.length > 1 ? 's' : ''} to double check`), h('div', { class: 'sub' }, 'The reader was unsure. Compare with your screenshot, especially the amount and whether it is money in or out.'), flagged.slice(0, 60).map(rowEl)));

      const rest = S.rows.filter((r) => !flagged.includes(r));
      out.append(h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', {}, flagged.length ? 'Everything else' : 'All transactions'), h('span', { class: 'chip' }, rest.length + ' rows')),
        rest.length ? [h('div', { style: 'margin-top:6px' }, rest.slice(0, S.limit).map(rowEl)), rest.length > S.limit ? h('button', { class: 'btn sm', style: 'margin-top:10px', onclick: () => { S.limit += 120; draw(true); } }, `Show ${Math.min(120, rest.length - S.limit)} more`) : null] : h('div', { class: 'empty' }, 'Nothing else.')));

      const remember = h('input', { type: 'checkbox', checked: S.remember, id: 'rem', onchange: (e) => { S.remember = e.target.checked; } });
      out.append(h('div', { class: 'sticky-bar' }, h('div', {}, h('b', {}, `${inc.length} to add`), h('span', { class: 'ink2 small' }, `  ·  net ${U.money(U.sum(inc.map((r) => r.amount)))}`)),
        h('div', { class: 'row wrap' }, S.newRules.size ? h('label', { class: 'row small ink2', for: 'rem' }, remember, `Remember ${S.newRules.size} category choice${S.newRules.size > 1 ? 's' : ''}`) : null,
          h('button', { class: 'btn primary', disabled: !inc.length, onclick: save }, icon('check'), `Save ${inc.length}`))));
      return out;
    }

    async function save() {
      const rows = S.rows.filter((r) => r.include);
      const ops = [];
      if (S.remember) for (const [k, v] of S.newRules) ops.push({ type: 'rule', opId: U.uid(), pattern: k, category: v });
      ops.push({ type: 'add', opId: U.uid(), rows: rows.map((r) => ({ id: U.uid(), date: r.date, desc: r.desc, amount: r.amount, category: r.catManual || undefined, force: r.force || undefined, shot: r.shot })) });
      try {
        const res = await ctx.ops(ops); const add = (res.results || []).find((x) => x && x.added != null);
        const n = add ? add.added : rows.length;
        BT.ui.toast(res.queued ? `Saved ${n} on this phone. Sending to your PC when online.` : `Added ${n} transaction${n === 1 ? '' : 's'}${add && add.skipped ? `, ${add.skipped} duplicates skipped` : ''}.`);
        ctx.nav('home');
      } catch (e) { BT.ui.toast('Could not save: ' + (e.message || e)); }
    }

    function draw(keepScroll) {
      const y = window.scrollY; root.replaceChildren(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Add transactions'), h('div', { class: 'sub' }, 'Screenshots or CSV statements. You check everything before it is saved.'))), S.stage === 'pick' ? pick() : S.stage === 'reading' ? reading() : review());
      if (keepScroll) window.scrollTo(0, y);
    }
    draw();
    BT._addDebug = { S, process, recompute, draw };
    return root;
  };
})(window);
