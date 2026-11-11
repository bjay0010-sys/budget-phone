/* Dependency-free SVG charts. Specs follow the dataviz skill: bars <= 24px with a 4px rounded data end and a square
   base, 2px lines, >= 8px end dots with a 2px surface ring, hairline solid grids, selective direct labels,
   hover tooltips on every mark, and a "View as table" twin for each chart. Text is built with textContent only. */
(function (g) {
  const BT = (g.BT = g.BT || {}); const U = BT.util;
  const NS = 'http://www.w3.org/2000/svg';
  const S = (tag, attrs, kids) => { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) { if (attrs[k] != null) e.setAttribute(k, attrs[k]); } for (const c of [].concat(kids || [])) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
  const H = (tag, attrs, kids) => { const e = document.createElement(tag); for (const k in attrs || {}) { if (k === 'class') e.className = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else if (attrs[k] != null) e.setAttribute(k, attrs[k]); } for (const c of [].concat(kids || [])) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
  const dollars = (c) => U.money(c, { round: true });
  const axisMoney = (c) => { const v = Math.abs(c) / 100; const s = c < 0 ? '-' : ''; return v >= 10000 ? s + '$' + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'K' : s + '$' + Math.round(v).toLocaleString('en-AU'); };

  function niceMax(maxCents, n) {
    n = n || 4; const max = Math.max(maxCents, 100) / 100; const raw = max / n; const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p;
    const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; const top = Math.ceil(max / step) * step;
    const ticks = []; for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100));
    return { top: top * 100, ticks };
  }

  /** Re-draws when the container's width changes so text stays a readable size on a phone. */
  function responsive(box, draw) {
    let lastW = 0; const run = () => { const w = Math.max(240, Math.round(box.clientWidth || 600)); if (Math.abs(w - lastW) < 6 && box.firstChild) return; lastW = w; draw(w); };
    if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(() => run()); ro.observe(box); box._ro = ro; }
    run(); requestAnimationFrame(run);
  }

  function tooltip(box) {
    const tip = H('div', { class: 'tip', role: 'status' }); box.append(tip);
    return {
      show(x, y, rows) {
        tip.replaceChildren();
        for (const r of rows) {
          if (r.head) { tip.append(H('div', { class: 'k', style: 'margin-bottom:3px' }, r.head)); continue; }
          const line = H('div', {}, [H('div', { class: 'v' }, r.value), H('div', { class: 'k' }, [r.color ? H('i', { style: `border-color:${r.color}` }) : null, r.label])]);
          tip.append(line);
        }
        tip.classList.add('on'); const bw = box.clientWidth; const tw = tip.offsetWidth; const th = tip.offsetHeight;
        let left = x + 14; if (left + tw > bw - 4) left = x - tw - 14; if (left < 2) left = 2;
        let top = Math.max(2, y - th - 10); tip.style.left = left + 'px'; tip.style.top = top + 'px';
      },
      hide() { tip.classList.remove('on'); },
    };
  }

  /** Wraps a chart with a "View as table" toggle (every value reachable without hovering). */
  function withTable(chartEl, columns, rows, caption) {
    const wrap = H('div', {});
    const table = H('div', { class: 'scroll-x hide' }, [H('table', { class: 'tbl' }, [
      H('thead', {}, H('tr', {}, columns.map((c, i) => H('th', { class: i ? 'r' : '' }, c)))),
      H('tbody', {}, rows.map((r) => H('tr', {}, r.map((c, i) => H('td', { class: i ? 'r num' : '' }, c))))),
    ])]);
    const btn = H('button', { class: 'viewtoggle', type: 'button', 'aria-label': 'Toggle between chart and table for ' + (caption || 'this chart') }, 'View as table');
    btn.onclick = () => { const showT = table.classList.contains('hide'); table.classList.toggle('hide', !showT); chartEl.classList.toggle('hide', showT); btn.textContent = showT ? 'View as chart' : 'View as table'; };
    wrap.append(chartEl, table, btn); return wrap;
  }

  function legend(items) { return H('div', { class: 'legend' }, items.map((i) => H('span', {}, [H('i', { class: i.box ? 'box' : '', style: i.box ? `background:${i.color}` : `border-color:${i.color}` }), i.label]))); }

  // ------------------------------------------------------------------ cumulative line vs your usual band
  function cumulativeChart(o) {
    // o: {days, day (as-of), current:[cum per day up to day], usual:[cum per day], range:[[min,max]...], monthLabel}
    const box = H('div', { class: 'chart' }); const tip = tooltip(box);
    const cur = o.current, usual = o.usual, band = o.range;
    responsive(box, (W) => {
      const hgt = W < 480 ? 220 : 260; const m = { l: 44, r: 90, t: 12, b: 26 }; const iw = W - m.l - m.r, ih = hgt - m.t - m.b;
      const maxV = Math.max(...usual, ...(band ? band.map((b) => b[1]) : [0]), ...cur, 1); const nm = niceMax(maxV, 4);
      const X = (d) => m.l + ((d - 1) / Math.max(1, o.days - 1)) * iw; const Y = (v) => m.t + ih - (v / nm.top) * ih;
      const svg = S('svg', { viewBox: `0 0 ${W} ${hgt}`, role: 'img', 'aria-label': `Cumulative spending this month versus your usual month` });
      const gridG = S('g', { class: 'grid' }); for (const t of nm.ticks) { gridG.append(S('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) })); svg.append(S('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, axisMoney(t))); }
      svg.prepend(gridG);
      const xt = [1, 8, 15, 22, o.days]; for (const d of xt) svg.append(S('text', { x: X(d), y: hgt - 6, 'text-anchor': d === 1 ? 'start' : d === o.days ? 'end' : 'middle' }, String(d)));
      if (band) { const top = band.map((b, i) => `${X(i + 1)},${Y(b[1])}`); const bot = band.slice(0, o.days).map((b, i) => `${X(i + 1)},${Y(b[0])}`).reverse(); svg.append(S('polygon', { points: [...top.slice(0, o.days), ...bot].join(' '), fill: 'var(--muted)', 'fill-opacity': '.14' })); }
      const path = (arr, upto) => arr.slice(0, upto).map((v, i) => `${i ? 'L' : 'M'}${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
      svg.append(S('path', { d: path(usual, o.days), fill: 'none', stroke: 'var(--muted)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      svg.append(S('path', { d: path(cur, o.day), fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      const ex = X(o.day), ey = Y(cur[o.day - 1]);
      svg.append(S('circle', { cx: ex, cy: ey, r: 5, fill: 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2 }));
      svg.append(S('text', { x: Math.min(ex + 9, W - 4), y: ey - 8, class: 'lbl', 'text-anchor': ex + 70 > W ? 'end' : 'start' }, 'You ' + dollars(cur[o.day - 1])));
      svg.append(S('text', { x: W - m.r + 6, y: Y(usual[o.days - 1]) + 4, class: 'lbl' }, 'Usual ' + dollars(usual[o.days - 1])));
      // crosshair
      const cross = S('line', { y1: m.t, y2: m.t + ih, stroke: 'var(--axis)', 'stroke-width': 1, opacity: 0 }); svg.append(cross);
      const hit = S('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', tabindex: 0, 'aria-label': 'Chart area: use left and right arrow keys to read each day' }); svg.append(hit);
      const at = (d) => { d = Math.max(1, Math.min(o.days, d)); cross.setAttribute('x1', X(d)); cross.setAttribute('x2', X(d)); cross.setAttribute('opacity', 1);
        const rows = [{ head: `${o.monthLabel} day ${d}` }]; if (d <= o.day) rows.push({ value: dollars(cur[d - 1]), label: 'This month', color: 'var(--s1)' }); rows.push({ value: dollars(usual[d - 1]), label: 'Your usual', color: 'var(--muted)' });
        if (band) rows.push({ value: `${dollars(band[d - 1][0])} to ${dollars(band[d - 1][1])}`, label: 'Range in past months', color: 'var(--axis)' }); tip.show(X(d), m.t + 20, rows); return d; };
      let kd = o.day;
      hit.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width); at(Math.round(((px - m.l) / iw) * (o.days - 1)) + 1); });
      hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); tip.hide(); });
      hit.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') kd = at(kd - 1); else if (e.key === 'ArrowRight') kd = at(kd + 1); });
      hit.addEventListener('blur', () => { cross.setAttribute('opacity', 0); tip.hide(); });
      box.querySelector('svg')?.remove(); box.prepend(svg);
    });
    const rows = []; for (let d = 1; d <= o.days; d++) rows.push([String(d), d <= o.day ? dollars(cur[d - 1]) : '', dollars(usual[d - 1]), band ? `${dollars(band[d - 1][0])} to ${dollars(band[d - 1][1])}` : '']);
    const keep = rows.filter((r, i) => i + 1 === 1 || (i + 1) % 3 === 0 || i + 1 === o.day || i + 1 === o.days);
    const wrap = H('div', {}, [legend([{ label: 'This month', color: 'var(--s1)' }, { label: 'Your usual', color: 'var(--muted)' }, { label: 'Range in past months', color: 'color-mix(in srgb, var(--muted) 30%, transparent)', box: true }]), withTable(box, ['Day', 'This month', 'Your usual', 'Range'], keep, 'cumulative spending')]);
    return wrap;
  }

  // ------------------------------------------------------------------ columns
  function columns(o) {
    // o: {items:[{label, value, partial, hi, note}], ref:{value,label}, fmt, aria, labelEvery}
    const box = H('div', { class: 'chart' }); const tip = tooltip(box); const fmt = o.fmt || dollars;
    responsive(box, (W) => {
      const hgt = 220; const m = { l: 44, r: o.ref ? 56 : 10, t: 16, b: 26 }; const iw = W - m.l - m.r, ih = hgt - m.t - m.b; const n = o.items.length;
      const maxV = Math.max(...o.items.map((i) => i.value), o.ref ? o.ref.value : 0, 1); const nm = niceMax(maxV, 4);
      const Y = (v) => m.t + ih - (v / nm.top) * ih; const band = iw / n; const bw = Math.min(24, band * 0.62);
      const svg = S('svg', { viewBox: `0 0 ${W} ${hgt}`, role: 'img', 'aria-label': o.aria || 'Column chart' });
      const gridG = S('g', { class: 'grid' }); for (const t of nm.ticks) { gridG.append(S('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) })); svg.append(S('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, axisMoney(t))); } svg.prepend(gridG);
      const maxI = o.items.reduce((b, it, i) => (it.value > o.items[b].value ? i : b), 0);
      o.items.forEach((it, i) => {
        const cx = m.l + band * i + band / 2; const x = cx - bw / 2; const y = Y(Math.max(0, it.value)); const h = Math.max(0, m.t + ih - y);
        const r = Math.min(4, h, bw / 2); const fill = o.emphasis ? (i === maxI ? 'var(--s1)' : 'var(--axis)') : 'var(--s1)';
        const d = h > 0 ? `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${y + h} Z` : '';
        const bar = S('path', { d, fill, 'fill-opacity': it.partial ? 0.45 : 1, tabindex: 0, 'aria-label': `${it.label}: ${fmt(it.value)}` }); svg.append(bar);
        const hitR = S('rect', { x: cx - band / 2, y: m.t, width: band, height: ih, fill: 'transparent' }); svg.append(hitR);
        const show = () => { tip.show(cx, y, [{ head: it.label + (it.partial ? ' (so far)' : '') }, { value: fmt(it.value), label: o.seriesName || 'Spending', color: 'var(--s1)' }].concat(it.note ? [{ head: it.note }] : [])); bar.setAttribute('fill-opacity', 1); bar.setAttribute('stroke', 'var(--ink)'); bar.setAttribute('stroke-width', 0); };
        const hide = () => { tip.hide(); bar.setAttribute('fill-opacity', it.partial ? 0.45 : 1); };
        hitR.addEventListener('pointermove', show); hitR.addEventListener('pointerleave', hide); bar.addEventListener('focus', show); bar.addEventListener('blur', hide);
        const every = o.labelEvery || (W < 480 && n > 8 ? 2 : 1); if (i % every === 0 || i === n - 1) svg.append(S('text', { x: cx, y: hgt - 6, 'text-anchor': 'middle' }, it.label));
        if (i === n - 1 || (o.emphasis && i === maxI)) svg.append(S('text', { x: cx, y: y - 6, 'text-anchor': 'middle', class: 'lbl' }, fmt(it.value)));
      });
      if (o.ref) { svg.append(S('line', { x1: m.l, x2: W - m.r, y1: Y(o.ref.value), y2: Y(o.ref.value), stroke: 'var(--ink2)', 'stroke-width': 1 })); svg.append(S('text', { x: W - m.r + 6, y: Y(o.ref.value) + 4, class: 'lbl' }, o.ref.label)); }
      svg.append(S('line', { x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, stroke: 'var(--axis)' }));
      box.querySelector('svg')?.remove(); box.prepend(svg);
    });
    return withTable(box, [o.catLabel || 'Period', o.valueLabel || 'Spending'], o.items.map((i) => [i.label + (i.partial ? ' (so far)' : ''), fmt(i.value)]), o.aria);
  }

  // ------------------------------------------------------------------ diverging bars (over / under your usual pace)
  function divergingBars(o) {
    // o: {items:[{label, delta, spent, expected, usual}]}
    const box = H('div', { class: 'chart' }); const tip = tooltip(box);
    responsive(box, (W) => {
      const rowH = 30; const n = o.items.length; const m = { l: W < 480 ? 96 : 130, r: 52, t: 8, b: 22 }; const hgt = m.t + n * rowH + m.b; const iw = W - m.l - m.r;
      const maxPos = Math.max(0, ...o.items.map((i) => i.delta)), maxNeg = Math.max(0, ...o.items.map((i) => -i.delta)); const total = Math.max(maxPos + maxNeg, 100);
      const padNeg = maxNeg > 0 ? 50 : 0; const plotW = iw - padNeg; // room left of the zero line for the value label of "behind" bars
      const zero = m.l + padNeg + (maxNeg / total) * plotW; const sc = plotW / total;
      const svg = S('svg', { viewBox: `0 0 ${W} ${hgt}`, role: 'img', 'aria-label': 'Each category against your usual pace so far this month' });
      o.items.forEach((it, i) => {
        const cy = m.t + i * rowH + rowH / 2; const pos = it.delta >= 0; const len = Math.max(2, Math.abs(it.delta) * sc); const bh = 16; const x = pos ? zero : zero - len; const r = Math.min(4, len);
        const col = pos ? 'var(--div-pos)' : 'var(--div-neg)';
        const d = pos ? `M${zero},${cy - bh / 2} H${zero + len - r} Q${zero + len},${cy - bh / 2} ${zero + len},${cy - bh / 2 + r} V${cy + bh / 2 - r} Q${zero + len},${cy + bh / 2} ${zero + len - r},${cy + bh / 2} H${zero} Z`
          : `M${zero},${cy - bh / 2} H${zero - len + r} Q${zero - len},${cy - bh / 2} ${zero - len},${cy - bh / 2 + r} V${cy + bh / 2 - r} Q${zero - len},${cy + bh / 2} ${zero - len + r},${cy + bh / 2} H${zero} Z`;
        svg.append(S('text', { x: m.l - 10, y: cy + 4, 'text-anchor': 'end', style: 'fill:var(--ink2);font-size:12px' }, it.label.length > 17 ? it.label.slice(0, 16) + '…' : it.label));
        const bar = S('path', { d, fill: col, tabindex: 0, 'aria-label': `${it.label}: ${U.money(it.delta, { round: true, sign: true })} against your usual pace` }); svg.append(bar);
        svg.append(S('text', { x: pos ? zero + len + 6 : zero - len - 6, y: cy + 4, 'text-anchor': pos ? 'start' : 'end', class: 'lbl' }, U.money(it.delta, { round: true, sign: true })));
        const hit = S('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, fill: 'transparent' }); svg.append(hit);
        const show = () => tip.show(Math.min(W - 130, zero + (pos ? len : -len)), cy - 6, [{ head: it.label }, { value: U.money(it.delta, { round: true, sign: true }), label: pos ? 'Ahead of your usual pace' : 'Behind your usual pace' }, { value: dollars(it.spent), label: 'Spent so far' }, { value: dollars(it.expected), label: 'Usual by this day' }]);
        hit.addEventListener('pointermove', show); hit.addEventListener('pointerleave', () => tip.hide()); bar.addEventListener('focus', show); bar.addEventListener('blur', () => tip.hide());
      });
      svg.append(S('line', { x1: zero, x2: zero, y1: m.t, y2: m.t + n * rowH, stroke: 'var(--axis)' }));
      svg.append(S('text', { x: zero - 6, y: hgt - 4, 'text-anchor': 'end' }, maxNeg ? '← behind usual pace' : ''));
      svg.append(S('text', { x: zero + 6, y: hgt - 4, 'text-anchor': 'start' }, maxPos ? 'ahead of usual pace →' : ''));
      box.querySelector('svg')?.remove(); box.prepend(svg);
    });
    return withTable(box, ['Category', 'Against usual', 'Spent so far', 'Usual by now'], o.items.map((i) => [i.label, U.money(i.delta, { round: true, sign: true }), dollars(i.spent), dollars(i.expected)]), 'category pace');
  }

  // ------------------------------------------------------------------ ranked horizontal bars (one hue)
  function rankedBars(o) {
    const box = H('div', { class: 'chart' }); const tip = tooltip(box); const fmt = o.fmt || dollars;
    responsive(box, (W) => {
      const rowH = 28; const n = o.items.length; const m = { l: W < 480 ? 104 : 140, r: 70, t: 4, b: 4 }; const hgt = m.t + n * rowH + m.b; const iw = W - m.l - m.r; const maxV = Math.max(...o.items.map((i) => i.value), 1);
      const svg = S('svg', { viewBox: `0 0 ${W} ${hgt}`, role: 'img', 'aria-label': o.aria || 'Ranked bars' });
      o.items.forEach((it, i) => {
        const cy = m.t + i * rowH + rowH / 2; const len = Math.max(2, (it.value / maxV) * iw); const bh = 14; const r = Math.min(4, len); const x0 = m.l;
        svg.append(S('text', { x: m.l - 10, y: cy + 4, 'text-anchor': 'end', style: 'fill:var(--ink2);font-size:12px' }, it.label.length > 19 ? it.label.slice(0, 18) + '…' : it.label));
        const d = `M${x0},${cy - bh / 2} H${x0 + len - r} Q${x0 + len},${cy - bh / 2} ${x0 + len},${cy - bh / 2 + r} V${cy + bh / 2 - r} Q${x0 + len},${cy + bh / 2} ${x0 + len - r},${cy + bh / 2} H${x0} Z`;
        const bar = S('path', { d, fill: 'var(--s1)', tabindex: 0, 'aria-label': `${it.label}: ${fmt(it.value)}` }); svg.append(bar);
        svg.append(S('text', { x: x0 + len + 6, y: cy + 4, class: 'lbl' }, fmt(it.value)));
        const hit = S('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, fill: 'transparent' }); svg.append(hit);
        const show = () => tip.show(Math.min(W - 140, x0 + len), cy - 8, [{ head: it.label }, { value: fmt(it.value), label: o.seriesName || 'Total', color: 'var(--s1)' }].concat(it.sub ? [{ head: it.sub }] : []));
        hit.addEventListener('pointermove', show); hit.addEventListener('pointerleave', () => tip.hide()); bar.addEventListener('focus', show); bar.addEventListener('blur', () => tip.hide());
      });
      svg.append(S('line', { x1: m.l, x2: m.l, y1: m.t, y2: m.t + n * rowH, stroke: 'var(--axis)' }));
      box.querySelector('svg')?.remove(); box.prepend(svg);
    });
    return withTable(box, ['Name', o.valueLabel || 'Total', 'Detail'], o.items.map((i) => [i.label, fmt(i.value), i.sub || '']), o.aria);
  }

  BT.charts = { cumulativeChart, columns, divergingBars, rankedBars, withTable, legend, H, S, dollars, axisMoney };
})(typeof window !== 'undefined' ? window : globalThis);
