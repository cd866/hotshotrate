/* Black Ram Logistics - app search (v96).
   One box that finds sections, loads in the books, the latest board scan, maintenance items,
   DOT checklist items, checklist lines, manual insights and rig specs/gear, then jumps there.
   Indexes only what the public app already shows (city-level lanes, first names only).
   Opens from the appbar magnifier, the Today quick action, or "/" on a keyboard. Plain ASCII. */
(function () {
  'use strict';
  var st = { q: '', idx: null, sel: 0, res: [] };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var TABS = {
    today: ['Today', 'home summary alerts attention next load waiting pay quick actions'],
    check: ['Rate Check', 'rate offer broker verdict take maybe pass net calculator per mile per day'],
    searches: ['Load Boards', 'boards loads scan truckstop direct freight uship combos fits'],
    stops: ['Stops', 'truck stops loves ta petro fuel diesel parking map near me'],
    reports: ['Reports', 'month loads expenses fuel miles ledger books delivered'],
    kpis: ['Scoreboard', 'kpi break-even cash on cash deadhead utilization on-time'],
    pdfs: ['Daily PDFs', 'nightly report pdf daily'],
    targets: ['Targets', 'goal break-even rate per mile loads per week plan bills'],
    fin: ['Finance', 'bank balance bills cash owed income bluevine'],
    acct: ['Accounting', 'p&l profit loss waterfall partners capital loans amex ar'],
    ins: ['Insurance', 'coi policy liability cargo progressive tire warranty trailergard claim anti-theft'],
    maint: ['Maintenance', 'service oil tires brakes bearings torque lube schedule mark done log checklists manuals'],
    dot: ['DOT Ready', 'roadside inspection cfr cdl medical card fire extinguisher triangles registration temp tag'],
    tax: ['Tax', 'tax filing irs 1065 k-1 1099 estimated quarterly franchise ifta 2290 deductions depreciation cpa due dates'],
    actions: ['Action items', 'to do todo tasks sign documents release waiting on partners checklist open items'],
    bills: ['Bill Waterfall', 'bills due next waterfall cash left upcoming payments due dates bluevine owed overdue'],
    loans: ['Loans and Schedules', 'loans amortization schedule truck note trailer note chase synchrony payoff interest principal balance apr due dates insurance progressive payments bills']
  };
  var KIND = { tab: 'Section', load: 'Load', board: 'On the boards', mt: 'Maintenance', dot: 'DOT', tax: 'Tax', ai: 'Action item', chk: 'Checklist', man: 'Manual', rig: 'Our rig', act: 'Action' };

  function A() { return window.BlackRamApp || {}; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ascii(v) { return String(v == null ? '' : v).replace(/\u2192/g, 'to').replace(/[\u2013\u2014\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[^\x00-\x7F]/g, ''); }
  function city(s) { var T = window.BlackRamToday; return T && T.city ? T.city(s) : ascii(s); }
  function md(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return MON[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0]; }
  function money(n) { return n == null || !isFinite(n) ? '' : '$' + Math.round(n).toLocaleString('en-US'); }

  function build() {
    var out = [];
    function add(kind, title, sub, hay, go) { out.push({ k: kind, t: ascii(title), s: ascii(sub || ''), h: (ascii(title) + ' ' + ascii(sub || '') + ' ' + ascii(hay || '')).toLowerCase(), go: go }); }
    Object.keys(TABS).forEach(function (t) { if (document.getElementById('panel-' + t)) add('tab', TABS[t][0], 'Open section', TABS[t][1], { tab: t }); });
    add('act', 'Pre-trip checklist', 'Maintenance | check off on this phone', 'pretrip pre-trip walkaround inspection', { jump: 'mt-chk', tab: 'maint' });
    add('act', 'Broker call sheet', 'MC, DOT, insurance and equipment facts', 'call sheet broker packet mc dot coi', { call: 1 });
    add('act', 'Team', 'Claudio, Ben, Meshach, and Felix', 'team partners totni felix 360', { team: 1 });
    add('act', 'Claudio 360', 'Partner / owner | dispatch and back office', 'claudio partner owner dispatch finances', { team: 'claudio' });
    add('act', 'Ben 360', 'Partner | trailer capital', 'ben partner capital trailer', { team: 'ben' });
    add('act', 'Driver 360', 'Meshach | loads, miles, on-time', 'driver meshach 360 profile', { driver: 1 });
    add('act', 'Felix 360', 'Totni owner | MC 1122113, 13% cut', 'felix totni carrier mc lease', { team: 'felix' });
    add('act', 'Trailer diagram', 'Big Tex labeled diagram', 'trailer diagram big tex parts', { diagram: 1 });
    var f = A().getFeed ? A().getFeed() : null;
    ((f && f.months) || []).forEach(function (m) {
      var pct = isFinite(Number(m.fee_pct)) ? Number(m.fee_pct) : 13;
      (m.loads || []).forEach(function (l) {
        var lane = city(l.pickup_place || l.lane) + ' to ' + city(l.drop_place || l.lane);
        add('load', lane, md(l.date) + ' | ' + money(Number(l.gross)) + (l.broker ? ' | ' + l.broker : ''), [l.desc, l.broker, l.load_no, l.date, l.delivery_date, l.pay_status, m.month].join(' '), { load: { load: l, pct: pct }, label: md(l.date) });
      });
    });
    var S = A().getScored ? A().getScored() : null;
    ((S && S.loads) || []).forEach(function (l) {
      add('board', ascii(l.origin) + ' to ' + ascii(l.destination), (l.verdict || '') + (l.net_est != null ? ' | ' + money(Number(l.net_est)) + ' net EST' : '') + (l.board ? ' | ' + l.board : ''), [l.equipment, l.broker, l.load_number, l.verdict].join(' '), { tab: 'searches' });
    });
    var M = window.BlackRamMaintenance, mi = M && M.index ? M.index() : null;
    if (mi) {
      mi.schedule.forEach(function (it) { add('mt', it.item, (it.unit === 'trailer' ? 'Trailer' : 'Truck') + ' | mark done or SOP', it.id, { mt: it.id }); });
      mi.checks.forEach(function (c) { add('chk', c.t, c.list, '', { jump: 'mt-chk', tab: 'maint' }); });
      mi.insights.forEach(function (x) { add('man', x.t, x.s, '', { jump: 'mt-man', tab: 'maint' }); });
    }
    var D = window.BlackRamDot;
    if (D && D.ready && D.ready() && D.list) {
      D.list().forEach(function (x) { add('dot', x.t, x.label + (x.cfr ? ' | ' + x.cfr.split(';')[0] : ''), x.cfr, { dot: x.id }); });
    }
    var X = window.BlackRamTax;
    if (X && X.ready && X.ready()) {
      X.list().forEach(function (x) { add('tax', x.t, x.form + ' | due ' + md(x.due), x.cat + ' ' + x.form, { tax: x.id }); });
      X.rules().forEach(function (x) { add('tax', x.t, 'Does it apply: ' + String(x.a).toUpperCase(), 'tax', { taxrule: x.id }); });
    }
    var AC = window.BlackRamActions;
    if (AC && AC.ready && AC.ready()) {
      AC.list().forEach(function (x) { add('ai', x.t, x.owner + ' | ' + x.cat + (x.done ? ' | done' : (x.due ? ' | due ' + md(x.due) : '')), x.cat + ' ' + x.owner + ' action item todo', { ai: x.id }); });
    }
    document.querySelectorAll('.rig-spec-grid .rig-spec').forEach(function (el) {
      var dt = el.querySelector('dt'), dd = el.querySelector('dd');
      if (dt && dd) add('rig', dt.textContent.trim() + ': ' + dd.textContent.trim(), 'Rig specs', '', { rig: 1 });
    });
    document.querySelectorAll('.rig-specs-body ul.rig-list > li').forEach(function (li) {
      var t = (li.firstChild && li.firstChild.nodeType === 3 ? li.firstChild.textContent : li.textContent).trim();
      if (t) add('rig', t, 'Our gear', li.textContent, { rig: 1 });
    });
    return out;
  }

  function search(q) {
    var toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return st.idx.filter(function (r) { return r.k === 'tab' || r.k === 'act'; });
    var res = [];
    st.idx.forEach(function (r) {
      var score = 0, tl = r.t.toLowerCase();
      for (var i = 0; i < toks.length; i++) {
        var t = toks[i];
        if (r.h.indexOf(t) < 0) return;
        if (tl.indexOf(t) === 0) score += 6; else if (new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(tl)) score += 4; else if (tl.indexOf(t) >= 0) score += 3; else score += 1;
      }
      if (r.k === 'tab') score += 2;
      if (r.k === 'board') score -= 1;
      res.push({ r: r, sc: score });
    });
    res.sort(function (a, b) { return b.sc - a.sc; });
    return res.slice(0, 40).map(function (x) { return x.r; });
  }

  function host() {
    var h = document.getElementById('srch');
    if (h) return h;
    h = document.createElement('div'); h.id = 'srch'; h.className = 'srch'; h.hidden = true;
    h.innerHTML = '<div class="srch-bd" data-srch-x="1"></div><div class="srch-p" role="dialog" aria-modal="true" aria-label="Search">' +
      '<div class="srch-bar"><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></g></svg>' +
      '<input id="srch-q" type="search" inputmode="search" enterkeyhint="go" autocomplete="off" spellcheck="false" placeholder="Search loads, DOT, service, gear" aria-label="Search the app" aria-controls="srch-list">' +
      '<button type="button" class="srch-x" data-srch-x="1">Close</button></div>' +
      '<div id="srch-list" class="srch-list" role="listbox"></div></div>';
    document.body.appendChild(h);
    var q = h.querySelector('#srch-q');
    q.addEventListener('input', function () { st.q = q.value; st.sel = 0; draw(); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { st.sel = Math.min(st.res.length - 1, st.sel + 1); draw(true); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { st.sel = Math.max(0, st.sel - 1); draw(true); e.preventDefault(); }
      else if (e.key === 'Enter') { if (st.res[st.sel]) go(st.res[st.sel]); e.preventDefault(); }
    });
    h.addEventListener('click', function (e) {
      if (e.target.closest('[data-srch-x]')) { close(); return; }
      var b = e.target.closest('[data-srch-i]'); if (b) go(st.res[+b.getAttribute('data-srch-i')]);
    });
    return h;
  }
  function hl(text) {
    var toks = st.q.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; });
    var out = esc(text);
    toks.forEach(function (t) { out = out.replace(new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>'); });
    return out;
  }
  function draw(keepScroll) {
    var list = document.getElementById('srch-list'); if (!list) return;
    st.res = search(st.q);
    if (!st.res.length) { list.innerHTML = '<p class="srch-empty">No match for "' + esc(st.q) + '". Try a city, broker, part or CFR number.</p>'; return; }
    var last = '';
    list.innerHTML = (st.q ? '' : '<p class="srch-hint">Jump to</p>') + st.res.map(function (r, i) {
      var head = '';
      if (st.q && r.k !== last) { head = '<p class="srch-hint">' + esc(KIND[r.k]) + '</p>'; last = r.k; }
      return head + '<button type="button" role="option" class="srch-i' + (i === st.sel ? ' on' : '') + '" data-srch-i="' + i + '" aria-selected="' + (i === st.sel ? 'true' : 'false') + '"><b>' + hl(r.t) + '</b>' + (r.s ? '<small>' + hl(r.s) + '</small>' : '') + '</button>';
    }).join('');
    if (st.q) {
      // group by kind, keeping the rank order inside each kind
      var order = [], by = {};
      st.res.forEach(function (r) { if (!by[r.k]) { by[r.k] = []; order.push(r.k); } by[r.k].push(r); });
      st.res = [].concat.apply([], order.map(function (k) { return by[k]; }));
      last = '';
      list.innerHTML = st.res.map(function (r, i) {
        var head = r.k !== last ? '<p class="srch-hint">' + esc(KIND[r.k]) + '</p>' : ''; last = r.k;
        return head + '<button type="button" role="option" class="srch-i' + (i === st.sel ? ' on' : '') + '" data-srch-i="' + i + '" aria-selected="' + (i === st.sel ? 'true' : 'false') + '"><b>' + hl(r.t) + '</b>' + (r.s ? '<small>' + hl(r.s) + '</small>' : '') + '</button>';
      }).join('');
    }
    if (keepScroll) { var on = list.querySelector('.srch-i.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }
  }

  function go(r) {
    if (!r) return;
    var g = r.go, a = A(), T = window.BlackRamTiles;
    close();
    if (g.tab && !g.jump) { a.showTab && a.showTab(g.tab); return; }
    if (g.jump && T) { T.jump(g.jump, g.tab); return; }
    if (g.call) { a.openCallSheet && a.openCallSheet(); return; }
    if (g.team) { window.BlackRamTeam && window.BlackRamTeam.open(g.team === 1 ? null : g.team); return; }
    if (g.driver) { window.BlackRamDriver && window.BlackRamDriver.open(); return; }
    if (g.diagram) { a.openRigDiagram && a.openRigDiagram(); return; }
    if (g.load) { loadSheet(g.load.load, g.load.pct); return; }
    if (g.mt) { var M = window.BlackRamMaintenance; if (M) M.openItem(g.mt); return; }
    if (g.dot) { var D = window.BlackRamDot; if (D) D.openItem(g.dot); return; }
    if (g.ai) { var AC = window.BlackRamActions; if (!AC) return; a.showTab && a.showTab('actions'); setTimeout(function () { AC.openItem(g.ai); }, 120); return; }
    if (g.tax || g.taxrule) { var X = window.BlackRamTax; if (!X) return; a.showTab && a.showTab('tax'); setTimeout(function () { if (g.tax) X.openItem(g.tax); else X.openRule(g.taxrule); }, 120); return; }
    if (g.rig) {
      a.showTab && a.showTab('check');
      var d = document.querySelector('.rig-specs-panel'); if (d) d.open = true;
      setTimeout(function () { var b = document.querySelector('.rig-specs-body'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
    }
  }

  /* One load from the books: same public fields Reports shows, city-level lane. */
  function loadSheet(l0, pct) {
    var T = window.BlackRamTiles, a = A(); if (!T) return;
    var sc = a.scoreLedgerLoad ? a.scoreLedgerLoad(l0, pct) : null;
    var netEst = sc && sc.netVal != null ? Number(sc.netVal) : null;
    var l = a.withResolvedStatus ? a.withResolvedStatus(l0) : l0;
    var PAY = { paid: 'Paid', paid_short: 'Paid short', unpaid: 'Waiting on pay', in_transit: 'Not delivered yet' };
    var mi = Number(l.loaded_mi), g = Number(l.gross);
    var rows = [
      ['Pickup', esc(md(l.pickup_date || l.date))],
      ['Delivered', esc(md(l.delivered_date || l.delivery_date) || 'not on file')],
      ['Gross', esc(money(g) || 'not on file')],
      ['Loaded mi', mi ? esc(Math.round(mi).toLocaleString('en-US')) : 'not on file'],
      ['$ / loaded mi', mi && g ? '$' + (g / mi).toFixed(2) : 'not on file'],
      ['Net EST', netEst != null && isFinite(netEst) ? esc((netEst < 0 ? '-' : '') + money(Math.abs(netEst))) : 'not on file'],
      ['Broker', esc(ascii(l.broker || 'not on file'))],
      ['Load #', esc(ascii(l.load_no || 'not on file'))],
      ['Pay', esc(PAY[l.pay_status] || 'not on file') + (l.pay_status === 'unpaid' && isFinite(Number(l.net_due)) ? ' | ' + esc(money(Number(l.net_due))) + ' due' : '')],
      ['Weight', l.weight_lb ? esc(Math.round(l.weight_lb).toLocaleString('en-US')) + ' lb' : 'not on file']
    ];
    T.open({ title: city(l.pickup_place || l.lane) + ' to ' + city(l.drop_place || l.lane), sub: esc(ascii(l.desc || 'Load')) + ' | from the books',
      body: T.hero(esc(money(g) || '-'), 'gross | ' + esc(md(l.date))) + T.kv(rows) +
        T.fine('Net EST = gross after the carrier fee, minus fuel and DEF on loaded and empty miles. Same math as the Reports load list.') +
        '<div>' + T.btn('Open Reports', 'td', 'go:tab:reports') + '</div>' });
  }

  function open() {
    var M = window.BlackRamMaintenance, D = window.BlackRamDot;
    if (M && M.load && !M.ready()) M.load();
    if (D && D.load && !D.ready()) D.load();
    st.idx = build();
    var h = host(); h.hidden = false;
    document.documentElement.classList.add('tl-noscroll');
    var q = h.querySelector('#srch-q'); q.value = st.q; draw();
    setTimeout(function () { try { q.focus(); q.select(); } catch (e) { /* ignore */ } }, 30);
    // DOT and maintenance JSON may land a moment later; rebuild once so their items show.
    setTimeout(function () { if (!h.hidden) { st.idx = build(); draw(); } }, 1200);
  }
  function close() {
    var h = document.getElementById('srch'); if (!h || h.hidden) return;
    h.hidden = true; document.documentElement.classList.remove('tl-noscroll');
  }

  function css() {
    if (document.getElementById('srch-css')) return;
    var s = document.createElement('style'); s.id = 'srch-css';
    s.textContent =
      '.srch{position:fixed;inset:0;z-index:2800}.srch[hidden]{display:none}' +
      '.srch-bd{position:absolute;inset:0;background:rgba(4,3,8,.7)}' +
      '.srch-p{position:absolute;left:0;right:0;top:0;max-height:92dvh;display:flex;flex-direction:column;background:var(--c-surface-2);border-bottom:1px solid var(--c-line-strong);border-radius:0 0 var(--radius-xl) var(--radius-xl);box-shadow:var(--shadow-2);padding-top:env(safe-area-inset-top)}' +
      '@media(min-width:720px){.srch-p{left:50%;right:auto;width:600px;transform:translateX(-50%);top:40px;border-radius:var(--radius-xl);border:1px solid var(--c-line-strong)}}' +
      '.srch-bar{display:flex;align-items:center;gap:var(--s-1);padding:var(--s-1h) var(--s-2);border-bottom:1px solid var(--c-line)}' +
      '.srch-bar svg{width:22px;height:22px;color:var(--c-text-3);flex:none}' +
      '#srch-q{flex:1;min-width:0;min-height:var(--tap);background:var(--c-surface-1);border:1px solid var(--c-line-strong);border-radius:var(--radius-pill);padding:0 var(--s-2);color:var(--c-text-1);font:inherit;font-size:var(--fs-base);outline:0}' +
      '#srch-q:focus{border-color:var(--c-gold);box-shadow:0 0 0 3px rgba(242,201,76,.22)}' +
      '.srch-x{min-height:40px;padding:0 14px;border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-3);color:var(--c-text-1);font:inherit;font-size:var(--fs-sm);font-weight:800;cursor:pointer;flex:none}' +
      '.srch-list{overflow-y:auto;overscroll-behavior:contain;padding:var(--s-1) var(--s-2) var(--s-2);display:flex;flex-direction:column;gap:4px}' +
      '.srch-hint{margin:var(--s-1) 0 2px;font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--c-accent-hi)}' +
      '.srch-i{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;width:100%;min-height:var(--tap);padding:8px var(--s-1h);border-radius:var(--radius-md);border:1px solid var(--c-line);background:var(--c-surface-1);color:var(--c-text-1);font:inherit;cursor:pointer}' +
      '.srch-i.on{border-color:var(--c-gold)}.srch-i b{font-size:var(--fs-sm);font-weight:800;overflow-wrap:anywhere}.srch-i small{font-size:11px;font-weight:700;color:var(--c-text-3);overflow-wrap:anywhere}' +
      '.srch-i mark{background:rgba(242,201,76,.25);color:inherit;border-radius:3px;padding:0 1px}' +
      '.srch-empty{margin:var(--s-2) 0;font-size:var(--fs-sm);color:var(--c-text-3)}';
    document.head.appendChild(s);
  }

  function init() {
    css();
    var b = document.getElementById('search-open'); if (b) b.addEventListener('click', open);
    document.addEventListener('keydown', function (e) {
      var h = document.getElementById('srch');
      if (e.key === 'Escape' && h && !h.hidden) { close(); return; }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') && !(document.activeElement && document.activeElement.isContentEditable)) { e.preventDefault(); open(); }
    });
    document.addEventListener('blackram:tab', close);
  }
  window.BlackRamSearch = { open: open, close: close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
