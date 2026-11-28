/* Black Ram Logistics - Bill Waterfall (v145, cards v155, priority).
   Swipeable bill cards (scroll-snap) under the chart: one card per upcoming bill,
   summary last. User-set pay order (localStorage blackram_bill_priority_v1).
   Reorder mode: long-press handle (iPhone) or drag (desktop), plus up/down.
   Before/After cash and OK/Short follow the chosen pay order.
   What is due next and what cash is left after each bill. PIN-gated: cash, bills, dates and
   owed load pay all come from the relay /financials payload (bills, loans.others, income,
   account), loaded through window.BlackRamBills.ensure (loans.js). Targets inputs supply only
   the Other monthly and Meshach amounts already shown on the Break-even sheets. Plain ASCII. */
(function () {
  'use strict';
  var FIN_KEY = 'blackram_fin_session_v1', PIN_KEY = 'blackram_relay_pin_v1', RANGE_KEY = 'blackram_billwf_range_v1', PRI_KEY = 'blackram_bill_priority_v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SHORT = { truck: 'Truck', trailer: 'Trailer', ins: 'Insur.', truckstop: 'TStop', amex_8008: 'AmEx' };
  var st = { range: rget(), lastForce: 0, reorder: false };

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
      if (!b.next) { tbd.push({ id: b.id || null, name: name, amount: b.amount, est: !!b.est, card: card, why: 'date TBD' }); return; }
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
        if (rest > 0) out.push({ id: 'other-mo', name: 'Other monthly (phone, software)', amount: rest, why: 'date TBD', note: 'Targets ' + m0(om.amount) + ' less Truckstop $42' });
      }
      var M = T && T.model ? T.model() : null;
      if (M && M.driverMo) out.push({ id: 'meshach', name: 'Meshach (from profit only)', amount: M.driverMo, why: 'after bills', note: 'paid only from profit left after bills' });
    } catch (e) { /* ignore */ }
    return out;
  }
  /* v146: pending Bluevine debits not yet in the pulled balance (payload pending_debits, e.g. the 11/27
     Progressive ACH). Dropped once a newer pull includes them: a bank line with the same amount within
     5 days, a matching pending outgoing amount, or a bank as-of date later than the debit date. */
  function pendingAdj(d) {
    var asOf = String(d.bank_as_of || d.as_of || '').slice(0, 10), acct = d.account || {}, out = { total: 0, items: [] };
    (d.pending_debits || []).forEach(function (x) {
      if (x.applied === false) return;
      var amt = Number(x.amount); if (!isFinite(amt) || !x.date) return;
      var hit = (d.transactions || []).some(function (t) { return Math.abs(Number(t.amount) - amt) < 0.005 && Math.abs(days(String(t.date).slice(0, 10), x.date)) <= 5; });
      if (hit || (acct.pending_outgoing && Math.abs(Number(acct.pending_outgoing) - amt) < 0.005) || asOf > x.date) return;
      out.total = Math.round((out.total + amt) * 100) / 100; out.items.push(x);
    });
    return out;
  }

  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'; }
  function eventKey(e) {
    var id = e.id || slug(e.name || e.payee || '');
    return e.date ? (id + ':' + e.date) : ('tbd:' + id);
  }
  function loadPri() {
    try { var j = JSON.parse(localStorage.getItem(PRI_KEY) || 'null'); return (j && Array.isArray(j.order)) ? j.order : []; }
    catch (e) { return []; }
  }
  function savePri(order) {
    try {
      if (!order || !order.length) localStorage.removeItem(PRI_KEY);
      else localStorage.setItem(PRI_KEY, JSON.stringify({ order: order }));
    } catch (e) { /* private mode */ }
  }
  function applyOrder(list, saved) {
    if (!saved || !saved.length) return list.slice();
    var map = {}, used = {}, out = [];
    list.forEach(function (e) { map[eventKey(e)] = e; });
    saved.forEach(function (k) { if (map[k] && !used[k]) { out.push(map[k]); used[k] = 1; } });
    list.forEach(function (e) { var k = eventKey(e); if (!used[k]) { out.push(e); used[k] = 1; } });
    return out;
  }
  function sameOrder(a, b) { return (a || []).join('\0') === (b || []).join('\0'); }

  function adjNote(A) { return A.items.map(function (x) { return 'incl. ' + x.label + ' ' + md(x.date) + ' ' + (x.amount < 0 ? '-' : '+') + Math.abs(x.amount).toLocaleString('en-US', { minimumFractionDigits: 2 }); }).join(', '); }
  function model(d, range) {
    var t = today(), end = endFor(range, t), acct = d.account || {};
    var start = acct.available != null ? Number(acct.available) : null;
    var adj = pendingAdj(d), cash = start;
    if (start != null && adj.total) start = Math.round((start + adj.total) * 100) / 100;
    var be = billEvents(d, t, end), all = billEvents(d, t, '9999-12-31').ev;
    var tbd = be.tbd.concat(targetsTbd());
    var defItems = be.ev.concat(tbd), defKeys = defItems.map(eventKey);
    var saved = loadPri();
    var items = applyOrder(defItems, saved);
    var custom = saved.length > 0 && !sameOrder(items.map(eventKey), defKeys);
    var run = start != null ? start : 0, ev = [], tbdOrd = [];
    items.forEach(function (e) {
      if (e.date) {
        e.before = run; run = Math.round((run - e.amount) * 100) / 100; e.bal = run; ev.push(e);
      } else tbdOrd.push(e);
    });
    var owed = (d.income || []).filter(function (i) { return i.status === 'unpaid' && i.amount; });
    var owedTot = owed.reduce(function (a, i) { return a + i.amount; }, 0);
    return { t: t, end: end, start: start, cash: cash, adj: adj, asOf: d.bank_as_of || d.as_of, ev: ev, tbd: tbdOrd, items: items, defKeys: defKeys, keys: items.map(eventKey), custom: custom,
      next: ev[0] || all[0] || null,
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


  function payMethod(e) {
    if (e.why === 'after bills') return 'From profit';
    if (e.card) return 'Card';
    if (e.why) return 'Pay method not set';
    return 'ACH';
  }
  function firstShort(ev) { return (ev || []).filter(function (e) { return e.bal < 0; })[0] || null; }
  function billsTot(ev) { return (ev || []).reduce(function (a, e) { return a + e.amount; }, 0); }
  function miniBar(before, after) {
    var lo = Math.min(0, after, before), hi = Math.max(0, after, before, 1);
    if (hi - lo < 1) hi = lo + 1;
    var W = 280, H = 36, l = 36, r = 36, y = 16;
    function X(v) { return l + (W - l - r) * (v - lo) / (hi - lo); }
    var xa = X(after), xb = X(before), xz = X(0), x1 = Math.min(xa, xz), x2 = Math.max(xa, xz);
    var neg = after < 0;
    return '<svg class="bw-mini" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Before ' + m2(before) + ', after ' + m2(after) + '">' +
      '<line x1="' + l + '" x2="' + (W - r) + '" y1="' + y + '" y2="' + y + '" class="bw-mini-track"/>' +
      '<line x1="' + xz.toFixed(1) + '" x2="' + xz.toFixed(1) + '" y1="8" y2="24" class="bw-mini-zero"/>' +
      '<line x1="' + xb.toFixed(1) + '" x2="' + xa.toFixed(1) + '" y1="' + y + '" y2="' + y + '" class="' + (neg ? 'bw-mini-drop-neg' : 'bw-mini-drop') + '"/>' +
      (neg ? '<line x1="' + x1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y1="' + y + '" y2="' + y + '" class="bw-mini-short"/>' : '') +
      '<circle cx="' + xb.toFixed(1) + '" cy="' + y + '" r="3.5" class="bw-mini-b"/>' +
      '<circle cx="' + xa.toFixed(1) + '" cy="' + y + '" r="4.5" class="' + (neg ? 'bw-mini-a-neg' : 'bw-mini-a') + '"/>' +
      '<text x="' + xz.toFixed(1) + '" y="33" text-anchor="middle" class="bw-mini-lbl">0</text></svg>';
  }
  function billCard(e, i, n, t, isFirst) {
    var u = urg(e.date, t), short = e.bal < 0, chip = short ? '<span class="bw-chip bw-chip-short">Short ' + m0(Math.abs(e.bal)) + '</span>' : '<span class="bw-chip bw-chip-ok">OK</span>';
    var daysN = u.n < 0 ? -u.n : u.n, daysL = u.n < 0 ? 'days late' : (u.n === 1 ? 'day' : 'days');
    var kick = isFirst ? (e.priority ? 'Pay first' : 'Due next') : (e.priority ? 'Priority ' + e.priority : 'Upcoming');
    return '<article class="bw-slide bw-scard bw-h-' + u.cls + (short ? ' bw-scard-short' : '') + '" data-bw-i="' + i + '" data-bw-key="' + esc(eventKey(e)) + '" aria-label="' + esc((isFirst ? kick + '. ' : '') + e.name + ', ' + m2(e.amount) + ', ' + md(e.date)) + '">' +
      '<div class="bw-scard-top"><div class="bw-k">' + kick + '</div>' +
      '<div class="bw-days bw-days-sm" aria-hidden="true"><b>' + daysN + '</b><span>' + daysL + '</span></div></div>' +
      '<div class="bw-hn">' + esc(e.name) + '</div>' +
      '<div class="bw-ha">' + m2(e.amount) + '</div>' +
      '<div class="bw-hd">Due ' + md(e.date) + ' | ' + u.rel + ' | ' + esc(payMethod(e)) + '</div>' +
      '<div class="bw-ba"><div><span>Before</span><b>' + m2(e.before) + '</b></div><div><span>After</span><b class="' + (short ? 'bw-neg' : 'bw-pos') + '">' + m2(e.bal) + '</b></div></div>' +
      miniBar(e.before, e.bal) +
      '<div class="bw-scard-foot">' + chip + '</div></article>';
  }
  function tbdCard(x, i) {
    return '<article class="bw-slide bw-scard bw-scard-tbd" data-bw-i="' + i + '" aria-label="Date TBD, ' + esc(x.name) + ', ' + m2(x.amount) + '">' +
      '<div class="bw-k">Date TBD</div>' +
      '<div class="bw-hn">' + esc(x.name) + '</div>' +
      '<div class="bw-ha">' + m2(x.amount) + '</div>' +
      '<div class="bw-hd">' + esc(x.why === 'after bills' ? 'After bills' : 'Due date not set') + ' | ' + esc(payMethod(x)) + (x.est ? ' | EST' : '') + '</div>' +
      (x.note ? '<p class="bw-fine">' + esc(x.note) + '</p>' : '') +
      '<div class="bw-scard-foot"><span class="bw-chip bw-chip-tbd">Date TBD</span><span class="bw-hd">Not in the cash bars</span></div></article>';
  }
  function sumBlock(label, M) {
    var sh = firstShort(M.ev), tot = billsTot(M.ev);
    return '<div class="bw-sum-blk"><div class="bw-k">' + esc(label) + '</div>' +
      '<div class="bw-sum-row"><div><span>Bills due</span><b class="bw-neg">' + m0(tot) + '</b></div>' +
      '<div><span>Left ' + md(M.end) + '</span><b class="' + (M.left < 0 ? 'bw-neg' : 'bw-pos') + '">' + m0(M.left) + '</b></div></div>' +
      '<div class="bw-hd">' + (sh ? 'First short: ' + md(sh.date) + ' ' + esc(sh.name) + ' | Short ' + m0(Math.abs(sh.bal)) : 'No short date in this range') + '</div></div>';
  }
  function summaryCard(d, i, n) {
    var a = model(d, '30'), b = model(d, '60');
    return '<article class="bw-slide bw-scard bw-scard-sum" data-bw-i="' + i + '" aria-label="Summary, 30 and 60 day totals">' +
      '<div class="bw-k">Summary</div>' +
      '<div class="bw-hn">30 and 60 days</div>' +
      sumBlock('30 days', a) + sumBlock('60 days', b) +
      '</article>';
  }

  function orderBar(M) {
    var custom = !!M.custom;
    return '<div class="bw-orderbar">' +
      '<div class="bw-order-lbl">Order: <b class="' + (custom ? 'bw-pri-on' : '') + '">' + (custom ? 'Priority' : 'Due date') + '</b></div>' +
      '<div class="bw-order-acts">' +
      ((custom || st.reorder) ? '<button type="button" class="bw-btn" id="bw-reset" aria-label="Reset to due date">Reset to due date</button>' : '') +
      '<button type="button" class="bw-btn' + (st.reorder ? ' gold' : '') + '" id="bw-reorder">' + (st.reorder ? 'Done' : 'Reorder') + '</button>' +
      '</div></div>';
  }
  function orderList(M) {
    var items = M.items || [], n = items.length;
    if (!n) return '<p class="bw-fine">No bills to reorder in this range.</p>';
    st._ordKeys = items.map(eventKey);
    st._defKeys = M.defKeys || st._ordKeys.slice();
    var rows = items.map(function (e, i) {
      var short = e.date && e.bal < 0;
      var sub = e.date ? ('Due ' + md(e.date) + ' | ' + payMethod(e)) : ((e.why === 'after bills' ? 'After bills' : 'Date TBD') + ' | ' + payMethod(e));
      var after = e.date ? ('<span class="' + (short ? 'bw-neg' : 'bw-pos') + '">' + (short ? 'Short ' + m0(Math.abs(e.bal)) : 'OK') + ' | After ' + m2(e.bal) + '</span>') : '<span class="bw-hd">Not in the cash bars</span>';
      return '<li class="bw-ord" data-bw-i="' + i + '" data-bw-key="' + esc(eventKey(e)) + '" aria-label="' + esc(e.name) + ', position ' + (i + 1) + ' of ' + n + '">' +
        '<button type="button" class="bw-drag" aria-label="Drag to reorder ' + esc(e.name) + '. Long press, then drag." title="Long press, then drag">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h10v2H7v-2z"/></svg></button>' +
        '<div class="bw-ord-m"><b>' + esc(e.name) + '</b><small>' + esc(sub) + '</small>' + after + '</div>' +
        '<b class="bw-ord-amt">' + m2(e.amount) + '</b>' +
        '<div class="bw-ord-btns">' +
        '<button type="button" class="bw-arrow bw-ord-up" data-bw-move="-1" data-bw-i="' + i + '" aria-label="Move up" ' + (i === 0 ? 'disabled' : '') + '>' + chevUpDown(-1) + '</button>' +
        '<button type="button" class="bw-arrow bw-ord-dn" data-bw-move="1" data-bw-i="' + i + '" aria-label="Move down" ' + (i === n - 1 ? 'disabled' : '') + '>' + chevUpDown(1) + '</button>' +
        '</div></li>';
    }).join('');
    return '<section class="bw-card bw-order-card" id="bw-order-card"><div class="bw-k">Reorder bills</div>' +
      '<p class="bw-fine">Long press the handle, then drag. Or use the up and down buttons. Cash Before / After follows this pay order. The summary card stays last.</p>' +
      '<ol class="bw-order" id="bw-order">' + rows + '</ol></section>';
  }
  function commitOrder(keys, stay) {
    var def = st._defKeys || [];
    if (sameOrder(keys, def)) savePri([]);
    else savePri(keys);
    st.carIdx = stay != null ? stay : 0;
    render();
  }
  function bindReorder() {
    var list = document.getElementById('bw-order'); if (!list) return;
    list.querySelectorAll('[data-bw-move]').forEach(function (b) {
      b.addEventListener('click', function () {
        var keys = (st._ordKeys || []).slice(), i = +b.getAttribute('data-bw-i'), j = i + (+b.getAttribute('data-bw-move'));
        if (j < 0 || j >= keys.length) return;
        var t = keys[i]; keys[i] = keys[j]; keys[j] = t;
        commitOrder(keys, j);
      });
    });
    var timer, dragging, startY, startX, curIdx, origin, handleEl;
    function rowAt(y) {
      var rows = [].slice.call(list.querySelectorAll('.bw-ord')), best = 0, bd = 1e9;
      rows.forEach(function (r, i) {
        var b = r.getBoundingClientRect(), d = Math.abs(y - (b.top + b.height / 2));
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }
    function lift(row) {
      dragging = true;
      row.classList.add('bw-ord-dragging');
      try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* ignore */ }
      try { if (handleEl && handleEl.setPointerCapture) handleEl.setPointerCapture(handleEl._pid); } catch (e) { /* ignore */ }
    }
    list.addEventListener('pointerdown', function (e) {
      var h = e.target.closest && e.target.closest('.bw-drag'); if (!h) return;
      var row = h.closest('.bw-ord'); if (!row) return;
      if (e.pointerType !== 'touch') e.preventDefault();
      handleEl = h; h._pid = e.pointerId;
      origin = curIdx = +row.getAttribute('data-bw-i');
      startY = e.clientY; startX = e.clientX; dragging = false;
      if (e.pointerType === 'touch') timer = setTimeout(function () { lift(row); }, 400);
      else lift(row);
    });
    list.addEventListener('pointermove', function (e) {
      if (timer && !dragging && (Math.abs(e.clientY - startY) > 12 || Math.abs(e.clientX - startX) > 12)) { clearTimeout(timer); timer = null; }
      if (!dragging) return;
      e.preventDefault();
      var i = rowAt(e.clientY);
      if (i === curIdx) return;
      var rows = list.querySelectorAll('.bw-ord'), row = rows[curIdx], target = rows[i];
      if (!row || !target) return;
      if (i < curIdx) list.insertBefore(row, target); else list.insertBefore(row, target.nextSibling);
      curIdx = i;
    }, { passive: false });
    function endDrag() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!dragging) return;
      dragging = false;
      var rows = [].slice.call(list.querySelectorAll('.bw-ord'));
      rows.forEach(function (r) { r.classList.remove('bw-ord-dragging'); });
      var keys = rows.map(function (r) { return r.getAttribute('data-bw-key'); });
      if (!sameOrder(keys, st._ordKeys)) commitOrder(keys, curIdx);
    }
    list.addEventListener('pointerup', endDrag);
    list.addEventListener('pointercancel', endDrag);
  }

  function chevUpDown(dir) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="' + (dir < 0 ? 'M6 14.5L12 8.5l6 6' : 'M6 9.5l6 6 6-6') + '"/></svg>';
  }
  function chev(dir) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="' + (dir < 0 ? 'M14.5 6L8.5 12l6 6' : 'M9.5 6l6 6-6 6') + '"/></svg>';
  }
  function carousel(d, M) {
    var cards = [], first = true, pri = 0;
    (M.items || M.ev.concat(M.tbd || [])).forEach(function (e) {
      if (e.date) { pri += 1; e.priority = M.custom ? pri : 0; cards.push({ html: billCard(e, cards.length, 0, M.t, first), short: e.bal < 0, kind: 'bill', name: e.name, key: eventKey(e) }); first = false; }
      else cards.push({ html: tbdCard(e, cards.length), kind: 'tbd', name: e.name, key: eventKey(e) });
    });
    cards.push({ html: summaryCard(d, cards.length, 0), kind: 'sum', name: 'Summary' });
    if (!cards.length) return '';
    var n = cards.length;
    var slides = cards.map(function (c, i) { return c.html.replace('data-bw-i="' + i + '"', 'data-bw-i="' + i + '" data-bw-n="' + n + '"'); }).join('');
    var dots = cards.map(function (c, i) {
      return '<button type="button" class="bw-dot" data-bw-go="' + i + '" role="tab" aria-label="' + esc((c.kind === 'sum' ? 'Summary' : c.name) + ', card ' + (i + 1) + ' of ' + n) + '"' + (i === 0 ? ' aria-current="true"' : '') + '><i></i></button>';
    }).join('');
    return '<section class="bw-car" aria-roledescription="carousel" aria-label="Upcoming bills">' +
      '<div class="bw-track" id="bw-track" tabindex="0">' + slides + '</div>' +
      '<div class="bw-nav">' +
      '<button type="button" class="bw-arrow" id="bw-prev" aria-label="Previous bill" disabled>' + chev(-1) + '</button>' +
      '<div class="bw-steps"><div class="bw-step" id="bw-step" aria-live="polite">1 of ' + n + '</div>' +
      '<div class="bw-dots" role="tablist" aria-label="Bills">' + dots + '</div></div>' +
      '<button type="button" class="bw-arrow" id="bw-next" aria-label="Next bill">' + chev(1) + '</button>' +
      '</div></section>';
  }
  function bindCarousel() {
    var track = document.getElementById('bw-track'); if (!track) return;
    var slides = [].slice.call(track.querySelectorAll('.bw-slide')), n = slides.length;
    var step = document.getElementById('bw-step'), prev = document.getElementById('bw-prev'), next = document.getElementById('bw-next');
    var dots = [].slice.call(document.querySelectorAll('.bw-dot'));
    var reduce = false; try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* ignore */ }
    function slideLeft(s) {
      return s.getBoundingClientRect().left - track.getBoundingClientRect().left + track.scrollLeft;
    }
    function idx() {
      var left = track.scrollLeft, best = 0, bd = 1e9;
      slides.forEach(function (s, i) { var d = Math.abs(slideLeft(s) - left); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    function go(i, smooth) {
      i = Math.max(0, Math.min(n - 1, i));
      st.carIdx = i;
      var sl = slides[i]; if (!sl) return;
      var pad = parseFloat(window.getComputedStyle(track).paddingLeft) || 0;
      track.scrollTo({ left: Math.max(0, slideLeft(sl) - pad), behavior: (smooth && !reduce) ? 'smooth' : 'auto' });
      mark(i);
    }
    function mark(i) {
      if (step) step.textContent = (i + 1) + ' of ' + n;
      if (prev) prev.disabled = i <= 0;
      if (next) next.disabled = i >= n - 1;
      dots.forEach(function (d, k) { if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
      slides.forEach(function (s, k) { s.setAttribute('aria-hidden', k === i ? 'false' : 'true'); });
    }
    var ticking = false;
    track.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () { ticking = false; mark(idx()); });
    }, { passive: true });
    if (prev) prev.addEventListener('click', function () { go(idx() - 1, true); });
    if (next) next.addEventListener('click', function () { go(idx() + 1, true); });
    dots.forEach(function (d) { d.addEventListener('click', function () { go(+d.getAttribute('data-bw-go'), true); }); });
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx() - 1, true); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx() + 1, true); }
      else if (e.key === 'Home') { e.preventDefault(); go(0, true); }
      else if (e.key === 'End') { e.preventDefault(); go(n - 1, true); }
    });
    go(Math.min(st.carIdx || 0, n - 1), false);
    st.goCard = go;
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
    if (st._rangeForCar !== st.range) { st.carIdx = 0; st._rangeForCar = st.range; }
    var M = model(d, st.range);
    var seg = '<div class="bw-seg" role="group" aria-label="Range">' + [['30', '30 days'], ['60', '60 days'], ['mo', 'This month']].map(function (r) {
      return '<button type="button" data-bw-range="' + r[0] + '" aria-pressed="' + (st.range === r[0]) + '">' + r[1] + '</button>'; }).join('') + '</div>';
    var tiles = '<div class="bw-tiles"><div><span>Cash now</span><b class="num-yellow">' + m0(M.start) + '</b>' + (M.adj.total ? '<small class="bw-adj">' + esc(adjNote(M.adj)) + '</small>' : '') + '</div><div><span>Bills due</span><b class="bw-neg">' + m0(M.ev.reduce(function (a, e) { return a + e.amount; }, 0)) + '</b></div>' +
      '<div><span>Left ' + md(M.end) + '</span><b class="' + (M.left < 0 ? 'bw-neg' : 'bw-pos') + '">' + m0(M.left) + '</b></div></div>';
    var rows = '<div class="bw-row bw-row-h"><span>Date</span><span>Bill</span><span>Amount</span><span>Balance</span></div>' +
      '<div class="bw-row bw-row-start"><span>' + md(String(M.asOf).slice(0, 10)) + '</span><span>Bluevine cash' + (M.adj.total ? '<small>' + m2(M.cash) + ' as of the ' + md(String(M.asOf).slice(0, 10)) + ' pull</small>' : '') + '</span><span></span><span>' + m2(M.cash) + '</span></div>' +
      M.adj.items.map(function (x) { return '<div class="bw-row bw-row-pend"><span>' + md(x.date) + '</span><span>' + esc(x.label) + ' <em>pending</em></span><span class="bw-neg">' + (x.amount < 0 ? '-' : '+') + m2(Math.abs(x.amount)) + '</span><span>' + m2(M.start) + '</span></div>'; }).join('') +
      (M.ev.length ? M.ev.map(function (e) {
        var u = urg(e.date, M.t);
        return '<div class="bw-row' + (e.overdue ? ' bw-late' : u.n <= 7 ? ' bw-soon' : '') + '"><span>' + md(e.date) + '</span><span>' + esc(e.name) + (e.card ? ' <em>card</em>' : '') + (e.overdue ? ' <em class="bw-em-red">overdue</em>' : '') + '</span><span class="bw-neg">-' + m2(e.amount) + '</span><span class="' + (e.bal < 0 ? 'bw-neg' : '') + '">' + m2(e.bal) + '</span></div>';
      }).join('') : '<div class="bw-row"><span></span><span>No dated bills in this range</span><span></span><span></span></div>') +
      M.owed.map(function (i) { return '<div class="bw-row bw-in"><span>date ?</span><span>Owed: ' + esc(i.payer) + '</span><span class="bw-pos">+' + m2(i.amount) + '</span><span>' + m2(M.left + i.amount) + '</span></div>'; }).join('');
    var tbd = M.tbd.length ? '<div class="bw-sec">Date TBD (not in the bars)</div>' + M.tbd.map(function (x) {
      return '<div class="bw-row bw-tbd"><span>' + esc(x.why) + '</span><span>' + esc(x.name) + (x.est ? ' <em>EST</em>' : '') + (x.card ? ' <em>card</em>' : '') + (x.note ? '<small>' + esc(x.note) + '</small>' : '') + '</span><span>' + m2(x.amount) + '</span><span></span></div>'; }).join('') : '';
    var asOf = String(M.asOf || '').slice(0, 10);
    el.innerHTML = '<div class="bw-top"><div><div class="bw-k">Sand Lily Pad LLC</div><h2>Bill Waterfall</h2></div><button type="button" class="bw-btn" id="bw-refresh">Refresh</button></div>' +
      '<section class="bw-card">' + seg + tiles + orderBar(M) + '</section>' +
      (st.reorder ? orderList(M) : carousel(d, M)) +
      '<details class="bw-fold" id="bw-chart-fold" open><summary>Waterfall chart</summary><div class="bw-fold-body">' + chart(M) + '</div></details>' +
      '<details class="bw-fold" id="bw-list-fold"><summary>List</summary><div class="bw-fold-body"><div class="bw-card bw-list">' + rows + tbd + '</div></div></details>' +
      '<p class="bw-fine">Cash = Bluevine available ' + md(asOf) + (M.pendingIn ? ' (incl. ' + m2(M.pendingIn) + ' pending in)' : '') + (M.adj.total ? ', ' + esc(adjNote(M.adj)) + ' (not in that pull yet)' : '') + '. Card = company AmEx, ACH = Bluevine. Owed load pay has no promised date. No new loads counted.</p>';
    bind();
  }
  function bind() {
    var el = root(); if (!el) return;
    el.querySelectorAll('[data-bw-range]').forEach(function (b) { b.addEventListener('click', function () { st.range = b.getAttribute('data-bw-range'); try { localStorage.setItem(RANGE_KEY, st.range); } catch (e) { /* ignore */ } render(); }); });
    var f = document.getElementById('bw-pin-form');
    if (f) f.addEventListener('submit', function (e) { e.preventDefault(); var v = (document.getElementById('bw-pin').value || '').trim(); if (!v) return; try { localStorage.setItem(PIN_KEY, v); } catch (er) { /* ignore */ } load(true); });
    var rf = document.getElementById('bw-refresh'); if (rf) rf.addEventListener('click', function () { load(true); });
    var rb = document.getElementById('bw-reorder');
    if (rb) rb.addEventListener('click', function () { st.reorder = !st.reorder; if (!st.reorder) st.carIdx = 0; render(); });
    var rs = document.getElementById('bw-reset');
    if (rs) rs.addEventListener('click', function () { savePri([]); st.carIdx = 0; render(); });
    if (st.reorder) bindReorder(); else bindCarousel();
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
      '.bw-btn{min-height:var(--tap,44px);padding:0 14px;border-radius:var(--radius-pill,999px);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-weight:800}' +
      '.bw-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg,16px);padding:14px;margin:0 0 12px}' +
      '.bw-hero{position:relative;border-width:1.5px}.bw-hrow{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin-top:4px;padding-right:76px}' +
      '.bw-hn{font-size:20px;font-weight:900;color:var(--c-text-1);line-height:1.15}.bw-hd{font-size:13px;font-weight:700;color:var(--c-text-2);margin-top:3px}.bw-ha{font-size:26px;font-weight:900;color:var(--c-gold);white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.bw-days{position:absolute;right:14px;top:12px;width:64px;height:64px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px solid var(--c-take);background:var(--c-surface-2)}' +
      '.bw-days b{font-size:22px;font-weight:900;line-height:1;color:var(--c-text-1)}.bw-days span{font-size:10px;font-weight:800;color:var(--c-text-3)}' +
      '.bw-h-amb{border-color:var(--c-maybe);background:linear-gradient(0deg,var(--c-maybe-bg),var(--c-maybe-bg)),var(--c-surface-1)}.bw-h-amb .bw-days{border-color:var(--c-maybe)}.bw-h-amb .bw-days b{color:var(--c-maybe)}' +
      '.bw-h-red{border-color:#F87171;background:linear-gradient(0deg,rgba(248,113,113,.12),rgba(248,113,113,.12)),var(--c-surface-1)}.bw-h-red .bw-days{border-color:#F87171}.bw-h-red .bw-days b,.bw-h-red .bw-hd{color:#FCA5A5}' +
      '.bw-seg{display:flex;gap:4px;background:var(--c-surface-2);border-radius:var(--radius-pill,999px);padding:3px;margin-bottom:10px}.bw-seg button{flex:1;min-height:var(--tap,44px);border:0;border-radius:var(--radius-pill,999px);background:transparent;color:var(--c-text-2);font-weight:800;font-size:13px}' +
      '.bw-seg button[aria-pressed=true]{background:var(--c-gold);color:var(--c-gold-ink)}' +
      '.bw-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:6px}.bw-tiles div{background:var(--c-surface-2);border-radius:var(--radius-md,12px);padding:8px}.bw-tiles span{display:block;font-size:11px;font-weight:700;color:var(--c-text-3)}.bw-tiles b{font-size:18px;font-weight:900}' +
      '.bw-tiles small.bw-adj{display:block;font-size:10px;font-weight:700;color:var(--c-text-3);line-height:1.25;margin-top:2px}.bw-row-start>span small{display:block;color:var(--c-text-3);font-weight:700}.bw-row-pend>span:first-child{color:#FCA5A5;font-weight:800}' +
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
      '.bw-car{margin:0 0 12px}' +
      '.bw-track{position:relative;display:flex;gap:10px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scroll-padding-inline:12px;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;padding:2px 12px 8px;margin:0 -2px;min-height:280px;scrollbar-width:none}' +
      '.bw-track::-webkit-scrollbar{display:none}' +
      '.bw-slide{flex:0 0 calc(100% - 28px);max-width:420px;scroll-snap-align:start;scroll-snap-stop:always;min-height:280px;box-sizing:border-box}' +
      '.bw-scard{background:var(--c-surface-1);border:1.5px solid var(--c-line);border-radius:var(--radius-lg,16px);padding:14px 14px 12px;display:flex;flex-direction:column;position:relative}' +
      '.bw-scard-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-height:64px}' +
      '.bw-days-sm{position:static;flex:none;width:58px;height:58px}' +
      '.bw-scard .bw-hn{margin:0 0 2px;min-height:2.3em}.bw-scard .bw-ha{margin:0 0 4px}.bw-scard .bw-hd{margin:0 0 10px}' +
      '.bw-ba{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 6px}.bw-ba div{background:var(--c-surface-2);border-radius:var(--radius-md,12px);padding:8px 10px}.bw-ba span{display:block;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--c-text-3)}.bw-ba b{font-size:18px;font-weight:900;font-variant-numeric:tabular-nums;color:var(--c-text-1)}.bw-ba b.bw-neg{color:#FCA5A5}.bw-ba b.bw-pos{color:var(--c-take)}' +
      '.bw-mini{width:100%;height:36px;display:block;margin:2px 0 6px;flex:none}.bw-mini-track{stroke:var(--c-line-strong);stroke-width:6;stroke-linecap:round}.bw-mini-zero{stroke:var(--c-text-3);stroke-width:1}' +
      '.bw-mini-drop{stroke:var(--c-gold);stroke-width:6;stroke-linecap:round}.bw-mini-drop-neg{stroke:#F87171;stroke-width:6;stroke-linecap:round}.bw-mini-short{stroke:#DC2626;stroke-width:6;stroke-linecap:round}' +
      '.bw-mini-b{fill:var(--c-text-3)}.bw-mini-a{fill:var(--c-gold)}.bw-mini-a-neg{fill:#F87171}.bw-mini-lbl{fill:var(--c-text-3);font-size:9px;font-weight:700;font-family:var(--body)}' +
      '.bw-scard-foot{display:flex;align-items:center;gap:8px;margin-top:auto;min-height:28px}' +
      '.bw-chip{display:inline-flex;align-items:center;min-height:24px;padding:0 8px;border-radius:var(--radius-pill,999px);font-size:12px;font-weight:800}' +
      '.bw-chip-ok{background:rgba(52,211,153,.16);color:var(--c-take)}.bw-chip-short{background:rgba(248,113,113,.16);color:#FCA5A5}.bw-chip-tbd{background:var(--c-pass-bg);color:var(--c-text-3)}' +
      '.bw-scard-short{border-color:#F87171}.bw-scard-tbd{border-style:dashed}.bw-scard-sum .bw-hn{margin-right:0;min-height:0}' +
      '.bw-sum-blk{background:var(--c-surface-2);border-radius:var(--radius-md,12px);padding:10px;margin:8px 0 0}.bw-sum-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:4px 0}.bw-sum-row span{display:block;font-size:11px;font-weight:700;color:var(--c-text-3)}.bw-sum-row b{font-size:20px;font-weight:900}' +
      '.bw-nav{display:flex;align-items:center;gap:8px;margin:4px 0 0;min-height:var(--tap,44px)}' +
      '.bw-arrow{flex:none;width:var(--tap,44px);height:var(--tap,44px);padding:0;border-radius:50%;border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);display:inline-flex;align-items:center;justify-content:center}' +
      '.bw-arrow svg{width:22px;height:22px}.bw-arrow:disabled{opacity:.35}' +
      '.bw-steps{flex:1;min-width:0;text-align:center}.bw-step{font-size:12px;font-weight:800;color:var(--c-text-2);margin-bottom:2px}' +
      '.bw-dots{display:flex;justify-content:center;gap:0;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}' +
      '.bw-dot{flex:none;width:32px;height:var(--tap,44px);padding:0;border:0;background:transparent;display:inline-flex;align-items:center;justify-content:center}' +
      '.bw-dot i{width:8px;height:8px;border-radius:50%;background:var(--c-line-strong);display:block}' +
      '.bw-dot[aria-current=true] i{background:var(--c-gold);width:16px;border-radius:5px}' +
      '.bw-fold{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg,16px);padding:4px 14px 10px;margin:0 0 12px}' +
      '.bw-fold>summary{cursor:pointer;min-height:var(--tap,44px);display:flex;align-items:center;font-size:var(--fs-sm,14px);font-weight:800;color:var(--c-accent-hi);list-style:none}' +
      '.bw-fold>summary::-webkit-details-marker{display:none}' +
      '.bw-fold>summary::after{content:"";margin-left:auto;flex:0 0 16px;width:16px;height:16px;background-color:currentColor;-webkit-mask:var(--caret-svg) center/contain no-repeat;mask:var(--caret-svg) center/contain no-repeat;transition:transform .25s ease}' +
      '.bw-fold[open]>summary::after{transform:rotate(180deg)}' +
      '@media (prefers-reduced-motion: reduce){.bw-track{scroll-behavior:auto}.bw-fold>summary::after{transition:none}}' +
      '.bw-orderbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:10px}' +'.bw-order-lbl{font-size:13px;font-weight:700;color:var(--c-text-3)}.bw-order-lbl b{color:var(--c-text-1);font-weight:900}.bw-order-lbl b.bw-pri-on{color:var(--c-gold)}' +'.bw-order-acts{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto}' +'.bw-btn.gold{background:var(--c-gold);border-color:var(--c-gold);color:var(--c-gold-ink)}' +'.bw-order{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}' +'.bw-ord{display:flex;align-items:center;gap:6px;min-height:64px;padding:6px;border:1px solid var(--c-line);border-radius:var(--radius-md,12px);background:var(--c-surface-2);touch-action:pan-y;-webkit-user-select:none;user-select:none}' +'.bw-ord-dragging{opacity:.72;border-color:var(--c-gold);box-shadow:0 8px 24px rgba(0,0,0,.35)}' +'.bw-drag{flex:none;width:var(--tap,44px);height:var(--tap,44px);padding:0;border:0;border-radius:var(--radius-sm,10px);background:rgba(255,255,255,.04);color:var(--c-text-2);display:inline-flex;align-items:center;justify-content:center;touch-action:none}' +'.bw-drag svg{width:22px;height:22px}' +'.bw-ord-m{flex:1;min-width:0}.bw-ord-m b{display:block;font-size:14px;font-weight:800;color:var(--c-text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bw-ord-m small,.bw-ord-m span{display:block;font-size:11px;font-weight:700;color:var(--c-text-3)}.bw-ord-m span.bw-neg{color:#FCA5A5}.bw-ord-m span.bw-pos{color:var(--c-take)}' +'.bw-ord-amt{flex:none;font-size:14px;font-weight:900;color:var(--c-gold);font-variant-numeric:tabular-nums}' +'.bw-ord-btns{display:flex;flex-direction:column;gap:2px;flex:none}.bw-ord-btns .bw-arrow{width:var(--tap,44px);height:var(--tap,44px);min-height:var(--tap,44px);border-radius:var(--radius-sm,8px)}.bw-ord-btns .bw-arrow:disabled{opacity:.32}' +'.bw-order-card .bw-k{margin-bottom:2px}' +
      '@media (min-width:900px){.bw-slide{flex-basis:400px}.bw-track{padding-left:0}}' +
      '@media (min-width:900px){.bw-row{grid-template-columns:70px 1fr 120px 120px;font-size:14px}}';
    document.head.appendChild(s);
  })();

  function init() {
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'bills') load(false); });
    document.addEventListener('blackram:financials', function () { var p = document.getElementById('panel-bills'); if (p && !p.hidden) render(); });
    var p = document.getElementById('panel-bills'); if (p && !p.hidden) load(false);
  }
  window.BlackRamBillWaterfall = { render: render, show: function () { load(false); }, model: function (r) { var d = fin(); return d ? model(d, r || st.range) : null; }, openFirst: function () { st.carIdx = 0; st.reorder = false; }, go: function (i) { st.carIdx = i || 0; if (st.goCard) st.goCard(st.carIdx, false); }, setReorder: function (on) { st.reorder = !!on; render(); }, setOrder: function (keys) { if (!keys || !keys.length) savePri([]); else savePri(keys); st.carIdx = 0; render(); }, keys: function () { var d = fin(); return d ? (model(d, st.range).keys || []) : []; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
