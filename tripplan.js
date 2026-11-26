/* Black Ram Logistics - Trip plan (v47-v48).
   Adds a "Trip plan" button to every load and combo card and builds a
   day-by-day driver itinerary on the phone:
   - deadhead from the saved truck location (or the scan origin) to pickup;
   - drive legs inside HOS (11 hr drive, 14 hr window, 30 min break after
     8 hr driving, 10 hr off), about 50 mph, 1 hr load and 1 hr unload;
   - pickup and drop ETAs against their windows (early waits, late flags);
   - fuel stops on the route at Love's / TA / Petro (data/stops.json) with
     EIA diesel for the state, overnight town + truck stops each night;
   - weather per day (Open-Meteo, else the cached route weather).
   Routing: public OSRM demo; geocoding: OpenStreetMap Nominatim; extra
   truck stops (Pilot / Flying J): data/pilot_fj.json, pulled once from OSM
   Overpass. All free, cached, on demand.
   No names, phones or home address are used or shown. Nothing is sent. */
(function () {
  'use strict';

  var MPH = 50;
  var DRIVE_MAX = 11;
  var WINDOW_MAX = 14;
  var BREAK_AFTER = 8;
  var REST_HRS = 10;
  var DOCK_HRS = 1;            // 1 hr load, 1 hr unload
  var FUEL_STOP_HRS = 0.5;     // fuel stop doubles as the 30 min break
  var MPG = 8;
  var TANK_GAL = 34;
  var FUEL_EVERY = 250;        // 34 gal x 8 mpg = 272 mi; fill around 250 mi so the tank never runs dry
  var DEF_PER_MI = 0.034;
  var COLD_F = 45;
  var STOP_NEAR_MI = 15;       // truck stop counts as "on route" within this many miles of the line
  var GEO_KEY = 'blackram_trip_geo_v1';
  var ROUTE_KEY = 'blackram_trip_route_v1';
  var TRUCK_AT_KEY = 'blackram_truck_at_v1';
  var DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var HR = 3600000;

  var cache = { searches: null, stops: null, diesel: null, pfj: null };

  // ---------- capture the load board data the app already fetched ----------
  if (typeof window !== 'undefined' && window.fetch && !window.__tripFetchWrapped) {
    var origFetch = window.fetch.bind(window);
    window.__tripFetchWrapped = true;
    window.fetch = function (input, init) {
      var p = origFetch(input, init);
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/data\/load_searches\.json/.test(url)) {
          p.then(function (res) {
            if (res && res.ok) res.clone().json().then(function (d) { if (d && d.loads) cache.searches = d; }).catch(function () {});
          }).catch(function () {});
        }
      } catch (e) { /* ignore */ }
      return p;
    };
  }

  // ---------- small helpers ----------
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null || !isFinite(n)) return '-';
    var neg = n < 0;
    var s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + s;
  }
  function num(n, d) {
    if (n == null || !isFinite(n)) return '-';
    return Number(n).toFixed(d || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function hrs(h) {
    var m = Math.round(h * 60);
    var hh = Math.floor(m / 60);
    var mm = m % 60;
    return hh + 'h' + (mm < 10 ? '0' : '') + mm;
  }
  function timeStr(ms) {
    var d = new Date(ms);
    var h = d.getHours();
    var m = d.getMinutes();
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  function dateStr(ms) {
    var d = new Date(ms);
    return DAY[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
  }
  function stamp(ms) { return dateStr(ms) + ' ' + timeStr(ms); }
  function dayKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
  }
  function startOfDay(ms) { var d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function cityOnly(s) { return String(s || '').replace(/\s*\(.*\)\s*$/, '').trim(); }
  function stateOf(place) {
    var m = String(place || '').match(/,\s*([A-Z]{2})\b/);
    return m ? m[1] : '';
  }
  function haversineMi(a, b) {
    var R = 3958.8;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLon = (b.lon - a.lon) * Math.PI / 180;
    var la1 = a.lat * Math.PI / 180;
    var la2 = b.lat * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function timed(url, opts, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 12000);
    var o = opts || {};
    if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* full or private */ } }

  // ---------- windows ----------
  function mkDate(year, mo, d, h, mi) { return new Date(year, mo - 1, d, h || 0, mi || 0, 0, 0).getTime(); }
  function to24(h, m, ap) {
    h = Number(h); m = Number(m || 0);
    ap = String(ap || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return [h, m];
  }
  function yearFor(mo, ref) {
    var r = new Date(ref);
    var y = r.getFullYear();
    if (mo < r.getMonth() + 1 - 6) y += 1;
    if (mo > r.getMonth() + 1 + 6) y -= 1;
    return y;
  }
  // Returns {open, close, timed} in ms, or null when not listed.
  function parseWindow(text, ref) {
    var s = String(text || '').trim();
    if (!s) return null;
    var full = s.match(/(\d{1,2})\/(\d{1,2}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2})\/(\d{1,2}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (full) {
      var a = to24(full[3], full[4], full[5]);
      var b = to24(full[8], full[9], full[10]);
      var m1 = Number(full[1]);
      var m2 = Number(full[6]);
      return {
        open: mkDate(yearFor(m1, ref), m1, Number(full[2]), a[0], a[1]),
        close: mkDate(yearFor(m2, ref), m2, Number(full[7]), b[0], b[1]),
        timed: true
      };
    }
    var one = s.match(/(\d{1,2})\/(\d{1,2})/);
    if (one) {
      var mo = Number(one[1]);
      var y = yearFor(mo, ref);
      // Date only ("Ships 11/28"): plan on a 7 AM - 5 PM shipping day.
      return { open: mkDate(y, mo, Number(one[2]), 7, 0), close: mkDate(y, mo, Number(one[2]), 17, 0), timed: false };
    }
    return null;
  }

  // ---------- geocode / route / stops ----------
  function geocode(place) {
    var key = cityOnly(place).toLowerCase();
    var all = lsGet(GEO_KEY) || {};
    if (all[key]) return Promise.resolve(all[key]);
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(cityOnly(place));
    return timed(url, { headers: { 'Accept': 'application/json' } }, 10000).then(function (r) { return r.json(); }).then(function (js) {
      if (!js || !js[0]) return null;
      var pt = { lat: Number(js[0].lat), lon: Number(js[0].lon) };
      all = lsGet(GEO_KEY) || {};
      all[key] = pt;
      lsSet(GEO_KEY, all);
      return pt;
    }).catch(function () { return null; });
  }
  function geocodeAll(places) {
    var out = [];
    var all = lsGet(GEO_KEY) || {};
    var chain = Promise.resolve();
    places.forEach(function (p, i) {
      chain = chain.then(function () {
        if (p && p.coord) { out[i] = p.coord; return null; }
        var key = cityOnly(p.name).toLowerCase();
        if (all[key]) { out[i] = all[key]; return null; }
        return geocode(p.name).then(function (pt) { out[i] = pt; return sleep(1100); });
      });
    });
    return chain.then(function () { return out; });
  }
  function decodePolyline(str) {
    var idx = 0, lat = 0, lng = 0, pts = [];
    while (idx < str.length) {
      var b, shift = 0, result = 0;
      do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      pts.push({ lat: lat / 1e5, lon: lng / 1e5 });
    }
    return pts;
  }
  function osrmRoute(coords) {
    var key = coords.map(function (c) { return c.lat.toFixed(3) + ',' + c.lon.toFixed(3); }).join(';');
    var saved = lsGet(ROUTE_KEY) || {};
    if (saved.key === key && saved.route) return Promise.resolve(saved.route);
    var url = 'https://router.project-osrm.org/route/v1/driving/' +
      coords.map(function (c) { return c.lon.toFixed(5) + ',' + c.lat.toFixed(5); }).join(';') +
      '?overview=full&geometries=polyline&steps=false';
    return timed(url, {}, 15000).then(function (r) { return r.json(); }).then(function (js) {
      if (!js || js.code !== 'Ok' || !js.routes || !js.routes[0]) return null;
      var rt = js.routes[0];
      var route = {
        legs: rt.legs.map(function (l) { return l.distance / 1609.344; }),
        poly: rt.geometry
      };
      lsSet(ROUTE_KEY, { key: key, route: route });
      return route;
    }).catch(function () { return null; });
  }
  function loadJson(url, slot) {
    if (cache[slot]) return Promise.resolve(cache[slot]);
    return timed(url, {}, 15000).then(function (r) { return r.json(); }).then(function (js) { cache[slot] = js; return js; }).catch(function () { return null; });
  }

  // Cumulative miles along the line.
  function measure(pts) {
    var cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineMi(pts[i - 1], pts[i]));
    return cum;
  }
  function pointAt(pts, cum, mi) {
    if (!pts || !pts.length) return null;
    if (mi <= 0) return pts[0];
    for (var i = 1; i < pts.length; i++) {
      if (cum[i] >= mi) {
        var seg = cum[i] - cum[i - 1] || 1;
        var f = (mi - cum[i - 1]) / seg;
        return { lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * f, lon: pts[i - 1].lon + (pts[i].lon - pts[i - 1].lon) * f };
      }
    }
    return pts[pts.length - 1];
  }
  // Truck stops near the line, each with its route mile.
  function stopsOnRoute(pts, cum, stops, scale) {
    if (!pts || !pts.length || !stops) return [];
    var minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    pts.forEach(function (p) {
      if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
    });
    var pad = 0.3;
    var step = Math.max(1, Math.floor(pts.length / 4000));
    var out = [];
    stops.forEach(function (s) {
      var lat = Number(s.lat), lon = Number(s.lng != null ? s.lng : s.lon);
      if (!(lat >= minLat - pad && lat <= maxLat + pad && lon >= minLon - pad && lon <= maxLon + pad)) return;
      var best = 1e9, bi = -1;
      for (var i = 0; i < pts.length; i += step) {
        var dLat = (pts[i].lat - lat) * 69;
        var dLon = (pts[i].lon - lon) * 69 * Math.cos(lat * Math.PI / 180);
        var d2 = dLat * dLat + dLon * dLon;
        if (d2 < best) { best = d2; bi = i; }
      }
      var dist = Math.sqrt(best);
      if (dist <= STOP_NEAR_MI) out.push({ stop: s, mile: cum[bi] * scale, off: dist });
    });
    out.sort(function (a, b) { return a.mile - b.mile; });
    return out;
  }
  var BRAND = { loves: "Love's", ta: 'TA', 'ta-express': 'TA Express', petro: 'Petro' };
  function stopLabel(s) {
    var b = BRAND[s.brand] || s.brand || 'Truck stop';
    return b + (s.number ? ' #' + s.number : '') + ' ' + s.city + ', ' + s.state + (s.highway ? ' (' + s.highway + ')' : '');
  }

  // ---------- build the stop list ----------
  function truckAt() {
    var rec = lsGet(TRUCK_AT_KEY);
    if (rec && isFinite(Number(rec.lat)) && isFinite(Number(rec.lon))) {
      return { name: cityOnly(rec.label) || 'Truck location', coord: { lat: Number(rec.lat), lon: Number(rec.lon) }, truck: true };
    }
    return null;
  }
  function buildStops(item, data, ref) {
    var start = truckAt();
    if (!start) {
      var oc = data && data.origin_coord;
      start = {
        name: cityOnly(data && data.origin) || 'Scan origin',
        coord: oc && isFinite(Number(oc.lat)) ? { lat: Number(oc.lat), lon: Number(oc.lon) } : null,
        truck: false
      };
    }
    var list = [{ kind: 'start', name: start.name, coord: start.coord, truck: start.truck }];
    if (item.isCombo) {
      (item.combo.stop_order || []).forEach(function (s) {
        list.push({ kind: s.action === 'drop' ? 'drop' : 'pickup', name: s.place, lane: s.lane || '', win: parseWindow(s.window, ref), winText: s.window || '' });
      });
    } else {
      var r = item.row;
      list.push({ kind: 'pickup', name: r.origin, lane: '', win: parseWindow(r.pickup_window, ref), winText: r.pickup_window || '' });
      list.push({ kind: 'drop', name: r.destination, lane: '', win: parseWindow(r.drop_window, ref), winText: r.drop_window || '' });
    }
    return list;
  }

  // ---------- HOS simulation ----------
  // stops: list with kind/name/win; legs[i] = miles from stops[i] to stops[i+1].
  function simulate(stops, legs, firstArrive, nowMs) {
    var events = [];
    var nights = [];
    var fuels = [];
    var flags = [];
    var dh0 = legs[0] || 0;
    // Depart so we reach the first stop at firstArrive (never before now).
    var depart = firstArrive - (dh0 / MPH) * HR - 0.25 * HR;
    var driveHrs0 = dh0 / MPH;
    if (driveHrs0 > DRIVE_MAX) depart -= Math.floor(driveHrs0 / DRIVE_MAX) * REST_HRS * HR;
    if (depart < nowMs) depart = nowMs;
    var t = depart;
    var dutyStart = t, drive = 0, sinceBreak = 0, sinceFuel = 0, mile = 0;
    var totals = { drive: 0, loadedMi: 0, emptyMi: 0, waitHrs: 0 };
    events.push({ type: 'depart', t: t, mile: 0, name: stops[0].name });

    function rest(reason) {
      nights.push({ t: t, until: t + REST_HRS * HR, mile: mile, reason: reason });
      events.push({ type: 'rest', t: t, until: t + REST_HRS * HR, mile: mile, nightIdx: nights.length - 1 });
      if (sinceFuel >= 120) fuelUp(true);
      t += REST_HRS * HR;
      dutyStart = t; drive = 0; sinceBreak = 0;
    }
    function fuelUp(atNight) {
      fuels.push({ t: t, mile: mile, miles: sinceFuel, gal: sinceFuel / MPG, atNight: !!atNight });
      events.push({ type: 'fuel', t: t, mile: mile, fuelIdx: fuels.length - 1, atNight: !!atNight });
      sinceFuel = 0;
      if (!atNight) { t += FUEL_STOP_HRS * HR; sinceBreak = 0; }
    }
    function driveMiles(miles, loaded) {
      var left = miles;
      var guard = 0;
      while (left > 0.05 && guard++ < 500) {
        var windowLeft = (dutyStart + WINDOW_MAX * HR - t) / HR;
        var can = Math.min(DRIVE_MAX - drive, windowLeft, BREAK_AFTER - sinceBreak);
        if (DRIVE_MAX - drive <= 0.01 || windowLeft <= 0.01) { rest('hos'); continue; }
        if (BREAK_AFTER - sinceBreak <= 0.01) {
          if (sinceFuel >= FUEL_EVERY * 0.6) { fuelUp(false); continue; }
          events.push({ type: 'break', t: t, mile: mile });
          t += 0.5 * HR; sinceBreak = 0; continue;
        }
        var toFuel = FUEL_EVERY - sinceFuel;
        var miCan = Math.min(can * MPH, left, Math.max(0.1, toFuel));
        var h = miCan / MPH;
        t += h * HR; drive += h; sinceBreak += h; sinceFuel += miCan; mile += miCan; left -= miCan;
        totals.drive += h;
        if (loaded) totals.loadedMi += miCan; else totals.emptyMi += miCan;
        if (sinceFuel >= FUEL_EVERY - 0.05 && left > 25) fuelUp(false);
      }
    }
    var carrying = 0;
    for (var i = 1; i < stops.length; i++) {
      driveMiles(legs[i - 1] || 0, carrying > 0);
      var st = stops[i];
      var arrive = t;
      var ev = { type: st.kind, t: arrive, mile: mile, name: st.name, lane: st.lane, win: st.win, winText: st.winText, idx: i };
      if (st.win) {
        if (arrive < st.win.open) {
          var wait = (st.win.open - arrive) / HR;
          ev.wait = wait;
          totals.waitHrs += wait;
          if (wait >= REST_HRS) {
            t = st.win.open; dutyStart = t; drive = 0; sinceBreak = 0;
            ev.waitRest = true;
          } else if ((st.win.open - dutyStart) / HR + DOCK_HRS > WINDOW_MAX) {
            // Waiting would blow the 14 hr window: take the 10 hr off first.
            var restStart = t;
            nights.push({ t: restStart, until: restStart + REST_HRS * HR, mile: mile, reason: 'wait' });
            events.push({ type: 'rest', t: restStart, until: restStart + REST_HRS * HR, mile: mile, nightIdx: nights.length - 1 });
            t = Math.max(st.win.open, restStart + REST_HRS * HR); dutyStart = t; drive = 0; sinceBreak = 0;
          } else {
            t = st.win.open;
          }
        }
        if (arrive > st.win.close) { ev.late = (arrive - st.win.close) / HR; flags.push((st.kind === 'drop' ? 'Drop ' : 'Pickup ') + cityOnly(st.name) + ' ETA is ' + hrs(ev.late) + ' after the window closes - call the broker.'); }
      }
      ev.dockStart = t;
      if ((t - dutyStart) / HR + DOCK_HRS > WINDOW_MAX) { rest('window'); ev.dockStart = t; }
      t += DOCK_HRS * HR; sinceBreak = 0;
      ev.dockEnd = t;
      carrying += st.kind === 'pickup' ? 1 : -1;
      events.push(ev);
      if (i === stops.length - 1) break;
      if ((t - dutyStart) / HR >= WINDOW_MAX - 0.25 || DRIVE_MAX - drive <= 0.25) rest('hos');
    }
    events.push({ type: 'done', t: t, mile: mile });
    return { depart: depart, end: t, events: events, nights: nights, fuels: fuels, flags: flags, totals: totals };
  }

  // Pick the first-stop arrival so later windows line up (same idea as the
  // feed's days_span: pick up as late as the windows allow, drop at open).
  function planSchedule(stops, legs, nowMs) {
    var first = stops[1];
    var dhHrs = (legs[0] || 0) / MPH;
    var earliest = nowMs + (dhHrs + 0.25) * HR;
    if (dhHrs > DRIVE_MAX) earliest += Math.floor(dhHrs / DRIVE_MAX) * REST_HRS * HR;
    var target = first.win ? Math.max(first.win.open, earliest) : earliest;
    var sim = simulate(stops, legs, target, nowMs);
    for (var k = 0; k < 4; k++) {
      // First stop after the start with an early wait, and how far later we can go.
      var waitEv = null, slack = Infinity;
      for (var j = 0; j < sim.events.length; j++) {
        var e = sim.events[j];
        if (!(e.type === 'pickup' || e.type === 'drop')) continue;
        if (e.wait && e.wait > 0.25 && e.idx > 1) { waitEv = e; break; }
        if (e.win) slack = Math.min(slack, (e.win.close - DOCK_HRS * HR - e.t) / HR);
      }
      if (!waitEv) break;
      var shift = Math.min(waitEv.wait, slack);
      if (!(shift > 0.25)) break;
      target += shift * HR;
      sim = simulate(stops, legs, target, nowMs);
    }
    return sim;
  }

  // ---------- weather ----------
  var WX_LABEL = { sun: 'Sunny', partly: 'Partly cloudy', cloud: 'Cloudy', rain: 'Rain', thunder: 'Storms', snow: 'Snow', ice: 'Ice', fog: 'Fog', wind: 'Windy' };
  function wxKind(code, gust) {
    var c = code == null || code === '' ? null : Number(code);
    if (c === 45 || c === 48) return 'fog';
    if (c === 56 || c === 57 || c === 66 || c === 67) return 'ice';
    if (c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86) return 'snow';
    if (c === 95 || c === 96 || c === 99) return 'thunder';
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].indexOf(c) >= 0) return 'rain';
    var windy = gust != null && Number(gust) >= 40;
    if (windy) return 'wind';
    if (c === 3) return 'cloud';
    if (c === 2) return 'partly';
    if (c === 0 || c === 1) return 'sun';
    return c == null || !isFinite(c) ? '' : 'cloud';
  }
  function wxIcon(kind) {
    var k = String(kind || '');
    var cloud = '<path fill="#C4B5FD" d="M5.8 4.6A3.2 3.2 0 0 1 11.8 5.2 2.5 2.5 0 0 1 13.8 7.6 2.5 2.5 0 0 1 11.3 10.1H5.9A2.6 2.6 0 0 1 4.6 5a2.8 2.8 0 0 1 1.2-.4z"/>';
    var body = '';
    if (k === 'sun') body = '<circle cx="9" cy="9" r="3.15" fill="#F2C94C"/><g stroke="#F2C94C" stroke-width="1.45" stroke-linecap="round"><path d="M9 1.6v2M9 14.4v2M1.6 9h2M14.4 9h2M3.5 3.5l1.4 1.4M13.1 13.1l1.4 1.4M3.5 14.5l1.4-1.4M13.1 4.9l1.4-1.4"/></g>';
    else if (k === 'partly') body = '<circle cx="6.6" cy="6.2" r="2.3" fill="#F2C94C"/><path fill="#C4B5FD" d="M7.1 9.2a3.1 3.1 0 0 1 5.8.6 2.5 2.5 0 0 1 1.9 2.4 2.5 2.5 0 0 1-2.5 2.5H7.4A2.6 2.6 0 0 1 6.2 9.6a2.7 2.7 0 0 1 .9-.4z"/>';
    else if (k === 'cloud') body = '<path fill="#C4B5FD" d="M5.6 7.4A3.4 3.4 0 0 1 12 8a2.7 2.7 0 0 1 2.1 2.6A2.7 2.7 0 0 1 11.4 13.3H5.7A2.8 2.8 0 0 1 4.4 7.8a3 3 0 0 1 1.2-.4z"/>';
    else if (k === 'rain') body = cloud + '<g stroke="#60A5FA" stroke-width="1.4" stroke-linecap="round"><path d="M6.3 11.6l-.8 2.6M9.2 11.6l-.8 2.6M12.1 11.6l-.8 2.6"/></g>';
    else if (k === 'thunder') body = cloud + '<path fill="#F2C94C" d="M10.3 9.2H8.2l1.15 3.05H7.4L11.1 8.1H9.15z"/>';
    else if (k === 'snow') body = cloud + '<g stroke="#BFDBFE" stroke-width="1.15" stroke-linecap="round"><path d="M6.1 11.5v3.1M4.6 13.05h3M9 11.5v3.1M7.5 13.05h3M11.9 11.5v3.1M10.4 13.05h3"/></g>';
    else if (k === 'ice') body = cloud + '<g stroke="#93C5FD" stroke-width="1.4" stroke-linecap="round"><path d="M6.2 11.2l-.6 3M9 11.2l-.6 3.4M11.9 11.2l-.6 3"/></g>';
    else if (k === 'fog') body = '<g fill="none" stroke="#C4B5FD" stroke-width="1.5" stroke-linecap="round"><path d="M3.2 6.2h9.2M5 9h9.8M3.6 11.8h8.6M6.2 14.4h7.2"/></g>';
    else if (k === 'wind') body = '<g fill="none" stroke="#E9D5FF" stroke-width="1.5" stroke-linecap="round"><path d="M3 6.2h8.2a2 2 0 1 0-2-2M3 9.4h10.2a2 2 0 1 1-2 2M3 12.6h6.5"/></g>';
    if (!body) return '';
    return '<span class="tp-ico" title="' + esc(WX_LABEL[k] || '') + '"><svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">' + body + '</svg></span>';
  }
  // Open-Meteo daily for several points in one call.
  function fetchWeather(points) {
    var ok = points.filter(function (p) { return p && p.coord; });
    if (!ok.length) return Promise.resolve(null);
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + ok.map(function (p) { return p.coord.lat.toFixed(3); }).join(',') +
      '&longitude=' + ok.map(function (p) { return p.coord.lon.toFixed(3); }).join(',') +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,wind_gusts_10m_max,precipitation_probability_max' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago&forecast_days=16';
    return timed(url, {}, 12000).then(function (r) { return r.json(); }).then(function (js) {
      var arr = Array.isArray(js) ? js : [js];
      ok.forEach(function (p, i) {
        var d = arr[i] && arr[i].daily;
        if (!d || !d.time) return;
        var j = d.time.indexOf(p.date);
        if (j < 0) return;
        p.wx = {
          code: d.weather_code[j], high: Math.round(d.temperature_2m_max[j]), low: Math.round(d.temperature_2m_min[j]),
          gust: d.wind_gusts_10m_max ? Math.round(d.wind_gusts_10m_max[j]) : null,
          pop: d.precipitation_probability_max ? d.precipitation_probability_max[j] : null, src: 'forecast'
        };
      });
      return true;
    }).catch(function () { return null; });
  }
  // Fallback: nearest cached route weather point (by route fraction, then date).
  function cachedWx(item, frac, date) {
    var src = item.isCombo ? item.combo : item.row;
    var pts = (src && src.route_wx && src.route_wx.points) || [];
    if (!pts.length) return null;
    var idx = Math.round(frac * (pts.length - 1));
    var p = pts[Math.max(0, Math.min(pts.length - 1, idx))];
    return { code: p.weather_code, high: p.high_f, low: p.low_f, gust: p.gust_mph, pop: p.precip_chance, src: 'cached ' + (p.place || ''), date: p.date };
  }

  // ---------- full plan ----------
  function buildPlan(item, data, onStatus) {
    var nowMs = Date.now();
    var refMs = nowMs;
    var stops = buildStops(item, data, refMs);
    var status = onStatus || function () {};
    var notes = [];
    status('Finding the towns...');
    return Promise.all([
      loadJson('data/stops.json', 'stops'),
      loadJson('data/diesel_prices.json', 'diesel'),
      geocodeAll(stops)
    ]).then(function (res) {
      var stopData = res[0] && res[0].stops ? res[0].stops : [];
      var diesel = res[1];
      var coords = res[2];
      stops.forEach(function (s, i) { if (!s.coord && coords[i]) s.coord = coords[i]; });
      var haveAll = stops.every(function (s) { return s.coord; });
      status('Routing...');
      return (haveAll ? osrmRoute(stops.map(function (s) { return s.coord; })) : Promise.resolve(null)).then(function (route) {
        var legs = [];
        var pts = null, cum = null, scale = 1;
        if (route) {
          legs = route.legs.slice();
          pts = decodePolyline(route.poly);
          cum = measure(pts);
          var routeMi = legs.reduce(function (a, b) { return a + b; }, 0);
          scale = cum[cum.length - 1] ? routeMi / cum[cum.length - 1] : 1;
        } else {
          notes.push('Road routing was not reachable, so miles come from the load board and town names come from the weather points.');
        }
        // Single load: keep the card's posted miles so totals match the card.
        if (!item.isCombo) {
          var r = item.row;
          var dh = stops[0].truck ? (legs[0] != null ? legs[0] : r.origin_dh_mi) : (r.origin_dh_mi != null ? Number(r.origin_dh_mi) : legs[0]);
          var lm = r.trip_mi != null ? Number(r.trip_mi) : legs[1];
          if (route && legs[0] + legs[1] > 0) scale *= ((dh || 0) + (lm || 0)) / (legs[0] + legs[1]);
          legs = [dh || 0, lm || 0];
        } else if (!route) {
          legs = fallbackComboLegs(item.combo, stops);
        }
        var sim = planSchedule(stops, legs, nowMs);
        var totalMi = legs.reduce(function (a, b) { return a + b; }, 0);
        var onRoute = pts ? stopsOnRoute(pts, cum, stopData, scale) : [];
        var priceFor = function (st) {
          var region = diesel && diesel.state_to_region ? diesel.state_to_region[st] : null;
          var reg = region && diesel.eia && diesel.eia.regions ? diesel.eia.regions[region] : null;
          var prem = diesel && isFinite(Number(diesel.pump_premium_usd_gal)) ? Number(diesel.pump_premium_usd_gal) : 0;
          if (reg && isFinite(Number(reg.usd_gal))) return { price: Number(reg.usd_gal) + prem, src: 'EIA ' + reg.name };
          var f = (item.isCombo ? (item.combo.loads && item.combo.loads[0] && item.combo.loads[0].fuel) : item.row.fuel) || {};
          if (f.diesel_usd_gal) return { price: Number(f.diesel_usd_gal), src: f.diesel_source || 'card diesel' };
          return { price: 5.6, src: 'EST' };
        };
        var wxPts = (item.isCombo ? item.combo : item.row).route_wx;
        wxPts = wxPts && wxPts.points ? wxPts.points : [];
        function placeAt(mile, lo, hi, wantNight) {
          // Best truck stop in [mile-lo, mile+hi] on the route, latest first.
          var cands = onRoute.filter(function (o) { return o.mile >= mile - lo && o.mile <= mile + hi; });
          if (cands.length) {
            cands.sort(function (a, b) { return (b.mile - a.mile) - (wantNight ? (b.stop.parking || 0) / 2000 - (a.stop.parking || 0) / 2000 : 0); });
            var c = cands[0];
            return { town: c.stop.city + ', ' + c.stop.state, state: c.stop.state, stop: c.stop, label: stopLabel(c.stop), mile: c.mile, coord: { lat: Number(c.stop.lat), lon: Number(c.stop.lng) } };
          }
          var coord = pts ? pointAt(pts, cum, mile / scale) : null;
          var town = '';
          if (wxPts.length && totalMi) {
            var idx = Math.round((mile / totalMi) * (wxPts.length - 1));
            town = wxPts[Math.max(0, Math.min(wxPts.length - 1, idx))].place || '';
          }
          return { town: town || ('mile ' + Math.round(mile)), state: stateOf(town), stop: null, label: '', mile: mile, coord: coord, needName: !!coord };
        }
        sim.fuels.forEach(function (f) {
          var p = placeAt(f.mile, f.atNight ? 30 : 60, f.atNight ? 10 : 0, false);
          f.place = p;
          var pr = priceFor(p.state);
          f.price = pr.price; f.priceSrc = pr.src; f.cost = f.gal * pr.price;
        });
        sim.nights.forEach(function (n) {
          var atStop = null;
          sim.events.forEach(function (e) { if ((e.type === 'pickup' || e.type === 'drop') && Math.abs(e.mile - n.mile) < 1) atStop = e; });
          n.place = atStop ? { town: cityOnly(atStop.name), state: stateOf(atStop.name), stop: null, label: '', mile: n.mile, coord: stops[atStop.idx].coord, atDock: true }
            : placeAt(n.mile, 40, 5, true);
          if (atStop) {
            var near = onRoute.filter(function (o) { return Math.abs(o.mile - n.mile) < 25; }).sort(function (a, b) { return Math.abs(a.mile - n.mile) - Math.abs(b.mile - n.mile); })[0];
            if (near) n.place.label = stopLabel(near.stop);
          }
          // Fuel at night follows the night town.
          sim.fuels.forEach(function (f) { if (f.atNight && Math.abs(f.t - n.t) < 60000) { f.place = n.place; var pr = priceFor(n.place.state); f.price = pr.price; f.priceSrc = pr.src; f.cost = f.gal * pr.price; } });
        });
        status('Truck stops and weather...');
        return Promise.all([
          nameUnknown(sim.fuels.map(function (f) { return f.place; }).concat(sim.nights.map(function (n) { return n.place; }))),
          loadJson('data/pilot_fj.json', 'pfj')
        ]).then(function (r2) {
          nearChains(sim.nights, [stopData, r2[1] && r2[1].stops]);
          var days = groupDays(sim, stops, item, totalMi);
          var wxReq = days.map(function (d) { return { coord: d.wxCoord, date: d.key }; });
          return fetchWeather(wxReq).then(function () {
            days.forEach(function (d, i) {
              d.wx = wxReq[i].wx || cachedWx(item, totalMi ? d.endMile / totalMi : 1, d.key);
            });
            // Price the fuel still in the tank at the end (refill after the trip).
            var leftMi = sim.totals.loadedMi + sim.totals.emptyMi - sim.fuels.reduce(function (a, f) { return a + f.miles; }, 0);
            var lastSt = stateOf(stops[stops.length - 1].name);
            var lastPr = priceFor(lastSt);
            var fuelBought = sim.fuels.reduce(function (a, f) { return a + f.cost; }, 0);
            var refill = Math.max(0, leftMi) / MPG * lastPr.price;
            var def = (sim.totals.loadedMi + sim.totals.emptyMi) * DEF_PER_MI;
            var src = item.isCombo ? item.combo : item.row;
            var feedDays = src.days_span != null ? Number(src.days_span) : (src.days != null ? Number(src.days) : null);
            var planDays = Math.round((startOfDay(sim.end) - startOfDay(sim.depart)) / (24 * HR)) + 1;
            return {
              item: item, stops: stops, legs: legs, sim: sim, days: days, notes: notes,
              totals: {
                drive: sim.totals.drive, loadedMi: sim.totals.loadedMi, emptyMi: sim.totals.emptyMi, waitHrs: sim.totals.waitHrs,
                fuelBought: fuelBought, refill: refill, fuelAll: fuelBought + refill, def: def,
                net: src.net_est != null ? Number(src.net_est) : null,
                rate: item.isCombo ? src.posted_rate : src.posted_rate,
                feedDays: feedDays, planDays: planDays,
                perDay: src.net_est != null && feedDays ? Number(src.net_est) / feedDays : null,
                perPlanDay: src.net_est != null && planDays ? Number(src.net_est) / planDays : null
              }
            };
          });
        });
      });
    });
  }
  function fallbackComboLegs(combo, stops) {
    var out = [];
    for (var i = 1; i < stops.length; i++) {
      if (stops[i - 1].coord && stops[i].coord) out.push(haversineMi(stops[i - 1].coord, stops[i].coord) * 1.2);
      else if (i === 1) out.push(Number(combo.deadhead_mi) || 0);
      else out.push((Number(combo.loaded_mi) || 0) / Math.max(1, stops.length - 2));
    }
    return out;
  }
  // Reverse-geocode places with no truck stop and no town name.
  function nameUnknown(places) {
    var chain = Promise.resolve();
    var all = lsGet(GEO_KEY) || {};
    places.forEach(function (p) {
      if (!p || !p.needName || !p.coord) return;
      chain = chain.then(function () {
        var k = 'rev:' + p.coord.lat.toFixed(2) + ',' + p.coord.lon.toFixed(2);
        if (all[k]) { p.town = all[k]; p.state = stateOf(all[k]); return null; }
        var url = 'https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=' + p.coord.lat.toFixed(4) + '&lon=' + p.coord.lon.toFixed(4);
        return timed(url, { headers: { 'Accept': 'application/json' } }, 8000).then(function (r) { return r.json(); }).then(function (js) {
          var a = js && js.address;
          if (!a) return;
          var town = String(a.city || a.town || a.village || a.hamlet || a.county || '').replace(/^(Town|Village|City) of /i, '');
          var st = (a['ISO3166-2-lvl4'] || '').replace('US-', '');
          if (town) { p.town = town + (st ? ', ' + st : ''); p.state = st; all[k] = p.town; lsSet(GEO_KEY, all); }
        }).catch(function () {}).then(function () { return sleep(1100); });
      });
    });
    return chain;
  }
  // Truck stop chains within 15 mi of each overnight: Love's / TA / Petro
  // (data/stops.json) plus Pilot / Flying J (data/pilot_fj.json, from OSM).
  var CHAIN = { loves: "Love's", ta: 'TA', 'ta-express': 'TA Express', petro: 'Petro', pilot: 'Pilot', 'flying-j': 'Flying J' };
  function nearChains(nights, lists) {
    nights.forEach(function (n) {
      if (!n.place || !n.place.coord) return;
      var found = {};
      lists.forEach(function (list) {
        (list || []).forEach(function (s) {
          var lat = Number(s.lat), lon = Number(s.lng != null ? s.lng : s.lon);
          if (!isFinite(lat) || Math.abs(lat - n.place.coord.lat) > 0.3) return;
          var d = haversineMi(n.place.coord, { lat: lat, lon: lon });
          if (d > 15) return;
          var label = CHAIN[s.brand] || '';
          if (!label) return;
          if (n.place.stop && n.place.stop.brand === s.brand && d < 0.5) return;
          if (found[label] == null || found[label] > d) found[label] = d;
        });
      });
      n.chains = Object.keys(found).sort(function (a, b) { return found[a] - found[b]; }).map(function (k) { return k + ' ' + (found[k] < 1 ? '<1' : Math.round(found[k])) + ' mi'; });
    });
  }

  // ---------- group into days ----------
  function groupDays(sim, stops, item, totalMi) {
    var days = [];
    var cur = null;
    function open(ms) {
      var k = dayKey(ms);
      if (cur && cur.key === k) return cur;
      cur = { key: k, date: dateStr(ms), items: [], drive: 0, startMile: null, endMile: 0, night: null, wxCoord: null };
      days.push(cur);
      return cur;
    }
    var prevT = null, prevMile = 0;
    sim.events.forEach(function (e) {
      var d = open(e.t);
      if (d.startMile == null) d.startMile = e.mile;
      d.endMile = Math.max(d.endMile, e.mile);
      if (e.type === 'rest') {
        var n = sim.nights[e.nightIdx];
        d.night = n;
        d.items.push({ t: e.t, kind: 'rest', ev: e, night: n });
        if (n.place && n.place.coord) d.wxCoord = n.place.coord;
        var d2 = open(e.until);
        if (d2 !== d) d2.startMile = e.mile;
        d2.items.push({ t: e.until, kind: 'roll', ev: e, night: n });
      } else {
        d.items.push({ t: e.t, kind: e.type, ev: e });
        if ((e.type === 'pickup' || e.type === 'drop') && stops[e.idx].coord) d.wxCoord = stops[e.idx].coord;
      }
      prevT = e.t; prevMile = e.mile;
    });
    // Drive hours per day from mileage change (good enough at a flat 50 mph).
    days.forEach(function (d) {
      d.miles = Math.max(0, d.endMile - (d.startMile || 0));
      d.drive = d.miles / MPH;
      if (!d.wxCoord) {
        var last = stops[stops.length - 1];
        d.wxCoord = last.coord || null;
      }
    });
    return days;
  }

  // ---------- render ----------
  function evTitle(it, plan) {
    var e = it.ev;
    if (it.kind === 'depart') return 'Depart ' + cityOnly(e.name) + (plan.stops[0].truck ? ' (saved truck location)' : ' (scan origin)');
    if (it.kind === 'pickup' || it.kind === 'drop') return (it.kind === 'pickup' ? 'Pickup ' : 'Drop ') + cityOnly(e.name);
    if (it.kind === 'fuel') {
      var f = plan.sim.fuels[e.fuelIdx];
      return 'Fuel ' + (f.place.label || f.place.town) + ' - ' + num(f.gal, 0) + ' gal x $' + f.price.toFixed(2) + ' = ' + money(f.cost);
    }
    if (it.kind === 'break') return '30 min break';
    if (it.kind === 'rest') return 'Stop for the night: ' + nightName(it.night);
    if (it.kind === 'roll') return 'Roll after 10 hr off';
    if (it.kind === 'done') return 'Empty and done';
    return it.kind;
  }
  function nightName(n) {
    if (!n || !n.place) return 'on route';
    var p = n.place;
    var s = p.atDock ? p.town + ' (at the dock)' : p.town;
    if (p.label && !p.atDock) s = p.label;
    return s;
  }
  function nightChains(n) {
    if (!n) return '';
    var bits = [];
    if (n.place && n.place.atDock && n.place.label) bits.push(n.place.label);
    if (n.chains && n.chains.length) bits.push('Within 15 mi: ' + n.chains.join(', '));
    return bits.join('. ');
  }
  function stopDetail(e) {
    var bits = [];
    var w = e.win;
    if (e.winText) bits.push('Window ' + e.winText.replace(/^Ships /, 'ships '));
    else bits.push('No window posted');
    if (e.wait && e.wait > 0.05) bits.push('Early: wait ' + hrs(e.wait) + (e.waitRest ? ' (counts as 10 hr off)' : ''));
    if (e.late) bits.push('LATE by ' + hrs(e.late));
    if (w && !w.timed) bits.push('time not listed, plan 7 AM - 5 PM');
    bits.push((e.type === 'pickup' ? 'Load ' : 'Unload ') + timeStr(e.dockStart) + ' - ' + timeStr(e.dockEnd));
    return bits.join(' | ');
  }
  function wxLine(d) {
    var w = d.wx;
    if (!w) return { html: '<span class="tp-wx-none">No forecast yet</span>', text: 'no forecast yet', cold: false };
    var kind = wxKind(w.code, w.gust);
    var cold = w.low != null && Number(w.low) <= COLD_F;
    var t = (WX_LABEL[kind] || 'Weather') + ', ' + (w.high != null ? w.high + ' F / ' : '') + 'low ' + w.low + ' F' +
      (w.gust != null && w.gust >= 30 ? ', gusts ' + w.gust + ' mph' : '') +
      (w.pop != null && w.pop >= 40 ? ', ' + w.pop + '% precip' : '');
    var srcTxt = w.src === 'forecast' ? '' : ' (' + w.src + ')';
    return {
      html: wxIcon(kind) + '<span>' + esc(t + srcTxt) + '</span>' + (cold ? '<span class="tp-cold">' + (d.night ? 'Cold night - 45 F or below, plan for idling or a heated stop' : 'Low of 45 F or below - cold idling weather') + '</span>' : ''),
      text: t + srcTxt + (cold ? (d.night ? ' - COLD NIGHT (45 F or below), plan for idling' : ' - COLD (low 45 F or below)') : ''),
      cold: cold
    };
  }
  function titleFor(item) {
    if (item.isCombo) {
      var so = item.combo.stop_order || [];
      return item.label + ': ' + so.map(function (s) { return cityOnly(s.place); }).join(' > ');
    }
    return cityOnly(item.row.origin) + ' to ' + cityOnly(item.row.destination);
  }
  function renderPlan(plan) {
    var T = plan.totals;
    var item = plan.item;
    var src = item.isCombo ? item.combo : item.row;
    var h = '';
    h += '<p class="tp-sub">' + esc(item.isCombo ? (item.combo.kind === 'shared' ? 'Shared deck combo' : 'Chain') + ', ' + (item.combo.loads || []).length + ' loads' : (item.row.board || '') + (item.row.load_number ? ' load ' + item.row.load_number : '')) +
      (src.posted_rate != null ? ' | ' + money(src.posted_rate) : '') + (src.net_est != null ? ' | Net EST ' + money(src.net_est) : '') + '</p>';
    h += '<div class="tp-start"><b>Start:</b> leave ' + esc(cityOnly(plan.stops[0].name)) + ' ' + esc(stamp(plan.sim.depart)) +
      '. ' + num(plan.legs[0], 0) + ' mi empty to ' + esc(cityOnly(plan.stops[1].name)) + ' (' + hrs(plan.legs[0] / MPH) + ').</div>';
    if (item.isCombo) {
      var between = [];
      for (var i = 2; i < plan.stops.length; i++) {
        between.push(cityOnly(plan.stops[i - 1].name) + ' > ' + cityOnly(plan.stops[i].name) + ' ' + num(plan.legs[i - 1], 0) + ' mi');
      }
      h += '<div class="tp-start"><b>Legs:</b> ' + esc(between.join('; ')) + '</div>';
    }
    if (plan.sim.flags.length) h += '<div class="tp-flags">' + plan.sim.flags.map(function (f) { return '<p>' + esc(f) + '</p>'; }).join('') + '</div>';
    plan.days.forEach(function (d, i) {
      var wx = wxLine(d);
      h += '<section class="tp-day' + (wx.cold ? ' cold' : '') + '"><div class="tp-day-h"><span>Day ' + (i + 1) + ' - ' + esc(d.date) + '</span><span class="tp-day-mi">' + num(d.miles, 0) + ' mi | ' + hrs(d.drive) + ' drive</span></div>';
      h += '<div class="tp-wx">' + wx.html + '</div><ol class="tp-list">';
      d.items.forEach(function (it) {
        var e = it.ev;
        var cls = 'tp-ev tp-' + it.kind + (e.late ? ' late' : '') + (e.wait > 0.05 ? ' wait' : '');
        h += '<li class="' + cls + '"><span class="tp-t">' + esc(timeStr(it.kind === 'roll' ? e.until : it.t)) + '</span><span class="tp-x"><b>' + esc(evTitle(it, plan)) + '</b>';
        if (it.kind === 'pickup' || it.kind === 'drop') h += '<small>' + esc(stopDetail(e)) + (e.lane ? ' | ' + esc(e.lane) : '') + '</small>';
        if (it.kind === 'rest') {
          var ch = nightChains(it.night);
          h += '<small>Mile ' + num(e.mile, 0) + '. 10 hr off until ' + esc(stamp(e.until)) + (ch ? '. ' + esc(ch) : '') + '</small>';
        }
        if (it.kind === 'fuel' && plan.sim.fuels[e.fuelIdx].atNight) h += '<small>Top off at the overnight stop</small>';
        if (it.kind === 'fuel' && !plan.sim.fuels[e.fuelIdx].atNight) h += '<small>Mile ' + num(e.mile, 0) + ' | 30 min, counts as the break | ' + esc(plan.sim.fuels[e.fuelIdx].priceSrc) + '</small>';
        h += '</span></li>';
      });
      h += '</ol></section>';
    });
    h += '<div class="tp-totals"><h3>Totals</h3><dl>' +
      row('Drive time', hrs(T.drive) + ' at ' + MPH + ' mph') +
      row('Loaded miles', num(T.loadedMi, 0)) +
      row('Empty miles', num(T.emptyMi, 0)) +
      (T.waitHrs > 0.05 ? row('Waiting at docks', hrs(T.waitHrs)) : '') +
      row('Fuel stops', plan.sim.fuels.length + ' stops, ' + money(T.fuelBought)) +
      row('Fuel EST (all miles)', money(T.fuelAll) + ' + DEF ' + money(T.def)) +
      row('Net EST', money(T.net)) +
      row('Days', (T.feedDays != null ? T.feedDays + ' (card)' : '-') + ' | ' + T.planDays + ' on this plan') +
      row('$/day', money(T.perDay) + (T.perPlanDay != null && T.planDays !== T.feedDays ? ' (' + money(T.perPlanDay) + ' on plan days)' : '')) +
      '</dl></div>';
    var notes = plan.notes.slice();
    notes.push('Times are CT on the phone clock. Fuel every ~' + FUEL_EVERY + ' mi (' + TANK_GAL + ' gal x ' + MPG + ' mpg = ' + (TANK_GAL * MPG) + ' mi range), EIA diesel by state. Truck stops: Love\'s/TA/Petro locator list, Pilot/Flying J from OpenStreetMap. Weather: Open-Meteo for each night town. Check parking and road conditions before rolling.');
    h += '<p class="tp-note">' + esc(notes.join(' ')) + '</p>';
    return h;
    function row(k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>'; }
  }
  function plainText(plan) {
    var T = plan.totals;
    var item = plan.item;
    var src = item.isCombo ? item.combo : item.row;
    var L = [];
    L.push('TRIP PLAN - ' + titleFor(item));
    L.push('Rig: 2026 Ram 3500 dually + Big Tex 40 ft gooseneck');
    if (src.posted_rate != null) L.push('Rate ' + money(src.posted_rate) + (src.net_est != null ? ' | Net EST ' + money(src.net_est) : ''));
    L.push('');
    L.push('START: leave ' + cityOnly(plan.stops[0].name) + ' ' + stamp(plan.sim.depart) + ', ' + num(plan.legs[0], 0) + ' mi empty to ' + cityOnly(plan.stops[1].name));
    if (item.isCombo) {
      for (var li = 2; li < plan.stops.length; li++) {
        L.push('LEG: ' + cityOnly(plan.stops[li - 1].name) + ' > ' + cityOnly(plan.stops[li].name) + ' ' + num(plan.legs[li - 1], 0) + ' mi');
      }
    }
    plan.sim.flags.forEach(function (f) { L.push('!! ' + f); });
    plan.days.forEach(function (d, i) {
      L.push('');
      L.push('DAY ' + (i + 1) + ' - ' + d.date + ' (' + num(d.miles, 0) + ' mi, ' + hrs(d.drive) + ' drive)');
      L.push('Weather: ' + wxLine(d).text);
      d.items.forEach(function (it) {
        var e = it.ev;
        var t = timeStr(it.kind === 'roll' ? e.until : it.t);
        var line = t + '  ' + evTitle(it, plan);
        if (it.kind === 'pickup' || it.kind === 'drop') line += '\n          ' + stopDetail(e);
        if (it.kind === 'rest') {
          var ch = nightChains(it.night);
          line += '\n          10 hr off until ' + stamp(e.until) + (ch ? '\n          ' + ch : '');
        }
        L.push(line);
      });
    });
    L.push('');
    L.push('TOTALS');
    L.push('Drive ' + hrs(T.drive) + ' | Loaded ' + num(T.loadedMi, 0) + ' mi | Empty ' + num(T.emptyMi, 0) + ' mi' + (T.waitHrs > 0.05 ? ' | Wait ' + hrs(T.waitHrs) : ''));
    L.push('Fuel EST ' + money(T.fuelAll) + ' (' + plan.sim.fuels.length + ' stops ' + money(T.fuelBought) + ') + DEF ' + money(T.def));
    L.push('Net EST ' + money(T.net) + ' | ' + (T.feedDays != null ? T.feedDays : T.planDays) + ' days | ' + money(T.perDay != null ? T.perDay : T.perPlanDay) + '/day');
    L.push('Plan only - confirm times with the broker and check parking before rolling.');
    // Plain ASCII for WhatsApp.
    return L.join('\n').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/[^\x0A\x20-\x7E]/g, '');
  }

  // ---------- sheet UI ----------
  var CSS = '' +
    '.search-actions .trip-plan-btn,.trip-plan-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:8px 12px;border-radius:10px;border:1px solid var(--purple,#a78bfa);background:rgba(167,139,250,0.12);color:var(--purple-hi,#c4b5fd);font-family:var(--body);font-size:14px;font-weight:600;white-space:nowrap;cursor:pointer}' +
    '.trip-plan-btn svg{width:16px;height:16px;flex:0 0 16px}' +
    '#tripplan .sheet-inner{padding-bottom:28px}' +
    '#tripplan h2{margin-bottom:4px}' +
    '.tp-sub{color:var(--muted,#b9b3cc)!important;font-size:14px!important;margin:4px 0 10px}' +
    '.tp-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px}' +
    '.tp-actions .btn{min-height:40px}' +
    '.tp-status{font-size:14px;color:var(--muted,#b9b3cc)}' +
    '.tp-start{background:var(--surface,#1a1726);border:1px solid var(--line,#2e2940);border-radius:10px;padding:10px 12px;margin:8px 0;font-size:15px;line-height:1.45}' +
    '.tp-flags{background:#3b0d1c;border:1px solid #9F1239;border-radius:10px;padding:8px 12px;margin:8px 0}.tp-flags p{color:#FECACA!important;font-size:14px!important;margin:4px 0}' +
    '.tp-day{border:1px solid var(--line,#2e2940);border-left:4px solid var(--purple,#a78bfa);border-radius:10px;margin:12px 0;padding:10px 12px;background:var(--surface,#1a1726)}' +
    '.tp-day.cold{border-left-color:#60A5FA}' +
    '.tp-day-h{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-weight:800;color:var(--gold,#F2C94C);font-size:15px}' +
    '.tp-day-mi{color:var(--muted,#b9b3cc);font-weight:600;font-size:13px}' +
    '.tp-wx{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0 4px;font-size:14px;color:var(--cream,#f2f0f7)}' +
    '.tp-ico{display:inline-flex;width:18px;height:18px}.tp-ico svg{width:18px!important;height:18px!important;margin:0!important}' +
    '.tp-cold{display:block;width:100%;color:#BFDBFE;font-size:13px;font-weight:700}' +
    '.tp-list{list-style:none;margin:6px 0 0!important;padding:0!important}' +
    '.tp-ev{display:flex;gap:10px;margin:7px 0!important;font-size:14px!important;line-height:1.35}' +
    '.tp-t{flex:0 0 66px;color:var(--muted,#b9b3cc);font-variant-numeric:tabular-nums;font-size:13px;padding-top:1px}' +
    '.tp-x{flex:1;min-width:0}.tp-x b{font-weight:700;color:var(--cream,#f2f0f7)}.tp-x small{display:block;color:var(--muted,#b9b3cc);font-size:12.5px;margin-top:2px}' +
    '.tp-pickup b,.tp-drop b{color:var(--gold,#F2C94C)}.tp-rest b{color:#93C5FD}.tp-fuel b{color:#A7F3D0}' +
    '.tp-ev.late small{color:#FCA5A5}.tp-ev.wait small{color:#FDE68A}' +
    '.tp-totals{border:1px solid var(--line,#2e2940);border-radius:10px;padding:10px 12px;margin-top:12px}.tp-totals h3{margin:0 0 6px;font-size:14px;color:var(--gold,#F2C94C);text-transform:uppercase;letter-spacing:1px}' +
    '.tp-totals dl{margin:0}.tp-totals dl div{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--line,#2e2940);font-size:14px}.tp-totals dt{color:var(--muted,#b9b3cc)}.tp-totals dd{margin:0;text-align:right;font-weight:700}' +
    '.tp-note{font-size:12.5px!important;color:var(--muted,#b9b3cc)!important;margin-top:10px}' +
    '@media print{html.tp-print body>*:not(#tripplan){display:none!important}html.tp-print #tripplan{position:static!important;background:#fff!important;color:#000!important;padding:0!important;overflow:visible!important}' +
    'html.tp-print #tripplan *{color:#000!important;background:transparent!important;border-color:#999!important}html.tp-print .tp-actions,html.tp-print .sheet-top{display:none!important}html.tp-print .tp-day{break-inside:avoid}}';

  function injectCss() {
    if (document.getElementById('tripplan-css')) return;
    var st = document.createElement('style');
    st.id = 'tripplan-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  function ensureSheet() {
    var el = document.getElementById('tripplan');
    if (el) return el;
    injectCss();
    el = document.createElement('div');
    el.id = 'tripplan';
    el.className = 'sheet tripplan';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'tripplan-title');
    el.hidden = true;
    el.innerHTML = '<div class="sheet-inner">' +
      '<div class="sheet-top"><button type="button" class="about-btn" id="tripplan-close">Close</button></div>' +
      '<h2 id="tripplan-title">Trip plan</h2>' +
      '<div class="tp-actions"><button type="button" class="btn primary" id="tripplan-copy" disabled>Copy for WhatsApp</button>' +
      '<button type="button" class="btn" id="tripplan-print" disabled>Print</button><span class="tp-status" id="tripplan-status"></span></div>' +
      '<div id="tripplan-body"></div></div>';
    document.body.appendChild(el);
    document.getElementById('tripplan-close').addEventListener('click', closeSheet);
    document.getElementById('tripplan-copy').addEventListener('click', function () {
      if (!current) return;
      copyText(plainText(current)).then(function (ok) {
        setStatus(ok ? 'Copied. Paste it in WhatsApp.' : 'Copy blocked - long-press the text below.');
        if (!ok) showPlainBox();
      });
    });
    document.getElementById('tripplan-print').addEventListener('click', function () {
      document.documentElement.classList.add('tp-print');
      setTimeout(function () { window.print(); }, 50);
    });
    window.addEventListener('afterprint', function () { document.documentElement.classList.remove('tp-print'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !el.hidden) closeSheet(); });
    return el;
  }
  var current = null;
  var reqSeq = 0;
  function setStatus(t) { var s = document.getElementById('tripplan-status'); if (s) s.textContent = t || ''; }
  function showPlainBox() {
    var body = document.getElementById('tripplan-body');
    if (!body || document.getElementById('tripplan-plain')) return;
    var ta = document.createElement('textarea');
    ta.id = 'tripplan-plain';
    ta.readOnly = true;
    ta.style.cssText = 'width:100%;min-height:240px;font:13px/1.4 monospace;margin-top:10px';
    ta.value = plainText(current);
    body.insertBefore(ta, body.firstChild);
    ta.focus(); ta.select();
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function closeSheet() {
    var el = document.getElementById('tripplan');
    if (!el) return;
    el.hidden = true;
    document.documentElement.classList.remove('sheet-open');
    document.documentElement.classList.remove('tp-print');
  }
  function openFor(item, data) {
    var el = ensureSheet();
    var seq = ++reqSeq;
    current = null;
    document.getElementById('tripplan-title').textContent = 'Trip plan: ' + titleFor(item);
    document.getElementById('tripplan-copy').disabled = true;
    document.getElementById('tripplan-print').disabled = true;
    document.getElementById('tripplan-body').innerHTML = '<p class="tp-sub">Building the plan (routing, truck stops, weather)...</p>';
    setStatus('');
    el.hidden = false;
    el.scrollTop = 0;
    document.documentElement.classList.add('sheet-open');
    buildPlan(item, data, function (s) { if (seq === reqSeq) setStatus(s); }).then(function (plan) {
      if (seq !== reqSeq) return;
      current = plan;
      window.__lastTripPlan = plan;
      document.getElementById('tripplan-body').innerHTML = renderPlan(plan);
      document.getElementById('tripplan-copy').disabled = false;
      document.getElementById('tripplan-print').disabled = false;
      setStatus('');
    }).catch(function (err) {
      if (seq !== reqSeq) return;
      document.getElementById('tripplan-body').innerHTML = '<p class="tp-sub">Could not build this plan: ' + esc(err && err.message ? err.message : err) + '</p>';
      setStatus('');
    });
  }

  // ---------- find the card's data ----------
  function loadKey(row) {
    if (!row) return '';
    var ln = String(row.load_number || '').trim();
    return [row.board || '', row.origin || '', row.destination || '', ln || String(row.posted_rate || ''), String(row.weight_lb || '')].join('|').toLowerCase();
  }
  function getData() {
    if (cache.searches) return Promise.resolve(cache.searches);
    return timed('data/load_searches.json?t=' + Date.now(), { cache: 'no-store' }, 15000).then(function (r) { return r.json(); }).then(function (d) { cache.searches = d; return d; });
  }
  function findItem(card, data) {
    if (card.classList.contains('combo-card')) {
      var nameEl = card.querySelector('.combo-name');
      var label = nameEl ? nameEl.textContent.trim() : '';
      var comboN = 0, chainN = 0, hit = null;
      (data.combos || []).forEach(function (c) {
        var chain = !!(c.kind && c.kind !== 'shared');
        var lab = chain ? 'Chain ' + (++chainN) : 'Combo ' + (++comboN);
        if (lab === label) hit = c;
      });
      return hit ? { isCombo: true, combo: hit, label: label } : null;
    }
    var key = card.getAttribute('data-load-key') || '';
    var row = null;
    (data.loads || []).forEach(function (r) { if (!row && loadKey(r) === key) row = r; });
    return row ? { isCombo: false, row: row } : null;
  }
  var BTN_SVG = '<svg viewBox="0 0 18 18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3.5" width="13" height="12" rx="2"/><path d="M2.5 7.5h13M6 2v3M12 2v3M5.5 10.5h3M5.5 13h5"/></g></svg>';
  function addButtons(root) {
    var cards = (root || document).querySelectorAll('.search-card, .combo-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.querySelector(':scope > .search-actions > .trip-plan-btn')) continue;
      var bar = card.querySelector(':scope > .search-actions');
      if (!bar) continue;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'trip-plan-btn';
      b.innerHTML = BTN_SVG + '<span>Trip plan</span>';
      var ref = bar.querySelector('.call-sheet-btn');
      if (ref && ref.nextSibling) bar.insertBefore(b, ref.nextSibling); else bar.appendChild(b);
    }
  }
  function init() {
    injectCss();
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.trip-plan-btn') : null;
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var card = btn.closest('.search-card, .combo-card');
      getData().then(function (data) {
        var item = card ? findItem(card, data) : null;
        if (!item) { alert('This load is not in the latest board data. Pull to refresh and try again.'); return; }
        openFor(item, data);
      }).catch(function () { alert('Load board data is not available offline yet.'); });
    }, true);
    var pending = false;
    var mo = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      (window.requestAnimationFrame || setTimeout)(function () { pending = false; addButtons(document); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    addButtons(document);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  // For tests and the console.
  var api = { buildPlan: buildPlan, plainText: plainText, parseWindow: parseWindow, simulate: simulate, planSchedule: planSchedule, _cache: cache, findItem: findItem, loadKey: loadKey };
  if (typeof window !== 'undefined') window.BlackRamTrip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
