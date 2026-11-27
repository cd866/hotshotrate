/* Black Ram Logistics - appbar weather chip (v105).
   Shows current weather for the truck's city next to the last-pull time. Tap for a small
   sheet: today's high/low, wind, rain chance, overnight low with the 45 F cold note.
   Truck city (city level only, never GPS or a street address), best source first:
     1. load in transit  -> its drop city ("en route")
     2. load booked      -> last delivered drop (the truck is still there until pickup)
     3. last delivered load's drop city
     4. base: Jacksonville, FL
   Coordinates are a city centroid (rounded to 2 decimals). Weather is Open-Meteo, fetched
   from the phone (no key), cached 30 min in localStorage. The service worker ignores
   cross-origin requests, so Open-Meteo is never cached there. Offline: "WX n/a".
   Icons: one function, iconFor(code, isDay). If the animated set is on the page
   (window.BlackRamWx.iconHtml from wxicons.js, or window.BlackRamWxIcons.iconFor) it is used
   instead of the built-in static icons. Plain ASCII. */
(function () {
  'use strict';
  var TTL = 30 * 60 * 1000;      /* fresh for 30 min */
  var STALE_MAX = 6 * 3600000;   /* show an older copy offline, labeled, up to 6 h */
  var KEY = 'blackram_wxbar_v1';
  var GEO_KEY = 'blackram_wxgeo_v1';
  var COLD_F = 45;
  var BASE = { city: 'Jacksonville, FL', lat: 30.33, lon: -81.66, src: 'base' };
  var STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
  var STATE_NAME = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  var NOISE = /^(UR|Equipment|EquipmentShare|Containers|Cargo|Rentals|Yard|Mfg|Supply|Elec|Taller|Technologies|STT|Tag|Near|BUILTEC|Stribling|Con|Global|United)$/;
  /* City centroids (2 decimals) for cities on our lanes. Others use the Open-Meteo geocoder. */
  var CITY = {
    'jacksonville, fl': [30.33, -81.66], 'graceville, fl': [30.96, -85.52], 'tallahassee, fl': [30.44, -84.28],
    'pensacola, fl': [30.42, -87.22], 'medley, fl': [25.84, -80.33], 'panama city beach, fl': [30.18, -85.81],
    'fernandina beach, fl': [30.67, -81.46], 'port wentworth, ga': [32.15, -81.17], 'albany, ga': [31.58, -84.16],
    'pooler, ga': [32.12, -81.25], 'chattanooga, tn': [35.05, -85.31], 'memphis, tn': [35.15, -90.05],
    'southaven, ms': [34.99, -90.01], 'springfield, mo': [37.21, -93.29], 'kansas city, mo': [39.10, -94.58],
    'trenton, tx': [33.43, -96.34], 'houston, tx': [29.76, -95.37], 'orlando, fl': [28.54, -81.38],
    'tampa, fl': [27.95, -82.46], 'miami, fl': [25.76, -80.19], 'savannah, ga': [32.08, -81.09],
    'atlanta, ga': [33.75, -84.39], 'dallas, tx': [32.78, -96.80], 'birmingham, al': [33.52, -86.80],
    'mobile, al': [30.69, -88.04], 'new orleans, la': [29.95, -90.07], 'nashville, tn': [36.16, -86.78]
  };
  var st = { loc: null, wx: null, busy: false, timer: null, open: false };

  function $(id) { return document.getElementById(id); }
  function A() { return window.BlackRamApp || {}; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ascii(v) { return String(v == null ? '' : v).replace(/\u2192/g, 'to').replace(/[\u2013\u2014\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x00-\x7F]/g, ''); }
  function rd(n) { return Math.round(Number(n)); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  function wxRulesOn() { try { return localStorage.getItem('blackram_weather_on_v1') !== 'off'; } catch (e) { return true; } }

  /* ---------- truck city ---------- */
  /* City and state only, never a street address. */
  function cityOf(s) {
    s = ascii(s);
    var paren = s.match(/\(([^)]*)\)/);
    var parts = [];
    if (paren) parts.push(paren[1]);
    parts.push(s.replace(/\([^)]*\)/g, ' '));
    var re = new RegExp('(?:^|[ ,])([A-Za-z.\' ]+?)[ ,]+(' + STATES + ')(?:\\s+\\d{5})?\\s*$');
    for (var i = 0; i < parts.length; i++) {
      var segs = parts[i].split(',');
      for (var j = segs.length - 1; j >= 0; j--) {
        var m = segs[j].trim().match(re);
        if (m) {
          var w = m[1].trim().split(/\s+/).filter(function (x) { return !/\d/.test(x); });
          while (w.length > 1 && NOISE.test(w[0])) w.shift();
          if (w.length > 3) w = w.slice(-3);
          if (w.length && !NOISE.test(w[w.length - 1])) return { name: w.join(' '), st: m[2] };
        }
      }
    }
    return null;
  }
  function resolved(l) { var a = A(); return a.withResolvedStatus ? a.withResolvedStatus(l) : l; }
  function dropDate(l) { return String(l.delivered_date || l.delivery_date || l.date || '').slice(0, 10); }
  function pickCity() {
    var f = A().getFeed ? A().getFeed() : null;
    if (!f) return null;
    var all = [];
    (f.months || []).forEach(function (m) { (m.loads || []).forEach(function (l) { all.push(resolved(l)); }); });
    var live = all.filter(function (l) { return l.status === 'in_transit'; });
    var booked = all.filter(function (l) { return l.status === 'booked'; });
    var done = all.filter(function (l) { return l.status === 'delivered'; })
      .sort(function (a, b) { return dropDate(a) < dropDate(b) ? 1 : -1; });
    var c;
    if (live.length) { c = cityOf(live[0].drop_place || live[0].lane); if (c) return { c: c, src: 'en route: drop city of the load in transit' }; }
    if (done.length) {
      c = cityOf(done[0].drop_place || done[0].lane);
      if (c) return { c: c, src: (booked.length ? 'last drop (next load is booked, truck is still there)' : 'last delivered drop') + (dropDate(done[0]) ? ', ' + dropDate(done[0]) : '') };
    }
    if (booked.length) { c = cityOf(booked[0].pickup_place || booked[0].lane); if (c) return { c: c, src: 'pickup city of the booked load' }; }
    return null;
  }
  function geocode(c) {
    var key = (c.name + ', ' + c.st).toLowerCase();
    if (CITY[key]) return Promise.resolve({ lat: CITY[key][0], lon: CITY[key][1] });
    var cache = lsGet(GEO_KEY) || {};
    if (cache[key]) return Promise.resolve(cache[key]);
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(c.name) + '&count=10&language=en&format=json&countryCode=US';
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('geo'); return r.json(); }).then(function (j) {
      var hit = ((j && j.results) || []).filter(function (x) { return x.admin1 === STATE_NAME[c.st]; })[0];
      if (!hit) throw new Error('nogeo');
      var v = { lat: Math.round(hit.latitude * 100) / 100, lon: Math.round(hit.longitude * 100) / 100 };
      cache[key] = v; lsSet(GEO_KEY, cache);
      return v;
    });
  }
  function locate() {
    var p = pickCity();
    if (!p) return Promise.resolve(st.useBase || (A().getFeed && A().getFeed()) ? BASE : null);
    var label = p.c.name + ', ' + p.c.st;
    return geocode(p.c).then(function (g) {
      return { city: label, lat: g.lat, lon: g.lon, src: p.src };
    }).catch(function () { return { city: BASE.city, lat: BASE.lat, lon: BASE.lon, src: 'base (could not place ' + label + ')' }; });
  }

  /* ---------- weather ---------- */
  var LABEL = { sun: 'Clear', moon: 'Clear night', partly: 'Partly cloudy', cloud: 'Cloudy', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', ice: 'Freezing rain', snow: 'Snow', thunder: 'Thunderstorm' };
  function kindOf(code, isDay) {
    var c = Number(code);
    if (c === 0 || c === 1) return isDay === 0 ? 'moon' : 'sun';
    if (c === 2) return 'partly';
    if (c === 3) return 'cloud';
    if (c === 45 || c === 48) return 'fog';
    if (c === 51 || c === 53 || c === 55) return 'drizzle';
    if (c === 56 || c === 57 || c === 66 || c === 67) return 'ice';
    if (c >= 61 && c <= 65) return 'rain';
    if (c >= 80 && c <= 82) return 'rain';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    if (c >= 95) return 'thunder';
    return 'cloud';
  }
  var CLOUD = '<path fill="#C4B5FD" d="M6.2 15.5a4 4 0 0 1-.3-8A5.2 5.2 0 0 1 16 6.6a4.5 4.5 0 0 1 1.6 8.9z"/>';
  var SUN = '<circle cx="12" cy="12" r="4.2" fill="#F2C94C"/><g stroke="#F2C94C" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/></g>';
  function drops(n, c) { var s = '<g stroke="' + c + '" stroke-width="1.8" stroke-linecap="round">'; for (var i = 0; i < n; i++) s += '<path d="M' + (8 + i * 4) + ' 17.4l-1 3.2"/>'; return s + '</g>'; }
  /* Built-in static icons. Swap the whole set by defining window.BlackRamWxIcons.iconFor. */
  function iconFor(code, isDay) {
    var ext = window.BlackRamWxIcons, W = window.BlackRamWx;
    if (ext && typeof ext.iconFor === 'function') {
      try { var h = ext.iconFor(code, isDay); if (h) return h; } catch (e) { /* fall through */ }
    }
    /* animated set (wxicons.js, HST-67) when it is on the page */
    if (W && typeof W.iconHtml === 'function' && typeof W.kindFromCode === 'function') {
      try {
        var ak = W.kindFromCode(code, null);
        var h2 = ak ? W.iconHtml(ak, { night: isDay === 0 }) : '';
        if (h2) return h2;
      } catch (e2) { /* fall through */ }
    }
    var k = kindOf(code, isDay), g;
    if (k === 'sun') g = SUN;
    else if (k === 'moon') g = '<path fill="#E8E4F4" d="M20 14.6A8.2 8.2 0 0 1 9.4 4 8.4 8.4 0 1 0 20 14.6z"/>';
    else if (k === 'partly') g = '<g transform="translate(-3 -3) scale(.7)">' + SUN + '</g><g transform="translate(2.5 3.5) scale(.8)">' + CLOUD + '</g>';
    else if (k === 'fog') g = '<g transform="translate(0 -3)">' + CLOUD + '</g><g stroke="#C4B5FD" stroke-width="1.8" stroke-linecap="round"><path d="M5 17.6h14M7.5 20.4h9"/></g>';
    else if (k === 'drizzle') g = '<g transform="translate(0 -3)">' + CLOUD + '</g>' + drops(2, '#60A5FA');
    else if (k === 'rain') g = '<g transform="translate(0 -3)">' + CLOUD + '</g>' + drops(3, '#60A5FA');
    else if (k === 'ice') g = '<g transform="translate(0 -3)">' + CLOUD + '</g>' + drops(3, '#A5F3FC');
    else if (k === 'snow') g = '<g transform="translate(0 -3)">' + CLOUD + '</g><g fill="#F5F1E6"><circle cx="8" cy="18.4" r="1.4"/><circle cx="12" cy="20.2" r="1.4"/><circle cx="16" cy="18.4" r="1.4"/></g>';
    else if (k === 'thunder') g = '<g transform="translate(0 -3)">' + CLOUD + '</g><path fill="#F2C94C" d="M12.6 13.2l-3 5h2.4l-1 3.6 3.6-5.2h-2.4z"/>';
    else g = CLOUD;
    return '<svg class="wxb-ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' + g + '</svg>';
  }
  function condLabel(code, isDay) { return LABEL[kindOf(code, isDay)] || 'Cloudy'; }

  function wxUrl(loc) {
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat.toFixed(2) + '&longitude=' + loc.lon.toFixed(2) +
      '&current=temperature_2m,weather_code,is_day,wind_speed_10m,wind_gusts_10m' +
      '&hourly=temperature_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=2';
  }
  function overnightLow(j) {
    var t = (j.hourly && j.hourly.time) || [], v = (j.hourly && j.hourly.temperature_2m) || [];
    var now = String((j.current && j.current.time) || ''), day = now.slice(0, 10), hr = +now.slice(11, 13);
    var from, to;
    if (hr < 8) { from = now; to = day + 'T08:00'; }
    else {
      from = day + 'T18:00';
      var nx = (j.daily && j.daily.time && j.daily.time[1]) || '';
      to = nx + 'T08:00';
    }
    var low = null;
    for (var i = 0; i < t.length; i++) {
      if (t[i] >= from && t[i] <= to && v[i] != null && (low == null || v[i] < low)) low = v[i];
    }
    if (low == null && j.daily && j.daily.temperature_2m_min) low = j.daily.temperature_2m_min[hr < 8 ? 0 : 1];
    return low;
  }
  function fetchWx(loc) {
    return fetch(wxUrl(loc)).then(function (r) { if (!r.ok) throw new Error('wx ' + r.status); return r.json(); }).then(function (j) {
      var c = j.current || {}, d = j.daily || {};
      return {
        city: loc.city, src: loc.src, lat: loc.lat, lon: loc.lon, t: Date.now(),
        temp: c.temperature_2m, code: c.weather_code, day: c.is_day, wind: c.wind_speed_10m, gust: c.wind_gusts_10m,
        hi: d.temperature_2m_max && d.temperature_2m_max[0], lo: d.temperature_2m_min && d.temperature_2m_min[0],
        pop: d.precipitation_probability_max && d.precipitation_probability_max[0], night: overnightLow(j)
      };
    });
  }
  function cacheFor(loc) {
    var c = lsGet(KEY);
    return c && c.city === loc.city && isFinite(c.t) ? c : null;
  }

  /* ---------- chip ---------- */
  function chipEl() { return $('hdr-wxnow'); }
  function render() {
    var el = chipEl();
    if (!el) return;
    var w = st.wx;
    if (!w || w.temp == null) {
      el.setAttribute('data-state', st.loc || st.busy ? (st.busy ? 'busy' : 'off') : 'busy');
      el.innerHTML = '<span class="wxb-na">WX ' + (st.busy || !st.loc ? '--' : 'n/a') + '</span>';
      el.setAttribute('aria-label', 'Truck weather ' + (st.busy || !st.loc ? 'loading' : 'not available') + '. Open details');
      return;
    }
    var old = Date.now() - w.t > TTL;
    var cold = w.temp <= COLD_F || (w.night != null && w.night <= COLD_F);
    el.setAttribute('data-state', old ? 'stale' : 'ok');
    el.classList.toggle('cold', !!cold);
    el.innerHTML = iconFor(w.code, w.day) + '<span class="wxb-t num-yellow">' + rd(w.temp) + '<small>F</small></span><span class="wxb-city">' + esc(w.city.replace(/, .*/, '')) + '</span>';
    el.setAttribute('aria-label', 'Weather in ' + w.city + ', ' + rd(w.temp) + ' F, ' + condLabel(w.code, w.day) + (old ? ', older reading' : '') + '. Open details');
    if (st.open) renderSheet();
  }

  /* ---------- sheet ---------- */
  function ago(ms) { var m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'just now' : (m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'); }
  function stat(label, val, sub) {
    return '<div class="wxs-stat"><span class="wxs-k">' + label + '</span><b class="wxs-v num-yellow">' + val + '</b>' + (sub ? '<span class="wxs-sub">' + sub + '</span>' : '') + '</div>';
  }
  function renderSheet() {
    var box = $('wxs-body');
    if (!box) return;
    var w = st.wx, loc = st.loc;
    if (!w || w.temp == null) {
      box.innerHTML = '<h2 id="wxs-title">Truck weather</h2>' + (loc ? '<p class="wxs-city">' + esc(loc.city) + '</p>' : '') +
        '<p class="wxs-note">' + (st.busy ? 'Loading...' : 'WX n/a. No weather reading yet (offline or Open-Meteo did not answer). It retries when the phone is back online.') + '</p>' +
        '<p class="wxs-fine">City level only. ' + (loc ? 'Location: ' + esc(loc.src) + '.' : '') + '</p>';
      return;
    }
    var old = Date.now() - w.t > TTL;
    var nl = w.night != null ? rd(w.night) : null;
    var coldNight = nl != null && nl <= COLD_F;
    var coldNow = w.temp <= COLD_F;
    var on = wxRulesOn();
    var note;
    if (coldNight || coldNow) {
      note = '<p class="wxs-cold"><b>Cold: ' + (coldNight ? 'overnight low ' + nl + ' F' : 'now ' + rd(w.temp) + ' F') + ', at or below ' + COLD_F + ' F.</b> ' +
        (on ? 'Weather rules are ON, so loads that drop in this cold are PASS. ' : 'Weather rules are OFF, so cold loads show as a note only. ') + 'Plan for idling or a heated stop.</p>';
    } else if (nl != null) {
      note = '<p class="wxs-ok">Overnight low ' + nl + ' F is above the ' + COLD_F + ' F cold limit.</p>';
    } else note = '';
    box.innerHTML =
      '<h2 id="wxs-title">Truck weather</h2><p class="wxs-city">' + esc(w.city) + '</p>' +
      '<div class="wxs-now">' + iconFor(w.code, w.day).replace('width="20" height="20"', 'width="56" height="56"').replace('wxb-ico', 'wxb-ico wxb-big') +
      '<div><b class="wxs-temp num-yellow">' + rd(w.temp) + ' F</b><span class="wxs-cond">' + esc(condLabel(w.code, w.day)) + '</span></div></div>' +
      '<div class="wxs-grid">' +
      stat('High today', w.hi != null ? rd(w.hi) + ' F' : '-') +
      stat('Low today', w.lo != null ? rd(w.lo) + ' F' : '-') +
      stat('Wind', w.wind != null ? rd(w.wind) + ' mph' : '-', w.gust != null ? 'gusts ' + rd(w.gust) : '') +
      stat('Rain chance', w.pop != null ? rd(w.pop) + '%' : '-') +
      stat('Overnight low', nl != null ? nl + ' F' : '-') +
      '</div>' + note +
      '<p class="wxs-fine">' + (old ? 'Older reading from ' + ago(Date.now() - w.t) + ' (offline). ' : 'Updated ' + ago(Date.now() - w.t) + '. ') +
      'Truck location: ' + esc(w.src || '') + '. City level only, never GPS. Weather by Open-Meteo.</p>';
  }
  function openSheet() {
    var s = $('wxs');
    if (!s) return;
    st.open = true;
    s.hidden = false;
    document.documentElement.classList.add('sheet-open');
    renderSheet();
    refresh(false);
    var b = $('wxs-close'); if (b) b.focus();
  }
  function closeSheet() {
    var s = $('wxs');
    if (!s) return;
    st.open = false;
    s.hidden = true;
    document.documentElement.classList.remove('sheet-open');
    var c = chipEl(); if (c) c.focus();
  }

  /* ---------- refresh ---------- */
  function refresh(force) {
    if (st.busy) return;
    st.busy = true;
    locate().then(function (loc) {
      if (!loc) { st.busy = false; render(); return null; }
      st.loc = loc;
      var c = cacheFor(loc);
      if (c && !force && Date.now() - c.t < TTL) { st.wx = c; st.busy = false; render(); return null; }
      if (c) { st.wx = c; render(); }   /* show the saved copy while the new one loads */
      return fetchWx(loc).then(function (w) {
        st.wx = w; lsSet(KEY, w);
      }).catch(function () {
        if (!(c && Date.now() - c.t < STALE_MAX)) st.wx = null;
      }).then(function () { st.busy = false; render(); });
    }).catch(function () { st.busy = false; render(); });
  }

  function build() {
    var chip = chipEl();
    if (!chip) return;
    if (!$('wxs')) {
      var d = document.createElement('div');
      d.id = 'wxs'; d.className = 'wxs'; d.hidden = true;
      d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'wxs-title');
      d.innerHTML = '<div class="wxs-card"><div class="wxs-top"><button type="button" class="about-btn" id="wxs-close">Close</button></div><div id="wxs-body"></div></div>';
      document.body.appendChild(d);
      d.addEventListener('click', function (e) { if (e.target === d) closeSheet(); });
      $('wxs-close').addEventListener('click', closeSheet);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.open) closeSheet(); });
    }
    chip.addEventListener('click', openSheet);
    document.addEventListener('blackram:data', function (e) { if (!e.detail || e.detail.kind === 'feed') refresh(false); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(false); });
    window.addEventListener('online', function () { refresh(true); });
    st.timer = setInterval(function () { if (!document.hidden) refresh(false); }, TTL);
    render();
    refresh(false);
    /* no feed after 6 s: use the base city so the chip is never empty */
    setTimeout(function () { if (!st.loc && !st.busy) { st.useBase = true; refresh(false); } }, 6000);
  }
  window.BlackRamWxBar = { iconFor: iconFor, refresh: refresh, kindOf: kindOf };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
