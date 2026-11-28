/* Black Ram Logistics - Broker vetting flags (v151).
   Badge for whether a broker is likely to accept Totni's MC: Likely OK / Strict / Unknown.
   Source: data/broker_vetting.json (broker business names and MC/DOT only, one-line reason each).
   Likely OK = already booked Sand Lily Pad (ledger). Strict = publishes a $1M liability minimum
   (Totni's FMCSA filing is $750K) or vets through Highway, where Totni's out-of-service rates show.
   Anything else is Unknown. Cards only emit an empty placeholder; this file fills it in and
   keeps new cards filled (MutationObserver), so a card never waits for the JSON.
   Plain ASCII. No personal contacts. */
(function () {
  'use strict';
  var URL_ = 'data/broker_vetting.json';
  var data = null, failed = false, loading = false, ctx = [];
  var LABEL = { ok: 'Likely OK', strict: 'Strict', unknown: 'Unknown' };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) {
    return ' ' + String(s || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }
  function digits(s) { var d = String(s == null ? '' : s).replace(/\D/g, ''); return d ? String(parseInt(d, 10)) : ''; }

  function find(q) {
    q = q || {};
    var mc = digits(q.mc), dot = digits(q.dot), n = norm(q.name);
    var list = (data && data.brokers) || [], i, j, b;
    if (mc) for (i = 0; i < list.length; i++) { b = list[i]; if ((b.mc || []).indexOf(mc) >= 0) return b; }
    if (dot) for (i = 0; i < list.length; i++) { b = list[i]; if ((b.dot || []).indexOf(dot) >= 0) return b; }
    if (n.trim()) for (i = 0; i < list.length; i++) {
      b = list[i];
      for (j = 0; j < (b.aliases || []).length; j++) {
        var a = norm(b.aliases[j]);
        if (a.trim() && n.indexOf(a) >= 0) return b;
      }
    }
    return null;
  }

  function judge(q) {
    q = q || {};
    var b = data ? find(q) : null;
    if (b) return { flag: b.flag, reason: b.reason, name: b.name };
    var has = String(q.name || '').trim() || digits(q.mc) || digits(q.dot);
    if (failed) return { flag: 'unknown', reason: 'The broker list did not load. Check again when online.' };
    if (!has) return { flag: 'unknown', reason: 'No broker listed on this load, so there is nothing to check.' };
    return { flag: 'unknown', reason: 'Not a broker that has booked us, and no published rule found. Ask which vetting tool they use.' };
  }

  function attrs(q) {
    q = q || {};
    return ' data-bk-n="' + esc(q.name || '') + '" data-bk-mc="' + esc(q.mc || '') + '" data-bk-dot="' + esc(q.dot || '') + '"';
  }
  function rowOf(r) { return { name: r && r.broker, mc: r && r.broker_mc, dot: r && r.broker_dot }; }

  /* Placeholder markup for a load row (search scan row, combo leg, compare column). */
  function slot(q, cls) { return '<div class="bk-row' + (cls ? ' ' + cls : '') + '"' + attrs(q) + '></div>'; }
  function slotFor(row, cls) { return slot(rowOf(row), cls); }
  /* Ledger loads carry the broker business name only. */
  function slotLedger(load, cls) { return slot({ name: load && load.broker }, cls); }

  function shortName(n) {
    var s = String(n || '').split(' / ')[0].replace(/\b(LLC|INC|INCORPORATED|INCORPORTED|CORP|CORPORATION|CO|LTD)\.?\b/gi, '').replace(/[ ,.]+$/, '').replace(/\s+/g, ' ').trim();
    return s.toLowerCase().replace(/(^|[ (-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }).replace(/\b(Llc|Dot|Mc)\b/g, function (m) { return m.toUpperCase(); });
  }
  function fill(el) {
    var q = { name: el.getAttribute('data-bk-n'), mc: el.getAttribute('data-bk-mc'), dot: el.getAttribute('data-bk-dot') };
    if (el.id === 'rc-bk' && !q.name && !digits(q.mc) && !digits(q.dot)) { el.innerHTML = ''; return; }
    var key = (data ? 'd' : failed ? 'f' : 'w') + '|' + q.name + '|' + q.mc + '|' + q.dot;
    if (el.getAttribute('data-bk-done') === key) return;
    if (!data && !failed) return;
    var j = judge(q);
    var open = el.getAttribute('data-bk-open') === '1';
    el.setAttribute('data-bk-done', key);
    el.innerHTML =
      '<button type="button" class="bk-badge bk-' + j.flag + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="Totni MC vetting: ' + LABEL[j.flag] + '. Tap for why.">' +
        '<span class="bk-pill"><span class="bk-k">MC</span> ' + LABEL[j.flag] + '</span></button>' +
      (el.classList.contains('bk-named') && q.name ? '<span class="bk-nm">' + esc(shortName(q.name)) + '</span>' : '') +
      '<p class="bk-why" role="status"' + (open ? '' : ' hidden') + '>' + esc(j.reason) + '</p>';
  }
  function hydrate(root) {
    var list = (root || document).querySelectorAll('.bk-row[data-bk-n]');
    for (var i = 0; i < list.length; i++) fill(list[i]);
  }

  var pending = false;
  function soon() {
    if (pending) return; pending = true;
    (window.requestAnimationFrame || setTimeout)(function () { pending = false; hydrate(document); });
  }

  function load() {
    if (data || loading) return;
    loading = true;
    fetch(URL_ + '?t=' + Date.now(), { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('vet');
      return r.json();
    }).then(function (j) { data = j; failed = false; loading = false; hydrate(document); renderSheet(); })
      .catch(function () { failed = true; loading = false; hydrate(document); renderSheet(); });
  }

  /* ---------- call sheet block ---------- */
  function setContext(list) { ctx = list || []; }
  function renderSheet() {
    var box = document.getElementById('callsheet-vet');
    if (!box) return;
    var html = '<h3 class="callsheet-h">Broker vs Totni MC</h3>';
    if (ctx.length) {
      html += ctx.map(function (q) {
        var j = judge(q);
        var nm = (q.name && String(q.name).trim()) ? shortName(q.name) : 'Broker not listed';
        return '<div class="bk-sheet-one"><span class="bk-sheet-n">' + esc(nm) + (digits(q.mc) ? ' | MC ' + esc(digits(q.mc)) : '') + '</span>' +
          slot(q, 'bk-open') + '</div>';
      }).join('');
    } else {
      html += '<p class="fine">Open the call sheet from a load to see that broker here.</p>';
    }
    if (data) {
      var t = data.totni || {};
      html += '<details class="bk-all"><summary>All brokers on the list (' + data.brokers.length + ')</summary>' +
        '<p class="fine">Totni: $' + Number(t.liability_filed_usd || 0).toLocaleString('en-US') + ' liability filed, vehicle out-of-service ' + esc(t.vehicle_oos_pct) + '%, driver ' + esc(t.driver_oos_pct) + '%.</p>' +
        data.brokers.map(function (b) {
          return '<div class="bk-sheet-one"><span class="bk-sheet-n">' + esc(b.name) + '</span>' +
            '<div class="bk-row bk-open" data-bk-n="' + esc(b.name) + '" data-bk-mc="' + esc((b.mc || [])[0] || '') + '" data-bk-dot="' + esc((b.dot || [])[0] || '') + '"></div></div>';
        }).join('') + '</details>';
    }
    box.innerHTML = html;
    var opens = box.querySelectorAll('.bk-open'); for (var i = 0; i < opens.length; i++) opens[i].setAttribute('data-bk-open', '1');
    hydrate(box);
  }
  function contextFromButton(btn) {
    var scope = btn && (btn.closest('.cc-leg') || btn.closest('article') || btn.closest('.rc-card'));
    var out = [];
    if (scope) {
      var rows = scope.querySelectorAll('.bk-row[data-bk-n]');
      for (var i = 0; i < rows.length; i++) {
        out.push({ name: rows[i].getAttribute('data-bk-n'), mc: rows[i].getAttribute('data-bk-mc'), dot: rows[i].getAttribute('data-bk-dot') });
      }
    }
    return out;
  }

  /* Rate Check: free-text broker name or MC number, checked as you type. */
  function syncRC() {
    var inp = document.getElementById('rc-broker'), row = document.getElementById('rc-bk');
    if (!inp || !row) return;
    var v = inp.value.trim(), m = v.match(/^(?:MC)?[\s#-]*(\d{3,8})$/i);
    row.setAttribute('data-bk-n', m ? '' : v);
    row.setAttribute('data-bk-mc', m ? m[1] : '');
    row.setAttribute('data-bk-dot', '');
    row.removeAttribute('data-bk-done');
    if (!v) { row.innerHTML = ''; return; }
    fill(row);
  }

  function css() {
    if (document.getElementById('bk-css')) return;
    var s = document.createElement('style'); s.id = 'bk-css';
    s.textContent =
      '.bk-row{display:flex;flex-wrap:wrap;align-items:center;gap:0 var(--s-1,8px);min-width:0}' +
      '.bk-row:empty{display:none}' +
      '.bk-badge{display:inline-flex;align-items:center;justify-content:flex-start;min-height:44px;min-width:44px;padding:0;margin:0;border:0;background:none;font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.bk-pill{display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:0 10px;border-radius:999px;border:1px solid transparent;font-size:12px;font-weight:900;letter-spacing:.03em;white-space:nowrap}' +
      '.bk-k{opacity:.75;font-weight:800}' +
      '.bk-ok .bk-pill{background:var(--c-take-bg,rgba(52,211,153,.15));color:var(--c-take,#34D399);border-color:rgba(52,211,153,.35)}' +
      '.bk-strict .bk-pill{background:rgba(248,113,113,.15);color:#FCA5A5;border-color:rgba(248,113,113,.4)}' +
      '.bk-unknown .bk-pill{background:var(--c-pass-bg,rgba(148,163,184,.14));color:var(--c-text-2,#cbd5e1);border-color:var(--c-line-strong,rgba(148,163,184,.3))}' +
      '.bk-badge:focus-visible .bk-pill{outline:2px solid var(--c-accent-hi,#A78BFA);outline-offset:2px}' +
      '.bk-badge:active .bk-pill{transform:scale(.97)}' +
      '.bk-nm{flex:1 1 0;min-width:0;font-size:12px;font-weight:700;color:var(--c-text-3,#94a3b8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.bk-why{flex:1 1 100%;margin:0 0 var(--s-1,8px);font-size:12px;line-height:1.45;font-weight:700;color:var(--c-text-2,#cbd5e1)}' +
      '.bk-why[hidden]{display:none}' +
      '.bk-sheet-one{display:flex;flex-direction:column;gap:0;padding:2px 0;border-bottom:1px solid var(--c-line,rgba(148,163,184,.2))}' +
      '.bk-sheet-n{font-size:var(--fs-sm,14px);font-weight:800;color:var(--c-text-1,#fff);padding-top:6px;overflow-wrap:anywhere}' +
      '.bk-all{margin-top:var(--s-1,8px)}.bk-all summary{min-height:44px;display:flex;align-items:center;font-weight:800;cursor:pointer;color:var(--c-accent-hi,#A78BFA)}' +
      '.compare-table .bk-row{justify-content:center}.compare-table .bk-why{text-align:left;min-width:150px}' +
      '.cc-leg-body .bk-row{margin-top:0}';
    document.head.appendChild(s);
  }

  function init() {
    css();
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.bk-badge');
      if (b) {
        e.preventDefault(); e.stopPropagation();
        var row = b.closest('.bk-row'), why = row && row.querySelector('.bk-why');
        if (!why) return;
        var open = why.hasAttribute('hidden');
        if (open) why.removeAttribute('hidden'); else why.setAttribute('hidden', '');
        row.setAttribute('data-bk-open', open ? '1' : '0');
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      var cs = e.target.closest && e.target.closest('.call-sheet-btn');
      if (cs) { setContext(contextFromButton(cs)); renderSheet(); }
    }, true);
    var rcb = document.getElementById('rc-broker');
    if (rcb) rcb.addEventListener('input', syncRC);
    if (window.MutationObserver) new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
    load();
    soon();
  }

  window.BlackRamVet = {
    slotFor: slotFor, slotLedger: slotLedger, slot: slot, judge: judge, find: find, hydrate: hydrate,
    setContext: setContext, syncRC: syncRC, renderSheet: renderSheet, load: load, ready: function () { return !!data; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
