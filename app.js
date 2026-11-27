(function () {
  'use strict';

  var APP_VERSION = 'v102';
  var RELAY_URL = 'https://blackram-relay.sandlilypad.workers.dev';
  var RELAY_PIN_KEY = 'blackram_relay_pin_v1';
  var DELIVERED_SYNC_KEY = 'blackram_delivered_sync_v1';
  var SETTINGS_KEY = 'blackram_settings_v4';
  var SETTINGS_KEY_V1 = 'blackram_settings_v1';
  var SETTINGS_KEY_V2 = 'blackram_settings_v2';
  var SETTINGS_KEY_V3 = 'blackram_settings_v3';
  var FEED_CACHE_KEY = 'blackram_feed_cache_v1';
  var SEARCH_CACHE_KEY = 'blackram_search_cache_v1';
  var PERIOD_KEY = 'blackram_period_v1';
  var DELIVERED_KEY = 'blackram_delivered_v1';
  var DELIVERED_OUTBOX_KEY = 'blackram_delivered_outbox_v1';
  var SAVED_LOADS_KEY = 'blackram_saved_loads_v1';
  var SEEN_LOADS_KEY = 'blackram_seen_loads_v1';
  var COMPARE_KEY = 'blackram_compare_v1';
  var SEARCH_PREFS_KEY = 'blackram_search_prefs_v1';
  var WEATHER_SWITCH_KEY = 'blackram_weather_on_v1';
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
    searchSort: 'default',
    hidePass: false,
    fitsOnly: false,
    weatherOn: true,
    savedLoads: null,
    compareKeys: null,
    seenLoads: null,
    reportChartMode: 'weekly',
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
    deliverUndoId: '',
    deliverUndoUntil: 0,
    deliverUndoTimer: null,
    relayConnectOpen: false,
    relayConnectMsg: '',
    relayConnectErr: false,
    freshPullBusy: false,
    freshPullStatus: '',
    freshPullStatusType: '',
    freshPullPollTimer: null,
    freshPullPollEnd: 0,
    freshPullBaseline: '',
    freshPullLastOkAt: 0,
    freshOriginRec: null,
    freshDestRec: null,
    freshOriginText: null,
    freshDestText: '',
    freshAnywhere: true,
    freshRadius: 150,
    pullStatus: null,
    pullStatusTimer: null,
    pullStatusError: '',
    lastLiveRefreshAt: 0,
    outboxFlushing: false,
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
    if (n == null || !isFinite(n)) return '--';
    var neg = n < -0.004;
    var abs = Math.abs(n);
    var showCents = Math.round(abs * 100) % 100 !== 0;
    var body = abs.toLocaleString('en-US', {
      minimumFractionDigits: showCents ? 2 : 0,
      maximumFractionDigits: 2
    });
    return (neg ? '-$' : '$') + body;
  }

  // whole dollars for headline tiles; ledger rows keep cents
  function money0(n) {
    if (n == null || !isFinite(n)) return '--';
    return money(Math.round(n));
  }

  function rpm(n) {
    if (n == null || !isFinite(n)) return '--';
    return '$' + n.toFixed(2) + '/mi';
  }

  function plainNum(n, digits) {
    if (n == null || !isFinite(n)) return '--';
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

  // Fuel for a Rate Check or Targets: same chooser as a Load Boards card
  // (truck location region, else the pickup state's PADD, else the US average).
  function rateCheckFuel(pickupText) {
    return currentFuel(pickupText ? { origin: pickupText } : null);
  }

  function fuelUsedText(f) {
    if (!f || f.fallback) return 'No diesel price on file: flat fallback $/mi from settings.';
    return dieselPhrase(f, 3) + ' at ' + Number(f.mpg).toFixed(1) + ' mpg + ' + money3(f.def_per_mi) +
      '/mi DEF = ' + money3(f.fuel_per_mi) + '/mi on loaded and empty miles' +
      (f.diesel_region ? ' (' + f.diesel_region + ', EIA week ' + ((state.dieselPrices && state.dieselPrices.eia && state.dieselPrices.eia.week) || '--') + ')' : '') + '.';
  }

  // One monthly bill basis everywhere (same as Targets / Scoreboard):
  // trailer + insurance + truck note from settings, plus other monthly
  // (Truckstop Freight Match $42 default, plus phone/software). The $42
  // (INV-4492445) was charged 11/14 to company AmEx ...8008; Totni did not pay it.
  // v68 had dropped it from the company basis; v71 puts it back.
  var TARGETS_KEY = 'blackram_targets_v1';
  function restoreTruckstop42(t) {
    t = t || {};
    if (t.droppedTruckstop42 && Number(t.otherMo) === 0 && !t.restoredTruckstop42) {
      t.otherMo = 42;
      t.restoredTruckstop42 = 1;
      t.droppedTruckstop42 = 0;
      try { localStorage.setItem(TARGETS_KEY, JSON.stringify(t)); } catch (e) { /* private mode */ }
    }
    return t;
  }
  function targetsOtherMo() {
    try {
      var t = restoreTruckstop42(JSON.parse(localStorage.getItem(TARGETS_KEY) || '{}'));
      if (t && t.otherMo != null && t.otherMo !== '' && isFinite(Number(t.otherMo))) return Number(t.otherMo);
    } catch (e) { /* ignore */ }
    return 42;
  }

  function monthlyBills(s) {
    s = s || settings();
    var other = targetsOtherMo();
    return {
      trailer: s.trailer, insurance: s.insurance, truck: s.otherFixed, otherMo: other,
      total: roundMoney(s.trailer + s.insurance + s.otherFixed + other)
    };
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
    // Same fuel model as the Load Boards: EIA regional diesel + pump premium at the feed mpg
    // plus DEF per mile, on loaded AND empty miles. Flat $/mi settings only when no price is on file.
    var fuelModel = rateCheckFuel(fieldText('pickup'));
    var fuelPerMi = fuelModel.fallback ? null : Number(fuelModel.fuel_per_mi);
    var loadedCostAmt, deadCostAmt, fuelCostAmt, netEst;
    if (fuelPerMi != null) {
      fuelCostAmt = roundMoney(fuelPerMi * totalMi);
      loadedCostAmt = roundMoney(fuelPerMi * loadedMi);
      deadCostAmt = roundMoney(fuelCostAmt - loadedCostAmt);
      netEst = roundMoney(afterFee - fuelCostAmt);
    } else {
      loadedCostAmt = roundMoney(s.loadedCost * loadedMi);
      deadCostAmt = roundMoney(s.deadheadCost * deadMi);
      fuelCostAmt = roundMoney(loadedCostAmt + deadCostAmt);
      netEst = roundMoney(afterFee - loadedCostAmt - deadCostAmt);
    }
    var mpg = fuelPerMi != null ? Number(fuelModel.mpg) : s.mpg;
    var fuelKnown = mpg > 0;
    var gallons = fuelKnown ? totalMi / mpg : null;
    var fuel = fuelPerMi != null ? fuelCostAmt : (fuelKnown ? roundMoney(gallons * s.diesel) : null);
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
    // Boards rule: no weight listed is a MAYBE until it is confirmed.
    if (weight == null) flags.push('Weight not listed - MAYBE until you enter it and confirm the fit');
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
      fuelModel: fuelModel,
      fuelPerMi: fuelPerMi,
      fuelCostAmt: fuelCostAmt,
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

  function rcFuelShort() {
    var f = rateCheckFuel(fieldText('pickup'));
    var s = settings();
    if (!f || f.fallback) return 'fallback $' + s.loadedCost.toFixed(2) + '/loaded mi + $' + s.deadheadCost.toFixed(2) + '/empty mi';
    return money3(f.fuel_per_mi) + '/mi, diesel ' + money3(f.diesel_usd_gal) + '/gal';
  }

  function verdictCopy(result) {
    var s = result.settings;
    if (!result.ready) {
      return {
        label: 'READY',
        msg: 'Enter the rate plus loaded miles, empty miles, or both.',
        meta: 'Net EST = rate x 0.87 minus fuel and DEF on loaded and empty miles (' + rcFuelShort() + '). Bar $' + plainNum(s.minNet, 0) + ' net EST, or $' + plainNum(s.minNetSameDay, 0) + ' for a same-day run under ' + plainNum(s.sameDayMiles, 0) + ' total miles.'
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
      label: result.verdict === 'take' ? 'Take' : (result.verdict === 'maybe' ? 'Maybe' : (result.verdict === 'idle' ? 'Ready' : 'Pass')),
      msg: msg,
      meta: bits.join(' ')
    };
  }

  function metric(value, label, sub, small, tap) {
    var ta = tap ? tlAttrs(tap[0], tap[1], String(label).replace(/<[^>]+>/g, '') + ': ' + String(value).replace(/<[^>]+>/g, '') + '. Show details') : '';
    return '<div class="metric' + (ta ? ' tl-tap tl-chev tl-chev-top' : '') + '"' + ta + '><div class="n' + (small ? ' n-small' : '') + '">' + value +
      '</div><div class="l">' + label + '</div>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }

  function renderCheck() {
    var result = compute();
    var copy = verdictCopy(result);
    var box = $('verdict');
    box.className = 'rc-verdict ' + (result.verdict === 'idle' ? 'idle' : result.verdict);
    $('verdict-label').textContent = copy.label;
    $('verdict-msg').textContent = result.ready ? copy.msg : 'Enter the rate and the miles.';
    $('verdict-meta').textContent = result.ready ? copy.meta : '';
    renderRateCheckHero(result);

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
    var fm = result.fuelModel;
    var fmLive = fm && !fm.fallback;
    var fuelValue = result.fuelKnown ? money(result.ready ? result.fuel : null) : '--';
    var fuelSub = fmLive
      ? '<span class="est">EST</span> ' + (result.ready ? result.gallons.toFixed(1) + ' gal + DEF | ' : '') + 'diesel ' + money3(fm.diesel_usd_gal) + '/gal (' + esc(fm.diesel_region || 'US') + ' EIA ' + money3(fm.diesel_eia_usd_gal) + ' ' + (fm.pump_premium_usd_gal < 0 ? '- ' : '+ ') + money3(Math.abs(fm.pump_premium_usd_gal)) + ') | ' + money3(fm.fuel_per_mi) + '/mi'
      : (result.fuelKnown && result.ready
        ? '<span class="est">EST</span> ' + result.gallons.toFixed(1) + ' gal at $' + s.diesel.toFixed(2) + '/gal (no EIA price on file)'
        : '<span class="est">EST</span> MPG ' + plainNum(s.mpg, 1) + ' | diesel $' + s.diesel.toFixed(2));
    var hourSub = !result.ready || result.netHour == null
      ? 'Optional hours, or estimated from miles'
      : (result.hoursEst
        ? '<span class="est">EST</span> ' + result.hours.toFixed(1) + ' h at ' + plainNum(s.assumedMph, 0) + ' mph'
        : plainNum(result.hours, 1) + ' h entered');

    var mathSub = fmLive
      ? (result.ready
        ? ('Rate x 0.87 = ' + money(result.afterFee) + '. Fuel + DEF ' + money3(result.fuelPerMi) + ' x ' + plainNum(result.totalMi, 0) + ' mi (loaded+empty) = ' + money(result.fuelCostAmt) + '.')
        : 'rate x 0.87 - ' + money3(fm.fuel_per_mi) + '/mi x (loaded + empty mi)')
      : result.ready
      ? ('Rate x 0.87 = ' + money(result.afterFee) + '. Loaded $' + s.loadedCost.toFixed(2) + ' x ' + plainNum(result.loadedMi, 0) + ' = ' + money(result.loadedCostAmt) + '. Empty miles $' + s.deadheadCost.toFixed(2) + ' x ' + plainNum(result.deadMi, 0) + ' = ' + money(result.deadCostAmt) + '.')
      : 'rate x 0.87 - $' + s.loadedCost.toFixed(2) + '/loaded mi - $' + s.deadheadCost.toFixed(2) + '/empty mi';

    $('metrics').innerHTML =
      metric(result.ready ? money(result.netEst) : '--', 'Net EST', mathSub) +
      metric(result.ready ? money(result.fee) : '--', 'Totni fee', plainNum(s.feePct, 2).replace(/\.00$/, '') + '% of the rate') +
      metric(result.ready && result.loadedMi > 0 ? rpm(result.loadedRpm) : '--', 'Posted / loaded mi', result.loadedMi > 0 ? plainNum(result.loadedMi, 0) + ' loaded mi' : 'No loaded miles yet') +
      metric(result.ready && result.totalMi > 0 ? rpm(result.allRpm) : '--', 'Posted / all-mi', result.totalMi > 0 ? plainNum(result.totalMi, 0) + ' total mi' : 'No miles yet') +
      metric(fuelValue, 'Fuel (MPG check)', fuelSub) +
      metric(result.ready && result.netHour != null ? money(result.netHour) : '--', 'Net EST per hour', hourSub);

    var insFlag = $('ins-flag');
    insFlag.hidden = s.insurance > 0;
    var brief = plainNum(s.feePct, 2).replace(/\.00$/, '') + '% / net bar $' + plainNum(s.minNet, 0);
    if (s.insurance <= 0) brief += ' / insurance not set';
    $('settings-brief').textContent = brief;
    var billsEl = $('rc-bills');
    if (billsEl) {
      var b = monthlyBills(s);
      billsEl.textContent = 'Monthly bills ' + money(b.total) + ' = trailer ' + money(b.trailer) + ' + insurance ' + money(b.insurance) +
        ' + truck ' + money(b.truck) + (b.otherMo ? ' + other ' + money(b.otherMo) : '') +
        '. The Truckstop $42 is billed to Totni and taken from load pay, so it stays in Totni fees, not in these bills. Break-even everywhere uses this. Fuel now: ' + fuelUsedText(result.fuelModel);
    }

    if (state.tab === 'kpis' && state.feed) renderKpis();
  }

  /* ---- Rate Check: big verdict numbers, Why list, saved checks (manual save only) ----
     Display only. Every number comes from compute() above or from the same
     hosDaysFromMiles() the load boards use for days. */
  var RC_HIST_KEY = 'blackram_ratecheck_history_v1';
  var RC_HIST_MAX = 10;

  function rcSet(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function rcDays(result) {
    if (!result.ready || result.loadedMi <= 0) return null;
    var d = hosDaysFromMiles(result.loadedMi, result.deadMi, 1);
    return d && d > 0 ? d : null;
  }

  function renderRateCheckHero(result) {
    var ready = result.ready && result.loadedMi > 0;
    var days = rcDays(result);
    rcSet('rcv-net', result.ready ? money(Math.round(result.netEst)) : '--');
    rcSet('rcv-day', ready && days ? money(Math.round(result.netEst / days)) : '--');
    rcSet('rcv-mi', ready && result.totalMi > 0 ? '$' + (result.netEst / result.totalMi).toFixed(2) : '--');
    rcSet('rcv-hr', ready && result.netHour != null ? money(Math.round(result.netHour)) : '--');
    var dl = $('rcv-day-l');
    if (dl) dl.textContent = ready && days ? 'Net / day (' + days + 'd)' : 'Net / day';
    var list = $('rc-why-list');
    if (!list) return;
    var s = result.settings;
    var items = [];
    function li(kind, text) { items.push('<li class="' + kind + '">' + esc(text) + '</li>'); }
    if (!result.ready) {
      li('', 'Net EST = rate x 0.87 minus fuel and DEF on loaded and empty miles (' + rcFuelShort() + ').');
      li('', 'Bar: $' + plainNum(s.minNet, 0) + ' net EST, or $' + plainNum(s.minNetSameDay, 0) + ' for a same-day run under ' + plainNum(s.sameDayMiles, 0) + ' total miles.');
      li('', 'Fit: up to 12,500 lb and ' + plainNum(s.deckFt, 0) + ' ft is clean. 12,501-15,300 lb is a MAYBE (scale check).');
    } else {
      if (result.loadedMi <= 0) li('w-bad', 'Add loaded miles to score this offer.');
      else if (result.netEst >= result.bar) li('w-ok', 'Net EST ' + money(result.netEst) + ' clears the $' + plainNum(result.bar, 0) + ' bar' + (result.sameDay ? ' (same-day run).' : '.'));
      else li('w-bad', 'Net EST ' + money(result.netEst) + ' is under the $' + plainNum(result.bar, 0) + ' bar' + (result.sameDay ? ' (same-day run).' : '.'));
      if (result.flags && result.flags.length) {
        result.flags.forEach(function (f) { li(result.hardFail ? 'w-bad' : 'w-warn', f + '.'); });
      } else if (result.weight != null || result.lengthFt != null) {
        li('w-ok', 'Fits the deck' + (result.weight != null ? ': ' + plainNum(result.weight, 0) + ' lb' : '') + (result.lengthFt != null ? ', ' + plainNum(result.lengthFt, 0) + ' ft' : '') + '.');
      } else {
        li('w-warn', 'No weight or length entered. Add them below to confirm it fits.');
      }
      li('', 'Fuel used: ' + fuelUsedText(result.fuelModel));
      if (days) li('', 'About ' + days + ' day' + (days === 1 ? '' : 's') + ' of driving (hours of service estimate).');
      if (state.tarp) li('', 'Tarp required. We have tarps and straps.');
    }
    list.innerHTML = items.join('');
    updateSaveBtn(result);
  }

  function updateSaveBtn(result) {
    var btn = $('rc-save');
    if (!btn) return;
    var ready = !!(result && result.ready && result.loadedMi > 0);
    btn.disabled = !ready;
    if (btn.getAttribute('data-flash') !== '1') btn.textContent = 'Save check';
  }

  function rcHistRead() {
    try {
      var arr = JSON.parse(localStorage.getItem(RC_HIST_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (err) { return []; }
  }

  function rcHistWrite(arr) {
    try { localStorage.setItem(RC_HIST_KEY, JSON.stringify(arr.slice(0, RC_HIST_MAX))); } catch (err) { /* private mode */ }
  }

  function rcSnapshot(result) {
    return {
      t: Date.now(),
      rate: fieldText('rate'), loaded: fieldText('loaded'), dead: fieldText('deadhead'),
      weight: fieldText('weight'), len: fieldText('lengthFt'),
      pickup: fieldText('pickup'), delivery: fieldText('delivery'), hours: fieldText('hours'),
      tarp: !!state.tarp, v: result.verdict, net: Math.round(result.netEst),
      days: rcDays(result)
    };
  }

  function rcSig(e) {
    return [e.rate, e.loaded, e.dead, e.weight, e.len, e.pickup, e.delivery, e.hours, e.tarp ? 1 : 0].join('|');
  }

  function saveRateCheck() {
    var cur = compute();
    if (!cur.ready || cur.loadedMi <= 0) return;
    var snap = rcSnapshot(cur);
    var arr = rcHistRead();
    if (arr.length && rcSig(arr[0]) === rcSig(snap)) {
      flashSaved();
      return;
    }
    arr.unshift(snap);
    rcHistWrite(arr);
    renderRateHistory();
    flashSaved();
  }

  function flashSaved() {
    var btn = $('rc-save');
    if (!btn) return;
    btn.setAttribute('data-flash', '1');
    btn.textContent = 'Saved';
    btn.disabled = true;
    setTimeout(function () {
      btn.removeAttribute('data-flash');
      updateSaveBtn(compute());
    }, 1400);
  }

  function deleteSavedCheck(i) {
    var arr = rcHistRead();
    if (i < 0 || i >= arr.length) return;
    arr.splice(i, 1);
    rcHistWrite(arr);
    renderRateHistory();
  }

  function rcAgo(t) {
    var mins = Math.floor((Date.now() - t) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    var h = Math.floor(mins / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }

  function renderRateHistory() {
    var box = $('rc-hist-list');
    if (!box) return;
    var arr = rcHistRead();
    var clr = $('rc-hist-clear');
    if (clr) clr.hidden = !arr.length;
    if (!arr.length) {
      box.innerHTML = '<div class="rc-empty"><div class="rc-empty-ico" aria-hidden="true">' + navIcon('check') + '</div>' +
        '<b>No saved checks</b><span>Score an offer, then tap Save check to keep it on this phone. Tap a saved check to bring it back.</span></div>';
      return;
    }
    box.innerHTML = arr.map(function (e, i) {
      var lane = (e.pickup || e.delivery) ? esc((e.pickup || '?') + ' > ' + (e.delivery || '?')) : '';
      var miles = plainNum(Number(e.loaded) || 0, 0) + (Number(e.dead) > 0 ? ' + ' + plainNum(Number(e.dead), 0) : '') + ' mi';
      var v = e.v === 'take' || e.v === 'maybe' ? e.v : 'pass';
      return '<div class="rc-hist-row ' + v + '" data-i="' + i + '">' +
        '<button type="button" class="rc-hist-load" data-i="' + i + '" aria-label="Load this check back in">' +
        '<span class="rc-hist-pill ' + v + '">' + v.toUpperCase() + '</span>' +
        '<span class="rc-hist-main"><b>' + esc(money(Number(e.rate) || 0)) + '</b><span>' + esc(miles) + (lane ? ' | ' + lane : '') + '</span></span>' +
        '<span class="rc-hist-net"><b>' + esc(money(e.net)) + '</b><span>' + esc(rcAgo(e.t)) + (e.days ? ' | ' + e.days + 'd' : '') + '</span></span></button>' +
        '<button type="button" class="rc-hist-del" data-i="' + i + '" aria-label="Remove this saved check">Remove</button></div>';
    }).join('');
  }

  function restoreRateCheck(i) {
    var e = rcHistRead()[i];
    if (!e) return;
    var map = { rate: e.rate, loaded: e.loaded, deadhead: e.dead, weight: e.weight, lengthFt: e.len, pickup: e.pickup, delivery: e.delivery, hours: e.hours };
    Object.keys(map).forEach(function (id) { $(id).value = map[id] == null ? '' : map[id]; });
    setTarp(!!e.tarp);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function bindRateCheck() {
    var list = $('rc-hist-list');
    if (list) list.addEventListener('click', function (ev) {
      var del = ev.target.closest && ev.target.closest('.rc-hist-del');
      if (del) { deleteSavedCheck(Number(del.getAttribute('data-i'))); return; }
      var row = ev.target.closest && ev.target.closest('.rc-hist-load');
      if (row) restoreRateCheck(Number(row.getAttribute('data-i')));
    });
    var save = $('rc-save');
    if (save) save.addEventListener('click', saveRateCheck);
    var clr = $('rc-hist-clear');
    if (clr) clr.addEventListener('click', function () { rcHistWrite([]); renderRateHistory(); });
    var why = $('rc-why');
    if (why) {
      try { why.open = localStorage.getItem('blackram_rc_why_open') === '1'; } catch (err) { /* ignore */ }
      why.addEventListener('toggle', function () {
        try { localStorage.setItem('blackram_rc_why_open', why.open ? '1' : '0'); } catch (err) { /* ignore */ }
      });
    }
    renderRateHistory();
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
      return MON[da.getUTCMonth()] + ' ' + da.getUTCDate() + '-' + db.getUTCDate();
    }
    return formatDay(a) + '-' + formatDay(b);
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

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function loadId(load) {
    if (!load) return '';
    if (load.load_id) return String(load.load_id);
    if (load.load_no) return String(load.load_no);
    return [load.date || '', load.pickup_place || '', load.drop_place || '', load.desc || '', load.lane || ''].join('|');
  }

  function readJsonKey(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var val = JSON.parse(raw);
      return val == null ? fallback : val;
    } catch (err) {
      return fallback;
    }
  }

  function writeJsonKey(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (err) { /* private mode */ }
  }

  function readDeliveredMap() {
    var map = readJsonKey(DELIVERED_KEY, {});
    return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
  }

  function writeDeliveredMap(map) {
    writeJsonKey(DELIVERED_KEY, map || {});
  }

  function readDeliveredOutbox() {
    var list = readJsonKey(DELIVERED_OUTBOX_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function writeDeliveredOutbox(list) {
    writeJsonKey(DELIVERED_OUTBOX_KEY, list || []);
  }

  function localDelivery(loadOrId) {
    var id = typeof loadOrId === 'string' ? loadOrId : loadId(loadOrId);
    if (!id) return null;
    var rec = readDeliveredMap()[id];
    return rec && rec.load_id ? rec : null;
  }

  function queueDeliveredOutbox(rec) {
    var list = readDeliveredOutbox().filter(function (row) {
      return !row || String(row.load_id) !== String(rec.load_id);
    });
    list.push({
      load_id: rec.load_id,
      delivered_at: rec.delivered_at,
      note: rec.note || ''
    });
    writeDeliveredOutbox(list);
  }

  function dropDeliveredOutbox(id) {
    writeDeliveredOutbox(readDeliveredOutbox().filter(function (row) {
      return row && String(row.load_id) !== String(id);
    }));
  }

  function readDeliveredSyncMap() {
    var map = readJsonKey(DELIVERED_SYNC_KEY, {});
    return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
  }

  function setDeliveredSyncState(id, status, error) {
    if (!id) return;
    var map = readDeliveredSyncMap();
    map[String(id)] = {
      status: status || 'queued',
      error: error || '',
      updated_at: new Date().toISOString()
    };
    writeJsonKey(DELIVERED_SYNC_KEY, map);
  }

  function getRelayPin() {
    try {
      var v = localStorage.getItem(RELAY_PIN_KEY);
      if (v && v.trim()) return v.trim();
      var legacy = localStorage.getItem(FRESH_PULL_CODE_KEY);
      return legacy ? legacy.trim() : '';
    } catch (err) {
      return '';
    }
  }

  function setRelayPin(pin) {
    var clean = String(pin || '').trim();
    try {
      if (clean) {
        localStorage.setItem(RELAY_PIN_KEY, clean);
        localStorage.setItem(FRESH_PULL_CODE_KEY, clean);
      } else {
        localStorage.removeItem(RELAY_PIN_KEY);
        localStorage.removeItem(FRESH_PULL_CODE_KEY);
      }
    } catch (err) { /* private mode */ }
    syncSettingsRelayUI();
  }

  function postRelayRequest(type, payload) {
    var pin = getRelayPin();
    if (!pin) {
      return Promise.resolve({ ok: false, status: 401, noPin: true, error: 'Enter your app PIN in Connect first.' });
    }
    return fetch(RELAY_URL + '/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin, type: type, payload: payload })
    }).then(function (resp) {
      return resp.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (resp.ok && data && data.ok) {
          return { ok: true, status: resp.status, data: data };
        }
        var msg = (data && data.error) ? data.error : ('Request failed (' + resp.status + ')');
        return { ok: false, status: resp.status, wrongPin: resp.status === 401, error: msg };
      });
    }).catch(function () {
      return { ok: false, status: 0, offline: true, error: 'Network error - check connection and try again.' };
    });
  }

  function flushDeliveredOutbox() {
    var list = readDeliveredOutbox();
    if (!list.length || state.outboxFlushing) return Promise.resolve();
    if (!getRelayPin()) return Promise.resolve();
    state.outboxFlushing = true;
    var idx = 0;
    function step() {
      var current = readDeliveredOutbox();
      if (idx >= current.length) {
        state.outboxFlushing = false;
        if (state.tab === 'reports') renderReports();
        return Promise.resolve();
      }
      var item = current[idx];
      if (!item || !item.load_id) {
        idx += 1;
        return step();
      }
      var payload = {
        load_id: String(item.load_id),
        delivered_at: String(item.delivered_at || ''),
        note: String(item.note || '')
      };
      return postRelayRequest('delivered', payload).then(function (res) {
        if (res.ok) {
          dropDeliveredOutbox(item.load_id);
          setDeliveredSyncState(item.load_id, 'sent', '');
          return step();
        }
        setDeliveredSyncState(item.load_id, res.wrongPin ? 'error' : 'queued', res.error || '');
        state.outboxFlushing = false;
        if (state.tab === 'reports') renderReports();
        return Promise.resolve();
      });
    }
    return step();
  }

  function syncSettingsRelayUI() {
    var hasPin = !!getRelayPin();
    var inp = $('settings-relay-pin');
    var clearBtn = $('settings-relay-clear');
    var st = $('settings-relay-status');
    if (inp && hasPin && !inp.value) inp.placeholder = 'PIN saved on this phone';
    if (inp && !hasPin) inp.placeholder = 'Enter app PIN';
    if (clearBtn) clearBtn.hidden = !hasPin;
    if (st) {
      st.textContent = hasPin ? 'Connected - PIN saved on this phone.' : 'Not connected yet.';
      st.className = 'relay-connect-status' + (hasPin ? ' ok' : '');
    }
  }

  function chicagoDateTimeLocal(parts) {
    parts = parts || chicagoNowParts();
    return parts.year + '-' + pad2(parts.month) + '-' + pad2(parts.day) + 'T' +
      pad2(parts.hour) + ':' + pad2(parts.minute);
  }

  function chicagoStampFromLocalInput(value) {
    var m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return chicagoStampFromLocalInput(chicagoDateTimeLocal());
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    var h = Number(m[4]);
    var mi = Number(m[5]);
    var offs = ['-06:00', '-05:00'];
    var i;
    for (i = 0; i < offs.length; i++) {
      var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':00' + offs[i];
      var p = chicagoNowParts(new Date(iso));
      if (p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi) return iso;
    }
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':00-06:00';
  }

  function formatDeliveredAt(iso) {
    var p = parseYmd(iso);
    if (!p) return String(iso || '');
    var mon = MON[p.month - 1] || p.month;
    if (p.hour == null) return mon + ' ' + p.day;
    var h = p.hour;
    var ap = 'AM';
    if (h === 0) h = 12;
    else if (h === 12) ap = 'PM';
    else if (h > 12) { h -= 12; ap = 'PM'; }
    return mon + ' ' + p.day + ', ' + h + ':' + pad2(p.minute) + ' ' + ap + ' CT';
  }

  function canMarkDelivered(load) {
    if (!load || isCancelledLoad(load)) return false;
    if (localDelivery(load)) return false;
    var status = resolveRunStatus(load, chicagoNowParts());
    return status === 'booked' || status === 'in_transit';
  }

  function findFeedLoad(id) {
    var months = (state.feed && state.feed.months) || [];
    var i, j, loads;
    for (i = 0; i < months.length; i++) {
      loads = months[i].loads || [];
      for (j = 0; j < loads.length; j++) {
        if (loadId(loads[j]) === String(id)) return loads[j];
      }
    }
    return null;
  }

  function withResolvedStatus(load) {
    var nowParts = chicagoNowParts();
    var rec = localDelivery(load);
    var src = load || {};
    var run = resolveRunStatus(src, nowParts);
    if (rec && !isCancelledLoad(src)) run = 'delivered';
    var pay = resolvePayStatus(src, run, nowParts);
    var out = {};
    Object.keys(src).forEach(function (key) { out[key] = src[key]; });
    if (rec && !isCancelledLoad(src)) {
      out._local_delivery = rec;
      if (rec.delivered_at) out.delivered_at = rec.delivered_at;
      var day = rec.delivered_at ? String(rec.delivered_at).slice(0, 10) : '';
      if (day) out.delivered_date = day;
    }
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

  function bookedAverages(feed) {
    if (!feed || !feed.months) return null;
    var count = 0;
    var totNet = 0;
    var totDays = 0;
    var totHours = 0;
    var totMiles = 0;
    feed.months.forEach(function (m) {
      var pct = isFinite(Number(m.fee_pct)) ? Number(m.fee_pct) : 13;
      (m.loads || []).forEach(function (load) {
        if (String(load.status || '').toLowerCase() === 'cancelled') return;
        var scored = scoreLedgerLoad(load, pct);
        if (scored.netVal == null || !isFinite(scored.netVal)) return;
        count += 1;
        totNet += scored.netVal;
        if (scored.days > 0) totDays += scored.days;
        if (scored.hours > 0) totHours += scored.hours;
        if (scored.allMi > 0) totMiles += scored.allMi;
      });
    });
    if (!count) return null;
    return {
      count: count,
      avgNetEst: totNet / count,
      avgNetPerDay: totDays > 0 ? totNet / totDays : null,
      avgPerHour: totHours > 0 ? totNet / totHours : null,
      avgNetPerMile: totMiles > 0 ? totNet / totMiles : null
    };
  }

  function renderAvgBanner(avgs) {
    if (!avgs || !avgs.count) return '';
    return '<section class="avg-banner" aria-label="Historical booked load averages">' +
      '<div class="avg-banner-head">Your ' + avgs.count + '-load avg (booked &amp; delivered)</div>' +
      '<div class="avg-banner-grid">' +
        '<div class="avg-cell"><span>Avg Net / day</span><b>' + (avgs.avgNetPerDay != null ? esc(searchMoney(avgs.avgNetPerDay)) + '/d' : 'n/a') + '</b></div>' +
        '<div class="avg-cell"><span>Avg $/hr EST</span><b>' + (avgs.avgPerHour != null ? esc(searchMoney(avgs.avgPerHour)) + '/hr' : 'n/a') + '</b></div>' +
        '<div class="avg-cell"><span>Avg Net $/mi</span><b>' + (avgs.avgNetPerMile != null ? esc(rateMoney(avgs.avgNetPerMile, 2)) + '/mi' : 'n/a') + '</b></div>' +
      '</div>' +
      '</section>';
  }

  function applyFeed(feed, meta) {
    state.feed = feed;
    state.offline = !!meta.offline;
    state.savedAt = meta.savedAt || null;
    state.error = '';
    state.historyAvgs = bookedAverages(feed);
    if (state.tab === 'reports') renderReports();
    if (state.tab === 'kpis') renderKpis();
    if (state.tab === 'targets' && window.BlackRamTargets) window.BlackRamTargets.render();
    if (state.tab === 'searches' && state.searches) renderSearches();
    if (window.BlackRamStops && BlackRamStops.onFeed) BlackRamStops.onFeed(feed);
  }

  function refreshFeed() {
    if (state.inflight) return state.inflight;
    var status = $('feed-status-text');
    if (status) status.textContent = 'Updating...';
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
      state.error = 'Could not load the month. Check the connection and pull to refresh.';
      state.feed = null;
      if (state.tab === 'reports') renderReports();
      if (state.tab === 'kpis') renderKpis();
    if (state.tab === 'targets' && window.BlackRamTargets) window.BlackRamTargets.render();
    }).then(function () {
      state.inflight = null;
      try { document.dispatchEvent(new CustomEvent('blackram:data', { detail: { kind: 'feed' } })); } catch (err) { /* old browser */ }
    });
    return state.inflight;
  }

  function statusLine(feed) {
    var when = feed && feed.generated_at ? formatStamp(feed.generated_at) : (state.savedAt ? formatStamp(state.savedAt) : '');
    var text = when ? 'Last updated ' + when : 'Last updated -';
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
      'Business meals (50% deductible)': 'Business meals (50%)',
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
    var b = monthlyBills();
    return '<p class="fine">Monthly bills ' + money(b.total) + ' (trailer ' + money(b.trailer) + ', insurance ' +
      money(b.insurance) + ', truck ' + money(b.truck) + (b.otherMo ? ', other ' + money(b.otherMo) : '') +
      '). Truckstop Freight Match $42 is a company bill (charged 11/14 to AmEx ...8008). Break-even here, on the Scoreboard and on Targets all use these bills.</p>';
  }

  function scoreLedgerLoad(load, pct) {
    var gross = isFinite(Number(load.gross)) ? Number(load.gross) : 0;
    var fee = loadFee(load, pct);
    var afterFee = roundMoney(gross - fee);
    var miles = isFinite(Number(load.loaded_mi)) ? Number(load.loaded_mi) : 0;
    var emp = ledgerEmpty(load);
    var emptyMi = emp.mi != null && isFinite(Number(emp.mi)) ? Number(emp.mi) : 0;
    var allMi = miles + emptyMi;
    var actualPaid = (load.net_received != null && load.net_received !== '' && isFinite(Number(load.net_received)) && Number(load.net_received) > 0)
      ? Number(load.net_received) : null;
    var actualFuel = null;
    if (load.fuel_actual != null && isFinite(Number(load.fuel_actual))) actualFuel = Number(load.fuel_actual);
    else if (load.fuel != null && isFinite(Number(load.fuel))) actualFuel = Number(load.fuel);

    var netVal = null;
    var usedActualFuel = false;
    if (actualFuel != null) {
      usedActualFuel = true;
      var basePay = actualPaid != null ? actualPaid : afterFee;
      netVal = roundMoney(basePay - actualFuel);
    } else if (load.net_est != null && isFinite(Number(load.net_est))) {
      netVal = Number(load.net_est);
    } else {
      var fuelObj = currentFuel({ origin: load.pickup_place || load.lane || '' });
      var scoredFuel = applyFuelNet(gross, miles, emptyMi, fuelObj);
      netVal = roundMoney(afterFee - (scoredFuel.after - scoredFuel.net));
    }

    var days = rowDays({
      pickup_date: load.pickup_date || load.date,
      delivery_date: load.delivery_date,
      date: load.date,
      days: load.days
    }, 1);
    if (!days || days < 1) days = 1;
    var hours = (load.hours != null && isFinite(Number(load.hours)) && Number(load.hours) > 0)
      ? Number(load.hours)
      : hoursEst(miles, emptyMi, 1);
    var perHour = (!usedActualFuel && load.per_hour != null && isFinite(Number(load.per_hour)))
      ? Number(load.per_hour)
      : (hours > 0 ? netVal / hours : null);
    var netPerDay = (!usedActualFuel && load.net_per_day != null && isFinite(Number(load.net_per_day)))
      ? Number(load.net_per_day)
      : (days > 0 ? netVal / days : null);
    var netPerMile = (!usedActualFuel && load.net_per_mile != null && isFinite(Number(load.net_per_mile)))
      ? Number(load.net_per_mile)
      : (allMi > 0 ? netVal / allMi : null);
    var grossPerMile = (load.gross_per_mile != null && isFinite(Number(load.gross_per_mile)))
      ? Number(load.gross_per_mile)
      : (allMi > 0 ? gross / allMi : null);
    var ratePerMi = (load.rate_per_mi != null && isFinite(Number(load.rate_per_mi)))
      ? Number(load.rate_per_mi)
      : (miles > 0 ? gross / miles : null);

    return {
      gross: gross,
      fee: fee,
      afterFee: afterFee,
      actualPaid: actualPaid,
      actualFuel: actualFuel,
      usedActualFuel: usedActualFuel,
      miles: miles,
      emp: emp,
      allMi: allMi,
      days: days,
      hours: hours,
      netVal: netVal,
      perHour: perHour,
      netPerDay: netPerDay,
      netPerMile: netPerMile,
      grossPerMile: grossPerMile,
      ratePerMi: ratePerMi
    };
  }

  function loadCard(load, pct) {
    var sc = scoreLedgerLoad(load, pct);
    var gross = sc.gross;
    var fee = sc.fee;
    var miles = isFinite(Number(load.loaded_mi)) ? Number(load.loaded_mi) : null;
    var when = formatDay(load.date);
    if (load.delivery_date && load.delivery_date !== load.date) {
      var end = formatDay(load.delivery_date);
      when = formatDay(load.date).split(' ')[0] === end.split(' ')[0]
        ? formatDay(load.date) + '-' + end.split(' ')[1]
        : formatDay(load.date) + ' - ' + end;
    }
    var emp = sc.emp;
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
    var ledgerRow = {
      loaded_mi: miles,
      deadhead_mi: emp.mi,
      empty_mi_est: emp.mi,
      pickup_date: load.pickup_date || load.date,
      delivery_date: load.delivery_date,
      date: load.date,
      days: sc.days,
      gross: gross,
      posted_rate: gross,
      rate_per_mi: sc.ratePerMi,
      gross_per_mile: sc.grossPerMile,
      net_est: sc.netVal,
      net_per_day: sc.netPerDay,
      net_per_mile: sc.netPerMile,
      hours: sc.hours,
      per_hour: sc.perHour,
      same_day: sc.days === 1
    };
    var gridOpts = {
      afterFeeNet: sc.afterFee,
      actualPaid: sc.actualPaid,
      usedActualFuel: sc.usedActualFuel
    };
    var routePane = '<div class="load-route" hidden>' +
      payLine(load) +
      (load.notes ? '<p class="notes">' + esc(load.notes) + '</p>' : '') +
      emptyNote +
      routeBlock(routePayload(load), mapsHref, (load.pickup_place || 'Pickup') + ' to ' + (load.drop_place || 'Drop') + ' route map') +
      '</div>';
    var toggle = '<button type="button" class="details-toggle-btn load-toggle" aria-expanded="false">' +
      (canMap ? 'Details &amp; route' : 'Details &amp; notes') + '</button>';
    var id = loadId(load);
    var local = localDelivery(load);
    var markable = canMarkDelivered(load);
    load = withResolvedStatus(load);
    var statusCls = 'load-' + String(load.status || '').replace(/_/g, '-');
    var payCls = load.pay_status ? ' load-pay-' + String(load.pay_status).replace(/_/g, '-') : '';
    var deliverBits = '';
    if (local) {
      deliverBits += '<p class="delivered-meta">Delivered ' + esc(formatDeliveredAt(local.delivered_at)) +
        (local.note ? ' | ' + esc(local.note) : '') + '</p>';
      var inOutbox = readDeliveredOutbox().some(function (r) { return r && String(r.load_id) === String(id); });
      var syncInfo = readDeliveredSyncMap()[String(id)] || null;
      var syncText = 'Queued on this phone - will send to Grok Bot';
      var syncCls = '';
      if (!inOutbox && syncInfo && syncInfo.status === 'sent') {
        syncText = 'Sent to Grok Bot';
        syncCls = ' ok';
      } else if (syncInfo && syncInfo.status === 'error') {
        syncText = 'Sync paused: ' + syncInfo.error;
        syncCls = ' err';
      } else if (!getRelayPin()) {
        syncText = 'Saved on this phone - enter PIN in Connect to send to Grok Bot';
      }
      deliverBits += '<p class="deliver-sync-note' + syncCls + '">' + esc(syncText) + '</p>';
      deliverBits += '<button type="button" class="btn undo-delivered-btn" data-load-id="' + esc(id) +
        '">Undo</button>';
    } else if (markable) {
      deliverBits += '<button type="button" class="btn primary mark-delivered-btn" data-load-id="' +
        esc(id) + '">Mark delivered</button>';
    }
    var badges = payBadge(load) +
      '<span class="pu-chip">' + esc(when) + '</span>' +
      (load.broker ? '<span class="board-chip">' + esc(load.broker) + '</span>' : '') +
      (load.load_no ? '<span class="board-chip">#' + esc(load.load_no) + '</span>' : '');
    var fitRow = '<div class="fit-row">' +
      weightFitBadge(load.weight_lb) +
      '<span class="fit-badge neutral">' + esc(formatDays(sc.days)) + (sc.days === 1 ? ' day' : ' days') + '</span>' +
      '<span class="fit-badge neutral">Rate ' + money(gross) + '</span>' +
      '<span class="fit-badge neutral">Fee ' + money(fee) + '</span>' +
      '</div>';
    return '<article class="load has-route ' + esc(statusCls) + esc(payCls) + '" data-load-id="' + esc(id) + '">' +
      '<div class="card-top-bar"><div class="card-badges">' + badges + '</div></div>' +
      '<h3>' + esc(load.desc || 'Load') + '</h3>' +
      '<p class="lane">' + esc(load.lane || ((load.pickup_place || '') + ' to ' + (load.drop_place || ''))) + '</p>' +
      keyMetricsGrid(ledgerRow, gridOpts) +
      milesStrip(miles, emp.mi, { loadedEst: !!load.miles_estimate, emptyEst: true, emptyFrom: emp.from }) +
      fitRow +
      '<div class="search-actions">' + deliverBits +
      '<button type="button" class="call-sheet-btn">Call sheet</button>' + toggle + '</div>' +
      routePane + '</article>';
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
          btn.textContent = open ? 'Hide details' : (canMap ? 'Details & route' : 'Details & notes');
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
        '<span>' + esc(formatDay(row.date)) + ' | ' + esc(catName(row.category || 'other')) +
        (row.deadhead_for ? ' | cancelled-load deadhead' : '') +
        (typeof row.gallons === 'number' ? ' | ' + plainNum(row.gallons, 2) + ' gal' : '') +
        '</span></div><b>' + money(row.amount) + (row.est ? ' <span class="est">EST</span>' : '') + '</b></div>';
    }).join('');
  }

  function renderReports() {
    var root = $('reports-root');
    if (root) destroyRouteMaps();
    var feed = state.feed;
    var months = feed ? sortedMonths(feed) : [];
    var head = '<div id="pull" class="pull">Pull to refresh</div>' +
      '<div class="status"><p id="feed-status-text">' + esc(feed ? statusLine(feed) : (state.error || 'Loading the month...')) +
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
      ? (formatDay(fig.start) + ' - ' + formatDay(fig.end))
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

    var avgs = state.historyAvgs || bookedAverages(feed);
    var chartsHtml = renderReportsCharts(feed, month, months, all, fig);
    tileCtx.reports = { entries: entries, expenses: expenseList, label: all ? 'All time' : monthTitle(month.month) + ', ' + span, from: all ? fig.start : month.month + '-01', to: asOf };
    root.innerHTML = head +
      renderAvgBanner(avgs) +
      '<section class="big tl-tap tl-chev"' + tlAttrs('rp', 'gross', esc(kicker) + ' ' + money0(fig.gross) + '. Show the loads') + '><div class="kicker">' + esc(kicker) + '</div>' +
      '<span class="n">' + money0(fig.gross) + '</span>' +
      '<p class="sub">' + esc(span) + ' | ' + loadCount +
      (loadCount === 1 ? ' load' : ' loads') + ' | net ' + money0(fig.net) + '</p></section>' +
      '<div class="stats">' +
      metric(money0(fig.fees), 'Totni fees', feeSub, false, ['rp', 'fees']) +
      metric(money0(fig.fuel), 'Fuel', 'DEF and other costs are separate', false, ['rp', 'fuel']) +
      metric(money0(fig.other), 'Other expenses', breakout || 'None logged', false, ['rp', 'other']) +
      metric(money0(fig.net), 'Net kept', 'Gross - fee - fuel - other', false, ['rp', 'net']) +
      metric(fig.perLoaded == null ? '--' : rpm(fig.perLoaded), '$ / loaded mile', plainNum(fig.loadedMi, 2) + ' loaded mi', false, loadCount ? ['rp', 'rpm'] : null) +
      metric(String(loadCount), 'Loads hauled', all ? 'Newest load first' : 'Cancelled loads are listed below', false, loadCount ? ['rp-jump', 'rp-loads'] : null) +
      (pay ? metric(money0(pay.received), 'Collected', 'Settlements received', false, ['rp', 'collected']) : '') +
      (pay ? metric(owedValue, 'Still owed', pay.detail, false, ['rp', 'owed']) : '') +
      '</div>' +
      chartsHtml +
      '<p class="fine">Load net below shows EST after fuel alongside gross after Totni fee.</p>' +
      '<h2 class="sec" id="rp-loads">Loads</h2>' +
      (loads || '<p class="fine">No loads' + (all ? '.' : ' this month.') + '</p>') +
      '<h2 class="sec">Cancelled</h2>' +
      (cancelled || '<p class="fine">No cancelled loads.</p>') +
      '<h2 class="sec">Day notes</h2>' +
      (notes || '<p class="fine">No day notes.</p>') +
      '<details class="expenses"><summary>Expense lines</summary>' + expenseRows(expenseList) + '</details>';
    bindRefresh();
    bindMonthSwitch(root);
    bindReportChartToggle(root);
    bindLoadRoutes(root);
    bindDeliveredActions(root);
    refreshDeliverUndoToast();
  }

  function deliverLaneLabel(load) {
    if (!load) return '';
    if (load.lane) return load.lane;
    var a = load.pickup_place || '';
    var b = load.drop_place || '';
    if (a && b) return a + ' to ' + b;
    return load.desc || ('Load ' + loadId(load));
  }

  function openDeliverSheet(id) {
    var load = findFeedLoad(id);
    if (!load || !canMarkDelivered(load)) return;
    var sheet = $('deliver-sheet');
    var lane = $('deliver-sheet-lane');
    var when = $('deliver-at');
    var note = $('deliver-note');
    if (!sheet || !when) return;
    sheet.dataset.loadId = id;
    if (lane) lane.textContent = deliverLaneLabel(load);
    when.value = chicagoDateTimeLocal();
    if (note) note.value = '';
    sheet.removeAttribute('hidden');
    sheet.classList.add('open');
    document.documentElement.classList.add('sheet-open');
    when.focus();
  }

  function closeDeliverSheet() {
    var sheet = $('deliver-sheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('hidden', '');
    delete sheet.dataset.loadId;
    document.documentElement.classList.remove('sheet-open');
  }

  function markLoadDelivered(id, deliveredAt, note) {
    if (!id) return false;
    var load = findFeedLoad(id);
    if (!load || isCancelledLoad(load)) return false;
    var rec = {
      load_id: String(id),
      delivered_at: deliveredAt || chicagoStampFromLocalInput(chicagoDateTimeLocal()),
      note: String(note || '').trim()
    };
    var map = readDeliveredMap();
    map[rec.load_id] = rec;
    writeDeliveredMap(map);
    queueDeliveredOutbox(rec);
    setDeliveredSyncState(rec.load_id, 'queued', '');
    state.deliverUndoId = rec.load_id;
    state.deliverUndoUntil = Date.now() + 10000;
    if (state.tab === 'reports') renderReports();
    else if (state.tab === 'kpis') renderKpis();
    refreshDeliverUndoToast();
    flushDeliveredOutbox();
    return true;
  }

  function undoLocalDelivery(id) {
    if (!id) return;
    var map = readDeliveredMap();
    delete map[String(id)];
    writeDeliveredMap(map);
    dropDeliveredOutbox(id);
    var syncMap = readDeliveredSyncMap();
    delete syncMap[String(id)];
    writeJsonKey(DELIVERED_SYNC_KEY, syncMap);
    if (state.deliverUndoId === String(id)) {
      state.deliverUndoId = '';
      state.deliverUndoUntil = 0;
    }
    if (state.tab === 'reports') renderReports();
    else if (state.tab === 'kpis') renderKpis();
    refreshDeliverUndoToast();
  }

  function refreshDeliverUndoToast() {
    var toast = $('deliver-undo-toast');
    if (!toast) return;
    var id = state.deliverUndoId;
    var until = state.deliverUndoUntil || 0;
    var left = until - Date.now();
    if (!id || left <= 0 || !localDelivery(id)) {
      toast.hidden = true;
      if (state.deliverUndoTimer) {
        clearTimeout(state.deliverUndoTimer);
        state.deliverUndoTimer = null;
      }
      return;
    }
    toast.hidden = false;
    var text = $('deliver-undo-text');
    if (text) text.textContent = 'Marked delivered.';
    if (state.deliverUndoTimer) clearTimeout(state.deliverUndoTimer);
    state.deliverUndoTimer = setTimeout(function () {
      state.deliverUndoId = '';
      state.deliverUndoUntil = 0;
      state.deliverUndoTimer = null;
      var el = $('deliver-undo-toast');
      if (el) el.hidden = true;
    }, left);
  }

  function bindDeliveredActions(root) {
    var scope = root || document;
    scope.querySelectorAll('.mark-delivered-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openDeliverSheet(btn.getAttribute('data-load-id') || '');
      });
    });
    scope.querySelectorAll('.undo-delivered-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        undoLocalDelivery(btn.getAttribute('data-load-id') || '');
      });
    });
  }

  function bindDeliverSheet() {
    var form = $('deliver-sheet-form');
    var close = $('deliver-sheet-close');
    var cancel = $('deliver-sheet-cancel');
    var undoBtn = $('deliver-undo-now');
    if (close) close.addEventListener('click', function () { closeDeliverSheet(); });
    if (cancel) cancel.addEventListener('click', function () { closeDeliverSheet(); });
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var sheet = $('deliver-sheet');
        var id = sheet && sheet.dataset ? sheet.dataset.loadId : '';
        var when = $('deliver-at');
        var note = $('deliver-note');
        var stamp = chicagoStampFromLocalInput(when && when.value);
        closeDeliverSheet();
        markLoadDelivered(id, stamp, note && note.value);
      });
    }
    if (undoBtn) {
      undoBtn.addEventListener('click', function () {
        undoLocalDelivery(state.deliverUndoId || '');
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('deliver-sheet') && $('deliver-sheet').classList.contains('open')) {
        closeDeliverSheet();
      }
    });
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

  function signedBarChart(rows, label) {
    if (!rows || !rows.length) return '';
    var w = 360;
    var h = 186;
    var padT = 22;
    var padB = 34;
    var gap = 10;
    var maxPos = 0;
    var minNeg = 0;
    rows.forEach(function (row) {
      var v = Number(row.value) || 0;
      if (v > maxPos) maxPos = v;
      if (v < minNeg) minNeg = v;
    });
    var span = (maxPos - minNeg) || 1;
    if (maxPos === 0 && minNeg === 0) { maxPos = 1; span = 1; }
    var innerW = w - 12;
    var barW = (innerW - gap * (rows.length - 1)) / rows.length;
    var innerH = h - padT - padB;
    var zeroY = padT + (maxPos / span) * innerH;
    var parts = '<line x1="4" y1="' + zeroY.toFixed(1) + '" x2="' + (w - 4) + '" y2="' + zeroY.toFixed(1) + '" stroke="#3b3556" stroke-width="1"></line>';
    parts += rows.map(function (row, i) {
      var v = Number(row.value) || 0;
      var x = 6 + i * (barW + gap);
      var bh = Math.max(v === 0 ? 0 : 3, Math.abs(v) / span * innerH);
      var y = v >= 0 ? zeroY - bh : zeroY;
      var fill = v > 0 ? '#34D399' : (v < 0 ? '#F87171' : '#585173');
      var txtY = v >= 0 ? Math.max(13, y - 5) : Math.min(h - padB + 12, y + bh + 12);
      var txtFill = v > 0 ? '#6EE7B7' : (v < 0 ? '#FCA5A5' : '#b9b3cc');
      return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) +
        '" height="' + bh.toFixed(1) + '" rx="4" fill="' + fill + '" fill-opacity="0.88"></rect>' +
        '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + txtY.toFixed(1) +
        '" text-anchor="middle" fill="' + txtFill + '" font-size="10.5" font-weight="600">' +
        esc(row.text) + '</text>' +
        '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (h - 10) +
        '" text-anchor="middle" fill="#b9b3cc" font-size="10.5">' +
        esc(row.label) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' +
      '<title>' + esc(label) + '</title>' + parts + '</svg>';
  }

  function dualBarChart(rows, label, colorA, colorB) {
    if (!rows || !rows.length) return '';
    var w = 360;
    var h = 180;
    var padT = 22;
    var padB = 34;
    var groupGap = 12;
    var innerGap = 3;
    var max = 0;
    rows.forEach(function (r) {
      if ((r.a || 0) > max) max = r.a;
      if ((r.b || 0) > max) max = r.b;
    });
    if (max <= 0) max = 1;
    var innerW = w - 12;
    var groupW = (innerW - groupGap * (rows.length - 1)) / rows.length;
    var barW = Math.max(6, (groupW - innerGap) / 2);
    var innerH = h - padT - padB;
    var parts = rows.map(function (r, i) {
      var gx = 6 + i * (groupW + groupGap);
      var a = Number(r.a) || 0;
      var b = Number(r.b) || 0;
      var ah = a > 0 ? Math.max(3, (a / max) * innerH) : 0;
      var bh = b > 0 ? Math.max(3, (b / max) * innerH) : 0;
      var ay = padT + innerH - ah;
      var by = padT + innerH - bh;
      return '<rect x="' + gx.toFixed(1) + '" y="' + ay.toFixed(1) + '" width="' + barW.toFixed(1) +
        '" height="' + ah.toFixed(1) + '" rx="3" fill="' + colorA + '"></rect>' +
        (r.textA ? '<text x="' + (gx + barW / 2).toFixed(1) + '" y="' + Math.max(12, ay - 4).toFixed(1) +
        '" text-anchor="middle" fill="' + colorA + '" font-size="9.5" font-weight="600">' + esc(r.textA) + '</text>' : '') +
        '<rect x="' + (gx + barW + innerGap).toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barW.toFixed(1) +
        '" height="' + bh.toFixed(1) + '" rx="3" fill="' + colorB + '"></rect>' +
        (r.textB ? '<text x="' + (gx + barW + innerGap + barW / 2).toFixed(1) + '" y="' + Math.max(12, by - 4).toFixed(1) +
        '" text-anchor="middle" fill="' + colorB + '" font-size="9.5" font-weight="600">' + esc(r.textB) + '</text>' : '') +
        '<text x="' + (gx + groupW / 2).toFixed(1) + '" y="' + (h - 10) +
        '" text-anchor="middle" fill="#b9b3cc" font-size="10.5">' + esc(r.label) + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' +
      '<title>' + esc(label) + '</title>' + parts + '</svg>';
  }

  function weekRows(month) {
    var start = month.month + '-01';
    var end = month.as_of || monthEnd(month.month);
    if (end < start) end = start;
    if (end.slice(0, 7) !== month.month) end = monthEnd(month.month);
    var weeks = weeksCovering(start, end);
    var pct = isFinite(Number(month.fee_pct)) ? Number(month.fee_pct) : 13;
    return weeks.map(function (week) {
      var grossC = 0;
      var feeC = 0;
      var fuelC = 0;
      var otherC = 0;
      var miles = 0;
      var dead = 0;
      var count = 0;
      (month.loads || []).forEach(function (load) {
        if (!load.date || load.date < week.start || load.date > week.end) return;
        var g = isFinite(Number(load.gross)) ? Number(load.gross) : 0;
        grossC += cents(g);
        feeC += cents(roundMoney(g * pct / 100));
        miles += isFinite(Number(load.loaded_mi)) ? Number(load.loaded_mi) : 0;
        var em = ledgerEmpty(load).mi;
        if (em != null) dead += em;
        count += 1;
      });
      (month.expenses || []).forEach(function (exp) {
        if (!exp.date || exp.date < week.start || exp.date > week.end) return;
        var amt = isFinite(Number(exp.amount)) ? Number(exp.amount) : 0;
        if (exp.category === 'fuel') fuelC += cents(amt);
        else otherC += cents(amt);
      });
      var gross = grossC / 100;
      var net = (grossC - feeC - fuelC - otherC) / 100;
      var allMi = miles + dead;
      return {
        label: rangeLabel(week.start, week.end),
        start: week.start,
        end: week.end,
        gross: gross,
        net: net,
        miles: miles,
        deadMi: dead,
        allMi: allMi,
        count: count,
        rpm: miles > 0 ? gross / miles : null,
        allRpm: allMi > 0 ? gross / allMi : null,
        text: money(gross),
        value: gross,
        feePct: pct
      };
    });
  }

  function weeksForLoads(loads, start, end, expenses, feePct) {
    var weeks = weeksCovering(start, end);
    var pct = feePct != null ? feePct : 13;
    return weeks.map(function (week) {
      var grossC = 0;
      var feeC = 0;
      var fuelC = 0;
      var otherC = 0;
      var miles = 0;
      var dead = 0;
      var count = 0;
      loads.forEach(function (load) {
        if (!load.date || load.date < week.start || load.date > week.end) return;
        var g = isFinite(Number(load.gross)) ? Number(load.gross) : 0;
        grossC += cents(g);
        feeC += cents(roundMoney(g * pct / 100));
        miles += isFinite(Number(load.loaded_mi)) ? Number(load.loaded_mi) : 0;
        var em = ledgerEmpty(load).mi;
        if (em != null) dead += em;
        count += 1;
      });
      (expenses || []).forEach(function (exp) {
        if (!exp.date || exp.date < week.start || exp.date > week.end) return;
        var amt = isFinite(Number(exp.amount)) ? Number(exp.amount) : 0;
        if (exp.category === 'fuel') fuelC += cents(amt);
        else otherC += cents(amt);
      });
      var gross = grossC / 100;
      var net = (grossC - feeC - fuelC - otherC) / 100;
      var allMi = miles + dead;
      return {
        label: rangeLabel(week.start, week.end),
        start: week.start,
        end: week.end,
        gross: gross,
        net: net,
        miles: miles,
        deadMi: dead,
        allMi: allMi,
        count: count,
        rpm: miles > 0 ? gross / miles : null,
        allRpm: allMi > 0 ? gross / allMi : null,
        text: money(gross),
        value: gross
      };
    });
  }

  function renderReportsCharts(feed, month, months, all, fig) {
    var canWeekly = !all && !!month;
    var canMonthly = months && months.length >= 2;
    if (!canWeekly && !canMonthly) return '';
    var mode = all ? 'monthly' : (state.reportChartMode === 'monthly' && canMonthly ? 'monthly' : 'weekly');
    var series = [];
    var scopeLabel = '';
    if (mode === 'weekly') {
      series = weekRows(month).filter(function (w) {
        return w.count > 0 || w.net !== 0 || w.miles > 0;
      });
      if (!series.length) series = weekRows(month);
      scopeLabel = monthTitle(month.month) + ' by week';
    } else {
      series = months.map(function (m) {
        var f = monthFigures(m);
        var dead = f.deadMi || 0;
        var allMi = f.loadedMi + dead;
        return {
          label: shortMonth(m.month),
          gross: f.gross,
          net: f.net,
          miles: f.loadedMi,
          deadMi: dead,
          allMi: allMi,
          rpm: f.loadedMi > 0 ? f.gross / f.loadedMi : null,
          allRpm: allMi > 0 ? f.gross / allMi : null
        };
      });
      scopeLabel = 'Monthly comparison';
    }
    if (!series.length) return '';

    var netRows = series.map(function (s) {
      return { label: s.label, value: Math.round(s.net), text: searchMoney(Math.round(s.net)) };
    });
    var bestNet = series.reduce(function (a, b) { return b.net > a.net ? b : a; }, series[0]);
    var netCallout = 'Best: <strong>' + esc(bestNet.label) + '</strong> (' + money(bestNet.net) + ' net) | Period total ' + money(fig.net);

    var rpmSeries = series.filter(function (s) { return s.rpm != null || s.allRpm != null; });
    var rpmHtml = '';
    if (rpmSeries.length) {
      var rpmRows = rpmSeries.map(function (s) {
        return {
          label: s.label,
          a: s.rpm || 0,
          b: s.allRpm || 0,
          textA: s.rpm != null ? '$' + s.rpm.toFixed(2) : '',
          textB: s.allRpm != null ? '$' + s.allRpm.toFixed(2) : ''
        };
      });
      var avgAllMi = fig.deadMi != null && (fig.loadedMi + fig.deadMi) > 0 ? fig.gross / (fig.loadedMi + fig.deadMi) : null;
      rpmHtml = '<div class="chart"><h3>Per-mile rate ($/mi)</h3>' +
        '<div class="chart-legend">' +
          '<span><i style="background:#a78bfa"></i>Loaded $/mi</span>' +
          '<span><i style="background:#F2C94C"></i>All-mi $/mi</span>' +
        '</div>' +
        dualBarChart(rpmRows, 'Loaded vs all-miles rate per mile', '#a78bfa', '#F2C94C') +
        '<p class="chart-callout">Period avg: <strong>' + (fig.perLoaded != null ? rpm(fig.perLoaded) : 'n/a') + '</strong> loaded' +
        (avgAllMi != null ? ' | <strong>' + rpm(avgAllMi) + '</strong> all-miles' : '') + '</p></div>';
    }

    var miRows = series.map(function (s) {
      return {
        label: s.label,
        a: Math.round(s.miles),
        b: Math.round(s.deadMi),
        textA: s.miles > 0 ? plainNum(Math.round(s.miles), 0) : '',
        textB: s.deadMi > 0 ? plainNum(Math.round(s.deadMi), 0) : ''
      };
    });
    var totLoaded = fig.loadedMi || 0;
    var totDead = fig.deadMi || 0;
    var totAll = totLoaded + totDead;
    var dhPct = totAll > 0 ? Math.round((totDead / totAll) * 100) : 0;
    var miHtml = '<div class="chart"><h3>Miles (loaded vs deadhead)</h3>' +
      '<div class="chart-legend">' +
        '<span><i style="background:#a78bfa"></i>Loaded mi</span>' +
        '<span><i style="background:#94a3b8"></i>Deadhead mi</span>' +
      '</div>' +
      dualBarChart(miRows, 'Loaded vs deadhead miles', '#a78bfa', '#94a3b8') +
      '<p class="chart-callout"><strong>' + plainNum(Math.round(totLoaded), 0) + ' mi</strong> loaded | ' +
      plainNum(Math.round(totDead), 0) + ' mi deadhead (' + dhPct + '% empty)</p></div>';

    var switcher = (!all && canMonthly)
      ? '<div class="chart-mode-btns" role="group" aria-label="Chart time grouping">' +
          '<button type="button" data-chart-mode="weekly" aria-pressed="' + (mode === 'weekly' ? 'true' : 'false') + '">Weekly</button>' +
          '<button type="button" data-chart-mode="monthly" aria-pressed="' + (mode === 'monthly' ? 'true' : 'false') + '">Monthly</button>' +
        '</div>'
      : '';

    return '<div class="rep-charts">' +
      '<div class="rep-charts-head"><h2 class="sec">Charts | ' + esc(scopeLabel) + '</h2>' + switcher + '</div>' +
      '<div class="chart"><h3>Net kept (' + (mode === 'weekly' ? 'weekly' : 'monthly') + ')</h3>' +
        signedBarChart(netRows, 'Net kept by ' + (mode === 'weekly' ? 'week' : 'month')) +
        '<p class="chart-callout">' + netCallout + '</p>' +
      '</div>' +
      rpmHtml +
      miHtml +
      '</div>';
  }

  function bindReportChartToggle(root) {
    (root || document).querySelectorAll('[data-chart-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.reportChartMode = btn.getAttribute('data-chart-mode') || 'weekly';
        renderReports();
      });
    });
  }

  function renderKpis() {
    var root = $('kpis-root');
    var feed = state.feed;
    var months = feed ? sortedMonths(feed) : [];
    if (!months.length) {
      root.innerHTML = state.error ? '<p class="fine">' + esc(state.error) + '</p>' : loadingSkeletonHtml('Loading KPIs');
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
    var bills = monthlyBills(s);
    var monthlyFixed = bills.total;
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
      be = need('Break-even', 'Set the trailer payment or insurance on Rate Check. Fixed costs are $0, so there is no monthly target yet.');
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
          ' + truck ' + money(s.otherFixed) + (bills.otherMo ? ' + other monthly ' + money(bills.otherMo) : '') +
          ' (same bills as Targets; Truckstop Freight Match $42 is a company bill, charged 11/14 to AmEx ...8008).');
      be = '<section class="big"><div class="kicker">Break-even | ' +
        esc(all ? 'All time' : monthTitle(month.month)) + '</div>' +
        '<span class="n phrase">' + esc(headline) + '</span>' +
        '<p class="sub">' + fixedCopy + '</p>' +
        '<div class="track" role="meter" aria-label="Progress toward break-even" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
        Math.round(width) + '"><span style="width:' + width.toFixed(1) + '%"></span></div>' + ins + '</section>';
    }

    tileCtx.kpis = { entries: usedLoads.map(function (l) { return { load: l, pct: all ? (fig.entries.filter(function (e) { return e.load === l; })[0] || {}).pct : fig.feePct }; }), expenses: all ? fig.expenses : (month.expenses || []),
      label: (all ? 'All time' : monthTitle(month.month)) + ', ' + formatDay(periodStart) + ' - ' + formatDay(asOf), from: periodStart, to: asOf };
    var hasL = loadCount > 0;
    var cards =
      metric(fig.perLoaded == null ? '--' : rpm(fig.perLoaded), 'Revenue / loaded mile', plainNum(fig.loadedMi, 2) + ' loaded mi', false, hasL ? ['kp', 'rpm'] : null) +
      (perAll == null
        ? metric('Not enough data', 'Revenue / all-miles', 'Deadhead miles are not on the feed yet.', true)
        : metric(rpm(perAll), 'Revenue / all-miles', plainNum(allMiles, 1) + ' all-miles', false, ['kp', 'allmi'])) +
      (deadPct == null
        ? metric('Not enough data', 'Deadhead %', 'No deadhead miles recorded on these loads.', true)
        : metric((deadPct * 100).toFixed(1) + '%', 'Deadhead', plainNum(fig.deadMi, 1) + ' empty mi', false, ['kp', 'dead'])) +
      metric(loadsPerWeek == null ? '--' : loadsPerWeek.toFixed(1), 'Loads per week', loadCount + ' loads / ' + days + ' days', false, hasL ? ['kp', 'lpw'] : null) +
      metric(days ? Math.round(used / days * 100) + '%' : '--', 'Truck utilization', used + ' days with a load of ' + days, false, days ? ['kp', 'util'] : null) +
      metric(margin == null ? '--' : (margin * 100).toFixed(1) + '%', 'Net margin', money(fig.net) + ' of ' + money(fig.gross), false, margin == null ? null : ['kp', 'margin']) +
      metric(fuelPer == null ? '--' : rpm(fuelPer), 'Fuel per loaded mile', fig.deadMi == null ? 'All-miles fuel rate needs deadhead' : 'Loaded miles only in this label', false, fuelPer == null ? null : ['kp', 'fuelmi']) +
      metric(money0(fig.fees), 'Totni fees paid', (fig.feePct == null ? 'Mixed rates' : plainNum(fig.feePct, 2).replace(/\.00$/, '') + '%') + ' | through ' + formatDay(asOf), false, hasL ? ['kp', 'fees'] : null) +
      (all && fig.pay ? metric(money(fig.pay.received), 'Collected', 'Settlements received', false, ['kp', 'collected']) : '') +
      (all && fig.pay ? metric((fig.pay.owedEst ? '<span class="est">EST</span> ' : '') + money(fig.pay.owed), 'Still owed', fig.pay.detail, false, ['kp', 'owed']) : '');

    var weeksData = all ? weeksForLoads(usedLoads, periodStart, asOf, fig.expenses, fig.feePct) : weekRows(month);
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
        '<p class="chart-callout">' + esc(last.label) + ' <strong>' + money(last.gross) + '</strong> | prior ' + esc(prev.label) + ' ' +
        money(prev.gross) + ' (' + (delta >= 0 ? '+' : '-') + money(Math.abs(delta)) + ')</p></div>';
      var weekNetRows = weeksData.map(function (w) {
        return { label: w.label, value: Math.round(w.net || 0), text: searchMoney(Math.round(w.net || 0)) };
      });
      var weekNetChart = '<div class="chart"><h3>Net kept by week</h3>' +
        signedBarChart(weekNetRows, 'Weekly net kept') + '</div>';
      var weekMilesRows = weeksData.map(function (w) {
        return {
          label: w.label,
          a: Math.round(w.miles || 0),
          b: Math.round(w.deadMi || 0),
          textA: w.miles > 0 ? plainNum(Math.round(w.miles), 0) : '',
          textB: w.deadMi > 0 ? plainNum(Math.round(w.deadMi), 0) : ''
        };
      });
      var weekMilesChart = '<div class="chart"><h3>Miles by week (loaded vs deadhead)</h3>' +
        '<div class="chart-legend"><span><i style="background:#a78bfa"></i>Loaded</span><span><i style="background:#94a3b8"></i>Deadhead</span></div>' +
        dualBarChart(weekMilesRows, 'Weekly loaded vs deadhead miles', '#a78bfa', '#94a3b8') + '</div>';
      var rateBlock;
      if (withLoads.length < 2) {
        rateBlock = need('Not enough data', 'Only one week has loads, so revenue per mile cannot be compared week over week yet.');
      } else {
        var rateRows = weeksData.filter(function (row) { return row.rpm != null; }).map(function (row) {
          return { label: row.label, value: row.rpm, text: '$' + row.rpm.toFixed(2) };
        });
        rateBlock = '<div class="chart"><h3>$ per loaded mile by week</h3>' +
          barChart(rateRows, 'Weekly revenue per loaded mile') + '</div>';
      }
      wow = '<h2 class="sec">Week over week</h2>' + grossChart + weekNetChart + rateBlock + weekMilesChart;
    }

    var months = sortedMonths(feed);
    var mom;
    if (months.length < 2) {
      mom = '<h2 class="sec">Month over month</h2>' +
        need('Not enough data', 'Only one month is in the feed. The next monthly update adds this comparison.');
    } else {
      var rows = months.map(function (item) {
        var f = monthFigures(item);
        return { label: shortMonth(item.month), value: f.gross, text: money(f.gross), net: f.net, miles: f.loadedMi, deadMi: f.deadMi || 0 };
      });
      var a = rows[rows.length - 2];
      var b = rows[rows.length - 1];
      var netDelta = b.net - a.net;
      var mNetRows = rows.map(function (r) {
        return { label: r.label, value: Math.round(r.net), text: searchMoney(Math.round(r.net)) };
      });
      var mMiRows = rows.map(function (r) {
        return { label: r.label, a: Math.round(r.miles), b: Math.round(r.deadMi), textA: plainNum(Math.round(r.miles), 0), textB: plainNum(Math.round(r.deadMi), 0) };
      });
      mom = '<h2 class="sec">Month over month</h2><div class="chart"><h3>Gross by month</h3>' +
        barChart(rows, 'Monthly gross') +
        '<p class="chart-callout">' + esc(b.label) + ' net <strong>' + money(b.net) + '</strong> vs ' + esc(a.label) + ' ' + money(a.net) +
        ' (' + (netDelta >= 0 ? '+' : '-') + money(Math.abs(netDelta)) + ')</p></div>' +
        '<div class="chart"><h3>Net kept by month</h3>' + signedBarChart(mNetRows, 'Monthly net kept') + '</div>' +
        '<div class="chart"><h3>Miles by month</h3>' +
        '<div class="chart-legend"><span><i style="background:#a78bfa"></i>Loaded</span><span><i style="background:#94a3b8"></i>Deadhead</span></div>' +
        dualBarChart(mMiRows, 'Monthly loaded vs deadhead miles', '#a78bfa', '#94a3b8') + '</div>';
    }

    var periodLabel = all
      ? ('All time | ' + formatDay(fig.start) + ' - ' + formatDay(fig.end))
      : (monthTitle(month.month) + ' through ' + formatDay(asOf));
    root.innerHTML =
      '<p class="fine" id="kpi-stamp">' + esc(statusLine(feed)) + ' | ' + esc(periodLabel) + '</p>' +
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
    syncSeenLoads(data);
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
    text += ' | ' + APP_VERSION;
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
    if (typeof updateAppbar === 'function') updateAppbar();
  }

  function refreshSearches() {
    if (state.searchInflight) return state.searchInflight;
    setSearchRefreshing(true);
    // Cache-bust so the phone gets the newest saved scan, not a stale copy.
    // This only reloads data/load_searches.json. It does not start a new board search.
    // no-store plus the cache-bust query so a new scan shows without a version bump.
    var url = 'data/load_searches.json?t=' + Date.now();
    state.searchInflight = fetchTimed(url, { cache: 'no-store' }, 15000).then(function (res) {
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
      try { document.dispatchEvent(new CustomEvent('blackram:data', { detail: { kind: 'searches' } })); } catch (err) { /* old browser */ }
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
  var HOS_HOURS_PER_DAY = 11;
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

  function addCalendarDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function hosDaysFromMiles(loaded, dead, nLoads) {
    var hours = hoursEst(loaded, dead, nLoads);
    if (hours == null || !isFinite(Number(hours)) || Number(hours) <= 0) return null;
    return Math.max(1, Math.ceil(Number(hours) / HOS_HOURS_PER_DAY - 1e-9));
  }

  function efficientPostedSpan(pickupWindow, dropWindow, year, needed) {
    var pu = parseWindow(pickupWindow, year);
    var dr = parseWindow(dropWindow, year);
    if (!pu || !dr) return null;
    var need = needed && needed > 0 ? needed : 1;
    var earliestDrop = new Date(dr[0].getFullYear(), dr[0].getMonth(), dr[0].getDate());
    var earliestPu = new Date(pu[0].getFullYear(), pu[0].getMonth(), pu[0].getDate());
    var latestPu = new Date(pu[1].getFullYear(), pu[1].getMonth(), pu[1].getDate());
    var idealPu = addCalendarDays(earliestDrop, -(need - 1));
    var puDate;
    if (idealPu < earliestPu) puDate = earliestPu;
    else if (idealPu > latestPu) puDate = latestPu;
    else puDate = idealPu;
    var dropDate = addCalendarDays(puDate, need - 1);
    if (dropDate < earliestDrop) dropDate = earliestDrop;
    return calendarSpanDays(puDate, dropDate);
  }

  function computeDaysSpan(row, nLoads) {
    if (!row) return null;
    var loaded = rowLoadedMiles ? rowLoadedMiles(row) : (row.trip_mi != null ? row.trip_mi : row.loaded_mi);
    var dead = rowEmptyMiles ? rowEmptyMiles(row) : (row.origin_dh_mi != null ? row.origin_dh_mi : row.deadhead_mi);
    var n = nLoads && nLoads > 0 ? nLoads : 1;
    var needed = hosDaysFromMiles(loaded, dead, n);
    var start = ledgerDate(row.pickup_date || row.date);
    var end = ledgerDate(row.delivery_date);
    if (start && end) {
      var posted = calendarSpanDays(start, end);
      if (posted) return posted;
    }
    var span = efficientPostedSpan(row.pickup_window, row.drop_window, scanYear(), needed || 1);
    if (span) return span;
    return needed;
  }

  function tripDaysForRow(row, nLoads) {
    if (!row) return null;
    if (row.days_span != null && isFinite(Number(row.days_span)) && !state.truckAt) return Number(row.days_span);
    return computeDaysSpan(row, nLoads);
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

  function comboComputeDaysSpan(combo) {
    if (!combo) return null;
    if (combo.days_span != null && isFinite(Number(combo.days_span)) && !state.truckAt) return Number(combo.days_span);
    var loads = combo.loads || [];
    var n = loads.length || 1;
    var needed = hosDaysFromMiles(combo.loaded_mi, combo.deadhead_mi, n);
    var puWin = '', drWin = '';
    var stops = combo.stop_order || [];
    var i;
    for (i = 0; i < stops.length; i++) {
      if (String(stops[i].action || '').toLowerCase() === 'pickup' && String(stops[i].window || '').trim()) {
        puWin = stops[i].window;
        break;
      }
    }
    for (i = stops.length - 1; i >= 0; i--) {
      if (String(stops[i].action || '').toLowerCase() === 'drop' && String(stops[i].window || '').trim()) {
        drWin = stops[i].window;
        break;
      }
    }
    if (!puWin && loads[0]) puWin = loads[0].pickup_window || '';
    if (!drWin && loads.length) drWin = (loads[loads.length - 1].drop_window || '');
    var span = efficientPostedSpan(puWin, drWin, scanYear(), needed || 1);
    if (span) return span;
    return needed;
  }

  function rowDays(row, nLoads) {
    if (row && row.kind && (row.loads || row.stop_order)) return comboComputeDaysSpan(row);
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
      ? '<span class="days-badge">' + esc(formatDays(days)) + ' days</span>'
      : '';
    return '<div class="trip-days' + (low ? ' low-day' : '') + '">' +
      '<div class="td-cell"><span>Trip days</span><b>' + (days == null ? 'n/a' : esc(formatDays(days))) + '</b></div>' +
      '<div class="td-cell"><span>Net / day</span><b>' + (npd == null ? 'n/a' : esc(searchMoney(npd))) + '</b></div>' +
      badge +
      (low ? '<p class="day-warn">Under $300/day - this pay is spread across ' + esc(formatDays(days)) + (Number(days)===1 ? ' day.' : ' days.') + '</p>' : '') +
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
        ' after the 13% Totni fee (' + money2(feeAmt) + '). Fallback (no diesel price on file): fuel and DEF $1.14 x ' +
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
    var stop = fuel.diesel_stop ? ' | ' + fuel.diesel_stop : '';
    return '<p class="search-fuel">' + esc(dieselPhrase(fuel, 2)) + stop +
      ' | ' + Number(fuel.mpg).toFixed(1) + ' mpg + ' + money3(fuel.def_per_mi) + '/mi DEF | ' +
      money3(fuel.fuel_per_mi) + '/mi</p>';
  }

  function loadDieselPrices() {
    return fetchTimed('data/diesel_prices.json?t=' + Date.now(), { cache: 'no-cache' }, 10000).then(function (res) {
      if (!res.ok) throw new Error('diesel');
      return res.json();
    }).then(function (data) {
      state.dieselPrices = data;
      refreshTruckFuel();
      try { renderCheck(); } catch (e) { /* not ready yet */ }
      if (state.tab === 'targets' && window.BlackRamTargets) window.BlackRamTargets.render();
      if (state.searches) {
        state.scoredSearches = applyLocalScoring(cloneData(state.searches));
        if (state.tab === 'searches') renderSearches();
      }
    }).catch(function () { /* keep pipeline numbers / fallback */ });
  }

  function currentScanStamp() {
    if (!state.searches) return '';
    return String(state.searches.scanned_at || state.searches.as_of || '');
  }

  var PULL_STEP_LABELS = {
    queued: 'Queued',
    truckstop: 'Searching Truckstop',
    direct_freight: 'Searching Direct Freight',
    uship: 'Searching uShip',
    scoring: 'Scoring loads',
    live: 'Live',
    failed: 'Search failed',
    idle: 'Idle'
  };

  function pullIsActive(st) {
    if (!st) return false;
    var s = st.state;
    return s === 'queued' || s === 'truckstop' || s === 'direct_freight' || s === 'uship' || s === 'scoring';
  }

  function parsePullTime(stamp) {
    if (!stamp) return null;
    return parseScanStamp(stamp) || (function () {
      var d = new Date(stamp);
      return isNaN(d.getTime()) ? null : d;
    }());
  }

  function formatChicagoHM(stamp) {
    var d = parsePullTime(stamp);
    if (!d) return '';
    var parts = chicagoNowParts(d);
    var h = parts.hour;
    var ampm = h >= 12 ? 'PM' : 'AM';
    var hr = h % 12;
    if (!hr) hr = 12;
    return hr + ':' + pad2(parts.minute) + ' ' + ampm;
  }

  function formatAgeOld(ms) {
    if (ms == null || !isFinite(ms) || ms < 0) return '';
    var mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm old';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h old';
    var days = Math.floor(hrs / 24);
    return days + 'd old';
  }

  function isPullStuck(st) {
    if (!pullIsActive(st)) {
      if (state.freshPullLastOkAt && (Date.now() - state.freshPullLastOkAt) > 15 * 60 * 1000) {
        if (!st || !pullIsActive(st) && st.state !== 'live' && st.state !== 'failed') return true;
      }
      return false;
    }
    var d = parsePullTime(st.updated_at) || parsePullTime(st.started_at);
    if (!d) {
      return !!(state.freshPullLastOkAt && (Date.now() - state.freshPullLastOkAt) > 15 * 60 * 1000);
    }
    return (Date.now() - d.getTime()) > 15 * 60 * 1000;
  }

  function shouldKeepPullStatusPolling() {
    if (pullIsActive(state.pullStatus)) return true;
    if (state.freshPullLastOkAt && (Date.now() - state.freshPullLastOkAt) < 15 * 60 * 1000) {
      var st = state.pullStatus;
      if (st && (st.state === 'live' || st.state === 'failed')) {
        var upd = parsePullTime(st.updated_at);
        if (upd && upd.getTime() >= state.freshPullLastOkAt - 15000) return false;
      }
      return true;
    }
    return false;
  }

  function renderPullProgressHtml() {
    var st = state.pullStatus;
    var html = '<div class="pull-progress" id="pull-progress">';
    if (!st) {
      html += '<p class="pull-progress-meta" id="pull-progress-meta">' +
        (state.pullStatusError ? esc(state.pullStatusError) : 'Waiting for search status...') +
        '</p></div>';
      return html;
    }
    var pct = Math.max(0, Math.min(100, Number(st.pct)));
    if (!isFinite(pct)) pct = 0;
    pct = Math.round(pct);
    var label = PULL_STEP_LABELS[st.state] || st.state;
    var updated = formatChicagoHM(st.updated_at);
    var origin = st.origin ? String(st.origin) : '';
    var ageMs = (function () {
      var ref = parsePullTime(st.updated_at) || parsePullTime(st.started_at) || parsePullTime(currentScanStamp());
      return ref ? (Date.now() - ref.getTime()) : null;
    }());
    var fresh = ageMs != null && ageMs < 60 * 60 * 1000;
    var showLiveBar = st.state === 'live' && fresh;
    var showBar = pullIsActive(st) || showLiveBar || st.state === 'failed';
    if (showBar) {
      var fillCls = showLiveBar ? ' live' : (st.state === 'failed' ? ' failed' : '');
      html += '<div class="pull-progress-row">' +
        '<div class="pull-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
        pct + '" aria-label="Search progress">' +
        '<div class="pull-progress-fill' + fillCls + '" style="width:' + pct + '%"></div></div>' +
        '<span class="pull-progress-pct">' + pct + '%</span></div>';
      var stepText = pullIsActive(st) || showLiveBar ? (label + ' ' + pct + '%') : label;
      html += '<p class="pull-progress-step">' + esc(stepText) + '</p>';
    }
    if (st.state === 'live' && fresh) {
      var fits = st.counts && st.counts.fits != null ? Number(st.counts.fits) : null;
      var viewD = viewSearches();
      if (!weatherOn() && viewD && viewD.counts) fits = Number(viewD.counts.take || 0) + Number(viewD.counts.maybe || 0);
      var banner = 'Loads updated' + (updated ? ' ' + updated : '');
      if (fits != null && isFinite(fits)) banner += ' - ' + fits + ' fit' + (fits === 1 ? '' : 's');
      html += '<p class="pull-progress-banner ok">' + esc(banner) + '</p>';
    } else if (st.state === 'live' && !fresh) {
      var lastWhen = updated || formatChicagoHM(st.started_at) || formatChicagoHM(currentScanStamp());
      var ageLabel = formatAgeOld(ageMs);
      html += '<p class="pull-progress-meta">' +
        esc('Last pull ' + (lastWhen ? lastWhen + ' CT' : '') + (lastWhen && ageLabel ? ' - ' : '') + ageLabel) +
        '</p>';
    } else if (st.state === 'idle') {
      html += '<p class="pull-progress-meta">Last scan' +
        (updated ? ' ' + updated : (currentScanStamp() ? ' ' + esc(currentScanStamp()) : ' - none yet')) +
        (origin ? ' from ' + esc(origin) : '') + '</p>';
    } else if (st.state === 'failed') {
      html += '<p class="pull-progress-banner err">' + esc(st.message || 'Search failed') + '</p>';
    } else if (isPullStuck(st)) {
      html += '<p class="pull-progress-banner err">Search may be stuck</p>';
    }
    if (updated && st.state !== 'idle' && st.state !== 'live') {
      html += '<p class="pull-progress-meta">Last update ' + esc(updated) +
        (origin ? ' | ' + esc(origin) : '') + '</p>';
    }
    html += '</div>';
    return html;
  }

  function updatePullProgressDom() {
    var box = $('pull-progress');
    if (!box) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = renderPullProgressHtml();
    var next = wrap.firstChild;
    if (next) box.replaceWith(next);
    var pill = $('load-fresh-pill');
    if (pill) {
      var fresh = feedFreshnessPillInner();
      pill.className = fresh.cls;
      pill.textContent = fresh.text;
      pill.hidden = !fresh.text;
    }
  }

  function feedFreshnessRef() {
    var st = state.pullStatus;
    var liveAt = st && st.state === 'live' ? parsePullTime(st.updated_at) : null;
    var scanDt = parsePullTime(currentScanStamp());
    return liveAt || scanDt;
  }

  function feedFreshnessPillInner() {
    var st = state.pullStatus;
    var ref = feedFreshnessRef();
    var ageMs = ref ? (Date.now() - ref.getTime()) : null;
    if (st && st.state === 'live' && ageMs != null && ageMs < 60 * 60 * 1000) {
      return { cls: 'fresh-pill live', text: 'Live' };
    }
    if (ageMs == null) return { cls: 'fresh-pill', text: '' };
    return { cls: 'fresh-pill aged', text: formatAgeOld(ageMs) };
  }

  function fetchPullStatus() {
    var url = 'data/pull_status.json?t=' + Date.now();
    return fetchTimed(url, { cache: 'no-store' }, 10000).then(function (res) {
      if (!res.ok) throw new Error('status ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || typeof data !== 'object') throw new Error('bad status');
      var prev = state.pullStatus;
      state.pullStatus = data;
      state.pullStatusError = '';
      updatePullProgressDom();
      updateAppbar();
      if (data.state === 'live') {
        var becameLive = !prev || prev.state !== 'live' ||
          String(prev.updated_at || '') !== String(data.updated_at || '');
        if (becameLive && Date.now() - state.lastLiveRefreshAt > 8000) {
          state.lastLiveRefreshAt = Date.now();
          refreshSearches();
        }
      }
      if (!shouldKeepPullStatusPolling()) stopPullStatusPolling();
      return data;
    }).catch(function () {
      if (!state.pullStatus) state.pullStatusError = 'Could not load search status.';
      updatePullProgressDom();
    });
  }

  function stopPullStatusPolling() {
    if (state.pullStatusTimer) {
      clearInterval(state.pullStatusTimer);
      state.pullStatusTimer = null;
    }
  }

  function startPullStatusPolling() {
    if (state.pullStatusTimer) return;
    fetchPullStatus();
    state.pullStatusTimer = setInterval(function () {
      if (!shouldKeepPullStatusPolling() && state.pullStatus && !pullIsActive(state.pullStatus)) {
        stopPullStatusPolling();
        return;
      }
      fetchPullStatus();
    }, 12000);
  }

  function stopFreshPullPolling() {
    if (state.freshPullPollTimer) {
      clearInterval(state.freshPullPollTimer);
      state.freshPullPollTimer = null;
    }
  }

  function startFreshPullPolling() {
    stopFreshPullPolling();
    state.freshPullBaseline = currentScanStamp();
    state.freshPullPollEnd = Date.now() + 15 * 60 * 1000;
    startPullStatusPolling();
    state.freshPullPollTimer = setInterval(function () {
      if (Date.now() > state.freshPullPollEnd) {
        stopFreshPullPolling();
        if (isPullStuck(state.pullStatus) || shouldKeepPullStatusPolling()) updatePullProgressDom();
        return;
      }
      refreshSearches().then(function () {
        var nowStamp = currentScanStamp();
        if (nowStamp && nowStamp !== state.freshPullBaseline) {
          stopFreshPullPolling();
          if (!state.freshPullStatus || state.freshPullStatusType !== 'ok') {
            setFreshPullStatus('New loads arrived (' + nowStamp + ').', 'ok');
          }
        }
      });
    }, 20000);
  }

  function renderConnectPanel() {
    if (!state.relayConnectOpen) return '';
    var connected = !!getRelayPin();
    var msg = state.relayConnectMsg || (connected ? 'Connected - PIN saved on this phone.' : 'Enter your app PIN once to pull loads and sync deliveries.');
    var msgCls = state.relayConnectErr ? ' err' : (connected && !state.relayConnectMsg ? ' ok' : (state.relayConnectMsg && !state.relayConnectErr ? ' ok' : ''));
    return '<div class="relay-connect-panel" id="relay-connect-panel">' +
      '<h3>Connect to Grok Bot</h3>' +
      '<p class="fine">Saved in this phone\'s browser only.</p>' +
      '<form id="relay-connect-form" action="#" class="relay-connect-form">' +
        '<input type="password" id="relay-pin-input" inputmode="numeric" autocomplete="off" placeholder="' + (connected ? 'PIN saved (enter new to change)' : 'Enter app PIN') + '">' +
        '<button type="submit" class="btn primary" id="relay-pin-save">Save PIN</button>' +
        (connected ? '<button type="button" class="btn" id="relay-pin-clear">Disconnect</button>' : '') +
      '</form>' +
      '<p class="relay-connect-status' + msgCls + '" id="relay-connect-status">' + esc(msg) + '</p>' +
      '</div>';
  }

  function renderFreshPull() {
    var origin = state.freshOriginRec || currentTruckPoint() || {};
    var originLabel = state.freshOriginText != null ? state.freshOriginText : (origin.label || '');
    var destLabel = state.freshDestText || '';
    var anyChecked = state.freshAnywhere !== false;
    var rad = Number(state.freshRadius || 150);
    var connected = !!getRelayPin();
    var stText = state.freshPullStatus || '';
    var stCls = state.freshPullStatusType ? (' ' + state.freshPullStatusType) : '';
    return '<div class="fresh-pull-top" id="fresh-pull">' +
      '<div class="fresh-pull-head">' +
        '<h3>Pull fresh loads</h3>' +
        '<span class="fresh-pull-badge' + (connected ? ' connected' : '') + '">' + (connected ? 'Connected' : 'PIN needed') + '</span>' +
      '</div>' +
      '<p class="fine">Triggers a live Grok Bot board scan from your current location. New loads arrive in a few minutes.</p>' +
      '<form id="fresh-pull-form" action="#" class="fresh-pull-form">' +
        '<label class="fresh-pull-field">Origin' +
          '<div class="truck-at-lookup">' +
            '<input type="text" id="fresh-origin" placeholder="City, address, or ZIP" value="' + esc(originLabel) + '" autocomplete="off" autocapitalize="words">' +
            '<ul class="truck-at-suggests" id="fresh-origin-suggests" hidden></ul>' +
          '</div></label>' +
        '<button type="button" class="btn fresh-pull-gps-btn" id="fresh-origin-gps">Use my GPS</button>' +
        '<label class="fresh-pull-anywhere"><input type="checkbox" id="fresh-anywhere"' + (anyChecked ? ' checked' : '') + '> Anywhere</label>' +
        '<label class="fresh-pull-field" id="fresh-dest-wrap">Destination' +
          '<div class="truck-at-lookup">' +
            '<input type="text" id="fresh-dest" placeholder="City, address, or ZIP" value="' + esc(destLabel) + '" autocomplete="off" autocapitalize="words"' + (anyChecked ? ' disabled' : '') + '>' +
            '<ul class="truck-at-suggests" id="fresh-dest-suggests" hidden></ul>' +
          '</div></label>' +
        '<label class="fresh-pull-field">Deadhead radius' +
          '<select id="fresh-radius">' +
            '<option value="50"' + (rad === 50 ? ' selected' : '') + '>50 mi</option>' +
            '<option value="100"' + (rad === 100 ? ' selected' : '') + '>100 mi</option>' +
            '<option value="150"' + (rad === 150 ? ' selected' : '') + '>150 mi</option>' +
            '<option value="250"' + (rad === 250 ? ' selected' : '') + '>250 mi</option>' +
          '</select></label>' +
        '<button type="submit" class="fresh-pull-go-btn" id="fresh-pull-go"' + (state.freshPullBusy ? ' disabled' : '') + '>' +
          (state.freshPullBusy ? 'Starting search...' : 'Pull fresh loads') +
        '</button>' +
      '</form>' +
      '<p class="fresh-pull-status' + stCls + '" id="fresh-pull-status">' + esc(stText) + '</p>' +
      renderPullProgressHtml() +
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

  function resolvePlaceIfTyped(inputEl, currentRec) {
    var text = inputEl ? String(inputEl.value || '').trim() : '';
    if (!text) return Promise.resolve(null);
    if (currentRec && currentRec.lat != null && currentRec.lon != null &&
        String(currentRec.label || '').trim().toLowerCase() === text.toLowerCase()) {
      return Promise.resolve({ label: currentRec.label, lat: Number(currentRec.lat), lon: Number(currentRec.lon) });
    }
    return suggestPlaces(text).then(function (items) {
      if (items && items.length && items[0].lat != null) {
        var top = items[0];
        if (inputEl) inputEl.value = top.label || text;
        return { label: top.label || text, lat: Number(top.lat), lon: Number(top.lon) };
      }
      return null;
    }).catch(function () { return null; });
  }

  function setFreshPullStatus(text, type) {
    state.freshPullStatus = text || '';
    state.freshPullStatusType = type || '';
    var st = $('fresh-pull-status');
    if (st) {
      st.textContent = state.freshPullStatus;
      st.className = 'fresh-pull-status' + (type ? (' ' + type) : '');
    }
  }

  function bindConnectPanel() {
    var gear = $('relay-gear-btn');
    if (gear && !gear._bound) {
      gear._bound = true;
      gear.addEventListener('click', function () {
        state.relayConnectOpen = !state.relayConnectOpen;
        state.relayConnectMsg = '';
        state.relayConnectErr = false;
        renderSearches();
      });
    }
    var form = $('relay-connect-form');
    if (form && !form._bound) {
      form._bound = true;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var inp = $('relay-pin-input');
        var val = inp ? String(inp.value || '').trim() : '';
        if (!val) {
          state.relayConnectMsg = 'Type your PIN first.';
          state.relayConnectErr = true;
          renderSearches();
          return;
        }
        setRelayPin(val);
        state.relayConnectMsg = 'PIN saved on this phone.';
        state.relayConnectErr = false;
        state.relayConnectOpen = false;
        renderSearches();
        flushDeliveredOutbox();
      });
    }
    var clearBtn = $('relay-pin-clear');
    if (clearBtn && !clearBtn._bound) {
      clearBtn._bound = true;
      clearBtn.addEventListener('click', function () {
        setRelayPin('');
        state.relayConnectMsg = 'Disconnected - PIN removed.';
        state.relayConnectErr = false;
        renderSearches();
      });
    }
  }

  function bindFreshPull() {
    var form = $('fresh-pull-form');
    if (!form || form._bound) return;
    form._bound = true;
    var originRec = state.freshOriginRec || (currentTruckPoint() ? { label: currentTruckPoint().label, lat: currentTruckPoint().lat, lon: currentTruckPoint().lon } : null);
    var destRec = state.freshDestRec || null;
    var originInp = $('fresh-origin');
    var destInp = $('fresh-dest');
    var radSel = $('fresh-radius');
    if (originInp) originInp.addEventListener('input', function () { state.freshOriginText = originInp.value; });
    if (destInp) destInp.addEventListener('input', function () { state.freshDestText = destInp.value; });
    if (radSel) radSel.addEventListener('change', function () { state.freshRadius = Number(radSel.value) || 150; });
    bindSuggestInput('fresh-origin', 'fresh-origin-suggests', function (rec) { originRec = rec; state.freshOriginRec = rec; state.freshOriginText = rec.label; });
    bindSuggestInput('fresh-dest', 'fresh-dest-suggests', function (rec) { destRec = rec; state.freshDestRec = rec; state.freshDestText = rec.label; });
    var any = $('fresh-anywhere');
    var dest = $('fresh-dest');
    function syncAnywhere() {
      var chk = !!(any && any.checked);
      state.freshAnywhere = chk;
      if (dest) dest.disabled = chk;
      var wrap = $('fresh-dest-wrap');
      if (wrap) wrap.hidden = chk;
    }
    if (any) any.addEventListener('change', syncAnywhere);
    syncAnywhere();
    var gps = $('fresh-origin-gps');
    if (gps) gps.addEventListener('click', function () {
      if (!navigator.geolocation) {
        setFreshPullStatus('This browser cannot share a location.', 'err');
        return;
      }
      setFreshPullStatus('Finding your GPS location...', '');
      navigator.geolocation.getCurrentPosition(function (pos) {
        reverseGeocode(pos.coords.latitude, pos.coords.longitude).then(function (rec) {
          originRec = rec;
          var inp = $('fresh-origin');
          if (inp) inp.value = rec.label || '';
          setFreshPullStatus('Using GPS: ' + (rec.label || 'Current location'), '');
        });
      }, function () {
        setFreshPullStatus('Location was not available. Type a city or ZIP.', 'err');
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.freshPullBusy) return;
      if (!getRelayPin()) {
        state.relayConnectOpen = true;
        state.relayConnectMsg = 'Enter your app PIN to pull fresh loads.';
        state.relayConnectErr = true;
        setFreshPullStatus('Enter your app PIN in Connect first.', 'err');
        renderSearches();
        var pinInput = $('relay-pin-input');
        if (pinInput) pinInput.focus();
        return;
      }
      var cooldownLeft = state.freshPullLastOkAt ? Math.ceil((120000 - (Date.now() - state.freshPullLastOkAt)) / 1000) : 0;
      if (cooldownLeft > 0) {
        setFreshPullStatus('Search already running - wait ' + cooldownLeft + 's before starting another.', 'err');
        return;
      }
      state.freshPullBusy = true;
      var goBtn = $('fresh-pull-go');
      if (goBtn) { goBtn.disabled = true; goBtn.textContent = 'Starting search...'; }
      setFreshPullStatus('Sending request to Grok Bot...', '');

      var originEl = $('fresh-origin');
      var destEl = $('fresh-dest');
      var isAny = !!(any && any.checked);
      var rad = Number($('fresh-radius') && $('fresh-radius').value) || 150;

      Promise.all([
        resolvePlaceIfTyped(originEl, originRec),
        isAny ? Promise.resolve('anywhere') : resolvePlaceIfTyped(destEl, destRec)
      ]).then(function (resolved) {
        var o = resolved[0];
        var d = resolved[1];
        if (!o || o.lat == null || o.lon == null) {
          state.freshPullBusy = false;
          if (goBtn) { goBtn.disabled = false; goBtn.textContent = 'Pull fresh loads'; }
          setFreshPullStatus('Pick an origin city, ZIP, or tap Use my GPS.', 'err');
          return;
        }
        originRec = o;
        if (!isAny && (!d || d === 'anywhere' || d.lat == null || d.lon == null)) {
          state.freshPullBusy = false;
          if (goBtn) { goBtn.disabled = false; goBtn.textContent = 'Pull fresh loads'; }
          setFreshPullStatus('Pick a destination city or check Anywhere.', 'err');
          return;
        }
        if (!isAny) destRec = d;
        var payload = {
          origin: o,
          destination: isAny ? 'anywhere' : d,
          radius_mi: rad,
          max_weight_lb: 19999
        };
        return postRelayRequest('fresh_pull', payload).then(function (res) {
          state.freshPullBusy = false;
          if (goBtn) { goBtn.disabled = false; goBtn.textContent = 'Pull fresh loads'; }
          if (res.ok) {
            state.freshPullLastOkAt = Date.now();
            setFreshPullStatus('Search started - loads arrive in a few minutes', 'ok');
            startFreshPullPolling();
            return;
          }
          if (res.wrongPin) {
            state.relayConnectOpen = true;
            state.relayConnectMsg = 'Wrong PIN. Re-enter your PIN and tap Save PIN.';
            state.relayConnectErr = true;
            setFreshPullStatus('Wrong PIN - tap Connect to fix your PIN.', 'err');
            renderSearches();
            return;
          }
          setFreshPullStatus(res.error || 'Could not start search.', 'err');
        });
      }).catch(function () {
        state.freshPullBusy = false;
        if (goBtn) { goBtn.disabled = false; goBtn.textContent = 'Pull fresh loads'; }
        setFreshPullStatus('Could not start search. Try again.', 'err');
      });
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
    if (row.width_ft != null && Number(row.width_ft) > 8.5) {
      flags.push('Over 8.5 ft wide - cannot haul');
      hard = true;
    }
    if (row.weight_lb == null) flags.push('weight not listed');
    var wxOn = weatherOn();
    var wxNotes = [];
    var keepFlags = (row.fit_flags || []).filter(function (f) {
      return /infeasible|cannot haul|misses the|pickup is only|too cold at drop|ice or snow on route|gusts 50\+|^uShip:/i.test(String(f));
    });
    if (!wxOn) {
      keepFlags = keepFlags.filter(function (f) {
        if (isWxFlag(f)) { pushUnique(wxNotes, String(f)); return false; }
        return true;
      });
    }
    flags = flags.concat(keepFlags);
    if (keepFlags.some(function (f) { return /infeasible|cannot haul|misses the|pickup is only/i.test(String(f)); })) hard = true;
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
    var savedSpan = row.days_span;
    delete row.days;
    delete row.net_per_day;
    if (savedSpan != null && isFinite(Number(savedSpan))) row.days_span = savedSpan;
    var days = tripDaysForRow(row, 1);
    row.days_span = days;
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
    var dropLow = row.drop_low_f;
    var tooCold = flags.some(function (f) { return String(f).indexOf('too cold at drop') !== -1; });
    var coldNote = '';
    if (!tooCold && dropLow != null && isFinite(Number(dropLow)) && Math.round(Number(dropLow)) <= 45) {
      var src = String(row.drop_low_source || '');
      var lowTxt = (src === 'normal' ? 'normal low ' : 'low ') + Math.round(Number(dropLow)) + ' F';
      coldNote = 'too cold at drop - ' + lowTxt + ', would idle overnight';
      if (wxOn) {
        flags.push(coldNote);
        tooCold = true;
      }
    }
    if (wxOn && tooCold) verdict = 'PASS';
    if (!wxOn && coldNote) pushUnique(wxNotes, coldNote);
    var iceSnow = flags.some(function (f) { return String(f).indexOf('ice or snow on route') !== -1; });
    var gust50 = flags.some(function (f) { return String(f).indexOf('gusts 50+') !== -1; });
    var pts = (row.route_wx && row.route_wx.points) ? row.route_wx.points : [];
    pts.forEach(function (pt) {
      var hz = pt.hazards || [];
      if (hz.indexOf('ice') !== -1 || hz.indexOf('snow') !== -1) iceSnow = true;
      if (pt.gust_mph != null && Number(pt.gust_mph) >= 50) gust50 = true;
    });
    if (wxOn) {
      if (iceSnow && flags.indexOf('ice or snow on route') === -1) flags.push('ice or snow on route');
      if (gust50 && flags.indexOf('gusts 50+ mph on route') === -1) flags.push('gusts 50+ mph on route');
      if (verdict === 'TAKE' && (iceSnow || gust50)) verdict = 'MAYBE';
    } else {
      if (wxNotes.some(function (f) { return /ice or snow/i.test(f); })) iceSnow = true;
      if (wxNotes.some(function (f) { return /gusts 50/i.test(f); })) gust50 = true;
      if (iceSnow) pushUnique(wxNotes, 'ice or snow on route');
      if (gust50) pushUnique(wxNotes, 'gusts 50+ mph on route');
    }
    // v86 uShip: bid listings (no Book now price) are never better than MAYBE.
    if (isUshipBid(row)) {
      if (!flags.some(function (f) { return /^uShip:/.test(String(f)); })) flags.push('uShip: bid listing - not a booked rate');
      if (verdict === 'TAKE') verdict = 'MAYBE';
    }
    row.weather_flags = wxOn ? flags.filter(isWxFlag) : wxNotes;
    row.fit_flags = flags;
    row.verdict = verdict;
    delete row.reason;
    row.reason = verdictReason(row);
    return row;
  }

  function rescoreCombo(combo, origCombo) {
    var wxOn = weatherOn();
    var comboWxNotes = [];
    if (!wxOn) {
      // Weather OFF: go back to the pre-weather verdict the feed saved.
      (combo.flags || []).forEach(function (f) { if (isWxFlag(f)) pushUnique(comboWxNotes, String(f)); });
      combo.flags = (combo.flags || []).filter(function (f) { return !isWxFlag(f); });
      if (combo.base_verdict) {
        combo.verdict = combo.base_verdict;
        if (combo.base_reason != null) combo.reason = combo.base_reason;
        else delete combo.reason;
      }
    }
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
    var savedComboSpan = combo.days_span;
    delete combo.days;
    delete combo.net_per_day;
    if (savedComboSpan != null && isFinite(Number(savedComboSpan))) combo.days_span = savedComboSpan;
    var days = rowDays(combo, loads.length);
    combo.days_span = days;
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
    var cLow = combo.drop_low_f;
    var cFlags = combo.flags || [];
    var comboCold = cFlags.some(function (f) { return String(f).indexOf('too cold at drop') !== -1; });
    var cColdTxt = '';
    if (!comboCold && cLow != null && isFinite(Number(cLow)) && Math.round(Number(cLow)) <= 45) {
      var cSrc = String(combo.drop_low_source || '');
      var cTxt = (cSrc === 'normal' ? 'normal low ' : 'low ') + Math.round(Number(cLow)) + ' F';
      cColdTxt = 'too cold at drop - ' + cTxt + ', would idle overnight';
      if (wxOn) {
        cFlags = cFlags.concat([cColdTxt]);
        combo.flags = cFlags;
        comboCold = true;
      }
    }
    var cPts = (combo.route_wx && combo.route_wx.points) ? combo.route_wx.points : [];
    var cIce = cFlags.some(function (f) { return String(f).indexOf('ice or snow on route') !== -1; });
    var cGust = cFlags.some(function (f) { return String(f).indexOf('gusts 50+') !== -1; });
    cPts.forEach(function (pt) {
      var hz = pt.hazards || [];
      if (hz.indexOf('ice') !== -1 || hz.indexOf('snow') !== -1) cIce = true;
      if (pt.gust_mph != null && Number(pt.gust_mph) >= 50) cGust = true;
    });
    if (!wxOn) {
      if (cColdTxt) pushUnique(comboWxNotes, cColdTxt);
      if (cIce) pushUnique(comboWxNotes, 'ice or snow on route');
      if (cGust) pushUnique(comboWxNotes, 'gusts 50+ mph on route');
      combo.weather_flags = comboWxNotes;
      return combo;
    }
    if (comboCold) {
      combo.verdict = 'PASS';
      var coldFlag = (combo.flags || []).filter(function (f) { return String(f).indexOf('too cold at drop') !== -1; })[0];
      if (coldFlag) combo.reason = /[.]$/.test(coldFlag) ? coldFlag : coldFlag + '.';
    } else {
      if (cIce && cFlags.indexOf('ice or snow on route') === -1) cFlags.push('ice or snow on route');
      if (cGust && cFlags.indexOf('gusts 50+ mph on route') === -1) cFlags.push('gusts 50+ mph on route');
      combo.flags = cFlags;
      if (combo.verdict === 'TAKE' && (cIce || cGust)) {
        combo.verdict = 'MAYBE';
        combo.reason = cIce
          ? 'Clears the combo bar, but ice or snow is on the route.'
          : 'Clears the combo bar, but gusts of 50+ mph are on the route.';
      }
    }
    combo.weather_flags = (combo.flags || []).filter(isWxFlag);
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

  var HIDDEN_HEAVY_LB = 20000;

  function isHiddenHeavyLoad(row) {
    return row && row.weight_lb != null && isFinite(Number(row.weight_lb)) && Number(row.weight_lb) >= HIDDEN_HEAVY_LB;
  }

  function stripHiddenHeavy(data) {
    if (!data) return data;
    var prior = Number(data.hidden_heavy || (data.counts && data.counts.hidden_heavy) || 0) || 0;
    var extra = 0;
    var loads = (data.loads || []).filter(function (row) {
      if (isHiddenHeavyLoad(row)) { extra += 1; return false; }
      return true;
    });
    data.loads = loads;
    if (data.combos) {
      data.combos = data.combos.filter(function (combo) {
        return !(combo.loads || []).some(isHiddenHeavyLoad);
      });
    }
    data.hidden_heavy = prior + extra;
    return data;
  }

  function applyLocalScoring(data) {
    stripHiddenHeavy(data);
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
    var counts = { total: loads.length, take: 0, maybe: 0, pass: 0, hidden_heavy: Number(data.hidden_heavy || 0) || 0 };
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
    if (state.truckAtBusy) text += ' | updating miles...';
    if (state.truckAtError) text += ' | ' + esc(state.truckAtError);
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
    var TB = window.BRMap;
    truckMap = L.map(el, {
      scrollWheelZoom: false,
      attributionControl: false,
      tap: true
    });
    L.control.attribution({ prefix: false }).addTo(truckMap);
    // CARTO now needs an API key (tiles showed 'API KEY REQUIRED'), so use the
    // same no-key Esri base plus colored state fills as the other maps.
    if (TB && TB.tiles) {
      TB.tiles(truckMap, 16);
      if (TB.addStates) TB.addStates(truckMap);
    } else {
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16,
        attribution: 'Tiles (c) <a href="https://www.esri.com/">Esri</a>'
      }).addTo(truckMap);
    }
    var truckPin = L.circleMarker([p.lat, p.lon], {
      radius: 10,
      color: '#fff',
      weight: 3,
      fillColor: '#0EA5E9',
      fillOpacity: 1
    }).addTo(truckMap).bindPopup(p.label || 'Truck');
    nearbyPickupPins(p).forEach(function (pin) {
      if (pin.mi > 150) return;
      var m = L.circleMarker([pin.lat, pin.lon], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: '#16A34A',
        fillOpacity: 1
      }).addTo(truckMap);
      m.bindPopup(pin.label + (pin.mi != null ? ' | ' + Math.round(pin.mi) + ' mi' : ''));
    });
    if (TB) {
      TB.legendControl(truckMap, '<div class="br-lg"><span><i class="br-dot y"></i>Truck</span><span><i class="br-dot p"></i>Pickups nearby</span></div>');
    }
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


  function bindRigDiagram() {
    var overlay = $('rig-zoom');
    var stage = $('rig-zoom-stage');
    var img = $('rig-zoom-img');
    var btnIn = $('rig-zoom-in');
    var btnOut = $('rig-zoom-out');
    var btnClose = $('rig-zoom-close');
    var openBtn = $('rig-diagram-open');
    if (!overlay || !stage || !img) return;

    var scale = 1;
    var minScale = 0.1;
    var maxScale = 1.25;
    var lastFocus = null;
    var pointers = {};
    var pinch = null;
    var pan = null;

    function natural() {
      return {
        w: img.naturalWidth || 4400,
        h: img.naturalHeight || 2688
      };
    }

    function fitScale() {
      var n = natural();
      var sw = stage.clientWidth || 1;
      var sh = stage.clientHeight || 1;
      return Math.min(sw / n.w, sh / n.h);
    }

    function readableScale() {
      var n = natural();
      var targetW = Math.min(n.w, Math.max(1200, (stage.clientWidth || 390) * 3));
      return Math.min(1, targetW / n.w);
    }

    function applyScale() {
      var n = natural();
      img.style.width = (n.w * scale) + 'px';
      img.style.height = (n.h * scale) + 'px';
    }

    function setScale(next, cx, cy) {
      var prev = scale;
      scale = Math.max(minScale, Math.min(maxScale, next));
      var n = natural();
      var sx = stage.scrollLeft;
      var sy = stage.scrollTop;
      var px = (cx != null) ? cx : (sx + stage.clientWidth / 2);
      var py = (cy != null) ? cy : (sy + stage.clientHeight / 2);
      var ratio = scale / (prev || scale);
      applyScale();
      stage.scrollLeft = px * ratio - (cx != null ? (cx - sx) : stage.clientWidth / 2);
      stage.scrollTop = py * ratio - (cy != null ? (cy - sy) : stage.clientHeight / 2);
    }

    function openZoom() {
      lastFocus = document.activeElement;
      overlay.hidden = false;
      document.documentElement.classList.add('sheet-open');
      document.documentElement.classList.add('rig-zoom-open');
      function start() {
        minScale = Math.max(0.05, fitScale());
        maxScale = Math.max(1.25, minScale * 6);
        scale = Math.max(minScale, readableScale());
        applyScale();
        var n = natural();
        stage.scrollLeft = 0;
        stage.scrollTop = 0;
        if (btnClose) btnClose.focus();
      }
      if (img.complete && img.naturalWidth) start();
      else img.addEventListener('load', start, { once: true });
    }

    function closeZoom() {
      if (overlay.hidden) return;
      overlay.hidden = true;
      document.documentElement.classList.remove('sheet-open');
      document.documentElement.classList.remove('rig-zoom-open');
      pointers = {};
      pinch = null;
      pan = null;
      if (lastFocus && typeof lastFocus.focus === 'function') {
        try { lastFocus.focus(); } catch (err) { /* ignore */ }
      }
    }

    if (openBtn) {
      openBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        openZoom();
      });
    }
    if (btnClose) btnClose.addEventListener('click', closeZoom);
    if (btnIn) btnIn.addEventListener('click', function () { setScale(scale * 1.35); });
    if (btnOut) btnOut.addEventListener('click', function () { setScale(scale / 1.35); });

    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) closeZoom();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !overlay.hidden) {
        ev.preventDefault();
        closeZoom();
      }
    });

    stage.addEventListener('wheel', function (ev) {
      if (overlay.hidden) return;
      ev.preventDefault();
      var rect = stage.getBoundingClientRect();
      var cx = ev.clientX - rect.left + stage.scrollLeft;
      var cy = ev.clientY - rect.top + stage.scrollTop;
      var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      setScale(scale * factor, cx, cy);
    }, { passive: false });

    stage.addEventListener('pointerdown', function (ev) {
      if (overlay.hidden) return;
      stage.setPointerCapture(ev.pointerId);
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var dx = a.x - b.x, dy = a.y - b.y;
        pinch = {
          dist: Math.sqrt(dx * dx + dy * dy) || 1,
          scale: scale,
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2
        };
        pan = null;
      } else if (ids.length === 1) {
        pan = { x: ev.clientX, y: ev.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
      }
    });

    stage.addEventListener('pointermove', function (ev) {
      if (overlay.hidden || !pointers[ev.pointerId]) return;
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (pinch && ids.length >= 2) {
        ev.preventDefault();
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var dx = a.x - b.x, dy = a.y - b.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var rect = stage.getBoundingClientRect();
        var midX = (a.x + b.x) / 2 - rect.left + stage.scrollLeft;
        var midY = (a.y + b.y) / 2 - rect.top + stage.scrollTop;
        setScale(pinch.scale * (dist / pinch.dist), midX, midY);
      } else if (pan && ids.length === 1) {
        ev.preventDefault();
        stage.scrollLeft = pan.sl - (ev.clientX - pan.x);
        stage.scrollTop = pan.st - (ev.clientY - pan.y);
      }
    });

    function endPointer(ev) {
      delete pointers[ev.pointerId];
      var ids = Object.keys(pointers);
      if (ids.length < 2) pinch = null;
      if (ids.length === 1) {
        var p = pointers[ids[0]];
        pan = { x: p.x, y: p.y, sl: stage.scrollLeft, st: stage.scrollTop };
      } else {
        pan = null;
      }
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('pointerleave', function (ev) {
      if (pointers[ev.pointerId]) endPointer(ev);
    });

    window.BlackRamApp = Object.assign(window.BlackRamApp || {}, {
      openRigDiagram: openZoom,
      closeRigDiagram: closeZoom
    });
  }

  function bindRigPhoto() {
    var img = $('rig-photo');
    var reflect = $('rig-reflect');
    function apply(el, fallbackSrc) {
      if (!el) return;
      var srcset = el.getAttribute('data-srcset');
      var src = el.getAttribute('data-src') || fallbackSrc || '';
      if (srcset && !el.getAttribute('srcset')) el.srcset = srcset;
      if (src && !el.getAttribute('src')) el.src = src;
    }
    if (img) {
      var sources = img.parentNode ? img.parentNode.querySelectorAll('source[data-srcset]') : [];
      for (var i = 0; i < sources.length; i++) {
        if (!sources[i].srcset) sources[i].srcset = sources[i].getAttribute('data-srcset') || '';
      }
      apply(img);
      apply(reflect, img.getAttribute('src') || img.getAttribute('data-src') || '');
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
    if (n == null || !isFinite(Number(n))) return 'neutral';
    n = Number(n);
    if (n >= 35) return 'good';
    if (n >= 20) return 'ok';
    return 'low';
  }

  function mileTone(n) {
    if (n == null || !isFinite(Number(n))) return 'neutral';
    n = Number(n);
    if (n >= 0.8) return 'good';
    if (n >= 0.4) return 'ok';
    return 'low';
  }

  function dayTone(n) {
    if (n == null || !isFinite(Number(n))) return 'neutral';
    n = Number(n);
    if (n >= 300) return 'good';
    if (n >= 200) return 'ok';
    return 'low';
  }

  function netTone(net, row, nLoads) {
    if (net == null || !isFinite(Number(net))) return 'neutral';
    var v = Number(net);
    var isCombo = !!(nLoads && nLoads > 1) || !!(row && row.kind);
    var bar = isCombo ? 1000 : ((row && row.bar != null && isFinite(Number(row.bar))) ? Number(row.bar) : ((row && row.same_day) ? 300 : 500));
    var strong = isCombo ? 1500 : ((row && row.same_day) ? 420 : 700);
    if (v >= strong) return 'good';
    if (v >= bar) return 'ok';
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

  function kmTile(label, valueHtml, tone, subHtml, primary) {
    var cls = 'km-tile ' + (tone || 'neutral') + (primary ? ' km-primary' : '');
    return '<div class="' + cls + '">' +
      '<span class="km-label">' + esc(label) + '</span>' +
      '<b class="km-val">' + valueHtml + '</b>' +
      (subHtml ? '<span class="km-sub">' + subHtml + '</span>' : '') +
      '</div>';
  }

  function keyMetricsGrid(row, opts) {
    if (!row) return '';
    opts = opts || {};
    var nLoads = opts.nLoads || ((row.loads && row.loads.length) ? row.loads.length : 1);
    var isPast = !!opts.isPast;
    var netVal = row.net_est != null && isFinite(Number(row.net_est)) ? Number(row.net_est) : opts.afterFeeNet;
    var perHour = perHourValue(row, nLoads);
    var days = rowDays(row, nLoads);
    var npd = rowNetPerDay(row, nLoads);
    if (npd == null && netVal != null && days && days > 0) npd = netVal / days;
    var netMi = netPerMileValue(row);
    var grossMi = grossPerMileValue(row);
    var loadedMi = rateLoadedValue(row);

    var isCombo = !!(row.kind || (row.loads && row.loads.length > 1));
    var bar = isCombo ? 1000 : ((row.bar != null && isFinite(Number(row.bar))) ? Number(row.bar) : (row.same_day ? 300 : 500));
    var netLabel = opts.usedActualFuel ? 'Net (actual fuel)' : 'Net EST';
    var netSub = 'Bar $' + plainNum(bar, 0);
    if (opts.actualPaid != null) {
      netSub = 'Actual net ' + money(opts.actualPaid) + ' (paid)';
    } else if (opts.afterFeeNet != null) {
      netSub = 'After fee ' + money(opts.afterFeeNet) + ' | Bar $' + plainNum(bar, 0);
    }
    var netTile = kmTile(netLabel, esc(searchMoney(netVal)), netTone(netVal, row, nLoads), esc(netSub), true);

    var hrs = row.hours != null && isFinite(Number(row.hours))
      ? Number(row.hours)
      : hoursEst(rowLoadedMiles(row), rowEmptyMiles(row), nLoads);
    var hrSub = hrs != null && isFinite(hrs) ? (hrs.toFixed(1) + 'h est') : '';
    var hrTile = kmTile('$/hr EST', perHour != null ? esc(searchMoney(perHour)) + '/hr' : 'n/a', hourTone(perHour), esc(hrSub), false);

    var dayLabel = days != null ? (formatDays(days) + (Number(days) === 1 ? ' day' : ' days')) : 'Days n/a';
    var dayTile = kmTile('Net / day', npd != null ? esc(searchMoney(npd)) + '/d' : 'n/a', dayTone(npd), esc(dayLabel), false);

    var miSub = '';
    if (grossMi != null && isFinite(Number(grossMi))) {
      miSub = 'Gross ' + rateMoney(grossMi, 2);
      if (loadedMi != null && isFinite(Number(loadedMi))) {
        miSub += ' (' + rateMoney(loadedMi, 2) + ' ld)';
      }
    }
    var miTile = kmTile('Net $/mi', netMi != null ? esc(rateMoney(netMi, 2)) + '/mi' : 'n/a', mileTone(netMi), esc(miSub), false);

    return '<div class="key-grid km-v51">' +
      '<div class="km-hero">' + netTile + dayTile + '</div>' +
      '<div class="km-second">' + hrTile + miTile + '</div>' +
      '</div>';
  }

  function rateCompare(row, nLoads) {
    if (!row) return '';
    return keyMetricsGrid(row, { nLoads: nLoads, isPast: true });
  }

  function netBlock(net, perHour, netPerMile, unitExtra, row, nLoads) {
    var target = row || { net_est: net, per_hour: perHour, net_per_mile: netPerMile };
    return keyMetricsGrid(target, { nLoads: nLoads });
  }

  function weightFitBadge(wt) {
    if (wt == null || !isFinite(Number(wt))) {
      return '<span class="fit-badge ok">Weight n/a (verify)</span>';
    }
    var w = Number(wt);
    if (w <= 12500) return '<span class="fit-badge good">' + esc(plainNum(w, 0)) + ' lb OK</span>';
    if (w <= 15300) return '<span class="fit-badge ok">' + esc(plainNum(w, 0)) + ' lb MAYBE (scale check)</span>';
    return '<span class="fit-badge low">' + esc(plainNum(w, 0)) + ' lb PASS (&gt;15.3k)</span>';
  }

  function avgHintBadge(row, nLoads) {
    var avg = state.historyAvgs;
    if (!avg || !row) return '';
    var npd = rowNetPerDay(row, nLoads || 1);
    var hr = perHourValue(row, nLoads || 1);
    if (npd == null || avg.avgNetPerDay == null) return '';
    if (npd >= avg.avgNetPerDay && hr != null && avg.avgPerHour != null && hr >= avg.avgPerHour) {
      return '<span class="fit-badge good">Above your avg (' + esc(searchMoney(avg.avgNetPerDay)) + '/d | ' + esc(searchMoney(avg.avgPerHour)) + '/hr)</span>';
    }
    if (npd >= avg.avgNetPerDay) {
      return '<span class="fit-badge good">Net/day above your ' + esc(searchMoney(avg.avgNetPerDay)) + '/d avg</span>';
    }
    if (npd < avg.avgNetPerDay * 0.85) {
      return '<span class="fit-badge neutral">Below your ' + esc(searchMoney(avg.avgNetPerDay)) + '/d avg</span>';
    }
    return '';
  }

  function wxKindFromCode(code, gust) {
    var c = code == null || code === '' ? null : Number(code);
    if (c === 45 || c === 48) return 'fog';
    if (c === 56 || c === 57 || c === 66 || c === 67) return 'ice';
    if (c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86) return 'snow';
    if (c === 95 || c === 96 || c === 97 || c === 99) return 'thunder';
    if (c === 51 || c === 53 || c === 55 || c === 61 || c === 63 || c === 65 || c === 80 || c === 81 || c === 82) return 'rain';
    var windy = gust != null && isFinite(Number(gust)) && Number(gust) >= 40;
    if (c === 3) return windy ? 'wind' : 'cloud';
    if (c === 2) return windy ? 'wind' : 'partly';
    if (c === 0 || c === 1) return windy ? 'wind' : 'sun';
    if (windy) return 'wind';
    return c == null || !isFinite(c) ? '' : 'cloud';
  }

  function wxKindFromPoint(pt) {
    if (!pt) return '';
    var kind = wxKindFromCode(pt.weather_code, pt.gust_mph);
    if (kind) return kind;
    var precip = String(pt.precip || '');
    if (precip === 'ice') return 'ice';
    if (precip === 'snow') return 'snow';
    if (precip === 'rain') return 'rain';
    if (pt.gust_mph != null && Number(pt.gust_mph) >= 40) return 'wind';
    return '';
  }

  function wxKindForDrop(row) {
    if (!row) return '';
    var kind = wxKindFromCode(row.drop_wx_code, row.drop_gust_mph);
    if (kind) return kind;
    var pts = (row.route_wx && row.route_wx.points) || [];
    var want = String(row.drop_low_date || '');
    var i, pt;
    for (i = 0; i < pts.length; i++) {
      pt = pts[i];
      if (want && String(pt.date || '').slice(0, 10) === want.slice(0, 10)) return wxKindFromPoint(pt);
    }
    if (pts.length) return wxKindFromPoint(pts[pts.length - 1]);
    return '';
  }

  var WX_KIND_LABEL = {
    sun: 'Sunny',
    partly: 'Partly cloudy',
    cloud: 'Cloudy',
    rain: 'Rain',
    thunder: 'Thunderstorm',
    snow: 'Snow',
    ice: 'Ice or freezing rain',
    fog: 'Fog',
    wind: 'Windy'
  };

  function wxIconSvg(kind) {
    var k = String(kind || '');
    if (k === 'sun') {
      return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="3.15" fill="#F2C94C"/><g stroke="#F2C94C" stroke-width="1.45" stroke-linecap="round"><path d="M9 1.6v2M9 14.4v2M1.6 9h2M14.4 9h2M3.5 3.5l1.4 1.4M13.1 13.1l1.4 1.4M3.5 14.5l1.4-1.4M13.1 4.9l1.4-1.4"/></g></svg>';
    }
    if (k === 'partly') {
      return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><circle cx="6.6" cy="6.2" r="2.3" fill="#F2C94C"/><g stroke="#F2C94C" stroke-width="1.2" stroke-linecap="round"><path d="M6.6 1.5v1.5M1.5 6.2h1.5M3.1 3.1l1.1 1.1M11 3.8l-1.1 1.1"/></g><path fill="#C4B5FD" d="M7.1 9.2a3.1 3.1 0 0 1 5.8.6 2.5 2.5 0 0 1 1.9 2.4 2.5 2.5 0 0 1-2.5 2.5H7.4A2.6 2.6 0 0 1 6.2 9.6a2.7 2.7 0 0 1 .9-.4z"/></svg>';
    }
    if (k === 'cloud') {
      return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#C4B5FD" d="M5.6 7.4A3.4 3.4 0 0 1 12 8a2.7 2.7 0 0 1 2.1 2.6A2.7 2.7 0 0 1 11.4 13.3H5.7A2.8 2.8 0 0 1 4.4 7.8a3 3 0 0 1 1.2-.4z"/></svg>';
    }
    if (k === 'rain') {
      return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#C4B5FD" d="M5.8 4.8A3.2 3.2 0 0 1 11.8 5.4 2.5 2.5 0 0 1 13.8 7.8 2.5 2.5 0 0 1 11.3 10.3H5.9A2.6 2.6 0 0 1 4.6 5.2a2.8 2.8 0 0 1 1.2-.4z"/><g fill="#60A5FA"><path d="M6.2 11.2l-.8 3.1c-.12.5.5.8.8.4l.9-1.6c.2-.35 0-.8-.4-.9-.2-.06-.4 0-.5.2z"/><path d="M9.1 11.2l-.8 3.1c-.12.5.5.8.8.4l.9-1.6c.2-.35 0-.8-.4-.9-.2-.06-.4 0-.5.2z"/><path d="M12 11.2l-.8 3.1c-.12.5.5.8.8.4l.9-1.6c.2-.35 0-.8-.4-.9-.2-.06-.4 0-.5.2z"/></g></svg>';
    }
    if (k === 'thunder') {
      return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#A78BFA" d="M5.7 4.6A3.2 3.2 0 0 1 11.7 5.2 2.5 2.5 0 0 1 13.7 7.6 2.5 2.5 0 0 1 11.2 10.1H5.8A2.6 2.6 0 0 1 4.5 5a2.8 2.8 0 0 1 1.2-.4z"/><path fill="#F2C94C" d="M10.3 9.2H8.2l1.15 3.05H7.4L11.1 8.1H9.15z"/></svg>';
    }
    if (k === 'snow') {
      return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#C4B5FD" d="M5.8 4.4A3.2 3.2 0 0 1 11.8 5 2.5 2.5 0 0 1 13.8 7.4 2.5 2.5 0 0 1 11.3 9.9H5.9A2.6 2.6 0 0 1 4.6 4.8a2.8 2.8 0 0 1 1.2-.4z"/><g stroke="#BFDBFE" stroke-width="1.15" stroke-linecap="round"><path d="M6.1 11.5v3.1M4.6 13.05h3"/><path d="M9 11.5v3.1M7.5 13.05h3"/><path d="M11.9 11.5v3.1M10.4 13.05h3"/></g></svg>';
    }
    if (k === 'ice') {
      return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#C4B5FD" d="M5.8 4.4A3.2 3.2 0 0 1 11.8 5 2.5 2.5 0 0 1 13.8 7.4 2.5 2.5 0 0 1 11.3 9.9H5.9A2.6 2.6 0 0 1 4.6 4.8a2.8 2.8 0 0 1 1.2-.4z"/><g fill="#93C5FD"><path d="M6.2 10.6l-.7 3.6c0 .4.5.5.7.2l.8-1.8c.15-.35-.1-.7-.45-.75-.15 0-.3.05-.35.15z"/><path d="M9 10.6l-.7 4.2c0 .4.55.55.75.2l.9-2.1c.15-.35-.1-.75-.45-.8-.15 0-.3.05-.35.15z"/><path d="M11.9 10.6l-.7 3.6c0 .4.5.5.7.2l.8-1.8c.15-.35-.1-.7-.45-.75-.15 0-.3.05-.35.15z"/></g></svg>';
    }
    if (k === 'fog') {
      return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><g fill="none" stroke="#C4B5FD" stroke-width="1.5" stroke-linecap="round"><path d="M3.2 6.2h9.2"/><path d="M5 9h9.8"/><path d="M3.6 11.8h8.6"/><path d="M6.2 14.4h7.2"/></g></svg>';
    }
    if (k === 'wind') {
      return '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><g fill="none" stroke="#E9D5FF" stroke-width="1.5" stroke-linecap="round"><path d="M3 6.2h8.2a2 2 0 1 0-2-2"/><path d="M3 9.4h10.2a2 2 0 1 1-2 2"/><path d="M3 12.6h6.5"/></g></svg>';
    }
    return '';
  }

  function wxIconHtml(kind) {
    var svg = wxIconSvg(kind);
    if (!svg) return '';
    var label = WX_KIND_LABEL[kind] || '';
    return '<span class="wx-ico wx-ico-' + esc(kind) + '"' +
      (label ? ' title="' + esc(label) + '" aria-label="' + esc(label) + '"' : '') +
      '>' + svg + '</span>';
  }

  function wxChipHtml(row) {
    if (!row || row.drop_low_f == null || !isFinite(Number(row.drop_low_f))) return '';
    var n = Math.round(Number(row.drop_low_f));
    var label = 'Low ' + n + ' F at drop';
    if (String(row.drop_low_source || '') === 'normal') label += ' (normal low)';
    var cls = n <= 45 ? (weatherOn() ? 'wx-chip cold' : 'wx-chip warn') : 'wx-chip';
    if (n <= 45 && !weatherOn()) label += ' (note only)';
    return '<span class="' + cls + '">' + wxIconHtml(wxKindForDrop(row)) + '<span class="wx-chip-temp">' + esc(label) + '</span></span>';
  }

  function formatWxDate(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    if (isNaN(d.getTime())) return String(iso);
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function wxPointCond(pt) {
    var bits = [];
    if (pt.precip) {
      var label = pt.precip === 'ice' ? 'Ice' : (pt.precip === 'snow' ? 'Snow' : (pt.precip === 'rain' ? 'Rain' : pt.precip));
      if (pt.precip_chance != null && isFinite(Number(pt.precip_chance))) label += ' ' + Math.round(Number(pt.precip_chance)) + '%';
      bits.push(label);
    } else if (pt.precip_chance != null && Number(pt.precip_chance) > 0) {
      bits.push('Precip ' + Math.round(Number(pt.precip_chance)) + '%');
    }
    if (pt.gust_mph != null && isFinite(Number(pt.gust_mph))) bits.push('gusts ' + Math.round(Number(pt.gust_mph)) + ' mph');
    if (pt.source === 'normal') bits.push('normal');
    return bits.join(', ');
  }

  function routeWxHtml(row) {
    var wx = row && row.route_wx;
    if (!wx || !wx.summary) return '';
    var pts = wx.points || [];
    var hazard = (wx.hazards && wx.hazards.length) || pts.some(function (pt) { return pt.hazards && pt.hazards.length; });
    var rows = pts.map(function (pt) {
      var hz = (pt.hazards && pt.hazards.length);
      var temps = [];
      if (pt.high_f != null) temps.push(pt.high_f + ' F');
      if (pt.low_f != null) temps.push(pt.low_f + ' F');
      var tempText = '';
      if (pt.high_f != null && pt.low_f != null) tempText = pt.high_f + ' / ' + pt.low_f + ' F';
      else if (temps.length) tempText = temps.join(' ');
      var cond = wxPointCond(pt);
      var kind = wxKindFromPoint(pt);
      return '<div class="wx-point' + (hz ? ' hazard' : '') + '">' +
        '<div class="wx-point-place">' + esc(pt.place || '') + '</div>' +
        '<div class="wx-point-date">' + esc(formatWxDate(pt.date)) + '</div>' +
        (tempText ? '<div class="wx-point-temps">' + wxIconHtml(kind) + '<span>' + esc(tempText) + '</span></div>' : '') +
        (cond ? '<div class="wx-point-cond">' + esc(cond) + '</div>' : '') +
        '</div>';
    }).join('');
    var headline = '';
    (function () {
      var order = ['ice', 'thunder', 'snow', 'rain', 'wind', 'fog', 'cloud', 'partly', 'sun'];
      var best = '', bestI = 99;
      pts.forEach(function (pt) {
        var k = wxKindFromPoint(pt);
        var i = order.indexOf(k);
        if (i !== -1 && i < bestI) { bestI = i; best = k; }
      });
      headline = best;
    })();
    return '<div class="route-wx' + (hazard ? ' has-hazard' : '') + '">' +
      '<button type="button" class="wx-toggle" aria-expanded="false">' +
        '<span class="wx-summary">' + wxIconHtml(headline) + '<span>' + esc(wx.summary) + '</span></span>' +
        '<span class="wx-toggle-label">Weather</span>' +
      '</button>' +
      '<div class="wx-points" hidden>' + rows + '</div>' +
      '</div>';
  }

  function fitBadgesHtml(row) {
    var badges = [];
    badges.push(weightFitBadge(row.weight_lb));
    var len = row.length_ft != null && isFinite(Number(row.length_ft)) ? Number(row.length_ft) : null;
    var wid = row.width_ft != null && isFinite(Number(row.width_ft)) ? Number(row.width_ft) : null;
    if (len != null && len > 40) {
      badges.push('<span class="fit-badge low">' + esc(plainNum(len, 1)) + ' ft PASS (&gt;40 ft)</span>');
    } else if (wid != null && wid > 8.5) {
      badges.push('<span class="fit-badge low">' + esc(plainNum(wid, 1)) + ' ft wide PASS (&gt;8.5 ft)</span>');
    } else if (len != null || wid != null) {
      var dim = (len != null ? plainNum(len, 1) + ' ft' : '') + (len != null && wid != null ? ' x ' : '') + (wid != null ? plainNum(wid, 1) + ' ft' : '');
      badges.push('<span class="fit-badge neutral">' + esc(dim) + ' OK</span>');
    }
    if (row.tarp) {
      badges.push('<span class="fit-badge good">Tarps OK</span>');
    }
    if (row.posted_rate != null) {
      badges.push('<span class="fit-badge neutral">' + esc(ushipRateLabel(row)) + ' ' + esc(money(row.posted_rate)) + '</span>');
    }
    var days = rowDays(row, 1);
    if (days != null) {
      badges.push('<span class="fit-badge neutral">' + esc(formatDays(days)) + (Number(days) === 1 ? ' day' : ' days') + '</span>');
    }
    var avgBadge = avgHintBadge(row, 1);
    if (avgBadge) badges.push(avgBadge);
    var wx = wxChipHtml(row);
    if (wx) badges.push(wx);
    return '<div class="fit-row">' + badges.join('') + '</div>';
  }

  function whyMoney(n) {
    if (n == null || !isFinite(Number(n))) return '';
    return '$' + Math.round(Number(n)).toLocaleString('en-US');
  }

  function whyLb(n) {
    return Number(n).toLocaleString('en-US');
  }

  function whyFlagText(f) {
    return String(f || '').replace(/\s+/g, ' ').replace(/\.+$/, '').trim();
  }

  function whyPush(list, seen, text) {
    text = String(text || '').trim();
    if (!text || seen[text]) return;
    seen[text] = true;
    list.push(text);
  }

  function whyShortLane(row) {
    if (!row) return '';
    var o = String(row.origin || '').split(',')[0].trim();
    var d = String(row.destination || '').split(',')[0].trim();
    if (o && d) return o + ' to ' + d;
    return o || d || '';
  }

  function whyMaxGust(row) {
    var best = row && row.drop_gust_mph != null ? Number(row.drop_gust_mph) : null;
    var pts = (row && row.route_wx && row.route_wx.points) || [];
    pts.forEach(function (pt) {
      if (pt.gust_mph != null && isFinite(Number(pt.gust_mph))) {
        var g = Number(pt.gust_mph);
        if (best == null || g > best) best = g;
      }
    });
    return best;
  }

  function whyDropLow(row) {
    if (row && row.drop_low_f != null && isFinite(Number(row.drop_low_f))) return Math.round(Number(row.drop_low_f));
    var flags = (row && (row.fit_flags || row.flags || [])).concat(row && row.weather_flags || []);
    if (row && row.reason) flags = flags.concat([row.reason]);
    if (row && row.base_reason) flags = flags.concat([row.base_reason]);
    var i, m;
    for (i = 0; i < flags.length; i++) {
      m = String(flags[i]).match(/too cold at drop.*?(- )?(normal low |low )?(\d+)\s*F/i);
      if (m) return Number(m[3]);
    }
    return null;
  }

  function collectWhy(row, opts) {
    opts = opts || {};
    var wxOn = weatherOn();
    var isCombo = !!(opts.combo || (row && row.kind && (row.loads || row.stop_order)));
    var verd = String((row && row.verdict) || 'PASS').toUpperCase();
    if (verd !== 'TAKE' && verd !== 'MAYBE' && verd !== 'PASS') verd = 'PASS';
    var reasons = [];
    var notes = [];
    var seen = {};
    var flags = ((row && (row.fit_flags || row.flags)) || []).map(whyFlagText);
    var wxFlags = ((row && row.weather_flags) || []).map(whyFlagText);
    var allFlags = flags.concat(wxFlags);
    if (row && row.reason) allFlags.push(whyFlagText(row.reason));
    if (row && row.base_reason) allFlags.push(whyFlagText(row.base_reason));
    function hasFlag(re) {
      return allFlags.some(function (f) { return re.test(f); });
    }
    function addReason(text) { whyPush(reasons, seen, text); }
    function addNote(text) { whyPush(notes, seen, text); }

    var wt = row && row.weight_lb != null && isFinite(Number(row.weight_lb)) ? Number(row.weight_lb) : (row && row.combined_weight_lb != null ? Number(row.combined_weight_lb) : null);
    var len = row && row.length_ft != null && isFinite(Number(row.length_ft)) ? Number(row.length_ft) : (row && row.combined_length_ft != null ? Number(row.combined_length_ft) : null);
    var wid = row && row.width_ft != null && isFinite(Number(row.width_ft)) ? Number(row.width_ft) : null;
    var net = row && row.net_est != null && isFinite(Number(row.net_est)) ? Number(row.net_est) : null;
    var bar = 500;
    if (row && row.same_day) bar = 300;
    if (row && row.bar != null && isFinite(Number(row.bar))) bar = Math.round(Number(row.bar));
    else if (isCombo) bar = 1000;
    var npd = null;
    if (row) {
      npd = row.net_per_day != null && isFinite(Number(row.net_per_day)) ? Number(row.net_per_day) : rowNetPerDay(row, isCombo ? ((row.loads || []).length || 1) : 1);
    }

    if (wt != null && wt > 15300) addReason('Weight ' + whyLb(wt) + ' lb - over 15,300 lb max');
    if (len != null && len > 40) addReason('Length ' + (Math.round(len * 10) / 10) + ' ft - over 40 ft deck');
    if (wid != null && wid > 8.5) addReason('Width ' + (Math.round(wid * 10) / 10) + ' ft - over 8.5 ft max');
    if (hasFlag(/full truckload with no size listed|likely a semi/i)) {
      addReason('Full truckload, no size listed - likely semi');
    }
    if (hasFlag(/informational only/i) || (net == null && hasFlag(/no posted rate/i))) {
      addReason('No posted rate or miles');
    } else if (net == null && !isCombo) {
      addReason('No posted rate or miles');
    }
    if (net != null && net < bar) addReason('Net ' + whyMoney(net) + ' under $' + bar.toLocaleString('en-US') + ' bar');

    var low = whyDropLow(row);
    var coldFlag = hasFlag(/too cold at drop/i) || (low != null && low <= 45);
    var snowFlag = hasFlag(/ice or snow on route/i);
    var iceFlag = hasFlag(/^ice\b/i) && !snowFlag;
    var gustFlag = hasFlag(/gusts 50\+/i);
    var gust = whyMaxGust(row);
    function addWx(line) {
      if (wxOn) addReason(line);
      else addNote(line);
    }
    if (coldFlag && low != null) {
      addWx('Drop low ' + low + ' F - cold rule (weather ' + (wxOn ? 'ON' : 'OFF') + ')');
    } else if (coldFlag) {
      addWx('Drop too cold - cold rule (weather ' + (wxOn ? 'ON' : 'OFF') + ')');
    }
    if (iceFlag) addWx('Ice on route');
    if (snowFlag) addWx('Snow on route');
    if (gustFlag) {
      addWx(gust != null && gust >= 50 ? ('Gusts ' + Math.round(gust) + ' mph on route') : 'Gusts 50+ mph on route');
    }

    if (wt != null && wt > 12500 && wt <= 15300) addReason('Weight ' + whyLb(wt) + ' lb - scale check');
    if (hasFlag(/^weight not listed$/i) && !(wt != null && wt > 15300)) addReason('Weight not listed');
    if (npd != null && npd < 300) addReason('$/day ' + whyMoney(npd) + ' under $300');
    if (hasFlag(/length not listed/i)) addReason('Length not listed on a leg');
    if (hasFlag(/timing not fully confirmed|windows are not listed/i)) addReason('Timing not fully confirmed');

    if (isCombo) {
      var nLegs = (row.loads || []).length || 1;
      var days = row.days_span != null && isFinite(Number(row.days_span)) ? Number(row.days_span) : rowDays(row, nLegs);
      var needed = hosDaysFromMiles(row.loaded_mi, row.deadhead_mi, nLegs);
      if (days != null && needed != null && days > needed) {
        var wait = Math.round(days - needed);
        if (wait >= 1) addReason('Wait ' + wait + ' day' + (wait === 1 ? '' : 's') + ' in the windows (' + formatDays(days) + ' days total)');
      }
      if (!opts.skipLegs) {
        (row.loads || []).forEach(function (leg, i) {
          var part = collectWhy(leg, { skipLegs: true });
          var lines = (part.reasons || []).filter(function (line) {
            return !/^Fits deck/.test(line);
          });
          var lane = whyShortLane(leg);
          lines.forEach(function (line) {
            addReason('Leg ' + legLetter(i) + (lane ? ' (' + lane + ')' : '') + ': ' + line);
          });
          (part.notes || []).forEach(function (line) {
            addNote('Leg ' + legLetter(i) + (lane ? ' (' + lane + ')' : '') + ': ' + line);
          });
        });
      }
    }

    if (verd === 'TAKE') {
      var bits = ['Fits deck'];
      if (wt != null) bits.push(whyLb(wt) + ' lb');
      if (net != null) bits.push('net ' + whyMoney(net));
      if (npd != null) bits.push(whyMoney(npd) + '/day');
      reasons = [bits.join(', ')];
    } else if (!reasons.length) {
      var fallback = verdictReason(row);
      if (fallback) reasons = [fallback.replace(/\.+$/, '')];
    }

    return { verdict: verd, reasons: reasons, notes: notes };
  }

  var WHY_VISIBLE = 3;

  function whyBoxHtml(row, opts) {
    var why = collectWhy(row, opts);
    var verd = String(why.verdict || 'PASS').toLowerCase();
    var title = verd === 'take' ? 'Why TAKE' : (verd === 'maybe' ? 'Why MAYBE' : 'Why PASS');
    var extra = why.reasons.length > WHY_VISIBLE ? why.reasons.length - WHY_VISIBLE : 0;
    function whyLine(line) {
      var m = /^Leg ([A-C])\b(.*)$/.exec(line);
      if (!m) return { cls: '', style: '', html: esc(line) };
      var col = legColor(m[1].charCodeAt(0) - 65);
      return { cls: ' why-leg', style: ' style="--lc:' + col + '"', html: '<span class="why-legchip">Leg ' + m[1] + '</span>' + esc(m[2]) };
    }
    var items = why.reasons.map(function (line, i) {
      var wl = whyLine(line);
      return '<li class="' + (i >= WHY_VISIBLE ? 'why-extra' : '') + wl.cls + '"' + wl.style + (i >= WHY_VISIBLE ? ' hidden' : '') + '>' + wl.html + '</li>';
    }).join('');
    var more = extra > 0
      ? '<button type="button" class="why-more-btn" aria-expanded="false">' + extra + ' more</button>'
      : '';
    var notes = '';
    if (why.notes && why.notes.length) {
      notes = '<div class="why-notes">' +
        '<div class="why-notes-title">Notes</div>' +
        '<ul class="why-list">' + why.notes.map(function (line) {
          var wl = whyLine(line);
          return '<li class="' + wl.cls.trim() + '"' + wl.style + '>' + wl.html + '</li>';
        }).join('') + '</ul></div>';
    }
    if (!items && !notes) return '';
    return '<div class="why-box ' + esc(verd) + '">' +
      '<div class="why-title">' + title + '</div>' +
      (items ? '<ul class="why-list">' + items + '</ul>' : '') +
      more +
      notes +
      '</div>';
  }

  function isUshipBid(row) {
    return !!row && row.board === 'uShip' && String(row.price_type || 'BID').toUpperCase() !== 'BOOK_NOW';
  }

  function ushipRateLabel(row) {
    if (!isUshipBid(row)) return (row && row.board === 'uShip') ? 'Book now' : 'Posted';
    if (row.price_basis === 'shipper_target') return 'Shipper target';
    if (row.price_basis === 'low_bid') return 'Low bid';
    return 'Est fair price';
  }

  function ushipPriceChip(row) {
    if (!row || row.board !== 'uShip') return '';
    var amt = row.posted_rate != null && isFinite(Number(row.posted_rate)) ? searchMoney(Number(row.posted_rate)) : '';
    if (!isUshipBid(row)) return '<span class="uship-price book">BOOK NOW ' + esc(amt) + '</span>';
    var basis = row.price_basis === 'shipper_target' ? 'target' : (row.price_basis === 'low_bid' ? 'low bid' : 'est');
    var n = row.bid_count != null ? ' | ' + plainNum(row.bid_count, 0) + ' bid' + (Number(row.bid_count) === 1 ? '' : 's') : '';
    return '<span class="uship-price bid">BID ' + esc(basis) + ' ' + esc(amt) + esc(n) + '</span>';
  }

  function verdictReason(row) {
    if (!row) return '';
    if (row.reason) return String(row.reason);
    var verd = String(row.verdict || '').toUpperCase();
    var flags = row.fit_flags || row.flags || [];
    var hard = flags.filter(function (f) { return String(f).indexOf('cannot haul') !== -1; });
    if (verd === 'TAKE') return 'Clears the net bar and fits the deck.';
    if (verd === 'MAYBE') {
      if (flags.some(function (f) { return String(f).indexOf('uShip: bid only') === 0; })) {
        return 'Clears the net bar at an estimated fair price, but it is a uShip bid with no price shown.';
      }
      if (flags.some(function (f) { return String(f).indexOf('uShip: bid listing') === 0; })) {
        return 'Clears the net bar, but it is a uShip bid, not a booked rate.';
      }
      if (flags.some(function (f) { return String(f).indexOf('ice or snow on route') !== -1; })) {
        return 'Clears the net bar, but ice or snow is on the route.';
      }
      if (flags.some(function (f) { return String(f).indexOf('gusts 50+') !== -1; })) {
        return 'Clears the net bar, but gusts of 50+ mph are on the route.';
      }
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
    if (flags.some(function (f) { return String(f).indexOf('too cold at drop') !== -1; })) {
      var cold = String(flags.filter(function (f) { return String(f).indexOf('too cold at drop') !== -1; })[0]);
      return /[.]$/.test(cold) ? cold : cold + '.';
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
    if (row.posted_rate != null) cells.push(statCell(ushipRateLabel(row), esc(money(row.posted_rate))));
    return strip + (cells.length ? '<div class="stat-row">' + cells.join('') + '</div>' : '');
  }

  function searchOriginLabel() {
    if (state.truckAt && state.truckAt.label) return String(state.truckAt.label);
    var o = state.searches && state.searches.origin;
    o = o ? String(o).replace(/\s*\(.*\)\s*$/, '') : '';
    return o || 'truck';
  }

  function rateLegend() {
    return '<p class="rate-legend" aria-label="Color key for net, per hour, per day, and per mile">' +
      '<span class="rate-legend-label">Key metrics color guide</span>' +
      '<span class="rate-pill good">Green: $35+/hr | $300+/day | $0.80+/mi</span>' +
      '<span class="rate-pill ok">Amber: $20-34/hr | $200-299/day | $0.40-0.79/mi</span>' +
      '<span class="rate-pill low">Red: under $20/hr, $200/day, $0.40/mi, or bar</span></p>';
  }

  function loadJsonPrefs(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) { return fallback; }
  }

  function saveJsonPrefs(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (err) { /* ignore */ }
  }

  function savedLoadsMap() {
    if (!state.savedLoads) state.savedLoads = loadJsonPrefs(SAVED_LOADS_KEY, {});
    return state.savedLoads;
  }

  function isSavedLoad(row) {
    var k = loadKey(row);
    return !!(k && savedLoadsMap()[k]);
  }

  function toggleSavedLoad(row) {
    var k = loadKey(row);
    if (!k) return;
    var map = savedLoadsMap();
    if (map[k]) delete map[k];
    else map[k] = true;
    saveJsonPrefs(SAVED_LOADS_KEY, map);
  }

  function savedCountInData(data) {
    var map = savedLoadsMap();
    var loads = (data && data.loads) || [];
    var n = 0;
    loads.forEach(function (r) { if (map[loadKey(r)]) n += 1; });
    return n;
  }

  function compareKeyList() {
    if (!state.compareKeys) {
      try {
        var raw = sessionStorage.getItem(COMPARE_KEY);
        state.compareKeys = raw ? JSON.parse(raw) : [];
      } catch (err) { state.compareKeys = []; }
    }
    return state.compareKeys;
  }

  function saveCompareKeys() {
    try { sessionStorage.setItem(COMPARE_KEY, JSON.stringify(state.compareKeys || [])); } catch (err) { /* ignore */ }
  }

  function isComparedLoad(row) {
    var k = loadKey(row);
    return !!(k && compareKeyList().indexOf(k) !== -1);
  }

  function toggleCompareLoad(row) {
    var k = loadKey(row);
    if (!k) return;
    var list = compareKeyList();
    var idx = list.indexOf(k);
    if (idx !== -1) {
      list.splice(idx, 1);
    } else {
      if (list.length >= 3) list.shift();
      list.push(k);
    }
    saveCompareKeys();
  }

  function seenStore() {
    if (!state.seenLoads) state.seenLoads = loadJsonPrefs(SEEN_LOADS_KEY, null);
    return state.seenLoads;
  }

  function syncSeenLoads(data) {
    if (!data || !data.loads) return;
    var scan = String(data.scanned_at || data.as_of || '');
    var keys = {};
    data.loads.forEach(function (r) {
      var k = loadKey(r);
      if (k) keys[k] = true;
    });
    var store = seenStore();
    if (!store || !store.curr) {
      store = { scan: scan, prev: keys, curr: keys };
      state.seenLoads = store;
      saveJsonPrefs(SEEN_LOADS_KEY, store);
    } else if (scan && store.scan !== scan) {
      store = { scan: scan, prev: store.curr || {}, curr: keys };
      state.seenLoads = store;
      saveJsonPrefs(SEEN_LOADS_KEY, store);
    }
  }

  function isNewLoad(row) {
    if (row && row.is_new) return true;
    var k = loadKey(row);
    var store = seenStore();
    if (!k || !store || !store.prev) return false;
    return !store.prev[k];
  }

  function markAllLoadsSeen(data) {
    var scan = String((data && (data.scanned_at || data.as_of)) || '');
    var keys = {};
    ((data && data.loads) || []).forEach(function (r) {
      var k = loadKey(r);
      if (k) keys[k] = true;
    });
    state.seenLoads = { scan: scan, prev: keys, curr: keys };
    saveJsonPrefs(SEEN_LOADS_KEY, state.seenLoads);
  }

  function parseScanStamp(stamp) {
    if (!stamp) return null;
    var m = String(stamp).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?:\s*(CT|CDT|CST|UTC|Z))?/i);
    if (!m) return null;
    var yr = Number(m[1]), mo = Number(m[2]) - 1, dy = Number(m[3]), hr = Number(m[4]), mn = Number(m[5]);
    var tz = (m[6] || 'CT').toUpperCase();
    if (tz === 'UTC' || tz === 'Z') return new Date(Date.UTC(yr, mo, dy, hr, mn));
    // America/Chicago UTC-6 (CST) / UTC-5 (CDT)
    var off = tz === 'CDT' ? 5 : 6;
    return new Date(Date.UTC(yr, mo, dy, hr + off, mn));
  }

  function formatRelAge(ms) {
    if (ms == null || !isFinite(ms) || ms < 0) return '';
    var mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    var remM = mins % 60;
    if (hrs < 24) return hrs + 'h ' + (remM ? remM + 'm ' : '') + 'ago';
    var days = Math.floor(hrs / 24);
    return days + 'd ' + (hrs % 24) + 'h ago';
  }

  function rowPickupDateMs(row) {
    var pu = parseWindow(row && row.pickup_window, scanYear());
    if (pu && pu[0]) return pu[0].getTime();
    return Number.MAX_SAFE_INTEGER;
  }

  function rowFitsDeck(row) {
    if (!row) return false;
    if (row.weight_lb != null && Number(row.weight_lb) > 15300) return false;
    if (row.length_ft != null && Number(row.length_ft) > 40) return false;
    if (row.width_ft != null && Number(row.width_ft) > 8.5) return false;
    var flags = row.fit_flags || row.flags || [];
    if (flags.some(function (f) { return /cannot haul|infeasible/i.test(String(f)); })) return false;
    return true;
  }

  function saveSearchPrefs() {
    saveJsonPrefs(SEARCH_PREFS_KEY, {
      sort: state.searchSort || 'default',
      hidePass: !!state.hidePass,
      fitsOnly: !!state.fitsOnly
    });
  }

  function loadSearchPrefs() {
    var p = loadJsonPrefs(SEARCH_PREFS_KEY, null);
    if (!p) return;
    if (p.sort) state.searchSort = p.sort;
    state.hidePass = !!p.hidePass;
    state.fitsOnly = !!p.fitsOnly;
  }

  // Weather switch (v42). ON (default): cold drops are PASS, ice/snow or 50+ mph
  // gusts turn TAKE into MAYBE. OFF: verdicts ignore weather; weather shows as notes.
  var WX_FLAG_RE = /too cold at drop|ice or snow on route|gusts 50\+/i;

  function isWxFlag(f) { return WX_FLAG_RE.test(String(f)); }

  function weatherOn() { return state.weatherOn !== false; }

  function loadWeatherSwitch() {
    try {
      var raw = localStorage.getItem(WEATHER_SWITCH_KEY);
      state.weatherOn = raw === null ? true : raw !== 'off';
    } catch (err) { state.weatherOn = true; }
  }

  function saveWeatherSwitch() {
    try { localStorage.setItem(WEATHER_SWITCH_KEY, state.weatherOn === false ? 'off' : 'on'); } catch (err) { /* ignore */ }
  }

  function pushUnique(list, text) {
    if (list.indexOf(text) === -1) list.push(text);
  }

  function wxNoteChipsHtml(row) {
    if (weatherOn() || !row) return '';
    var notes = (row.weather_flags || []).filter(function (f) { return !/too cold at drop/i.test(String(f)); });
    if (!notes.length) return '';
    return '<div class="wx-notes">' + notes.map(function (f) {
      var label = /ice or snow/i.test(String(f)) ? 'Ice or snow on route' : (/gusts 50/i.test(String(f)) ? 'Gusts 50+ mph on route' : String(f));
      return '<span class="wx-chip warn">' + esc(label + ' (note only)') + '</span>';
    }).join('') + '</div>';
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
    if (state.hidePass) {
      rows = rows.filter(function (row) { return String(row.verdict).toUpperCase() !== 'PASS'; });
    }
    if (state.fitsOnly) {
      rows = rows.filter(rowFitsDeck);
    }
    var f = state.searchFilter || 'all';
    if (f === 'combos') {
      rows = [];
    } else if (f === 'take' || f === 'maybe' || f === 'pass') {
      rows = rows.filter(function (row) { return String(row.verdict).toLowerCase() === f; });
    } else if (f === 'truckstop') {
      rows = rows.filter(function (row) { return row.board === 'Truckstop'; });
    } else if (f === 'df') {
      rows = rows.filter(function (row) { return row.board === 'Direct Freight'; });
    } else if (f === 'uship') {
      rows = rows.filter(function (row) { return row.board === 'uShip'; });
    } else if (f === 'saved') {
      var saved = savedLoadsMap();
      rows = rows.filter(function (row) { return !!saved[loadKey(row)]; });
    }
    return sortSearches(rows);
  }

  function sortSearches(rows) {
    var mode = state.searchSort || 'default';
    var order = { TAKE: 0, MAYBE: 1, PASS: 2 };
    return (rows || []).slice().sort(function (a, b) {
      if (mode === 'net_day') {
        var da = rowNetPerDay(a, 1), db = rowNetPerDay(b, 1);
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return db - da;
      }
      if (mode === 'net') {
        var na = a.net_est, nb = b.net_est;
        if (na == null && nb == null) return 0;
        if (na == null) return 1;
        if (nb == null) return -1;
        return nb - na;
      }
      if (mode === 'net_mi') {
        var ma = netPerMileValue(a), mb = netPerMileValue(b);
        if (ma == null && mb == null) return 0;
        if (ma == null) return 1;
        if (mb == null) return -1;
        return mb - ma;
      }
      if (mode === 'per_hr') {
        var ha = perHourValue(a), hb = perHourValue(b);
        if (ha == null && hb == null) return 0;
        if (ha == null) return 1;
        if (hb == null) return -1;
        return hb - ha;
      }
      if (mode === 'deadhead') {
        var dha = rowEmptyMiles(a), dhb = rowEmptyMiles(b);
        return (dha != null ? dha : 99999) - (dhb != null ? dhb : 99999);
      }
      if (mode === 'pickup') {
        return rowPickupDateMs(a) - rowPickupDateMs(b);
      }
      var ra = order[String(a.verdict || '').toUpperCase()];
      var rb = order[String(b.verdict || '').toUpperCase()];
      if (ra == null) ra = 9;
      if (rb == null) rb = 9;
      if (ra !== rb) return ra - rb;
      var na2 = a.net_est;
      var nb2 = b.net_est;
      var da2 = a.net_per_day, db2 = b.net_per_day;
      if (da2 == null && db2 != null) return 1;
      if (db2 == null && da2 != null) return -1;
      if (da2 != null && db2 != null && db2 !== da2) return db2 - da2;
      if (na2 == null && nb2 == null) return 0;
      if (na2 == null) return 1;
      if (nb2 == null) return -1;
      return nb2 - na2;
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
        ' | ' + searchMoney(row.net_est) + ' net EST | ' + perHourLabel(row) +
        ' | Gross ' + (grossPerMileValue(row) != null ? rateMoney(grossPerMileValue(row), 2) : 'n/a') +
        '/mi | Net ' + netPerMileLabel(row);
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
    if (row && row.board === 'uShip') return 'https://www.uship.com/find';
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

  function comboLegColors(combo, route) {
    // v58: colors for each drive leg and pin, matching the combo card's A/B/C chips.
    try {
      var stops = comboStopModel(combo);
      var legs = (route && route.legs) || [];
      if (!stops.length || legs.length !== stops.length) return null;
      return {
        leg: stops.map(function (st) { return st.deckBefore.map(legColor); }),
        pin: stops.map(function (st) { return st.leg >= 0 ? legColor(st.leg) : ''; })
      };
    } catch (err) { return null; }
  }

  function routeBlock(route, mapsHref, label, combo) {
    state.routeMapSeq = (state.routeMapSeq || 0) + 1;
    var id = 'rmap-' + state.routeMapSeq;
    state.routePayloads = state.routePayloads || {};
    var canDraw = hasRouteToDraw(route);
    var cc = (canDraw && combo) ? comboLegColors(combo, route) : null;
    if (canDraw) state.routePayloads[id] = cc ? { legs: route.legs, points: route.points, cc: cc } : route;
    var maps = mapsHref
      ? '<a class="open-maps" href="' + esc(mapsHref) + '" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>'
      : '';
    if (!canDraw && !maps) {
      return '<p class="route-missing">Map unavailable for this load.</p>';
    }
    var safeLabel = (window.BRMap ? String(label || 'Route map').split(' to ').map(BRMap.cityLabel).join(' to ') : 'Route map');
    var map = canDraw
      ? '<div class="route-map" id="' + id + '" data-route-id="' + id + '" role="img" aria-label="' + esc(safeLabel) + '"></div>'
      : '<p class="route-missing">Map unavailable for this load.</p>';
    var legend = '';
    if (canDraw) {
      legend = window.BRMap
        ? BRMap.legendHtml({ legs: combo ? (combo.loads || []).map(function (r, i) { return legColor(i); }) : null })
        : '<p class="route-legend"><span class="swatch deadhead"></span> Empty miles <span class="swatch loaded"></span> Loaded</p>';
    }
    return '<div class="route-wrap">' + map + maps + legend + '</div>';
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
    var B = window.BRMap;
    var map = L.map(el, {
      scrollWheelZoom: false,
      dragging: true,
      tap: true,
      attributionControl: false,
      zoomControl: false,
      maxZoom: B ? 11 : 18
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.attribution({ prefix: false, position: 'bottomright' }).addTo(map);
    bindMapGestures(map, el);
    if (B) {
      B.tiles(map, 11);
      B.addStates(map);
    } else {
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16,
        attribution: 'Tiles (c) <a href="https://www.esri.com/">Esri</a>'
      }).addTo(map);
    }
    var bounds = [];
    var cc = payload.cc;
    (payload.legs || []).forEach(function (leg, li) {
      if (!leg || !leg.path || leg.path.length < 2) return;
      var isDead = leg.kind === 'deadhead';
      var cols = (!isDead && cc && cc.leg[li] && cc.leg[li].length) ? cc.leg[li] : null;
      var line;
      if (B) {
        line = B.cased(map, leg.path, isDead
          ? { color: B.COL.dead, weight: 5, dash: '9 9' }
          : { color: B.COL.loaded, colors: cols, weight: 6 });
        leg.path.forEach(function (ll) { bounds.push(ll); });
      } else {
        line = L.polyline(leg.path, {
          color: isDead ? '#E8E0C8' : '#C4B5FD', weight: isDead ? 3 : 4, opacity: 0.95, dashArray: isDead ? '7 7' : null
        }).addTo(map);
        line.getLatLngs().forEach(function (ll) { bounds.push(ll); });
      }
    });
    var havePoint = [];
    (payload.points || []).forEach(function (pt, pi) {
      if (!pt || pt.lat == null || pt.lon == null) return;
      // City level only: round to 0.01 degree (about 0.7 mi) and strip street parts of the label.
      var lat = Math.round(pt.lat * 100) / 100;
      var lon = Math.round(pt.lon * 100) / 100;
      bounds.push([lat, lon]);
      var place = B ? B.cityLabel(pt.label || '') : (pt.label || '');
      var isHome = (pt.label || '') === 'Home base (Jacksonville)' || (pt.kind === 'truck' && /jacksonville|home/i.test(pt.label || ''));
      var kind = isHome ? 'home' : (pt.kind === 'pickup' ? 'pickup' : (pt.kind === 'drop' ? 'drop' : 'start'));
      var label = isHome ? 'H' : (kind === 'start' ? 'S' : (pt.n != null ? String(pt.n) : ''));
      var title = isHome ? 'Home base (Jacksonville, FL)' : ((pt.kind === 'pickup' ? 'Pickup | ' : (pt.kind === 'drop' ? 'Drop | ' : 'Start (empty from) | ')) + place);
      var icon;
      if (B) {
        icon = B.pin(kind, label);
      } else {
        icon = L.divIcon({ className: 'route-pin-wrap', html: '<div class="route-pin ' + esc(pt.kind || '') + '">' + esc(label) + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] });
      }
      if (isHome) havePoint.push([lat, lon]);
      var mk = L.marker([lat, lon], { icon: icon, keyboard: false, title: title, zIndexOffset: isHome ? 300 : (kind === 'start' ? 0 : 100) })
        .addTo(map)
        .bindTooltip(title, { direction: 'top', opacity: 0.95 });
      var pc = cc && cc.pin[pi - 1];
      if (pc && mk._icon) mk._icon.firstChild.style.setProperty('--lc', pc);
    });
    if (B && !havePoint.length && bounds.length) {
      // Mark Jacksonville when the route passes near it (or starts there), without stretching the view.
      var near = bounds.some(function (ll) { return Math.abs(ll[0] - B.HOME.lat) < 0.6 && Math.abs(ll[1] - B.HOME.lon) < 0.6; });
      if (near) B.homeMarker(map, false);
    }
    if (bounds.length) {
      map.fitBounds(bounds, { padding: [26, 26], maxZoom: 10 });
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

  function searchActions(row, detailsToggle) {
    var href = openLoadHref(row);
    var html = '<div class="search-actions">' +
      '<a class="search-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Open load</a>' +
      '<button type="button" class="call-sheet-btn">Call sheet</button>';
    var mail = brokerMailto(row);
    var tel = brokerTel(row);
    var hiddenDf = row && row.board === 'Direct Freight' && !row.broker && !row.broker_mc;
    var onUship = row && row.board === 'uShip';
    if (tel) {
      html += '<a class="call-broker" href="' + esc(tel) + '">Call broker</a>';
    }
    if (mail) {
      html += '<a class="email-broker" href="' + esc(mail) + '">Email broker</a>';
    }
    if (!tel && !mail) {
      if (hiddenDf) {
        html += '<a class="search-link" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">Broker on DF</a>';
      } else if (onUship) {
        html += '<span class="no-email">Quote on uShip</span>';
      } else {
        html += '<span class="no-email">No contact</span>';
      }
    }
    if (row && row.looked_up) {
      html += '<span class="looked-up">Looked up</span>';
    }
    if (detailsToggle) {
      html += '<button type="button" class="details-toggle-btn" aria-expanded="false">Details &amp; map</button>';
    }
    return html + '</div>';
  }

  function comboPackages(data) {
    var list = (data && data.combos) ? data.combos : [];
    var comboN = 0;
    var chainN = 0;
    return list.map(function (combo) {
      var chain = !!(combo.kind && combo.kind !== 'shared');
      if (chain) {
        chainN += 1;
        return { combo: combo, chain: true, n: chainN, label: 'Chain ' + chainN };
      }
      comboN += 1;
      return { combo: combo, chain: false, n: comboN, label: 'Combo ' + comboN };
    });
  }

  function loadKey(row) {
    if (!row) return '';
    var ln = String(row.load_number || '').trim();
    return [row.board || '', row.origin || '', row.destination || '', ln || String(row.posted_rate || ''), String(row.weight_lb || '')].join('|').toLowerCase();
  }

  function alsoInLabels(row, data) {
    var key = loadKey(row);
    if (!key) return [];
    var names = [];
    comboPackages(data).forEach(function (pkg) {
      var loads = pkg.combo.loads || [];
      for (var i = 0; i < loads.length; i++) {
        if (loadKey(loads[i]) === key) {
          names.push(pkg.label);
          break;
        }
      }
    });
    return names;
  }

  function displayVerdict(v) {
    var key = String(v || '').toUpperCase();
    if (key === 'TAKE') return 'Take';
    if (key === 'MAYBE') return 'Maybe';
    if (key === 'PASS') return 'Pass';
    if (key === 'READY') return 'Ready';
    return v || '';
  }

  function typeBadgeHtml(kind, text) {
    return '<span class="type-badge ' + kind + '">' + esc(text) + '</span>';
  }

  function packageTypeBadge(combo) {
    var n = (combo.loads || []).length;
    if (combo.kind && combo.kind !== 'shared') {
      return typeBadgeHtml('chain', 'Chain (leg 1 of ' + n + ')');
    }
    return typeBadgeHtml('combo', 'Combo (' + n + ' load' + (n === 1 ? '' : 's') + ')');
  }

  function renderLegBox(row, i, total) {
    var route = (row.origin || 'Origin') + ' to ' + (row.destination || 'Destination');
    var miles = rowLoadedMiles(row);
    var milesTxt = miles ? plainNum(miles, 0) + ' mi' : 'miles n/a';
    var wt = row.weight_lb != null ? plainNum(row.weight_lb, 0) + ' lb' : 'weight n/a';
    var rate = row.posted_rate != null ? money(row.posted_rate) : 'rate n/a';
    return '<div class="combo-leg-box">' +
      '<div class="combo-leg-kicker">Leg ' + (i + 1) + ' of ' + total + '</div>' +
      '<div class="combo-leg-route">' + esc(route) + '</div>' +
      '<div class="combo-leg-stats">' +
        '<span>' + esc(milesTxt) + '</span>' +
        '<span>' + esc(wt) + '</span>' +
        '<span>' + esc(rate) + '</span>' +
      '</div>' +
      '</div>';
  }

  function scrollToSearchGroup(name) {
    var id = 'search-list';
    if (name === 'take') id = 'search-group-take';
    else if (name === 'maybe') id = 'search-group-maybe';
    else if (name === 'pass') id = 'search-group-pass';
    var el = document.getElementById(id) || document.getElementById('search-list') ||
      document.querySelector('.combo-card, .search-card');
    if (!el) return;
    var offset = stickyTopOffset();
    var top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function renderSearchCard(row, data) {
    var verd = String(row.verdict || 'PASS').toLowerCase();
    var origin = row.origin || 'Origin';
    var dest = row.destination || 'Destination';
    var key = loadKey(row);
    var saved = isSavedLoad(row);
    var cmp = isComparedLoad(row);
    var isNew = isNewLoad(row);
    var pu = pickupDateLabel(row);
    var postedAge = row.posted_age || row.age || '';
    var bits = [];
    bits.push(row.board || '');
    if (row.equipment) bits.push(row.equipment);
    if (row.pickup_window) bits.push('Pickup ' + row.pickup_window);
    if (row.drop_window) bits.push('Drop ' + row.drop_window);
    var broker = row.broker || (row.board === 'Direct Freight' ? 'Broker not listed on the free list' :
      (row.board === 'uShip' ? 'Shipper on uShip (quote or book on uShip)' : ''));
    if (broker) bits.push(broker);
    if (row.broker_mc) bits.push('MC ' + row.broker_mc);
    if (row.broker_dot) bits.push('DOT ' + row.broker_dot);
    if (row.load_number) bits.push((row.board === 'uShip' ? 'Listing # ' : 'Load # ') + row.load_number);
    if (row.board === 'uShip') {
      var dims = [row.length_ft, row.width_ft, row.height_ft].map(function (v) { return v != null ? plainNum(v, 1) : '?'; });
      if (row.length_ft != null || row.width_ft != null || row.height_ft != null) bits.push('L x W x H ' + dims.join(' x ') + ' ft');
      if (row.item_count != null && Number(row.item_count) > 1) bits.push(plainNum(row.item_count, 0) + ' items');
      if (row.expires) bits.push('Ends ' + row.expires);
      if (row.deadhead_est) bits.push('Empty miles estimated (straight line x 1.2)');
    }
    if (row.notes) bits.push(row.notes);
    var alsoHtml = '';
    var comboChip = inComboChipHtml(row, data);

    var badges = (row.board ? '<span class="board-chip' + (row.board === 'uShip' ? ' uship-chip' : '') + '">' + esc(row.board) + '</span>' : '') +
      ushipPriceChip(row) +
      (pu && pu !== 'date not listed' ? '<span class="pu-chip">PU ' + esc(pu) + '</span>' : '') +
      (postedAge ? '<span class="board-chip">Posted ' + esc(postedAge) + '</span>' : '') +
      (isNew ? '<span class="new-badge">New</span>' : '');
    var collapse = verd === 'pass';

    var tools = '<button type="button" class="star-btn" data-save-key="' + esc(key) + '" aria-pressed="' + (saved ? 'true' : 'false') + '" aria-label="' + (saved ? 'Remove from shortlist' : 'Save to shortlist') + '">' + (saved ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z" fill="currentColor" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>' : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>') + '</button>' +
      '<button type="button" class="cmp-btn" data-cmp-key="' + esc(key) + '" aria-pressed="' + (cmp ? 'true' : 'false') + '">' + (cmp ? 'Comparing' : '+ Compare') + '</button>';

    var detailsHtml = '<div class="search-details" hidden>' +
      fuelLine(currentFuel(row)) +
      (row.math ? '<p class="search-math">' + esc(row.math) + '</p>' : '') +
      '<p class="search-meta">' + esc(bits.filter(Boolean).join(' | ')) + '</p>' +
      routeBlock(routePayload(row), loadMapsUrl(row), (origin + ' to ' + dest + ' route map')) +
      '</div>';

    return '<article class="search-card ' + esc(verd) + (isNew ? ' is-new' : '') + (collapse ? ' collapsible is-collapsed' : '') + '" data-load-key="' + esc(key) + '">' +
      (collapse ? collapsedSummaryHtml(origin + ' to ' + dest, row.net_est, rowNetPerDay(row, 1), row, row.verdict) : '') +
      '<div class="card-top-bar">' +
        '<div class="card-badges">' + badges + '</div>' +
        '<div class="card-tools">' + tools + '</div>' +
      '</div>' +
      (comboChip ? '<div class="in-combo-row">' + comboChip + '</div>' : '') +
      '<div class="verdict-row">' +
        '<div class="lane">' + esc(origin) + ' to ' + esc(dest) + '</div>' +
        '<span class="verdict-pill ' + esc(verd) + '">' + esc(displayVerdict(row.verdict || 'PASS')) + '</span>' +
      '</div>' +
      netBlock(row.net_est, perHourValue(row), netPerMileValue(row), '', row) +
      milesStrip(rowLoadedMiles(row) || null, row.origin_dh_mi != null ? row.origin_dh_mi : null,
        { emptyFrom: searchOriginLabel() }) +
      fitBadgesHtml(row) +
      alsoHtml +
      whyBoxHtml(row) +
      routeWxHtml(row) +
      searchActions(row, true) +
      detailsHtml +
      '</article>';
  }

  // ---- v49 combo cards: one connected trip (timeline, leg colors, header line) ----
  var LEG_COLORS = ['#38BDF8', '#F472B6', '#2DD4BF'];
  function legLetter(i) { return String.fromCharCode(65 + (i % 26)); }
  function legColor(i) { return LEG_COLORS[i % LEG_COLORS.length]; }

  function fmtDriveTime(h) {
    if (h == null || !isFinite(h) || h <= 0) return '';
    var m = Math.round(h * 60);
    var hh = Math.floor(m / 60);
    var mm = m % 60;
    if (hh === 0) return mm + 'm';
    return hh + 'h ' + (mm < 10 ? '0' : '') + mm + 'm';
  }

  function fmtWhen(d) {
    if (!d || isNaN(d.getTime())) return '';
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var h = d.getHours();
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    var mi = d.getMinutes();
    return days[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + h12 + ':' + (mi < 10 ? '0' : '') + mi + ' ' + ap;
  }

  function fmtWaitHrs(h) {
    if (h < 24) return Math.round(h) + ' h';
    var d = Math.round(h / 24);
    return d + ' day' + (d === 1 ? '' : 's');
  }

  function comboStopModel(combo) {
    var loads = combo.loads || [];
    var order = combo.stop_order || [];
    var usedP = {};
    var usedD = {};
    var pN = 0;
    var dN = 0;
    var stops = order.map(function (st, idx) {
      var isDrop = String(st.action) === 'drop';
      var leg = -1;
      for (var i = 0; i < loads.length; i++) {
        var lane = (loads[i].origin || '') + ' -> ' + (loads[i].destination || '');
        var used = isDrop ? usedD : usedP;
        if (!used[i] && lane === (st.lane || '')) { leg = i; used[i] = true; break; }
      }
      if (leg < 0) {
        for (var j = 0; j < loads.length; j++) {
          var u2 = isDrop ? usedD : usedP;
          if (!u2[j] && (isDrop ? loads[j].destination === st.place : loads[j].origin === st.place)) { leg = j; u2[j] = true; break; }
        }
      }
      if (isDrop) dN += 1; else pN += 1;
      return {
        n: idx + 1,
        drop: isDrop,
        place: st.place || '',
        window: st.window || '',
        leg: leg,
        tag: (isDrop ? 'D' : 'P') + (isDrop ? dN : pN),
        mi: (st.miles_from_prev != null && isFinite(Number(st.miles_from_prev))) ? Number(st.miles_from_prev) : null,
        approx: false
      };
    });
    // The first drive follows the truck location, so prefer the live deadhead on that load.
    if (stops.length && stops[0].leg >= 0 && loads[stops[0].leg] && loads[stops[0].leg].origin_dh_mi != null &&
        isFinite(Number(loads[stops[0].leg].origin_dh_mi))) {
      stops[0].mi = Number(loads[stops[0].leg].origin_dh_mi);
      stops[0].approx = false;
    }
    // Fill missing miles (older feeds): spread what is left over the unknown segments.
    var known = 0;
    var unknown = 0;
    stops.forEach(function (s) { if (s.mi == null) unknown += 1; else known += s.mi; });
    if (unknown) {
      var tot = combo.total_mi != null ? Number(combo.total_mi) : (Number(combo.loaded_mi || 0) + Number(combo.deadhead_mi || 0));
      var each = Math.max(0, (tot - known) / unknown);
      stops.forEach(function (s, i) {
        if (s.mi == null) { s.mi = i === 0 && loads[0] && loads[0].origin_dh_mi != null ? Number(loads[0].origin_dh_mi) : each; s.approx = true; }
      });
    }
    // Deck tracking: a segment is loaded when something is on the deck at its start.
    var deck = [];
    stops.forEach(function (s) {
      s.deckBefore = deck.slice();
      s.loaded = deck.length > 0;
      s.hrs = (s.mi || 0) / PER_HOUR_MPH;
      if (s.leg >= 0) {
        if (s.drop) deck = deck.filter(function (x) { return x !== s.leg; });
        else if (deck.indexOf(s.leg) < 0) deck.push(s.leg);
      }
    });
    return stops;
  }

  // Waits inside the trip: walk the stops at 50 mph (10 h rest per 11 h driven, 1 h per stop).
  // The start is slid later (never past a pickup window's close) so we are not early at a drop;
  // idle time before the first pickup is not trip time and is not drawn. Waits of 6 h or more
  // after that first pickup show as a dashed segment.
  function comboWaits(stops, year) {
    var wins = stops.map(function (s) { return s.window ? parseWindow(s.window, year) : null; });
    var now = Date.now();
    var HR = 3600000;
    function run(t0) {
      var t = t0;
      var out = [];
      stops.forEach(function (s, i) {
        var hrs = s.hrs || 0;
        var rest = hrs > 11 ? Math.floor((hrs - 0.001) / 11) * 10 : 0;
        var arrive = t + (hrs + rest) * HR;
        var ws = wins[i] && wins[i][0] ? wins[i][0].getTime() : null;
        var we = wins[i] && wins[i][1] ? wins[i][1].getTime() : null;
        var wait = 0;
        if (ws != null && arrive < ws) { wait = ws - arrive; arrive = ws; }
        out.push({ wait: wait / HR, ws: ws, we: we, arrive: arrive, drop: s.drop });
        t = arrive + HR;
      });
      return out;
    }
    var shift = 0;
    var res = run(now);
    for (var it = 0; it < 8; it++) {
      var worst = 0;
      res.forEach(function (r, i) { if (i > 0 && r.wait > worst) worst = r.wait; });
      if (worst <= 1) break;
      var slack = Infinity;
      res.forEach(function (r) {
        if (!r.drop && r.we != null) slack = Math.min(slack, (r.we - r.arrive) / HR);
      });
      var step = Math.min(worst, Math.max(0, slack));
      if (step <= 0.25) break;
      shift += step;
      res = run(now + shift * HR);
    }
    return res.map(function (r, i) { return { wait: i === 0 ? 0 : r.wait, ws: r.ws }; });
  }

  function comboTimelineHtml(combo) {
    var stops = comboStopModel(combo);
    if (!stops.length) return '';
    var scanDt = parseScanStamp(String((state.searches && (state.searches.scanned_at || state.searches.as_of)) || ''));
    var year = scanDt ? scanDt.getFullYear() : new Date().getFullYear();
    var waits = comboWaits(stops, year);
    var startName = (state.truckAt && state.truckAt.label) ? state.truckAt.label : searchOriginLabel();
    var html = '<ol class="cc-tl" aria-label="Trip timeline">';
    html += '<li class="cc-stop cc-first"><span class="cc-dot cc-start">S</span>' +
      '<div class="cc-stop-main"><div class="cc-place">' + esc(startName) + '</div>' +
      '<div class="cc-stop-sub"><span class="cc-act">START</span></div></div></li>';
    stops.forEach(function (s, i) {
      var w = waits[i];
      var lc = s.deckBefore.map(legColor);
      var segStyle = '';
      if (s.loaded) {
        var stopsPct = lc.map(function (c, k) {
          return c + ' ' + (100 * k / lc.length) + '%, ' + c + ' ' + (100 * (k + 1) / lc.length) + '%';
        }).join(', ');
        segStyle = ' style="--seg:linear-gradient(to right, ' + stopsPct + ')"';
      }
      if (s.mi > 0.05) {
        var onDeck = s.deckBefore.map(legLetter).join('+');
        html += '<li class="cc-seg ' + (s.loaded ? 'loaded' : 'empty') + '"' + segStyle + '><span class="cc-seg-label">' +
          '<b>' + (s.loaded ? 'Loaded' : 'Empty') + '</b> ' + (s.approx ? '~' : '') + esc(plainNum(s.mi, 0)) + ' mi, ' + esc(fmtDriveTime(s.hrs)) +
          (s.loaded && onDeck ? ' <i>(' + esc(onDeck) + ' on deck)</i>' : '') + '</span></li>';
      } else {
        html += '<li class="cc-seg same ' + (s.loaded ? 'loaded' : 'empty') + '"' + segStyle + '><span class="cc-seg-label"><i>same stop</i></span></li>';
      }
      if (w.wait >= 6) {
        html += '<li class="cc-seg wait"><span class="cc-seg-label"><b>Wait ~' + esc(fmtWaitHrs(w.wait)) + '</b> ' +
          (s.drop ? 'drop' : 'pickup') + ' opens ' + esc(fmtWhen(new Date(w.ws))) + '</span></li>';
      }
      var col = s.leg >= 0 ? legColor(s.leg) : '#c4b5fd';
      var last = i === stops.length - 1;
      html += '<li class="cc-stop' + (last ? ' cc-last' : '') + '" style="--lc:' + col + '">' +
        '<span class="cc-dot ' + (s.drop ? 'drop' : 'pickup') + '">' + s.n + '</span>' +
        '<div class="cc-stop-main"><div class="cc-place">' + esc(s.place) + '</div>' +
        '<div class="cc-stop-sub"><span class="cc-act">' + esc(s.tag) + ' ' + (s.drop ? 'DROP' : 'PICKUP') + '</span>' +
        (s.leg >= 0 ? '<span class="cc-legchip">Leg ' + legLetter(s.leg) + '</span>' : '') +
        (s.window ? '<span class="cc-win">' + esc(s.window) + '</span>' : '') +
        '</div></div></li>';
    });
    html += '</ol>';
    html += '<p class="cc-key"><span class="k-solid"></span>pickup <span class="k-ring"></span>drop ' +
      '<span class="k-line empty"></span>empty <span class="k-line loaded"></span>loaded <span class="k-line wait"></span>wait</p>';
    return html;
  }

  function comboLegRowsHtml(combo) {
    var loads = combo.loads || [];
    return '<div class="cc-legs">' + loads.map(function (row, i) {
      var wt = row.weight_lb != null ? plainNum(row.weight_lb, 0) + ' lb' : 'weight n/a';
      var meta = [];
      meta.push(row.broker || (row.board === 'Direct Freight' ? 'Broker on DF' : (row.board === 'uShip' ? 'Shipper on uShip' : 'Broker n/a')));
      meta.push(wt);
      if (row.length_ft != null) meta.push(plainNum(row.length_ft, 0) + ' ft');
      var mi = rowLoadedMiles(row);
      if (mi) meta.push(plainNum(mi, 0) + ' mi');
      if (row.board) meta.push(row.board);
      var tel = brokerTel(row);
      var mail = brokerMailto(row);
      var acts = '<button type="button" class="call-sheet-btn cc-mini">Call sheet</button>' +
        (tel ? '<a class="cc-mini cc-call" href="' + esc(tel) + '">Call</a>' : '') +
        (mail ? '<a class="cc-mini cc-call" href="' + esc(mail) + '">Email</a>' : '');
      return '<div class="cc-leg" style="--lc:' + legColor(i) + '">' +
        '<span class="cc-legbadge">' + legLetter(i) + '</span>' +
        '<div class="cc-leg-body">' +
          '<div class="cc-leg-route">' + esc((row.origin || 'Origin') + ' to ' + (row.destination || 'Destination')) + '</div>' +
          '<div class="cc-leg-meta">' + esc(meta.join(' | ')) + '</div>' +
        '</div>' +
        '<span class="cc-rate">' + (row.posted_rate != null ? esc(money(row.posted_rate)) : 'n/a') + '</span>' +
        '<div class="cc-leg-actions">' + acts + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function comboHeaderLine(combo, nLegs) {
    var rateSum = 0;
    var rateOk = nLegs > 0;
    (combo.loads || []).forEach(function (row) {
      if (row.posted_rate == null || !isFinite(Number(row.posted_rate))) rateOk = false;
      else rateSum += Number(row.posted_rate);
    });
    var rate = rateOk ? rateSum : (combo.posted_rate != null ? Number(combo.posted_rate) : null);
    var days = rowDays(combo, nLegs);
    var npd = rowNetPerDay(combo, nLegs);
    var verd = String(combo.verdict || 'MAYBE').toLowerCase();
    function cell(label, val, cls) {
      return '<div class="cc-cell' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span><b>' + val + '</b></div>';
    }
    return '<div class="cc-summary" role="group" aria-label="Combo summary">' +
      cell('Rate', rate != null ? esc(money(rate)) : 'n/a') +
      cell('Net EST', combo.net_est != null ? esc(searchMoney(combo.net_est)) : 'n/a', 'net') +
      cell('Days', days != null ? esc(formatDays(days)) : 'n/a') +
      cell('$/day', npd != null ? esc(searchMoney(npd)) : 'n/a', npd != null && npd < MIN_NET_PER_DAY ? 'low' : '') +
      '<div class="cc-cell cc-verd"><span>Verdict</span><span class="verdict-pill ' + esc(verd) + '">' + esc(displayVerdict(combo.verdict || 'MAYBE')) + '</span></div>' +
      '</div>';
  }

  function renderComboCard(combo, pkg) {
    var verd = String(combo.verdict || 'MAYBE').toLowerCase();
    var comboLoads = combo.loads || [];
    var nLegs = comboLoads.length;
    var label = (pkg && pkg.label) ? pkg.label : 'Combo';
    var cid = pkg ? ((pkg.chain ? 'chain-' : 'combo-') + pkg.n) : '';
    var kind = combo.kind === 'shared' ? 'Shared deck' : 'Sequential chain';
    var len = combo.combined_length_ft != null ? plainNum(combo.combined_length_ft, 1) + ' ft' : 'n/a';
    if (combo.length_unknown) len += ' (some not listed)';
    var fitRow = '<div class="fit-row">' +
      weightFitBadge(combo.combined_weight_lb) +
      '<span class="fit-badge neutral">' + esc(len) + '</span>' +
      avgHintBadge(combo, nLegs) +
      wxChipHtml(combo) +
      '</div>';
    var detailsHtml = '<div class="search-details" hidden>' +
      netBlock(combo.net_est, perHourValue(combo, nLegs), netPerMileValue(combo), '', combo, nLegs) +
      milesStrip(combo.loaded_mi, combo.deadhead_mi, { emptyFrom: searchOriginLabel() + ', all legs' }) +
      fuelLine(currentFuel(combo.loads && combo.loads[0] ? combo.loads[0] : combo)) +
      (combo.math ? '<p class="search-math">' + esc(combo.math) + '</p>' : '') +
      (combo.timing_note ? '<p class="search-meta">Timing: ' + esc(combo.timing_note) + '</p>' : '') +
      routeBlock(routePayload(combo), comboMapsUrl(combo), kind + ' route map', combo) +
      ((combo.flags && combo.flags.length) ? '<p class="search-flags">' + esc(combo.flags.join(' ')) + '</p>' : '') +
      '</div>';
    var cCollapse = verd === 'pass';
    var cTitle = label + ': ' + comboLoads.map(function (r) { return whyShortLane(r); }).join(' + ');
    return '<article class="combo-card cc ' + esc(verd) + (cCollapse ? ' collapsible is-collapsed' : '') + '"' + (cid ? ' id="' + esc(cid) + '"' : '') + '>' +
      (cCollapse ? collapsedSummaryHtml(cTitle, combo.net_est, rowNetPerDay(combo, nLegs), combo, combo.verdict, true) : '') +
      '<div class="cc-rail" aria-hidden="true" style="background:linear-gradient(to bottom, ' +
        comboLoads.map(function (r, i) { return legColor(i) + ' ' + (100 * i / nLegs) + '%, ' + legColor(i) + ' ' + (100 * (i + 1) / nLegs) + '%'; }).join(', ') + ')"></div>' +
      '<div class="cc-head">' +
        '<span class="combo-name cc-badge">' + esc(label) + '</span>' +
        '<span class="cc-kind">' + esc(kind) + ' / ' + nLegs + ' loads</span>' +
      '</div>' +
      comboHeaderLine(combo, nLegs) +
      fitRow +
      comboTimelineHtml(combo) +
      comboLegRowsHtml(combo) +
      whyBoxHtml(combo, { combo: true }) +
      routeWxHtml(combo) +
      '<div class="search-actions"><button type="button" class="call-sheet-btn">Call sheet</button><button type="button" class="details-toggle-btn" aria-expanded="false">Map &amp; math</button></div>' +
      detailsHtml +
      '</article>';
  }

  function jumpToCombo(id) {
    var el = document.getElementById(id);
    if (!el) {
      state.searchFilter = 'all';
      state.hidePass = false;
      state.maxDeadhead = 0;
      renderSearches();
      el = document.getElementById(id);
    }
    if (!el) return;
    var offset = stickyTopOffset();
    var top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    el.classList.remove('is-collapsed');
    var sum = el.querySelector(':scope > .card-summary');
    if (sum) sum.setAttribute('aria-expanded', 'true');
    el.classList.remove('cc-flash');
    void el.offsetWidth;
    el.classList.add('cc-flash');
    window.setTimeout(function () { el.classList.remove('cc-flash'); }, 2200);
  }

  function inComboChipHtml(row, data) {
    var key = loadKey(row);
    if (!key) return '';
    var combos = [];
    var chains = [];
    comboPackages(data).forEach(function (pkg) {
      var legs = pkg.combo.loads || [];
      for (var i = 0; i < legs.length; i++) {
        if (loadKey(legs[i]) === key) { (pkg.chain ? chains : combos).push(pkg); break; }
      }
    });
    function chip(word, list, prefix) {
      if (!list.length) return '';
      return '<span class="in-combo"><span class="in-combo-word">In ' + word + '</span> ' + list.map(function (pkg, i) {
        return '<span class="icj"><button type="button" class="in-combo-jump" data-jump="' + prefix + pkg.n + '" aria-label="Jump to ' + esc(pkg.label) + '">' + pkg.n + '</button>' + (i < list.length - 1 ? ',' : '') + '</span>';
      }).join(' ') + '</span>';
    }
    return chip('Combo', combos, 'combo-') + chip('Chain', chains, 'chain-');
  }

  function bindComboJumps() {
    if (state.comboJumpBound) return;
    state.comboJumpBound = true;
    document.addEventListener('click', function (event) {
      var btn = event.target.closest && event.target.closest('.in-combo-jump');
      if (!btn) return;
      event.preventDefault();
      jumpToCombo(btn.getAttribute('data-jump'));
    });
  }

  function renderCombos(data) {
    if (state.searchFilter === 'saved') return '';
    var packages = comboPackages(data);
    var cap = Number(state.maxDeadhead) || 0;
    if (cap > 0) {
      packages = packages.filter(function (pkg) {
        var combo = pkg.combo;
        var first = (combo.loads || [])[0];
        var dh = first ? rowEmptyMiles(first) : combo.deadhead_mi;
        return dh == null || dh <= cap;
      });
    }
    if (state.hidePass) {
      packages = packages.filter(function (pkg) {
        return String(pkg.combo.verdict || '').toUpperCase() !== 'PASS';
      });
    }
    var f = state.searchFilter || 'all';
    if (f === 'take' || f === 'maybe' || f === 'pass') {
      packages = packages.filter(function (pkg) {
        return String(pkg.combo.verdict || '').toLowerCase() === f;
      });
    } else if (f === 'truckstop' || f === 'df' || f === 'uship') {
      packages = [];
    }
    var body;
    if (!packages.length) {
      if (f === 'all') {
        body = '<p class="fine">No 2- or 3-load combos in this scan cleared the $1,000 net bar with a feasible route.</p>';
      } else {
        body = '';
      }
    } else {
      body = packages.map(function (pkg) { return renderComboCard(pkg.combo, pkg); }).join('');
    }
    if (!body) return '';
    return '<div class="combos">' +
      '<h3>Combos</h3>' +
      '<p class="fine">Shared-deck and sequential chains (&gt;= $1,000 net EST, beats single by $200).</p>' +
      body + '</div>';
  }

  function renderSearchGroups(rows, data) {
    if (state.searchSort && state.searchSort !== 'default') {
      if (!rows.length) return emptyStateHtml('No loads match these filters.', 'Try All, or turn off Hide PASS and Fits only.');
      return '<section class="search-group" id="search-group-sorted">' +
        '<h3 class="search-group-head">' + esc(rows.length + ' loads sorted') + '</h3>' +
        rows.map(function (row) { return renderSearchCard(row, data); }).join('') +
        '</section>';
    }
    var groups = { TAKE: [], MAYBE: [], PASS: [] };
    rows.forEach(function (row) {
      var key = String(row.verdict || 'PASS').toUpperCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });
    var labels = { TAKE: 'Take', MAYBE: 'Maybe', PASS: 'Pass' };
    var html = '';
    var filter = state.searchFilter || 'all';
    ['TAKE', 'MAYBE', 'PASS'].forEach(function (key) {
      var list = groups[key] || [];
      if (!list.length) return;
      var cards = list.map(function (row) { return renderSearchCard(row, data); }).join('');
      var title = labels[key] + ' (' + list.length + ')';
      var gid = 'search-group-' + key.toLowerCase();
      if (key === 'PASS' && filter !== 'pass' && filter !== 'saved') {
        var passOpen = state.passGroupOpen !== false;
        html += '<details class="search-group pass-group" id="' + gid + '"' + (passOpen ? ' open' : '') + '>' +
          '<summary class="search-group-head pass">' + esc(title) + '</summary>' +
          cards + '</details>';
      } else {
        html += '<section class="search-group" id="' + gid + '">' +
          '<h3 class="search-group-head ' + key.toLowerCase() + '">' + esc(title) + '</h3>' +
          cards + '</section>';
      }
    });
    if (!html && (state.searchFilter || 'all') === 'combos') return '';
    return html || emptyStateHtml('No loads in this filter.', 'Try All, or turn off Hide PASS and Fits only.');
  }

  function searchToolbar() {
    var spinHidden = state.searchRefreshing ? '' : ' hidden';
    var connected = !!getRelayPin();
    return '<div id="search-pull" class="pull">Pull to refresh</div>' +
      '<div class="search-toolbar">' +
        '<p class="search-updated" id="search-updated">' +
          '<span id="search-spinner" class="search-spinner"' + spinHidden + ' aria-hidden="true"></span>' +
          '<span id="search-updated-text">' + esc(searchUpdatedText()) + '</span>' +
        '</p>' +
        '<div class="search-toolbar-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm relay-gear-btn' + (connected ? ' connected' : '') + '" id="relay-gear-btn" aria-expanded="' + (state.relayConnectOpen ? 'true' : 'false') + '" aria-controls="relay-connect-panel">' +
            (connected ? 'Connected' : 'Connect') +
          '</button>' +
          '<button type="button" class="btn btn-secondary btn-sm" id="search-refresh-btn"' +
            (state.searchRefreshing ? ' disabled' : '') + ' aria-label="Reload the latest saved scan">Refresh</button>' +
        '</div>' +
      '</div>' +
      renderConnectPanel() +
      toolFold('pull', 'Pull fresh loads', getRelayPin() ? 'New board scan from GPS or a city' : 'PIN needed',
        state.freshPullBusy || !!state.freshPullStatus || pullIsActive(state.pullStatus || {}), renderFreshPull()) +
      toolFold('truck', 'Truck location', (state.truckAt && state.truckAt.label) ? state.truckAt.label : ('Deadhead from ' + searchOriginLabel()),
        !!(state.truckAt && state.truckAt.lat != null), renderTruckAt());
  }

  function bindSearchRefresh() {
    var btn = $('search-refresh-btn');
    if (btn) btn.addEventListener('click', function () { refreshSearches(); });
    bindConnectPanel();
    bindTruckAt();
    bindFreshPull();
    var wxSw = $('wx-switch');
    if (wxSw) wxSw.addEventListener('click', function () {
      state.weatherOn = !weatherOn();
      saveWeatherSwitch();
      if (state.searches) refreshDeadheads(); else renderSearches();
    });
  }

  function findRowByKey(key, data) {
    var loads = (data && data.loads) || [];
    for (var i = 0; i < loads.length; i++) {
      if (loadKey(loads[i]) === key) return loads[i];
    }
    return null;
  }

  function updateCompareBar() {
    var bar = $('compare-bar');
    if (!bar) return;
    var data = viewSearches();
    var keys = compareKeyList().filter(function (k) { return !data || !!findRowByKey(k, data); });
    if (!keys.length || state.tab !== 'searches') {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    var title = $('compare-bar-title');
    var sub = $('compare-bar-sub');
    var openBtn = $('compare-open-btn');
    if (title) title.textContent = 'Compare (' + keys.length + '/3)';
    if (sub && data) {
      var names = keys.map(function (k) {
        var r = findRowByKey(k, data);
        return r ? ((r.origin || '').split(',')[0] + '->' + (r.destination || '').split(',')[0]) : '';
      }).filter(Boolean);
      sub.textContent = names.join(' | ');
    }
    if (openBtn) openBtn.disabled = keys.length < 2;
  }

  function closeCompareSheet() {
    var sheet = $('compare-sheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('hidden', '');
    document.documentElement.classList.remove('sheet-open');
  }

  function openCompareSheet() {
    var sheet = $('compare-sheet');
    var body = $('compare-sheet-body');
    var data = viewSearches();
    if (!sheet || !body || !data) return;
    var rows = compareKeyList().map(function (k) { return findRowByKey(k, data); }).filter(Boolean);
    if (rows.length < 2) return;

    function maxIdx(vals, lowerBetter) {
      var best = -1, bestVal = null;
      vals.forEach(function (v, i) {
        if (v == null || !isFinite(Number(v))) return;
        var n = Number(v);
        if (bestVal == null || (lowerBetter ? n < bestVal : n > bestVal)) {
          bestVal = n;
          best = i;
        }
      });
      return best;
    }

    var netBest = maxIdx(rows.map(function (r) { return r.net_est; }), false);
    var npdBest = maxIdx(rows.map(function (r) { return rowNetPerDay(r, 1); }), false);
    var hrBest = maxIdx(rows.map(function (r) { return perHourValue(r, 1); }), false);
    var nmiBest = maxIdx(rows.map(function (r) { return netPerMileValue(r); }), false);
    var dhBest = maxIdx(rows.map(function (r) { return rowEmptyMiles(r); }), true);

    function tr(label, cells, bestI) {
      return '<tr><th>' + esc(label) + '</th>' + cells.map(function (c, i) {
        return '<td' + (bestI === i ? ' class="cmp-best"' : '') + '>' + c + '</td>';
      }).join('') + '</tr>';
    }

    var heads = '<tr><th>Load</th>' + rows.map(function (r) {
      return '<td class="compare-col-head">' + esc((r.origin || '').split(',')[0] + ' -> ' + (r.destination || '').split(',')[0]) +
        '<br><span class="verdict-pill ' + esc(String(r.verdict || 'PASS').toLowerCase()) + '">' + esc(displayVerdict(r.verdict || 'PASS')) + '</span></td>';
    }).join('') + '</tr>';

    var table = '<div class="compare-table-wrap"><table class="compare-table"><tbody>' +
      heads +
      tr('Net EST', rows.map(function (r) { return esc(searchMoney(r.net_est)); }), netBest) +
      tr('Net / day', rows.map(function (r) { return esc(searchMoney(rowNetPerDay(r, 1))) + '/d'; }), npdBest) +
      tr('$/hr EST', rows.map(function (r) { return esc(searchMoney(perHourValue(r, 1))) + '/hr'; }), hrBest) +
      tr('Net $/mi', rows.map(function (r) { return esc(rateMoney(netPerMileValue(r), 2)) + '/mi'; }), nmiBest) +
      tr('Gross $/mi', rows.map(function (r) { return esc(rateMoney(grossPerMileValue(r), 2)) + '/mi'; }), -1) +
      tr('Loaded mi', rows.map(function (r) { return esc(plainNum(rowLoadedMiles(r), 0)) + ' mi'; }), -1) +
      tr('Deadhead', rows.map(function (r) { return esc(plainNum(rowEmptyMiles(r), 0)) + ' mi'; }), dhBest) +
      tr('Days', rows.map(function (r) { return esc(formatDays(rowDays(r, 1))) + ' d'; }), -1) +
      tr('Weight', rows.map(function (r) { return r.weight_lb != null ? esc(plainNum(r.weight_lb, 0)) + ' lb' : 'n/a'; }), -1) +
      tr('Pickup', rows.map(function (r) { return esc(pickupDateLabel(r)); }), -1) +
      tr('Board', rows.map(function (r) { return esc(r.board || ''); }), -1) +
      tr('Actions', rows.map(function (r) {
        var mail = brokerMailto(r);
        var tel = brokerTel(r);
        return '<div class="compare-mini-actions">' +
          '<a href="' + esc(openLoadHref(r)) + '" target="_blank" rel="noopener noreferrer">Open</a>' +
          (tel ? '<a href="' + esc(tel) + '">Call</a>' : '') +
          (mail ? '<a href="' + esc(mail) + '">Email</a>' : '') +
          '</div>';
      }), -1) +
      '</tbody></table></div>';

    body.innerHTML = table;
    sheet.removeAttribute('hidden');
    sheet.classList.add('open');
    document.documentElement.classList.add('sheet-open');
  }

  function bindCompareSheet() {
    var close = $('compare-sheet-close');
    var openBtn = $('compare-open-btn');
    var clearBtn = $('compare-clear-btn');
    if (close) close.addEventListener('click', closeCompareSheet);
    if (openBtn) openBtn.addEventListener('click', openCompareSheet);
    if (clearBtn) clearBtn.addEventListener('click', function () {
      state.compareKeys = [];
      saveCompareKeys();
      if (state.tab === 'searches') renderSearches();
      else updateCompareBar();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('compare-sheet') && $('compare-sheet').classList.contains('open')) {
        closeCompareSheet();
      }
    });
  }

  function weatherSwitchHtml() {
    var on = weatherOn();
    return '<div class="wx-switch-row">' +
      '<button type="button" id="wx-switch" class="wx-switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="Weather rules">' +
        '<span class="wx-switch-track"><span class="wx-switch-knob"></span></span>' +
        '<span class="wx-switch-label">Weather ' + (on ? 'ON' : 'OFF') + '</span>' +
      '</button>' +
      '<span class="wx-switch-hint">' + (on
        ? 'Cold drops (low 45 F or colder) are PASS. Snow/ice or 50+ mph gusts turn TAKE into MAYBE.'
        : 'Verdicts ignore weather. Cold and storm warnings show as amber notes only.') + '</span>' +
      '</div>';
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
      updateCompareBar();
      return;
    }
    if (!data) {
      root.innerHTML = head + loadingSkeletonHtml('Loading the latest saved scan...');
      bindSearchRefresh();
      updateCompareBar();
      return;
    }
    var counts = data.counts || {};
    var rules = data.rules || {};
    var scanStamp = data.scanned_at || data.as_of || '';
    var scanDt = parseScanStamp(scanStamp);
    var ageMs = scanDt ? (Date.now() - scanDt.getTime()) : null;
    var ageText = ageMs != null ? formatRelAge(ageMs) : '';
    var isStale = ageMs != null && ageMs > 6 * 3600000;
    var newCount = (data.loads || []).filter(isNewLoad).length;
    var savedCount = savedCountInData(data);

    var formula = rules.formula || 'net EST = rate x 0.87 - (EIA diesel / 8.0 mpg + $0.034 DEF) x total mi';
    var bar = rules.quality_bar || '';
    var rows = filteredSearches(data);
    var filter = state.searchFilter || 'all';
    function countTile(name, label, value) {
      var on = filter === name;
      return '<button type="button" class="search-count chip chip-' + name + '" data-filter="' + name +
        '" aria-pressed="' + (on ? 'true' : 'false') +
        '" aria-label="' + label + ', ' + esc(String(value || 0)) +
        (name === 'all' ? ' loads, show all' : ', show ' + label) + '">' +
        '<span class="l">' + label + '</span>' +
        '<span class="n">' + esc(String(value || 0)) + '</span></button>';
    }

    var filterRow = [
      ['all', 'All'],
      ['truckstop', 'Truckstop'],
      ['df', 'Direct Freight'],
      ['uship', 'uShip'],
      ['saved', 'Saved (' + savedCount + ')']
    ].map(function (pair) {
      var on = filter === pair[0];
      return '<button type="button" data-filter="' + pair[0] + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(pair[1]) + '</button>';
    }).join('');

    var sortOpts = [
      ['default', 'Verdict + Net/day'],
      ['net_day', 'Net / day (high-low)'],
      ['net', 'Net EST (high-low)'],
      ['net_mi', 'Net $/mi (high-low)'],
      ['per_hr', '$/hr EST (high-low)'],
      ['deadhead', 'Deadhead (low-high)'],
      ['pickup', 'Pickup date (soonest)']
    ].map(function (pair) {
      return '<option value="' + pair[0] + '"' + ((state.searchSort || 'default') === pair[0] ? ' selected' : '') + '>' + esc(pair[1]) + '</option>';
    }).join('');

    var controlsHtml = '<div class="search-controls">' +
      '<div class="search-filter-row" role="group" aria-label="Filter loads">' +
        filterRow +
        '<button type="button" id="toggle-hide-pass" aria-pressed="' + (state.hidePass ? 'true' : 'false') + '">Hide PASS</button>' +
        '<button type="button" id="toggle-fits-only" aria-pressed="' + (state.fitsOnly ? 'true' : 'false') + '">Fits only</button>' +
      '</div>' +
      '<div class="search-sort-row">' +
        '<label class="search-sort-label">Sort <select id="search-sort-select">' + sortOpts + '</select></label>' +
      '</div>' +
      '</div>';

    var fresh = feedFreshnessPillInner();
    var freshnessBar = '<div class="freshness-bar">' +
      (fresh.text ? '<span class="' + fresh.cls + '" id="load-fresh-pill">' + esc(fresh.text) + '</span>' : '<span class="fresh-pill" id="load-fresh-pill" hidden></span>') +
      (newCount > 0 ? '<span class="new-badge">' + newCount + ' new since last scan</span><button type="button" class="mark-seen-btn" id="mark-seen-btn">Mark all seen</button>' : '') +
      '</div>';

    var cards = renderSearchGroups(rows, data);
    var combosHtml = renderCombos(data);
    root.innerHTML =
      '<div class="searches-hero">' +
        '<div class="hero-title-row"><h2>Load Boards</h2>' +
        '<p class="hero-meta">' + (scanStamp ? 'Scan ' + esc(scanStamp) : 'Latest saved scan') +
          (data.origin ? ' / ' + esc(data.origin) : '') +
          (state.searchOffline ? ' / offline copy' : '') + '</p></div>' +
        freshnessBar +
        '<div class="search-counts chip-row" role="group" aria-label="Filter load boards by verdict">' +
          countTile('all', 'All', counts.total || 0) +
          countTile('take', 'Take', counts.take || 0) +
          countTile('maybe', 'Maybe', counts.maybe || 0) +
          countTile('pass', 'Pass', counts.pass || 0) +
          countTile('combos', 'Combos', comboPackages(data).length) +
        '</div>' +
        '<p class="wx-hint">' + (weatherOn()
          ? 'Weather ON: drops at 45 F or colder are PASS; snow, ice or 50+ mph gusts turn TAKE into MAYBE.'
          : 'Weather OFF: verdicts ignore weather; cold and storm warnings show as amber notes.') + '</p>' +
        (Number(data.hidden_heavy || counts.hidden_heavy || 0) > 0
          ? '<p class="fine hidden-heavy">' + esc(String(Number(data.hidden_heavy || counts.hidden_heavy))) +
            ' loads 20,000 lb+ hidden</p>'
          : '') +
        '<details class="score-help"><summary>How loads are scored</summary>' +
          '<p class="fine">' + esc(formula) + '. ' + esc(bar) + '</p>' +
          rateLegend() +
        '</details>' +
      '</div>' +
      head +
      controlsHtml +
      '<div id="search-list">' +
      combosHtml +
      renderSearchChart(rows) +
      cards +
      '</div>';
    bindSearchRefresh();
    updateAppbar();

    root.querySelectorAll('.search-counts [data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.searchFilter = btn.getAttribute('data-filter') || 'all';
        renderSearches();
        requestAnimationFrame(function () {
          scrollToSearchGroup(state.searchFilter);
        });
      });
    });
    root.querySelectorAll('.search-filter-row [data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.searchFilter = btn.getAttribute('data-filter') || 'all';
        renderSearches();
      });
    });
    var hp = $('toggle-hide-pass');
    if (hp) hp.addEventListener('click', function () {
      state.hidePass = !state.hidePass;
      saveSearchPrefs();
      renderSearches();
    });
    var fo = $('toggle-fits-only');
    if (fo) fo.addEventListener('click', function () {
      state.fitsOnly = !state.fitsOnly;
      saveSearchPrefs();
      renderSearches();
    });
    var sortSel = $('search-sort-select');
    if (sortSel) sortSel.addEventListener('change', function () {
      state.searchSort = sortSel.value || 'default';
      saveSearchPrefs();
      renderSearches();
    });
    var markSeen = $('mark-seen-btn');
    if (markSeen) markSeen.addEventListener('click', function () {
      markAllLoadsSeen(state.searches);
      renderSearches();
    });

    root.querySelectorAll('[data-save-key]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var k = btn.getAttribute('data-save-key');
        var r = findRowByKey(k, data);
        if (!r) return;
        toggleSavedLoad(r);
        renderSearches();
      });
    });
    root.querySelectorAll('[data-cmp-key]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var k = btn.getAttribute('data-cmp-key');
        var r = findRowByKey(k, data);
        if (!r) return;
        toggleCompareLoad(r);
        renderSearches();
      });
    });
    root.querySelectorAll('.why-more-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var box = btn.closest('.why-box');
        if (!box) return;
        var open = btn.getAttribute('aria-expanded') === 'true';
        open = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        box.querySelectorAll('.why-extra').forEach(function (li) { li.hidden = !open; });
        var n = box.querySelectorAll('.why-extra').length;
        btn.textContent = open ? 'Show less' : (n + ' more');
      });
    });
    root.querySelectorAll('.wx-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var wrap = btn.closest('.route-wx');
        var pane = wrap ? wrap.querySelector('.wx-points') : null;
        if (!pane) return;
        var open = pane.hidden;
        pane.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
    root.querySelectorAll('.details-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.search-card, .combo-card');
        var pane = card ? card.querySelector('.search-details') : null;
        if (!pane) return;
        var open = pane.hidden;
        pane.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.textContent = open ? 'Hide details' : (card.classList.contains('combo-card') ? 'Map & math' : 'Details & map');
        if (open) observeRouteMaps(pane);
      });
    });
    updateCompareBar();
  }

  // ---- Finance tab (v41): PIN-gated via relay /financials. Nothing is stored in the repo. ----
  var FIN_SESSION_KEY = 'blackram_fin_session_v1';
  var finState = { data: null, loading: false, error: '', range: 30, fetchedAt: 0 };

  function finMoney(n, cents) {
    if (n == null || !isFinite(n)) return '--';
    var neg = n < -0.004;
    var abs = Math.abs(n);
    var s = abs.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
    return (neg ? '-$' : '$') + s;
  }
  function finDay(iso) {
    if (!iso) return 'date?';
    var p = String(iso).slice(0, 10).split('-');
    return Number(p[1]) + '/' + Number(p[2]);
  }
  function finDaysFrom(iso, base) {
    var a = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    var b = Date.UTC(+base.slice(0, 4), +base.slice(5, 7) - 1, +base.slice(8, 10));
    return Math.round((a - b) / 86400000);
  }
  function finAsOfText(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
  }

  function fetchFinance(force) {
    var pin = getRelayPin();
    if (!pin) { finState.error = 'nopin'; renderFinance(); return Promise.resolve(); }
    if (finState.loading) return Promise.resolve();
    if (!force && finState.data && Date.now() - finState.fetchedAt < 60000) return Promise.resolve();
    finState.loading = true;
    if (!finState.data) renderFinance();
    return fetch(RELAY_URL + '/financials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin }),
      cache: 'no-store'
    }).then(function (resp) {
      return resp.json().catch(function () { return null; }).then(function (j) {
        if (resp.ok && j && j.ok && j.data) {
          finState.data = j.data; finState.error = ''; finState.fetchedAt = Date.now();
          try { sessionStorage.setItem(FIN_SESSION_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ }
        } else if (resp.status === 401) {
          finState.error = 'wrongpin'; finState.data = null;
          try { sessionStorage.removeItem(FIN_SESSION_KEY); } catch (e) { /* ignore */ }
        } else {
          finState.error = (j && j.error) || ('Could not load (' + resp.status + ')');
        }
      });
    }).catch(function () {
      finState.error = 'Offline - showing last copy if any.';
    }).then(function () {
      finState.loading = false;
      if (state.tab === 'fin') renderFinance();
      renderCallSheetDispatch();
      try { document.dispatchEvent(new CustomEvent('blackram:financials')); } catch (err) { /* old browser */ }
    });
  }

  var PIN_LOCK_ICON = '<div class="pin-lock-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></g></svg></div>';

  function finPinForm(msg) {
    return '<section class="fin-card fin-lock pin-lock">' + PIN_LOCK_ICON +
      '<h3>Finance is locked</h3><p class="fin-sub">' + esc(msg) + '</p>' +
      '<form id="fin-pin-form" class="fin-pin-row" autocomplete="off">' +
      '<input id="fin-pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="App PIN" aria-label="App PIN" />' +
      '<button type="submit" class="btn primary">Unlock</button></form>' +
      '<p class="pin-lock-note">One PIN unlocks Finance, Accounting, Daily PDFs and receipts on this phone.</p></section>';
  }

  function finChart(proj, range) {
    var base = proj.base.slice(0, range + 1);
    var alt = (proj.if_paid || []).slice(0, range + 1);
    var W = 340, H = 190, L = 44, R = 10, T = 14, B = 26;
    var vals = base.map(function (p) { return p[1]; }).concat(alt.map(function (p) { return p[1]; })).concat([0, proj.start]);
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    var pad = (max - min) * 0.08 || 100; max += pad; min -= pad;
    var n = base.length - 1;
    function x(i) { return L + (W - L - R) * (i / n); }
    function y(v) { return T + (H - T - B) * (1 - (v - min) / (max - min)); }
    function path(series) {
      // step line: balance holds until the next event
      var d = '';
      series.forEach(function (p, i) {
        if (i === 0) d += 'M' + x(0).toFixed(1) + ' ' + y(p[1]).toFixed(1);
        else d += 'H' + x(i).toFixed(1) + 'V' + y(p[1]).toFixed(1);
      });
      return d;
    }
    var grid = '';
    var steps = 4;
    for (var g = 0; g <= steps; g++) {
      var v = min + (max - min) * g / steps;
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '" class="fin-grid"/>' +
        '<text x="' + (L - 4) + '" y="' + (y(v) + 3).toFixed(1) + '" class="fin-axis" text-anchor="end">' + finMoney(Math.round(v / 100) * 100).replace('$', '$') + '</text>';
    }
    var zero = '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" class="fin-zero"/>';
    var below = '<rect x="' + L + '" y="' + y(0).toFixed(1) + '" width="' + (W - L - R) + '" height="' + Math.max(0, (H - B) - y(0)).toFixed(1) + '" class="fin-red-zone"/>';
    var ticks = '';
    [0, Math.round(n / 3), Math.round(2 * n / 3), n].forEach(function (i) {
      ticks += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" class="fin-axis" text-anchor="' + (i === 0 ? 'start' : i === n ? 'end' : 'middle') + '">' + finDay(base[i][0]) + '</text>';
    });
    var dots = '';
    (proj.events || []).forEach(function (e) {
      var i = finDaysFrom(e.date, base[0][0]);
      if (i < 0 || i > n) return;
      dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(base[i][1]).toFixed(1) + '" r="3" class="fin-dot"/>';
    });
    var lowIdx = 0;
    base.forEach(function (p, i) { if (p[1] < base[lowIdx][1]) lowIdx = i; });
    var lp = base[lowIdx];
    var lx = x(lowIdx), ly = y(lp[1]);
    var anchor = lx > W - 90 ? 'end' : 'start';
    var low = '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="5" class="fin-low"/>' +
      '<text x="' + (anchor === 'end' ? lx - 8 : lx + 8).toFixed(1) + '" y="' + Math.min(H - B - 4, ly + 4).toFixed(1) + '" class="fin-low-label" text-anchor="' + anchor + '">Low ' + finMoney(lp[1]) + ' ' + finDay(lp[0]) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="fin-svg" role="img" aria-label="Projected bank balance next ' + range + ' days">' +
      below + grid + zero + ticks +
      (alt.length ? '<path d="' + path(alt) + '" class="fin-line-alt"/>' : '') +
      '<path d="' + path(base) + '" class="fin-line"/>' + dots + low + '</svg>';
  }

  function finStatusChip(s) {
    var map = { due: 'Due', overdue: 'Overdue', paid: 'Paid', withheld: 'Withheld', 'date?': 'date?', unpaid: 'Unpaid' };
    return '<span class="fin-chip fin-chip-' + esc(s.replace('?', 'q')) + '">' + esc(map[s] || s) + '</span>';
  }

  function renderFinance() {
    var root = $('fin-root');
    if (!root) return;
    var d = finState.data;
    if (!d) {
      try { var c = sessionStorage.getItem(FIN_SESSION_KEY); if (c && finState.error !== 'wrongpin') d = finState.data = JSON.parse(c); } catch (e) { d = null; }
    }
    if (!d) {
      if (finState.error === 'nopin') root.innerHTML = finPinForm('Enter the app PIN to see the bank balance, bills and cash-flow projection.');
      else if (finState.error === 'wrongpin') root.innerHTML = finPinForm('Wrong PIN. Try again.');
      else if (finState.error) root.innerHTML = '<p class="fine">' + esc(finState.error) + '</p>';
      else root.innerHTML = loadingSkeletonHtml('Loading financials');
      bindFinance();
      return;
    }
    var today = String(d.as_of).slice(0, 10);
    var acct = d.account || {};
    var proj = d.projection;
    var range = finState.range;
    var low = range === 60 ? proj.low60 : proj.low30;

    var bal = '<section class="fin-card fin-balance tl-tap tl-chev tl-chev-top"' + tlAttrs('fin', 'bal', 'Bank balance ' + finMoney(acct.available, true) + '. Show transactions') + '>' +
      '<div class="fin-kicker">' + esc(acct.bank + ' ' + acct.name) + ' ...' + esc(acct.last4) + '</div>' +
      '<div class="fin-big">' + finMoney(acct.available, true) + '</div>' +
      '<div class="fin-sub">Available | as of ' + esc(finAsOfText(d.as_of)) + '</div>' +
      '<div class="fin-mini-row">' +
      '<span class="fin-owed-link" data-tl="fin" data-tl-arg="owed" role="button" tabindex="0" aria-label="Owed to us. Show money coming in">Owed to us <b class="pos">' + finMoney(d.income_pending_total, true) + '</b></span>' +
      ((d.off_bank || []).map(function (o) { return '<span>' + esc(o.label) + ' <b>' + finMoney(o.amount) + '</b></span>'; }).join('')) +
      '</div></section>';

    var calls = '<div class="fin-callouts">' + (d.callouts || []).map(function (c, ci) {
      var ck = /owed to us/i.test(c.text) ? 'owed' : (/^bills /i.test(c.text) ? 'bills' : 'proj:' + ci);
      return '<div class="fin-call fin-call-' + esc(c.tone) + ' tl-tap tl-chev tl-chev-top"' + tlAttrs('fin', ck, c.text + '. Show details') + '><b>' + esc(c.text) + '</b><span>' + esc(c.sub || '') + '</span></div>';
    }).join('') + '</div>';

    var chart = '<section class="fin-card"><div class="fin-head"><div class="fin-kicker">Cash projection</div>' +
      '<div class="fin-seg" role="group" aria-label="Range">' +
      '<button type="button" data-fin-range="30" aria-pressed="' + (range === 30) + '">30d</button>' +
      '<button type="button" data-fin-range="60" aria-pressed="' + (range === 60) + '">60d</button></div></div>' +
      finChart(proj, range) +
      '<div class="fin-legend"><span><i class="lg-base"></i>Bills only</span><span><i class="lg-alt"></i>' + esc(proj.if_paid_note || 'If unpaid loads pay') + '</span></div>' +
      '<div class="fin-sub">Low in ' + range + 'd: <b class="' + (low.balance < 0 ? 'neg' : 'pos') + '">' + finMoney(low.balance) + '</b> on ' + finDay(low.date) + ' | no new loads counted</div>' +
      '</section>';

    var bills = (d.bills || []).map(function (b) {
      var dd = b.next ? finDaysFrom(b.next, today) : null;
      var when = b.next ? (finDay(b.next) + (dd != null ? ' | ' + (dd === 0 ? 'today' : dd > 0 ? dd + 'd' : -dd + 'd late') : '')) : 'date?';
      return '<li class="fin-row tl-tap tl-chev"' + tlAttrs('fin', 'bill:' + b.id, b.payee + '. Show bill details') + '><div class="fin-row-main"><b>' + esc(b.payee) + '</b>' +
        '<span class="fin-row-sub">' + esc(b.freq) + ' | ' + esc(b.from) + (b.paid_note ? ' | ' + esc(b.paid_note) : '') + (b.note ? ' | ' + esc(b.note) : '') + '</span></div>' +
        '<div class="fin-row-end"><b class="neg">' + (b.amount == null ? esc(b.amount_text || 'amount?') : finMoney(b.amount, true)) + '</b>' +
        '<span class="fin-row-sub">' + esc(when) + '</span>' + finStatusChip(b.status) + '</div></li>';
    }).join('');
    var billsCard = '<section class="fin-card" id="fin-bills"><div class="fin-kicker">Bills</div><ul class="fin-list">' + bills + '</ul>' +
      '<p class="fin-foot">Bluevine Bill Pay: ' + (d.scheduled_bank_payments ? d.scheduled_bank_payments + ' scheduled' : 'nothing scheduled') + '</p></section>';

    var inc = (d.income || []).map(function (i) {
      var since = i.delivered ? finDaysFrom(today, i.delivered) : null;
      return '<li class="fin-row tl-tap tl-chev"' + tlAttrs('fin', 'inc:' + i.id, i.payer + '. Show details') + '><div class="fin-row-main"><b>' + esc(i.payer) + '</b>' +
        '<span class="fin-row-sub">Net via ' + esc(i.via) + ' | delivered ' + finDay(i.delivered) + (since != null ? ' (' + since + 'd ago)' : '') + '</span></div>' +
        '<div class="fin-row-end"><b class="pos">+' + finMoney(i.amount, true) + '</b><span class="fin-row-sub">' + (i.expected ? finDay(i.expected) : 'date?') + '</span>' + finStatusChip(i.status) + '</div></li>';
    }).join('');
    var incCard = '<section class="fin-card" id="fin-income"><div class="fin-kicker">Money coming in</div><ul class="fin-list">' + (inc || '<li class="fin-row">Nothing owed right now.</li>') + '</ul></section>';

    var tx = (d.transactions || []).map(function (t) {
      var pos = t.amount >= 0;
      return '<li class="fin-tx fin-tx-' + (pos ? 'in' : 'out') + '"><span class="fin-tx-date">' + finDay(t.date) + '</span>' +
        '<span class="fin-tx-desc">' + esc(t.desc) + '</span>' +
        '<span class="fin-tx-amt ' + (pos ? 'pos' : 'neg') + '">' + (pos ? '+' : '') + finMoney(t.amount, true) + '</span>' +
        '<span class="fin-tx-bal">' + finMoney(t.balance, true) + '</span></li>';
    }).join('');
    var txCard = '<section class="fin-card"><div class="fin-kicker">Transactions</div>' +
      '<div class="fin-tx fin-tx-head"><span>Date</span><span>What</span><span>Amount</span><span>Balance</span></div>' +
      '<ul class="fin-list">' + tx + '</ul></section>';

    var unk = (d.unknown || []).length ? '<p class="fin-foot">date? ' + esc(d.unknown.join(' | ')) + '</p>' : '';
    var status = finState.loading ? '<p class="fin-foot">Refreshing...</p>' : (finState.error && finState.error !== 'nopin' ? '<p class="fin-foot">' + esc(finState.error) + '</p>' : '');

    root.innerHTML = bal + calls + chart + billsCard + incCard + txCard + unk + status +
      '<p class="fin-foot">Private: loaded with your PIN, not stored on the public site. <button type="button" class="linkish" id="fin-refresh">Refresh</button></p>';
    bindFinance();
  }

  function bindFinance() {
    var form = $('fin-pin-form');
    if (form) form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = ($('fin-pin') && $('fin-pin').value || '').trim();
      if (!v) return;
      setRelayPin(v);
      finState.error = '';
      fetchFinance(true);
    });
    document.querySelectorAll('[data-fin-range]').forEach(function (btn) {
      btn.addEventListener('click', function () { finState.range = Number(btn.getAttribute('data-fin-range')); renderFinance(); });
    });
    var rf = $('fin-refresh');
    if (rf) rf.addEventListener('click', function () { fetchFinance(true); });
  }


  // ---- v51 UI shell: design-system helpers, bottom nav + More, sticky app bar ----
  function collapsedSummaryHtml(title, net, npd, row, verdict, isCombo) {
    var why = '';
    try {
      var w = collectWhy(row, isCombo ? { combo: true } : {});
      why = (w.reasons && w.reasons[0]) || '';
    } catch (err) { why = ''; }
    var v = String(verdict || 'PASS').toLowerCase();
    return '<button type="button" class="card-summary" aria-expanded="false">' +
      '<span class="cs-main"><span class="cs-title">' + esc(title) + '</span>' +
        (why ? '<span class="cs-why">' + esc(why) + '</span>' : '') + '</span>' +
      '<span class="cs-nums"><b>' + (net != null ? esc(searchMoney(net)) : 'n/a') + '</b>' +
        (npd != null ? '<small>' + esc(searchMoney(npd)) + '/d</small>' : '') + '</span>' +
      '<span class="verdict-pill ' + esc(v) + '">' + esc(displayVerdict(verdict || 'PASS')) + '</span>' +
      '<span class="cs-chev" aria-hidden="true"></span>' +
      '</button>';
  }

  function toolFold(id, title, sub, open, body) {
    var key = 'fold_' + id;
    var isOpen = state[key] != null ? state[key] : !!open;
    if (open) isOpen = true;
    return '<details class="tool-fold" data-fold="' + esc(id) + '"' + (isOpen ? ' open' : '') + '>' +
      '<summary><span class="tf-title">' + esc(title) + '</span><span class="tf-sub">' + esc(sub || '') + '</span></summary>' +
      '<div class="tf-body">' + body + '</div></details>';
  }

  function loadingSkeletonHtml(text) {
    var card = '<div class="skel-card" aria-hidden="true"><div class="skel skel-line w60"></div>' +
      '<div class="skel-row"><div class="skel skel-block"></div><div class="skel skel-block"></div></div>' +
      '<div class="skel skel-line w80"></div></div>';
    return '<div class="loading-state" role="status" aria-live="polite"><p class="sr-only">' + esc(text || 'Loading') + '</p>' +
      card + card + card + '</div>';
  }

  function emptyStateHtml(title, sub) {
    return '<div class="empty-state" role="status">' +
      '<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="6" y="10" width="36" height="28" rx="5"/><path d="M6 18h36M16 26h16M20 32h8"/></g></svg>' +
      '<p class="empty-title">' + esc(title) + '</p>' +
      (sub ? '<p class="empty-sub">' + esc(sub) + '</p>' : '') +
      '<button type="button" class="btn btn-secondary empty-reset">Show all loads</button></div>';
  }

  function stickyTopOffset() {
    var bar = document.getElementById('appbar');
    return (bar ? bar.getBoundingClientRect().height : 0) + 8;
  }

  var NAV_PRIMARY = ['today', 'check', 'searches', 'reports'];
  var NAV_SHORT = { today: 'Today', check: 'Rate Check', searches: 'Boards', reports: 'Reports', targets: 'Targets', kpis: 'Scoreboard', fin: 'Finance', acct: 'Accounting', ins: 'Insurance', maint: 'Maint.', dot: 'DOT', tax: 'Tax', stops: 'Stops', pdfs: 'PDFs' };
  var NAV_ICON_PATHS = {
    today: '<path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
    check: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7h7M8.5 11h2M13.5 11h2M8.5 14.5h2M13.5 14.5h2M8.5 18h2M13.5 18h2"/>',
    searches: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18.5" cy="17.5" r="2.5"/>',
    reports: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 13v4M12 10v7M15 15v2"/>',
    targets: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    kpis: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    fin: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
    acct: '<path d="M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21z"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/>',
    ins: '<path d="M12 3l7 2.6v5.6c0 4.4-2.9 8-7 9.8-4.1-1.8-7-5.4-7-9.8V5.6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    maint: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    dot: '<path d="M9 4h6l1 2h3v14H5V6h3z"/><path d="M8.5 13.2l2.6 2.6 4.4-4.8"/>',
    tax: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3v4M15.5 3v4M9 14.5l2 2 4-4"/>',
    stops: '<path d="M12 21s-6.5-6.2-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    pdfs: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M12 10v7M9 14l3 3 3-3"/>',
    scoreboard: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v2a3 3 0 0 0 3 3M16 6h3v2a3 3 0 0 1-3 3M12 13v4M8.5 20h7"/>',
    more: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
    def: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>'
  };
  function navIcon(name) {
    var key = NAV_ICON_PATHS[name] ? name : (/score/i.test(name) ? 'scoreboard' : (/report|pdf/i.test(name) ? 'reports' : 'def'));
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      NAV_ICON_PATHS[key] + '</g></svg>';
  }

  function enhanceNav() {
    var nav = document.querySelector('.tabbar');
    if (!nav) return;
    nav.classList.add('bnav');
    nav.querySelectorAll('button[data-tab]').forEach(function (btn) {
      var tab = btn.getAttribute('data-tab');
      if (!btn.querySelector('.tb-ico')) {
        var full = btn.getAttribute('data-label') || btn.textContent.trim();
        btn.setAttribute('data-label', full);
        if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', full);
        btn.innerHTML = '<span class="tb-ico">' + navIcon(tab) + '</span><span class="tb-lbl">' + esc(NAV_SHORT[tab] || full) + '</span>';
      }
      btn.classList.toggle('tb-overflow', NAV_PRIMARY.indexOf(tab) < 0);
    });
    var more = document.getElementById('tab-more');
    if (!more) {
      more = document.createElement('button');
      more.type = 'button';
      more.id = 'tab-more';
      more.className = 'tb-more';
      more.setAttribute('aria-haspopup', 'dialog');
      more.setAttribute('aria-controls', 'more-sheet');
      more.setAttribute('aria-label', 'More sections');
      more.innerHTML = '<span class="tb-ico">' + navIcon('more') + '</span><span class="tb-lbl">More</span>';
      nav.appendChild(more);
    } else if (more !== nav.lastElementChild) {
      nav.appendChild(more);
    }
    updateNavActive();
  }

  function updateNavActive() {
    var more = document.getElementById('tab-more');
    if (!more) return;
    var inMore = false;
    document.querySelectorAll('.tabbar button.tb-overflow').forEach(function (btn) {
      if (btn.getAttribute('data-tab') === state.tab) inMore = true;
    });
    more.classList.toggle('is-active', inMore);
    var cur = inMore ? document.querySelector('.tabbar button[data-tab="' + state.tab + '"]') : null;
    var lbl = more.querySelector('.tb-lbl');
    if (lbl) lbl.textContent = cur ? (NAV_SHORT[state.tab] || cur.getAttribute('data-label') || 'More') : 'More';
  }

  function renderMoreSheet() {
    var box = document.getElementById('more-tabs');
    if (!box) return;
    var items = [];
    document.querySelectorAll('.tabbar button.tb-overflow[data-tab]').forEach(function (btn) {
      var tab = btn.getAttribute('data-tab');
      items.push('<button type="button" class="more-item' + (tab === state.tab ? ' is-active' : '') + '" data-goto="' + esc(tab) + '">' +
        '<span class="mi-ico">' + navIcon(tab) + '</span><span class="mi-lbl">' + esc(btn.getAttribute('data-label') || tab) + '</span></button>');
    });
    box.innerHTML = items.join('');
  }

  function openMoreSheet() {
    var sheet = document.getElementById('more-sheet');
    if (!sheet) return;
    renderMoreSheet();
    sheet.hidden = false;
    document.documentElement.classList.add('more-open');
    var more = document.getElementById('tab-more');
    if (more) more.setAttribute('aria-expanded', 'true');
    var first = sheet.querySelector('.more-item');
    if (first) { try { first.focus({ preventScroll: true }); } catch (err) { first.focus(); } }
  }

  function closeMoreSheet() {
    var sheet = document.getElementById('more-sheet');
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    document.documentElement.classList.remove('more-open');
    var more = document.getElementById('tab-more');
    if (more) more.setAttribute('aria-expanded', 'false');
  }

  function updateAppbar() {
    var txt = document.getElementById('appbar-status-text');
    var dot = document.getElementById('appbar-status');
    if (txt && dot) {
      var st = state.pullStatus || {};
      var label = 'Last pull --';
      var cls = 'idle';
      if (state.freshPullBusy || pullIsActive(st)) {
        label = 'Pulling loads...';
        cls = 'busy';
      } else {
        var stamp = state.searches && (state.searches.scanned_at || state.searches.as_of);
        var dt = stamp ? parseScanStamp(String(stamp)) : null;
        if (dt) {
          var age = Date.now() - dt.getTime();
          var h = dt.getHours();
          var hh = (h % 12 === 0 ? 12 : h % 12) + ':' + (dt.getMinutes() < 10 ? '0' : '') + dt.getMinutes() + (h >= 12 ? ' PM' : ' AM');
          label = hh + ' | ' + formatRelAge(age).replace(/ \d+m ago$/, '').replace(' ago', '');
          cls = age < 2 * 3600000 ? 'fresh' : (age < 8 * 3600000 ? 'aging' : 'stale');
        } else if (st.state === 'failed') {
          label = 'Last pull failed';
          cls = 'stale';
        }
      }
      txt.textContent = label;
      dot.setAttribute('data-state', cls);
    }
    var sw = document.getElementById('hdr-wx');
    if (sw) {
      var on = weatherOn();
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      var l = sw.querySelector('.hdr-wx-label');
      if (l) l.textContent = on ? 'WX ON' : 'WX OFF';
    }
  }

  function bindUiShell() {
    if (state.uiShellBound) return;
    state.uiShellBound = true;
    var nav = document.querySelector('.tabbar');
    if (nav) {
      nav.addEventListener('click', function (ev) {
        var btn = ev.target.closest('button');
        if (!btn || !nav.contains(btn)) return;
        if (btn.id === 'tab-more') {
          var sheet = document.getElementById('more-sheet');
          if (sheet && !sheet.hidden) closeMoreSheet(); else openMoreSheet();
          return;
        }
        var tab = btn.getAttribute('data-tab');
        if (tab) showTab(tab);
      });
      if (typeof MutationObserver === 'function') {
        new MutationObserver(function () { enhanceNav(); }).observe(nav, { childList: true });
      }
    }
    var sheet = document.getElementById('more-sheet');
    if (sheet) {
      sheet.addEventListener('click', function (ev) {
        if (ev.target.closest('.more-backdrop')) { closeMoreSheet(); return; }
        var go = ev.target.closest('[data-goto]');
        if (go) { showTab(go.getAttribute('data-goto')); return; }
        var cs = ev.target.closest('#more-callsheet');
        if (cs) { closeMoreSheet(); openCallSheet(); return; }
        var rig = ev.target.closest('#more-rig');
        if (rig) {
          showTab('check');
          var d = document.querySelector('.rig-specs-panel');
          if (d) { d.open = true; }
          var card = document.querySelector('.rig-card');
          if (card) window.scrollTo({ top: card.getBoundingClientRect().top + window.pageYOffset - stickyTopOffset(), behavior: 'smooth' });
        }
        if (ev.target.closest('#more-driver')) { closeMoreSheet(); if (window.BlackRamDriver) window.BlackRamDriver.open(); return; }
        if (ev.target.closest('#about-open')) closeMoreSheet();
      });
    }
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeMoreSheet(); });
    var home = document.getElementById('appbar-home');
    if (home) home.addEventListener('click', function () { showTab('today'); });
    var stBtn = document.getElementById('appbar-status');
    if (stBtn) stBtn.addEventListener('click', function () { showTab('searches'); });
    var sw = document.getElementById('hdr-wx');
    if (sw) sw.addEventListener('click', function () {
      state.weatherOn = !weatherOn();
      saveWeatherSwitch();
      updateAppbar();
      if (state.searches) refreshDeadheads(); else if (state.tab === 'searches') renderSearches();
    });
    document.addEventListener('click', function (ev) {
      var sum = ev.target.closest && ev.target.closest('.card-summary');
      if (sum) {
        var card = sum.parentNode;
        var collapsed = card.classList.toggle('is-collapsed');
        sum.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        if (!collapsed && typeof observeRouteMaps === 'function') { try { observeRouteMaps(card); } catch (err) { /* ignore */ } }
        return;
      }
      var reset = ev.target.closest && ev.target.closest('.empty-reset');
      if (reset) {
        state.searchFilter = 'all';
        state.hidePass = false;
        state.fitsOnly = false;
        renderSearches();
      }
    });
    document.addEventListener('toggle', function (ev) {
      var d = ev.target;
      if (d && d.classList && d.classList.contains('pass-group')) { state.passGroupOpen = d.open; return; }
      if (!d || !d.classList || !d.classList.contains('tool-fold')) return;
      state['fold_' + d.getAttribute('data-fold')] = d.open;
      if (d.open) { try { window.dispatchEvent(new Event('resize')); } catch (err) { /* ignore */ } }
    }, true);
    updateAppbar();
    window.setInterval(updateAppbar, 60000);
    if (!state.searches) { try { refreshSearches(); } catch (err) { /* ignore */ } }
    if (!state.pullStatus) { try { fetchPullStatus().then(updateAppbar); } catch (err) { /* ignore */ } }
    // v52: merge, do not replace - targets.js and scoreboard.js read getFeed/monthFigures/settings from here.
    window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { showTab: showTab, openMore: openMoreSheet, closeMore: closeMoreSheet, updateAppbar: updateAppbar });
  }

  function showTab(name) {
    if (!name) return;
    if (!$('panel-' + name)) name = 'check';
    state.tab = name;
    // Generic: every .tabbar button with data-tab="x" pairs with section#panel-x.
    // New sections (e.g. Reports PDFs, Scoreboard) only need those two pieces and
    // can listen for the 'blackram:tab' event to render.
    document.querySelectorAll('.tabbar [data-tab]').forEach(function (btn) {
      var id = btn.getAttribute('data-tab');
      var on = id === name;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      var panel = $('panel-' + id);
      if (panel) panel.hidden = !on;
    });
    document.querySelectorAll('main > section.panel[id^="panel-"]').forEach(function (panel) {
      panel.hidden = panel.id !== 'panel-' + name;
    });
    document.documentElement.setAttribute('data-tab', name);
    // v96: deep links. The URL hash names the tab (#dot, #maint ...) so a shared link or a
    // home-screen reopen lands on the same section. replaceState keeps Back from cycling tabs.
    try { if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name); } catch (err) { /* file:// */ }
    document.querySelector('.app').classList.toggle('tab-stops', name === 'stops');
    closeMoreSheet();
    updateNavActive();
    if (name === 'reports') {
      renderReports();
      refreshFeed();
    } else if (name === 'kpis') {
      renderKpis();
      refreshFeed();
    } else if (name === 'searches') {
      renderSearches();
      refreshSearches();
      fetchPullStatus().then(function () {
        if (shouldKeepPullStatusPolling()) startPullStatusPolling();
      });
    } else if (name === 'targets') {
      if (window.BlackRamTargets) window.BlackRamTargets.render();
      refreshFeed();
    } else if (name === 'fin') {
      renderFinance();
      fetchFinance(false);
    } else if (name === 'stops' && window.BlackRamStops) {
      window.BlackRamStops.show();
    }
    updateCompareBar();
    window.scrollTo(0, 0);
    try { document.dispatchEvent(new CustomEvent('blackram:tab', { detail: { tab: name } })); } catch (err) { /* old browser */ }
  }


  var CALLSHEET_NOTES_KEY = 'blackram_broker_load_notes_v1';

  /* v97: dispatch phone and email are not in the public source. They arrive in the
     PIN-gated /financials payload (data.dispatch), same session as Finance. */
  function financePayload() {
    if (finState.data) return finState.data;
    try {
      var raw = sessionStorage.getItem(FIN_SESSION_KEY);
      if (!raw || finState.error === 'wrongpin') return null;
      var d = JSON.parse(raw);
      if (d && (d.dispatch || d.account)) { finState.data = d; return d; }
    } catch (err) { /* ignore */ }
    return null;
  }

  function dispatchContact() {
    var d = financePayload();
    var c = d && d.dispatch;
    if (!c) return null;
    var phone = String(c.phone || '').trim();
    var email = String(c.email || '').trim();
    if (!phone && !email) return null;
    var tel = String(c.phone_tel || c.tel || '').trim();
    if (!tel && phone) tel = '+1' + phone.replace(/\D/g, '');
    return { phone: phone, email: email, tel: tel };
  }

  function dispatchPacketLines() {
    var c = dispatchContact();
    if (c) {
      var out = [];
      if (c.phone) out.push('Phone: ' + c.phone);
      if (c.email) out.push('Email: ' + c.email);
      return out;
    }
    return ['Phone: unlock with the app PIN', 'Email: unlock with the app PIN'];
  }

  function callSheetLockHtml(msg) {
    return '<h3 class="callsheet-h">Dispatch</h3>' +
      '<div class="callsheet-lock pin-lock" id="callsheet-dispatch-body">' +
      PIN_LOCK_ICON +
      '<p>' + esc(msg) + '</p>' +
      '<form id="callsheet-pin-form" class="fin-pin-row" autocomplete="off">' +
      '<input id="callsheet-pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="App PIN" aria-label="App PIN" />' +
      '<button type="submit" class="btn primary">Unlock</button></form>' +
      '<p class="pin-lock-note">One PIN unlocks Finance, Accounting, Daily PDFs, receipts and dispatch contact on this phone.</p></div>';
  }

  function renderCallSheetDispatch() {
    var box = $('callsheet-dispatch');
    if (!box) return;
    var c = dispatchContact();
    if (c) {
      var rows = '';
      if (c.phone) {
        rows += '<div class="callsheet-row" data-copy="' + esc(c.phone) + '"><span class="callsheet-k">Phone</span><span class="callsheet-v"><a href="tel:' + esc(c.tel || c.phone) + '">' + esc(c.phone) + '</a></span><button type="button" class="copy-btn">Copy</button></div>';
      }
      if (c.email) {
        rows += '<div class="callsheet-row callsheet-wide" data-copy="' + esc(c.email) + '"><span class="callsheet-k">Email</span><span class="callsheet-v"><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></span><button type="button" class="copy-btn">Copy</button></div>';
      }
      box.innerHTML = '<h3 class="callsheet-h">Dispatch</h3><div class="callsheet-grid">' + rows + '</div>';
      return;
    }
    var msg = 'The dispatch phone and email stay behind the app PIN, same as Finance.';
    if (finState.error === 'wrongpin') msg = 'Wrong PIN. Try again.';
    else if (finState.loading && getRelayPin()) msg = 'Loading dispatch contact...';
    else if (finState.error && finState.error !== 'nopin') msg = finState.error;
    var payload = financePayload();
    if (payload && !payload.dispatch && !finState.loading) {
      box.innerHTML = callSheetLockHtml('Dispatch contact is not on file.');
      return;
    }
    if (getRelayPin() && !payload && !finState.loading && !finState.error) {
      box.innerHTML = callSheetLockHtml('Loading dispatch contact...');
      fetchFinance(true);
      return;
    }
    if (finState.loading) msg = 'Loading dispatch contact...';
    box.innerHTML = callSheetLockHtml(msg);
    var form = $('callsheet-pin-form');
    if (form) form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var v = (($('callsheet-pin') && $('callsheet-pin').value) || '').trim();
      if (!v) return;
      setRelayPin(v);
      finState.error = '';
      fetchFinance(true);
    });
  }

  function callSheetPacket() {
    var notes = '';
    var ta = $('callsheet-notes');
    if (ta) notes = String(ta.value || '').trim();
    var lines = [
      'BLACK RAM LOGISTICS / SAND LILY PAD LLC',
      'We run under Totni Enterprise LLC authority',
      'MC 1122113    DOT 3448727',
      '',
      'INSURANCE (Totni COI dated 10/23/2026, for loads under MC 1122113)',
      'Insurer: United Financial Casualty Company (Progressive)',
      'Auto liability: $1,000,000',
      'Cargo: $100,000 ($2,500 deductible)',
      'Policy ending in 8412',
      'Request a COI: ask Claudio (producer on file is Marquee Insurance Group LLC)',
      '',
      'EQUIPMENT',
      '2026 Ram 3500 dually',
      'Big Tex 25GN-40 gooseneck',
      '40 ft deck, including about 5 ft dovetail with mega ramps',
      '102 in wide, 34 in deck height',
      'Max cargo: 12,500 lb OK; up to 15,300 lb with a scale check',
      'Tarps and straps on board',
      'No semi loads',
      '',
      'LANES',
      'Home base: Jacksonville, FL area',
      'Avoids drops at 45 F or colder overnight',
      '',
      'DISPATCH'
    ];
    dispatchPacketLines().forEach(function (line) { lines.push(line); });
    lines.push(
      '',
      'FACTORING: ask Claudio',
      'INVOICE / PAPERWORK EMAIL: ask Claudio'
    );
    if (notes) {
      lines.push('', 'LOAD NOTES', notes);
    }
    return lines.join('\n');
  }

  function copyText(text, statusEl) {
    if (!text) return Promise.resolve(false);
    function ok() {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = 'Copied';
        setTimeout(function () { statusEl.hidden = true; }, 1600);
      }
      return true;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(ok).catch(function () {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          var worked = document.execCommand('copy');
          document.body.removeChild(ta);
          return worked ? ok() : false;
        } catch (err) { return false; }
      });
    }
    try {
      var ta2 = document.createElement('textarea');
      ta2.value = text;
      ta2.setAttribute('readonly', '');
      ta2.style.position = 'fixed';
      ta2.style.left = '-9999px';
      document.body.appendChild(ta2);
      ta2.select();
      var worked2 = document.execCommand('copy');
      document.body.removeChild(ta2);
      return Promise.resolve(worked2 ? ok() : false);
    } catch (err2) {
      return Promise.resolve(false);
    }
  }

  function openCallSheet() {
    var sheet = $('callsheet');
    if (!sheet) return;
    sheet.hidden = false;
    document.documentElement.classList.add('sheet-open');
    var ta = $('callsheet-notes');
    if (ta && ta.value === '') {
      try {
        var saved = localStorage.getItem(CALLSHEET_NOTES_KEY);
        if (saved) ta.value = saved;
      } catch (err) { /* ignore */ }
    }
    renderCallSheetDispatch();
  }

  function closeCallSheet() {
    var sheet = $('callsheet');
    if (!sheet) return;
    sheet.hidden = true;
    document.documentElement.classList.remove('sheet-open');
  }

  function bindCallSheet() {
    var openBtn = $('callsheet-open');
    var closeBtn = $('callsheet-close');
    var copyAll = $('callsheet-copy-all');
    var status = $('callsheet-copy-status');
    var ta = $('callsheet-notes');
    if (openBtn) openBtn.addEventListener('click', openCallSheet);
    if (closeBtn) closeBtn.addEventListener('click', closeCallSheet);
    if (copyAll) copyAll.addEventListener('click', function () {
      copyText(callSheetPacket(), status);
    });
    if (ta) {
      try {
        var saved = localStorage.getItem(CALLSHEET_NOTES_KEY);
        if (saved) ta.value = saved;
      } catch (err) { /* ignore */ }
      ta.addEventListener('input', function () {
        try { localStorage.setItem(CALLSHEET_NOTES_KEY, ta.value); } catch (err2) { /* ignore */ }
      });
    }
    document.addEventListener('click', function (event) {
      var btn = event.target.closest('.call-sheet-btn');
      if (btn) {
        event.preventDefault();
        openCallSheet();
        return;
      }
      var copyBtn = event.target.closest('#callsheet .copy-btn');
      if (copyBtn) {
        event.preventDefault();
        var row = copyBtn.closest('.callsheet-row');
        var text = row && row.getAttribute('data-copy');
        if (text) copyText(text, status);
      }
    });
    document.addEventListener('blackram:financials', renderCallSheetDispatch);
    renderCallSheetDispatch();
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

  // ---- v91 tappable tiles: Reports, KPI and Finance drill-downs (sheet lives in tiles.js) ----
  var tileCtx = {};
  function tl() { return window.BlackRamTiles || null; }
  function tlAttrs(key, arg, label) { var T = tl(); return T ? T.attrs(key, arg, label) : ''; }
  function cityOnly(place) { // city-level only: no street lines or ZIPs in the sheets
    var t = String(place || '').replace(/\s*\([^)]*\)/g, '').split(',').pop();
    return t.replace(/\b\d{5}(-\d{4})?\b/g, '').replace(/\s+/g, ' ').trim();
  }
  function shortLane(load) {
    if (load.pickup_place || load.drop_place) return [cityOnly(load.pickup_place), cityOnly(load.drop_place)].filter(Boolean).join(' to ');
    return cityOnly(String(load.lane || '').split(/ to | \u2192 /)[0]) || String(load.desc || '');
  }
  function loadWho(load) { return [load.broker, load.load_no].filter(Boolean).join(' #'); }
  function dayShort(iso) { if (!iso) return 'date?'; var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function expenseTileRows(list) {
    return list.slice().sort(byDateDesc).map(function (row) {
      return { d: dayShort(row.date), t: esc(row.vendor || 'Expense'), s: esc(catName(row.category || 'other')) + (typeof row.gallons === 'number' ? ' | ' + plainNum(row.gallons, 2) + ' gal' : '') + (row.est ? ' | EST' : ''), v: money(row.amount) };
    });
  }
  function loadSpanDays(load, from, to) {
    var out = [];
    if (!load.date) return out;
    var end = load.delivery_date && load.delivery_date >= load.date ? load.delivery_date : load.date;
    eachDate(load.date, end, function (d) { if ((!from || d >= from) && (!to || d <= to)) out.push(d); });
    return out;
  }
  // opts: { title, sub, entries: [{load, pct}], expenses: [], mode, from, to }
  function openLoadsSheet(opts) {
    var T = tl(); if (!T) return;
    var entries = (opts.entries || []).slice().sort(function (a, b) { return byDateDesc(a.load, b.load); });
    var exps = opts.expenses || [];
    var mode = opts.mode || 'loads';
    var body = '', tot = 0, list = [];
    function base(e) { var l = e.load; return { d: dayShort(l.date), t: esc(loadWho(l) || l.desc || 'Load'), s: esc(shortLane(l)) }; }
    if (mode === 'gross' || mode === 'loads') {
      list = entries.map(function (e) { var r = base(e); var g = Number(e.load.gross) || 0; tot += g; r.v = money0(g); r.vs = e.load.loaded_mi ? plainNum(e.load.loaded_mi, 0) + ' mi' : ''; return r; });
      body = T.hero(money0(tot), entries.length + (entries.length === 1 ? ' load' : ' loads') + ' | gross') + T.rows(list, 'No loads in this period.');
    } else if (mode === 'fees') {
      list = entries.map(function (e) { var r = base(e); var f = loadFee(e.load, e.pct); tot += f; r.v = money(f); r.vs = (e.pct != null ? plainNum(e.pct, 2).replace(/\.00$/, '') + '% of ' : 'of ') + money0(e.load.gross); return r; });
      body = T.hero(money0(tot), 'Totni fees on ' + entries.length + ' loads') + T.rows(list, 'No loads in this period.') + T.fine('Fee = gross x the month fee %. ELD fees withheld by Totni are logged as expenses.');
    } else if (mode === 'fuel' || mode === 'fuelmi') {
      var fl = exps.filter(function (x) { return (x.category || 'other') === 'fuel'; });
      fl.forEach(function (x) { tot += Number(x.amount) || 0; });
      var mi = 0; entries.forEach(function (e) { mi += Number(e.load.loaded_mi) || 0; });
      body = T.hero(money0(tot), fl.length + ' fuel lines' + (mode === 'fuelmi' && mi ? ' | ' + rpm(tot / mi) + ' per loaded mi (' + plainNum(mi, 0) + ' mi)' : '')) + T.rows(expenseTileRows(fl), 'No fuel logged.');
    } else if (mode === 'other') {
      var ol = exps.filter(function (x) { return (x.category || 'other') !== 'fuel'; });
      var byc = {}; ol.forEach(function (x) { var c = x.category || 'other'; byc[c] = (byc[c] || 0) + (Number(x.amount) || 0); tot += Number(x.amount) || 0; });
      var cats = Object.keys(byc).sort(function (a, b) { return byc[b] - byc[a]; });
      body = T.hero(money0(tot), ol.length + ' expense lines, not fuel') +
        T.sec('By category') + T.rows(cats.map(function (c) { return { t: esc(catName(c)), v: money(byc[c]) }; })) +
        T.sec('Lines') + T.rows(expenseTileRows(ol), 'None logged.');
    } else if (mode === 'net' || mode === 'margin') {
      var g = 0, f = 0, fu = 0, ot = 0;
      entries.forEach(function (e) { g += Number(e.load.gross) || 0; f += loadFee(e.load, e.pct); });
      exps.forEach(function (x) { if ((x.category || 'other') === 'fuel') fu += Number(x.amount) || 0; else ot += Number(x.amount) || 0; });
      var n = g - f - fu - ot;
      body = T.hero(money0(n), mode === 'margin' && g ? (n / g * 100).toFixed(1) + '% of ' + money0(g) + ' gross' : 'Net kept, before truck, trailer and insurance bills', n < 0 ? 'bad' : 'good') +
        T.rows([
          { t: 'Gross', s: entries.length + ' loads', v: money(g), vc: 'pos' },
          { t: 'Totni fees', v: '-' + money(f).replace('-', ''), vc: 'neg' },
          { t: 'Fuel', s: exps.filter(function (x) { return x.category === 'fuel'; }).length + ' lines', v: '-' + money(fu).replace('-', ''), vc: 'neg' },
          { t: 'Other expenses', s: exps.filter(function (x) { return x.category !== 'fuel'; }).length + ' lines', v: '-' + money(ot).replace('-', ''), vc: 'neg' },
          { t: 'Net kept', v: money(n), cls: 'tl-tot', vc: n < 0 ? 'neg' : 'pos' }
        ]) +
        T.sec('Each load (net EST after fee and fuel)') +
        T.rows(entries.map(function (e) { var r = base(e); var sc = scoreLedgerLoad(e.load, e.pct); r.v = sc.netVal == null ? '--' : money0(sc.netVal); r.vc = sc.netVal < 0 ? 'neg' : ''; r.vs = 'gross ' + money0(e.load.gross); return r; }), 'No loads.') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' + T.btn('Fuel lines', 'ld-sub', 'fuel') + T.btn('Other expenses', 'ld-sub', 'other') + '</div>';
    } else if (mode === 'rpm' || mode === 'allmi') {
      var gm = 0, lm = 0, dm = 0;
      list = entries.map(function (e) {
        var r = base(e), l = e.load, m = Number(l.loaded_mi) || 0, em = ledgerEmpty(l).mi;
        gm += Number(l.gross) || 0; lm += m; dm += em || 0;
        if (mode === 'rpm') { r.v = m ? rpm((Number(l.gross) || 0) / m) : '--'; r.vs = plainNum(m, 0) + ' loaded mi'; }
        else { var all = m + (em || 0); r.v = all ? rpm((Number(l.gross) || 0) / all) : '--'; r.vs = plainNum(m, 0) + ' + ' + (em == null ? '?' : plainNum(em, 0)) + ' empty mi'; }
        return r;
      });
      var den = mode === 'rpm' ? lm : lm + dm;
      body = T.hero(den ? rpm(gm / den) : '--', money0(gm) + ' gross / ' + plainNum(den, 0) + (mode === 'rpm' ? ' loaded mi' : ' all miles')) + T.rows(list, 'No loads.');
    } else if (mode === 'dead') {
      var lm2 = 0, dm2 = 0;
      list = entries.map(function (e) {
        var r = base(e), em = ledgerEmpty(e.load);
        lm2 += Number(e.load.loaded_mi) || 0; dm2 += em.mi || 0;
        r.v = em.mi == null ? '?' : plainNum(em.mi, 0) + ' mi';
        r.vs = em.from ? 'from ' + esc(em.from) : (e.load.deadhead_mi != null ? 'logged' : 'EST');
        return r;
      });
      body = T.hero(lm2 + dm2 ? (dm2 / (lm2 + dm2) * 100).toFixed(1) + '%' : '--', plainNum(dm2, 0) + ' empty mi of ' + plainNum(lm2 + dm2, 0) + ' total') + T.rows(list, 'No loads.') +
        T.fine('Empty miles are the logged deadhead, or the EST from the previous drop or home.');
    } else if (mode === 'util' || mode === 'idle') {
      var from = opts.from, to = opts.to, seen = {};
      list = entries.map(function (e) {
        var r = base(e), ds = loadSpanDays(e.load, from, to);
        ds.forEach(function (d) { seen[d] = true; });
        r.v = ds.length + (ds.length === 1 ? ' day' : ' days'); r.vs = ds.length ? dayShort(ds[0]) + (ds.length > 1 ? '-' + dayShort(ds[ds.length - 1]) : '') : 'outside range';
        return r;
      });
      var runs = [], cur = null, total = 0;
      if (from && to) eachDate(from, to, function (d) {
        total++;
        if (seen[d]) { cur = null; return; }
        if (cur) { cur.end = d; cur.n++; } else { cur = { start: d, end: d, n: 1 }; runs.push(cur); }
      });
      var used = Object.keys(seen).length;
      body = T.hero(used + ' of ' + total + ' days', 'days with a load (' + (total ? Math.round(used / total * 100) : 0) + '%) | ' + (total - used) + ' idle') +
        T.sec('Idle stretches') + T.rows(runs.reverse().map(function (r) { return { d: dayShort(r.start), t: r.n === 1 ? dayShort(r.start) : dayShort(r.start) + ' - ' + dayShort(r.end), v: r.n + (r.n === 1 ? ' day' : ' days'), vc: r.n >= 3 ? 'warn' : '' }; }), 'No idle days.') +
        T.sec('Loaded days') + T.rows(list, 'No loads.');
    } else if (mode === 'netday') {
      var netT = 0, dayT = {};
      list = entries.map(function (e) {
        var r = base(e), sc = scoreLedgerLoad(e.load, e.pct);
        netT += sc.netVal || 0; loadSpanDays(e.load, opts.from, opts.to).forEach(function (d) { dayT[d] = true; });
        r.v = sc.netPerDay == null ? '--' : money0(sc.netPerDay) + '/d'; r.vs = (sc.days || 1) + 'd | net ' + money0(sc.netVal); return r;
      });
      body = T.hero(opts.headline || '--', opts.headSub || '') + T.rows(list, 'No loads.') + T.fine('Per load: net EST after fee and fuel / days on the load.');
    } else if (mode === 'ontime') {
      list = entries.filter(function (e) { return e.load.delivered_date && e.load.delivery_date; }).map(function (e) {
        var r = base(e), ok = e.load.delivered_date <= e.load.delivery_date;
        r.v = ok ? 'On time' : 'Late'; r.vc = ok ? 'pos' : 'neg'; r.vs = 'due ' + dayShort(e.load.delivery_date) + ', dropped ' + dayShort(e.load.delivered_date); return r;
      });
      body = T.rows(list, 'No loads with a logged delivered date yet.') + T.fine('Drop date vs the rate con delivery date. Pickup times are not logged yet.');
    } else if (mode === 'collected' || mode === 'owed') {
      var sum = 0;
      list = [];
      entries.forEach(function (e) {
        var l = withResolvedStatus(e.load), due = Number(l.net_due), got = Number(l.net_received) || 0;
        if (!isFinite(due)) return;
        var r = base(e);
        if (mode === 'collected') { if (!got) return; sum += got; r.v = money(got); r.vs = l.received_date ? 'paid ' + dayShort(l.received_date) : 'paid'; if (l.net_received_est) r.vs += ' | EST share'; }
        else { if (due - got <= 0.004) return; sum += due - got; r.v = money(due - got); r.vs = (got ? 'short' : 'unpaid') + (l.net_due_est ? ' | EST' : ''); r.vc = 'warn'; }
        list.push(r);
      });
      body = T.hero(money(sum), mode === 'collected' ? 'settlements received' : 'still owed by Totni') + T.rows(list, mode === 'owed' ? 'Nothing owed.' : 'Nothing collected yet.');
    }
    tileCtx.lastSheet = opts;
    T.open({ title: opts.title, sub: opts.sub ? esc(opts.sub) : '', body: body });
  }
  function ctxOpen(scope, mode, title) {
    var c = tileCtx[scope]; if (!c) return;
    openLoadsSheet({ title: title, sub: c.label, entries: c.entries, expenses: c.expenses, mode: mode, from: c.from, to: c.to, headline: c.headline && c.headline[mode], headSub: c.headSub && c.headSub[mode] });
  }
  var LD_TITLES = { gross: 'Gross', fees: 'Totni fees', fuel: 'Fuel', other: 'Other expenses', net: 'Net kept', rpm: '$ / loaded mile', loads: 'Loads hauled', collected: 'Collected', owed: 'Still owed', allmi: 'Revenue / all-miles', dead: 'Deadhead', lpw: 'Loads per week', util: 'Truck utilization', margin: 'Net margin', fuelmi: 'Fuel per loaded mile' };
  function initTiles() {
    var T = tl(); if (!T) return;
    T.on('rp', function (mode) { ctxOpen('reports', mode, LD_TITLES[mode] || 'Details'); });
    T.on('kp', function (mode) { ctxOpen('kpis', mode === 'lpw' ? 'loads' : mode, LD_TITLES[mode] || 'Details'); });
    T.on('ld-sub', function (mode) { var o = tileCtx.lastSheet; if (!o) return; openLoadsSheet(Object.assign({}, o, { mode: mode, title: LD_TITLES[mode] || o.title })); });
    T.on('rp-jump', function (id) { T.jump(id); });
    T.on('fin', finTile);
  }
  function finTile(arg) {
    var T = tl(), d = finState.data; if (!T || !d) return;
    var p = String(arg || '').split(':'), k = p[0], id = p.slice(1).join(':');
    var today = String(d.as_of).slice(0, 10);
    if (k === 'bal') {
      var tx = (d.transactions || []).map(function (t) { return { d: dayShort(t.date), t: esc(t.desc), s: 'balance ' + finMoney(t.balance, true), v: (t.amount >= 0 ? '+' : '') + finMoney(t.amount, true), vc: t.amount >= 0 ? 'pos' : 'neg' }; });
      T.open({ title: 'Bluevine ...' + esc((d.account || {}).last4), sub: 'Available ' + finMoney((d.account || {}).available, true) + ' | as of ' + esc(finAsOfText(d.as_of)),
        body: T.sec('Latest transactions') + T.rows(tx, 'No transactions.') + T.sec('Next scheduled bills') + finEventsRows(d, null) });
    } else if (k === 'owed') {
      T.jump('fin-income');
    } else if (k === 'bills') {
      T.jump('fin-bills');
    } else if (k === 'proj') {
      var c = (d.callouts || [])[Number(id)] || {};
      T.open({ title: c.text || 'Cash projection', sub: 'Bills only, no new loads', body: T.hero(finMoney(d.projection.start, true), 'starting balance', 'good') + finEventsRows(d, null) +
        T.fine(esc(d.projection.if_paid_note || '') + ' Money coming in: ' + finMoney(d.income_pending_total, true) + ', not counted until it lands.') });
    } else if (k === 'bill') {
      var b = (d.bills || []).filter(function (x) { return x.id === id; })[0]; if (!b) return;
      var dd = b.next ? finDaysFrom(b.next, today) : null;
      T.open({ title: b.payee, sub: esc(b.freq || ''), body:
        T.kv([['Amount', b.amount == null ? esc(b.amount_text || 'amount?') : finMoney(b.amount, true)], ['Next', b.next ? finDay(b.next) + (dd != null ? ' (' + (dd === 0 ? 'today' : dd > 0 ? 'in ' + dd + 'd' : -dd + 'd late') + ')' : '') : 'date?'],
          ['Paid from', esc(b.from || '--'), 'wide'], ['Status', esc(String(b.status || '--').toUpperCase())], ['Hits the bank', b.hits_bank ? 'Yes' : 'No']].concat(b.left ? [['Left', esc(b.left), 'wide']] : [])) +
        ((b.dates || []).length ? T.sec('Schedule') + T.rows(b.dates.map(function (x) { return { d: dayShort(x[0]), t: finDay(x[0]), v: finMoney(x[1], true), vc: 'neg' }; })) : '') +
        ((b.paid_note || b.note) ? T.fine(esc([b.paid_note, b.note].filter(Boolean).join(' | '))) : '') });
    } else if (k === 'inc') {
      var i = (d.income || []).filter(function (x) { return String(x.id) === id; })[0]; if (!i) return;
      var since = i.delivered ? finDaysFrom(today, i.delivered) : null;
      T.open({ title: i.payer, sub: 'Net via ' + esc(i.via), body: T.hero('+' + finMoney(i.amount, true), esc(String(i.status || '').toUpperCase()), 'good') +
        T.kv([['Delivered', finDay(i.delivered) + (since != null ? ' (' + since + 'd ago)' : '')], ['Expected', i.expected ? finDay(i.expected) : 'date?']]) +
        T.fine('Owed by Totni after the 13% fee. Lands in Bluevine through ' + esc(i.via) + '.') });
    }
  }
  function finEventsRows(d, until) {
    var T = tl(), bal = d.projection.start;
    var ev = (d.projection.events || []).filter(function (e) { return !until || e.date <= until; }).map(function (e) {
      bal += e.amount;
      return { d: dayShort(e.date), t: esc(e.label), s: 'balance after ' + finMoney(bal, true), v: finMoney(e.amount, true), vc: e.amount < 0 ? 'neg' : 'pos', cls: bal < 0 ? 'tl-neg' : '' };
    });
    return T.rows(ev, 'Nothing scheduled.');
  }

  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, {
    isUshipBid: isUshipBid,
    ledgerEmpty: ledgerEmpty,
    openLoadsSheet: openLoadsSheet,
    getFeed: function () { return state.feed; },
    settings: settings,
    monthFigures: monthFigures,
    utilizedDays: utilizedDays,
    fuelModel: function () { return rateCheckFuel(null); },
    fuelUsedText: fuelUsedText,
    monthlyBills: monthlyBills,
    withResolvedStatus: withResolvedStatus,
    scoreLedgerLoad: function (l, pct) { return scoreLedgerLoad(l, pct); },
    openDeliverSheet: openDeliverSheet,
    canMarkDelivered: function (l) { return canMarkDelivered(l); },
    loadId: loadId,
    isOffline: function () { return !!state.offline; },
    getScored: function () { return state.scoredSearches; },
    openCallSheet: function () { openCallSheet(); },
    skeleton: function (t) { return loadingSkeletonHtml(t); }
  });

  function init() {
    initTiles();
    loadSettings();
    loadView();
    loadSearchPrefs();
    loadWeatherSwitch();
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
    bindCallSheet();
    bindComboJumps();
    enhanceNav();
    bindUiShell();
    bindRateCheck();
    setupPull();
    bindDeliverSheet();
    bindCompareSheet();
    recallTruckAt();
    watchTabbar();
    bindRigPhoto();
    bindRigDiagram();
    loadDieselPrices();
    var ver = $('app-version');
    if (ver) ver.textContent = APP_VERSION;
    var sSave = $('settings-relay-save');
    var sClear = $('settings-relay-clear');
    var sPin = $('settings-relay-pin');
    if (sSave) sSave.addEventListener('click', function () {
      var v = sPin ? String(sPin.value || '').trim() : '';
      if (!v) {
        var sst = $('settings-relay-status');
        if (sst) { sst.textContent = 'Type your PIN first.'; sst.className = 'relay-connect-status err'; }
        return;
      }
      setRelayPin(v);
      if (sPin) sPin.value = '';
      if (state.tab === 'searches') renderSearches();
      flushDeliveredOutbox();
    });
    if (sClear) sClear.addEventListener('click', function () {
      setRelayPin('');
      if (sPin) sPin.value = '';
      if (state.tab === 'searches') renderSearches();
    });
    syncSettingsRelayUI();
    // v96: land on Today unless the URL names a tab (#check, #dot ...).
    var startTab = String(location.hash || '').replace(/^#/, '');
    showTab($('panel-' + startTab) ? startTab : 'today');
    window.addEventListener('hashchange', function () {
      var h = String(location.hash || '').replace(/^#/, '');
      if (h && h !== state.tab && $('panel-' + h)) showTab(h);
    });
    window.addEventListener('online', function () { flushDeliveredOutbox(); });
    renderCheck();
    refreshFeed();
    refreshSearches();
    flushDeliveredOutbox();
    fetchPullStatus().then(function () {
      if (shouldKeepPullStatusPolling()) startPullStatusPolling();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        refreshSearches();
        flushDeliveredOutbox();
        fetchPullStatus().then(function () {
          if (shouldKeepPullStatusPolling()) startPullStatusPolling();
        });
      }
    });
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
    getSearches: function () { return state.searches; },
    getScored: function () { return state.scoredSearches; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
