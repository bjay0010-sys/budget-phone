/* Bank CSV import. uBank lets you download statements as CSV; the exact columns aren't known here, so the
   mapper works from the header names (or, with no header, from what the columns contain) and reports what it chose. */
(function (g) {
  const BT = (g.BT = g.BT || {});
  if (!BT.util && typeof require !== 'undefined') require('./util.js');
  const U = BT.util;

  /** RFC-4180-ish parser: quotes, escaped quotes, CRLF, BOM, comma/semicolon/tab. */
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 5).join('\n');
    const counts = { ',': (first.match(/,/g) || []).length, ';': (first.match(/;/g) || []).length, '\t': (first.match(/\t/g) || []).length };
    const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
    return rows;
  }

  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  /** Parse one date cell. order: 'dmy' (Australia) or 'mdy'. Returns ISO or null. */
  function parseDateCell(s, order) {
    s = String(s || '').trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, '');
    let m;
    if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s))) { const iso = U.iso(+m[1], +m[2], +m[3]); return U.validISO(iso) ? iso : null; }
    if ((m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{2,4})$/.exec(s))) { const mo = MON[m[2].slice(0, 3).toLowerCase()]; if (!mo) return null; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; const iso = U.iso(y, mo, +m[1]); return U.validISO(iso) ? iso : null; }
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
      let a = +m[1], b = +m[2]; const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      const [d, mo] = order === 'mdy' ? [b, a] : [a, b];
      const iso = U.iso(y, mo, d); return U.validISO(iso) ? iso : null;
    }
    return null;
  }

  const ROLE_PATTERNS = [
    ['date', /^(transaction |posting |posted |effective |processed |value |settlement )?date( posted)?$|^date\b/i],
    ['balance', /balance/i],
    ['debit', /\b(debit|withdrawal|money out|paid out|dr)\b/i],
    ['credit', /\b(credit|deposit|money in|paid in|cr)\b/i],
    ['amount', /^(transaction )?(amount|value)\b|^amount\b/i],
    ['type', /^(transaction )?type$|^dr\/cr$|^debit\/credit$/i],
    ['desc', /(description|narrative|details|merchant|payee|particulars|memo|transaction$|^reference|^name$)/i],
  ];

  function detectHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const roles = {}; let hits = 0;
      rows[i].forEach((cell, idx) => {
        const c = cell.trim(); if (!c) return;
        for (const [role, re] of ROLE_PATTERNS) { if (re.test(c) && roles[role] === undefined) { roles[role] = idx; hits++; break; } }
      });
      if (roles.date !== undefined && (roles.amount !== undefined || roles.debit !== undefined || roles.credit !== undefined) && hits >= 2) return { index: i, roles };
    }
    return null;
  }

  /** Guess columns when there is no header row. */
  function guessRoles(rows) {
    const sample = rows.slice(0, 30); const n = Math.max(...sample.map((r) => r.length));
    const score = Array.from({ length: n }, () => ({ date: 0, num: 0, len: 0, signed: 0 }));
    for (const r of sample) r.forEach((c, i) => {
      const v = c.trim(); if (!v) return;
      if (parseDateCell(v, 'dmy')) score[i].date++;
      else if (/^[-+($]*\s?[\d,]+\.\d{2}\)?$/.test(v)) { score[i].num++; if (/^[-(]/.test(v)) score[i].signed++; }
      score[i].len += v.length;
    });
    const roles = {};
    roles.date = score.reduce((b, s, i) => (s.date > (score[b]?.date ?? -1) ? i : b), 0);
    const numCols = score.map((s, i) => ({ i, s })).filter((x) => x.s.num >= sample.length * 0.5);
    if (numCols.length) { roles.amount = numCols[0].i; if (numCols[1]) roles.balance = numCols[1].i; }
    const textCols = score.map((s, i) => ({ i, l: s.len })).filter((x) => x.i !== roles.date && x.i !== roles.amount && x.i !== roles.balance).sort((a, b) => b.l - a.l);
    if (textCols.length) roles.desc = textCols[0].i;
    return roles;
  }

  function detectOrder(rows, roles, start) {
    let dFirst = false, mFirst = false;
    for (const r of rows.slice(start)) {
      const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(String(r[roles.date] || '').trim());
      if (m) { if (+m[1] > 12) dFirst = true; if (+m[2] > 12) mFirst = true; }
    }
    return mFirst && !dFirst ? 'mdy' : 'dmy';
  }

  /** Main entry: CSV text -> {rows:[{date,desc,amount,balance,raw}], warnings, mapping, skipped} */
  function importCSV(text) {
    const grid = parseCSV(text); const warnings = [];
    if (grid.length < 1) return { rows: [], warnings: ['The file is empty.'], mapping: {}, skipped: 0 };
    let hdr = detectHeader(grid); let roles; let start;
    if (hdr) { roles = hdr.roles; start = hdr.index + 1; }
    else { roles = guessRoles(grid); start = 0; warnings.push('No header row found: columns were guessed from the data. Check the preview.'); }
    if (roles.date === undefined || (roles.amount === undefined && roles.debit === undefined && roles.credit === undefined)) {
      return { rows: [], warnings: ['Could not find a date column and an amount column in this file.'], mapping: roles, skipped: 0 };
    }
    const order = detectOrder(grid, roles, start);
    if (order === 'mdy') warnings.push('Dates look like month/day/year, so they were read that way.');
    const names = hdr ? grid[hdr.index] : null;
    const mapping = {}; for (const k of Object.keys(roles)) mapping[k] = names ? names[roles[k]].trim() : `column ${roles[k] + 1}`;

    const rows = []; let skipped = 0;
    for (const r of grid.slice(start)) {
      const date = parseDateCell(r[roles.date], order);
      if (!date) { skipped++; continue; }
      let amount = null;
      if (roles.amount !== undefined) amount = U.toCents(r[roles.amount]);
      if (roles.debit !== undefined || roles.credit !== undefined) {
        const d = roles.debit !== undefined ? U.toCents(r[roles.debit]) : null;
        const c = roles.credit !== undefined ? U.toCents(r[roles.credit]) : null;
        if (d) amount = -Math.abs(d); else if (c) amount = Math.abs(c);
        else if (amount === null) amount = null;
      }
      if (roles.type !== undefined && amount !== null) {
        const t = String(r[roles.type] || '');
        if (/debit|\bdr\b|withdraw/i.test(t)) amount = -Math.abs(amount); else if (/credit|\bcr\b|deposit/i.test(t)) amount = Math.abs(amount);
      }
      if (amount === null || amount === 0) { skipped++; continue; }
      const desc = String(roles.desc !== undefined ? r[roles.desc] : r.filter((x, i) => i !== roles.date && i !== roles.amount).join(' ')).replace(/\s+/g, ' ').trim();
      const balance = roles.balance !== undefined ? U.toCents(r[roles.balance]) : null;
      rows.push({ date, desc: desc || '(no description)', amount, balance, raw: r.join(' | ') });
    }
    if (!rows.length) warnings.push('No transaction rows could be read.');
    // single signed Amount column where every number is positive: direction unknown
    if (roles.amount !== undefined && roles.debit === undefined && roles.type === undefined && rows.length > 5 && rows.every((x) => x.amount > 0)) {
      warnings.push('Every amount is positive and there is no debit/credit column, so spending cannot be told from income. Check the file.');
    }
    return { rows, warnings, mapping, skipped, order };
  }

  BT.csv = { parseCSV, parseDateCell, importCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = BT.csv;
})(typeof window !== 'undefined' ? window : globalThis);
