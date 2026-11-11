/* PDF statements. Text PDFs (what a bank statement download normally is) are read straight from the file: every piece of
   text comes with its position, so the rows and the Debit / Credit / Balance columns can be rebuilt exactly, no OCR guessing.
   Image-only PDFs (a scan or a printed-to-PDF screenshot) are drawn to a picture page by page and sent through the
   screenshot reader instead. Runs on the device that holds the file; nothing is uploaded. Needs pdf.js (vendored). */
(function (g) {
  const BT = (g.BT = g.BT || {});
  if (typeof require !== 'undefined') { if (!BT.parse) require('./parse.js'); }

  const AMT_WORD = /^\(?[-+−–]?\(?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:\s?(?:CR|DR))?-?$/i;
  const NUM_ONLY = (t) => (t.match(/\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/) || [''])[0];

  // ------------------------------------------------------------ text items -> joined words
  /** Items from pdf.js (already converted to top-down coordinates) -> words, gluing pieces of one word together. */
  function joinItems(items) {
    const its = items.filter((i) => i.text && i.text.trim() !== '' || i.text === ' ').map((i) => ({ ...i }));
    its.sort((a, b) => (Math.abs(a.yb - b.yb) < Math.min(a.h, b.h) * 0.4 ? a.x0 - b.x0 : a.yb - b.yb));
    const out = [];
    for (const it of its) {
      const p = out[out.length - 1];
      if (p && Math.abs(p.yb - it.yb) < Math.min(p.h, it.h) * 0.4 && it.x0 - p.x1 < Math.min(p.h, it.h) * 0.2 && it.x0 - p.x1 > -Math.min(p.h, it.h) * 0.5 && !/\s$/.test(p.text) && !/^\s/.test(it.text)) {
        p.text += it.text; p.x1 = Math.max(p.x1, it.x1); p.y0 = Math.min(p.y0, it.y0); p.y1 = Math.max(p.y1, it.y1);
      } else out.push(it);
    }
    return out.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1 }));
  }

  // ------------------------------------------------------------ column header detection
  function findColumns(line) {
    const ws = line.words; if (!ws || ws.length < 2) return null; const cols = [];
    for (let i = 0; i < ws.length; i++) {
      const t = ws[i].text.toLowerCase().replace(/[^a-z/]/g, ''); const nx = ws[i + 1] ? ws[i + 1].text.toLowerCase().replace(/[^a-z]/g, '') : '';
      let role = null; let span = [ws[i].x0, ws[i].x1];
      const whole = ws[i].text.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
      if (/^(money|paid|amount) out$/.test(whole)) role = 'debit';
      else if (/^(money|paid|amount) in$/.test(whole)) role = 'credit';
      else if ((t === 'money' || t === 'paid' || t === 'amount') && nx === 'out') { role = 'debit'; span = [ws[i].x0, ws[i + 1].x1]; i++; }
      else if ((t === 'money' || t === 'paid' || t === 'amount') && nx === 'in') { role = 'credit'; span = [ws[i].x0, ws[i + 1].x1]; i++; }
      else if (/^(debit|debits|withdrawal|withdrawals|dr)$/.test(t)) role = 'debit';
      else if (/^(credit|credits|deposit|deposits|cr)$/.test(t)) role = 'credit';
      else if (/^(running)?balance$/.test(t)) role = 'balance';
      else if (/^(amount|value)$/.test(t)) role = 'amount';
      if (role) cols.push({ role, x0: span[0], x1: span[1] });
    }
    const roles = new Set(cols.map((c) => c.role));
    if ((roles.has('debit') && roles.has('credit')) || (roles.has('debit') && roles.has('balance')) || (roles.has('credit') && roles.has('balance')) || (roles.has('amount') && roles.has('balance'))) return cols;
    return null;
  }
  const colDist = (w, c) => Math.min(Math.abs(w.x1 - c.x1), Math.abs((w.x0 + w.x1) / 2 - (c.x0 + c.x1) / 2), Math.abs(w.x0 - c.x0));

  /** Rewrites a line so the existing line parser sees explicit signs: Debit column -> "-$x", Credit column -> "+$x", Balance removed. */
  function applyColumns(line, cols) {
    let changed = 0; const kept = [];
    let prev = null; let text = '';
    for (const w of line.words) {
      let t = w.text;
      if (AMT_WORD.test(t) && cols) {
        const col = cols.slice().sort((a, b) => colDist(w, a) - colDist(w, b))[0]; const nd = colDist(w, col);
        const limit = Math.max(40, (col.x1 - col.x0) * 1.6);
        if (nd <= limit) {
          if (col.role === 'balance') { changed++; continue; }
          if (col.role === 'debit') { t = '-$' + NUM_ONLY(t); changed++; }
          else if (col.role === 'credit') { t = '+$' + NUM_ONLY(t); changed++; }
        }
      }
      kept.push({ ...w, text: t });
    }
    const hs = kept.map((w) => w.y1 - w.y0).sort((a, b) => a - b); const medH = hs[hs.length >> 1] || 10;
    for (const w of kept) { text += (prev ? ((w.x0 - prev.x1) > medH * 2.5 ? '   ' : ' ') : '') + w.text; prev = w; }
    return { ...line, words: kept, text, changed };
  }

  /** pages: [{words:[{text,x0,x1,y0,y1}]}] -> {rows, warnings, columns:boolean}. Pure, so it can be tested without a PDF. */
  function rowsFromPages(pages, opts) {
    opts = opts || {}; let cols = null; let usedCols = false; const all = [];
    for (const pg of pages) {
      const lines = BT.parse.linesFromWords(pg.words || []);
      for (const ln of lines) {
        const c = findColumns(ln);
        if (c) { cols = c; continue; } // the header line itself is not a transaction
        if (cols) { const r = applyColumns(ln, cols); if (r.changed) usedCols = true; all.push(r); } else all.push(ln);
      }
    }
    const parsed = BT.parse.parseLines(all, { ref: opts.ref, isIncomeDesc: opts.isIncomeDesc });
    const warnings = parsed.warnings.slice();
    for (const r of parsed.rows) { r.fromPdf = true; if (usedCols) { r.lowConf = r.lowConf && !r.flags.some((f) => /direction|minus/.test(f)); } }
    if (parsed.rows.length) { const i = warnings.findIndex((w) => /^No transactions/.test(w)); if (i >= 0) warnings.splice(i, 1); }
    else warnings.push('No transactions were found in the text of this PDF.');
    return { rows: parsed.rows, warnings: [...new Set(warnings)], columns: usedCols };
  }

  // ------------------------------------------------------------ pdf.js glue
  async function pageWords(page) {
    const vp = page.getViewport({ scale: 1 }); const tc = await page.getTextContent({ normalizeWhitespace: true }); const items = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string' || !it.transform) continue;
      const h = Math.abs(it.height || it.transform[3]) || 8; const yb = vp.height - it.transform[5]; const x0 = it.transform[4];
      items.push({ text: it.str, x0, x1: x0 + (it.width || 0), y0: yb - h * 0.8, y1: yb + h * 0.2, yb, h });
    }
    return { words: joinItems(items), chars: items.reduce((n, i) => n + i.text.trim().length, 0), vp };
  }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF reader')); document.head.appendChild(s); });
  }
  async function getLib(ctx) {
    if (ctx.pdfLib) return ctx.pdfLib;
    if (g.pdfjsLib) return g.pdfjsLib;
    const base = new URL((BT.config && BT.config.pdfPath || 'web/vendor/pdf').replace(/\/$/, '') + '/', document.baseURI).href;
    await loadScript(base + 'pdf.min.js'); const lib = g.pdfjsLib; if (!lib) throw new Error('PDF reader not available');
    lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js'; return lib;
  }

  async function readPDF(file, ctx) {
    ctx = ctx || {}; const lib = await getLib(ctx); const say = ctx.onStatus || (() => {}); const prog = ctx.onProgress || (() => {});
    const data = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
    let doc;
    try { doc = await lib.getDocument({ data, isEvalSupported: false, verbosity: 0, disableFontFace: true }).promise; }
    catch (e) {
      if (e && (e.name === 'PasswordException' || /password/i.test(e.message || ''))) return { rows: [], warnings: ['This PDF is password protected. Remove the password (open it, then Print or Save as PDF) and add it again.'], skipped: 0, mapping: {} };
      throw e;
    }
    const textPages = []; const scanned = []; const n = Math.min(doc.numPages, 60);
    for (let p = 1; p <= n; p++) {
      const page = await doc.getPage(p); const pw = await pageWords(page);
      if (pw.chars >= 25) textPages.push({ words: pw.words, page: p }); else scanned.push({ page, p });
      prog((p / n) * (scanned.length ? 0.3 : 1));
    }
    const out = textPages.length ? rowsFromPages(textPages, ctx) : { rows: [], warnings: [], columns: false };
    const warnings = textPages.length ? out.warnings : []; const rows = out.rows.slice();
    if (scanned.length) {
      if (!ctx.canvas && typeof document === 'undefined') { warnings.push(`${scanned.length} page(s) are pictures and cannot be read here.`); }
      else {
        say('This PDF has picture pages. Starting the screenshot reader...');
        await BT.ocr.init(BT.config.ocrPath);
        for (let i = 0; i < scanned.length; i++) {
          const { page, p } = scanned[i]; say(`Reading picture page ${p} of ${doc.numPages}...`);
          const vp = page.getViewport({ scale: 2.4 }); const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
          const r = await BT.ocr.readScreenshot(blob, { ref: ctx.ref, isIncomeDesc: ctx.isIncomeDesc }, (q) => prog(0.3 + 0.7 * ((i + q) / scanned.length)));
          for (const row of r.rows) { row.flags = (row.flags || []).concat(['read from a picture page']); rows.push(row); }
          warnings.push(...r.warnings);
        }
      }
    }
    if (doc.numPages > n) warnings.push(`Only the first ${n} pages were read.`);
    if (rows.length) { const i = warnings.findIndex((w) => /^No transactions/.test(w)); if (i >= 0) warnings.splice(i, 1); }
    if (textPages.length && !out.columns && rows.length) warnings.push('No Debit/Credit columns were found, so money in / out is judged from signs and wording. Check the direction.');
    return { rows, warnings: [...new Set(warnings)], skipped: 0, mapping: {}, scanned: scanned.length, pages: doc.numPages };
  }

  BT.pdf = { readPDF, rowsFromPages, joinItems, findColumns };
  if (typeof module !== 'undefined' && module.exports) module.exports = BT.pdf;
})(typeof window !== 'undefined' ? window : globalThis);
