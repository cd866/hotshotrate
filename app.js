(function () {
  'use strict';

  var STORAGE_KEY = 'hotshotrate_loads_v1';
  var PREFS_KEY = 'hotshotrate_prefs_v1';

  var $ = function (id) { return document.getElementById(id); };

  var ids = [
    'rate', 'dh', 'loaded', 'fuelPrice', 'mpg', 'tolls',
    'leasePct', 'factorPct', 'target', 'targetBasis',
    'monthlyMiles', 'truckNote', 'insurance', 'trailerNote', 'eldOther', 'maintPerMi', 'notes'
  ];

  function num(id) {
    var v = parseFloat($(id).value);
    return isFinite(v) ? v : 0;
  }

  function money(n) {
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function money2(n) {
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function rpm(n) {
    return '$' + n.toFixed(2) + '/mi';
  }

  function calc() {
    var rate = num('rate');
    var dh = num('dh');
    var loaded = num('loaded');
    var fuelPrice = num('fuelPrice');
    var mpg = num('mpg') || 0.0001;
    var tolls = num('tolls');
    var leasePct = num('leasePct');
    var factorPct = num('factorPct');
    var target = num('target');
    var targetBasis = $('targetBasis').value;
    var monthlyMiles = Math.max(num('monthlyMiles'), 1);
    var truckNote = num('truckNote');
    var insurance = num('insurance');
    var trailerNote = num('trailerNote');
    var eldOther = num('eldOther');
    var maintPerMi = num('maintPerMi');

    var totalMiles = dh + loaded;
    var gallons = totalMiles / mpg;
    var fuelCost = gallons * fuelPrice;
    var leaseFee = rate * (leasePct / 100);
    var factorFee = rate * (factorPct / 100);
    var totalFees = leaseFee + factorFee;
    var rateAfterFees = rate - totalFees;
    var allMilesRpm = totalMiles > 0 ? rate / totalMiles : 0;
    var afterFeeRpm = totalMiles > 0 ? rateAfterFees / totalMiles : 0;
    var contribution = rate - fuelCost - tolls - totalFees;
    var contributionRpm = totalMiles > 0 ? contribution / totalMiles : 0;

    var monthlyFixed = truckNote + insurance + trailerNote + eldOther;
    var fixedPerMi = monthlyFixed / monthlyMiles;
    var allocatedFixed = (fixedPerMi + maintPerMi) * totalMiles;
    var netAfterFixed = contribution - allocatedFixed;
    var netRpm = totalMiles > 0 ? netAfterFixed / totalMiles : 0;

    var compareRpm;
    if (targetBasis === 'beforeFee') compareRpm = allMilesRpm;
    else if (targetBasis === 'netFixed') compareRpm = netRpm;
    else compareRpm = afterFeeRpm;

    var verdict, msg, cls;
    if (compareRpm >= target) {
      verdict = 'TAKE IT';
      cls = 'take';
      msg = 'Meets your target (' + rpm(target) + ' on selected basis).';
    } else if (compareRpm >= target * 0.9) {
      verdict = 'MARGINAL';
      cls = 'marginal';
      msg = 'Within 10% of target — tight margins.';
    } else {
      verdict = 'PASS';
      cls = 'pass';
      msg = 'Below target. Deadhead, fuel, or fees eat the rate.';
    }

    return {
      rate: rate, dh: dh, loaded: loaded, fuelPrice: fuelPrice, mpg: mpg, tolls: tolls,
      leasePct: leasePct, factorPct: factorPct, target: target, targetBasis: targetBasis,
      totalMiles: totalMiles, gallons: gallons, fuelCost: fuelCost,
      leaseFee: leaseFee, factorFee: factorFee, totalFees: totalFees,
      rateAfterFees: rateAfterFees, allMilesRpm: allMilesRpm, afterFeeRpm: afterFeeRpm,
      contribution: contribution, contributionRpm: contributionRpm,
      monthlyFixed: monthlyFixed, fixedPerMi: fixedPerMi, maintPerMi: maintPerMi,
      allocatedFixed: allocatedFixed, netAfterFixed: netAfterFixed, netRpm: netRpm,
      compareRpm: compareRpm, verdict: verdict, verdictClass: cls, verdictMsg: msg,
      notes: ($('notes').value || '').trim()
    };
  }

  function render(r) {
    var v = $('verdict');
    v.className = 'verdict ' + r.verdictClass;
    v.innerHTML = '<span class="verdict-label">' + r.verdict + '</span>' +
      '<span class="verdict-msg">' + r.verdictMsg + '</span>';

    var feeParts = [];
    if (r.leasePct > 0) feeParts.push('lease ' + r.leasePct + '% = ' + money2(r.leaseFee));
    if (r.factorPct > 0) feeParts.push('factor ' + r.factorPct + '% = ' + money2(r.factorFee));
    var feeSub = feeParts.length ? feeParts.join(' · ') : 'no fees';

    var fixedSub = money2(r.monthlyFixed) + '/mo ÷ miles + ' +
      money2(r.maintPerMi) + '/mi maint → ' + money2(r.allocatedFixed) + ' this load';

    $('metrics').innerHTML =
      row('Total rate', money(r.rate)) +
      row('Total miles', r.totalMiles.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' mi',
        (r.dh + ' DH + ' + r.loaded + ' loaded')) +
      row('All-miles RPM', rpm(r.allMilesRpm), null, 'accent') +
      row('Fuel cost', money2(r.fuelCost), r.gallons.toFixed(1) + ' gal @ ' + money2(r.fuelPrice) + '/gal') +
      row('Tolls', money2(r.tolls)) +
      row('Fees (lease + factor)', money2(r.totalFees), feeSub) +
      row('Rate after fees', money2(r.rateAfterFees), rpm(r.afterFeeRpm) + ' all-miles') +
      row('True contribution', money2(r.contribution), rpm(r.contributionRpm) + ' after fuel/tolls/fees', 'good') +
      row('Allocated fixed costs', money2(r.allocatedFixed), fixedSub) +
      row('Net after fixed', money2(r.netAfterFixed), rpm(r.netRpm), r.netAfterFixed >= 0 ? 'good' : '');
  }

  function row(label, value, sub, cls) {
    return '<div class="row"><dt>' + label +
      (sub ? '<span class="sub">' + sub + '</span>' : '') +
      '</dt><dd class="' + (cls || '') + '">' + value + '</dd></div>';
  }

  function recalc() {
    render(calc());
    persistPrefs();
  }

  /* ---- prefs ---- */
  function persistPrefs() {
    try {
      var o = {};
      ids.forEach(function (id) {
        if (id === 'notes') return;
        o[id] = $(id).value;
      });
      localStorage.setItem(PREFS_KEY, JSON.stringify(o));
    } catch (e) { /* ignore */ }
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      ids.forEach(function (id) {
        if (id === 'notes') return;
        if (o[id] != null && $(id)) $(id).value = o[id];
      });
    } catch (e) { /* ignore */ }
  }

  /* ---- loads history ---- */
  function getLoads() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function setLoads(arr) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  }

  function saveLoad() {
    var r = calc();
    var entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      date: new Date().toISOString(),
      notes: r.notes || (r.dh + '+' + r.loaded + ' mi'),
      rate: r.rate,
      totalMiles: r.totalMiles,
      dh: r.dh,
      loaded: r.loaded,
      allMilesRpm: r.allMilesRpm,
      afterFeeRpm: r.afterFeeRpm,
      contribution: r.contribution,
      netAfterFixed: r.netAfterFixed,
      fuelCost: r.fuelCost,
      totalFees: r.totalFees,
      verdict: r.verdict,
      leasePct: r.leasePct,
      factorPct: r.factorPct
    };
    var loads = getLoads();
    loads.unshift(entry);
    if (loads.length > 500) loads = loads.slice(0, 500);
    setLoads(loads);
    var fb = $('save-feedback');
    fb.hidden = false;
    fb.textContent = 'Saved to this device.';
    setTimeout(function () { fb.hidden = true; }, 2200);
    renderDash();
  }

  function deleteLoad(id) {
    setLoads(getLoads().filter(function (l) { return l.id !== id; }));
    renderDash();
  }

  function clearLoads() {
    if (!getLoads().length) return;
    if (!confirm('Clear all saved loads from this device? This cannot be undone.')) return;
    setLoads([]);
    renderDash();
  }

  function exportCsv() {
    var loads = getLoads();
    if (!loads.length) {
      alert('No loads to export.');
      return;
    }
    var headers = ['date', 'notes', 'rate', 'deadhead', 'loaded', 'total_miles', 'all_miles_rpm', 'after_fee_rpm', 'contribution', 'net_after_fixed', 'fuel_cost', 'fees', 'verdict', 'lease_pct', 'factor_pct'];
    var lines = [headers.join(',')];
    loads.forEach(function (l) {
      lines.push([
        l.date,
        csvEscape(l.notes),
        l.rate,
        l.dh,
        l.loaded,
        l.totalMiles,
        (l.allMilesRpm || 0).toFixed(4),
        (l.afterFeeRpm || 0).toFixed(4),
        (l.contribution || 0).toFixed(2),
        (l.netAfterFixed || 0).toFixed(2),
        (l.fuelCost || 0).toFixed(2),
        (l.totalFees || 0).toFixed(2),
        l.verdict,
        l.leasePct,
        l.factorPct
      ].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hotshotrate-loads-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function csvEscape(s) {
    s = String(s == null ? '' : s);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function renderDash() {
    var loads = getLoads();
    var n = loads.length;
    var revenue = 0, fuel = 0, rpmSum = 0, take = 0;
    loads.forEach(function (l) {
      revenue += l.rate || 0;
      fuel += l.fuelCost || 0;
      rpmSum += l.allMilesRpm || 0;
      if (l.verdict === 'TAKE IT') take++;
    });
    var avgRpm = n ? rpmSum / n : 0;
    var winRate = n ? (take / n) * 100 : 0;

    $('stats-grid').innerHTML =
      stat('Loads', String(n)) +
      stat('Revenue', money(revenue)) +
      stat('Avg $/mi', n ? rpm(avgRpm) : '—') +
      stat('Win rate', n ? winRate.toFixed(0) + '%' : '—') +
      stat('Fuel spend', money(fuel));

    // verdict bars
    var counts = { 'TAKE IT': 0, MARGINAL: 0, PASS: 0 };
    loads.forEach(function (l) { if (counts[l.verdict] != null) counts[l.verdict]++; });
    var bars = $('verdict-bars');
    bars.innerHTML = ['TAKE IT', 'MARGINAL', 'PASS'].map(function (k) {
      var pct = n ? (counts[k] / n) * 100 : 0;
      var cls = k === 'TAKE IT' ? 'take' : (k === 'MARGINAL' ? 'marginal' : 'pass');
      return '<div class="bar-row"><span class="name">' + k + '</span>' +
        '<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
        '<span class="pct">' + (n ? pct.toFixed(0) + '%' : '—') + '</span></div>';
    }).join('');

    // table
    var tbody = $('loads-table').querySelector('tbody');
    var empty = $('loads-empty');
    if (!n) {
      tbody.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      tbody.innerHTML = loads.map(function (l) {
        var d = new Date(l.date);
        var dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
        var cls = l.verdict === 'TAKE IT' ? 'take' : (l.verdict === 'MARGINAL' ? 'marginal' : 'pass');
        return '<tr>' +
          '<td>' + dateStr + '</td>' +
          '<td class="notes" title="' + escapeAttr(l.notes) + '">' + escapeHtml(l.notes) + '</td>' +
          '<td>' + money(l.rate) + '</td>' +
          '<td>' + Math.round(l.totalMiles) + '</td>' +
          '<td>' + (l.allMilesRpm || 0).toFixed(2) + '</td>' +
          '<td>' + money2(l.contribution || 0) + '</td>' +
          '<td><span class="badge ' + cls + '">' + l.verdict + '</span></td>' +
          '<td><button type="button" class="icon-btn" data-del="' + l.id + '" title="Delete" aria-label="Delete">✕</button></td>' +
          '</tr>';
      }).join('');
    }

    drawChart(loads.slice(0, 20).reverse());
  }

  function stat(label, value) {
    return '<div class="stat"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function drawChart(loads) {
    var canvas = $('rpm-chart');
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 640;
    var cssH = 200;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    ctx.fillStyle = '#0e0e0e';
    ctx.fillRect(0, 0, cssW, cssH);

    if (!loads.length) {
      ctx.fillStyle = '#666';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Save loads to see RPM trend', cssW / 2, cssH / 2);
      return;
    }

    var pad = { t: 16, r: 12, b: 28, l: 40 };
    var w = cssW - pad.l - pad.r;
    var h = cssH - pad.t - pad.b;
    var values = loads.map(function (l) { return l.allMilesRpm || 0; });
    var maxV = Math.max.apply(null, values.concat([2]));
    var minV = 0;
    var range = maxV - minV || 1;

    // grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#666';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    for (var g = 0; g <= 4; g++) {
      var y = pad.t + (h * g) / 4;
      var val = maxV - (range * g) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      ctx.fillText(val.toFixed(1), pad.l - 6, y + 3);
    }

    // line
    ctx.strokeStyle = '#F5A623';
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach(function (v, i) {
      var x = pad.l + (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
      var y = pad.t + h - ((v - minV) / range) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // points
    values.forEach(function (v, i) {
      var x = pad.l + (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
      var y = pad.t + h - ((v - minV) / range) * h;
      var verdict = loads[i].verdict;
      ctx.fillStyle = verdict === 'TAKE IT' ? '#3dd68c' : (verdict === 'MARGINAL' ? '#e8c547' : '#ff6b6b');
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('All-miles $/mi (oldest → newest of last ' + values.length + ')', cssW / 2, cssH - 8);
  }

  /* ---- presets ---- */
  function applySandLilyPad() {
    $('rate').value = '1800';
    $('dh').value = '85';
    $('loaded').value = '520';
    $('fuelPrice').value = '3.89';
    $('mpg').value = '6.5';
    $('tolls').value = '45';
    $('leasePct').value = '5';
    $('factorPct').value = '0';
    $('target').value = '1.20';
    $('targetBasis').value = 'afterFee';
    $('monthlyMiles').value = '8000';
    $('truckNote').value = '1573';
    $('insurance').value = '0';
    $('trailerNote').value = '0';
    $('eldOther').value = '0';
    $('maintPerMi').value = '0.10';
    $('notes').value = 'Sand Lily Pad sample';
    recalc();
  }

  function resetDefaults() {
    applySandLilyPad();
    $('notes').value = '';
    $('insurance').value = '0';
    $('trailerNote').value = '0';
    $('eldOther').value = '0';
  }

  function copySummary() {
    var r = calc();
    var text = [
      'HotshotRate summary',
      'Rate: ' + money(r.rate) + ' | Miles: ' + r.totalMiles + ' (DH ' + r.dh + ' + loaded ' + r.loaded + ')',
      'All-miles RPM: ' + rpm(r.allMilesRpm),
      'After fees (' + r.leasePct + '% lease + ' + r.factorPct + '% factor): ' + money2(r.rateAfterFees) + ' (' + rpm(r.afterFeeRpm) + ')',
      'Fuel: ' + money2(r.fuelCost) + ' (' + r.gallons.toFixed(1) + ' gal) | Tolls: ' + money2(r.tolls),
      'True contribution: ' + money2(r.contribution),
      'Net after fixed: ' + money2(r.netAfterFixed) + ' (' + rpm(r.netRpm) + ')',
      'Verdict: ' + r.verdict + ' vs target ' + rpm(r.target)
    ].join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        var fb = $('save-feedback');
        fb.hidden = false;
        fb.textContent = 'Summary copied.';
        setTimeout(function () { fb.hidden = true; }, 1800);
      });
    } else {
      prompt('Copy summary:', text);
    }
  }

  /* ---- tabs ---- */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('panel-calc').classList.toggle('active', name === 'calc');
    $('panel-calc').hidden = name !== 'calc';
    $('panel-dash').classList.toggle('active', name === 'dash');
    $('panel-dash').hidden = name !== 'dash';
    if (name === 'dash') renderDash();
  }

  /* ---- init ---- */
  function init() {
    $('year').textContent = String(new Date().getFullYear());
    loadPrefs();

    ids.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', recalc);
      el.addEventListener('change', recalc);
    });

    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
    });

    $('btn-preset-slp').addEventListener('click', applySandLilyPad);
    $('btn-reset').addEventListener('click', resetDefaults);
    $('btn-save').addEventListener('click', saveLoad);
    $('btn-copy').addEventListener('click', copySummary);
    $('btn-export').addEventListener('click', exportCsv);
    $('btn-clear').addEventListener('click', clearLoads);

    $('loads-table').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-del]');
      if (btn) deleteLoad(btn.getAttribute('data-del'));
    });

    window.addEventListener('resize', function () {
      if ($('panel-dash').classList.contains('active')) {
        drawChart(getLoads().slice(0, 20).reverse());
      }
    });

    recalc();
    renderDash();
  }

  // Expose for verification
  window.HotshotRate = { calc: calc, applySandLilyPad: applySandLilyPad };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
