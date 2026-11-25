(function () {
  'use strict';

  var APP_VERSION = 'v29';
  var SETTINGS_KEY = 'blackram_settings_v4';
  var SETTINGS_KEY_V1 = 'blackram_settings_v1';
  var SETTINGS_KEY_V2 = 'blackram_settings_v2';
  var SETTINGS_KEY_V3 = 'blackram_settings_v3';
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
    scoredSearches: null,
    truckAt: null,
    truckAtBusy: false,
    truckAtError: '',
    dieselPrices: null,
    truckFuel: null,
    maxDeadhead: 0,
    routeCache: null,
    geoCache: null,
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

  // fetch with a timeout so a weak signal falls back to the saved copy
  // instead of spinning forever.
  function fetchTimed(url, opts, ms) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var o = {};
    for (var k in (opts || {})) o[k] = opts[k];
    if (ctrl) o.signal = ctrl.signal;
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (ctrl) { try { ctrl.abort(); } catch (e) { /* ignore */ } }
        reject(new Error('Timed out'));
      }, ms || 15000);
      fetch(url, o).then(function (res) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res);
      }, function (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function milesNum(v) {
    if (v == null || v === '' || typeof v === 'boolean') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // Deadhead, loaded, and total miles side by side on every load card.
  function milesStrip(loaded, empty, opts) {
    opts = opts || {};
    var lo = milesNum(loaded);
    var em = milesNum(empty);
    if (lo == null && em == null) return '';
    var total = (lo || 0) + (em || 0);
    function cell(cls, label, val, est, sub) {
      return '<div class="mi-cell ' + cls + '"><span>' + esc(label) + '</span>' +
        '<b>' + (val == null ? 'n/a' : esc(plainNum(val, 0)) + ' mi') +
        (est && val != null ? ' <i class="est">EST</i>' : '') + '</b>' +
        (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
    }
    return '<div class="miles-strip">' +
      cell('mi-dead', 'Deadhead', em, opts.emptyEst, opts.emptyFrom ? 'from ' + opts.emptyFrom : '') +
      cell('mi-loaded', 'Loaded', lo, opts.loadedEst, '') +
      cell('mi-total', 'Total', total > 0 ? total : null, opts.loadedEst || opts.emptyEst, '') +
      '</div>';
  }

  // Ledger loads: recorded deadhead_mi wins, else the inferred empty_mi_est.
  function ledgerEmpty(load) {
    if (!load) return { mi: null, from: '' };
    var rec = milesNum(load.deadhead_mi);
    var est = milesNum(load.empty_mi_est);
    var from = load.empty_inferred_from === 'home' ? 'home' : (load.empty_from || '');
    if (rec != null) return { mi: rec, from: from };
    if (est != null) return { mi: est, from: from };
    return { mi: null, from: '' };
  }

  function settings() {
    function n(id, fallback) {
      var v = fieldNum(id);
      return v == null ? fallback : v;
    }
    var mph = n('assumedMph', 50);
    var loadedCost = n('loadedCost', 1.14);
    var deadheadCost = n('deadheadCost', 0.30);
    var minNet = n('minNet', 500);
    var minNetSameDay = n('minNetSameDay', 300);
    var sameDayMiles = n('sameDayMiles', 250);
    var chainMin = n('chainMin', 1000);
    var capacity = n('capacity', 15300);
    var deckFt = n('deckFt', 40);
    return {
      feePct: n('feePct', 13),
      loadedCost: loadedCost != null && loadedCost >= 0 ? loadedCost : 1.14,
      deadheadCost: deadheadCost != null && deadheadCost >= 0 ? deadheadCost : 0.30,
      minNet: minNet != null ? minNet : 500,
      minNetSameDay: minNetSameDay != null ? minNetSameDay : 300,
      sameDayMiles: sameDayMiles > 0 ? sameDayMiles : 250,
      chainMin: chainMin != null ? chainMin : 1000,
      trailer: n('trailer', 434.84),
      insurance: n('insurance', 1221.62),
      otherFixed: n('otherFixed', 1573.04),
      mpg: n('mpg', 8),
      diesel: n('diesel', 5.36),
      capacity: capacity != null ? capacity : 15300,
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
      var fromV3 = false;
      var fromOld = false;
      if (!raw) {
        raw = localStorage.getItem(SETTINGS_KEY_V3);
        if (raw) fromV3 = true;
        else {
          raw = localStorage.getItem(SETTINGS_KEY_V2) || localStorage.getItem(SETTINGS_KEY_V1);
          fromOld = !!raw;
        }
      }
      if (!raw) return;
      var data = JSON.parse(raw);
      // v3 phones saved loaded cost at $1.64/mi (included $0.50 driver pay).
      // Meshach is paid from profits, so the default is now $1.14 fuel and DEF only.
      // Older phones also stored $/mi floors and a 15,000 lb deck.
      var resetOld = {
        floor: 1, takeAt: 1, loadedCost: 1, deadheadCost: 1,
        minNet: 1, minNetSameDay: 1, sameDayMiles: 1, chainMin: 1,
        capacity: 1, deckFt: 1
      };
      var resetV3 = { loadedCost: 1 };
      Object.keys(data).forEach(function (id) {
        if (fromV3 && resetV3[id]) return;
        if (fromOld && resetOld[id]) return;
        if ($(id) && data[id] != null && data[id] !== '') $(id).value = data[id];
      });
      if (fromV3 || fromOld) saveSettings();
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
    var hardMax = Math.min(s.capacity != null ? s.capacity : 15300, 15300);
    var overWeight = weight != null && weight > hardMax;
    var maybeWeight = weight != null && weight > 12500 && weight <= hardMax;
    var overLength = lengthFt != null && lengthFt > s.deckFt;
    var hardFail = overWeight || overLength;
    var flags = [];
    if (overWeight) flags.push('Over ' + plainNum(hardMax, 0) + ' lb payload - cannot haul');
    else if (maybeWeight) flags.push('12,501-15,300 lb, scale check, load centered just ahead of trailer axles');
    if (overLength) flags.push('Over ' + plainNum(s.deckFt, 0) + ' ft deck - cannot haul');
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
        msg: 'Enter the rate plus loaded miles, empty miles, or both.',
        meta: 'Net EST = rate x 0.87 minus $' + s.loadedCost.toFixed(2) + ' per loaded mile minus $' + s.deadheadCost.toFixed(2) + ' per empty mile. Bar $' + plainNum(s.minNet, 0) + ' net EST, or $' + plainNum(s.minNetSameDay, 0) + ' for a same-day run under ' + plainNum(s.sameDayMiles, 0) + ' total miles.'
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
    if (state.tarp) bits.push('Tarp required. We have tarps and straps.');
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
        : 'This may not fit the 40 ft deck or the 12,500 lb clean / 15,300 lb maybe payload (scale check, load centered just ahead of trailer axles).';
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
      ? ('Rate x 0.87 = ' + money(result.afterFee) + '. Loaded $' + s.loadedCost.toFixed(2) + ' x ' + plainNum(result.loadedMi, 0) + ' = ' + money(result.loadedCostAmt) + '. Empty miles $' + s.deadheadCost.toFixed(2) + ' x ' + plainNum(result.deadMi, 0) + ' = ' + money(result.deadCostAmt) + '.')
      : 'rate x 0.87 - $' + s.loadedCost.toFixed(2) + '/loaded mi - $' + s.deadheadCost.toFixed(2) + '/empty mi';

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

  function chicagoNowParts(date) {
    var d = date || new Date();
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    var parts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
    fmt.formatToParts(d).forEach(function (part) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    });
    return parts;
  }

  function chicagoDayNum(parts) {
    return parts.year * 10000 + parts.month * 100 + parts.day;
  }

  function parseYmd(value) {
    if (value == null || value === '') return null;
    var text = String(value);
    var m = text.match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    return {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: m[4] != null ? Number(m[4]) : null,
      minute: m[5] != null ? Number(m[5]) : 0,
      second: m[6] != null ? Number(m[6]) : 0
    };
  }

  function parseClock(text) {
    if (!text) return null;
    var m = String(text).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
    if (!m) return null;
    var hh = Number(m[1]);
    var mm = Number(m[2] || 0);
    var ap = (m[3] || '').replace(/\./g, '').toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    if (hh > 23 || mm > 59) return null;
    return { hour: hh, minute: mm, second: 0 };
  }

  function windowEndClock(window) {
    if (!window) return null;
    var text = String(window).trim();
    var parts = text.split(/\s*(?:[-–—]|to)\s*/i);
    var end = (parts[parts.length - 1] || text).trim();
    var parsed = parseClock(end);
    if (parsed) return parsed;
    var ampm = text.match(/(a\.?m\.?|p\.?m\.?)\s*$/i);
    if (ampm && !/(a\.?m\.?|p\.?m\.?)/i.test(end)) return parseClock(end + ' ' + ampm[1]);
    return null;
  }

  function hasPayment(load, nowParts) {
    var recDates = ['received_date', 'paid_date', 'payout_date'].map(function (key) {
      return parseYmd(load && load[key]);
    }).filter(Boolean);
    var asOf = nowParts ? chicagoDayNum(nowParts) : null;
    var datedFuture = false;
    if (recDates.length && asOf != null) {
      datedFuture = recDates.every(function (rd) {
        return (rd.year * 10000 + rd.month * 100 + rd.day) > asOf;
      });
      if (!datedFuture) return true;
    }
    var rec = load && load.net_received != null && load.net_received !== '' ? Number(load.net_received) : 0;
    if (isFinite(rec) && rec > 0 && !datedFuture) return true;
    var payout = load && (load.totni_payout || load.totni_paid || load.payout);
    if (payout && payout !== true && !datedFuture) {
      if (typeof payout === 'number') return payout > 0;
      return true;
    }
    return false;
  }

  function isCancelledLoad(load) {
    return String((load && load.status) || '').trim().toLowerCase().indexOf('cancel') === 0;
  }

  function pastDelivery(load, nowParts) {
    nowParts = nowParts || chicagoNowParts();
    var nowNum = chicagoDayNum(nowParts);
    var nowClock = nowParts.hour * 3600 + nowParts.minute * 60 + nowParts.second;
    var conf = parseYmd(load && load.delivered_date);
    if (conf && nowNum >= (conf.year * 10000 + conf.month * 100 + conf.day)) return true;
    var raw = (load && (load.delivery_date || load.delivered_date || load.delivery_due)) || '';
    var parsed = parseYmd(raw);
    if (!parsed) return false;
    var dayNum = parsed.year * 10000 + parsed.month * 100 + parsed.day;
    var clock = windowEndClock((load && (load.delivery_window || load.delivery_time)) || '');
    if (!clock && parsed.hour != null) clock = { hour: parsed.hour, minute: parsed.minute, second: parsed.second };
    if (clock) {
      var cut = clock.hour * 3600 + clock.minute * 60 + (clock.second || 0);
      if (nowNum > dayNum) return true;
      if (nowNum < dayNum) return false;
      return nowClock >= cut;
    }
    // Date only: past the end of that day (start of the next day).
    var next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1));
    var nextNum = next.getUTCFullYear() * 10000 + (next.getUTCMonth() + 1) * 100 + next.getUTCDate();
    return nowNum >= nextNum;
  }

  function resolveRunStatus(load, nowParts) {
    nowParts = nowParts || chicagoNowParts();
    if (isCancelledLoad(load)) return 'cancelled';
    if (hasPayment(load, nowParts) || pastDelivery(load, nowParts)) return 'delivered';
    var pickup = parseYmd((load && (load.pickup_date || load.date)) || '');
    if (pickup) {
      var pu = pickup.year * 10000 + pickup.month * 100 + pickup.day;
      if (chicagoDayNum(nowParts) >= pu) return 'in_transit';
      return 'booked';
    }
    var st = String((load && load.status) || '').trim().toUpperCase();
    if (st === 'BOOKED') return 'booked';
    return 'in_transit';
  }

  function resolvePayStatus(load, runStatus, nowParts) {
    runStatus = runStatus || resolveRunStatus(load, nowParts);
    if (runStatus === 'cancelled') return '';
    var rec = load && load.net_received != null && load.net_received !== '' ? Number(load.net_received) : 0;
    var due = load && load.net_due != null && load.net_due !== '' ? Number(load.net_due) : null;
    if (isFinite(rec) && rec > 0) {
      if (due != null && isFinite(due) && rec + 0.004 < due) return 'paid_short';
      return 'paid';
    }
    if (runStatus === 'in_transit' || runStatus === 'booked') return 'in_transit';
    return 'unpaid';
  }

  function withResolvedStatus(load) {
    var nowParts = chicagoNowParts();
    var run = resolveRunStatus(load, nowParts);
    var pay = resolvePayStatus(load, run, nowParts);
    var out = {};
    Object.keys(load || {}).forEach(function (key) { out[key] = load[key]; });
    out.status = run;
    out.pay_status = pay;
    return out;
  }

  function paySummary(loads) {
    var receivedC = 0;
    var owedC = 0;
    var owedEst = false;
    var counts = { paid: 0, paid_short: 0, unpaid: 0, in_transit: 0, delivered: 0, booked: 0 };
    loads.forEach(function (load) {
      load = withResolvedStatus(load);
      if (counts[load.pay_status] != null) counts[load.pay_status] += 1;
      if (counts[load.status] != null) counts[load.status] += 1;
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
    if (counts.paid_short) bits.push(counts.paid_short + ' paid - ELD fees');
    if (counts.in_transit) bits.push(counts.in_transit + ' in transit');
    if (counts.booked) bits.push(counts.booked + ' booked');
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
      var em = ledgerEmpty(load).mi;
      if (em != null) dead += em;
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
    state.inflight = fetchTimed('data/feed.json', { cache: 'no-cache' }, 15000).then(function (res) {
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

  function eldFeeAmount(load) {
    if (!load) return null;
    if (load.eld_fee_withheld != null && load.eld_fee_withheld !== '' && isFinite(Number(load.eld_fee_withheld)) && Number(load.eld_fee_withheld) > 0) {
      return Number(load.eld_fee_withheld);
    }
    return null;
  }

  function payBadge(load) {
    load = withResolvedStatus(load);
    var html = '';
    var runLabels = {
      delivered: 'Delivered',
      in_transit: 'In transit',
      booked: 'Booked'
    };
    if (runLabels[load.status]) {
      html += ' <span class="pay pay-' + load.status + '">' + runLabels[load.status] + '</span>';
    }
    var eld = eldFeeAmount(load);
    if (eld != null) {
      var eldLabel = 'Paid - ELD fees (' + money(eld) + ')';
      html += ' <span class="pay pay-paid_short">' + eldLabel +
        (load.eld_fee_est ? ' <span class="est">EST</span>' : '') + '</span>';
    } else {
      var payLabels = {
        paid: 'Paid',
        paid_short: 'Paid short',
        unpaid: 'Unpaid'
      };
      if (payLabels[load.pay_status]) {
        html += ' <span class="pay pay-' + load.pay_status + '">' + payLabels[load.pay_status] + '</span>';
      }
    }
    return html;
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
    var emp = ledgerEmpty(load);
    var allMi = (miles || 0) + (emp.mi || 0);
    var allRate = allMi > 0 && gross ? rpm(gross / allMi) : '—';
    var rateCell = miles ? rpm(load.rate_per_mi != null && isFinite(Number(load.rate_per_mi)) ? Number(load.rate_per_mi) : gross / miles) : '—';
    if (miles && load.miles_estimate) rateCell += ' <span class="est">EST</span>';
    var who = [load.broker, load.load_no].filter(Boolean).join(' | ');
    var canMap = hasRouteToDraw(routePayload(load));
    var mapsHref = pastLoadMapsUrl(load);
    var emptyNote = '';
    if (load.empty_mi_est != null && isFinite(Number(load.empty_mi_est))) {
      var from = load.empty_inferred_from === 'home' ? 'home' : 'the previous drop';
      if (load.empty_from) from += ' (' + load.empty_from + ')';
      emptyNote = '<p class="load-empty-note">Empty miles ' + esc(plainNum(load.empty_mi_est, 0)) +
        ' mi EST from ' + esc(from) + '.</p>';
    }
    var routePane = '<div class="load-route" hidden>' +
      rateCompare(load) +
      emptyNote +
      routeBlock(routePayload(load), mapsHref, (load.pickup_place || 'Pickup') + ' to ' + (load.drop_place || 'Drop') + ' route map') +
      '</div>';
    var toggle = '<button type="button" class="load-toggle" aria-expanded="false">' +
      (canMap ? 'Show route' : 'Show $/mi') + '</button>';
    load = withResolvedStatus(load);
    var statusCls = 'load-' + String(load.status || '').replace(/_/g, '-');
    var payCls = load.pay_status ? ' load-pay-' + String(load.pay_status).replace(/_/g, '-') : '';
    return '<article class="load has-route ' + esc(statusCls) + esc(payCls) + '">' +
      '<h3>' + esc(load.desc || 'Load') + payBadge(load) + '</h3>' +
      '<p class="lane">' + esc(when) + (load.lane ? ' · ' + esc(load.lane) : '') + '</p>' +
      milesStrip(miles, emp.mi, { loadedEst: !!load.miles_estimate, emptyEst: true, emptyFrom: emp.from }) +
      tripDaysBlock({
        loaded_mi: miles,
        deadhead_mi: emp.mi,
        empty_mi_est: emp.mi,
        pickup_date: load.pickup_date || load.date,
        delivery_date: load.delivery_date,
        date: load.date,
        net_est: (load.net_est != null ? load.net_est : (gross - fee)),
        days: load.days,
        net_per_day: load.net_per_day
      }) +
      '<div class="kv">' +
      '<div><span>Gross</span><b>' + money(gross) + '</b></div>' +
      '<div><span>Loaded $/mi</span><b>' + rateCell + '</b></div>' +
      '<div><span>All-mi $/mi</span><b>' + allRate + '</b></div>' +
      '<div><span>Net</span><b>' + money(roundMoney(gross - fee)) + '</b></div>' +
      '</div>' + payLine(load) +
      '<p class="notes">Fee ' + money(fee) +
      (who ? ' · ' + esc(who) : '') +
      (typeof load.weight_lb === 'number' ? ' · ' + plainNum(load.weight_lb, 0) + ' lb' : '') +
      (load.notes ? '<br>' + esc(load.notes) : '') + '</p>' +
      toggle + routePane + '</article>';
  }

  function pastLoadMapsUrl(load) {
    if (!load) return '';
    var origin = coordKey(load.empty_from_coord) || load.empty_from || 'Home base (Jacksonville)';
    var waypoint = coordKey(load.pickup_coord) || load.pickup_place || '';
    var dest = coordKey(load.drop_coord) || load.drop_place || '';
    if (!dest) return '';
    if (waypoint) return mapsDirUrl(origin, [waypoint], dest);
    return mapsDirUrl(origin, [], dest);
  }

  function bindLoadRoutes(root) {
    var scope = root || document;
    scope.querySelectorAll('article.load.has-route').forEach(function (card) {
      var btn = card.querySelector('.load-toggle');
      var pane = card.querySelector('.load-route');
      if (!pane) return;
      function toggle(force) {
        var open = force != null ? force : pane.hidden;
        pane.hidden = !open;
        card.classList.toggle('open', open);
        if (btn) {
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          var canMap = pane.querySelector('.route-map');
          btn.textContent = open ? 'Hide route' : (canMap ? 'Show route' : 'Show $/mi');
        }
        if (open) observeRouteMaps(pane);
      }
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          toggle();
        });
      }
      card.addEventListener('click', function (e) {
        if (e.target.closest('a, button, .load-route')) return;
        toggle();
      });
      card.setAttribute('tabindex', '0');
      card.addEventListener('keydown', function (e) {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
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
    if (root) destroyRouteMaps();
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
    bindLoadRoutes(root);
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
        '" text-anchor="middle" fill="#b9b3cc" font-size="11" font-family="Oswald, Arial Narrow, sans-serif">' +
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
    refreshDeadheads();
  }

  function searchUpdatedText() {
    var when = '';
    if (state.searches && (state.searches.scanned_at || state.searches.as_of)) {
      when = state.searches.scanned_at || state.searches.as_of;
    } else if (state.searchSavedAt) when = formatStamp(state.searchSavedAt);
    if (state.searchRefreshing) return 'Updating...';
    if (!when) return 'Last scan: --';
    var text = 'Last scan: ' + when;
    if (state.searchOffline) text += ' / offline copy';
    text += ' · ' + APP_VERSION;
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
    state.searchInflight = fetchTimed(url, { cache: 'no-cache' }, 15000).then(function (res) {
      if (!res.ok) throw new Error('Load Boards responded ' + res.status);
      var fromCache = res.headers.get('X-Feed-Cache') === '1';
      return res.json().then(function (data) {
        return { data: data, fromCache: fromCache };
      });
    }).then(function (pack) {
      if (!pack.data || !pack.data.loads) throw new Error('Load Boards feed has no loads');
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

  var PER_HOUR_MPH = 50;
  var LOAD_UNLOAD_HOURS = 2;

  var MILES_PER_DAY = 550;
  var MIN_NET_PER_DAY = 300;
  var TRUCK_AT_KEY = 'blackram_truck_at_v1';
  var GEO_CACHE_KEY = 'blackram_geocode_cache_v1';
  var ROUTE_CACHE_KEY = 'blackram_route_cache_v1';
  var CIRCUITY = 1.2;
  var EARTH_MI = 3958.7613;
  var OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/';
  var PHOTON_URL = 'https://photon.komoot.io/api/';
  var PHOTON_REV = 'https://photon.komoot.io/reverse';
  var NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

  function formatDays(n) {
    if (n == null || !isFinite(Number(n))) return 'n/a';
    var v = Math.round(Number(n) * 2) / 2;
    return v.toFixed(v % 1 === 0 ? 0 : 1);
  }

  function ceilHalfDay(n) {
    if (n == null || !isFinite(Number(n)) || Number(n) <= 0) return null;
    return Math.round(Math.ceil(Number(n) * 2 - 1e-9) * 10 / 2) / 10;
  }

  function daysFromMiles(loaded, dead, nLoads) {
    var total = (Number(loaded) || 0) + (Number(dead) || 0);
    if (total <= 0) return null;
    var n = nLoads && nLoads > 0 ? nLoads : 1;
    return ceilHalfDay(total / MILES_PER_DAY + (LOAD_UNLOAD_HOURS * n) / 24);
  }

  function elapsedHours(miles) {
    miles = Number(miles) || 0;
    if (miles <= 0) return 0;
    var full = Math.floor(miles / MILES_PER_DAY);
    var rem = miles - full * MILES_PER_DAY;
    return full * 24 + rem / PER_HOUR_MPH;
  }

  function scanYear() {
    var stamp = state.searches && (state.searches.scanned_at || state.searches.as_of);
    var m = stamp && String(stamp).match(/(20\d{2})/);
    return m ? Number(m[1]) : 2026;
  }

  function parseOneDate(text, year, defaultHour, defaultMinute) {
    if (!text) return null;
    var m = String(text).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*,?\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/i);
    if (!m) return null;
    var month = Number(m[1]), day = Number(m[2]);
    var yr = year;
    if (m[3]) {
      yr = Number(m[3]);
      if (yr < 100) yr += 2000;
    }
    var hour = defaultHour, minute = defaultMinute;
    if (m[4]) {
      hour = Number(m[4]);
      minute = Number(m[5]);
      var ap = (m[6] || '').toUpperCase();
      if (ap === 'PM' && hour < 12) hour += 12;
      if (ap === 'AM' && hour === 12) hour = 0;
    }
    var d = new Date(yr, month - 1, day, hour, minute, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  function parseWindow(text, year) {
    var s = String(text || '').trim();
    if (!s || /not available/i.test(s)) return null;
    var ships = s.match(/ships\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
    if (ships) {
      var a = parseOneDate(ships[1], year, 0, 0);
      var b = parseOneDate(ships[1], year, 23, 59);
      return a && b ? [a, b] : null;
    }
    var orParts = s.split(/\s+or\s+/i);
    if (orParts.length >= 2) {
      var first = parseOneDate(orParts[0], year, 0, 0);
      var last = parseOneDate(orParts[orParts.length - 1], year, 23, 59);
      return first && last ? [first, last] : null;
    }
    var parts = s.split(/\s*-\s*/);
    if (parts.length >= 2) {
      var start = parseOneDate(parts[0], year, 0, 0);
      var end = parseOneDate(parts[1], year, 23, 59);
      return start && end ? [start, end] : null;
    }
    var one = parseOneDate(s, year, 0, 0);
    if (!one) return null;
    var endOne = parseOneDate(s, year, 23, 59);
    return [one, endOne];
  }

  function calendarSpanDays(start, end) {
    if (!start || !end) return null;
    var a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    var b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    if (b < a) return null;
    return (b - a) / 86400000 + 1;
  }

  function windowForcedDays(pickupWindow, dropWindow, year, loaded, dead, nLoads) {
    var pu = parseWindow(pickupWindow, year);
    var dr = parseWindow(dropWindow, year);
    if (!pu && !dr) return null;
    var dhH = elapsedHours(dead);
    var ldH = elapsedHours(loaded) + LOAD_UNLOAD_HOURS * (nLoads && nLoads > 0 ? nLoads : 1);
    var puStart = pu ? pu[0] : null, puEnd = pu ? pu[1] : null;
    var drStart = dr ? dr[0] : null;
    var tPickup;
    if (puStart && drStart) {
      var ideal = new Date(drStart.getTime() - ldH * 3600000);
      if (ideal < puStart) tPickup = puStart;
      else if (puEnd && ideal > puEnd) tPickup = puEnd;
      else tPickup = ideal;
    } else if (puEnd) tPickup = puEnd;
    else if (puStart) tPickup = puStart;
    else if (drStart) tPickup = new Date(drStart.getTime() - ldH * 3600000);
    else return null;
    var tDepart = new Date(tPickup.getTime() - dhH * 3600000);
    var tDrop = new Date(tPickup.getTime() + ldH * 3600000);
    if (drStart && tDrop < drStart) tDrop = drStart;
    var raw = (tDrop - tDepart) / 86400000;
    var occupied = calendarSpanDays(tDepart, tDrop);
    var best = ceilHalfDay(raw);
    if (occupied) {
      var occ = ceilHalfDay(occupied) || occupied;
      if (best == null || occ > best) best = occ;
    }
    return best;
  }

  function ledgerDate(value) {
    if (!value) return null;
    var s = String(value).slice(0, 10);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function tripDaysForRow(row, nLoads) {
    if (!row) return null;
    if (row.days != null && isFinite(Number(row.days)) && !state.truckAt) return Number(row.days);
    var loaded = rowLoadedMiles(row);
    var dead = rowEmptyMiles(row);
    var n = nLoads && nLoads > 0 ? nLoads : 1;
    var byMiles = daysFromMiles(loaded, dead, n);
    var byWindow = windowForcedDays(row.pickup_window, row.drop_window, scanYear(), loaded, dead, n);
    var start = ledgerDate(row.pickup_date || row.date);
    var end = ledgerDate(row.delivery_date);
    var byDates = start && end ? ceilHalfDay(calendarSpanDays(start, end)) : null;
    var vals = [byMiles, byWindow, byDates].filter(function (d) { return d != null && d > 0; });
    return vals.length ? Math.max.apply(null, vals) : null;
  }

  function efficientLoadTimes(row, year) {
    var pu = parseWindow(row && row.pickup_window, year);
    var dr = parseWindow(row && row.drop_window, year);
    var dhH = elapsedHours(rowEmptyMiles(row));
    var ldH = elapsedHours(rowLoadedMiles(row)) + LOAD_UNLOAD_HOURS;
    var puStart = pu ? pu[0] : null, puEnd = pu ? pu[1] : null;
    var drStart = dr ? dr[0] : null;
    var tPickup;
    if (puStart && drStart) {
      var ideal = new Date(drStart.getTime() - ldH * 3600000);
      if (ideal < puStart) tPickup = puStart;
      else if (puEnd && ideal > puEnd) tPickup = puEnd;
      else tPickup = ideal;
    } else if (puEnd) tPickup = puEnd;
    else if (puStart) tPickup = puStart;
    else if (drStart) tPickup = new Date(drStart.getTime() - ldH * 3600000);
    else return null;
    var tDepart = new Date(tPickup.getTime() - dhH * 3600000);
    var tDrop = new Date(tPickup.getTime() + ldH * 3600000);
    if (drStart && tDrop < drStart) tDrop = drStart;
    return { depart: tDepart, pickup: tPickup, drop: tDrop };
  }

  function comboElapsedDays(combo) {
    var loads = (combo && combo.loads) || [];
    if (!loads.length) return null;
    var year = scanYear();
    var times = efficientLoadTimes(loads[0], year);
    var t, t0;
    if (times) {
      t0 = times.depart;
      t = times.drop;
    }
    if (String(combo.kind || 'chain') !== 'shared') {
      for (var i = 1; i < loads.length; i++) {
        var row = loads[i];
        var dhH = elapsedHours(rowEmptyMiles(row));
        var ldH = elapsedHours(rowLoadedMiles(row)) + LOAD_UNLOAD_HOURS;
        if (!t) break;
        t = new Date(t.getTime() + dhH * 3600000);
        var pu = parseWindow(row.pickup_window, year);
        if (pu && t < pu[0]) t = pu[0];
        t = new Date(t.getTime() + ldH * 3600000);
        var dr = parseWindow(row.drop_window, year);
        if (dr && t < dr[0]) t = dr[0];
      }
    } else if (t && combo.stop_order && combo.stop_order.length) {
      var stops = combo.stop_order;
      for (var j = 1; j < stops.length; j++) {
        var a = stops[j - 1].coord;
        var b = stops[j].coord;
        var miles = (a && b) ? (haversineMi(a, b) * CIRCUITY) : 0;
        t = new Date(t.getTime() + elapsedHours(miles) * 3600000);
        var w = parseWindow(stops[j].window, year);
        if (w && t < w[0]) t = w[0];
        t = new Date(t.getTime() + 0.5 * 3600000);
      }
    }
    if (!t0 || !t || t <= t0) return null;
    var raw = (t - t0) / 86400000;
    var occupied = calendarSpanDays(t0, t);
    var best = ceilHalfDay(raw);
    if (occupied && (best == null || occupied > best)) best = ceilHalfDay(occupied) || occupied;
    return best;
  }

  function rowDays(row, nLoads) {
    if (row && row.kind && (row.loads || row.stop_order)) {
      var byMiles = daysFromMiles(row.loaded_mi, row.deadhead_mi, (row.loads || []).length || nLoads || 1);
      var byTime = comboElapsedDays(row);
      var vals = [byMiles, byTime].filter(function (d) { return d != null; });
      return vals.length ? Math.max.apply(null, vals) : byMiles;
    }
    return tripDaysForRow(row, nLoads);
  }

  function rowNetPerDay(row, nLoads) {
    if (!row) return null;
    var days = rowDays(row, nLoads);
    if (row.net_per_day != null && isFinite(Number(row.net_per_day)) && !state.truckAt && !nLoads) {
      // Prefer live math when days were recomputed.
    }
    var net = row.net_est;
    if (net == null || days == null || days <= 0) return null;
    return Number(net) / days;
  }

  function tripDaysBlock(row, nLoads) {
    var days = rowDays(row, nLoads);
    var npd = rowNetPerDay(row, nLoads);
    if (days == null && npd == null) return '';
    var low = npd != null && npd < MIN_NET_PER_DAY;
    var badge = (days != null && days >= 1.5)
      ? '<span class="days-badge">' + esc(formatDays(days)) + ' DAYS</span>'
      : '';
    return '<div class="trip-days' + (low ? ' low-day' : '') + '">' +
      '<div class="td-cell"><span>Trip days</span><b>' + (days == null ? 'n/a' : esc(formatDays(days))) + '</b></div>' +
      '<div class="td-cell"><span>Net / day</span><b>' + (npd == null ? 'n/a' : esc(searchMoney(npd))) + '</b></div>' +
      badge +
      (low ? '<p class="day-warn">Under $300/day — this pay is spread across ' + esc(formatDays(days)) + (Number(days)===1 ? ' day.' : ' days.') + '</p>' : '') +
      '</div>';
  }

  function haversineMi(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return null;
    var toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR;
    var dLon = (b.lon - a.lon) * toR;
    var s = Math.sin(dLat / 2);
    var t = Math.sin(dLon / 2);
    var h = s * s + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * t * t;
    return 2 * EARTH_MI * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function coordKey(a, b) {
    function n(p) { return Number(p.lat).toFixed(5) + ',' + Number(p.lon).toFixed(5); }
    return n(a) + '>' + n(b);
  }

  function loadJsonStore(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch (err) { return {}; }
  }

  function saveJsonStore(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (err) { /* ignore */ }
  }

  function milesBetween(a, b) {
    if (!a || !b) return Promise.resolve(null);
    var key = coordKey(a, b);
    var mem = (state.routeCache || (state.routeCache = loadJsonStore(ROUTE_CACHE_KEY)));
    if (mem[key] != null && isFinite(mem[key])) return Promise.resolve(Number(mem[key]));
    var url = OSRM_URL + a.lon + ',' + a.lat + ';' + b.lon + ',' + b.lat + '?overview=false';
    return fetchTimed(url, {}, 8000).then(function (res) {
      if (!res.ok) throw new Error('osrm');
      return res.json();
    }).then(function (data) {
      if (!data || !data.routes || !data.routes[0]) throw new Error('osrm');
      var mi = data.routes[0].distance / 1609.344;
      mem[key] = Math.round(mi * 10) / 10;
      saveJsonStore(ROUTE_CACHE_KEY, mem);
      return mem[key];
    }).catch(function () {
      var hv = haversineMi(a, b);
      if (hv == null) return null;
      var mi = Math.round(hv * CIRCUITY * 10) / 10;
      mem[key] = mi;
      saveJsonStore(ROUTE_CACHE_KEY, mem);
      return mi;
    });
  }

  function poolMap(items, limit, fn) {
    var i = 0;
    var out = new Array(items.length);
    function next() {
      if (i >= items.length) return Promise.resolve();
      var idx = i++;
      return Promise.resolve(fn(items[idx], idx)).then(function (v) {
        out[idx] = v;
        return next();
      });
    }
    var starters = [];
    for (var k = 0; k < Math.min(limit || 3, items.length); k++) starters.push(next());
    return Promise.all(starters).then(function () { return out; });
  }

  function placeLabelFromPhoton(props, fallback) {
    if (!props) return fallback || '';
    var num = props.housenumber ? String(props.housenumber) : '';
    var street = props.street || '';
    var name = props.name || '';
    var city = props.city || props.town || props.village || props.hamlet || '';
    var state = props.state || '';
    var zip = props.postcode || '';
    var line = '';
    if (num && street) line = num + ' ' + street;
    else if (street) line = street;
    else if (name && name !== city && name !== state) line = name;
    var tail = [];
    if (city) tail.push(city);
    if (state) tail.push(state);
    if (zip) tail.push(zip);
    var out = line;
    if (tail.length) out = out ? (out + ', ' + tail.join(', ')) : tail.join(', ');
    return out || name || fallback || '';
  }

  function placeLabelFromNominatim(hit, fallback) {
    if (!hit) return fallback || '';
    var a = hit.address || {};
    var num = a.house_number || '';
    var street = a.road || a.pedestrian || a.residential || '';
    var city = a.city || a.town || a.village || a.hamlet || a.county || '';
    var state = a.state || '';
    var zip = a.postcode || '';
    var line = (num && street) ? (num + ' ' + street) : (street || '');
    var tail = [];
    if (city) tail.push(city);
    if (state) tail.push(state);
    if (zip) tail.push(zip);
    if (line && tail.length) return line + ', ' + tail.join(', ');
    if (line) return line;
    if (tail.length) return tail.join(', ');
    var raw = hit.display_name || fallback || '';
    return String(raw).split(',').slice(0, 4).join(',').trim();
  }

  function isUsPlace(props, lon, lat) {
    var cc = String((props && (props.countrycode || props.country_code || props.country)) || '').toLowerCase();
    if (cc === 'us' || cc === 'usa' || cc === 'united states' || cc === 'united states of america') return true;
    if (cc === 'pr' || cc === 'vi' || cc === 'gu' || cc === 'mp' || cc === 'as') return true;
    if (cc) return false;
    if (lon == null || lat == null || !isFinite(Number(lon)) || !isFinite(Number(lat))) return false;
    lon = Number(lon); lat = Number(lat);
    if (lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66) return true;
    if (lat >= 51 && lat <= 72 && lon >= -170 && lon <= -129) return true;
    if (lat >= 18.5 && lat <= 22.5 && lon >= -161 && lon <= -154) return true;
    if (lat >= 17.5 && lat <= 18.6 && lon >= -68 && lon <= -64.5) return true;
    return false;
  }

  var US_BBOX = '-124.9,24.3,-66.8,49.6';
  var suggestTimer = null;
  var suggestGen = 0;
  var lastNominatimAt = 0;
  var truckMap = null;

  function suggestNominatim(q) {
    var wait = Math.max(0, 1100 - (Date.now() - lastNominatimAt));
    return new Promise(function (resolve) { setTimeout(resolve, wait); }).then(function () {
      lastNominatimAt = Date.now();
      var url = NOMINATIM_URL + '?format=jsonv2&addressdetails=1&limit=5&countrycodes=us&q=' + encodeURIComponent(q);
      return fetchTimed(url, { headers: { Accept: 'application/json' } }, 8000);
    }).then(function (res) {
      if (!res.ok) return [];
      return res.json();
    }).then(function (list) {
      var out = [];
      (list || []).forEach(function (hit) {
        if (!hit || hit.lat == null || hit.lon == null) return;
        var lat = Number(hit.lat), lon = Number(hit.lon);
        if (!isUsPlace(hit.address, lon, lat) && (hit.address && hit.address.country_code && String(hit.address.country_code).toLowerCase() !== 'us')) return;
        out.push({ lat: lat, lon: lon, label: placeLabelFromNominatim(hit, q) });
      });
      return out;
    }).catch(function () { return []; });
  }

  function suggestPlaces(q) {
    q = String(q || '').trim();
    if (q.length < 3) return Promise.resolve([]);
    var cache = state.suggestCache || (state.suggestCache = {});
    var key = q.toLowerCase();
    if (cache[key]) return Promise.resolve(cache[key]);
    var url = PHOTON_URL + '?q=' + encodeURIComponent(q) + '&limit=6&lang=en&bbox=' + US_BBOX;
    return fetchTimed(url, {}, 8000).then(function (res) {
      if (!res.ok) throw new Error('photon');
      return res.json();
    }).then(function (data) {
      var out = [];
      ((data && data.features) || []).forEach(function (feat) {
        if (!feat || !feat.geometry || !feat.geometry.coordinates) return;
        var lon = feat.geometry.coordinates[0];
        var lat = feat.geometry.coordinates[1];
        if (!isUsPlace(feat.properties, lon, lat)) return;
        out.push({ lat: lat, lon: lon, label: placeLabelFromPhoton(feat.properties, q) });
      });
      return out;
    }).then(function (items) {
      if (items && items.length) {
        cache[key] = items;
        return items;
      }
      return suggestNominatim(q).then(function (list) {
        cache[key] = list || [];
        return cache[key];
      });
    }).catch(function () {
      return suggestNominatim(q).then(function (list) {
        cache[key] = list || [];
        return cache[key];
      });
    });
  }

  function geocodeQuery(q) {
    q = String(q || '').trim();
    if (!q) return Promise.reject(new Error('Enter a city or address.'));
    var cache = state.geoCache || (state.geoCache = loadJsonStore(GEO_CACHE_KEY));
    var key = q.toLowerCase();
    if (cache[key] && cache[key].lat != null) return Promise.resolve(cache[key]);
    var url = PHOTON_URL + '?q=' + encodeURIComponent(q) + '&limit=1&lang=en&bbox=' + US_BBOX;
    return fetchTimed(url, {}, 8000).then(function (res) {
      if (!res.ok) throw new Error('photon');
      return res.json();
    }).then(function (data) {
      var feat = data && data.features && data.features[0];
      if (!feat || !feat.geometry || !feat.geometry.coordinates) throw new Error('photon');
      var lon = feat.geometry.coordinates[0];
      var lat = feat.geometry.coordinates[1];
      if (!isUsPlace(feat.properties, lon, lat)) throw new Error('photon');
      var rec = {
        lon: lon,
        lat: lat,
        label: placeLabelFromPhoton(feat.properties, q)
      };
      cache[key] = rec;
      saveJsonStore(GEO_CACHE_KEY, cache);
      return rec;
    }).catch(function () {
      var url2 = NOMINATIM_URL + '?format=jsonv2&addressdetails=1&limit=1&countrycodes=us&q=' + encodeURIComponent(q);
      return fetchTimed(url2, { headers: { Accept: 'application/json' } }, 8000).then(function (res) {
        if (!res.ok) throw new Error('nominatim');
        return res.json();
      }).then(function (list) {
        var hit = list && list[0];
        if (!hit) throw new Error('No match for that place.');
        var rec = {
          lat: Number(hit.lat),
          lon: Number(hit.lon),
          label: placeLabelFromNominatim(hit, q)
        };
        cache[key] = rec;
        saveJsonStore(GEO_CACHE_KEY, cache);
        return rec;
      });
    });
  }

  function reverseGeocode(lat, lon) {
    var url = PHOTON_REV + '?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
    return fetchTimed(url, {}, 8000).then(function (res) { return res.ok ? res.json() : null; }).then(function (data) {
      var feat = data && data.features && data.features[0];
      var label = placeLabelFromPhoton(feat && feat.properties, 'Dropped pin');
      return { lat: lat, lon: lon, label: label || (Number(lat).toFixed(3) + ', ' + Number(lon).toFixed(3)) };
    }).catch(function () {
      return { lat: lat, lon: lon, label: Number(lat).toFixed(3) + ', ' + Number(lon).toFixed(3) };
    });
  }

  function recallTruckAt() {
    try {
      var raw = localStorage.getItem(TRUCK_AT_KEY);
      var rec = raw ? JSON.parse(raw) : null;
      if (rec && isFinite(Number(rec.lat)) && isFinite(Number(rec.lon))) {
        state.truckAt = { lat: Number(rec.lat), lon: Number(rec.lon), label: rec.label || '', source: rec.source || 'saved' };
      }
    } catch (err) { state.truckAt = null; }
  }

  function rememberTruckAt(rec) {
    state.truckAt = rec;
    refreshTruckFuel();
    try {
      if (rec) localStorage.setItem(TRUCK_AT_KEY, JSON.stringify(rec));
      else localStorage.removeItem(TRUCK_AT_KEY);
    } catch (err) { /* ignore */ }
  }

  function scanOriginName() {
    var o = state.searches && state.searches.origin;
    o = o ? String(o).replace(/\s*\(.*\)\s*$/, '') : '';
    return o || 'scan origin';
  }

  function scanOriginPoint() {
    var c = state.searches && state.searches.origin_coord;
    if (c && c.lat != null && c.lon != null) {
      return { lat: Number(c.lat), lon: Number(c.lon), label: scanOriginName() };
    }
    return null;
  }

  function currentTruckPoint() {
    if (state.truckAt && state.truckAt.lat != null) return state.truckAt;
    return scanOriginPoint();
  }


  var FRESH_PULL_FLAG = 'blackram_fresh_pull_v1';
  var FRESH_PULL_CODE_KEY = 'blackram_fresh_pull_code';
  var FRESH_PULL_URL_KEY = 'blackram_fresh_pull_webhook';
  var FALLBACK_LOADED = 1.14;
  var FALLBACK_DEADHEAD = 0.30;
  var DEFAULT_MPG = 8;
  var DEFAULT_DEF_PER_MI = 0.034;

  var STATE_NAMES = {
    ALABAMA:'AL', ALASKA:'AK', ARIZONA:'AZ', ARKANSAS:'AR', CALIFORNIA:'CA',
    COLORADO:'CO', CONNECTICUT:'CT', DELAWARE:'DE', FLORIDA:'FL', GEORGIA:'GA',
    HAWAII:'HI', IDAHO:'ID', ILLINOIS:'IL', INDIANA:'IN', IOWA:'IA', KANSAS:'KS',
    KENTUCKY:'KY', LOUISIANA:'LA', MAINE:'ME', MARYLAND:'MD', MASSACHUSETTS:'MA',
    MICHIGAN:'MI', MINNESOTA:'MN', MISSISSIPPI:'MS', MISSOURI:'MO', MONTANA:'MT',
    NEBRASKA:'NE', NEVADA:'NV', 'NEW HAMPSHIRE':'NH', 'NEW JERSEY':'NJ',
    'NEW MEXICO':'NM', 'NEW YORK':'NY', 'NORTH CAROLINA':'NC', 'NORTH DAKOTA':'ND',
    OHIO:'OH', OKLAHOMA:'OK', OREGON:'OR', PENNSYLVANIA:'PA', 'RHODE ISLAND':'RI',
    'SOUTH CAROLINA':'SC', 'SOUTH DAKOTA':'SD', TENNESSEE:'TN', TEXAS:'TX',
    UTAH:'UT', VERMONT:'VT', VIRGINIA:'VA', WASHINGTON:'WA', 'WEST VIRGINIA':'WV',
    WISCONSIN:'WI', WYOMING:'WY', 'DISTRICT OF COLUMBIA':'DC'
  };

  function stateFromText(text) {
    if (!text) return null;
    var s = String(text);
    var m = s.match(/,\s*([A-Z]{2})(?:\s|,|$)/);
    if (m) return m[1];
    var up = s.toUpperCase().replace(/[^A-Z ]/g, ' ');
    var name;
    for (name in STATE_NAMES) {
      if (up.indexOf(name) !== -1) return STATE_NAMES[name];
    }
    return null;
  }

  function fallbackFuel() {
    return {
      diesel_usd_gal: null,
      diesel_source: 'fallback $1.14/loaded mi + $0.30/empty mi',
      diesel_region: null,
      diesel_stop: null,
      mpg: DEFAULT_MPG,
      def_per_mi: DEFAULT_DEF_PER_MI,
      fuel_per_mi: FALLBACK_LOADED,
      fallback: true
    };
  }

  function fuelFromPrices(prices, st) {
    var eia = prices && prices.eia;
    if (!eia || !eia.regions) return fallbackFuel();
    var map = prices.state_to_region || {};
    var code = (st && map[st]) || 'US';
    var info = eia.regions[code] || eia.regions.US;
    if (!info || info.usd_gal == null) return fallbackFuel();
    var mpg = Number(prices.mpg) > 0 ? Number(prices.mpg) : DEFAULT_MPG;
    var defp = prices.def_per_mi != null ? Number(prices.def_per_mi) : DEFAULT_DEF_PER_MI;
    var eiaPrice = Number(info.usd_gal);
    var premium = prices.pump_premium_usd_gal != null ? Number(prices.pump_premium_usd_gal) : 0;
    var diesel = Math.round((eiaPrice + premium) * 1000) / 1000;
    var fpm = Math.round((diesel / mpg + defp) * 1000) / 1000;
    return {
      diesel_usd_gal: diesel,
      diesel_eia_usd_gal: eiaPrice,
      pump_premium_usd_gal: Math.round(premium * 1000) / 1000,
      diesel_source: 'EIA ' + (info.name || code) + ' ' + money3(eiaPrice) + ' + our pump premium ' + money3(premium),
      diesel_region: code,
      diesel_stop: null,
      mpg: mpg,
      def_per_mi: defp,
      fuel_per_mi: fpm,
      fallback: false
    };
  }

  function refreshTruckFuel() {
    state.truckFuel = null;
    var p = state.truckAt;
    if (!p || !state.dieselPrices) return;
    var st = stateFromText(p.label || '');
    if (!st) return;
    state.truckFuel = fuelFromPrices(state.dieselPrices, st);
  }

  function currentFuel(row) {
    if (state.truckFuel && !state.truckFuel.fallback) return state.truckFuel;
    if (row && row.fuel && row.fuel.fuel_per_mi != null && !row.fuel.fallback) return row.fuel;
    if (state.dieselPrices) {
      var st = row ? stateFromText(row.origin || '') : null;
      var f = fuelFromPrices(state.dieselPrices, st);
      if (f && !f.fallback) return f;
    }
    return fallbackFuel();
  }

  function moneyFmt(n, places) {
    var v = Number(n);
    var sign = v < 0 ? '-' : '';
    return sign + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
  }
  function money2(n) { return moneyFmt(n, 2); }
  function money3(n) { return moneyFmt(n, 3); }
  function dieselPhrase(fuel, places) {
    places = places == null ? 2 : places;
    var m = function (n) { return moneyFmt(n, places); };
    if (!fuel || fuel.fallback || fuel.diesel_eia_usd_gal == null) {
      return 'Diesel ' + m(fuel && fuel.diesel_usd_gal) + '/gal';
    }
    return 'Diesel ' + m(fuel.diesel_usd_gal) + '/gal (EIA region ' +
      m(fuel.diesel_eia_usd_gal) + ' + our pump premium ' +
      m(fuel.pump_premium_usd_gal) + ')';
  }

  function applyFuelNet(rate, trip, dh, fuel) {
    var after = Math.round(Number(rate) * 0.87 * 100) / 100;
    var feeAmt = Math.round((Number(rate) - after) * 100) / 100;
    var net, math, cost;
    if (!fuel || fuel.fallback) {
      var loadedCost = Math.round(FALLBACK_LOADED * trip * 100) / 100;
      var dhCost = Math.round(FALLBACK_DEADHEAD * dh * 100) / 100;
      net = Math.round((after - loadedCost - dhCost) * 100) / 100;
      math = 'Rate ' + money2(rate) + ' x 0.87 = ' + money2(after) +
        ' after the 13% Totni fee (' + money2(feeAmt) + '). Fuel and DEF $1.14 x ' +
        Math.round(trip).toLocaleString('en-US') + ' mi = ' + money2(loadedCost) +
        '. Empty miles $0.30 x ' + Math.round(dh).toLocaleString('en-US') + ' mi = ' +
        money2(dhCost) + '. Net EST ' + money2(net) + '.';
    } else {
      var total = trip + dh;
      cost = Math.round(fuel.fuel_per_mi * total * 100) / 100;
      net = Math.round((after - cost) * 100) / 100;
      math = 'Rate ' + money2(rate) + ' x 0.87 = ' + money2(after) +
        ' after the 13% Totni fee (' + money2(feeAmt) + '). ' +
        dieselPhrase(fuel, 3) + ' at ' +
        Number(fuel.mpg).toFixed(1) + ' mpg plus ' + money3(fuel.def_per_mi) +
        '/mi DEF = ' + money3(fuel.fuel_per_mi) + '/mi. Fuel ' +
        money3(fuel.fuel_per_mi) + ' x ' + Math.round(total).toLocaleString('en-US') +
        ' mi (loaded+empty) = ' + money2(cost) + '. Net EST ' + money2(net) + '.';
    }
    return { net: net, after: after, math: math, fuel: fuel };
  }

  function fuelLine(fuel) {
    if (!fuel) return '';
    if (fuel.fallback) {
      return '<p class="search-fuel">Fuel: fallback $1.14/loaded mi + $0.30/empty mi (no diesel price on file)</p>';
    }
    var stop = fuel.diesel_stop ? ' · ' + fuel.diesel_stop : '';
    return '<p class="search-fuel">' + esc(dieselPhrase(fuel, 2)) + stop +
      ' · ' + Number(fuel.mpg).toFixed(1) + ' mpg + ' + money3(fuel.def_per_mi) + '/mi DEF · ' +
      money3(fuel.fuel_per_mi) + '/mi</p>';
  }

  function loadDieselPrices() {
    return fetchTimed('data/diesel_prices.json?t=' + Date.now(), { cache: 'no-cache' }, 10000).then(function (res) {
      if (!res.ok) throw new Error('diesel');
      return res.json();
    }).then(function (data) {
      state.dieselPrices = data;
      refreshTruckFuel();
      if (state.searches) {
        state.scoredSearches = applyLocalScoring(cloneData(state.searches));
        if (state.tab === 'searches') renderSearches();
      }
    }).catch(function () { /* keep pipeline numbers / fallback */ });
  }

  function freshPullEnabled() {
    try { return localStorage.getItem(FRESH_PULL_FLAG) === '1'; } catch (err) { return false; }
  }

  function renderFreshPull() {
    if (!freshPullEnabled()) return '';
    var origin = currentTruckPoint() || {};
    var originLabel = origin.label || '';
    return '<div class="fresh-pull" id="fresh-pull">' +
      '<h3>Pull fresh loads</h3>' +
      '<p class="fine">On-demand board search. Not connected yet \u2014 this form only prepares the request.</p>' +
      '<form id="fresh-pull-form" action="#" class="fresh-pull-form">' +
        '<label class="fresh-pull-field">Origin' +
          '<div class="truck-at-lookup">' +
            '<input type="text" id="fresh-origin" placeholder="City, address, or ZIP" value="' + esc(originLabel) + '" autocomplete="off" autocapitalize="words">' +
            '<ul class="truck-at-suggests" id="fresh-origin-suggests" hidden></ul>' +
          '</div></label>' +
        '<button type="button" id="fresh-origin-gps">Use my GPS</button>' +
        '<label class="fresh-pull-anywhere"><input type="checkbox" id="fresh-anywhere" checked> Anywhere</label>' +
        '<label class="fresh-pull-field" id="fresh-dest-wrap">Destination' +
          '<div class="truck-at-lookup">' +
            '<input type="text" id="fresh-dest" placeholder="City, address, or ZIP" autocomplete="off" autocapitalize="words" disabled>' +
            '<ul class="truck-at-suggests" id="fresh-dest-suggests" hidden></ul>' +
          '</div></label>' +
        '<label class="fresh-pull-field">Deadhead radius' +
          '<select id="fresh-radius">' +
            '<option value="50">50 mi</option>' +
            '<option value="100" selected>100 mi</option>' +
            '<option value="150">150 mi</option>' +
            '<option value="250">250 mi</option>' +
          '</select></label>' +
        '<button type="submit" class="primary" id="fresh-pull-go">Pull fresh loads</button>' +
      '</form>' +
      '<p class="fresh-pull-status" id="fresh-pull-status"></p>' +
      '</div>';
  }

  function bindSuggestInput(inputId, listId, onPick) {
    var input = $(inputId);
    var box = $(listId);
    if (!input || !box) return;
    var timer = null, gen = 0;
    input.addEventListener('input', function () {
      var q = input.value || '';
      if (timer) clearTimeout(timer);
      if (q.trim().length < 3) { box.hidden = true; box.innerHTML = ''; return; }
      var g = ++gen;
      timer = setTimeout(function () {
        suggestPlaces(q).then(function (items) {
          if (g !== gen) return;
          if (!items || !items.length) { box.hidden = true; box.innerHTML = ''; return; }
          box.innerHTML = items.map(function (it, i) {
            return '<li><button type="button" class="truck-at-suggest" data-idx="' + i + '">' + esc(it.label) + '</button></li>';
          }).join('');
          box._items = items;
          box.hidden = false;
        }).catch(function () { box.hidden = true; });
      }, 300);
    });
    box.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.truck-at-suggest') : null;
      if (!btn) return;
      var rec = (box._items || [])[Number(btn.getAttribute('data-idx'))];
      if (!rec) return;
      input.value = rec.label;
      box.hidden = true;
      if (onPick) onPick(rec);
    });
  }

  function bindFreshPull() {
    if (!freshPullEnabled()) return;
    var form = $('fresh-pull-form');
    if (!form || form._bound) return;
    form._bound = true;
    var originRec = currentTruckPoint() ? { label: currentTruckPoint().label, lat: currentTruckPoint().lat, lon: currentTruckPoint().lon } : null;
    var destRec = null;
    bindSuggestInput('fresh-origin', 'fresh-origin-suggests', function (rec) { originRec = rec; });
    bindSuggestInput('fresh-dest', 'fresh-dest-suggests', function (rec) { destRec = rec; });
    var any = $('fresh-anywhere');
    var dest = $('fresh-dest');
    function syncAnywhere() {
      if (dest) dest.disabled = !!(any && any.checked);
      var wrap = $('fresh-dest-wrap');
      if (wrap) wrap.hidden = !!(any && any.checked);
    }
    if (any) any.addEventListener('change', syncAnywhere);
    syncAnywhere();
    var gps = $('fresh-origin-gps');
    if (gps) gps.addEventListener('click', function () {
      if (!navigator.geolocation) {
        var st = $('fresh-pull-status');
        if (st) st.textContent = 'This browser cannot share a location.';
        return;
      }
      navigator.geolocation.getCurrentPosition(function (pos) {
        reverseGeocode(pos.coords.latitude, pos.coords.longitude).then(function (rec) {
          originRec = rec;
          var inp = $('fresh-origin');
          if (inp) inp.value = rec.label || '';
        });
      }, function () {
        var st2 = $('fresh-pull-status');
        if (st2) st2.textContent = 'Location was not available.';
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      // Not wired: a later pass will POST this payload to the webhook URL
      // in localStorage (blackram_fresh_pull_webhook) with the code in
      // blackram_fresh_pull_code. Do not send anything yet.
      var payload = {
        origin: originRec && originRec.lat != null ? { label: originRec.label, lat: originRec.lat, lon: originRec.lon } : null,
        destination: (any && any.checked) ? 'anywhere' : (destRec && destRec.lat != null ? { label: destRec.label, lat: destRec.lat, lon: destRec.lon } : null),
        radius_mi: Number($('fresh-radius') && $('fresh-radius').value) || 100,
        code: null
      };
      try { payload.code = localStorage.getItem(FRESH_PULL_CODE_KEY) || null; } catch (err) { payload.code = null; }
      var st = $('fresh-pull-status');
      if (st) st.textContent = 'On-demand search is not connected yet. The request would be ' +
        '{origin:{label,lat,lon}, destination:{label,lat,lon}|\"anywhere\", radius_mi, code}.';
      try { console.log('fresh-pull payload (not sent)', payload); } catch (err2) { /* ignore */ }
    });
  }

  function scoreSearchLoad(row) {
    var trip = rowLoadedMiles(row);
    var dh = rowEmptyMiles(row);
    var rate = row.posted_rate;
    var total = trip + dh;
    var sameDay = total > 0 && total < 250;
    var bar = sameDay ? 300 : 500;
    var fuel = currentFuel(row);
    var net = null;
    var fuelMath = null;
    if (rate != null && isFinite(Number(rate)) && trip > 0) {
      fuelMath = applyFuelNet(rate, trip, dh, fuel);
      net = fuelMath.net;
    }
    var flags = [];
    var hard = false;
    if (row.weight_lb != null && Number(row.weight_lb) > 15300) {
      flags.push('Over 15,300 lb payload - cannot haul');
      hard = true;
    } else if (row.weight_lb != null && Number(row.weight_lb) > 12500) {
      flags.push('12,501-15,300 lb, scale check, load centered just ahead of trailer axles');
    }
    if (row.length_ft != null && Number(row.length_ft) > 40) {
      flags.push('Over 40 ft deck - cannot haul');
      hard = true;
    }
    if (row.weight_lb == null) flags.push('weight not listed');
    var keepFlags = (row.fit_flags || []).filter(function (f) {
      return /infeasible|cannot haul|misses the|pickup is only/i.test(String(f));
    });
    flags = flags.concat(keepFlags);
    if (keepFlags.length) hard = true;
    row.net_est = net;
    row.fuel = fuel;
    if (fuelMath) row.math = fuelMath.math;
    row.total_mi = total;
    row.same_day = sameDay;
    row.bar = bar;
    row.hours = hoursEst(trip, dh, 1);
    row.per_hour = (net != null && row.hours) ? net / row.hours : null;
    row.net_per_mile = netPerMileValue({ net_est: net, trip_mi: trip, origin_dh_mi: dh, total_mi: total });
    row.gross_per_mile = grossPerMileValue({ posted_rate: rate, trip_mi: trip, origin_dh_mi: dh, total_mi: total });
    delete row.days;
    delete row.net_per_day;
    var days = tripDaysForRow(row, 1);
    var npd = (net != null && days) ? net / days : null;
    row.days = days;
    row.net_per_day = npd == null ? null : Math.round(npd * 100) / 100;
    var verdict;
    if (net == null) verdict = 'PASS';
    else if (hard || net < bar) verdict = 'PASS';
    else if (flags.length) verdict = 'MAYBE';
    else verdict = 'TAKE';
    if (npd != null && npd < MIN_NET_PER_DAY) {
      flags.push('net per day under $300');
      if (verdict === 'TAKE') verdict = 'MAYBE';
    }
    row.fit_flags = flags;
    row.verdict = verdict;
    delete row.reason;
    row.reason = verdictReason(row);
    return row;
  }

  function rescoreCombo(combo, origCombo) {
    var loads = combo.loads || [];
    var origLoads = (origCombo && origCombo.loads) || [];
    var first = loads[0];
    var origFirst = origLoads[0];
    var extra = 0;
    if (first && origFirst) extra = rowEmptyMiles(first) - rowEmptyMiles(origFirst);
    var dead = (Number(origCombo && origCombo.deadhead_mi) || 0) + extra;
    combo.deadhead_mi = Math.round(dead * 10) / 10;
    combo.total_mi = Math.round(((Number(combo.loaded_mi) || 0) + dead) * 10) / 10;
    var fuel = currentFuel(combo.loads && combo.loads[0] ? combo.loads[0] : combo);
    combo.fuel = fuel;
    if (combo.after_fee != null && combo.loaded_mi != null) {
      var loaded = Number(combo.loaded_mi) || 0;
      if (fuel && !fuel.fallback) {
        var cost = Math.round(fuel.fuel_per_mi * (loaded + dead) * 100) / 100;
        combo.net_est = Math.round((Number(combo.after_fee) - cost) * 100) / 100;
        combo.math = 'Rates after the 13% Totni fee ' + money2(combo.after_fee) + '. ' +
          dieselPhrase(fuel, 3) + ' at ' +
          Number(fuel.mpg).toFixed(1) + ' mpg plus ' + money3(fuel.def_per_mi) +
          '/mi DEF = ' + money3(fuel.fuel_per_mi) + '/mi. Fuel ' +
          money3(fuel.fuel_per_mi) + ' x ' + Math.round(loaded + dead).toLocaleString('en-US') +
          ' mi (loaded+empty) = ' + money2(cost) + '. Net EST ' + money2(combo.net_est) + '.';
      } else {
        combo.net_est = Math.round((Number(combo.after_fee) - FALLBACK_LOADED * loaded - FALLBACK_DEADHEAD * dead) * 100) / 100;
      }
    }
    delete combo.days;
    delete combo.net_per_day;
    var days = rowDays(combo, loads.length);
    var npd = (combo.net_est != null && days) ? combo.net_est / days : null;
    combo.days = days;
    combo.net_per_day = npd == null ? null : Math.round(npd * 100) / 100;
    if (npd != null && npd < MIN_NET_PER_DAY) {
      combo.flags = (combo.flags || []).concat(['net per day under $300']);
      if (combo.verdict === 'TAKE') {
        combo.verdict = 'MAYBE';
        combo.reason = 'Clears the combo bar, but net per day is under $300.';
      }
    }
    return combo;
  }

  function cloneData(data) {
    try { return JSON.parse(JSON.stringify(data)); } catch (err) { return data; }
  }

  function matchScoredLoad(scored, row) {
    var i, s;
    for (i = 0; i < scored.length; i++) {
      s = scored[i];
      if (row.load_number && s.load_number && String(row.load_number) === String(s.load_number) && s.board === row.board) return s;
    }
    for (i = 0; i < scored.length; i++) {
      s = scored[i];
      if (s.origin === row.origin && s.destination === row.destination && s.board === row.board) return s;
    }
    return null;
  }

  function applyLocalScoring(data) {
    var loads = data.loads || [];
    loads.forEach(function (row) { scoreSearchLoad(row); });
    var orig = state.searches || data;
    (data.combos || []).forEach(function (combo, i) {
      (combo.loads || []).forEach(function (leg) {
        var src = matchScoredLoad(loads, leg);
        if (src) {
          leg.origin_dh_mi = src.origin_dh_mi;
          leg.net_est = src.net_est;
          leg.days = src.days;
          leg.net_per_day = src.net_per_day;
          leg.verdict = src.verdict;
          leg.reason = src.reason;
          leg.hours = src.hours;
          leg.per_hour = src.per_hour;
          leg.net_per_mile = src.net_per_mile;
          leg.gross_per_mile = src.gross_per_mile;
          leg.total_mi = src.total_mi;
        } else {
          scoreSearchLoad(leg);
        }
      });
      rescoreCombo(combo, (orig.combos || [])[i] || combo);
    });
    var counts = { total: loads.length, take: 0, maybe: 0, pass: 0 };
    loads.forEach(function (row) {
      var v = String(row.verdict || 'PASS').toLowerCase();
      if (counts[v] != null) counts[v] += 1;
    });
    data.counts = counts;
    return data;
  }

  function truckAtStatusText() {
    var p = currentTruckPoint();
    var label = p && p.label ? p.label : scanOriginName();
    var text = 'Deadhead from <strong>' + esc(label) + '</strong>';
    if (state.truckAtBusy) text += ' · updating miles…';
    if (state.truckAtError) text += ' · ' + esc(state.truckAtError);
    return text;
  }

  function hideTruckSuggests() {
    var box = $('truck-at-suggests');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    box._items = null;
  }

  function placeSuggestList(box) {
    if (!box || box.hidden) return;
    box.classList.remove('is-above');
    var wrap = box.parentNode;
    if (!wrap || !wrap.getBoundingClientRect) return;
    var rect = wrap.getBoundingClientRect();
    var vv = window.visualViewport;
    var viewBottom = vv ? (vv.offsetTop + vv.height) : window.innerHeight;
    var roomBelow = viewBottom - rect.bottom;
    var roomAbove = rect.top - (vv ? vv.offsetTop : 0);
    var need = Math.min(240, box.scrollHeight || 240);
    if (roomBelow < need && roomAbove > roomBelow) box.classList.add('is-above');
    try { wrap.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (err) {
      try { wrap.scrollIntoView(true); } catch (e2) { /* ignore */ }
    }
  }

  function renderTruckSuggests(items) {
    var box = $('truck-at-suggests');
    var input = $('truck-at-input');
    if (!box) return;
    if (!items || !items.length) {
      hideTruckSuggests();
      if (input) input.setAttribute('aria-expanded', 'false');
      return;
    }
    box.innerHTML = items.map(function (it, i) {
      return '<li role="option"><button type="button" class="truck-at-suggest" data-idx="' + i + '">' + esc(it.label) + '</button></li>';
    }).join('');
    box._items = items;
    box.hidden = false;
    if (input) input.setAttribute('aria-expanded', 'true');
    placeSuggestList(box);
  }

  function nearbyPickupPins(origin) {
    var data = viewSearches();
    var loads = (data && data.loads) || [];
    var seen = {};
    var pins = [];
    loads.forEach(function (row) {
      var c = row.origin_coord;
      if (!c || c.lat == null || c.lon == null) return;
      var key = Number(c.lat).toFixed(3) + ',' + Number(c.lon).toFixed(3);
      if (seen[key]) return;
      seen[key] = true;
      var dlat = (Number(c.lat) - origin.lat) * 69;
      var dlng = (Number(c.lon) - origin.lon) * 69 * Math.cos(origin.lat * Math.PI / 180);
      var mi = Math.sqrt(dlat * dlat + dlng * dlng);
      pins.push({
        lat: Number(c.lat),
        lon: Number(c.lon),
        label: row.origin || row.pickup || 'Pickup',
        mi: mi
      });
    });
    pins.sort(function (a, b) { return a.mi - b.mi; });
    return pins.slice(0, 12);
  }

  function renderTruckMap() {
    var el = $('truck-at-map');
    if (truckMap) {
      try { truckMap.remove(); } catch (err) { /* ignore */ }
      truckMap = null;
    }
    if (!el) return;
    var p = state.truckAt;
    if (!p || p.lat == null || p.lon == null || typeof L === 'undefined') {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    el.innerHTML = '';
    truckMap = L.map(el, {
      scrollWheelZoom: false,
      attributionControl: true,
      tap: true
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(truckMap);
    var truckPin = L.circleMarker([p.lat, p.lon], {
      radius: 9,
      color: '#D4A62A',
      weight: 2,
      fillColor: '#6B3FA0',
      fillOpacity: 1
    }).addTo(truckMap).bindPopup(p.label || 'Truck');
    nearbyPickupPins(p).forEach(function (pin) {
      if (pin.mi > 150) return;
      var m = L.circleMarker([pin.lat, pin.lon], {
        radius: 6,
        color: '#c9c4d6',
        weight: 1,
        fillColor: '#c9c4d6',
        fillOpacity: 0.85
      }).addTo(truckMap);
      m.bindPopup(pin.label + (pin.mi != null ? ' · ' + Math.round(pin.mi) + ' mi' : ''));
    });
    // Stay zoomed on the truck so a street or city pin is readable. Nearby
    // pickup dots remain on the map if he zooms out.
    truckMap.setView([p.lat, p.lon], 13);
    setTimeout(function () { if (truckMap) truckMap.invalidateSize(); }, 0);
  }

  function renderTruckAt() {
    var value = (state.truckAt && state.truckAt.label) || '';
    var maxv = String(state.maxDeadhead || 0);
    var showMap = !!(state.truckAt && state.truckAt.lat != null);
    return '<div class="truck-at" id="truck-at">' +
      '<h3>Truck is at</h3>' +
      '<form id="truck-at-form" action="#" class="truck-at-row">' +
        '<div class="truck-at-lookup">' +
          '<input type="text" id="truck-at-input" placeholder="City, address, or ZIP" value="' + esc(value) + '" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="truck-at-suggests" enterkeyhint="search">' +
          '<ul class="truck-at-suggests" id="truck-at-suggests" role="listbox" hidden></ul>' +
        '</div>' +
        '<button type="submit" class="primary" id="truck-at-set">Set</button>' +
        '<button type="button" id="truck-at-geo">Use my location</button>' +
        '<button type="button" id="truck-at-reset">Reset to scan origin</button>' +
      '</form>' +
      '<p class="truck-at-status" id="truck-at-status">' + truckAtStatusText() + '</p>' +
      '<div id="truck-at-map" class="truck-at-map"' + (showMap ? '' : ' hidden') + '></div>' +
      '<p class="truck-at-filter"><label>Max deadhead ' +
        '<select id="max-deadhead">' +
          '<option value="0"' + (maxv === '0' ? ' selected' : '') + '>Any</option>' +
          '<option value="150"' + (maxv === '150' ? ' selected' : '') + '>150 mi</option>' +
          '<option value="250"' + (maxv === '250' ? ' selected' : '') + '>250 mi</option>' +
          '<option value="300"' + (maxv === '300' ? ' selected' : '') + '>300 mi</option>' +
        '</select></label></p>' +
      '</div>';
  }

  function bindTruckAt() {
    var form = $('truck-at-form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      hideTruckSuggests();
      setTruckFromQuery($('truck-at-input') && $('truck-at-input').value);
    });
    var input = $('truck-at-input');
    if (input) {
      input.addEventListener('input', function () {
        var q = input.value || '';
        if (suggestTimer) clearTimeout(suggestTimer);
        if (q.trim().length < 3) {
          hideTruckSuggests();
          return;
        }
        var gen = ++suggestGen;
        suggestTimer = setTimeout(function () {
          suggestPlaces(q).then(function (items) {
            if (gen !== suggestGen) return;
            if (input.value.trim() !== q.trim() && input.value.trim().toLowerCase() !== q.trim().toLowerCase()) return;
            renderTruckSuggests(items);
          }).catch(function () {
            if (gen !== suggestGen) return;
            hideTruckSuggests();
          });
        }, 300);
      });
      input.addEventListener('focus', function () {
        setTimeout(function () {
          var wrap = input.parentNode;
          if (wrap && wrap.scrollIntoView) {
            try { wrap.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (err) { wrap.scrollIntoView(true); }
          }
          placeSuggestList($('truck-at-suggests'));
        }, 350);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') hideTruckSuggests();
      });
    }
    var box = $('truck-at-suggests');
    if (box) box.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.truck-at-suggest') : null;
      if (!btn) return;
      e.preventDefault();
      var items = box._items || [];
      var rec = items[Number(btn.getAttribute('data-idx'))];
      if (!rec) return;
      if (input) input.value = rec.label;
      hideTruckSuggests();
      setTruckFromRecord(rec, 'typed');
    });
    var geo = $('truck-at-geo');
    if (geo) geo.addEventListener('click', setTruckFromGeo);
    var reset = $('truck-at-reset');
    if (reset) reset.addEventListener('click', resetTruckAt);
    var sel = $('max-deadhead');
    if (sel) sel.addEventListener('change', function () {
      state.maxDeadhead = Number(sel.value) || 0;
      if (state.tab === 'searches') renderSearches();
    });
    renderTruckMap();
  }

  function setTruckFromRecord(rec, source) {
    if (!rec || rec.lat == null || rec.lon == null) return Promise.reject(new Error('Could not find that place.'));
    rememberTruckAt({ lat: rec.lat, lon: rec.lon, label: rec.label || '', source: source || 'typed' });
    state.truckAtError = '';
    state.truckAtBusy = false;
    return refreshDeadheads();
  }

  function setTruckFromQuery(q) {
    state.truckAtError = '';
    state.truckAtBusy = true;
    if (state.tab === 'searches') {
      var st = $('truck-at-status');
      if (st) st.innerHTML = truckAtStatusText();
    }
    return geocodeQuery(q).then(function (rec) {
      rec.label = rec.label || q;
      return setTruckFromRecord(rec, 'typed');
    }).catch(function (err) {
      state.truckAtBusy = false;
      state.truckAtError = (err && err.message) ? err.message : 'Could not find that place.';
      if (state.tab === 'searches') renderSearches();
    });
  }

  function setTruckFromGeo() {
    state.truckAtError = '';
    if (!navigator.geolocation) {
      state.truckAtError = 'This browser cannot share a location.';
      if (state.tab === 'searches') renderSearches();
      return;
    }
    state.truckAtBusy = true;
    if (state.tab === 'searches') {
      var st = $('truck-at-status');
      if (st) st.innerHTML = truckAtStatusText();
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      reverseGeocode(pos.coords.latitude, pos.coords.longitude).then(function (rec) {
        rememberTruckAt({ lat: rec.lat, lon: rec.lon, label: rec.label, source: 'geo' });
        state.truckAtBusy = false;
        return refreshDeadheads();
      });
    }, function () {
      state.truckAtBusy = false;
      state.truckAtError = 'Location was not available. You can type a city instead.';
      if (state.tab === 'searches') renderSearches();
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  function resetTruckAt() {
    rememberTruckAt(null);
    state.truckAtError = '';
    refreshDeadheads();
  }

  function refreshDeadheads() {
    var src = state.searches;
    if (!src) return Promise.resolve();
    var data = cloneData(src);
    var truck = currentTruckPoint();
    var targets = (data.loads || []).filter(function (row) { return row.origin_coord && row.origin_coord.lat != null; });
    if (!truck || !targets.length) {
      state.scoredSearches = applyLocalScoring(data);
      if (state.tab === 'searches') renderSearches();
      return Promise.resolve();
    }
    var same = scanOriginPoint();
    var close = same && Math.abs(same.lat - truck.lat) < 0.02 && Math.abs(same.lon - truck.lon) < 0.02 && !state.truckAt;
    if (close) {
      state.scoredSearches = applyLocalScoring(data);
      if (state.tab === 'searches') renderSearches();
      return Promise.resolve();
    }
    state.truckAtBusy = true;
    if (state.tab === 'searches') renderSearches();
    return poolMap(targets, 3, function (row) {
      return milesBetween(truck, row.origin_coord).then(function (mi) {
        if (mi != null) row.origin_dh_mi = mi;
      });
    }).then(function () {
      state.truckAtBusy = false;
      state.scoredSearches = applyLocalScoring(data);
      if (state.tab === 'searches') renderSearches();
    }).catch(function () {
      state.truckAtBusy = false;
      state.scoredSearches = applyLocalScoring(data);
      if (state.tab === 'searches') renderSearches();
    });
  }

  function viewSearches() {
    return state.scoredSearches || state.searches;
  }

  function bindRigPhoto() {
    var card = document.querySelector('details.rig-card');
    var img = $('rig-photo');
    var reflect = $('rig-reflect');
    function load() {
      if (!img || img.getAttribute('src')) return;
      var sources = img.parentNode ? img.parentNode.querySelectorAll('source[data-srcset]') : [];
      for (var i = 0; i < sources.length; i++) {
        sources[i].srcset = sources[i].getAttribute('data-srcset') || '';
      }
      if (img.getAttribute('data-srcset')) img.srcset = img.getAttribute('data-srcset');
      img.src = img.getAttribute('data-src') || '';
      if (reflect) {
        if (img.getAttribute('data-srcset')) reflect.srcset = img.getAttribute('data-srcset');
        reflect.src = img.getAttribute('data-src') || '';
      }
    }
    if (card && card.open) load();
    if (card) {
      card.addEventListener('toggle', function () {
        if (card.open) load();
      });
    }
  }

  function watchTabbar() {
    var nav = document.querySelector('.tabbar');
    if (!nav || nav._watched) return;
    nav._watched = true;
    var sentinel = document.createElement('div');
    sentinel.className = 'tabbar-sentinel';
    nav.parentNode.insertBefore(sentinel, nav);
    if (typeof IntersectionObserver !== 'function') return;
    var io = new IntersectionObserver(function (entries) {
      var hit = entries[0];
      nav.classList.toggle('is-stuck', !!(hit && !hit.isIntersecting));
    }, { threshold: [1] });
    io.observe(sentinel);
  }


  function hoursEst(loadedMi, deadMi, nLoads) {
    var loaded = Number(loadedMi) || 0;
    var dead = Number(deadMi) || 0;
    if (loaded <= 0 && dead <= 0) return null;
    var n = nLoads && nLoads > 0 ? nLoads : 1;
    return (loaded + dead) / PER_HOUR_MPH + LOAD_UNLOAD_HOURS * n;
  }

  function perHourValue(row, nLoads) {
    if (!row) return null;
    if (row.per_hour != null && isFinite(Number(row.per_hour))) return Number(row.per_hour);
    var loaded = rowLoadedMiles(row);
    var dead = rowEmptyMiles(row);
    var hours = row.hours != null && isFinite(Number(row.hours))
      ? Number(row.hours)
      : hoursEst(loaded, dead, nLoads || 1);
    if (row.net_est == null || hours == null || hours <= 0) return null;
    return row.net_est / hours;
  }

  function perHourLabel(row, nLoads) {
    var n = perHourValue(row, nLoads);
    if (n == null) return 'n/a/hr EST';
    return searchMoney(n) + '/hr EST';
  }

  function moneyPerMile(n) {
    if (n == null || !isFinite(n)) return 'n/a';
    var neg = n < 0;
    return (neg ? '-$' : '$') + Math.abs(n).toFixed(2);
  }

  function netPerMileValue(row) {
    if (!row) return null;
    if (row.net_per_mile != null && isFinite(Number(row.net_per_mile))) return Number(row.net_per_mile);
    var loaded = rowLoadedMiles(row);
    var dead = rowEmptyMiles(row);
    var miles = (Number(loaded) || 0) + (Number(dead) || 0);
    if (row.net_est == null || miles <= 0) return null;
    return row.net_est / miles;
  }

  function netPerMileLabel(row) {
    var n = netPerMileValue(row);
    if (n == null) return 'n/a/mi EST';
    return moneyPerMile(n) + '/mi EST';
  }

  function rowLoadedMiles(row) {
    if (!row) return 0;
    if (row.trip_mi != null && isFinite(Number(row.trip_mi))) return Number(row.trip_mi);
    if (row.loaded_mi != null && isFinite(Number(row.loaded_mi))) return Number(row.loaded_mi);
    return 0;
  }

  function rowEmptyMiles(row) {
    if (!row) return 0;
    if (row.origin_dh_mi != null && isFinite(Number(row.origin_dh_mi))) return Number(row.origin_dh_mi);
    if (row.empty_mi_est != null && isFinite(Number(row.empty_mi_est))) return Number(row.empty_mi_est);
    if (row.deadhead_mi != null && isFinite(Number(row.deadhead_mi))) return Number(row.deadhead_mi);
    return 0;
  }

  function rowTotalMiles(row) {
    var total = rowLoadedMiles(row) + rowEmptyMiles(row);
    return total > 0 ? total : null;
  }

  function grossPerMileValue(row) {
    if (!row) return null;
    if (row.gross_per_mile != null && isFinite(Number(row.gross_per_mile))) return Number(row.gross_per_mile);
    var rate = row.posted_rate != null ? row.posted_rate : row.gross;
    var miles = rowTotalMiles(row);
    if (rate == null || !isFinite(Number(rate)) || miles == null) return null;
    return Number(rate) / miles;
  }

  function rateLoadedValue(row) {
    if (!row) return null;
    if (row.rate_per_mi != null && isFinite(Number(row.rate_per_mi))) return Number(row.rate_per_mi);
    var rate = row.posted_rate != null ? row.posted_rate : row.gross;
    var loaded = rowLoadedMiles(row);
    if (rate == null || !isFinite(Number(rate)) || loaded <= 0) return null;
    return Number(rate) / loaded;
  }

  function hourTone(n) {
    if (n == null || !isFinite(Number(n))) return '';
    n = Number(n);
    if (n >= 35) return 'good';
    if (n >= 20) return 'ok';
    return 'low';
  }

  function mileTone(n) {
    if (n == null || !isFinite(Number(n))) return '';
    n = Number(n);
    if (n >= 0.8) return 'good';
    if (n >= 0.4) return 'ok';
    return 'low';
  }

  function rateMoney(n, digits) {
    if (n == null || !isFinite(Number(n))) return 'n/a';
    var neg = Number(n) < 0;
    return (neg ? '-$' : '$') + Math.abs(Number(n)).toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function rateTile(label, valueHtml, tone, subHtml) {
    var cls = 'rate-tile ' + (tone || 'neutral');
    return '<div class="' + cls + '">' +
      '<span class="rate-label">' + esc(label) + '</span>' +
      '<b class="rate-value">' + valueHtml + '</b>' +
      (subHtml ? '<span class="rate-sub">' + subHtml + '</span>' : '') +
      '</div>';
  }

  function rateCompare(row, nLoads) {
    if (!row) return '';
    var perHour = perHourValue(row, nLoads);
    var netMi = netPerMileValue(row);
    var grossMi = grossPerMileValue(row);
    var loadedMi = rateLoadedValue(row);
    var hour = (perHour != null && isFinite(Number(perHour)))
      ? rateTile('$/hr EST', esc(searchMoney(perHour)), hourTone(perHour))
      : '';
    var grossSub = '';
    if (loadedMi != null && isFinite(Number(loadedMi))) {
      grossSub = esc(rateMoney(loadedMi, 2)) + ' on loaded mi';
    }
    var gross = (grossMi != null && isFinite(Number(grossMi)))
      ? rateTile('Gross $/mi', esc(rateMoney(grossMi, 2)), 'neutral', grossSub)
      : '';
    var netmi = (netMi != null && isFinite(Number(netMi)))
      ? rateTile('Net $/mi', esc(rateMoney(netMi, 2)), mileTone(netMi))
      : '';
    if (!hour && !gross && !netmi) return '';
    return '<div class="rate-compare">' +
      hour +
      ((gross || netmi) ? '<div class="rate-pair">' + gross + netmi + '</div>' : '') +
      '</div>';
  }

  function netBlock(net, perHour, netPerMile, unitExtra, row, nLoads) {
    var compare = row ? rateCompare(row, nLoads) : '';
    if (!compare) {
      // Fallback if a caller has no row object
      compare = rateCompare({
        net_est: net,
        per_hour: perHour,
        net_per_mile: netPerMile
      }, nLoads);
    }
    return '<div class="search-net">' + esc(searchMoney(net)) +
      '<span class="unit">Net EST' + (unitExtra || '') + '</span>' +
      compare +
      (row ? tripDaysBlock(row, nLoads) : '') +
      '</div>';
  }

  function verdictReason(row) {
    if (!row) return '';
    if (row.reason) return String(row.reason);
    var verd = String(row.verdict || '').toUpperCase();
    var flags = row.fit_flags || row.flags || [];
    var hard = flags.filter(function (f) { return String(f).indexOf('cannot haul') !== -1; });
    if (verd === 'TAKE') return 'Clears the net bar and fits the deck.';
    if (verd === 'MAYBE') {
      if (flags.some(function (f) { return String(f).indexOf('net per day under $300') !== -1; })) {
        return 'Clears the net bar, but net per day is under $300.';
      }
      if (flags.some(function (f) { return String(f).indexOf('weight not listed') !== -1; })) {
        return 'Clears the net bar, but weight is not listed.';
      }
      if (flags.some(function (f) { return String(f).indexOf('12,501-15,300') !== -1 || String(f).indexOf('scale check') !== -1; })) {
        return 'Clears the net bar, but weight is 12,501-15,300 lb (scale check, load centered just ahead of trailer axles).';
      }
      return 'Clears the net bar, but check fit before you book.';
    }
    if (hard.length) {
      var text = String(hard[0]);
      return /[.]$/.test(text) ? text : text + '.';
    }
    if (row.net_est == null) return 'No posted rate or miles, so net cannot be figured.';
    var bar = row.same_day ? 300 : 500;
    if (row.bar != null && isFinite(Number(row.bar))) bar = Math.round(Number(row.bar));
    var barText = '$' + Number(bar).toLocaleString('en-US');
    return row.same_day
      ? 'Net EST is under the ' + barText + ' same-day bar.'
      : 'Net EST is under the ' + barText + ' bar.';
  }

  function statCell(label, value) {
    if (value == null || value === '') return '';
    return '<div><span>' + esc(label) + '</span><b>' + value + '</b></div>';
  }

  function loadStatRow(row, emptyFrom) {
    var cells = [];
    var strip = milesStrip(rowLoadedMiles(row) || null, row.origin_dh_mi != null ? row.origin_dh_mi : null,
      { emptyFrom: emptyFrom || '' });
    if (row.weight_lb != null) cells.push(statCell('Weight', esc(plainNum(row.weight_lb, 0)) + ' lb'));
    else cells.push(statCell('Weight', 'n/a'));
    if (row.length_ft != null) cells.push(statCell('Length', esc(plainNum(row.length_ft, 1)) + ' ft'));
    if (row.posted_rate != null) cells.push(statCell('Posted', esc(money(row.posted_rate))));
    return strip + (cells.length ? '<div class="stat-row">' + cells.join('') + '</div>' : '');
  }

  function searchOriginLabel() {
    if (state.truckAt && state.truckAt.label) return String(state.truckAt.label);
    var o = state.searches && state.searches.origin;
    o = o ? String(o).replace(/\s*\(.*\)\s*$/, '') : '';
    return o || 'truck';
  }

  function rateLegend() {
    return '<p class="rate-legend" aria-label="Dollar per hour and per mile color key">' +
      '<span class="rate-legend-label">$/hr and Net $/mi</span>' +
      '<span class="rate-pill good">Green $35+/hr or $0.80+/mi</span>' +
      '<span class="rate-pill ok">Yellow $20-34/hr or $0.40-0.79/mi</span>' +
      '<span class="rate-pill low">Red under $20/hr or $0.40/mi</span>' +
      '<span class="rate-pill neutral">Gross $/mi is posted / all miles, including empty miles</span></p>';
  }

  function filteredSearches(data) {
    var rows = (data && data.loads) ? data.loads.slice() : [];
    var cap = Number(state.maxDeadhead) || 0;
    if (cap > 0) {
      rows = rows.filter(function (row) {
        var dh = rowEmptyMiles(row);
        return dh == null || dh <= cap;
      });
    }
    var f = state.searchFilter || 'all';
    if (f === 'take' || f === 'maybe' || f === 'pass') {
      rows = rows.filter(function (row) { return String(row.verdict).toLowerCase() === f; });
    } else if (f === 'truckstop') {
      rows = rows.filter(function (row) { return row.board === 'Truckstop'; });
    } else if (f === 'df') {
      rows = rows.filter(function (row) { return row.board === 'Direct Freight'; });
    }
    return sortSearches(rows);
  }

  function sortSearches(rows) {
    var order = { TAKE: 0, MAYBE: 1, PASS: 2 };
    return (rows || []).slice().sort(function (a, b) {
      var ra = order[String(a.verdict || '').toUpperCase()];
      var rb = order[String(b.verdict || '').toUpperCase()];
      if (ra == null) ra = 9;
      if (rb == null) rb = 9;
      if (ra !== rb) return ra - rb;
      var na = a.net_est;
      var nb = b.net_est;
      var da = a.net_per_day, db = b.net_per_day;
      if (da == null && db != null) return 1;
      if (db == null && da != null) return -1;
      if (da != null && db != null && db !== da) return db - da;
      if (na == null && nb == null) return 0;
      if (na == null) return 1;
      if (nb == null) return -1;
      return nb - na;
    });
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
      var color = row.verdict === 'TAKE' ? '#F2C94C' : (row.verdict === 'MAYBE' ? '#C4B5FD' : '#F87171');
      if (row.net_est < 0) color = '#F87171';
      var lane = (row.origin || '') + ' -> ' + (row.destination || '');
      if (lane.length > 28) lane = lane.slice(0, 26) + '...';
      var tip = (row.origin || '') + ' -> ' + (row.destination || '') +
        ' · ' + searchMoney(row.net_est) + ' net EST · ' + perHourLabel(row) +
        ' · Gross ' + (grossPerMileValue(row) != null ? rateMoney(grossPerMileValue(row), 2) : 'n/a') +
        '/mi · Net ' + netPerMileLabel(row);
      return '<g>' +
        '<title>' + esc(tip) + '</title>' +
        '<text class="chart-label" x="0" y="' + (y + 14) + '">' + esc(lane) + '</text>' +
        '<rect x="' + left + '" y="' + (y + 4) + '" width="' + w + '" height="14" rx="3" fill="' + color + '"></rect>' +
        '<text class="chart-val" x="' + (left + w + 6) + '" y="' + (y + 15) + '">' + esc(searchMoney(row.net_est)) + '</text>' +
        '</g>';
    }).join('');
    return '<div class="net-chart"><h3>Best to take first</h3>' +
      '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Net EST, dollars per hour, and net dollars per mile bar chart">' + bars + '</svg></div>';
  }


  function boardFallback(row) {
    return row && row.board === 'Direct Freight'
      ? 'https://www.directfreight.com'
      : 'https://main.truckstop.com/app/search/loads';
  }

  function openLoadHref(row) {
    var href = ((row && row.link) || '').trim();
    if (/^https?:\/\//i.test(href)) return href;
    return boardFallback(row || {});
  }

  function pickupDateLabel(row) {
    var w = (row && row.pickup_window) || '';
    var dates = w.match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g);
    if (!dates || !dates.length) return 'date not listed';
    if (dates.length > 1 && dates[0] !== dates[dates.length - 1]) {
      return dates[0] + '-' + dates[dates.length - 1];
    }
    return dates[0];
  }

  function loadNumberLabel(row) {
    var n = row && row.load_number && String(row.load_number).trim();
    return n || 'not listed';
  }

  function postedRateLabel(row) {
    var n = row && row.posted_rate;
    if (n == null || !isFinite(Number(n))) return 'not listed';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  }

  function brokerMailto(row) {
    var email = ((row && row.broker_email) || '').trim();
    if (!email || email.indexOf('@') < 0) return '';
    var loadNo = loadNumberLabel(row);
    var origin = (row.origin || 'Origin');
    var dest = (row.destination || 'Destination');
    var subject = 'Load # ' + loadNo + ' - ' + origin + ' to ' + dest + ' - Totni Enterprise MC 1122113';
    var body = [
      'Hello,',
      '',
      'I am interested in load # ' + loadNo + ', ' + origin + ' to ' + dest + ', pickup ' + pickupDateLabel(row) + '.',
      '',
      'Carrier: Totni Enterprise LLC MC 1122113 / USDOT 3448727.',
      '',
      'Equipment: 2026 Ram 3500 dually + 40 ft Big Tex gooseneck flatbed with tarps and straps.',
      '',
      'Please confirm the rate is ' + postedRateLabel(row) + ' and send a rate confirmation.',
      '',
      'Claudio Dias',
      'Sand Lily Pad LLC (leased to Totni)'
    ].join('\r\n');
    var addr = encodeURIComponent(email).replace(/%40/g, '@');
    return 'mailto:' + addr + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  function brokerTel(row) {
    var d = String((row && row.broker_phone) || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    if (d.length !== 10) return '';
    return 'tel:+1' + d;
  }

  function coordKey(c) {
    if (!c || c.lat == null || c.lon == null || !isFinite(Number(c.lat)) || !isFinite(Number(c.lon))) return '';
    return Number(c.lat) + ',' + Number(c.lon);
  }

  function mapsDirUrl(origin, waypoints, destination) {
    if (!origin || !destination) return '';
    var url = 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(origin) +
      '&destination=' + encodeURIComponent(destination);
    if (waypoints && waypoints.length) {
      url += '&waypoints=' + encodeURIComponent(waypoints.filter(Boolean).join('|'));
    }
    return url;
  }

  function loadMapsUrl(row) {
    if (!row) return '';
    var home = state.searches || {};
    var origin = coordKey(row.truck_coord) || coordKey(home.origin_coord) || home.origin || 'Home base (Jacksonville)';
    var waypoint = coordKey(row.origin_coord) || row.origin || '';
    var dest = coordKey(row.destination_coord) || row.destination || '';
    if (!waypoint || !dest) return '';
    return mapsDirUrl(origin, [waypoint], dest);
  }

  function comboMapsUrl(combo) {
    if (!combo) return '';
    var home = state.searches || {};
    var origin = coordKey(combo.truck_coord) || coordKey(home.origin_coord) || home.origin || 'Home base (Jacksonville)';
    var stops = [];
    (combo.stop_order || []).forEach(function (stop) {
      var key = coordKey(stop.coord) || stop.place || '';
      if (key) stops.push(key);
    });
    if (!stops.length) return '';
    var dest = stops.pop();
    return mapsDirUrl(origin, stops, dest);
  }

  function routePayload(row) {
    return row && row.route ? row.route : null;
  }

  function hasRouteToDraw(route) {
    if (!route) return false;
    var legs = route.legs || [];
    var points = route.points || [];
    if (legs.some(function (leg) { return leg && leg.path && leg.path.length >= 2; })) return true;
    return points.some(function (pt) { return pt && pt.lat != null && pt.lon != null; });
  }

  function routeBlock(route, mapsHref, label) {
    state.routeMapSeq = (state.routeMapSeq || 0) + 1;
    var id = 'rmap-' + state.routeMapSeq;
    state.routePayloads = state.routePayloads || {};
    var canDraw = hasRouteToDraw(route);
    if (canDraw) state.routePayloads[id] = route;
    var maps = mapsHref
      ? '<a class="open-maps" href="' + esc(mapsHref) + '" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>'
      : '';
    if (!canDraw && !maps) {
      return '<p class="route-missing">Map unavailable for this load.</p>';
    }
    var map = canDraw
      ? '<div class="route-map" id="' + id + '" data-route-id="' + id + '" role="img" aria-label="' + esc(label || 'Route map') + '"></div>'
      : '<p class="route-missing">Map unavailable for this load.</p>';
    return '<div class="route-wrap">' + map + maps +
      (canDraw ? '<p class="route-legend"><span class="swatch deadhead"></span> Empty miles <span class="swatch loaded"></span> Loaded</p>' : '') +
      '</div>';
  }

  function destroyRouteMaps() {
    (state.liveMaps || []).forEach(function (map) {
      try { map.remove(); } catch (err) { /* ignore */ }
    });
    state.liveMaps = [];
    if (state.routeObserver) {
      try { state.routeObserver.disconnect(); } catch (err) { /* ignore */ }
      state.routeObserver = null;
    }
    state.routePayloads = {};
  }

  function bindMapGestures(map, el) {
    if (!map || !el) return;
    if (map.scrollWheelZoom) map.scrollWheelZoom.disable();
    var touch = (window.L && (L.Browser.touch || L.Browser.mobile)) || ('ontouchstart' in window);
    if (!touch) return;
    if (map.dragging) map.dragging.disable();
    var hint = el.querySelector('.map-gesture-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'map-gesture-hint';
      hint.setAttribute('aria-hidden', 'true');
      hint.textContent = 'Use two fingers to move the map';
      el.appendChild(hint);
    }
    var hideTimer = 0;
    function showHint() {
      hint.classList.add('show');
      if (hideTimer) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(function () { hint.classList.remove('show'); }, 1400);
    }
    el.addEventListener('touchstart', function (ev) {
      var n = ev.touches ? ev.touches.length : 0;
      if (n >= 2) {
        if (map.dragging) map.dragging.enable();
        hint.classList.remove('show');
      } else if (n === 1) {
        if (map.dragging) map.dragging.disable();
        showHint();
      }
    }, { passive: true });
    function stopDragIfOneFinger(ev) {
      var n = ev.touches ? ev.touches.length : 0;
      if (n < 2 && map.dragging) map.dragging.disable();
    }
    el.addEventListener('touchend', stopDragIfOneFinger, { passive: true });
    el.addEventListener('touchcancel', stopDragIfOneFinger, { passive: true });
  }

  function mountRouteMap(el) {
    if (!el || el.getAttribute('data-mounted') || !window.L) return;
    var payload = state.routePayloads && state.routePayloads[el.getAttribute('data-route-id')];
    if (!payload) return;
    el.setAttribute('data-mounted', '1');
    var map = L.map(el, {
      scrollWheelZoom: false,
      dragging: true,
      tap: true,
      attributionControl: true,
      zoomControl: true
    });
    bindMapGestures(map, el);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 16,
      attribution: 'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, TomTom, Garmin, FAO, NOAA, USGS'
    }).addTo(map);
    var bounds = [];
    (payload.legs || []).forEach(function (leg) {
      if (!leg || !leg.path || leg.path.length < 2) return;
      var isDead = leg.kind === 'deadhead';
      var line = L.polyline(leg.path, {
        color: isDead ? '#E8E0C8' : '#C4B5FD',
        weight: isDead ? 3 : 4,
        opacity: isDead ? 0.95 : 0.95,
        dashArray: isDead ? '7 7' : null
      }).addTo(map);
      line.getLatLngs().forEach(function (ll) { bounds.push(ll); });
    });
    (payload.points || []).forEach(function (pt) {
      if (!pt || pt.lat == null || pt.lon == null) return;
      bounds.push([pt.lat, pt.lon]);
      var isHome = pt.kind === 'truck' || (pt.label || '') === 'Home base (Jacksonville)';
      var label = isHome ? 'H' : (pt.n != null ? String(pt.n) : '');
      var title = isHome ? (pt.label || 'Home base (Jacksonville)') : ((pt.kind === 'pickup' ? 'Pickup · ' : (pt.kind === 'drop' ? 'Drop · ' : (pt.kind === 'empty' ? 'Empty miles · ' : ''))) + (pt.label || ''));
      var icon = L.divIcon({
        className: 'route-pin-wrap',
        html: '<div class="route-pin ' + esc(pt.kind || '') + '">' + esc(label) + '</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      L.marker([pt.lat, pt.lon], { icon: icon, keyboard: false, title: title })
        .addTo(map)
        .bindTooltip(title, { direction: 'top', opacity: 0.95 });
    });
    if (bounds.length) {
      map.fitBounds(bounds, { padding: [22, 22], maxZoom: 10 });
    } else {
      map.setView([30.3, -82], 5);
    }
    requestAnimationFrame(function () { map.invalidateSize(); });
    state.liveMaps = state.liveMaps || [];
    state.liveMaps.push(map);
  }

  function observeRouteMaps(root) {
    var scope = root || document;
    if (!window.IntersectionObserver || !window.L) {
      scope.querySelectorAll('.route-map').forEach(mountRouteMap);
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        mountRouteMap(entry.target);
        observer.unobserve(entry.target);
      });
    }, { root: null, rootMargin: '120px 0px', threshold: 0.01 });
    state.routeObserver = observer;
    scope.querySelectorAll('.route-map').forEach(function (el) {
      observer.observe(el);
    });
    scope.querySelectorAll('details.pass-group').forEach(function (details) {
      details.addEventListener('toggle', function () {
        if (!details.open) return;
        details.querySelectorAll('.route-map').forEach(function (el) {
          if (!el.getAttribute('data-mounted')) observer.observe(el);
        });
      });
    });
  }

  function searchActions(row) {
    var href = openLoadHref(row);
    var html = '<div class="search-actions">' +
      '<a class="search-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Open load</a>';
    var mail = brokerMailto(row);
    var tel = brokerTel(row);
    var hiddenDf = row && row.board === 'Direct Freight' && !row.broker && !row.broker_mc;
    if (mail) {
      html += '<a class="email-broker" href="' + esc(mail) + '">Email broker</a>';
    } else if (tel) {
      html += '<a class="call-broker" href="' + esc(tel) + '">Call broker</a>';
    } else if (hiddenDf) {
      html += '<a class="search-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Broker on Direct Freight detail</a>';
    } else {
      html += '<span class="no-email">No company contact listed</span>';
    }
    if (row && row.looked_up) {
      html += '<span class="looked-up">Looked up</span>';
    }
    return html + '</div>';
  }

  function renderSearchCard(row) {
    var verd = String(row.verdict || 'PASS').toLowerCase();
    var origin = row.origin || 'Origin';
    var dest = row.destination || 'Destination';
    var bits = [];
    bits.push(row.board || '');
    if (row.equipment) bits.push(row.equipment);
    if (row.pickup_window) bits.push('Pickup ' + row.pickup_window);
    if (row.drop_window) bits.push('Drop ' + row.drop_window);
    var broker = row.broker || (row.board === 'Direct Freight' ? 'Broker not listed on the free list' : '');
    if (broker) bits.push(broker);
    if (row.broker_mc) bits.push('MC ' + row.broker_mc);
    if (row.broker_dot) bits.push('DOT ' + row.broker_dot);
    if (row.load_number) bits.push('Load # ' + row.load_number);
    if (row.notes) bits.push(row.notes);
    var reason = verdictReason(row);
    return '<article class="search-card ' + esc(verd) + '">' +
      '<div class="search-head">' +
        netBlock(row.net_est, perHourValue(row), netPerMileValue(row), '', row) +
        '<span class="verdict-pill ' + esc(verd) + '">' + esc(row.verdict || 'PASS') + '</span>' +
      '</div>' +
      (reason ? '<p class="search-reason">' + esc(reason) + '</p>' : '') +
      '<div class="lane">' + esc(origin) + ' to ' + esc(dest) + '</div>' +
      loadStatRow(row, searchOriginLabel()) +
      fuelLine(currentFuel(row)) +
      (row.math ? '<p class="search-math">' + esc(row.math) + '</p>' : '') +
      (row.tarp ? '<p class="search-fit">Tarps, straps</p>' : '') +
      '<p class="search-meta">' + esc(bits.filter(Boolean).join(' | ')) + '</p>' +
      routeBlock(routePayload(row), loadMapsUrl(row), (origin + ' to ' + dest + ' route map')) +
      searchActions(row) + '</article>';
  }

  function renderComboCard(combo) {
    var verd = String(combo.verdict || 'MAYBE').toLowerCase();
    var stops = (combo.stop_order || []).map(function (stop) {
      return '<li><span class="act">' + esc(stop.action) + '</span> ' + esc(stop.place) +
        (stop.lane ? ' <span class="lane-mini">(' + esc(stop.lane) + ')</span>' : '') +
        (stop.window ? ' · ' + esc(stop.window) : '') + '</li>';
    }).join('');
    var comboLoads = combo.loads || [];
    var legs = comboLoads.map(function (row, i) {
      var from;
      if (combo.kind === 'shared') from = searchOriginLabel() + ' (solo run)';
      else from = i === 0 ? searchOriginLabel() : (comboLoads[i - 1].destination || 'previous drop');
      var bits = [(row.origin || '') + ' to ' + (row.destination || '')];
      if (row.board) bits.push(row.board);
      if (row.load_number) bits.push('Load # ' + row.load_number);
      var reason = verdictReason(row);
      return '<li class="combo-leg ' + esc(String(row.verdict || '').toLowerCase()) + '">' +
        '<div class="search-head">' +
          netBlock(row.net_est, perHourValue(row), netPerMileValue(row), '', row) +
          (row.verdict ? '<span class="verdict-pill ' + esc(String(row.verdict).toLowerCase()) + '">' + esc(row.verdict) + '</span>' : '') +
        '</div>' +
        (reason ? '<p class="search-reason">' + esc(reason) + '</p>' : '') +
        '<div class="lane">' + (i + 1) + '. ' + esc(bits.join(' · ')) + '</div>' +
        loadStatRow(row, from) +
        routeBlock(routePayload(row), loadMapsUrl(row), (row.origin || '') + ' to ' + (row.destination || '') + ' route map') +
        searchActions(row) + '</li>';
    }).join('');
    var wt = combo.combined_weight_lb != null ? plainNum(combo.combined_weight_lb, 0) + ' lb' : 'n/a';
    if (combo.weight_unknown) wt += ' (some not listed)';
    var len = combo.combined_length_ft != null ? plainNum(combo.combined_length_ft, 1) + ' ft' : 'n/a';
    if (combo.length_unknown) len += ' (some not listed)';
    var kind = combo.kind === 'shared' ? 'Shared deck' : 'Sequential chain';
    var reason = verdictReason(combo);
    return '<article class="combo-card ' + esc(verd) + '">' +
      '<div class="search-head">' +
        netBlock(combo.net_est, perHourValue(combo, (combo.loads || []).length),
          netPerMileValue(combo),
          '',
          combo, (combo.loads || []).length) +
        '<span class="verdict-pill ' + esc(verd) + '">' + esc(combo.verdict || 'MAYBE') + '</span>' +
      '</div>' +
      (reason ? '<p class="search-reason">' + esc(reason) + '</p>' : '') +
      '<div class="lane">' + esc(kind) + '</div>' +
      milesStrip(combo.loaded_mi, combo.deadhead_mi, { emptyFrom: searchOriginLabel() + ', all legs' }) +
      fuelLine(currentFuel(combo.loads && combo.loads[0] ? combo.loads[0] : combo)) +
      (combo.math ? '<p class="search-math">' + esc(combo.math) + '</p>' : '') +
      '<div class="stat-row">' +
        statCell('On deck', esc(wt)) +
        statCell('Length', esc(len)) +
        (combo.timing_note ? statCell('Timing', esc(combo.timing_note)) : '') +
      '</div>' +
      routeBlock(routePayload(combo), comboMapsUrl(combo), kind + ' route map') +
      '<p class="combo-label">Stop order</p><ol class="combo-stops">' + stops + '</ol>' +
      '<p class="combo-label">Loads</p><ul class="combo-loads">' + legs + '</ul>' +
      ((combo.flags && combo.flags.length) ? '<p class="search-flags">' + esc(combo.flags.join(' ')) + '</p>' : '') +
      '</article>';
  }

  function renderCombos(data) {
    var list = (data && data.combos) ? data.combos.slice() : [];
    var cap = Number(state.maxDeadhead) || 0;
    if (cap > 0) {
      list = list.filter(function (combo) {
        var first = (combo.loads || [])[0];
        var dh = first ? rowEmptyMiles(first) : combo.deadhead_mi;
        return dh == null || dh <= cap;
      });
    }
    var body;
    if (!list.length) {
      body = '<p class="fine">No 2- or 3-load combos in this scan cleared the $1,000 net bar with a feasible route. Many postings were full TL, over the 15,300 lb or 40 ft limit, or did not line up for a shared deck or a sequential chain.</p>';
    } else {
      body = list.map(renderComboCard).join('');
    }
    return '<div class="combos">' +
      '<h3>Combos</h3>' +
      '<p class="fine">Shared-deck and sequential chains, ranked by total net EST and net per day. A combo needs at least $1,000 net EST and must beat its best single load by $200, with no losing leg.</p>' +
      body + '</div>';
  }

  function renderSearchGroups(rows) {
    var groups = { TAKE: [], MAYBE: [], PASS: [] };
    rows.forEach(function (row) {
      var key = String(row.verdict || 'PASS').toUpperCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });
    var labels = { TAKE: 'Take', MAYBE: 'Maybe', PASS: 'Pass' };
    var html = '';
    ['TAKE', 'MAYBE', 'PASS'].forEach(function (key) {
      var list = groups[key] || [];
      if (!list.length) return;
      var cards = list.map(renderSearchCard).join('');
      var title = labels[key] + ' (' + list.length + ')';
      if (key === 'PASS') {
        var onlyPass = !groups.TAKE.length && !groups.MAYBE.length;
        html += '<details class="search-group pass-group"' + (onlyPass ? ' open' : '') + '>' +
          '<summary class="search-group-head pass">' + esc(title) + '</summary>' +
          cards + '</details>';
      } else {
        html += '<section class="search-group">' +
          '<h3 class="search-group-head ' + key.toLowerCase() + '">' + esc(title) + '</h3>' +
          cards + '</section>';
      }
    });
    return html || '<p class="fine">No loads in this filter.</p>';
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
      '<p class="fine">Refresh reloads the latest saved scan. It does not start a new board search.</p>' +
      renderTruckAt();
  }

  function bindSearchRefresh() {
    var btn = $('search-refresh-btn');
    if (btn) btn.addEventListener('click', function () { refreshSearches(); });
    bindTruckAt();
    bindFreshPull();
  }

  function renderSearches() {
    var root = $('searches-root');
    if (!root) return;
    destroyRouteMaps();
    var data = viewSearches();
    var head = searchToolbar();
    if (state.searchError && !state.searches) {
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
    var formula = rules.formula || 'net EST = rate x 0.87 - $1.14 per loaded mile (fuel and DEF) - $0.30 per deadhead mile';
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
    var cards = renderSearchGroups(rows);
    root.innerHTML =
      head +
      '<div class="searches-hero">' +
        '<h2>Load Boards</h2>' +
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
        rateLegend() +
        renderFreshPull() +
      '</div>' +
      renderCombos(data) +
      renderSearchChart(rows) +
      '<div class="search-filters" role="group" aria-label="Filter load boards">' + filters + '</div>' +
      cards;
    bindSearchRefresh();
    root.querySelectorAll('.search-filters button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.searchFilter = btn.getAttribute('data-filter') || 'all';
        renderSearches();
      });
    });
    observeRouteMaps(root);
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
    recallTruckAt();
    watchTabbar();
    bindRigPhoto();
    loadDieselPrices();
    var ver = $('app-version');
    if (ver) ver.textContent = APP_VERSION;
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
