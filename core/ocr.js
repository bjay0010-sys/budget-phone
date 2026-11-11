/* In-browser OCR (Tesseract compiled to WebAssembly, bundled locally: no network, nothing uploaded).
   A screenshot is read on the device that holds it. Steps: decode (respecting EXIF rotation) -> grayscale and
   contrast boost -> invert if it is a dark-mode screen -> OCR -> group words into lines -> parse. */
(function (g) {
  const BT = (g.BT = g.BT || {});
  let worker = null; let initPromise = null; let base = '';

  async function init(basePath, onStatus) {
    if (worker) return worker;
    if (initPromise) return initPromise;
    base = new URL(basePath.replace(/\/$/, '') + '/', document.baseURI).href.replace(/\/$/, '');
    initPromise = (async () => {
      if (typeof Tesseract === 'undefined') throw new Error('OCR engine not loaded');
      const w = await Tesseract.createWorker('eng', 1, {
        workerPath: base + '/worker.min.js', corePath: base, langPath: base, gzip: true, workerBlobURL: false,
        logger: (m) => { if (onStatus && m && m.status) onStatus(m); },
      });
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', user_defined_dpi: '300' });
      worker = w; return w;
    })();
    try { return await initPromise; } catch (e) { initPromise = null; throw e; }
  }

  async function decode(file) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
    }
    return new Promise((res, rej) => { const img = new Image(); const url = URL.createObjectURL(file); img.onload = () => { res(img); URL.revokeObjectURL(url); }; img.onerror = () => rej(new Error('Could not open this image')); img.src = url; });
  }

  /** Returns {canvas (prepared for OCR), colour (original pixels), scale, inverted} */
  function prepare(bmp) {
    const w0 = bmp.width, h0 = bmp.height;
    const scale = w0 < 1100 ? 1100 / w0 : (w0 > 2000 ? 2000 / w0 : 1);
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
    const colour = document.createElement('canvas'); colour.width = w; colour.height = h;
    const cx = colour.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingQuality = 'high'; cx.drawImage(bmp, 0, 0, w, h);
    const img = cx.getImageData(0, 0, w, h); const d = img.data; const n = w * h;
    let sum = 0; const gray = new Uint8ClampedArray(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) { const v = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0; gray[i] = v; sum += v; }
    const mean = sum / n; const inverted = mean < 118;
    // contrast stretch between the 2nd and 98th percentile
    const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[gray[i]]++;
    let lo = 0, hi = 255, acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
    acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
    const span = Math.max(40, hi - lo);
    const out = document.createElement('canvas'); out.width = w; out.height = h; const ox = out.getContext('2d');
    const o = ox.createImageData(w, h);
    for (let i = 0, p = 0; i < n; i++, p += 4) { let v = ((gray[i] - lo) * 255) / span; v = v < 0 ? 0 : v > 255 ? 255 : v; if (inverted) v = 255 - v; o.data[p] = o.data[p + 1] = o.data[p + 2] = v; o.data[p + 3] = 255; }
    ox.putImageData(o, 0, 0);
    return { canvas: out, colour, scale, inverted };
  }

  /** green/red text detector for the amount word (credits are often green). */
  function colourOfFactory(colourCanvas) {
    const cx = colourCanvas.getContext('2d', { willReadFrequently: true });
    return function (word) {
      try {
        const x0 = Math.max(0, word.x0), y0 = Math.max(0, word.y0), w = Math.max(1, Math.min(colourCanvas.width - x0, word.x1 - word.x0)), h = Math.max(1, Math.min(colourCanvas.height - y0, word.y1 - word.y0));
        const d = cx.getImageData(x0, y0, w, h).data; const px = d.length / 4; if (px < 20) return null;
        // background = colour of the corners
        const idx = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4]; let br = 0, bg = 0, bb = 0; for (const i of idx) { br += d[i]; bg += d[i + 1]; bb += d[i + 2]; } br /= 4; bg /= 4; bb /= 4;
        let r = 0, gg = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { const dist = Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb); if (dist > 140) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } }
        if (n < 12) return null; r /= n; gg /= n; b /= n;
        if (gg > r + 28 && gg > b + 18) return 'green';
        if (r > gg + 45 && r > b + 45) return 'red';
        return null;
      } catch (e) { return null; }
    };
  }

  /** OCR one image file. Returns {lines, colourOf, width, height, inverted, text}. Tall images are read in overlapping strips. */
  async function readImage(file, onProgress) {
    if (!worker) throw new Error('OCR not initialised');
    const bmp = await decode(file); const prep = prepare(bmp);
    const { canvas } = prep; const W = canvas.width, H = canvas.height; const STRIP = 3200, OVER = 160;
    const strips = []; for (let y = 0; y < H; y += STRIP - OVER) { strips.push([y, Math.min(H, y + STRIP)]); if (y + STRIP >= H) break; }
    const out = [];
    for (let s = 0; s < strips.length; s++) {
      const [y0, y1] = strips[s]; const rect = { left: 0, top: y0, width: W, height: y1 - y0 };
      const res = await worker.recognize(canvas, { rectangle: rect }, { blocks: true });
      const words = [];
      const blocks = (res.data && res.data.blocks) || [];
      for (const b of blocks) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
        const dc = (w.symbols || []).filter((y) => /[0-9]/.test(y.text)).map((y) => y.confidence);
        words.push({ text: w.text, conf: w.confidence, digitConf: dc.length ? Math.min(...dc) : undefined, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
      }
      if (!words.length && res.data && res.data.words) for (const w of res.data.words) words.push({ text: w.text, conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
      out.push({ words, text: (res.data && res.data.text) || '' });
      if (onProgress) onProgress((s + 1) / strips.length);
    }
    return { strips: out, colourOf: colourOfFactory(prep.colour), width: W, height: H, inverted: prep.inverted, bitmap: bmp };
  }

  /** OCR + parse one screenshot -> {rows, warnings, inverted} */
  async function readScreenshot(file, opts, onProgress) {
    opts = opts || {};
    const r = await readImage(file, onProgress);
    const rows = []; const warnings = [];
    r.strips.forEach((st, i) => {
      const lines = BT.parse.linesFromWords(st.words);
      const parsed = BT.parse.parseLines(lines, { ref: opts.ref, colourOf: r.colourOf, isIncomeDesc: opts.isIncomeDesc });
      for (const row of parsed.rows) { row.strip = i; rows.push(row); }
      warnings.push(...parsed.warnings);
    });
    if (rows.length) { const i = warnings.findIndex((w) => /^No transactions/.test(w)); if (i >= 0) warnings.splice(i, 1); }
    return { rows, warnings: [...new Set(warnings)], inverted: r.inverted, width: r.width, height: r.height, bitmap: r.bitmap };
  }

  BT.ocr = { init, readScreenshot, readImage, prepare };
})(typeof window !== 'undefined' ? window : globalThis);
