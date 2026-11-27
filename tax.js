/* Black Ram Logistics - Tax tab (v98+). Filing calendar, does-it-apply, deductions, documents and CPA questions
   for Sand Lily Pad LLC (Texas LLC taxed as a partnership).
   Public part: data/tax.json (dates, rules, reasoning, official sources; no amounts, no full EIN/SSN, no addresses).
   Amounts: computed in the browser from the PIN-gated /financials payload (accounting key), same session as Finance
   and Accounting. Nothing financial is in this repo. Status changes (not started / in progress / filed / paid / N/A) use
   the PIN-checked relay POST /maintenance like DOT Ready (KV maint_log, item_id "tax-<id>", status in the note),
   with a localStorage queue (blackram_tax_queue_v1) that sends later.
   Uses v51 tokens and the dr-* card styles from dotready.js; extends window.BlackRamApp. Plain ASCII. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var FIN_KEY = 'blackram_fin_session_v1';
  var QUEUE_KEY = 'blackram_tax_queue_v1';
  var CACHE_KEY = 'blackram_tax_cache_v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var ST = { ns: 'Not started', ip: 'In progress', filed: 'Filed', paid: 'Paid', na: 'N/A' };
  var ST_ORDER = ['ns', 'ip', 'filed', 'paid', 'na'];
  var ST_COL = { ns: '#8F86B8', ip: '#F2C94C', filed: '#34D399', paid: '#10B981', na: '#4B4566' };
  var AP = { yes: ['YES', 'ok'], no: ['NO', 'na'], check: ['CHECK', 'warn'], paid: ['PAID', 'ok'] };
  var DOC = { have: ['HAVE', 'ok'], partial: ['PARTIAL', 'warn'], missing: ['MISSING', 'bad'], unknown: ['UNKNOWN', 'unk'] };
  var st = { pub: null, pubErr: '', pubLoading: false, srv: null, loading: false, flushing: false, syncMsg: '', toast: '', fin: null, finLoading: false, finErr: '', showDone: false, sheetId: '' };
  var toastTimer = 0, flushTimer = 0;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function m0(n) { if (n == null || !isFinite(n)) return 'not on file'; var a = Math.abs(Math.round(n)).toLocaleString('en-US'); return (n <= -0.5 ? '-$' : '$') + a; }
  function m2(n) { if (n == null || !isFinite(n)) return 'not on file'; var a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < -0.004 ? '-$' : '$') + a; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function utc(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function daysTo(iso) { return Math.round((utc(iso) - utc(todayIso())) / 86400000); }
  function ymd(iso) { var p = String(iso).slice(0, 10).split('-'); return MON[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0]; }
  function dow(iso) { return DOW[new Date(utc(iso)).getUTCDay()]; }
  function md(iso) { var p = String(iso).slice(0, 10).split('-'); return (+p[1]) + '/' + (+p[2]); }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private mode */ } }
  function root() { return document.getElementById('tx-root'); }
  function T() { return window.BlackRamTiles; }
  function ta(arg, label) { var t = T(); return t ? t.attrs('tx', arg, label) : ''; }
  function newId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pill(tone, txt) { return '<span class="dr-pill dr-pill-' + tone + '">' + esc(txt) + '</span>'; }
  function src(k) { var s = st.pub && st.pub.sources && st.pub.sources[k]; return s ? '<li><a class="dr-link" href="' + esc(s[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(s[0]) + '</a></li>' : ''; }

  /* ---------- public data ---------- */
  function loadPublic() {
    if (st.pub || st.pubLoading) return;
    st.pubLoading = true;
    fetch('data/tax.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { st.pub = j; st.pubErr = ''; })
      .catch(function (e) { st.pubErr = 'Could not load the tax calendar (' + (e && e.message ? e.message : 'offline') + ').'; })
      .then(function () { st.pubLoading = false; render(); ping(); if (st.pub && pin()) fetchSrv(); });
  }
  function ping() { try { document.dispatchEvent(new CustomEvent('blackram:tax')); } catch (e) { /* ignore */ } }

  /* ---------- status log (relay, PIN) ---------- */
  function slim(entries) {
    var out = [];
    (entries || []).forEach(function (e) {
      if (e && String(e.item_id || '').indexOf('tax-') === 0) out.push({ id: e.id, item_id: e.item_id, date: e.date, note: e.note || '', at: e.at || '', undone: e.undone ? true : undefined });
    });
    return out;
  }
  function srvEntries() { if (st.srv) return st.srv; var c = jget(CACHE_KEY, null); return (c && Array.isArray(c.entries)) ? c.entries : []; }
  function fetchSrv() {
    var p = pin(); if (!p || st.loading) return;
    st.loading = true;
    fetch(RELAY + '/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p, op: 'list' }), cache: 'no-store' })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (resp.ok && j && j.ok && j.data) { st.srv = slim(j.data.entries); jset(CACHE_KEY, { at: Date.now(), entries: st.srv }); st.syncMsg = ''; }
          else if (resp.status === 401) st.syncMsg = 'Wrong PIN. Status changes stay on this phone until the PIN is right.';
          else st.syncMsg = 'Could not load the shared log (' + resp.status + '). Showing this phone.';
        });
      })
      .catch(function () { st.syncMsg = 'Offline. Showing this phone.'; })
      .then(function () { st.loading = false; render(); ping(); flush(); });
  }
  function queue() { var q = jget(QUEUE_KEY, []); return Array.isArray(q) ? q : []; }
  function setQueue(q) { jset(QUEUE_KEY, q); }
  function effEntries() {
    var map = {}, order = [];
    srvEntries().forEach(function (e) { map[e.id] = Object.assign({}, e); order.push(e.id); });
    queue().forEach(function (op) {
      if (op.op === 'add' && op.entry && !map[op.entry.id]) { map[op.entry.id] = Object.assign({}, op.entry, { pending: true }); order.push(op.entry.id); }
      else if (op.op === 'undo' && map[op.id]) { map[op.id].undone = true; map[op.id].pending = true; }
    });
    return order.map(function (id) { return map[id]; });
  }
  function parseNote(n) { var m = /^\[(ns|ip|filed|paid|na)\] ?([\s\S]*)$/.exec(n || ''); return m ? { s: m[1], text: m[2] || '' } : null; }
  function flush() {
    if (st.flushing) return;
    var q = queue(); if (!q.length) return;
    var p = pin(); if (!p) return;
    var op = q[0], sent = [], body;
    if (op.op === 'add') { for (var i = 0; i < q.length && q[i].op === 'add' && sent.length < 20; i++) sent.push(q[i]); body = { pin: p, op: 'add', entries: sent.map(function (x) { return x.entry; }) }; }
    else { sent = [op]; body = { pin: p, op: op.op, id: op.id }; }
    st.flushing = true;
    var retry = false, more = false;
    fetch(RELAY + '/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
      .then(function (resp) { return resp.json().catch(function () { return null; }).then(function (j) { return { resp: resp, j: j }; }); })
      .then(function (r) {
        var drop = false;
        if (r.resp.ok && r.j && r.j.ok) { st.srv = slim(r.j.data && r.j.data.entries); jset(CACHE_KEY, { at: Date.now(), entries: st.srv }); st.syncMsg = ''; drop = true; }
        else if (r.resp.status === 401) st.syncMsg = 'Wrong PIN. Saved on this phone; it sends once the PIN is right.';
        else if (r.resp.status === 400 || r.resp.status === 404) { drop = true; st.syncMsg = 'The server rejected one change: ' + ((r.j && r.j.error) || r.resp.status) + '.'; }
        else { st.syncMsg = 'Could not reach the server. Saved on this phone, will retry.'; retry = true; }
        if (drop) {
          var keys = sent.map(function (o) { return o.op + ':' + (o.entry ? o.entry.id : o.id); });
          setQueue(queue().filter(function (x) { return keys.indexOf(x.op + ':' + (x.entry ? x.entry.id : x.id)) < 0; }));
          more = queue().length > 0;
        }
      })
      .catch(function () { st.syncMsg = 'Offline. Saved on this phone, will retry.'; retry = true; })
      .then(function () {
        st.flushing = false; render(); ping(); if (st.sheetId) openItem(st.sheetId, true);
        if (more) flush(); else if (retry) { if (flushTimer) clearTimeout(flushTimer); flushTimer = setTimeout(flush, 30000); }
      });
  }
  function setStatus(id, s, text) {
    var it = itemById(id); if (!it || !ST[s]) return;
    var entry = { id: newId(), item_id: ('tax-' + id).slice(0, 40), unit: 'truck', date: todayIso(), odo: null, cost: null, vendor: '', note: ('[' + s + ']' + (text ? ' ' + text : '')).slice(0, 290), at: new Date().toISOString() };
    var q = queue(); q.push({ op: 'add', entry: entry }); setQueue(q);
    toast(it.title + ': ' + ST[s] + '. ' + (pin() ? 'Saving to every phone...' : 'Saved on this phone. Enter the PIN to sync.'));
    render(); ping(); flush();
  }
  function toast(t) { st.toast = t; if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(function () { st.toast = ''; render(); }, 8000); }

  /* ---------- items ---------- */
  function items() { return (st.pub && st.pub.items) || []; }
  function itemById(id) { return items().filter(function (x) { return x.id === id; })[0]; }
  function calc(it) {
    var mine = effEntries().filter(function (e) { return e.item_id === ('tax-' + it.id).slice(0, 40) && !e.undone; });
    mine.sort(function (a, b) { return (a.at || a.date) < (b.at || b.date) ? -1 : 1; });
    var le = mine.length ? mine[mine.length - 1] : null, pn = le ? parseNote(le.note) : null;
    var s = pn ? pn.s : (it.applies === 'no' ? 'na' : it.status || 'ns');
    var d = daysTo(it.due);
    var done = s === 'filed' || s === 'paid' || s === 'na';
    var tone = done ? 'ok' : (d < 0 ? 'bad' : (d <= 14 ? 'bad' : (d <= 45 ? 'warn' : 'unk')));
    return { s: s, d: d, done: done, tone: tone, entry: le, text: pn ? pn.text : '', hist: mine };
  }
  function rows() { return items().map(function (it) { return { it: it, r: calc(it) }; }).sort(function (a, b) { return a.it.due < b.it.due ? -1 : (a.it.due > b.it.due ? 1 : 0); }); }
  function upcoming() { return rows().filter(function (x) { return !x.r.done && x.r.d >= -30 && x.it.applies !== 'no'; }); }
  function whenTxt(d) { return d < 0 ? (-d) + ' d late' : (d === 0 ? 'due today' : (d === 1 ? 'tomorrow' : d + ' d left')); }

  /* ---------- financials (PIN) ---------- */
  function finFromSession() { try { var c = sessionStorage.getItem(FIN_KEY); if (!c) return null; var j = JSON.parse(c); return j && j.accounting ? j : null; } catch (e) { return null; } }
  function fetchFin() {
    var p = pin(); if (!p || st.finLoading) return;
    var c = finFromSession(); if (c) { st.fin = c; return; }
    st.finLoading = true;
    fetch(RELAY + '/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }), cache: 'no-store' })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (resp.ok && j && j.ok && j.data) { st.fin = j.data.accounting ? j.data : null; st.finErr = st.fin ? '' : 'Accounting data is not on the server yet.'; try { sessionStorage.setItem(FIN_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ } }
          else if (resp.status === 401) { st.finErr = 'wrongpin'; st.fin = null; }
          else st.finErr = (j && j.error) || ('Could not load (' + resp.status + ')');
        });
      })
      .catch(function () { st.finErr = 'Offline.'; })
      .then(function () { st.finLoading = false; render(); });
  }
  var BUCKETS = [
    ['fee', 'Totni 13% fee', 1], ['fuel', 'Fuel', 1], ['insurance', 'Insurance', 1], ['def', 'DEF', 1], ['eld', 'ELD (Totni)', 1],
    ['tolls', 'Tolls, scales, parking', 1], ['repairs', 'Repairs', 1], ['legal', 'Formation and legal', 1], ['travel', 'Travel (flight)', 1],
    ['equip', 'Small equipment, supplies', 1], ['admin', 'Load board, dispatch, bank', 1], ['software', 'Software (incl. Grok Bot AI)', 1], ['meals', 'Meals (50%)', 0.5]
  ];
  function deductions() {
    var F = st.fin; if (!F || !F.accounting) return null;
    var A = F.accounting, yr = String((st.pub && st.pub.year) || 2026);
    var months = (A.months || []).filter(function (m) { return m.slice(0, 4) === yr; });
    var b = {}, lines = {}, gross = 0, loads = 0;
    BUCKETS.forEach(function (x) { b[x[0]] = 0; lines[x[0]] = []; });
    var nd = { notes: 0, cap: 0, unk: 0 }, ndl = { notes: [], cap: [], unk: [] };
    months.forEach(function (m) {
      var p = A.pl && A.pl[m]; if (!p) return;
      gross += Number(p.gross) || 0; loads += Number(p.loads) || 0;
      var L = p.lines || {};
      ['fee', 'eld'].forEach(function (k) { b[k] += Number(L[k]) || 0; });
    });
    (A.revenue || []).forEach(function (r) { if (String(r.month || '').slice(0, 4) === yr) { if (r.fee) lines.fee.push({ date: r.pickup, t: 'Load ' + r.load + (r.broker ? ' | ' + r.broker : ''), a: Number(r.fee) }); if (r.eld) lines.eld.push({ date: r.pickup, t: 'ELD on load ' + r.load, a: Number(r.eld) }); } });
    (A.expenses || []).forEach(function (e) {
      if (String(e.date || '').slice(0, 4) !== yr) return;
      var a = Number(e.amount) || 0, raw = String(e.cat_raw || '').toLowerCase(), v = String(e.vendor || ''), k = e.cat, row = { date: e.date, t: v, a: a, est: !!e.est };
      if (k === 'fee' || k === 'eld') return; /* from the P&L lines above */
      if (k === 'notes') { nd.notes += a; ndl.notes.push(row); return; }
      if (k === 'overhead') {
        if (raw.indexOf('legal') >= 0) k = 'legal';
        else if (raw.indexOf('title') >= 0 || /trailer cash at purchase|down payment/i.test(v)) { nd.cap += a; ndl.cap.push(row); return; }
        else if (raw === 'unconfirmed') { nd.unk += a; ndl.unk.push(row); return; }
        else if (raw === 'travel') k = 'travel';
        else if (/equipment|supplies|safety/.test(raw)) k = 'equip';
        else k = 'admin';
      }
      if (b[k] == null) k = 'admin';
      b[k] += a; lines[k].push(row);
    });
    var list = BUCKETS.map(function (x) { return { k: x[0], label: x[1], cash: b[x[0]], ded: b[x[0]] * x[2], lines: lines[x[0]] }; });
    if (A.meals_tax && isFinite(Number(A.meals_tax.deductible))) { list.forEach(function (x) { if (x.k === 'meals' && Math.abs(x.cash - Number(A.meals_tax.amount)) < 0.01) x.ded = Number(A.meals_tax.deductible); }); }
    list = list.filter(function (x) { return x.cash > 0.004; }).sort(function (a, c) { return c.ded - a.ded; });
    var ded = list.reduce(function (s, x) { return s + x.ded; }, 0);
    var basis = null;
    ((A.balance && A.balance.assets) || []).forEach(function (x) { if (/truck \+ trailer/i.test(x.label)) basis = Number(x.amount); });
    var drv = A.driver || {};
    return { gross: gross, loads: loads, list: list, ded: ded, net: gross - ded, nd: nd, ndl: ndl, basis: basis, drvPaid: Number(drv.paid_total) || 0, months: months };
  }

  /* ---------- charts ---------- */
  function timeline(rs) {
    var W = 340, H = 92, L = 10, R = 10;
    var t0 = todayIso(), list = rs.filter(function (x) { return x.it.applies !== 'no'; });
    if (!list.length) return '';
    var end = list[list.length - 1].it.due, span = Math.max(30, daysTo(end) + 10);
    function x(iso) { return L + (W - L - R) * Math.max(0, Math.min(1, daysTo(iso) / span)); }
    var ticks = '', d0 = new Date(utc(t0));
    for (var i = 1; i <= 12; i++) {
      var dt = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i, 1)); var iso = dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-01';
      if (daysTo(iso) > span) break;
      var xx = x(iso).toFixed(1);
      ticks += '<line x1="' + xx + '" x2="' + xx + '" y1="40" y2="48" class="tx-tick"/><text x="' + xx + '" y="62" text-anchor="middle" class="tx-tl">' + MON[dt.getUTCMonth()] + '</text>';
    }
    var lanes = {}, dots = list.map(function (o) {
      var cx = x(o.it.due), key = Math.round(cx / 9); lanes[key] = (lanes[key] || 0) + 1;
      var cy = 44 - (lanes[key] - 1) * 11;
      var col = o.r.done ? ST_COL[o.r.s] : (o.r.tone === 'bad' ? '#F87171' : (o.r.tone === 'warn' ? '#F2C94C' : '#C4BDE6'));
      return '<circle cx="' + cx.toFixed(1) + '" cy="' + cy + '" r="5" fill="' + col + '" stroke="#100C1C" stroke-width="1.5"><title>' + esc(md(o.it.due) + ' ' + o.it.title) + '</title></circle>';
    }).join('');
    return '<svg class="tx-timeline" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Deadlines from today to ' + esc(ymd(end)) + '">' +
      '<line x1="' + L + '" x2="' + (W - R) + '" y1="44" y2="44" class="tx-axis"/>' + ticks +
      '<line x1="' + L + '" x2="' + L + '" y1="30" y2="56" class="tx-now"/><text x="' + L + '" y="80" class="tx-tl tx-tl-now">Today</text>' + dots + '</svg>';
  }
  function statusBar(rs) {
    var c = {}, n = 0; ST_ORDER.forEach(function (k) { c[k] = 0; });
    rs.forEach(function (x) { c[x.r.s] = (c[x.r.s] || 0) + 1; n++; });
    var bar = ST_ORDER.filter(function (k) { return c[k]; }).map(function (k) { return '<i style="flex:' + c[k] + ';background:' + ST_COL[k] + '"></i>'; }).join('');
    var leg = ST_ORDER.map(function (k) {
      return '<div class="tx-leg tl-tap"' + ta('st:' + k, ST[k] + ': ' + c[k] + '. Open list') + '><span class="tx-sw" style="background:' + ST_COL[k] + '"></span><b class="num-yellow">' + c[k] + '</b><small>' + ST[k] + '</small></div>';
    }).join('');
    return '<div class="tx-sbar" aria-hidden="true">' + bar + '</div><div class="tx-legs">' + leg + '</div>';
  }
  function dedBars(D) {
    var mx = D.list.reduce(function (m, x) { return Math.max(m, x.cash); }, 1);
    return '<div class="tx-bars">' + D.list.map(function (x) {
      return '<div class="tx-bar tl-tap tl-chev"' + ta('ded:' + x.k, x.label + ' ' + m0(x.ded) + ' deductible. Open lines') + '><span class="tx-bl">' + esc(x.label) + '</span>' +
        '<span class="tx-bt"><i class="tx-bc" style="width:' + (100 * x.cash / mx).toFixed(1) + '%"></i><i class="tx-bd" style="width:' + (100 * x.ded / mx).toFixed(1) + '%"></i></span>' +
        '<b class="tx-bv num-yellow">' + m0(x.ded) + '</b></div>';
    }).join('') + '</div><div class="tx-key"><span><i class="tx-bd"></i>Deductible EST</span><span><i class="tx-bc"></i>Cash spent</span></div>';
  }

  /* ---------- sections ---------- */
  function secNext(rs) {
    var up = upcoming().slice(0, 2);
    var hero = up.map(function (o, i) {
      return '<div class="tx-next tl-tap tl-chev' + (i ? ' tx-next2' : '') + '"' + ta('it:' + o.it.id, o.it.title + ', due ' + ymd(o.it.due) + '. Open') + '>' +
        '<div class="tx-nd"><b class="num-yellow">' + Math.max(0, o.r.d) + '</b><small>' + (o.r.d < 0 ? 'days late' : 'days') + '</small></div>' +
        '<div class="tx-nm"><b>' + esc(o.it.title) + '</b><small>' + esc(dow(o.it.due) + ' ' + ymd(o.it.due) + ' | ' + o.it.form) + '</small>' +
        '<span class="tx-pills">' + pill(AP[o.it.applies] ? AP[o.it.applies][1] : 'unk', AP[o.it.applies] ? AP[o.it.applies][0] : 'CHECK') + pill(o.r.s === 'ip' ? 'warn' : 'unk', ST[o.r.s]) + '</span></div></div>';
    }).join('');
    return '<section class="dr-card" aria-label="Next deadlines"><div class="dr-h"><h3>Next due</h3><span>' + upcoming().length + ' open</span></div>' +
      (hero || '<p class="dr-p">Nothing open. All filed, paid or not required.</p>') + timeline(rs) + statusBar(rs) + '</section>';
  }
  function secCal(rs) {
    var list = st.showDone ? rs : rs.filter(function (x) { return !x.r.done || x.it.applies === 'no'; }), cur = '', out = '';
    list = list.filter(function (x) { return x.it.applies !== 'no'; });
    list.forEach(function (o) {
      var mk = o.it.due.slice(0, 7);
      if (mk !== cur) { cur = mk; out += '<div class="tx-mon">' + MON[+mk.slice(5, 7) - 1] + ' ' + mk.slice(0, 4) + '</div>'; }
      var ap = AP[o.it.applies] || AP.check;
      out += '<div class="tx-row tl-tap tl-chev"' + ta('it:' + o.it.id, o.it.title + ', ' + ymd(o.it.due) + ', ' + ST[o.r.s] + '. Open') + '>' +
        '<div class="tx-date tx-' + o.r.tone + '"><small>' + MON[+o.it.due.slice(5, 7) - 1] + '</small><b>' + (+o.it.due.slice(8, 10)) + '</b></div>' +
        '<div class="tx-rm"><b>' + esc(o.it.title) + '</b><small>' + esc(o.it.form + ' | ' + (o.r.done ? ST[o.r.s] : whenTxt(o.r.d))) + '</small></div>' +
        '<div class="tx-rp">' + pill(ap[1], ap[0]) + '<span class="tx-st" style="color:' + ST_COL[o.r.s] + '">' + esc(ST[o.r.s]) + '</span></div></div>';
    });
    var nDone = rs.filter(function (x) { return x.r.done && x.it.applies !== 'no'; }).length;
    return '<section class="dr-card" id="tx-cal" aria-label="Filing calendar"><div class="dr-h"><h3>Filing calendar</h3><span>tap for what, who, docs</span></div>' + out +
      (nDone ? '<button type="button" class="dr-more" data-tx-done="1">' + (st.showDone ? 'Hide filed and paid' : 'Show ' + nDone + ' filed or paid') + '</button>' : '') + '</section>';
  }
  function secRules() {
    var R = (st.pub && st.pub.rules) || [];
    var c = { yes: 0, no: 0, check: 0, paid: 0 }; R.forEach(function (r) { c[r.a] = (c[r.a] || 0) + 1; });
    return '<section class="dr-card" id="tx-rules" aria-label="Does it apply"><div class="dr-h"><h3>Does it apply to us?</h3><span>' + c.yes + ' yes | ' + c.check + ' check | ' + c.no + ' no</span></div>' +
      '<div class="tx-rules">' + R.map(function (r) {
        var ap = AP[r.a] || AP.check;
        return '<div class="tx-rule tl-tap tl-chev"' + ta('rule:' + r.id, r.t + ': ' + ap[0] + '. Why') + '>' + pill(ap[1], ap[0]) + '<b>' + esc(r.t) + '</b></div>';
      }).join('') + '</div></section>';
  }
  function lockCard(title, msg) {
    return '<section class="dr-card" aria-label="' + esc(title) + '"><div class="dr-h"><h3>' + esc(title) + '</h3><span>PIN</span></div><p class="dr-p">' + esc(msg) + '</p>' +
      '<form class="dr-pin" data-tx-pin="1" autocomplete="off"><input type="password" inputmode="numeric" placeholder="App PIN" aria-label="App PIN" /><button type="submit" class="btn primary">Unlock</button></form></section>';
  }
  function secDed() {
    var title = 'Deductions ' + ((st.pub && st.pub.year) || 2026);
    if (!pin() || st.finErr === 'wrongpin') return lockCard(title, st.finErr === 'wrongpin' ? 'Wrong PIN. Try again.' : 'Amounts stay behind the app PIN, same as Finance and Accounting.');
    if (!st.fin) { if (!st.finLoading) fetchFin(); return '<section class="dr-card"><div class="dr-h"><h3>' + esc(title) + '</h3></div><p class="dr-p">' + (st.finErr ? esc(st.finErr) : 'Loading the books...') + '</p></section>'; }
    var D = deductions(); if (!D) return '';
    var N = (st.pub && st.pub.deduction_notes) || {};
    var tiles = '<div class="tx-tiles">' +
      '<div class="tx-tile tl-tap"' + ta('sum:gross', 'Gross revenue') + '><small>Gross ' + esc(D.months.length ? MON[+D.months[0].slice(5) - 1] + '-' + MON[+D.months[D.months.length - 1].slice(5) - 1] : '') + '</small><b class="num-yellow">' + m0(D.gross) + '</b><span>' + D.loads + ' loads</span></div>' +
      '<div class="tx-tile tl-tap"' + ta('sum:ded', 'Deductible expenses') + '><small>Deductible EST</small><b class="num-yellow">' + m0(D.ded) + '</b><span>before depreciation</span></div>' +
      '<div class="tx-tile tl-tap"' + ta('sum:net', 'Tax profit before depreciation') + '><small>Profit before depr.</small><b class="' + (D.net < 0 ? 'tx-neg' : 'num-yellow') + '">' + m0(D.net) + '</b><span>EST, split 3 ways</span></div></div>';
    var nd = '<div class="tx-nd-list">' +
      '<div class="tx-ndr tl-tap tl-chev"' + ta('nd:notes', 'Loan payments') + '><b>Truck + trailer note payments</b><small>' + m0(D.nd.notes) + ' paid. Only interest counts: <em>interest not on file</em></small></div>' +
      '<div class="tx-ndr tl-tap tl-chev"' + ta('nd:cap', 'Capital items') + '><b>Capitalized, not expensed</b><small>' + m0(D.nd.cap) + ' (trailer cash at purchase, title and sales tax). Goes into basis.</small></div>' +
      '<div class="tx-ndr tl-tap tl-chev"' + ta('nd:dep', 'Depreciation') + '><b>Depreciation (truck + trailer)</b><small>Basis EST ' + m0(D.basis) + '. 100% bonus or Sec. 179 possible. CPA decides.</small></div>' +
      (D.nd.unk ? '<div class="tx-ndr tl-tap tl-chev"' + ta('nd:unk', 'Unconfirmed') + '><b>Category unconfirmed</b><small>' + m0(D.nd.unk) + ' not counted until confirmed</small></div>' : '') +
      '<div class="tx-ndr tl-tap tl-chev"' + ta('nd:perdiem', 'Per diem') + '><b>Per diem (driver days away)</b><small>$80/day x 80% for HOS drivers. Days away: <em>not on file</em></small></div>' +
      '<div class="tx-ndr tl-tap tl-chev"' + ta('nd:drv', 'Driver pay') + '><b>Meshach driver pay</b><small>' + m0(D.drvPaid) + ' paid in ' + esc((st.pub && st.pub.year) || 2026) + '. Guaranteed payment or profit share: ask CPA</small></div></div>';
    return '<section class="dr-card" id="tx-ded" aria-label="Deductions"><div class="dr-h"><h3>' + esc(title) + '</h3><span>from the ledger, EST</span></div>' + tiles + dedBars(D) +
      '<div class="tx-sub">Not in the total</div>' + nd + '<p class="dr-fine">' + esc(N.meals || '') + '</p></section>';
  }
  function secEntity() {
    var E = (st.pub && st.pub.entity) || {};
    var kv = [['Entity', E.state], ['Taxed as', E.tax], ['EIN', E.ein], ['Members', E.members], ['Tax contact', E.contact], ['First year', E.first_year], ['Truck', E.in_service]];
    return '<section class="dr-card" aria-label="Entity"><div class="dr-h"><h3>The LLC for tax</h3><span>from our records</span></div><div class="tx-kv">' +
      kv.map(function (r) { return r[1] ? '<div><small>' + esc(r[0]) + '</small><b>' + esc(r[1]) + '</b></div>' : ''; }).join('') + '</div></section>';
  }
  function secDocs() {
    if (!pin()) return '';
    var Dc = (st.pub && st.pub.docs) || [], c = { have: 0, partial: 0, missing: 0, unknown: 0 };
    Dc.forEach(function (d) { c[d.s] = (c[d.s] || 0) + 1; });
    var bar = '<div class="tx-sbar" aria-hidden="true">' + ['have', 'partial', 'missing', 'unknown'].filter(function (k) { return c[k]; }).map(function (k) { return '<i style="flex:' + c[k] + ';background:' + { have: '#34D399', partial: '#F2C94C', missing: '#F87171', unknown: '#8F86B8' }[k] + '"></i>'; }).join('') + '</div>';
    return '<section class="dr-card" id="tx-docs" aria-label="Documents"><div class="dr-h"><h3>Documents for the CPA</h3><span><b class="num-yellow">' + c.have + '</b> of ' + Dc.length + ' in hand</span></div>' + bar +
      '<div class="tx-docs">' + Dc.map(function (d) { var p = DOC[d.s] || DOC.unknown; return '<div class="tx-doc">' + pill(p[1], p[0]) + '<div><b>' + esc(d.t) + '</b><small>' + esc(d.n) + '</small></div></div>'; }).join('') + '</div></section>';
  }
  function secQs() {
    if (!pin()) return '';
    var Q = (st.pub && st.pub.questions) || [];
    return '<section class="dr-card" id="tx-qs" aria-label="Questions for the CPA"><div class="dr-h"><h3>Open questions for the CPA</h3><span>' + Q.length + '</span></div><ol class="tx-qs">' +
      Q.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ol></section>';
  }
  function secSources() {
    var S = (st.pub && st.pub.sources) || {};
    return '<section class="dr-card" aria-label="Sources"><div class="dr-h"><h3>Sources</h3><span>official, checked ' + esc(md((st.pub && st.pub.as_of) || todayIso())) + '</span></div><ul class="dr-src">' +
      Object.keys(S).map(src).join('') + '</ul></section>';
  }
  function render() {
    var el = root(); if (!el) return;
    if (st.pubErr) { el.innerHTML = '<section class="dr-card"><p class="dr-p">' + esc(st.pubErr) + '</p></section>'; return; }
    if (!st.pub) { el.innerHTML = '<section class="dr-card"><p class="dr-p">Loading the tax calendar...</p></section>'; return; }
    var rs = rows(), q = queue().length;
    var sync = q ? '<div class="dr-sync"><span>' + q + ' waiting to sync' + (st.syncMsg ? '. ' + esc(st.syncMsg) : '') + '</span><button type="button" class="dr-mini" data-tx-sync="1">' + (st.flushing ? 'Sending...' : 'Sync now') + '</button></div>' : (st.syncMsg ? '<p class="dr-fine">' + esc(st.syncMsg) + '</p>' : '');
    el.innerHTML = (st.toast ? '<div class="dr-toast"><span>' + esc(st.toast) + '</span></div>' : '') +
      '<div class="dr-top"><div><div class="dr-kicker">Sand Lily Pad LLC</div><h2>Tax</h2></div></div>' +
      '<p class="tx-disc"><b>Estimates.</b> Confirm with the CPA. Not tax advice.</p>' + sync +
      secNext(rs) + secCal(rs) + secRules() + secDed() + secDocs() + secQs() + secEntity() + secSources();
  }

  /* ---------- sheets ---------- */
  function srcList(keys) { return (keys || []).length ? '<ul class="dr-src">' + keys.map(src).join('') + '</ul>' : ''; }
  function openItem(id, refresh) {
    var t = T(), it = itemById(id); if (!t || !it) return;
    if (refresh && !(t.isOpen && t.isOpen() && st.sheetId === id)) return;
    st.sheetId = id;
    var r = calc(it), ap = AP[it.applies] || AP.check;
    var btns = '<div class="tx-stbtns" role="group" aria-label="Set status">' + ST_ORDER.map(function (k) {
      return '<button type="button" class="tx-stb' + (r.s === k ? ' on' : '') + '" data-tx-set="' + esc(k) + '" data-tx-id="' + esc(id) + '" aria-pressed="' + (r.s === k) + '"><i style="background:' + ST_COL[k] + '"></i>' + esc(ST[k]) + '</button>';
    }).join('') + '</div>';
    var last = r.entry ? '<p class="tl-fine">Last change ' + esc(md(r.entry.date)) + (r.entry.pending ? ' (waiting to sync)' : '') + (r.text ? ': ' + esc(r.text) : '') + '</p>' : '<p class="tl-fine">Starting status from our records. Tap to change; it syncs to every phone with the PIN.</p>';
    var body = '<div class="tl-hero tl-' + (r.done ? 'ok' : (r.tone === 'bad' ? 'bad' : 'warn')) + '"><b>' + esc(r.done ? ST[r.s] : whenTxt(r.d)) + '</b><span>' + esc(dow(it.due) + ' ' + ymd(it.due)) + '</span></div>' +
      '<div class="tx-pills">' + pill(ap[1], 'Applies: ' + ap[0]) + pill('unk', it.form) + pill('unk', it.cat) + '</div>' +
      '<div class="tl-sec">Status</div>' + btns + last +
      '<div class="tl-sec">What it is</div><p class="dr-p">' + esc(it.what) + '</p>' +
      '<div class="tl-sec">Who files</div><p class="dr-p">' + esc(it.who) + '</p>' +
      '<div class="tl-sec">Why / does it apply</div><p class="dr-p">' + esc(it.why) + '</p>' +
      ((it.docs || []).length ? '<div class="tl-sec">Docs needed</div><ul class="tx-ul">' + it.docs.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="tl-sec">Source</div>' + srcList(it.src) + '<p class="tl-fine">' + esc((st.pub && st.pub.disclaimer) || '') + '</p>';
    t.open({ title: it.title, sub: esc(it.form + ' | due ' + md(it.due)), body: body });
  }
  function openRule(id) {
    var t = T(), r = ((st.pub && st.pub.rules) || []).filter(function (x) { return x.id === id; })[0]; if (!t || !r) return;
    var ap = AP[r.a] || AP.check;
    t.open({ title: r.t, sub: 'Does it apply: ' + ap[0], body: '<div class="tl-hero tl-' + (r.a === 'check' ? 'warn' : 'ok') + '"><b>' + ap[0] + '</b><span>' + esc(r.a === 'check' ? 'Check first' : (r.a === 'no' ? 'Not required for us' : (r.a === 'paid' ? 'Paid at purchase' : 'Required'))) + '</span></div>' +
      '<p class="dr-p">' + esc(r.why) + '</p><div class="tl-sec">Source</div>' + srcList(r.src) + '<p class="tl-fine">' + esc((st.pub && st.pub.disclaimer) || '') + '</p>' });
  }
  function openList(s) {
    var t = T(); if (!t) return;
    var list = rows().filter(function (x) { return x.r.s === s; });
    t.open({ title: ST[s] || 'Items', sub: list.length + ' item' + (list.length === 1 ? '' : 's'), body: listRows(list) });
  }
  function listRows(list) {
    if (!list.length) return '<p class="tl-fine">Nothing here.</p>';
    return '<div class="tl-rows">' + list.map(function (o) {
      return '<div class="tl-r tl-tap tl-chev"' + ta('it:' + o.it.id, o.it.title + '. Open') + '><span class="tl-d">' + esc(md(o.it.due)) + '</span><span class="tl-m"><b>' + esc(o.it.title) + '</b><small>' + esc(o.it.form) + '</small></span><span class="tl-v">' + esc(o.r.done ? ST[o.r.s] : whenTxt(o.r.d)) + '</span></div>';
    }).join('') + '</div>';
  }
  function lineRows(ls) {
    if (!ls || !ls.length) return '<p class="tl-fine">No lines on file.</p>';
    return '<div class="tl-rows">' + ls.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (l) {
      return '<div class="tl-r">' + (l.date ? '<span class="tl-d">' + esc(md(l.date)) + '</span>' : '') + '<span class="tl-m"><b>' + esc(l.t) + '</b>' + (l.est ? '<small>EST</small>' : '') + '</span><span class="tl-v num-yellow">' + m2(l.a) + '</span></div>';
    }).join('') + '</div>';
  }
  function openDed(arg) {
    var t = T(), D = deductions(), N = (st.pub && st.pub.deduction_notes) || {}; if (!t || !D) return;
    var k = arg.split(':')[1], kind = arg.split(':')[0];
    if (kind === 'ded') {
      var x = D.list.filter(function (y) { return y.k === k; })[0]; if (!x) return;
      var note = N[k] || (k === 'legal' ? N.legal : (k === 'equip' ? N.equipment : (k === 'travel' ? 'Business travel: deductible.' : N.overhead)));
      t.open({ title: x.label, sub: 'Deductible EST ' + esc(m0(x.ded)), body: '<div class="tl-hero"><b class="num-yellow">' + m2(x.ded) + '</b><span>deductible of ' + m2(x.cash) + ' spent</span></div><p class="dr-p">' + esc(note || '') + '</p>' + lineRows(x.lines) + '<p class="tl-fine">' + esc(st.pub.disclaimer) + '</p>' });
      return;
    }
    if (kind === 'nd') {
      var map = { notes: ['Note payments', N.notes, D.ndl.notes], cap: ['Capitalized items', N.title + ' Trailer cash at purchase is part of the trailer cost.', D.ndl.cap], unk: ['Category unconfirmed', 'Not counted until the category is confirmed.', D.ndl.unk],
        dep: ['Depreciation', N.dep + ' Basis EST ' + m0(D.basis) + ' (truck at amount financed plus trailer at cost; the CPA sets the real basis).', null], perdiem: ['Per diem', N.perdiem, null],
        drv: ['Meshach driver pay', 'Partners are not employees: no W-2 and no 1099. If it is a guaranteed payment it goes on his K-1 (box 4) and is deductible to the LLC; if it is a share of profit it is not. Paid so far in ' + st.pub.year + ': ' + m0(D.drvPaid) + '.', null] };
      var m = map[k]; if (!m) return;
      t.open({ title: m[0], sub: 'Not in the deductible total', body: '<p class="dr-p">' + esc(m[1] || '') + '</p>' + (m[2] ? lineRows(m[2]) : '') + '<p class="tl-fine">' + esc(st.pub.disclaimer) + '</p>' });
      return;
    }
    if (kind === 'sum') {
      var body = k === 'gross' ? '<p class="dr-p">Gross load revenue booked by pickup month (cash books). Totni\'s 1099 should match this total; check it in January.</p>'
        : (k === 'ded' ? lineRows(D.list.map(function (y) { return { date: '', t: y.label, a: y.ded }; }))
        : '<p class="dr-p">Gross minus deductible expenses, before depreciation, loan interest and per diem. Each partner gets 1/3 on his K-1 (the 2026 split depends on the Oct 15 admission - CPA question).</p>');
      var big = k === 'gross' ? D.gross : (k === 'ded' ? D.ded : D.net);
      t.open({ title: { gross: 'Gross revenue', ded: 'Deductible expenses', net: 'Profit before depreciation' }[k], sub: 'EST from the ledger', body: '<div class="tl-hero"><b class="num-yellow">' + m2(big) + '</b><span>' + esc(D.months.join(', ')) + '</span></div>' + body + '<p class="tl-fine">' + esc(st.pub.disclaimer) + '</p>' });
    }
  }
  function onTile(arg) {
    arg = String(arg || '');
    var k = arg.slice(0, arg.indexOf(':')), v = arg.slice(arg.indexOf(':') + 1);
    if (k === 'it') openItem(v); else if (k === 'rule') openRule(v); else if (k === 'st') openList(v); else openDed(arg);
  }

  /* ---------- styles ---------- */
  function css() {
    if (document.getElementById('tx-css')) return;
    var s = document.createElement('style'); s.id = 'tx-css';
    s.textContent =
      '#tx-root{display:flex;flex-direction:column;gap:var(--s-2)}' +
      '.tx-disc{margin:-4px 0 0;padding:8px 12px;border-radius:var(--radius-md);background:var(--c-maybe-bg);color:var(--c-maybe);font-size:var(--fs-sm);font-weight:700}.tx-disc b{color:var(--c-text-1)}' +
      '.tx-next{display:flex;gap:14px;align-items:center;background:var(--c-surface-2);border-radius:var(--radius-md);padding:12px 14px}.tx-next2{opacity:.92}' +
      '.tx-nd{display:flex;flex-direction:column;align-items:center;min-width:64px}.tx-nd b{font-size:34px;line-height:1;font-weight:900}.tx-nd small{font-size:11px;font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.06em}' +
      '.tx-nm{display:flex;flex-direction:column;gap:4px;min-width:0}.tx-nm b{font-size:var(--fs-md);color:var(--c-text-1);font-weight:800;line-height:1.25}.tx-nm small{font-size:12px;color:var(--c-text-3);font-weight:700}' +
      '.tx-pills{display:flex;flex-wrap:wrap;gap:6px}' +
      '.tx-timeline{width:100%;height:auto;display:block}.tx-axis{stroke:var(--c-line-strong);stroke-width:2}.tx-tick{stroke:var(--c-line-strong)}.tx-now{stroke:var(--num-yellow);stroke-width:2}.tx-tl{fill:var(--c-text-3);font-size:10px;font-weight:700}.tx-tl-now{fill:var(--num-yellow)}' +
      '.tx-sbar{display:flex;height:10px;border-radius:6px;overflow:hidden;gap:2px}.tx-sbar i{display:block;height:100%}' +
      '.tx-legs{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}.tx-leg{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 2px;border-radius:var(--radius-sm);background:var(--c-surface-2);cursor:pointer}.tx-leg b{font-size:var(--fs-lg);font-weight:900;line-height:1}.tx-leg small{font-size:10px;font-weight:700;color:var(--c-text-3);text-align:center;line-height:1.1}.tx-sw{width:10px;height:4px;border-radius:2px}' +
      '.tx-mon{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c-gold);margin-top:4px}' +
      '.tx-row{display:flex;align-items:center;gap:12px;background:var(--c-surface-2);border-radius:var(--radius-md);padding:10px 12px;cursor:pointer}' +
      '.tx-date{display:flex;flex-direction:column;align-items:center;min-width:44px;padding:4px 0;border-radius:10px;background:var(--c-surface-3)}.tx-date small{font-size:10px;font-weight:800;text-transform:uppercase;color:var(--c-text-3)}.tx-date b{font-size:20px;font-weight:900;color:var(--num-yellow);line-height:1.05}' +
      '.tx-date.tx-bad{box-shadow:inset 0 0 0 2px #F87171}.tx-date.tx-warn{box-shadow:inset 0 0 0 2px var(--c-maybe)}.tx-date.tx-ok{opacity:.7}' +
      '.tx-rm{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}.tx-rm b{font-size:var(--fs-sm);color:var(--c-text-1);font-weight:800;line-height:1.25}.tx-rm small{font-size:12px;color:var(--c-text-3);font-weight:700}' +
      '.tx-rp{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none}.tx-st{font-size:11px;font-weight:800}' +
      '.tx-rules{display:flex;flex-direction:column;gap:6px}.tx-rule{display:flex;align-items:center;gap:10px;background:var(--c-surface-2);border-radius:var(--radius-md);padding:10px 12px;cursor:pointer}.tx-rule .dr-pill{min-width:62px;text-align:center}.tx-rule b{flex:1;font-size:var(--fs-sm);color:var(--c-text-1);font-weight:800}' +
      '.tx-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.tx-tile{display:flex;flex-direction:column;gap:2px;background:var(--c-surface-2);border-radius:var(--radius-md);padding:10px;cursor:pointer;min-width:0}.tx-tile small{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--c-text-3)}.tx-tile b{font-size:var(--fs-lg);font-weight:900;line-height:1.1}.tx-tile span{font-size:11px;color:var(--c-text-3);font-weight:600}.tx-neg{color:#FCA5A5}' +
      '.tx-bars{display:flex;flex-direction:column;gap:8px}.tx-bar{display:grid;grid-template-columns:118px 1fr 68px;align-items:center;gap:8px;cursor:pointer;min-height:28px}.tx-bl{font-size:12px;font-weight:700;color:var(--c-text-2);line-height:1.15}' +
      '.tx-bt{position:relative;height:14px;border-radius:7px;background:var(--c-surface-3);overflow:hidden}.tx-bt i{position:absolute;left:0;top:0;bottom:0;border-radius:7px}.tx-bc{background:rgba(242,201,76,.25)}.tx-bd{background:var(--num-yellow)}.tx-bv{text-align:right;font-size:var(--fs-sm);font-weight:900}' +
      '.tx-key{display:flex;gap:14px;font-size:11px;font-weight:700;color:var(--c-text-3)}.tx-key i{display:inline-block;width:12px;height:8px;border-radius:3px;margin-right:5px;vertical-align:middle}' +
      '.tx-sub{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c-text-3);margin-top:6px}' +
      '.tx-nd-list{display:flex;flex-direction:column;gap:6px}.tx-ndr{display:flex;flex-direction:column;gap:3px;background:var(--c-surface-2);border-radius:var(--radius-md);padding:10px 12px;cursor:pointer}.tx-ndr b{font-size:var(--fs-sm);color:var(--c-text-1);font-weight:800}.tx-ndr small{font-size:12px;color:var(--c-text-3);font-weight:600;line-height:1.35}.tx-ndr em{color:var(--c-maybe);font-style:normal;font-weight:800}' +
      '.tx-kv{display:grid;grid-template-columns:1fr;gap:8px}.tx-kv div{display:flex;flex-direction:column;gap:2px}.tx-kv small{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--c-text-3)}.tx-kv b{font-size:var(--fs-sm);color:var(--c-text-1);font-weight:700;line-height:1.35}' +
      '.tx-docs{display:flex;flex-direction:column;gap:8px}.tx-doc{display:flex;gap:10px;align-items:flex-start}.tx-doc .dr-pill{min-width:70px;text-align:center;margin-top:2px}.tx-doc div{display:flex;flex-direction:column;gap:2px;min-width:0}.tx-doc b{font-size:var(--fs-sm);color:var(--c-text-1);font-weight:800;line-height:1.3}.tx-doc small{font-size:12px;color:var(--c-text-3);font-weight:600;line-height:1.35}' +
      '.tx-qs{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px}.tx-qs li{font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.45}' +
      '.tx-ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px}.tx-ul li{font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.4}' +
      '.tx-stbtns{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.tx-stb{display:flex;align-items:center;justify-content:center;gap:6px;min-height:var(--tap);border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-3);color:var(--c-text-1);font:inherit;font-size:12px;font-weight:800;cursor:pointer}.tx-stb i{width:9px;height:9px;border-radius:50%}.tx-stb.on{border-color:var(--num-yellow);box-shadow:inset 0 0 0 1px var(--num-yellow);background:rgba(242,201,76,.12)}';
    document.head.appendChild(s);
  }

  /* ---------- wiring ---------- */
  function bind() {
    var el = root(); if (!el || el.getAttribute('data-tx-bound')) return;
    el.setAttribute('data-tx-bound', '1');
    el.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.closest) return;
      if (t.closest('[data-tx-done]')) { st.showDone = !st.showDone; render(); return; }
      if (t.closest('[data-tx-sync]')) { if (!pin()) { st.syncMsg = 'Enter the PIN first.'; render(); return; } flush(); fetchSrv(); }
    });
    el.addEventListener('submit', function (e) {
      var f = e.target; if (!f || !f.getAttribute || !f.getAttribute('data-tx-pin')) return;
      e.preventDefault(); var i = f.querySelector('input'), v = i ? i.value.trim() : '';
      if (v) { setPin(v); st.finErr = ''; st.fin = null; st.srv = null; fetchFin(); fetchSrv(); render(); }
    });
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-tx-set]') : null; if (!b) return;
      e.preventDefault(); var id = b.getAttribute('data-tx-id'), s = b.getAttribute('data-tx-set');
      var it = itemById(id); if (!it || calc(it).s === s) return;
      setStatus(id, s, ''); openItem(id);
    });
  }
  function onShow() { loadPublic(); render(); if (pin()) { fetchSrv(); fetchFin(); } flush(); }
  function init() {
    css(); bind();
    var t = T(); if (t) t.on('tx', onTile);
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'tax') onShow(); else st.sheetId = ''; });
    document.addEventListener('blackram:financials', function () { var c = finFromSession(); if (c) { st.fin = c; st.finErr = ''; if (document.documentElement.getAttribute('data-tab') === 'tax') render(); } });
    window.addEventListener('online', flush);
    if (document.documentElement.getAttribute('data-tab') === 'tax') onShow();
  }
  window.BlackRamTax = {
    ready: function () { return !!st.pub; }, load: loadPublic, render: render, openItem: function (id) { openItem(id); },
    next: function (n) { return upcoming().slice(0, n || 2).map(function (o) { return { id: o.it.id, t: o.it.title, form: o.it.form, due: o.it.due, days: o.r.d, s: o.r.s, tone: o.r.tone, applies: o.it.applies }; }); },
    list: function () { return rows().map(function (o) { return { id: o.it.id, t: o.it.title, form: o.it.form, due: o.it.due, s: o.r.s, cat: o.it.cat }; }); },
    rules: function () { return ((st.pub && st.pub.rules) || []).map(function (r) { return { id: r.id, t: r.t, a: r.a }; }); },
    openRule: openRule
  };
  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { tax: window.BlackRamTax });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
