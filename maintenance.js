/* Black Ram Logistics - Maintenance tab (v80+, check-offs and SOPs v84).
   Public part: data/maintenance.json (no dollars): units, current odometer + as-of date, due-next schedule, service log
   (date, unit, job, odometer, vendor), checklists, warranty basics, open items. The schedule intervals come from the 2026 Ram
   owner's manual (diesel plan), the company rules, Dexter axle guidance and 49 CFR 396.17 (see the sources note on the tab).
   PIN-gated part: costs, who paid, spend totals. They come from the relay /financials payload key "maintenance"
   (built on the box by maintenance_build.py, pushed with push_financials.py). Nothing financial is in this repo.
   Update the odometer: edit maintenance.json on the box, or tap Update odometer (saved on that phone only).
   v84: tap any item for a sheet: Mark done (date, miles, cost, shop, note; resets the next-due, undoable) and an SOP (how-to).
   Check-offs are saved through the relay POST /maintenance (PIN-checked, KV key maint_log) and come back on every device in the
   /financials payload as maintenance_applog. If the relay cannot be reached they are queued on the phone (localStorage) and sent
   later. Costs and shop names in check-offs only travel through the PIN-checked relay (never in this repo).
   Uses v51 tokens; extends window.BlackRamApp (never overwrites it). Plain ASCII text. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var FIN_KEY = 'blackram_fin_session_v1';
  var ODO_KEY = 'blackram_maint_odo_v1';
  var CHK_KEY = 'blackram_maint_chk_v2';
  var QUEUE_KEY = 'blackram_maint_queue_v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var st = { pub: null, pubErr: '', priv: null, applog: null, error: '', loading: false, fetchedAt: 0, unit: 'all', status: '', logf: 'all', odoOpen: false, sheet: null, toast: '', toastUndo: '', flushing: false, syncMsg: '' };

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
    try { var c = sessionStorage.getItem(FIN_KEY); if (!c) return null; var j = JSON.parse(c); if (j && j.maintenance_applog && !st.applog) st.applog = j.maintenance_applog; return j && j.maintenance ? j.maintenance : null; } catch (e) { return null; }
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
            st.applog = j.data.maintenance_applog || (st.priv && st.priv.applog) || st.applog || null;
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
      .then(function () { st.loading = false; render(); flush(); });
  }

  /* ---------- check-offs: local queue + relay sync ---------- */
  var PII_RE = /[\w.+-]+@[\w-]+\.[\w.]+|\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/;
  var flushTimer = 0, toastTimer = 0;
  function newId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function queue() { var q = jget(QUEUE_KEY, []); return Array.isArray(q) ? q : []; }
  function setQueue(q) { jset(QUEUE_KEY, q); }
  function opKey(o) { return o.op + ':' + (o.entry ? o.entry.id : o.id); }
  function srvEntries() { return (st.applog && Array.isArray(st.applog.entries)) ? st.applog.entries.filter(function (e) { return String(e.item_id || '').indexOf('dot-') !== 0; }) : []; }  /* dot- entries belong to the DOT Ready tab (dotready.js) */
  function onServer(id) { return srvEntries().some(function (e) { return e.id === id; }); }
  function effEntries() {
    var map = {}, order = [];
    srvEntries().forEach(function (e) { map[e.id] = Object.assign({}, e); order.push(e.id); });
    queue().forEach(function (op) {
      if (op.op === 'add' && op.entry && op.entry.id) {
        if (!map[op.entry.id]) { map[op.entry.id] = Object.assign({}, op.entry, { pending: true }); order.push(op.entry.id); }
      } else if (op.op === 'undo' && map[op.id]) { map[op.id].undone = true; map[op.id].pending = true; }
      else if (op.op === 'redo' && map[op.id]) { delete map[op.id].undone; map[op.id].pending = true; }
    });
    return order.map(function (id) { return map[id]; });
  }
  function activeEntries() { return effEntries().filter(function (e) { return !e.undone; }); }
  function cmpEntry(a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : ((a.at || '') < (b.at || '') ? -1 : ((a.at || '') > (b.at || '') ? 1 : 0))); }
  function latestFor(itemId) {
    var l = activeEntries().filter(function (e) { return e.item_id === itemId; }).sort(cmpEntry);
    return l.length ? l[l.length - 1] : null;
  }
  function itemName(id) {
    var s = st.pub && st.pub.schedule ? st.pub.schedule.filter(function (x) { return x.id === id; })[0] : null;
    return s ? s.item : id;
  }
  function baseItem(it) {
    if (!it.base) return it;
    var c = Object.assign({}, it), b = it.base;
    c.last_date = b.last_date;
    if (b.last_odo != null) c.last_odo = b.last_odo; else delete c.last_odo;
    if (b.baseline) c.baseline = true; else delete c.baseline;
    if (b.need_record) c.need_record = true; else delete c.need_record;
    delete c.checked_off;
    return c;
  }
  function withEntry(it) {
    var c = baseItem(it), e = latestFor(it.id);
    if (e) {
      if (c === it) c = Object.assign({}, it);
      c.last_date = e.date; if (e.odo != null) c.last_odo = e.odo;
      delete c.baseline; delete c.need_record; c.checked_off = e;
    }
    return c;
  }
  function saveCachedApplog() {
    try { var c = sessionStorage.getItem(FIN_KEY); if (!c) return; var j = JSON.parse(c); j.maintenance_applog = st.applog; sessionStorage.setItem(FIN_KEY, JSON.stringify(j)); } catch (e) { /* ignore */ }
  }
  function setToast(text, undoId) {
    st.toast = text; st.toastUndo = undoId || '';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { st.toast = ''; st.toastUndo = ''; render(); }, 12000);
  }
  function flush() {
    if (st.flushing) return;
    var q = queue(); if (!q.length) { st.syncMsg = ''; return; }
    var p = pin(); if (!p) return;
    var body, sent = [], op = q[0];
    if (op.op === 'add') {
      for (var i = 0; i < q.length && q[i].op === 'add' && sent.length < 20; i++) sent.push(q[i]);
      body = { pin: p, op: 'add', entries: sent.map(function (x) { return x.entry; }) };
    } else { sent = [op]; body = { pin: p, op: op.op, id: op.id }; }
    st.flushing = true;
    var retry = false, more = false;
    fetch(RELAY + '/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
      .then(function (resp) { return resp.json().catch(function () { return null; }).then(function (j) { return { resp: resp, j: j }; }); })
      .then(function (r) {
        var drop = false;
        if (r.resp.ok && r.j && r.j.ok) { st.applog = r.j.data; saveCachedApplog(); st.syncMsg = ''; drop = true; if (st.error === 'wrongpin') st.error = ''; }
        else if (r.resp.status === 401) { st.syncMsg = 'Wrong PIN. Your check-offs are saved on this phone and will send once the PIN is right.'; }
        else if (r.resp.status === 400 || r.resp.status === 404) { drop = true; st.syncMsg = 'The server rejected one entry: ' + ((r.j && r.j.error) || r.resp.status) + '.'; setToast(st.syncMsg); }
        else { st.syncMsg = 'Could not reach the server. Saved on this phone, will retry.'; retry = true; }
        if (drop) {
          var keys = sent.map(opKey);
          setQueue(queue().filter(function (x) { return keys.indexOf(opKey(x)) < 0; }));
          more = queue().length > 0;
        }
      })
      .catch(function () { st.syncMsg = 'Offline. Saved on this phone, will retry.'; retry = true; })
      .then(function () {
        st.flushing = false; render(); refreshSheet();
        if (more) flush();
        else if (retry) { if (flushTimer) clearTimeout(flushTimer); flushTimer = setTimeout(flush, 30000); }
      });
  }
  function addEntry(entry) {
    var q = queue(); q.push({ op: 'add', entry: entry }); setQueue(q);
  }
  function undoEntry(id) {
    var q = queue(), idx = -1;
    q.forEach(function (o, i) { if (o.op === 'add' && o.entry && o.entry.id === id) idx = i; });
    if (idx >= 0 && !onServer(id)) { q.splice(idx, 1); setQueue(q); }
    else { q = q.filter(function (o) { return !(o.id === id && (o.op === 'undo' || o.op === 'redo')); }); q.push({ op: 'undo', id: id }); setQueue(q); }
    setToast('Undone. The item is back to its earlier due date.');
    render(); refreshSheet(); flush();
  }
  function redoEntry(id) {
    var q = queue().filter(function (o) { return !(o.id === id && (o.op === 'undo' || o.op === 'redo')); });
    q.push({ op: 'redo', id: id }); setQueue(q);
    render(); refreshSheet(); flush();
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
    var best = null;
    activeEntries().forEach(function (e) {
      if (e.unit === 'truck' && e.odo != null && e.odo > 0 && !e.odo_est && e.date >= o.as_of && (e.date > o.as_of || e.odo >= o.reading)) {
        if (!best || e.date > best.date || (e.date === best.date && e.odo > best.odo)) best = e;
      }
    });
    if (best) { o.reading = best.odo; o.as_of = best.date; o.source = 'Check-off: ' + itemName(best.item_id); o.since = 0; o.est = false; o.local = false; o.fromEntry = true; }
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
    var rows = P.schedule.map(function (it) { return calc(withEntry(it), P, O); });
    rows.sort(function (a, b) {
      var A = a.status === 'need' ? 9 : -a.frac, B = b.status === 'need' ? 9 : -b.frac;
      return A - B;
    });
    return rows;
  }
  var ST_LABEL = { ok: 'OK', soon: 'Due soon', over: 'Overdue', need: 'Need record' };

  /* ---------- tile sheet: Mark done + SOP ---------- */
  var BASIS = { manual: 'From the manual', mixed: 'Manual specs plus general shop practice', general: 'General guidance, not from a manual' };
  var TAG = { m: ['Ram manual', 'm'], d: ['Dexter', 'd'], b: ['Big Tex', 'b'], c: ['Company rule', 'c'], g: ['General guidance', 'g'] };
  function sheetHost() {
    var h = document.getElementById('mt-sheet');
    if (!h) {
      h = document.createElement('div'); h.id = 'mt-sheet'; h.className = 'mt-sheet'; h.hidden = true;
      document.body.appendChild(h);
      h.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.hasAttribute && t.hasAttribute('data-mt-close')) { closeSheet(); return; }
        var b = t && t.closest ? t.closest('[data-mt-tab],[data-mt-undo],[data-mt-redo]') : null;
        if (!b || !st.sheet) return;
        if (b.hasAttribute('data-mt-tab')) { st.sheet.tab = b.getAttribute('data-mt-tab'); st.sheet.err = ''; renderSheet(); var sc = h.querySelector('.mt-sh-body'); if (sc) sc.scrollTop = 0; }
        else if (b.hasAttribute('data-mt-undo')) undoEntry(b.getAttribute('data-mt-undo'));
        else if (b.hasAttribute('data-mt-redo')) redoEntry(b.getAttribute('data-mt-redo'));
      });
      h.addEventListener('input', function (e) {
        var t = e.target, f = st.sheet && st.sheet.f; if (!f || !t.id) return;
        var k = { 'mt-f-date': 'date', 'mt-f-odo': 'odo', 'mt-f-cost': 'cost', 'mt-f-vendor': 'vendor', 'mt-f-note': 'note' }[t.id];
        if (k) { f[k] = t.value; f.odoTouched = f.odoTouched || k === 'odo'; updatePreview(); }
      });
      h.addEventListener('submit', function (e) { e.preventDefault(); if (e.target && e.target.id === 'mt-done-form') saveDone(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.sheet) closeSheet(); });
    }
    return h;
  }
  function rowFor(id) {
    var P = st.pub; if (!P) return null;
    var it = P.schedule.filter(function (x) { return x.id === id; })[0]; if (!it) return null;
    return calc(withEntry(it), P, odo());
  }
  function openSheet(id, tab) {
    var P = st.pub, O = odo(); if (!P || !O) return;
    var it = P.schedule.filter(function (x) { return x.id === id; })[0]; if (!it) return;
    var isT = it.unit === 'trailer';
    st.sheet = { id: id, tab: tab || 'done', err: '', f: { date: todayIso(), odo: String(Math.round(isT ? O.trailer : O.cur)), cost: '', vendor: '', note: '', odoTouched: false, est: Math.round(isT ? O.trailer : O.cur) } };
    renderSheet();
    var h = sheetHost(), c = h.querySelector('.mt-sh-x'); if (c) c.focus();
  }
  function closeSheet() { st.sheet = null; renderSheet(); }
  function refreshSheet() {
    if (!st.sheet) return;
    var a = document.activeElement, h = sheetHost();
    if (a && h.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
    renderSheet();
  }
  function infoHtml(r) {
    var it = r.it, P = st.pub;
    var eta = (r.etaDays != null && r.status !== 'over' && it.unit === 'truck') ? ' At the recent pace (EST) that is about ' + etaDate(r.etaDays) + '.' : '';
    var basis = r.status === 'need' ? '' : (it.baseline ? 'No service on record: counted from delivery (' + md(r.lastDate) + ').' : 'Last done ' + ymd(r.lastDate) + (it.last_odo != null ? ' at ' + n0(it.last_odo) + (it.unit === 'trailer' ? ' trailer mi' : ' mi') : '') + '.');
    return (basis ? '<p>' + esc(basis + eta) + '</p>' : '');
  }
  function infoFoot(r) {
    var it = r.it, srcs = (it.src || []).map(function (k) { return (st.pub.sources || {})[k]; }).filter(Boolean);
    if (!it.note && !srcs.length) return '';
    return '<div class="mt-sh-foot"><div class="mt-sub">About this interval</div>' + (it.note ? '<p>' + esc(it.note) + '</p>' : '') +
      (srcs.length ? '<p class="mt-src">Source: ' + srcs.map(esc).join(' | ') + '</p>' : '') + '</div>';
  }
  function histRow(e, withItem) {
    var priv = !!st.priv || !!e.pending;
    return '<div class="mt-hrow' + (e.undone ? ' mt-undone' : '') + '"><div class="mt-hrow-m"><b>' + ymd(e.date) + (withItem ? ' | ' + esc(itemName(e.item_id)) : '') + '</b>' +
      '<span>' + (e.odo != null ? n0(e.odo) + (e.unit === 'trailer' ? ' trailer mi' : ' mi') + (e.odo_est ? ' (EST)' : '') : 'no miles') +
      (priv && e.cost != null ? ' | ' + m2(e.cost) : '') + (e.vendor ? ' | ' + esc(e.vendor) : '') + '</span>' +
      (e.note ? '<span class="mt-hnote">' + esc(e.note) + '</span>' : '') +
      (e.pending ? '<span class="mt-chip mt-chip-unk">Waiting to sync</span>' : '') + (e.undone ? '<span class="mt-chip mt-chip-unk">Undone</span>' : '') + '</div>' +
      (e.undone ? '<button type="button" class="mt-mini" data-mt-redo="' + esc(e.id) + '">Restore</button>' : '<button type="button" class="mt-mini" data-mt-undo="' + esc(e.id) + '">Undo</button>') + '</div>';
  }
  function doneTab(r) {
    var it = r.it, f = st.sheet.f, isT = it.unit === 'trailer';
    var mine = effEntries().filter(function (e) { return e.item_id === it.id; }).sort(cmpEntry).reverse();
    var hint = f.odoTouched ? 'Entered by you.' : 'Prefilled with the current ' + (isT ? 'trailer-mile' : 'odometer') + ' estimate. Change it if you read the real number.';
    return '<form id="mt-done-form" class="mt-form" autocomplete="off" novalidate>' +
      '<label>Date done<input id="mt-f-date" type="date" max="' + todayIso() + '" value="' + esc(f.date) + '" /></label>' +
      '<label>' + (isT ? 'Trailer miles' : 'Odometer (mi)') + (it.int_mi ? '' : ' (optional)') + '<input id="mt-f-odo" type="number" inputmode="numeric" min="0" step="1" value="' + esc(f.odo) + '" /><small>' + esc(hint) + '</small></label>' +
      '<label>Cost ($, optional)<input id="mt-f-cost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" value="' + esc(f.cost) + '" /><small>Costs are only sent through the PIN-checked relay.</small></label>' +
      '<label>Shop or who did it<input id="mt-f-vendor" type="text" maxlength="80" placeholder="Self, shop name" value="' + esc(f.vendor) + '" /></label>' +
      '<label>Note<textarea id="mt-f-note" rows="2" maxlength="300" placeholder="Parts used, what you saw">' + esc(f.note) + '</textarea></label>' +
      '<p class="mt-preview" id="mt-preview"></p>' +
      (st.sheet.err ? '<p class="mt-err" role="alert">' + esc(st.sheet.err) + '</p>' : '') +
      '<button type="submit" class="btn primary mt-save">Mark done</button>' +
      (pin() ? '' : '<p class="mt-fine">No PIN on this phone: it will be saved here and sent once you unlock the costs section.</p>') + '</form>' +
      '<div class="mt-sub">History for this item</div>' +
      (mine.length ? '<div class="mt-hist">' + mine.map(function (e) { return histRow(e, false); }).join('') + '</div>' : '<p class="mt-fine">No check-offs yet.</p>');
  }
  function sopTab(r) {
    var it = r.it, S = (st.pub.sop || {})[it.id];
    if (!S) return '<p class="mt-fine">No SOP written for this item yet.</p>';
    function list(a, cls) { return '<ul class="mt-list ' + (cls || '') + '">' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }
    var specs = (S.specs || []).map(function (s) {
      var t = TAG[s[2]] || TAG.g;
      return '<div class="mt-spec"><div><span>' + esc(s[0]) + '</span><b>' + esc(s[1]) + '</b></div><i class="mt-tag mt-tag-' + t[1] + '">' + esc(t[0]) + '</i></div>';
    }).join('');
    return '<div class="mt-sop"><p class="mt-sop-about">' + esc(S.about || '') + '</p>' +
      '<p class="mt-fine">' + esc(BASIS[S.basis] || BASIS.mixed) + '. Anything tagged General guidance is shop practice, not a manual spec.</p>' +
      (specs ? '<div class="mt-sub">Specs and intervals</div><div class="mt-specs">' + specs + '</div>' : '') +
      '<div class="mt-sub">Tools</div>' + list(S.tools || []) +
      '<div class="mt-sub">Parts and fluids</div>' + list(S.parts || []) +
      '<div class="mt-sub">Steps</div><ol class="mt-steps">' + (S.steps || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' +
      ((S.safety || []).length ? '<div class="mt-warnbox"><b>Safety</b>' + list(S.safety) + '</div>' : '') +
      (S.note ? '<p class="mt-fine">' + esc(S.note) + '</p>' : '') +
      ((S.cite || []).length ? '<div class="mt-sub">Manual and page</div><ul class="mt-list mt-cite">' + S.cite.map(function (x) { return '<li>' + citeLinks(esc(x)) + '</li>'; }).join('') + '</ul>' : '') +
      '<button type="button" class="btn primary mt-save" data-mt-tab="done">Done with the job: mark it done</button></div>';
  }
  function renderSheet() {
    var h = sheetHost();
    if (!st.sheet || !st.pub) {
      h.hidden = true; h.innerHTML = ''; document.documentElement.classList.remove('mt-noscroll'); return;
    }
    var r = rowFor(st.sheet.id); if (!r) { st.sheet = null; renderSheet(); return; }
    var it = r.it, tone = r.status === 'over' ? 'bad' : (r.status === 'soon' ? 'warn' : (r.status === 'need' ? 'need' : 'ok'));
    var intv = intervalText(it), tab = st.sheet.tab;
    var scroll = h.querySelector('.mt-sh-body'), keep = scroll ? scroll.scrollTop : 0;
    h.hidden = false; document.documentElement.classList.add('mt-noscroll');
    h.innerHTML = '<div class="mt-sh-bd" data-mt-close="1"></div><div class="mt-sh-p" role="dialog" aria-modal="true" aria-label="' + esc(it.item) + '">' +
      '<div class="mt-sh-grab" aria-hidden="true"></div>' +
      '<div class="mt-sh-h"><div><b>' + esc(it.item) + '</b><span>' + (it.unit === 'trailer' ? 'Trailer' : 'Truck') + ' | every ' + esc(intv) + '</span></div>' +
      '<button type="button" class="mt-sh-x" data-mt-close="1" aria-label="Close">Close</button></div>' +
      '<div class="mt-sh-body"><div class="mt-sh-info">' + pill(tone, ST_LABEL[r.status]) + dueLine(r) + infoHtml(r) + '</div>' +
      '<div class="mt-segs mt-tabs" role="tablist"><button type="button" role="tab" class="mt-seg' + (tab === 'done' ? ' on' : '') + '" data-mt-tab="done" aria-selected="' + (tab === 'done') + '">Mark done</button>' +
      '<button type="button" role="tab" class="mt-seg' + (tab === 'sop' ? ' on' : '') + '" data-mt-tab="sop" aria-selected="' + (tab === 'sop') + '">SOP: how to</button></div>' +
      (tab === 'sop' ? sopTab(r) : doneTab(r)) + infoFoot(r) + '</div></div>';
    var nb = h.querySelector('.mt-sh-body'); if (nb) nb.scrollTop = keep;
    updatePreview();
  }
  function intervalText(it) {
    return (it.int_mi ? n0(it.int_mi) + ' mi' : '') + (it.int_mi && it.int_mo ? ' or ' : '') + (it.int_mo ? (it.int_mo % 12 === 0 && it.int_mo >= 12 ? (it.int_mo / 12) + ' yr' : it.int_mo + ' mo') : '');
  }
  function dueLine(r) {
    if (r.status === 'need') return '<p class="mt-next"><b>No record on file.</b> Mark it done to start the clock.</p>';
    var a = [];
    if (r.remMi != null) a.push((r.remMi > 0 ? n0(r.remMi) + ' mi left' : n0(-r.remMi) + ' mi over') + ' (due at ' + n0(r.dueOdo) + ')');
    if (r.remD != null) a.push(r.remD > 0 ? 'by ' + ymd(r.dueDate) + ' (' + r.remD + ' d)' : 'date passed ' + ymd(r.dueDate));
    return '<p class="mt-next"><b>' + esc(a.join(' or ')) + '</b></p>';
  }
  function updatePreview() {
    var el = document.getElementById('mt-preview'); if (!el || !st.sheet) return;
    var it = (st.pub.schedule || []).filter(function (x) { return x.id === st.sheet.id; })[0], f = st.sheet.f, bits = [];
    var o = Number(f.odo);
    if (it.int_mi && f.odo !== '' && o >= 0) bits.push('at ' + n0(o + it.int_mi) + (it.unit === 'trailer' ? ' trailer mi' : ' mi'));
    if (it.int_mo && /^\d{4}-\d{2}-\d{2}$/.test(f.date)) bits.push('by ' + ymd(addMonths(f.date, it.int_mo)));
    el.textContent = bits.length ? 'Saving resets the next due to ' + bits.join(' or ') + '.' : '';
  }
  function saveDone() {
    var s = st.sheet; if (!s) return;
    var P = st.pub, it = P.schedule.filter(function (x) { return x.id === s.id; })[0], f = s.f;
    function fail(m) { s.err = m; renderSheet(); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') || isNaN(utc(f.date))) return fail('Pick the date it was done.');
    if (f.date > todayIso()) return fail('That date is in the future.');
    var odoV = null;
    if (String(f.odo).trim() !== '') { odoV = Number(f.odo); if (!isFinite(odoV) || odoV < 0 || odoV > 2000000) return fail('Check the miles number.'); odoV = Math.round(odoV); }
    else if (it.int_mi) return fail('Enter the miles so the next due is right.');
    var costV = null;
    if (String(f.cost).trim() !== '') { costV = Number(f.cost); if (!isFinite(costV) || costV < 0 || costV > 100000) return fail('Check the cost.'); costV = Math.round(costV * 100) / 100; }
    var vendor = String(f.vendor || '').trim().slice(0, 80), note = String(f.note || '').trim().slice(0, 300);
    if (PII_RE.test(vendor) || PII_RE.test(note)) return fail('Leave phone numbers and emails out of the log.');
    var entry = { id: newId(), item_id: it.id, unit: it.unit === 'trailer' ? 'trailer' : 'truck', date: f.date, odo: odoV, odo_est: odoV != null && odoV === f.est, cost: costV, vendor: vendor, note: note, at: new Date().toISOString() };
    addEntry(entry);
    setToast('Checked off: ' + it.item + '. ' + (pin() ? 'Saving to every device...' : 'Saved on this phone. Unlock with the PIN to sync.'), entry.id);
    closeSheet(); render(); flush();
    var d = document.getElementById('mt-due'); if (d && d.scrollIntoView) { /* stay put */ }
  }

  /* ---------- pieces ---------- */
  function card(id, title, sub, body) {
    return '<section class="mt-card" id="' + id + '"><div class="mt-h"><h3>' + title + '</h3>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>' + body + '</section>';
  }
  function pill(cls, t) { return '<span class="mt-pill mt-pill-' + cls + '">' + esc(t) + '</span>'; }
  function tile(label, big, sub, tone, key) {
    var inner = '<span>' + esc(label) + '</span><b>' + esc(big) + '</b><small>' + esc(sub) + '</small>';
    if (key) return '<button type="button" class="mt-tile mt-tile-btn mt-t-' + (tone || 'ok') + (st.status === key ? ' on' : '') + '" data-mt-status="' + key + '" aria-pressed="' + (st.status === key ? 'true' : 'false') + '">' + inner + '</button>';
    return '<div class="mt-tile mt-t-' + (tone || 'ok') + '">' + inner + '</div>';
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
      : (O.fromEntry ? 'Read on ' + ymd(O.as_of) + ' at a check-off.' : 'Read on ' + ymd(O.as_of) + ', entered on this phone.')) + '</span></div>' +
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
      tile('Overdue', String(c.over), c.over ? 'Past the interval. Tap to list' : 'Nothing past due', c.over ? 'bad' : 'ok', 'over') +
      tile('Due soon', String(c.soon), 'Within the warning window. Tap', c.soon ? 'warn' : 'ok', 'soon') +
      tile('Need record', String(c.need), 'Annual DOT inspections. Tap', c.need ? 'warn' : 'ok', 'need') +
      '</div>' + (nxt ? '<p class="mt-next tl-tap tl-chev"' + (window.BlackRamTiles ? window.BlackRamTiles.attrs('mt', 'item:' + nxt.it.id, 'Most urgent: ' + nxt.it.item + '. Open it') : '') + '>Most urgent: <b>' + esc(nxt.it.item) + '</b>' + (/\((truck|trailer)\)/.test(nxt.it.item) ? '' : ' (' + (nxt.it.unit === 'trailer' ? 'trailer' : 'truck') + ')') + ', ' + esc(nSub) + '</p>' : '');
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
    var intv = intervalText(it), ck = it.checked_off;
    var done = ck ? '<span class="mt-done-tag">Done ' + md(ck.date) + (ck.pending ? ' (syncing)' : '') + '</span>' : '';
    return '<button type="button" class="mt-due mt-due-' + tone + '" data-mt-item="' + esc(it.id) + '" aria-label="' + esc(it.item + ': open mark done and SOP') + '">' +
      '<div class="mt-due-top"><b>' + esc(it.item) + '</b>' + pill(tone, ST_LABEL[r.status]) + '</div>' +
      '<div class="mt-due-tag">' + (it.unit === 'trailer' ? 'Trailer' : 'Truck') + ' | every ' + esc(intv) + (r.status !== 'need' && it.baseline ? ' | no record' : '') + '</div>' +
      '<div class="mt-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="mt-due-l"><span>' + esc(l1) + '</span><span>' + esc(l2) + '</span></div>' +
      '<div class="mt-due-act">' + done + '<span>Tap: mark done or SOP</span></div></button>';
  }
  function etaDate(days) { var d = new Date(); d.setDate(d.getDate() + days); return MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }

  function secDue(rows) {
    var seg = ['all', 'truck', 'trailer'].map(function (k) {
      var n = rows.filter(function (r) { return k === 'all' || r.it.unit === k; }).length;
      return '<button type="button" class="mt-seg' + (st.unit === k ? ' on' : '') + '" data-mt-unit="' + k + '" aria-pressed="' + (st.unit === k ? 'true' : 'false') + '">' + (k === 'all' ? 'All' : (k === 'truck' ? 'Truck' : 'Trailer')) + ' ' + n + '</button>';
    }).join('');
    var list = rows.filter(function (r) { return (st.unit === 'all' || r.it.unit === st.unit) && (!st.status || r.status === st.status); });
    var sf = st.status ? '<p class="mt-filt">Showing ' + esc(ST_LABEL[st.status]) + ' only (' + list.length + ') <button type="button" class="mt-mini" data-mt-status="">Show all</button></p>' : '';
    return card('mt-due', 'Due next', 'Miles or date, whichever comes first',
      '<div class="mt-segs">' + seg + '</div>' + sf + '<div class="mt-dues">' + (list.length ? list.map(rowHtml).join('') : '<p class="mt-fine">Nothing here.</p>') + '</div>' +
      '<p class="mt-fine">Bar = share of the interval used. Tap any item to mark it done (resets the next due) or open its SOP. Truck miles use the odometer estimate above. Trailer miles are estimated from loads. Items marked no record have never been logged, so they count from delivery.</p>');
  }

  /* v91: manual page cites open the PDF at that page. Printed page + offset = PDF page (checked against the PDFs). */
  var CITE_DOC = [[/^Ram OM$/, /Ram .*Owner/i, 2], [/^Big Tex OM$/, /Big Tex .*Owner/i, 1], [/^Dexter/, /Dexter/i, 1]];
  function citeLinks(html) {
    var docs = (st.pub && st.pub.manuals && st.pub.manuals.docs) || [];
    return String(html).replace(/(Ram OM|Big Tex OM|Dexter(?: 9-15K)?) p\. ?(\d{1,3})/g, function (all, name, pg) {
      var rule = CITE_DOC.filter(function (c) { return c[0].test(name); })[0]; if (!rule) return all;
      var doc = docs.filter(function (d) { return rule[1].test(d[0]); })[0]; if (!doc || !/^https:\/\//.test(doc[1])) return all;
      return '<a class="mt-pg-a" href="' + esc(doc[1]) + '#page=' + (Number(pg) + rule[2]) + '" target="_blank" rel="noopener" aria-label="Open ' + esc(name) + ' page ' + pg + '">' + all + '</a>';
    });
  }
  var KIND = { done: 'Check-off', service: 'Service', repair: 'Repair', def: 'DEF', setup: 'Setup', cosmetic: 'Detail', baseline: 'Baseline' };
  function unitName(u) { return u === 'truck' ? 'Truck' : (u === 'trailer' ? 'Trailer' : 'Unit unclear'); }
  function costOf(e) { var p = st.priv; return p && p.costs ? p.costs[e.id] : null; }
  function secLog(P) {
    var f = st.logf;
    var chips = [['all', 'All'], ['truck', 'Truck'], ['trailer', 'Trailer'], ['service', 'Service and repair'], ['def', 'DEF']].map(function (c) {
      return '<button type="button" class="mt-seg' + (f === c[0] ? ' on' : '') + '" data-mt-log="' + c[0] + '" aria-pressed="' + (f === c[0] ? 'true' : 'false') + '">' + c[1] + '</button>';
    }).join('');
    var ents = activeEntries().map(function (e) { return { id: e.id, date: e.date, unit: e.unit, kind: 'done', job: 'Done: ' + itemName(e.item_id), odo: e.odo, odoEst: e.odo_est, vendor: e.vendor, note: e.note, ent: e }; });
    var list = ents.concat(P.log.slice().reverse()).sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); }).filter(function (e) {
      if (f === 'all') return true;
      if (f === 'truck' || f === 'trailer') return e.unit === f;
      if (f === 'service') return e.kind === 'service' || e.kind === 'repair' || e.kind === 'done';
      return e.kind === f;
    });
    var priv = !!st.priv;
    var rows = list.map(function (e) {
      var c = e.ent ? { cost: e.ent.cost, paid_by: '' } : costOf(e);
      var cost = (priv || e.ent) ? (c && c.cost != null ? '<b class="mt-cost">' + m2(c.cost) + (c.est ? '<small>EST</small>' : '') + '</b>' : '<b class="mt-cost mt-unk">unknown</b>') : '<b class="mt-cost mt-lockd">' + lockIcon() + '</b>';
      var odoTxt = e.odo != null ? n0(e.odo) + (e.unit === 'trailer' && e.ent ? ' trailer mi' : ' mi') + (e.odoEst ? ' EST' : '') : 'odometer unknown';
      var paid = (priv && !e.ent) ? (c && c.paid_by ? 'Paid by ' + c.paid_by : (e.kind === 'baseline' ? '' : 'Paid by: unknown')) : '';
      var note = priv && c && c.note && !e.ent ? c.note : e.note;
      return '<div class="mt-log mt-log-' + esc(e.kind) + '"><div class="mt-log-d"><b>' + md(e.date) + '</b><span>' + String(e.date).slice(0, 4) + '</span></div>' +
        '<div class="mt-log-m"><div class="mt-log-t"><b>' + esc(e.job) + '</b></div>' +
        '<div class="mt-log-s"><span class="mt-chip mt-u-' + esc(e.unit) + '">' + unitName(e.unit) + '</span><span class="mt-chip' + (e.ent ? ' mt-chip-done' : '') + '">' + esc(KIND[e.kind] || e.kind) + '</span>' + (e.ent && e.ent.pending ? '<span class="mt-chip mt-chip-unk">Syncing</span>' : '') + '<span class="mt-chip' + (e.odo == null ? ' mt-chip-unk' : '') + '">' + odoTxt + '</span></div>' +
        '<div class="mt-log-v">' + (e.vendor ? esc(e.vendor) : (e.ent ? 'Shop not entered' : 'Vendor unknown')) + (paid ? ' | ' + esc(paid) : '') + '</div>' +
        (note ? '<p class="mt-log-n">' + esc(note) + '</p>' : '') + '</div>' + cost + '</div>';
    }).join('');
    return card('mt-log', 'Service log', (P.log.length + ents.length) + ' entries',
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
    activeEntries().forEach(function (e) {
      if (e.cost == null) return;
      t.svc += e.cost; t.svcN++; if (String(e.date).slice(0, 7) === ym) t.svcM += e.cost;
    });
    var u = P.units[0], miles = Math.max(O.cur - (u.start_odo || 0), 1);
    var all = t.svc + t.def;
    var bars = [['Service and repair', t.svc], ['DEF', t.def], ['Setup and detail (not counted)', t.excl]];
    var mx = Math.max.apply(null, bars.map(function (b) { return b[1]; }).concat([1]));
    var monthLbl = MON[now.getMonth()];
    return card('mt-spend', 'Maintenance spend', 'PIN-gated',
      '<div class="mt-tiles">' +
      tapT(tile(monthLbl + ' so far', m0(t.svcM + t.defM), m0(t.svcM) + ' service, ' + m0(t.defM) + ' DEF', 'ok'), 'spend:month', monthLbl + ' maintenance spend') +
      tapT(tile('Since start', m0(all), m0(t.svc) + ' service, ' + m0(t.def) + ' DEF', 'ok'), 'spend:all', 'Maintenance spend since start') +
      tapT(tile('Cost per mile', '$' + (all / miles).toFixed(3), '$' + (t.svc / miles).toFixed(3) + ' service only', 'ok'), 'spend:cpm', 'Maintenance cost per mile') +
      '</div>' +
      bars.map(function (b, bi) { return '<div class="mt-sbar' + (b[1] ? ' tl-tap"' + (window.BlackRamTiles ? window.BlackRamTiles.attrs('mt', 'spend:' + ['svc', 'def', 'excl'][bi], b[0] + ' ' + m0(b[1]) + '. Show the jobs') : '') : '"') + '><span>' + b[0] + '</span><div class="mt-sbar-t"><i style="width:' + Math.max(b[1] / mx * 100, b[1] ? 3 : 0).toFixed(1) + '%"></i></div><b>' + m0(b[1]) + '</b></div>'; }).join('') +
      '<p class="mt-fine">Per mile uses ' + n0(miles) + ' miles driven since delivery' + (O.est ? ' (EST, a floor, so cost per mile is a ceiling)' : '') + '. ' +
      (t.est ? 'Includes estimated amounts (oil change) until the final invoices are posted. ' : '') +
      (t.unk ? t.unk + ' job' + (t.unk > 1 ? 's' : '') + ' with no cost on file (the 11/11 tire; the warranty may have paid). ' : '') +
      'Fuel and the TrailerGard contract are not maintenance spend. The rate model budgets DEF at $0.034 a mile.</p>');
  }
  function tapT(html, arg, label) {
    var T = window.BlackRamTiles; if (!T) return html;
    return html.replace('<div class="mt-tile ', '<div' + T.attrs('mt', arg, label + '. Show the jobs') + ' class="tl-tap tl-corner mt-tile ');
  }
  function spendLines(kind) {
    var P = st.pub, priv = st.priv; if (!P || !priv) return [];
    var out = [];
    P.log.forEach(function (e) {
      var c = priv.costs[e.id], k = e.kind;
      if (!c || c.cost == null) { if (k === 'service' || k === 'repair' || k === 'def') out.push({ e: e, cost: null, k: k === 'def' ? 'def' : 'svc' }); return; }
      if (k === 'service' || k === 'repair') out.push({ e: e, cost: c.cost, est: c.est, k: 'svc', by: c.paid_by });
      else if (k === 'def') out.push({ e: e, cost: c.cost, est: c.est, k: 'def', by: c.paid_by });
      else if (k === 'setup' || k === 'cosmetic') out.push({ e: e, cost: c.cost, est: c.est, k: 'excl', by: c.paid_by });
    });
    activeEntries().forEach(function (e) { if (e.cost != null) out.push({ e: { date: e.date, job: 'Done: ' + itemName(e.item_id), unit: e.unit, vendor: e.vendor }, cost: e.cost, k: 'svc' }); });
    return out.filter(function (x) { return !kind || x.k === kind; }).sort(function (a, b) { return a.e.date < b.e.date ? 1 : -1; });
  }
  function drill(arg) {
    var T = window.BlackRamTiles; if (!T) return;
    var p = String(arg).split(':'), k = p[0], id = p.slice(1).join(':');
    if (k === 'item') { openSheet(id); return; }
    if (k !== 'spend' || !st.priv || !st.pub) return;
    var now = new Date(), ym = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
    var L = spendLines(id === 'svc' || id === 'def' || id === 'excl' ? id : null);
    if (id === 'month') L = L.filter(function (x) { return x.k !== 'excl' && String(x.e.date).slice(0, 7) === ym; });
    else if (id === 'all' || id === 'cpm') L = L.filter(function (x) { return x.k !== 'excl'; });
    var tot = L.reduce(function (a, x) { return a + (x.cost || 0); }, 0);
    var O = odo(), u = st.pub.units[0], miles = O ? Math.max(O.cur - (u.start_odo || 0), 1) : null;
    var title = { month: MON[now.getMonth()] + ' maintenance spend', all: 'Maintenance spend since start', cpm: 'Maintenance cost per mile', svc: 'Service and repair', def: 'DEF', excl: 'Setup and detail (not counted)' }[id] || 'Spend';
    T.open({ title: title, sub: 'PIN-gated', body: T.hero(id === 'cpm' && miles ? '$' + (tot / miles).toFixed(3) + '/mi' : m2(tot), id === 'cpm' && miles ? m2(tot) + ' over ' + n0(miles) + ' mi' + (O.est ? ' (EST, a floor)' : '') : L.length + ' jobs') +
      T.rows(L.map(function (x) { return { d: md(x.e.date), t: esc(x.e.job), s: unitName(x.e.unit) + (x.e.vendor ? ' | ' + esc(x.e.vendor) : '') + (x.by ? ' | paid by ' + esc(x.by) : ''), v: x.cost == null ? 'cost?' : m2(x.cost), vc: x.cost == null ? 'warn' : '', vs: x.est ? 'EST' : '' }; }), 'No jobs with a cost in this view.') +
      T.fine('Fuel and the TrailerGard contract are not maintenance spend. A job with no cost on file shows cost?.') });
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
  /* v96: daily lists (pre-trip, every stop, post-trip) store the check date and reset each day;
     the monthly list keeps its checks until Clear checks. */
  function chkOn(s, k) { var v = s[k]; if (!v) return false; return /^monthly/.test(k) ? true : v === todayIso(); }
  function secChecks(P) {
    var s = chkState(), C = P.checklists;
    function one(key) {
      var c = C[key];
      return '<div class="mt-sub">' + esc(c.title) + '</div><div class="mt-docs">' + c.items.map(function (t, i) {
        var k = key + ':' + i;
        var on = chkOn(s, k);
        return '<button type="button" class="mt-doc' + (on ? ' on' : '') + '" data-mt-chk="' + k + '" aria-pressed="' + (on ? 'true' : 'false') + '"><span class="mt-ck" aria-hidden="true"></span><span>' + esc(t) + '</span></button>';
      }).join('') + '</div>';
    }
    var keys = Object.keys(C || {}).filter(function (k) { return C[k] && Array.isArray(C[k].items) && C[k].items.length; });
    return card('mt-chk', 'Checklists', 'Pre-trip, every stop, post-trip',
      keys.map(one).join('') + '<button type="button" class="btn" id="mt-chk-reset">Clear checks</button>' +
      '<p class="mt-fine">Built from the Ram owner\'s manual, the Big Tex owner\'s manual and the Dexter axle manual (pages in each line). Saved on this phone only. Pre-trip, every-stop and post-trip checks reset each day; monthly checks stay until Clear checks.</p>');
  }
  function secManuals(P) {
    var M = P.manuals || {};
    if (!M.insights) return '';
    var rat = (M.ratings || []).map(function (r) { return '<div class="mt-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '<small>' + citeLinks(esc(r[2])) + '</small></b></div>'; }).join('');
    var F = M.fit || {};
    var fit = (F.rows || []).map(function (r) { return '<div class="mt-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('');
    var ins = (M.insights || []).map(function (x) { return '<li><b>' + esc(x[0]) + '.</b> ' + esc(x[1]) + ' <i class="mt-pg">' + citeLinks(esc(x[2])) + '</i></li>'; }).join('');
    var docs = (M.docs || []).map(function (x) { return '<li><a href="' + esc(x[1]) + '" target="_blank" rel="noopener">' + esc(x[0]) + '</a></li>'; }).join('');
    return card('mt-man', 'From the manuals', (M.insights || []).length + ' insights',
      '<div class="mt-in"><div class="mt-in-h"><b>Ratings for our rig</b></div><div class="mt-rows">' + rat + '</div></div>' +
      '<div class="mt-in"><div class="mt-in-h"><b>' + esc(F.title || 'Fit rule check') + '</b>' + pill('warn', 'Agrees if CAT was hitched') + '</div><div class="mt-rows">' + fit + '</div>' +
      (F.note ? '<p class="mt-fine">' + esc(F.note) + '</p>' : '') + '</div>' +
      '<div class="mt-sub">What the manuals say</div><ul class="mt-list mt-ins">' + ins + '</ul>' +
      '<div class="mt-sub">Manuals</div><ul class="mt-list mt-list-s">' + docs + '</ul><p class="mt-fine">Tap a page cite to open that manual at the page.</p>');
  }
  function secNeed(P) {
    return card('mt-need', 'Need from Claudio (' + P.need.length + ')', 'Fills the gaps',
      '<ul class="mt-list">' + P.need.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>');
  }
  function secSources(P) {
    var S = P.sources;
    return '<section class="mt-card mt-srcs"><div class="mt-h"><h3>Where the intervals come from</h3></div><ul class="mt-list mt-list-s">' +
      Object.keys(S).map(function (k) { return '<li>' + esc(S[k]) + '</li>'; }).join('') + '</ul>' +
      '<p class="mt-fine">Our oil change is every 5,000 mi, tighter than the Ram manual (15,000 mi or 12 months maximum, OM p. 286) and the severe-duty towing schedule (7,500 mi or 6 months). Each how-to lists the manual and page it came from. Heavy towing can justify shorter fluid intervals than the manual lists. Check the manual and your dealer before relying on any date here.</p></section>';
  }

  function secHist() {
    var all = effEntries().sort(cmpEntry).reverse(), q = queue().length;
    var sync = q ? '<div class="mt-sync"><span>' + q + ' waiting to sync' + (st.syncMsg ? '. ' + esc(st.syncMsg) : '') + '</span><button type="button" class="mt-mini" id="mt-sync">' + (st.flushing ? 'Sending...' : 'Sync now') + '</button></div>' : '';
    var body = all.length ? '<div class="mt-hist">' + all.slice(0, 40).map(function (e) { return histRow(e, true); }).join('') + '</div>' : '<p class="mt-fine">Nothing checked off yet. Tap any item under Due next, then Mark done.</p>';
    return card('mt-hist', 'Check-off history', all.length ? all.length + ' saved' : 'Newest first', sync + body +
      '<p class="mt-fine">Saved through the PIN-checked relay so they show on every device. Undo puts the item back to its earlier due date.</p>');
  }
  function toastHtml() {
    if (!st.toast) return '';
    return '<div class="mt-toast" role="status"><span>' + esc(st.toast) + '</span>' + (st.toastUndo ? '<button type="button" class="mt-mini" data-mt-undo-t="' + esc(st.toastUndo) + '">Undo</button>' : '') + '</div>';
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
    var nav = [['mt-odo', 'Odometer'], ['mt-due', 'Due next'], ['mt-hist', 'Done'], ['mt-log', 'Log'], ['mt-spend', 'Spend'], ['mt-warr', 'Warranty'], ['mt-chk', 'Checks'], ['mt-man', 'Manuals'], ['mt-need', 'Need']];
    var built = P.built_at ? new Date(P.built_at) : null;
    var stamp = built && !isNaN(built.getTime()) ? ' Records built ' + built.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT.' : '';
    el.innerHTML =
      '<div class="mt-top"><div><div class="mt-kicker">Sand Lily Pad LLC</div><h2>Maintenance</h2></div>' +
      '<div class="mt-acts"><button type="button" class="mt-btn" id="mt-refresh" aria-label="Refresh">' + (st.loading ? '...' : 'Refresh') + '</button></div></div>' +
      toastHtml() + secTiles(rows) + secDue(rows) +
      '<nav class="mt-jump">' + nav.map(function (j) { return '<a href="#' + j[0] + '" data-mt-jump="' + j[0] + '">' + j[1] + '</a>'; }).join('') + '</nav>' +
      secOdo(P, O) + secHist() + secLog(P) + secSpend(P, O) + secWarranty(P, O) + secChecks(P) + secManuals(P) + secNeed(P) + secSources(P) +
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
    el.querySelectorAll('[data-mt-item]').forEach(function (b) { b.addEventListener('click', function () { openSheet(b.getAttribute('data-mt-item'), 'done'); }); });
    el.querySelectorAll('[data-mt-status]').forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-mt-status'); st.status = (k && st.status === k) ? '' : k; render(); if (st.status) { var d = document.getElementById('mt-due'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }); });
    el.querySelectorAll('[data-mt-undo]').forEach(function (b) { b.addEventListener('click', function () { undoEntry(b.getAttribute('data-mt-undo')); }); });
    el.querySelectorAll('[data-mt-redo]').forEach(function (b) { b.addEventListener('click', function () { redoEntry(b.getAttribute('data-mt-redo')); }); });
    el.querySelectorAll('[data-mt-undo-t]').forEach(function (b) { b.addEventListener('click', function () { st.toast = ''; undoEntry(b.getAttribute('data-mt-undo-t')); }); });
    var sy = document.getElementById('mt-sync'); if (sy) sy.addEventListener('click', function () { if (!pin()) { st.syncMsg = 'Enter the PIN under Maintenance spend first.'; render(); return; } flush(); fetchPriv(true); });
    var r = document.getElementById('mt-refresh'); if (r) r.addEventListener('click', function () { st.pub = null; loadPublic(); fetchPriv(true); });
    el.querySelectorAll('[data-mt-jump]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); var t = document.getElementById(a.getAttribute('data-mt-jump')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    });
    el.querySelectorAll('[data-mt-unit]').forEach(function (b) { b.addEventListener('click', function () { st.unit = b.getAttribute('data-mt-unit'); render(); }); });
    el.querySelectorAll('[data-mt-log]').forEach(function (b) { b.addEventListener('click', function () { st.logf = b.getAttribute('data-mt-log'); render(); }); });
    el.querySelectorAll('[data-mt-chk]').forEach(function (b) {
      b.addEventListener('click', function () { var s = chkState(), k = b.getAttribute('data-mt-chk'); if (chkOn(s, k)) delete s[k]; else s[k] = todayIso(); jset(CHK_KEY, s); render(); });
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
      '.mt-tile b{font-size:var(--fs-lg);font-weight:900;color:var(--num-yellow,var(--c-gold,#F2C94C));line-height:1.15;overflow-wrap:anywhere}' +
      '.mt-tile small{font-size:11px;color:var(--c-text-3);line-height:1.25}' +
      '.mt-t-warn b{color:var(--c-maybe)}.mt-t-warn{border-color:var(--c-maybe)}.mt-t-bad b{color:#FCA5A5}.mt-t-bad{border-color:#F87171}' +
      '.mt-next{margin:0;font-size:var(--fs-sm);color:var(--c-text-2)}.mt-next b{color:var(--c-text-1)}' +
      '.mt-jump{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:-2px 0}' +
      '.mt-jump a{flex:none;font-size:var(--fs-xs);font-weight:700;color:var(--c-text-3);text-decoration:none;padding:4px 10px;border-radius:var(--radius-pill);background:var(--c-surface-1)}' +
      '.mt-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg);padding:var(--s-2) var(--s-2) var(--s-1h);display:flex;flex-direction:column;gap:var(--s-1h);scroll-margin-top:calc(var(--appbar-h) + 8px)}' +
      '.mt-h{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-1);flex-wrap:wrap}' +
      '.mt-h h3{margin:0;font-size:var(--fs-lg);font-weight:var(--fw-black);color:var(--c-text-1)}.mt-h span{font-size:var(--fs-xs);font-weight:700;color:var(--c-text-3)}' +
      '.mt-fine{margin:0;font-size:var(--fs-xs);color:var(--c-text-3);line-height:1.4}' +
      '.mt-big{font-size:var(--fs-3xl);font-weight:var(--fw-black);color:var(--num-yellow,var(--c-gold));line-height:1.1}.mt-big span{display:block;font-size:var(--fs-sm);font-weight:700;color:var(--c-text-3);margin-top:4px;line-height:1.35}' +
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
      '.mt-cite li,.mt-ins li{font-size:var(--fs-sm)}.mt-pg{display:inline-block;font-style:normal;font-size:11px;font-weight:700;color:var(--c-text-3)}.mt-ins b{color:var(--c-text-1)}' +
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
    s.textContent +=
      '.mt-pg-a{color:var(--c-accent-hi);text-decoration:underline;text-underline-offset:2px}' +
      '.mt-next.tl-tap{border-radius:var(--radius-sm)}' +
      '.mt-tile-btn{font:inherit;text-align:left;cursor:pointer;color:inherit;width:100%}.mt-tile-btn.on{border-color:var(--c-gold);box-shadow:0 0 0 1px var(--c-gold) inset}' +
      '.mt-tile-btn:active,.mt-due:active{transform:scale(.99)}' +
      'button.mt-due{display:flex;flex-direction:column;gap:6px;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer;padding:var(--s-1h);border:0;border-left:4px solid var(--c-take)}' +
      'button.mt-due.mt-due-warn{border-left-color:var(--c-maybe)}button.mt-due.mt-due-bad{border-left-color:#F87171}button.mt-due.mt-due-need{border-left-color:var(--c-line-strong);border-left-style:dashed}' +
      '.mt-due-act{display:flex;justify-content:space-between;align-items:center;gap:var(--s-1);font-size:11px;font-weight:800;color:var(--c-accent-hi)}.mt-due-act>span:last-child{margin-left:auto}' +
      '.mt-done-tag{background:var(--c-take-bg);color:var(--c-take);padding:2px 8px;border-radius:var(--radius-pill)}' +
      '.mt-filt{margin:0;font-size:var(--fs-xs);font-weight:700;color:var(--c-text-2);display:flex;align-items:center;gap:var(--s-1)}' +
      '.mt-mini{min-height:34px;padding:0 12px;border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-3);color:var(--c-text-1);font:inherit;font-size:var(--fs-xs);font-weight:800;cursor:pointer;flex:none}' +
      '.mt-toast{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1);padding:var(--s-1h);border-radius:var(--radius-md);background:var(--c-take-bg);border:1px solid var(--c-take);color:var(--c-text-1);font-size:var(--fs-sm);font-weight:700}' +
      '.mt-sync{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1);padding:var(--s-1);border-radius:var(--radius-md);background:var(--c-maybe-bg);color:var(--c-maybe);font-size:var(--fs-xs);font-weight:700}' +
      '.mt-hist{display:flex;flex-direction:column;gap:6px}' +
      '.mt-hrow{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1);background:var(--c-surface-2);border-radius:var(--radius-md);padding:var(--s-1) var(--s-1h)}.mt-hrow.mt-undone{opacity:.6}' +
      '.mt-hrow-m{display:flex;flex-direction:column;gap:3px;min-width:0}.mt-hrow-m b{font-size:var(--fs-sm);color:var(--c-text-1);line-height:1.3}.mt-hrow-m span{font-size:12px;color:var(--c-text-3);font-weight:600}.mt-hrow-m .mt-hnote{color:var(--c-text-2)}' +
      '.mt-chip-done{background:var(--c-take-bg);color:var(--c-take)}' +
      '.mt-noscroll,.mt-noscroll body{overflow:hidden}' +
      '.mt-sheet{position:fixed;inset:0;z-index:2700}.mt-sheet[hidden]{display:none}' +
      '.mt-sh-bd{position:absolute;inset:0;background:rgba(4,3,8,.66)}' +
      '.mt-sh-p{position:absolute;left:0;right:0;bottom:0;max-height:92dvh;display:flex;flex-direction:column;background:var(--c-surface-2);border-top:1px solid var(--c-line-strong);border-radius:var(--radius-xl) var(--radius-xl) 0 0;box-shadow:var(--shadow-2);animation:moreUp .18s ease-out;padding-bottom:env(safe-area-inset-bottom)}' +
      '@media(min-width:720px){.mt-sh-p{left:50%;right:auto;width:560px;transform:translateX(-50%)}}' +
      '.mt-sh-grab{width:40px;height:4px;border-radius:2px;background:var(--c-line-strong);margin:8px auto 0}' +
      '.mt-sh-h{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s-1);padding:var(--s-1h) var(--s-2) var(--s-1)}.mt-sh-h b{display:block;font-size:var(--fs-lg);font-weight:900;color:var(--c-text-1);line-height:1.2}.mt-sh-h span{font-size:var(--fs-xs);color:var(--c-text-3);font-weight:700}' +
      '.mt-sh-x{min-height:36px;padding:0 14px;border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-3);color:var(--c-text-1);font:inherit;font-size:var(--fs-sm);font-weight:800;cursor:pointer;flex:none}' +
      '.mt-sh-body{overflow-y:auto;overscroll-behavior:contain;padding:0 var(--s-2) var(--s-3);display:flex;flex-direction:column;gap:var(--s-1h)}' +
      '.mt-sh-foot{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--c-line);padding-top:var(--s-1h)}.mt-sh-foot p{margin:0;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.4}.mt-sh-foot .mt-src{font-size:11px;color:var(--c-text-3)}' +
      '.mt-sh-info{display:flex;flex-direction:column;gap:6px;align-items:flex-start}.mt-sh-info p{margin:0;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.4}.mt-sh-info .mt-src{font-size:11px;color:var(--c-text-3)}' +
      '.mt-tabs .mt-seg{flex:1;min-height:42px}' +
      '.mt-form{display:flex;flex-direction:column;gap:var(--s-1h)}.mt-form label{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-xs);font-weight:800;color:var(--c-text-2)}' +
      '.mt-form input,.mt-form textarea{min-height:var(--tap);padding:0 var(--s-1h);border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-1);color:var(--c-text-1);font:inherit;font-size:16px;font-weight:600}.mt-form textarea{padding:var(--s-1) var(--s-1h);resize:vertical}' +
      '.mt-form small{font-size:11px;font-weight:600;color:var(--c-text-3)}' +
      '.mt-preview{margin:0;font-size:var(--fs-sm);font-weight:700;color:var(--c-gold)}.mt-preview:empty{display:none}' +
      '.mt-err{margin:0;font-size:var(--fs-sm);font-weight:800;color:#FCA5A5}' +
      '.mt-save{width:100%;min-height:var(--tap)}' +
      '.mt-sop{display:flex;flex-direction:column;gap:var(--s-1h)}.mt-sop-about{margin:0;font-size:var(--fs-md);font-weight:700;color:var(--c-text-1);line-height:1.4}' +
      '.mt-specs{display:flex;flex-direction:column;gap:6px}.mt-spec{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--s-1);background:var(--c-surface-1);border-radius:var(--radius-md);padding:var(--s-1) var(--s-1h)}.mt-spec span{display:block;font-size:11px;font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.04em}.mt-spec b{display:block;font-size:var(--fs-sm);color:var(--c-text-1);line-height:1.35;margin-top:2px}' +
      '.mt-tag{flex:none;font-style:normal;font-size:10px;font-weight:800;padding:2px 8px;border-radius:var(--radius-pill);white-space:nowrap}.mt-tag-m{background:var(--c-take-bg);color:var(--c-take)}.mt-tag-d,.mt-tag-b,.mt-tag-c{background:rgba(96,165,250,.16);color:#93C5FD}.mt-tag-g{background:var(--c-maybe-bg);color:var(--c-maybe)}' +
      '.mt-steps{margin:0;padding-left:22px;font-size:var(--fs-sm);color:var(--c-text-1);line-height:1.5;display:flex;flex-direction:column;gap:8px}' +
      '.mt-warnbox{border:1px solid rgba(248,113,113,.5);background:rgba(248,113,113,.08);border-radius:var(--radius-md);padding:var(--s-1h);display:flex;flex-direction:column;gap:6px}.mt-warnbox>b{color:#FCA5A5;font-size:var(--fs-sm)}' +
      '';
    document.head.appendChild(s);
  }

  function onShow() { loadPublic(); render(); fetchPriv(false); flush(); }
  function init() {
    css();
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'maint') onShow(); else if (st.sheet) closeSheet(); });
    window.addEventListener('online', flush);
    if (document.documentElement.getAttribute('data-tab') === 'maint') onShow();
  }
  if (window.BlackRamTiles) window.BlackRamTiles.on('mt', drill);
  function pubRows() { return allRows().map(function (r) { return { id: r.it.id, item: r.it.item, unit: r.it.unit, status: r.status, remMi: r.remMi, remD: r.remD, dueDate: r.dueDate || null }; }); }
  function checkStats() {
    var P = st.pub; if (!P || !P.checklists) return [];
    var s = chkState(), C = P.checklists;
    return Object.keys(C).filter(function (k) { return C[k] && Array.isArray(C[k].items) && C[k].items.length; }).map(function (k) {
      var done = 0; C[k].items.forEach(function (t, i) { if (chkOn(s, k + ':' + i)) done++; });
      return { key: k, title: C[k].title, done: done, total: C[k].items.length };
    });
  }
  function searchIndex() {
    var P = st.pub; if (!P) return null;
    return {
      schedule: (P.schedule || []).map(function (it) { return { id: it.id, item: it.item, unit: it.unit }; }),
      checks: Object.keys(P.checklists || {}).reduce(function (a, k) { var c = P.checklists[k]; (c && c.items || []).forEach(function (t) { a.push({ list: c.title, t: t }); }); return a; }, []),
      insights: ((P.manuals && P.manuals.insights) || []).map(function (x) { return { t: x[0], s: x[1] }; })
    };
  }
  window.BlackRamMaintenance = { ready: function () { return !!st.pub; }, load: loadPublic, rows: pubRows, checks: checkStats, index: searchIndex, render: render, openItem: openSheet, closeSheet: closeSheet, flush: flush, refresh: function () { st.pub = null; loadPublic(); fetchPriv(true); } };
  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { maintenance: window.BlackRamMaintenance });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
