/* Black Ram Logistics - appbar weather chip (v105, location picker).
   Shows current weather for the truck's city next to the last-pull time. Tap for a small
   sheet: today's high/low, wind, rain chance, overnight low with the 45 F cold note, and a
   city search to set the truck city the chip uses.
   Auto truck city (city level only, never GPS or a street address), best source first:
     1. load in transit  -> its drop city ("en route")
     2. load booked      -> last delivered drop (the truck is still there until pickup)
     3. last delivered load's drop city
     4. base: Jacksonville, FL
   A city picked in the sheet is saved in localStorage (blackram_wxloc_v1) and wins until
   "Use truck location" clears it. Home sets Jacksonville, FL (base centroid) in one tap.
   "Use my phone location" is opt-in only: the point is
   reverse-looked-up to the nearest city and stored as City, ST (centroid), never a pin.
   This override is only for the weather chip. It does not change Rate Check "Truck is at"
   (deadhead / fuel) or the Today "Truck now" load card.
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
  var OVR_KEY = 'blackram_wxloc_v1';
  var COLD_F = 45;
  var BASE = { city: 'Jacksonville, FL', lat: 30.33, lon: -81.66, src: 'base' };
  var STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
  var STATE_NAME = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  var ST_FROM_NAME = (function () {
    var m = { 'District of Columbia': 'DC' }, k;
    for (k in STATE_NAME) if (STATE_NAME.hasOwnProperty(k)) m[STATE_NAME[k]] = k;
    return m;
  })();
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
  var st = { loc: null, wx: null, busy: false, timer: null, open: false, gen: 0, searchTimer: null, hits: [], geoBusy: false };

  function $(id) { return document.getElementById(id); }
  function A() { return window.BlackRamApp || {}; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ascii(v) { return String(v == null ? '' : v).replace(/\u2192/g, 'to').replace(/[\u2013\u2014\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x00-\x7F]/g, ''); }
  function rd(n) { return Math.round(Number(n)); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
  function wxRulesOn() { try { return localStorage.getItem('blackram_weather_on_v1') !== 'off'; } catch (e) { return true; } }
  function pinSvg(cls) {
    return '<svg class="' + (cls || 'wxb-pin') + '" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path fill="#F2C94C" d="M6 1.1A3.5 3.5 0 0 0 2.5 4.6c0 2.5 3.5 6.2 3.5 6.2s3.5-3.7 3.5-6.2A3.5 3.5 0 0 0 6 1.1zm0 4.8A1.3 1.3 0 1 1 6 3.3a1.3 1.3 0 0 1 0 2.6z"/></svg>';
  }
  function stateAbbr(v) {
    if (!v) return null;
    var s = ascii(v).trim();
    var up = s.toUpperCase();
    if (new RegExp('^(' + STATES + '|DC)$').test(up)) return up;
    return ST_FROM_NAME[s] || ST_FROM_NAME[s.replace(/\b\w/g, function (c) { return c.toUpperCase(); })] || null;
  }
  function locLabel(name, abbr) { return ascii(name).replace(/\s+/g, ' ').trim() + ', ' + abbr; }
  function asLoc(city, lat, lon, src, manual) {
    return {
      city: ascii(city).replace(/\s+/g, ' ').trim(),
      lat: Math.round(Number(lat) * 100) / 100,
      lon: Math.round(Number(lon) * 100) / 100,
      src: src,
      manual: !!manual
    };
  }
  function readOverride() {
    var o = lsGet(OVR_KEY);
    if (o && o.city && isFinite(Number(o.lat)) && isFinite(Number(o.lon))) {
      return asLoc(o.city, o.lat, o.lon, o.src || 'set by you', true);
    }
    return null;
  }

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
    var o = readOverride();
    if (o) return Promise.resolve(o);
    var p = pickCity();
    if (!p) return Promise.resolve(st.useBase || (A().getFeed && A().getFeed()) ? BASE : null);
    var label = p.c.name + ', ' + p.c.st;
    return geocode(p.c).then(function (g) {
      return { city: label, lat: g.lat, lon: g.lon, src: p.src };
    }).catch(function () { return { city: BASE.city, lat: BASE.lat, lon: BASE.lon, src: 'base (could not place ' + label + ')' }; });
  }

  /* ---------- manual city override (chip only) ---------- */
  function clearWxCache() { lsDel(KEY); }
  function setOverride(loc) {
    if (!loc || !loc.city || !isFinite(Number(loc.lat)) || !isFinite(Number(loc.lon))) return;
    var rec = asLoc(loc.city, loc.lat, loc.lon, loc.src || 'set by you', true);
    lsSet(OVR_KEY, { city: rec.city, lat: rec.lat, lon: rec.lon, src: rec.src });
    clearWxCache();
    st.loc = rec;
    st.wx = null;
    setHits([]);
    setLocMsg('');
    var q = $('wxs-q'); if (q) q.value = '';
    refresh(true);
  }
  function clearOverride() {
    lsDel(OVR_KEY);
    clearWxCache();
    st.wx = null;
    setHits([]);
    setLocMsg('');
    var q = $('wxs-q'); if (q) q.value = '';
    refresh(true);
  }
  function isHome(loc) {
    return !!(loc && loc.city === BASE.city && Math.abs(loc.lat - BASE.lat) < 0.02 && Math.abs(loc.lon - BASE.lon) < 0.02);
  }
  function setHome() {
    setOverride(asLoc(BASE.city, BASE.lat, BASE.lon, 'home (Jacksonville, FL)', true));
  }
  var HOME_ICO = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.5 12 4.2l8.5 7.3"/><path d="M6 10.5V20h12v-9.5"/><path d="M10 20v-6h4v6"/></g></svg>';
  function hitFromGeo(r, wantSt) {
    if (!r || (r.country_code && String(r.country_code).toUpperCase() !== 'US')) return null;
    var code = (r.feature_code || '');
    if (code && code.charAt(0) !== 'P') return null; /* populated places only, not counties */
    var abbr = stateAbbr(r.admin1);
    if (!abbr || abbr === 'DC') return null;
    if (wantSt && abbr !== wantSt) return null;
    var name = ascii(r.name || '').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    return asLoc(locLabel(name, abbr), r.latitude, r.longitude, 'set by you', true);
  }
  function parseQuery(q) {
    q = ascii(q).replace(/\s+/g, ' ').trim();
    var m = q.match(new RegExp('^(.+?)[, ]+(' + STATES + ')\\s*$', 'i'));
    if (m) return { name: m[1].trim(), st: m[2].toUpperCase() };
    return { name: q, st: null };
  }
  function searchCities(q) {
    var p = parseQuery(q);
    if (!p.name || p.name.length < 2) return Promise.resolve([]);
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(p.name) + '&count=10&language=en&format=json&countryCode=US';
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('geo'); return r.json(); }).then(function (j) {
      var out = [], seen = {}, i, h, key;
      var rows = (j && j.results) || [];
      for (i = 0; i < rows.length; i++) {
        h = hitFromGeo(rows[i], p.st);
        if (!h) continue;
        key = h.city.toLowerCase();
        if (seen[key]) continue;
        seen[key] = 1;
        out.push(h);
        if (out.length >= 8) break;
      }
      return out;
    });
  }
  function setHits(list) {
    st.hits = list || [];
    var box = $('wxs-hits');
    if (!box) return;
    if (!st.hits.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = st.hits.map(function (h, i) {
      return '<li><button type="button" class="wxs-hit" data-idx="' + i + '">' + esc(h.city) + '</button></li>';
    }).join('');
  }
  function setLocMsg(t) {
    var el = $('wxs-loc-msg');
    if (!el) return;
    if (!t) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = t;
  }
  function syncLocUi() {
    var p = $('wxs-loc-now');
    var loc = st.loc;
    if (p) {
      if (loc && loc.manual && isHome(loc)) p.textContent = 'Showing ' + loc.city + ' (home).';
      else if (loc && loc.manual) p.textContent = 'Showing ' + loc.city + ' (set by you).';
      else if (loc) p.textContent = 'Showing the truck city: ' + loc.city + '.';
      else p.textContent = '';
    }
    var home = $('wxs-home');
    if (home) {
      var on = !!(loc && loc.manual && isHome(loc));
      home.classList.toggle('on', on);
      home.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var auto = $('wxs-auto');
    if (auto) auto.disabled = !(loc && loc.manual);
    var geo = $('wxs-geo');
    if (geo) {
      geo.disabled = !!st.geoBusy;
      geo.textContent = st.geoBusy ? 'Finding city...' : 'Use my phone location';
    }
  }
  function runSearch(q) {
    q = ascii(q || '').trim();
    if (q.length < 2) { setHits([]); setLocMsg(''); return; }
    var token = (st.searchToken = (st.searchToken || 0) + 1);
    setLocMsg('Searching...');
    searchCities(q).then(function (hits) {
      if (token !== st.searchToken) return;
      setHits(hits);
      setLocMsg(hits.length ? '' : 'No US cities matched. Try City, ST.');
    }).catch(function () {
      if (token !== st.searchToken) return;
      setHits([]);
      setLocMsg('City search is unavailable right now.');
    });
  }
  function cityFromPhoton(p) {
    if (!p) return null;
    var cc = String(p.countrycode || p.country_code || '').toUpperCase();
    if (cc && cc !== 'US') return null;
    var abbr = stateAbbr(p.state);
    var name = p.city || p.town || p.village || p.locality || '';
    name = ascii(name).replace(/\s+/g, ' ').trim();
    if (!name || !abbr || abbr === 'DC') return null;
    return { name: name, st: abbr };
  }
  function reverseToCity(lat, lon) {
    var url = 'https://photon.komoot.io/reverse?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('rev'); return r.json(); }).then(function (j) {
      var feat = j && j.features && j.features[0];
      var c = cityFromPhoton(feat && feat.properties);
      if (!c) throw new Error('nocity');
      return geocode(c).then(function (g) {
        return asLoc(locLabel(c.name, c.st), g.lat, g.lon, 'phone location (nearest city)', true);
      });
    });
  }
  function usePhoneLocation() {
    if (st.geoBusy) return;
    if (!navigator.geolocation) { setLocMsg('This browser cannot share a location. Search a city instead.'); return; }
    st.geoBusy = true;
    syncLocUi();
    setLocMsg('Finding the nearest city...');
    navigator.geolocation.getCurrentPosition(function (pos) {
      reverseToCity(pos.coords.latitude, pos.coords.longitude).then(function (loc) {
        st.geoBusy = false;
        setOverride(loc);
        setLocMsg('');
      }).catch(function () {
        st.geoBusy = false;
        syncLocUi();
        setLocMsg('Could not turn that into a city. Search City, ST instead.');
      });
    }, function () {
      st.geoBusy = false;
      syncLocUi();
      setLocMsg('Location was not available. Search a city instead.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }
  function bindLocUi(root) {
    root.addEventListener('input', function (e) {
      if (!e.target || e.target.id !== 'wxs-q') return;
      var q = e.target.value || '';
      if (st.searchTimer) clearTimeout(st.searchTimer);
      if (ascii(q).trim().length < 2) { setHits([]); setLocMsg(''); return; }
      st.searchTimer = setTimeout(function () { runSearch(q); }, 300);
    });
    root.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !e.target || e.target.id !== 'wxs-q') return;
      e.preventDefault();
      if (st.searchTimer) { clearTimeout(st.searchTimer); st.searchTimer = null; }
      var q = e.target.value || '';
      if (st.hits && st.hits[0] && ascii(q).trim()) { setOverride(st.hits[0]); return; }
      runSearch(q);
    });
    root.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!t) return;
      if (t.id === 'wxs-home') { e.preventDefault(); setHome(); return; }
      if (t.id === 'wxs-auto') { e.preventDefault(); clearOverride(); return; }
      if (t.id === 'wxs-geo') { e.preventDefault(); usePhoneLocation(); return; }
      if (t.classList && t.classList.contains('wxs-hit')) {
        e.preventDefault();
        var rec = st.hits[Number(t.getAttribute('data-idx'))];
        if (rec) setOverride(rec);
      }
    });
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
        city: loc.city, src: loc.src, lat: loc.lat, lon: loc.lon, t: Date.now(), manual: !!loc.manual,
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
    var manual = !!(st.loc && st.loc.manual) || !!(w && w.manual);
    el.classList.toggle('manual', manual);
    if (!w || w.temp == null) {
      el.setAttribute('data-state', st.loc || st.busy ? (st.busy ? 'busy' : 'off') : 'busy');
      el.innerHTML = '<span class="wxb-na">WX ' + (st.busy || !st.loc ? '--' : 'n/a') + '</span>' + (manual ? pinSvg() : '');
      el.setAttribute('aria-label', 'Truck weather ' + (st.busy || !st.loc ? 'loading' : 'not available') + (manual && st.loc ? ' for ' + st.loc.city + (isHome(st.loc) ? ', home' : ', set by you') : '') + '. Open details');
      syncLocUi();
      if (st.open) renderSheet();
      return;
    }
    var old = Date.now() - w.t > TTL;
    var cold = w.temp <= COLD_F || (w.night != null && w.night <= COLD_F);
    el.setAttribute('data-state', old ? 'stale' : 'ok');
    el.classList.toggle('cold', !!cold);
    el.innerHTML = iconFor(w.code, w.day) + '<span class="wxb-t num-yellow">' + rd(w.temp) + '<small>F</small></span>' +
      (manual ? pinSvg() : '') +
      '<span class="wxb-city">' + esc(w.city.replace(/, .*/, '')) + '</span>';
    el.setAttribute('aria-label', 'Weather in ' + w.city + ', ' + rd(w.temp) + ' F, ' + condLabel(w.code, w.day) +
      (manual ? (isHome(st.loc) || isHome(w) ? ', home location' : ', location set by you') : '') + (old ? ', older reading' : '') + '. Open details');
    syncLocUi();
    if (st.open) renderSheet();
  }

  /* ---------- sheet ---------- */
  function ago(ms) { var m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'just now' : (m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'); }
  function stat(label, val, sub) {
    return '<div class="wxs-stat"><span class="wxs-k">' + label + '</span><b class="wxs-v num-yellow">' + val + '</b>' + (sub ? '<span class="wxs-sub">' + sub + '</span>' : '') + '</div>';
  }
  function cityLine(city, manual, home) {
    var tag = home ? 'home' : (manual ? 'set by you' : '');
    return '<p class="wxs-city">' + (manual ? pinSvg('wxb-pin wxs-pin') : '') + '<span>' + esc(city) + '</span>' +
      (tag ? '<span class="wxs-set">' + tag + '</span>' : '') + '</p>';
  }
  function renderSheet() {
    var box = $('wxs-body');
    if (!box) return;
    var w = st.wx, loc = st.loc;
    var manual = !!(loc && loc.manual) || !!(w && w.manual);
    if (!w || w.temp == null) {
      box.innerHTML = '<h2 id="wxs-title">Truck weather</h2>' + (loc ? cityLine(loc.city, manual, isHome(loc)) : '') +
        '<p class="wxs-note">' + (st.busy ? 'Loading...' : 'WX n/a. No weather reading yet (offline or Open-Meteo did not answer). It retries when the phone is back online.') + '</p>' +
        '<p class="wxs-fine">City level only. ' + (loc ? 'Location: ' + esc(loc.src) + '.' : '') + '</p>';
      syncLocUi();
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
      '<h2 id="wxs-title">Truck weather</h2>' + cityLine(w.city, manual, isHome(loc) || isHome(w)) +
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
      'Truck location: ' + esc(w.src || '') + '. City level only' + (manual ? '' : ', never GPS') + '. Weather by Open-Meteo.</p>';
    syncLocUi();
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
    var my = ++st.gen;
    st.busy = true;
    locate().then(function (loc) {
      if (my !== st.gen) return null;
      if (!loc) { st.busy = false; render(); return null; }
      st.loc = loc;
      var c = cacheFor(loc);
      if (c && !force && Date.now() - c.t < TTL) { st.wx = c; st.busy = false; render(); return null; }
      if (c) { st.wx = c; render(); }   /* show the saved copy while the new one loads */
      return fetchWx(loc).then(function (w) {
        if (my !== st.gen) return;
        st.wx = w; lsSet(KEY, w);
      }).catch(function () {
        if (my !== st.gen) return;
        if (!(c && Date.now() - c.t < STALE_MAX)) st.wx = null;
      }).then(function () {
        if (my !== st.gen) return;
        st.busy = false; render();
      });
    }).catch(function () {
      if (my !== st.gen) return;
      st.busy = false; render();
    });
  }

  function build() {
    var chip = chipEl();
    if (!chip) return;
    if (!$('wxs')) {
      var d = document.createElement('div');
      d.id = 'wxs'; d.className = 'wxs'; d.hidden = true;
      d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'wxs-title');
      d.innerHTML = '<div class="wxs-card"><div class="wxs-top"><button type="button" class="about-btn" id="wxs-close">Close</button></div><div id="wxs-body"></div>' +
        '<div class="wxs-loc" id="wxs-loc">' +
        '<h3 class="wxs-loc-h">Change city</h3>' +
        '<p class="wxs-loc-now" id="wxs-loc-now"></p>' +
        '<button type="button" class="btn gold btn-glow wxs-home" id="wxs-home" aria-label="Home, Jacksonville, FL" aria-pressed="false">' +
        HOME_ICO + '<span class="wxs-home-copy"><b>Home</b><span>Jacksonville, FL</span></span></button>' +
        '<label class="wxs-k" for="wxs-q">Search a city</label>' +
        '<input type="search" id="wxs-q" placeholder="City, ST" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="search">' +
        '<ul class="wxs-hits" id="wxs-hits" hidden role="listbox"></ul>' +
        '<div class="wxs-loc-actions">' +
        '<button type="button" class="about-btn" id="wxs-auto">Use truck location</button>' +
        '<button type="button" class="about-btn" id="wxs-geo">Use my phone location</button>' +
        '</div>' +
        '<p class="wxs-loc-msg" id="wxs-loc-msg" hidden></p>' +
        '</div></div>';
      document.body.appendChild(d);
      d.addEventListener('click', function (e) { if (e.target === d) closeSheet(); });
      $('wxs-close').addEventListener('click', closeSheet);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && st.open) closeSheet(); });
      bindLocUi(d);
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
  window.BlackRamWxBar = { iconFor: iconFor, refresh: refresh, kindOf: kindOf, setCity: setOverride, useTruckLocation: clearOverride, setHome: setHome };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
