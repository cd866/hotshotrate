(function () {
  'use strict';

  var SETTINGS_KEY = 'blackram_settings_v1';
  var FEED_CACHE_KEY = 'blackram_feed_cache_v1';
  var SPLASH_KEY = 'blackram_splash_seen';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var state = {
    tab: 'check',
    tarp: false,
    feed: null,
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
    return {
      feePct: n('feePct', 13),
      floor: n('floor', 2.4),
      takeAt: n('takeAt', 3),
      trailer: n('trailer', 434.84),
      insurance: n('insurance', 0),
      otherFixed: n('otherFixed', 0),
      mpg: n('mpg', 9),
      diesel: n('diesel', 3.85),
      capacity: n('capacity', 15000),
      assumedMph: mph > 0 ? mph : 50
    };
  }

  function saveSettings() {
    var ids = ['feePct', 'floor', 'takeAt', 'trailer', 'insurance', 'otherFixed', 'mpg', 'diesel', 'capacity', 'assumedMph'];
    var data = {};
    ids.forEach(function (id) { data[id] = $(id).value; });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch (err) { /* private mode */ }
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      Object.keys(data).forEach(function (id) {
        if ($(id) && data[id] != null) $(id).value = data[id];
      });
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
    var hoursIn = fieldNum('hours');
    var loadedMi = loadedIn == null ? 0 : Math.max(0, loadedIn);
    var deadMi = deadIn == null ? 0 : Math.max(0, deadIn);
    var totalMi = loadedMi + deadMi;
    var rate = rateIn == null ? 0 : Math.max(0, rateIn);
    var ready = rateIn != null && totalMi > 0;
    var fee = roundMoney(rate * s.feePct / 100);
    var mpg = s.mpg;
    var fuelKnown = mpg > 0;
    var gallons = fuelKnown ? totalMi / mpg : null;
    var fuel = fuelKnown ? roundMoney(gallons * s.diesel) : null;
    var net = fuel == null ? null : roundMoney(rate - fee - fuel);
    var hoursEst = !(hoursIn != null && hoursIn > 0);
    var hours = hoursEst ? (s.assumedMph > 0 ? totalMi / s.assumedMph : null) : hoursIn;
    var netHour = net != null && hours ? net / hours : null;
    var allRpm = totalMi > 0 ? rate / totalMi : null;
    var loadedRpm = loadedMi > 0 ? rate / loadedMi : null;
    var verdict = 'idle';
    if (ready && allRpm != null) {
      if (allRpm < s.floor) verdict = 'pass';
      else if (allRpm < s.takeAt) verdict = 'negotiate';
      else verdict = 'take';
    }
    var over = weight != null && weight > s.capacity;
    return {
      ready: ready,
      rate: rate,
      loadedMi: loadedMi,
      deadMi: deadMi,
      totalMi: totalMi,
      weight: weight,
      fee: fee,
      gallons: gallons,
      fuel: fuel,
      fuelKnown: fuelKnown,
      net: net,
      hours: hours,
      hoursEst: hoursEst,
      netHour: netHour,
      allRpm: allRpm,
      loadedRpm: loadedRpm,
      verdict: verdict,
      over: over,
      settings: s,
      pickup: fieldText('pickup'),
      delivery: fieldText('delivery')
    };
  }

  function verdictCopy(result) {
    var s = result.settings;
    var floor = '$' + s.floor.toFixed(2);
    var take = '$' + s.takeAt.toFixed(2);
    if (!result.ready) {
      return {
        label: 'READY',
        msg: 'Enter the rate plus loaded miles, deadhead, or both.',
        meta: 'Under ' + floor + '/mi all-miles is PASS. Up to the ' + take + ' take line is NEGOTIATE.'
      };
    }
    var rpmText = rpm(result.allRpm);
    var msg;
    if (result.verdict === 'pass') {
      msg = 'All-miles ' + rpmText + ' is under the ' + floor + ' floor.';
    } else if (result.verdict === 'negotiate') {
      msg = 'All-miles ' + rpmText + ' clears the ' + floor + ' floor and sits under the ' + take + ' take line.';
    } else {
      msg = 'All-miles ' + rpmText + ' clears the ' + take + ' take line.';
    }
    var bits = [];
    if (result.pickup || result.delivery) {
      bits.push((result.pickup || 'Pickup') + ' → ' + (result.delivery || 'Delivery'));
    }
    if (state.tarp) bits.push('Tarp required.');
    if (!result.fuelKnown) bits.push('Set MPG to estimate fuel.');
    return {
      label: result.verdict === 'take' ? 'TAKE IT' : (result.verdict === 'negotiate' ? 'NEGOTIATE' : 'PASS'),
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
    if (result.over) {
      warn.hidden = false;
      warn.textContent = 'Over deck capacity. This gooseneck is about ' +
        plainNum(result.settings.capacity, 0) + ' lb. Confirm before you haul it.';
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

    $('metrics').innerHTML =
      metric(result.ready ? rpm(result.allRpm) : '—', 'All-miles', 'Deadhead counts toward the floor') +
      metric(result.ready && result.loadedMi > 0 ? rpm(result.loadedRpm) : '—', 'Loaded', result.loadedMi > 0 ? plainNum(result.loadedMi, 2) + ' loaded mi' : 'No loaded miles yet') +
      metric(result.ready ? money(result.fee) : '—', 'Totni fee', plainNum(s.feePct, 2).replace(/\.00$/, '') + '% of the rate') +
      metric(fuelValue, 'Fuel', fuelSub) +
      metric(result.ready && result.net != null ? money(result.net) : '—', 'Net kept', 'Rate minus fee and est. fuel') +
      metric(result.ready && result.netHour != null ? money(result.netHour) : '—', 'Net per hour', hourSub);

    var insFlag = $('ins-flag');
    insFlag.hidden = s.insurance > 0;
    var brief = plainNum(s.feePct, 2).replace(/\.00$/, '') + '% · floor $' + s.floor.toFixed(2);
    if (s.insurance <= 0) brief += ' · insurance not set';
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
    ['rate', 'loaded', 'deadhead', 'weight', 'pickup', 'delivery', 'hours'].forEach(function (id) {
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
    if (state.offline) text += ' · offline copy';
    return text;
  }

  function catName(cat) {
    if (cat === 'fuel') return 'Fuel';
    if (cat === 'def') return 'DEF';
    if (cat === 'equipment') return 'Equipment';
    if (cat === 'scale') return 'Scale';
    return cat;
  }

  function renderReports() {
    var root = $('reports-root');
    var feed = state.feed;
    var month = feed ? latestMonth(feed) : null;
    var head = '<div id="pull" class="pull">Pull to refresh</div>' +
      '<div class="status"><p id="feed-status-text">' + esc(feed ? statusLine(feed) : (state.error || 'Loading the month…')) +
      '</p><button type="button" class="btn" id="refresh-btn">Refresh</button></div>';
    if (!month) {
      root.innerHTML = head + (state.error ? '<p class="offline">' + esc(state.error) + '</p>' : '');
      bindRefresh();
      return;
    }
    if (state.offline) head += '<p class="offline">Showing the saved copy. Pull down or tap refresh when you have service.</p>';
    var fig = monthFigures(month);
    var asOf = month.as_of || monthEnd(month.month);
    var cats = Object.keys(fig.byCat).filter(function (cat) { return cat !== 'fuel'; });
    cats.sort(function (a, b) { return fig.byCat[b] - fig.byCat[a]; });
    var breakout = cats.map(function (cat) {
      return esc(catName(cat)) + ' ' + money(fig.byCat[cat]);
    }).join(' · ');

    var loads = fig.loads.map(function (load) {
      var gross = isFinite(Number(load.gross)) ? Number(load.gross) : 0;
      var fee = loadFee(load, fig.feePct);
      var miles = isFinite(Number(load.loaded_mi)) ? Number(load.loaded_mi) : null;
      var when = formatDay(load.date);
      if (load.delivery_date && load.delivery_date !== load.date) {
        var end = formatDay(load.delivery_date);
        when = formatDay(load.date).split(' ')[0] === end.split(' ')[0]
          ? formatDay(load.date) + '–' + end.split(' ')[1]
          : formatDay(load.date) + ' – ' + end;
      }
      var mileCell = miles == null ? '—' : plainNum(miles, 2) + (load.miles_estimate ? ' <span class="est">EST</span>' : '');
      var who = [load.broker, load.load_no].filter(Boolean).join(' · ');
      return '<article class="load"><h3>' + esc(load.desc || 'Load') + '</h3>' +
        '<p class="lane">' + esc(when) + (load.lane ? ' · ' + esc(load.lane) : '') + '</p>' +
        '<div class="kv">' +
        '<div><span>Gross</span><b>' + money(gross) + '</b></div>' +
        '<div><span>Miles</span><b>' + mileCell + '</b></div>' +
        '<div><span>$/mi</span><b>' + (miles ? rpm(gross / miles) : '—') + '</b></div>' +
        '<div><span>Net</span><b>' + money(roundMoney(gross - fee)) + '</b></div>' +
        '</div><p class="notes">Fee ' + money(fee) +
        (who ? ' · ' + esc(who) : '') +
        (typeof load.weight_lb === 'number' ? ' · ' + plainNum(load.weight_lb, 0) + ' lb' : '') +
        (load.notes ? '<br>' + esc(load.notes) : '') + '</p></article>';
    }).join('');

    var cancelled = (month.cancelled || []).map(function (row) {
      return '<article class="note cancel"><time>' + esc(formatDay(row.date)) + '</time>' +
        '<h3>' + esc(row.status || 'Cancelled') + '</h3>' +
        '<p>' + esc([row.broker, row.load_no].filter(Boolean).join(' · ')) +
        (row.tonu ? ' ' + esc(row.tonu) : '') +
        (row.deadhead_fuel ? ' Deadhead fuel ' + money(row.deadhead_fuel) + ' is already in the fuel total.' : '') +
        (row.notes ? ' ' + esc(row.notes) : '') + '</p></article>';
    }).join('');

    var notes = (month.day_notes || []).map(function (row) {
      return '<article class="note"><time>' + esc(formatDay(row.date)) + '</time><p>' + esc(row.text) + '</p></article>';
    }).join('');

    var expenses = (month.expenses || []).map(function (row) {
      return '<div class="exp"><div>' + esc(row.vendor || 'Expense') +
        '<span>' + esc(formatDay(row.date)) + ' · ' + esc(catName(row.category || 'other')) +
        (row.deadhead_for ? ' · cancelled-load deadhead' : '') +
        (typeof row.gallons === 'number' ? ' · ' + plainNum(row.gallons, 2) + ' gal' : '') +
        '</span></div><b>' + money(row.amount) + '</b></div>';
    }).join('');

    root.innerHTML = head +
      '<section class="big"><div class="kicker">' + esc(monthTitle(month.month)) + ' gross, month to date</div>' +
      '<span class="n">' + money(fig.gross) + '</span>' +
      '<p class="sub">Through ' + esc(formatDay(asOf)) + ' · ' + fig.loads.length + ' loads · net ' + money(fig.net) + '</p></section>' +
      '<div class="stats">' +
      metric(money(fig.fees), 'Totni fees', plainNum(fig.feePct, 2).replace(/\.00$/, '') + '% of gross') +
      metric(money(fig.fuel), 'Fuel', 'DEF and other costs are separate') +
      metric(money(fig.other), 'Other expenses', breakout || 'None logged') +
      metric(money(fig.net), 'Net kept', 'Gross − fee − fuel − other') +
      metric(fig.perLoaded == null ? '—' : rpm(fig.perLoaded), '$ / loaded mile', plainNum(fig.loadedMi, 2) + ' loaded mi') +
      metric(String(fig.loads.length), 'Loads hauled', 'Cancelled loads are listed below') +
      '</div>' +
      '<p class="fine">Load net below is after the Totni fee only. Fuel is totaled for the month, not split onto each load.</p>' +
      '<h2 class="sec">Loads</h2>' +
      (loads || '<p class="fine">No loads this month.</p>') +
      '<h2 class="sec">Cancelled</h2>' +
      (cancelled || '<p class="fine">No cancelled loads.</p>') +
      '<h2 class="sec">Day notes</h2>' +
      (notes || '<p class="fine">No day notes.</p>') +
      '<details class="expenses"><summary>Expense lines</summary>' + expenses + '</details>';
    bindRefresh();
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

  function renderKpis() {
    var root = $('kpis-root');
    var feed = state.feed;
    var month = feed ? latestMonth(feed) : null;
    if (!month) {
      root.innerHTML = '<p class="fine">' + esc(state.error || 'Loading KPIs…') + '</p>';
      return;
    }
    var fig = monthFigures(month);
    var s = settings();
    var asOf = month.as_of && month.as_of.slice(0, 7) === month.month ? month.as_of : monthEnd(month.month);
    var periodStart = month.month + '-01';
    var days = daysInclusive(periodStart, asOf);
    var used = utilizedDays(month, asOf);
    var fixed = roundMoney(s.trailer + s.insurance + s.otherFixed);
    var weeks = days > 0 ? days / 7 : 0;
    var loadsPerWeek = weeks > 0 ? fig.loads.length / weeks : null;
    var margin = fig.gross > 0 ? fig.net / fig.gross : null;
    var fuelPer = fig.loadedMi > 0 ? fig.fuel / fig.loadedMi : null;
    var allMiles = fig.deadMi == null ? null : fig.loadedMi + fig.deadMi;
    var deadPct = allMiles ? fig.deadMi / allMiles : null;
    var perAll = allMiles ? fig.gross / allMiles : null;

    var be;
    if (fixed <= 0) {
      be = need('Break-even', 'Set the trailer payment or insurance on Load check. Fixed costs are $0, so there is no monthly target yet.');
    } else {
      var ratio = fig.net / fixed;
      var width = Math.max(0, Math.min(100, ratio * 100));
      var headline = ratio >= 1 ? 'Past break-even' : money(roundMoney(fixed - fig.net)) + ' still to cover';
      var ins = s.insurance <= 0
        ? '<p class="fine">Insurance is $0 <span class="flag">Set this</span>. This target is the trailer payment until insurance is entered, so break-even is understated.</p>'
        : '';
      be = '<section class="big"><div class="kicker">Break-even · ' + esc(monthTitle(month.month)) + '</div>' +
        '<span class="n phrase">' + esc(headline) + '</span>' +
        '<p class="sub">' + money(fig.net) + ' net vs ' + money(fixed) + ' fixed (' +
        Math.round(ratio * 100) + '%). Trailer ' + money(s.trailer) + ' + insurance ' + money(s.insurance) +
        ' + other ' + money(s.otherFixed) + '.</p>' +
        '<div class="track" role="meter" aria-label="Progress toward monthly break-even" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' +
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
      metric(loadsPerWeek == null ? '—' : loadsPerWeek.toFixed(1), 'Loads per week', fig.loads.length + ' loads / ' + days + ' days') +
      metric(days ? Math.round(used / days * 100) + '%' : '—', 'Truck utilization', used + ' days with a load of ' + days) +
      metric(margin == null ? '—' : (margin * 100).toFixed(1) + '%', 'Net margin', money(fig.net) + ' of ' + money(fig.gross)) +
      metric(fuelPer == null ? '—' : rpm(fuelPer), 'Fuel per loaded mile', fig.deadMi == null ? 'All-miles fuel rate needs deadhead' : 'Loaded miles only in this label') +
      metric(money(fig.fees), 'Totni fees paid', plainNum(fig.feePct, 2).replace(/\.00$/, '') + '% · through ' + formatDay(asOf));

    var weeksData = weekRows(month);
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
        need('Not enough data', monthTitle(month.month) + ' is the only month in the feed. The next monthly update adds this comparison.');
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

    root.innerHTML =
      '<p class="fine" id="kpi-stamp">' + esc(statusLine(feed)) + ' · ' + esc(monthTitle(month.month)) +
      ' through ' + esc(formatDay(asOf)) + '</p>' +
      be + '<div class="stats">' + cards + '</div>' + wow + mom;
  }

  function showTab(name) {
    state.tab = name;
    ['check', 'reports', 'kpis'].forEach(function (id) {
      var on = id === name;
      $('tab-' + id).setAttribute('aria-selected', on ? 'true' : 'false');
      $('panel-' + id).hidden = !on;
    });
    if (name === 'reports') {
      renderReports();
      refreshFeed();
    } else if (name === 'kpis') {
      renderKpis();
      refreshFeed();
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
      var el = $('pull');
      if (!el) return;
      el.style.height = px + 'px';
      el.textContent = text || 'Pull to refresh';
    }

    document.addEventListener('touchstart', function (event) {
      if (state.tab !== 'reports') return;
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
      if (pulling && dy > 70 && state.tab === 'reports') refreshFeed();
      pulling = false;
      dy = 0;
      indicator(0);
    });
  }

  function init() {
    loadSettings();
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
  }

  window.BlackRam = {
    compute: compute,
    settings: settings,
    refreshFeed: refreshFeed,
    monthFigures: monthFigures,
    latestMonth: latestMonth,
    showTab: showTab
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
