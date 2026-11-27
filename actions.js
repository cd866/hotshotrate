/* Black Ram Logistics - Action items (v105+). More > Action items (#actions) and a card on Today.
   Public part: data/actions.json (titles, first names, dates, links; no amounts, phones, emails or addresses).
   PIN part: the relay POST /maintenance log (KV maint_log), item_id "act-<id>":
     "[done]" / "[open]" notes set status (latest wins), "[info] ..." notes carry private detail (amounts),
     "[new] {json}" adds a partner item (item_id "act-u-<rand>"); undo on that entry removes it.
   Only PIN holders can check off or add. Queue in localStorage (blackram_act_queue_v1) like Tax and DOT.
   Uses v51 tokens, dr-* card styles (dotready.js) and the shared tiles.js sheet. Plain ASCII. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var QUEUE_KEY = 'blackram_act_queue_v1';
  var CACHE_KEY = 'blackram_act_cache_v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var PR = { high: ['High', 0, '#F87171'], med: ['Medium', 1, '#F2C94C'], low: ['Low', 2, '#8F86B8'] };
  var OWN_COL = { Claudio: '#F2C94C', Ben: '#60A5FA', Meshach: '#34D399' };
  var PII = /[\w.+-]+@[\w-]+\.[\w.]+|\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/;
  var st = { pub: null, pubErr: '', pubLoading: false, srv: null, loading: false, flushing: false, syncMsg: '', toast: '', showDone: false, sheetId: '', owner: '', adding: false };
  var toastTimer = 0, flushTimer = 0;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ascii(v) { return String(v == null ? '' : v).replace(/[\u2013\u2014\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E]/g, ''); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function utc(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function daysTo(iso) { return Math.round((utc(iso) - utc(todayIso())) / 86400000); }
  function md(iso) { var p = String(iso).slice(0, 10).split('-'); return (+p[1]) + '/' + (+p[2]); }
  function ymd(iso) { var p = String(iso).slice(0, 10).split('-'); return DOW[new Date(utc(iso)).getUTCDay()] + ' ' + MON[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0]; }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private mode */ } }
  function root() { return document.getElementById('ai-root'); }
  function T() { return window.BlackRamTiles; }
  function ta(arg, label) { var t = T(); return t ? t.attrs('ai', arg, label) : ''; }
  function rnd() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pill(tone, txt) { return '<span class="dr-pill dr-pill-' + tone + '">' + esc(txt) + '</span>'; }
  function ping() { try { document.dispatchEvent(new CustomEvent('blackram:actions')); } catch (e) { /* ignore */ } }

  /* ---------- public data ---------- */
  function loadPublic() {
    if (st.pub || st.pubLoading) return;
    st.pubLoading = true;
    fetch('data/actions.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { st.pub = j; st.pubErr = ''; })
      .catch(function (e) { st.pubErr = 'Could not load the action items (' + (e && e.message ? e.message : 'offline') + ').'; })
      .then(function () { st.pubLoading = false; render(); ping(); if (st.pub && pin()) fetchSrv(); });
  }

  /* ---------- relay log (PIN) ---------- */
  function slim(entries) {
    var out = [];
    (entries || []).forEach(function (e) { if (e && String(e.item_id || '').indexOf('act-') === 0) out.push({ id: e.id, item_id: e.item_id, date: e.date, note: e.note || '', at: e.at || '', undone: e.undone ? true : undefined }); });
    return out;
  }
  function srvEntries() { if (st.srv) return st.srv; if (!pin()) return []; var c = jget(CACHE_KEY, null); return (c && Array.isArray(c.entries)) ? c.entries : []; }
  function fetchSrv() {
    var p = pin(); if (!p || st.loading) return;
    st.loading = true;
    fetch(RELAY + '/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p, op: 'list' }), cache: 'no-store' })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (resp.ok && j && j.ok && j.data) { st.srv = slim(j.data.entries); jset(CACHE_KEY, { at: Date.now(), entries: st.srv }); st.syncMsg = ''; }
          else if (resp.status === 401) { st.syncMsg = 'Wrong PIN. Enter the right PIN to check items off.'; st.srv = null; jset(CACHE_KEY, null); }
          else st.syncMsg = 'Could not load the shared list (' + resp.status + '). Showing this phone.';
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
    return order.map(function (id) { return map[id]; }).filter(function (e) { return !e.undone; });
  }
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
  function push(entry) { var q = queue(); q.push({ op: 'add', entry: entry }); setQueue(q); }
  function entry(itemId, note) { return { id: 'a' + rnd(), item_id: ('act-' + itemId).slice(0, 40), unit: 'truck', date: todayIso(), odo: null, cost: null, vendor: '', note: ascii(note).slice(0, 290), at: new Date().toISOString() }; }

  /* ---------- items ---------- */
  function userItems() {
    var out = [];
    effEntries().forEach(function (e) {
      var m = /^\[new\] ?([\s\S]*)$/.exec(e.note || ''); if (!m) return;
      var j = null; try { j = JSON.parse(m[1]); } catch (x) { j = null; }
      if (!j || !j.t) return;
      out.push({ id: String(e.item_id).slice(4), t: String(j.t), owner: OWN_COL[j.o] ? j.o : 'Claudio', due: /^\d{4}-\d{2}-\d{2}$/.test(j.d || '') ? j.d : null, p: PR[j.p] ? j.p : 'med', cat: 'Added', why: String(j.w || ''), steps: [], go: '', covers: [], user: true, entryId: e.id, pending: !!e.pending, added: e.date });
    });
    return out;
  }
  function items() { return ((st.pub && st.pub.items) || []).concat(userItems()); }
  function itemById(id) { return items().filter(function (x) { return x.id === id; })[0]; }
  function calc(it) {
    var mine = effEntries().filter(function (e) { return e.item_id === ('act-' + it.id).slice(0, 40); });
    var stat = mine.filter(function (e) { return /^\[(done|open)\]/.test(e.note); }).sort(function (a, b) { return (a.at || a.date) < (b.at || b.date) ? -1 : 1; });
    var le = stat.length ? stat[stat.length - 1] : null;
    var s = le ? /^\[(done|open)\]/.exec(le.note)[1] : (it.status || 'open');
    var info = mine.filter(function (e) { return /^\[info\]/.test(e.note); }).sort(function (a, b) { return a.id < b.id ? -1 : 1; }).map(function (e) { return e.note.replace(/^\[info\] ?/, ''); });
    var d = it.due ? daysTo(it.due) : null;
    var done = s === 'done';
    var tone = done ? 'ok' : (d != null && d < 0 ? 'bad' : (d != null && d <= 7 ? 'bad' : (it.p === 'high' ? 'warn' : (d != null && d <= 30 ? 'warn' : 'unk'))));
    return { s: s, done: done, d: d, tone: tone, entry: le, info: info };
  }
  function title(it) { /* sensitive items: the real title rides in a PIN-only "[title] ..." note */
    if (!it.sens || !pin()) return it.t;
    var e = effEntries().filter(function (x) { return x.item_id === ('act-' + it.id).slice(0, 40) && /^\[title\]/.test(x.note); })[0];
    return e ? e.note.replace(/^\[title\] ?/, '') : it.t;
  }
  function rows() {
    return items().map(function (it) { return { it: it, r: calc(it) }; }).sort(function (a, b) {
      if (a.r.done !== b.r.done) return a.r.done ? 1 : -1;
      var pa = PR[a.it.p] ? PR[a.it.p][1] : 1, pb = PR[b.it.p] ? PR[b.it.p][1] : 1;
      var da = a.r.d == null ? 9999 : a.r.d, db = b.r.d == null ? 9999 : b.r.d;
      var ua = da <= 7 ? 0 : 1, ub = db <= 7 ? 0 : 1; /* due within a week jumps the queue */
      return (ua - ub) || (pa - pb) || (da - db) || (a.it.t < b.it.t ? -1 : 1);
    });
  }
  function counts() {
    var c = { open: 0, done: 0, high: 0, owners: {} };
    ((st.pub && st.pub.owners) || ['Claudio', 'Ben', 'Meshach']).forEach(function (o) { c.owners[o] = { open: 0, done: 0 }; });
    rows().forEach(function (x) {
      if (x.r.done) c.done++; else { c.open++; if (x.it.p === 'high') c.high++; }
      var o = c.owners[x.it.owner] || (c.owners[x.it.owner] = { open: 0, done: 0 });
      o[x.r.done ? 'done' : 'open']++;
    });
    return c;
  }
  function whenTxt(r) { return r.d == null ? 'no date' : (r.d < 0 ? (-r.d) + ' d late' : (r.d === 0 ? 'due today' : (r.d === 1 ? 'tomorrow' : r.d + ' d left'))); }

  function setStatus(id, s) {
    var it = itemById(id); if (!it) return;
    if (!pin()) { toast('Enter the app PIN to check items off.'); render(); return; }
    push(entry(id, '[' + s + ']'));
    toast(ascii(title(it)) + (s === 'done' ? ': done.' : ': open again.') + ' Saving to every phone...');
    render(); ping(); flush();
  }
  function addItem(f) {
    if (!pin()) { toast('Enter the app PIN to add an item.'); return false; }
    var t = ascii(f.t).trim().slice(0, 90), w = ascii(f.w).trim().slice(0, 120);
    if (!t) { toast('Type what needs doing.'); return false; }
    if (PII.test(t) || PII.test(w)) { toast('No phone numbers or emails in action items.'); return false; }
    var j = { t: t, o: OWN_COL[f.o] ? f.o : 'Claudio', d: /^\d{4}-\d{2}-\d{2}$/.test(f.d || '') ? f.d : '', p: PR[f.p] ? f.p : 'med', w: w };
    var note = '[new] ' + JSON.stringify(j);
    while (note.length > 290 && j.w) { j.w = j.w.slice(0, -10); note = '[new] ' + JSON.stringify(j); }
    push(entry('u-' + rnd(), note));
    toast('Added: ' + t + '. Saving to every phone...');
    st.adding = false; render(); ping(); flush();
    return true;
  }
  function removeUser(id) {
    var it = itemById(id); if (!it || !it.user || !pin()) return;
    var q = queue(), qi = -1;
    q.forEach(function (o, i) { if (o.op === 'add' && o.entry && o.entry.id === it.entryId) qi = i; });
    if (qi >= 0) { q.splice(qi, 1); setQueue(q); } else { q.push({ op: 'undo', id: it.entryId }); setQueue(q); }
    var t = T(); if (t && t.close) t.close();
    st.sheetId = ''; toast('Removed: ' + it.t + '.'); render(); ping(); flush();
  }
  function toast(t) { st.toast = t; if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(function () { st.toast = ''; render(); }, 7000); }

  /* ---------- charts ---------- */
  function donut(c, size) {
    var R = 40, C = 2 * Math.PI * R, tot = c.open + c.done || 1, fo = C * c.open / tot;
    size = size || 112;
    return '<svg class="ai-donut" width="' + size + '" height="' + size + '" viewBox="0 0 112 112" role="img" aria-label="' + c.open + ' open, ' + c.done + ' done">' +
      '<circle cx="56" cy="56" r="' + R + '" fill="none" stroke="var(--c-surface-3)" stroke-width="14"/>' +
      (c.done ? '<circle cx="56" cy="56" r="' + R + '" fill="none" stroke="#34D399" stroke-width="14" stroke-dasharray="' + (C - fo).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-fo).toFixed(2) + '" transform="rotate(-90 56 56)"/>' : '') +
      (c.open ? '<circle cx="56" cy="56" r="' + R + '" fill="none" stroke="#F2C94C" stroke-width="14" stroke-dasharray="' + fo.toFixed(2) + ' ' + C.toFixed(2) + '" transform="rotate(-90 56 56)"/>' : '') +
      '<text x="56" y="56" text-anchor="middle" class="ai-dn">' + c.open + '</text><text x="56" y="74" text-anchor="middle" class="ai-dl">open</text></svg>';
  }
  function ownerBars(c) {
    var names = Object.keys(c.owners), mx = 1;
    names.forEach(function (n) { mx = Math.max(mx, c.owners[n].open + c.owners[n].done); });
    return '<div class="ai-obars">' + names.map(function (n) {
      var o = c.owners[n];
      return '<div class="ai-obar tl-tap"' + ta('own:' + n, n + ': ' + o.open + ' open, ' + o.done + ' done. Show') + '><span class="ai-on">' + esc(n) + '</span>' +
        '<span class="ai-ot"><i style="width:' + (100 * o.open / mx).toFixed(1) + '%;background:' + (OWN_COL[n] || '#8F86B8') + '"></i><i class="ai-od" style="width:' + (100 * o.done / mx).toFixed(1) + '%"></i></span>' +
        '<b class="num-yellow">' + o.open + '</b></div>';
    }).join('') + '</div>';
  }

  /* ---------- render ---------- */
  function rowHtml(o) {
    var it = o.it, r = o.r, pr = PR[it.p] || PR.med;
    var chk = '<button type="button" class="ai-chk' + (r.done ? ' on' : '') + '" data-ai-toggle="' + esc(it.id) + '" aria-pressed="' + r.done + '" aria-label="' + (r.done ? 'Mark open: ' : 'Mark done: ') + esc(title(it)) + '"' + (pin() ? '' : ' data-ai-locked="1"') + '>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    return '<div class="ai-row' + (r.done ? ' ai-done' : '') + '">' + chk +
      '<div class="ai-rm tl-tap tl-chev"' + ta('it:' + it.id, title(it) + '. Open') + '><b>' + esc(title(it)) + '</b>' +
      '<small><i class="ai-pd" style="background:' + pr[2] + '"></i>' + esc(it.owner) + ' | ' + esc(it.cat) + (it.due ? ' | ' + (r.done ? md(it.due) : whenTxt(r)) : '') + (it.sens && !pin() ? ' | PIN' : '') + '</small></div></div>';
  }
  function render() {
    var el = root(); if (!el) return;
    if (st.pubErr) { el.innerHTML = '<section class="dr-card"><p class="dr-p">' + esc(st.pubErr) + '</p></section>'; return; }
    if (!st.pub) { el.innerHTML = '<section class="dr-card"><p class="dr-p">Loading the action items...</p></section>'; return; }
    var rs = rows(), c = counts(), q = queue().length, P = !!pin();
    var list = rs.filter(function (x) { return (!st.owner || x.it.owner === st.owner) && (st.showDone || !x.r.done); });
    var nDone = rs.filter(function (x) { return x.r.done && (!st.owner || x.it.owner === st.owner); }).length;
    var sync = q ? '<div class="dr-sync"><span>' + q + ' waiting to sync' + (st.syncMsg ? '. ' + esc(st.syncMsg) : '') + '</span><button type="button" class="dr-mini" data-ai-sync="1">' + (st.flushing ? 'Sending...' : 'Sync now') + '</button></div>' : (st.syncMsg ? '<p class="dr-fine">' + esc(st.syncMsg) + '</p>' : '');
    var top = '<section class="dr-card" aria-label="Summary"><div class="ai-sum">' + donut(c) +
      '<div class="ai-sumr"><div class="ai-k"><span class="tl-tap"' + ta('sum:open', 'Open items') + '><b class="num-yellow">' + c.open + '</b><small>open</small></span><span class="tl-tap"' + ta('sum:high', 'High priority') + '><b style="color:#F87171">' + c.high + '</b><small>high</small></span><span class="tl-tap"' + ta('sum:done', 'Done') + '><b style="color:#34D399">' + c.done + '</b><small>done</small></span></div>' +
      ownerBars(c) + '</div></div>' +
      (P ? '<button type="button" class="btn primary btn-glow ai-add" data-ai-add="1">+ Add an action item</button>' :
        '<form class="dr-pin" data-ai-pin="1" autocomplete="off"><input type="password" inputmode="numeric" placeholder="App PIN to check off or add" aria-label="App PIN" /><button type="submit" class="btn primary btn-glow">Unlock</button></form>') + '</section>';
    var form = st.adding && P ? addForm() : '';
    var filt = '<div class="ai-filt" role="group" aria-label="Filter by owner">' + ['', 'Claudio', 'Ben', 'Meshach'].map(function (o) {
      return '<button type="button" class="ai-fb' + (st.owner === o ? ' on' : '') + '" data-ai-owner="' + esc(o) + '">' + esc(o || 'All') + '</button>';
    }).join('') + '</div>';
    var listHtml = '<section class="dr-card" aria-label="Action items"><div class="dr-h"><h3>' + (st.owner ? esc(st.owner) + "'s items" : 'To do') + '</h3><span>tap for why and where</span></div>' + filt +
      (list.length ? '<div class="ai-list">' + list.map(rowHtml).join('') + '</div>' : '<p class="dr-p">Nothing open here.</p>') +
      (nDone ? '<button type="button" class="dr-more" data-ai-done="1">' + (st.showDone ? 'Hide done' : 'Show ' + nDone + ' done') + '</button>' : '') +
      (P ? '' : '<p class="dr-fine">Check-offs and private detail (amounts) need the app PIN.</p>') + '</section>';
    el.innerHTML = (st.toast ? '<div class="dr-toast"><span>' + esc(st.toast) + '</span></div>' : '') +
      '<div class="dr-top"><div><div class="dr-kicker">Sand Lily Pad LLC</div><h2>Action items</h2></div></div>' + sync + top + form + listHtml +
      '<p class="dr-fine">From our records as of ' + esc(md(st.pub.as_of || todayIso())) + '. ' + esc(st.pub.note || '') + '</p>';
  }
  function addForm() {
    var o = ['Claudio', 'Ben', 'Meshach'].map(function (n) { return '<option>' + n + '</option>'; }).join('');
    return '<section class="dr-card" aria-label="Add an action item"><div class="dr-h"><h3>Add an action item</h3><span>syncs with the PIN</span></div>' +
      '<form class="ai-form" data-ai-form="1" autocomplete="off">' +
      '<label><small>What needs doing</small><input name="t" maxlength="90" required placeholder="e.g. Sign the trailer title" /></label>' +
      '<div class="ai-f2"><label><small>Owner</small><select name="o">' + o + '</select></label><label><small>Priority</small><select name="p"><option value="high">High</option><option value="med" selected>Medium</option><option value="low">Low</option></select></label></div>' +
      '<label><small>Due (optional)</small><input name="d" type="date" /></label>' +
      '<label><small>Why (optional, no phone numbers or emails)</small><input name="w" maxlength="120" /></label>' +
      '<div class="ai-f2"><button type="button" class="btn" data-ai-cancel="1">Cancel</button><button type="submit" class="btn primary btn-glow">Add</button></div></form></section>';
  }

  /* ---------- sheets ---------- */
  function openItem(id, refresh) {
    var t = T(), it = itemById(id); if (!t || !it) return;
    if (refresh && !(t.isOpen && t.isOpen() && st.sheetId === id)) return;
    st.sheetId = id;
    var r = calc(it), pr = PR[it.p] || PR.med, P = !!pin();
    var btns = '<div class="ai-stbtns" role="group" aria-label="Status">' +
      '<button type="button" class="ai-stb' + (!r.done ? ' on' : '') + '" data-ai-set="open" data-ai-id="' + esc(id) + '">Open</button>' +
      '<button type="button" class="ai-stb' + (r.done ? ' on' : '') + '" data-ai-set="done" data-ai-id="' + esc(id) + '">Done</button></div>' +
      (P ? '' : '<p class="tl-fine">Enter the app PIN on the Action items page to check this off.</p>');
    var last = r.entry ? '<p class="tl-fine">Last change ' + esc(md(r.entry.date)) + (r.entry.pending ? ' (waiting to sync)' : '') + '</p>' : '';
    var why = it.sens && !P ? 'Details are behind the PIN.' : it.why;
    var steps = (it.steps || []).length ? '<div class="tl-sec">Steps</div><ol class="ai-steps">' + it.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : '';
    var priv = P && r.info.length ? '<div class="tl-sec">Private detail (PIN)</div>' + r.info.map(function (n) { return '<p class="dr-p ai-priv">' + esc(n) + '</p>'; }).join('') : (it.pin_detail && !P ? '<p class="tl-fine">Amounts and private detail: enter the PIN.</p>' : '');
    var go = it.go ? '<button type="button" class="btn primary btn-glow ai-go" data-ai-go="' + esc(it.go) + '">Open ' + esc(it.go_label || 'source') + '</button>' : '';
    var rm = it.user && P ? '<button type="button" class="btn ai-rmv" data-ai-rm="' + esc(id) + '">Remove this item</button>' : '';
    var body = '<div class="tl-hero tl-' + (r.done ? 'ok' : (r.tone === 'bad' ? 'bad' : 'warn')) + '"><b>' + esc(r.done ? 'Done' : (it.due ? whenTxt(r) : 'Open')) + '</b><span>' + esc(it.due ? 'Due ' + ymd(it.due) : 'No due date on file') + '</span></div>' +
      '<div class="ai-pills">' + pill(it.p === 'high' ? 'bad' : (it.p === 'med' ? 'warn' : 'unk'), pr[0] + ' priority') + pill('unk', it.owner) + pill('unk', it.cat) + '</div>' +
      '<div class="tl-sec">Status</div>' + btns + last +
      (it.sens && P ? '' : '<div class="tl-sec">Why</div><p class="dr-p">' + esc(why || 'Added by a partner.') + '</p>') + steps + priv + go + rm;
    t.open({ title: title(it), sub: esc(it.owner + (it.due ? ' | due ' + md(it.due) : '')), body: body });
  }
  function openList(kind) {
    var t = T(); if (!t) return;
    var rs = rows(), list, ttl;
    if (kind.indexOf('own:') === 0) { var n = kind.slice(4); list = rs.filter(function (x) { return x.it.owner === n; }); ttl = n + "'s items"; }
    else if (kind === 'sum:high') { list = rs.filter(function (x) { return !x.r.done && x.it.p === 'high'; }); ttl = 'High priority'; }
    else if (kind === 'sum:done') { list = rs.filter(function (x) { return x.r.done; }); ttl = 'Done'; }
    else { list = rs.filter(function (x) { return !x.r.done; }); ttl = 'Open items'; }
    t.open({ title: ttl, sub: list.length + ' item' + (list.length === 1 ? '' : 's'), body: list.length ? '<div class="tl-rows">' + list.map(function (o) {
      return '<div class="tl-r tl-tap tl-chev"' + ta('it:' + o.it.id, title(o.it) + '. Open') + '><span class="tl-d">' + esc(o.it.due ? md(o.it.due) : '-') + '</span><span class="tl-m"><b>' + esc(title(o.it)) + '</b><small>' + esc(o.it.owner + ' | ' + o.it.cat) + '</small></span><span class="tl-v">' + esc(o.r.done ? 'Done' : (PR[o.it.p] || PR.med)[0]) + '</span></div>';
    }).join('') + '</div>' : '<p class="tl-fine">Nothing here.</p>' });
  }
  function onTile(arg) {
    arg = String(arg || '');
    if (arg.indexOf('it:') === 0) return openItem(arg.slice(3));
    openList(arg);
  }
  function go(g) {
    var a = window.BlackRamApp || {}, t = T();
    if (t && t.close) t.close();
    var i = g.indexOf(':'), k = g.slice(0, i), v = g.slice(i + 1);
    if (k === 'tab') { a.showTab && a.showTab(v); return; }
    if (k === 'dot') { var D = window.BlackRamDot; a.showTab && a.showTab('dot'); if (D && D.openItem) setTimeout(function () { D.openItem(v); }, 150); return; }
    if (k === 'tax') { var X = window.BlackRamTax; a.showTab && a.showTab('tax'); if (X && X.openItem) setTimeout(function () { X.openItem(v); }, 150); return; }
    if (k === 'mt') { var M = window.BlackRamMaintenance; a.showTab && a.showTab('maint'); if (M && M.openItem) setTimeout(function () { M.openItem(v); }, 150); return; }
    if (k === 'jump') { var p = v.split(':'); if (t && t.jump) t.jump(p[0], p[1]); else a.showTab && a.showTab(p[1]); return; }
    if (k === 'go') { var TD = window.BlackRamToday; a.showTab && a.showTab('today'); if (TD && TD.act) setTimeout(function () { TD.act(v); }, 150); }
  }

  /* ---------- styles ---------- */
  function css() {
    if (document.getElementById('ai-css')) return;
    var s = document.createElement('style'); s.id = 'ai-css';
    s.textContent =
      '#ai-root{display:flex;flex-direction:column;gap:var(--s-2)}' +
      '.ai-sum{display:flex;gap:14px;align-items:center}.ai-donut{flex:none}.ai-dn{fill:var(--num-yellow);font-size:28px;font-weight:900}.ai-dl{fill:var(--c-text-3);font-size:11px;font-weight:700}' +
      '.ai-sumr{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px}.ai-k{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.ai-k span{display:flex;flex-direction:column;align-items:center;background:var(--c-surface-2);border-radius:var(--radius-sm);padding:6px 2px;cursor:pointer}.ai-k b{font-size:var(--fs-lg);font-weight:900;line-height:1.05}.ai-k small{font-size:10px;font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.04em}' +
      '.ai-obars{display:flex;flex-direction:column;gap:6px}.ai-obar{display:grid;grid-template-columns:62px 1fr 22px;gap:6px;align-items:center;cursor:pointer;min-height:22px}.ai-on{font-size:12px;font-weight:700;color:var(--c-text-2)}.ai-ot{display:flex;height:10px;border-radius:5px;background:var(--c-surface-3);overflow:hidden}.ai-ot i{display:block;height:100%}.ai-od{background:rgba(52,211,153,.55)}.ai-obar b{text-align:right;font-size:var(--fs-sm);font-weight:900}' +
      '.ai-add{width:100%;margin-top:12px;min-height:var(--tap)}' +
      '.ai-filt{display:flex;gap:6px;flex-wrap:wrap}.ai-fb{min-height:34px;padding:0 14px;border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-2);font:inherit;font-size:12px;font-weight:800;cursor:pointer}.ai-fb.on{border-color:var(--num-yellow);color:var(--c-text-1);background:rgba(242,201,76,.12)}' +
      '.ai-list{display:flex;flex-direction:column;gap:6px}.ai-row{display:flex;align-items:center;gap:10px;background:var(--c-surface-2);border-radius:var(--radius-md);padding:8px 10px}' +
      '.ai-chk{flex:none;width:34px;height:34px;border-radius:50%;border:2px solid var(--c-line-strong);background:transparent;color:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}.ai-chk svg{width:20px;height:20px}.ai-chk.on{background:#34D399;border-color:#34D399;color:#0f0d17}.ai-chk[data-ai-locked]{opacity:.55}' +
      '.ai-rm{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;cursor:pointer;padding:2px 0}.ai-rm b{font-size:var(--fs-sm);color:var(--c-text-1);font-weight:800;line-height:1.25}.ai-rm small{font-size:12px;color:var(--c-text-3);font-weight:700;display:flex;align-items:center;gap:6px}.ai-pd{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none}' +
      '.ai-done .ai-rm b{text-decoration:line-through;color:var(--c-text-3)}' +
      '.ai-pills{display:flex;flex-wrap:wrap;gap:6px}.ai-steps{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px}.ai-steps li{font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.4}' +
      '.ai-priv{background:var(--c-surface-2);border-radius:var(--radius-md);padding:10px 12px}.ai-go,.ai-rmv{width:100%;margin-top:14px;min-height:var(--tap)}' +
      '.ai-stbtns{display:grid;grid-template-columns:1fr 1fr;gap:6px}.ai-stb{min-height:var(--tap);border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-3);color:var(--c-text-1);font:inherit;font-size:13px;font-weight:800;cursor:pointer}.ai-stb.on{border-color:var(--num-yellow);box-shadow:inset 0 0 0 1px var(--num-yellow);background:rgba(242,201,76,.12)}' +
      '.ai-form{display:flex;flex-direction:column;gap:10px}.ai-form label{display:flex;flex-direction:column;gap:4px}.ai-form small{font-size:11px;font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.04em}.ai-form input,.ai-form select{min-height:var(--tap);border-radius:var(--radius-md);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font:inherit;font-size:16px;padding:0 12px}.ai-f2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.ai-f2 .btn{min-height:var(--tap)}';
    document.head.appendChild(s);
  }

  /* ---------- wiring ---------- */
  function bind() {
    var el = root(); if (!el || el.getAttribute('data-ai-bound')) return;
    el.setAttribute('data-ai-bound', '1');
    el.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.closest) return;
      var b;
      if ((b = t.closest('[data-ai-toggle]'))) { var id = b.getAttribute('data-ai-toggle'), it = itemById(id); if (it) setStatus(id, calc(it).done ? 'open' : 'done'); return; }
      if (t.closest('[data-ai-done]')) { st.showDone = !st.showDone; render(); return; }
      if ((b = t.closest('[data-ai-owner]'))) { st.owner = b.getAttribute('data-ai-owner'); render(); return; }
      if (t.closest('[data-ai-add]')) { st.adding = true; render(); var i = el.querySelector('.ai-form input'); if (i) i.focus(); return; }
      if (t.closest('[data-ai-cancel]')) { st.adding = false; render(); return; }
      if (t.closest('[data-ai-sync]')) { if (!pin()) { st.syncMsg = 'Enter the PIN first.'; render(); return; } flush(); fetchSrv(); }
    });
    el.addEventListener('submit', function (e) {
      var f = e.target; if (!f || !f.getAttribute) return;
      if (f.getAttribute('data-ai-pin')) { e.preventDefault(); var i = f.querySelector('input'), v = i ? i.value.trim() : ''; if (v) { setPin(v); st.srv = null; fetchSrv(); render(); } return; }
      if (f.getAttribute('data-ai-form')) { e.preventDefault(); addItem({ t: f.t.value, o: f.o.value, p: f.p.value, d: f.d.value, w: f.w.value }); }
    });
    document.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.closest) return;
      var b = t.closest('[data-ai-set]');
      if (b) { e.preventDefault(); var id = b.getAttribute('data-ai-id'), s = b.getAttribute('data-ai-set'), it = itemById(id); if (!it || calc(it).s === s) return; setStatus(id, s); openItem(id); return; }
      if ((b = t.closest('[data-ai-go]'))) { e.preventDefault(); go(b.getAttribute('data-ai-go')); return; }
      if ((b = t.closest('[data-ai-rm]'))) { e.preventDefault(); removeUser(b.getAttribute('data-ai-rm')); return; }
      if ((b = t.closest('[data-ai-open]'))) { e.preventDefault(); var a = window.BlackRamApp || {}; a.showTab && a.showTab('actions'); }
    });
  }
  function onShow() { loadPublic(); render(); if (pin()) fetchSrv(); flush(); }
  function init() {
    css(); bind();
    var t = T(); if (t) t.on('ai', onTile);
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'actions') onShow(); else st.sheetId = ''; });
    window.addEventListener('online', flush);
    loadPublic();
    if (pin()) fetchSrv();
    if (document.documentElement.getAttribute('data-tab') === 'actions') onShow();
  }
  window.BlackRamActions = {
    ready: function () { return !!st.pub; }, load: loadPublic, render: render, openItem: function (id) { openItem(id); }, donut: donut,
    counts: function () { return st.pub ? counts() : null; },
    top: function (n) { return st.pub ? rows().filter(function (x) { return !x.r.done; }).slice(0, n || 3).map(function (x) { return { id: x.it.id, t: title(x.it), owner: x.it.owner, due: x.it.due, d: x.r.d, p: x.it.p, tone: x.r.tone, when: x.it.due ? whenTxt(x.r) : '', cat: x.it.cat }; }) : []; },
    covers: function () { var out = []; if (!st.pub) return out; rows().forEach(function (x) { if (!x.r.done) (x.it.covers || []).forEach(function (c) { out.push(c); }); }); return out; },
    list: function () { return st.pub ? rows().map(function (x) { return { id: x.it.id, t: title(x.it), owner: x.it.owner, cat: x.it.cat, due: x.it.due, done: x.r.done }; }) : []; }
  };
  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { actions: window.BlackRamActions });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
