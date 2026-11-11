/* Analytics: baseline from your history, "on track" for the month so far, trends, and habits.
   Conventions: "spend" is a positive number of cents (refunds reduce it). Only the 'living' group counts as spending.
   Transfers are ignored; bookmaker and eBay are reported as their own net lines; savings are reported as saved. */
(function (g) {
  const BT = (g.BT = g.BT || {});
  if (!BT.util && typeof require !== 'undefined') require('./util.js');
  if (!BT.cats && typeof require !== 'undefined') require('./categories.js');
  const U = BT.util; const C = BT.cats;
  const $ = (c) => U.money(c, { round: true });
  const LIVING = C.CATS.filter((c) => c.group === 'living').map((c) => c.id);
  const DISCRETIONARY = ['eating', 'coffee', 'fun', 'shopping', 'subs'];

  /** One pass over the ledger: per-month totals and per-category per-day spend. */
  function buildIndex(txns) {
    const months = {}; let first = null; let last = null;
    for (const t of txns) {
      if (!first || t.date < first) first = t.date; if (!last || t.date > last) last = t.date;
      const mk = t.date.slice(0, 7);
      const m = months[mk] || (months[mk] = { mk, n: 0, days: U.daysInMonth(mk), spend: 0, income: 0, bookie: 0, ebay: 0, saving: 0, byCat: {}, catDaily: {}, lastDate: t.date, firstDate: t.date });
      m.n++; if (t.date > m.lastDate) m.lastDate = t.date; if (t.date < m.firstDate) m.firstDate = t.date;
      const grp = C.group(t.category);
      if (grp === 'living') {
        const sp = -t.amount; m.spend += sp; m.byCat[t.category] = (m.byCat[t.category] || 0) + sp;
        const arr = m.catDaily[t.category] || (m.catDaily[t.category] = new Array(m.days).fill(0)); arr[Number(t.date.slice(8)) - 1] += sp;
      } else if (grp === 'income') m.income += t.amount;
      else if (grp === 'bookie') m.bookie += t.amount;
      else if (grp === 'ebay') m.ebay += t.amount;
      else if (grp === 'saving') m.saving += -t.amount;
    }
    return { months, first, last };
  }

  function cumulative(arr, upTo) { let s = 0; const n = Math.min(upTo, arr.length); for (let i = 0; i < n; i++) s += arr[i]; return s; }
  function totalDaily(m) { const out = new Array(m.days).fill(0); for (const a of Object.values(m.catDaily)) for (let i = 0; i < a.length; i++) out[i] += a[i]; return out; }

  /**
   * Baseline = your usual month, from complete months before the current one.
   * Drops a leading month that starts late (partial history) and a latest month whose data stops early.
   */
  function baseline(idx, asOf, opts) {
    opts = opts || {}; const want = opts.months || 6; const curMk = asOf.slice(0, 7);
    let mks = Object.keys(idx.months).filter((k) => k < curMk).sort();
    const notes = [];
    if (mks.length) {
      const f = idx.months[mks[0]];
      if (Number(idx.first.slice(8)) > 7 && idx.first.slice(0, 7) === mks[0] && mks.length > 1) { mks.shift(); notes.push(`${U.monthLabel(f.mk)} was left out: your history starts partway through it.`); }
    }
    if (mks.length) {
      const l = idx.months[mks[mks.length - 1]];
      if (l.days - Number(l.lastDate.slice(8)) > 10) { mks.pop(); notes.push(`${U.monthLabel(l.mk)} was left out: its data stops on the ${Number(l.lastDate.slice(8))}th.`); }
    }
    mks = mks.slice(-want);
    const out = { months: mks, notes, ok: mks.length >= 2, perCat: {}, total: null, income: null, cum: {}, cumTotal: null, ranges: null };
    if (!mks.length) return out;
    const ms = mks.map((k) => idx.months[k]);
    const cats = new Set(); ms.forEach((m) => Object.keys(m.byCat).forEach((c) => cats.add(c)));
    for (const c of cats) {
      const vals = ms.map((m) => m.byCat[c] || 0);
      out.perCat[c] = { mean: U.mean(vals), median: U.median(vals), min: Math.min(...vals), max: Math.max(...vals), vals };
      out.cum[c] = Array.from({ length: 31 }, (_, d) => U.mean(ms.map((m) => (m.catDaily[c] ? cumulative(m.catDaily[c], d + 1) : 0))));
    }
    const tv = ms.map((m) => m.spend);
    out.total = { mean: U.mean(tv), median: U.median(tv), min: Math.min(...tv), max: Math.max(...tv), vals: tv };
    out.income = { mean: U.mean(ms.map((m) => m.income)), min: Math.min(...ms.map((m) => m.income)), max: Math.max(...ms.map((m) => m.income)), vals: ms.map((m) => m.income) };
    const tdaily = ms.map(totalDaily);
    out.cumTotal = Array.from({ length: 31 }, (_, d) => U.mean(tdaily.map((a) => cumulative(a, d + 1))));
    out.cumRange = Array.from({ length: 31 }, (_, d) => { const v = tdaily.map((a) => cumulative(a, d + 1)); return [Math.min(...v), Math.max(...v)]; });
    return out;
  }

  function status(delta, expected) {
    if (delta > Math.max(2500, 0.2 * expected)) return 'over';
    if (delta > Math.max(1000, 0.08 * expected)) return 'watch';
    if (delta < -Math.max(1000, 0.15 * expected)) return 'under';
    return 'on';
  }

  /** Month-to-date vs the same point in your usual month. */
  function onTrack(idx, base, asOf) {
    const curMk = asOf.slice(0, 7); const m = idx.months[curMk] || { spend: 0, byCat: {}, income: 0, days: U.daysInMonth(curMk) };
    const day = Number(asOf.slice(8));
    const res = { month: curMk, day, daysInMonth: m.days, ok: base.ok, spent: m.spend, income: m.income };
    if (!base.ok) return res;
    const expected = base.cumTotal[Math.min(day, 31) - 1];
    const usual = base.total.mean;
    res.expected = expected; res.usual = usual; res.range = base.cumRange[Math.min(day, 31) - 1];
    res.delta = m.spend - expected; res.pct = expected > 0 ? res.delta / expected : null; res.status = status(res.delta, expected);
    res.projected = m.spend + Math.max(0, usual - expected);
    res.cats = [];
    const all = new Set([...Object.keys(m.byCat), ...Object.keys(base.perCat)]);
    for (const c of all) {
      const spent = m.byCat[c] || 0; const bc = base.perCat[c];
      const exp = bc ? base.cum[c][Math.min(day, 31) - 1] : 0; const usualC = bc ? bc.mean : 0;
      if (spent === 0 && usualC < 500) continue;
      res.cats.push({ cat: c, spent, expected: exp, usual: usualC, delta: spent - exp, status: bc ? status(spent - exp, exp) : (spent > 3000 ? 'new' : 'on'), isNew: !bc });
    }
    res.cats.sort((a, b) => b.delta - a.delta);
    return res;
  }

  function monthlySeries(idx, asOf, n) {
    const curMk = asOf.slice(0, 7); const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const mk = U.addMonths(curMk, -i); const m = idx.months[mk];
      out.push({ mk, spend: m ? m.spend : 0, income: m ? m.income : 0, bookie: m ? m.bookie : 0, ebay: m ? m.ebay : 0, saving: m ? m.saving : 0, byCat: m ? m.byCat : {}, partial: mk === curMk, has: !!m });
    }
    return out;
  }

  function weeklySeries(txns, asOf, n) {
    const ws = U.weekStart(asOf); const out = []; const map = {};
    for (let i = n - 1; i >= 0; i--) { const w = U.addDays(ws, -7 * i); map[w] = { week: w, spend: 0, partial: i === 0 }; out.push(map[w]); }
    for (const t of txns) { if (C.group(t.category) !== 'living') continue; const w = U.weekStart(t.date); if (map[w]) map[w].spend += -t.amount; }
    return out;
  }

  // ------------------------------------------------------------------ habits
  function livingIn(txns, from, to) { return txns.filter((t) => t.date >= from && t.date <= to && C.group(t.category) === 'living'); }

  function recurring(txns, asOf) {
    const groups = new Map();
    for (const t of txns) {
      if (t.amount >= 0) continue; const grp = C.group(t.category); if (grp !== 'living' && grp !== 'saving') continue;
      const key = (C.merchantKey(t.desc) || t.desc.toLowerCase()); if (!key) continue;
      let arr = groups.get(key); if (!arr) groups.set(key, (arr = [])); arr.push(t);
    }
    const out = [];
    for (const [key, arr] of groups) {
      if (arr.length < 3) continue;
      // cluster by amount (within 8%)
      const sorted = [...arr].sort((a, b) => a.amount - b.amount);
      let cluster = [sorted[0]];
      const flush = () => { if (cluster.length >= 3) evalCluster(key, cluster); };
      const evalCluster = (k, cl) => {
        const dates = cl.map((t) => t.date).sort(); const gaps = []; for (let i = 1; i < dates.length; i++) gaps.push(U.daysBetween(dates[i - 1], dates[i]));
        const gap = U.median(gaps); let per = null; let perYear = 0;
        if (gap >= 6 && gap <= 8) { per = 'weekly'; perYear = 52; } else if (gap >= 13 && gap <= 16) { per = 'fortnightly'; perYear = 26; } else if (gap >= 27 && gap <= 34) { per = 'monthly'; perYear = 12; }
        if (!per) return;
        const spread = gaps.filter((x) => Math.abs(x - gap) <= Math.max(2, gap * 0.2)).length / gaps.length; if (spread < 0.6) return;
        const amt = Math.abs(U.median(cl.map((t) => t.amount)));
        const stillActive = U.daysBetween(dates[dates.length - 1], asOf) <= gap * 2 + 5;
        out.push({ key: k, name: C.prettyName(cl[0].desc), category: cl[0].category, every: per, amount: amt, count: cl.length, perYear: amt * perYear, active: stillActive, last: dates[dates.length - 1] });
      };
      for (let i = 1; i < sorted.length; i++) {
        if (Math.abs(sorted[i].amount - cluster[0].amount) <= Math.abs(cluster[0].amount) * 0.08 + 50) cluster.push(sorted[i]);
        else { flush(); cluster = [sorted[i]]; }
      }
      flush();
    }
    return out.filter((r) => r.active).sort((a, b) => b.perYear - a.perYear);
  }

  function habits(txns, asOf, idx, base) {
    const from = U.addDays(asOf, -89); const win = livingIn(txns, from, asOf);
    const spanDays = Math.max(1, Math.min(90, idx.first ? U.daysBetween(idx.first, asOf) + 1 : 90));
    const perMonth = (c) => c * 30.4 / spanDays;
    const H = { spanDays, from, windowSpend: U.sum(win.map((t) => -t.amount)) };

    // day of week
    const dowTot = new Array(7).fill(0); const dowDays = new Array(7).fill(0);
    for (let i = 0; i < spanDays; i++) dowDays[U.dow(U.addDays(asOf, -i))]++;
    for (const t of win) dowTot[U.dow(t.date)] += -t.amount;
    H.dow = dowTot.map((v, d) => ({ dow: d, label: U.DOW[d], total: v, avg: dowDays[d] ? v / dowDays[d] : 0 }));
    const weekendShare = (dowTot[0] + dowTot[6]) / (H.windowSpend || 1); H.weekendShare = weekendShare;

    // fixed repeating charges first, so they are not mistaken for impulse habits
    H.recurring = recurring(txns.filter((t) => t.date >= U.addDays(asOf, -400)), asOf);
    const recKeys = new Set(H.recurring.map((r) => r.key));
    // small purchases (the "frequency leak")
    const small = win.filter((t) => -t.amount > 0 && -t.amount < 1500 && C.group(t.category) === 'living' && !recKeys.has(C.merchantKey(t.desc) || t.desc.toLowerCase()));
    const smallByCat = {}; for (const t of small) { const o = smallByCat[t.category] || (smallByCat[t.category] = { n: 0, total: 0 }); o.n++; o.total += -t.amount; }
    H.small = { n: small.length, total: U.sum(small.map((t) => -t.amount)), perMonth: perMonth(U.sum(small.map((t) => -t.amount))), byCat: smallByCat };

    // merchants
    const mm = new Map();
    for (const t of win) { if (t.amount >= 0) continue; const k = C.merchantKey(t.desc) || t.desc.toLowerCase(); const o = mm.get(k) || { key: k, name: C.prettyName(t.desc), category: t.category, n: 0, total: 0 }; o.n++; o.total += -t.amount; mm.set(k, o); }
    H.merchants = [...mm.values()].sort((a, b) => b.total - a.total);
    H.regulars = [...mm.values()].filter((o) => o.n >= 6).sort((a, b) => b.total - a.total);


    // month shape: share of spend by week of month (last 3 complete months + current)
    const shape = [0, 0, 0, 0]; let shapeTot = 0;
    for (const t of txns) { if (C.group(t.category) !== 'living' || t.date < U.addDays(asOf, -120)) continue; const d = Number(t.date.slice(8)); shape[d <= 7 ? 0 : d <= 14 ? 1 : d <= 21 ? 2 : 3] += -t.amount; shapeTot += -t.amount; }
    H.monthShape = shape.map((v) => (shapeTot ? v / shapeTot : 0));

    // payday effect: spend in the 3 days after each pay vs the usual daily rate
    const pays = txns.filter((t) => t.category === 'pay' && t.amount > 0 && t.date >= U.addDays(asOf, -120)).map((t) => t.date).sort();
    const payDays = [...new Set(pays)];
    if (payDays.length >= 3) {
      const daily = {}; for (const t of win) daily[t.date] = (daily[t.date] || 0) + -t.amount;
      const avgDaily = H.windowSpend / spanDays; let after = 0; let n = 0;
      for (const p of payDays) { if (p < from) continue; for (let i = 0; i < 3; i++) { const d = U.addDays(p, i); if (d <= asOf) { after += daily[d] || 0; n++; } } }
      if (n >= 6) H.payday = { ratio: (after / n) / (avgDaily || 1), avgAfter: after / n, avgDaily, paydays: payDays.length };
    }

    // savings rate over last 3 complete months
    const curMk = asOf.slice(0, 7); const last3 = [1, 2, 3].map((i) => idx.months[U.addMonths(curMk, -i)]).filter(Boolean);
    if (last3.length >= 2) {
      const inc = U.sum(last3.map((m) => m.income)); const sp = U.sum(last3.map((m) => m.spend));
      H.savings = { months: last3.length, income: inc / last3.length, spend: sp / last3.length, rate: inc > 0 ? (inc - sp) / inc : null, lowestIncome: Math.min(...last3.map((m) => m.income)), incomeVolatility: last3.length > 1 && inc > 0 ? (Math.max(...last3.map((m) => m.income)) - Math.min(...last3.map((m) => m.income))) / (inc / last3.length) : 0 };
    }
    // excluded flows over the window
    const ex = { bookie: 0, ebay: 0, bookieIn: 0, bookieOut: 0 };
    for (const t of txns) { if (t.date < from || t.date > asOf) continue; const gp = C.group(t.category); if (gp === 'bookie') { ex.bookie += t.amount; if (t.amount < 0) ex.bookieIn += -t.amount; else ex.bookieOut += t.amount; } if (gp === 'ebay') ex.ebay += t.amount; }
    H.excluded = ex;
    H.perMonth = perMonth;
    return H;
  }

  // ------------------------------------------------------------------ insights
  /** Plain, specific, ranked. Each: {id, level, title, detail, impact (cents/month), do} */
  function insights(idx, base, track, H, settings) {
    const out = []; settings = settings || {};
    const add = (o) => out.push(Object.assign({ level: 'info', impact: 0 }, o));

    if (track && track.ok) {
      const worst = track.cats.filter((c) => c.status === 'over' && !c.isNew && c.delta > 2500).slice(0, 3);
      for (const c of worst) {
        add({ id: 'over-' + c.cat, level: 'high', impact: c.delta, title: `${C.name(c.cat)} is ${$(c.delta)} ahead of your usual pace`,
          detail: `${$(c.spent)} spent so far this month. At this point in a normal month you'd be around ${$(c.expected)}.`,
          do: `Find the 2-3 purchases that account for the gap. Were they planned, or drift?` });
      }
      const fresh = track.cats.filter((c) => c.isNew && c.spent > 3000).slice(0, 2);
      for (const c of fresh) add({ id: 'new-' + c.cat, level: 'med', impact: c.spent, title: `${C.name(c.cat)} is new: ${$(c.spent)} with no history behind it`, detail: 'Nothing like this appears in your baseline months, so there is no usual pace to compare to.', do: 'One-off, or the start of a new regular cost?' });
      if (track.status === 'under' && track.delta < -5000) add({ id: 'under', level: 'info', title: `You're ${$(-track.delta)} under your usual pace`, detail: 'Check this is real restraint and not just purchases that have not been imported yet.', do: 'Confirm your latest screenshots are all in.' });
    }

    if (H.small && H.small.n >= 15) {
      const top = Object.entries(H.small.byCat).sort((a, b) => b[1].total - a[1].total)[0];
      add({ id: 'small', level: H.small.perMonth > 15000 ? 'high' : 'med', impact: Math.round(H.small.perMonth * 0.3),
        title: `${H.small.n} purchases under $15 add up to about ${$(H.small.perMonth)} a month`,
        detail: `Biggest source: ${C.name(top[0])} (${top[1].n} purchases, ${$(top[1].total)}). Each one feels free. The total does not.`,
        do: `Cutting a third of these is roughly ${$(H.small.perMonth * 0.3)} a month.` });
    }

    for (const r of (H.regulars || []).slice(0, 3)) {
      if (['rent', 'bills', 'uni'].includes(r.category)) continue;
      add({ id: 'reg-' + r.key, level: 'info', impact: Math.round(H.perMonth(r.total) * 0.25), title: `${r.name}: ${r.n} visits in ${H.spanDays} days, ${$(r.total)} total`, detail: `That is about ${$(H.perMonth(r.total))} a month, ${$(r.total / r.n)} each time.`, do: 'Is this a deliberate habit, or one you have never priced?' });
    }

    const subs = (H.recurring || []).filter((r) => ['subs', 'gym', 'bills', 'fun', 'health', 'personal', 'other', 'uncat'].includes(r.category));
    const subsYear = U.sum(subs.map((r) => r.perYear));
    if (subs.length >= 3) add({ id: 'subs', level: subsYear > 60000 ? 'med' : 'info', impact: Math.round(subsYear / 12 * 0.25), title: `${subs.length} recurring charges cost about ${$(subsYear)} a year`, detail: subs.slice(0, 5).map((r) => `${r.name} ${$(r.amount)} ${r.every}`).join('; ') + (subs.length > 5 ? '...' : ''), do: 'For each: did you use it this month? Cancel any you did not.' });

    if (H.payday && H.payday.ratio > 1.5) add({ id: 'payday', level: 'med', impact: Math.round((H.payday.avgAfter - H.payday.avgDaily) * 3 * 2), title: `Spending jumps ${Math.round((H.payday.ratio - 1) * 100)}% in the 3 days after payday`, detail: `${$(H.payday.avgAfter)} a day after pay vs ${$(H.payday.avgDaily)} a day normally (${H.payday.paydays} paydays).`, do: 'Move a fixed amount to savings the day pay lands, before the spike.' });

    if (H.savings && H.savings.rate !== null) {
      const goal = (settings.savingsGoalPct || 0) / 100;
      if (H.savings.rate < 0) add({ id: 'deficit', level: 'high', impact: Math.round(H.savings.spend - H.savings.income), title: `You spent more than you earned: ${$(H.savings.spend)} out vs ${$(H.savings.income)} in, per month`, detail: `Averaged over the last ${H.savings.months} full months.`, do: 'This is the number that matters most. Everything else is secondary.' });
      else if (goal && H.savings.rate < goal) add({ id: 'goal', level: 'med', impact: Math.round(goal * H.savings.income - (H.savings.income - H.savings.spend)), title: `Saving ${Math.round(H.savings.rate * 100)}% of income against a ${Math.round(goal * 100)}% goal`, detail: `The gap is about ${$(goal * H.savings.income - (H.savings.income - H.savings.spend))} a month.`, do: 'Pick which category absorbs it before you pick which ones feel painful.' });
      if (H.savings.incomeVolatility > 0.25) add({ id: 'income-var', level: 'info', title: `Your income swings by ${Math.round(H.savings.incomeVolatility * 100)}% month to month`, detail: `Lowest recent month: ${$(H.savings.lowestIncome)}.`, do: `Budget against ${$(H.savings.lowestIncome)}, not your average. Treat anything above it as a bonus.` });
    }

    if (H.monthShape && H.monthShape[3] > 0.34) add({ id: 'shape', level: 'info', title: `${Math.round(H.monthShape[3] * 100)}% of your spending lands in the last week of the month`, detail: 'Days 22 onward carry more than their share (a quarter would be even).', do: 'Is that bills and rent, or discretionary spending when you feel you have room?' });
    if (H.weekendShare > 0.5) add({ id: 'weekend', level: 'info', title: `${Math.round(H.weekendShare * 100)}% of spending happens on weekends`, detail: 'Weekends are 2 of 7 days.', do: 'Plan the weekend spend before the weekend, not during it.' });

    const ex = H.excluded;
    if (ex && ex.bookieIn > 0) {
      const net = ex.bookie; const net30 = H.perMonth(net);
      add({ id: 'bookie', level: net < -5000 ? 'med' : 'info', impact: 0, title: `Bookmaker net over ${H.spanDays} days: ${U.money(net, { round: true, sign: true })}`, detail: `${$(ex.bookieIn)} deposited, ${$(ex.bookieOut)} withdrawn. Kept out of your living-spend numbers.`, do: net < 0 ? `Track it against the promo value you extract. If the loss is bigger than the bonuses earned, the method is leaking.` : 'Keep logging every deposit and withdrawal so this stays honest.' });
    }
    out.sort((a, b) => ({ high: 0, med: 1, info: 2 }[a.level] - { high: 0, med: 1, info: 2 }[b.level]) || b.impact - a.impact);
    return out;
  }

  /** Reflection prompts from the biggest gaps (the app asks; you answer). */
  function reflectionPrompts(track, H) {
    const p = [];
    if (track && track.ok) {
      const top = track.cats.filter((c) => c.delta > 2000 && !c.isNew).slice(0, 2);
      for (const c of top) p.push(`${C.name(c.cat)} is ${$(c.delta)} over your usual pace. What was different this time: a specific event, or gradual drift?`);
      const under = track.cats.filter((c) => c.delta < -3000).slice(0, 1);
      for (const c of under) p.push(`${C.name(c.cat)} is ${$(-c.delta)} under your usual pace. What did you do differently, and can you repeat it on purpose?`);
    }
    if (H && H.small && H.small.n > 10) p.push(`You made ${H.small.n} purchases under $15 in the last ${H.spanDays} days. Which three would you not miss?`);
    p.push('What is one purchase this week you would not make again?');
    return p.slice(0, 4);
  }

  function summarise(txns, opts) {
    opts = opts || {};
    const idx = buildIndex(txns);
    const today = opts.today || U.today();
    const asOf = idx.last && idx.last < today ? idx.last : today;
    const base = baseline(idx, asOf, { months: (opts.settings && opts.settings.baselineMonths) || 6 });
    const track = onTrack(idx, base, asOf);
    const H = habits(txns, asOf, idx, base);
    const ins = insights(idx, base, track, H, opts.settings);
    return { idx, asOf, today, staleDays: idx.last ? U.daysBetween(idx.last, today) : null, base, track, habits: H, insights: ins, prompts: reflectionPrompts(track, H),
      months: monthlySeries(idx, asOf, 12), weeks: weeklySeries(txns, asOf, 12) };
  }

  BT.an = { buildIndex, baseline, onTrack, monthlySeries, weeklySeries, habits, insights, reflectionPrompts, summarise, recurring, LIVING, DISCRETIONARY };
  if (typeof module !== 'undefined' && module.exports) module.exports = BT.an;
})(typeof window !== 'undefined' ? window : globalThis);
