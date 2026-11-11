/* Settings: goals, theme, category rules, backups, and the phone connection. */
(function (g) {
  const BT = (g.BT = g.BT || {}); BT.views = BT.views || {}; const U = BT.util; const C = BT.cats; const { h, icon, toast } = BT.ui;

  BT.views.settings = function (ctx) {
    const root = h('div', {}); const s = ctx.settings; const pc = ctx.backend.mode === 'pc';
    const card = (title, sub, ...kids) => h('div', { class: 'card mt' }, h('h2', {}, title), sub ? h('div', { class: 'sub' }, sub) : h('div', { style: 'height:8px' }), ...kids);
    root.append(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'))));

    // ---- profile & goals
    const name = h('input', { type: 'text', value: s.name || '', placeholder: 'Optional' });
    const goal = h('input', { type: 'number', min: 0, max: 80, value: s.savingsGoalPct });
    const months = h('select', {}, [3, 4, 6, 9, 12].map((n) => h('option', { value: n, selected: s.baselineMonths === n }, `${n} months`)));
    root.append(card('You', 'These shape the comparisons, not your data.', h('div', { class: 'grid g2' },
      h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'Savings goal (% of income)', goal),
      h('label', { class: 'field' }, 'Your usual month is based on the last', months)),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', onclick: async () => { await ctx.saveSettings({ name: name.value.trim(), savingsGoalPct: Math.max(0, Math.min(80, Number(goal.value) || 0)), baselineMonths: Number(months.value) }); toast('Saved'); ctx.render(); } }, 'Save'))));

    // ---- appearance (saved on this device only)
    const seg = (key, def, opts) => { const cur = localStorage.getItem(key) || def; return h('div', { class: 'seg', role: 'group' }, opts.map(([v, l]) => h('button', { type: 'button', class: String(cur) === String(v) ? 'on' : '', 'aria-pressed': String(cur) === String(v), onclick: () => BT.setLook(key, v) }, l))); };
    root.append(card('Appearance', 'Saved on this device only, so your phone and PC can look different.', h('div', { class: 'stack' },
      h('div', {}, h('div', { class: 'small ink2', style: 'margin-bottom:6px;font-weight:600' }, 'Theme'), seg('bt-theme', 'auto', [['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark']])),
      h('div', {}, h('div', { class: 'small ink2', style: 'margin-bottom:6px;font-weight:600' }, 'Text size'), seg('bt-fs', '1', [['0.92', 'Small'], ['1', 'Normal'], ['1.12', 'Large'], ['1.25', 'Extra large']])),
      h('div', {}, h('div', { class: 'small ink2', style: 'margin-bottom:6px;font-weight:600' }, 'Spacing'), seg('bt-dens', 'cozy', [['cozy', 'Comfortable'], ['compact', 'Compact']])))));

    // ---- rules
    const rulesBox = h('div', {});
    const drawRules = () => {
      rulesBox.replaceChildren();
      const rules = ctx.rules; if (!rules.length) rulesBox.append(h('div', { class: 'muted small' }, 'No rules of your own yet. When you change a category and choose "apply to all", a rule is saved here.'));
      for (const r of rules.slice(0, 60)) rulesBox.append(h('div', { class: 'row', style: 'padding:6px 0;border-bottom:1px solid var(--grid)' }, h('div', { class: 'grow' }, h('code', {}, r.pattern), h('span', { class: 'muted small' }, '  →  ' + C.name(r.category))), h('button', { class: 'btn sm', 'aria-label': 'Delete rule', onclick: async () => { await ctx.ops([{ type: 'delrule', opId: U.uid(), id: r.id }]); drawRules(); } }, icon('trash'))));
    };
    drawRules();
    const pat = h('input', { type: 'text', placeholder: 'Text to look for, e.g. zeus (or /regex/)' }); let ruleCat = 'coffee';
    root.append(card('Category rules', 'Your rules are checked before the built-in ones (which cover Australian supermarkets, bookmakers, eBay, subscriptions and more).', rulesBox,
      h('div', { class: 'row wrap', style: 'margin-top:12px' }, h('div', { style: 'flex:1;min-width:200px' }, pat), h('div', { style: 'width:190px' }, BT.catSelect(ruleCat, (v) => { ruleCat = v; })),
        h('button', { class: 'btn', onclick: async () => { if (!pat.value.trim()) return; await ctx.ops([{ type: 'rule', opId: U.uid(), pattern: pat.value.trim().toLowerCase(), category: ruleCat }]); pat.value = ''; drawRules(); toast('Rule added and applied'); } }, 'Add rule'))));

    // ---- phone / sync
    if (pc) root.append(syncCard(ctx, card));
    else root.append(phoneCard(ctx, card));

    // ---- data
    if (pc) {
      const file = h('input', { type: 'file', accept: '.json,application/json', class: 'hide', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; if (!(await BT.ui.confirmBox('Replace everything with this backup?', 'Your current data is backed up first, then replaced.', 'Restore', true))) return; try { await ctx.backend.restore(JSON.parse(await f.text())); await ctx.load(); toast('Restored'); ctx.render(); } catch (err) { toast('That file could not be restored: ' + err.message); } } });
      root.append(card('Your data', 'Stored only on this computer, in the data folder next to the app. A copy is made automatically every day (last 45 kept).',
        h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => BT.ui.download('budget-backup-' + U.today() + '.json', JSON.stringify(ctx.state, null, 1), 'application/json') }, icon('file'), 'Download a backup'), h('button', { class: 'btn', onclick: () => file.click() }, 'Restore from backup'), file,
          h('button', { class: 'btn danger', onclick: async () => { if (await BT.ui.confirmBox('Delete all data?', 'Every transaction, rule and note is removed from this computer. A final backup is kept in the backups folder.', 'Delete everything', true)) { await ctx.backend.reset(); await ctx.load(); toast('All data deleted'); ctx.nav('home'); } } }, icon('trash'), 'Delete everything')),
        h('p', { class: 'tiny muted', style: 'margin-top:10px' }, `${ctx.state.transactions.length.toLocaleString()} transactions stored.`)));
    }
    return root;
  };

  // ------------------------------------------------------------------ PC: connect the phone
  function syncCard(ctx, card) {
    const box = h('div', {}); const be = ctx.backend;
    const draw = async () => {
      let st; try { st = await be.sync.status(); } catch (e) { st = { error: e.message }; }
      box.replaceChildren();
      if (st.error) { box.append(h('div', { class: 'banner crit' }, icon('alert'), st.error)); return; }
      if (!st.configured) {
        const repo = h('input', { type: 'text', placeholder: 'your-username/budget-data' }); const token = h('input', { type: 'password', placeholder: 'github_pat_...', autocomplete: 'off' }); const pass = h('input', { type: 'password', placeholder: 'At least 8 characters', autocomplete: 'new-password' });
        const pages = h('input', { type: 'text', placeholder: 'https://bjay0010-sys.github.io/budget-phone/', value: ctx.settings.pagesUrl || '' });
        box.append(h('p', { class: 'ink2 small' }, 'Optional. Connects your phone so you can send screenshots and see your numbers away from home. Everything is encrypted on your devices before it reaches GitHub, which only ever holds scrambled data. Your PC app works fully without this.'),
          h('ol', { class: 'small ink2', style: 'padding-left:18px;margin:10px 0' },
            h('li', {}, 'On GitHub, create a ', h('b', {}, 'private'), ' repository for the data (any name, e.g. budget-data). Tick "Add a README".'),
            h('li', {}, 'Create a fine-grained access token limited to that one repository, with ', h('b', {}, 'Contents: read and write'), ' permission, and nothing else.'),
            h('li', {}, 'Paste the repository name and the token below, and choose a passcode. You type the passcode on your phone too. It is never stored on GitHub.')),
          h('div', { class: 'grid g2' }, h('label', { class: 'field' }, 'Data repository', repo), h('label', { class: 'field' }, 'Access token', token), h('label', { class: 'field' }, 'Passcode', pass), h('label', { class: 'field' }, 'Phone app address (can add later)', pages)),
          h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', id: 'connectbtn', onclick: async (e) => {
            e.target.disabled = true; try { if (pass.value.length < 8) throw new Error('Choose a passcode of at least 8 characters.'); await be.sync.configure({ repo: repo.value.trim(), token: token.value.trim(), passcode: pass.value, pagesUrl: pages.value.trim() }); if (pages.value.trim()) await ctx.saveSettings({ pagesUrl: pages.value.trim() }); toast('Connected'); } catch (err) { toast(err.message); } e.target.disabled = false; draw();
          } }, icon('sync'), 'Connect')));
        return;
      }
      const ago = (t) => (t ? new Date(t).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'never');
      box.append(h('div', { class: 'row wrap' }, h('span', { class: 'chip ' + (st.lastError ? 'amber' : 'good') }, st.lastError ? 'Needs attention' : 'Connected'), h('span', { class: 'small ink2' }, st.repo)),
        h('div', { class: 'small ink2', style: 'margin:8px 0' }, `Last sent to phone: ${ago(st.lastPush)} · Last checked for phone uploads: ${ago(st.lastPull)} · Phone uploads applied: ${st.applied || 0}`),
        st.lastError ? h('div', { class: 'banner mt' }, icon('alert'), st.lastError) : null,
        h('div', { class: 'row wrap', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { const r = await be.sync.now(); await ctx.load(); toast(r && r.applied ? `Pulled ${r.applied} upload${r.applied > 1 ? 's' : ''} from your phone` : 'Up to date'); } catch (err) { toast(err.message); } draw(); } }, icon('sync'), 'Sync now'),
          h('button', { class: 'btn', onclick: () => showQR(ctx) }, 'Set up a phone'), h('button', { class: 'btn danger', onclick: async () => { if (await BT.ui.confirmBox('Disconnect the phone?', 'Syncing stops. Data already on GitHub stays there (encrypted). You can delete the repository on GitHub to remove it.', 'Disconnect', true)) { await be.sync.disconnect(); draw(); } } }, 'Disconnect')));
    };
    draw();
    return card('Phone', 'Send screenshots from your phone, see your numbers anywhere.', box);
  }

  async function showQR(ctx) {
    let link; try { const pagesUrl = ctx.settings.pagesUrl; link = (await ctx.backend.sync.link(pagesUrl)).link; } catch (e) { toast(e.message); return; }
    BT.ui.modal((box, close) => {
      let svg = ''; try { const qr = qrcode(0, 'M'); qr.addData(link); qr.make(); svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (e) { svg = ''; }
      const qrEl = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR code to set up your phone' }); qrEl.innerHTML = svg; // generated locally by the QR library from our own link
      box.append(h('h2', {}, 'Set up your phone'), h('div', { class: 'stack', style: 'margin-top:12px;align-items:center;text-align:center' }, qrEl,
        h('p', { class: 'small ink2' }, 'On your iPhone: scan with the camera, open the link in Safari, tap Share > Add to Home Screen, then open Budget from its icon and enter your passcode. (If the icon asks for a link, use Copy link below and paste it.)'),
        h('div', { class: 'banner', style: 'text-align:left' }, icon('alert'), h('div', {}, h('b', {}, 'This code contains your GitHub token. '), 'Scan it, then close this window. Do not screenshot it or share it.')),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch (e) { toast('Could not copy'); } } }, 'Copy link instead'), h('button', { class: 'btn primary', onclick: close }, 'Done'))));
    });
  }

  // ------------------------------------------------------------------ phone: sync + lock
  function phoneCard(ctx, card) {
    const be = ctx.backend; const box = h('div', {});
    let faceOk = false; be.faceAvailable().then((v) => { faceOk = v; draw(); });
    const faceRow = () => !faceOk ? h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Face ID is not available in this browser. Your passcode locks the app.')
      : be.hasFace ? h('div', { class: 'row wrap', style: 'margin-top:10px' }, h('span', { class: 'chip good' }, icon('face'), be.faceMode === 'prf' ? 'Face ID on' : 'Face ID on (screen lock)'), h('button', { class: 'btn sm', onclick: async () => { await be.faceOff(); toast('Face ID turned off'); draw(); } }, 'Turn off'))
      : h('div', { class: 'row wrap', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { const m = await be.faceEnroll(); toast(m === 'prf' ? 'Face ID is on' : 'Face ID is on (screen lock)'); } catch (err) { toast(err && err.name === 'NotAllowedError' ? 'Face ID was cancelled' : (err.message || 'Could not turn on Face ID')); } draw(); } }, icon('face'), 'Turn on Face ID'));
    const draw = async () => {
      const st = await be.status(); box.replaceChildren(
        h('div', { class: 'small ink2' }, `Last updated from your PC: ${st.lastPull ? new Date(st.lastPull).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'never'}. Waiting to send: ${st.pending}.`),
        st.error ? h('div', { class: 'banner mt' }, icon('alert'), st.error) : null,
        faceRow(),
        h('label', { class: 'field', style: 'margin-top:12px' }, 'Ask for Face ID or passcode again after being away for', h('select', { onchange: async (e) => { try { await be.setLock(e.target.value); toast(e.target.value === 'never' ? 'This phone will stay unlocked' : 'Saved'); } catch (er) { toast(er.message); } } },
          [['1', '1 minute'], ['5', '5 minutes'], ['30', '30 minutes'], ['480', '8 hours'], ['never', 'Never (stay unlocked)']].map(([v, l]) => h('option', { value: v, selected: String(be.prefs.lockMins) === v }, l))),
          h('span', { class: 'tiny muted' }, 'Never: nothing is asked, and anyone who can open your unlocked iPhone can open Budget. Lock now still works.')),
        h('div', { class: 'row wrap', style: 'margin-top:10px' }, h('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { await be.syncNow(); await ctx.load(); toast('Synced'); } catch (err) { toast(err.message); } ctx.render(); } }, icon('sync'), 'Sync now'), h('button', { class: 'btn', onclick: () => be.lock() }, icon('lock'), 'Lock now'),
          h('button', { class: 'btn danger', onclick: async () => { if (await BT.ui.confirmBox('Sign out of this phone?', 'The copy of your data on this phone is erased. Your PC is not affected. Anything not yet sent is lost.', 'Sign out', true)) be.signOut(); } }, 'Sign out')));
    }; draw();
    return card('This phone', 'Your data is kept encrypted on this phone. Saves are sent to your PC when you are online.', box);
  }
})(window);
