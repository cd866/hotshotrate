/* Black Ram Logistics v120: global pull bar + instant Refresh feedback.
   Lives at the app shell (one fixed dock above the bottom nav), so it survives tab changes.
   1) Pull bar: starts when Pull fresh loads is tapped (event blackram:pull from app.js), then follows
      data/pull_status.json (published by /workspace/bigtex/dashboard/pull_status.py through GitHub Pages:
      truckstop 20, direct_freight 55, scoring 85, live 100). State is kept in localStorage so a reload
      keeps showing it. Tap opens Load Boards. Hides ~5 s after 100%. Error plus Retry after 15 min of no update.
   2) Refresh feedback: every Refresh button shows a spinner and a toast at once, then Updated or a clear error.
   Plain ASCII on purpose. */
(function () {
  'use strict';
  var KEY = 'blackram_pullbar_v1';
  var POLL_MS = 8000;
  var STALL_MS = 15 * 60 * 1000;
  var HIDE_MS = 5000;
  var RELAY_HOST = 'blackram-relay.sandlilypad.workers.dev';
  var local = null;      // { startedAt, origin, adopted, err, done, doneAt, take, seen }
  var server = null;     // last data/pull_status.json
  var timer = null, hideTimer = null, tickTimer = null;
  var dock, bar, toastEl;
  var maxPct = 0;

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function load() { try { var j = JSON.parse(localStorage.getItem(KEY) || 'null'); return j && typeof j === 'object' ? j : null; } catch (e) { return null; } }
  function save() { try { if (local) localStorage.setItem(KEY, JSON.stringify(local)); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ } }

  // "2026-11-27 01:04 CT" (America/Chicago wall time) -> ms
  function ctMs(stamp) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(stamp || ''));
    if (!m) { var d = new Date(stamp); return isNaN(d.getTime()) ? null : d.getTime(); }
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    try {
      var f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
      for (var i = 0; i < 2; i++) {
        var o = {}; f.formatToParts(new Date(guess)).forEach(function (p) { o[p.type] = +p.value; });
        var seen = Date.UTC(o.year, o.month - 1, o.day, o.hour % 24, o.minute);
        guess += Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - seen;
      }
    } catch (e) { guess += 6 * 3600000; }
    return guess;
  }
  function isActive(s) { var t = s && s.state; return t === 'queued' || t === 'truckstop' || t === 'direct_freight' || t === 'uship' || t === 'scoring'; }
  function n(v) { v = Number(v); return isFinite(v) ? v : 0; }

  /* ---------- styles ---------- */
  function addStyle() {
    var css = '' +
      '#br-dock{position:fixed;left:0;right:0;bottom:calc(var(--br-nav,64px) + 8px);z-index:2800;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;padding:0 12px}' +
      '#br-dock>*{pointer-events:auto;width:min(456px,100%)}' +
      '.br-pull{position:relative;display:flex;align-items:stretch;background:#1f1a33;border:1px solid #D4A62A;border-radius:14px;box-shadow:0 10px 26px rgba(0,0,0,.65);overflow:hidden}' +
      '.br-pull.err{border-color:#e5534b}.br-pull.done{border-color:#3fb950}' +
      '.br-pull-main{flex:1;min-width:0;text-align:left;background:none;border:0;color:#F5F1E6;font:inherit;padding:9px 12px 8px;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.br-row{display:flex;justify-content:space-between;gap:8px;font-size:14px;font-weight:700;line-height:1.25}' +
      '.br-lbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.br-pct{font-variant-numeric:tabular-nums;color:#F2C94C}' +
      '.br-track{height:6px;border-radius:3px;background:rgba(255,255,255,.14);margin:6px 0 5px;overflow:hidden}' +
      '.br-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#D4A62A,#F2C94C);transition:width .6s ease}' +
      '.br-pull.err .br-fill{background:#e5534b}.br-pull.done .br-fill{background:#3fb950}' +
      '.br-sub{font-size:12px;color:#b9b3c9;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.br-pull.run .br-fill{background-size:200% 100%;animation:br-slide 1.6s linear infinite}' +
      '@keyframes br-slide{from{background-position:200% 0}to{background-position:0 0}}' +
      '.br-act{flex:none;min-width:44px;background:none;border:0;border-left:1px solid rgba(255,255,255,.1);color:#F2C94C;font:inherit;font-size:13px;font-weight:700;padding:0 12px;cursor:pointer}' +
      '.br-toast{display:flex;align-items:center;gap:10px;background:#2a2540;border:1px solid #5b4b8a;border-radius:12px;color:#F5F1E6;font-size:14px;padding:10px 12px;box-shadow:0 8px 22px rgba(0,0,0,.6)}' +
      '.br-toast.err{border-color:#e5534b;background:#3a1d22}.br-toast.ok{border-color:#3fb950}' +
      '.br-toast span.t{flex:1;min-width:0;line-height:1.3}' +
      '.br-toast button{flex:none;background:none;border:1px solid currentColor;border-radius:8px;color:#F2C94C;font:inherit;font-size:13px;font-weight:700;padding:5px 12px;cursor:pointer}' +
      '.br-spinner,.br-busy::before{display:inline-block;width:14px;height:14px;border:2px solid #F2C94C;border-right-color:transparent;border-radius:50%;animation:br-rot .7s linear infinite;flex:none}' +
      '.br-busy::before{content:"";width:11px;height:11px;margin-right:6px;vertical-align:-1px}' +
      '.br-busy{opacity:.85}' +
      '@keyframes br-rot{to{transform:rotate(360deg)}}' +
      '@media (prefers-reduced-motion:reduce){.br-spinner,.br-busy::before,.br-pull.run .br-fill{animation-duration:2.4s}.br-fill{transition:none}}';
    var el = document.createElement('style'); el.id = 'br-style'; el.textContent = css; document.head.appendChild(el);
  }

  function mount() {
    if (dock) return;
    addStyle();
    dock = document.createElement('div'); dock.id = 'br-dock';
    toastEl = document.createElement('div'); toastEl.id = 'br-toast'; toastEl.className = 'br-toast'; toastEl.hidden = true; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
    bar = document.createElement('div'); bar.id = 'br-pull'; bar.hidden = true;
    dock.appendChild(toastEl); dock.appendChild(bar);
    document.body.appendChild(dock);
    bar.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('[data-br]') : null;
      var act = a ? a.getAttribute('data-br') : '';
      if (act === 'retry') { dismiss(); document.dispatchEvent(new CustomEvent('blackram:pull-retry')); return; }
      if (act === 'x') { dismiss(); return; }
      openLoads();
    });
    syncNavHeight();
    window.addEventListener('resize', syncNavHeight);
    window.addEventListener('orientationchange', syncNavHeight);
  }
  function syncNavHeight() {
    var nav = document.querySelector('nav.tabbar.bnav');
    var h = nav ? nav.getBoundingClientRect().height : 64;
    if (dock) dock.style.setProperty('--br-nav', Math.round(h || 64) + 'px');
  }
  function openLoads() {
    if (location.hash !== '#searches') location.hash = '#searches'; else { try { window.scrollTo(0, 0); } catch (e) { /* ignore */ } }
    var t = $('tab-searches'); if (t && document.documentElement.getAttribute('data-tab') !== 'searches') t.click();
    setTimeout(function () { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); } }, 60);
  }

  /* ---------- pull state ---------- */
  function elapsedText(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60);
    return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }
  function view() {
    if (!local) return null;
    var now = Date.now();
    var s = server, c = (s && s.counts) || {};
    var ts = n(c.truckstop), df = n(c.df), us = n(c.uship), fits = n(c.fits);
    var origin = (s && s.origin) || local.origin || '';
    var mine = !!s && (ctMs(s.updated_at) || 0) + 70000 >= local.startedAt;
    var countsLine = [];
    if (mine && (ts || df || us)) {
      countsLine.push('Truckstop ' + ts); countsLine.push('Direct Freight ' + df); if (us) countsLine.push('uShip ' + us);
    }
    if (origin) countsLine.push(origin);
    var elapsed = elapsedText(now - local.startedAt);
    if (local.err) return { kind: 'err', pct: Math.max(maxPct, 0), label: 'Search problem', sub: local.err, retry: true };
    if (mine && s.state === 'failed') return { kind: 'err', pct: 0, label: 'Search failed', sub: String(s.message || 'Board search failed'), retry: true };
    if (mine && s.state === 'live') {
      var take = local.take != null ? local.take : null;
      var lbl = take != null ? 'Live - ' + take + ' TAKE' : 'Live - ' + fits + ' fit' + (fits === 1 ? '' : 's');
      return { kind: 'done', pct: 100, label: lbl, sub: [(ts + df + us) + ' loads scored'].concat(origin ? [origin] : []).join(' | ') };
    }
    if (mine && isActive(s)) {
      var upd = ctMs(s.updated_at) || local.startedAt;
      if (now - upd > STALL_MS) return { kind: 'err', pct: n(s.pct), label: 'Search stalled', sub: 'No update for ' + Math.floor((now - upd) / 60000) + ' min. Tap Retry.', retry: true };
      var label, st = s.state;
      if (st === 'queued') label = 'Starting search...';
      else if (st === 'truckstop') label = 'Truckstop...' + (ts ? ' ' + ts + ' load' + (ts === 1 ? '' : 's') : '');
      else if (st === 'direct_freight') label = 'Direct Freight...' + (df ? ' ' + df : (ts ? ' (Truckstop ' + ts + ' in)' : ''));
      else if (st === 'uship') label = 'uShip...' + (us ? ' ' + us : '');
      else label = 'Scoring...' + ((ts + df + us) ? ' ' + (ts + df + us) + ' loads' : '');
      return { kind: 'run', pct: n(s.pct), label: label, sub: countsLine.concat([elapsed]).join(' | ') };
    }
    // nothing from the box yet (or only an older run): we are still starting
    if (now - local.startedAt > STALL_MS) return { kind: 'err', pct: 0, label: 'No answer from the box', sub: 'Nothing started in 15 min. Tap Retry.', retry: true };
    return { kind: 'run', pct: 3, label: 'Starting search...', sub: ['Request sent', origin, elapsed].filter(Boolean).join(' | ') };
  }

  function render() {
    mount(); syncNavHeight();
    var v = view();
    if (!v) { bar.hidden = true; bar.innerHTML = ''; return; }
    if (v.kind === 'run') maxPct = Math.max(maxPct, v.pct); else if (v.kind === 'done') maxPct = 100;
    var pct = v.kind === 'run' ? Math.max(maxPct, v.pct) : v.pct;
    bar.hidden = false;
    bar.className = 'br-pull ' + v.kind;
    bar.innerHTML = '<button type="button" class="br-pull-main" aria-label="Pull progress. Open Load Boards">' +
      '<div class="br-row"><span class="br-lbl">' + esc(v.label) + '</span><span class="br-pct">' + Math.round(pct) + '%</span></div>' +
      '<div class="br-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><div class="br-fill" style="width:' + Math.max(2, Math.round(pct)) + '%"></div></div>' +
      '<div class="br-sub">' + esc(v.sub) + '</div></button>' +
      (v.retry ? '<button type="button" class="br-act" data-br="retry">Retry</button>' : '') +
      (v.kind !== 'run' ? '<button type="button" class="br-act" data-br="x" aria-label="Dismiss">X</button>' : '');
    if (v.kind === 'done' && local && !local.doneAt) {
      local.doneAt = Date.now(); save();
    }
    if (v.kind === 'done') {
      var left = Math.max(300, HIDE_MS - (Date.now() - (local.doneAt || Date.now())));
      clearTimeout(hideTimer); hideTimer = setTimeout(dismiss, left);
    }
  }

  function dismiss() {
    clearTimeout(hideTimer);
    if (server && server.started_at) { try { localStorage.setItem(KEY + '_seen', String(server.started_at)); } catch (e) { /* ignore */ } }
    local = null; maxPct = 0; save(); stop(); render();
  }

  function fetchTake() {
    return fetch('data/load_searches.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (local && d && d.counts && d.counts.take != null) { local.take = n(d.counts.take); save(); render(); }
    }).catch(function () { /* label falls back to fits */ });
  }

  function poll() {
    return fetch('data/pull_status.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('status ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || typeof data !== 'object') return;
      var prev = server; server = data;
      var seen = ''; try { seen = localStorage.getItem(KEY + '_seen') || ''; } catch (e) { /* ignore */ }
      if (!local && isActive(data)) {
        var up = ctMs(data.updated_at);
        if (up && Date.now() - up < STALL_MS && String(data.started_at) !== seen) {
          local = { startedAt: ctMs(data.started_at) || up, origin: data.origin || '', adopted: true }; save(); start();
        }
      }
      if (local && data.state === 'live' && (ctMs(data.updated_at) || 0) + 70000 >= local.startedAt) {
        if (!local.liveSeen) {
          local.liveSeen = true; save();
          document.dispatchEvent(new CustomEvent('blackram:pull-live'));
          fetchTake();
        }
      }
      if (local && local.adopted && !isActive(data) && data.state !== 'live' && data.state !== 'failed') { local = null; save(); }
      render();
    }).catch(function () { /* keep the last status; stall logic still runs */ render(); });
  }

  function start() {
    if (timer) return;
    timer = setInterval(poll, POLL_MS);
    tickTimer = setInterval(render, 1000);
  }
  function stop() {
    clearInterval(timer); timer = null; clearInterval(tickTimer); tickTimer = null;
  }

  document.addEventListener('blackram:pull', function (e) {
    var d = (e && e.detail) || {};
    if (d.phase === 'start') {
      maxPct = 0;
      local = { startedAt: Date.now(), origin: d.origin || '' }; save();
      try { localStorage.removeItem(KEY + '_seen'); } catch (err) { /* ignore */ }
      start(); render(); poll();
    } else if (d.phase === 'error' && local) {
      local.err = d.message || 'Could not start the search.'; save(); render();
    } else if (d.phase === 'ok' && local) {
      local.accepted = Date.now(); delete local.err; save(); render();
    }
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') poll(); });

  /* ---------- Refresh buttons: instant feedback ---------- */
  var REFRESH_SEL = '#search-refresh-btn,#refresh-btn,#fin-refresh,#fin-bv-refresh,#ac-refresh,#in-refresh,#mt-refresh,#ln-refresh';
  var DONE_TEXT = {
    'search-refresh-btn': function () { var t = $('search-updated-text'); return 'Loads reloaded' + (t && t.textContent && !/Updating/.test(t.textContent) ? ' - ' + t.textContent : ''); },
    'refresh-btn': function () { return 'Reports reloaded'; },
    'fin-refresh': function () { return 'Finance updated'; },
    'fin-bv-refresh': function () { return 'Bluevine pull requested. It takes a few minutes.'; },
    'ac-refresh': function () { return 'Accounting updated'; },
    'in-refresh': function () { return 'Insurance updated'; },
    'mt-refresh': function () { return 'Maintenance updated'; },
    'ln-refresh': function () { return 'Loans updated'; }
  };
  var sess = null, toastTimer = null;

  function showToast(text, kind, retryId, ms) {
    mount(); syncNavHeight();
    clearTimeout(toastTimer);
    toastEl.className = 'br-toast' + (kind ? ' ' + kind : '');
    toastEl.innerHTML = (kind === 'busy' ? '<span class="br-spinner" aria-hidden="true"></span>' : '') +
      '<span class="t">' + esc(text) + '</span>' + (retryId ? '<button type="button" data-br-retry="' + esc(retryId) + '">Retry</button>' : '');
    toastEl.hidden = false;
    if (ms) toastTimer = setTimeout(function () { toastEl.hidden = true; }, ms);
  }

  function tracked(url) {
    url = String(url || '');
    if (/pull_status\.json/.test(url)) return false;
    return url.indexOf(RELAY_HOST) >= 0 || /(^|\/)data\/[^?]+\.json/.test(url);
  }
  function sessNote(fail) { if (sess && !sess.fail) sess.fail = fail; }

  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  if (realFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
      var s = sess;
      if (!s || !tracked(url)) return realFetch(input, init);
      s.pending++; s.reqs++; s.last = Date.now();
      var isRelay = url.indexOf(RELAY_HOST) >= 0;
      var p = realFetch(input, init);
      p.then(function (res) {
        try {
          if (!res.ok) {
            if (isRelay) {
              res.clone().json().then(function (j) { sessNote((j && j.error) || ('Server error ' + res.status)); }, function () { sessNote('Server error ' + res.status); });
            } else sessNote(res.status === 503 ? 'Offline - showing the saved copy' : 'Server error ' + res.status);
          } else if (res.headers && res.headers.get('X-Feed-Cache') === '1') {
            sessNote('Offline - showing the saved copy');
          } else if (isRelay) {
            res.clone().json().then(function (j) { if (j && j.ok === false) sessNote(j.error || 'The server refused the request'); }, function () { /* not json */ });
          }
        } catch (e) { /* ignore */ }
        s.pending--; s.last = Date.now();
      }, function () { sessNote('Offline - could not reach the server'); s.pending--; s.last = Date.now(); });
      return p;
    };
  }

  function busyMark() {
    if (!sess) return;
    var b = $(sess.id);
    if (b && !b.classList.contains('br-busy')) b.classList.add('br-busy');
  }
  function endSess(kind, text) {
    var s = sess; if (!s) return;
    clearInterval(s.iv); sess = null;
    var b = $(s.id); if (b) b.classList.remove('br-busy');
    if (kind === 'ok') showToast(text, 'ok', null, 3200);
    else showToast(text, 'err', s.id, 9000);
  }
  function startSess(id) {
    if (sess) { clearInterval(sess.iv); var ob = $(sess.id); if (ob) ob.classList.remove('br-busy'); }
    sess = { id: id, t0: Date.now(), last: Date.now(), pending: 0, reqs: 0, fail: '' };
    showToast('Refreshing...', 'busy');
    busyMark();
    sess.iv = setInterval(function () {
      if (!sess) return;
      busyMark();
      var now = Date.now();
      if (now - sess.t0 > 25000) { endSess('err', 'Timed out. Check your connection and tap Retry.'); return; }
      if (now - sess.t0 >= 900 && sess.pending === 0 && now - sess.last >= 350) {
        if (sess.fail) endSess('err', sess.fail + '. Tap Retry.');
        else { var fn = DONE_TEXT[sess.id]; var txt; try { txt = fn ? fn() : 'Updated'; } catch (e) { txt = 'Updated'; } endSess('ok', txt); }
      }
    }, 120);
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var btn = t && t.closest ? t.closest(REFRESH_SEL) : null;
    if (btn) { startSess(btn.id); return; }
    var rb = t && t.closest ? t.closest('[data-br-retry]') : null;
    if (rb) {
      var id = rb.getAttribute('data-br-retry'), target = $(id);
      if (target && !target.disabled) target.click();
      else showToast('Open that screen and tap Refresh again.', 'err', null, 5000);
    }
  }, true);
  // the toast is created lazily by mount(); wire its element once it exists
  function boot() {
    mount();
    local = load();
    if (local && (local.done || (local.adopted && Date.now() - local.startedAt > 2 * STALL_MS))) { local = null; save(); }
    if (local) { start(); render(); }
    poll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.BlackRamPullBar = { poll: poll, toast: showToast, state: function () { return { local: local, server: server }; } };
})();
