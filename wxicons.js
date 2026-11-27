/* Black Ram Logistics - animated weather icons (v107).
   Original SVG + CSS (no raster GIFs, no hotlinking). Transforms and opacity
   only, so many load cards stay cheap. Off-screen icons pause via
   IntersectionObserver. prefers-reduced-motion shows a static first frame.
   Plain ASCII in labels. */
(function (root) {
  'use strict';

  var LABELS = {
    sun: 'Sunny',
    moon: 'Clear night',
    partly: 'Partly cloudy',
    'partly-night': 'Partly cloudy night',
    cloud: 'Cloudy',
    drizzle: 'Drizzle',
    rain: 'Rain',
    thunder: 'Thunderstorm',
    snow: 'Snow',
    ice: 'Ice or freezing rain',
    fog: 'Fog',
    wind: 'Windy',
    cold: 'Cold, 45 F or below'
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function kindFromCode(code, gust) {
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

  function kindFromPoint(pt) {
    if (!pt) return '';
    var kind = kindFromCode(pt.weather_code, pt.gust_mph);
    if (kind) return kind;
    var precip = String(pt.precip || '');
    if (precip === 'ice') return 'ice';
    if (precip === 'snow') return 'snow';
    if (precip === 'rain') return 'rain';
    if (pt.gust_mph != null && Number(pt.gust_mph) >= 40) return 'wind';
    return '';
  }

  function kindForDrop(row) {
    if (!row) return '';
    var kind = kindFromCode(row.drop_wx_code, row.drop_gust_mph);
    if (kind) return kind;
    var pts = (row.route_wx && row.route_wx.points) || [];
    var want = String(row.drop_low_date || '');
    var i, pt;
    for (i = 0; i < pts.length; i++) {
      pt = pts[i];
      if (want && String(pt.date || '').slice(0, 10) === want.slice(0, 10)) return kindFromPoint(pt);
    }
    if (pts.length) return kindFromPoint(pts[pts.length - 1]);
    return '';
  }

  function displayKind(kind, night) {
    var k = String(kind || '');
    if (!night) return k;
    if (k === 'sun') return 'moon';
    if (k === 'partly') return 'partly-night';
    return k;
  }

  function svg(inner) {
    return '<svg class="wxb-ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' + inner + '</svg>';
  }

  function sunRays(cx, cy, r0, r1) {
    /* Eight rays around (cx, cy). transform-origin is set in CSS via the wx-spin class. */
    var i, a, x1, y1, x2, y2, d = '';
    for (i = 0; i < 8; i++) {
      a = (i * Math.PI) / 4;
      x1 = cx + Math.cos(a) * r0;
      y1 = cy + Math.sin(a) * r0;
      x2 = cx + Math.cos(a) * r1;
      y2 = cy + Math.sin(a) * r1;
      d += 'M' + x1.toFixed(2) + ' ' + y1.toFixed(2) + 'L' + x2.toFixed(2) + ' ' + y2.toFixed(2);
    }
    return '<g class="wx-anim wx-spin" style="transform-origin:' + cx + 'px ' + cy + 'px"><g fill="none" stroke="#F2C94C" stroke-width="1.55" stroke-linecap="round">' +
      '<path d="' + d + '"/></g></g>';
  }

  function cloud(x, y, s, cls) {
    /* Compact cloud path in a local 18x10 box, scaled and shifted.
       Animation lives on the wrapper so it does not clobber the SVG transform. */
    s = s || 1;
    return '<g class="' + (cls || 'wx-anim wx-drift') + '"><path transform="translate(' + x + ',' + y + ') scale(' + s + ')" fill="#C4B5FD" d="M4.4 3.4A3.6 3.6 0 0 1 11.2 4a2.8 2.8 0 0 1 2.2 2.7A2.8 2.8 0 0 1 10.6 9.6H4.6A3 3 0 0 1 3.2 3.8 3.2 3.2 0 0 1 4.4 3.4z"/></g>';
  }

  function star(cx, cy, delayCls) {
    return '<circle class="wx-anim wx-twinkle ' + (delayCls || '') + '" cx="' + cx + '" cy="' + cy + '" r="0.85" fill="#F2C94C"/>';
  }

  var ICONS = {
    sun: function () {
      return sunRays(12, 12, 6.15, 9.35) + '<circle cx="12" cy="12" r="4.05" fill="#F2C94C"/>';
    },
    moon: function () {
      return star(6.2, 6.4, '') + star(8.6, 3.8, 'wx-d2') +
        '<path class="wx-anim wx-bob" fill="#E8E4F4" d="M14.1 4.8a7 7 0 1 0 5.6 11.6 5.55 5.55 0 1 1-5.6-11.6z"/>';
    },
    partly: function () {
      return sunRays(8.2, 8.1, 4.15, 6.35) + '<circle cx="8.2" cy="8.1" r="2.7" fill="#F2C94C"/>' +
        cloud(4.4, 9.2, 1.15);
    },
    'partly-night': function () {
      return star(5.4, 4.2, '') +
        '<path class="wx-anim wx-bob" fill="#E8E4F4" d="M9.4 3.7a4.4 4.4 0 1 0 3.5 7.3 3.5 3.5 0 1 1-3.5-7.3z"/>' +
        cloud(4.4, 9.4, 1.15);
    },
    cloud: function () {
      return cloud(2.6, 6.4, 1.35);
    },
    drizzle: function () { return ICONS.rain(); },
    rain: function () {
      return cloud(3, 3.2, 1.28) +
        '<g fill="none" stroke="#60A5FA" stroke-width="1.55" stroke-linecap="round">' +
        '<path class="wx-anim wx-fall" d="M8.1 14.2l-1.05 3.5"/>' +
        '<path class="wx-anim wx-fall wx-d2" d="M12.1 14.2l-1.05 3.5"/>' +
        '<path class="wx-anim wx-fall wx-d3" d="M16.1 14.2l-1.05 3.5"/>' +
        '</g>';
    },
    thunder: function () {
      return cloud(3, 3.0, 1.28) +
        '<path class="wx-anim wx-flash" fill="#F2C94C" d="M13.6 11.4h-3.3l1.7 3.9h-3.05L15.2 10.15h-2.75z"/>';
    },
    snow: function () {
      return cloud(3, 3.0, 1.28) +
        '<g fill="none" stroke="#BFDBFE" stroke-width="1.2" stroke-linecap="round">' +
        '<g class="wx-anim wx-snow"><path d="M8 14.3v3.2M6.45 15.9h3.1M6.9 14.75l2.2 2.3M9.1 14.75l-2.2 2.3"/></g>' +
        '<g class="wx-anim wx-snow wx-d2"><path d="M12 14.3v3.2M10.45 15.9h3.1M10.9 14.75l2.2 2.3M13.1 14.75l-2.2 2.3"/></g>' +
        '<g class="wx-anim wx-snow wx-d3"><path d="M16 14.3v3.2M14.45 15.9h3.1M14.9 14.75l2.2 2.3M17.1 14.75l-2.2 2.3"/></g>' +
        '</g>';
    },
    ice: function () {
      return cloud(3, 3.0, 1.28) +
        '<g fill="none" stroke="#93C5FD" stroke-width="1.55" stroke-linecap="round">' +
        '<path class="wx-anim wx-fall" d="M8.1 14.1l-0.7 3.6"/>' +
        '<path class="wx-anim wx-fall wx-d2" d="M12.1 14.1l-0.7 4.0"/>' +
        '<path class="wx-anim wx-fall wx-d3" d="M16.1 14.1l-0.7 3.6"/>' +
        '</g>' +
        '<circle class="wx-anim wx-twinkle" cx="19.2" cy="19.2" r="1.15" fill="#BFDBFE"/>';
    },
    fog: function () {
      return '<g fill="none" stroke="#C4B5FD" stroke-width="1.65" stroke-linecap="round">' +
        '<path class="wx-anim wx-fog" d="M3.6 7h13.2"/>' +
        '<path class="wx-anim wx-fog wx-d2" d="M5.4 11h14"/>' +
        '<path class="wx-anim wx-fog wx-d3" d="M3.9 15h12.4"/>' +
        '<path class="wx-anim wx-fog wx-d4" d="M6.6 19h10.6"/>' +
        '</g>';
    },
    wind: function () {
      return '<g fill="none" stroke="#E9D5FF" stroke-width="1.65" stroke-linecap="round">' +
        '<path class="wx-anim wx-wind" d="M3 7.6h12.4a2.25 2.25 0 1 0-2.25-2.25"/>' +
        '<path class="wx-anim wx-wind wx-d2" d="M3 12.2h14.6a2.25 2.25 0 1 1-2.25 2.25"/>' +
        '<path class="wx-anim wx-wind wx-d3" d="M3 16.8h9.2"/>' +
        '</g>';
    },
    cold: function () {
      return '<g class="wx-anim wx-shimmer" fill="none" stroke="#93C5FD" stroke-width="1.35" stroke-linecap="round">' +
        '<path d="M12 3.6v16.8M3.6 12h16.8M5.95 5.95l12.1 12.1M18.05 5.95L5.95 18.05"/>' +
        '<path d="M12 6.3l1.1-1.1M12 6.3l-1.1-1.1M12 17.7l1.1 1.1M12 17.7l-1.1 1.1M6.3 12l-1.1 1.1M6.3 12l-1.1-1.1M17.7 12l1.1 1.1M17.7 12l1.1-1.1"/>' +
        '</g>';
    }
  };

  function iconSvg(kind) {
    var fn = ICONS[String(kind || '')];
    return fn ? svg(fn()) : '';
  }

  function looksLikeCode(v) {
    if (v == null || v === '') return false;
    if (ICONS[String(v)]) return false;
    var n = Number(v);
    return isFinite(n) && n >= 0 && n <= 99;
  }

  /* iconHtml(kind, { night, cold }) is the app/trip-planner form.
     iconHtml(weatherCode, isDay) is the wxbar.js form (isDay is 1/0 or true/false). */
  function iconHtml(kindOrCode, optsOrIsDay) {
    var kind, opts;
    if (typeof optsOrIsDay === 'boolean' || optsOrIsDay === 0 || optsOrIsDay === 1) {
      kind = kindFromCode(kindOrCode, null);
      opts = { night: optsOrIsDay === 0 || optsOrIsDay === false };
    } else if (looksLikeCode(kindOrCode) && (optsOrIsDay == null || typeof optsOrIsDay !== 'object')) {
      kind = kindFromCode(kindOrCode, null);
      opts = {};
    } else {
      kind = kindOrCode;
      opts = optsOrIsDay || {};
    }
    var k = displayKind(kind, opts.night);
    var body = iconSvg(k);
    var label = LABELS[k] || '';
    var html = '';
    if (body) {
      html += '<span class="wx-ico wx-ico-' + esc(k) + '"' +
        (label ? ' title="' + esc(label) + '" aria-label="' + esc(label) + '"' : '') +
        '>' + body + '</span>';
    }
    if (opts.cold) {
      html += '<span class="wx-ico wx-ico-cold" title="' + esc(LABELS.cold) + '" aria-label="' + esc(LABELS.cold) + '">' +
        iconSvg('cold') + '</span>';
    }
    return html;
  }

  function iconFor(code, isDay) {
    return iconHtml(code, isDay);
  }

  function labelFor(kind, night) {
    return LABELS[displayKind(kind, night)] || '';
  }

  /* Pause off-screen icons so a long Load Boards list does not keep dozens of
     animations running. Icons start running; the observer adds .wx-ico-off
     once they leave the viewport. */
  var io = null;
  function hook(el) {
    if (!el || el.getAttribute('data-wx-io') === '1' || !io) return;
    el.setAttribute('data-wx-io', '1');
    io.observe(el);
  }
  function scan(root) {
    if (!io) return;
    var list = (root && root.querySelectorAll ? root : document).querySelectorAll('.wx-ico');
    var i;
    for (i = 0; i < list.length; i++) hook(list[i]);
  }
  function bootIo() {
    if (io) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof IntersectionObserver === 'undefined') return;
    io = new IntersectionObserver(function (entries) {
      var i, e;
      for (i = 0; i < entries.length; i++) {
        e = entries[i];
        if (e.isIntersecting) e.target.classList.remove('wx-ico-off');
        else e.target.classList.add('wx-ico-off');
      }
    }, { root: null, rootMargin: '120px 0px', threshold: 0 });
    scan(document);
    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
      new MutationObserver(function (muts) {
        var i, j, n, el, inner, k;
        for (i = 0; i < muts.length; i++) {
          n = muts[i].addedNodes;
          for (j = 0; j < n.length; j++) {
            el = n[j];
            if (!el || el.nodeType !== 1) continue;
            if (el.classList && el.classList.contains('wx-ico')) hook(el);
            if (el.querySelectorAll) {
              inner = el.querySelectorAll('.wx-ico');
              for (k = 0; k < inner.length; k++) hook(inner[k]);
            }
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function fillToggles() {
    var slots = document.querySelectorAll('.hdr-wx-ico, .wx-switch-ico');
    var i, el;
    for (i = 0; i < slots.length; i++) {
      el = slots[i];
      if (!el.innerHTML) el.innerHTML = iconSvg('partly');
    }
  }

  function boot() {
    bootIo();
    fillToggles();
  }

  var api = {
    kindFromCode: kindFromCode,
    kindFromPoint: kindFromPoint,
    kindForDrop: kindForDrop,
    displayKind: displayKind,
    iconSvg: iconSvg,
    iconHtml: iconHtml,
    iconFor: iconFor,
    labelFor: labelFor,
    labels: LABELS,
    scan: scan,
    fillToggles: fillToggles
  };
  root.BlackRamWx = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
