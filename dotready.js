/* Black Ram Logistics - DOT Ready tab (v87+). Roadside inspection readiness for the Ram 3500 + Big Tex 25GN, leased on Totni.
   Public part: data/dot_ready.json (items, 49 CFR cites, evidence found in the books and chats, fix, EST cost, no phones, emails,
   license numbers or full VIN). Statuses there are the starting point: OK only where there is evidence, UNKNOWN where there is not.
   Check-offs are saved the same way as the maintenance log: PIN-checked relay POST /maintenance (KV key maint_log, item_id "dot-<item>",
   status and expiry kept in the entry note), with a localStorage queue fallback (blackram_dot_queue_v1) that sends later.
   Items linked to a Maintenance job (annual inspection, brakes, lug nuts, breakaway...) turn OK by themselves when that job is
   checked off in the Maintenance tab (needs the PIN on this phone to read the log).
   Uses v51 tokens; extends window.BlackRamApp (never overwrites it). Plain ASCII text. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var QUEUE_KEY = 'blackram_dot_queue_v1';
  var CACHE_KEY = 'blackram_dot_cache_v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SOON_DAYS = 60;
  var PII_RE = /[\w.+-]+@[\w-]+\.[\w.]+|\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/;
  var st = { pub: null, pubErr: '', srv: null, loading: false, sheet: null, toast: '', toastUndo: '', flushing: false, syncMsg: '', all: false, open: {}, calc: { kind: 'gen', len: 20, wt: 12000, type: 's2', mode: 'over', blocked: false }, cdl: false };
  var toastTimer = 0, flushTimer = 0;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n0(n) { return Math.round(n).toLocaleString('en-US'); }
  function ymd(iso) { var p = String(iso).slice(0, 10).split('-'); return MON[Number(p[1]) - 1] + ' ' + Number(p[2]) + ', ' + p[0]; }
  function md(iso) { var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function utc(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  function addMonths(iso, n) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n, d = +iso.slice(8, 10);
    var dt = new Date(Date.UTC(y, m, 1)); var last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
    dt.setUTCDate(Math.min(d, last));
    return dt.getUTCFullYear() + '-' + ('0' + (dt.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + dt.getUTCDate()).slice(-2);
  }
  function jget(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private mode */ } }
  function root() { return document.getElementById('dr-root'); }
  function newId() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------- data ---------- */
  function loadPublic() {
    if (st.pub || st.pubLoading) return;
    st.pubLoading = true;
    fetch('data/dot_ready.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { st.pub = j; st.pubErr = ''; })
      .catch(function (e) { st.pubErr = 'Could not load the DOT checklist (' + (e && e.message ? e.message : 'offline') + ').'; })
      .then(function () { st.pubLoading = false; render(); if (st.pub && pin()) fetchSrv(); });
  }
  function ping() { try { document.dispatchEvent(new CustomEvent('blackram:dot')); } catch (e) { /* ignore */ } }
  function maintIds() {
    var m = {}; ((st.pub && st.pub.items) || []).forEach(function (it) { (it.maint || []).forEach(function (x) { m[x] = 1; }); });
    return m;
  }
  /* keep only what this tab needs: our dot- entries, and the date of linked maintenance jobs (no costs, no shops) */
  function slim(entries) {
    var mi = maintIds(), out = [];
    (entries || []).forEach(function (e) {
      if (!e || !e.item_id) return;
      if (String(e.item_id).indexOf('dot-') === 0) out.push({ id: e.id, item_id: e.item_id, unit: e.unit, date: e.date, note: e.note || '', at: e.at || '', undone: e.undone ? true : undefined });
      else if (mi[e.item_id]) out.push({ id: e.id, item_id: e.item_id, date: e.date, at: e.at || '', undone: e.undone ? true : undefined, maint: true });
    });
    return out;
  }
  function srvEntries() { if (st.srv) return st.srv; var c = jget(CACHE_KEY, null); return (c && Array.isArray(c.entries)) ? c.entries : []; }
  function fetchSrv() {
    var p = pin();
    if (!p || st.loading) return;
    st.loading = true;
    fetch(RELAY + '/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p, op: 'list' }), cache: 'no-store' })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (resp.ok && j && j.ok && j.data) { st.srv = slim(j.data.entries); jset(CACHE_KEY, { at: Date.now(), entries: st.srv }); st.syncMsg = ''; }
          else if (resp.status === 401) { st.syncMsg = 'Wrong PIN. Your check-offs stay on this phone until the PIN is right.'; }
          else st.syncMsg = 'Could not load the shared log (' + resp.status + '). Showing this phone.';
        });
      })
      .catch(function () { st.syncMsg = 'Offline. Showing this phone.'; })
      .then(function () { st.loading = false; render(); if (st.sheet && st.sheet.mode === 'list') renderSheet(); flush(); });
  }

  /* ---------- check-offs: local queue + relay sync (same pattern as the maintenance log) ---------- */
  function queue() { var q = jget(QUEUE_KEY, []); return Array.isArray(q) ? q : []; }
  function setQueue(q) { jset(QUEUE_KEY, q); }
  function opKey(o) { return o.op + ':' + (o.entry ? o.entry.id : o.id); }
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
  function cmpEntry(a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : ((a.at || '') < (b.at || '') ? -1 : ((a.at || '') > (b.at || '') ? 1 : 0))); }
  function latest(list) { var l = list.filter(function (e) { return !e.undone; }).sort(cmpEntry); return l.length ? l[l.length - 1] : null; }
  function parseNote(n) {
    var m = /^\[(ok|na|bad)\](?: \[exp (\d{4}-\d{2}-\d{2})\])? ?([\s\S]*)$/.exec(n || '');
    return m ? { s: m[1], exp: m[2] || '', text: m[3] || '' } : { s: 'ok', exp: '', text: n || '' };
  }
  function buildNote(s, exp, text) { return ('[' + s + ']' + (exp ? ' [exp ' + exp + ']' : '') + (text ? ' ' + text : '')).slice(0, 290); }
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
        if (r.resp.ok && r.j && r.j.ok) { st.srv = slim(r.j.data && r.j.data.entries); jset(CACHE_KEY, { at: Date.now(), entries: st.srv }); st.syncMsg = ''; drop = true; }
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
        st.flushing = false; render(); renderSheet();
        if (more) flush();
        else if (retry) { if (flushTimer) clearTimeout(flushTimer); flushTimer = setTimeout(flush, 30000); }
      });
  }
  function setToast(text, undoId) {
    st.toast = text; st.toastUndo = undoId || '';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { st.toast = ''; st.toastUndo = ''; render(); }, 12000);
  }
  function addEntry(it, s, date, exp, text) {
    var entry = { id: newId(), item_id: 'dot-' + it.id, unit: it.u === 'trailer' ? 'trailer' : 'truck', date: date, odo: null, cost: null, vendor: '', note: buildNote(s, exp, text), at: new Date().toISOString() };
    var q = queue(); q.push({ op: 'add', entry: entry }); setQueue(q);
    return entry;
  }
  function undoEntry(id) {
    var q = queue(), idx = -1;
    q.forEach(function (o, i) { if (o.op === 'add' && o.entry && o.entry.id === id) idx = i; });
    if (idx >= 0 && !onServer(id)) { q.splice(idx, 1); setQueue(q); }
    else { q = q.filter(function (o) { return !(o.id === id && (o.op === 'undo' || o.op === 'redo')); }); q.push({ op: 'undo', id: id }); setQueue(q); }
    setToast('Undone.'); render(); renderSheet(); flush();
  }
  function redoEntry(id) {
    var q = queue().filter(function (o) { return !(o.id === id && (o.op === 'undo' || o.op === 'redo')); });
    q.push({ op: 'redo', id: id }); setQueue(q); render(); renderSheet(); flush();
  }

  /* ---------- status math ---------- */
  var LBL = { ok: 'OK', gap: 'MISSING', bad: 'PROBLEM', unk: 'UNKNOWN - verify', soon: 'DUE SOON', stale: 'RE-CHECK', na: 'N/A' };
  function itemById(id) { return ((st.pub && st.pub.items) || []).filter(function (x) { return x.id === id; })[0]; }
  function calc(it) {
    var all = effEntries(), today = todayIso();
    var mine = all.filter(function (e) { return e.item_id === 'dot-' + it.id; });
    var le = latest(mine), r = { s: it.s, label: it.badge || LBL[it.s] || '', date: '', exp: it.exp || '', src: 'base', days: null, entry: le };
    var sinceChk = null;
    if (le) {
      var pn = parseNote(le.note);
      r.src = 'you'; r.date = le.date; r.text = pn.text;
      if (pn.s === 'na') { r.s = 'na'; r.label = LBL.na; r.exp = ''; }
      else if (pn.s === 'bad') { r.s = 'gap'; r.label = LBL.bad; r.exp = pn.exp; }
      else { r.s = 'ok'; r.label = LBL.ok; r.exp = pn.exp; sinceChk = le.date; }
    } else if (it.maint && it.maint.length) {
      var dates = [], okAll = true;
      it.maint.forEach(function (mid) {
        var l = latest(all.filter(function (e) { return e.item_id === mid; }));
        if (l) dates.push(l.date); else okAll = false;
      });
      if (okAll && dates.length) {
        dates.sort(); r.s = 'ok'; r.label = LBL.ok; r.src = 'maint'; r.date = dates[0]; sinceChk = dates[0];
        r.exp = it.maint_exp_months ? addMonths(dates[0], it.maint_exp_months) : '';
      }
    }
    if (r.s === 'ok' && r.exp) {
      var d = daysBetween(today, r.exp); r.days = d;
      if (d < 0) { r.s = 'gap'; r.label = 'EXPIRED'; }
      else if (d <= SOON_DAYS) { r.s = 'soon'; r.label = 'DUE SOON'; }
    }
    if (r.s === 'ok' && it.ttl && sinceChk && daysBetween(sinceChk, today) > it.ttl) { r.s = 'stale'; r.label = LBL.stale; }
    return r;
  }
  function rows() { return ((st.pub && st.pub.items) || []).map(function (it) { return { it: it, r: calc(it) }; }); }
  function val(r) { return r.s === 'ok' ? 1 : (r.s === 'soon' ? 0.5 : 0); }
  function score(rs) {
    var tw = 0, got = 0, c = { ok: 0, soon: 0, unk: 0, gap: 0, na: 0 };
    rs.forEach(function (x) {
      var k = (x.r.s === 'stale') ? 'unk' : x.r.s;
      c[k] = (c[k] || 0) + 1;
      if (x.r.s === 'na') return;
      tw += x.it.w; got += x.it.w * val(x.r);
    });
    return { pct: tw ? Math.round(100 * got / tw) : 0, c: c, n: rs.length - c.na };
  }
  function tone(s) { return s === 'ok' ? 'ok' : (s === 'soon' ? 'warn' : (s === 'gap' ? 'bad' : (s === 'na' ? 'na' : 'unk'))); }
  var ORDER = { gap: 0, soon: 1, unk: 2, stale: 2, ok: 3, na: 4 };
  function cmpRows(a, b) { var d = ORDER[a.r.s] - ORDER[b.r.s]; return d || (b.it.w - a.it.w) || 0; }
  function money(lo, hi) { if (!lo && !hi) return 'about $0'; return lo === hi ? '$' + n0(lo) : '$' + n0(lo) + '-' + n0(hi); }
  function costOf(list) {
    var lo = 0, hi = 0; list.forEach(function (x) { lo += x.it.lo || 0; hi += x.it.hi || 0; }); return [lo, hi];
  }
  function dueTxt(r) {
    if (r.days == null) return '';
    return r.days < 0 ? 'expired ' + (-r.days) + ' d ago' : r.days + ' d left';
  }

  function chev() {
    return '<svg class="dr-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  var LIST_META = {
    gaps: { title: 'Known gaps', sub: 'Missing and due soon first, then unknown' },
    gap: { title: 'Missing', sub: 'Items marked missing' },
    soon: { title: 'Due soon', sub: 'Within 60 days of expiry' },
    unk: { title: 'Unknown', sub: 'No evidence yet. Verify each one.' },
    ok: { title: 'OK', sub: 'Has evidence or a check-off' }
  };
  function listWant(kind) {
    if (kind === 'gaps') return function (x) { return x.r.s === 'gap' || x.r.s === 'soon' || x.r.s === 'unk' || x.r.s === 'stale'; };
    if (kind === 'gap') return function (x) { return x.r.s === 'gap'; };
    if (kind === 'soon') return function (x) { return x.r.s === 'soon'; };
    if (kind === 'unk') return function (x) { return x.r.s === 'unk' || x.r.s === 'stale'; };
    if (kind === 'ok') return function (x) { return x.r.s === 'ok'; };
    return function () { return false; };
  }
  function listRows(kind) { return rows().filter(listWant(kind)).sort(cmpRows); }
  function listCount(list) {
    var c = { gap: 0, soon: 0, unk: 0, ok: 0 };
    list.forEach(function (x) { if (x.r.s === 'gap') c.gap++; else if (x.r.s === 'soon') c.soon++; else if (x.r.s === 'ok') c.ok++; else if (x.r.s === 'unk' || x.r.s === 'stale') c.unk++; });
    var bits = [];
    if (c.gap) bits.push(c.gap + ' missing');
    if (c.soon) bits.push(c.soon + ' due soon');
    if (c.unk) bits.push(c.unk + ' unknown');
    if (c.ok) bits.push(c.ok + ' OK');
    return bits.join(', ') || 'None';
  }

  /* ---------- charts ---------- */
  function donut(c, pct) {
    var R = 46, C = 2 * Math.PI * R, parts = [['ok', c.ok, 'var(--c-take)'], ['soon', c.soon, 'var(--c-maybe)'], ['unk', c.unk, '#8F86B8'], ['gap', c.gap, '#F87171']];
    var tot = c.ok + c.soon + c.unk + c.gap || 1, off = 0, segs = '';
    parts.forEach(function (p) {
      if (!p[1]) return;
      var len = C * p[1] / tot;
      segs += '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="' + p[2] + '" stroke-width="14" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 60 60)"></circle>';
      off += len;
    });
    return '<svg class="dr-donut" viewBox="0 0 120 120" role="img" aria-label="Readiness ' + pct + ' percent"><circle cx="60" cy="60" r="' + R + '" fill="none" stroke="var(--c-surface-3)" stroke-width="14"></circle>' + segs +
      '<text x="60" y="58" text-anchor="middle" class="dr-dn">' + pct + '%</text><text x="60" y="75" text-anchor="middle" class="dr-dl">proven ready</text></svg>';
  }
  function stack(c, tot) {
    var t = tot || 1, o = '';
    [['ok', c.ok], ['soon', c.soon], ['unk', c.unk], ['gap', c.gap]].forEach(function (p) { if (p[1]) o += '<i class="dr-sg dr-sg-' + p[0] + '" style="width:' + (100 * p[1] / t).toFixed(1) + '%"></i>'; });
    return '<span class="dr-stack" aria-hidden="true">' + o + '</span>';
  }

  /* ---------- pieces ---------- */
  function pill(s, t) { return '<span class="dr-pill dr-pill-' + tone(s) + '">' + esc(t) + '</span>'; }
  function rowHtml(x) {
    var it = x.it, r = x.r, soonTxt = dueTxt(r);
    var meta = pill(r.s === 'stale' ? 'unk' : r.s, r.label) + (soonTxt ? '<span class="dr-m">' + esc(soonTxt) + '</span>' : '') +
      (r.src === 'maint' ? '<span class="dr-m">from Maintenance</span>' : '') + '<span class="dr-m dr-cfr">' + esc(it.cfr.split(';')[0]) + '</span>';
    var chk = '<button type="button" class="dr-chk dr-chk-' + tone(r.s === 'stale' ? 'unk' : r.s) + '" data-dr-chk="' + esc(it.id) + '" aria-label="' + (r.s === 'ok' ? 'Open ' : 'Mark OK today: ') + esc(it.t) + '">' + (r.s === 'ok' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '') + '</button>';
    return '<div class="dr-row dr-row-' + tone(r.s === 'stale' ? 'unk' : r.s) + '">' + chk +
      '<button type="button" class="dr-main" data-dr-open="' + esc(it.id) + '"><b>' + esc(it.t) + '</b><span class="dr-meta">' + meta + '</span></button></div>';
  }
  function secScore(rs, S) {
    var gaps = rs.filter(function (x) { return x.r.s === 'gap'; }), unk = rs.filter(function (x) { return x.r.s === 'unk' || x.r.s === 'stale'; });
    var cg = costOf(gaps), cu = costOf(unk);
    var leg = [['ok', 'OK', S.c.ok, 'ok'], ['soon', 'Due soon', S.c.soon, 'soon'], ['unk', 'Unknown', S.c.unk, 'unk'], ['gap', 'Missing', S.c.gap, 'gap']].map(function (p) {
      return '<button type="button" class="dr-leg" data-dr-list="' + p[3] + '" aria-label="Open ' + p[1] + ' list, ' + p[2] + ' items"><i class="dr-sg dr-sg-' + p[0] + '"></i><span>' + p[1] + '</span><b>' + p[2] + '</b>' + chev() + '</button>';
    }).join('');
    var groups = (st.pub.groups || []).map(function (g) {
      var list = rs.filter(function (x) { return x.it.g === g.id && x.r.s !== 'na'; }), s2 = score(list);
      return '<a class="dr-gb" href="#dr-g-' + esc(g.id) + '" data-dr-jump="' + esc(g.id) + '"><span>' + esc(g.name) + '</span>' + stack({ ok: s2.c.ok, soon: s2.c.soon, unk: s2.c.unk, gap: s2.c.gap }, list.length) + '<b>' + s2.pct + '%</b></a>';
    }).join('');
    return '<section class="dr-card dr-score"><div class="dr-sc-top">' + donut(S.c, S.pct) + '<div class="dr-legs">' + leg + '</div></div>' +
      '<div class="dr-sub">By group (weighted, % proven ready)</div><div class="dr-gbs">' + groups + '</div>' +
      '<div class="dr-tiles">' +
      '<button type="button" class="dr-tile dr-t-cdl" data-dr-cdl="1" aria-expanded="' + st.cdl + '"><span class="dr-tile-h">CDL' + chev() + '</span><b>' + esc(st.pub.cdl.verdict.replace(' CDL required', '')) + '</b><small>Tap for the math</small></button>' +
      '<button type="button" class="dr-tile dr-t-bad" data-dr-list="gaps" aria-label="Open known gaps"><span class="dr-tile-h">Known gaps' + chev() + '</span><b>' + gaps.length + '</b><small>EST ' + esc(money(cg[0], cg[1])) + '</small></button>' +
      '<button type="button" class="dr-tile" data-dr-list="unk" aria-label="Open unknowns"><span class="dr-tile-h">Unknowns' + chev() + '</span><b>' + unk.length + '</b><small>up to EST ' + esc(money(cu[0], cu[1])) + '</small></button></div>' +
      '<p class="dr-fine">Proven ready counts only what has evidence or a check-off. Unknown is not OK. Costs are EST. For the unknowns the cost is what it would be if each one turns out to be missing.</p></section>';
  }
  function secCdl() {
    var C = st.pub.cdl;
    var body = '<div class="dr-rows">' + C.lines.map(function (l) { return '<div class="dr-r"><span>' + esc(l[0]) + '</span><b>' + esc(l[1]) + '</b></div>'; }).join('') + '</div>' +
      '<p class="dr-p">' + esc(C.why) + '</p><p class="dr-p">' + esc(C.also) + '</p><p class="dr-fine">Source: ' + esc(C.src) + '</p>';
    return '<section class="dr-card dr-cdl" id="dr-cdl"><button type="button" class="dr-h dr-h-btn" data-dr-cdl="1" aria-expanded="' + st.cdl + '"><h3>' + esc(C.verdict) + '</h3><span>' + (st.cdl ? 'Hide' : 'Show the math') + '</span></button>' +
      (st.cdl ? body : '<p class="dr-p dr-p-s">39,900 lb combined rating and a 25,900 lb trailer: over both CDL lines. The rating counts, not the load.</p>') + '</section>';
  }
  function secFix(rs) {
    var todo = rs.filter(function (x) { return x.r.s !== 'ok' && x.r.s !== 'na'; }).sort(cmpRows);
    var show = st.all ? todo : todo.slice(0, 7);
    if (!todo.length) return '<section class="dr-card"><div class="dr-h"><h3>Fix first</h3></div><p class="dr-p">Nothing open. Keep the check-offs fresh.</p></section>';
    return '<section class="dr-card" id="dr-fix"><div class="dr-h"><h3>Fix first</h3><span>' + todo.length + ' open, missing first</span></div><div class="dr-list">' + show.map(rowHtml).join('') + '</div>' +
      (todo.length > 7 ? '<button type="button" class="dr-more" data-dr-all="1">' + (st.all ? 'Show fewer' : 'Show all ' + todo.length + ' open') + '</button>' : '') + '</section>';
  }
  function secGroup(g, rs) {
    var list = rs.filter(function (x) { return x.it.g === g.id; }).sort(cmpRows), s2 = score(list.filter(function (x) { return x.r.s !== 'na'; }));
    var open = st.open[g.id];
    return '<section class="dr-card dr-gcard" id="dr-g-' + esc(g.id) + '"><button type="button" class="dr-h dr-h-btn" data-dr-grp="' + esc(g.id) + '" aria-expanded="' + (open ? 'true' : 'false') + '"><h3>' + esc(g.name) + '</h3><span>' + s2.pct + '% | ' + list.length + ' items ' + (open ? '(hide)' : '(show)') + '</span></button>' +
      stack({ ok: s2.c.ok, soon: s2.c.soon, unk: s2.c.unk, gap: s2.c.gap }, s2.n) +
      (open ? '<div class="dr-list">' + list.map(rowHtml).join('') + '</div>' + (g.id === 'crg' ? calcHtml() : '') : '') + '</section>';
  }

  /* ---------- tiedown calculator (49 CFR 393.110, 393.106(d), 393.128, 393.130) ---------- */
  var TYPES = { s2: ['2 in ratchet strap (typical WLL 3,333)', 3333], s4: ['4 in winch strap (typical WLL 5,400)', 5400], c58: ['5/16 in grade 70 chain (typical WLL 4,700)', 4700], c38: ['3/8 in grade 70 chain (typical WLL 6,600)', 6600] };
  function calcOut() {
    var c = st.calc, L = Number(c.len), W = Number(c.wt);
    if (!(L > 0) || !(W >= 0)) return '<p class="dr-fine">Enter a length and a weight.</p>';
    var n1;
    if (c.blocked) n1 = Math.max(1, Math.ceil(L / 10));
    else if (L <= 5) n1 = W > 1100 ? 2 : 1;
    else if (L <= 10) n1 = 2;
    else n1 = 2 + Math.ceil((L - 10) / 10);
    var minKind = 1, why = '393.110';
    if (c.kind === 'veh') { minKind = 2; why = '393.128: at least 2'; }
    if (c.kind === 'mach') { minKind = 4; why = '393.130(c): at least 4'; }
    var T = TYPES[c.type] || TYPES.s2, per = T[1] * (c.mode === 'over' ? 1 : 0.5);
    var need = W * 0.5, n2 = Math.ceil(need / per);
    var n = Math.max(n1, minKind, n2);
    var bind = n === n2 && n2 > Math.max(n1, minKind) ? 'weight (WLL)' : (minKind > n1 ? why : 'length rule');
    return '<div class="dr-calc-out"><b>' + n + ' tiedowns minimum</b><span>Length rule ' + n1 + (minKind > 1 ? ', cargo-type minimum ' + minKind : '') + ', weight rule ' + n2 + '. Driven by the ' + esc(bind) + '.</span>' +
      '<span>Total working load limit needed: ' + n0(need) + ' lb (half the cargo weight, 393.106(d)). Each ' + (c.mode === 'over' ? 'strap over the load to the other side counts its full WLL' : 'chain or strap that ends on the same side or on the cargo counts half its WLL') + '.</span></div>';
  }
  function calcHtml() {
    var c = st.calc;
    var opts = Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (c.type === k ? ' selected' : '') + '>' + esc(TYPES[k][0]) + '</option>'; }).join('');
    return '<div class="dr-calc"><div class="dr-sub">Tiedown calculator</div><div class="dr-calc-g">' +
      '<label>Cargo<select id="dr-c-kind"><option value="gen"' + (c.kind === 'gen' ? ' selected' : '') + '>General article</option><option value="veh"' + (c.kind === 'veh' ? ' selected' : '') + '>Car, light truck or van (10,000 lb or less)</option><option value="mach"' + (c.kind === 'mach' ? ' selected' : '') + '>Wheeled or tracked machinery (10,000 lb or more)</option></select></label>' +
      '<label>Length (ft)<input id="dr-c-len" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(c.len) + '" /></label>' +
      '<label>Weight (lb)<input id="dr-c-wt" type="number" inputmode="numeric" min="0" step="100" value="' + esc(c.wt) + '" /></label>' +
      '<label>Tiedown<select id="dr-c-type">' + opts + '</select></label>' +
      '<label>How it goes<select id="dr-c-mode"><option value="over"' + (c.mode === 'over' ? ' selected' : '') + '>Over the load to the other side</option><option value="half"' + (c.mode === 'half' ? ' selected' : '') + '>Same side, or end on the cargo</option></select></label>' +
      '<label class="dr-c-chk"><input id="dr-c-blk" type="checkbox"' + (c.blocked ? ' checked' : '') + ' /> Blocked in front by a headerboard or bulkhead (393.110(c))</label></div>' +
      '<div id="dr-c-out">' + calcOut() + '</div><p class="dr-fine">WLL values are typical. Read the tag on yours. This is the minimum, add more for rough roads or a slick load.</p></div>';
  }

  /* ---------- sheet ---------- */
  function sheetHost() {
    var h = document.getElementById('dr-sheet');
    if (!h) {
      h = document.createElement('div'); h.id = 'dr-sheet'; h.className = 'dr-sheet'; h.hidden = true;
      document.body.appendChild(h);
      h.addEventListener('click', function (e) {
        var t = e.target, b;
        if (t && t.hasAttribute && t.hasAttribute('data-dr-close')) { closeSheet(); return; }
        if (!t || !t.closest) return;
        if ((b = t.closest('[data-dr-chk]'))) { quickCheck(b.getAttribute('data-dr-chk')); return; }
        if ((b = t.closest('[data-dr-open]'))) { openSheet(b.getAttribute('data-dr-open')); return; }
        b = t.closest('[data-dr-save],[data-dr-undo],[data-dr-redo]');
        if (!b) return;
        if (b.hasAttribute('data-dr-save')) saveSheet(b.getAttribute('data-dr-save'));
        else if (b.hasAttribute('data-dr-undo')) undoEntry(b.getAttribute('data-dr-undo'));
        else if (b.hasAttribute('data-dr-redo')) redoEntry(b.getAttribute('data-dr-redo'));
      });
      h.addEventListener('input', function (e) {
        var t = e.target; if (!t || !st.sheet) return;
        var f = st.sheet.f;
        if (t.id === 'dr-f-date') f.date = t.value; else if (t.id === 'dr-f-exp') f.exp = t.value; else if (t.id === 'dr-f-note') f.note = t.value;
        else calcInput(t);
      });
      h.addEventListener('change', function (e) { calcInput(e.target); });
    }
    return h;
  }
  function openList(kind) {
    if (!LIST_META[kind]) return;
    st.sheet = { mode: 'list', kind: kind, scroll: 0 };
    renderSheet();
    var h = sheetHost(), c = h.querySelector('.dr-sh-x'); if (c) c.focus();
  }
  function openSheet(id) {
    var it = itemById(id); if (!it) return;
    var r = calc(it);
    var back = null;
    if (st.sheet && st.sheet.mode === 'list') {
      var body = document.querySelector('#dr-sheet .dr-sh-body');
      back = { mode: 'list', kind: st.sheet.kind, scroll: body ? body.scrollTop : 0 };
    } else if (st.sheet && st.sheet.back) back = st.sheet.back;
    st.sheet = { mode: 'item', id: id, f: { date: todayIso(), exp: (r.exp && r.src !== 'base') ? r.exp : (it.exp || ''), note: '' }, err: '', back: back };
    renderSheet();
    var h = sheetHost(), c = h.querySelector('.dr-sh-x'); if (c) c.focus();
  }
  function dismissSheet() { st.sheet = null; renderSheet(); }
  function closeSheet() {
    if (st.sheet && st.sheet.mode === 'item' && st.sheet.back) { st.sheet = st.sheet.back; renderSheet(); return; }
    dismissSheet();
  }
  function histRow(e) {
    var pn = parseNote(e.note), lab = pn.s === 'na' ? 'N/A' : (pn.s === 'bad' ? 'Problem' : 'OK');
    return '<div class="dr-hrow' + (e.undone ? ' dr-undone' : '') + '"><div class="dr-hrow-m"><b>' + ymd(e.date) + ' | ' + lab + (pn.exp ? ' | expires ' + ymd(pn.exp) : '') + '</b>' +
      (pn.text ? '<span>' + esc(pn.text) + '</span>' : '') + (e.pending ? '<span class="dr-chip">Waiting to sync</span>' : '') + (e.undone ? '<span class="dr-chip">Undone</span>' : '') + '</div>' +
      (e.undone ? '<button type="button" class="dr-mini" data-dr-redo="' + esc(e.id) + '">Restore</button>' : '<button type="button" class="dr-mini" data-dr-undo="' + esc(e.id) + '">Undo</button>') + '</div>';
  }
  function renderListSheet() {
    var h = sheetHost(), kind = st.sheet.kind, meta = LIST_META[kind] || LIST_META.gaps, list = listRows(kind);
    var keep = st.sheet.scroll || 0;
    h.hidden = false; document.documentElement.classList.add('dr-noscroll');
    var cost = '';
    if (kind === 'gaps' || kind === 'gap' || kind === 'unk' || kind === 'soon') {
      var c = costOf(list);
      cost = '<p class="dr-fine">' + (kind === 'unk' ? 'Up to EST ' : 'EST ') + esc(money(c[0], c[1])) + (kind === 'unk' || kind === 'gaps' ? ' if each unknown turns out to be missing. Costs are EST.' : '. Costs are EST.') + '</p>';
    }
    var body = list.length ? '<div class="dr-list">' + list.map(rowHtml).join('') + '</div>' : '<p class="dr-p">None in this group.</p>';
    h.innerHTML = '<div class="dr-sh-bd" data-dr-close="1"></div><div class="dr-sh-p" role="dialog" aria-modal="true" aria-label="' + esc(meta.title) + '"><div class="dr-sh-grab" aria-hidden="true"></div>' +
      '<div class="dr-sh-h"><div><b>' + esc(meta.title) + '</b><span>' + esc(listCount(list)) + '. ' + esc(meta.sub) + '</span></div><button type="button" class="dr-sh-x" data-dr-close="1" aria-label="Close">Close</button></div>' +
      '<div class="dr-sh-body">' + cost + body + '<p class="dr-fine">Tap a row for the fix, the cost, the citation and the check-off form.</p></div></div>';
    var nb = h.querySelector('.dr-sh-body'); if (nb) nb.scrollTop = keep;
  }
  function renderSheet() {
    var h = sheetHost();
    if (!st.sheet || !st.pub) { h.hidden = true; h.innerHTML = ''; document.documentElement.classList.remove('dr-noscroll'); return; }
    if (st.sheet.mode === 'list') { renderListSheet(); return; }
    var it = itemById(st.sheet.id); if (!it) { st.sheet = null; renderSheet(); return; }
    var r = calc(it), f = st.sheet.f;
    var mine = effEntries().filter(function (e) { return e.item_id === 'dot-' + it.id; }).sort(cmpEntry).reverse();
    var scroll = h.querySelector('.dr-sh-body'), keep = scroll ? scroll.scrollTop : 0;
    h.hidden = false; document.documentElement.classList.add('dr-noscroll');
    var cost = (it.lo != null && it.hi != null && (it.lo || it.hi)) ? '<p class="dr-p"><b>Cost (EST):</b> ' + esc(money(it.lo, it.hi)) + '</p>' : '';
    var links = (it.links || []).map(function (l) { return '<a class="dr-link" href="' + esc(l[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(l[0]) + '</a>'; }).join('');
    var showExp = !!(it.wantexp || it.exp || it.maint_exp_months);
    h.innerHTML = '<div class="dr-sh-bd" data-dr-close="1"></div><div class="dr-sh-p" role="dialog" aria-modal="true" aria-label="' + esc(it.t) + '"><div class="dr-sh-grab" aria-hidden="true"></div>' +
      '<div class="dr-sh-h"><div><b>' + esc(it.t) + '</b><span>' + esc(it.cfr) + '</span></div><button type="button" class="dr-sh-x" data-dr-close="1" aria-label="' + (st.sheet.back ? 'Back to the list' : 'Close') + '">' + (st.sheet.back ? 'Back' : 'Close') + '</button></div>' +
      '<div class="dr-sh-body"><div class="dr-sh-info">' + pill(r.s === 'stale' ? 'unk' : r.s, r.label) + (r.date ? '<span class="dr-m">' + (r.src === 'maint' ? 'Maintenance job done ' : 'Checked ') + ymd(r.date) + '</span>' : '') + (dueTxt(r) ? '<span class="dr-m">' + esc(dueTxt(r)) + (r.exp ? ' (' + ymd(r.exp) + ')' : '') + '</span>' : '') + '</div>' +
      '<div class="dr-sub">What we found</div><p class="dr-p">' + esc(it.ev) + '</p>' +
      '<div class="dr-sub">What the inspector checks</div><p class="dr-p">' + esc(it.why) + '</p>' +
      '<div class="dr-sub">Fix</div><p class="dr-p">' + esc(it.fix) + '</p>' + cost + (links ? '<div class="dr-links">' + links + '</div>' : '') +
      (it.id === 'c-count' ? calcHtml() : '') +
      '<form class="dr-form" id="dr-form" autocomplete="off" novalidate><div class="dr-sub">Check it off</div>' +
      '<label>Date checked<input id="dr-f-date" type="date" max="' + todayIso() + '" value="' + esc(f.date) + '" /></label>' +
      (showExp ? '<label>Expires (optional)<input id="dr-f-exp" type="date" value="' + esc(f.exp) + '" /><small>Turns amber 60 days before and red when it lapses.</small></label>' : '') +
      '<label>Note (optional)<textarea id="dr-f-note" rows="2" maxlength="240" placeholder="What you saw. No phone numbers or emails.">' + esc(f.note) + '</textarea></label>' +
      (st.sheet.err ? '<p class="dr-err" role="alert">' + esc(st.sheet.err) + '</p>' : '') +
      '<div class="dr-btns"><button type="button" class="btn primary dr-save" data-dr-save="ok">Mark OK</button><button type="button" class="btn dr-save2" data-dr-save="bad">Flag a problem</button><button type="button" class="btn dr-save2" data-dr-save="na">Not applicable</button></div>' +
      (pin() ? '' : '<p class="dr-fine">No PIN on this phone: it will be saved here and sent once you enter the PIN on this tab.</p>') + '</form>' +
      '<div class="dr-sub">History</div>' + (mine.length ? '<div class="dr-hist">' + mine.map(histRow).join('') + '</div>' : '<p class="dr-fine">No check-offs yet.</p>') + '</div></div>';
    var nb = h.querySelector('.dr-sh-body'); if (nb) nb.scrollTop = keep;
  }
  function saveSheet(kind) {
    var s = st.sheet; if (!s) return;
    var it = itemById(s.id), f = s.f;
    function fail(m) { s.err = m; renderSheet(); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') || isNaN(utc(f.date))) return fail('Pick the date.');
    if (f.date > todayIso()) return fail('That date is in the future.');
    var exp = (f.exp || '').trim();
    if (exp && (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || isNaN(utc(exp)))) return fail('Check the expiry date.');
    var note = String(f.note || '').trim().slice(0, 240);
    if (PII_RE.test(note)) return fail('Leave phone numbers and emails out of the log.');
    var entry = addEntry(it, kind, f.date, kind === 'ok' ? exp : '', note);
    setToast((kind === 'ok' ? 'Checked off: ' : (kind === 'na' ? 'Marked N/A: ' : 'Flagged: ')) + it.t + '. ' + (pin() ? 'Saving to every device...' : 'Saved on this phone. Enter the PIN to sync.'), entry.id);
    closeSheet(); render(); flush();
  }
  function quickCheck(id) {
    var it = itemById(id); if (!it) return;
    var r = calc(it);
    if ((r.s === 'ok' && r.src !== 'base') || it.wantexp || it.exp || it.maint_exp_months) { openSheet(id); return; }
    var entry = addEntry(it, 'ok', todayIso(), '', '');
    setToast('Checked off: ' + it.t + '. ' + (pin() ? 'Saving to every device...' : 'Saved on this phone. Enter the PIN to sync.'), entry.id);
    render(); if (st.sheet && st.sheet.mode === 'list') renderSheet(); flush();
  }
  function calcInput(t) {
    if (!t || !t.id) return;
    var c = st.calc, m = { 'dr-c-kind': 'kind', 'dr-c-len': 'len', 'dr-c-wt': 'wt', 'dr-c-type': 'type', 'dr-c-mode': 'mode' };
    if (m[t.id]) c[m[t.id]] = t.value; else if (t.id === 'dr-c-blk') c.blocked = !!t.checked; else return;
    var outs = document.querySelectorAll('#dr-c-out'); for (var i = 0; i < outs.length; i++) outs[i].innerHTML = calcOut();
  }

  /* ---------- page ---------- */
  function render() {
    ping();
    var el = root(); if (!el) return;
    if (st.pubErr) { el.innerHTML = '<section class="dr-card"><p class="dr-p">' + esc(st.pubErr) + '</p></section>'; return; }
    if (!st.pub) { el.innerHTML = '<section class="dr-card"><p class="dr-p">Loading the DOT checklist...</p></section>'; return; }
    var rs = rows(), S = score(rs), q = queue().length;
    var toast = st.toast ? '<div class="dr-toast"><span>' + esc(st.toast) + '</span>' + (st.toastUndo ? '<button type="button" class="dr-mini" data-dr-toastundo="' + esc(st.toastUndo) + '">Undo</button>' : '') + '</div>' : '';
    var sync = q ? '<div class="dr-sync"><span>' + q + ' waiting to sync' + (st.syncMsg ? '. ' + esc(st.syncMsg) : '') + '</span><button type="button" class="dr-mini" id="dr-sync">' + (st.flushing ? 'Sending...' : 'Sync now') + '</button></div>' : (st.syncMsg ? '<p class="dr-fine">' + esc(st.syncMsg) + '</p>' : '');
    var pinForm = pin() ? '' : '<form id="dr-pin-form" class="dr-pin" autocomplete="off"><input id="dr-pin" type="password" inputmode="numeric" placeholder="App PIN to sync" aria-label="App PIN" /><button type="submit" class="btn primary">Unlock</button></form>';
    var P = st.pub;
    el.innerHTML = toast +
      '<div class="dr-top"><div><div class="dr-kicker">Roadside inspection</div><h2>DOT Ready</h2></div></div>' +
      '<p class="dr-sub1">' + esc(P.rig) + '. Operating carrier: ' + esc(P.carrier) + '. Driver: ' + esc(P.driver) + '. Built on the CVSA Level I procedure and 49 CFR Parts 376 to 396.</p>' +
      sync + pinForm + secScore(rs, S) + secCdl() + secFix(rs) +
      (P.groups || []).map(function (g) { return secGroup(g, rs); }).join('') +
      '<section class="dr-card"><div class="dr-h"><h3>Sources</h3></div><ul class="dr-src">' + (P.sources || []).map(function (s2) { return '<li><a class="dr-link" href="' + esc(s2[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(s2[0]) + '</a></li>'; }).join('') + '</ul>' +
      '<p class="dr-fine">Checklist, not legal advice. Evidence comes from the ledger, receipts and the partner chats up to 11/26/2026. Where there was none the item says UNKNOWN. Totni write-ups quoted here are from its public FMCSA record and may involve other trucks.</p></section>';
  }
  function bind() {
    var el = root(); if (!el || el.getAttribute('data-dr-bound')) return;
    el.setAttribute('data-dr-bound', '1');
    el.addEventListener('click', function (e) {
      var t = e.target, b;
      if (!t || !t.closest) return;
      if ((b = t.closest('[data-dr-chk]'))) { quickCheck(b.getAttribute('data-dr-chk')); return; }
      if ((b = t.closest('[data-dr-open]'))) { openSheet(b.getAttribute('data-dr-open')); return; }
      if ((b = t.closest('[data-dr-list]'))) { openList(b.getAttribute('data-dr-list')); return; }
      if ((b = t.closest('[data-dr-grp]'))) { var g = b.getAttribute('data-dr-grp'); st.open[g] = !st.open[g]; render(); return; }
      if (t.closest('[data-dr-cdl]')) { st.cdl = !st.cdl; render(); var c = document.getElementById('dr-cdl'); if (st.cdl && c && c.scrollIntoView) c.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      if (t.closest('[data-dr-all]')) { st.all = !st.all; render(); return; }
      if ((b = t.closest('[data-dr-jump]'))) { e.preventDefault(); var id = b.getAttribute('data-dr-jump'); st.open[id] = true; render(); var s = document.getElementById('dr-g-' + id); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      if ((b = t.closest('[data-dr-toastundo]'))) { undoEntry(b.getAttribute('data-dr-toastundo')); return; }
      if (t.closest('#dr-sync')) { if (!pin()) { st.syncMsg = 'Enter the PIN first.'; render(); return; } flush(); fetchSrv(); return; }
    });
    el.addEventListener('submit', function (e) {
      if (e.target && e.target.id === 'dr-pin-form') {
        e.preventDefault(); var i = document.getElementById('dr-pin'), v = i ? i.value.trim() : '';
        if (v) { setPin(v); st.srv = null; fetchSrv(); render(); }
      }
    });
    el.addEventListener('input', function (e) { calcInput(e.target); });
    el.addEventListener('change', function (e) { calcInput(e.target); });
  }

  function css() {
    if (document.getElementById('dr-css')) return;
    var s = document.createElement('style'); s.id = 'dr-css';
    s.textContent =
      '#dr-root{display:flex;flex-direction:column;gap:var(--s-2)}' +
      '.dr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--s-1)}' +
      '.dr-kicker{font-size:var(--fs-xs);font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c-gold)}' +
      '.dr-top h2{margin:0;font-size:var(--fs-2xl);font-weight:var(--fw-black);color:var(--c-text-1);letter-spacing:-.01em}' +
      '.dr-sub1{margin:-6px 0 0;font-size:var(--fs-sm);color:var(--c-text-3);line-height:1.4}' +
      '.dr-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg);padding:var(--s-2) var(--s-2) var(--s-1h);display:flex;flex-direction:column;gap:var(--s-1h);scroll-margin-top:calc(var(--appbar-h) + 8px)}' +
      '.dr-h{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-1);flex-wrap:wrap}.dr-h h3{margin:0;font-size:var(--fs-lg);font-weight:var(--fw-black);color:var(--c-text-1);text-align:left}.dr-h span{font-size:var(--fs-xs);font-weight:700;color:var(--c-text-3)}' +
      '.dr-h-btn{background:none;border:0;padding:0;margin:0;font:inherit;cursor:pointer;width:100%;min-height:var(--tap)}' +
      '.dr-p{margin:0;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.45}.dr-p b{color:var(--c-text-1)}.dr-p-s{color:var(--c-text-3)}' +
      '.dr-fine{margin:0;font-size:var(--fs-xs);color:var(--c-text-3);line-height:1.4}' +
      '.dr-sub{font-size:var(--fs-xs);font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.06em;margin-top:4px}' +
      '.dr-sc-top{display:flex;align-items:center;gap:var(--s-2)}.dr-donut{width:132px;height:132px;flex:none}' +
      '.dr-dn{font-size:26px;font-weight:900;fill:var(--num-yellow,var(--c-gold,#F2C94C))}.dr-dl{font-size:9px;font-weight:800;fill:var(--c-text-3);letter-spacing:.04em;text-transform:uppercase}' +
      '.dr-legs{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}.dr-leg{display:grid;grid-template-columns:14px 1fr auto 14px;align-items:center;gap:8px;min-height:32px;padding:0;margin:0;background:none;border:0;width:100%;text-align:left;font:inherit;font-size:var(--fs-sm);font-weight:700;color:var(--c-text-2);cursor:pointer;-webkit-appearance:none;appearance:none}.dr-leg b{color:var(--c-text-1);font-weight:900;font-variant-numeric:tabular-nums;font-size:var(--fs-lg)}' +
      '.dr-chev{width:16px;height:16px;flex:none;color:var(--c-text-3)}.dr-leg .dr-chev{width:14px;height:14px}' +
      '.dr-sg{display:inline-block;height:100%;min-height:12px}.dr-leg .dr-sg{width:14px;height:14px;min-height:0;border-radius:4px}' +
      '.dr-sg-ok{background:var(--c-take)}.dr-sg-soon{background:var(--c-maybe)}.dr-sg-unk{background:#8F86B8}.dr-sg-gap{background:#F87171}' +
      '.dr-stack{display:flex;height:12px;border-radius:var(--radius-pill);background:var(--c-surface-3);overflow:hidden}' +
      '.dr-gbs{display:flex;flex-direction:column;gap:6px}.dr-gb{display:grid;grid-template-columns:1fr 84px 40px;align-items:center;gap:var(--s-1);text-decoration:none;color:var(--c-text-2);font-size:12px;font-weight:700;min-height:28px}.dr-gb b{text-align:right;color:var(--c-text-1);font-weight:800;font-variant-numeric:tabular-nums}.dr-gb>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dr-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s-1)}' +
      '.dr-tile{background:var(--c-surface-2);border:1px solid var(--c-line);border-radius:var(--radius-md);padding:var(--s-1h) var(--s-1);display:flex;flex-direction:column;gap:2px;min-width:0;min-height:var(--tap);text-align:left;font:inherit;color:inherit;-webkit-appearance:none;appearance:none}' +
      '.dr-tile span{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text-3)}.dr-tile b{font-size:var(--fs-lg);font-weight:900;color:var(--num-yellow,var(--c-gold,#F2C94C));line-height:1.15;overflow-wrap:anywhere}.dr-tile small{font-size:11px;color:var(--c-text-3);line-height:1.25}' +
      '.dr-tile-h{display:flex;align-items:center;justify-content:space-between;gap:4px;width:100%}.dr-tile-h .dr-chev{color:var(--c-text-2)}.dr-t-bad .dr-chev{color:#FCA5A5}.dr-t-cdl .dr-chev{color:var(--c-gold)}' +
      '.dr-t-bad b{color:#FCA5A5}.dr-t-bad{border-color:#F87171}.dr-t-cdl{border-color:var(--c-gold)}.dr-t-cdl b{color:var(--c-gold)}button.dr-tile{cursor:pointer}button.dr-tile:not(.dr-t-cdl):not(.dr-t-bad){border-color:var(--c-line-strong)}button.dr-tile:active,button.dr-leg:active{opacity:.88}' +
      '.dr-rows{display:flex;flex-direction:column}.dr-r{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--s-1);padding:7px 0;border-bottom:1px solid var(--c-line);font-size:var(--fs-sm);color:var(--c-text-2)}.dr-r:last-child{border-bottom:0}.dr-r>span{flex:0 1 44%}.dr-r b{flex:1;text-align:right;color:var(--c-text-1);font-weight:800}' +
      '.dr-list{display:flex;flex-direction:column;gap:var(--s-1)}' +
      '.dr-row{display:flex;align-items:stretch;gap:var(--s-1);background:var(--c-surface-2);border-radius:var(--radius-md);border-left:4px solid #8F86B8;overflow:hidden}' +
      '.dr-row-ok{border-left-color:var(--c-take)}.dr-row-warn{border-left-color:var(--c-maybe)}.dr-row-bad{border-left-color:#F87171}.dr-row-na{border-left-color:var(--c-line-strong);opacity:.75}' +
      '.dr-chk{flex:none;width:52px;min-height:var(--tap);border:0;background:transparent;color:#14111f;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}' +
      '.dr-chk::before{content:"";width:26px;height:26px;border-radius:50%;border:2px solid var(--c-line-strong);box-sizing:border-box;position:absolute}.dr-chk{position:relative}' +
      '.dr-chk svg{width:20px;height:20px;position:relative;z-index:1}.dr-chk-ok::before{background:var(--c-take);border-color:var(--c-take)}.dr-chk-warn::before{border-color:var(--c-maybe)}.dr-chk-bad::before{border-color:#F87171}' +
      '.dr-main{flex:1;min-width:0;text-align:left;background:transparent;border:0;color:inherit;font:inherit;padding:var(--s-1h) var(--s-1h) var(--s-1h) 0;display:flex;flex-direction:column;gap:6px;cursor:pointer}' +
      '.dr-main b{font-size:var(--fs-md);color:var(--c-text-1);line-height:1.25;font-weight:800}.dr-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
      '.dr-m{font-size:11px;font-weight:700;color:var(--c-text-3)}.dr-cfr{opacity:.9}' +
      '.dr-pill{flex:none;font-size:11px;font-weight:800;padding:2px 9px;border-radius:var(--radius-pill);white-space:nowrap}' +
      '.dr-pill-ok{background:var(--c-take-bg);color:var(--c-take)}.dr-pill-warn{background:var(--c-maybe-bg);color:var(--c-maybe)}.dr-pill-bad{background:rgba(248,113,113,.14);color:#FCA5A5}.dr-pill-unk{background:rgba(143,134,184,.2);color:#C4BDE6}.dr-pill-na{background:var(--c-surface-3);color:var(--c-text-2)}' +
      '.dr-more{min-height:var(--tap);border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font:inherit;font-weight:800;font-size:var(--fs-sm);cursor:pointer}' +
      '.dr-mini{min-height:34px;padding:0 12px;border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-3);color:var(--c-text-1);font:inherit;font-size:var(--fs-xs);font-weight:800;cursor:pointer;flex:none}' +
      '.dr-toast{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1);padding:var(--s-1h);border-radius:var(--radius-md);background:#0E2F25;border:1px solid var(--c-take);color:var(--c-text-1);font-size:var(--fs-sm);font-weight:700;box-shadow:var(--shadow-1);position:sticky;top:calc(var(--appbar-h) + 6px);z-index:5}' +
      '.dr-sync{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1);padding:var(--s-1) var(--s-1h);border-radius:var(--radius-md);background:var(--c-maybe-bg);color:var(--c-maybe);font-size:var(--fs-xs);font-weight:700}' +
      '.dr-pin{display:flex;gap:var(--s-1)}.dr-pin input{flex:1;min-height:var(--tap);padding:0 var(--s-1h);border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-size:16px}' +
      '.dr-link{display:block;color:var(--c-accent-hi);font-weight:700;font-size:var(--fs-sm);line-height:1.4;overflow-wrap:anywhere;text-decoration:underline}.dr-links{display:flex;flex-direction:column;gap:6px}.dr-src{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}.dr-src .dr-link{display:inline}' +
      '.dr-calc{display:flex;flex-direction:column;gap:var(--s-1);background:var(--c-surface-2);border-radius:var(--radius-md);padding:var(--s-1h)}.dr-calc-g{display:grid;grid-template-columns:1fr 1fr;gap:var(--s-1)}.dr-calc label{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-xs);font-weight:800;color:var(--c-text-2)}.dr-calc label:nth-child(1),.dr-calc label:nth-child(4),.dr-calc label:nth-child(5),.dr-calc .dr-c-chk{grid-column:1/-1}' +
      '.dr-calc select,.dr-calc input[type=number]{min-height:var(--tap);padding:0 var(--s-1h);border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-1);color:var(--c-text-1);font:inherit;font-size:16px;font-weight:600}.dr-calc .dr-c-chk{flex-direction:row;align-items:center;gap:10px;font-weight:700}.dr-calc .dr-c-chk input{width:22px;height:22px;min-height:0;flex:none;accent-color:var(--c-accent);margin:0}' +
      '.dr-calc-out{display:flex;flex-direction:column;gap:4px}.dr-calc-out b{font-size:var(--fs-xl);color:var(--c-gold);font-weight:900}.dr-calc-out span{font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.4}' +
      '.dr-noscroll,.dr-noscroll body{overflow:hidden}.dr-sheet{position:fixed;inset:0;z-index:2700}.dr-sheet[hidden]{display:none}' +
      '.dr-sh-bd{position:absolute;inset:0;background:rgba(4,3,8,.66)}' +
      '.dr-sh-p{position:absolute;left:0;right:0;bottom:0;max-height:92dvh;display:flex;flex-direction:column;background:var(--c-surface-2);border-top:1px solid var(--c-line-strong);border-radius:var(--radius-xl) var(--radius-xl) 0 0;box-shadow:var(--shadow-2);animation:moreUp .18s ease-out;padding-bottom:env(safe-area-inset-bottom)}' +
      '.dr-sh-grab{width:40px;height:4px;border-radius:2px;background:var(--c-line-strong);margin:8px auto 0}' +
      '.dr-sh-h{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s-1);padding:var(--s-1h) var(--s-2) var(--s-1)}.dr-sh-h b{display:block;font-size:var(--fs-lg);font-weight:900;color:var(--c-text-1);line-height:1.2}.dr-sh-h span{font-size:var(--fs-xs);color:var(--c-text-3);font-weight:700}' +
      '.dr-sh-x{min-height:36px;padding:0 14px;border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-3);color:var(--c-text-1);font:inherit;font-size:var(--fs-sm);font-weight:800;cursor:pointer;flex:none}' +
      '.dr-sh-body{overflow-y:auto;overscroll-behavior:contain;padding:0 var(--s-2) var(--s-3);display:flex;flex-direction:column;gap:var(--s-1h)}.dr-sh-info{display:flex;flex-wrap:wrap;gap:8px;align-items:center}' +
      '.dr-form{display:flex;flex-direction:column;gap:var(--s-1h)}.dr-form label{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-xs);font-weight:800;color:var(--c-text-2)}' +
      '.dr-form input,.dr-form textarea{min-height:var(--tap);padding:0 var(--s-1h);border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-1);color:var(--c-text-1);font:inherit;font-size:16px;font-weight:600}.dr-form textarea{padding:var(--s-1) var(--s-1h);resize:vertical}.dr-form small{font-size:11px;font-weight:600;color:var(--c-text-3)}' +
      '.dr-btns{display:flex;flex-direction:column;gap:var(--s-1)}.dr-btns .btn{width:100%;min-height:var(--tap)}.dr-err{margin:0;color:#FCA5A5;font-size:var(--fs-sm);font-weight:700}' +
      '.dr-hist{display:flex;flex-direction:column;gap:var(--s-1)}.dr-hrow{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1);background:var(--c-surface-1);border-radius:var(--radius-md);padding:var(--s-1) var(--s-1h)}.dr-hrow.dr-undone{opacity:.6}.dr-hrow-m{display:flex;flex-direction:column;gap:3px;min-width:0}.dr-hrow-m b{font-size:var(--fs-sm);color:var(--c-text-1)}.dr-hrow-m span{font-size:12px;color:var(--c-text-3);font-weight:600}' +
      '.dr-chip{font-size:10px;font-weight:800;padding:2px 8px;border-radius:var(--radius-pill);background:var(--c-surface-3);color:var(--c-maybe);align-self:flex-start}';
    document.head.appendChild(s);
  }

  function onShow() { loadPublic(); render(); if (st.pub) fetchSrv(); flush(); }
  function init() {
    css(); bind();
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'dot') onShow(); else if (st.sheet) dismissSheet(); });
    window.addEventListener('online', flush);
    if (document.documentElement.getAttribute('data-tab') === 'dot') onShow();
  }
  window.BlackRamDot = { ready: function () { return !!st.pub; }, load: loadPublic, status: function (id) { var it = itemById(id); if (!it) return null; var r = calc(it); return { s: r.s, label: r.label, date: r.date, exp: r.exp, t: it.t, cfr: it.cfr }; }, render: render, openItem: openSheet, closeSheet: closeSheet, flush: flush, score: function () { return score(rows()); }, refresh: function () { st.pub = null; st.srv = null; loadPublic(); fetchSrv(); } };
  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { dot: window.BlackRamDot });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
