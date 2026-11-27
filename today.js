/* Black Ram Logistics - Today (v96).
   One-glance home: truck now, what needs attention, net kept vs bills chart, readiness and
   driver quick actions. Reads only data the app already loads in public (ledger feed, board
   scan, maintenance.json, dot_ready.json). Money figures here are the same public ledger
   numbers Reports and Scoreboard show; bank, partner and owed figures stay behind the PIN.
   Unknown values say "not on file". Cities only, no street addresses. Plain ASCII. */
(function () {
  'use strict';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var st = { showAll: false, timer: null };

  function A() { return window.BlackRamApp || {}; }
  function T() { return window.BlackRamTiles; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ascii(v) { return String(v == null ? '' : v).replace(/\u2192/g, 'to').replace(/[\u2013\u2014\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x00-\x7F]/g, ''); }
  function money(n) { if (n == null || !isFinite(n)) return '-'; var neg = n < 0; return (neg ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'); }
  function n0(n) { return Math.round(n).toLocaleString('en-US'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function utc(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
  function md(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return MON[+p[1] - 1] + ' ' + (+p[2]); }
  function root() { return document.getElementById('today-root'); }
  function onToday() { return document.documentElement.getAttribute('data-tab') === 'today'; }

  var STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY';
  var NOISE = /^(UR|Equipment|EquipmentShare|Containers|Cargo|Rentals|Yard|Mfg|Supply|Elec|Taller|Technologies|STT|Tag|Near|BUILTEC|Stribling|Con|Global|United)$/;
  /* City and state only, never a street address (maps and labels stay city level). */
  function city(s) {
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
          if (w.length && !NOISE.test(w[w.length - 1])) return w.join(' ') + ', ' + m[2];
          return m[2];
        }
      }
    }
    var st2 = s.match(new RegExp('\\b(' + STATES + ')\\b'));
    return st2 ? st2[1] : 'not on file';
  }

  /* ---------- data helpers ---------- */
  function feed() { var a = A(); return a.getFeed ? a.getFeed() : null; }
  function months(f) { return ((f && f.months) || []).slice().sort(function (a, b) { return a.month < b.month ? -1 : 1; }); }
  function allLoads(f) {
    var out = [];
    months(f).forEach(function (m) { (m.loads || []).forEach(function (l) { out.push({ load: l, pct: isFinite(Number(m.fee_pct)) ? Number(m.fee_pct) : 13, month: m.month }); }); });
    return out;
  }
  function resolved(l) { var a = A(); return a.withResolvedStatus ? a.withResolvedStatus(l) : l; }

  /* Daily cumulative net kept for a month: gross - carrier fee on the load date, minus each
     expense on its date. Same total as monthFigures().net (Scoreboard "Net kept"). */
  function netSeries(m) {
    var byDay = {};
    var pct = isFinite(Number(m.fee_pct)) ? Number(m.fee_pct) : 13;
    (m.loads || []).forEach(function (l) {
      var g = Number(l.gross) || 0, d = +String(l.date || '').slice(8, 10) || 1;
      byDay[d] = (byDay[d] || 0) + g - Math.round(g * pct) / 100;
    });
    (m.expenses || []).forEach(function (e) {
      var d = +String(e.date || '').slice(8, 10) || 1;
      byDay[d] = (byDay[d] || 0) - (Number(e.amount) || 0);
    });
    var y = +m.month.slice(0, 4), mo = +m.month.slice(5, 7);
    var dim = new Date(y, mo, 0).getDate();
    var out = [], run = 0;
    for (var d = 1; d <= dim; d++) { run += byDay[d] || 0; out.push(run); }
    return { pts: out, dim: dim };
  }

  /* ---------- sections ---------- */
  function pill(tone, txt) { return '<span class="td-pill td-' + tone + '">' + esc(txt) + '</span>'; }
  function tap(key, arg, label) { var t = T(); return t ? t.jumpAttrs('td', key + (arg != null ? ':' + arg : ''), label) : ''; }

  function secNow(f) {
    var list = allLoads(f).map(function (e) { return { e: e, l: resolved(e.load) }; });
    var live = list.filter(function (x) { return x.l.status === 'in_transit' || x.l.status === 'booked'; })
      .sort(function (a, b) { return (a.l.date || '') < (b.l.date || '') ? -1 : 1; });
    var done = list.filter(function (x) { return x.l.status === 'delivered'; })
      .sort(function (a, b) { var A1 = a.l.delivered_date || a.l.delivery_date || a.l.date || '', B1 = b.l.delivered_date || b.l.delivery_date || b.l.date || ''; return A1 < B1 ? 1 : -1; });
    var cur = live[0], last = done[0];
    var body;
    if (cur) {
      var l = cur.l, isT = l.status === 'in_transit';
      var canDel = A().canMarkDelivered && A().canMarkDelivered(l);
      body = '<div class="td-now-top">' + pill(isT ? 'warn' : 'info', isT ? 'IN TRANSIT' : 'BOOKED') + '<span class="td-now-when">' + (isT ? 'Due ' + esc(md(l.delivery_date) || 'not on file') : 'Pickup ' + esc(md(l.pickup_date || l.date))) + '</span></div>' +
        '<div class="td-lane"><b>' + esc(city(l.pickup_place || l.lane)) + '</b><i aria-hidden="true"></i><b>' + esc(city(l.drop_place || l.lane)) + '</b></div>' +
        '<div class="td-now-kv"><span><b class="num-yellow">' + money(Number(l.gross)) + '</b>gross</span><span><b>' + (l.loaded_mi ? n0(l.loaded_mi) : '-') + '</b>loaded mi</span><span><b>' + esc(ascii(l.broker || 'not on file')) + '</b>broker</span></div>' +
        '<div class="td-btns">' + (canDel ? '<button type="button" class="td-btn gold" data-td-deliver="' + esc(A().loadId(cur.e.load)) + '">Mark delivered</button>' : '') +
        '<button type="button" class="td-btn" data-td-go="stops">Stops near me</button></div>';
    } else {
      var lastTxt = 'No delivered load on file';
      var idle = null;
      if (last) {
        var dd = last.l.delivered_date || last.l.delivery_date || last.l.date;
        idle = dd ? Math.max(0, daysBetween(String(dd).slice(0, 10), todayIso())) : null;
        lastTxt = 'Last drop ' + city(last.l.drop_place || last.l.lane) + (dd ? ', ' + md(dd) : '');
      }
      body = '<div class="td-now-top">' + pill('muted', 'NO LOAD BOOKED') + (idle != null ? '<span class="td-now-when">' + (idle === 0 ? 'dropped today' : idle + ' d since last drop') + '</span>' : '') + '</div>' +
        '<p class="td-now-sub">' + esc(lastTxt) + '</p>' +
        '<div class="td-btns"><button type="button" class="td-btn gold" data-td-go="searches">Find a load</button><button type="button" class="td-btn" data-td-go="check">Rate check</button></div>';
    }
    return '<section class="td-card td-now" aria-label="Truck now"><h2 class="td-h">Truck now</h2>' + body + '</section>';
  }

  function alerts(f) {
    var out = [];
    var D = window.BlackRamDot, M = window.BlackRamMaintenance;
    if (D && D.ready && D.ready() && D.list) {
      D.list().forEach(function (x) {
        if (x.s === 'gap') out.push({ tone: 'bad', r: 0, t: 'DOT: ' + x.t, s: x.label + (x.cfr ? ' | ' + x.cfr.split(';')[0] : ''), go: 'dot:' + x.id });
        else if (x.s === 'soon') out.push({ tone: 'warn', r: 2, t: 'DOT: ' + x.t, s: 'Due soon' + (x.days != null ? ' | ' + x.days + ' d left' : ''), go: 'dot:' + x.id });
      });
    }
    if (M && M.ready && M.ready() && M.rows) {
      var need = 0;
      M.rows().forEach(function (r) {
        var left = r.remMi != null ? (r.remMi > 0 ? n0(r.remMi) + ' mi left' : n0(-r.remMi) + ' mi over') : (r.remD != null ? (r.remD > 0 ? r.remD + ' d left' : -r.remD + ' d over') : '');
        var unit = r.unit === 'trailer' ? 'Trailer' : 'Truck';
        var item = String(r.item || '').replace(/\s*\((truck|trailer)\)\s*$/i, '');
        if (r.status === 'over') out.push({ tone: 'bad', r: 1, t: unit + ': ' + item, s: 'Overdue | ' + left, go: 'mt:' + r.id });
        else if (r.status === 'soon') out.push({ tone: 'warn', r: 3, t: unit + ': ' + item, s: 'Due soon | ' + left, go: 'mt:' + r.id });
        else if (r.status === 'need') need++;
      });
      if (need) out.push({ tone: 'info', r: 6, t: need + (need === 1 ? ' inspection has' : ' inspections have') + ' no record on file', s: 'Annual DOT inspection reports | Maintenance', go: 'mtneed' });
    }
    allLoads(f).forEach(function (e) {
      var l = resolved(e.load);
      if (l.pay_status !== 'unpaid') return;
      var dd = String(l.delivered_date || l.delivery_date || l.date || '').slice(0, 10);
      var age = dd ? daysBetween(dd, todayIso()) : null;
      var due = Number(l.net_due);
      out.push({ tone: age != null && age > 30 ? 'bad' : (age != null && age > 14 ? 'warn' : 'info'), r: 4, t: 'Waiting on pay: ' + city(l.pickup_place) + ' to ' + city(l.drop_place), s: (isFinite(due) && due > 0 ? money(due) + ' due' + (l.net_due_est ? ' EST' : '') : 'amount not on file') + (age != null ? ' | delivered ' + age + ' d ago' : ''), go: 'unpaid' });
    });
    var X = window.BlackRamTax;
    if (X && X.ready && X.ready()) {
      X.next(2).forEach(function (x) {
        var tone = x.days <= 14 ? 'bad' : (x.days <= 45 ? 'warn' : 'info');
        out.push({ tone: tone, r: tone === 'bad' ? 1.5 : (tone === 'warn' ? 3.5 : 6.5), t: 'Tax: ' + x.t, s: x.form + ' | due ' + md(x.due) + ' | ' + (x.days < 0 ? -x.days + ' d late' : x.days + ' d left'), go: 'tax:' + x.id });
      });
    }
    var S = A().getScored ? A().getScored() : null;
    var stamp = S && (S.scanned_at || S.as_of);
    if (stamp) {
      var dt = parseStamp(String(stamp));
      if (dt) {
        var h = (Date.now() - dt.getTime()) / 3600000;
        if (h > 8) out.push({ tone: 'warn', r: 5, t: 'Load boards are ' + Math.round(h) + ' h old', s: 'Last scan ' + md(dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate())) + '. Ask Grok Bot for a fresh pull.', go: 'tab:searches' });
      }
    }
    /* v105: anything an open action item already covers (DOT gaps, unpaid loads) shows once, on the Action items card */
    var AC = window.BlackRamActions, cov = AC && AC.covers ? AC.covers() : [];
    if (cov.length) out = out.filter(function (x) { return cov.indexOf(x.go) < 0; });
    if (A().isOffline && A().isOffline()) out.push({ tone: 'info', r: 7, t: 'Offline copy', s: 'Showing the books saved on this phone', go: 'tab:reports' });
    out.sort(function (a, b) { return a.r - b.r; });
    return out;
  }
  function parseStamp(s) {
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
    if (!m) return null;
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) { var d = new Date(s.replace(' ', 'T')); return isNaN(d) ? null : d; }
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }

  /* v105: Action items card - open vs done donut, the top 3 open items, CTA to the full list */
  function secActions() {
    var AC = window.BlackRamActions;
    if (!AC || !AC.ready || !AC.ready()) return '<section class="td-card" aria-label="Action items"><div class="td-h-row"><h2 class="td-h">Action items</h2></div><p class="td-fine">Loading...</p></section>';
    var c = AC.counts(), top = AC.top(3);
    var rows = top.map(function (x) {
      return '<div class="td-al td-al-' + (x.tone === 'bad' ? 'bad' : (x.tone === 'warn' ? 'warn' : 'info')) + ' tl-tap tl-chev"' + tap('go', 'ac:' + x.id, x.t + '. Open') + '><span class="td-dot" aria-hidden="true"></span><span class="td-al-m"><b>' + esc(ascii(x.t)) + '</b><small>' + esc(x.owner + ' | ' + x.cat + (x.when ? ' | ' + x.when : '')) + '</small></span></div>';
    }).join('');
    return '<section class="td-card" aria-label="Action items"><div class="td-h-row"><h2 class="td-h">Action items</h2>' + (c.open ? pill(c.high ? 'bad' : 'warn', String(c.open)) : '') + '</div>' +
      '<div class="td-ac"><div class="td-ac-d">' + AC.donut(c, 84) + '</div><div class="td-ac-k"><span><b class="num-yellow">' + c.open + '</b> open</span><span><b style="color:#F87171">' + c.high + '</b> high</span><span><b style="color:#34D399">' + c.done + '</b> done</span></div></div>' +
      (rows ? '<div class="td-als">' + rows + '</div>' : '<p class="td-ok">Nothing waiting on anyone.</p>') +
      '<div class="td-btns"><button type="button" class="td-btn gold btn-glow" data-td-go="actions">All action items</button></div></section>';
  }

  function secAlerts(f) {
    var list = alerts(f);
    var loading = !(window.BlackRamDot && window.BlackRamDot.ready && window.BlackRamDot.ready()) || !(window.BlackRamMaintenance && window.BlackRamMaintenance.ready && window.BlackRamMaintenance.ready());
    var bad = list.filter(function (x) { return x.tone === 'bad'; }).length;
    var shown = st.showAll ? list : list.slice(0, 5);
    /* v98: the next 2 tax deadlines always show, even when service and DOT items fill the top 5 */
    if (!st.showAll) list.forEach(function (x) { if (String(x.go).indexOf('tax:') === 0 && shown.indexOf(x) < 0) shown.push(x); });
    var rows = shown.map(function (x) {
      return '<div class="td-al td-al-' + x.tone + ' tl-tap tl-chev"' + tap('go', x.go, x.t + '. Open') + '><span class="td-dot" aria-hidden="true"></span><span class="td-al-m"><b>' + esc(ascii(x.t)) + '</b><small>' + esc(ascii(x.s)) + '</small></span></div>';
    }).join('');
    var more = list.length > 5 ? '<button type="button" class="td-more" data-td-all="1">' + (st.showAll ? 'Show top 5' : 'Show all ' + list.length) + '</button>' : '';
    var empty = loading ? '<p class="td-fine">Checking DOT and maintenance...</p>' : '<p class="td-ok">All clear. Nothing overdue, missing or waiting.</p>';
    return '<section class="td-card" aria-label="Needs attention"><div class="td-h-row"><h2 class="td-h">Needs attention</h2>' +
      (list.length ? pill(bad ? 'bad' : 'warn', String(list.length)) : '') + '</div>' + (list.length ? '<div class="td-als">' + rows + '</div>' + more : empty) + '</section>';
  }

  function chart(cur, prev, bills, dayNow) {
    var W = 340, H = 150, L = 6, R = 6, TP = 14, B = 20;
    var vals = cur.pts.slice(0, dayNow).concat(prev ? prev.pts : []).concat([0, bills || 0]);
    var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals);
    if (mx === mn) mx = mn + 1;
    var span = mx - mn; mx += span * 0.08; mn -= span * 0.06;
    var dim = Math.max(cur.dim, prev ? prev.dim : 0);
    function x(i) { return L + (W - L - R) * (i / (dim - 1)); }
    function y(v) { return TP + (H - TP - B) * (1 - (v - mn) / (mx - mn)); }
    function path(pts, n) { return pts.slice(0, n).map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(''); }
    var cp = path(cur.pts, dayNow);
    var area = cp + 'L' + x(dayNow - 1).toFixed(1) + ' ' + y(Math.max(mn, 0)).toFixed(1) + 'L' + x(0).toFixed(1) + ' ' + y(Math.max(mn, 0)).toFixed(1) + 'Z';
    var svg = '<svg class="td-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Net kept by day this month vs last month and monthly bills">' +
      '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" class="td-zero"/><text x="' + (L + 2) + '" y="' + (y(0) - 4).toFixed(1) + '" class="td-lbl">$0</text>' +
      (bills ? '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(bills).toFixed(1) + '" y2="' + y(bills).toFixed(1) + '" class="td-bills"/><text x="' + (W - R) + '" y="' + (y(bills) - 4).toFixed(1) + '" text-anchor="end" class="td-lbl td-lbl-bills">Bills ' + money(bills) + '</text>' : '') +
      (prev ? '<path d="' + path(prev.pts, prev.dim) + '" class="td-prev"/>' : '') +
      '<path d="' + area + '" class="td-area"/><path d="' + cp + '" class="td-cur"/>' +
      '<circle cx="' + x(dayNow - 1).toFixed(1) + '" cy="' + y(cur.pts[dayNow - 1]).toFixed(1) + '" r="4" class="td-end"/>' +
      '<text x="' + L + '" y="' + (H - 5) + '" class="td-lbl">1</text><text x="' + (W - R) + '" y="' + (H - 5) + '" text-anchor="end" class="td-lbl">' + dim + '</text>' +
      '<text x="' + x(dayNow - 1).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" class="td-lbl td-lbl-now">' + dayNow + '</text></svg>';
    return svg;
  }

  function secMoney(f) {
    var ms = months(f);
    if (!ms.length) return '<section class="td-card"><h2 class="td-h">This month</h2><p class="td-fine">Books not loaded yet.</p></section>';
    var m = ms[ms.length - 1], prev = ms.length > 1 ? ms[ms.length - 2] : null;
    var fig = A().monthFigures ? A().monthFigures(m) : null;
    var model = window.BlackRamTargets && window.BlackRamTargets.model ? window.BlackRamTargets.model() : null;
    var bills = model && isFinite(model.fixed) ? model.fixed : null;
    var p = m.month.split('-');
    var tIso = todayIso();
    var cur = netSeries(m);
    var dayNow = tIso.slice(0, 7) === m.month ? +tIso.slice(8, 10) : (m.as_of && m.as_of.slice(0, 7) === m.month ? +m.as_of.slice(8, 10) : cur.dim);
    var pv = prev ? netSeries(prev) : null;
    var unpaid = 0, unpaidN = 0;
    allLoads(f).forEach(function (e) { var l = resolved(e.load); if (l.pay_status === 'unpaid' && isFinite(Number(l.net_due))) { unpaid += Number(l.net_due); unpaidN++; } });
    var net = fig ? fig.net : cur.pts[dayNow - 1];
    var toGo = bills != null ? bills - net : null;
    var head = toGo == null ? '' : (toGo <= 0 ? '<span class="td-good">Past break-even</span>' : '<b class="num-yellow">' + money(toGo) + '</b> to break-even');
    var tiles = '<div class="td-kpis">' +
      kpi('Gross', fig ? money(fig.gross) : '-', (fig ? fig.loads.length : 0) + ' loads', 'gross') +
      kpi('Net kept', money(net), 'after fee, fuel, costs', 'net') +
      kpi('Waiting on pay', money(unpaid), unpaidN + (unpaidN === 1 ? ' load' : ' loads'), 'unpaid') + '</div>';
    return '<section class="td-card td-money" aria-label="This month"><div class="td-h-row"><h2 class="td-h">' + MON[+p[1] - 1] + ' net kept vs bills</h2><span class="td-h-sub">' + head + '</span></div>' +
      '<div class="tl-tap td-chart-wrap"' + tap('go', 'tab:kpis', 'Open Scoreboard break-even') + '>' + chart(cur, pv, bills, Math.max(1, Math.min(dayNow, cur.dim))) + '</div>' +
      '<div class="td-legend"><span><i class="lg-cur"></i>' + MON[+p[1] - 1] + '</span>' + (prev ? '<span><i class="lg-prev"></i>' + MON[+prev.month.slice(5, 7) - 1] + '</span>' : '') + (bills ? '<span><i class="lg-bills"></i>Monthly bills</span>' : '') + '</div>' +
      tiles + '</section>';
  }
  function kpi(label, big, sub, key) {
    return '<div class="td-kpi tl-tap tl-corner"' + tap('kpi', key, label + ' ' + big + '. Open the list') + '><span>' + esc(label) + '</span><b class="num-yellow">' + esc(big) + '</b><small>' + esc(sub) + '</small></div>';
  }

  function ring(pct, tone) {
    var R = 17, C = 2 * Math.PI * R, v = Math.max(0, Math.min(100, pct || 0));
    return '<svg class="td-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="' + R + '" class="td-ring-bg"/>' + (v > 0 ? '<circle cx="22" cy="22" r="' + R + '" class="td-ring-fg td-' + tone + '" stroke-dasharray="' + (C * v / 100).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 22 22)"/>' : '') + '</svg>';
  }
  function secReady() {
    var D = window.BlackRamDot, M = window.BlackRamMaintenance;
    var dot = D && D.ready && D.ready() ? D.score() : null;
    var mrows = M && M.ready && M.ready() ? M.rows() : null;
    var checks = M && M.ready && M.ready() && M.checks ? M.checks() : [];
    var over = 0, soon = 0;
    (mrows || []).forEach(function (r) { if (r.status === 'over') over++; else if (r.status === 'soon') soon++; });
    var pre = checks.filter(function (c) { return /^pretrip/.test(c.key); });
    var pd = 0, pt = 0; pre.forEach(function (c) { pd += c.done; pt += c.total; });
    var dTone = dot ? (dot.pct >= 80 ? 'good' : (dot.pct >= 50 ? 'warn' : 'bad')) : 'muted';
    var mTone = mrows ? (over ? 'bad' : (soon ? 'warn' : 'good')) : 'muted';
    var pTone = pt ? (pd === pt ? 'good' : (pd ? 'warn' : 'muted')) : 'muted';
    function t(key, label, big, sub, tone, pct) {
      return '<div class="td-rd tl-tap"' + tap('go', key, label + ' ' + big + '. Open') + '>' + ring(pct, tone) + '<div><span>' + esc(label) + '</span><b class="num-yellow">' + esc(big) + '</b><small>' + esc(sub) + '</small></div></div>';
    }
    return '<section class="td-card" aria-label="Ready to roll"><h2 class="td-h">Ready to roll</h2><div class="td-rds">' +
      t('tab:dot', 'DOT ready', dot ? dot.pct + '%' : '...', dot ? (dot.c.gap || 0) + ' missing | ' + (dot.c.unk || 0) + ' unknown' : 'loading', dTone, dot ? dot.pct : 0) +
      t('tab:maint', 'Maintenance', mrows ? (over ? over + ' overdue' : (soon ? soon + ' due soon' : 'All OK')) : '...', mrows ? mrows.length + ' items tracked' : 'loading', mTone, mrows ? 100 * (mrows.length - over - soon) / Math.max(1, mrows.length) : 0) +
      t('pretrip', 'Pre-trip', pt ? pd + '/' + pt : '...', pt ? 'checked today on this phone' : 'loading', pTone, pt ? 100 * pd / pt : 0) +
      '</div></section>';
  }

  function secBoards() {
    var S = A().getScored ? A().getScored() : null;
    if (!S || !S.loads) return '<section class="td-card"><h2 class="td-h">Best on the boards</h2><p class="td-fine">Loading the last scan...</p></section>';
    var good = S.loads.filter(function (l) { return l.verdict === 'TAKE' || l.verdict === 'MAYBE'; })
      .sort(function (a, b) { return (a.verdict === b.verdict ? 0 : (a.verdict === 'TAKE' ? -1 : 1)) || ((Number(b.net_est) || 0) - (Number(a.net_est) || 0)); });
    var combos = (S.combos || []).filter(function (c) { return c.verdict === 'TAKE'; }).length;
    var stamp = S.scanned_at || S.as_of, dt = stamp ? parseStamp(String(stamp)) : null;
    var when = dt ? ((dt.getHours() % 12) || 12) + ':' + pad(dt.getMinutes()) + (dt.getHours() >= 12 ? ' PM' : ' AM') + ' ' + md(dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate())) : 'time not on file';
    var rows = good.slice(0, 3).map(function (l) {
      var tone = l.verdict === 'TAKE' ? 'good' : 'warn';
      var W = window.BlackRamWx;
      var low = l.drop_low_f;
      var cold = low != null && isFinite(Number(low)) && Number(low) <= 45;
      var wx = (W && W.iconHtml) ? W.iconHtml(W.kindForDrop ? W.kindForDrop(l) : '', { night: true, cold: cold }) : '';
      var wxBit = wx ? '<span class="td-bd-wx">' + wx + (low != null && isFinite(Number(low)) ? '<span>' + Math.round(Number(low)) + ' F</span>' : '') + '</span>' : '';
      return '<div class="td-bd tl-tap tl-chev"' + tap('go', 'tab:searches', l.verdict + ' ' + ascii(l.origin) + ' to ' + ascii(l.destination) + '. Open Load Boards') + '>' + pill(tone, l.verdict) +
        '<span class="td-bd-m"><b>' + esc(ascii(l.origin)) + ' to ' + esc(ascii(l.destination)) + '</b><small>' + wxBit + (l.posted_rate ? money(Number(l.posted_rate)) + ' posted | ' : '') + (l.total_mi ? n0(l.total_mi) + ' mi total' : 'miles not on file') + '</small></span>' +
        '<span class="td-bd-v"><b class="num-yellow">' + (l.net_est != null ? money(Number(l.net_est)) : '-') + '</b><small>net EST</small></span></div>';
    }).join('');
    var sub = S.loads.length + ' checked' + (combos ? ' | ' + combos + ' TAKE combos' : '') + ' | ' + when;
    return '<section class="td-card" aria-label="Best on the boards"><div class="td-h-row"><h2 class="td-h">Best on the boards</h2><span class="td-h-sub">' + esc(sub) + '</span></div>' +
      (rows ? '<div class="td-bds">' + rows + '</div>' : '<p class="td-fine">No TAKE or MAYBE loads in the last scan.</p>') +
      '<button type="button" class="td-more" data-td-go="searches">Open Load Boards</button></section>';
  }

  var QUICK = [
    ['check', 'Rate check', '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7h7M8.5 11h2M13.5 11h2M8.5 14.5h2M13.5 14.5h2M8.5 18h2M13.5 18h2"/>'],
    ['searches', 'Load boards', '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18.5" cy="17.5" r="2.5"/>'],
    ['pretrip', 'Pre-trip', '<path d="M9 4h6l1 2h3v14H5V6h3z"/><path d="M8.5 13.2l2.6 2.6 4.4-4.8"/>'],
    ['maint', 'Log service', '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>'],
    ['stops', 'Truck stops', '<path d="M12 21s-6.5-6.2-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'],
    ['dot', 'DOT check', '<path d="M12 3l7 2.6v5.6c0 4.4-2.9 8-7 9.8-4.1-1.8-7-5.4-7-9.8V5.6z"/><path d="M9 12l2.2 2.2L15.5 10"/>'],
    ['callsheet', 'Call sheet', '<path d="M6.6 3.5h2.6l1.4 4-1.9 1.3a11 11 0 0 0 6.5 6.5l1.3-1.9 4 1.4v2.6A2.1 2.1 0 0 1 18.3 20 15.8 15.8 0 0 1 4 5.7a2.1 2.1 0 0 1 2.6-2.2z"/>'],
    ['search', 'Search', '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>']
  ];
  function secQuick() {
    return '<section class="td-card" aria-label="Quick actions"><h2 class="td-h">Quick actions</h2><div class="td-qs">' + QUICK.map(function (q) {
      return '<button type="button" class="td-q" data-td-q="' + q[0] + '"><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + q[2] + '</g></svg><span>' + esc(q[1]) + '</span></button>';
    }).join('') + '</div></section>';
  }

  function render() {
    var el = root(); if (!el) return;
    var f = feed();
    var d = new Date();
    var asOf = '';
    var ms = months(f);
    if (ms.length && ms[ms.length - 1].as_of) asOf = 'Books thru ' + md(ms[ms.length - 1].as_of);
    var hdr = '<div class="td-hdr"><h1 class="td-h1">Today</h1><span>' + DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() + (asOf ? ' | ' + esc(asOf) : '') + '</span></div>';
    if (!f) {
      el.innerHTML = hdr + (A().skeleton ? A().skeleton('Loading today') : '<p class="td-fine">Loading...</p>') + secQuick();
      return;
    }
    el.innerHTML = hdr + secNow(f) + secActions() + secAlerts(f) + secMoney(f) + secReady() + secBoards() + secQuick() +
      '<p class="td-fine td-foot">Net kept = gross - carrier fee - fuel - other costs (ledger), before truck, trailer and insurance bills. Bills line = Targets monthly bills. Same numbers as Scoreboard. Tap any card for the detail.</p>';
  }
  function soon() { if (st.timer) return; st.timer = setTimeout(function () { st.timer = null; if (onToday()) render(); }, 60); }

  /* ---------- actions ---------- */
  function goTab(t) {
    var a = A(); if (!a.showTab) return;
    a.showTab(t);
    if (t !== 'check') return;
    /* From Today, Rate check skips the rig hero: scroll to the offer form and focus the rate box
       (same tap, so the phone keyboard opens). */
    var h = document.querySelector('#panel-check .rc-title'), r = document.getElementById('rate');
    if (h) window.scrollTo(0, Math.max(0, h.getBoundingClientRect().top + window.pageYOffset - 64));
    if (r) { try { r.focus({ preventScroll: true }); } catch (e) { /* old browser */ } }
  }
  function openPretrip() {
    var t = T();
    if (t) t.jump('mt-chk', 'maint'); else goTab('maint');
  }
  function act(arg) {
    var a = String(arg || ''), i = a.indexOf(':'), k = i < 0 ? a : a.slice(0, i), v = i < 0 ? '' : a.slice(i + 1);
    if (k === 'tab') return goTab(v);
    if (k === 'pretrip') return openPretrip();
    if (k === 'dot') { var D = window.BlackRamDot; if (D && D.openItem) D.openItem(v); return; }
    if (k === 'ac') { var AC = window.BlackRamActions; goTab('actions'); if (AC && AC.openItem) setTimeout(function () { AC.openItem(v); }, 120); return; }
    if (k === 'tax') { var X = window.BlackRamTax; goTab('tax'); if (X && X.openItem) setTimeout(function () { X.openItem(v); }, 120); return; }
    if (k === 'mt') { var M = window.BlackRamMaintenance; if (M && M.openItem) M.openItem(v); return; }
    if (k === 'mtneed') { var t = T(); goTab('maint'); if (t) setTimeout(function () { var b = document.querySelector('[data-tl="mt"][data-tl-arg="need"]'); if (b) b.click(); }, 400); return; }
    if (k === 'unpaid') return openLoads('unpaid');
  }
  function openLoads(kind) {
    var f = feed(), a = A(); if (!f || !a.openLoadsSheet) return;
    var ms = months(f), m = ms[ms.length - 1];
    var entries;
    if (kind === 'unpaid') {
      entries = allLoads(f).filter(function (e) { return resolved(e.load).pay_status === 'unpaid'; });
      a.openLoadsSheet({ title: 'Waiting on pay', sub: entries.length + ' delivered, not paid yet', entries: entries, mode: 'owed' });
      return;
    }
    entries = (m.loads || []).map(function (l) { return { load: l, pct: isFinite(Number(m.fee_pct)) ? Number(m.fee_pct) : 13 }; });
    a.openLoadsSheet({ title: kind === 'net' ? 'Net kept MTD' : 'Gross MTD', sub: MON[+m.month.slice(5, 7) - 1] + ' ' + m.month.slice(0, 4), entries: entries, expenses: kind === 'net' ? (m.expenses || []) : null, mode: kind === 'net' ? 'net' : 'gross' });
  }
  function quick(q) {
    if (q === 'pretrip') return openPretrip();
    if (q === 'callsheet') { if (A().openCallSheet) A().openCallSheet(); return; }
    if (q === 'search') { if (window.BlackRamSearch) window.BlackRamSearch.open(); return; }
    goTab(q);
  }

  function css() {
    if (document.getElementById('td-css')) return;
    var s = document.createElement('style'); s.id = 'td-css';
    s.textContent =
      '.td-root{display:flex;flex-direction:column;gap:var(--s-1h);padding:var(--s-1h) 0 var(--s-3)}' +
      '.td-hdr{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-1);flex-wrap:wrap}' +
      '.td-h1{margin:0;font-size:var(--fs-2xl);font-weight:var(--fw-black);color:var(--c-text-1);letter-spacing:-.01em}' +
      '.td-hdr span{font-size:var(--fs-xs);font-weight:800;color:var(--c-text-3)}' +
      '.td-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg);padding:var(--s-1h) var(--s-2);box-shadow:var(--shadow-1);display:flex;flex-direction:column;gap:var(--s-1)}' +
      '.td-h{margin:0;font-size:var(--fs-xs);font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--c-accent-hi)}' +
      '.td-h-row{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1)}' +
      '.td-h-sub{font-size:var(--fs-xs);font-weight:700;color:var(--c-text-3);text-align:right}.td-h-sub b{font-size:var(--fs-sm)}' +
      '.td-good{color:var(--c-take);font-weight:900}' +
      '.td-pill{display:inline-flex;align-items:center;min-height:22px;padding:0 9px;border-radius:var(--radius-pill);font-size:11px;font-weight:900;letter-spacing:.04em;flex:none}' +
      '.td-pill.td-good{background:var(--c-take-bg);color:var(--c-take)}.td-pill.td-warn{background:var(--c-maybe-bg);color:var(--c-maybe)}.td-pill.td-bad{background:rgba(248,113,113,.15);color:#FCA5A5}.td-pill.td-info{background:rgba(167,139,250,.16);color:var(--c-accent-hi)}.td-pill.td-muted{background:var(--c-pass-bg);color:var(--c-text-2)}' +
      '.td-now-top{display:flex;align-items:center;gap:var(--s-1);flex-wrap:wrap}.td-now-when{font-size:var(--fs-sm);font-weight:800;color:var(--c-text-2)}' +
      '.td-now-sub{margin:0;font-size:var(--fs-md);font-weight:800;color:var(--c-text-1)}' +
      '.td-lane{display:flex;align-items:center;gap:var(--s-1);font-size:var(--fs-lg);color:var(--c-text-1)}.td-lane i{flex:1;height:2px;background:linear-gradient(90deg,var(--c-accent),var(--c-gold));border-radius:2px;min-width:20px}' +
      '.td-now-kv{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s-1)}.td-now-kv span{font-size:11px;font-weight:700;color:var(--c-text-3);display:flex;flex-direction:column}.td-now-kv b{font-size:var(--fs-md);color:var(--c-text-1);font-weight:900;overflow-wrap:anywhere}' +
      '.td-btns{display:flex;gap:var(--s-1);flex-wrap:wrap}' +
      '.td-ac{display:flex;align-items:center;gap:14px;margin-bottom:8px}.td-ac-d{flex:none}.td-ac-k{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-sm);color:var(--c-text-3);font-weight:700}.td-ac-k b{font-size:var(--fs-lg);font-weight:900;margin-right:4px}' +
      '.td-btn{flex:1;min-height:var(--tap);padding:0 var(--s-2);border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-3);color:var(--c-text-1);font:inherit;font-size:var(--fs-md);font-weight:800;cursor:pointer}' +
      '.td-btn.gold{background:var(--c-gold);border-color:var(--c-gold);color:var(--c-gold-ink)}' +
      '.td-btn:active,.td-q:active,.td-more:active{transform:scale(.98)}' +
      '.td-als,.td-bds{display:flex;flex-direction:column;border:1px solid var(--c-line);border-radius:var(--radius-md);overflow:hidden}' +
      '.td-al,.td-bd{display:flex;align-items:center;gap:var(--s-1);padding:10px var(--s-1h);border-bottom:1px solid var(--c-line);background:var(--c-surface-2);min-height:var(--tap)}.td-al:last-child,.td-bd:last-child{border-bottom:0}' +
      '.td-dot{flex:none;width:10px;height:10px;border-radius:50%;background:var(--c-accent)}.td-al-bad .td-dot{background:#F87171;box-shadow:0 0 0 3px rgba(248,113,113,.2)}.td-al-warn .td-dot{background:var(--c-maybe)}.td-al-info .td-dot{background:var(--c-accent)}' +
      '.td-al-m,.td-bd-m{flex:1;min-width:0}.td-al-m b,.td-bd-m b{display:block;font-size:var(--fs-sm);font-weight:800;color:var(--c-text-1);overflow-wrap:anywhere}.td-al-m small,.td-bd-m small{display:block;font-size:11px;font-weight:700;color:var(--c-text-3);margin-top:1px}' +
      '.td-bd-wx{display:inline-flex;align-items:center;gap:4px;margin-right:8px;vertical-align:middle}' +
      '.td-bd-v{flex:none;text-align:right}.td-bd-v b{display:block;font-size:var(--fs-md);font-weight:900}.td-bd-v small{font-size:10px;font-weight:800;color:var(--c-text-3)}' +
      '.td-more{align-self:flex-start;min-height:38px;padding:0 14px;border-radius:var(--radius-pill);border:1px solid var(--c-accent);background:transparent;color:var(--c-accent-hi);font:inherit;font-size:var(--fs-sm);font-weight:800;cursor:pointer}' +
      '.td-ok{margin:0;font-size:var(--fs-sm);font-weight:800;color:var(--c-take)}' +
      '.td-fine{margin:0;font-size:11px;color:var(--c-text-3);line-height:1.45}.td-foot{padding:0 var(--s-h)}' +
      '.td-chart-wrap{border-radius:var(--radius-md);background:var(--c-surface-2);border:1px solid var(--c-line);padding:6px 4px 0}' +
      '.td-chart{display:block;width:100%;height:auto}' +
      '.td-zero{stroke:var(--c-line-strong);stroke-width:1}.td-bills{stroke:#F87171;stroke-width:1.5;stroke-dasharray:5 4}' +
      '.td-prev{fill:none;stroke:var(--c-text-3);stroke-width:1.6;stroke-dasharray:3 3;opacity:.8}' +
      '.td-cur{fill:none;stroke:var(--c-gold);stroke-width:2.6;stroke-linejoin:round;stroke-linecap:round}.td-area{fill:rgba(242,201,76,.12)}' +
      '.td-end{fill:var(--c-gold);stroke:var(--c-bg);stroke-width:2}' +
      '.td-lbl{font-size:10px;font-weight:800;fill:var(--c-text-3);font-family:var(--body)}.td-lbl-bills{fill:#FCA5A5}.td-lbl-now{fill:var(--c-gold)}' +
      '.td-legend{display:flex;gap:var(--s-2);flex-wrap:wrap;font-size:11px;font-weight:800;color:var(--c-text-3)}.td-legend span{display:inline-flex;align-items:center;gap:6px}' +
      '.td-legend i{display:inline-block;width:16px;height:0;border-top:3px solid var(--c-gold)}.td-legend .lg-prev{border-top:2px dashed var(--c-text-3)}.td-legend .lg-bills{border-top:2px dashed #F87171}' +
      '.td-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s-1)}' +
      '.td-kpi{background:var(--c-surface-2);border:1px solid var(--c-line);border-radius:var(--radius-md);padding:var(--s-1) 10px;min-width:0;display:flex;flex-direction:column}' +
      '.td-kpi span{font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--c-text-3)}.td-kpi b{font-size:var(--fs-lg);font-weight:900;line-height:1.2}.td-kpi small{font-size:10px;font-weight:700;color:var(--c-text-3)}' +
      '.td-rds{display:grid;grid-template-columns:1fr;gap:var(--s-1)}' +
      '.td-rd{display:flex;align-items:center;gap:var(--s-1h);background:var(--c-surface-2);border:1px solid var(--c-line);border-radius:var(--radius-md);padding:var(--s-1) var(--s-1h);min-height:56px}' +
      '.td-rd>div{display:grid;grid-template-columns:1fr auto;align-items:baseline;column-gap:var(--s-1);flex:1;min-width:0}.td-rd span{font-size:var(--fs-sm);font-weight:800;color:var(--c-text-1)}.td-rd b{font-size:var(--fs-lg);font-weight:900;text-align:right}.td-rd small{grid-column:1/-1;font-size:11px;font-weight:700;color:var(--c-text-3)}' +
      '.td-ring{width:40px;height:40px;flex:none}.td-ring-bg{fill:none;stroke:var(--c-surface-3);stroke-width:6}.td-ring-fg{fill:none;stroke-width:6;stroke-linecap:round}' +
      '.td-ring-fg.td-good{stroke:var(--c-take)}.td-ring-fg.td-warn{stroke:var(--c-maybe)}.td-ring-fg.td-bad{stroke:#F87171}.td-ring-fg.td-muted{stroke:var(--c-text-3)}' +
      '.td-qs{display:grid;grid-template-columns:repeat(4,1fr);gap:var(--s-1)}' +
      '.td-q{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:72px;padding:var(--s-1) 2px;border-radius:var(--radius-md);border:1px solid var(--c-line);background:var(--c-surface-2);color:var(--c-text-1);font:inherit;font-size:11px;font-weight:800;cursor:pointer;text-align:center;line-height:1.15}' +
      '.td-q svg{width:24px;height:24px;color:var(--c-gold)}' +
      '@media(min-width:720px){.td-rds{grid-template-columns:repeat(3,1fr)}.td-qs{grid-template-columns:repeat(8,1fr)}}';
    document.head.appendChild(s);
  }

  function bind() {
    var el = root(); if (!el) return;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-td-go]'); if (b) { goTab(b.getAttribute('data-td-go')); return; }
      b = e.target.closest('[data-td-q]'); if (b) { quick(b.getAttribute('data-td-q')); return; }
      b = e.target.closest('[data-td-all]'); if (b) { st.showAll = !st.showAll; render(); return; }
      b = e.target.closest('[data-td-deliver]'); if (b && A().openDeliverSheet) { A().openDeliverSheet(b.getAttribute('data-td-deliver')); }
    });
  }

  function init() {
    css(); bind();
    if (window.BlackRamTiles) {
      window.BlackRamTiles.on('td', function (arg) {
        var a = String(arg || '');
        if (a.indexOf('go:') === 0) return act(a.slice(3));
        if (a.indexOf('kpi:') === 0) { var k = a.slice(4); return k === 'unpaid' ? openLoads('unpaid') : openLoads(k); }
      });
    }
    /* DOT and maintenance load their public JSON on demand; Today needs both for the alerts. */
    function warm() {
      var D = window.BlackRamDot, M = window.BlackRamMaintenance, X = window.BlackRamTax;
      if (D && D.load && !D.ready()) D.load();
      if (X && X.load && !X.ready()) X.load();
      if (M && M.load && !M.ready()) M.load();
    }
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'today') { warm(); render(); } });
    document.addEventListener('blackram:data', soon);
    document.addEventListener('blackram:dot', soon);
    document.addEventListener('blackram:tax', soon);
    document.addEventListener('blackram:actions', soon);
    /* the DOT and maintenance modules re-render their own roots when their JSON lands */
    ['dr-root', 'mt-root'].forEach(function (id) {
      var r = document.getElementById(id);
      if (r && typeof MutationObserver === 'function') new MutationObserver(soon).observe(r, { childList: true });
    });
    setInterval(function () { if (onToday() && document.visibilityState === 'visible') render(); }, 60000);
    warm();
    render();
  }
  window.BlackRamToday = { render: render, city: city, act: act };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
