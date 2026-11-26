/* Black Ram Logistics - Driver 360 (v92+). Meshach: performance, pay, compliance, safety, capital.
   Public: first name only, load stats from the public ledger feed (data/feed.json, same numbers as Scoreboard),
   DOT status from data/dot_ready.json + check-offs (via window.BlackRamDot). No phone, email, DOB, license
   number or address. Pay and partner capital come ONLY from the PIN-gated relay /financials.
   Tiles reuse tiles.js (BlackRamTiles). v51 tokens. Plain ASCII. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var FIN_KEY = 'blackram_fin_session_v1';
  var NAME = 'Meshach';
  var ART = 'brand/meshach-360.jpg';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOT_IDS = ['d-cdl', 'd-med', 'd-dq', 'd-da', 'd-eld', 'd-hos', 'd-eldpack', 'd-blank', 't-pre', 't-dvir'];
  var DOT_SHORT = { 'd-cdl': 'Class A CDL', 'd-med': 'Med card', 'd-dq': 'DQ file (Totni)', 'd-da': 'Drug and alcohol pool', 'd-eld': 'ELD login', 'd-hos': 'HOS logs', 'd-eldpack': 'ELD packet in cab', 'd-blank': 'Blank paper logs', 't-pre': 'Pre-trip habit', 't-dvir': 'DVIR / post-trip' };
  /* Safety log: high level only. No claim numbers, amounts or other parties' names in public. */
  var EVENTS = [
    { date: '2026-11-11', kind: 'tire', t: 'Tire exchanged under warranty', s: 'Exchanged at Big Tex in Jacksonville, FL after Meshach returned. Unit (truck or trailer) still unclear. Cost not on file.', fault: 'n/a', status: 'Closed' },
    { date: '2026-11-06', kind: 'accident', t: 'Another vehicle hit the truck', s: 'Truck mirror only. Not at fault. No claim on our policy.', fault: 'Not at fault', status: 'Closed', priv: 'Settled directly with the other party under a confidential agreement (signed 11/19). Terms stay in the signed copy, not in the app.' },
    { date: '2026-11-03', kind: 'tire', t: 'Trailer flat from a nail', s: 'Spare swapped at a Love\'s in Houston, load still delivered next day.', fault: 'Road hazard', status: 'Closed' }
  ];
  var st = { open: false, feed: null, feedErr: '', fin: null, finErr: '', finLoading: false, fetchedAt: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function m0(n) { if (n == null || !isFinite(n)) return '-'; var a = Math.abs(Math.round(n)).toLocaleString('en-US'); return (n <= -0.5 ? '-$' : '$') + a; }
  function m2(n) { if (n == null || !isFinite(n)) return '-'; var a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < -0.004 ? '-$' : '$') + a; }
  function n0(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  function day(iso) { if (!iso) return '?'; var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function monLbl(k) { var p = String(k).split('-'); return MON[Number(p[1]) - 1] + ' ' + p[0]; }
  function monShort(k) { return MON[Number(String(k).split('-')[1]) - 1]; }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function addDay(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private mode */ } }
  function T() { return window.BlackRamTiles; }
  function ta(key, arg, label) { var t = T(); return t ? t.attrs(key, arg, label) : ''; }
  function place(s) { return String(s || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/^.*?,\s*(?=[^,]*\b[A-Z]{2}\b)/, '').trim(); }
  function city(s) { var m = String(s || '').match(/([A-Za-z .']+?)\s+(FL|GA|TN|MS|MO|TX|AL|SC|NC|LA|KS|OK|AR|KY|VA)\b/); return m ? (m[1].split(/\s+/).slice(-2).join(' ') + ' ' + m[2]).replace(/^(Equipment|Containers|Cargo|Rentals|Yard|Mfg|Supply|Elec|Dr|Rd|Taller|Technologies)\s+/, '') : place(s); }

  /* ---------- data ---------- */
  function loadFeed() {
    var A = window.BlackRamApp, f = A && A.getFeed ? A.getFeed() : null;
    if (f && f.months) { st.feed = f; return; }
    if (st.feedLoading) return;
    st.feedLoading = true;
    fetch('data/feed.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { st.feed = j; st.feedErr = ''; })
      .catch(function (e) { st.feedErr = 'Could not load the ledger (' + (e && e.message || 'offline') + ').'; })
      .then(function () { st.feedLoading = false; render(); renderTeaser(); });
  }
  function finCache() { try { var c = sessionStorage.getItem(FIN_KEY); if (!c) return null; var j = JSON.parse(c); return j && j.accounting ? j : null; } catch (e) { return null; } }
  function loadFin(force) {
    var p = pin();
    if (!p) { st.fin = null; st.finErr = 'nopin'; return; }
    if (!st.fin) { var c = finCache(); if (c) { st.fin = c; st.finErr = ''; } }
    if (st.finLoading || (!force && st.fin && Date.now() - st.fetchedAt < 60000)) return;
    st.finLoading = true;
    fetch(RELAY + '/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }), cache: 'no-store' })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (resp.ok && j && j.ok && j.data) {
            st.fin = j.data.accounting ? j.data : null; st.finErr = st.fin ? '' : 'Pay data is not on the server yet.'; st.fetchedAt = Date.now();
            try { sessionStorage.setItem(FIN_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ }
          } else if (resp.status === 401) { st.fin = null; st.finErr = 'wrongpin'; }
          else st.finErr = st.fin ? '' : 'Server error (' + resp.status + ').';
        });
      })
      .catch(function () { if (!st.fin) st.finErr = 'Offline. Try again when you have signal.'; })
      .then(function () { st.finLoading = false; render(); });
  }

  /* ---------- stats from the public ledger ---------- */
  function allLoads() {
    var out = [];
    ((st.feed && st.feed.months) || []).forEach(function (m) { (m.loads || []).forEach(function (l) { out.push(Object.assign({ _m: m.month }, l)); }); });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function isDone(l) { return /deliver/i.test(l.status || ''); }
  function stats() {
    var L = allLoads(), done = L.filter(isDone), today = todayIso();
    var s = { loads: done.length, all: L, done: done, loaded: 0, dead: 0, gross: 0, net: 0, netRecv: 0, onTime: 0, onTimeProof: 0, late: [], months: [], roadDays: {}, first: null };
    done.forEach(function (l) {
      s.loaded += Number(l.loaded_mi) || 0;
      s.dead += Number(l.empty_mi_est != null ? l.empty_mi_est : l.deadhead_mi) || 0;
      s.gross += Number(l.gross) || 0;
      s.net += Number(l.net_est) || 0;
      s.netRecv += Number(l.net_received) || 0;
      var due = l.delivery_date, got = l.delivered_date;
      if (got && due && got > due) s.late.push(l); else { s.onTime++; if (got) s.onTimeProof++; }
      var a = l.pickup_date || l.date, b = l.delivered_date || l.delivery_date || a;
      if (!s.first || a < s.first) s.first = a;
      for (var d = a, i = 0; d <= b && i < 14; d = addDay(d, 1), i++) s.roadDays[d] = 1;
    });
    s.road = Object.keys(s.roadDays).length;
    s.span = s.first ? daysBetween(s.first, today) + 1 : 0;
    s.off = Math.max(0, s.span - s.road);
    s.rpm = s.loaded ? s.gross / s.loaded : 0;
    s.rpmAll = (s.loaded + s.dead) ? s.gross / (s.loaded + s.dead) : 0;
    s.deadPct = (s.loaded + s.dead) ? s.dead / (s.loaded + s.dead) : 0;
    var byM = {};
    done.forEach(function (l) {
      var k = l._m; var o = byM[k] || (byM[k] = { month: k, loads: 0, gross: 0, net: 0, loaded: 0, dead: 0 });
      o.loads++; o.gross += Number(l.gross) || 0; o.net += Number(l.net_est) || 0; o.loaded += Number(l.loaded_mi) || 0;
      o.dead += Number(l.empty_mi_est != null ? l.empty_mi_est : l.deadhead_mi) || 0;
    });
    s.months = Object.keys(byM).sort().map(function (k) { return byM[k]; });
    var open = L.filter(function (l) { return !isDone(l) && !/cancel/i.test(l.status || ''); });
    s.current = open[0] || null;
    s.last = done[done.length - 1] || null;
    return s;
  }

  /* ---------- charts (inline SVG) ---------- */
  function trendChart(months) {
    if (!months.length) return '<p class="d3-fine">No months yet.</p>';
    var W = 320, H = 150, pad = 26, top = 18, max = 1;
    months.forEach(function (m) { max = Math.max(max, m.gross); });
    var bw = Math.min(46, (W - pad * 2) / months.length / 2.6), slot = (W - pad * 2) / months.length;
    var o = ['<svg class="d3-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gross and net EST by month">'];
    [0.5, 1].forEach(function (f) { var y = top + (H - top - 28) * (1 - f); o.push('<line x1="' + pad + '" x2="' + (W - 6) + '" y1="' + y + '" y2="' + y + '" stroke="var(--c-line)" stroke-dasharray="3 4"/>'); });
    months.forEach(function (m, i) {
      var cx = pad + slot * i + slot / 2, base = H - 28, sc = (H - top - 28) / max;
      var hg = m.gross * sc, hn = Math.max(0, m.net) * sc;
      o.push('<g class="tl-tap"' + ta('d3', 'month:' + m.month, monLbl(m.month) + ' ' + m.loads + ' loads, gross ' + m0(m.gross) + '. Show loads') + '>');
      o.push('<rect x="' + (cx - bw - 2) + '" y="' + (base - hg) + '" width="' + bw + '" height="' + hg + '" rx="4" fill="var(--c-gold)"/>');
      o.push('<rect x="' + (cx + 2) + '" y="' + (base - hn) + '" width="' + bw + '" height="' + hn + '" rx="4" fill="var(--c-take)"/>');
      o.push('<text x="' + (cx - bw / 2 - 2) + '" y="' + (base - hg - 5) + '" text-anchor="middle" font-size="10" font-weight="800" fill="var(--c-text-2)">' + m0(m.gross) + '</text>');
      o.push('<text x="' + (cx + bw / 2 + 2) + '" y="' + (base - hn - 5) + '" text-anchor="middle" font-size="10" font-weight="800" fill="var(--c-take)">' + m0(m.net) + '</text>');
      o.push('<text x="' + cx + '" y="' + (H - 12) + '" text-anchor="middle" font-size="11" font-weight="800" fill="var(--c-text-1)">' + monShort(m.month) + '</text>');
      o.push('<text x="' + cx + '" y="' + (H - 1) + '" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--c-text-3)">' + m.loads + ' loads | ' + n0(m.loaded) + ' mi</text></g>');
    });
    o.push('</svg>');
    return o.join('') + '<div class="d3-leg"><span><i style="background:var(--c-gold)"></i>Gross</span><span><i style="background:var(--c-take)"></i>Net EST (after 13%, fuel, DEF)</span></div>';
  }
  function milesBar(s) {
    var tot = s.loaded + s.dead || 1, lp = s.loaded / tot * 100;
    return '<div class="d3-mbar tl-tap"' + ta('d3', 'miles', 'Loaded ' + n0(s.loaded) + ' mi, deadhead ' + n0(s.dead) + ' mi. Show per load') + '>' +
      '<div class="d3-mtrack"><i class="d3-ml" style="width:' + lp.toFixed(1) + '%"></i><i class="d3-md" style="width:' + (100 - lp).toFixed(1) + '%"></i></div>' +
      '<div class="d3-mlbl"><span><b>' + n0(s.loaded) + '</b> loaded mi</span><span><b>' + n0(s.dead) + '</b> deadhead EST (' + Math.round(s.deadPct * 100) + '%)</span></div></div>';
  }
  function perLoadStrip(done) {
    if (!done.length) return '';
    var max = 1; done.forEach(function (l) { max = Math.max(max, (Number(l.loaded_mi) || 0) + (Number(l.empty_mi_est) || 0)); });
    var W = 320, H = 92, gap = 4, bw = (W - gap * (done.length - 1)) / done.length;
    var o = ['<svg class="d3-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Miles per load, loaded and deadhead">'];
    done.forEach(function (l, i) {
      var x = i * (bw + gap), lm = Number(l.loaded_mi) || 0, dm = Number(l.empty_mi_est != null ? l.empty_mi_est : l.deadhead_mi) || 0, sc = (H - 18) / max;
      var hl = lm * sc, hd = dm * sc, base = H - 14;
      o.push('<g class="tl-tap"' + ta('d3', 'load:' + l.date + '|' + (l.load_no || i), day(l.date) + ' ' + esc(l.desc) + '. Show load') + '>');
      o.push('<rect x="' + x + '" y="0" width="' + bw + '" height="' + H + '" fill="transparent"/>');
      o.push('<rect x="' + x + '" y="' + (base - hl) + '" width="' + bw + '" height="' + hl + '" rx="2" fill="var(--c-accent)"/>');
      o.push('<rect x="' + x + '" y="' + (base - hl - hd) + '" width="' + bw + '" height="' + Math.max(hd - 1, 0) + '" rx="2" fill="var(--c-surface-3)" stroke="var(--c-line-strong)"/>');
      o.push('<text x="' + (x + bw / 2) + '" y="' + (H - 2) + '" text-anchor="middle" font-size="9" font-weight="700" fill="var(--c-text-3)">' + day(l.date) + '</text></g>');
    });
    o.push('</svg>');
    return o.join('') + '<div class="d3-leg"><span><i style="background:var(--c-accent)"></i>Loaded</span><span><i style="background:var(--c-surface-3);border:1px solid var(--c-line-strong)"></i>Deadhead EST</span><span>Tap a bar</span></div>';
  }
  function dayStrip(s) {
    if (!s.first) return '';
    var cells = [], d = s.first, today = todayIso(), i = 0;
    while (d <= today && i < 120) { cells.push('<i class="' + (s.roadDays[d] ? 'on' : '') + '" title="' + day(d) + '"></i>'); d = addDay(d, 1); i++; }
    return '<div class="d3-days" aria-hidden="true">' + cells.join('') + '</div><div class="d3-leg"><span><i style="background:var(--c-gold)"></i>On a load</span><span><i style="background:var(--c-surface-3)"></i>No load (home, waiting or running empty)</span></div>';
  }
  function payChart(D) {
    var ms = (D.months || []), tgt = D.target || D.monthly || 3000;
    if (!ms.length) return '<p class="d3-fine">No pay months yet.</p>';
    var paidBy = {}; (D.paid || []).forEach(function (p) { var k = String(p.date).slice(0, 7); paidBy[k] = (paidBy[k] || 0) + (Number(p.amount) || 0); });
    return '<div class="d3-pay">' + ms.map(function (m) {
      var cov = Number(m.covered_from_profit) || 0, paid = paidBy[m.month] || 0, t = Number(m.target) || tgt;
      var pc = Math.min(100, paid / t * 100), cc = Math.min(100, cov / t * 100);
      return '<div class="d3-prow tl-tap"' + ta('d3', 'pay:' + m.month, monLbl(m.month) + ' paid ' + m0(paid) + ' of ' + m0(t) + '. Show pay') + '><span class="d3-pm">' + monShort(m.month) + '</span>' +
        '<div class="d3-ptrack"><i class="d3-pc" style="width:' + cc.toFixed(1) + '%"></i><i class="d3-pp" style="width:' + pc.toFixed(1) + '%"></i></div>' +
        '<span class="d3-pv"><b>' + m0(paid) + '</b><small>of ' + m0(t) + '</small></span></div>';
    }).join('') + '</div><div class="d3-leg"><span><i style="background:var(--c-take)"></i>Paid</span><span><i style="background:rgba(52,211,153,.3)"></i>Covered by profit</span><span><i style="background:var(--c-surface-3)"></i>Target ' + m0(tgt) + '</span></div>';
  }

  /* ---------- sections ---------- */
  function tile(key, arg, label, big, sub, tone) {
    return '<div class="d3-t tl-tap tl-chev' + (tone ? ' d3-' + tone : '') + '"' + ta(key, arg, label + ' ' + big + '. Show details') + '><span>' + esc(label) + '</span><b>' + big + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  }
  function card(id, title, sub, body) {
    return '<section class="d3-card" id="' + id + '"><div class="d3-ch"><h3>' + esc(title) + '</h3>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>' + body + '</section>';
  }
  function call(tone, html) { return '<p class="d3-call d3-' + tone + '">' + html + '</p>'; }
  function lockBox(what) {
    var bad = st.finErr === 'wrongpin';
    return '<div class="d3-lock"><p' + (bad ? ' class="d3-err"' : '') + '>' + (bad ? 'Wrong PIN. Try again.' : esc(what) + ' Enter the app PIN.') + '</p>' +
      '<form class="d3-pin" data-d3-pin="1" autocomplete="off"><input type="password" inputmode="numeric" placeholder="App PIN" aria-label="App PIN"><button type="submit" class="btn primary">Unlock</button></form></div>';
  }
  function secHero(s) {
    var c = s.current;
    var now = c ? '<b>Now:</b> ' + esc(city(c.pickup_place)) + ' to ' + esc(city(c.drop_place)) + ' | ' + esc(c.status || 'booked') :
      (s.last ? '<b>Now:</b> no load booked. Last drop ' + esc(city(s.last.drop_place)) + ' ' + day(s.last.delivered_date || s.last.delivery_date) : '<b>Now:</b> no loads yet');
    return '<figure class="d3-hero"><img src="' + ART + '" width="864" height="1152" alt="Illustration of Meshach, arms crossed, in front of the black Ram 3500 dually with the Big Tex gooseneck hitch at sunset." decoding="async">' +
      '<figcaption><span class="d3-kick">Driver 360</span><b>' + NAME + '</b><span class="d3-role">Driver and 1/3 partner | Black Ram Logistics</span>' +
      '<span class="d3-chips"><span class="d3-chip">' + s.loads + ' loads</span><span class="d3-chip">' + n0(s.loaded + s.dead) + ' mi</span><span class="d3-chip">Since ' + day(s.first) + '</span></span></figcaption></figure>' +
      '<div class="d3-now tl-tap tl-chev"' + ta('d3', 'now', 'Current or next load. Show') + '>' + now + '</div>';
  }
  function secPerf(s) {
    var proofNote = s.onTimeProof < s.loads ? (s.loads - s.onTimeProof) + ' on due date per records, no arrival time' : 'arrival dates on file';
    var tiles = '<div class="d3-grid">' +
      tile('d3', 'loads', 'Loads done', String(s.loads), s.months.map(function (m) { return monShort(m.month) + ': ' + m.loads; }).join(' | ')) +
      tile('d3', 'ontime', 'On time', s.loads ? Math.round(s.onTime / s.loads * 100) + '%' : '-', s.onTime + ' of ' + s.loads + ' by due date', s.late.length ? 'bad' : 'good') +
      tile('d3', 'gross', 'Gross', m0(s.gross), '$' + s.rpm.toFixed(2) + '/loaded mi') +
      tile('d3', 'net', 'Net EST', m0(s.net), 'after 13%, fuel, DEF', s.net > 0 ? 'good' : 'bad') +
      tile('d3', 'rpm', '$ / mi', '$' + s.rpm.toFixed(2), '$' + s.rpmAll.toFixed(2) + ' all-in') +
      tile('d3', 'days', 'Days on a load', s.road + ' / ' + s.span, s.off + ' days without a load') +
      '</div>';
    var c = [];
    if (s.deadPct > 0.25) c.push(call('warn', 'Deadhead is <b>' + Math.round(s.deadPct * 100) + '%</b> of miles. Under 20% is the goal: book the next load near the last drop.'));
    else c.push(call('ok', 'Deadhead <b>' + Math.round(s.deadPct * 100) + '%</b> of miles.'));
    if (s.rpmAll < 2.71) c.push(call('warn', 'All-in <b>$' + s.rpmAll.toFixed(2) + '/mi</b> is under the $2.71-$2.82 break-even EST.'));
    return card('d3-perf', 'Performance', 'from the load ledger', tiles + c.join('') +
      '<div class="d3-sub">Miles</div>' + milesBar(s) + perLoadStrip(s.done) +
      '<div class="d3-sub">Monthly trend</div>' + trendChart(s.months) +
      '<div class="d3-sub">Days since first load (' + s.span + ')</div>' + dayStrip(s) +
      '<p class="d3-fine">On time = delivered by the rate-con due date (' + esc(proofNote) + '). Deadhead is the ledger EST from the last drop or home.</p>');
  }
  function secPay() {
    if (!pin() || st.finErr === 'wrongpin' || st.finErr === 'nopin') return card('d3-pay', 'Pay', 'PIN', lockBox('Driver pay is private.'));
    if (!st.fin) return card('d3-pay', 'Pay', 'PIN', '<p class="d3-fine">' + (st.finErr ? esc(st.finErr) : 'Loading pay...') + '</p>');
    var D = st.fin.accounting.driver || {}, tgt = D.target || D.monthly || 3000, cov = D.covered_from_profit || 0;
    return card('d3-pay', 'Pay', esc(m0(D.monthly || 3000)) + '/mo from profit',
      '<div class="d3-grid d3-g3">' + tile('d3', 'pay:paid', 'Paid out', m0(D.paid_total || 0), (D.paid || []).length + ' payments') +
      tile('d3', 'pay:cov', 'This month', m0(cov), 'of ' + m0(tgt) + ' covered', cov >= tgt ? 'good' : 'bad') +
      tile('d3', 'pay:owed', 'Owed', '$0', 'no accrual') + '</div>' +
      payChart(D) +
      call(cov >= tgt ? 'ok' : 'warn', 'Order: bills first, then up to <b>' + m0(tgt) + '/mo</b> to ' + NAME + ' from actual profit, then thirds. A shortfall is not a debt.') +
      '<p class="d3-fine">' + esc(D.note || '') + '</p>');
  }
  function dotRow(id) {
    var B = window.BlackRamDot, r = B && B.status ? B.status(id) : null;
    var s = r ? r.s : 'load', lbl = r ? r.label : '...';
    var cls = s === 'ok' ? 'ok' : (s === 'soon' || s === 'stale') ? 'warn' : s === 'gap' ? 'bad' : s === 'na' ? 'na' : 'unk';
    return '<div class="d3-dr tl-tap tl-chev"' + ta('d3dot', id, (DOT_SHORT[id] || id) + ' ' + lbl + '. Open DOT item') + '><span class="d3-dot d3-' + cls + '"></span><span class="d3-dn"><b>' + esc(DOT_SHORT[id] || id) + '</b>' +
      (r && r.cfr ? '<small>' + esc(r.cfr.split(';')[0]) + '</small>' : '') + '</span><span class="d3-badge d3-' + cls + '">' + esc(lbl.replace(' - verify', '')) + '</span></div>';
  }
  function secDot() {
    var B = window.BlackRamDot, ready = B && B.ready && B.ready();
    var cnt = { ok: 0, bad: 0, unk: 0 };
    if (ready) DOT_IDS.forEach(function (id) { var r = B.status(id); if (!r) return; if (r.s === 'ok' || r.s === 'na') cnt.ok++; else if (r.s === 'gap') cnt.bad++; else cnt.unk++; });
    var tot = DOT_IDS.length;
    var bar = ready ? '<div class="d3-stack" aria-label="' + cnt.ok + ' OK, ' + cnt.unk + ' to verify, ' + cnt.bad + ' missing"><i class="d3-ok" style="flex:' + cnt.ok + '"></i><i class="d3-unk" style="flex:' + cnt.unk + '"></i><i class="d3-bad" style="flex:' + cnt.bad + '"></i></div>' +
      '<div class="d3-leg"><span><i class="d3-ok"></i>' + cnt.ok + ' OK</span><span><i class="d3-unk"></i>' + cnt.unk + ' verify</span><span><i class="d3-bad"></i>' + cnt.bad + ' missing</span></div>' : '';
    return card('d3-dot', 'Compliance', ready ? cnt.ok + ' of ' + tot + ' proven' : 'loading',
      bar + '<div class="d3-list">' + DOT_IDS.map(dotRow).join('') + '</div>' +
      call('warn', 'Rig is a Group A combo (39,900 lb rated). Confirm <b>Class A</b> and a current <b>med card</b> first.') +
      '<p class="d3-fine">Same items and check-offs as the DOT tab. Tap one to see the fix and mark it.</p>');
  }
  function secSafety() {
    var acc = EVENTS.filter(function (e) { return e.kind === 'accident'; }), tires = EVENTS.filter(function (e) { return e.kind === 'tire'; });
    var priv = !!(st.fin && pin());
    return card('d3-safe', 'Safety', 'incidents on file',
      '<div class="d3-grid d3-g3">' + tile('d3', 'safe:acc', 'Accidents', String(acc.length), acc.filter(function (e) { return /not at fault/i.test(e.fault); }).length + ' not at fault') +
      tile('d3', 'safe:tire', 'Tire events', String(tires.length), 'road hazard / warranty') +
      tile('d3', 'safe:insp', 'Inspections', '0', 'none on file') + '</div>' +
      '<div class="d3-tl">' + EVENTS.map(function (e, i) {
        return '<div class="d3-ev tl-tap tl-chev"' + ta('d3', 'ev:' + i, day(e.date) + ' ' + e.t + '. Show') + '><span class="d3-evd">' + day(e.date) + '</span><span class="d3-evi d3-' + (e.kind === 'accident' ? 'warn' : 'unk') + '"></span><span class="d3-evm"><b>' + esc(e.t) + '</b><small>' + esc(e.s) + (priv && e.priv ? ' ' + esc(e.priv) : '') + '</small></span></div>';
      }).join('') + '</div>' +
      call('ok', 'No at-fault crashes, no tickets and no out-of-service orders on file.'));
  }
  function secCap() {
    if (!pin() || st.finErr === 'wrongpin' || st.finErr === 'nopin') return card('d3-cap', 'Partner capital', 'PIN', lockBox('Partner capital is private.'));
    if (!st.fin) return card('d3-cap', 'Partner capital', 'PIN', '<p class="d3-fine">Loading...</p>');
    var P = (st.fin.accounting.partners || []), me = P.filter(function (p) { return p.name === NAME; })[0];
    if (!me) return card('d3-cap', 'Partner capital', 'PIN', '<p class="d3-fine">No partner record found.</p>');
    var tot = P.reduce(function (s, p) { return s + (p.capital_total || 0); }, 0);
    var bars = P.slice().sort(function (a, b) { return b.capital_total - a.capital_total; }).map(function (p) {
      return '<div class="d3-crow' + (p.name === NAME ? ' me' : '') + '"><span>' + esc(p.name) + '</span><div class="d3-ctrack"><i style="width:' + (tot ? p.capital_total / tot * 100 : 0).toFixed(1) + '%"></i></div><b>' + m0(p.capital_total) + '</b></div>';
    }).join('');
    return card('d3-cap', 'Partner capital', esc(me.share || '1/3') + ' owner',
      '<div class="d3-grid d3-g2">' + tile('d3acct', 'cap:' + NAME, 'Put in', m2(me.capital_total), me.capital.length + ' contributions') +
      tile('d3', 'cap:share', 'Share of capital', (tot ? Math.round(me.capital_total / tot * 100) : 0) + '%', 'of ' + m0(tot) + ' total') + '</div>' +
      '<div class="d3-cbars tl-tap"' + ta('d3acct', 'cap:' + NAME, 'Partner capital. Open ' + NAME + '\'s contributions') + '>' + bars + '</div>' +
      '<p class="d3-fine">Distributions so far: ' + m0(me.dist_all || 0) + '. His third of any leftover is on top of his pay.</p>');
  }

  /* ---------- tap sheets ---------- */
  function loadRows(list) {
    return list.slice().reverse().map(function (l) {
      return { d: day(l.date), t: esc(l.desc), s: esc(city(l.pickup_place)) + ' to ' + esc(city(l.drop_place)) + ' | ' + n0(l.loaded_mi) + ' mi + ' + n0(l.empty_mi_est) + ' DH', v: m0(l.gross), vs: 'net EST ' + m0(l.net_est) };
    });
  }
  function loadSheet(l) {
    var t = T(); if (!t || !l) return;
    var due = l.delivery_date, got = l.delivered_date;
    t.open({ title: l.desc, sub: day(l.pickup_date || l.date) + ' to ' + day(got || due) + ' | ' + esc(l.status || ''), body:
      t.hero(m0(l.gross), 'gross | net EST ' + m0(l.net_est)) +
      t.kv([['Lane', esc(city(l.pickup_place)) + ' to ' + esc(city(l.drop_place))], ['Loaded', n0(l.loaded_mi) + ' mi' + (l.miles_estimate ? ' EST' : '')], ['Deadhead EST', n0(l.empty_mi_est) + ' mi from ' + esc(place(l.empty_from))],
        ['$/mi', '$' + (Number(l.rate_per_mi) || 0).toFixed(2) + ' loaded'], ['Weight', n0(l.weight_lb) + ' lb'], ['Due', day(due) + (l.delivery_window ? ' ' + esc(l.delivery_window) : '')], ['Delivered', got ? day(got) : 'by due date (no arrival time on file)'], ['Days', String(l.days || '-')]]) +
      '<div>' + t.btn('Open in Reports', 'd3', 'goreports') + '</div>' });
  }
  function drill(arg) {
    var t = T(); if (!t) return;
    var s = stats(), p = String(arg || '').split(':'), k = p[0], id = p.slice(1).join(':');
    if (k === 'loads' || k === 'gross' || k === 'net' || k === 'rpm') {
      var title = { loads: 'Loads done', gross: 'Gross generated', net: 'Net EST generated', rpm: 'Rate per mile' }[k];
      var big = { loads: String(s.loads), gross: m0(s.gross), net: m0(s.net), rpm: '$' + s.rpm.toFixed(2) + '/mi' }[k];
      var sub = { loads: n0(s.loaded) + ' loaded mi', gross: 'all delivered loads', net: 'gross less 13%, fuel, DEF (EST)', rpm: '$' + s.rpmAll.toFixed(2) + '/mi with deadhead' }[k];
      t.open({ title: title, sub: NAME + ' | since ' + day(s.first), body: t.hero(big, sub) + t.rows(loadRows(s.done), 'No loads yet.') +
        (k === 'net' ? t.fine('Net received so far: ' + m0(s.netRecv) + ' (2 loads unpaid). Net EST does not take out the truck, trailer and insurance bills.') : '') });
    } else if (k === 'month') {
      var ml = s.done.filter(function (l) { return l._m === id; }), mm = s.months.filter(function (m) { return m.month === id; })[0] || {};
      t.open({ title: monLbl(id), sub: ml.length + ' loads', body: t.kv([['Gross', m0(mm.gross)], ['Net EST', m0(mm.net)], ['Loaded mi', n0(mm.loaded)], ['Deadhead EST', n0(mm.dead) + ' mi']]) + t.rows(loadRows(ml)) });
    } else if (k === 'miles') {
      t.open({ title: 'Miles', sub: 'loaded vs deadhead EST', body: t.hero(n0(s.loaded + s.dead) + ' mi', Math.round(s.deadPct * 100) + '% deadhead') +
        t.rows(s.done.slice().reverse().map(function (l) { return { d: day(l.date), t: esc(city(l.pickup_place)) + ' to ' + esc(city(l.drop_place)), s: 'deadhead from ' + esc(place(l.empty_from)), v: n0(l.loaded_mi) + ' mi', vs: '+' + n0(l.empty_mi_est) + ' DH' }; })) });
    } else if (k === 'load') {
      var key = id.split('|'); loadSheet(s.done.filter(function (l, i) { return l.date === key[0] && String(l.load_no || i) === key[1]; })[0]);
    } else if (k === 'ontime') {
      t.open({ title: 'On time', sub: 'by rate-con due date', body: t.hero(s.onTime + ' of ' + s.loads, s.late.length ? s.late.length + ' late' : 'none late on file', s.late.length ? 'bad' : 'good') +
        t.rows(s.done.slice().reverse().map(function (l) { var late = l.delivered_date && l.delivery_date && l.delivered_date > l.delivery_date; return { d: day(l.date), t: esc(l.desc), s: 'due ' + day(l.delivery_date) + (l.delivery_window ? ' ' + esc(l.delivery_window) : ''), v: late ? 'LATE' : 'On time', vc: late ? 'neg' : 'pos', vs: l.delivered_date ? 'delivered ' + day(l.delivered_date) : 'per records' }; })) +
        t.fine('Gap: there are no arrival times or signed PODs with times on file for most loads. Add the delivered time to each load to make this exact.') });
    } else if (k === 'days') {
      t.open({ title: 'Days on a load', sub: 'since ' + day(s.first), body: t.hero(s.road + ' of ' + s.span, s.off + ' days without a load', null) + dayStrip(s) +
        t.rows(s.done.slice().reverse().map(function (l) { return { d: day(l.pickup_date || l.date), t: esc(city(l.pickup_place)) + ' to ' + esc(city(l.drop_place)), v: (l.days || 1) + ' d' }; })) +
        t.fine('Counts pickup through delivery. Home vs away time is not logged; trips like 10/21-10/26 had days away between loads.') });
    } else if (k === 'now') {
      if (s.current) loadSheet(s.current);
      else t.open({ title: 'Next load', sub: 'none booked', body: t.hero('No load', 'nothing booked or in transit') + (s.last ? t.kv([['Last drop', esc(city(s.last.drop_place))], ['Delivered', day(s.last.delivered_date || s.last.delivery_date)], ['Pay', esc(s.last.pay_status || '')]]) : '') + '<div>' + t.btn('Open Load Boards', 'd3', 'goboards') + '</div>' });
    } else if (k === 'goboards' || k === 'goreports') {
      close(); var A = window.BlackRamApp; if (A && A.showTab) A.showTab(k === 'goboards' ? 'searches' : 'reports'); t.close();
    } else if (k === 'safe' || k === 'ev') {
      var priv = !!(st.fin && pin()), list = EVENTS;
      if (k === 'safe' && id === 'acc') list = EVENTS.filter(function (e) { return e.kind === 'accident'; });
      if (k === 'safe' && id === 'tire') list = EVENTS.filter(function (e) { return e.kind === 'tire'; });
      if (k === 'ev') list = [EVENTS[Number(id)]];
      if (k === 'safe' && id === 'insp') { t.open({ title: 'Roadside inspections', sub: NAME, body: t.hero('0 on file', 'no reports saved') + t.fine('Save every roadside inspection report (even clean ones) and send a copy to Totni. A clean Level I helps the carrier score.') }); return; }
      t.open({ title: k === 'ev' ? list[0].t : 'Safety log', sub: NAME + ' | high level', body: list.map(function (e) {
        return t.kv([['Date', day(e.date)], ['What', esc(e.t)], ['Detail', esc(e.s)], ['Fault', esc(e.fault)], ['Status', esc(e.status)], priv && e.priv ? ['Private', esc(e.priv)] : null]);
      }).join('') + t.fine('Claim numbers and settlement terms are never shown in the app.') });
    } else if (k === 'pay') {
      var D = st.fin && st.fin.accounting && st.fin.accounting.driver; if (!D) return;
      var tgt = D.target || D.monthly || 3000;
      t.open({ title: 'Driver pay', sub: NAME + ' | ' + m0(D.monthly) + '/mo from profit', body: t.hero(m0(D.paid_total || 0), 'paid out so far') +
        t.sec('By month') + t.rows((D.months || []).map(function (m) { return { d: monShort(m.month), t: 'Covered from profit ' + m0(m.covered_from_profit), s: 'uncovered ' + m0(m.uncovered) + ' (not owed)', v: m0(m.covered_from_profit), vs: 'of ' + m0(m.target || tgt) }; })) +
        t.sec('Payments') + t.rows((D.paid || []).map(function (x) { return { d: day(x.date), t: 'Paid to ' + NAME, s: esc(x.source || ''), v: m2(x.amount) }; }), 'No payments logged yet.') +
        t.fine(esc(D.rule || '') + ' ' + esc(D.assumption || '')) + '<div>' + t.btn('Open Accounting: Driver', 'd3', 'goacct:ac-driver') + '</div>' });
    } else if (k === 'goacct') {
      close(); t.jump(id || 'ac-partners', 'acct');
    } else if (k === 'cap') {
      openCap();
    }
  }
  function openCap() {
    var Acc = window.BlackRamAccounting;
    if (Acc && Acc.drill) { Acc.drill('cap:' + NAME); return; }
    var t = T(); if (t) { close(); t.jump('ac-partners', 'acct'); }
  }

  /* ---------- overlay ---------- */
  function host() {
    var h = $('d3-view');
    if (h) return h;
    h = document.createElement('div'); h.id = 'd3-view'; h.className = 'd3-view'; h.hidden = true;
    h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', 'Driver 360: ' + NAME);
    document.body.appendChild(h);
    h.addEventListener('click', function (e) {
      if (e.target.closest('[data-d3-close]')) { close(); return; }
    });
    h.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-d3-pin]'); if (!f) return;
      e.preventDefault();
      var v = (f.querySelector('input').value || '').trim(); if (!v) return;
      setPin(v); st.fin = null; st.finErr = ''; loadFin(true); render();
    });
    return h;
  }
  function render() {
    if (!st.open) return;
    var h = host(), sc = h.querySelector('.d3-scroll'), top = sc ? sc.scrollTop : 0;
    var body;
    if (!st.feed) body = '<p class="d3-fine">' + esc(st.feedErr || 'Loading the ledger...') + '</p>';
    else {
      var s = stats();
      body = secHero(s) + '<nav class="d3-jump">' + [['d3-perf', 'Performance'], ['d3-pay', 'Pay'], ['d3-dot', 'Compliance'], ['d3-safe', 'Safety'], ['d3-cap', 'Capital']].map(function (j) { return '<a href="#' + j[0] + '" data-d3-jump="' + j[0] + '">' + j[1] + '</a>'; }).join('') + '</nav>' +
        secPerf(s) + secPay() + secDot() + secSafety() + secCap() +
        '<p class="d3-fine d3-foot">First name only. No contact, license or address details are kept in the app. Pay and capital need the PIN.</p>';
    }
    h.innerHTML = '<div class="d3-bar"><button type="button" class="d3-back" data-d3-close="1" aria-label="Close Driver 360">Back</button><b>Driver 360</b><span>' + NAME + '</span></div><div class="d3-scroll">' + body + '</div>';
    var ns = h.querySelector('.d3-scroll'); if (ns) ns.scrollTop = top;
    h.querySelectorAll('[data-d3-jump]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); var t = $(a.getAttribute('data-d3-jump')); if (t && ns) ns.scrollTo({ top: t.offsetTop - 56, behavior: 'smooth' }); });
    });
  }
  var lastFocus = null;
  function open() {
    st.open = true; lastFocus = document.activeElement;
    loadFeed(); loadFin(false);
    var B = window.BlackRamDot; if (B && B.load) B.load();
    var h = host(); h.hidden = false; render();
    document.documentElement.classList.add('d3-noscroll');
    var b = h.querySelector('.d3-back'); if (b) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
  }
  function close() {
    if (!st.open) return;
    st.open = false;
    var h = $('d3-view'); if (h) { h.hidden = true; h.innerHTML = ''; }
    document.documentElement.classList.remove('d3-noscroll');
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  /* ---------- teaser card next to Our rig ---------- */
  function renderTeaser() {
    var rig = document.querySelector('header.top .rig-card'); if (!rig) return;
    var el = $('d3-teaser');
    if (!el) { el = document.createElement('section'); el.id = 'd3-teaser'; el.className = 'd3-teaser tl-tap'; rig.parentNode.insertBefore(el, rig.nextSibling); }
    var s = st.feed ? stats() : null;
    el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0'); el.setAttribute('data-tl', 'd3open');
    el.setAttribute('aria-label', 'Driver 360: ' + NAME + '. Open');
    el.innerHTML = '<span class="d3-face" style="background-image:url(' + ART + ')" aria-hidden="true"></span>' +
      '<span class="d3-tm"><small>Driver 360</small><b>' + NAME + '</b><span>Driver + partner</span></span>' +
      '<span class="d3-ts">' + (s ? '<span><b>' + s.loads + '</b>loads</span><span><b>' + n0(s.loaded) + '</b>loaded mi</span><span><b>' + (s.loads ? Math.round(s.onTime / s.loads * 100) : 0) + '%</b>on time</span>' : '<span><b>--</b>loads</span>') + '</span>' +
      '<span class="d3-tchev" aria-hidden="true">&rsaquo;</span>';
  }

  function css() {
    if ($('d3-css')) return;
    var s = document.createElement('style'); s.id = 'd3-css';
    s.textContent =
      '.d3-teaser{display:flex;align-items:center;gap:10px;margin:8px 0 0;padding:8px 10px;border:1px solid var(--c-line);border-radius:10px;background:var(--c-surface-1);color:var(--c-text-1);text-align:left}' +
      '.d3-face{flex:0 0 52px;width:52px;height:52px;border-radius:50%;background-size:330%;background-position:31% 13%;border:2px solid var(--c-gold);box-shadow:0 0 0 2px var(--c-surface-1)}' +
      '.d3-tm{display:flex;flex-direction:column;min-width:0;line-height:1.15}.d3-tm small{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c-gold)}.d3-tm b{font-size:17px;font-weight:900}.d3-tm span{font-size:11px;color:var(--c-text-3);font-weight:700}' +
      '.d3-ts{display:flex;gap:8px;margin-left:auto}.d3-ts span{display:flex;flex-direction:column;align-items:center;font-size:9.5px;color:var(--c-text-3);font-weight:700;line-height:1.1}.d3-ts b{font-size:14px;color:var(--c-text-1);font-weight:900}' +
      '.d3-tchev{font-size:24px;color:var(--c-text-3);line-height:1;margin-left:2px}' +
      'html.d3-noscroll,html.d3-noscroll body{overflow:hidden}' +
      '.d3-view{position:fixed;inset:0;z-index:2650;background:var(--c-bg);display:flex;flex-direction:column;color:var(--c-text-1)}' +
      '.d3-bar{display:flex;align-items:center;gap:10px;min-height:52px;padding:calc(env(safe-area-inset-top,0px) + 6px) 12px 6px;background:var(--c-surface-1);border-bottom:1px solid var(--c-line)}.d3-bar b{font-size:16px;font-weight:900}.d3-bar span{margin-left:auto;color:var(--c-text-3);font-size:12px;font-weight:800}' +
      '.d3-back{min-height:40px;min-width:64px;border-radius:var(--radius-pill,999px);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-weight:800;font-size:14px}' +
      '.d3-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 12px calc(env(safe-area-inset-bottom,0px) + var(--bnav-h,64px) + 28px);max-width:560px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:12px}' +
      '.d3-scroll>*{flex-shrink:0}' +
      '.d3-hero{position:relative;margin:0;border-radius:14px;overflow:hidden;border:1px solid var(--c-line);aspect-ratio:3/4;background:#2a1a33}.d3-hero img{display:block;width:100%;height:100%;object-fit:cover}' +
      '.d3-hero figcaption{position:absolute;left:0;right:0;bottom:0;padding:48px 14px 14px;background:linear-gradient(180deg,rgba(15,13,23,0),rgba(15,13,23,.78) 45%,rgba(15,13,23,.95));display:flex;flex-direction:column;gap:2px}' +
      '.d3-kick{font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--c-gold)}.d3-hero figcaption>b{font-size:34px;font-weight:900;line-height:1;letter-spacing:.01em}.d3-role{font-size:13px;font-weight:700;color:var(--c-text-2)}' +
      '.d3-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.d3-chip{font-size:12px;font-weight:800;padding:4px 10px;border-radius:999px;background:rgba(242,201,76,.16);color:var(--c-gold);border:1px solid rgba(242,201,76,.35)}' +
      '.d3-now{padding:10px 30px 10px 12px;border-radius:10px;background:var(--c-surface-1);border:1px solid var(--c-line);font-size:13px;color:var(--c-text-2);position:relative}.d3-now b{color:var(--c-text-1)}' +
      '.d3-jump{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}.d3-jump a{flex:0 0 auto;padding:6px 12px;border-radius:999px;background:var(--c-surface-2);border:1px solid var(--c-line);color:var(--c-text-2);font-size:12px;font-weight:800;text-decoration:none}' +
      '.d3-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px}' +
      '.d3-ch{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.d3-ch h3{margin:0;font-size:17px;font-weight:900}.d3-ch span{font-size:12px;font-weight:800;color:var(--c-text-3)}' +
      '.d3-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.d3-g3{grid-template-columns:repeat(3,minmax(0,1fr))}.d3-g2{grid-template-columns:repeat(2,minmax(0,1fr))}' +
      '.d3-t{position:relative;display:flex;flex-direction:column;gap:2px;padding:10px 22px 10px 10px;border-radius:10px;background:var(--c-surface-2);border:1px solid var(--c-line);min-width:0}' +
      '.d3-t span{font-size:11px;font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.04em}.d3-t b{font-size:21px;font-weight:900;line-height:1.1}.d3-t small{font-size:11px;font-weight:700;color:var(--c-text-3);line-height:1.25}' +
      '.d3-g3 .d3-t b{font-size:18px}.d3-t.d3-good b{color:var(--c-take)}.d3-t.d3-bad b{color:#FCA5A5}' +
      '.d3-sub{font-size:12px;font-weight:900;color:var(--c-text-2);text-transform:uppercase;letter-spacing:.06em;margin-top:4px}' +
      '.d3-svg{display:block;width:100%;height:auto}.d3-leg{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;font-weight:700;color:var(--c-text-3)}.d3-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}' +
      '.d3-mbar{display:flex;flex-direction:column;gap:6px;padding:4px 0}.d3-mtrack{display:flex;height:16px;border-radius:999px;overflow:hidden;background:var(--c-surface-3)}.d3-ml{background:var(--c-accent)}.d3-md{background:var(--c-surface-3);background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.08) 0 4px,transparent 4px 8px)}' +
      '.d3-mlbl{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--c-text-3);font-weight:700}.d3-mlbl b{color:var(--c-text-1)}' +
      '.d3-days{display:grid;grid-template-columns:repeat(auto-fill,minmax(14px,1fr));gap:3px}.d3-days i{aspect-ratio:1;border-radius:3px;background:var(--c-surface-3)}.d3-days i.on{background:var(--c-gold)}' +
      '.d3-call{margin:0;padding:8px 10px;border-radius:10px;font-size:13px;line-height:1.35;border-left:3px solid}.d3-call.d3-ok{background:rgba(52,211,153,.08);border-color:var(--c-take)}.d3-call.d3-warn{background:rgba(251,191,36,.08);border-color:var(--c-maybe)}' +
      '.d3-fine{margin:0;font-size:11.5px;line-height:1.4;color:var(--c-text-3)}.d3-foot{text-align:center;padding:4px 8px}' +
      '.d3-pay{display:flex;flex-direction:column;gap:8px}.d3-prow{display:flex;align-items:center;gap:8px;padding:4px 0}.d3-pm{flex:0 0 32px;font-weight:900;font-size:13px}.d3-ptrack{position:relative;flex:1;height:18px;border-radius:999px;background:var(--c-surface-3);overflow:hidden}' +
      '.d3-ptrack i{position:absolute;left:0;top:0;bottom:0;border-radius:999px}.d3-pc{background:rgba(52,211,153,.3)}.d3-pp{background:var(--c-take)}.d3-pv{display:flex;flex-direction:column;align-items:flex-end;min-width:64px;line-height:1.1}.d3-pv b{font-size:14px}.d3-pv small{font-size:10.5px;color:var(--c-text-3);font-weight:700}' +
      '.d3-stack{display:flex;height:12px;border-radius:999px;overflow:hidden;gap:2px}.d3-stack i{display:block}i.d3-ok,.d3-leg i.d3-ok{background:var(--c-take)}i.d3-unk,.d3-leg i.d3-unk{background:#6d6787}i.d3-bad,.d3-leg i.d3-bad{background:#F87171}' +
      '.d3-list{display:flex;flex-direction:column;gap:6px}.d3-dr{position:relative;display:flex;align-items:center;gap:10px;padding:9px 26px 9px 10px;border-radius:10px;background:var(--c-surface-2);border:1px solid var(--c-line)}' +
      '.d3-dot{flex:0 0 10px;height:10px;border-radius:50%}.d3-dot.d3-ok{background:var(--c-take)}.d3-dot.d3-warn{background:var(--c-maybe)}.d3-dot.d3-bad{background:#F87171}.d3-dot.d3-unk,.d3-dot.d3-na{background:#6d6787}' +
      '.d3-dn{display:flex;flex-direction:column;min-width:0;flex:1}.d3-dn b{font-size:14px}.d3-dn small{font-size:10.5px;color:var(--c-text-3);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.d3-badge{font-size:10px;font-weight:900;padding:3px 8px;border-radius:999px;white-space:nowrap}.d3-badge.d3-ok{background:#065F46;color:#A7F3D0}.d3-badge.d3-warn{background:#92400E;color:#FDE68A}.d3-badge.d3-bad{background:#9F1239;color:#FECACA}.d3-badge.d3-unk,.d3-badge.d3-na{background:var(--c-surface-3);color:var(--c-text-2)}' +
      '.d3-tl{display:flex;flex-direction:column;gap:6px}.d3-ev{position:relative;display:flex;align-items:flex-start;gap:10px;padding:9px 26px 9px 10px;border-radius:10px;background:var(--c-surface-2);border:1px solid var(--c-line)}' +
      '.d3-evd{flex:0 0 38px;font-weight:900;font-size:13px}.d3-evi{flex:0 0 10px;height:10px;border-radius:50%;margin-top:4px}.d3-evi.d3-warn{background:var(--c-maybe)}.d3-evi.d3-unk{background:#6d6787}.d3-evm{display:flex;flex-direction:column;gap:2px;min-width:0}.d3-evm b{font-size:14px}.d3-evm small{font-size:12px;color:var(--c-text-3);line-height:1.3}' +
      '.d3-cbars{display:flex;flex-direction:column;gap:6px;padding:4px 0}.d3-crow{display:grid;grid-template-columns:70px 1fr 64px;align-items:center;gap:8px;font-size:13px;font-weight:800;color:var(--c-text-2)}.d3-crow b{text-align:right;color:var(--c-text-1)}.d3-ctrack{height:12px;border-radius:999px;background:var(--c-surface-3);overflow:hidden}.d3-ctrack i{display:block;height:100%;background:#6d6787;border-radius:999px}.d3-crow.me{color:var(--c-gold)}.d3-crow.me .d3-ctrack i{background:var(--c-gold)}' +
      '.d3-lock{display:flex;flex-direction:column;gap:8px}.d3-lock p{margin:0;font-size:13px;color:var(--c-text-2)}.d3-err{color:#FCA5A5!important;font-weight:800}.d3-pin{display:flex;gap:8px}.d3-pin input{flex:1;min-width:0;min-height:var(--tap);padding:0 12px;border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-size:16px}.d3-pin .btn{flex:0 0 96px;min-height:var(--tap)}';
    document.head.appendChild(s);
  }

  function init() {
    css();
    var t = T();
    if (t) {
      t.on('d3', drill);
      t.on('d3open', function () { open(); });
      t.on('d3dot', function (id) { var B = window.BlackRamDot; if (!B) return; if (B.ready && !B.ready()) { B.load(); setTimeout(function () { B.openItem(id); }, 600); } else B.openItem(id); });
      t.on('d3acct', function () { openCap(); });
    }
    renderTeaser(); loadFeed();
    document.addEventListener('blackram:tab', function () { if (st.open) close(); });
    document.addEventListener('blackram:dot', function () { if (st.open) render(); });
    document.addEventListener('blackram:financials', function () { var c = finCache(); if (c) { st.fin = c; st.finErr = ''; st.fetchedAt = Date.now(); } if (st.open) render(); });
    document.addEventListener('blackram:feed', function () { st.feed = null; loadFeed(); renderTeaser(); render(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !st.open) return;
      var tl = $('tl-sheet'), dr = $('dr-sheet');
      if (tl && !tl.hidden) return;
      if (dr && !dr.hidden) { var B = window.BlackRamDot; if (B && B.closeSheet) { e.stopPropagation(); B.closeSheet(); } return; }
      close();
    }, true);
    var feedPoll = 0;
    (function wait() { var A = window.BlackRamApp; if (A && A.getFeed && A.getFeed()) { st.feed = A.getFeed(); renderTeaser(); render(); } else if (feedPoll++ < 30) setTimeout(wait, 500); })();
  }
  window.BlackRamDriver = { open: open, close: close, refresh: function () { st.feed = null; loadFeed(); loadFin(true); render(); } };
  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { driver360: window.BlackRamDriver });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
