/* Tiny UI toolkit: element builder (text only, never innerHTML with data), icons, toast, modal. */
(function (g) {
  const BT = (g.BT = g.BT || {});
  const SVGNS = 'http://www.w3.org/2000/svg';

  /** h('div', {class:'x', onclick: fn, 'data-a': 1}, child, 'text', [more]) */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k]; if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v; else if (k === 'checked') e.checked = !!v; else if (k === 'disabled') e.disabled = !!v; else if (k === 'selected') e.selected = !!v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else e.append(c.nodeType ? c : document.createTextNode(String(c))); };
    kids.forEach(add); return e;
  }

  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>', add: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    check: '<path d="M5 12l5 5 9-10"/>', alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h.01"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    face: '<path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2"/><path d="M9 10v1.5M15 10v1.5M12 10v3.5h-1M9 16c1.8 1.4 4.2 1.4 6 0"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>', sync: '<path d="M20 11a8 8 0 00-14-4M4 13a8 8 0 0014 4"/><path d="M20 4v5h-5M4 20v-5h5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', down: '<path d="M6 9l6 6 6-6"/>', file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
  };
  function icon(name) { const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICONS[name] || ''; return s; }

  let toastEl = null; let toastT = null;
  function toast(msg, action) {
    if (toastEl) toastEl.remove(); clearTimeout(toastT);
    toastEl = h('div', { class: 'toast', role: 'status' }, h('span', {}, msg), action ? h('button', { onclick: () => { action.fn(); toastEl && toastEl.remove(); } }, action.label) : null);
    document.body.append(toastEl); toastT = setTimeout(() => toastEl && toastEl.remove(), action ? 9000 : 3600);
  }

  function modal(build) {
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(); } });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }); bg.append(box);
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', onKey);
    build(box, close); document.body.append(bg); const f = box.querySelector('input,select,textarea,button'); if (f) f.focus(); return { close };
  }
  function confirmBox(title, body, okLabel, danger) {
    return new Promise((res) => modal((box, close) => {
      box.append(h('h2', {}, title), h('p', { class: 'ink2', style: 'margin:8px 0 16px' }, body),
        h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn', onclick: () => { close(); res(false); } }, 'Cancel'), h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { close(); res(true); } }, okLabel || 'OK')));
    }));
  }
  function download(name, text, mime) { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  BT.ui = { h, icon, toast, modal, confirmBox, download, sleep, debounce };
})(window);
