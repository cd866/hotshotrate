/* Black Ram Logistics - tappable tiles (v91+).
   One shared bottom sheet + delegated tap handling for summary tiles, KPI cards, chart bars and rows.
   A tile opts in with BlackRamTiles.attrs(key, arg, label) + class "tl-tap" (and "tl-chev" for the cue);
   each tab module registers its drill-down with BlackRamTiles.on(key, fn(arg, el)).
   Financial drill-downs are registered by the PIN-gated modules and only read data they already
   unlocked, so nothing new is public. Uses the v51 tokens. Plain ASCII. */
(function () {
  'use strict';
  var reg = {}, opener = null, host = null;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function attrs(key, arg, label) {
    return ' role="button" tabindex="0" aria-haspopup="dialog" data-tl="' + esc(key) + '"' + (arg != null ? ' data-tl-arg="' + esc(arg) + '"' : '') + (label ? ' aria-label="' + esc(label) + '"' : '');
  }
  function jumpAttrs(key, arg, label) { // same, but the tap moves on the page instead of opening a sheet
    return ' role="button" tabindex="0" data-tl="' + esc(key) + '"' + (arg != null ? ' data-tl-arg="' + esc(arg) + '"' : '') + (label ? ' aria-label="' + esc(label) + '"' : '');
  }
  function on(key, fn) { reg[key] = fn; }

  /* ---------- sheet ---------- */
  function sheetHost() {
    if (host) return host;
    host = document.createElement('div'); host.id = 'tl-sheet'; host.className = 'tl-sheet'; host.hidden = true;
    document.body.appendChild(host);
    host.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('[data-tl-close]')) close();
    });
    return host;
  }
  function open(o) {
    var h = sheetHost();
    if (!h.hidden && opener == null) opener = null;
    if (h.hidden) opener = document.activeElement;
    h.innerHTML = '<div class="tl-bd" data-tl-close="1"></div><div class="tl-p" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
      '<div class="tl-grab" aria-hidden="true"></div>' +
      '<div class="tl-h"><div><b>' + esc(o.title) + '</b>' + (o.sub ? '<span>' + o.sub + '</span>' : '') + '</div>' +
      '<button type="button" class="tl-x" data-tl-close="1" aria-label="Close">Close</button></div>' +
      '<div class="tl-body">' + (o.body || '') + '</div></div>';
    h.hidden = false;
    document.documentElement.classList.add('tl-noscroll');
    var x = h.querySelector('.tl-x'); if (x) x.focus();
    if (o.bind) { try { o.bind(h.querySelector('.tl-body')); } catch (e) { /* ignore */ } }
  }
  function close() {
    if (!host || host.hidden) return;
    host.hidden = true; host.innerHTML = '';
    document.documentElement.classList.remove('tl-noscroll');
    if (opener && opener.focus && document.contains(opener)) { try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); } }
    opener = null;
  }
  function isOpen() { return !!(host && !host.hidden); }

  /* ---------- building blocks for sheet bodies (callers pass escaped HTML) ---------- */
  function rows(list, empty) {
    if (!list || !list.length) return '<p class="tl-fine">' + esc(empty || 'Nothing to list.') + '</p>';
    return '<div class="tl-rows">' + list.map(function (r) {
      return '<div class="tl-r' + (r.cls ? ' ' + r.cls : '') + '">' + (r.d != null ? '<span class="tl-d">' + r.d + '</span>' : '') +
        '<span class="tl-m"><b>' + (r.t || '') + '</b>' + (r.s ? '<small>' + r.s + '</small>' : '') + '</span>' +
        '<span class="tl-v' + (r.vc ? ' ' + r.vc : '') + '">' + (r.v != null ? r.v : '') + (r.vs ? '<small>' + r.vs + '</small>' : '') + '</span></div>';
    }).join('') + '</div>';
  }
  function kv(list) {
    return '<div class="tl-kv">' + list.filter(Boolean).map(function (r) {
      return '<div class="tl-k' + (r[2] ? ' ' + r[2] : '') + '"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>';
    }).join('') + '</div>';
  }
  function hero(big, sub, tone) { return '<div class="tl-hero' + (tone ? ' tl-' + tone : '') + '"><b>' + big + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>'; }
  function sec(t) { return '<div class="tl-sec">' + esc(t) + '</div>'; }
  function fine(t) { return '<p class="tl-fine">' + t + '</p>'; }
  function btn(label, key, arg) { return '<button type="button" class="tl-go"' + ' data-tl="' + esc(key) + '"' + (arg != null ? ' data-tl-arg="' + esc(arg) + '"' : '') + '>' + esc(label) + '</button>'; }

  /* Move to a card on the page (optionally after switching tab) and flash it. */
  function jump(id, tab, after) {
    close();
    function go() {
      var t = document.getElementById(id);
      if (!t) return;
      if (t.tagName === 'DETAILS') t.open = true;
      var top = t.getBoundingClientRect().top + window.scrollY - ((parseInt(getComputedStyle(document.documentElement).getPropertyValue('--appbar-h'), 10) || 56) + 10);
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      t.classList.remove('tl-flash'); void t.offsetWidth; t.classList.add('tl-flash');
      setTimeout(function () { t.classList.remove('tl-flash'); }, 1400);
      if (after) after(t);
    }
    var A = window.BlackRamApp;
    if (tab && A && A.showTab && document.documentElement.getAttribute('data-tab') !== tab) {
      A.showTab(tab);
      var n = 0;
      (function wait() { if (document.getElementById(id) || n++ > 40) setTimeout(go, 60); else setTimeout(wait, 100); })();
    } else go();
  }

  /* ---------- delegated activation ---------- */
  function activate(el, ev) {
    var key = el.getAttribute('data-tl'), fn = reg[key];
    if (!fn) return false;
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    try { fn(el.getAttribute('data-tl-arg'), el); } catch (e) { if (window.console) console.error('tile ' + key, e); }
    return true;
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-tl]') : null;
    if (!el) return;
    var inner = e.target.closest('a[href], input, select, textarea');
    if (inner && el.contains(inner) && inner !== el) return;
    activate(el, e);
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) { close(); return; }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target;
    if (!el || !el.hasAttribute || !el.hasAttribute('data-tl') || /^(BUTTON|A)$/.test(el.tagName)) return;
    activate(el, e);
  });
  document.addEventListener('blackram:tab', function () { close(); });

  /* ---------- Rate Check: the verdict numbers open "Why and the math" ---------- */
  function rcWhy() {
    var d = document.getElementById('rc-why'); if (!d) return;
    d.open = true;
    jump('rc-why');
  }
  on('rc-why', rcWhy);
  function decorateRateCheck() {
    var v = document.getElementById('verdict'); if (!v) return;
    var els = [v.querySelector('.rcv-net')].concat([].slice.call(v.querySelectorAll('.rcv-stat')));
    els.forEach(function (el) {
      if (!el || el.hasAttribute('data-tl')) return;
      el.setAttribute('data-tl', 'rc-why'); el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', (el.innerText || '').replace(/\s+/g, ' ').trim() + '. Show why and the math');
      el.classList.add('tl-tap');
    });
  }

  /* ---------- Load Boards: NET EST, NET / DAY and TOTAL mi open the card's map and math ---------- */
  on('lb-math', function (arg, el) {
    var card = el.closest('.search-card, .combo-card'); if (!card) return;
    if (card.classList.contains('is-collapsed')) { var sum = card.querySelector('.card-summary'); if (sum) sum.click(); }
    var b = card.querySelector('.details-toggle-btn'), pane = card.querySelector('.search-details');
    if (b && pane && pane.hidden) b.click();
    if (pane && !pane.hidden) setTimeout(function () { pane.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 60);
  });
  function decorateBoards(root) {
    if (!root) return;
    root.querySelectorAll('.search-card .km-tile, .combo-card .km-tile, .search-card .mi-total, .combo-card .mi-total').forEach(function (el) {
      if (el.hasAttribute('data-tl')) return;
      var card = el.closest('.search-card, .combo-card');
      if (!card || !card.querySelector('.details-toggle-btn')) return;
      el.setAttribute('data-tl', 'lb-math'); el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', (el.innerText || '').replace(/\s+/g, ' ').trim() + '. Show map and math');
      el.classList.add('tl-tap');
      if (el.classList.contains('km-primary') || el.classList.contains('mi-total')) el.classList.add('tl-chev', 'tl-chev-top');
    });
  }

  /* ---------- styles (v51 tokens) ---------- */
  function css() {
    if (document.getElementById('tl-css')) return;
    var s = document.createElement('style'); s.id = 'tl-css';
    s.textContent =
      '.tl-noscroll,.tl-noscroll body{overflow:hidden}' +
      '.tl-tap{cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .08s ease,border-color .12s ease,background-color .12s ease}' +
      '.tl-tap:hover{border-color:var(--c-line-strong)}' +
      '.tl-tap:active{transform:scale(.985)}' +
      '.tl-tap:focus-visible{outline:2px solid var(--c-accent-hi);outline-offset:2px;border-radius:var(--radius-sm)}' +
      'g.tl-tap:focus-visible{outline:none}g.tl-tap:focus-visible rect:first-child{stroke:var(--c-accent-hi);stroke-width:2}' +
      'g.tl-tap:active{transform:none;opacity:.8}' +
      '.tl-chev{position:relative;padding-right:26px!important}' +
      '.tl-chev::after{content:"";position:absolute;right:11px;top:50%;width:7px;height:7px;border-top:2px solid var(--c-text-3);border-right:2px solid var(--c-text-3);transform:translateY(-50%) rotate(45deg);opacity:.9;pointer-events:none}' +
      '.tl-chev-top::after{top:15px;transform:rotate(45deg)}' +
      '.tl-chev-row::after{content:"";flex:none;align-self:center;width:6px;height:6px;margin-left:6px;border-top:2px solid var(--c-text-3);border-right:2px solid var(--c-text-3);transform:rotate(45deg)}' +
      '.tl-corner{position:relative}.tl-corner::after{content:"";position:absolute;right:7px;bottom:8px;width:5px;height:5px;border-top:2px solid var(--c-text-3);border-right:2px solid var(--c-text-3);transform:rotate(45deg);opacity:.8;pointer-events:none}' +
      '.fin-owed-link{cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}' +
      '.sb-t.tl-chev{padding-right:12px!important}.sb-t.tl-chev::after{right:7px;top:17px}.sb-t.tl-chev .sb-l{margin-right:9px}' +
      '.sb-hero.tl-chev::after{top:16px;transform:rotate(45deg)}' +
      '.tl-chev-row>b:last-of-type{margin-left:auto}' +
      '.tl-flash{animation:tlFlash 1.3s ease-out}' +
      '@keyframes tlFlash{0%{box-shadow:0 0 0 2px var(--c-gold)}100%{box-shadow:0 0 0 2px rgba(242,201,76,0)}}' +
      '.tl-sheet{position:fixed;inset:0;z-index:2750}.tl-sheet[hidden]{display:none}' +
      '.tl-bd{position:absolute;inset:0;background:rgba(4,3,8,.66)}' +
      '.tl-p{position:absolute;left:0;right:0;bottom:0;max-height:88dvh;display:flex;flex-direction:column;background:var(--c-surface-2);border-top:1px solid var(--c-line-strong);border-radius:var(--radius-xl) var(--radius-xl) 0 0;box-shadow:var(--shadow-2);animation:moreUp .18s ease-out;padding-bottom:env(safe-area-inset-bottom)}' +
      '@media(min-width:720px){.tl-p{left:50%;right:auto;width:560px;transform:translateX(-50%)}}' +
      '.tl-grab{width:40px;height:4px;border-radius:2px;background:var(--c-line-strong);margin:8px auto 0}' +
      '.tl-h{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s-1);padding:var(--s-1h) var(--s-2) var(--s-1)}' +
      '.tl-h b{display:block;font-size:var(--fs-lg);font-weight:900;color:var(--c-text-1);line-height:1.2}.tl-h span{display:block;font-size:var(--fs-xs);color:var(--c-text-3);font-weight:700;margin-top:2px}' +
      '.tl-x{min-height:36px;padding:0 14px;border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-3);color:var(--c-text-1);font:inherit;font-size:var(--fs-sm);font-weight:800;cursor:pointer;flex:none}' +
      '.tl-body{overflow-y:auto;overscroll-behavior:contain;padding:0 var(--s-2) var(--s-3);display:flex;flex-direction:column;gap:var(--s-1h)}' +
      '.tl-body>*{flex-shrink:0}' +
      '.tl-hero{display:flex;flex-direction:column;gap:2px;background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-md);padding:var(--s-1h)}' +
      '.tl-hero b{font-size:var(--fs-2xl);font-weight:var(--fw-black);color:var(--c-gold);line-height:1.1}.tl-hero span{font-size:var(--fs-sm);font-weight:700;color:var(--c-text-3)}' +
      '.tl-hero.tl-bad b{color:#FCA5A5}.tl-hero.tl-good b{color:var(--c-take)}.tl-hero.tl-warn b{color:var(--c-maybe)}' +
      '.tl-sec{font-size:var(--fs-xs);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-accent-hi);margin-top:4px}' +
      '.tl-rows{display:flex;flex-direction:column;background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-md);overflow:hidden}' +
      '.tl-r{display:flex;align-items:flex-start;gap:var(--s-1);padding:9px var(--s-1h);border-bottom:1px solid var(--c-line);font-size:var(--fs-sm)}.tl-r:last-child{border-bottom:0}' +
      '.tl-d{flex:none;min-width:40px;font-weight:800;color:var(--c-text-3);font-size:var(--fs-xs);padding-top:1px}' +
      '.tl-m{flex:1;min-width:0}.tl-m b{display:block;font-weight:800;color:var(--c-text-1);overflow-wrap:anywhere}.tl-m small{display:block;font-size:11px;color:var(--c-text-3);line-height:1.35;margin-top:1px}' +
      '.tl-v{flex:none;text-align:right;font-weight:900;color:var(--c-text-1);font-variant-numeric:tabular-nums}.tl-v small{display:block;font-size:11px;font-weight:700;color:var(--c-text-3)}' +
      '.tl-v.pos{color:var(--c-take)}.tl-v.neg{color:#FCA5A5}.tl-v.warn{color:var(--c-maybe)}' +
      '.tl-r.tl-tot{background:var(--c-surface-3)}.tl-r.tl-tot .tl-m b{color:var(--c-gold)}' +
      '.tl-kv{display:grid;grid-template-columns:1fr 1fr;gap:var(--s-1)}' +
      '.tl-k{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-md);padding:var(--s-1) var(--s-1h);min-width:0}.tl-k.wide{grid-column:1/-1}' +
      '.tl-k span{display:block;font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text-3)}.tl-k b{display:block;font-size:var(--fs-md);font-weight:900;color:var(--c-text-1);overflow-wrap:anywhere}' +
      '.tl-fine{margin:0;font-size:11px;color:var(--c-text-3);line-height:1.45}' +
      '.tl-go{align-self:flex-start;min-height:40px;padding:0 16px;border-radius:var(--radius-pill);border:1px solid var(--c-accent);background:transparent;color:var(--c-accent-hi);font:inherit;font-size:var(--fs-sm);font-weight:800;cursor:pointer}' +
      '.tl-hint{font-size:11px;font-weight:700;color:var(--c-text-3)}';
    document.head.appendChild(s);
  }

  function init() {
    css();
    decorateRateCheck();
    var sr = document.getElementById('panel-searches');
    if (sr) {
      decorateBoards(sr);
      var t = null;
      new MutationObserver(function () { if (t) return; t = setTimeout(function () { t = null; decorateBoards(sr); }, 80); }).observe(sr, { childList: true, subtree: true });
    }
  }

  window.BlackRamTiles = { on: on, attrs: attrs, jumpAttrs: jumpAttrs, open: open, close: close, isOpen: isOpen, jump: jump,
    rows: rows, kv: kv, hero: hero, sec: sec, fine: fine, btn: btn, esc: esc };
  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { tiles: window.BlackRamTiles });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
