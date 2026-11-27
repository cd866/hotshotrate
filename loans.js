/* Black Ram Logistics - Loans and Schedules (v112) + bill due dates.
   PIN-gated: every balance, amount and date below comes from the relay /financials payload
   (KV key "financials", keys "loans" and "bills", built on the box by loans_build.py and
   push_financials.py from the Chase contract, the Synchrony statement and the Progressive
   payment schedule). Nothing financial is in this repo. Locked = PIN form only.
   window.BlackRamBills gives due dates to the Break-even sheets, the Finance bill list and Today.
   Plain ASCII. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var FIN_KEY = 'blackram_fin_session_v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var st = { loading: false, error: '', fetchedAt: 0, waiters: [] };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function m2(n) { if (n == null || !isFinite(n)) return '-'; return (n < -0.004 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function m0(n) { if (n == null || !isFinite(n)) return '-'; return (n <= -0.5 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US'); }
  function mk(n) { if (n == null || !isFinite(n)) return '-'; return n >= 1000 ? '$' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : m0(n); }
  function md(iso) { if (!iso) return '?'; var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function mdy(iso) { if (!iso) return '?'; var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]) + '/' + p[0].slice(2); }
  function monY(iso) { var p = String(iso).slice(0, 10).split('-'); return MON[Number(p[1]) - 1] + ' ' + p[0]; }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function days(a, b) { return Math.round((Date.parse(String(a).slice(0, 10) + 'T12:00:00') - Date.parse(String(b).slice(0, 10) + 'T12:00:00')) / 864e5); }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, v); } catch (e) { /* private mode */ } }

  /* ---------- PIN-gated payload ---------- */
  function fin() { try { var c = sessionStorage.getItem(FIN_KEY); return c ? JSON.parse(c) : null; } catch (e) { return null; } }
  function ensure(cb, force) {
    var d = fin();
    if (d && d.loans && !force) { if (cb) cb(d); return; }
    if (!pin()) { st.error = 'nopin'; if (cb) cb(null); return; }
    if (cb) st.waiters.push(cb);
    if (st.loading) return;
    st.loading = true;
    fetch(RELAY + '/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin() }), cache: 'no-store' })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) {
          if (r.ok && j && j.ok && j.data) { st.error = ''; st.fetchedAt = Date.now(); try { sessionStorage.setItem(FIN_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ } }
          else if (r.status === 401) { st.error = 'wrongpin'; try { sessionStorage.removeItem(FIN_KEY); } catch (e) { /* ignore */ } }
          else st.error = (j && j.error) || ('Could not load (' + r.status + ')');
        });
      })
      .catch(function () { st.error = 'Offline - showing the last copy if any.'; })
      .then(function () {
        st.loading = false;
        var w = st.waiters; st.waiters = []; var d2 = fin();
        w.forEach(function (f) { try { f(d2); } catch (e) { /* ignore */ } });
        if (d2) { try { document.dispatchEvent(new CustomEvent('blackram:financials')); } catch (e) { /* ignore */ } }
        render();
      });
  }

  /* ---------- due dates ---------- */
  function idFor(label) {
    var s = String(label || '');
    if (/truck note|chase/i.test(s)) return 'truck';
    if (/trailer note|synchrony/i.test(s)) return 'trailer';
    if (/insurance|progressive/i.test(s)) return 'ins';
    return null;
  }
  function nextDue(id, d) {
    d = d || fin(); if (!d || !id) return null;
    var L = d.loans && (d.loans.loans || []).filter(function (x) { return x.id === id; })[0];
    if (L && L.next_due) return { date: L.next_due, amount: L.payment };
    var b = (d.bills || []).filter(function (x) { return x.id === id; })[0];
    return b && b.next ? { date: b.next, amount: b.amount } : null;
  }
  function urg(date) {
    var n = days(date, todayIso());
    return { n: n, cls: n < 0 ? 'bd-red' : n <= 7 ? 'bd-amb' : 'bd-mut', rel: n < 0 ? (-n) + 'd overdue' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + 'd' };
  }
  /* Adds .due ({date, n, cls, rel} | null) and .dueTxt and sorts soonest first. Unknown dates go last. */
  function decorate(list) {
    var d = fin();
    var out = (list || []).map(function (b) {
      var x = Object.assign({}, b), id = b.id || idFor(b.label || b.payee), nd = nextDue(id, d);
      if (!d) { x.due = null; x.dueHtml = '<span class="bd bd-mut">Due date: unlock with PIN</span>'; return x; }
      if (!nd) { x.due = null; x.dueHtml = '<span class="bd bd-mut">Due date not set</span>'; return x; }
      var u = urg(nd.date); x.due = Object.assign({ date: nd.date }, u);
      x.dueHtml = '<span class="bd ' + u.cls + '">Due ' + md(nd.date) + ' | ' + u.rel + '</span>';
      return x;
    });
    out.sort(function (a, b) { return (a.due ? a.due.n : 1e9) - (b.due ? b.due.n : 1e9); });
    return out;
  }
  /* Today card strip: the bills, soonest first, colored by urgency. Unlocked only. */
  function todayStrip(list) {
    var d = fin(); if (!d) return '';
    var B = decorate(list);
    if (!B.length) return '';
    return '<div class="bd-strip tl-tap" role="button" tabindex="0" data-bd-go="loans" aria-label="Bills by due date. Open Loans and Schedules">' +
      '<div class="bd-strip-h">Bills by due date</div>' + B.map(function (b) {
        return '<div class="bd-li"><span>' + esc(b.label || b.payee) + '</span><b>' + m0(b.amount) + '</b>' + b.dueHtml + '</div>';
      }).join('') + '</div>';
  }

  /* ---------- charts ---------- */
  function balChart(L, made) {
    var R = L.rows, W = 340, H = 156, l = 40, r = 10, t = 24, b = 24, n = R.length;
    var mx = L.principal;
    function X(i) { return l + (W - l - r) * i / n; }
    function Y(v) { return t + (H - t - b) * (1 - v / mx); }
    var pts = [[0, L.principal]].concat(R.map(function (q, i) { return [i + 1, q[5]]; }));
    var paid = pts.slice(0, made + 1), fut = pts.slice(made);
    function path(p) { return p.map(function (q, i) { return (i ? 'L' : 'M') + X(q[0]).toFixed(1) + ' ' + Y(q[1]).toFixed(1); }).join(''); }
    var area = path(fut) + 'L' + X(n).toFixed(1) + ' ' + Y(0).toFixed(1) + 'L' + X(made).toFixed(1) + ' ' + Y(0).toFixed(1) + 'Z';
    var o = ['<svg class="ln-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Remaining balance by month">'];
    [0, 0.5, 1].forEach(function (f) { var v = mx * f; o.push('<line x1="' + l + '" x2="' + (W - r) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" class="ln-grid"/><text x="' + (l - 4) + '" y="' + (Y(v) + 3).toFixed(1) + '" text-anchor="end" class="ln-ax">' + mk(v) + '</text>'); });
    var yrs = {}; R.forEach(function (q, i) { var y = q[1].slice(0, 4); if (!yrs[y]) { yrs[y] = 1; if (q[1].slice(5, 7) === '01' || (i === 0 && Number(q[1].slice(5, 7)) <= 9)) o.push('<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" class="ln-ax" text-anchor="' + (i === 0 ? 'start' : 'middle') + '">\'' + y.slice(2) + '</text>'); } });
    o.push('<path d="' + area + '" class="ln-area"/><path d="' + path(fut) + '" class="ln-fut"/>');
    if (made > 0) o.push('<path d="' + path(paid) + '" class="ln-paid"/>');
    var c = pts[made];
    o.push('<line x1="' + X(made).toFixed(1) + '" x2="' + X(made).toFixed(1) + '" y1="' + t + '" y2="' + Y(0).toFixed(1) + '" class="ln-now"/><circle cx="' + X(c[0]).toFixed(1) + '" cy="' + Y(c[1]).toFixed(1) + '" r="4.5" class="ln-dot"/>');
    o.push('<text x="' + Math.min(X(made) + 7, W - 80).toFixed(1) + '" y="' + (Y(c[1]) - 8).toFixed(1) + '" class="ln-lbl">' + mk(c[1]) + ' now</text>');
    o.push('</svg>');
    return o.join('');
  }
  function yearBars(L) {
    var by = {}, ks = [];
    L.rows.forEach(function (q) { var y = q[1].slice(0, 4); if (!by[y]) { by[y] = { p: 0, i: 0 }; ks.push(y); } by[y].p += q[3]; by[y].i += q[4]; });
    var W = 340, H = 140, l = 8, r = 8, t = 16, b = 22, mx = 1;
    ks.forEach(function (k) { mx = Math.max(mx, by[k].p + by[k].i); });
    var gw = (W - l - r) / ks.length, bw = Math.min(26, gw * 0.62);
    var o = ['<svg class="ln-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Principal and interest paid per year">'];
    ks.forEach(function (k, i) {
      var cx = l + gw * i + gw / 2, hp = by[k].p / mx * (H - t - b), hi = by[k].i / mx * (H - t - b), base = H - b;
      o.push('<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + (base - hp).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(hp, 0.5).toFixed(1) + '" rx="3" class="ln-bp"/>');
      o.push('<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + (base - hp - hi).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(hi, 0.5).toFixed(1) + '" rx="3" class="ln-bi"/>');
      o.push('<text x="' + cx.toFixed(1) + '" y="' + (base - hp - hi - 4).toFixed(1) + '" text-anchor="middle" class="ln-ax">' + mk(by[k].p + by[k].i) + '</text>');
      o.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle" class="ln-ax">\'' + k.slice(2) + '</text>');
    });
    o.push('</svg>');
    return o.join('') + '<div class="ln-leg"><span><i class="lg-p"></i>Principal</span><span><i class="lg-i"></i>Interest</span><span class="ln-leg-n">per year</span></div>';
  }
  function ring(made, n) {
    var f = n ? made / n : 0, C = 2 * Math.PI * 26;
    return '<svg class="ln-ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" class="ln-ring-bg"/><circle cx="32" cy="32" r="26" class="ln-ring-fg" stroke-dasharray="' + (C * f).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 32 32)"/>' +
      '<text x="32" y="30" text-anchor="middle" class="ln-ring-n">' + made + '</text><text x="32" y="43" text-anchor="middle" class="ln-ring-s">of ' + n + '</text></svg>';
  }

  /* ---------- sections ---------- */
  function loanCard(L) {
    var made = Math.max(0, Math.min(L.payments_made || 0, L.rows.length)), n = L.rows.length;
    var bal = made ? L.rows[made - 1][5] : L.principal;
    var ti = L.rows.reduce(function (a, q) { return a + q[4]; }, 0);
    var tiPaid = L.rows.slice(0, made).reduce(function (a, q) { return a + q[4]; }, 0);
    var nd = L.next_due ? urg(L.next_due) : null;
    var payoff = L.rows[n - 1][1];
    var tiTxt = L.contract_interest != null ? m0(L.contract_interest) : m0(ti) + ' EST';
    var tiSub = L.contract_interest != null ? 'contract finance charge' : 'from the schedule';
    function kv(k, v, s) { return '<div class="ln-kv"><span>' + k + '</span><b>' + v + '</b>' + (s ? '<small>' + s + '</small>' : '') + '</div>'; }
    var today = todayIso();
    var rows = L.rows.map(function (q, i) {
      var paid = i < made, late = !paid && q[1] < today, nxt = !paid && !late && (i === made);
      return '<tr class="' + (paid ? 'ln-paid-r' : late ? 'ln-late-r' : nxt ? 'ln-next-r' : '') + '"' + (paid ? ' aria-label="paid"' : late ? ' aria-label="past due, not logged"' : nxt ? ' aria-label="next payment"' : '') + '><td>' + q[0] + '</td><td>' + mdy(q[1]) + '</td><td>' + m2(q[2]) + '</td><td>' + m2(q[3]) + '</td><td>' + m2(q[4]) + '</td><td>' + m2(q[5]) + '</td></tr>';
    }).join('');
    return '<section class="ln-card" id="loans-' + esc(L.id) + '">' +
      '<div class="ln-h"><div><div class="ln-kick">' + esc(L.name) + ' | ' + esc(L.lender) + '</div><div class="ln-asset">' + esc(L.asset) + '</div></div>' + ring(made, n) + '</div>' +
      '<div class="ln-big"><b class="num-yellow">' + m0(bal) + '</b><span>balance EST after ' + made + ' paid</span></div>' +
      balChart(L, made) +
      yearBars(L) +
      '<div class="ln-grid2">' +
      kv('Payment', m2(L.payment), 'the ' + L.due_day + (L.due_day === 1 ? 'st' : 'th') + ' monthly') +
      kv('Next due', L.next_due ? '<span class="ln-u ' + nd.cls.replace('bd-', 'ln-u-') + '">' + mdy(L.next_due) + '</span>' : 'Due date not set', nd ? nd.rel : '') +
      kv('Original principal', m2(L.principal), 'amount financed') +
      kv('APR', L.apr.toFixed(2) + '%', 'fixed') +
      kv('Term', L.term + ' mo', (L.term / 12) + ' years') +
      kv('Start', mdy(L.start), '1st pmt ' + mdy(L.first_payment)) +
      kv('Paid / left', made + ' / ' + (n - made), L.last_paid ? 'last ' + mdy(L.last_paid) : '') +
      kv('Payoff', monY(payoff), 'last pmt ' + mdy(payoff)) +
      kv('Total interest', tiTxt, tiSub) +
      kv('Interest paid', m0(tiPaid) + ' EST', 'of the ' + made + ' paid') +
      (L.statement_balance != null ? kv('Last statement', m2(L.statement_balance), mdy(L.statement_date) + ', before Nov pmt') : '') +
      (L.down != null ? kv('Down (cash)', m2(L.down), 'invoice ' + m0(L.price) + ' - financed') : '') +
      '</div>' +
      '<details class="ln-sched" id="loans-' + esc(L.id) + '-sched"><summary>Full schedule (' + n + ' payments)</summary>' +
      '<div class="ln-key"><span><i class="k-paid"></i>Paid</span><span><i class="k-next"></i>Next</span><span><i class="k-late"></i>Past due, not logged</span></div><div class="ln-tbl-wrap"><table class="ln-tbl"><thead><tr><th>#</th><th>Date</th><th>Pmt</th><th>Princ.</th><th>Int.</th><th>Balance</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>' +
      '<p class="ln-fine">' + esc(L.method) + ' ' + esc(L.statement_note || '') + '</p>' +
      '<details class="ln-src"><summary>Sources</summary><ul>' + Object.keys(L.sources || {}).map(function (k) { return '<li><b>' + esc(k) + ':</b> ' + esc(L.sources[k]) + '</li>'; }).join('') + '</ul></details>' +
      '</section>';
  }
  function otherCard(O) {
    var today = todayIso(), nextI = -1;
    O.rows.forEach(function (q, i) { if (nextI < 0 && !q[2]) nextI = i; });
    var left = O.rows.filter(function (q) { return !q[2]; });
    var tot = left.reduce(function (a, q) { return a + q[1]; }, 0);
    var mx = 1; O.rows.forEach(function (q) { mx = Math.max(mx, q[1]); });
    var list = O.rows.map(function (q, i) {
      var u = q[2] ? null : urg(q[0]);
      return '<div class="ln-pr' + (q[2] ? ' ln-pr-paid' : '') + (i === nextI ? ' ln-pr-next' : '') + '"><span class="ln-pr-d">' + mdy(q[0]) + '</span><span class="ln-pr-bar"><i style="width:' + (q[1] / mx * 100).toFixed(0) + '%"></i></span><b>' + m2(q[1]) + '</b>' +
        (q[2] ? '<span class="ln-ok">Paid</span>' : '<span class="bd ' + (i === nextI || (u && u.n < 0) ? u.cls : 'bd-mut') + '">' + (u.n < 0 ? 'overdue' : u.rel) + '</span>') + '</div>';
    }).join('');
    return '<section class="ln-card" id="loans-' + esc(O.id) + '"><div class="ln-h"><div><div class="ln-kick">' + esc(O.name) + ' | ' + esc(O.payee) + '</div>' +
      '<div class="ln-asset">' + left.length + ' left | ' + m2(tot) + '</div></div></div>' + list +
      '<p class="ln-fine">' + esc(O.note) + ' Source: ' + esc(O.source) + '.</p></section>';
  }
  function lockView(msg) {
    return '<section class="ln-card ln-lock"><svg viewBox="0 0 24 24" class="ln-lock-ico" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></g></svg>' +
      '<h3>Loans and Schedules is locked</h3><p class="ln-fine">' + esc(msg) + '</p>' +
      '<form id="ln-pin-form" class="ln-pin" autocomplete="off"><input id="ln-pin" type="password" inputmode="numeric" placeholder="App PIN" aria-label="App PIN" />' +
      '<button type="submit" class="btn primary">Unlock</button></form></section>';
  }
  function root() { return document.getElementById('ln-root'); }
  function render() {
    var el = root(); if (!el) return;
    var d = fin(), LN = d && d.loans;
    if (!LN) {
      if (st.error === 'wrongpin') el.innerHTML = lockView('Wrong PIN. Try again.');
      else if (!pin() || st.error === 'nopin') el.innerHTML = lockView('Truck and trailer notes, balances and payment schedules. Enter the app PIN to see them.');
      else if (st.loading) el.innerHTML = '<section class="ln-card"><p class="ln-fine">Loading loans...</p></section>';
      else el.innerHTML = '<section class="ln-card"><p class="ln-fine">' + esc(st.error || (d ? 'Loan schedules are not on the server yet.' : 'Loading...')) + '</p></section>';
      bind(); return;
    }
    var loans = LN.loans || [], tot = 0, pay = 0;
    loans.forEach(function (L) { var m = Math.min(L.payments_made || 0, L.rows.length); tot += m ? L.rows[m - 1][5] : L.principal; pay += L.payment; });
    var B = decorate([{ id: 'truck', label: 'Truck note (Chase)' }, { id: 'trailer', label: 'Trailer note (Synchrony)' }, { id: 'ins', label: 'Insurance (Progressive)' }]);
    var nav = '<nav class="ln-jump">' + loans.map(function (L) { return '<a href="#" data-ln-jump="loans-' + esc(L.id) + '">' + esc(L.name) + '</a>'; }).join('') +
      (LN.others || []).map(function (O) { return '<a href="#" data-ln-jump="loans-' + esc(O.id) + '">' + esc(O.name.split(' ')[0]) + '</a>'; }).join('') + '</nav>';
    el.innerHTML =
      '<div class="ln-top"><div><div class="ln-kick">Sand Lily Pad LLC</div><h2>Loans and Schedules</h2></div><button type="button" class="ln-btn" id="ln-refresh">' + (st.loading ? '...' : 'Refresh') + '</button></div>' +
      '<section class="ln-card ln-sum"><div class="ln-sum-row"><div><span>Owed on equipment</span><b class="num-yellow">' + m0(tot) + '</b><small>EST, schedule</small></div><div><span>Notes per month</span><b class="num-yellow">' + m0(pay) + '</b><small>truck + trailer</small></div></div>' +
      '<div class="ln-due">' + B.map(function (b) { return '<div class="bd-li"><span>' + esc(b.label) + '</span>' + b.dueHtml + '</div>'; }).join('') +
      '<div class="bd-li"><span>Other monthly (phone, software)</span><span class="bd bd-mut">Due date not set</span></div></div></section>' +
      nav + loans.map(loanCard).join('') + (LN.others || []).map(otherCard).join('') +
      (LN.needed && LN.needed.length ? '<details class="ln-src"><summary>Still needed (' + LN.needed.length + ')</summary><ul>' + LN.needed.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>' : '') +
      '<p class="ln-fine">EST schedules: lenders charge simple interest, so real balances move with the actual pay dates. Not a payoff quote.</p>';
    bind();
  }
  function bind() {
    var f = document.getElementById('ln-pin-form');
    if (f) f.addEventListener('submit', function (e) { e.preventDefault(); var v = (document.getElementById('ln-pin').value || '').trim(); if (!v) return; setPin(v); st.error = ''; ensure(null, true); render(); });
    var rf = document.getElementById('ln-refresh');
    if (rf) rf.addEventListener('click', function () { ensure(null, true); render(); });
    var el = root(); if (!el) return;
    el.querySelectorAll('[data-ln-jump]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); var t = document.getElementById(a.getAttribute('data-ln-jump')); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' }); });
    });
  }
  function onShow() { render(); ensure(function () { render(); }, !!(fin() && Date.now() - st.fetchedAt > 60000 && st.fetchedAt)); }

  /* ---------- styles ---------- */
  (function css() {
    if (document.getElementById('ln-css')) return;
    var s = document.createElement('style'); s.id = 'ln-css';
    s.textContent =
      '.bd{display:inline-block;font-size:11px;font-weight:800;padding:1px 7px;border-radius:var(--radius-pill,999px);white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.bd-red{background:rgba(248,113,113,.16);color:#FCA5A5}.bd-amb{background:var(--c-maybe-bg);color:var(--c-maybe)}.bd-mut{background:var(--c-pass-bg);color:var(--c-text-3)}' +
      '.ln-u-red{color:#FCA5A5}.ln-u-amb{color:var(--c-maybe)}.ln-u-mut{color:var(--c-text-1)}' +
      '.tl-m small .bd{margin-top:3px}' +
      '.bd-strip{margin-top:var(--s-1,8px);border-top:1px solid var(--c-line);padding-top:8px;display:flex;flex-direction:column;gap:5px}' +
      '.bd-strip-h{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text-3)}' +
      '.bd-li{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--c-text-2)}.bd-li>span:first-child{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bd-li>b{color:var(--c-text-1);font-variant-numeric:tabular-nums}' +
      '.ln-top{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin:4px 2px 10px}.ln-top h2{margin:0;font-size:var(--fs-xl,22px)}' +
      '.ln-kick{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text-3)}' +
      '.ln-btn{min-height:36px;padding:0 14px;border-radius:var(--radius-pill,999px);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-weight:800}' +
      '.ln-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg,16px);padding:14px;margin:0 0 12px}' +
      '.ln-sum-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}.ln-sum-row span{display:block;font-size:12px;color:var(--c-text-3);font-weight:700}.ln-sum-row b{display:block;font-size:26px;font-weight:900;line-height:1.15}.ln-sum-row small{color:var(--c-text-3);font-size:11px}' +
      '.ln-due{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--c-line);padding-top:10px}' +
      '.ln-jump{display:flex;gap:6px;overflow-x:auto;margin:0 0 10px;padding-bottom:2px}.ln-jump a{flex:none;padding:6px 12px;border-radius:var(--radius-pill,999px);background:var(--c-surface-2);border:1px solid var(--c-line);color:var(--c-text-2);font-size:13px;font-weight:800;text-decoration:none}' +
      '.ln-h{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.ln-asset{font-size:14px;font-weight:800;color:var(--c-text-1);margin-top:2px}' +
      '.ln-ring{width:58px;height:58px;flex:none}.ln-ring-bg{fill:none;stroke:var(--c-surface-3);stroke-width:6}.ln-ring-fg{fill:none;stroke:var(--c-gold);stroke-width:6;stroke-linecap:round}.ln-ring-n{fill:var(--c-text-1);font-size:16px;font-weight:900}.ln-ring-s{fill:var(--c-text-3);font-size:9px;font-weight:700}' +
      '.ln-big{margin:2px 0 4px}.ln-big b{font-size:30px;font-weight:900;margin-right:8px}.ln-big span{font-size:12px;color:var(--c-text-3);font-weight:700}' +
      '.ln-svg{width:100%;height:auto;display:block;margin:4px 0}.ln-grid{stroke:var(--c-line);stroke-width:1}.ln-ax{fill:var(--c-text-3);font-size:10px;font-weight:700;font-family:var(--body)}' +
      '.ln-area{fill:rgba(242,201,76,.10)}.ln-fut{fill:none;stroke:var(--c-gold);stroke-width:2;stroke-dasharray:5 4;opacity:.8}.ln-paid{fill:none;stroke:var(--c-take);stroke-width:3;stroke-linecap:round}' +
      '.ln-now{stroke:var(--c-text-3);stroke-width:1;stroke-dasharray:2 3}.ln-dot{fill:var(--c-gold);stroke:var(--c-bg);stroke-width:2}.ln-lbl{fill:var(--c-gold);font-size:11px;font-weight:900;font-family:var(--body)}' +
      '.ln-bp{fill:var(--c-gold)}.ln-bi{fill:#F87171;opacity:.85}' +
      '.ln-leg{display:flex;gap:12px;font-size:12px;color:var(--c-text-2);margin:0 0 8px}.ln-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}.ln-leg .lg-p{background:var(--c-gold)}.ln-leg .lg-i{background:#F87171}.ln-leg-n{margin-left:auto;color:var(--c-text-3)}' +
      '.ln-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0 10px}' +
      '.ln-kv{background:var(--c-surface-2);border-radius:var(--radius-md,12px);padding:8px 10px;min-width:0}.ln-kv span{display:block;font-size:11px;font-weight:700;color:var(--c-text-3)}.ln-kv b{display:block;font-size:16px;font-weight:900;color:var(--c-text-1);font-variant-numeric:tabular-nums}.ln-kv small{display:block;font-size:11px;color:var(--c-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.ln-sched,.ln-src{border-top:1px solid var(--c-line);padding-top:6px;margin-top:6px}' +
      '.ln-sched>summary,.ln-src>summary{cursor:pointer;min-height:40px;display:flex;align-items:center;font-size:var(--fs-sm,14px);font-weight:800;color:var(--c-accent-hi);list-style:none}' +
      '.ln-sched>summary::-webkit-details-marker,.ln-src>summary::-webkit-details-marker{display:none}' +
      '.ln-sched>summary::after,.ln-src>summary::after{content:"";margin-left:auto;width:16px;height:16px;flex:0 0 16px;background-color:currentColor;-webkit-mask:var(--caret-svg) center/contain no-repeat;mask:var(--caret-svg) center/contain no-repeat;transition:transform .25s ease}' +
      '.ln-sched[open]>summary::after,.ln-src[open]>summary::after{transform:rotate(180deg)}' +
      '.ln-tbl-wrap{max-height:420px;overflow:auto;border-radius:var(--radius-md,12px);border:1px solid var(--c-line)}' +
      '.ln-tbl{width:100%;border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums}.ln-tbl th{position:sticky;top:0;background:var(--c-surface-3);color:var(--c-text-2);font-weight:800;text-align:right;padding:6px 4px}' +
      '.ln-tbl td{text-align:right;padding:5px 4px;border-top:1px solid var(--c-line);color:var(--c-text-2);white-space:nowrap}.ln-tbl th:first-child,.ln-tbl td:first-child{text-align:left}' +
      '.ln-paid-r td{color:var(--c-text-3);background:rgba(52,211,153,.06)}.ln-next-r td{background:rgba(242,201,76,.10);color:var(--c-text-1);font-weight:800}.ln-late-r td{background:rgba(248,113,113,.08)}' +
      '.ln-paid-r td:first-child{box-shadow:inset 3px 0 var(--c-take)}.ln-next-r td:first-child{box-shadow:inset 3px 0 var(--c-gold)}.ln-late-r td:first-child{box-shadow:inset 3px 0 #F87171}' +
      '.ln-key{display:flex;gap:12px;font-size:11px;color:var(--c-text-3);margin:0 0 6px}.ln-key i{display:inline-block;width:3px;height:11px;margin-right:4px;vertical-align:-1px}.ln-key .k-paid{background:var(--c-take)}.ln-key .k-next{background:var(--c-gold)}.ln-key .k-late{background:#F87171}' +
      '.ln-st{text-align:left!important}.ln-ok{font-size:11px;font-weight:800;color:var(--c-take)}' +
      '.ln-pr{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--c-line);font-size:13px}.ln-pr:last-of-type{border-bottom:0}' +
      '.ln-pr-d{width:62px;flex:none;color:var(--c-text-2);font-weight:700}.ln-pr-bar{flex:1;height:8px;background:var(--c-surface-3);border-radius:4px;overflow:hidden}.ln-pr-bar i{display:block;height:100%;background:var(--c-gold);border-radius:4px}' +
      '.ln-pr b{width:76px;text-align:right;color:var(--c-text-1);font-variant-numeric:tabular-nums}.ln-pr .bd,.ln-pr .ln-ok{width:76px;text-align:center}.ln-pr-paid{opacity:.6}.ln-pr-next b{color:var(--c-gold)}' +
      '.ln-fine{font-size:12px;color:var(--c-text-3);line-height:1.4;margin:8px 0 0}.ln-src ul{margin:0;padding-left:18px;font-size:12px;color:var(--c-text-3);line-height:1.45}' +
      '.ln-lock{text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px}.ln-lock-ico{width:34px;height:34px;color:var(--c-gold)}.ln-lock h3{margin:0}' +
      '.ln-pin{display:flex;gap:8px;width:100%;max-width:320px}.ln-pin input{flex:1;min-width:0;min-height:var(--tap,44px);padding:0 12px;border-radius:var(--radius-sm,10px);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1)}' +
      '@media (prefers-reduced-motion: reduce){.ln-sched>summary::after,.ln-src>summary::after{transition:none}}';
    document.head.appendChild(s);
  })();

  function init() {
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'loans') onShow(); });
    document.addEventListener('click', function (e) { var g = e.target.closest && e.target.closest('[data-bd-go]'); if (g && window.BlackRamApp && window.BlackRamApp.showTab) window.BlackRamApp.showTab('loans'); });
    var p = document.getElementById('panel-loans'); if (p && !p.hidden) onShow();
    // Warm the due dates once so the Break-even sheet and Today have them.
    if (pin() && !(fin() && fin().loans)) setTimeout(function () { ensure(null); }, 1500);
  }
  window.BlackRamBills = { decorate: decorate, todayStrip: todayStrip, ensure: ensure, nextDue: nextDue, urg: urg, idFor: idFor, has: function () { return !!fin(); } };
  window.BlackRamLoans = { render: render, show: onShow };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
