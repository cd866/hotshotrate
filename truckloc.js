/* Black Ram Logistics - the one "truck current location" (v119).
   Everything that needs the truck's position (weather chip, Truck is at, deadhead, next-load origin,
   combos, trip plan, Today "Truck now") reads window.BlackRamTruck.get().
   Source of truth, best first:
     1. the location Claudio set (weather chip city search, Home, phone location rounded to the nearest
        city, or Truck is at), stamped with the time it was set. Saved in localStorage
        (blackram_truckloc_v1) and mirrored to the PIN relay POST /truck-loc (KV truck_loc) so the box
        scan scripts see it. A newer set on any device wins.
     2. otherwise the last delivered load's drop city. A delivery on a LATER DAY than the set moves the
        truck to that drop (same-day ties go to the set). With no set, a load in transit counts as the
        drop city en route, and a booked load with no delivery counts as its pickup city.
     3. otherwise home: Jacksonville, FL (city centroid 30.33,-81.66).
   City level only: the synced and public record is City, ST plus a 2-decimal centroid, never a street.
   A street address typed into Truck is at stays on this phone as a precise point (pt) for deadhead.
   Old keys blackram_wxloc_v1 and blackram_truck_at_v1 are migrated once, stamped at migration time.
   Plain ASCII. */
(function () {
  'use strict';
  var KEY = 'blackram_truckloc_v1';
  var OLD_OVR = 'blackram_wxloc_v1';
  var OLD_AT = 'blackram_truck_at_v1';
  var GEO_KEY = 'blackram_wxgeo_v1';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
  var STATE_NAME = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  var NOISE = /^(UR|Equipment|EquipmentShare|Containers|Cargo|Rentals|Yard|Mfg|Supply|Elec|Taller|Technologies|STT|Tag|Near|BUILTEC|Stribling|Con|Global|United)$/;
  var BASE = { name: 'Jacksonville', st: 'FL', city: 'Jacksonville, FL', lat: 30.33, lon: -81.66 };
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
  var st = { manual: null, lastKey: '', pullAt: 0, geoBusy: {} };

  function A() { return window.BlackRamApp || {}; }
  function ascii(v) { return String(v == null ? '' : v).replace(/\u2192/g, 'to').replace(/[\u2013\u2014\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x00-\x7F]/g, ''); }
  function r2(n) { return Math.round(Number(n) * 100) / 100; }
  function fin(n) { return n != null && n !== '' && isFinite(Number(n)); }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }

  /* America/Chicago calendar day (YYYY-MM-DD) of a time. */
  function ctDay(ms) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
    catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }
  function md(iso) { var m = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})/); return m ? (+m[1]) + '/' + (+m[2]) : ''; }

  /* ---------- city parsing and coordinates ---------- */
  function cityOf(s) {
    s = ascii(s);
    var paren = s.match(/\(([^)]*)\)/);
    var parts = [];
    if (paren) parts.push(paren[1]);
    parts.push(s.replace(/\([^)]*\)/g, ' '));
    var re = new RegExp('(?:^|[ ,])([A-Za-z.\' ]+?)[ ,]+(' + STATES + ')(?:\\s+\\d{5})?\\s*$');
    for (var i = 0; i < parts.length; i++) {
      var segs = parts[i].split(',');
      /* "City, ST 32202" has the city and the state in two comma parts: also try each pair joined */
      var cands = [];
      for (var j = segs.length - 1; j >= 0; j--) {
        cands.push(segs[j].trim());
        if (j > 0) cands.push((segs[j - 1] + ',' + segs[j]).trim());
      }
      for (j = 0; j < cands.length; j++) {
        var m = cands[j].match(re);
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
  function coordSync(c) {
    var key = (c.name + ', ' + c.st).toLowerCase();
    if (CITY[key]) return { lat: CITY[key][0], lon: CITY[key][1] };
    var cache = lsGet(GEO_KEY) || {};
    return cache[key] || null;
  }
  function geocode(c) {
    var key = (c.name + ', ' + c.st).toLowerCase();
    var known = coordSync(c);
    if (known) return Promise.resolve(known);
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(c.name) + '&count=10&language=en&format=json&countryCode=US';
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('geo'); return r.json(); }).then(function (j) {
      var hit = ((j && j.results) || []).filter(function (x) { return x.admin1 === STATE_NAME[c.st]; })[0];
      if (!hit) throw new Error('nogeo');
      var v = { lat: r2(hit.latitude), lon: r2(hit.longitude) };
      var cache = lsGet(GEO_KEY) || {}; cache[key] = v; lsSet(GEO_KEY, cache);
      return v;
    });
  }
  function splitCity(label) {
    var m = String(label || '').match(/^(.*?),\s*([A-Z]{2})$/);
    return m ? { name: m[1].trim(), st: m[2] } : null;
  }

  /* ---------- the set location (manual) ---------- */
  function validRec(o) {
    return !!(o && o.city && fin(o.lat) && fin(o.lon) && o.set_at && isFinite(Date.parse(o.set_at)));
  }
  function load() {
    var rec = lsGet(KEY);
    if (validRec(rec)) { st.manual = rec; return; }
    st.manual = null;
    /* one-time migration of the two older, unstamped places this was saved */
    var o = lsGet(OLD_OVR), a = lsGet(OLD_AT), now = new Date().toISOString(), m = null;
    if (o && o.city && fin(o.lat) && fin(o.lon)) {
      m = { city: ascii(o.city), lat: r2(o.lat), lon: r2(o.lon), set_at: now, source: /home/i.test(o.src || '') ? 'home' : 'weather' };
    } else if (a && fin(a.lat) && fin(a.lon)) {
      var c = cityOf(a.label || '');
      var cc = c ? coordSync(c) : null;   /* city centroid when known, so a street never leaves this phone */
      m = { city: c ? c.name + ', ' + c.st : ascii(a.label || 'Truck location'), lat: cc ? cc.lat : r2(a.lat), lon: cc ? cc.lon : r2(a.lon), set_at: now, source: 'truck-at' };
      m.pt = { lat: Number(a.lat), lon: Number(a.lon), label: ascii(a.label || '') };
    }
    if (m) { lsSet(KEY, m); st.manual = m; }
    lsDel(OLD_OVR); lsDel(OLD_AT);
  }

  /* ---------- feed: last delivered drop / in transit / booked ---------- */
  function resolvedLoad(l) { var a = A(); return a.withResolvedStatus ? a.withResolvedStatus(l) : l; }
  function dropDate(l) { return String(l.delivered_date || l.delivery_date || l.date || '').slice(0, 10); }
  function feedPick() {
    var f = A().getFeed ? A().getFeed() : null;
    if (!f) return null;
    var all = [];
    (f.months || []).forEach(function (m) { (m.loads || []).forEach(function (l) { all.push(resolvedLoad(l)); }); });
    var out = { live: null, drop: null, booked: null };
    var live = all.filter(function (l) { return l.status === 'in_transit'; });
    var booked = all.filter(function (l) { return l.status === 'booked'; });
    var done = all.filter(function (l) { return l.status === 'delivered'; })
      .sort(function (a, b) { return dropDate(a) < dropDate(b) ? 1 : -1; });
    var c;
    if (live.length) { c = cityOf(live[0].drop_place || live[0].lane); if (c) out.live = { c: c }; }
    if (done.length) { c = cityOf(done[0].drop_place || done[0].lane); if (c) out.drop = { c: c, date: dropDate(done[0]) }; }
    if (booked.length) { c = cityOf(booked[0].pickup_place || booked[0].lane); if (c) out.booked = { c: c }; }
    return out;
  }

  function mk(o) {
    var r = {
      name: o.name, st: o.st, city: o.name + ', ' + o.st, lat: o.lat, lon: o.lon,
      src: o.src, source: o.source || '', set_at: o.set_at || '', date: o.date || '',
      manual: o.src === 'manual', pt: o.pt || null, feed: !!o.feed, why: o.why, tag: o.tag
    };
    r.pending = r.lat == null;
    return r;
  }
  function fromCity(c, src, extra) {
    var co = coordSync(c);
    var o = { name: c.name, st: c.st, lat: co ? co.lat : null, lon: co ? co.lon : null, src: src, feed: true };
    for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
    if (!co) ensureCity(c);
    return mk(o);
  }
  function get() {
    var p = feedPick();
    var m = st.manual, out = null, sc;
    if (m) {
      sc = splitCity(m.city) || { name: m.city, st: '' };
      var setDay = ctDay(Date.parse(m.set_at));
      if (!(p && p.drop && p.drop.date > setDay)) {
        out = mk({
          name: sc.name, st: sc.st, lat: Number(m.lat), lon: Number(m.lon), src: 'manual', source: m.source, set_at: m.set_at, date: setDay, pt: m.pt || null, feed: !!p,
          why: 'set by you' + (m.source === 'home' ? ' (home)' : m.source === 'phone' ? ' (phone location)' : '') + ', ' + md(setDay),
          tag: 'Truck: ' + m.city + ' (set ' + md(setDay) + ')'
        });
        if (!out.st) out.city = m.city;
        return out;
      }
    }
    if (p && p.live && !m) return fromCity(p.live.c, 'live', { why: 'en route: drop city of the load in transit', tag: 'Truck: ' + p.live.c.name + ', ' + p.live.c.st + ' (en route to this drop)' });
    if (p && p.drop) return fromCity(p.drop.c, 'drop', { date: p.drop.date, why: 'last delivered drop, ' + p.drop.date, tag: 'Truck: ' + p.drop.c.name + ', ' + p.drop.c.st + ' (last drop ' + md(p.drop.date) + ')' });
    if (p && p.booked) return fromCity(p.booked.c, 'booked', { why: 'pickup city of the booked load', tag: 'Truck: ' + p.booked.c.name + ', ' + p.booked.c.st + ' (booked pickup)' });
    return mk({ name: BASE.name, st: BASE.st, lat: BASE.lat, lon: BASE.lon, src: 'home', feed: !!p, why: 'home base', tag: 'Truck: Jacksonville, FL (home)' });
  }

  function keyOf(t) { return [t.src, t.city, t.lat, t.lon, t.set_at, t.date, t.pt ? t.pt.lat + ',' + t.pt.lon : ''].join('|'); }
  function emit(force) {
    var t = get(), k = keyOf(t);
    if (!force && k === st.lastKey) return;
    st.lastKey = k;
    try { document.dispatchEvent(new CustomEvent('blackram:truckloc', { detail: t })); } catch (e) { /* old browser */ }
  }
  function ensureCity(c) {
    var key = (c.name + ', ' + c.st).toLowerCase();
    if (st.geoBusy[key]) return;
    st.geoBusy[key] = 1;
    geocode(c).then(function () { emit(true); }).catch(function () { /* stays pending */ }).then(function () { delete st.geoBusy[key]; });
  }
  /* Resolves with get() once its coordinates are known (or after the lookup failed). */
  function ensure() {
    var t = get();
    if (!t.pending) return Promise.resolve(t);
    return geocode({ name: t.name, st: t.st }).then(function () { return get(); }).catch(function () { return get(); });
  }

  /* ---------- relay mirror ---------- */
  function relayCall(body) {
    var p = pin();
    if (!p) return Promise.resolve(null);
    body.pin = p;
    return fetch(RELAY + '/truck-loc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function pushRec(m) {
    var c = splitCity(m.city);
    if (!c) return Promise.resolve(null);
    return relayCall({ op: 'set', loc: { city: c.name, state: c.st, lat: m.lat, lon: m.lon, set_at: m.set_at, source: m.source } });
  }
  function pull(force) {
    var now = Date.now();
    if (!force && now - st.pullAt < 20000) return Promise.resolve();
    st.pullAt = now;
    return relayCall({ op: 'get' }).then(function (j) {
      if (!j || !j.ok) return;
      var d = j.data, m = st.manual;
      if (d && d.city && d.state && isFinite(Date.parse(d.set_at)) && (!m || Date.parse(d.set_at) > Date.parse(m.set_at))) {
        st.manual = { city: d.city + ', ' + d.state, lat: r2(d.lat), lon: r2(d.lon), set_at: d.set_at, source: d.source || 'app' };
        lsSet(KEY, st.manual);
      } else if (d && d.cleared_at && m && Date.parse(d.cleared_at) > Date.parse(m.set_at)) {
        st.manual = null; lsDel(KEY);
      } else if (m) {
        var dt = d ? Date.parse(d.set_at || d.cleared_at || '') : NaN;
        if (!isFinite(dt) || Date.parse(m.set_at) > dt) pushRec(m);
      }
      emit(false);
    });
  }

  /* ---------- set / clear ---------- */
  /* loc: { city: 'City, ST', lat, lon, pt?: {lat, lon, label} }. source: weather | home | phone | truck-at */
  function set(loc, source) {
    if (!loc || !loc.city || !fin(loc.lat) || !fin(loc.lon)) return null;
    var m = { city: ascii(loc.city).replace(/\s+/g, ' ').trim(), lat: r2(loc.lat), lon: r2(loc.lon), set_at: new Date().toISOString(), source: source || 'weather' };
    if (loc.pt && fin(loc.pt.lat) && fin(loc.pt.lon)) m.pt = { lat: Number(loc.pt.lat), lon: Number(loc.pt.lon), label: ascii(loc.pt.label || '') };
    st.manual = m;
    lsSet(KEY, m);
    pushRec(m);
    emit(true);
    return get();
  }
  function clear() {
    st.manual = null;
    lsDel(KEY);
    relayCall({ op: 'clear' });
    emit(true);
    return get();
  }

  load();
  function init() {
    document.addEventListener('blackram:data', function () { emit(false); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) pull(false); });
    window.addEventListener('online', function () { pull(true); });
    pull(true);
  }
  window.BlackRamTruck = { get: get, set: set, clear: clear, ensure: ensure, pull: pull, cityOf: cityOf, geocode: geocode, BASE: BASE };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
