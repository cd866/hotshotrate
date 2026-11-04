/* Truck stops: Love's and TA/Petro.
   The list is data/stops.json (cached by the service worker and localStorage).
   Map tiles are OpenStreetMap. Place search is Nominatim, with Photon
   (also OpenStreetMap) only when Nominatim has no hit. Routes are the
   public OSRM demo server. One driver, results cached, no bulk calls. */
(function () {
  var STOPS_KEY = 'blackram_stops_v1';
  var GEO_KEY = 'blackram_geo_v1';
  var NEAR_LIMIT = 40;
  var VIEW_LIMIT = 80;
  var BRAND = {
    loves: { label: "Love's", short: 'L', color: '#F2C94C', ink: '#0E0E10' },
    ta: { label: 'TA', short: 'TA', color: '#E24B4B', ink: '#F5F1E6' },
    'ta-express': { label: 'TA Express', short: 'TX', color: '#7EB6FF', ink: '#0E0E10' },
    petro: { label: 'Petro', short: 'P', color: '#FF8A3D', ink: '#0E0E10' }
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var state = {
    data: null,
    offline: false,
    mode: 'view',
    brand: 'all',
    corridor: 10,
    here: null,
    route: null,
    selectedId: null,
    map: null,
    markers: null,
    line: null,
    you: null
  };
  var loadsById = {};
  var inflight = null;
  var routing = false;
  var lastNominatim = 0;

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function formatDataDate(iso) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!match) return iso || '';
    return MONTHS[Number(match[2]) - 1] + ' ' + Number(match[3]) + ', ' + match[1];
  }

  function setStatus(text) {
    var el = $('stops-status');
    if (el) el.textContent = text || '';
  }

  function milesBetween(aLat, aLng, bLat, bLng) {
    var radius = 3958.7613;
    var lat1 = aLat * Math.PI / 180;
    var lat2 = bLat * Math.PI / 180;
    var dLat = (bLat - aLat) * Math.PI / 180;
    var dLng = (bLng - aLng) * Math.PI / 180;
    var half = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(half)));
  }

  function fmtMi(n) {
    if (!isFinite(n)) return '';
    if (n < 10) return n.toFixed(1) + ' mi';
    return Math.round(n) + ' mi';
  }

  function brandMeta(brand) {
    return BRAND[brand] || { label: brand || 'Stop', short: '•', color: '#D4A62A', ink: '#0E0E10' };
  }

  function stopTitle(stop) {
    return brandMeta(stop.brand).label + ' #' + stop.number;
  }

  function addressLine(stop) {
    var city = [stop.city, stop.state].filter(Boolean).join(', ');
    if (stop.zip) city = city ? (city + ' ' + stop.zip) : stop.zip;
    return [stop.address, city].filter(Boolean).join(', ');
  }

  function roadLine(stop) {
    if (stop.highway && stop.exit) {
      var exit = String(stop.exit);
      var label = /exit/i.test(exit) ? exit : ('Exit ' + exit);
      return stop.highway + ' · ' + label;
    }
    return stop.highway || '';
  }

  function phoneDigits(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
    return digits.length === 10 ? digits : '';
  }

  function safeUrl(url) {
    return /^https:\/\/(www\.)?(loves\.com|ta-petro\.com)\//.test(url || '') ? url : '';
  }

  function listMode() {
    if (state.mode === 'near' && state.here) return 'near';
    if (state.mode === 'route' && state.route && state.route.built) return 'route';
    return 'view';
  }

  function filteredStops() {
    var stops = (state.data && state.data.stops) || [];
    if (state.brand === 'all') return stops;
    return stops.filter(function (stop) { return stop.brand === state.brand; });
  }

  function buildRoute(coords) {
    if (!coords || coords.length < 2) return null;
    var mid = coords[Math.floor(coords.length / 2)];
    var cos = Math.cos(mid[1] * Math.PI / 180);
    var pts = [];
    var miles = 0;
    var prev = null;
    function push(lng, lat, force) {
      var x = lng * 69.172 * cos;
      var y = lat * 69.172;
      if (prev) {
        var dx = x - prev.x;
        var dy = y - prev.y;
        var seg = Math.sqrt(dx * dx + dy * dy);
        if (!force && seg < 0.25) return;
        miles += seg;
      }
      prev = { x: x, y: y, lat: lat, lng: lng, miles: miles };
      pts.push(prev);
    }
    coords.forEach(function (pair, index) {
      push(pair[0], pair[1], index === 0 || index === coords.length - 1);
    });
    if (pts.length < 2) return null;
    return { pts: pts, cos: cos, miles: miles };
  }

  function along(route, lat, lng) {
    var x = lng * 69.172 * route.cos;
    var y = lat * 69.172;
    var best = { dist: Infinity, mile: 0 };
    var pts = route.pts;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1];
      var b = pts[i];
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len2 = dx * dx + dy * dy;
      var t = len2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      var cx = a.x + t * dx;
      var cy = a.y + t * dy;
      var dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (dist < best.dist) {
        best = { dist: dist, mile: a.miles + t * (b.miles - a.miles) };
      }
    }
    return best;
  }

  function collect() {
    var stops = filteredStops();
    var mode = listMode();
    var rows = [];
    if (mode === 'near') {
      stops.forEach(function (stop) {
        rows.push({
          stop: stop,
          miles: milesBetween(state.here.lat, state.here.lng, stop.lat, stop.lng),
          kind: 'near'
        });
      });
      rows.sort(function (a, b) { return a.miles - b.miles; });
      return { rows: rows.slice(0, NEAR_LIMIT), total: rows.length, capped: rows.length > NEAR_LIMIT, mode: mode };
    }
    if (mode === 'route') {
      var route = state.route.built;
      var corridor = state.corridor;
      var pad = corridor / 69;
      var minLat = Infinity;
      var maxLat = -Infinity;
      var minLng = Infinity;
      var maxLng = -Infinity;
      route.pts.forEach(function (point) {
        if (point.lat < minLat) minLat = point.lat;
        if (point.lat > maxLat) maxLat = point.lat;
        if (point.lng < minLng) minLng = point.lng;
        if (point.lng > maxLng) maxLng = point.lng;
      });
      var lngPad = pad / Math.max(0.25, route.cos);
      stops.forEach(function (stop) {
        if (stop.lat < minLat - pad || stop.lat > maxLat + pad) return;
        if (stop.lng < minLng - lngPad || stop.lng > maxLng + lngPad) return;
        var hit = along(route, stop.lat, stop.lng);
        if (hit.dist <= corridor + 0.05) {
          rows.push({ stop: stop, miles: hit.mile, off: hit.dist, kind: 'route' });
        }
      });
      rows.sort(function (a, b) { return a.miles - b.miles || a.off - b.off; });
      return { rows: rows, total: rows.length, capped: false, mode: mode };
    }
    var center = state.map ? state.map.getCenter() : { lat: 31.8, lng: -90.5 };
    var bounds = state.map ? state.map.getBounds().pad(0.02) : null;
    stops.forEach(function (stop) {
      if (bounds && !bounds.contains([stop.lat, stop.lng])) return;
      rows.push({
        stop: stop,
        miles: milesBetween(center.lat, center.lng, stop.lat, stop.lng),
        kind: 'view'
      });
    });
    rows.sort(function (a, b) { return a.miles - b.miles; });
    return { rows: rows.slice(0, VIEW_LIMIT), total: rows.length, capped: rows.length > VIEW_LIMIT, mode: mode };
  }

  function rowLabel(row) {
    if (row.kind === 'route') {
      var mile = row.miles < 10 ? row.miles.toFixed(1) : String(Math.round(row.miles));
      var off = row.off < 10 ? row.off.toFixed(1) : String(Math.round(row.off));
      return 'mi ' + mile + ' · ' + off + ' off';
    }
    return fmtMi(row.miles);
  }

  function heading(pack) {
    if (pack.mode === 'near') return 'Closest to you';
    if (pack.mode === 'route') return 'Along the route · within ' + state.corridor + ' mi';
    if (pack.capped) return 'In this view · nearest ' + pack.rows.length;
    return 'In this view';
  }

  function emptyCopy(pack) {
    if (pack.mode === 'near') return 'No stops of this brand near you. Try All.';
    if (pack.mode === 'route') return 'No stops within ' + state.corridor + ' miles of this route. Try 25 mi.';
    return 'No stops in this view. Zoom out, or tap Near me.';
  }

  function drawMarkers(rows) {
    if (!state.map || !window.L) return;
    if (state.markers) state.map.removeLayer(state.markers);
    state.markers = L.layerGroup().addTo(state.map);
    rows.forEach(function (row) {
      var stop = row.stop;
      var meta = brandMeta(stop.brand);
      var on = stop.id === state.selectedId ? ' on' : '';
      var icon = L.divIcon({
        className: 'pin-wrap',
        html: '<div class="pin' + on + '" data-id="' + esc(stop.id) + '" style="background:' +
          meta.color + ';color:' + meta.ink + '">' + esc(meta.short) + '</div>',
        iconSize: [34, 34],
        iconAnchor: [17, 17]
      });
      var marker = L.marker([stop.lat, stop.lng], { icon: icon, keyboard: false });
      marker.on('click', function () { openStop(stop.id); });
      marker.addTo(state.markers);
    });
  }

  function drawList(pack) {
    var root = $('stops-list');
    if (!root) return;
    var head = '<h2 class="sec">' + esc(heading(pack)) + '</h2>';
    if (!pack.rows.length) {
      root.innerHTML = head + '<p class="need">' + esc(emptyCopy(pack)) + '</p>';
      return;
    }
    var html = pack.rows.map(function (row) {
      var stop = row.stop;
      var meta = brandMeta(stop.brand);
      var place = [];
      if (stop.kind) place.push(stop.kind);
      if (stop.name) place.push(stop.name);
      var sub = [place.join(' · '), addressLine(stop)].filter(Boolean).join(' — ');
      var on = stop.id === state.selectedId ? ' on' : '';
      return '<button type="button" class="stop' + on + '" data-id="' + esc(stop.id) + '">' +
        '<span class="stop-top"><span class="pill" style="background:' + meta.color + ';color:' + meta.ink + '">' +
        esc(meta.label) + '</span><span class="miles">' + esc(rowLabel(row)) + '</span></span>' +
        '<span class="stop-name">' + esc(stopTitle(stop)) + '</span>' +
        '<span class="lane">' + esc(sub) + '</span></button>';
    }).join('');
    var more = '';
    if (pack.capped) {
      more = '<p class="fine">Showing ' + pack.rows.length + ' of ' + pack.total + '. Zoom in to shorten the list.</p>';
    }
    root.innerHTML = head + html + more;
  }

  function render(opts) {
    if (!state.data) return null;
    syncChrome();
    var pack = collect();
    drawMarkers(pack.rows);
    drawList(pack);
    if (opts && opts.fit && state.line && state.map) {
      state.map.fitBounds(state.line.getBounds(), { padding: [24, 24] });
    }
    return pack;
  }

  function findStop(id) {
    var stops = (state.data && state.data.stops) || [];
    for (var i = 0; i < stops.length; i++) {
      if (stops[i].id === id) return stops[i];
    }
    return null;
  }

  function renderSheet(stop) {
    var meta = brandMeta(stop.brand);
    var digits = phoneDigits(stop.phone);
    var call = digits
      ? '<a class="btn gold block" href="tel:+1' + digits + '">Call ' + esc(stop.phone) + '</a>'
      : '<p class="fine">Phone not listed.</p>';
    var road = roadLine(stop);
    var flags = '<p class="stop-flag">' + (stop.tireCare ? 'Tire care' : 'Tire care not listed') + '</p>' +
      '<p class="stop-flag">' + (stop.truckService ? 'Truck service' : 'Truck service not listed') + '</p>';
    var parking = stop.parking ? '<p class="lane">' + esc(String(stop.parking)) + ' truck spaces</p>' : '';
    var page = safeUrl(stop.url);
    var pageLink = page ? '<p class="fine"><a href="' + esc(page) + '" target="_blank" rel="noopener">Store page</a></p>' : '';
    var lat = Number(stop.lat).toFixed(5);
    var lng = Number(stop.lng).toFixed(5);
    var apple = 'https://maps.apple.com/?daddr=' + lat + ',' + lng + '&dirflg=d';
    var google = 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=driving';
    $('stop-body').innerHTML =
      '<span class="pill" style="background:' + meta.color + ';color:' + meta.ink + '">' + esc(meta.label) + '</span>' +
      '<h2 id="stop-title">' + esc(stopTitle(stop)) + '</h2>' +
      '<p class="stop-place">' + esc(stop.name || '') + '</p>' +
      '<p class="stop-addr">' + esc(addressLine(stop)) + '</p>' +
      (road ? '<p class="lane">' + esc(road) + '</p>' : '') +
      parking +
      '<div class="stop-flags">' + flags + '</div>' +
      call +
      '<div class="row-actions">' +
      '<a class="btn gold" href="' + apple + '" target="_blank" rel="noopener">Apple Maps</a>' +
      '<a class="btn" href="' + google + '" target="_blank" rel="noopener">Google Maps</a>' +
      '</div>' +
      pageLink;
  }

  function openStop(id) {
    var stop = findStop(id);
    if (!stop) return;
    state.selectedId = id;
    renderSheet(stop);
    $('stop-sheet').hidden = false;
    var pinOn = document.querySelectorAll('.pin');
    pinOn.forEach(function (el) {
      el.classList.toggle('on', el.getAttribute('data-id') === id);
    });
    document.querySelectorAll('.stop').forEach(function (el) {
      el.classList.toggle('on', el.getAttribute('data-id') === id);
    });
    if (state.map) {
      var ll = [stop.lat, stop.lng];
      if (!state.map.getBounds().contains(ll) || state.map.getZoom() < 8) {
        state.map.setView(ll, Math.max(state.map.getZoom(), 10));
      } else {
        state.map.panTo(ll);
      }
    }
  }

  function closeSheet() {
    $('stop-sheet').hidden = true;
  }

  function showYou(here) {
    if (!state.map || !window.L) return;
    if (state.you) state.map.removeLayer(state.you);
    state.you = null;
    if (!here) return;
    var accuracy = Number(here.accuracy);
    var layers = [];
    if (isFinite(accuracy) && accuracy > 0) {
      layers.push(L.circle([here.lat, here.lng], {
        radius: accuracy,
        color: '#F2C94C',
        weight: 1,
        fillColor: '#F2C94C',
        fillOpacity: 0.15
      }));
    }
    layers.push(L.circleMarker([here.lat, here.lng], {
      radius: 7,
      color: '#F5F1E6',
      weight: 3,
      fillColor: '#D4A62A',
      fillOpacity: 1
    }));
    state.you = L.layerGroup(layers).addTo(state.map);
  }

  function showLine(geometry) {
    if (!state.map || !window.L) return;
    if (state.line) state.map.removeLayer(state.line);
    state.line = null;
    if (!geometry) return;
    state.line = L.geoJSON(geometry, {
      pane: 'route',
      style: { color: '#F2C94C', weight: 5, opacity: 0.95 }
    }).addTo(state.map);
  }

  function syncChrome() {
    var near = $('stops-near');
    var route = $('stops-route');
    if (near) near.setAttribute('aria-pressed', state.mode === 'near' ? 'true' : 'false');
    if (route) route.setAttribute('aria-pressed', state.mode === 'route' ? 'true' : 'false');
    var form = $('stops-route-form');
    if (form) form.hidden = state.mode !== 'route';
    document.querySelectorAll('#stops-brands button').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-brand') === state.brand ? 'true' : 'false');
    });
    document.querySelectorAll('#stops-corridor button').forEach(function (btn) {
      btn.setAttribute('aria-pressed', Number(btn.getAttribute('data-miles')) === state.corridor ? 'true' : 'false');
    });
    var banner = $('stops-offline');
    if (banner) banner.hidden = !state.offline;
  }

  function rememberStops(data) {
    try {
      localStorage.setItem(STOPS_KEY, JSON.stringify({ savedAt: new Date().toISOString(), data: data }));
    } catch (err) { /* quota or private mode */ }
  }

  function recallStops() {
    try {
      var raw = localStorage.getItem(STOPS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function applyStops(data, offline) {
    state.data = data;
    state.offline = !!offline;
    var count = data.count || (data.stops && data.stops.length) || 0;
    var stamp = count.toLocaleString() + ' stops as of ' + formatDataDate(data.fetched_at);
    $('stops-stamp').textContent = stamp;
    syncChrome();
    render();
  }

  function loadStops() {
    var cached = recallStops();
    if (cached && cached.data && cached.data.stops && !state.data) {
      applyStops(cached.data, true);
    } else if (!state.data) {
      setStatus('Loading stops…');
    }
    inflight = fetch('data/stops.json', { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('status');
      var offline = res.headers.get('X-Feed-Cache') === '1';
      return res.json().then(function (data) {
        return { data: data, offline: offline };
      });
    }).then(function (pack) {
      if (!pack.data || !pack.data.stops || !pack.data.stops.length) throw new Error('shape');
      rememberStops(pack.data);
      applyStops(pack.data, pack.offline);
      if ($('stops-status').textContent === 'Loading stops…') setStatus('');
    }).catch(function () {
      if (state.data) {
        state.offline = true;
        syncChrome();
        return;
      }
      $('stops-stamp').textContent = 'Truck stops did not load.';
      setStatus('The stop list needs one online visit. After that it stays on this phone.');
    }).then(function () {
      inflight = null;
    });
  }

  function ensureMap() {
    var el = $('stops-map');
    if (!el || state.map) return;
    if (!window.L) {
      el.innerHTML = '<p class="fine map-fallback">The map did not load. The stop list below still works.</p>';
      return;
    }
    state.map = L.map(el, { zoomControl: false, attributionControl: true }).setView([31.8, -90.5], 5);
    L.control.zoom({ position: 'topright' }).addTo(state.map);
    state.map.createPane('route');
    var routePane = state.map.getPane('route');
    routePane.style.zIndex = 650;
    routePane.style.pointerEvents = 'none';
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(state.map);
    state.map.on('moveend', function () {
      if (listMode() === 'view' && state.data) render();
    });
    setTimeout(function () {
      if (state.map) state.map.invalidateSize();
    }, 80);
  }

  function nearMe() {
    if (!navigator.geolocation) {
      setStatus('This phone does not share location. Use Along route.');
      return;
    }
    setStatus('Finding you…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      state.here = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
      state.mode = 'near';
      state.route = null;
      showLine(null);
      var shown = render();
      showYou(state.here);
      if (state.map && shown && shown.rows.length) {
        var bounds = L.latLngBounds([[state.here.lat, state.here.lng]]);
        shown.rows.slice(0, 8).forEach(function (row) {
          bounds.extend([row.stop.lat, row.stop.lng]);
        });
        state.map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
      }
      setStatus('Sorted by miles from you.');
    }, function (err) {
      if (err && err.code === 1) {
        setStatus('Location is blocked. Allow it for Black Ram, or use Along route.');
      } else {
        setStatus('No GPS fix. Step outside and try again, or use Along route.');
      }
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 });
  }

  function pause(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function geoCache() {
    try {
      return JSON.parse(localStorage.getItem(GEO_KEY) || '{}');
    } catch (err) {
      return {};
    }
  }

  function rememberGeo(key, hit) {
    var all = geoCache();
    all[key] = { lat: hit.lat, lng: hit.lng, label: hit.label, at: Date.now() };
    var keys = Object.keys(all);
    if (keys.length > 40) {
      keys.sort(function (a, b) { return (all[a].at || 0) - (all[b].at || 0); });
      keys.slice(0, keys.length - 40).forEach(function (keyName) { delete all[keyName]; });
    }
    try { localStorage.setItem(GEO_KEY, JSON.stringify(all)); } catch (err) { /* ignore */ }
  }

  function nominatim(query) {
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=' +
      encodeURIComponent(query);
    var wait = Math.max(0, 1100 - (Date.now() - lastNominatim));
    return pause(wait).then(function () {
      lastNominatim = Date.now();
      return fetch(url, { headers: { Accept: 'application/json' } });
    }).then(function (res) {
      if (!res.ok) throw new Error('geocode');
      return res.json();
    }).then(function (rows) {
      if (!rows || !rows.length) return null;
      var lat = Number(rows[0].lat);
      var lng = Number(rows[0].lon);
      if (!isFinite(lat) || !isFinite(lng)) return null;
      return { lat: lat, lng: lng, label: rows[0].display_name || query };
    });
  }

  function photon(query) {
    var url = 'https://photon.komoot.io/api/?limit=1&lang=en&lat=31.5&lon=-90&q=' + encodeURIComponent(query);
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('geocode');
      return res.json();
    }).then(function (data) {
      var feature = data && data.features && data.features[0];
      var coords = feature && feature.geometry && feature.geometry.coordinates;
      if (!coords) return null;
      var props = feature.properties || {};
      var label = [props.name, props.city, props.state].filter(Boolean).join(', ') || query;
      if (!isFinite(coords[1]) || !isFinite(coords[0])) return null;
      return { lat: coords[1], lng: coords[0], label: label };
    });
  }

  function geocode(raw) {
    var query = String(raw || '').replace(/\s+/g, ' ').trim();
    var key = query.toLowerCase();
    var cached = geoCache()[key];
    if (cached && isFinite(cached.lat) && isFinite(cached.lng)) {
      return Promise.resolve({ lat: cached.lat, lng: cached.lng, label: cached.label || query });
    }
    return nominatim(query).catch(function () { return null; }).then(function (hit) {
      if (hit) return hit;
      return photon(query).catch(function () { return null; });
    }).then(function (hit) {
      if (hit) rememberGeo(key, hit);
      return hit;
    });
  }

  function routeLine(from, to) {
    var url = 'https://router.project-osrm.org/route/v1/driving/' +
      from.lng.toFixed(5) + ',' + from.lat.toFixed(5) + ';' +
      to.lng.toFixed(5) + ',' + to.lat.toFixed(5) +
      '?overview=full&geometries=geojson&steps=false';
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('route');
      return res.json();
    }).then(function (data) {
      if (!data || data.code !== 'Ok' || !data.routes || !data.routes[0]) throw new Error('route');
      return data.routes[0];
    });
  }

  function friendly(err) {
    var msg = err && err.message ? err.message : '';
    if (msg.indexOf('Could not find') === 0) return msg;
    return 'Routing is busy or offline. Try again in a minute. The stop list stays on this phone.';
  }

  function runRoute() {
    if (routing) return;
    var pickup = $('stops-pickup').value.replace(/\s+/g, ' ').trim();
    var delivery = $('stops-delivery').value.replace(/\s+/g, ' ').trim();
    if (!pickup || !delivery) {
      setStatus('Enter a pickup and a delivery.');
      return;
    }
    routing = true;
    $('stops-go').disabled = true;
    setStatus('Finding ' + pickup + '…');
    geocode(pickup).then(function (from) {
      if (!from) throw new Error('Could not find “' + pickup + '”. Try city and state, like Houston TX.');
      setStatus('Finding ' + delivery + '…');
      return geocode(delivery).then(function (to) {
        if (!to) throw new Error('Could not find “' + delivery + '”. Try city and state, like Pensacola FL.');
        setStatus('Routing…');
        return routeLine(from, to).then(function (route) {
          return { from: from, to: to, route: route };
        });
      });
    }).then(function (pack) {
      var geometry = pack.route.geometry;
      var built = buildRoute(geometry && geometry.coordinates);
      if (!built) throw new Error('route');
      state.mode = 'route';
      state.route = {
        from: pack.from,
        to: pack.to,
        geometry: geometry,
        built: built,
        roadMiles: pack.route.distance / 1609.344
      };
      showLine(geometry);
      var shown = render({ fit: true });
      var count = shown ? shown.rows.length : 0;
      setStatus(Math.round(state.route.roadMiles) + ' mi route · ' + count + ' stops within ' + state.corridor + ' mi, in order along the road.');
    }).catch(function (err) {
      setStatus(friendly(err));
    }).then(function () {
      routing = false;
      var button = $('stops-go');
      if (button) button.disabled = false;
    });
  }

  function savedLoads(feed) {
    var rows = [];
    ((feed && feed.months) || []).forEach(function (month) {
      (month.loads || []).forEach(function (load) {
        var lane = String(load.lane || '');
        var parts = lane.split(/\s*(?:→|->|–|—)\s*/);
        if (parts.length < 2) return;
        var pickup = parts[0].trim();
        var delivery = parts[parts.length - 1].trim();
        if (!pickup || !delivery) return;
        rows.push({
          date: load.date || '',
          desc: load.desc || lane,
          pickup: pickup,
          delivery: delivery
        });
      });
    });
    rows.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
    return rows;
  }

  function fillLoads() {
    var select = $('stops-load');
    if (!select) return;
    var feed = window.BlackRam && BlackRam.getFeed ? BlackRam.getFeed() : null;
    var loads = savedLoads(feed);
    loadsById = {};
    var previous = select.value;
    var html = '<option value="">Pick a saved load</option>';
    loads.forEach(function (load, index) {
      var id = String(index);
      loadsById[id] = load;
      var label = (load.date ? load.date + ' · ' : '') + load.desc;
      html += '<option value="' + id + '">' + esc(label) + '</option>';
    });
    select.innerHTML = html;
    if (loadsById[previous]) select.value = previous;
    select.disabled = loads.length === 0;
  }

  function useLoadCheck() {
    var pickup = $('pickup');
    var delivery = $('delivery');
    var from = pickup ? pickup.value.replace(/\s+/g, ' ').trim() : '';
    var to = delivery ? delivery.value.replace(/\s+/g, ' ').trim() : '';
    if (!from && !to) {
      setStatus('Enter a pickup and delivery on Load check first.');
      return;
    }
    if (from) $('stops-pickup').value = from;
    if (to) $('stops-delivery').value = to;
    setStatus('Filled from Load check.');
  }

  function show() {
    ensureMap();
    fillLoads();
    if (!state.data && !inflight) loadStops();
    setTimeout(function () {
      if (state.map) state.map.invalidateSize();
      if (state.data && listMode() === 'view') render();
    }, 60);
  }

  function init() {
    var near = $('stops-near');
    var routeBtn = $('stops-route');
    if (!near || !routeBtn) return;
    near.addEventListener('click', nearMe);
    routeBtn.addEventListener('click', function () {
      state.mode = 'route';
      syncChrome();
      if (state.route && state.route.built) render();
      else setStatus('Enter a pickup and a delivery. City and state works best.');
    });
    document.querySelectorAll('#stops-brands button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.brand = btn.getAttribute('data-brand') || 'all';
        render();
      });
    });
    document.querySelectorAll('#stops-corridor button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.corridor = Number(btn.getAttribute('data-miles')) || 10;
        syncChrome();
        if (state.route && state.route.built) {
          var shown = render();
          var count = shown ? shown.rows.length : 0;
          setStatus(count + ' stops within ' + state.corridor + ' mi of the route.');
        }
      });
    });
    $('stops-route-form').addEventListener('submit', function (event) {
      event.preventDefault();
      runRoute();
    });
    $('stops-load').addEventListener('change', function () {
      var load = loadsById[$('stops-load').value];
      if (!load) return;
      $('stops-pickup').value = load.pickup;
      $('stops-delivery').value = load.delivery;
    });
    $('stops-from-check').addEventListener('click', useLoadCheck);
    $('stops-list').addEventListener('click', function (event) {
      var button = event.target.closest('.stop');
      if (!button) return;
      openStop(button.getAttribute('data-id'));
    });
    $('stop-close').addEventListener('click', closeSheet);
    $('stop-backdrop').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && $('stop-sheet') && !$('stop-sheet').hidden) closeSheet();
    });
  }

  window.BlackRamStops = {
    show: show,
    onFeed: fillLoads
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
