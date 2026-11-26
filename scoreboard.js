/* Black Ram Logistics - Scoreboard section (v52).
   Big KPI tiles: actual vs target, green/amber/red status, trend vs last period.
   Targets: Targets tab sliders (localStorage blackram_targets_v1) + targets.js break-even math.
   Actuals: the public ledger feed (data/feed.json via window.BlackRamApp).
   Private bank figures only via the PIN-gated relay /financials (cached Finance session). */
(function () {
  'use strict';
  var TKEY = 'blackram_targets_v1';
  var DEF = { goal: 3000, partners: 3, rpm: 2.75, dead: 25, loadsWk: 3, miLoad: 350, daysMo: 22, fee: 13, maint: 0.15, otherMo: 42, driverMo: 3000 };
  var WEEKS = 52 / 12;
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var FIN_KEY = 'blackram_fin_session_v1';
  var fin = { data: null, tried: false };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null || !isFinite(n)) return '-';
    var r = Math.round(n);
    return (r < 0 ? '-$' : '$') + Math.abs(r).toLocaleString('en-US');
  }
  function pct(n, d) { return (n == null || !isFinite(n)) ? '-' : (n * 100).toFixed(d == null ? 0 : d) + '%'; }
  function num(n, d) { return (n == null || !isFinite(n)) ? '-' : Number(n).toFixed(d == null ? 0 : d).replace(/\.0+$/, ''); }
  function rpmT(n) { return (n == null || !isFinite(n)) ? '-' : '$' + n.toFixed(2); }
  function tg() {
    var s = {}, out = {};
    try { s = JSON.parse(localStorage.getItem(TKEY) || '{}') || {}; } catch (e) { s = {}; }
    Object.keys(DEF).forEach(function (k) { out[k] = s[k] != null ? Number(s[k]) : DEF[k]; });
    return out;
  }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function parse(s) { var p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
  function addDays(s, n) { var d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function todayCT() {
    var f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
    return f.format(new Date());
  }
  function mondayOf(s) { var d = parse(s); var w = (d.getUTCDay() + 6) % 7; return addDays(s, -w); }
  function md(s) { var p = s.split('-'); return Number(p[1]) + '/' + Number(p[2]); }

  function css() {
    if ($('sb-css')) return;
    var s = document.createElement('style');
    s.id = 'sb-css';
    s.textContent = [
      '#scoreboard-root{margin:0 0 18px}',
      '.sb-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:2px 0 10px}',
      '.sb-h h2{margin:0;font-size:13px;letter-spacing:1.2px;text-transform:uppercase;color:var(--c-gold,#F2C94C);font-weight:800}',
      '.sb-h span{font-size:12px;color:var(--c-text-3,#b9b3cc)}',
      '.sb-hero{display:grid;grid-template-columns:118px 1fr;gap:14px;align-items:center;background:linear-gradient(135deg,#2a1f4a 0%,var(--c-surface-1,#1a1726) 70%);border:1px solid #4c3d80;border-radius:18px;padding:14px;margin:0 0 12px}',
      '.sb-hero svg{display:block;width:118px;height:118px}',
      '.sb-hero h3{margin:0 0 4px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--c-text-3,#b9b3cc)}',
      '.sb-hero .sb-big{font-size:24px;font-weight:800;color:var(--c-text-1,#f2f0f7);line-height:1.1;margin:0 0 4px}',
      '.sb-hero p{margin:0;font-size:13px;color:var(--c-text-3,#b9b3cc);line-height:1.35}',
      '.sb-hero .sb-be2{margin-top:6px;padding-top:6px;border-top:1px solid #4c3d80;color:var(--c-text-2,#d2cce4)}',
      '.sb-calls{background:var(--c-surface-1,#1a1726);border:1px solid var(--c-line,#2e2940);border-left:4px solid var(--c-gold,#F2C94C);border-radius:var(--radius-md,12px);padding:10px 12px;margin:0 0 12px}',
      '.sb-calls p{margin:0 0 6px;font-size:14.5px;line-height:1.35;color:var(--c-text-1,#f2f0f7)}',
      '.sb-calls p:last-child{margin:0}',
      '.sb-calls b{color:var(--gold-hi,#F5D76A)}',
      '.sb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '.sb-t{position:relative;background:var(--c-surface-1,#1a1726);border:1px solid var(--c-line,#2e2940);border-radius:var(--radius-lg,16px);padding:12px 12px 10px;overflow:hidden;min-width:0}',
      '.sb-t::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:#5a5d80}',
      '.sb-t.g::before{background:var(--c-take,#34D399)}.sb-t.a::before{background:var(--c-maybe,#FBBF24)}.sb-t.r::before{background:#F87171}',
      '.sb-t.wide{grid-column:1 / -1}',
      '.sb-l{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--c-text-3,#b9b3cc)}',
      '.sb-dot{flex:0 0 auto;font-size:10px;font-weight:800;letter-spacing:.5px;border-radius:999px;padding:2px 7px;background:#3a3550;color:#ddd}',
      '.g .sb-dot{background:var(--good-bg,#065F46);color:var(--good-ink,#A7F3D0)}.a .sb-dot{background:var(--ok-bg,#92400E);color:var(--ok-ink,#FDE68A)}.r .sb-dot{background:var(--bad-bg,#9F1239);color:var(--bad-ink,#FECACA)}',
      '.sb-v{font-size:30px;font-weight:800;color:var(--c-text-1,#f2f0f7);line-height:1.05;margin:6px 0 2px;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.sb-v small{font-size:14px;color:var(--c-text-3,#b9b3cc);font-weight:700}',
      '.sb-tg{font-size:12.5px;color:var(--c-text-3,#b9b3cc);margin:0 0 6px;line-height:1.3}',
      '.sb-tg b{color:var(--c-text-1,#f2f0f7)}',
      '.sb-bar{position:relative;height:8px;border-radius:99px;background:#2a2440;margin:0 0 6px}',
      '.sb-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:99px;background:#8b8fb0}',
      '.g .sb-bar i{background:var(--c-take,#34D399)}.a .sb-bar i{background:var(--c-maybe,#FBBF24)}.r .sb-bar i{background:#F87171}',
      '.sb-bar em{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--c-text-1,#f2f0f7);border-radius:2px}',
      '.sb-f{display:flex;justify-content:space-between;align-items:flex-end;gap:6px}',
      '.sb-tr{font-size:12px;font-weight:700;color:var(--c-text-3,#b9b3cc);line-height:1.25}',
      '.sb-tr.up{color:var(--good-ink,#A7F3D0)}.sb-tr.dn{color:var(--bad-ink,#FECACA)}',
      '.sb-f svg{flex:0 0 auto;display:block}',
      '.sb-fine{font-size:12px;color:var(--c-text-3,#b9b3cc);line-height:1.4;margin:10px 2px 0}',
      '.sb-lock{cursor:pointer}'
    ].join('');
    document.head.appendChild(s);
  }

  function mount() {
    var panel = $('panel-kpis');
    if (!panel) return null;
    var root = $('scoreboard-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'scoreboard-root';
      var anchor = $('kpis-root');
      if (anchor && anchor.parentNode === panel) panel.insertBefore(root, anchor);
      else panel.insertBefore(root, panel.firstChild);
    }
    return root;
  }

  // ratio >= 1 green, >= .8 amber, else red. lower=true flips (target/actual).
  function status(actual, target, lower) {
    if (actual == null || target == null || !isFinite(actual) || !isFinite(target)) return '';
    var r;
    if (lower) r = actual <= 0 ? 1 : target / actual; else r = target <= 0 ? 1 : actual / target;
    return r >= 1 ? 'g' : (r >= 0.8 ? 'a' : 'r');
  }
  var SLABEL = { g: 'ON TRACK', a: 'CLOSE', r: 'BEHIND', '': 'NO DATA' };

  function spark(vals, cls) {
    var v = vals.filter(function (x) { return x != null && isFinite(x); });
    if (v.length < 2) return '';
    var w = 64, h = 24, min = Math.min.apply(null, v), max = Math.max.apply(null, v);
    if (max === min) { max += 1; min -= 1; }
    var pts = vals.map(function (x, i) {
      if (x == null || !isFinite(x)) return null;
      return (i * (w - 4) / (vals.length - 1) + 2).toFixed(1) + ',' + (h - 3 - (x - min) / (max - min) * (h - 6)).toFixed(1);
    }).filter(Boolean);
    var col = cls === 'g' ? '#34D399' : cls === 'a' ? '#FBBF24' : cls === 'r' ? '#F87171' : '#a78bfa';
    var last = pts[pts.length - 1].split(',');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true"><polyline points="' + pts.join(' ') +
      '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.6" fill="' + col + '"/></svg>';
  }

  function trend(cur, prev, label, fmt, lower) {
    if (prev == null || !isFinite(prev) || cur == null || !isFinite(cur)) return '<span class="sb-tr">' + esc(label ? 'No ' + label + ' data' : '') + '</span>';
    var d = cur - prev;
    var good = lower ? d < 0 : d > 0;
    var cls = Math.abs(d) < 1e-9 ? '' : (good ? 'up' : 'dn');
    var arrow = Math.abs(d) < 1e-9 ? '=' : (d > 0 ? '+' : '-');
    return '<span class="sb-tr ' + cls + '">' + arrow + ' ' + esc(fmt(Math.abs(d))) + ' vs ' + esc(label) + '<br>(' + esc(fmt(prev)) + ')</span>';
  }

  function tile(o) {
    var cls = o.cls != null ? o.cls : status(o.actual, o.paceTarget != null ? o.paceTarget : o.target, o.lower);
    var barMax = o.barMax || (o.lower ? Math.max(o.actual || 0, (o.target || 0) * 1.6, 1) : Math.max(o.target || 0, o.actual || 0, 1e-9));
    var fill = o.actual == null ? 0 : Math.max(0, Math.min(100, (o.actual / barMax) * 100));
    var mark = o.paceTarget != null ? o.paceTarget : o.target;
    var markPct = mark == null ? null : Math.max(0, Math.min(100, mark / barMax * 100));
    return '<article class="sb-t ' + cls + (o.wide ? ' wide' : '') + (o.extraCls ? ' ' + o.extraCls : '') + '"' + (o.attrs || '') + '>' +
      '<div class="sb-l"><span>' + esc(o.label) + '</span><span class="sb-dot">' + SLABEL[cls] + '</span></div>' +
      '<div class="sb-v">' + o.value + '</div>' +
      '<p class="sb-tg">' + o.targetText + '</p>' +
      (o.noBar ? '' : '<div class="sb-bar" aria-hidden="true"><i style="width:' + fill.toFixed(1) + '%"></i>' +
        (markPct != null ? '<em style="left:calc(' + markPct.toFixed(1) + '% - 1px)"></em>' : '') + '</div>') +
      '<div class="sb-f">' + (o.trend || '<span class="sb-tr"></span>') + (o.spark ? o.spark.replace('#a78bfa', cls === 'g' ? '#34D399' : cls === 'a' ? '#FBBF24' : cls === 'r' ? '#F87171' : '#a78bfa').replace('#a78bfa', cls === 'g' ? '#34D399' : cls === 'a' ? '#FBBF24' : cls === 'r' ? '#F87171' : '#a78bfa') : '') + '</div></article>';
  }

  function sub(month, from, to) {
    // Synthetic month limited to [from, to] so monthFigures can be reused for weeks / same-day comparisons.
    return {
      month: month.month, fee_pct: month.fee_pct, as_of: to,
      loads: (month.loads || []).filter(function (l) { return l.date && l.date >= from && l.date <= to; }),
      expenses: (month.expenses || []).filter(function (e) { return e.date && e.date >= from && e.date <= to; })
    };
  }
  function allSub(months, from, to) {
    var out = { month: from.slice(0, 7), fee_pct: months.length ? months[months.length - 1].fee_pct : 13, as_of: to, loads: [], expenses: [] };
    months.forEach(function (m) { var s = sub(m, from, to); out.loads = out.loads.concat(s.loads); out.expenses = out.expenses.concat(s.expenses); });
    return out;
  }
  function usedDays(loads, from, to) {
    var seen = {};
    loads.forEach(function (l) {
      if (!l.date) return;
      var end = l.delivery_date && l.delivery_date >= l.date ? l.delivery_date : l.date;
      for (var d = l.date; d <= end; d = addDays(d, 1)) if (d >= from && d <= to) seen[d] = true;
    });
    return Object.keys(seen).length;
  }

  function loadFin() {
    if (fin.data) return;
    try { var c = sessionStorage.getItem(FIN_KEY); if (c) { fin.data = JSON.parse(c); return; } } catch (e) { /* ignore */ }
    var p = '';
    try { p = (localStorage.getItem('blackram_relay_pin_v1') || '').trim(); } catch (e) { p = ''; }
    if (!p || fin.tried) return;
    fin.tried = true;
    fetch(RELAY + '/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }), cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok && j.data) {
          fin.data = j.data;
          try { sessionStorage.setItem(FIN_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ }
          if (visible()) render();
        }
      }).catch(function () { /* offline */ });
  }

  function render() {
    css();
    var root = mount();
    if (!root) return;
    var A = window.BlackRamApp, T = window.BlackRamTargets;
    var feed = A && A.getFeed ? A.getFeed() : null;
    if (!feed || !feed.months || !feed.months.length || !A.monthFigures) {
      root.innerHTML = '<div class="sb-h"><h2>Scoreboard</h2><span>loading the ledger...</span></div>';
      return;
    }
    var t = tg();
    var M = T && T.model ? T.model() : null;
    var months = feed.months.slice().sort(function (a, b) { return a.month < b.month ? -1 : 1; });
    var cur = months[months.length - 1];
    var prevM = months.length > 1 ? months[months.length - 2] : null;
    var p = cur.month.split('-').map(Number);
    var dim = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
    var asOf = (cur.as_of && cur.as_of.slice(0, 7) === cur.month) ? cur.as_of : cur.month + '-' + String(dim).padStart(2, '0');
    var day = Number(asOf.slice(8, 10));
    var pace = day / dim;
    var mStart = cur.month + '-01';
    var fig = A.monthFigures(cur);
    var loadsM = (cur.loads || []).length;
    var used = usedDays(cur.loads || [], mStart, asOf);
    var idle = day - used;

    // Prior month through the same day (fair comparison).
    var prevFig = null, prevLoads = null, prevUsed = null, prevDay = null, prevAsOf = null;
    if (prevM) {
      var pp = prevM.month.split('-').map(Number);
      var pdim = new Date(Date.UTC(pp[0], pp[1], 0)).getUTCDate();
      prevDay = Math.min(day, pdim);
      prevAsOf = prevM.month + '-' + String(prevDay).padStart(2, '0');
      var ps = sub(prevM, prevM.month + '-01', prevAsOf);
      prevFig = A.monthFigures(ps); prevLoads = ps.loads.length; prevUsed = usedDays(prevM.loads || [], prevM.month + '-01', prevAsOf);
    }
    var prevLbl = prevM ? MON[Number(prevM.month.slice(5)) - 1] + ' 1-' + prevDay : '';

    // Weeks (Mon-Sun), last 6 for sparklines.
    var today = todayCT();
    var ref = today > asOf ? today : asOf;
    var wk0 = mondayOf(ref);
    var weeks = [];
    for (var i = 5; i >= 0; i--) {
      var ws = addDays(wk0, -7 * i), we = addDays(ws, 6);
      var sm = allSub(months, ws, we);
      var f = A.monthFigures(sm);
      var all = f.deadMi == null ? null : f.loadedMi + f.deadMi;
      weeks.push({ start: ws, end: we, loads: sm.loads.length, gross: f.gross, net: f.net, rpm: f.perLoaded, dead: all ? f.deadMi / all : null,
        used: usedDays(sm.loads, ws, we < ref ? we : ref), days: Math.min(7, Math.round((parse(we < ref ? we : ref) - parse(ws)) / 864e5) + 1) });
    }
    var wkNow = weeks[5], wkPrev = weeks[4];
    var wkDays = wkNow.days;
    var col = function (k) { return weeks.map(function (w) { return w[k]; }); };

    var allMi = fig.deadMi == null ? null : fig.loadedMi + fig.deadMi;
    var deadPct = allMi ? fig.deadMi / allMi : null;
    var prevAll = prevFig && prevFig.deadMi != null ? prevFig.loadedMi + prevFig.deadMi : null;
    var prevDead = prevAll ? prevFig.deadMi / prevAll : null;

    var loadsMoT = t.loadsWk * WEEKS;
    var grossT = M ? M.gross : t.loadsWk * WEEKS * t.miLoad * t.rpm;
    var netT = M ? M.loadedMo * M.contrib : null;            // plan net before fixed bills (same basis as the ledger net kept)
    var fixed = M ? M.fixed : null;
    var utilT = Math.min(1, t.daysMo / dim);
    var idleT = day * (1 - utilT);
    var netDay = used > 0 ? fig.net / used : null;
    var netDayT = M ? M.netDayGoal : null;
    var beRatio = fixed ? fig.net / fixed : null;

    // On-time drops: delivered_date on or before the rate-con delivery date.
    var withDel = (cur.loads || []).concat(prevM ? prevM.loads || [] : []).filter(function (l) { return l.delivered_date && l.delivery_date; });
    var onTime = withDel.filter(function (l) { return l.delivered_date <= l.delivery_date; }).length;

    var tiles = [];
    tiles.push(tile({ label: 'Loads this week', actual: wkNow.loads, target: t.loadsWk, paceTarget: t.loadsWk * wkDays / 7,
      value: wkNow.loads + ' <small>/ ' + num(t.loadsWk, 1) + '</small>',
      targetText: 'Target <b>' + num(t.loadsWk, 1) + '/wk</b> - pace ' + num(t.loadsWk * wkDays / 7, 1) + ' by ' + md(addDays(wkNow.start, wkDays - 1)),
      trend: trend(wkNow.loads, wkPrev.loads, 'last wk', function (x) { return num(x, 0); }), spark: spark(col('loads')) }));
    tiles.push(tile({ label: 'Loads this month', actual: loadsM, target: loadsMoT, paceTarget: loadsMoT * pace,
      value: loadsM + ' <small>/ ' + num(loadsMoT, 0) + '</small>',
      targetText: 'Pace <b>' + num(loadsMoT * pace, 1) + '</b> by ' + md(asOf) + ' - ' + Math.max(0, Math.ceil(loadsMoT - loadsM)) + ' more for the month',
      trend: trend(loadsM, prevLoads, prevLbl, function (x) { return num(x, 0); }) }));
    tiles.push(tile({ label: 'Gross MTD', actual: fig.gross, target: grossT, paceTarget: grossT * pace,
      value: money(fig.gross), targetText: 'Plan <b>' + money(grossT) + '</b> - pace ' + money(grossT * pace) + (M && M.beGross ? ' - BE ' + money(M.beGross) + ', incl. Meshach ' + money(M.beGrossDriver) : ''),
      trend: trend(fig.gross, prevFig && prevFig.gross, prevLbl, money), spark: spark(col('gross')) }));
    tiles.push(tile({ label: 'Net kept MTD', actual: fig.net, target: netT, paceTarget: netT != null ? netT * pace : null,
      value: money(fig.net), targetText: 'Plan <b>' + money(netT) + '</b> before bills - pace ' + money(netT != null ? netT * pace : null),
      trend: trend(fig.net, prevFig && prevFig.net, prevLbl, money), spark: spark(col('net')) }));
    // Meshach's living wage is paid first (Claudio 11/26): how much of it this month's net kept covers.
    var wage = t.driverMo || 0, billsMo = fixed || 0;
    var afterBills = fig.net - billsMo;                                   // profit after ALL expenses incl. notes (month's full bills)
    var wcov = Math.max(0, Math.min(afterBills, wage));
    var wprev = prevFig ? Math.max(0, Math.min(prevFig.net - billsMo, wage)) : null;
    tiles.push(tile({ label: 'Meshach pay covered', actual: wcov, target: wage, paceTarget: wage * pace,
      value: money(wcov) + ' <small>/ ' + money(wage) + '</small>',
      targetText: 'Profit after all bills ' + money(afterBills) + ' covers <b>' + pct(wage ? wcov / wage : null) + '</b> of his ' + money(wage) + '. He is paid first from profit; leftover is split in thirds (his third on top of his pay).',
      trend: trend(wcov, wprev, prevLbl, money) }));
    tiles.push(tile({ label: 'Avg $/loaded mi', actual: fig.perLoaded, target: t.rpm, barMax: Math.max(t.rpm, fig.perLoaded || 0) * 1.15,
      value: rpmT(fig.perLoaded), targetText: 'Target <b>' + rpmT(t.rpm) + '</b> - ' + num(fig.loadedMi, 0) + ' loaded mi',
      trend: trend(fig.perLoaded, prevFig && prevFig.perLoaded, prevLbl, rpmT), spark: spark(col('rpm')) }));
    tiles.push(tile({ label: 'Deadhead', actual: deadPct == null ? null : deadPct * 100, target: t.dead, lower: true, barMax: 60,
      value: deadPct == null ? '-' : pct(deadPct), targetText: 'Target <b>' + num(t.dead, 0) + '% or less</b>' + (fig.deadMi != null ? ' - ' + num(fig.deadMi, 0) + ' empty mi' : ''),
      trend: trend(deadPct == null ? null : deadPct * 100, prevDead == null ? null : prevDead * 100, prevLbl, function (x) { return num(x, 0) + ' pts'; }, true),
      spark: spark(col('dead').map(function (x) { return x == null ? null : -x; })) }));
    tiles.push(tile({ label: 'Idle days', actual: idle, target: idleT, lower: true, barMax: day,
      value: idle + ' <small>of ' + day + '</small>', targetText: 'Target <b>' + num(idleT, 0) + ' or fewer</b> by ' + md(asOf) + ' (' + num(t.daysMo, 0) + ' work days/mo)',
      trend: trend(idle, prevUsed == null ? null : prevDay - prevUsed, prevLbl, function (x) { return num(x, 0); }, true) }));
    tiles.push(tile({ label: 'Truck utilization', actual: day ? used / day : null, target: utilT, barMax: 1,
      value: pct(day ? used / day : null), targetText: 'Target <b>' + pct(utilT) + '</b> - ' + used + ' days loaded of ' + day,
      trend: trend(day ? used / day * 100 : null, prevUsed == null ? null : prevUsed / prevDay * 100, prevLbl, function (x) { return num(x, 0) + ' pts'; }),
      spark: spark(weeks.map(function (w) { return w.days ? w.used / w.days : null; })) }));
    tiles.push(tile({ label: 'Net / loaded day', actual: netDay, target: netDayT,
      value: money(netDay), targetText: 'Target <b>' + money(netDayT) + '/day</b> (bills + partner goal / ' + num(t.daysMo, 0) + ' days)',
      trend: trend(netDay, prevFig && prevUsed ? prevFig.net / prevUsed : null, prevLbl, money) }));
    tiles.push(tile({ label: 'On-time drops', actual: withDel.length ? onTime / withDel.length : null, target: 1, barMax: 1,
      cls: withDel.length ? status(onTime / withDel.length, 1) : '',
      value: withDel.length ? onTime + ' <small>of ' + withDel.length + '</small>' : 'No data',
      targetText: withDel.length ? 'Target <b>100%</b> - drop date vs rate con. Pickup times not logged yet.' : 'Delivered dates are not logged yet.',
      trend: '<span class="sb-tr">Loads with a logged delivery date</span>' }));

    // Private: Bluevine cash only from the PIN-gated /financials.
    var finTile;
    if (fin.data && fin.data.account) {
      var fn = fin.data.projection && fin.data.projection.first_negative;
      var low = fin.data.projection && fin.data.projection.low30;
      finTile = tile({ label: 'Bluevine cash', actual: fin.data.account.available, target: fixed, cls: fn ? 'r' : 'g', noBar: false, barMax: Math.max(fixed || 1, fin.data.account.available || 0),
        value: money(fin.data.account.available), targetText: 'One month of bills <b>' + money(fixed) + '</b>' + (fn ? ' - goes negative ' + md(fn.date.slice(0, 10)) : '') + (low ? ' - 30-day low ' + money(low.balance) : ''),
        trend: '<span class="sb-tr">PIN-gated, as of ' + esc(String(fin.data.as_of || '').slice(5, 10).replace('-', '/')) + '</span>' });
    } else {
      finTile = '<article class="sb-t sb-lock" id="sb-fin-lock"><div class="sb-l"><span>Bluevine cash</span><span class="sb-dot">LOCKED</span></div>' +
        '<div class="sb-v"><small>Enter PIN in Finance</small></div><p class="sb-tg">Bank figures stay behind the app PIN.</p></article>';
    }
    tiles.push(finTile);

    // Hero: break-even ring.
    var be = beRatio == null ? 0 : Math.max(0, Math.min(1, beRatio));
    var R = 48, C = 2 * Math.PI * R;
    var beCls = beRatio == null ? '' : status(beRatio, pace);
    var ringCol = beCls === 'g' ? '#34D399' : beCls === 'a' ? '#FBBF24' : '#F87171';
    var paceAng = pace * 2 * Math.PI - Math.PI / 2;
    var hero = '<section class="sb-hero"><svg viewBox="0 0 118 118" role="img" aria-label="Break-even ' + pct(beRatio) + '">' +
      '<circle cx="59" cy="59" r="' + R + '" fill="none" stroke="#2a2440" stroke-width="12"/>' +
      '<circle cx="59" cy="59" r="' + R + '" fill="none" stroke="' + ringCol + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (C * be).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 59 59)"/>' +
      '<line x1="' + (59 + 40 * Math.cos(paceAng)).toFixed(1) + '" y1="' + (59 + 40 * Math.sin(paceAng)).toFixed(1) + '" x2="' + (59 + 56 * Math.cos(paceAng)).toFixed(1) + '" y2="' + (59 + 56 * Math.sin(paceAng)).toFixed(1) + '" stroke="#f2f0f7" stroke-width="2.5"/>' +
      '<text x="59" y="58" text-anchor="middle" font-size="24" font-weight="800" fill="#f2f0f7">' + pct(beRatio) + '</text>' +
      '<text x="59" y="76" text-anchor="middle" font-size="10" fill="#b9b3cc">of bills</text></svg>' +
      '<div><h3>Break-even - ' + esc(MON[p[1] - 1]) + ' ' + day + ' of ' + dim + '</h3>' +
      '<div class="sb-big">' + (beRatio != null && beRatio >= 1 ? 'Past break-even' : money(fixed - fig.net) + ' to go') + '</div>' +
      '<p>Net kept ' + money(fig.net) + ' vs ' + money(fixed) + ' monthly bills. Pace mark ' + pct(pace) + '. ' +
      (M && M.beLoadsWk ? 'Break-even is about ' + num(M.beLoadsWk, 1) + ' loads/wk at your Targets inputs.' : '') + '</p>' +
      (M && M.beGrossDriver != null ? '<p class="sb-be2"><b>Break-even incl. Meshach ' + money(t.driverMo) + ':</b> ' + money(M.beGrossDriver) + '/mo gross, ' + num(M.beLoadsWkDriver, 1) + ' loads/wk. His pay comes first from profit after expenses; leftover is split in thirds. ' + money(Math.max(0, fixed + t.driverMo - fig.net)) + ' to go.</p>' : '') + '</div></section>';

    // Callouts: the three biggest gaps, one line each.
    var calls = [];
    var moreLoads = Math.max(0, Math.ceil(loadsMoT - loadsM));
    if (loadsM < loadsMoT * pace) calls.push('Book <b>' + moreLoads + ' more load' + (moreLoads === 1 ? '' : 's') + '</b> to hit ' + num(loadsMoT, 0) + ' this month; you are at ' + loadsM + '.');
    if (idle > idleT) calls.push('Truck sat <b>' + idle + ' of ' + day + ' days</b>; target is ' + num(idleT, 0) + '. Line up the next load before the drop.');
    if (deadPct != null && deadPct * 100 > t.dead) calls.push('Deadhead is <b>' + pct(deadPct) + '</b> vs ' + num(t.dead, 0) + '%. Search from the drop city, not home.');
    if (fig.perLoaded != null && fig.perLoaded < t.rpm) calls.push('Rate is <b>' + rpmT(fig.perLoaded) + '/mi</b> vs ' + rpmT(t.rpm) + '. Counter low offers by $0.25/mi.');
    if (beRatio != null && beRatio < 1) calls.push('<b>' + money(fixed - fig.net) + '</b> of bills still uncovered with ' + (dim - day) + ' days left.');
    if (!calls.length) calls.push('Every KPI is on pace. Keep it rolling.');

    root.innerHTML = '<div class="sb-h"><h2>Scoreboard</h2><span>' + esc(MON[p[1] - 1] + ' 1-' + day + ' - week of ' + md(wk0) + ' - targets from Targets tab') + '</span></div>' +
      hero + '<section class="sb-calls">' + calls.slice(0, 3).map(function (c) { return '<p>' + c + '</p>'; }).join('') + '</section>' +
      '<div class="sb-grid">' + tiles.join('') + '</div>' +
      '<p class="sb-fine">Net kept = gross - carrier fee - fuel - other costs (ledger), before truck, trailer and insurance bills. Pace = target x ' + day + '/' + dim + ' of the month. Trends compare to ' + esc(prevLbl || 'last period') + ' and last week. Sparklines show the last 6 weeks.</p>';
    var lock = $('sb-fin-lock');
    if (lock) lock.addEventListener('click', function () { var b = $('tab-fin'); if (b) b.click(); });
  }

  function visible() { var p = $('panel-kpis'); return p && !p.hidden; }
  var tmr = null;
  function soon() { if (tmr) clearTimeout(tmr); tmr = setTimeout(function () { if (visible()) { loadFin(); render(); } }, 60); }
  function init() {
    var p = $('panel-kpis');
    if (!p) return;
    new MutationObserver(soon).observe(p, { attributes: true, attributeFilter: ['hidden'] });
    var k = $('kpis-root');
    if (k) new MutationObserver(soon).observe(k, { childList: true }); // app.js re-rendered KPIs (new feed / month switch)
    new MutationObserver(function () { if (!$('scoreboard-root')) soon(); }).observe(p, { childList: true });
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'kpis') soon(); });
    window.addEventListener('storage', function (e) { if (e.key === TKEY) soon(); });
    var tr = $('targets-root');
    if (tr) tr.addEventListener('input', soon);
    soon();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.BlackRamScoreboard = { render: render };
})();
