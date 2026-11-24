(function () {
  'use strict';

  var SETTINGS_KEY = 'blackram_settings_v3';
  var SETTINGS_KEY_V1 = 'blackram_settings_v1';
  var SETTINGS_KEY_V2 = 'blackram_settings_v2';
  var FEED_CACHE_KEY = 'blackram_feed_cache_v1';
  var SEARCH_CACHE_KEY = 'blackram_search_cache_v1';
  var PERIOD_KEY = 'blackram_period_v1';
  var SPLASH_KEY = 'blackram_splash_seen';
  var ALL_TIME = 'all';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var state = {
    tab: 'check',
    tarp: false,
    feed: null,
    searches: null,
    searchFilter: 'all',
    searchOffline: false,
    searchSavedAt: null,
    searchError: '',
    searchRefreshing: false,
    searchInflight: null,
    viewMonth: null,
    offline: false,
    savedAt: null,
    error: '',
    inflight: null
  };

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function fieldText(id) {
    var el = $(id);
    return el ? el.value.trim() : '';
  }

  function fieldNum(id) {
    var text = fieldText(id);
    if (text === '') return null;
    var n = parseFloat(text);
    return isFinite(n) ? n : null;
  }

  function cents(n) {
    return Math.round((isFinite(n) ? n : 0) * 100);
  }

  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    var neg = n < -0.004;
    var abs = Math.abs(n);
    var showCents = Math.round(abs * 100) % 100 !== 0;
    var body = abs.toLocaleString('en-US', {
      minimumFractionDigits: showCents ? 2 : 0,
      maximumFractionDigits: 2
    });
    return (neg ? '-$' : '$') + body;
  }

  function rpm(n) {
    if (n == null || !isFinite(n)) return '—';
    return '$' + n.toFixed(2) + '/mi';
  }

  function plainNum(n, digits) {
    if (n == null || !isFinite(n)) return '—';
    return n.toLocaleString('en-US', { maximumFractionDigits: digits == null ? 2 : digits });
  }

  function settings() {
    function n(id, fallback) {
      var v = fieldNum(id);
      return v == null ? fallback : v;
    }
    var mph = n('assumedMph', 50);
    var loadedCost = n('loadedCost', 1.64);
    var deadheadCost = n('deadheadCost', 0.30);
    var minNet = n('minNet', 500);
    var minNetSameDay = n('minNetSameDay', 300);
    var sameDayMiles = n('sameDayMiles', 250);
    var chainMin = n('chainMin', 1000);
    var capacity = n('capacity', 16000);
    var deckFt = n('deckFt', 40);
    return {
      feePct: n('feePct', 13),
      loadedCost: loadedCost != null && loadedCost >= 0 ? loadedCost : 1.64,
      deadheadCost: deadheadCost != null && deadheadCost >= 0 ? deadheadCost : 0.30,
      minNet: minNet != null ? minNet : 500,
      minNetSameDay: minNetSameDay != null ? minNetSameDay : 300,
      sameDayMiles: sameDayMiles > 0 ? sameDayMiles : 250,
      chainMin: chainMin != null ? chainMin : 1000,
      trailer: n('trailer', 434.84),
      insurance: n('insurance', 1221.62),
      otherFixed: n('otherFixed', 1573.04),
      mpg: n('mpg', 9),
      diesel: n('diesel', 6.04),
      capacity: capacity != null ? capacity : 16000,
      deckFt: deckFt != null ? deckFt : 40,
      assumedMph: mph > 0 ? mph : 50
    };
  }

  function saveSettings() {
    var ids = ['feePct', 'loadedCost', 'deadheadCost', 'minNet', 'minNetSameDay', 'sameDayMiles', 'chainMin', 'trailer', 'insurance', 'otherFixed', 'mpg', 'diesel', 'capacity', 'deckFt', 'assumedMph'];
    var data = {};
    ids.forEach(function (id) { data[id] = $(id).value; });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (err) { /* private mode */ }
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      var fromOld = false;
      if (!raw) {
        raw = localStorage.getItem(SETTINGS_KEY_V2) || localStorage.getItem(SETTINGS_KEY_V1);
        fromOld = !!raw;
      }
      if (!raw) return;
      var data = JSON.parse(raw);
      // Older phones stored $/mi floors (2.82 / 3.00) and a 15,000 lb deck.
      // Keep fee and monthly costs; use the new net-EST defaults for the rest.
      var resetOld = {
        floor: 1, takeAt: 1, loadedCost: 1, deadheadCost: 1,
        minNet: 1, minNetSameDay: 1, sameDayMiles: 1, chainMin: 1,
        capacity: 1, deckFt: 1
      };
      Object.keys(data).forEach(function (id) {
        if (fromOld && resetOld[id]) return;
        if ($(id) && data[id] != null && data[id] !== '') $(id).value = data[id];
      });
      if (fromOld) saveSettings();
    } catch (err) { /* ignore bad storage */ }
  }

  function roundMoney(n) {
    return Math.round(n * 100) / 100;
  }

  function compute() {
    var s = settings();
    var rateIn = fieldNum('rate');
    var loadedIn = fieldNum('loaded');
    var deadIn = fieldNum('deadhead');
    var weight = fieldNum('weight');
    var lengthFt = fieldNum('lengthFt');
    var hoursIn = fieldNum('hours');
    var loadedMi = loadedIn == null ? 0 : Math.max(0, loadedIn);
    var deadMi = deadIn == null ? 0 : Math.max(0, deadIn);
    var totalMi = loadedMi + deadMi;
    var rate = rateIn == null ? 0 : Math.max(0, rateIn);
    var ready = rateIn != null && (loadedMi > 0 || deadMi > 0);
    var fee = roundMoney(rate * s.feePct / 100);
    var afterFee = roundMoney(rate - fee);
    var loadedCostAmt = roundMoney(s.loadedCost * loadedMi);
    var deadCostAmt = roundMoney(s.deadheadCost * deadMi);
    var netEst = roundMoney(afterFee - loadedCostAmt - deadCostAmt);
    var mpg = s.mpg;
    var fuelKnown = mpg > 0;
    var gallons = fuelKnown ? totalMi / mpg : null;
    var fuel = fuelKnown ? roundMoney(gallons * s.diesel) : null;
    var hoursEst = !(hoursIn != null && hoursIn > 0);
    var hours = hoursEst ? (s.assumedMph > 0 ? totalMi / s.assumedMph : null) : hoursIn;
    var netHour = hours ? netEst / hours : null;
    var allRpm = totalMi > 0 ? rate / totalMi : null;
    var loadedRpm = loadedMi > 0 ? rate / loadedMi : null;
    var sameDay = totalMi > 0 && totalMi < s.sameDayMiles;
    var bar = sameDay ? s.minNetSameDay : s.minNet;
    var overWeight = weight != null && weight >= s.capacity;
    var overLength = lengthFt != null && lengthFt > s.deckFt;
    var hardFail = (weight != null && weight >= 18000) || (lengthFt != null && lengthFt > 48);
    var flags = [];
    if (weight != null && weight >= 18000) flags.push('over payload, will not fit');
    else if (overWeight) flags.push('at or over payload (~' + plainNum(s.capacity, 0) + ' lb)');
    if (lengthFt != null && lengthFt > 48) flags.push('over ' + plainNum(s.deckFt, 0) + ' ft deck, will not fit');
    else if (overLength) flags.push('over ' + plainNum(s.deckFt, 0) + ' ft deck');
    var verdict = 'idle';
    if (ready && loadedMi > 0) {
      if (hardFail || netEst < bar) verdict = 'pass';
      else if (flags.length) verdict = 'maybe';
      else verdict = 'take';
    } else if (ready && loadedMi <= 0) {
      verdict = 'pass';
    }
    return {
      ready: ready,
      rate: rate,
      loadedMi: loadedMi,
      deadMi: deadMi,
      totalMi: totalMi,
      weight: weight,
      lengthFt: lengthFt,
      fee: fee,
      afterFee: afterFee,
      loadedCostAmt: loadedCostAmt,
      deadCostAmt: deadCostAmt,
      gallons: gallons,
      fuel: fuel,
      fuelKnown: fuelKnown,
      net: netEst,
      netEst: netEst,
      hours: hours,
      hoursEst: hoursEst,
      netHour: netHour,
      allRpm: allRpm,
      loadedRpm: loadedRpm,
      sameDay: sameDay,
      bar: bar,
      verdict: verdict,
      over: overWeight || overLength,
      hardFail: hardFail,
      flags: flags,
      settings: s,
      pickup: fieldText('pickup'),
      delivery: fieldText('delivery')
    };
  }

  function verdictCopy(result) {
    var s = result.settings;
    if (!result.ready) {
      return {
        label: 'READY',
        msg: 'Enter the rate plus loaded miles, deadhead, or both.',
        meta: 'Net EST = rate x 0.87 minus $' + s.loadedCost.toFixed(2) + ' per loaded mile minus $' + s.deadheadCost.toFixed(2) + ' per deadhead mile. Bar $' + plainNum(s.minNet, 0) + ' net EST, or $' + plainNum(s.minNetSameDay, 0) + ' for a same-day run under ' + plainNum(s.sameDayMiles, 0) + ' total miles.'
      };
    }
    var msg;
    var netText = money(result.netEst);
    if (result.loadedMi <= 0) {
      msg = 'Enter loaded miles to score this offer.';
    } else if (result.verdict === 'pass' && result.hardFail) {
      msg = 'Net EST ' + netText + ', but this freight will not fit the deck.';
    } else if (result.verdict === 'pass') {
      msg = 'Net EST ' + netText + ' is under the $' + plainNum(result.bar, 0) + ' bar' + (result.sameDay ? ' for a same-day run.' : '.');
    } else if (result.verdict === 'maybe') {
      msg = 'Net EST ' + netText + ' clears the $' + plainNum(result.bar, 0) + ' bar, but check fit before you book.';
    } else {
      msg = 'Net EST ' + netText + ' clears the $' + plainNum(result.bar, 0) + ' bar and fits the deck.';
    }
    var bits = [];
    if (result.pickup || result.delivery) {
      bits.push((result.pickup || 'Pickup') + ' -> ' + (result.delivery || 'Delivery'));
    }
    if (result.flags && result.flags.length) bits.push(result.flags.join('. ') + '.');
    if (state.tarp) bits.push('Tarp required.');
    return {
      label: result.verdict === 'take' ? 'TAKE' : (result.verdict === 'maybe' ? 'MAYBE' : (result.verdict === 'idle' ? 'READY' : 'PASS')),
      msg: msg,
      meta: bits.join(' ')
    };
  }

  function metric(value, label, sub, small) {
    return '<div class="metric"><div class="n' + (small ? ' n-small' : '') + '">' + value +
      '</div><div class="l">' + label + '</div>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }

  function renderCheck() {
    var result = compute();
    var copy = verdictCopy(result);
    var box = $('verdict');
    box.className = 'verdict ' + (result.verdict === 'idle' ? 'idle' : result.verdict);
    $('verdict-label').textContent = copy.label;
    $('verdict-msg').textContent = copy.msg;
    $('verdict-meta').textContent = copy.meta;

    var warn = $('weight-warn');
    if (result.over || result.hardFail) {
      warn.hidden = false;
      warn.textContent = (result.flags && result.flags.length)
        ? result.flags.join('. ') + '. Confirm before you haul it.'
        : 'This may not fit the 40 ft deck or the about ' + plainNum(result.settings.capacity, 0) + ' lb payload.';
    } else {
      warn.hidden = true;
      warn.textContent = '';
    }

    var s = result.settings;
    var fuelValue = result.fuelKnown ? money(result.ready ? result.fuel : null) : '—';
    var fuelSub = result.fuelKnown && result.ready
      ? '<span class="est">EST</span> ' + result.gallons.toFixed(1) + ' gal at $' + s.diesel.toFixed(2) + '/gal'
      : '<span class="est">EST</span> MPG ' + plainNum(s.mpg, 1) + ' · diesel $' + s.diesel.toFixed(2);
    var hourSub = !result.ready || result.netHour == null
      ? 'Optional hours, or estimated from miles'
      : (result.hoursEst
        ? '<span class="est">EST</span> ' + result.hours.toFixed(1) + ' h at ' + plainNum(s.assumedMph, 0) + ' mph'
        : plainNum(result.hours, 1) + ' h entered');

    var mathSub = result.ready
      ? ('Rate x 0.87 = ' + money(result.afterFee) + '. Loaded $' + s.loadedCost.toFixed(2) + ' x ' + plainNum(result.loadedMi, 0) + ' = ' + money(result.loadedCostAmt) + '. DH $' + s.deadheadCost.toFixed(2) + ' x ' + plainNum(result.deadMi, 0) + ' = ' + money(result.deadCostAmt) + '.')
      : 'rate x 0.87 - $' + s.loadedCost.toFixed(2) + '/loaded mi - $' + s.deadheadCost.toFixed(2) + '/deadhead mi';

    $('metrics').innerHTML =
      metric(result.ready ? money(result.netEst) : '—', 'Net EST', mathSub) +
      metric(result.ready ? money(result.fee) : '—', 'Totni fee', plainNum(s.feePct, 2).replace(/\.00$/, '') + '% of the rate') +
      metric(result.ready && result.loadedMi > 0 ? rpm(result.loadedRpm) : '—', 'Posted / loaded mi', result.loadedMi > 0 ? plainNum(result.loadedMi, 0) + ' loaded mi' : 'No loaded miles yet') +
      metric(result.ready && result.totalMi > 0 ? rpm(result.allRpm) : '—', 'Posted / all-mi', result.totalMi > 0 ? plainNum(result.totalMi, 0) + ' total mi' : 'No miles yet') +
      metric(fuelValue, 'Fuel (MPG check)', fuelSub) +
      metric(result.ready && result.netHour != null ? money(result.netHour) : '—', 'Net EST per hour', hourSub);

    var insFlag = $('ins-flag');
    insFlag.hidden = s.insurance > 0;
    var brief = plainNum(s.feePct, 2).replace(/\.00$/, '') + '% / net bar $' + plainNum(s.minNet, 0);
    if (s.insurance <= 0) brief += ' / insurance not set';
    $('settings-brief').textContent = brief;

    if (state.tab === 'kpis' && state.feed) renderKpis();
  }

  function setTarp(on) {
    state.tarp = !!on;
    $('tarp-yes').setAttribute('aria-pressed', state.tarp ? 'true' : 'false');
    $('tarp-no').setAttribute('aria-pressed', state.tarp ? 'false' : 'true');
    renderCheck();
  }

  function clearOffer() {
    ['rate', 'loaded', 'deadhead', 'weight', 'lengthFt', 'pickup', 'delivery', 'hours'].forEach(function (id) {
      $(id).value = '';
    });
    setTarp(false);
  }

  /* ---- dates ---- */
  function parseISO(iso) {
    var p = String(iso || '').split('-');
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  }

  function isoDate(d) {
    return d.getUTCFullYear() + '-' + (d.getUTCMonth() < 9 ? '0' : '') + (d.getUTCMonth() + 1) +
      '-' + (d.getUTCDate() < 10 ? '0' : '') + d.getUTCDate();
  }

  function addDays(iso, n) {
    var d = parseISO(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return isoDate(d);
  }

  function formatDay(iso) {
    var d = parseISO(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    return MON[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }

  function monthTitle(ym) {
    var p = String(ym || '').split('-');
    var name = MONTHS[Number(p[1]) - 1] || ym;
    return name + ' ' + p[0];
  }

  function shortMonth(ym) {
    var p = String(ym || '').split('-');
    return (MON[Number(p[1]) - 1] || ym) + ' ' + String(p[0]).slice(2);
  }

  function monthEnd(ym) {
    var p = String(ym).split('-');
    return isoDate(new Date(Date.UTC(Number(p[0]), Number(p[1]), 0)));
  }

  function daysInclusive(a, b) {
    var ms = parseISO(b) - parseISO(a);
    if (!isFinite(ms) || ms < 0) return 0;
    return Math.round(ms / 86400000) + 1;
  }

  function eachDate(start, end, fn) {
    var cur = start;
    var guard = 0;
    while (cur <= end && guard < 400) {
      fn(cur);
      cur = addDays(cur, 1);
      guard += 1;
    }
  }

  function formatStamp(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '');
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function weekStart(iso) {
    var d = parseISO(iso);
    var day = d.getUTCDay();
    var delta = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - delta);
    return isoDate(d);
  }

  function weeksCovering(start, end) {
    var weeks = [];
    var cursor = weekStart(start);
    var last = weekStart(end);
    var guard = 0;
    while (cursor <= last && guard < 60) {
      var wEnd = addDays(cursor, 6);
      weeks.push({
        start: cursor < start ? start : cursor,
        end: wEnd > end ? end : wEnd
      });
      cursor = addDays(cursor, 7);
      guard += 1;
    }
    return weeks;
  }

  function rangeLabel(a, b) {
    if (a === b) return formatDay(a);
    var da = parseISO(a);
    var db = parseISO(b);
    if (da.getUTCMonth() === db.getUTCMonth()) {
      return MON[da.getUTCMonth()] + ' ' + da.getUTCDate() + '–' + db.getUTCDate();
    }
    return formatDay(a) + '–' + formatDay(b);
  }

  /* ---- feed math ---- */
  function sortedMonths(feed) {
    return ((feed && feed.months) || []).slice().sort(function (a, b) {
      return a.month < b.month ? -1 : 1;
    });
  }

  function latestMonth(feed) {
    var months = sortedMonths(feed);
    return months.length ? months[months.length - 1] : null;
  }

  function chipLabel(ym) {
    var p = String(ym || '').split('-');
    return (MON[Number(p[1]) - 1] || ym) + ' ' + p[0];
  }

  function loadView() {
    try {
      var saved = localStorage.getItem(PERIOD_KEY);
      if (saved) state.viewMonth = saved;
    } catch (err) { /* private mode */ }
  }

  function saveView() {
    try {
      if (state.viewMonth) localStorage.setItem(PERIOD_KEY, state.viewMonth);
    } catch (err) { /* private mode */ }
  }

  function activeMonth(feed) {
    var months = sortedMonths(feed);
    if (!months.length) return null;
    if (state.viewMonth && state.viewMonth !== ALL_TIME) {
      for (var i = 0; i < months.length; i++) {
        if (months[i].month === state.viewMonth) return months[i];
      }
    }
    return months[months.length - 1];
  }

  function viewingAll(feed) {
    return state.viewMonth === ALL_TIME && sortedMonths(feed).length > 0;
  }

  function monthSwitcher(feed) {
    var months = sortedMonths(feed);
    if (!months.length) return '';
    var current = viewingAll(feed) ? ALL_TIME : activeMonth(feed).month;
    var buttons = months.map(function (month) {
      var on = month.month === current;
      return '<button type="button" class="month-btn" data-month="' + esc(month.month) +
        '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(chipLabel(month.month)) + '</button>';
    }).join('');
    buttons += '<button type="button" class="month-btn" data-month="' + ALL_TIME +
      '" aria-pressed="' + (current === ALL_TIME ? 'true' : 'false') + '">All time</button>';
    return '<div class="chips month-switch" role="group" aria-label="Period">' + buttons + '</div>';
  }

  function bindMonthSwitch(root) {
    if (!root) return;
    root.querySelectorAll('.month-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.viewMonth = btn.getAttribute('data-month');
        saveView();
        if (state.tab === 'reports') renderReports();
        else if (state.tab === 'kpis') renderKpis();
      });
    });
  }

  function byDateDesc(a, b) {
    var da = a.date || '';
    var db = b.date || '';
    if (da === db) return 0;
    return da < db ? 1 : -1;
  }

  function paySummary(loads) {
    var receivedC = 0;
    var owedC = 0;
    var owedEst = false;
    var counts = { paid: 0, paid_short: 0, unpaid: 0, in_transit: 0 };
    loads.forEach(function (load) {
      if (counts[load.pay_status] != null) counts[load.pay_status] += 1;
      var hasDue = load.net_due != null && load.net_due !== '' && isFinite(Number(load.net_due));
      var hasGot = load.net_received != null && load.net_received !== '' && isFinite(Number(load.net_received));
      if (!hasDue) return;
      var due = Number(load.net_due);
      var got = hasGot ? Number(load.net_received) : 0;
      receivedC += cents(got);
      if (due - got > 0.004) {
        owedC += cents(due - got);
        if (load.net_due_est) owedEst = true;
      }
    });
    var bits = [];
    if (counts.unpaid) bits.push(counts.unpaid + ' unpaid');
    if (counts.paid_short) bits.push(counts.paid_short + ' paid short');
    if (counts.in_transit) bits.push(counts.in_transit + ' in transit');
    if (counts.paid) bits.push(counts.paid + ' paid');
    return {
      received: receivedC / 100,
      owed: owedC / 100,
      owedEst: owedEst,
      detail: bits.join(' | ') || 'No pay status on these loads'
    };
  }

  function allTimeFigures(months) {
    var grossC = 0;
    var feeC = 0;
    var fuelC = 0;
    var otherC = 0;
    var loaded = 0;
    var dead = 0;
    var deadKnown = true;
    var sawLoads = false;
    var byCatC = {};
    var pcts = {};
    var entries = [];
    var expenses = [];
    var cancelled = [];
    var notes = [];
    months.forEach(function (month) {
      var fig = monthFigures(month);
      grossC += cents(fig.gross);
      feeC += cents(fig.fees);
      fuelC += cents(fig.fuel);
      otherC += cents(fig.other);
      loaded += fig.loadedMi;
      pcts[String(fig.feePct)] = true;
      if ((month.loads || []).length) {
        sawLoads = true;
        if (fig.deadMi == null) deadKnown = false;
        else dead += fig.deadMi;
      }
      (month.loads || []).forEach(function (load) {
        entries.push({ load: load, pct: fig.feePct });
      });
      (month.expenses || []).forEach(function (row) {
        expenses.push(row);
        var cat = row.category || 'other';
        var amount = isFinite(Number(row.amount)) ? Number(row.amount) : 0;
        byCatC[cat] = (byCatC[cat] || 0) + cents(amount);
      });
      (month.cancelled || []).forEach(function (row) { cancelled.push(row); });
      (month.day_notes || []).forEach(function (row) { notes.push(row); });
    });
    if (!sawLoads) deadKnown = false;
    entries.sort(function (a, b) { return byDateDesc(a.load, b.load); });
    expenses.sort(byDateDesc);
    cancelled.sort(byDateDesc);
    notes.sort(byDateDesc);
    var byCat = {};
    Object.keys(byCatC).forEach(function (cat) { byCat[cat] = byCatC[cat] / 100; });
    var gross = grossC / 100;
    var loads = entries.map(function (entry) { return entry.load; });
    var pctKeys = Object.keys(pcts);
    var start = months[0].month + '-01';
    var last = months[months.length - 1];
    var end = last.as_of && String(last.as_of).slice(0, 7) === last.month ? last.as_of : monthEnd(last.month);
    return {
      gross: gross,
      fees: feeC / 100,
      fuel: fuelC / 100,
      other: otherC / 100,
      net: (grossC - feeC - fuelC - otherC) / 100,
      loadedMi: loaded,
      deadMi: deadKnown ? dead : null,
      perLoaded: loaded > 0 ? gross / loaded : null,
      feePct: pctKeys.length === 1 ? Number(pctKeys[0]) : null,
      byCat: byCat,
      entries: entries,
      expenses: expenses,
      cancelled: cancelled,
      notes: notes,
      pay: paySummary(loads),
      start: start,
      end: end,
      months: months.length
    };
  }

  function monthFigures(month) {
    var loads = month.loads || [];
    var expenses = month.expenses || [];
    var pct = isFinite(Number(month.fee_pct)) ? Number(month.fee_pct) : 13;
    var grossC = 0;
    var feeC = 0;
    var loaded = 0;
    var dead = 0;
    var deadKnown = loads.length > 0;
    loads.forEach(function (load) {
      var gross = isFinite(Number(load.gross)) ? Number(load.gross) : 0;
      grossC += cents(gross);
      feeC += cents(roundMoney(gross * pct / 100));
      loaded += isFinite(Number(load.loaded_mi)) ? Number(load.loaded_mi) : 0;
      if (typeof load.deadhead_mi === 'number' && isFinite(load.deadhead_mi)) dead += load.deadhead_mi;
      else deadKnown = false;
    });
    var fuelC = 0;
    var otherC = 0;
    var byCat = {};
    expenses.forEach(function (row) {
      var amount = isFinite(Number(row.amount)) ? Number(row.amount) : 0;
      var cat = row.category || 'other';
      byCat[cat] = (byCat[cat] || 0) + amount;
      if (cat === 'fuel') fuelC += cents(amount);
      else otherC += cents(amount);
    });
    var gross = grossC / 100;
    var fees = feeC / 100;
    var fuel = fuelC / 100;
    var other = otherC / 100;
    var net = (grossC - feeC - fuelC - otherC) / 100;
    return {
      gross: gross,
      fees: fees,
      fuel: fuel,
      other: other,
      net: net,
      loadedMi: loaded,
      deadMi: deadKnown ? dead : null,
      perLoaded: loaded > 0 ? gross / loaded : null,
      feePct: pct,
      byCat: byCat,
      loads: loads
    };
  }

  function loadFee(load, pct) {
    var gross = isFinite(Number(load.gross)) ? Number(load.gross) : 0;
    return roundMoney(gross * pct / 100);
  }

  function recallFeed() {
    try {
      var raw = localStorage.getItem(FEED_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function rememberFeed(feed) {
    var savedAt = new Date().toISOString();
    try {
      localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ savedAt: savedAt, feed: feed }));
    } catch (err) { /* ignore */ }
    return savedAt;
  }

  function applyFeed(feed, meta) {
    state.feed = feed;
    state.offline = !!meta.offline;
    state.savedAt = meta.savedAt || null;
    state.error = '';
    if (state.tab === 'reports') renderReports();
    if (state.tab === 'kpis') renderKpis();
    if (window.BlackRamStops && BlackRamStops.onFeed) BlackRamStops.onFeed(feed);
  }

  function refreshFeed() {
    if (state.inflight) return state.inflight;
    var status = $('feed-status-text');
    if (status) status.textContent = 'Updating…';
    state.inflight = fetch('data/feed.json', { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('Feed responded ' + res.status);
      var fromCache = res.headers.get('X-Feed-Cache') === '1';
      return res.json().then(function (feed) {
        return { feed: feed, fromCache: fromCache };
      });
    }).then(function (pack) {
      if (!pack.feed || !pack.feed.months) throw new Error('Feed has no months');
      if (pack.fromCache) {
        var prev = recallFeed();
        applyFeed(pack.feed, { offline: true, savedAt: prev && prev.savedAt });
      } else {
        applyFeed(pack.feed, { offline: false, savedAt: rememberFeed(pack.feed) });
      }
    }).catch(function () {
      var cached = recallFeed();
      if (cached && cached.feed) {
        applyFeed(cached.feed, { offline: true, savedAt: cached.savedAt });
        return;
      }
      state.error = 'Couldn’t load the month. Check the connection and pull to refresh.';
      state.feed = null;
      if (state.tab === 'reports') renderReports();
      if (state.tab === 'kpis') renderKpis();
    }).then(function () {
      state.inflight = null;
    });
    return state.inflight;
  }

  function statusLine(feed) {
    var when = feed && feed.generated_at ? formatStamp(feed.generated_at) : (state.savedAt ? formatStamp(state.savedAt) : '');
    var text = when ? 'Last updated ' + when : 'Last updated —';
    if (state.offline) text += ' / offline copy';
    return text;
  }

  function catName(cat) {
    var known = {
      fuel: 'Fuel',
      def: 'DEF',
      equipment: 'Equipment',
      scale: 'Scale',
      insurance: 'Insurance',
      maintenance: 'Maintenance',
      'safety equipment': 'Safety',
      parking: 'Parking',
      meals: 'Meals',
      'legal/LLC admin': 'Legal'
    };
    return known[cat] || cat;
  }

  function payBadge(load) {
    var labels = {
      paid: 'Paid',
      paid_short: 'Paid short',
      unpaid: 'Unpaid',
      in_transit: 'In transit'
    };
    var key = load && load.pay_status;
    if (!labels[key]) return '';
    return ' <span class="pay pay-' + key + '">' + labels[key] + '</span>';
  }

  function payLine(load) {
    var bits = [];
    if (load.net_due != null && load.net_due !== '' && isFinite(Number(load.net_due))) {
      var due = 'Due ' + money(Number(load.net_due));
      if (load.net_due_est) due = '<span class="est">EST</span> ' + due;
      bits.push(due);
    }
    if (load.net_received != null && load.net_received !== '' && isFinite(Number(load.net_received))) {
      bits.push('Received ' + money(Number(load.net_received)));
    }
    if (load.pay_note) bits.push(esc(load.pay_note));
    if (!bits.length) return '';
    return '<p class="notes">' + bits.join(' | ') + '</p>';
  }

  function fixedCostNote(feed) {
    var block = feed && feed.fixed_costs;
    if (!block || !isFinite(Number(block.monthly_total))) return '';
    return '<p class="fine">Fixed costs on file ' + money(Number(block.monthly_total)) +
      '/mo. Break-even uses the trailer, insurance, and truck note on Load check.</p>';
  }

  function loadCard(load, pct) {
    var gross = isFinite(Number(load.gross)) ? Number(load.gross) : 0;
    var fee = loadFee(load, pct);
    var miles = isFinite(Number(load.loaded_mi)) ? Number(load.loaded_mi) : null;
    var when = formatDay(load.date);
    if (load.delivery_date && load.delivery_date !== load.date) {
      var end = formatDay(load.delivery_date);
      when = formatDay(load.date).split(' ')[0] === end.split(' ')[0]
        ? formatDay(load.date) + '–' + end.split(' ')[1]
        : formatDay(load.date) + ' – ' + end;
    }
    var mileCell = miles == null ? '—' : plainNum(miles, 2) + (load.miles_estimate ? ' <span class="est">EST</span>' : '');
    var rateCell = miles ? rpm(load.rate_per_mi != null && isFinite(Number(load.rate_per_mi)) ? Number(load.rate_per_mi) : gross / miles) : '—';
    if (miles && load.miles_estimate) rateCell += ' <span class="est">EST</span>';
    var who = [load.broker, load.load_no].filter(Boolean).join(' | ');
    return '<article class="load"><h3>' + esc(load.desc || 'Load') + payBadge(load) + '</h3>' +
      '<p class="lane">' + esc(when) + (load.lane ? ' · ' + esc(load.lane) : '') + '</p>' +
      '<div class="kv">' +
      '<div><span>Gross</span><b>' + money(gross) + '</b></div>' +
      '<div><span>Miles</span><b>' + mileCell + '</b></div>' +
      '<div><span>$/mi</span><b>' + rateCell + '</b></div>' +
      '<div><span>Net</span><b>' + money(roundMoney(gross - fee)) + '</b></div>' +
      '</div>' + payLine(load) +
      '<p class="notes">Fee ' + money(fee) +
      (who ? ' · ' + esc(who) : '') +
      (typeof load.weight_lb === 'number' ? ' · ' + plainNum(load.weight_lb, 0) + ' lb' : '') +
      (load.notes ? '<br>' + esc(load.notes) : '') + '</p></article>';
  }

  function expenseRows(rows) {
    return (rows || []).map(function (row) {
      return '<div class="exp"><div>' + esc(row.vendor || 'Expense') +
        '<span>' + esc(formatDay(row.date)) + ' · ' + esc(catName(row.category || 'other')) +
        (row.deadhead_for ? ' · cancelled-load deadhead' : '') +
        (typeof row.gallons === 'number' ? ' · ' + plainNum(row.gallons, 2) + ' gal' : '') +
        '</span></div><b>' + money(row.amount) + (row.est ? ' <span class="est">EST</span>' : '') + '</b></div>';
    }).join('');
  }

  function renderReports() {
    var root = $('reports-root');
    var feed = state.feed;
    var months = feed ? sortedMonths(feed) : [];
    var head = '<div id="pull" class="pull">Pull to refresh</div>' +
      '<div class="status"><p id="feed-status-text">' + esc(feed ? statusLine(feed) : (state.error || 'Loading the month…')) +
      '</p><button type="button" class="btn" id="refresh-btn">Refresh</button></div>';
    if (!months.length) {
      root.innerHTML = head + (state.error ? '<p class="offline">' + esc(state.error) + '</p>' : '');
      bindRefresh();
      return;
    }
    if (state.offline) head += '<p class="offline">Showing the saved copy. Pull down or tap refresh when you have service.</p>';
    head += monthSwitcher(feed);
    var all = viewingAll(feed);
    var month = all ? null : activeMonth(feed);
    var fig = all ? allTimeFigures(months) : monthFigures(month);
    var entries = all ? fig.entries : (month.loads || []).map(function (load) {
      return { load: load, pct: fig.feePct };
    });
    var cancelledRows = all ? fig.cancelled : (month.cancelled || []);
    var noteRows = all ? fig.notes : (month.day_notes || []);
    var expenseList = all ? fig.expenses : (month.expenses || []);
    var asOf = all ? fig.end : (month.as_of || monthEnd(month.month));
    var kicker = all ? 'All time gross' : (monthTitle(month.month) + ' gross, month to date');
    var span = all
      ? (formatDay(fig.start) + ' – ' + formatDay(fig.end))
      : ('Through ' + formatDay(asOf));
    var cats = Object.keys(fig.byCat).filter(function (cat) { return cat !== 'fuel'; });
    cats.sort(function (a, b) { return fig.byCat[b] - fig.byCat[a]; });
    var breakout = cats.map(function (cat) {
      return esc(catName(cat)) + ' ' + money(fig.byCat[cat]);
    }).join(' | ');
    var loads = entries.map(function (entry) { return loadCard(entry.load, entry.pct); }).join('');
    var loadCount = entries.length;
    var cancelled = cancelledRows.map(function (row) {
      return '<article class="note cancel"><time>' + esc(formatDay(row.date)) + '</time>' +
        '<h3>' + esc(row.status || 'Cancelled') + '</h3>' +
        '<p>' + esc([row.broker, row.load_no].filter(Boolean).join(' | ')) +
        (row.tonu ? ' ' + esc(row.tonu) : '') +
        (row.deadhead_fuel ? ' Deadhead fuel ' + money(row.deadhead_fuel) + ' is already in the fuel total.' : '') +
        (row.notes ? ' ' + esc(row.notes) : '') + '</p></article>';
    }).join('');
    var notes = noteRows.map(function (row) {
      return '<article class="note"><time>' + esc(formatDay(row.date)) + '</time><p>' + esc(row.text) + '</p></article>';
    }).join('');
    var pay = all ? fig.pay : null;
    var owedValue = pay ? ((pay.owedEst ? '<span class="est">EST</span> ' : '') + money(pay.owed)) : '';
    var feeSub = fig.feePct == null ? 'Rates differ by month' : (plainNum(fig.feePct, 2).replace(/\.00$/, '') + '% of gross');

    root.innerHTML = head +
      '<section class="big"><div class="kicker">' + esc(kicker) + '</div>' +
      '<span class="n">' + money(fig.gross) + '</span>' +
      '<p class="sub">' + esc(span) + ' · ' + loadCount +
      (loadCount === 1 ? ' load' : ' loads') + ' · net ' + money(fig.net) + '</p></section>' +
      '<div class="stats">' +
      metric(money(fig.fees), 'Totni fees', feeSub) +
      metric(money(fig.fuel), 'Fuel', 'DEF and other costs are separate') +
      metric(money(fig.other), 'Other expenses', breakout || 'None logged') +
      metric(money(fig.net), 'Net kept', 'Gross − fee − fuel − other') +
      metric(fig.perLoaded == null ? '—' : rpm(fig.perLoaded), '$ / loaded mile', plainNum(fig.loadedMi, 2) + ' loaded mi') +
      metric(String(loadCount), 'Loads hauled', all ? 'Newest load first' : 'Cancelled loads are listed below') +
      (pay ? metric(money(pay.received), 'Collected', 'Settlements received') : '') +
      (pay ? metric(owedValue, 'Still owed', pay.detail) : '') +
      '</div>' +
      '<p class="fine">Load net below is after the Totni fee only. Fuel is totaled ' +
      (all ? 'across every month' : 'for the month') + ', not split onto each load.</p>' +
      '<h2 class="sec">Loads</h2>' +
      (loads || '<p class="fine">No loads' + (all ? '.' : ' this month.') + '</p>') +
      '<h2 class="sec">Cancelled</h2>' +
      (cancelled || '<p class="fine">No cancelled loads.</p>') +
      '<h2 class="sec">Day notes</h2>' +
      (notes || '<p class="fine">No day notes.</p>') +
      '<details class="expenses"><summary>Expense lines</summary>' + expenseRows(expenseList) + '</details>';
    bindRefresh();
    bindMonthSwitch(root);
  }

  function bindRefresh() {
    var btn = $('refresh-btn');
    if (btn) btn.addEventListener('click', function () { refreshFeed(); });
  }

  function need(title, text) {
    return '<section class="need"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p></section>';
  }

  function barChart(rows, label) {
    var w = 360;
    var h = 176;
    var padT = 22;
    var padB = 36;
    var gap = 12;
    var max = 0;
    rows.forEach(function (row) { if (row.value > max) max = row.value; });
    if (max <= 0) max = 1;
    var innerW = w - 8;
    var barW = (innerW - gap * (rows.length - 1)) / rows.length;
    var innerH = h - padT - padB;
    var parts = rows.map(function (row, i) {
      var bh = Math.max(0, (row.value / max) * innerH);
      var x = 4 + i * (barW + gap);
      var y = padT + innerH - bh;
      var fill = i === rows.length - 1 ? '#F2C94C' : '#D4A62A';
      var labelY = bh > 16 ? y + 14 : Math.max(12, y - 4);
      var labelFill = bh > 16 ? '#0E0E10' : '#F5F1E6';
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) +
        '" height="' + Math.max(bh, 0).toFixed(1) + '" rx="4" fill="' + fill + '"></rect>' +
        '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + labelY.toFixed(1) +
        '" text-anchor="middle" fill="' + labelFill + '" font-size="11" font-family="Oswald, Arial Narrow, sans-serif">' +
        esc(row.text) + '</text>' +
        '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (h - 14) +
        '" text-anchor="middle" fill="#E7E1D4" font-size="11" font-family="Oswald, Arial Narrow, sans-serif">' +
        esc(row.label) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' +
      '<title>' + esc(label) + '</title>' + parts + '</svg>';
  }

  function utilizedDays(month, asOf) {
    var start = month.month + '-01';
    var used = {};
    (month.loads || []).forEach(function (load) {
      if (!load.date) return;
      var end = load.delivery_date || load.date;
      if (end < load.date) end = load.date;
      eachDate(load.date, end, function (day) {
        if (day >= start && day <= asOf) used[day] = true;
      });
    });
    return Object.keys(used).length;
  }

  function weekRows(month) {
    var start = month.month + '-01';
    var end = month.as_of || monthEnd(month.month);
    if (end < start) end = start;
    if (end.slice(0, 7) !== month.month) end = monthEnd(month.month);
    var weeks = weeksCovering(start, end);
    var pct = isFinite(Number(month.fee_pct)) ? Number(month.fee_pct) : 13;
    return weeks.map(function (week) {
      var gross = 0;
      var miles = 0;
      var count = 0;
      (month.loads || []).forEach(function (load) {
        if (!load.date || load.date < week.start || load.date > week.end) return;
        gross += isFinite(Number(load.gross)) ? Number(load.gross) : 0;
        miles += isFinite(Number(load.loaded_mi)) ? Number(load.loaded_mi) : 0;
        count += 1;
      });
      return {
        label: rangeLabel(week.start, week.end),
        start: week.start,
        end: week.end,
        gross: gross,
        miles: miles,
        count: count,
        rpm: miles > 0 ? gross / miles : null,
        text: money(gross),
        value: gross,
        feePct: pct
      };
    });
  }

  function weeksForLoads(loads, start, end) {
    var weeks = weeksCovering(start, end);
    return weeks.map(function (week) {
      var gross = 0;
      var miles = 0;
      var count = 0;
      loads.forEach(function (load) {
        if (!load.date || load.date < week.start || load.date > week.end) return;
        gross += isFinite(Number(load.gross)) ? Number(load.gross) : 0;
        miles += isFinite(Number(load.loaded_mi)) ? Number(load.loaded_mi) : 0;
        count += 1;
      });
      return {
        label: rangeLabel(week.start, week.end),
        start: week.start,
        end: week.end,
        gross: gross,
        miles: miles,
        count: count,
        rpm: miles > 0 ? gross / miles : null,
        text: money(gross),
        value: gross
      };
    });
  }

  function renderKpis() {
    var root = $('kpis-root');
    var feed = state.feed;
    var months = feed ? sortedMonths(feed) : [];
    if (!months.length) {
      root.innerHTML = '<p class="fine">' + esc(state.error || 'Loading KPIs…') + '</p>';
      return;
    }
    var all = viewingAll(feed);
    var month = all ? null : activeMonth(feed);
    var fig = all ? allTimeFigures(months) : monthFigures(month);
    var s = settings();
    var asOf = all ? fig.end : (month.as_of && month.as_of.slice(0, 7) === month.month ? month.as_of : monthEnd(month.month));
    var periodStart = all ? fig.start : (month.month + '-01');
    var days = daysInclusive(periodStart, asOf);
    var usedLoads = all ? fig.entries.map(function (entry) { return entry.load; }) : (month.loads || []);
    var used = all ? (function () {
      var seen = {};
      usedLoads.forEach(function (load) {
        if (!load.date) return;
        var end = load.delivery_date || load.date;
        if (end < load.date) end = load.date;
        eachDate(load.date, end, function (day) {
          if (day >= periodStart && day <= asOf) seen[day] = true;
        });
      });
      return Object.keys(seen).length;
    })() : utilizedDays(month, asOf);
    var monthlyFixed = roundMoney(s.trailer + s.insurance + s.otherFixed);
    var fixed = all ? roundMoney(monthlyFixed * months.length) : monthlyFixed;
    var loadCount = all ? fig.entries.length : fig.loads.length;
    var weeks = days > 0 ? days / 7 : 0;
    var loadsPerWeek = weeks > 0 ? loadCount / weeks : null;
    var margin = fig.gross > 0 ? fig.net / fig.gross : null;
    var fuelPer = fig.loadedMi > 0 ? fig.fuel / fig.loadedMi : null;
    var allMiles = fig.deadMi == null ? null : fig.loadedMi + fig.deadMi;
    var deadPct = allMiles ? fig.deadMi / allMiles : null;
    var perAll = allMiles ? fig.gross / allMiles : null;

    var be;
    if (monthlyFixed <= 0) {
      be = need('Break-even', 'Set the trailer payment or insurance on Load check. Fixed costs are $0, so there is no monthly target yet.');
    } else {
      var ratio = fixed > 0 ? fig.net / fixed : 0;
      var width = Math.max(0, Math.min(100, ratio * 100));
      var headline = ratio >= 1 ? 'Past break-even' : money(roundMoney(fixed - fig.net)) + ' still to cover';
      var ins = s.insurance <= 0
        ? '<p class="fine">Insurance is $0 <span class="flag">Set this</span>. This target is the trailer payment until insurance is entered, so break-even is understated.</p>'
        : '';
      var fixedCopy = all
        ? (money(fig.net) + ' net vs ' + money(fixed) + ' fixed across ' + months.length +
          (months.length === 1 ? ' month' : ' months') + ' (' + money(monthlyFixed) + '/mo, ' +
          Math.round(ratio * 100) + '%).')
        : (money(fig.net) + ' net vs ' + money(fixed) + ' fixed (' +
          Math.round(ratio * 100) + '%). Trailer ' + money(s.trailer) + ' + insurance ' + money(s.insurance) +
          ' + other ' + money(s.otherFixed) + '.');
      be = '<section class="big"><div class="kicker">Break-even · ' +
        esc(all ? 'All time' : monthTitle(month.month)) + '</div>' +
        '<span class="n phrase">' + esc(headline) + '</span>' +
        '<p class="sub">' + fixedCopy + '</p>' +
        '<div class="track" role="meter" aria-label="Progress toward break-even" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
        Math.round(width) + '"><span style="width:' + width.toFixed(1) + '%"></span></div>' + ins + '</section>';
    }

    var cards =
      metric(fig.perLoaded == null ? '—' : rpm(fig.perLoaded), 'Revenue / loaded mile', plainNum(fig.loadedMi, 2) + ' loaded mi') +
      (perAll == null
        ? metric('Not enough data', 'Revenue / all-miles', 'Deadhead miles are not on the feed yet.', true)
        : metric(rpm(perAll), 'Revenue / all-miles', plainNum(allMiles, 1) + ' all-miles')) +
      (deadPct == null
        ? metric('Not enough data', 'Deadhead %', 'No deadhead miles recorded on these loads.', true)
        : metric((deadPct * 100).toFixed(1) + '%', 'Deadhead', plainNum(fig.deadMi, 1) + ' empty mi')) +
      metric(loadsPerWeek == null ? '—' : loadsPerWeek.toFixed(1), 'Loads per week', loadCount + ' loads / ' + days + ' days') +
      metric(days ? Math.round(used / days * 100) + '%' : '—', 'Truck utilization', used + ' days with a load of ' + days) +
      metric(margin == null ? '—' : (margin * 100).toFixed(1) + '%', 'Net margin', money(fig.net) + ' of ' + money(fig.gross)) +
      metric(fuelPer == null ? '—' : rpm(fuelPer), 'Fuel per loaded mile', fig.deadMi == null ? 'All-miles fuel rate needs deadhead' : 'Loaded miles only in this label') +
      metric(money(fig.fees), 'Totni fees paid', (fig.feePct == null ? 'Mixed rates' : plainNum(fig.feePct, 2).replace(/\.00$/, '') + '%') + ' · through ' + formatDay(asOf)) +
      (all && fig.pay ? metric(money(fig.pay.received), 'Collected', 'Settlements received') : '') +
      (all && fig.pay ? metric((fig.pay.owedEst ? '<span class="est">EST</span> ' : '') + money(fig.pay.owed), 'Still owed', fig.pay.detail) : '');

    var weeksData = all ? weeksForLoads(usedLoads, periodStart, asOf) : weekRows(month);
    var wow = '';
    if (weeksData.length < 2) {
      wow = '<h2 class="sec">Week over week</h2>' + need('Not enough data', 'This month does not cover two weeks yet.');
    } else {
      var last = weeksData[weeksData.length - 1];
      var prev = weeksData[weeksData.length - 2];
      var delta = last.gross - prev.gross;
      var withLoads = weeksData.filter(function (row) { return row.count > 0; });
      var grossChart = '<div class="chart"><h3>Gross by week</h3>' +
        barChart(weeksData, 'Weekly gross') +
        '<p>' + esc(last.label) + ' ' + money(last.gross) + ' · prior week ' + esc(prev.label) + ' ' +
        money(prev.gross) + ' · change ' + (delta >= 0 ? '+' : '-') + money(Math.abs(delta)) + '.</p></div>';
      var rateBlock;
      if (withLoads.length < 2) {
        rateBlock = need('Not enough data', 'Only one week has loads, so revenue per mile can’t be compared week over week yet.');
      } else {
        var rateRows = weeksData.filter(function (row) { return row.rpm != null; }).map(function (row) {
          return { label: row.label, value: row.rpm, text: '$' + row.rpm.toFixed(2) };
        });
        rateBlock = '<div class="chart"><h3>$ per loaded mile by week</h3>' +
          barChart(rateRows, 'Weekly revenue per loaded mile') + '</div>';
      }
      wow = '<h2 class="sec">Week over week</h2>' + grossChart + rateBlock;
    }

    var months = sortedMonths(feed);
    var mom;
    if (months.length < 2) {
      mom = '<h2 class="sec">Month over month</h2>' +
        need('Not enough data', 'Only one month is in the feed. The next monthly update adds this comparison.');
    } else {
      var rows = months.map(function (item) {
        var f = monthFigures(item);
        return { label: shortMonth(item.month), value: f.gross, text: money(f.gross), net: f.net };
      });
      var a = rows[rows.length - 2];
      var b = rows[rows.length - 1];
      var netDelta = b.net - a.net;
      mom = '<h2 class="sec">Month over month</h2><div class="chart"><h3>Gross by month</h3>' +
        barChart(rows, 'Monthly gross') +
        '<p>' + esc(b.label) + ' net ' + money(b.net) + ' vs ' + esc(a.label) + ' net ' + money(a.net) +
        ' (' + (netDelta >= 0 ? '+' : '-') + money(Math.abs(netDelta)) + ').</p></div>';
    }

    var periodLabel = all
      ? ('All time · ' + formatDay(fig.start) + ' – ' + formatDay(fig.end))
      : (monthTitle(month.month) + ' through ' + formatDay(asOf));
    root.innerHTML =
      '<p class="fine" id="kpi-stamp">' + esc(statusLine(feed)) + ' · ' + esc(periodLabel) + '</p>' +
      monthSwitcher(feed) +
      be + fixedCostNote(feed) + '<div class="stats">' + cards + '</div>' + wow + mom;
    bindMonthSwitch(root);
  }


  function rememberSearches(data) {
    var savedAt = Date.now();
    try {
      localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify({ savedAt: savedAt, data: data }));
    } catch (err) { /* private mode */ }
    return savedAt;
  }

  function recallSearches() {
    try {
      var raw = localStorage.getItem(SEARCH_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function applySearches(data, meta) {
    state.searches = data;
    state.searchOffline = !!(meta && meta.offline);
    state.searchSavedAt = (meta && meta.savedAt) || null;
    state.searchError = '';
    if (state.tab === 'searches') renderSearches();
  }

  function searchUpdatedText() {
    var when = '';
    if (state.searchSavedAt) when = formatStamp(state.searchSavedAt);
    else if (state.searches && (state.searches.as_of || state.searches.scanned_at)) {
      when = state.searches.as_of || state.searches.scanned_at;
    }
    if (state.searchRefreshing) return 'Updating...';
    if (!when) return 'Updated --';
    var text = 'Updated ' + when;
    if (state.searchOffline) text += ' / offline copy';
    return text;
  }

  function setSearchRefreshing(on) {
    state.searchRefreshing = !!on;
    var spin = $('search-spinner');
    var stamp = $('search-updated-text') || $('search-updated');
    var btn = $('search-refresh-btn');
    if (spin) spin.hidden = !on;
    if (stamp) stamp.textContent = searchUpdatedText();
    if (btn) btn.disabled = !!on;
  }

  function refreshSearches() {
    if (state.searchInflight) return state.searchInflight;
    setSearchRefreshing(true);
    // Cache-bust so the phone gets the newest saved scan, not a stale copy.
    // This only reloads data/load_searches.json. It does not start a new board search.
    var url = 'data/load_searches.json?t=' + Date.now();
    state.searchInflight = fetch(url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('Searches responded ' + res.status);
      var fromCache = res.headers.get('X-Feed-Cache') === '1';
      return res.json().then(function (data) {
        return { data: data, fromCache: fromCache };
      });
    }).then(function (pack) {
      if (!pack.data || !pack.data.loads) throw new Error('Searches feed has no loads');
      if (pack.fromCache) {
        var prev = recallSearches();
        applySearches(pack.data, { offline: true, savedAt: prev && prev.savedAt });
      } else {
        applySearches(pack.data, { offline: false, savedAt: rememberSearches(pack.data) });
      }
    }).catch(function () {
      var cached = recallSearches();
      if (cached && cached.data) {
        applySearches(cached.data, { offline: true, savedAt: cached.savedAt });
      } else {
        state.searchError = 'Could not load the latest scan.';
        if (state.tab === 'searches') renderSearches();
      }
    }).then(function () {
      state.searchInflight = null;
      setSearchRefreshing(false);
      if (state.tab === 'searches') {
        var stamp = $('search-updated-text') || $('search-updated');
        if (stamp) stamp.textContent = searchUpdatedText();
        var spin = $('search-spinner');
        if (spin) spin.hidden = true;
      }
    });
    return state.searchInflight;
  }

  function searchMoney(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    var neg = n < -0.004;
    var abs = Math.abs(n);
    var body = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return (neg ? '-$' : '$') + body;
  }

  function filteredSearches(data) {
    var rows = (data && data.loads) ? data.loads.slice() : [];
    var f = state.searchFilter || 'all';
    if (f === 'take' || f === 'maybe' || f === 'pass') {
      rows = rows.filter(function (row) { return String(row.verdict).toLowerCase() === f; });
    } else if (f === 'truckstop') {
      rows = rows.filter(function (row) { return row.board === 'Truckstop'; });
    } else if (f === 'df') {
      rows = rows.filter(function (row) { return row.board === 'Direct Freight'; });
    }
    return rows;
  }

  function renderSearchChart(rows) {
    var top = rows.filter(function (row) { return row.net_est != null; }).slice(0, 12);
    if (!top.length) return '';
    var width = 440;
    var rowH = 26;
    var left = 150;
    var right = 54;
    var height = top.length * rowH + 8;
    var maxAbs = 1;
    top.forEach(function (row) {
      var a = Math.abs(row.net_est);
      if (a > maxAbs) maxAbs = a;
    });
    var barW = width - left - right;
    var bars = top.map(function (row, i) {
      var y = 4 + i * rowH;
      var w = Math.max(2, Math.round(Math.abs(row.net_est) / maxAbs * barW));
      var color = row.verdict === 'TAKE' ? '#D4A62A' : (row.verdict === 'MAYBE' ? '#C4B5FD' : '#8C1C13');
      if (row.net_est < 0) color = '#8C1C13';
      var lane = (row.origin || '') + ' -> ' + (row.destination || '');
      if (lane.length > 28) lane = lane.slice(0, 26) + '...';
      return '<text class="chart-label" x="0" y="' + (y + 14) + '">' + esc(lane) + '</text>' +
        '<rect x="' + left + '" y="' + (y + 4) + '" width="' + w + '" height="14" rx="3" fill="' + color + '"></rect>' +
        '<text class="chart-val" x="' + (left + w + 6) + '" y="' + (y + 15) + '">' + esc(searchMoney(row.net_est)) + '</text>';
    }).join('');
    return '<div class="net-chart"><h3>Net EST, best first</h3>' +
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Net EST bar chart">' + bars + '</svg></div>';
  }

  function renderSearchCard(row) {
    var verd = String(row.verdict || 'PASS').toLowerCase();
    var origin = row.origin || 'Origin';
    var dh = row.origin_dh_mi != null ? ' (' + plainNum(row.origin_dh_mi, 0) + ' mi deadhead)' : '';
    var dest = row.destination || 'Destination';
    var bits = [];
    bits.push(row.board || '');
    if (row.trip_mi != null) bits.push(plainNum(row.trip_mi, 0) + ' trip mi');
    if (row.equipment) bits.push(row.equipment);
    if (row.weight_lb != null) bits.push(plainNum(row.weight_lb, 0) + ' lb');
    if (row.length_ft != null) bits.push(plainNum(row.length_ft, 1) + ' ft');
    if (row.posted_rate != null) bits.push('posted ' + money(row.posted_rate));
    if (row.rate_per_mi != null) bits.push('$' + Number(row.rate_per_mi).toFixed(2) + '/mi');
    if (row.pickup_window) bits.push('PU ' + row.pickup_window);
    if (row.drop_window) bits.push('DEL ' + row.drop_window);
    var broker = row.broker || (row.board === 'Direct Freight' ? 'Broker not listed on the free list' : '');
    if (broker) bits.push(broker);
    if (row.broker_mc) bits.push('MC ' + row.broker_mc);
    if (row.broker_dot) bits.push('DOT ' + row.broker_dot);
    if (row.load_number) bits.push('Load # ' + row.load_number);
    if (row.notes) bits.push(row.notes);
    var flags = (row.fit_flags && row.fit_flags.length) ? row.fit_flags.join('. ') + '.' : '';
    var link = row.link ? '<a class="search-link" href="' + esc(row.link) + '" target="_blank" rel="noopener noreferrer">Open on ' + esc(row.board || 'the board') + '</a>' : '';
    return '<article class="search-card ' + esc(verd) + '">' +
      '<div class="search-top"><div>' +
      '<div class="lane">' + esc(origin) + dh + ' -> ' + esc(dest) + '</div>' +
      '<span class="verdict-pill ' + esc(verd) + '">' + esc(row.verdict || 'PASS') + '</span>' +
      '</div><div class="search-net">' + esc(searchMoney(row.net_est)) + '<span class="unit">Net EST</span></div></div>' +
      (row.math ? '<p class="search-math">' + esc(row.math) + '</p>' : '') +
      (flags ? '<p class="search-flags">' + esc(flags) + '</p>' : '') +
      '<p class="search-meta">' + esc(bits.filter(Boolean).join(' | ')) + '</p>' +
      link + '</article>';
  }

  function searchToolbar() {
    var spinHidden = state.searchRefreshing ? '' : ' hidden';
    return '<div id="search-pull" class="pull">Pull to refresh</div>' +
      '<div class="search-toolbar">' +
        '<p class="search-updated" id="search-updated">' +
          '<span id="search-spinner" class="search-spinner"' + spinHidden + ' aria-hidden="true"></span>' +
          '<span id="search-updated-text">' + esc(searchUpdatedText()) + '</span>' +
        '</p>' +
        '<button type="button" class="btn" id="search-refresh-btn"' +
          (state.searchRefreshing ? ' disabled' : '') + '>Refresh</button>' +
      '</div>' +
      '<p class="fine">Refresh reloads the latest saved scan. It does not start a new board search.</p>';
  }

  function bindSearchRefresh() {
    var btn = $('search-refresh-btn');
    if (btn) btn.addEventListener('click', function () { refreshSearches(); });
  }

  function renderSearches() {
    var root = $('searches-root');
    if (!root) return;
    var data = state.searches;
    var head = searchToolbar();
    if (state.searchError && !data) {
      root.innerHTML = head + '<p class="warn">' + esc(state.searchError) + '</p>';
      bindSearchRefresh();
      return;
    }
    if (!data) {
      root.innerHTML = head + '<p class="fine">Loading the latest saved scan...</p>';
      bindSearchRefresh();
      return;
    }
    var counts = data.counts || {};
    var rules = data.rules || {};
    var scanStamp = data.scanned_at || data.as_of || '';
    var formula = rules.formula || 'net EST = rate x 0.87 - $1.64 per loaded mile - $0.30 per deadhead mile';
    var bar = rules.quality_bar || '';
    var rows = filteredSearches(data);
    var filters = [
      ['all', 'All'],
      ['take', 'TAKE'],
      ['maybe', 'MAYBE'],
      ['pass', 'PASS'],
      ['truckstop', 'Truckstop'],
      ['df', 'Direct Freight']
    ].map(function (pair) {
      var on = (state.searchFilter || 'all') === pair[0];
      return '<button type="button" data-filter="' + pair[0] + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + pair[1] + '</button>';
    }).join('');
    var cards = rows.map(renderSearchCard).join('') || '<p class="fine">No loads in this filter.</p>';
    root.innerHTML =
      head +
      '<div class="searches-hero">' +
        '<h2>Load Searches</h2>' +
        '<p class="fine">' + (scanStamp ? 'Scan ' + esc(scanStamp) : 'Latest saved scan') +
          (data.origin ? ' / from ' + esc(data.origin) : '') +
          (state.searchOffline ? ' / offline copy' : '') + '</p>' +
        '<p class="fine">' + esc(formula) + '. ' + esc(bar) + '</p>' +
        '<div class="search-counts">' +
          '<div class="search-count"><div class="n">' + esc(String(counts.total || 0)) + '</div><div class="l">Loads</div></div>' +
          '<div class="search-count"><div class="n">' + esc(String(counts.take || 0)) + '</div><div class="l">TAKE</div></div>' +
          '<div class="search-count"><div class="n">' + esc(String(counts.maybe || 0)) + '</div><div class="l">MAYBE</div></div>' +
          '<div class="search-count"><div class="n">' + esc(String(counts.pass || 0)) + '</div><div class="l">PASS</div></div>' +
        '</div>' +
      '</div>' +
      renderSearchChart(data.loads || []) +
      '<div class="search-filters" role="group" aria-label="Filter loads">' + filters + '</div>' +
      cards;
    bindSearchRefresh();
    root.querySelectorAll('.search-filters button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.searchFilter = btn.getAttribute('data-filter') || 'all';
        renderSearches();
      });
    });
  }

  function showTab(name) {
    state.tab = name;
    ['check', 'searches', 'reports', 'kpis', 'stops'].forEach(function (id) {
      var on = id === name;
      $('tab-' + id).setAttribute('aria-selected', on ? 'true' : 'false');
      $('panel-' + id).hidden = !on;
    });
    document.querySelector('.app').classList.toggle('tab-stops', name === 'stops');
    if (name === 'reports') {
      renderReports();
      refreshFeed();
    } else if (name === 'kpis') {
      renderKpis();
      refreshFeed();
    } else if (name === 'searches') {
      renderSearches();
      refreshSearches();
    } else if (name === 'stops' && window.BlackRamStops) {
      window.BlackRamStops.show();
    }
    window.scrollTo(0, 0);
  }

  function openAbout() {
    $('about').classList.add('open');
    document.documentElement.classList.add('sheet-open');
  }

  function closeAbout() {
    $('about').classList.remove('open');
    document.documentElement.classList.add('splash-seen');
    document.documentElement.classList.remove('sheet-open');
    try { localStorage.setItem(SPLASH_KEY, '1'); } catch (err) { /* ignore */ }
  }

  function setupPull() {
    var startY = 0;
    var pulling = false;
    var dy = 0;

    function indicator(px, text) {
      var el = document.querySelector('.panel:not([hidden]) .pull') || $('pull') || $('search-pull');
      if (!el) return;
      el.style.height = px + 'px';
      el.textContent = text || 'Pull to refresh';
    }

    document.addEventListener('touchstart', function (event) {
      if (state.tab !== 'reports' && state.tab !== 'searches') return;
      if (window.scrollY > 2) return;
      if (event.target.closest('input, textarea, button, a, summary')) return;
      startY = event.touches[0].clientY;
      pulling = true;
      dy = 0;
    }, { passive: true });

    document.addEventListener('touchmove', function (event) {
      if (!pulling) return;
      dy = event.touches[0].clientY - startY;
      if (dy > 16 && window.scrollY <= 2) {
        var shown = Math.min(dy * 0.45, 48);
        indicator(shown, dy > 70 ? 'Release to refresh' : 'Pull to refresh');
      }
    }, { passive: true });

    document.addEventListener('touchend', function () {
      if (pulling && dy > 70 && (state.tab === 'reports' || state.tab === 'kpis')) refreshFeed();
      if (pulling && dy > 70 && state.tab === 'searches') refreshSearches();
      pulling = false;
      dy = 0;
      indicator(0);
    });
  }

  function init() {
    loadSettings();
    loadView();
    $('offer').addEventListener('submit', function (event) { event.preventDefault(); });
    $('offer').addEventListener('input', renderCheck);
    $('settings').addEventListener('input', function () {
      saveSettings();
      renderCheck();
    });
    $('tarp-yes').addEventListener('click', function () { setTarp(true); });
    $('tarp-no').addEventListener('click', function () { setTarp(false); });
    $('clear-offer').addEventListener('click', clearOffer);
    $('about-open').addEventListener('click', openAbout);
    $('about-close').addEventListener('click', closeAbout);
    $('about-done').addEventListener('click', closeAbout);
    document.querySelectorAll('.tabbar button').forEach(function (btn) {
      btn.addEventListener('click', function () { showTab(btn.getAttribute('data-tab')); });
    });
    setupPull();
    renderCheck();
    refreshFeed();
    refreshSearches();
  }

  window.BlackRam = {
    compute: compute,
    settings: settings,
    refreshFeed: refreshFeed,
    refreshSearches: refreshSearches,
    monthFigures: monthFigures,
    latestMonth: latestMonth,
    showTab: showTab,
    getFeed: function () { return state.feed; },
    getSearches: function () { return state.searches; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
