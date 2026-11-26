/* Black Ram Logistics - Maintenance tab (v79+).
   Public part: data/maintenance.json (no dollars): units, current odometer + as-of date, due-next schedule, service log
   (date, unit, job, odometer, vendor), checklists, warranty basics, open items. The schedule intervals come from the 2026 Ram
   owner's manual (diesel plan), the company rules, Dexter axle guidance and 49 CFR 396.17 (see the sources note on the tab).
   PIN-gated part: costs, who paid, spend totals. They come from the relay /financials payload key "maintenance"
   (built on the box by maintenance_build.py, pushed with push_financials.py). Nothing financial is in this repo.
   Update the odometer: edit maintenance.json on the box, or tap Update odometer (saved on that phone only).
   Uses v51 tokens; extends window.BlackRamApp (never overwrites it). Plain ASCII text. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var FIN_KEY = 'blackram_fin_session_v1';
  var ODO_KEY = 'blackram_maint_odo_v1';
  var CHK_KEY = 'blackram_maint_chk_v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var st = { pub: null, pubErr: '', priv: null, error: '', loading: false, fetchedAt: 0, unit: 'all', logf: 'all', odoOpen: false };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n0(n) { return Math.round(n).toLocaleString('en-US'); }
  function m0(n) { if (n == null || !isFinite(n)) return '-'; return '$' + Math.round(n).toLocaleString('en-US'); }
  function m2(n) { if (n == null || !isFinite(n)) return '-'; return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function ymd(iso) { var p = String(iso).slice(0, 10).split('-'); return MON[Number(p[1]) - 1] + ' ' + Number(p[2]) + ', ' + p[0]; }
  function md(iso) { var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function utc(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  function daysTo(iso) { return daysBetween(todayIso(), iso); }
  function addMonths(iso, n) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n, d = +iso.slice(8, 10);
    var dt = new Date(Date.UTC(y, m, 1)); var last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(d, last));
    return dt.getUTCFullYear() + '-' + ('0' + (dt.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + dt.getUTCDate()).slice(-2);
  }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private mode */ } }
  function root() { return document.getElementById('mt-root'); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  /* ---------- data ---------- */
  function loadPublic() {
    if (st.pub || st.pubLoading) return;
    st.pubLoading = true;
    fetch('data/maintenance.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { st.pub = j; st.pubErr = ''; })
      .catch(function (e) { st.pubErr = 'Could not load the maintenance data (' + (e && e.message ? e.message : 'offline') + ').'; })
      .then(function () { st.pubLoading = false; render(); });
  }
  function fromCache() {
    try { var c = sessionStorage.getItem(FIN_KEY); if (!c) return null; var j = JSON.parse(c); return j && j.maintenance ? j.maintenance : null; } catch (e) { return null; }
  }
  function fetchPriv(force) {
    var p = pin();
    if (!p) { st.error = 'nopin'; render(); return; }
    if (st.loading) return;
    if (!force && st.priv && Date.now() - st.fetchedAt < 60000) return;
    st.loading = true;
    fetch(RELAY + '/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }), cache: 'no-store' })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (resp.ok && j && j.ok && j.data) {
            st.error = ''; st.fetchedAt = Date.now();
            st.priv = j.data.maintenance || null;
            if (!st.priv) st.error = 'Maintenance costs are not on the server yet.';
            try { sessionStorage.setItem(FIN_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ }
          } else if (resp.status === 401) {
            st.error = 'wrongpin'; st.priv = null;
            try { sessionStorage.removeItem(FIN_KEY); } catch (e) { /* ignore */ }
          } else {
            st.error = (j && j.error) || ('Could not load (' + resp.status + ')');
          }
        });
      })
      .catch(function () { st.error = 'Offline - showing the last copy if any.'; })
      .then(function () { st.loading = false; render(); });
  }

  /* ---------- math ---------- */
  function odo() {
    var P = st.pub; if (!P) return null;
    var O = P.odometer, L = P.ledger_miles || {};
    var loc = jget(ODO_KEY, null);
    var o = { reading: O.value, as_of: O.as_of, source: O.source, est: true, since: L.est_since || 0, local: false };
    if (loc && loc.value > 0 && loc.as_of && loc.as_of >= O.as_of && (loc.as_of > O.as_of || loc.value >= O.value)) {
      o.reading = loc.value; o.as_of = loc.as_of; o.source = 'Entered on this phone'; o.since = 0; o.est = false; o.local = true;
    }
    o.cur = o.reading + o.since;
    var t = (P.units || []).filter(function (u) { return u.id === 'trailer'; })[0] || {};
    o.trailer = ((L.trailer_before && L.trailer_before.est) || 0) + (o.cur - O.value);
    o.trailerStart = t.in_service;
    var days = Math.max(daysBetween(O.as_of, todayIso()), 1);
    o.pace = (L.est_since || 0) / days;   /* mi per day, ledger-based, floor */
    return o;
  }
  function unitOf(P, id) { return (P.units || []).filter(function (u) { return u.id === id; })[0] || {}; }
  function calc(it, P, O) {
    var u = unitOf(P, it.unit), r = { it: it };
    if (it.need_record && !it.last_date) { r.status = 'need'; r.frac = 2; r.dueDate = null; return r; }
    var isT = it.unit === 'trailer';
    var curMi = isT ? O.trailer : O.cur;
    var lastOdo = it.last_odo != null ? it.last_odo : (isT ? 0 : (u.start_odo || 0));
    var lastDate = it.last_date || u.in_service;
    r.lastOdo = lastOdo; r.lastDate = lastDate;
    var fm = null, fd = null;
    if (it.int_mi) {
      r.usedMi = curMi - lastOdo; r.remMi = it.int_mi - r.usedMi; r.dueOdo = lastOdo + it.int_mi; fm = r.usedMi / it.int_mi;
      if (O.pace > 0 && r.remMi > 0) r.etaDays = Math.round(r.remMi / O.pace);
    }
    if (it.int_mo) {
      r.dueDate = addMonths(lastDate, it.int_mo); r.remD = daysTo(r.dueDate);
      var tot = Math.max(daysBetween(lastDate, r.dueDate), 1); fd = daysBetween(lastDate, todayIso()) / tot;
    }
    r.frac = Math.max(fm == null ? -1 : fm, fd == null ? -1 : fd);
    var soonMi = it.soon_mi != null ? it.soon_mi : (it.int_mi ? it.int_mi * 0.1 : 0);
    var soonD = it.soon_d != null ? it.soon_d : 30;
    var over = (r.remMi != null && r.remMi <= 0) || (r.remD != null && r.remD <= 0);
    var soon = (r.remMi != null && r.remMi <= soonMi) || (r.remD != null && r.remD <= soonD);
    r.status = over ? 'over' : (soon ? 'soon' : 'ok');
    r.first = (fm != null && (fd == null || fm >= fd)) ? 'mi' : 'date';
    return r;
  }
  function allRows() {
    var P = st.pub, O = odo(); if (!P) return [];
    var rows = P.schedule.map(function (it) { return calc(it, P, O); });
    rows.sort(function (a, b) {
      var A = a.status === 'need' ? 9 : -a.frac, B = b.status === 'need' ? 9 : -b.frac;
      return A - B;
    });
    return rows;
  }
  var ST_LABEL = { ok: 'OK', soon: 'Due soon', over: 'Overdue', need: 'Need record' };

  /* ---------- pieces ---------- */
  function card(id, title, sub, body) {
    return '<section class="mt-card" id="' + id + '"><div class="mt-h"><h3>' + title + '</h3>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>' + body + '</section>';
  }
  function pill(cls, t) { return '<span class="mt-pill mt-pill-' + cls + '">' + esc(t) + '</span>'; }
  function tile(label, big, sub, tone) {
    return '<div class="mt-tile mt-t-' + (tone || 'ok') + '"><span>' + esc(label) + '</span><b>' + esc(big) + '</b><small>' + esc(sub) + '</small></div>';
  }
  function lockIcon() { return '<svg viewBox="0 0 24 24" class="mt-lk" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></g></svg>'; }
  function lockCard(msg) {
    return '<section class="mt-card mt-lock" id="mt-lock"><div class="mt-lock-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></g></svg></div>' +
      '<h3>Costs and spend are locked</h3><p class="mt-fine">' + esc(msg) + '</p>' +
      '<form id="mt-pin-form" class="mt-pin" autocomplete="off"><input id="mt-pin" type="password" inputmode="numeric" placeholder="App PIN" aria-label="App PIN" />' +
      '<button type="submit" class="btn primary">Unlock</button></form></section>';
  }

  function secOdo(P, O) {
    var T = O.est ? 'EST' : 'read';
    var up = st.odoOpen
      ? '<form id="mt-odo-form" class="mt-odo-form" autocomplete="off"><label>Dash odometer (mi)<input id="mt-odo-v" type="number" inputmode="numeric" min="0" step="1" placeholder="e.g. 6400" /></label>' +
        '<label>Date read<input id="mt-odo-d" type="date" value="' + todayIso() + '" /></label>' +
        '<div class="mt-odo-btns"><button type="submit" class="btn primary">Save on this phone</button><button type="button" class="btn" id="mt-odo-x">Cancel</button></div></form>'
      : '<div class="mt-odo-btns"><button type="button" class="btn primary" id="mt-odo-up">Update odometer</button>' + (O.local ? '<button type="button" class="btn" id="mt-odo-reset">Use records</button>' : '') + '</div>';
    var L = P.ledger_miles || {};
    var body = '<div class="mt-big">' + n0(O.cur) + ' mi<span>Ram 3500 odometer ' + T + '. ' + (O.est
      ? 'Last reading ' + n0(O.reading) + ' mi on ' + ymd(O.as_of) + ', plus ' + n0(O.since) + ' mi from ' + (L.loads || 0) + ' loads since (a floor).'
      : 'Read on ' + ymd(O.as_of) + ', entered on this phone.') + '</span></div>' +
      '<div class="mt-rows"><div class="mt-row"><span>Last real reading</span><b>' + n0(O.reading) + ' mi<small>' + esc(O.source) + '</small></b></div>' +
      '<div class="mt-row"><span>As of</span><b>' + ymd(O.as_of) + '<small>' + (O.local ? 'newer than the records file' : daysBetween(O.as_of, todayIso()) + ' days ago') + '</small></b></div>' +
      '<div class="mt-row"><span>Trailer miles (EST)</span><b>' + n0(O.trailer) + ' mi<small>Loads run since ' + ymd(O.trailerStart) + ' plus truck miles since the reading. The trailer has no odometer.</small></b></div>' +
      (O.est && O.pace > 0 ? '<div class="mt-row"><span>Recent pace</span><b>' + n0(O.pace * 30) + ' mi a month<small>From logged loads since the reading (EST, floor)</small></b></div>' : '') + '</div>' +
      (O.est ? '<p class="mt-call mt-call-warn">The real odometer is higher than the estimate: empty miles between loads are not logged. Send a photo of the dash, or tap Update odometer, so every bar below is exact.</p>' : '') + up +
      '<p class="mt-fine">To update for everyone, tell Grok Bot the dash reading and it goes in the records file (maintenance.json on the box).</p>';
    return card('mt-odo', 'Odometer', 'Tap to update', body);
  }
  function secTiles(rows) {
    var c = { over: 0, soon: 0, need: 0, ok: 0 };
    rows.forEach(function (r) { c[r.status]++; });
    var nxt = rows.filter(function (r) { return r.status !== 'need'; })[0];
    var nSub = nxt ? (nxt.remMi != null ? (nxt.remMi > 0 ? n0(nxt.remMi) + ' mi left' : n0(-nxt.remMi) + ' mi over') : (nxt.remD > 0 ? nxt.remD + ' d left' : -nxt.remD + ' d over')) : '';
    return '<div class="mt-tiles">' +
      tile('Overdue', String(c.over), c.over ? 'No record, past interval' : 'Nothing past due', c.over ? 'bad' : 'ok') +
      tile('Due soon', String(c.soon), 'Within the warning window', c.soon ? 'warn' : 'ok') +
      tile('Need record', String(c.need), 'Annual DOT inspections', c.need ? 'warn' : 'ok') +
      '</div>' + (nxt ? '<p class="mt-next">Most urgent: <b>' + esc(nxt.it.item) + '</b> (' + (nxt.it.unit === 'trailer' ? 'trailer' : 'truck') + '), ' + esc(nSub) + '</p>' : '');
  }
  function rowHtml(r) {
    var it = r.it, tone = r.status === 'over' ? 'bad' : (r.status === 'soon' ? 'warn' : (r.status === 'need' ? 'need' : 'ok'));
    var pct = r.status === 'need' ? 0 : Math.max(2, Math.min(100, r.frac * 100));
    var l1 = '', l2 = '';
    if (r.status === 'need') { l1 = 'No inspection report on file'; l2 = 'Every ' + it.int_mo + ' months'; }
    else {
      if (r.remMi != null) l1 = (r.remMi > 0 ? n0(r.remMi) + ' mi left' : n0(-r.remMi) + ' mi over') + ' (due at ' + n0(r.dueOdo) + (it.unit === 'trailer' ? ' trailer mi' : ' mi') + ')';
      if (r.remD != null) l2 = (r.remD > 0 ? 'or by ' + ymd(r.dueDate) + ' (' + r.remD + ' d)' : 'date passed ' + ymd(r.dueDate));
      if (!l1) { l1 = (r.remD > 0 ? r.remD + ' d left' : -r.remD + ' d over'); l2 = 'Due ' + ymd(r.dueDate); }
    }
    var eta = (r.etaDays != null && r.status !== 'over' && it.unit === 'truck') ? ' At the recent pace (EST) that is about ' + etaDate(r.etaDays) + '.' : '';
    var basis = r.status === 'need' ? '' : (it.baseline ? 'No service on record: counted from delivery (' + md(r.lastDate) + ').' : 'Last done ' + ymd(r.lastDate) + (it.last_odo != null ? ' at ' + n0(it.last_odo) + ' mi' : '') + '.');
    var srcs = (it.src || []).map(function (k) { return (st.pub.sources || {})[k]; }).filter(Boolean);
    var intv = (it.int_mi ? n0(it.int_mi) + ' mi' : '') + (it.int_mi && it.int_mo ? ' or ' : '') + (it.int_mo ? (it.int_mo % 12 === 0 && it.int_mo >= 12 ? (it.int_mo / 12) + ' yr' : it.int_mo + ' mo') : '');
    return '<details class="mt-due mt-due-' + tone + '"><summary><div class="mt-due-top"><b>' + esc(it.item) + '</b>' + pill(tone, ST_LABEL[r.status]) + '</div>' +
      '<div class="mt-due-tag">' + (it.unit === 'trailer' ? 'Trailer' : 'Truck') + ' | every ' + esc(intv) + (r.status !== 'need' && it.baseline ? ' | no record' : '') + '</div>' +
      '<div class="mt-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="mt-due-l"><span>' + esc(l1) + '</span><span>' + esc(l2) + '</span></div></summary>' +
      '<div class="mt-due-more">' + (basis ? '<p>' + esc(basis + eta) + '</p>' : '') + (it.note ? '<p>' + esc(it.note) + '</p>' : '') +
      (srcs.length ? '<p class="mt-src">Source: ' + srcs.map(esc).join(' | ') + '</p>' : '') + '</div></details>';
  }
  function etaDate(days) { var d = new Date(); d.setDate(d.getDate() + days); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function secDue(rows) {
    var seg = ['all', 'truck', 'trailer'].map(function (k) {
      var n = rows.filter(function (r) { return k === 'all' || r.it.unit === k; }).length;
      return '<button type="button" class="mt-seg' + (st.unit === k ? ' on' : '') + '" data-mt-unit="' + k + '" aria-pressed="' + (st.unit === k ? 'true' : 'false') + '">' + (k === 'all' ? 'All' : (k === 'truck' ? 'Truck' : 'Trailer')) + ' ' + n + '</button>';
    }).join('');
    var list = rows.filter(function (r) { return st.unit === 'all' || r.it.unit === st.unit; });
    return card('mt-due', 'Due next', 'Miles or date, whichever comes first',
      '<div class="mt-segs">' + seg + '</div><div class="mt-dues">' + list.map(rowHtml).join('') + '</div>' +
      '<p class="mt-fine">Bar = share of the interval used. Tap a row for the last service, the notes and the source. Truck miles use the odometer estimate above. Trailer miles are estimated from loads. Items marked no record have never been logged, so they count from delivery.</p>');
  }

  var KIND = { service: 'Service', repair: 'Repair', def: 'DEF', setup: 'Setup', cosmetic: 'Detail', baseline: 'Baseline' };
  function unitName(u) { return u === 'truck' ? 'Truck' : (u === 'trailer' ? 'Trailer' : 'Unit unclear'); }
  function costOf(e) { var p = st.priv; return p && p.costs ? p.costs[e.id] : null; }
  function secLog(P) {
    var f = st.logf;
    var chips = [['all', 'All'], ['truck', 'Truck'], ['trailer', 'Trailer'], ['service', 'Service and repair'], ['def', 'DEF']].map(function (c) {
      return '<button type="button" class="mt-seg' + (f === c[0] ? ' on' : '') + '" data-mt-log="' + c[0] + '" aria-pressed="' + (f === c[0] ? 'true' : 'false') + '">' + c[1] + '</button>';
    }).join('');
    var list = P.log.slice().reverse().filter(function (e) {
      if (f === 'all') return true;
      if (f === 'truck' || f === 'trailer') return e.unit === f;
      if (f === 'service') return e.kind === 'service' || e.kind === 'repair';
      return e.kind === f;
    });
    var priv = !!st.priv;
    var rows = list.map(function (e) {
      var c = costOf(e);
      var cost = priv ? (c && c.cost != null ? '<b class="mt-cost">' + m2(c.cost) + (c.est ? '<small>EST</small>' : '') + '</b>' : '<b class="mt-cost mt-unk">unknown</b>') : '<b class="mt-cost mt-lockd">' + lockIcon() + '</b>';
      var odoTxt = e.odo != null ? n0(e.odo) + ' mi' : 'odometer unknown';
      var paid = priv ? (c && c.paid_by ? 'Paid by ' + c.paid_by : (e.kind === 'baseline' ? '' : 'Paid by: unknown')) : '';
      var note = priv && c && c.note ? c.note : e.note;
      return '<div class="mt-log mt-log-' + esc(e.kind) + '"><div class="mt-log-d"><b>' + md(e.date) + '</b><span>' + String(e.date).slice(0, 4) + '</span></div>' +
        '<div class="mt-log-m"><div class="mt-log-t"><b>' + esc(e.job) + '</b></div>' +
        '<div class="mt-log-s"><span class="mt-chip mt-u-' + esc(e.unit) + '">' + unitName(e.unit) + '</span><span class="mt-chip">' + esc(KIND[e.kind] || e.kind) + '</span><span class="mt-chip' + (e.odo == null ? ' mt-chip-unk' : '') + '">' + odoTxt + '</span></div>' +
        '<div class="mt-log-v">' + (e.vendor ? esc(e.vendor) : 'Vendor unknown') + (paid ? ' | ' + esc(paid) : '') + '</div>' +
        (note ? '<p class="mt-log-n">' + esc(note) + '</p>' : '') + '</div>' + cost + '</div>';
    }).join('');
    return card('mt-log', 'Service log', P.log.length + ' entries from the books',
      '<div class="mt-segs mt-segs-wrap">' + chips + '</div><div class="mt-logs">' + (rows || '<p class="mt-fine">Nothing in this filter.</p>') + '</div>' +
      '<p class="mt-fine">Built from the ledger, receipts and the WhatsApp group. Nothing is guessed: a blank odometer, shop or cost means it is not in the records. Tell Grok Bot about any job that is missing.</p>');
  }

  function spendHtml(P, O) {
    var priv = st.priv; if (!priv) return '';
    var now = new Date(), ym = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
    var t = { svc: 0, def: 0, svcM: 0, defM: 0, svcN: 0, unk: 0, excl: 0, est: false };
    P.log.forEach(function (e) {
      var c = priv.costs[e.id]; var k = e.kind;
      if (k === 'service' || k === 'repair' || k === 'def') {
        if (!c || c.cost == null) { t.unk++; return; }
        if (c.est) t.est = true;
        if (k === 'def') { t.def += c.cost; if (e.date.slice(0, 7) === ym) t.defM += c.cost; }
        else { t.svc += c.cost; t.svcN++; if (e.date.slice(0, 7) === ym) t.svcM += c.cost; }
      } else if ((k === 'setup' || k === 'cosmetic') && c && c.cost) t.excl += c.cost;
    });
    var u = P.units[0], miles = Math.max(O.cur - (u.start_odo || 0), 1);
    var all = t.svc + t.def;
    var bars = [['Service and repair', t.svc], ['DEF', t.def], ['Setup and detail (not counted)', t.excl]];
    var mx = Math.max.apply(null, bars.map(function (b) { return b[1]; }).concat([1]));
    var monthLbl = MON[now.getMonth()];
    return card('mt-spend', 'Maintenance spend', 'PIN-gated',
      '<div class="mt-tiles">' +
      tile(monthLbl + ' so far', m0(t.svcM + t.defM), m0(t.svcM) + ' service, ' + m0(t.defM) + ' DEF', 'ok') +
      tile('Since start', m0(all), m0(t.svc) + ' service, ' + m0(t.def) + ' DEF', 'ok') +
      tile('Cost per mile', '$' + (all / miles).toFixed(3), '$' + (t.svc / miles).toFixed(3) + ' service only', 'ok') +
      '</div>' +
      bars.map(function (b) { return '<div class="mt-sbar"><span>' + b[0] + '</span><div class="mt-sbar-t"><i style="width:' + Math.max(b[1] / mx * 100, b[1] ? 3 : 0).toFixed(1) + '%"></i></div><b>' + m0(b[1]) + '</b></div>'; }).join('') +
      '<p class="mt-fine">Per mile uses ' + n0(miles) + ' miles driven since delivery' + (O.est ? ' (EST, a floor, so cost per mile is a ceiling)' : '') + '. ' +
      (t.est ? 'Includes estimated amounts (oil change, spare swap) until the final invoices are posted. ' : '') +
      (t.unk ? t.unk + ' job' + (t.unk > 1 ? 's' : '') + ' with no cost on file (the 11/11 tire; the warranty may have paid). ' : '') +
      'Fuel and the TrailerGard contract are not maintenance spend. The rate model budgets DEF at $0.034 a mile.</p>');
  }
  function secSpend(P, O) {
    if (st.priv) return spendHtml(P, O);
    if (st.error === 'wrongpin') return lockCard('Wrong PIN. Try again.');
    if (st.error === 'nopin') return lockCard('Costs, who paid, spend this month, since start and cost per mile. Enter the app PIN to see them.');
    if (st.loading) return '<section class="mt-card"><p class="mt-fine">Loading costs...</p></section>';
    return lockCard(st.error || 'Loading...');
  }

  function secWarranty(P, O) {
    var W = P.warranty;
    var bars = [['Basic 36,000 mi', 36000, 3], ['Engine and powertrain 100,000 mi', 100000, 10]].map(function (b) {
      var pc = Math.min(O.cur / b[1] * 100, 100);
      return '<div class="mt-wbar"><span>' + b[0] + '</span><div class="mt-bar"><i style="width:' + Math.max(pc, 1.5).toFixed(1) + '%"></i></div><b>' + n0(O.cur) + ' of ' + n0(b[1]) + ' mi</b></div>';
    }).join('');
    var inService = (P.units[0] || {}).in_service || '2026-09-30';
    var basicEnd = addMonths(inService, 36);
    return card('mt-warr', 'Warranty tie-in', 'Keep every receipt',
      '<div class="mt-in"><div class="mt-in-h"><b>Ram 3500 factory warranty</b>' + pill('ok', 'In force') + '</div>' +
      '<div class="mt-rows">' + W.ram.map(function (r) { return '<div class="mt-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '<small>' + esc(r[2]) + '</small></b></div>'; }).join('') + '</div>' +
      bars + '<p class="mt-fine">Basic coverage also ends by time on ' + ymd(basicEnd) + ', whichever comes first. At the recent pace miles will run out first. ' + esc(W.ram_src) + '</p>' +
      '<div class="mt-sub">What keeps it valid</div><ul class="mt-list">' + W.rules.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<p class="mt-fine">' + esc(W.lds) + '</p></div>' +
      '<div class="mt-in"><div class="mt-in-h"><b>Trailer tires: TrailerGard</b>' + pill('ok', 'On file') + '</div>' +
      '<p class="mt-fine">' + esc(W.tire_note) + '</p>' +
      '<button type="button" class="btn" id="mt-go-ins">Open Insurance tab: tire warranty</button></div>');
  }

  function chkState() { return jget(CHK_KEY, {}); }
  function secChecks(P) {
    var s = chkState(), C = P.checklists;
    function one(key) {
      var c = C[key];
      return '<div class="mt-sub">' + esc(c.title) + '</div><div class="mt-docs">' + c.items.map(function (t, i) {
        var k = key + ':' + i;
        return '<button type="button" class="mt-doc' + (s[k] ? ' on' : '') + '" data-mt-chk="' + k + '" aria-pressed="' + (s[k] ? 'true' : 'false') + '"><span class="mt-ck" aria-hidden="true"></span><span>' + esc(t) + '</span></button>';
      }).join('') + '</div>';
    }
    return card('mt-chk', 'Checklists', 'Tap to check off',
      one('monthly') + one('pretrip') + '<button type="button" class="btn" id="mt-chk-reset">Clear checks</button>' +
      '<p class="mt-fine">Truck list: Ram owner\'s manual, once a month or before a long trip. Trailer list: general trailer practice. Saved on this phone only.</p>');
  }
  function secNeed(P) {
    return card('mt-need', 'Need from Claudio (' + P.need.length + ')', 'Fills the gaps',
      '<ul class="mt-list">' + P.need.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>');
  }
  function secSources(P) {
    var S = P.sources;
    return '<section class="mt-card mt-srcs"><div class="mt-h"><h3>Where the intervals come from</h3></div><ul class="mt-list mt-list-s">' +
      Object.keys(S).map(function (k) { return '<li>' + esc(S[k]) + '</li>'; }).join('') + '</ul>' +
      '<p class="mt-fine">Our oil change is every 5,000 mi, tighter than the Ram manual (15,000 mi or 12 months maximum) and the severe-duty towing schedule (7,500 mi or 6 months). Heavy towing can justify shorter fluid intervals than the manual lists. Check the manual and your dealer before relying on any date here.</p></section>';
  }

  /* ---------- render ---------- */
  function render() {
    var el = root(); if (!el) return;
    if (!st.priv && st.error !== 'wrongpin') st.priv = fromCache();
    var P = st.pub;
    if (!P) {
      el.innerHTML = '<div class="mt-top"><div><div class="mt-kicker">Sand Lily Pad LLC</div><h2>Maintenance</h2></div></div>' +
        '<section class="mt-card"><p class="mt-fine">' + esc(st.pubErr || 'Loading maintenance records...') + '</p>' +
        (st.pubErr ? '<button type="button" class="btn" id="mt-retry">Try again</button>' : '') + '</section>';
      var rt = document.getElementById('mt-retry'); if (rt) rt.addEventListener('click', function () { st.pub = null; st.pubErr = ''; loadPublic(); render(); });
      return;
    }
    var O = odo(), rows = allRows();
    var nav = [['mt-odo', 'Odometer'], ['mt-due', 'Due next'], ['mt-log', 'Log'], ['mt-spend', 'Spend'], ['mt-warr', 'Warranty'], ['mt-chk', 'Checks'], ['mt-need', 'Need']];
    var built = P.built_at ? new Date(P.built_at) : null;
    var stamp = built && !isNaN(built.getTime()) ? ' Records built ' + built.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT.' : '';
    el.innerHTML =
      '<div class="mt-top"><div><div class="mt-kicker">Sand Lily Pad LLC</div><h2>Maintenance</h2></div>' +
      '<div class="mt-acts"><button type="button" class="mt-btn" id="mt-refresh" aria-label="Refresh">' + (st.loading ? '...' : 'Refresh') + '</button></div></div>' +
      secTiles(rows) + secDue(rows) +
      '<nav class="mt-jump">' + nav.map(function (j) { return '<a href="#' + j[0] + '" data-mt-jump="' + j[0] + '">' + j[1] + '</a>'; }).join('') + '</nav>' +
      secOdo(P, O) + secLog(P) + secSpend(P, O) + secWarranty(P, O) + secChecks(P) + secNeed(P) + secSources(P) +
      '<p class="mt-foot">Estimates are marked EST. Not a mechanic\'s advice.' + esc(stamp) + (st.error && st.error !== 'nopin' && st.error !== 'wrongpin' ? ' ' + esc(st.error) : '') + '</p>';
    bind();
  }
  function bind() {
    var el = root(); if (!el) return;
    var f = document.getElementById('mt-pin-form');
    if (f) f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = (document.getElementById('mt-pin').value || '').trim(); if (!v) return;
      setPin(v); st.error = ''; st.priv = null; fetchPriv(true);
    });
    var r = document.getElementById('mt-refresh'); if (r) r.addEventListener('click', function () { st.pub = null; loadPublic(); fetchPriv(true); });
    el.querySelectorAll('[data-mt-jump]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); var t = document.getElementById(a.getAttribute('data-mt-jump')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    });
    el.querySelectorAll('[data-mt-unit]').forEach(function (b) { b.addEventListener('click', function () { st.unit = b.getAttribute('data-mt-unit'); render(); }); });
    el.querySelectorAll('[data-mt-log]').forEach(function (b) { b.addEventListener('click', function () { st.logf = b.getAttribute('data-mt-log'); render(); }); });
    el.querySelectorAll('[data-mt-chk]').forEach(function (b) {
      b.addEventListener('click', function () { var s = chkState(), k = b.getAttribute('data-mt-chk'); if (s[k]) delete s[k]; else s[k] = 1; jset(CHK_KEY, s); render(); });
    });
    var cr = document.getElementById('mt-chk-reset'); if (cr) cr.addEventListener('click', function () { jset(CHK_KEY, {}); render(); });
    var gi = document.getElementById('mt-go-ins'); if (gi) gi.addEventListener('click', function () { if (window.BlackRamApp && window.BlackRamApp.showTab) window.BlackRamApp.showTab('ins'); });
    var up = document.getElementById('mt-odo-up'); if (up) up.addEventListener('click', function () { st.odoOpen = true; render(); var i = document.getElementById('mt-odo-v'); if (i) i.focus(); });
    var ux = document.getElementById('mt-odo-x'); if (ux) ux.addEventListener('click', function () { st.odoOpen = false; render(); });
    var ur = document.getElementById('mt-odo-reset'); if (ur) ur.addEventListener('click', function () { try { localStorage.removeItem(ODO_KEY); } catch (e) { /* ignore */ } render(); });
    var of = document.getElementById('mt-odo-form');
    if (of) of.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = Number(document.getElementById('mt-odo-v').value), d = document.getElementById('mt-odo-d').value || todayIso();
      if (!(v > 0)) return;
      jset(ODO_KEY, { value: Math.round(v), as_of: d }); st.odoOpen = false; render();
    });
  }

  /* ---------- styles (injected; v51 tokens) ---------- */
  function css() {
    if (document.getElementById('mt-css')) return;
    var s = document.createElement('style'); s.id = 'mt-css';
    s.textContent =
      '.mt-panel{padding-bottom:var(--s-4)}#mt-root{display:flex;flex-direction:column;gap:var(--s-2)}' +
      '.mt-top{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--s-1)}' +
      '.mt-kicker{font-size:var(--fs-xs);font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c-gold)}' +
      '.mt-top h2{margin:0;font-size:var(--fs-2xl);font-weight:var(--fw-black);color:var(--c-text-1);letter-spacing:-.01em}' +
      '.mt-btn{min-height:var(--tap);padding:0 var(--s-2);border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font:inherit;font-weight:800;font-size:var(--fs-sm);cursor:pointer}' +
      '.mt-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s-1)}' +
      '.mt-tile{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-md);padding:var(--s-1h) var(--s-1);display:flex;flex-direction:column;gap:2px;min-width:0}' +
      '.mt-tile span{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text-3)}' +
      '.mt-tile b{font-size:var(--fs-lg);font-weight:900;color:var(--c-take);line-height:1.15;overflow-wrap:anywhere}' +
      '.mt-tile small{font-size:11px;color:var(--c-text-3);line-height:1.25}' +
      '.mt-t-warn b{color:var(--c-maybe)}.mt-t-warn{border-color:var(--c-maybe)}.mt-t-bad b{color:#FCA5A5}.mt-t-bad{border-color:#F87171}' +
      '.mt-next{margin:0;font-size:var(--fs-sm);color:var(--c-text-2)}.mt-next b{color:var(--c-text-1)}' +
      '.mt-jump{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:-2px 0}' +
      '.mt-jump a{flex:none;font-size:var(--fs-xs);font-weight:700;color:var(--c-text-3);text-decoration:none;padding:4px 10px;border-radius:var(--radius-pill);background:var(--c-surface-1)}' +
      '.mt-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg);padding:var(--s-2) var(--s-2) var(--s-1h);display:flex;flex-direction:column;gap:var(--s-1h);scroll-margin-top:calc(var(--appbar-h) + 8px)}' +
      '.mt-h{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-1);flex-wrap:wrap}' +
      '.mt-h h3{margin:0;font-size:var(--fs-lg);font-weight:var(--fw-black);color:var(--c-text-1)}.mt-h span{font-size:var(--fs-xs);font-weight:700;color:var(--c-text-3)}' +
      '.mt-fine{margin:0;font-size:var(--fs-xs);color:var(--c-text-3);line-height:1.4}' +
      '.mt-big{font-size:var(--fs-3xl);font-weight:var(--fw-black);color:var(--c-gold);line-height:1.1}.mt-big span{display:block;font-size:var(--fs-sm);font-weight:700;color:var(--c-text-3);margin-top:4px;line-height:1.35}' +
      '.mt-pill{flex:none;font-size:11px;font-weight:800;padding:2px 9px;border-radius:var(--radius-pill);white-space:nowrap}' +
      '.mt-pill-ok{background:var(--c-take-bg);color:var(--c-take)}.mt-pill-warn{background:var(--c-maybe-bg);color:var(--c-maybe)}.mt-pill-bad{background:rgba(248,113,113,.14);color:#FCA5A5}.mt-pill-need{background:var(--c-surface-3);color:var(--c-text-2);border:1px dashed var(--c-line-strong)}' +
      '.mt-segs{display:flex;gap:6px}.mt-segs-wrap{flex-wrap:wrap}' +
      '.mt-seg{min-height:36px;padding:0 12px;border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-2);font:inherit;font-size:var(--fs-xs);font-weight:800;cursor:pointer}' +
      '.mt-seg.on{background:var(--c-accent);border-color:var(--c-accent);color:#14111f}' +
      '.mt-dues{display:flex;flex-direction:column;gap:var(--s-1)}' +
      '.mt-due{background:var(--c-surface-2);border-radius:var(--radius-md);border-left:4px solid var(--c-take)}' +
      '.mt-due-warn{border-left-color:var(--c-maybe)}.mt-due-bad{border-left-color:#F87171}.mt-due-need{border-left-color:var(--c-line-strong);border-left-style:dashed}' +
      '.mt-due summary{list-style:none;cursor:pointer;padding:var(--s-1h);display:flex;flex-direction:column;gap:6px}.mt-due summary::-webkit-details-marker{display:none}' +
      '.mt-due-top{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s-1)}.mt-due-top b{font-size:var(--fs-md);color:var(--c-text-1);line-height:1.25;min-width:0}' +
      '.mt-due-tag{font-size:11px;font-weight:700;color:var(--c-text-3)}' +
      '.mt-bar{height:12px;border-radius:var(--radius-pill);background:var(--c-surface-3);overflow:hidden}.mt-bar i{display:block;height:100%;background:var(--c-take);border-radius:var(--radius-pill)}' +
      '.mt-due-warn .mt-bar i{background:var(--c-maybe)}.mt-due-bad .mt-bar i{background:#F87171}.mt-due-need .mt-bar i{width:0!important}' +
      '.mt-due-l{display:flex;flex-direction:column;gap:1px;font-size:12px;font-weight:700;color:var(--c-text-2)}.mt-due-l span:last-child{color:var(--c-text-3);font-weight:600}' +
      '.mt-due-more{padding:0 var(--s-1h) var(--s-1h);display:flex;flex-direction:column;gap:6px}.mt-due-more p{margin:0;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.4}.mt-due-more .mt-src{font-size:11px;color:var(--c-text-3)}' +
      '.mt-rows{display:flex;flex-direction:column}' +
      '.mt-row{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--s-1);padding:7px 0;border-bottom:1px solid var(--c-line);font-size:var(--fs-sm);color:var(--c-text-2)}.mt-row:last-child{border-bottom:0}' +
      '.mt-row>span{flex:0 1 42%;min-width:0}.mt-row b{flex:1;text-align:right;font-weight:800;color:var(--c-text-1);min-width:0}.mt-row b small{display:block;font-size:11px;font-weight:600;color:var(--c-text-3);margin-top:1px}' +
      '.mt-call{margin:0;padding:var(--s-1) var(--s-1h);border-radius:var(--radius-sm);font-size:var(--fs-sm);font-weight:600;line-height:1.35}.mt-call-warn{background:var(--c-maybe-bg);color:var(--c-maybe)}' +
      '.mt-odo-btns{display:flex;gap:var(--s-1);flex-wrap:wrap}.mt-odo-form{display:flex;flex-direction:column;gap:var(--s-1)}' +
      '.mt-odo-form label{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-xs);font-weight:800;color:var(--c-text-3)}' +
      '.mt-odo-form input{min-height:var(--tap);padding:0 var(--s-1h);border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-size:var(--fs-base)}' +
      '.mt-logs{display:flex;flex-direction:column}' +
      '.mt-log{display:grid;grid-template-columns:44px 1fr auto;gap:var(--s-1);padding:var(--s-1h) 0;border-bottom:1px solid var(--c-line);align-items:flex-start}.mt-log:last-child{border-bottom:0}' +
      '.mt-log-d{display:flex;flex-direction:column;align-items:center;background:var(--c-surface-2);border-radius:var(--radius-sm);padding:4px 0}.mt-log-d b{font-size:var(--fs-sm);color:var(--c-text-1)}.mt-log-d span{font-size:10px;color:var(--c-text-3);font-weight:700}' +
      '.mt-log-t b{font-size:var(--fs-sm);color:var(--c-text-1);line-height:1.3}' +
      '.mt-log-s{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}' +
      '.mt-chip{font-size:10px;font-weight:800;padding:2px 8px;border-radius:var(--radius-pill);background:var(--c-surface-3);color:var(--c-text-2)}.mt-chip-unk{color:var(--c-maybe)}' +
      '.mt-u-truck{background:rgba(212,175,55,.16);color:var(--c-gold)}.mt-u-trailer{background:var(--c-surface-3);color:var(--c-accent-hi)}.mt-u-unconfirmed{background:rgba(248,113,113,.14);color:#FCA5A5}' +
      '.mt-log-v{font-size:12px;color:var(--c-text-3);margin-top:4px;line-height:1.35}.mt-log-n{margin:4px 0 0;font-size:11px;color:var(--c-text-3);line-height:1.4}' +
      '.mt-cost{font-size:var(--fs-sm);color:var(--c-text-1);text-align:right;white-space:nowrap}.mt-cost small{display:block;font-size:9px;color:var(--c-maybe);font-weight:800}.mt-unk{color:var(--c-maybe);font-size:12px}.mt-lockd{color:var(--c-text-3)}.mt-lk{width:16px;height:16px}' +
      '.mt-log-baseline{opacity:.8}.mt-log-cosmetic .mt-log-t b,.mt-log-setup .mt-log-t b{color:var(--c-text-2)}' +
      '.mt-sbar{display:grid;grid-template-columns:116px 1fr 56px;align-items:center;gap:var(--s-1);font-size:12px;color:var(--c-text-2);font-weight:700}.mt-sbar b{text-align:right;color:var(--c-text-1);font-weight:800;font-variant-numeric:tabular-nums}' +
      '.mt-sbar-t{height:12px;border-radius:var(--radius-pill);background:var(--c-surface-3);overflow:hidden}.mt-sbar-t i{display:block;height:100%;background:var(--c-accent);border-radius:var(--radius-pill)}' +
      '.mt-in{background:var(--c-surface-2);border-radius:var(--radius-md);padding:var(--s-1h);display:flex;flex-direction:column;gap:var(--s-1)}.mt-in-h{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1)}.mt-in-h b{font-size:var(--fs-md);font-weight:800;color:var(--c-text-1)}' +
      '.mt-wbar{display:grid;grid-template-columns:1fr;gap:4px;font-size:12px;font-weight:700;color:var(--c-text-2)}.mt-wbar b{color:var(--c-text-1);font-weight:800}' +
      '.mt-sub{font-size:var(--fs-xs);font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.06em;margin-top:4px}' +
      '.mt-list{margin:0;padding-left:18px;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.45;display:flex;flex-direction:column;gap:6px}.mt-list-s{font-size:var(--fs-xs);color:var(--c-text-3)}' +
      '.mt-docs{display:flex;flex-direction:column;gap:6px}' +
      '.mt-doc{display:flex;align-items:center;gap:var(--s-1h);min-height:var(--tap);padding:var(--s-1) var(--s-1h);border-radius:var(--radius-md);border:1px solid var(--c-line);background:var(--c-surface-2);color:var(--c-text-1);text-align:left;cursor:pointer;font:inherit;font-size:var(--fs-sm);font-weight:700}' +
      '.mt-ck{flex:none;width:22px;height:22px;border-radius:7px;border:2px solid var(--c-line-strong)}.mt-doc.on .mt-ck{background:var(--c-take);border-color:var(--c-take);box-shadow:inset 0 0 0 4px var(--c-surface-2)}.mt-doc.on{opacity:.7}' +
      '.mt-foot{margin:0;font-size:11px;color:var(--c-text-3);text-align:center;line-height:1.4}' +
      '.mt-lock{align-items:center;text-align:center;padding:var(--s-4) var(--s-2)}.mt-lock h3{margin:0;font-size:var(--fs-xl);font-weight:800;color:var(--c-text-1)}' +
      '.mt-lock-ico{width:56px;height:56px;border-radius:50%;background:var(--c-surface-3);color:var(--c-accent-hi);display:grid;place-items:center}.mt-lock-ico svg{width:28px;height:28px}' +
      '.mt-pin{display:flex;gap:var(--s-1);width:100%;max-width:320px}.mt-pin input{flex:1;min-width:0;min-height:var(--tap);padding:0 var(--s-1h);border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-size:var(--fs-base)}';
    document.head.appendChild(s);
  }

  function onShow() { loadPublic(); render(); fetchPriv(false); }
  function init() {
    css();
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'maint') onShow(); });
    if (document.documentElement.getAttribute('data-tab') === 'maint') onShow();
  }
  window.BlackRamMaintenance = { render: render, refresh: function () { st.pub = null; loadPublic(); fetchPriv(true); } };
  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { maintenance: window.BlackRamMaintenance });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
