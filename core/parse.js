/* Turn OCR text from a banking-app screenshot into transactions.
   Written to be layout-tolerant (the exact uBank layout isn't known yet), and to be honest about doubt:
   every row carries flags (lowConf / signGuess / dateGuess) that the review screen shows in amber,
   because OCR can drop a minus sign or misread a digit. Nothing is saved until the user confirms. */
(function (g) {
  const BT = (g.BT = g.BT || {});
  if (!BT.util && typeof require !== 'undefined') require('./util.js');
  if (!BT.cats && typeof require !== 'undefined') require('./categories.js');
  const U = BT.util;

  const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const WD = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?,?\\s+';
  const RE_DMY_TEXT = new RegExp(`(?:${WD})?\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\b\\.?,?(?:\\s+(\\d{4}))?`, 'i');
  const RE_MDY_TEXT = new RegExp(`(?:${WD})?\\b${MON}\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i');
  const RE_SLASH = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
  const RE_DOTDASH = /\b(\d{1,2})[-.](\d{1,2})[-.](\d{2,4})\b/;
  const RE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
  const RE_REL = /\b(today|yesterday)\b/i;
  const WEEKDAY_ONLY = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i;

  function monthNum(s) { return MONTH[s.slice(0, 3).toLowerCase()]; }

  /** Pick the year for a date with no year: the latest one that is not (much) in the future. */
  function inferYear(m, d, ref) {
    const ry = Number(ref.slice(0, 4));
    let iso = U.iso(ry, m, d);
    if (U.validISO(iso) && U.daysBetween(ref, iso) <= 1) return iso;
    iso = U.iso(ry - 1, m, d);
    return U.validISO(iso) ? iso : null;
  }
  function fullYear(y) { y = Number(y); return y < 100 ? 2000 + y : y; }

  /** First date found in a piece of text -> {date, index, length} or null. */
  function findDate(text, ref) {
    let m;
    if ((m = RE_ISO.exec(text))) { const iso = U.iso(+m[1], +m[2], +m[3]); if (U.validISO(iso)) return { date: iso, index: m.index, length: m[0].length }; }
    if ((m = RE_DMY_TEXT.exec(text))) {
      const d = +m[1], mo = monthNum(m[2]); const iso = m[3] ? U.iso(+m[3], mo, d) : inferYear(mo, d, ref);
      if (iso && U.validISO(iso)) return { date: iso, index: m.index, length: m[0].length };
    }
    if ((m = RE_MDY_TEXT.exec(text))) {
      const d = +m[2], mo = monthNum(m[1]); const iso = m[3] ? U.iso(+m[3], mo, d) : inferYear(mo, d, ref);
      if (iso && U.validISO(iso)) return { date: iso, index: m.index, length: m[0].length };
    }
    if ((m = RE_DOTDASH.exec(text))) { const iso = U.iso(fullYear(m[3]), +m[2], +m[1]); if (U.validISO(iso)) return { date: iso, index: m.index, length: m[0].length }; }
    if ((m = RE_SLASH.exec(text))) {
      const d = +m[1], mo = +m[2];
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) { const iso = m[3] ? U.iso(fullYear(m[3]), mo, d) : inferYear(mo, d, ref); if (iso && U.validISO(iso)) return { date: iso, index: m.index, length: m[0].length }; }
    }
    if ((m = RE_REL.exec(text))) { const d = m[1].toLowerCase() === 'today' ? ref : U.addDays(ref, -1); return { date: d, index: m.index, length: m[0].length }; }
    return null;
  }

  /** Is this whole line a date heading ("Tuesday 10 November", "Today", "10/11/2026")? */
  function headerDate(text, ref) {
    const t = text.trim();
    if (!t || t.length > 40) return null;
    const hit = findDate(t, ref);
    if (!hit) return null;
    const rest = (t.slice(0, hit.index) + ' ' + t.slice(hit.index + hit.length)).replace(/[^a-z0-9]+/gi, ' ').trim();
    const leftover = rest.split(/\s+/).filter((w) => w && !WEEKDAY_ONLY.test(w) && !/^(of|the)$/i.test(w));
    if (leftover.join('').length <= 2) return hit.date;
    return null;
  }

  // ---------- amounts ----------
  const RE_AMT = /([+\-−–—]?)\s?(AU)?(\$|S|§)?\s?(\d{1,3}(?:,\d{3})+|\d{1,7})\.(\d{2})(?!\d)(?:\s?(CR|DR)\b)?/gi;
  function findAmounts(text) {
    const out = [];
    RE_AMT.lastIndex = 0;
    let m;
    while ((m = RE_AMT.exec(text))) {
      const start = m.index; const prev = text[start - 1];
      // the "S" some OCR engines give for "$" must not be the tail of a word; digits glued to letters aren't money
      if (prev && /[A-Za-z0-9.,]/.test(prev) && !m[1]) { continue; }
      if (m[3] && m[3].toUpperCase() === 'S' && prev && /[A-Za-z]/.test(prev)) continue;
      let sign = '';
      if (m[1]) sign = /[+]/.test(m[1]) ? '+' : '-';
      if (m[6] && /cr/i.test(m[6])) sign = '+';
      if (m[6] && /dr/i.test(m[6])) sign = '-';
      const end = m.index + m[0].length;
      if (text[start - 1] === '(' && text[end] === ')') sign = '-';
      const cents = Number(m[4].replace(/,/g, '')) * 100 + Number(m[5]);
      out.push({ start, end, cents, sign, hasSymbol: !!m[3] || !!m[2], text: m[0] });
    }
    return out;
  }

  const NOT_A_TXN = /\b(avail(able)?|balance|limit|total|spent|earned|saved|statement|minimum|owing|bsb)\b/i;
  const KIND = /^(card purchase|purchase|debit card|visa|mastercard|eftpos|direct debit|direct credit|bpay|osko|payid|transfer|internal transfer|apple pay|google pay|contactless|atm|fee|interest|refund|deposit|payment|pending|authorised|in progress|declined)\b/i;
  const KIND_ONLY = new RegExp('^(' + KIND.source.replace(/^\^\(/, '').replace(/\)\\b$/, '') + ')$', 'i');
  const PENDING_HDR = /^(pending|authorised|authorized|in progress|processing)( transactions?)?$/i;
  const SECTION_NOISE = /^(transactions?|activity|recent|search|filter|filters|all|spend|save|home|pay|cards?|profile|more|menu|export|statements?|today|yesterday|this (week|month))$/i;
  const INCOMEISH = /\b(salary|payroll|wages?|pay\b|deposit|refund|interest|received|cashback|reversal|transfer from|osko from|payid from|centrelink|reimburse)/i;

  function cleanDesc(s) {
    s = s.replace(/[|·•›>»«<¦—–_~=]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    // drop leading avatar/icon junk: single characters before a real word
    s = s.replace(/^(?:[^A-Za-z0-9]|[A-Za-z0-9](?=\s))\s*/g, '');
    s = s.replace(/^(?:[^A-Za-z0-9]|[A-Za-z0-9](?=\s))\s*/g, '');
    // an avatar circle shows the merchant's initial, which OCR reads as a stray 1-2 letter word ("Mm McDonalds")
    const av = s.match(/^([A-Za-z]{1,2})\s+(\S)/); if (av && av[1][0].toLowerCase() === av[2].toLowerCase()) s = s.slice(av[1].length).trim();
    s = s.replace(/[^A-Za-z0-9)'\]]+$/g, '').trim();
    return s;
  }

  /**
   * lines: [{text, words?: [{text,x0,y0,x1,y1,conf}]}]
   * opts: { ref: 'YYYY-MM-DD' (what "Today" means), colourOf(word) -> 'green'|'red'|null }
   */
  function parseLines(lines, opts) {
    opts = opts || {};
    const ref = opts.ref || U.today();
    const rows = []; const warnings = [];
    let cur = null; let pendingSection = false; let last = null; let lastText = null; let lastTextIdx = -1;
    let sawDateHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]; const text = String(ln.text || '').replace(/ /g, ' ').replace(/\s{2,}/g, '  ').trim();
      if (!text) continue;
      const amts = findAmounts(text);

      if (!amts.length) {
        if (PENDING_HDR.test(text)) { pendingSection = true; last = null; lastText = null; continue; }
        const hd = headerDate(text, ref);
        if (hd) { cur = hd; sawDateHeader = true; pendingSection = false; last = null; lastText = null; continue; }
        if (SECTION_NOISE.test(text) || /^\d{1,2}:\d{2}\b/.test(text) || /^\d{1,3}%$/.test(text)) continue;
        // text-only line: a subtitle of the txn above, or the merchant name for an amount-only line below
        if (last && i - last.lineIdx <= 2) {
          if (KIND.test(text) && !last.kind) last.kind = text.slice(0, 40);
          else if (!last.subtitle) last.subtitle = text.slice(0, 60);
          if (/\bpending\b/i.test(text)) last.pending = true;
        }
        lastText = text; lastTextIdx = i;
        continue;
      }

      // ---- a line with money on it ----
      if (NOT_A_TXN.test(text) && text.replace(RE_AMT, '').trim().split(/\s+/).length <= 4) continue;

      // amount vs running balance: if two amounts and exactly one is signed, that one is the amount
      let amt = amts[0]; let bal = null;
      if (amts.length >= 2) {
        const signed = amts.filter((a) => a.sign);
        if (signed.length === 1) { amt = signed[0]; bal = amts.find((a) => a !== amt); }
        else { amt = amts[0]; bal = amts[amts.length - 1]; }
      }

      let left = text;
      for (const a of [...amts].sort((x, y) => y.start - x.start)) left = left.slice(0, a.start) + ' ' + left.slice(a.end);
      let rowDate = null; let dateInline = false;
      const hit = findDate(left, ref);
      if (hit) { rowDate = hit.date; dateInline = true; left = left.slice(0, hit.index) + ' ' + left.slice(hit.index + hit.length); }
      let pending = pendingSection || /\bpending\b/i.test(left);
      left = left.replace(/\bpending\b/gi, ' ');
      let desc = cleanDesc(left);
      let kind = null;
      if (KIND_ONLY.test(desc)) { kind = desc; desc = ''; }

      if (desc.replace(/[^A-Za-z]/g, '').length < 2) {
        if (lastText && lastTextIdx === i - 1 && !headerDate(lastText, ref)) {
          desc = cleanDesc(lastText);
          if (last && last.subtitle === lastText.slice(0, 60)) last.subtitle = null; // it belonged to this row, not the one above
        } else desc = '';
      }

      const row = {
        date: rowDate || cur, dateGuess: !(rowDate || cur), desc: desc || '(unreadable)', amount: amt.cents, balance: bal ? bal.cents : null,
        sign: amt.sign, pending, kind, subtitle: null, signSource: amt.sign ? 'explicit' : null,
        lowConf: !desc, flags: [], raw: text, lineIdx: i, _sym: amt.hasSymbol,
      };
      if (!desc) row.flags.push('no description');

      // OCR confidence of the amount word
      if (ln.words && ln.words.length) {
        const digitsW = ln.words.filter((w) => /\d\.\d{2}/.test(w.text));
        const w = digitsW[digitsW.length - 1];
        if (w) {
          row._word = w;
          const c = typeof w.digitConf === 'number' ? w.digitConf : w.conf;
          if (typeof c === 'number' && c < 75) { row.lowConf = true; row.flags.push('digits read with low confidence: check the amount'); }
        }
      }
      rows.push(row); last = row; lastText = null;
    }

    // ---- decide signs for unsigned amounts ----
    // Clues, strongest first: explicit +/-, text colour (green = money in) when the screenshot shows that pattern,
    // wording that says income, then the batch pattern. OCR often drops a thin "-", so an unsigned amount at an
    // ordinary merchant is read as spending (and flagged) rather than as money in.
    const neg = rows.filter((r) => r.sign === '-').length; const pos = rows.filter((r) => r.sign === '+').length;
    const batchMode = neg > 0 && pos === 0 ? 'credit' : (pos > 0 && neg === 0 ? 'debit' : null);
    const isIncome = opts.isIncomeDesc ? (d) => opts.isIncomeDesc(d) || INCOMEISH.test(d) : (d) => INCOMEISH.test(d);
    for (const r of rows) r._colour = opts.colourOf && r._word ? opts.colourOf(r._word) : null;
    const greenCredit = rows.some((r) => r._colour === 'green' && r.sign !== '-') && !rows.some((r) => r._colour === 'green' && r.sign === '-');
    const symRate = rows.length ? rows.filter((r) => r._sym).length / rows.length : 1;
    for (const r of rows) {
      let sign = r.sign; const wording = r.desc + ' ' + (r.kind || '') + ' ' + (r.subtitle || '');
      if (!sign) {
        if (r._colour === 'green') { sign = '+'; r.signSource = 'colour'; }
        else if (r._colour === 'red') { sign = '-'; r.signSource = 'colour'; }
        else if (greenCredit) {
          if (isIncome(wording)) { sign = '+'; r.signSource = 'keyword'; r.lowConf = true; r.flags.push('not green, but the wording says money in'); }
          else { sign = '-'; r.signSource = 'colour'; }
        } else if (batchMode === 'credit') {
          if (isIncome(wording)) { sign = '+'; r.signSource = 'batch'; }
          else { sign = '-'; r.signSource = 'batch-fix'; r.lowConf = true; r.flags.push('no minus sign read: treated as spending. Flip it if this was money in'); }
        } else if (batchMode === 'debit') { sign = '-'; r.signSource = 'batch'; }
        else if (isIncome(wording)) { sign = '+'; r.signSource = 'keyword'; r.flags.push('direction guessed from wording'); r.lowConf = true; }
        else { sign = '-'; r.signSource = 'default'; r.flags.push('direction assumed to be spending'); r.lowConf = true; }
      }
      r.amount = sign === '+' ? Math.abs(r.amount) : -Math.abs(r.amount);
      if (symRate > 0.6 && !r._sym) { r.lowConf = true; r.flags.push('no $ sign read: check the digits'); }
      if (r.dateGuess) r.flags.push('no date found');
      delete r._sym; delete r._word; delete r._colour;
    }
    if (rows.length && !sawDateHeader && rows.every((r) => r.dateGuess)) warnings.push('No dates were found in this screenshot. Pick the date for these rows.');
    if (!rows.length) warnings.push('No transactions were found. Is this the transaction list? Try a sharper or larger screenshot.');
    return { rows, warnings, batchMode };
  }

  /** Group OCR words into visual lines by vertical position. words: [{text,x0,y0,x1,y1,conf}] */
  function linesFromWords(words) {
    const ws = words.filter((w) => w.text && w.text.trim());
    if (!ws.length) return [];
    const hs = ws.map((w) => w.y1 - w.y0).sort((a, b) => a - b); const medH = hs[hs.length >> 1] || 20;
    ws.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    const lines = [];
    for (const w of ws) {
      const yc = (w.y0 + w.y1) / 2;
      const L = lines[lines.length - 1];
      if (L && Math.abs(yc - L.yc) < medH * 0.6) { L.words.push(w); L.yc = (L.yc * (L.words.length - 1) + yc) / L.words.length; }
      else lines.push({ words: [w], yc });
    }
    for (const L of lines) {
      L.words.sort((a, b) => a.x0 - b.x0);
      let t = ''; let prev = null;
      for (const w of L.words) { t += (prev ? ((w.x0 - prev.x1) > medH * 2.5 ? '   ' : ' ') : '') + w.text; prev = w; }
      L.text = t;
    }
    return lines;
  }

  /** Convenience for plain text (tests, paste box). */
  function parseText(text, opts) { return parseLines(String(text).split(/\r?\n/).map((t) => ({ text: t })), opts); }

  BT.parse = { findDate, headerDate, findAmounts, parseLines, parseText, linesFromWords, cleanDesc };
  if (typeof module !== 'undefined' && module.exports) module.exports = BT.parse;
})(typeof window !== 'undefined' ? window : globalThis);
