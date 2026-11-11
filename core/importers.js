/* Other file formats besides screenshots and CSV: OFX/QFX, QIF, Excel (.xlsx), tab/plain text, pasted text.
   All pure JavaScript, nothing is uploaded. Every reader returns {rows, warnings, skipped, mapping?} where a row is
   {date:'YYYY-MM-DD', desc, amount (integer cents, spending negative), ...} like the CSV importer. */
(function (g) {
  const BT = (g.BT = g.BT || {});
  if (typeof require !== 'undefined') { if (!BT.util) require('./util.js'); if (!BT.parse) require('./parse.js'); if (!BT.csv) require('./csv.js'); }
  const U = BT.util;

  const iso = (y, m, d) => { y = Number(y); m = Number(m); d = Number(d); if (!(y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null; return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
  const decodeEnt = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
  const toCents = (s) => { const n = Number(String(s).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : null; };
  const clean = (s) => decodeEnt(s || '').replace(/\s+/g, ' ').trim();

  // ------------------------------------------------------------------ OFX / QFX
  function fromOFX(text) {
    text = String(text); const rows = []; let skipped = 0; const warnings = [];
    const blocks = text.split(/<STMTTRN>/i).slice(1);
    const tag = (b, t) => { const m = b.match(new RegExp('<' + t + '>\\s*([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; };
    for (const b of blocks) {
      const dt = tag(b, 'DTPOSTED').match(/^(\d{4})(\d{2})(\d{2})/); const amt = toCents(tag(b, 'TRNAMT'));
      const date = dt ? iso(dt[1], dt[2], dt[3]) : null;
      if (!date || amt === null || amt === 0) { skipped++; continue; }
      const name = clean(tag(b, 'NAME')); const memo = clean(tag(b, 'MEMO'));
      const desc = [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' ') || clean(tag(b, 'TRNTYPE')) || '(no description)';
      rows.push({ date, desc, amount: amt, balance: null, raw: 'OFX ' + tag(b, 'FITID') });
    }
    if (!blocks.length) warnings.push('No transactions found. Is this an OFX or QFX statement?');
    else if (!rows.length) warnings.push('No transaction rows could be read.');
    return { rows, warnings, skipped, mapping: {} };
  }

  // ------------------------------------------------------------------ QIF
  function fromQIF(text) {
    const recs = []; let cur = {};
    for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
      if (!line) continue; const c = line[0]; const v = line.slice(1).trim();
      if (c === '!') continue;
      if (c === '^') { if (cur.D !== undefined || cur.T !== undefined) recs.push(cur); cur = {}; continue; }
      if ('DTPMNL'.includes(c)) cur[c] = v;
    }
    if (cur.D !== undefined || cur.T !== undefined) recs.push(cur);
    // day/month order: decided by the data, Australian (day first) unless a second number is above 12
    let order = 'dmy';
    const parts = recs.map((r) => String(r.D || '').replace(/'/g, '/20').split(/[\/\-.]/).map(Number)).filter((p) => p.length === 3 && p[0] < 100);
    if (parts.some((p) => p[0] > 12)) order = 'dmy'; else if (parts.some((p) => p[1] > 12)) order = 'mdy';
    const rows = []; let skipped = 0; const warnings = [];
    for (const r of recs) {
      let d = String(r.D || '').replace(/'/g, '/20'); let date = null;
      const m = d.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/);
      if (m) { const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]); if (a > 1900) date = iso(a, b, c); else { const y = c < 100 ? 2000 + c : c; date = order === 'dmy' ? iso(y, b, a) : iso(y, a, b); } }
      const amt = toCents(r.T || '');
      if (!date || amt === null || amt === 0) { skipped++; continue; }
      const desc = [clean(r.P), clean(r.M) && clean(r.M) !== clean(r.P) ? clean(r.M) : ''].filter(Boolean).join(' ') || '(no description)';
      rows.push({ date, desc, amount: amt, balance: null, raw: 'QIF' });
    }
    if (!recs.length) warnings.push('No transactions found. Is this a QIF file?');
    if (order === 'mdy' && rows.length) warnings.push('Dates look like month/day/year, so they were read that way.');
    return { rows, warnings, skipped, mapping: {} };
  }

  // ------------------------------------------------------------------ XLSX (zip + XML, no library)
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open Excel files. Save the sheet as CSV instead.');
    const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function unzip(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a valid .xlsx file');
    const n = u16(b, eocd + 10); let p = u32(b, eocd + 16); const files = {};
    for (let i = 0; i < n; i++) {
      if (u32(b, p) !== 0x02014b50) break;
      const method = u16(b, p + 10), csize = u32(b, p + 20), nl = u16(b, p + 28), el = u16(b, p + 30), cl = u16(b, p + 32), off = u32(b, p + 42);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
      if (!/^xl\/(sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
      const lnl = u16(b, off + 26), lel = u16(b, off + 28); const data = b.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      files[name] = new TextDecoder().decode(method === 0 ? data : await inflateRaw(data));
    }
    return files;
  }
  const colIdx = (ref) => { const m = String(ref).match(/^([A-Z]+)/); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  function sharedStrings(xml) { if (!xml) return []; return (xml.match(/<si\b[\s\S]*?<\/si>/g) || []).map((si) => decodeEnt((si.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(''))); }
  function dateStyles(xml) {
    const dateXf = new Set(); if (!xml) return dateXf;
    const custom = {}; for (const m of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom[m[1]] = decodeEnt(m[2]);
    const cx = (xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0]; let i = 0;
    for (const m of cx.matchAll(/<xf\b[^>]*>/g)) {
      const id = Number((m[0].match(/numFmtId="(\d+)"/) || [])[1]);
      const code = custom[id]; const isDate = (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (code && /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/[#0]/.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')));
      if (isDate) dateXf.add(i); i++;
    }
    return dateXf;
  }
  function serialToISO(n) { const ms = Math.round((Number(n) - 25569) * 86400000); const d = new Date(ms); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function sheetGrid(xml, strings, dateXf) {
    const grid = [];
    for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const row = []; const body = rm[1] || '';
      for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = cm[1]; const inner = cm[2] || ''; const ref = (at.match(/\br="([A-Z]+\d+)"/) || [])[1]; const t = (at.match(/\bt="(\w+)"/) || [])[1]; const s = Number((at.match(/\bs="(\d+)"/) || [])[1]);
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (t === 's') val = strings[Number(v)] || '';
        else if (t === 'inlineStr') val = decodeEnt((inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
        else if (t === 'str' || t === 'e') val = decodeEnt(v || '');
        else if (v !== undefined) val = dateXf.has(s) ? (serialToISO(v) || v) : v;
        row[ref ? colIdx(ref) : row.length] = val;
      }
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      grid.push(row);
    }
    return grid;
  }
  const gridToCSV = (grid) => grid.map((r) => r.map((c) => { c = String(c); return /[",\n\r]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',')).join('\n');
  async function fromXLSX(buf) {
    const files = await unzip(buf); const sheets = Object.keys(files).filter((n) => /worksheets\//.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!sheets.length) return { rows: [], warnings: ['No sheets found in this Excel file.'], skipped: 0, mapping: {} };
    const strings = sharedStrings(files['xl/sharedStrings.xml']); const dateXf = dateStyles(files['xl/styles.xml']);
    let best = null;
    for (const name of sheets) {
      const grid = sheetGrid(files[name], strings, dateXf); if (!grid.length) continue;
      const r = BT.csv.importCSV(gridToCSV(grid));
      if (!best || r.rows.length > best.rows.length) best = r;
    }
    if (!best) return { rows: [], warnings: ['The Excel file is empty.'], skipped: 0, mapping: {} };
    return best;
  }

  // ------------------------------------------------------------------ plain text / TSV / pasted
  /** Tries the table reader first (needs a header or clear columns), then the screenshot-style line parser. */
  function fromText(text, opts) {
    opts = opts || {}; text = String(text);
    if (/<STMTTRN>/i.test(text)) return fromOFX(text);
    if (/^\s*!Type:/im.test(text)) return fromQIF(text);
    const looksTable = /[,\t;]/.test(text.split(/\r?\n/, 3).join('\n'));
    if (looksTable) { const r = BT.csv.importCSV(text); if (r.rows.length >= 1) return r; }
    const p = BT.parse.parseText(text, { ref: opts.ref, isIncomeDesc: opts.isIncomeDesc });
    const warnings = p.warnings.slice(); if (p.rows.length) warnings.push('Read as plain text: check the dates and the money in / money out direction.');
    return { rows: p.rows.map((r) => ({ ...r, desc: r.desc })), warnings, skipped: 0, mapping: {}, textParsed: true };
  }

  const EXT = { pdf: 'pdf', xlsx: 'xlsx', xlsm: 'xlsx', ofx: 'ofx', qfx: 'ofx', qif: 'qif', csv: 'text', tsv: 'text', txt: 'text', tab: 'text', xls: 'xls', ods: 'ods', numbers: 'numbers' };
  /** Decide the format from the bytes first (names lie), then the extension. Returns pdf|xlsx|ofx|qif|text|image|xls|unsupported */
  function sniff(name, mime, head) {
    const h = head || new Uint8Array(0); const s = new TextDecoder('latin1').decode(h.subarray(0, 600));
    if (s.startsWith('%PDF')) return 'pdf';
    if (h[0] === 0x50 && h[1] === 0x4b) return /\.(ods)$/i.test(name) ? 'ods' : 'xlsx';
    if (h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11) return 'xls';
    if (/OFXHEADER|<OFX>|<STMTTRN>/i.test(s)) return 'ofx';
    if (/^\s*!Type:/i.test(s)) return 'qif';
    if (/^image\//.test(mime || '') || /\.(png|jpe?g|heic|heif|webp|gif|bmp)$/i.test(name)) return 'image';
    const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]; const k = ext && EXT[ext.toLowerCase()];
    if (k) return k;
    if (/^text\//.test(mime || '') || /csv|tab-separated/.test(mime || '')) return 'text';
    return 'unsupported';
  }

  /** Read any non-image file. ctx: {ref, isIncomeDesc, onStatus}. Returns {kind, rows, warnings, skipped, mapping}. */
  async function readFile(file, ctx) {
    ctx = ctx || {}; const head = new Uint8Array(await file.slice(0, 600).arrayBuffer()); const kind = sniff(file.name || '', file.type, head);
    if (kind === 'xlsx') return { kind, ...(await fromXLSX(await file.arrayBuffer())) };
    if (kind === 'pdf') { if (!BT.pdf) throw new Error('PDF reader not loaded'); return { kind, ...(await BT.pdf.readPDF(file, ctx)) }; }
    if (kind === 'ofx') return { kind, ...fromOFX(await file.text()) };
    if (kind === 'qif') return { kind, ...fromQIF(await file.text()) };
    if (kind === 'text') { const t = await file.text(); const r = fromText(t, ctx); return { kind: /\.(csv)$/i.test(file.name) ? 'csv' : (r.textParsed ? 'text' : 'table'), ...r }; }
    if (kind === 'xls') return { kind, rows: [], warnings: ['Old-style .xls files cannot be read. Open it in Excel and use Save As, .xlsx or .csv.'], skipped: 0, mapping: {} };
    if (kind === 'ods' || kind === 'numbers') return { kind, rows: [], warnings: ['This spreadsheet format cannot be read. Export it as .xlsx or .csv and add that instead.'], skipped: 0, mapping: {} };
    return { kind: 'unsupported', rows: [], warnings: [], skipped: 0, mapping: {}, error: 'Not a supported file. Use a screenshot, PDF, CSV, Excel (.xlsx), OFX/QFX, QIF or text file.' };
  }

  BT.importers = { fromOFX, fromQIF, fromXLSX, fromText, sniff, readFile, unzip, gridToCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = BT.importers;
})(typeof window !== 'undefined' ? window : globalThis);
