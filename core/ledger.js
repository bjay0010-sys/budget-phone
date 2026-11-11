/* The ledger: creating transactions, merging without double-counting, and applying edits.
   Merge rule (why overlapping screenshots and re-imports are safe):
   - Rows are matched on date + amount + the first letters of the cleaned merchant name, so OCR wobble in a
     name ("Coles Clayton" vs "Coles Clayt0n") doesn't create a duplicate.
   - Two identical purchases on one day are legitimate, so matching is by COUNT, not by "seen before":
     within one import, overlapping screenshots are collapsed to the highest count seen in any one screenshot;
     against what's already saved, only the surplus is new. */
(function (g) {
  const BT = (g.BT = g.BT || {});
  if (!BT.util && typeof require !== 'undefined') require('./util.js');
  if (!BT.cats && typeof require !== 'undefined') require('./categories.js');
  const U = BT.util; const C = BT.cats;

  function looseKey(date, amount, desc) {
    const mk = C.merchantKey(desc) || String(desc || '').toLowerCase();
    const first = (mk.split(' ')[0] || '').replace(/[^a-z]/g, '').slice(0, 4);
    return `${date}|${amount}|${first}`;
  }

  function makeTxn(row, ctx) {
    ctx = ctx || {};
    const cat = row.category ? { category: row.category, source: 'manual' } : C.categorise(row.desc, row.amount, ctx.rules);
    return {
      id: row.id || U.uid(), date: row.date, desc: row.desc, merchant: C.prettyName(row.desc), amount: row.amount,
      category: cat.category, catSource: cat.source, source: ctx.source || row.source || 'manual', batch: ctx.batch || row.batch || null,
      note: row.note || '', createdAt: row.createdAt || Date.now(),
    };
  }

  /**
   * incoming: [{date, desc, amount, shot?}] (shot = which screenshot/file it came from)
   * existing: saved transactions.
   * Returns incoming rows annotated with .dup (true when already saved or repeated across screenshots) and .dupOf.
   */
  function planMerge(existing, incoming) {
    const have = new Map(); for (const t of existing) { const k = looseKey(t.date, t.amount, t.desc); have.set(k, (have.get(k) || 0) + 1); }
    // per key: how many rows each shot contains
    const byKey = new Map();
    incoming.forEach((r, i) => { r._i = i; if (r.force) { r.dup = false; delete r.dupReason; return; } const k = looseKey(r.date, r.amount, r.desc); let e = byKey.get(k); if (!e) byKey.set(k, (e = new Map())); const s = r.shot || 0; if (!e.has(s)) e.set(s, []); e.get(s).push(r); });
    for (const [k, shots] of byKey) {
      let best = []; for (const arr of shots.values()) if (arr.length > best.length) best = arr;
      const keep = new Set(best);
      const existingN = have.get(k) || 0;
      let freeSlots = Math.max(0, best.length - existingN);
      for (const arr of shots.values()) for (const r of arr) {
        if (!keep.has(r)) { r.dup = true; r.dupReason = 'also in another screenshot'; continue; }
        if (freeSlots > 0) { r.dup = false; freeSlots--; } else { r.dup = true; r.dupReason = 'already saved'; }
      }
    }
    for (const r of incoming) delete r._i;
    return incoming;
  }

  /** Apply a user rule retroactively: returns the number of transactions changed. */
  function recategoriseAll(txns, rules, onlyAuto) {
    let n = 0;
    for (const t of txns) {
      if (onlyAuto && (t.catSource === 'manual')) continue;
      const c = C.categorise(t.desc, t.amount, rules);
      if (c.category !== t.category) { t.category = c.category; t.catSource = c.source; n++; }
    }
    return n;
  }

  /** Learn from a manual correction: a rule keyed on the cleaned merchant name. */
  function ruleFor(desc, category) {
    const k = C.merchantKey(desc);
    if (!k || k.length < 3) return null;
    return { id: U.uid(), pattern: k, category, created: Date.now() };
  }

  /** Apply an op from the phone (or anywhere) to a state object. Idempotent by opId. */
  function applyOp(state, op) {
    state.appliedOps = state.appliedOps || [];
    if (op.opId && state.appliedOps.includes(op.opId)) return { applied: false };
    let result = { applied: true };
    if (op.type === 'add') {
      const rows = (op.rows || []).filter((r) => r && U.validISO(r.date) && Number.isInteger(r.amount) && r.desc);
      planMerge(state.transactions, rows);
      let added = 0;
      for (const r of rows) { if (r.dup) continue; state.transactions.push(makeTxn(r, { rules: state.rules, source: 'phone', batch: op.opId })); added++; }
      result.added = added; result.skipped = rows.length - added;
    } else if (op.type === 'update') {
      const t = state.transactions.find((x) => x.id === op.id);
      if (t) { Object.assign(t, pick(op.patch || {}, ['category', 'note', 'desc', 'amount', 'date'])); if (op.patch && op.patch.category) t.catSource = 'manual'; }
    } else if (op.type === 'delete') {
      state.transactions = state.transactions.filter((x) => x.id !== op.id);
    } else if (op.type === 'settings') {
      state.settings = Object.assign(state.settings || {}, pick(op.patch || {}, ['name', 'savingsGoalPct', 'baselineMonths']));
    } else if (op.type === 'review') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(op.week || '')) { state.reviews = state.reviews || {}; state.reviews[op.week] = String(op.text || '').slice(0, 5000); }
    } else if (op.type === 'delrule') {
      state.rules = state.rules.filter((r) => r.id !== op.id);
    } else if (op.type === 'rule' && op.pattern && C.BYID[op.category]) {
      const pat = String(op.pattern).slice(0, 80); state.rules = state.rules.filter((r) => r.pattern !== pat);
      state.rules.unshift({ id: U.uid(), pattern: pat, category: op.category, created: Date.now() });
      recategoriseAll(state.transactions, state.rules, true);
    }
    if (op.opId) { state.appliedOps.push(op.opId); if (state.appliedOps.length > 3000) state.appliedOps = state.appliedOps.slice(-2000); }
    return result;
  }
  function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }

  BT.ledger = { looseKey, makeTxn, planMerge, recategoriseAll, ruleFor, applyOp };
  if (typeof module !== 'undefined' && module.exports) module.exports = BT.ledger;
})(typeof window !== 'undefined' ? window : globalThis);
