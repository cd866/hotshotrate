/* Black Ram Logistics - Targets tab (v44).
   Works back from a monthly take-home goal to the loads, miles and $/mi
   needed, and compares structures (Totni 13%, other lease-on, own MC).
   Uses only the public feed (loads, fixed costs) plus research numbers.
   No bank data. Inputs are saved in localStorage on this phone only. */
(function () {
  'use strict';
  var KEY = 'blackram_targets_v1';
  var WEEKS = 52 / 12; // 4.33 weeks per month
  var DEF = {
    goal: 3000, partners: 3, rpm: 2.75, dead: 25, loadsWk: 3, miLoad: 350,
    daysMo: 22, fee: 13, maint: 0.15, otherMo: 42, driverMo: 3000, structure: 'totni'
  };
  // Research numbers (see /workspace/bigtex/reports/mc-options.pdf).
  var OWN = {
    insuranceMo: 39394 / 12,   // Progressive own-authority quote via TAP, 10/26/2026 ($39,394/yr, 11-pay)
    factoringPct: 3,           // 2.5-4% typical small-carrier factoring (EST)
    complianceMo: 120,         // ELD, IRP, UCR, consortium, BOC-3 spread monthly (EST)
    startup: 1978 + 6575,      // filings/plates EST + 16.67% insurance down payment
    rampShare: 0.6             // months 1-6: about 60% of normal loads while brokers age us in (EST)
  };
  var LEASE_PCT = 25;          // typical hotshot lease-on keeps 20-30% (Landstar/AEL 30%, Adams 25%, KHB/OLO 20-25%)
  var tgt = load();

  (function injectStepCss() {
    if (document.getElementById('tg-step-css')) return;
    var st = document.createElement('style');
    st.id = 'tg-step-css';
    st.textContent =
      '.tg-sl{display:block;margin:10px 0 4px}' +
      '.tg-sl-row{display:flex;align-items:center;gap:8px}' +
      '.tg-sl-row input[type=range]{flex:1 1 auto;min-width:0;width:auto;margin:0}' +
      '.tg-step{flex:0 0 44px;width:44px;height:44px;min-width:44px;min-height:44px;border-radius:var(--radius-md,12px);border:1px solid var(--c-line,#2e2940);' +
      'background:var(--c-surface-2,#14111f);color:var(--c-gold,#F2C94C);font:800 24px/1 var(--body,system-ui);display:inline-flex;align-items:center;' +
      'justify-content:center;padding:0;touch-action:manipulation;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;cursor:pointer}' +
      '.tg-step:active{background:var(--c-gold,#F2C94C);color:var(--c-gold-ink,#0f0d17)}' +
      '.tg-be2{margin-top:12px;padding-top:10px;border-top:1px solid var(--c-line,#2e2940)}.tg-be2 .n{font-size:26px}' +
      '.tg-step:focus-visible{outline:2px solid var(--c-accent-hi,#c4b5fd);outline-offset:2px}';
    document.head.appendChild(st);
  })();

  function load() {
    var out = {};
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
    // v71: restore Truckstop $42 (INV-4492445) in otherMo; charged 11/14 to company AmEx ...8008, not paid by Totni.
    if (saved.droppedTruckstop42 && Number(saved.otherMo) === 0 && !saved.restoredTruckstop42) {
      saved.otherMo = 42;
      saved.restoredTruckstop42 = 1;
      saved.droppedTruckstop42 = 0;
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* private mode */ }
    }
    Object.keys(DEF).forEach(function (k) { out[k] = saved[k] != null ? saved[k] : DEF[k]; });
    return out;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(tgt)); } catch (e) { /* private mode */ } }
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
  function num(n, d) { return (n == null || !isFinite(n)) ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 1 : d, minimumFractionDigits: d == null ? 0 : Math.min(d, 2) }); }
  function rpm(n) { return (n == null || !isFinite(n)) ? '-' : '$' + n.toFixed(2) + '/mi'; }

  function app() { return window.BlackRamApp || null; }
  function costs() {
    var A = app();
    var s = A && A.settings ? A.settings() : { loadedCost: 1.14, deadheadCost: 0.30, trailer: 434.84, insurance: 1221.62, otherFixed: 1573.04 };
    return s;
  }
  // Fuel + DEF per mile: same model as the Load Boards (EIA diesel + pump premium / mpg + DEF),
  // on loaded and empty miles. Flat Rate Check $/mi only when no diesel price is on file.
  function fuelPm(s) {
    var A = app();
    var f = A && A.fuelModel ? A.fuelModel() : null;
    if (f && !f.fallback && isFinite(Number(f.fuel_per_mi))) return { loaded: Number(f.fuel_per_mi), dead: Number(f.fuel_per_mi), live: true, f: f };
    return { loaded: s.loadedCost, dead: s.deadheadCost, live: false, f: null };
  }

  // Core model for one structure at the current inputs.
  function model(opts) {
    var s = costs();
    var o = opts || {};
    var feePct = o.feePct != null ? o.feePct : Number(tgt.fee);
    var insurance = o.insurance != null ? o.insurance : s.insurance;
    var extraFixed = o.extraFixed || 0;
    var loadsWk = o.loadsWk != null ? o.loadsWk : Number(tgt.loadsWk);
    var rate = o.rpm != null ? o.rpm : Number(tgt.rpm);
    var dead = Math.min(0.9, Math.max(0, Number(tgt.dead) / 100));
    var deadPerLoaded = dead / (1 - dead);
    // Business break-even = covering expenses. Meshach's $3,000/mo is a target paid ONLY from
    // actual profit after all bills and expenses (Claudio 11/26 1:24 PM CT). A shortfall is not
    // a debt. Break-even incl. Meshach is the target to fully cover that $3,000, not a liability.
    var driverMo = Number(tgt.driverMo) || 0;
    var fixed = s.trailer + insurance + s.otherFixed + Number(tgt.otherMo) + extraFixed;
    var keep = 1 - feePct / 100;
    // Contribution per loaded mile after fee, fuel/DEF (loaded + empty) and maintenance reserve.
    var fp = fuelPm(s);
    var contrib = rate * keep - fp.loaded - deadPerLoaded * fp.dead - (1 + deadPerLoaded) * Number(tgt.maint);
    var loadedMo = loadsWk * WEEKS * Number(tgt.miLoad);
    var gross = loadedMo * rate;
    var net = loadedMo * contrib - fixed;
    var goalNet = Number(tgt.goal) * Number(tgt.partners);
    var beMiD = contrib > 0 ? (fixed + driverMo) / contrib : null;
    var beMi = contrib > 0 ? fixed / contrib : null;
    var goalMi = contrib > 0 ? (fixed + goalNet) / contrib : null;
    var perMileCosts = fp.loaded + deadPerLoaded * fp.dead + (1 + deadPerLoaded) * Number(tgt.maint);
    var minRpmBE = loadedMo > 0 ? (fixed / loadedMo + perMileCosts) / keep : null;
    var minRpmGoal = loadedMo > 0 ? ((fixed + goalNet) / loadedMo + perMileCosts) / keep : null;
    return {
      fixed: fixed, driverMo: driverMo, fixedDriver: fixed + driverMo, contrib: contrib,
      beMiDriver: beMiD, beGrossDriver: beMiD != null ? beMiD * rate : null,
      beLoadsWkDriver: beMiD != null ? beMiD / WEEKS / Number(tgt.miLoad) : null, netAfterDriver: net - driverMo, loadedMo: loadedMo, gross: gross, net: net,
      perPartner: net / Number(tgt.partners || 1), goalNet: goalNet,
      beMi: beMi, beGross: beMi != null ? beMi * rate : null,
      beLoadsWk: beMi != null ? beMi / WEEKS / Number(tgt.miLoad) : null,
      goalMi: goalMi, goalGross: goalMi != null ? goalMi * rate : null,
      goalLoadsWk: goalMi != null ? goalMi / WEEKS / Number(tgt.miLoad) : null,
      goalMiWk: goalMi != null ? goalMi / WEEKS : null,
      goalAllMiWk: goalMi != null ? goalMi * (1 + deadPerLoaded) / WEEKS : null,
      minRpmBE: minRpmBE, minRpmGoal: minRpmGoal,
      netDayGoal: (fixed + goalNet) / Math.max(1, Number(tgt.daysMo)),
      deadPerLoaded: deadPerLoaded, feePct: feePct, perMileCosts: perMileCosts
    };
  }

  var FIN_KEY = 'blackram_fin_session_v1';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var cocFin = { data: null, tried: false };

  function readCoc() {
    try {
      var c = sessionStorage.getItem(FIN_KEY);
      if (c) {
        var j = JSON.parse(c);
        if (j && j.accounting && j.accounting.coc) return j.accounting.coc;
      }
    } catch (e) { /* ignore */ }
    if (cocFin.data && cocFin.data.accounting && cocFin.data.accounting.coc) return cocFin.data.accounting.coc;
    return null;
  }

  function loadCoc() {
    if (readCoc()) return;
    var p = '';
    try { p = (localStorage.getItem('blackram_relay_pin_v1') || '').trim(); } catch (e) { p = ''; }
    if (!p || cocFin.tried) return;
    cocFin.tried = true;
    fetch(RELAY + '/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }), cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok && j.data && j.data.accounting) {
          cocFin.data = j.data;
          try { sessionStorage.setItem(FIN_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ }
          render();
        }
      }).catch(function () { /* offline */ });
  }

  // Plan CoC from the current sliders. Meshach is paid only from actual profit; a shortfall is not accrued.
  function cocPlan(coc) {
    if (!coc || !coc.invested) return null;
    var m = model();
    var inv = Number(coc.invested);
    var net = m.net;
    var driver = Number(tgt.driverMo) || 0;
    var pay = Math.min(driver, Math.max(net, 0));
    var after = net - pay;
    var needMo = (coc.needed && coc.needed.mo_after != null) ? Number(coc.needed.mo_after) : 0.20 * inv / 12;
    var needAnn = (coc.needed && coc.needed.ann_after != null) ? Number(coc.needed.ann_after) : 0.20 * inv;
    var needNet = driver + needMo;
    var keep = 1 - Number(tgt.fee) / 100;
    var loadsWk = m.contrib > 0 ? (m.fixed + needNet) / m.contrib / WEEKS / Number(tgt.miLoad) : null;
    var minRpm = m.loadedMo > 0 ? ((m.fixed + needNet) / m.loadedMo + m.perMileCosts) / keep : null;
    return {
      net: net, pay: pay, after: after, before: net,
      ann_before: net * 12, ann_after: after * 12,
      coc_before: net * 12 / inv, coc_after: after * 12 / inv,
      needMo: needMo, needNet: needNet, needAnn: needAnn,
      loadsWk: loadsWk, minRpm: minRpm,
      invested: inv, target: coc.target || 0.20
    };
  }

  function pctCoc(n) {
    if (n == null || !isFinite(n)) return '-';
    var p = n * 100;
    var t = (Math.abs(p) >= 10 ? p.toFixed(0) : p.toFixed(1)).replace(/\.0$/, '');
    return t + '%';
  }

  function structures() {
    var s = costs();
    var totni = model({ feePct: 13 });
    var lease = model({ feePct: LEASE_PCT });
    var own = model({ feePct: OWN.factoringPct, insurance: OWN.insuranceMo, extraFixed: OWN.complianceMo });
    var ownRamp = model({ feePct: OWN.factoringPct, insurance: OWN.insuranceMo, extraFixed: OWN.complianceMo, loadsWk: Number(tgt.loadsWk) * OWN.rampShare });
    // Own MC beats Totni once the 10-point fee saving covers the extra insurance + compliance.
    var crossGross = (OWN.insuranceMo - s.insurance + OWN.complianceMo) / ((13 - OWN.factoringPct) / 100);
    return { totni: totni, lease: lease, own: own, ownRamp: ownRamp, crossGross: crossGross };
  }

  // Actuals from the public ledger feed (latest month).
  function actuals() {
    var A = app();
    var feed = A && A.getFeed ? A.getFeed() : null;
    if (!feed || !feed.months || !feed.months.length) return null;
    var months = feed.months.slice().sort(function (a, b) { return a.month < b.month ? -1 : 1; });
    var m = months[months.length - 1];
    var asOf = (m.as_of && m.as_of.slice(0, 7) === m.month) ? m.as_of : null;
    var p = m.month.split('-');
    var dim = new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate();
    var day = asOf ? Number(asOf.slice(8, 10)) : dim;
    var fig = A.monthFigures(m);
    var used = A.utilizedDays ? A.utilizedDays(m, asOf || (m.month + '-' + String(dim).padStart(2, '0'))) : null;
    var allMi = fig.deadMi == null ? null : fig.loadedMi + fig.deadMi;
    return {
      month: m.month, asOf: asOf, day: day, dim: dim, fig: fig, mo: m,
      loads: (m.loads || []).length,
      deadPct: allMi ? fig.deadMi / allMi * 100 : null,
      idle: used != null ? day - used : null,
      used: used,
      netBeforeFixedPerDay: (fig.gross - fig.fees - fig.fuel) / Math.max(1, day)
    };
  }

  function TA(arg, label) { var T = window.BlackRamTiles; return T ? T.attrs('tg', arg, label + '. Show details') : ''; }
  function bar(label, actualTxt, targetTxt, ratio, note, tap) {
    var w = Math.max(0, Math.min(100, (isFinite(ratio) ? ratio : 0) * 100));
    var cls = ratio >= 1 ? 'tg-ok' : (ratio >= 0.6 ? 'tg-mid' : 'tg-low');
    return '<div class="tg-bar ' + cls + (tap ? ' tl-tap tl-chev tl-chev-top"' + TA(tap, label) : '"') + '><div class="tg-bar-top"><span>' + esc(label) + '</span><b>' + actualTxt +
      ' <i>/ ' + targetTxt + '</i></b></div><div class="track"><span style="width:' + w.toFixed(1) + '%"></span></div>' +
      (note ? '<div class="tg-note">' + note + '</div>' : '') + '</div>';
  }

  function slider(id, label, min, max, step, val, fmt) {
    return '<div class="tg-sl"><label class="tg-sl-top" for="tg-' + id + '"><span>' + esc(label) + '</span><b id="tgv-' + id + '">' + fmt(val) + '</b></label>' +
      '<div class="tg-sl-row"><button type="button" class="tg-step" data-step-k="' + id + '" data-dir="-1" aria-label="Decrease ' + esc(label) + '">-</button>' +
      '<input type="range" id="tg-' + id + '" data-k="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">' +
      '<button type="button" class="tg-step" data-step-k="' + id + '" data-dir="1" aria-label="Increase ' + esc(label) + '">+</button></div></div>';
  }
  var FMT = {
    goal: function (v) { return money(+v) + '/mo each'; },
    partners: function (v) { return v + ' partners'; },
    rpm: function (v) { return '$' + Number(v).toFixed(2) + '/mi'; },
    dead: function (v) { return v + '%'; },
    loadsWk: function (v) { return num(+v, 1) + '/wk'; },
    miLoad: function (v) { return v + ' mi'; },
    daysMo: function (v) { return v + ' days'; },
    fee: function (v) { return v + '%'; },
    maint: function (v) { return '$' + Number(v).toFixed(2) + '/mi'; },
    otherMo: function (v) { return money(+v) + '/mo'; },
    driverMo: function (v) { return money(+v) + '/mo'; }
  };

  function chart() {
    // Projected monthly net (after all bills) vs loads/week, per structure, with the goal line.
    var w = 360, h = 210, padL = 44, padR = 8, padT = 14, padB = 30;
    var xs = [1, 2, 3, 4, 5, 6, 7];
    var s = costs();
    var lines = [
      { name: 'Totni 13%', color: '#F2C94C', f: function (x) { return model({ feePct: 13, loadsWk: x }).net; } },
      { name: 'Lease-on ' + LEASE_PCT + '%', color: '#a78bfa', f: function (x) { return model({ feePct: LEASE_PCT, loadsWk: x }).net; } },
      { name: 'Own MC', color: '#34D399', dash: '5 4', f: function (x) { return model({ feePct: OWN.factoringPct, insurance: OWN.insuranceMo, extraFixed: OWN.complianceMo, loadsWk: x }).net; } }
    ];
    var goal = Number(tgt.goal) * Number(tgt.partners);
    var vals = [goal, 0];
    lines.forEach(function (l) { xs.forEach(function (x) { vals.push(l.f(x)); }); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var span = (hi - lo) || 1; lo -= span * 0.05; hi += span * 0.08;
    function X(x) { return padL + (x - 1) / 6 * (w - padL - padR); }
    function Y(v) { return padT + (hi - v) / (hi - lo) * (h - padT - padB); }
    var g = '';
    // y ticks
    var step = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4)));
    [1, 2, 2.5, 5, 10].some(function (m) { if ((hi - lo) / (step * m) <= 5) { step = step * m; return true; } return false; });
    for (var t = Math.ceil(lo / step) * step; t <= hi; t += step) {
      g += '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + Y(t).toFixed(1) + '" y2="' + Y(t).toFixed(1) + '" stroke="#2e2940" stroke-width="1"/>' +
        '<text x="' + (padL - 4) + '" y="' + (Y(t) + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#b9b3cc">' + (t === 0 ? '$0' : (t < 0 ? '-' : '') + '$' + Math.abs(t / 1000).toFixed(Math.abs(t) % 1000 ? 1 : 0) + 'k') + '</text>';
    }
    g += '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '" stroke="#F87171" stroke-width="1.5"/>' +
      '<text x="' + (w - padR) + '" y="' + (Y(0) - 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#FECACA">break-even</text>';
    g += '<line x1="' + padL + '" x2="' + (w - padR) + '" y1="' + Y(goal).toFixed(1) + '" y2="' + Y(goal).toFixed(1) + '" stroke="#F2C94C" stroke-dasharray="2 3" stroke-width="1.5"/>' +
      '<text x="' + (padL + 4) + '" y="' + (Y(goal) - 4).toFixed(1) + '" font-size="10" fill="#F5D76A">goal ' + money(goal) + '/mo</text>';
    xs.forEach(function (x) {
      g += '<text x="' + X(x).toFixed(1) + '" y="' + (h - padB + 14) + '" text-anchor="middle" font-size="10" fill="#b9b3cc">' + x + '</text>';
    });
    g += '<text x="' + ((padL + w - padR) / 2) + '" y="' + (h - 4) + '" text-anchor="middle" font-size="10" fill="#b9b3cc">loads per week (' + tgt.miLoad + ' loaded mi each, $' + Number(tgt.rpm).toFixed(2) + '/mi)</text>';
    lines.forEach(function (l) {
      var d = xs.map(function (x, i) { return (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(l.f(x)).toFixed(1); }).join(' ');
      g += '<path d="' + d + '" fill="none" stroke="' + l.color + '" stroke-width="2.5"' + (l.dash ? ' stroke-dasharray="' + l.dash + '"' : '') + '/>';
    });
    // current marker on Totni line
    var cur = Number(tgt.loadsWk);
    if (cur >= 1 && cur <= 7) {
      var cv = model({ loadsWk: cur }).net;
      g += '<circle cx="' + X(cur).toFixed(1) + '" cy="' + Y(cv).toFixed(1) + '" r="5" fill="#0f0d17" stroke="#F2C94C" stroke-width="2.5"/>';
    }
    var legend = '<div class="chart-legend">' + lines.map(function (l) {
      return '<span><i style="background:' + l.color + '"></i>' + esc(l.name) + '</span>';
    }).join('') + '</div>';
    return '<div class="chart"><h3>Monthly net after all bills vs loads per week</h3>' + legend +
      '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Projected monthly net by loads per week"><title>Projected monthly net by loads per week</title>' + g + '</svg></div>';
  }

  function render() {
    var root = $('targets-root');
    if (!root) return;
    loadCoc();
    var m = model();
    var st = structures();
    var act = actuals();
    var s = costs();
    var reachable = m.goalAllMiWk != null && m.goalAllMiWk <= 3000;

    var callouts = [];
    if (m.contrib <= 0) {
      callouts.push('At $' + Number(tgt.rpm).toFixed(2) + '/mi every mile loses money after the fee, fuel and wear. Raise $/mi before adding loads.');
    } else {
      callouts.push('Need <b>' + num(m.beLoadsWk, 1) + ' loads/wk</b> at <b>$' + Number(tgt.rpm).toFixed(2) + '/mi</b> just to break even (' + money(m.beGross) + '/mo gross).');
      callouts.push('Break-even <b>incl. Meshach ' + money(tgt.driverMo) + '</b>: <b>' + num(m.beLoadsWkDriver, 1) + ' loads/wk</b> (' + money(m.beGrossDriver) + '/mo gross). His pay comes first from profit after expenses; any leftover is split in thirds (Meshach\'s third is on top of his pay).');
      callouts.push('Hitting ' + money(m.goalNet) + '/mo take-home needs <b>' + num(m.goalLoadsWk, 1) + ' loads/wk</b> (' + money(m.goalGross / WEEKS) + ' gross a week).');
      callouts.push('At ' + num(+tgt.loadsWk, 1) + ' loads/wk you need at least <b>' + rpm(m.minRpmBE) + '</b> to break even and <b>' + rpm(m.minRpmGoal) + '</b> to hit the goal.');
      if (!reachable) callouts.push('That goal is about ' + num(m.goalAllMiWk, 0) + ' total mi/wk, past what one truck and driver can legally run (about 3,000). Raise $/mi or lower the goal.');
    }
    if (act && act.fig.perLoaded != null) {
      callouts.push('This month so far: ' + act.loads + ' loads at ' + rpm(act.fig.perLoaded) + ' loaded. ' + (Math.abs(act.fig.perLoaded - m.minRpmBE) < 0.05 ? 'That is right at break-even $/mi, so every load needs more.' : (act.fig.perLoaded < m.minRpmBE ? 'That is below break-even $/mi.' : 'That clears break-even $/mi.')));
    }
    var coc = readCoc();
    var plan = cocPlan(coc);
    if (plan && plan.loadsWk != null) {
      callouts.push('To hit a <b>20% cash-on-cash</b> return (after Meshach is paid from profit): <b>' + num(plan.loadsWk, 1) + ' loads/wk</b> at <b>' + rpm(+tgt.rpm) + '</b>, or <b>' + rpm(plan.minRpm) + '</b> at ' + num(+tgt.loadsWk, 1) + ' loads/wk. Plan at your inputs: <b>' + pctCoc(plan.coc_after) + '</b> after Meshach (' + pctCoc(plan.coc_before) + ' before).');
    }

    var headline = '<section class="big tg-head"><div class="tg-be1 tl-tap tl-chev tl-chev-top"' + TA('be', 'Break-even') + '><div class="kicker">Break-even (Totni ' + tgt.fee + '%)</div>' +
      '<span class="n phrase">' + (m.beGross != null ? money(m.beGross) + '/mo gross' : 'Not reachable') + '</span>' +
      '<p class="sub">' + (m.beLoadsWk != null ? num(m.beLoadsWk, 1) + ' loads/wk | ' + num(m.beMi / WEEKS, 0) + ' loaded mi/wk | bills ' + money(m.fixed) + '/mo' : 'Contribution per mile is negative') + '</p></div>' +
      (m.beGrossDriver != null ? '<div class="tg-be2 tl-tap tl-chev tl-chev-top"' + TA('bed', 'Break-even including Meshach') + '><div class="kicker">Break-even incl. Meshach ' + money(tgt.driverMo) + '</div><span class="n phrase">' + money(m.beGrossDriver) + '/mo gross</span><p class="sub">' + num(m.beLoadsWkDriver, 1) + ' loads/wk | ' + num(m.beMiDriver / WEEKS, 0) + ' loaded mi/wk | expenses + his pay ' + money(m.fixedDriver) + '/mo</p></div>' : '') +
      cocBlock(coc, plan) + '</section>';

    var outs = '<div class="stats">' +
      metricBox(money(m.goalGross) , 'Gross needed / month', money(m.goalGross / WEEKS) + ' a week') +
      metricBox(num(m.goalLoadsWk, 1), 'Loads / week needed', num(m.goalMiWk, 0) + ' loaded mi/wk') +
      metricBox(rpm(m.minRpmGoal), 'Min $/loaded mi', 'at ' + num(+tgt.loadsWk, 1) + ' loads/wk for the goal') +
      metricBox(money(m.netDayGoal), 'Net / work day needed', 'before bills, ' + tgt.daysMo + ' days/mo') +
      metricBox(money(m.net), 'Projected net / month', 'at your inputs, after all bills') +
      metricBox(money(m.perPartner), 'Per partner / month', 'goal ' + money(+tgt.goal)) +
      '</div>';

    var acts = '';
    if (act) {
      var frac = act.day / act.dim;
      var tGross = m.goalGross * frac;
      var tLoads = m.goalLoadsWk * WEEKS * frac;
      var beG = (m.beGross || 0) * frac;
      acts = '<h2 class="sec">This month vs goal | ' + esc(monLabel(act.month)) + ' 1-' + act.day + '</h2><div class="tg-bars">' +
        bar('Gross MTD', money(act.fig.gross), money(tGross), act.fig.gross / (tGross || 1), 'Break-even pace ' + money(beG) + ' by today', act.loads ? 'act:gross' : null) +
        bar('Loads MTD', String(act.loads), num(tLoads, 1), act.loads / (tLoads || 1), null, act.loads ? 'act:loads' : null) +
        bar('$ / loaded mile', rpm(act.fig.perLoaded), rpm(m.minRpmGoal), (act.fig.perLoaded || 0) / (m.minRpmGoal || 1), null, act.loads ? 'act:rpm' : null) +
        (act.deadPct != null ? bar('Deadhead %', num(act.deadPct, 0) + '%', '&lt;= ' + tgt.dead + '%', act.deadPct > 0 ? Math.min(1, Number(tgt.dead) / act.deadPct) : 1, 'Lower is better', 'act:dead') : '') +
        (act.idle != null ? bar('Days with a load', String(act.used), num(Number(tgt.daysMo) * frac, 0), act.used / ((Number(tgt.daysMo) * frac) || 1), act.idle + ' idle days so far', 'act:util') : '') +
        bar('Net before bills / day', money(act.netBeforeFixedPerDay), money((m.fixed + m.goalNet) / 30.4), act.netBeforeFixedPerDay / (((m.fixed + m.goalNet) / 30.4) || 1), 'Gross less ' + tgt.fee + '% fee and fuel, per calendar day', act.loads ? 'act:net' : null) +
        '</div>';
    }

    var inputs = '<details class="tg-inputs"><summary>Change targets and assumptions</summary>' +
      slider('goal', 'Take-home goal per partner', 0, 6000, 250, tgt.goal, FMT.goal) +
      slider('partners', 'Partners', 1, 4, 1, tgt.partners, FMT.partners) +
      slider('rpm', 'Loaded rate', 1.5, 5, 0.05, tgt.rpm, FMT.rpm) +
      slider('dead', 'Deadhead (of all miles)', 0, 50, 1, tgt.dead, FMT.dead) +
      slider('loadsWk', 'Loads per week', 0.5, 8, 0.5, tgt.loadsWk, FMT.loadsWk) +
      slider('miLoad', 'Loaded miles per load', 100, 1200, 25, tgt.miLoad, FMT.miLoad) +
      slider('daysMo', 'Work days per month', 10, 28, 1, tgt.daysMo, FMT.daysMo) +
      slider('fee', 'Carrier fee', 0, 35, 1, tgt.fee, FMT.fee) +
      slider('maint', 'Tires and maintenance reserve', 0, 0.4, 0.01, tgt.maint, FMT.maint) +
      slider('driverMo', 'Driver pay (Meshach, only from profit after bills)', 0, 6000, 100, tgt.driverMo, FMT.driverMo) +
      slider('otherMo', 'Other monthly (Truckstop $42 + phone, software)', 0, 500, 1, tgt.otherMo, FMT.otherMo) +
      '<p class="fine">Fuel and DEF: ' + (function () { var fp = fuelPm(s); var A = app(); return fp.live && A && A.fuelUsedText ? esc(A.fuelUsedText(fp.f)) : 'no diesel price on file, fallback ' + rpm(s.loadedCost) + ' loaded, ' + rpm(s.deadheadCost) + ' empty.'; })() + ' Bills: truck ' + money(s.otherFixed) + ', trailer ' + money(s.trailer) + ', insurance ' + money(s.insurance) +
        (Number(tgt.otherMo) ? ', other ' + money(tgt.otherMo) : '') +
        ' = ' + money(s.trailer + s.insurance + s.otherFixed + Number(tgt.otherMo)) +
        '/mo. The Truckstop $42 is billed to Totni and taken from load pay, so it stays in Totni fees, not in these bills. Meshach ' + money(tgt.driverMo) + '/mo is paid first from profit after these bills; leftover is split in thirds (his third on top of his pay). Saved on this phone. <button type="button" class="tg-reset" id="tg-reset">Reset</button></p></details>';

    var cmpRows = [
      ['Stay on Totni (13%)', st.totni, 'Cheap fee, but brokers score Totni low (see below).'],
      ['Lease-on, strong carrier (' + LEASE_PCT + '% EST)', st.lease, 'Typical hotshot split 20-30%. Their authority, often their freight.'],
      ['Own MC, after month 6', st.own, 'No carrier fee; ' + OWN.factoringPct + '% factoring; insurance ' + money(OWN.insuranceMo) + '/mo (real quote).'],
      ['Own MC, months 1-6', st.ownRamp, 'EST ' + Math.round(OWN.rampShare * 100) + '% of loads while many brokers block new MCs.']
    ];
    var best = cmpRows.slice(0, 3).reduce(function (a, b) { return b[1].net > a[1].net ? b : a; });
    var cmp = '<h2 class="sec">Structure comparison at your inputs</h2><section class="tg-cmp">' +
      cmpRows.map(function (r) {
        var bestCls = r === best ? ' tg-best' : '';
        return '<div class="tg-cmp-row' + bestCls + '"><div><b>' + esc(r[0]) + '</b><span>' + esc(r[2]) + '</span></div>' +
          '<div class="tg-cmp-n"><b>' + money(r[1].net) + '</b><span>net/mo | BE ' + (r[1].beGross != null ? money(r[1].beGross) : '-') + '</span></div></div>';
      }).join('') +
      '<p class="tg-call">Own MC only beats Totni once gross is over about <b>' + money(st.crossGross) + '/mo</b>, because own-authority insurance runs about ' + money(OWN.insuranceMo - s.insurance) + '/mo more than today. Startup cash about ' + money(OWN.startup) + ' (EST).</p>' +
      '<p class="fine">Sources: Progressive own-authority quote via TAP 10/26/2026 ($39,394/yr); Landstar hotshot BCO 70% and Bennett/American Eagle hotshot 70% (keep), Adams Freight 75%, Kings of Hotshots and OnTime Logistics 75-80%; factoring 2.5-4%. Lease-on insurance kept the same as today (EST). Totni ELD fee ($50 seen once) not included. Full write-up: MC options PDF.</p></section>';

    if (!$('tg-top') || !$('tg-in') || !$('tg-out')) {
      root.innerHTML =
        '<p class="fine">Targets work back from your take-home goal. Estimates are marked EST. Public ledger only, no bank data.</p>' +
        '<div id="tg-top"></div><div id="tg-in"></div><div id="tg-out"></div>';
      $('tg-in').innerHTML = inputs;
      bind(root);
    }
    $('tg-top').innerHTML = headline +
      '<section class="tg-callouts">' + callouts.map(function (c) { return '<p>' + c + '</p>'; }).join('') + '</section>';
    $('tg-out').innerHTML = outs + chart() + acts + cmp;
  }

  function monLabel(ym) {
    var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var p = String(ym).split('-');
    return (M[Number(p[1]) - 1] || ym);
  }

  function cocBlock(coc, plan) {
    if (!plan) {
      return '<div class="tg-be2 tg-coc tg-coc-lock" id="tg-coc-lock"><div class="kicker">20% cash-on-cash</div>' +
        '<p class="sub">Unlock with the app PIN (Finance, Accounting or Daily PDFs) to see the loads/wk and $/mi that hit a 20% cash-on-cash return.</p></div>';
    }
    var need = (plan.loadsWk != null)
      ? 'Need <b>' + num(plan.loadsWk, 1) + ' loads/wk</b> at ' + rpm(+tgt.rpm) + ', or <b>' + rpm(plan.minRpm) + '</b> at ' + num(+tgt.loadsWk, 1) + ' loads/wk, after Meshach is paid from profit.'
      : 'Contribution per mile is negative, so a 20% return is not reachable at this $/mi.';
    return '<div class="tg-be2 tg-coc tl-tap tl-chev tl-chev-top"' + TA('coc', '20% cash-on-cash. Opens Accounting') + '><div class="kicker">20% cash-on-cash</div>' +
      '<span class="n phrase">' + pctCoc(plan.coc_after) + ' plan after Meshach</span>' +
      '<p class="sub">' + need + ' Cash in ' + money(plan.invested) + '. Target ' + money(plan.needAnn) + '/yr (' + money(plan.needMo) + '/mo leftover). Before Meshach: ' + pctCoc(plan.coc_before) + '.</p></div>';
  }

  function metricBox(value, label, sub) {
    return '<div class="metric tl-tap tl-chev tl-chev-top"' + TA('inputs', label + ' ' + String(value).replace(/<[^>]+>/g, '') + '. Change the targets behind it') + '><div class="n">' + value + '</div><div class="l">' + esc(label) + '</div>' +
      (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  var raf = null;
  function bind(root) {
    root.querySelectorAll('input[type=range][data-k]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var k = inp.getAttribute('data-k');
        tgt[k] = Number(inp.value);
        var lab = $('tgv-' + k);
        if (lab) lab.textContent = FMT[k](tgt[k]);
        save();
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(render);
      });
    });
    // v52: minus/plus steppers. One step per tap, clamped; press-and-hold repeats.
    // Fires the slider's own input + change events so projections, localStorage and Scoreboard update.
    root.querySelectorAll('button.tg-step[data-step-k]').forEach(function (btn) {
      var inp = $('tg-' + btn.getAttribute('data-step-k'));
      if (!inp) return;
      var dir = Number(btn.getAttribute('data-dir'));
      var holdT = null, repT = null, usedPointer = false;
      function stepOnce() {
        var min = Number(inp.min), max = Number(inp.max), st = Number(inp.step) || 1;
        var dec = (String(inp.step).split('.')[1] || '').length;
        var n = Math.round((Number(inp.value) - min) / st) + dir;
        var v = Math.min(max, Math.max(min, min + n * st));
        v = Number(v.toFixed(dec));
        if (v === Number(inp.value)) { stop(); return; }
        inp.value = String(v);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
      function stop() {
        if (holdT) clearTimeout(holdT);
        if (repT) clearInterval(repT);
        holdT = repT = null;
      }
      btn.addEventListener('pointerdown', function (ev) {
        if (ev.button != null && ev.button !== 0) return;
        ev.preventDefault();
        usedPointer = true;
        stop();
        stepOnce();
        holdT = setTimeout(function () { repT = setInterval(stepOnce, 90); }, 420);
      });
      ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (t) { btn.addEventListener(t, stop); });
      btn.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
      btn.addEventListener('click', function (ev) {
        // Keyboard (Enter/Space) activation; pointer taps already stepped on pointerdown.
        if (usedPointer) { usedPointer = false; return; }
        stepOnce();
      });
    });
    var reset = $('tg-reset');
    if (reset) reset.addEventListener('click', function () {
      tgt = JSON.parse(JSON.stringify(DEF));
      save();
      var r = $('targets-root');
      if (r) r.innerHTML = '';
      render();
    });
  }

  function billsList() {
    var s = costs();
    return [{ label: 'Truck note (Chase)', amount: s.otherFixed }, { label: 'Trailer note (Synchrony)', amount: s.trailer }, { label: 'Insurance (Progressive)', amount: s.insurance }]
      .concat(Number(tgt.otherMo) ? [{ label: 'Other monthly', amount: Number(tgt.otherMo) }] : []);
  }
  function drill(arg) {
    var T = window.BlackRamTiles, A = app(); if (!T) return;
    var m = model(), s = costs(), fp = fuelPm(s), keep = 1 - m.feePct / 100;
    if (arg === 'inputs') {
      T.jump('tg-in', null, function () { var d = document.querySelector('#tg-in details.tg-inputs'); if (d) d.open = true; });
      return;
    }
    if (arg === 'coc') { T.jump('ac-coc', 'acct'); return; }
    if (arg === 'be' || arg === 'bed') {
      var withD = arg === 'bed', fixed = withD ? m.fixedDriver : m.fixed, beMi = withD ? m.beMiDriver : m.beMi;
      var B = billsList(), BD = window.BlackRamBills;
      if (BD) { B = BD.decorate(B); if (!BD.has()) BD.ensure(function (d) { if (d && document.querySelector('.tl-p[aria-label="' + (withD ? 'Break-even incl. Meshach' : 'Break-even') + '"]')) drill(arg); }); }
      if (withD) B.push({ label: 'Meshach (from profit only)', amount: m.driverMo });
      T.open({ title: withD ? 'Break-even incl. Meshach' : 'Break-even', sub: 'At your Targets inputs', body:
        T.hero(beMi != null ? money(beMi * Number(tgt.rpm)) + '/mo' : 'Not reachable', beMi != null ? num(beMi / WEEKS / Number(tgt.miLoad), 1) + ' loads/wk | ' + num(beMi / WEEKS, 0) + ' loaded mi/wk' : 'Contribution per mile is negative') +
        T.sec('Monthly bills to cover') + T.rows(B.map(function (b) { return { t: esc(b.label), s: b.dueHtml || '', v: money(b.amount), vc: 'neg' }; }).concat([{ t: 'Total', v: money(fixed), cls: 'tl-tot' }])) +
        T.sec('What each loaded mile keeps') + T.rows([
          { t: 'Rate', v: rpm(Number(tgt.rpm)) },
          { t: 'Less Totni ' + m.feePct + '%', v: '-' + rpm(Number(tgt.rpm) * (1 - keep)), vc: 'neg' },
          { t: 'Less fuel + DEF', s: fp.live ? 'Load Boards diesel model' : 'Rate Check flat rate', v: '-' + rpm(fp.loaded + m.deadPerLoaded * fp.dead), vc: 'neg' },
          { t: 'Less tires + maintenance reserve', v: '-' + rpm((1 + m.deadPerLoaded) * Number(tgt.maint)), vc: 'neg' },
          { t: 'Keeps per loaded mile', v: rpm(m.contrib), cls: 'tl-tot', vc: m.contrib < 0 ? 'neg' : 'pos' }
        ]) + T.fine('Break-even miles = bills / keeps per mile. Deadhead ' + tgt.dead + '% of all miles is in the fuel and reserve lines.') +
        '<div>' + T.btn('Change the inputs', 'tg', 'inputs') + '</div>' });
      return;
    }
    if (/^act:/.test(arg)) {
      var act = actuals(); if (!act || !A || !A.openLoadsSheet) return;
      var k = arg.slice(4), mode = { gross: 'gross', loads: 'loads', rpm: 'rpm', dead: 'dead', util: 'util', net: 'net' }[k];
      var to = act.asOf || (act.month + '-' + String(act.dim).padStart(2, '0'));
      A.openLoadsSheet({ title: { gross: 'Gross MTD', loads: 'Loads MTD', rpm: '$ / loaded mile', dead: 'Deadhead', util: 'Days with a load', net: 'Net before bills' }[k], sub: monLabel(act.month) + ' 1-' + act.day,
        entries: (act.mo.loads || []).map(function (l) { return { load: l, pct: act.mo.fee_pct }; }), expenses: act.mo.expenses || [], mode: mode, from: act.month + '-01', to: to });
    }
  }
  if (window.BlackRamTiles) window.BlackRamTiles.on('tg', drill);
  window.BlackRamTargets = { render: render, model: model, structures: structures, cocPlan: cocPlan, bills: billsList };
  document.addEventListener('blackram:financials', function () { render(); });
  window.addEventListener('storage', function (e) { if (e.key === FIN_KEY || e.key === 'blackram_relay_pin_v1') { cocFin.tried = false; render(); } });
})();
