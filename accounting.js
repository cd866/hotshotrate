/* Black Ram Logistics - Accounting tab (v55+).
   PIN-gated: every number comes from the relay /financials (Worker KV payload key "accounting",
   built by push_financials.py + accounting_build.py on the box). Nothing financial is in this repo.
   Wrong PIN = locked, nothing shown. CSV export is generated in the browser after unlock.
   Uses v51 design tokens; extends window.BlackRamApp (never overwrites it). Plain ASCII text. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var FIN_KEY = 'blackram_fin_session_v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var COL = { fee: '#a78bfa', eld: '#c4b5fd', fuel: '#F2C94C', def: '#F5D76A', tolls: '#60A5FA', repairs: '#FB923C',
    insurance: '#F472B6', driver: '#FDBA74', notes: '#F87171', software: '#34D399', meals: '#E8B86D', overhead: '#8a84a3' };
  var SHORT = { fee: 'Totni 13%', eld: 'ELD fees', fuel: 'Fuel', def: 'DEF', tolls: 'Tolls/scales', repairs: 'Repairs', insurance: 'Insurance', driver: 'Driver pay', notes: 'Loan notes', software: 'Software', meals: 'Meals (50%)', overhead: 'Overhead' };
  var st = { data: null, loading: false, error: '', sel: null, fetchedAt: 0, openExp: false };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function m2(n) { if (n == null || !isFinite(n)) return '-'; var a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < -0.004 ? '-$' : '$') + a; }
  function m0(n) { if (n == null || !isFinite(n)) return '-'; var a = Math.abs(Math.round(n)).toLocaleString('en-US'); return (n <= -0.5 ? '-$' : '$') + a; }
  function day(iso) { if (!iso) return 'date?'; var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function monLbl(k) { if (k === 'all') return 'All time'; var p = k.split('-'); return MON[Number(p[1]) - 1] + ' ' + p[0]; }
  function monShort(k) { if (k === 'all') return 'All'; return MON[Number(k.split('-')[1]) - 1]; }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private mode */ } }
  function root() { return document.getElementById('acct-root'); }
  function ta(arg, label) { var T = window.BlackRamTiles; return T ? T.attrs('ac', arg, label) : ''; }
  function inMonth(iso) { return st.sel === 'all' || String(iso || '').slice(0, 7) === st.sel; }

  /* ---------- data ---------- */
  function fromCache() {
    try { var c = sessionStorage.getItem(FIN_KEY); if (!c) return null; var j = JSON.parse(c); return j && j.accounting ? j : null; } catch (e) { return null; }
  }
  function fetchData(force) {
    var p = pin();
    if (!p) { st.error = 'nopin'; render(); return; }
    if (st.loading) return;
    if (!force && st.data && Date.now() - st.fetchedAt < 60000) return;
    st.loading = true;
    if (!st.data) render();
    fetch(RELAY + '/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }), cache: 'no-store' })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (resp.ok && j && j.ok && j.data) {
            st.error = ''; st.fetchedAt = Date.now();
            st.data = j.data.accounting ? j.data : null;
            if (!st.data) st.error = 'Accounting data is not on the server yet.';
            try { sessionStorage.setItem(FIN_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ }
          } else if (resp.status === 401) {
            st.error = 'wrongpin'; st.data = null;
            try { sessionStorage.removeItem(FIN_KEY); } catch (e) { /* ignore */ }
          } else {
            st.error = (j && j.error) || ('Could not load (' + resp.status + ')');
          }
        });
      })
      .catch(function () { st.error = 'Offline - showing the last copy if any.'; })
      .then(function () {
        st.loading = false; render();
        if (st.data) { try { document.dispatchEvent(new CustomEvent('blackram:financials')); } catch (e) { /* ignore */ } }
      });
  }

  /* ---------- charts (inline SVG) ---------- */
  function plChart(A) {
    var ms = A.months, W = 340, H = 168, pad = 26, base = 120, top = 18;
    var mx = 1; ms.forEach(function (k) { var p = A.pl[k]; mx = Math.max(mx, p.gross, p.costs); });
    var bw = Math.min(26, (W - pad * 2) / ms.length / 3), gap = (W - pad * 2) / ms.length;
    var o = ['<svg class="ac-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Monthly revenue, costs and net">'];
    o.push('<line x1="' + pad + '" y1="' + base + '" x2="' + (W - pad) + '" y2="' + base + '" stroke="var(--c-line-strong)"/>');
    ms.forEach(function (k, i) {
      var p = A.pl[k], cx = pad + gap * i + gap / 2, hr = (p.gross / mx) * (base - top), hc = (p.costs / mx) * (base - top);
      var sel = st.sel === k;
      o.push('<g class="ac-bar" data-ac-month="' + esc(k) + '" style="cursor:pointer">');
      o.push('<rect x="' + (cx - gap / 2 + 2) + '" y="4" width="' + (gap - 4) + '" height="' + (H - 8) + '" rx="10" fill="' + (sel ? 'rgba(167,139,250,.12)' : 'transparent') + '"/>');
      o.push('<rect x="' + (cx - bw - 2) + '" y="' + (base - hr) + '" width="' + bw + '" height="' + Math.max(hr, 1) + '" rx="4" fill="var(--c-take)"/>');
      o.push('<rect x="' + (cx + 2) + '" y="' + (base - hc) + '" width="' + bw + '" height="' + Math.max(hc, 1) + '" rx="4" fill="#F87171"/>');
      o.push('<text x="' + cx + '" y="' + (base + 16) + '" text-anchor="middle" font-size="12" font-weight="700" fill="var(--c-text-2)">' + monShort(k) + '</text>');
      o.push('<text x="' + cx + '" y="' + (base + 34) + '" text-anchor="middle" font-size="12" font-weight="800" fill="' + (p.net < 0 ? '#FCA5A5' : 'var(--c-take)') + '">' + m0(p.net) + '</text>');
      o.push('</g>');
    });
    o.push('</svg>');
    return o.join('');
  }
  function donut(parts, total, center) {
    var R = 54, C = 2 * Math.PI * R, off = 0, o = ['<svg class="ac-donut" viewBox="0 0 140 140" role="img" aria-label="Expenses by category">'];
    o.push('<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="var(--c-surface-3)" stroke-width="20"/>');
    parts.forEach(function (p) {
      if (!total || p.v <= 0) return;
      var len = p.v / total * C;
      o.push('<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + p.c + '" stroke-width="20" stroke-dasharray="' + Math.max(len - 1.2, 0.5).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)"/>');
      off += len;
    });
    o.push('<text x="70" y="66" text-anchor="middle" font-size="18" font-weight="800" fill="var(--c-text-1)">' + esc(center) + '</text>');
    o.push('<text x="70" y="84" text-anchor="middle" font-size="11" font-weight="700" fill="var(--c-text-3)">costs</text></svg>');
    return o.join('');
  }
  function cashChart(c) {
    var hist = c.history || [], proj = c.proj || [], alt = c.proj_if_paid || [];
    var all = hist.concat(proj).concat(alt);
    if (!all.length) return '';
    function t(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)); }
    var t0 = t(all[0][0]), t1 = t0; all.forEach(function (p) { t0 = Math.min(t0, t(p[0])); t1 = Math.max(t1, t(p[0])); });
    var lo = 0, hi = 0; all.forEach(function (p) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
    var W = 340, H = 170, L = 8, R = 8, T = 14, B = 26;
    function X(s) { return L + (t(s) - t0) / Math.max(t1 - t0, 1) * (W - L - R); }
    function Y(v) { return T + (hi - v) / Math.max(hi - lo, 1) * (H - T - B); }
    function path(a) { return a.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join(''); }
    var o = ['<svg class="ac-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Bluevine balance and 30-day projection">'];
    o.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="var(--c-line-strong)" stroke-dasharray="3 3"/>');
    if (Y(lo) > Y(0) + 2) o.push('<rect x="' + L + '" y="' + Y(0) + '" width="' + (W - L - R) + '" height="' + (Y(lo) - Y(0)) + '" fill="rgba(248,113,113,.08)"/>');
    if (alt.length) o.push('<path d="' + path(alt) + '" fill="none" stroke="var(--c-take)" stroke-width="1.6" stroke-dasharray="4 4" opacity=".8"/>');
    if (proj.length) o.push('<path d="' + path(proj) + '" fill="none" stroke="var(--c-gold)" stroke-width="2.2" stroke-dasharray="6 4"/>');
    if (hist.length) o.push('<path d="' + path(hist) + '" fill="none" stroke="var(--c-accent-hi)" stroke-width="2.6"/>');
    if (hist.length) { var lp = hist[hist.length - 1]; o.push('<circle cx="' + X(lp[0]) + '" cy="' + Y(lp[1]) + '" r="3.5" fill="var(--c-accent-hi)"/>'); }
    var ticks = [all[0][0], proj.length ? proj[0][0] : null, proj.length ? proj[proj.length - 1][0] : null].filter(Boolean);
    ticks.forEach(function (s, i) { o.push('<text x="' + X(s) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : (i === ticks.length - 1 ? 'end' : 'middle')) + '" font-size="11" fill="var(--c-text-3)">' + day(s) + '</text>'); });
    o.push('<text x="' + (W - R) + '" y="' + (Y(hi) + 10) + '" text-anchor="end" font-size="11" fill="var(--c-text-3)">' + m0(hi) + '</text>');
    o.push('<text x="' + (L + 2) + '" y="' + (Y(lo) - 4) + '" text-anchor="start" font-size="11" fill="#FCA5A5">Low ' + m0(lo) + '</text>');
    o.push('</svg>');
    return o.join('');
  }

  /* ---------- sections ---------- */
  function card(title, sub, body, id) {
    return '<section class="ac-card"' + (id ? ' id="' + id + '"' : '') + '><div class="ac-h"><h3>' + esc(title) + '</h3>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>' + body + '</section>';
  }
  function call(tone, text) { return '<p class="ac-call ac-' + tone + '">' + text + '</p>'; }
  function srcTag(s) {
    var k = /bluevine/i.test(s) ? 'bv' : (/amex/i.test(s) ? 'ax' : (/partner/i.test(s) ? 'pp' : (/totni/i.test(s) ? 'tw' : 'lc')));
    return '<span class="ac-src ac-src-' + k + '">' + esc(s) + '</span>';
  }
  function statusPill(s) {
    var k = /^deposited/i.test(s) ? 'ok' : (/meshach/i.test(s) ? 'held' : (/short/i.test(s) ? 'short' : 'pend'));
    return '<span class="ac-pill ac-pill-' + k + '">' + esc(s) + '</span>';
  }

  function secPL(A) {
    var p = A.pl[st.sel], cats = A.cats, rows = [];
    rows.push('<div class="ac-l ac-l-rev tl-tap tl-chev-row"' + ta('rev', 'Gross revenue ' + m2(p.gross) + '. Show the loads') + '><span>Gross revenue <small>' + p.loads + ' load' + (p.loads === 1 ? '' : 's') + '</small></span><b>' + m2(p.gross) + '</b></div>');
    cats.forEach(function (c) {
      var v = p.lines[c.key] || 0;
      if (c.key === 'notes') rows.push('<div class="ac-l ac-l-sub"><span>Operating net (before notes)</span><b class="' + (p.op_net < 0 ? 'neg' : 'pos') + '">' + m2(p.op_net) + '</b></div>');
      rows.push('<div class="ac-l' + (v ? ' tl-tap tl-chev-row"' + ta('cat:' + c.key, c.label + ' ' + m2(v) + '. Show the lines') : '"') + '><span><i style="background:' + COL[c.key] + '"></i>' + esc(c.label) + '</span><b>' + (v ? '-' + m2(v).replace('-', '') : '$0.00') + '</b></div>');
    });
    var wf = p.waterfall;
    rows.push('<div class="ac-l ac-l-net"><span>Net after all expenses</span><b class="' + (p.net < 0 ? 'neg' : 'pos') + '">' + m2(p.net) + '</b></div>');
    var tgt = wf.target || 0;
    if (tgt) rows.push('<div class="ac-l ac-l-sub"><span>Driver pay this month <small>' + m0(wf.driver_pay) + ' of ' + m0(tgt) + '</small></span><b>' + (wf.driver_pay ? '-' + m2(wf.driver_pay).replace('-', '') : '$0.00') + '</b></div>');
    rows.push('<div class="ac-l ac-l-net"><span>Left to split (1/3 each)</span><b class="' + (wf.left > 0 ? 'pos' : '') + '">' + m2(wf.left) + '</b></div>');
    if (wf.split) {
      ['Claudio', 'Ben', 'Meshach'].forEach(function (n) {
        rows.push('<div class="ac-l"><span>' + n + '\'s third' + (n === 'Meshach' ? ' <small>on top of his wage</small>' : '') + '</span><b>' + m2(wf.split[n]) + '</b></div>');
      });
    }
    var diff = [];
    if (Math.abs(p.report_net - p.net) > 0.01) {
      diff.push('Nightly report "kept" for ' + esc(monLbl(st.sel)) + ' is ' + m2(p.report_net) + ' (gross less 13% and ledger costs). This view also counts ' +
        'loan payments' + (p.lines.insurance ? ', partner-paid insurance' : '') + (p.lines.eld ? ', ELD withheld' : '') + ' and TONU income.');
    }
    var top = cats.filter(function (c) { return c.key !== 'fee'; }).map(function (c) { return { k: c.label, v: p.lines[c.key] || 0 }; }).sort(function (a, b) { return b.v - a.v; })[0];
    var callouts = '<div class="ac-calls">' +
      call(p.net < 0 ? 'bad' : 'good', '<b>' + m0(p.net) + '</b> net ' + (st.sel === 'all' ? 'all time' : 'in ' + esc(monShort(st.sel))) + (p.margin != null ? ' (' + Math.round(p.margin) + '% of gross)' : '')) +
      (top && top.v ? call('ok', 'Biggest cost: <b>' + esc(top.k) + '</b> ' + m0(top.v)) : '') +
      call(p.op_net < 0 ? 'bad' : 'good', 'Before notes: <b>' + m0(p.op_net) + '</b>') + '</div>';
    return card('Profit and loss', esc(monLbl(st.sel)) + ' | cash basis',
      plChart(A) + '<div class="ac-legend"><span><i style="background:var(--c-take)"></i>Revenue</span><span><i style="background:#F87171"></i>Costs</span><span>Net under each month. Tap a month.</span></div>' +
      callouts + '<div class="ac-pl">' + rows.join('') + '</div><p class="ac-fine tl-hint">Tap a line to see what makes it up.</p>' + (diff.length ? '<p class="ac-fine">' + diff.join(' ') + '</p>' : ''), 'ac-pl');
  }

  function wfChart(w) {
    var W = 340, H = 196, L = 6, R = 6, T = 22, B = 44;
    var lvl = 0, bars = [], lo = 0, hi = 1;
    w.steps.forEach(function (x, i) {
      if (i === 0) { bars.push({ a: 0, b: x.amount, k: 'total', v: x.amount, t: 'Gross', d: 'rev' }); lvl = x.amount; }
      else { bars.push({ a: lvl, b: lvl + x.amount, k: 'neg', v: x.amount, t: i === 1 ? 'Totni+ELD' : (i === 2 ? 'Truck costs' : 'Notes'), d: i === 1 ? 'wf:fee' : (i === 2 ? 'wf:ops' : 'cat:notes') }); lvl += x.amount; }
      lo = Math.min(lo, lvl); hi = Math.max(hi, lvl);
    });
    bars.push({ a: 0, b: w.net, k: w.net >= 0 ? 'sub' : 'short', v: w.net, t: 'Net after exp.', d: 'jump:ac-pl' });
    bars.push({ a: Math.max(w.net, 0), b: Math.max(w.net, 0) - w.driver_pay, k: 'drv', v: -w.driver_pay, t: 'Meshach', d: 'jump:ac-driver' });
    bars.push({ a: 0, b: w.left, k: 'left', v: w.left, t: '1/3 each', d: 'jump:ac-partners' });
    hi = Math.max(hi, 1);
    var n = bars.length, gap = (W - L - R) / n, bw = gap - 6;
    function Y(v) { return T + (hi - v) / Math.max(hi - lo, 1) * (H - T - B); }
    var COLR = { total: 'var(--c-take)', neg: '#F87171', sub: '#60A5FA', short: '#FB7185', drv: '#FDBA74', left: 'var(--c-gold)' };
    var o = ['<svg class="ac-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Profit waterfall">'];
    o.push('<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="var(--c-line-strong)"/>');
    bars.forEach(function (b, i) {
      var x = L + gap * i + 3, y1 = Y(Math.max(b.a, b.b)), y2 = Y(Math.min(b.a, b.b));
      o.push('<g class="tl-tap"' + ta(b.d, b.t + ' ' + m0(b.v) + '. Show details') + '><rect x="' + (x - 2) + '" y="2" width="' + (bw + 4) + '" height="' + (H - 4) + '" rx="6" fill="transparent"/>');
      o.push('<rect x="' + x + '" y="' + y1 + '" width="' + bw + '" height="' + Math.max(y2 - y1, 2) + '" rx="4" fill="' + COLR[b.k] + '"' + (b.k === 'drv' || b.k === 'left' ? ' opacity="' + (b.v ? 1 : 0.5) + '"' : '') + '/>');
      o.push('<text x="' + (x + bw / 2) + '" y="' + (Math.min(y1, y2) - 4) + '" text-anchor="middle" font-size="9.5" font-weight="800" fill="var(--c-text-1)">' + m0(b.v) + '</text>');
      var words = b.t.split(' ');
      o.push('<text x="' + (x + bw / 2) + '" y="' + (H - 26) + '" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--c-text-3)">' + esc(words[0]) + '</text>');
      if (words[1]) o.push('<text x="' + (x + bw / 2) + '" y="' + (H - 15) + '" text-anchor="middle" font-size="8.5" font-weight="700" fill="var(--c-text-3)">' + esc(words[1]) + '</text>');
      o.push('</g>');
    });
    o.push('</svg>');
    return o.join('');
  }
  function secWaterfall(A) {
    var w = A.pl[st.sel].waterfall, lab = st.sel === 'all' ? 'all time' : monShort(st.sel);
    var D = A.driver;
    var thirds = ['Claudio', 'Ben', 'Meshach'].map(function (n) {
      return '<div><span>' + n + (n === 'Meshach' ? ' <small>+ wage</small>' : '') + '</span><b>' + m0(w.split && w.split[n] || w.third || 0) + '</b></div>';
    }).join('');
    var tgt = w.target || 0;
    var need = w.net < 0 ? Math.ceil(-w.net / 0.87 / 10) * 10 : 0;
    var needD = tgt && (w.net - tgt) < 0 ? Math.ceil((tgt - w.net) / 0.87 / 10) * 10 : 0;
    var body = wfChart(w) + '<p class="ac-fine tl-hint">Tap a bar to see what makes it up.</p>' +
      '<div class="ac-calls">' +
      (w.net < 0 ? call('bad', 'Net after ALL expenses is <b>' + m0(w.net) + '</b> in ' + esc(lab) + '. Nothing is left to pay Meshach or the partners.') :
        call('good', 'Net after all expenses <b>' + m0(w.net) + '</b>')) +
      (tgt ? call('ok', 'Driver pay this month: <b>' + m0(w.driver_pay) + '</b> of ' + m0(tgt) + ' covered from profit. A shortfall is not a debt.') : '') +
      (needD ? call('ok', 'Needs about <b>' + m0(needD) + '</b> more gross (after Totni 13%) to cover expenses AND Meshach\'s ' + m0(tgt) + ' target') : '') +
      call(w.left > 0 ? 'good' : 'ok', 'Left to split three ways: <b>' + m0(w.left) + '</b> (' + m0(w.third || 0) + ' each)') + '</div>' +
      '<div class="ac-tot' + (w.left > 0 ? '' : ' ac-dim') + '">' + thirds + '</div>' +
      '<p class="ac-fine">Order: all bills and expenses first (Totni, ELD, fuel, DEF, tolls, repairs, insurance, software, meals, overhead and the truck and trailer notes) = net after expenses. Meshach\'s $' + D.monthly.toLocaleString('en-US') + '/mo comes ONLY from actual profit left after that. A shortfall is not accrued and is not a debt. The remainder is split in thirds among Claudio, Ben and Meshach. Meshach\'s third is on top of his pay.</p>';
    return card('Profit waterfall', esc(monLbl(st.sel)), body, 'ac-wf');
  }
  function pctCoc(n) {
    if (n == null || !isFinite(n)) return '-';
    var p = n * 100;
    var txt = (Math.abs(p) >= 10 ? p.toFixed(0) : p.toFixed(1)).replace(/\.0$/, '');
    return txt + '%';
  }
  function cocFill(val, lo, hi) {
    function x(v) { return Math.max(0, Math.min(100, (v - lo) / ((hi - lo) || 1) * 100)); }
    var v = (val == null || !isFinite(val)) ? lo : val;
    var a = x(0), b = x(v);
    var left = Math.min(a, b), w = Math.max(Math.abs(b - a), 1.2);
    return { left: left, w: w, zero: a, mark: x(0.20), pos: v >= 0, pct: pctCoc(val) };
  }

  /* ---------- cash invested vs cash back (v100) ---------- */
  var SRC_COL = { truck_down: '#8a84a3', trailer_down: '#a78bfa', equip: '#c4b5fd', ins_down: '#F472B6', llc: '#60A5FA', card: '#FB923C', trip: '#34D399' };
  function cocInvestChart(c) {
    var iv = c.invest, W = 340, rowH = 30, top = 6, lab = 62, right = 64, bw = W - lab - right;
    var parts = iv.partners.slice();
    var mx = 1; parts.forEach(function (p) { mx = Math.max(mx, p.total); });
    var H = top + parts.length * rowH + 4;
    var o = ['<svg class="ac-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cash invested by partner and source">'];
    parts.forEach(function (pt, i) {
      var y = top + i * rowH, x = lab;
      o.push('<text x="0" y="' + (y + 17) + '" font-size="12" font-weight="700" fill="var(--c-text-2)">' + esc(pt.name) + '</text>');
      iv.sources.forEach(function (sr) {
        var v = sr.by_partner[pt.name] || 0; if (v <= 0) return;
        var w = v / mx * bw;
        o.push('<rect x="' + x.toFixed(1) + '" y="' + (y + 4) + '" width="' + Math.max(w - 1, 1).toFixed(1) + '" height="18" rx="3" fill="' + (SRC_COL[sr.key] || '#8a84a3') + '"/>');
        x += w;
      });
      o.push('<text x="' + (x + 6).toFixed(1) + '" y="' + (y + 18) + '" font-size="12" font-weight="800" fill="var(--num-yellow,#F2C94C)">' + m0(pt.total) + '</text>');
    });
    o.push('</svg>');
    var leg = iv.sources.map(function (sr) {
      return '<span><i style="background:' + (SRC_COL[sr.key] || '#8a84a3') + '"></i>' + esc(sr.label.replace(' (EST)', '')) + '</span>';
    }).join('');
    return o.join('') + '<div class="ac-legend">' + leg + '</div>';
  }
  function cocBackChart(c) {
    var b = c.back, inv = c.invest.total, W = 340, H = 176, padL = 26, padR = 62, top = 16, bot = 28;
    var pts = [{ l: 'Start', v: 0 }].concat(b.months.map(function (m) { return { l: monShort(m.month), v: m.cum }; }));
    var lo = Math.min(0, Math.min.apply(null, pts.map(function (q) { return q.v; }))), hi = Math.max(inv, 0);
    var span = (hi - lo) || 1, ph = H - top - bot, pw = W - padL - padR;
    function X(i) { return padL + (pts.length > 1 ? i / (pts.length - 1) : 0) * pw; }
    function Y(v) { return top + (hi - v) / span * ph; }
    var o = ['<svg class="ac-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cumulative cash back versus cash invested">'];
    o.push('<line x1="' + padL + '" y1="' + Y(inv).toFixed(1) + '" x2="' + (W - padR + 6) + '" y2="' + Y(inv).toFixed(1) + '" stroke="#F2C94C" stroke-width="1.6" stroke-dasharray="5 4"/>');
    o.push('<text x="' + (W - padR + 10) + '" y="' + (Y(inv) + 4).toFixed(1) + '" font-size="11" font-weight="800" fill="#F2C94C">' + m0(inv) + '</text>');
    o.push('<text x="' + padL + '" y="' + (Y(inv) - 5).toFixed(1) + '" font-size="10" font-weight="700" fill="var(--c-text-3)">Cash invested = payback line</text>');
    o.push('<line x1="' + padL + '" y1="' + Y(0).toFixed(1) + '" x2="' + (W - padR + 6) + '" y2="' + Y(0).toFixed(1) + '" stroke="var(--c-line-strong)"/>');
    o.push('<text x="' + (W - padR + 10) + '" y="' + (Y(0) + 4).toFixed(1) + '" font-size="11" fill="var(--c-text-3)">$0</text>');
    var d = pts.map(function (q, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(q.v).toFixed(1); }).join(' ');
    o.push('<path d="' + d + '" fill="none" stroke="#a78bfa" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>');
    pts.forEach(function (q, i) {
      o.push('<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(q.v).toFixed(1) + '" r="4" fill="#a78bfa"/>');
      o.push('<text x="' + X(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="12" font-weight="700" fill="var(--c-text-2)">' + esc(q.l) + '</text>');
    });
    var last = pts[pts.length - 1], li = pts.length - 1;
    o.push('<text x="' + (X(li) + 8).toFixed(1) + '" y="' + (Y(last.v) + 4).toFixed(1) + '" font-size="12" font-weight="800" fill="var(--num-yellow,#F2C94C)">' + m0(last.v) + '</text>');
    o.push('</svg>');
    return o.join('');
  }
  function secCocMoney(A) {
    var c = A.coc, iv = c.invest, b = c.back, s = c.since_start || {}, rr = b.run_rate || {}, need = c.needed || {};
    var tgt = c.target || 0.2, pctT = Math.round(tgt * 100) + '%';
    var cocA = (rr.ann != null && c.invested) ? rr.ann / c.invested : s.coc_after;
    var tile = function (lab, val, sub) { return '<div class="ac-ci-t"><span>' + lab + '</span><b class="num-yellow">' + val + '</b><small>' + sub + '</small></div>'; };
    var tiles = '<div class="ac-ci-tiles">' +
      tile('Cash invested', m0(iv.total), iv.est_total ? 'incl. ' + m0(iv.est_total) + ' EST' : 'all documented') +
      tile('Cash back to date', m0(b.to_date), 'net after bills | paid out ' + m0(b.returned_cash)) +
      tile('Payback (EST)', b.payback_months != null ? b.payback_months.toFixed(1) + ' mo' : 'n/a', b.payback_months != null ? 'at current pace' : 'cash back is negative') + '</div>';
    var rows = iv.sources.map(function (sr) {
      var by = iv.partners.map(function (pt) { var v = sr.by_partner[pt.name] || 0; return v ? esc(pt.name) + ' ' + m0(v) : ''; }).filter(Boolean).join(' | ');
      var none = !sr.total;
      var sub = none ? esc(sr.note || 'not on file') : by + (sr.est ? ' | ' + m0(sr.est) + ' EST' : '');
      return '<div class="ac-xr' + (none ? '' : ' tl-tap tl-chev-row"' + ta('src:' + sr.key, sr.label + ' ' + m2(sr.total) + '. Show items')) + (none ? '"' : '') + '><span class="ac-xv"><i class="ac-sw" style="background:' + (SRC_COL[sr.key] || '#8a84a3') + '"></i>' + esc(sr.label) + '<small>' + sub + '</small></span><b>' + m0(sr.total) + '</b></div>';
    }).join('');
    var mrows = b.months.map(function (m) {
      return '<div class="ac-xr"><span class="ac-xd">' + esc(monShort(m.month)) + '</span><span class="ac-xv">Gross ' + m0(m.gross) + ' | bills and costs ' + m0(m.costs) + '<small>running total ' + m0(m.cum) + '</small></span><b class="' + (m.net < 0 ? 'ac-neg' : 'ac-pos') + '">' + m0(m.net) + '</b></div>';
    }).join('');
    var formula = 'CoC = annual cash back / cash invested = ' + (rr.ann != null ? m0(rr.ann) : 'not on file') + ' / ' + m0(c.invested) + ' = ' + pctCoc(cocA) + ' (EST) vs ' + pctT + ' target';
    var pay = b.payback_months != null ? b.payback_months.toFixed(1) + ' months at the current pace (EST)' : 'not at the current pace (cash back is ' + (rr.mo < 0 ? 'negative' : 'zero') + ')';
    var calls = [];
    if (b.to_date < 0) calls.push(call('bad', 'Nothing has come back yet. After all bills, <b>' + m0(-b.to_date) + '</b> more went out than came in.'));
    else calls.push(call('good', 'Cash back to date <b>' + m0(b.to_date) + '</b> after all bills.'));
    calls.push(call('ok', 'To earn ' + pctT + ' you need <b>' + m0(need.mo_after) + '/mo</b> left after bills and Meshach (' + m0(need.ann_after) + '/yr). Payback at that pace: ' + (b.payback_at_target_months != null ? b.payback_at_target_months.toFixed(0) + ' months' : 'not on file') + '.'));
    var nof = (iv.not_on_file || []).map(function (x) { return '<li>' + esc(x) + ': not on file</li>'; }).join('');
    return '<div class="ac-coc-hero"><div class="ac-kicker">Cash on cash, EST run rate, after Meshach</div><div class="ac-coc-big">' + pctCoc(cocA) + '</div>' +
        '<p>vs ' + pctT + ' target | ' + (rr.days || '') + ' days annualized</p></div>' + tiles +
      '<div class="ac-sub">Cash invested by partner and source</div>' + cocInvestChart(c) +
      '<div class="ac-sub">Cash back vs cash invested (running total)</div>' + cocBackChart(c) +
      '<div class="ac-calls">' + calls.join('') + '</div>' +
      '<div class="ac-sub">Invested by source (tap for items)</div>' + rows +
      '<div class="ac-sub">Cash back by month (net after bills)</div>' + mrows +
        '<div class="ac-xr rep"><span class="ac-xv">Paid out to partners ' + m0(b.paid_to_partners) + ' | to Meshach ' + m0(b.paid_to_meshach) + '</span><b>' + m0(b.returned_cash) + '</b></div>' +
      '<div class="ac-sub">Run rate (ESTIMATE)</div>' +
        '<div class="ac-xr"><span class="ac-xv">Since start, ' + (rr.days || '') + ' days<small>cash / days x 365</small></span><b>' + (rr.ann != null ? m0(rr.ann) + '/yr' : 'not on file') + '</b></div>' +
        '<div class="ac-xr"><span class="ac-xv">Last 30 days<small>cash / days x 365</small></span><b>' + (rr.ann_30 != null ? m0(rr.ann_30) + '/yr' : 'not on file') + '</b></div>' +
        '<div class="ac-xr"><span class="ac-xv">Payback months<small>cash invested / monthly cash back</small></span><b>' + (b.payback_months != null ? b.payback_months.toFixed(1) : 'n/a') + '</b></div>' +
      '<p class="ac-fine ac-formula"><b>' + esc(formula) + '</b></p>' +
      '<p class="ac-fine">Payback: ' + esc(pay) + '. Invested counts partner cash only (down payments, hardware, insurance down, setup, card paydowns). Truck and trailer loan principal is debt and is not counted. Cash back is net after all bills including the loan payments, with Meshach paid only from profit.</p>' +
      (nof ? '<div class="ac-sub">Not on file</div><ul class="ac-nof">' + nof + '</ul>' : '');
  }
  function secCoc(A) {
    var c = A.coc;
    if (!c) return '';
    var s = c.since_start || {}, t30 = c.trailing_30 || {}, need = c.needed || {};
    var plan = (window.BlackRamTargets && window.BlackRamTargets.cocPlan) ? window.BlackRamTargets.cocPlan(c) : null;
    var views = [
      { key: 'start', label: 'Since start', sub: (s.days || '') + ' days (' + day(s.from) + ' to ' + day(s.to) + ')', v: s },
      { key: 't30', label: 'Last 30 days', sub: day(t30.from) + ' to ' + day(t30.to), v: t30 },
      { key: 'plan', label: 'Plan (Targets)', sub: 'Updates with the sliders', v: plan ? { coc_after: plan.coc_after, coc_before: plan.coc_before, ann_after: plan.ann_after, ann_before: plan.ann_before, cash_after: plan.after, cash_before: plan.before, paid_from_profit: plan.pay } : null }
    ];
    var vals = [];
    views.forEach(function (vw) { if (vw.v && isFinite(vw.v.coc_after)) vals.push(vw.v.coc_after); if (vw.v && isFinite(vw.v.coc_before)) vals.push(vw.v.coc_before); });
    var lo = Math.min(0, -0.4), hi = Math.max(0.3, c.target || 0.20);
    vals.forEach(function (v) { if (v > -1 && v < 1.5) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    var rows = views.map(function (vw) {
      var v = vw.v;
      if (!v) return '<div class="ac-coc-view"><div class="ac-coc-lab"><b>' + esc(vw.label) + '</b><span>' + esc(vw.sub) + '</span></div><div class="ac-coc-n">Unlock Targets math</div></div>';
      var fa = cocFill(v.coc_after, lo, hi), fb = cocFill(v.coc_before, lo, hi);
      return '<div class="ac-coc-view">' +
        '<div class="ac-coc-lab"><b>' + esc(vw.label) + '</b><span>' + esc(vw.sub) + '</span></div>' +
        '<div class="ac-coc-n ' + (v.coc_after < 0 ? 'neg' : 'pos') + '">' + fa.pct + '<small>after Meshach</small></div>' +
        '<div class="ac-coc-track" aria-hidden="true"><i class="' + (fa.pos ? 'pos' : '') + '" style="left:' + fa.left.toFixed(1) + '%;width:' + fa.w.toFixed(1) + '%"></i><em class="zero" style="left:calc(' + fa.zero.toFixed(1) + '% - 1px)"></em><em style="left:calc(' + fa.mark.toFixed(1) + '% - 1px)"></em></div>' +
        '<p class="ac-fine">Before Meshach: <b>' + pctCoc(v.coc_before) + '</b>' +
          (v.ann_after != null ? ' | Annualized ' + m0(v.ann_after) + ' after, ' + m0(v.ann_before) + ' before' : '') +
          (v.cash_after != null && vw.key !== 'plan' ? ' | Cash in period ' + m2(v.cash_after) : '') +
          (v.paid_from_profit ? ' | Meshach paid ' + m2(v.paid_from_profit) : '') + '.</p></div>';
    }).join('');
    var parts = (c.partners || []).map(function (p) {
      var w = c.invested ? (p.amount / c.invested * 100) : 0;
      return '<div class="ac-xr tl-tap tl-chev-row"' + ta('cap:' + p.name, p.name + ' cash in ' + m2(p.amount) + '. Show contributions') + '><span class="ac-xv">' + esc(p.name) + '</span><span class="ac-coc-bar"><i style="width:' + w.toFixed(1) + '%"></i></span><b>' + m2(p.amount) + '</b></div>';
    }).join('');
    var needLine = (plan && plan.loadsWk != null)
      ? 'To hit 20% after Meshach is paid from profit: <b>' + (plan.loadsWk.toFixed(1)) + ' loads/wk</b> at your Targets $/mi, or the $/mi on the Targets tab at your loads/wk. Leftover needed: ' + m0(need.mo_after) + '/mo (' + m0(need.ann_after) + '/yr).'
      : '20% of cash in is ' + m0(need.ann_after) + '/yr, or ' + m0(need.mo_after) + '/mo leftover after Meshach is paid from profit.';
    var math = '<p class="ac-fine">CoC = annualized pre-tax cash flow / cash invested. Annualize as cash / days x 365. Cash flow is net after all expenses including the truck and trailer notes. After Meshach subtracts only pay actually paid from profit; unpaid shortfalls are not accrued and are not a cash outflow.</p>' +
      '<p class="ac-fine">' + needLine + ' White mark is the 20% target.</p>';
    var lead = (c.invest && c.back) ? secCocMoney(A) : ('<div class="ac-coc-hero"><div class="ac-kicker">Since start, after Meshach</div><div class="ac-coc-big ' + (s.coc_after < 0 ? 'neg' : 'pos') + '">' + pctCoc(s.coc_after) + '</div>' +
      '<p>vs 20% target | cash in ' + m0(c.invested) + ' | ' + (s.days || '') + ' days annualized</p></div>');
    var body = lead + '<div class="ac-sub">Other views</div>' + rows +
      (c.invest ? '' : '<div class="ac-coc-cap"><div class="ac-kicker">Cash invested</div>' + parts + '</div>') + math;
    return card('Cash on cash', 'Target 20%', body, 'ac-coc');
  }
  function secDriver(A) {
    var d = A.driver, tgt = d.target || d.monthly, cov = d.covered_from_profit || 0;
    var months = (d.months || []).map(function (a) {
      return '<div class="ac-xr"><span class="ac-xd">' + esc(monShort(a.month)) + '</span><span class="ac-xv">Covered from profit<small>Driver pay this month: ' + m2(a.covered_from_profit) + ' of ' + m2(a.target) + '</small></span><b>' + m2(a.covered_from_profit) + '</b></div>';
    }).join('');
    var paid = (d.paid || []).map(function (p) { return '<div class="ac-xr rep"><span class="ac-xd">' + day(p.date) + '</span><span class="ac-xv">Paid to Meshach<small>' + esc(p.source) + '</small></span><b>' + m2(p.amount) + '</b></div>'; }).join('');
    return card('Driver pay - Meshach', '$' + d.monthly.toLocaleString('en-US') + '/mo from profit after bills',
      '<div class="ac-tot"><div><span>This month</span><b>' + m0(cov) + ' of ' + m0(tgt) + '</b></div><div><span>Paid out</span><b>' + m0(d.paid_total) + '</b></div></div>' +
      call('ok', 'Driver pay this month: <b>' + m2(cov) + '</b> of ' + m0(tgt) + '. Paid only from actual profit after all bills and expenses. A shortfall is not a debt.') +
      months + paid + '<p class="ac-fine">' + esc(d.rule) + ' ' + esc(d.assumption || '') + ' ' + esc(d.note || '') + '</p>', 'ac-driver');
  }

  function secRevenue(A) {
    var R = A.revenue.filter(function (r) { return inMonth(r.pickup); });
    if (!R.length) return card('Revenue by load', esc(monLbl(st.sel)), '<p class="ac-fine">No loads this month.</p>');
    var tg = 0, td = 0, tdep = 0;
    var rows = R.map(function (r) {
      tg += r.gross; td += r.net_due; tdep += r.dep_amount || 0;
      return '<div class="ac-rv tl-tap tl-chev tl-chev-top"' + ta('load:' + r.load, 'Load ' + r.load + ' ' + r.broker + '. Show load money') + '><div class="ac-rv-t"><b>' + esc(r.load) + '</b><span class="ac-rv-b">' + esc(r.broker) + '</span>' + statusPill(r.status) + '</div>' +
        '<div class="ac-rv-g"><div><span>Gross</span><b>' + m2(r.gross) + '</b></div><div><span>Fee</span><b>-' + m2(r.fee).replace('-', '') + '</b></div>' +
        '<div><span>Net due</span><b>' + m2(r.net_due) + '</b></div><div><span>' + (r.dep_amount != null ? 'Paid ' + esc(day(r.dep_date)) : 'Paid') + '</span><b class="' + (r.dep_amount == null ? 'dim' : '') + '">' + (r.dep_amount != null ? m2(r.dep_amount) : '--') + '</b></div></div>' +
        (r.via ? '<p class="ac-fine">' + esc(r.via) + '</p>' : '') + '</div>';
    });
    return card('Revenue by load', R.length + ' load' + (R.length === 1 ? '' : 's') + ' | ' + esc(monLbl(st.sel)),
      '<div class="ac-tot"><div><span>Gross</span><b>' + m0(tg) + '</b></div><div><span>Net due</span><b>' + m0(td) + '</b></div><div><span>Paid</span><b>' + m0(tdep) + '</b></div></div>' + rows.join(''), 'ac-rev');
  }

  function secExpenses(A) {
    var X = A.expenses.filter(function (x) { return inMonth(x.date) && !x.capex; });
    var p = A.pl[st.sel], parts = [], total = 0;
    A.cats.forEach(function (c) { var v = p.lines[c.key] || 0; if (c.key === 'fee') return; parts.push({ k: c.key, l: SHORT[c.key] || c.label, v: v, c: COL[c.key] }); total += v; });
    parts.sort(function (a, b) { return b.v - a.v; });
    var bySrc = {}; X.forEach(function (x) { var s = x.source; bySrc[s] = (bySrc[s] || 0) + x.amount; });
    var leg = parts.filter(function (q) { return q.v > 0; }).map(function (q) {
      return '<div class="ac-lg tl-tap tl-chev-row"' + ta('cat:' + q.k, q.l + ' ' + m0(q.v) + '. Show the lines') + '><i style="background:' + q.c + '"></i><span>' + esc(q.l) + '</span><em>' + Math.round(q.v / total * 100) + '%</em><b>' + m0(q.v) + '</b></div>';
    }).join('');
    var src = Object.keys(bySrc).sort(function (a, b) { return bySrc[b] - bySrc[a]; }).map(function (s) { return '<span>' + srcTag(s) + ' ' + m0(bySrc[s]) + '</span>'; }).join('');
    var list = X.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (x) {
      var tax = '';
      if (x.deductible_amount != null) {
        tax = 'Tax deductible ' + m2(x.deductible_amount) + ' (50%)' + (x.attendees_purpose ? '. ' + esc(x.attendees_purpose) : '');
      }
      return '<div class="ac-xr"><span class="ac-xd">' + day(x.date) + '</span><span class="ac-xv">' + esc(x.vendor) + (x.est ? ' <em>EST</em>' : '') +
        '<small><i style="background:' + COL[x.cat] + '"></i>' + esc((A.cats.filter(function (c) { return c.key === x.cat; })[0] || {}).label || x.cat) + ' ' + srcTag(x.source + (x.partner ? ' - ' + x.partner : '')) + (tax ? '<br>' + tax : '') + '</small></span><b>' + m2(x.amount) + '</b></div>';
    }).join('');
    var capex = A.expenses.filter(function (x) { return inMonth(x.date) && x.capex; });
    var cx = capex.length ? '<p class="ac-fine">Equipment not in the P&amp;L (on the balance sheet): ' + capex.map(function (x) { return esc(x.vendor) + ' ' + m2(x.amount) + ' (' + esc(x.partner || x.source) + ')'; }).join('; ') + '.</p>' : '';
    var mealAmt = 0, mealDed = 0;
    X.forEach(function (x) {
      if (x.cat === 'meals') {
        mealAmt += x.amount;
        mealDed += (x.deductible_amount != null ? x.deductible_amount : x.amount * 0.5);
      }
    });
    var taxNote = '';
    if (mealAmt > 0) {
      var rule = (A.meals_tax && A.meals_tax.rule) ? A.meals_tax.rule : 'IRS Pub 463: 50% of business meal cost deductible; needs who/where/purpose.';
      taxNote = '<p class="ac-fine">Business meals in this period: ' + m2(mealAmt) + ' in the cash books; tax-deductible ' + m2(mealDed) + ' (50%). ' + esc(rule) + '</p>';
    }
    return card('Expenses by category', m0(total) + ' | ' + X.length + ' items',
      '<div class="ac-dn">' + donut(parts, total, m0(total)) + '<div class="ac-lgs">' + leg + '</div></div>' +
      '<div class="ac-srcs">' + src + '</div>' + (p.lines.fee ? '<p class="ac-fine">Totni 13% (' + m0(p.lines.fee) + ') is shown in the P&amp;L, not here.</p>' : '') +
      taxNote +
      '<details class="ac-more"' + (st.openExp ? ' open' : '') + ' id="ac-exp-d"><summary>All ' + X.length + ' expense lines</summary>' + list + '</details>' + cx, 'ac-exp');
  }

  function secAR(A) {
    var ar = A.ar, max = Math.max(1, ar.total);
    var bars = Object.keys(ar.buckets).map(function (k) {
      var v = ar.buckets[k];
      return '<div class="ac-ag' + (v ? ' tl-tap"' + ta('ar:' + k, k + ' days ' + m0(v) + '. Show the loads') : '"') + '><span>' + k + ' days</span><div class="ac-agb"><i style="width:' + (v / max * 100).toFixed(1) + '%"></i></div><b>' + m0(v) + '</b></div>';
    }).join('');
    var items = ar.items.map(function (i) {
      return '<div class="ac-xr tl-tap tl-chev-row"' + ta('load:' + i.load, 'Load ' + i.load + '. Show load money') + '><span class="ac-xd">' + i.days + 'd</span><span class="ac-xv">' + esc(i.broker) + ' ' + esc(i.load) + '<small>Delivered ' + day(i.delivered) + '</small></span><b>' + m2(i.net_due) + '</b></div>';
    }).join('');
    var oldest = ar.items.reduce(function (a, b) { return !a || b.days > a.days ? b : a; }, null);
    return card('Accounts receivable', 'Owed by Totni, not deposited yet',
      '<div class="ac-big">' + m2(ar.total) + '<span>' + ar.items.length + ' load' + (ar.items.length === 1 ? '' : 's') + ' unpaid</span></div>' +
      (oldest ? call(oldest.days > 30 ? 'bad' : 'ok', 'Oldest: <b>' + esc(oldest.broker) + '</b> ' + oldest.days + ' days since delivery') : call('good', 'Nothing owed right now')) +
      bars + items + '<p class="ac-fine">' + esc(ar.note) + '</p>', 'ac-ar');
  }

  function secBills(A) {
    var b = A.bills, asOf = String(A.as_of).slice(0, 10);
    function within(dd, n) { var a = Date.UTC(+dd.slice(0, 4), +dd.slice(5, 7) - 1, +dd.slice(8, 10)), z = Date.UTC(+asOf.slice(0, 4), +asOf.slice(5, 7) - 1, +asOf.slice(8, 10)); return (a - z) / 86400000 <= n; }
    var up = b.upcoming.filter(function (x) { return within(x.date, 60); });
    var t30 = up.filter(function (x) { return within(x.date, 30); }).reduce(function (s, x) { return s + x.amount; }, 0);
    var rows = up.map(function (x) {
      return '<div class="ac-xr"><span class="ac-xd">' + day(x.date) + '</span><span class="ac-xv">' + esc(x.payee) + '<small>' + esc(x.from || '') + '</small></span><b>' + m2(x.amount) + '</b></div>';
    }).join('');
    var ax = b.amex;
    var loans = b.loans.map(function (l) {
      return '<div class="ac-loan tl-tap tl-chev"' + ta('loan:' + l.name, l.name + ' balance ' + m0(l.balance) + '. Show loan details') + '><div><b>' + esc(l.name) + '</b><span>' + esc(l.what) + ' | ' + l.apr + '% | due the ' + l.due_day + 'th</span></div><div class="r"><b>' + m0(l.balance) + '</b><span>' + m2(l.monthly) + '/mo</span></div></div>';
    }).join('');
    var wh = b.withheld.map(function (w) { return esc(w.payee) + ' ' + (w.amount != null ? m2(w.amount) : esc(w.amount_text || 'varies')); }).join('; ');
    return card('Bills and payables', 'Next 60 days',
      '<div class="ac-calls"><div class="tl-tap tl-chev"' + ta('bills30', m0(t30) + ' due in the next 30 days. Show the bills') + '>' + call('bad', '<b>' + m0(t30) + '</b> due in the next 30 days') + '</div>' + call('ok', 'AmEx about <b>' + m0(ax.est_balance) + '</b> EST, due date?') + '</div>' +
      rows + '<div class="ac-sub">Company AmEx</div>' +
      '<div class="ac-tot"><div class="tl-tap tl-corner"' + ta('amex:charges', 'AmEx charged ' + m0(ax.charges_logged) + '. Show charges') + '><span>Charged (receipts)</span><b>' + m0(ax.charges_logged) + '</b></div><div><span>Paid down</span><b>' + m0(ax.paid_total) + '</b></div><div class="tl-tap tl-corner"' + ta('amex:bal', 'AmEx balance EST ' + m0(ax.est_balance) + '. Show the math') + '><span>Balance EST</span><b>' + m0(ax.est_balance) + '</b></div></div>' +
      '<p class="ac-fine">' + esc(ax.note) + '</p>' +
      '<div class="ac-sub">Loans</div>' + loans +
      '<p class="ac-fine">Insurance: ' + b.insurance_payments_left + ' payments, ' + m2(b.insurance_left) + ' left. Taken out of load pay (Totni fees, not company bills): ' + wh + '.</p>', 'ac-bills');
  }

  function secCash(A) {
    var c = A.cash, fn = c.first_negative, low = c.low30;
    var ev = (c.events30 || []).map(function (e) { return '<div class="ac-xr"><span class="ac-xd">' + day(e.date) + '</span><span class="ac-xv">' + esc(e.label) + '</span><b>' + m2(e.amount) + '</b></div>'; }).join('');
    var mo = st.sel !== 'all' ? '<div class="ac-tot"><div class="tl-tap tl-corner"' + ta('cash:in', 'Cash in ' + m0(c.in_month[st.sel] || 0) + '. Show deposits') + '><span>In (' + esc(monShort(st.sel)) + ')</span><b>' + m0(c.in_month[st.sel] || 0) + '</b></div><div class="tl-tap tl-corner"' + ta('cash:out', 'Cash out ' + m0(c.out_month[st.sel] || 0) + '. Show payments') + '><span>Out</span><b>' + m0(c.out_month[st.sel] || 0) + '</b></div><div><span>Held by Meshach</span><b>' + m0(c.held) + (c.held_est ? '*' : '') + '</b></div></div>' : '';
    return card('Cash flow', 'Bluevine ...' + esc(c.last4) + ' | ' + m2(c.balance) + ' on ' + day(c.as_of),
      cashChart(c) + '<div class="ac-legend"><span><i style="background:var(--c-accent-hi)"></i>Bank balance</span><span><i style="background:var(--c-gold)"></i>30-day, no new loads</span><span><i style="background:var(--c-take)"></i>If unpaid loads land</span></div>' +
      '<div class="ac-calls">' + (fn ? call('bad', 'Goes negative <b>' + day(fn.date) + '</b> (' + m0(fn.balance) + ')') : call('good', 'Stays positive 30 days')) +
      (low ? call(low.balance < 0 ? 'bad' : 'ok', '30-day low <b>' + m0(low.balance) + '</b> on ' + day(low.date)) : '') + '</div>' + mo + ev +
      '<p class="ac-fine">Projection counts scheduled bank bills only; no new loads. *Meshach cash is EST.</p>', 'ac-cash');
  }

  function secPartners(A) {
    var tot = A.partners.reduce(function (s, p) { return s + p.capital_total; }, 0);
    var cards = A.partners.map(function (p) {
      var items = p.capital.map(function (i) { return '<div class="ac-xr"><span class="ac-xd">' + day(i.date) + '</span><span class="ac-xv">' + esc(i.label) + '</span><b>' + m2(i.amount) + '</b></div>'; }).join('');
      var wg = p.wage ? '<div class="ac-sub">Driver pay from profit</div><div class="ac-xr rep"><span class="ac-xd">This month</span><span class="ac-xv">Driver pay this month: ' + m2(p.wage.covered_from_profit || 0) + ' of ' + m2(p.wage.target || p.wage.monthly) + '<small>$' + p.wage.monthly.toLocaleString('en-US') + '/mo only from profit after all bills. A shortfall is not a debt.</small></span><b>' + m2(p.wage.covered_from_profit || 0) + '</b></div>' : '';
      var rep = p.repaid.map(function (i) { return '<div class="ac-xr rep"><span class="ac-xd">' + day(i.date) + '</span><span class="ac-xv">' + esc(i.note) + '</span><b>' + m2(i.amount) + '</b></div>'; }).join('');
      return '<div class="ac-pt"><div class="ac-pt-h"><b>' + esc(p.name) + '</b><span>' + esc(p.share) + ' owner</span><strong>' + m0(p.capital_total) + '</strong></div>' +
        '<div class="ac-pt-bar"><i style="width:' + (tot ? (p.capital_total / tot * 100).toFixed(1) : 0) + '%"></i></div>' + items +
        (rep ? '<div class="ac-sub">Paid back (not distributions)</div>' + rep : '') + wg +
        '<div class="ac-pt-f"><span>This month\'s third <b>' + m2(p.third_month) + '</b></span><span>All-time third <b>' + m2(p.third_all) + '</b></span></div></div>';
    }).join('');
    return card('Partner capital', m0(tot) + ' put in | distributions $0', cards, 'ac-partners');
  }

  function secBalance(A) {
    var b = A.balance;
    function bsKey(lbl) {
      var ln = (A.bills.loans || []).filter(function (l) { return lbl.indexOf(l.name) === 0; })[0];
      if (ln) return 'loan:' + ln.name;
      if (/receivable/i.test(lbl)) return 'jump:ac-ar';
      if (/^bluevine/i.test(lbl)) return 'jump:ac-cash';
      return '';
    }
    function list(a) { return a.map(function (x) { var k = bsKey(x.label); return '<div class="ac-l' + (k ? ' tl-tap tl-chev-row"' + ta(k, x.label + ' ' + m2(x.amount) + '. Show details') : '"') + '><span>' + esc(x.label) + '</span><b>' + m2(x.amount) + '</b></div>'; }).join(''); }
    var debt = b.total_liabilities, as = b.total_assets, w = Math.max(as, debt, 1);
    return card('Balance sheet', 'Snapshot ' + day(A.as_of),
      '<div class="ac-bs"><div><span>Assets</span><div class="ac-agb"><i style="width:' + (as / w * 100).toFixed(1) + '%;background:var(--c-take)"></i></div><b>' + m0(as) + '</b></div>' +
      '<div><span>Debts</span><div class="ac-agb"><i style="width:' + (debt / w * 100).toFixed(1) + '%;background:#F87171"></i></div><b>' + m0(debt) + '</b></div></div>' +
      '<div class="ac-sub">Assets</div><div class="ac-pl">' + list(b.assets) + '</div>' +
      '<div class="ac-sub">Owed</div><div class="ac-pl">' + list(b.liabilities) + '</div>' +
      '<div class="ac-pl"><div class="ac-l"><span>Partner capital put in</span><b>' + m2(b.partner_capital) + '</b></div>' +
      '<div class="ac-l ac-l-net"><span>Equity (assets less debts)</span><b class="' + (b.equity < 0 ? 'neg' : 'pos') + '">' + m2(b.equity) + '</b></div></div>' +
      '<p class="ac-fine">' + esc(b.note) + '</p>', 'ac-bs');
  }

  /* ---------- tap drill-downs (v91). Only reads the PIN-unlocked payload already in st.data. ---------- */
  function catLabel(A, k) { return ((A.cats || []).filter(function (c) { return c.key === k; })[0] || {}).label || SHORT[k] || k; }
  function xRows(list) {
    return list.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (x) {
      return { d: day(x.date), t: esc(x.vendor || x.desc || '') + (x.est ? ' <em>EST</em>' : ''), s: esc(x.source + (x.partner ? ' - ' + x.partner : '')) + (x.deductible_amount != null ? ' | deductible ' + m2(x.deductible_amount) : ''), v: m2(x.amount) };
    });
  }
  function sumOf(list, k) { return list.reduce(function (s, x) { return s + (Number(x[k || 'amount']) || 0); }, 0); }
  function lbl() { return esc(monLbl(st.sel)); }
  function drill(arg) {
    var T = window.BlackRamTiles, D = st.data, A = D && D.accounting;
    if (!T || !A) return;
    var p = String(arg || '').split(':'), k = p[0], id = p.slice(1).join(':');
    var X = A.expenses.filter(function (x) { return inMonth(x.date) && !x.capex; });
    var R = A.revenue.filter(function (r) { return inMonth(r.pickup); });
    if (k === 'jump') { T.jump(id); return; }
    if (k === 'rev') {
      T.open({ title: 'Gross revenue', sub: lbl(), body: T.hero(m2(sumOf(R, 'gross')), R.length + ' loads') +
        T.rows(R.map(function (r) { return { d: day(r.pickup), t: esc(r.broker) + ' #' + esc(r.load), s: esc(r.status), v: m2(r.gross), vs: 'net due ' + m2(r.net_due) }; }), 'No loads.') +
        T.fine('Tap a load in Revenue by load for its fuel, fees and pay.') });
    } else if (k === 'cat' || (k === 'wf' && id !== 'fee' && id !== 'ops')) {
      var key = id, L;
      if (key === 'fee') {
        L = R.filter(function (r) { return r.fee; });
        T.open({ title: catLabel(A, 'fee'), sub: lbl(), body: T.hero(m2(sumOf(L, 'fee')), '13% of gross, withheld by Totni') +
          T.rows(L.map(function (r) { return { d: day(r.pickup), t: esc(r.broker) + ' #' + esc(r.load), s: 'gross ' + m2(r.gross), v: m2(r.fee) }; })) });
        return;
      }
      L = X.filter(function (x) { return x.cat === key; });
      T.open({ title: catLabel(A, key), sub: lbl() + ' | cash basis', body: T.hero(m2(sumOf(L)), L.length + ' line' + (L.length === 1 ? '' : 's')) + T.rows(xRows(L), 'No lines this period.') +
        (key === 'meals' ? T.fine('Business meals: 50% deductible (IRS Pub 463).') : '') });
    } else if (k === 'wf') {
      if (id === 'fee') {
        var fees = sumOf(R, 'fee'), E = X.filter(function (x) { return x.cat === 'eld'; });
        T.open({ title: 'Totni + ELD', sub: lbl(), body: T.hero(m2(fees + sumOf(E)), 'taken out of load pay') +
          T.sec('Totni 13%') + T.rows(R.filter(function (r) { return r.fee; }).map(function (r) { return { d: day(r.pickup), t: esc(r.broker) + ' #' + esc(r.load), v: m2(r.fee) }; })) +
          T.sec('ELD fees withheld') + T.rows(xRows(E), 'None this period.') });
      } else {
        var O = X.filter(function (x) { return x.cat !== 'eld' && x.cat !== 'notes'; }), by = {};
        O.forEach(function (x) { by[x.cat] = (by[x.cat] || 0) + x.amount; });
        T.open({ title: 'Truck costs', sub: lbl() + ' | before the notes', body: T.hero(m2(sumOf(O)), O.length + ' lines') +
          T.rows(Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).map(function (c) { return { t: '<i style="display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;background:' + COL[c] + '"></i>' + esc(catLabel(A, c)), v: m2(by[c]) }; })) +
          T.sec('Lines') + T.rows(xRows(O)) });
      }
    } else if (k === 'src') {
      var SR = ((A.coc && A.coc.invest && A.coc.invest.sources) || []).filter(function (x) { return x.key === id; })[0]; if (!SR) return;
      T.open({ title: SR.label, sub: 'Cash invested', body: T.hero(m2(SR.total), SR.items.length + ' item' + (SR.items.length === 1 ? '' : 's') + (SR.est ? ' | ' + m0(SR.est) + ' EST' : '')) +
        T.rows(SR.items.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (i) { return { d: day(i.date), t: esc(i.label) + (i.est ? ' <em>EST</em>' : ''), s: esc(i.partner), v: m2(i.amount) }; }), 'None.') +
        (SR.note ? T.fine(esc(SR.note)) : '') });
    } else if (k === 'cap') {
      var P = A.partners.filter(function (x) { return x.name === id; })[0]; if (!P) return;
      T.open({ title: P.name + ' - capital put in', sub: esc(P.share) + ' owner', body: T.hero(m2(P.capital_total), P.capital.length + ' contributions') +
        T.rows(P.capital.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (i) { return { d: day(i.date), t: esc(i.label), v: m2(i.amount) }; }), 'None.') +
        (P.repaid.length ? T.sec('Paid back (not distributions)') + T.rows(P.repaid.map(function (i) { return { d: day(i.date), t: esc(i.note), v: m2(i.amount) }; })) : '') +
        T.kv([['This month\'s third', m2(P.third_month)], ['All-time third', m2(P.third_all)]]) });
    } else if (k === 'load') {
      var r = A.revenue.filter(function (x) { return String(x.load) === id; })[0];
      var lc = D.load_costs && D.load_costs.loads ? D.load_costs.loads[id] : null;
      if (!r) return;
      var fuel = lc ? (lc.fuel_total || 0) : null, def = lc ? (lc.def_total || 0) : null, oth = lc ? (lc.other_total || 0) : null;
      var kept = r.net_due - (r.eld || 0) - (fuel || 0) - (def || 0) - (oth || 0);
      var lines = lc ? [].concat(lc.fuel || [], lc.def || [], lc.other || []).map(function (c) { return { d: day(c.d), t: esc(c.v), s: esc(c.c || '') + (c.by ? ' | ' + esc(c.by) : ''), v: m2(c.a) }; }) : [];
      T.open({ title: r.broker + ' #' + r.load, sub: 'Picked up ' + day(r.pickup) + (r.delivered ? ' | delivered ' + day(r.delivered) : ''), body:
        T.rows([{ t: 'Gross', v: m2(r.gross), vc: 'pos' }, { t: 'Totni 13%', v: '-' + m2(r.fee).replace('-', ''), vc: 'neg' }, { t: 'Net due', v: m2(r.net_due), cls: 'tl-tot' }]
          .concat(r.eld ? [{ t: 'ELD withheld' + (r.eld_est ? ' (EST)' : ''), v: '-' + m2(r.eld).replace('-', ''), vc: 'neg' }] : [])
          .concat(lc ? [{ t: 'Fuel', v: '-' + m2(fuel).replace('-', ''), vc: 'neg' }, { t: 'DEF', v: '-' + m2(def).replace('-', ''), vc: 'neg' }, { t: 'Other load costs', v: '-' + m2(oth).replace('-', ''), vc: 'neg' }, { t: 'Kept after load costs', v: m2(kept), cls: 'tl-tot', vc: kept < 0 ? 'neg' : 'pos' }] : [])) +
        T.kv([['Status', esc(r.status)], ['Paid', r.dep_amount != null ? m2(r.dep_amount) + ' on ' + day(r.dep_date) : '--']]) +
        (lines.length ? T.sec('Costs tied to this load') + T.rows(lines) : '') + (r.via ? T.fine(esc(r.via)) : '') +
        T.fine('Before the truck and trailer notes, insurance and other monthly bills.') });
    } else if (k === 'ar') {
      var it = A.ar.items.filter(function (i) { return i.bucket === id; });
      T.open({ title: 'Owed ' + id + ' days', sub: 'Accounts receivable', body: T.hero(m2(sumOf(it, 'net_due')), it.length + ' loads') +
        T.rows(it.map(function (i) { return { d: i.days + 'd', t: esc(i.broker) + ' ' + esc(i.load), s: 'Delivered ' + day(i.delivered), v: m2(i.net_due) }; }), 'Nothing in this bucket.') });
    } else if (k === 'bills30') {
      var asOf = String(A.as_of).slice(0, 10), z = Date.UTC(+asOf.slice(0, 4), +asOf.slice(5, 7) - 1, +asOf.slice(8, 10));
      var up = A.bills.upcoming.filter(function (x) { var a = Date.UTC(+x.date.slice(0, 4), +x.date.slice(5, 7) - 1, +x.date.slice(8, 10)); return (a - z) / 864e5 <= 30; });
      T.open({ title: 'Due in the next 30 days', sub: 'From ' + day(asOf), body: T.hero(m2(sumOf(up)), up.length + ' bills', 'bad') +
        T.rows(up.map(function (x) { return { d: day(x.date), t: esc(x.payee), s: esc(x.from || ''), v: m2(x.amount), vc: 'neg' }; })) });
    } else if (k === 'amex') {
      var ax = A.bills.amex;
      var ch = A.expenses.filter(function (x) { return /amex/i.test(x.source); });
      var body = T.kv([['Charged (receipts)', m0(ax.charges_logged)], ['Paid down', m0(ax.paid_total)], ['Balance EST', m0(ax.est_balance)], ['Statement', ax.statement_balance != null ? m0(ax.statement_balance) : '--'], ['Due', ax.due_date ? day(ax.due_date) : 'date?', 'wide']]);
      if (id === 'charges') body += T.sec('Charges on the card (' + ch.length + ')') + T.rows(xRows(ch), 'None logged.');
      body += T.fine(esc(ax.note || ''));
      if (id !== 'charges') body += '<div>' + T.btn('See the ' + ch.length + ' charges', 'ac', 'amex:charges') + '</div>';
      T.open({ title: 'Company AmEx', sub: id === 'charges' ? 'Charges from receipts | ' + m2(sumOf(ch)) : 'Balance EST', body: body });
    } else if (k === 'loan') {
      var l = A.bills.loans.filter(function (x) { return x.name === id; })[0]; if (!l) return;
      var pays = A.expenses.filter(function (x) { return x.cat === 'notes' && x.vendor === l.name; });
      T.open({ title: l.name, sub: esc(l.what), body: T.hero(m0(l.balance), 'balance' + (l.balance_date ? ' on ' + day(l.balance_date) : '')) +
        T.kv([['Payment', m2(l.monthly) + '/mo'], ['Due', 'the ' + l.due_day + 'th'], ['APR', l.apr + '%'], ['Paid after stmt', l.paid_after != null ? m2(l.paid_after) : '--']]) +
        T.sec('Payments in the books') + T.rows(xRows(pays), 'None logged yet.') + (l.note ? T.fine(esc(l.note)) : '') });
    } else if (k === 'cash') {
      var J = A.journal.filter(function (j) { return j.type === 'Bank' && inMonth(j.date) && (id === 'in' ? j.amount > 0 : j.amount < 0); });
      var c = A.cash;
      T.open({ title: id === 'in' ? 'Cash in' : 'Cash out', sub: 'Bluevine ...' + esc(c.last4) + ' | ' + lbl(), body:
        T.hero(m0(id === 'in' ? c.in_month[st.sel] || 0 : c.out_month[st.sel] || 0), id === 'in' ? 'deposits' : 'payments out of the bank') +
        T.rows(J.map(function (j) { return { d: day(j.date), t: esc(j.desc), v: m2(Math.abs(j.amount)), vc: id === 'in' ? 'pos' : 'neg' }; }), 'No bank lines this month.') });
    }
  }
  function regDrill() { if (window.BlackRamTiles && !regDrill.done) { regDrill.done = true; window.BlackRamTiles.on('ac', drill); } }

  /* ---------- CSV ---------- */
  function csvCell(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCsv() {
    var A = st.data && st.data.accounting; if (!A) return;
    var rows = [['date', 'type', 'description', 'category', 'amount', 'source', 'in_pnl', 'tax_deductible']];
    A.journal.filter(function (j) { return inMonth(j.date); }).forEach(function (j) {
      rows.push([j.date, j.type, j.desc, j.cat, Number(j.amount).toFixed(2), j.source, j.pnl ? 'yes' : 'no', j.tax_deductible != null ? Number(j.tax_deductible).toFixed(2) : '']);
    });
    var blob = new Blob([rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sandlilypad-accounting-' + (st.sel === 'all' ? 'all-time' : st.sel) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ---------- render ---------- */
  function lockView(msg) {
    return '<section class="ac-card ac-lock"><div class="ac-lock-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></g></svg></div>' +
      '<h3>Accounting is locked</h3><p class="ac-fine">' + esc(msg) + '</p>' +
      '<form id="ac-pin-form" class="ac-pin" autocomplete="off"><input id="ac-pin" type="password" inputmode="numeric" placeholder="App PIN" aria-label="App PIN" />' +
      '<button type="submit" class="btn primary">Unlock</button></form></section>';
  }
  function render() {
    var el = root(); if (!el) return;
    if (!st.data && st.error !== 'wrongpin') st.data = fromCache();
    var D = st.data, A = D && D.accounting;
    if (!A) {
      if (st.error === 'wrongpin') el.innerHTML = lockView('Wrong PIN. Try again.');
      else if (st.error === 'nopin') el.innerHTML = lockView('P&L, deposits, partner capital and the balance sheet. Enter the app PIN to see them.');
      else if (st.loading) el.innerHTML = (window.BlackRamApp && window.BlackRamApp.skeleton) ? window.BlackRamApp.skeleton('Loading accounting') : '<section class="ac-card"><p class="ac-fine">Loading accounting...</p></section>';
      else el.innerHTML = '<section class="ac-card"><p class="ac-fine">' + esc(st.error || 'Loading...') + '</p></section>';
      bind(); return;
    }
    if (!st.sel || (st.sel !== 'all' && !A.pl[st.sel])) st.sel = A.months[A.months.length - 1];
    var chips = A.months.concat(['all']).map(function (k) {
      return '<button type="button" class="ac-chip' + (st.sel === k ? ' on' : '') + '" data-ac-month="' + esc(k) + '">' + esc(k === 'all' ? 'All time' : monShort(k)) + '</button>';
    }).join('');
    var built = D.built_at ? new Date(D.built_at) : null;
    var stamp = built && !isNaN(built.getTime()) ? built.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' : '';
    var gaps = '<details class="ac-more ac-gaps"><summary>Data gaps (' + A.gaps.length + ')</summary><ul>' + A.gaps.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul></details>';
    el.innerHTML =
      '<div class="ac-top"><div><div class="ac-kicker">Sand Lily Pad LLC</div><h2>Accounting</h2></div>' +
      '<div class="ac-acts"><button type="button" class="ac-btn" id="ac-csv" aria-label="Export CSV">CSV</button><button type="button" class="ac-btn" id="ac-refresh" aria-label="Refresh">' + (st.loading ? '...' : 'Refresh') + '</button></div></div>' +
      '<div class="ac-chips" role="tablist" aria-label="Month">' + chips + '</div>' +
      '<nav class="ac-jump">' + [['ac-pl', 'P&amp;L'], ['ac-wf', 'Waterfall'], ['ac-coc', 'CoC'], ['ac-driver', 'Driver'], ['ac-rev', 'Revenue'], ['ac-exp', 'Expenses'], ['ac-ar', 'AR'], ['ac-bills', 'Bills'], ['ac-cash', 'Cash'], ['ac-partners', 'Partners'], ['ac-bs', 'Balance']].map(function (j) { return '<a href="#' + j[0] + '" data-ac-jump="' + j[0] + '">' + j[1] + '</a>'; }).join('') + '</nav>' +
      secPL(A) + secWaterfall(A) + secCoc(A) + secDriver(A) + secRevenue(A) + secExpenses(A) + secAR(A) + secBills(A) + secCash(A) + secPartners(A) + secBalance(A) + gaps +
      '<p class="ac-foot">Built ' + esc(stamp) + ' from the ledger and Bluevine ...' + esc(A.cash.last4) + '. Basis: ' + esc(A.basis) + '. Not tax advice.' + (st.error && st.error !== 'nopin' ? ' ' + esc(st.error) : '') + '</p>';
    bind();
  }
  function bind() {
    var el = root(); if (!el) return;
    var f = document.getElementById('ac-pin-form');
    if (f) f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = (document.getElementById('ac-pin').value || '').trim();
      if (!v) return;
      setPin(v); st.error = ''; st.data = null; fetchData(true);
    });
    el.querySelectorAll('[data-ac-month]').forEach(function (b) {
      b.addEventListener('click', function () { st.sel = b.getAttribute('data-ac-month'); render(); });
    });
    el.querySelectorAll('[data-ac-jump]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); var t = document.getElementById(a.getAttribute('data-ac-jump')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    });
    var d = document.getElementById('ac-exp-d'); if (d) d.addEventListener('toggle', function () { st.openExp = d.open; });
    var c = document.getElementById('ac-csv'); if (c) c.addEventListener('click', exportCsv);
    var r = document.getElementById('ac-refresh'); if (r) r.addEventListener('click', function () { fetchData(true); });
  }

  /* ---------- styles (v51 tokens) ---------- */
  function css() {
    if (document.getElementById('ac-css')) return;
    var s = document.createElement('style'); s.id = 'ac-css';
    s.textContent =
      '#acct-root{display:flex;flex-direction:column;gap:var(--s-1h);padding-bottom:var(--s-3)}' +
      '.ac-top{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--s-1)}' +
      '.ac-top h2{margin:0;font-size:var(--fs-2xl);font-weight:var(--fw-black);color:var(--c-text-1);letter-spacing:-.01em}' +
      '.ac-kicker{font-size:var(--fs-xs);font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c-accent-hi)}' +
      '.ac-acts{display:flex;gap:var(--s-1)}' +
      '.ac-btn{min-height:36px;padding:0 14px;border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-weight:800;font-size:var(--fs-sm);cursor:pointer}' +
      '#ac-csv{background:var(--c-gold);color:var(--c-gold-ink);border-color:var(--c-gold)}' +
      '.ac-chips{display:flex;gap:var(--s-1);overflow-x:auto;scrollbar-width:none}' +
      '.ac-chip{flex:none;min-height:36px;padding:0 16px;border-radius:var(--radius-pill);border:1px solid var(--c-line);background:var(--c-surface-1);color:var(--c-text-2);font-weight:800;font-size:var(--fs-sm);cursor:pointer}' +
      '.ac-chip.on{background:var(--c-accent);border-color:var(--c-accent);color:#14111f}' +
      '.ac-jump{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:-2px 0}' +
      '.ac-jump a{flex:none;font-size:var(--fs-xs);font-weight:700;color:var(--c-text-3);text-decoration:none;padding:4px 10px;border-radius:var(--radius-pill);background:var(--c-surface-1)}' +
      '.ac-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg);padding:var(--s-2) var(--s-2) var(--s-1h);display:flex;flex-direction:column;gap:var(--s-1h);scroll-margin-top:calc(var(--appbar-h) + 8px)}' +
      '.ac-h{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-1);flex-wrap:wrap}' +
      '.ac-h h3{margin:0;font-size:var(--fs-lg);font-weight:var(--fw-black);color:var(--c-text-1)}' +
      '.ac-h span{font-size:var(--fs-xs);font-weight:700;color:var(--c-text-3)}' +
      '.ac-svg{width:100%;height:auto;display:block}' +
      '.ac-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:11px;color:var(--c-text-3);font-weight:600}' +
      '.ac-legend i,.ac-l i,.ac-lg i,.ac-xv small i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:0}' +
      '.ac-calls{display:flex;flex-direction:column;gap:6px}' +
      '.ac-call{margin:0;padding:var(--s-1) var(--s-1h);border-radius:var(--radius-sm);font-size:var(--fs-sm);font-weight:600;line-height:1.35}' +
      '.ac-call b{font-weight:800}' +
      '.ac-good{background:var(--c-take-bg);color:var(--c-take)}.ac-ok{background:var(--c-maybe-bg);color:var(--c-maybe)}.ac-bad{background:rgba(248,113,113,.14);color:#FCA5A5}' +
      '.ac-pl{display:flex;flex-direction:column}' +
      '.ac-l{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s-1);padding:7px 0;border-bottom:1px solid var(--c-line);font-size:var(--fs-sm);color:var(--c-text-2)}' +
      '.ac-l:last-child{border-bottom:0}' +
      '.ac-l b{font-weight:800;color:var(--c-text-1);white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.ac-l small{color:var(--c-text-3);font-size:11px;margin-left:4px}' +
      '.ac-l-rev{font-size:var(--fs-md)}.ac-l-rev b{color:var(--c-take)}' +
      '.ac-l-sub{background:var(--c-surface-2);margin:2px -8px;padding:7px 8px;border-radius:var(--radius-sm);border:0;font-weight:700}' +
      '.ac-l-net{font-size:var(--fs-lg);font-weight:800;color:var(--c-text-1);border-top:2px solid var(--c-line-strong);border-bottom:0;margin-top:2px}' +
      '.ac-l b.neg{color:#FCA5A5}.ac-l b.pos{color:var(--c-take)}' +
      '.ac-fine{margin:0;font-size:var(--fs-xs);color:var(--c-text-3);line-height:1.4}' +
      '.ac-tot{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s-1)}' +
      '.ac-tot div{background:var(--c-surface-2);border-radius:var(--radius-sm);padding:var(--s-1) 6px;text-align:center;min-width:0}' +
      '.ac-tot span{display:block;font-size:11px;color:var(--c-text-3);font-weight:700}' +
      '.ac-tot b{display:block;font-size:var(--fs-md);font-weight:800;color:var(--c-text-1)}' +
      '.ac-rv{border-top:1px solid var(--c-line);padding-top:var(--s-1h);display:flex;flex-direction:column;gap:6px}' +
      '.ac-rv-t{display:flex;align-items:center;gap:var(--s-1);flex-wrap:wrap}' +
      '.ac-rv-t b{font-size:var(--fs-md);font-weight:800;color:var(--c-text-1)}' +
      '.ac-rv-b{font-size:var(--fs-sm);color:var(--c-text-2);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.ac-rv-g{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}' +
      '.ac-rv-g span{display:block;font-size:10px;font-weight:700;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.03em}' +
      '.ac-rv-g b{font-size:var(--fs-sm);font-weight:800;color:var(--c-text-1);font-variant-numeric:tabular-nums}.ac-rv-g b.dim{color:var(--c-text-3)}' +
      '.ac-dim{opacity:.45}' +
      '.ac-pill{flex:none;font-size:11px;font-weight:800;padding:2px 9px;border-radius:var(--radius-pill);white-space:nowrap}' +
      '.ac-pill-ok{background:var(--c-take-bg);color:var(--c-take)}.ac-pill-held{background:rgba(167,139,250,.16);color:var(--c-accent-hi)}' +
      '.ac-pill-short{background:rgba(248,113,113,.14);color:#FCA5A5}.ac-pill-pend{background:var(--c-maybe-bg);color:var(--c-maybe)}' +
      '.ac-dn{display:flex;align-items:center;gap:var(--s-1h)}' +
      '.ac-donut{width:132px;height:132px;flex:none}' +
      '.ac-lgs{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}' +
      '.ac-lg{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--c-text-2)}' +
      '.ac-lg span{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.ac-lg em{font-style:normal;color:var(--c-text-3);font-size:11px;width:30px;text-align:right}' +
      '.ac-lg b{font-weight:800;color:var(--c-text-1);width:52px;text-align:right;font-variant-numeric:tabular-nums}' +
      '.ac-srcs{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px;font-weight:700;color:var(--c-text-2)}' +
      '.ac-src{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.02em;padding:1px 7px;border-radius:var(--radius-pill);vertical-align:1px}' +
      '.ac-src-bv{background:rgba(96,165,250,.16);color:#93C5FD}.ac-src-ax{background:var(--c-maybe-bg);color:var(--c-maybe)}' +
      '.ac-src-pp{background:rgba(167,139,250,.16);color:var(--c-accent-hi)}.ac-src-tw{background:rgba(248,113,113,.14);color:#FCA5A5}.ac-src-lc{background:var(--c-pass-bg);color:var(--c-text-2)}' +
      '.ac-more{border-top:1px solid var(--c-line);padding-top:var(--s-1)}' +
      '.ac-more>summary{cursor:pointer;min-height:36px;display:flex;align-items:center;font-size:var(--fs-sm);font-weight:800;color:var(--c-accent-hi);list-style:none}' +
      '.ac-more>summary::-webkit-details-marker{display:none}.ac-more>summary::after{content:"+";margin-left:auto;font-size:var(--fs-lg)}.ac-more[open]>summary::after{content:"-"}' +
      '.ac-xr{display:flex;gap:var(--s-1);align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--c-line);font-size:var(--fs-sm);color:var(--c-text-2)}' +
      '.ac-xr:last-child{border-bottom:0}.ac-xr.rep b{color:var(--c-accent-hi)}' +
      '.ac-xd{flex:none;width:38px;color:var(--c-text-3);font-weight:700;font-size:12px;padding-top:1px}' +
      '.ac-xv{flex:1;min-width:0;line-height:1.3}.ac-xv em{font-style:normal;font-size:10px;font-weight:800;color:var(--c-maybe)}' +
      '.ac-xv small{display:block;font-size:11px;color:var(--c-text-3);margin-top:2px}' +
      '.ac-xr>b{white-space:nowrap;color:var(--c-text-1);font-weight:800;font-variant-numeric:tabular-nums}' +
      '.ac-big{font-size:var(--fs-3xl);font-weight:var(--fw-black);color:var(--num-yellow,var(--c-gold));line-height:1.1}' +
      '.ac-big span{display:block;font-size:var(--fs-sm);font-weight:700;color:var(--c-text-3)}' +
      '.ac-ag,.ac-bs>div{display:grid;grid-template-columns:76px 1fr 64px;align-items:center;gap:var(--s-1);font-size:12px;color:var(--c-text-2);font-weight:700}' +
      '.ac-ag b,.ac-bs b{text-align:right;color:var(--c-text-1);font-weight:800}' +
      '.ac-bs{display:flex;flex-direction:column;gap:6px}' +
      '.ac-agb{height:12px;border-radius:var(--radius-pill);background:var(--c-surface-3);overflow:hidden}.ac-agb i{display:block;height:100%;background:var(--c-gold);border-radius:var(--radius-pill);min-width:2px}' +
      '.ac-sub{font-size:var(--fs-xs);font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.06em;margin-top:4px}' +
      '.ac-loan{display:flex;justify-content:space-between;gap:var(--s-1);background:var(--c-surface-2);border-radius:var(--radius-md);padding:var(--s-1) var(--s-1h)}' +
      '.ac-loan b{display:block;color:var(--c-text-1);font-weight:800;font-size:var(--fs-sm)}.ac-loan span{display:block;font-size:11px;color:var(--c-text-3)}.ac-loan .r{text-align:right}' +
      '.ac-pt{background:var(--c-surface-2);border-radius:var(--radius-md);padding:var(--s-1h);display:flex;flex-direction:column;gap:4px}' +
      '.ac-pt-h{display:flex;align-items:baseline;gap:var(--s-1)}.ac-pt-h b{font-size:var(--fs-md);font-weight:800;color:var(--c-text-1)}' +
      '.ac-pt-h span{font-size:11px;color:var(--c-text-3);flex:1}.ac-pt-h strong{font-size:var(--fs-lg);font-weight:900;color:var(--num-yellow,var(--c-gold))}' +
      '.ac-pt-bar{height:6px;border-radius:var(--radius-pill);background:var(--c-surface-3);overflow:hidden}.ac-pt-bar i{display:block;height:100%;background:var(--c-accent)}' +
      '.ac-pt .ac-xr{border-color:var(--c-line)}' +
      '.ac-pt-f{display:flex;justify-content:space-between;font-size:12px;color:var(--c-text-3);border-top:1px solid var(--c-line);padding-top:6px}.ac-pt-f b{color:var(--c-text-1)}' +
      '.ac-ci-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 var(--s-1h)}' +
      '.ac-ci-t{background:var(--c-surface-2,#221c38);border:1px solid var(--c-line);border-radius:var(--radius-sm,12px);padding:10px 8px;display:flex;flex-direction:column;gap:3px;min-width:0}' +
      '.ac-ci-t span{font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text-3)}' +
      '.ac-ci-t b{font-size:20px;font-weight:800;letter-spacing:-.02em;line-height:1.05;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}' +
      '.ac-ci-t small{font-size:10px;color:var(--c-text-3);line-height:1.25}' +
      '.ac-sw{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px}' +
      '.ac-neg{color:#FCA5A5}.ac-pos{color:var(--c-take)}' +
      '.ac-formula{margin-top:var(--s-1);padding:8px 10px;border-radius:var(--radius-sm,12px);background:rgba(167,139,250,.12);color:var(--c-text-1)}' +
      '.ac-nof{margin:4px 0 0;padding-left:18px;font-size:var(--fs-xs);color:var(--c-text-3);line-height:1.5}' +
      '.ac-coc-hero{text-align:center;padding:var(--s-1) 0 var(--s-1h);border-bottom:1px solid var(--c-line);margin-bottom:var(--s-1h)}' +
      '.ac-coc-big{font-size:44px;font-weight:800;letter-spacing:-.03em;line-height:1;color:var(--num-yellow,var(--c-gold,#F2C94C));font-variant-numeric:tabular-nums}' +
      '.ac-coc-big.neg,.ac-coc-n.neg{color:#F87171}.ac-coc-big.pos,.ac-coc-n.pos{color:var(--c-take,#34D399)}' +
      '.ac-coc-hero p{margin:6px 0 0;font-size:13px;color:var(--c-text-3)}' +
      '.ac-coc-view{padding:10px 0;border-bottom:1px solid var(--c-line)}' +
      '.ac-coc-lab{display:flex;justify-content:space-between;gap:8px;align-items:baseline}' +
      '.ac-coc-lab b{font-size:13px;color:var(--c-text-1)}.ac-coc-lab span{font-size:12px;color:var(--c-text-3)}' +
      '.ac-coc-n{font-size:22px;font-weight:800;margin:4px 0 6px;font-variant-numeric:tabular-nums}' +
      '.ac-coc-n small{margin-left:8px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--c-text-3)}' +
      '.ac-coc-track{position:relative;height:10px;border-radius:99px;background:var(--c-surface-3,#2a2440);overflow:hidden;margin:0 0 6px}' +
      '.ac-coc-track i{position:absolute;top:0;bottom:0;border-radius:99px;background:#F87171}' +
      '.ac-coc-track i.pos{background:var(--c-take,#34D399)}' +
      '.ac-coc-track em{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--c-text-1);border-radius:2px}' +
      '.ac-coc-track em.zero{background:#8b8fb0}' +
      '.ac-coc-cap{margin-top:var(--s-1h)}.ac-coc-cap .ac-kicker{margin-bottom:8px}.ac-coc-cap .ac-xr{align-items:center}' +
      '.ac-coc-bar{flex:1;height:8px;border-radius:99px;background:var(--c-surface-3,#2a2440);overflow:hidden;margin:0 8px}' +
      '.ac-coc-bar i{display:block;height:100%;background:var(--c-gold,#F2C94C);border-radius:99px}' +
      '.ac-gaps{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg);padding:var(--s-1) var(--s-2)}' +
      '.ac-gaps ul{margin:0 0 var(--s-1);padding-left:18px;font-size:var(--fs-xs);color:var(--c-text-2);line-height:1.45}' +
      '.ac-foot{margin:0;font-size:11px;color:var(--c-text-3);text-align:center}' +
      '.ac-lock{align-items:center;text-align:center;padding:var(--s-4) var(--s-2)}' +
      '.ac-lock h3{margin:0;font-size:var(--fs-xl);font-weight:800;color:var(--c-text-1)}' +
      '.ac-lock-ico{width:56px;height:56px;border-radius:50%;background:var(--c-surface-3);color:var(--c-accent-hi);display:grid;place-items:center}.ac-lock-ico svg{width:28px;height:28px}' +
      '.ac-pin{display:flex;gap:var(--s-1);width:100%;max-width:320px}' +
      '.ac-pin input{flex:1;min-width:0;min-height:var(--tap);padding:0 var(--s-1h);border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-size:var(--fs-base)}';
    document.head.appendChild(s);
  }

  function onShow() { render(); fetchData(false); }
  function init() {
    css();
    regDrill();
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'acct') onShow(); });
    if (document.documentElement.getAttribute('data-tab') === 'acct') onShow();
  }
  window.BlackRamAccounting = { drill: function (a) { if (!st.data) { var c = fromCache(); if (c) st.data = c; } regDrill(); drill(a); }, render: render, refresh: function () { fetchData(true); }, exportCsv: exportCsv };
  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { accounting: window.BlackRamAccounting });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
