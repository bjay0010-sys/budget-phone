/* Budget Tracker core: small helpers shared by the PC app, the phone app and the tests.
   Money is always integer CENTS. Spending is negative, income is positive.
   Dates are plain 'YYYY-MM-DD' strings (no time zones to get wrong). */
(function (g) {
  const BT = (g.BT = g.BT || {});
  const pad = (n) => String(n).padStart(2, '0');

  const U = {
    pad,
    iso: (y, m, d) => `${y}-${pad(m)}-${pad(d)}`,
    parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
    fmt(dt) { return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; },
    addDays(s, n) { const dt = U.parse(s); dt.setUTCDate(dt.getUTCDate() + n); return U.fmt(dt); },
    daysBetween(a, b) { return Math.round((U.parse(b) - U.parse(a)) / 864e5); },
    monthKey: (s) => s.slice(0, 7),
    daysInMonth(mk) { const [y, m] = mk.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); },
    addMonths(mk, n) { let [y, m] = mk.split('-').map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return `${y}-${pad(m)}`; },
    dow: (s) => U.parse(s).getUTCDay(), // 0 = Sunday
    weekStart(s) { const d = U.dow(s); return U.addDays(s, -((d + 6) % 7)); }, // Monday
    validISO(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; return U.fmt(U.parse(s)) === s; },
    /** Today in Melbourne (the user's time zone). Tests can override U.nowOverride. */
    today() {
      if (U.nowOverride) return U.nowOverride;
      try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
      catch (e) { return U.fmt(new Date()); }
    },
    nowOverride: null,

    // ---- money ----
    dollars: (c) => c / 100,
    /** Format cents as $1,234.56 (sign-aware). opts.sign forces +/-; opts.round drops cents. */
    money(c, opts) {
      opts = opts || {};
      const neg = c < 0; const a = Math.abs(c);
      const v = opts.round ? Math.round(a / 100) : (a / 100);
      let s = opts.round ? v.toLocaleString('en-AU') : v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      s = '$' + s;
      if (neg) return '-' + s;
      return (opts.sign && c > 0 ? '+' : '') + s;
    },
    /** "$12.50", "-12.5", "1,234.00" -> cents, or null */
    toCents(str) {
      if (typeof str === 'number') return Math.round(str * 100);
      let s = String(str).trim(); if (!s) return null;
      let neg = false;
      if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
      if (/[-−–—]/.test(s[0] || '') || /^\$?\s*[-−–—]/.test(s)) neg = true;
      if (/\bDR\b/i.test(s)) neg = true;
      s = s.replace(/[^0-9.,]/g, '');
      if (!s) return null;
      // 1.234,56 (euro style) is not expected for AU banks, but handle a lone comma decimal
      if (/,\d{2}$/.test(s) && !/\./.test(s)) s = s.replace(',', '.');
      s = s.replace(/,/g, '');
      const n = Number(s); if (!isFinite(n)) return null;
      const c = Math.round(n * 100);
      return neg ? -c : c;
    },

    // ---- ids / hashing ----
    uid() {
      const r = (g.crypto && g.crypto.getRandomValues) ? g.crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 4e9 >>> 0, Math.random() * 4e9 >>> 0];
      return Date.now().toString(36) + '-' + (r[0] >>> 0).toString(36) + (r[1] >>> 0).toString(36);
    },
    fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); },
    median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
    mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; },
    sum(a) { let t = 0; for (const x of a) t += x; return t; },
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    MONTHS: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    DOW: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    monthLabel(mk, short) { const [y, m] = mk.split('-').map(Number); const n = U.MONTHS[m - 1]; return short ? n.slice(0, 3) : `${n} ${y}`; },
    dateLabel(s) { const dt = U.parse(s); return `${U.DOW[dt.getUTCDay()]} ${dt.getUTCDate()} ${U.MONTHS[dt.getUTCMonth()].slice(0, 3)}`; },
  };
  BT.util = U;
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);
