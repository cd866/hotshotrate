/* Black Ram Logistics - Bill Waterfall (v145).
   What is due next and what cash is left after each bill. PIN-gated: cash, bills, dates and
   owed load pay all come from the relay /financials payload (bills, loans.others, income,
   account), loaded through window.BlackRamBills.ensure (loans.js). Targets inputs supply only
   the Other monthly and Meshach amounts already shown on the Break-even sheets. Plain ASCII. */
(function () {
  'use strict';
  var FIN_KEY = 'blackram_fin_session_v1', PIN_KEY = 'blackram_relay_pin_v1', RANGE_KEY = 'blackram_billwf_range_v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SHORT = { truck: 'Truck', trailer: 'Trailer', ins: 'Insur.', truckstop: 'TStop', amex_8008: 'AmEx' };
  var st = { range: rget(), lastForce: 0 };

  function rget() { try { var v = localStorage.getItem(RANGE_KEY); return v === '60' || v === 'mo' ? v : '30'; } catch (e) { return '30'; } }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function m2(n) { if (n == null || !isFinite(n)) return '-'; return (n < -0.004 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function m0(n) { if (n == null || !isFinite(n)) return '-'; return (n <= -0.5 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'); }
  function mk(n) { var a = Math.abs(n), s = n < -0.5 ? '-' : ''; return s + (a >= 1000 ? '$' + (a / 1000).toFixed(1) + 'k' : '$' + Math.round(a)); }
  function md(iso) { var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function today() { return iso(new Date()); }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function addMon(s, k) { var p = s.split('-').map(Number), y = p[0], m = p[1] - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; var last = new Date(y, m + 1, 0).getDate(); return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(Math.min(p[2], last)).padStart(2, '0'); }
  function days(a, b) { return Math.round((Date.parse(a + 'T12:00:00') - Date.parse(b + 'T12:00:00')) / 864e5); }
  function fin() { try { var c = sessionStorage.getItem(FIN_KEY); return c ? JSON.parse(c) : null; } catch (e) { return null; } }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function urg(date, t) { var n = days(date, t); return { n: n, cls: n < 0 ? 'red' : n <= 7 ? 'amb' : 'ok', rel: n < 0 ? (-n) + 'd overdue' : n === 0 ? 'due today' : n === 1 ? '1 day left' : n + ' days left' }; }

  /* ---------- model ---------- */
  function endFor(range, t) {
    if (range === 'mo') { var p = t.split('-').map(Number); return iso(new Date(p[0], p[1], 0, 12)); }
    return addDays(t, range === '60' ? 60 : 30);
  }
  /* Every dated, unpaid bill from today (overdue first) through `end`. */
  function billEvents(d, t, end) {
    var ev = [], tbd = [];
    var insRows = null;
    ((d.loans && d.loans.others) || []).forEach(function (o) { if (o.id === 'ins') insRows = o.rows; });
    (d.bills || []).forEach(function (b) {
      if (b.status === 'withheld' || b.amount == null && !b.amount_text) return;
      if (b.status === 'withheld') return;
      var name = b.payee, card = !b.hits_bank;
      if (b.amount == null) return;                       // e.g. ELD fees: no amount on file
      if (!b.next) { tbd.push({ name: name, amount: b.amount, est: !!b.est, card: card, why: 'date TBD' }); return; }
      if (b.id === 'ins' && insRows) {
        insRows.forEach(function (r) { if (!r[2] && r[0] <= end) ev.push({ id: b.id, name: name, date: r[0], amount: r[1], card: card }); });
        return;
      }
      if (b.id === 'truck' || b.id === 'trailer' || b.id === 'truckstop') {
        for (var k = 0, dt = b.next; dt <= end && k < 6; k++, dt = addMon(b.next, k)) ev.push({ id: b.id, name: name, date: dt, amount: b.amount, card: card });
        return;
      }
      var ds = (b.dates && b.dates.length) ? b.dates : [[b.next, b.amount]];
      ds.forEach(function (x) { if (x[0] <= end) ev.push({ id: b.id, name: name, date: x[0], amount: x[1], card: card }); });
    });
    ev.forEach(function (e) { e.overdue = e.date < t; });
    ev.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount; });
    return { ev: ev, tbd: tbd };
  }
  function targetsTbd() {
    var out = [], T = window.BlackRamTargets;
    try {
      var B = T && T.bills ? T.bills() : [], om = B.filter(function (b) { return /^Other monthly/.test(b.label); })[0];
      if (om) {
        var rest = Math.round((om.amount - 42) * 100) / 100;   // Targets Other monthly includes Truckstop $42 (dated above)
        if (rest > 0) out.push({ name: 'Other monthly (phone, software)', amount: rest, why: 'date TBD', note: 'Targets ' + m0(om.amount) + ' less Truckstop $42' });
      }
      var M = T && T.model ? T.model() : null;
      if (M && M.driverMo) out.push({ name: 'Meshach (from profit only)', amount: M.driverMo, why: 'after bills', note: 'paid only from profit left after bills' });
    } catch (e) { /* ignore */ }
    return out;
  }
  function model(d, range) {
    var t = today(), end = endFor(range, t), acct = d.account || {};
    var start = acct.available != null ? Number(acct.available) : null;
    var be = billEvents(d, t, end), all = billEvents(d, t, '9999-12-31').ev;
    var run = start != null ? start : 0;
    be.ev.forEach(function (e) { run = Math.round((run - e.amount) * 100) / 100; e.bal = run; });
    var owed = (d.income || []).filter(function (i) { return i.status === 'unpaid' && i.amount; });
    var owedTot = owed.reduce(function (a, i) { return a + i.amount; }, 0);
    return { t: t, end: end, start: start, asOf: d.bank_as_of || d.as_of, ev: be.ev, tbd: be.tbd.concat(targetsTbd()), next: all[0] || null,
      left: run, owed: owed, owedTot: owedTot, leftIfPaid: Math.round((run + owedTot) * 100) / 100, pendingIn: acct.pending_incoming || 0 };
  }

  /* ---------- chart ---------- */
  function chart(M) {
    var bars = [{ k: 'start', lab: 'Cash', sub: md(String(M.asOf).slice(0, 10)), from: 0, to: M.start }];
    var run = M.start;
    M.ev.forEach(function (e) { bars.push({ k: e.overdue ? 'late' : 'bill', lab: SHORT[e.id] || e.name.split(' ')[0], sub: md(e.date), from: run, to: e.bal, v: -e.amount }); run = e.bal; });
    bars.push({ k: M.left < 0 ? 'endneg' : 'end', lab: 'Left', sub: md(M.end), from: 0, to: M.left });
    M.owed.forEach(function (i) { bars.push({ k: 'in', lab: 'Owed', sub: 'date ?', from: run, to: run + i.amount, v: i.amount }); run += i.amount; });
    if (M.owed.length) bars.push({ k: M.leftIfPaid < 0 ? 'endneg' : 'end2', lab: 'If paid', sub: md(M.end), from: 0, to: M.leftIfPaid });
    var n = bars.length, W = Math.max(340, n * 44), H = 210, l = 8, r = 8, t = 22, b = 36;
    var hi = 0, lo = 0; bars.forEach(function (x) { hi = Math.max(hi, x.from, x.to); lo = Math.min(lo, x.from, x.to); });
    if (hi === lo) hi = lo + 1;
    function Y(v) { return t + (H - t - b) * (hi - v) / (hi - lo); }
    var gw = (W - l - r) / n, bw = Math.min(26, gw * 0.7);
    var o = ['<svg class="bw-svg" viewBox="0 0 ' + W + ' ' + H + '" style="min-width:' + (W > 340 ? Math.round(W * 0.82) : 0) + 'px;max-width:' + Math.round(W * 1.9) + 'px" role="img" aria-label="Bill waterfall from cash on hand to cash left">'];
    o.push('<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" class="bw-zero"/>');
    bars.forEach(function (x, i) {
      var cx = l + gw * i + gw / 2, y1 = Y(Math.max(x.from, x.to)), y2 = Y(Math.min(x.from, x.to));
      o.push('<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1.5, y2 - y1).toFixed(1) + '" rx="3" class="bw-' + x.k + '"/>');
      if (i < n - 1) { var nx = bars[i + 1], yy = Y(x.to); if (nx.from === x.to || (nx.k === 'end' || nx.k === 'endneg' || nx.k === 'end2')) o.push('<line x1="' + (cx + bw / 2).toFixed(1) + '" x2="' + (cx + gw - bw / 2).toFixed(1) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '" class="bw-link"/>'); }
      var val = x.v != null ? (x.v < 0 ? '-' : '+') + mk(Math.abs(x.v)).replace('$', '$') : mk(x.to);
      var vy = y1 - 4;
      o.push('<text x="' + cx.toFixed(1) + '" y="' + vy.toFixed(1) + '" text-anchor="middle" class="bw-val bw-v-' + x.k + '">' + esc(val) + '</text>');
      o.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 20) + '" text-anchor="middle" class="bw-lab">' + esc(x.lab) + '</text>');
      o.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="bw-sub">' + esc(x.sub) + '</text>');
    });
    o.push('</svg>');
    return '<div class="bw-scroll">' + o.join('') + '</div>' +
      '<div class="bw-leg"><span><i class="lg-cash"></i>Cash</span><span><i class="lg-bill"></i>Bill</span>' + (M.ev.some(function (e) { return e.overdue; }) ? '<span><i class="lg-late"></i>Overdue</span>' : '') + (M.owed.length ? '<span><i class="lg-in"></i>Owed load pay (date ?)</span>' : '') + '</div>';
  }

  /* ---------- render ---------- */
  function lockView(msg) {
    return '<section class="bw-card bw-lock"><h3>Bill Waterfall is locked</h3><p class="bw-fine">' + esc(msg) + '</p>' +
      '<form id="bw-pin-form" class="bw-pin" autocomplete="off"><input id="bw-pin" type="password" inputmode="numeric" placeholder="App PIN" aria-label="App PIN" />' +
      '<button type="submit" class="btn primary">Unlock</button></form></section>';
  }
  function root() { return document.getElementById('bw-root'); }
  function render() {
    var el = root(); if (!el) return;
    var d = fin();
    if (!d || !d.bills) {
      el.innerHTML = pin() ? '<section class="bw-card"><p class="bw-fine">Loading bills...</p></section>' : lockView('Cash on hand, bills by due date and what is left. Enter the app PIN.');
      bind(); return;
    }
    var M = model(d, st.range), N = M.next;
    var hero = N ? (function () {
      var u = urg(N.date, M.t);
      return '<section class="bw-card bw-hero bw-h-' + u.cls + '"><div class="bw-k">Due next</div><div class="bw-hrow"><div><div class="bw-hn">' + esc(N.name) + '</div><div class="bw-hd">' + md(N.date) + ' | ' + u.rel + (N.card ? ' | card' : '') + '</div></div>' +
        '<div class="bw-ha">' + m2(N.amount) + '</div></div>' +
        '<div class="bw-days"><b>' + (u.n < 0 ? -u.n : u.n) + '</b><span>' + (u.n < 0 ? 'days late' : u.n === 1 ? 'day' : 'days') + '</span></div></section>';
    })() : '<section class="bw-card bw-hero bw-h-ok"><div class="bw-k">Due next</div><div class="bw-hn">Nothing dated on file</div></section>';
    var seg = '<div class="bw-seg" role="group" aria-label="Range">' + [['30', '30 days'], ['60', '60 days'], ['mo', 'This month']].map(function (r) {
      return '<button type="button" data-bw-range="' + r[0] + '" aria-pressed="' + (st.range === r[0]) + '">' + r[1] + '</button>'; }).join('') + '</div>';
    var tiles = '<div class="bw-tiles"><div><span>Cash now</span><b class="num-yellow">' + m0(M.start) + '</b></div><div><span>Bills due</span><b class="bw-neg">' + m0(M.ev.reduce(function (a, e) { return a + e.amount; }, 0)) + '</b></div>' +
      '<div><span>Left ' + md(M.end) + '</span><b class="' + (M.left < 0 ? 'bw-neg' : 'bw-pos') + '">' + m0(M.left) + '</b></div></div>';
    var rows = '<div class="bw-row bw-row-h"><span>Date</span><span>Bill</span><span>Amount</span><span>Balance</span></div>' +
      '<div class="bw-row bw-row-start"><span>' + md(String(M.asOf).slice(0, 10)) + '</span><span>Bluevine cash</span><span></span><span>' + m2(M.start) + '</span></div>' +
      (M.ev.length ? M.ev.map(function (e) {
        var u = urg(e.date, M.t);
        return '<div class="bw-row' + (e.overdue ? ' bw-late' : u.n <= 7 ? ' bw-soon' : '') + '"><span>' + md(e.date) + '</span><span>' + esc(e.name) + (e.card ? ' <em>card</em>' : '') + (e.overdue ? ' <em class="bw-em-red">overdue</em>' : '') + '</span><span class="bw-neg">-' + m2(e.amount) + '</span><span class="' + (e.bal < 0 ? 'bw-neg' : '') + '">' + m2(e.bal) + '</span></div>';
      }).join('') : '<div class="bw-row"><span></span><span>No dated bills in this range</span><span></span><span></span></div>') +
      M.owed.map(function (i) { return '<div class="bw-row bw-in"><span>date ?</span><span>Owed: ' + esc(i.payer) + '</span><span class="bw-pos">+' + m2(i.amount) + '</span><span>' + m2(M.left + i.amount) + '</span></div>'; }).join('');
    var tbd = M.tbd.length ? '<div class="bw-sec">Date TBD (not in the bars)</div>' + M.tbd.map(function (x) {
      return '<div class="bw-row bw-tbd"><span>' + esc(x.why) + '</span><span>' + esc(x.name) + (x.est ? ' <em>EST</em>' : '') + (x.card ? ' <em>card</em>' : '') + (x.note ? '<small>' + esc(x.note) + '</small>' : '') + '</span><span>' + m2(x.amount) + '</span><span></span></div>'; }).join('') : '';
    var asOf = String(M.asOf || '').slice(0, 10);
    el.innerHTML = '<div class="bw-top"><div><div class="bw-k">Sand Lily Pad LLC</div><h2>Bill Waterfall</h2></div><button type="button" class="bw-btn" id="bw-refresh">Refresh</button></div>' +
      hero + '<section class="bw-card">' + seg + tiles + chart(M) + '</section>' +
      '<section class="bw-card bw-list">' + rows + tbd + '</section>' +
      '<p class="bw-fine">Cash = Bluevine available ' + md(asOf) + (M.pendingIn ? ' (incl. ' + m2(M.pendingIn) + ' pending in)' : '') + '. card = paid on the company AmEx, not from Bluevine. Owed load pay has no promised date. No new loads counted.</p>';
    bind();
  }
  function bind() {
    var el = root(); if (!el) return;
    el.querySelectorAll('[data-bw-range]').forEach(function (b) { b.addEventListener('click', function () { st.range = b.getAttribute('data-bw-range'); try { localStorage.setItem(RANGE_KEY, st.range); } catch (e) { /* ignore */ } render(); }); });
    var f = document.getElementById('bw-pin-form');
    if (f) f.addEventListener('submit', function (e) { e.preventDefault(); var v = (document.getElementById('bw-pin').value || '').trim(); if (!v) return; try { localStorage.setItem(PIN_KEY, v); } catch (er) { /* ignore */ } load(true); });
    var rf = document.getElementById('bw-refresh'); if (rf) rf.addEventListener('click', function () { load(true); });
  }
  function load(force) {
    var B = window.BlackRamBills; render();
    if (!B || !pin()) return;
    if (!force && fin() && Date.now() - st.lastForce < 120000) return;
    st.lastForce = Date.now();
    B.ensure(function (d) { var el = root(); if (!d && el) el.innerHTML = lockView('Wrong PIN or offline. Try again.'), bind(); else render(); }, true);
  }

  (function css() {
    if (document.getElementById('bw-css')) return;
    var s = document.createElement('style'); s.id = 'bw-css';
    s.textContent =
      '.bw-top{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin:4px 2px 10px}.bw-top h2{margin:0;font-size:var(--fs-xl,22px)}' +
      '.bw-k{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text-3)}' +
      '.bw-btn{min-height:36px;padding:0 14px;border-radius:var(--radius-pill,999px);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-weight:800}' +
      '.bw-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg,16px);padding:14px;margin:0 0 12px}' +
      '.bw-hero{position:relative;border-width:1.5px}.bw-hrow{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:4px;padding-right:76px}' +
      '.bw-hn{font-size:20px;font-weight:900;color:var(--c-text-1);line-height:1.15}.bw-hd{font-size:13px;font-weight:700;color:var(--c-text-2);margin-top:3px}.bw-ha{font-size:26px;font-weight:900;color:var(--c-gold);white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.bw-days{position:absolute;right:14px;top:12px;width:64px;height:64px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px solid var(--c-take);background:var(--c-surface-2)}' +
      '.bw-days b{font-size:22px;font-weight:900;line-height:1;color:var(--c-text-1)}.bw-days span{font-size:10px;font-weight:800;color:var(--c-text-3)}' +
      '.bw-h-amb{border-color:var(--c-maybe);background:linear-gradient(0deg,var(--c-maybe-bg),var(--c-maybe-bg)),var(--c-surface-1)}.bw-h-amb .bw-days{border-color:var(--c-maybe)}.bw-h-amb .bw-days b{color:var(--c-maybe)}' +
      '.bw-h-red{border-color:#F87171;background:linear-gradient(0deg,rgba(248,113,113,.12),rgba(248,113,113,.12)),var(--c-surface-1)}.bw-h-red .bw-days{border-color:#F87171}.bw-h-red .bw-days b,.bw-h-red .bw-hd{color:#FCA5A5}' +
      '.bw-seg{display:flex;gap:4px;background:var(--c-surface-2);border-radius:var(--radius-pill,999px);padding:3px;margin-bottom:10px}.bw-seg button{flex:1;min-height:36px;border:0;border-radius:var(--radius-pill,999px);background:transparent;color:var(--c-text-2);font-weight:800;font-size:13px}' +
      '.bw-seg button[aria-pressed=true]{background:var(--c-gold);color:var(--c-gold-ink)}' +
      '.bw-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:6px}.bw-tiles div{background:var(--c-surface-2);border-radius:var(--radius-md,12px);padding:8px}.bw-tiles span{display:block;font-size:11px;font-weight:700;color:var(--c-text-3)}.bw-tiles b{font-size:18px;font-weight:900}' +
      '.bw-neg{color:#FCA5A5}.bw-pos{color:var(--c-take)}' +
      '.bw-scroll{overflow-x:auto;margin:0 -4px}.bw-svg{width:100%;height:auto;display:block;margin:0 auto}' +
      '.bw-zero{stroke:var(--c-line-strong);stroke-width:1}.bw-link{stroke:var(--c-text-3);stroke-width:1;stroke-dasharray:2 2}' +
      '.bw-start,.bw-end,.bw-end2{fill:var(--c-gold)}.bw-end2{opacity:.65}.bw-endneg{fill:#EF4444}.bw-bill{fill:#F87171;opacity:.9}.bw-late{fill:#DC2626}.bw-in{fill:var(--c-take)}' +
      '.bw-val{font-size:9.5px;font-weight:900;fill:var(--c-text-1);font-family:var(--body)}.bw-v-bill,.bw-v-late,.bw-v-endneg{fill:#FCA5A5}.bw-v-in{fill:var(--c-take)}.bw-v-start,.bw-v-end{fill:var(--c-gold)}' +
      '.bw-lab{font-size:9.5px;font-weight:800;fill:var(--c-text-2);font-family:var(--body)}.bw-sub{font-size:9px;font-weight:700;fill:var(--c-text-3);font-family:var(--body)}' +
      '.bw-leg{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px;color:var(--c-text-2);margin-top:4px}.bw-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}' +
      '.bw-leg .lg-cash{background:var(--c-gold)}.bw-leg .lg-bill{background:#F87171}.bw-leg .lg-late{background:#DC2626}.bw-leg .lg-in{background:var(--c-take)}' +
      '.bw-row{display:grid;grid-template-columns:52px 1fr 82px 84px;gap:6px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--c-line);font-size:13px;color:var(--c-text-2);font-variant-numeric:tabular-nums}' +
      '.bw-row>span:nth-child(3),.bw-row>span:nth-child(4){text-align:right;font-weight:800;color:var(--c-text-1)}.bw-row>span:nth-child(3).bw-neg{color:#FCA5A5}.bw-row>span:nth-child(3).bw-pos{color:var(--c-take)}.bw-row>span.bw-neg{color:#FCA5A5}' +
      '.bw-row-h{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--c-text-3)}.bw-row-h>span{color:var(--c-text-3)!important;font-weight:800}' +
      '.bw-row-start>span{color:var(--c-gold)!important;font-weight:800}.bw-soon>span:first-child{color:var(--c-maybe);font-weight:800}.bw-late>span:first-child{color:#FCA5A5;font-weight:800}' +
      '.bw-row em{font-style:normal;font-size:10px;font-weight:800;padding:0 5px;border-radius:6px;background:var(--c-pass-bg);color:var(--c-text-3)}.bw-row em.bw-em-red{background:rgba(248,113,113,.16);color:#FCA5A5}' +
      '.bw-row small{display:block;font-size:11px;color:var(--c-text-3)}.bw-tbd>span:first-child{font-size:11px;font-weight:800;color:var(--c-text-3)}.bw-in>span:first-child{font-size:11px;color:var(--c-take);font-weight:800}' +
      '.bw-sec{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text-3);margin:12px 0 0}' +
      '.bw-fine{font-size:12px;color:var(--c-text-3);line-height:1.4;margin:4px 2px 0}' +
      '.bw-lock{text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px}.bw-lock h3{margin:0}' +
      '.bw-pin{display:flex;gap:8px;width:100%;max-width:320px}.bw-pin input{flex:1;min-width:0;min-height:var(--tap,44px);padding:0 12px;border-radius:var(--radius-sm,10px);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1)}' +
      '@media (min-width:900px){.bw-row{grid-template-columns:70px 1fr 120px 120px;font-size:14px}}';
    document.head.appendChild(s);
  })();

  function init() {
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'bills') load(false); });
    document.addEventListener('blackram:financials', function () { var p = document.getElementById('panel-bills'); if (p && !p.hidden) render(); });
    var p = document.getElementById('panel-bills'); if (p && !p.hidden) load(false);
  }
  window.BlackRamBillWaterfall = { render: render, show: function () { load(false); }, model: function (r) { var d = fin(); return d ? model(d, r || st.range) : null; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
