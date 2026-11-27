/* Black Ram Logistics - Team and partner 360 pages.
   Roster of first-name cards (Claudio, Ben, Meshach, Felix / Totni) styled like Driver 360.
   Meshach opens the existing Driver 360. Pay, capital, coverage dollars and any other
   money figures come ONLY from the PIN-gated relay /financials. Public chips are roles,
   MC, lease rate, and COI date. No phone, email, address, DOB, license or card numbers.
   Reuses Driver 360 .d3-* styles when present; does not edit driver360.js.
   Tiles reuse tiles.js (BlackRamTiles). Plain ASCII. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var FIN_KEY = 'blackram_fin_session_v1';
  var ART_V = '129';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var PEOPLE = [
    {
      id: 'claudio',
      name: 'Claudio',
      group: 'partner',
      kick: 'Partner 360',
      role: 'Partner / owner | Dispatch, loads, finances, and back office',
      short: 'Owner · dispatch and back office',
      chips: ['1/3 partner', 'Does not drive'],
      art: 'brand/claudio-360.jpg?v=' + ART_V,
      alt: 'Illustration of Claudio, gray hair and sunglasses, arms crossed in front of a white Audi RS Q8 at sunset.',
      duties: [
        { t: 'Dispatch', s: 'In-house', d: 'since Nov 1, 2026' },
        { t: 'Loads', s: 'Books them', d: 'company load board' },
        { t: 'Finances', s: 'Ledger', d: 'bills and reports' },
        { t: 'Back office', s: 'App + admin', d: 'day-to-day' }
      ],
      calls: [{ tone: 'ok', html: 'One-third member-owner of Sand Lily Pad LLC. He does not drive the rig and is listed as an excluded driver.' }],
      tbd: ['Formal title beyond partner / owner: TBD']
    },
    {
      id: 'ben',
      name: 'Ben',
      group: 'partner',
      kick: 'Partner 360',
      role: 'Partner | Trailer capital and company paydowns',
      short: 'Partner · trailer capital',
      chips: ['1/3 partner', 'Trailer capital'],
      art: 'brand/ben-360.jpg?v=' + ART_V,
      alt: 'Illustration of Ben in a tan coat, in front of the black Ram 3500 dually and Big Tex gooseneck at sunset.',
      duties: [
        { t: 'Trailer capital', s: 'Cash down', d: 'invoice minus financed' },
        { t: 'Card paydowns', s: 'As capital', d: 'company card payments' },
        { t: 'LLC / legal', s: 'Member fee', d: 'added Meshach' },
        { t: 'Day-to-day ops', s: 'TBD', d: 'role not on file' }
      ],
      calls: [{ tone: 'ok', html: 'One-third member-owner. Dollar amounts for capital sit behind the PIN, same as Finance.' }],
      tbd: ['Day-to-day operating role: TBD', 'Wyoming LLC formation amount: TBD (receipts pending)']
    },
    {
      id: 'meshach',
      name: 'Meshach',
      group: 'partner',
      kick: 'Driver 360',
      role: 'Driver and 1/3 partner | Black Ram Logistics',
      short: 'Driver + partner',
      chips: ['1/3 partner', 'Driver'],
      art: 'brand/meshach-360.png?v=' + ART_V,
      alt: 'Illustration of Meshach, arms crossed, in front of the black Ram 3500 dually with the Big Tex gooseneck hitch at sunset.',
      driver360: true
    },
    {
      id: 'felix',
      name: 'Felix',
      group: 'carrier',
      kick: 'Carrier 360',
      role: 'Carrier owner | Totni, our lease-on carrier',
      short: 'Totni owner · lease-on carrier',
      chips: ['MC 1122113', '13% cut', 'COI 12/10/26'],
      art: 'brand/felix-360.jpg?v=' + ART_V,
      alt: 'Illustration of Felix in a dark suit, in front of a Ram and freight trucks at sunset.',
      duties: [
        { t: 'MC authority', s: '1122113', d: 'Totni MC' },
        { t: 'ELD', s: 'Included', d: 'under Totni' },
        { t: 'COI', s: '12/10/26', d: 'expires' },
        { t: 'Lease cut', s: '13%', d: 'of gross' }
      ],
      calls: [{ tone: 'warn', html: 'Sand Lily Pad is leased onto Totni. Dispatch has been in-house since Nov 1, 2026, not run by Totni.' }],
      tbd: ['Signed lease copy on file: TBD', 'Bobtail / non-trucking and trailer interchange on the COI: TBD']
    }
  ];

  var st = { teamOpen: false, who: null, feed: null, feedErr: '', fin: null, finErr: '', finLoading: false, fetchedAt: 0, teamFocus: null, personFocus: null, d3watch: null };

  function $(id) { return document.getElementById(id); }
  function person(id) { for (var i = 0; i < PEOPLE.length; i++) if (PEOPLE[i].id === id) return PEOPLE[i]; return null; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function m0(n) { if (n == null || !isFinite(n)) return '-'; var a = Math.abs(Math.round(n)).toLocaleString('en-US'); return (n <= -0.5 ? '-$' : '$') + a; }
  function m2(n) { if (n == null || !isFinite(n)) return '-'; var a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < -0.004 ? '-$' : '$') + a; }
  function n0(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  function day(iso) { if (!iso) return '?'; var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function dayY(iso) { if (!iso) return '?'; var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]) + '/' + String(p[0]).slice(2); }
  function pubLabel(s) { return String(s || '').replace(/\s*\.{2,}\s*\d{3,5}\b/g, '').replace(/Need from Claudio/gi, 'TBD'); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5); }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private mode */ } }
  function T() { return window.BlackRamTiles; }
  function ta(key, arg, label) { var t = T(); return t ? t.attrs(key, arg, label) : ''; }

  /* ---------- data ---------- */
  function loadFeed() {
    var A = window.BlackRamApp, f = A && A.getFeed ? A.getFeed() : null;
    if (f && f.months) { st.feed = f; return; }
    if (st.feedLoading) return;
    st.feedLoading = true;
    fetch('data/feed.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { st.feed = j; st.feedErr = ''; })
      .catch(function (e) { st.feedErr = 'Could not load the ledger (' + (e && e.message || 'offline') + ').'; })
      .then(function () { st.feedLoading = false; renderTeam(); renderPerson(); });
  }
  function finCache() { try { var c = sessionStorage.getItem(FIN_KEY); if (!c) return null; var j = JSON.parse(c); return j && j.accounting ? j : null; } catch (e) { return null; } }
  function loadFin(force) {
    var p = pin();
    if (!p) { st.fin = null; st.finErr = 'nopin'; return; }
    if (!st.fin) { var c = finCache(); if (c) { st.fin = c; st.finErr = ''; } }
    if (st.finLoading || (!force && st.fin && Date.now() - st.fetchedAt < 60000)) return;
    st.finLoading = true;
    fetch(RELAY + '/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }), cache: 'no-store' })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (resp.ok && j && j.ok && j.data) {
            st.fin = j.data.accounting ? j.data : null; st.finErr = st.fin ? '' : 'Pay data is not on the server yet.'; st.fetchedAt = Date.now();
            try { sessionStorage.setItem(FIN_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ }
          } else if (resp.status === 401) { st.fin = null; st.finErr = 'wrongpin'; }
          else st.finErr = st.fin ? '' : 'Server error (' + resp.status + ').';
        });
      })
      .catch(function () { if (!st.fin) st.finErr = 'Offline. Try again when you have signal.'; })
      .then(function () { st.finLoading = false; renderTeam(); renderPerson(); });
  }

  function allLoads() {
    var out = [];
    ((st.feed && st.feed.months) || []).forEach(function (m) { (m.loads || []).forEach(function (l) { out.push(Object.assign({ _m: m.month }, l)); }); });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function isDone(l) { return /deliver/i.test(l.status || ''); }
  function stats() {
    var L = allLoads(), done = L.filter(isDone);
    var s = { loads: done.length, all: L, done: done, loaded: 0, dead: 0, first: null, onTime: 0, onTimeProof: 0 };
    done.forEach(function (l) {
      s.loaded += Number(l.loaded_mi) || 0;
      s.dead += Number(l.empty_mi_est) || 0;
      if (!s.first || l.date < s.first) s.first = l.date;
      var due = l.delivery_date, got = l.delivered_date;
      if (got && due) { s.onTimeProof++; if (got <= due) s.onTime++; }
      else if (due) { if (String(l.status || '').toLowerCase().indexOf('deliver') >= 0) s.onTime++; }
    });
    return s;
  }

  /* ---------- shared UI bits (same classes as Driver 360) ---------- */
  function tile(label, big, sub, tone) {
    return '<div class="d3-t' + (tone ? ' d3-' + tone : '') + '"><span>' + esc(label) + '</span><b>' + big + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  }
  function card(id, title, sub, body) {
    return '<section class="d3-card" id="' + id + '"><div class="d3-ch"><h3>' + esc(title) + '</h3>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>' + body + '</section>';
  }
  function call(tone, html) { return '<p class="d3-call d3-' + tone + '">' + html + '</p>'; }
  function lockBox(what) {
    var bad = st.finErr === 'wrongpin';
    return '<div class="d3-lock"><p' + (bad ? ' class="d3-err"' : '') + '>' + (bad ? 'Wrong PIN. Try again.' : esc(what) + ' Enter the app PIN.') + '</p>' +
      '<form class="d3-pin" data-tm-pin="1" autocomplete="off"><input type="password" inputmode="numeric" placeholder="App PIN" aria-label="App PIN"><button type="submit" class="btn primary">Unlock</button></form></div>';
  }

  function partnerRec(name) {
    var P = (st.fin && st.fin.accounting && st.fin.accounting.partners) || [];
    for (var i = 0; i < P.length; i++) if (P[i].name === name) return P[i];
    return null;
  }
  function secCap(p) {
    if (p.group !== 'partner') return '';
    if (!pin() || st.finErr === 'wrongpin' || st.finErr === 'nopin') return card('tm-cap', 'Partner capital', 'PIN', lockBox('Partner capital is private.'));
    if (!st.fin) return card('tm-cap', 'Partner capital', 'PIN', '<p class="d3-fine">' + esc(st.finErr || 'Loading...') + '</p>');
    var P = (st.fin.accounting.partners || []), me = partnerRec(p.name);
    if (!me) return card('tm-cap', 'Partner capital', 'PIN', '<p class="d3-fine">No partner record found.</p>');
    var tot = P.reduce(function (s, x) { return s + (x.capital_total || 0); }, 0);
    var bars = P.slice().sort(function (a, b) { return b.capital_total - a.capital_total; }).map(function (x) {
      return '<div class="d3-crow' + (x.name === p.name ? ' me' : '') + '"><span>' + esc(x.name) + '</span><div class="d3-ctrack"><i style="width:' + (tot ? x.capital_total / tot * 100 : 0).toFixed(1) + '%"></i></div><b>' + m0(x.capital_total) + '</b></div>';
    }).join('');
    var rows = (me.capital || []).slice().reverse().map(function (c) {
      return '<div class="d3-ev"><span class="d3-evd">' + day(c.date) + '</span><span class="d3-evi d3-unk"></span><span class="d3-evm"><b>' + esc(pubLabel(c.label)) + '</b><small>' + m2(c.amount) + '</small></span></div>';
    }).join('');
    return card('tm-cap', 'Partner capital', esc(me.share || '1/3') + ' owner',
      '<div class="d3-grid d3-g2">' + tile('Put in', m2(me.capital_total), (me.capital || []).length + ' contributions') +
      tile('Share of capital', (tot ? Math.round(me.capital_total / tot * 100) : 0) + '%', 'of ' + m0(tot) + ' total') + '</div>' +
      '<div class="d3-cbars tl-tap"' + ta('tmacct', 'cap:' + p.name, 'Partner capital. Open ' + p.name + '\'s contributions') + '>' + bars + '</div>' +
      (rows ? '<div class="d3-tl">' + rows + '</div>' : '') +
      '<p class="d3-fine">Repaid (not a distribution): ' + m0(me.repaid_total || 0) + '. Distributions so far: ' + m0(me.dist_all || 0) + '.</p>');
  }
  function secShare(p) {
    if (p.group !== 'partner') return '';
    if (!pin() || st.finErr === 'wrongpin' || st.finErr === 'nopin') return card('tm-share', 'Profit share', 'PIN', lockBox('Profit share is private.'));
    if (!st.fin) return card('tm-share', 'Profit share', 'PIN', '<p class="d3-fine">' + esc(st.finErr || 'Loading...') + '</p>');
    var me = partnerRec(p.name);
    var D = (st.fin.accounting && st.fin.accounting.driver) || {};
    var rule = D.rule || 'Bills first, then driver pay from profit, then leftover split in thirds.';
    return card('tm-share', 'Profit share', '1/3 of leftover',
      '<div class="d3-grid d3-g3">' + tile('Share', esc((me && me.share) || '1/3'), 'after bills and driver pay') +
      tile('This month', m0(me && me.third_month), 'this month\'s third') +
      tile('All time', m0(me && me.dist_all), 'distributions') + '</div>' +
      call('ok', 'Order: bills first, then up to <b>' + m0(D.monthly || D.target || 3000) + '/mo</b> to Meshach from actual profit, then thirds among Claudio, Ben and Meshach. A shortfall is not a debt.') +
      '<p class="d3-fine">' + esc(rule) + '</p>');
  }
  function secCompany(p) {
    if (p.id !== 'claudio' && p.id !== 'meshach') return '';
    var s = st.feed ? stats() : null;
    if (!s) return card('tm-co', 'Company loads', '', '<p class="d3-fine">' + esc(st.feedErr || 'Loading the ledger...') + '</p>');
    var ot = s.loads ? Math.round(s.onTime / s.loads * 100) : 0;
    var title = p.id === 'claudio' ? 'Company loads' : 'Loads (company ledger)';
    var sub = p.id === 'claudio' ? 'dispatched in-house' : 'same numbers as Scoreboard';
    return card('tm-co', title, sub,
      '<div class="d3-grid d3-g3">' + tile('Loads done', String(s.loads), s.first ? 'since ' + day(s.first) : '') +
      tile('Miles', n0(s.loaded + s.dead), n0(s.loaded) + ' loaded + ' + n0(s.dead) + ' DH') +
      tile('On time', ot + '%', 'per delivery date') + '</div>' +
      '<p class="d3-fine">Company totals from the public ledger, not a personal driving log' + (p.id === 'claudio' ? '. He books the loads; Meshach drives them.' : '.') + '</p>');
  }
  function secDuties(p) {
    if (!p.duties || !p.duties.length) return '';
    var title = p.group === 'carrier' ? 'What Totni provides' : 'Role';
    var body = '<div class="d3-grid d3-g2">' + p.duties.map(function (d) {
      return tile(d.t, esc(d.s || 'TBD'), d.d ? esc(d.d) : '');
    }).join('') + '</div>';
    var calls = (p.calls || []).map(function (c) { return call(c.tone, c.html); }).join('');
    var tbd = (p.tbd || []).length ? '<p class="d3-fine">' + p.tbd.map(function (x) { return esc(x); }).join(' · ') + '</p>' : '';
    return card('tm-role', title, p.group === 'carrier' ? 'lease-on' : '1/3 owner', body + calls + tbd);
  }
  function secCoi(p) {
    if (p.id !== 'felix') return '';
    var left = daysBetween(todayIso(), '2026-12-10');
    var soon = left <= 14;
    var pub = '<div class="d3-grid d3-g2">' + tile('MC', '1122113', 'Totni authority') +
      tile('Lease cut', '13%', 'of gross') +
      tile('COI expires', '12/10/26', left >= 0 ? (left + ' days left') : 'expired', soon ? 'bad' : '') +
      tile('Dispatch', 'In-house', 'not Totni, since Nov 1') + '</div>';
    var priv;
    if (!pin() || st.finErr === 'wrongpin' || st.finErr === 'nopin') priv = lockBox('Coverage dollar amounts are private.');
    else if (!st.fin) priv = '<p class="d3-fine">' + esc(st.finErr || 'Loading...') + '</p>';
    else {
      var totni = (st.fin.insurance && st.fin.insurance.totni) || {};
      var lim = totni.limits || [];
      var rows = lim.map(function (row) {
        var label = row && row[0], val = row && row[1], ded = row && row[2];
        if (!label) return '';
        return '<div class="d3-ev"><span class="d3-evm"><b>' + esc(pubLabel(label)) + '</b><small>' + esc(pubLabel(val || 'TBD')) + (ded ? ' · ' + esc(pubLabel(ded)) : '') + '</small></span></div>';
      }).join('');
      priv = '<p class="d3-fine">' + esc(totni.insurer || 'Insurer on file') + (totni.start && totni.end ? ' · ' + dayY(totni.start) + ' to ' + dayY(totni.end) : '') + '</p>' +
        (rows ? '<div class="d3-tl">' + rows + '</div>' : '<p class="d3-fine">Coverage details not on the financials payload.</p>');
    }
    return card('tm-coi', 'Carrier facts', 'Totni', pub + priv);
  }
  function secHero(p, s) {
    var chips = (p.chips || []).map(function (c) { return '<span class="d3-chip">' + esc(c) + '</span>'; }).join('');
    if (p.group === 'partner' && s && s.loads && (p.id === 'claudio' || p.id === 'meshach')) {
      chips += '<span class="d3-chip">' + s.loads + ' company loads</span><span class="d3-chip">' + n0(s.loaded + s.dead) + ' mi</span>';
    }
    return '<figure class="d3-hero"><img src="' + esc(p.art) + '" width="864" height="1152" alt="' + esc(p.alt) + '" decoding="async">' +
      '<figcaption><span class="d3-kick">' + esc(p.kick) + '</span><b>' + esc(p.name) + '</b><span class="d3-role">' + esc(p.role) + '</span>' +
      '<span class="d3-chips">' + chips + '</span></figcaption></figure>';
  }

  /* ---------- Team roster ---------- */
  function rosterCard(p, s) {
    var extra = '';
    if (p.id === 'meshach' && s) {
      extra = '<span class="tm-cs"><span><b>' + s.loads + '</b>loads</span><span><b>' + n0(s.loaded) + '</b>loaded mi</span></span>';
    } else if (p.id === 'felix') {
      var left = daysBetween(todayIso(), '2026-12-10');
      extra = '<span class="tm-cs"><span><b>13%</b>cut</span><span><b>' + (left >= 0 ? left + 'd' : '—') + '</b>COI left</span></span>';
    } else if (p.group === 'partner') {
      extra = '<span class="tm-cs"><span><b>1/3</b>owner</span></span>';
    }
    return '<button type="button" class="tm-card" data-tm-open="' + p.id + '" aria-label="' + esc(p.name) + ', ' + esc(p.short) + '. Open 360">' +
      '<span class="tm-face is-' + p.id + '" style="background-image:url(' + esc(p.art) + ')" aria-hidden="true"></span>' +
      '<span class="tm-meta"><small>' + esc(p.group === 'carrier' ? 'Carrier' : 'Partner') + '</small><b>' + esc(p.name) + '</b><span>' + esc(p.short) + '</span></span>' +
      extra + '<span class="d3-tchev" aria-hidden="true">&rsaquo;</span></button>';
  }
  function renderTeam() {
    if (!st.teamOpen) return;
    var h = teamHost(), sc = h.querySelector('.d3-scroll'), top = sc ? sc.scrollTop : 0;
    var s = st.feed ? stats() : null;
    var partners = PEOPLE.filter(function (p) { return p.group === 'partner'; }).map(function (p) { return rosterCard(p, s); }).join('');
    var carrier = PEOPLE.filter(function (p) { return p.group === 'carrier'; }).map(function (p) { return rosterCard(p, s); }).join('');
    var coChips = '<div class="d3-chips tm-cochips">' +
      '<span class="d3-chip">1/3 each</span>' +
      '<span class="d3-chip">Jacksonville, FL</span>' +
      '<span class="d3-chip">Totni MC 1122113</span>' +
      '<span class="d3-chip">Ram 3500 DRW + 25GN</span>' +
      (s ? '<span class="d3-chip">' + s.loads + ' loads</span>' : '') +
      '</div>';
    var body = '<div class="tm-intro"><span class="d3-kick">Sand Lily Pad LLC</span><b>Black Ram Logistics</b><span class="d3-role">Hotshot · leased onto Totni</span>' + coChips + '</div>' +
      '<h3 class="tm-h">Partners</h3><div class="tm-list">' + partners + '</div>' +
      '<h3 class="tm-h">Carrier</h3><div class="tm-list">' + carrier + '</div>' +
      '<p class="d3-fine d3-foot">First names only. No phone, email or address. Capital, pay and coverage dollars need the PIN.</p>';
    h.innerHTML = '<div class="d3-bar"><button type="button" class="d3-back" data-tm-close="1" aria-label="Close Team">Back</button><b>Team</b><span>Sand Lily Pad</span></div><div class="d3-scroll">' + body + '</div>';
    var ns = h.querySelector('.d3-scroll'); if (ns) ns.scrollTop = top;
  }
  function teamHost() {
    var h = $('tm-view');
    if (h) return h;
    h = document.createElement('div'); h.id = 'tm-view'; h.className = 'tm-view'; h.hidden = true;
    h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', 'Team');
    document.body.appendChild(h);
    h.addEventListener('click', function (e) {
      if (e.target.closest('[data-tm-close]')) { closeTeam(); return; }
      var open = e.target.closest('[data-tm-open]');
      if (open) openPerson(open.getAttribute('data-tm-open'));
    });
    return h;
  }

  /* ---------- Person 360 ---------- */
  function renderPerson() {
    if (!st.who) return;
    var p = person(st.who); if (!p || p.driver360) return;
    var h = personHost(), sc = h.querySelector('.d3-scroll'), top = sc ? sc.scrollTop : 0;
    stopOrbit(h);
    var s = st.feed ? stats() : null;
    var jump = [['tm-role', p.group === 'carrier' ? 'Provides' : 'Role']];
    if (p.id === 'claudio' || p.id === 'meshach') jump.push(['tm-co', 'Loads']);
    if (p.group === 'partner') { jump.push(['tm-cap', 'Capital']); jump.push(['tm-share', 'Share']); }
    if (p.id === 'felix') jump.push(['tm-coi', 'Carrier']);
    var body = secHero(p, s) +
      '<nav class="d3-jump">' + jump.map(function (j) { return '<a href="#' + j[0] + '" data-tm-jump="' + j[0] + '">' + j[1] + '</a>'; }).join('') + '</nav>' +
      secDuties(p) + secCompany(p) + secCap(p) + secShare(p) + secCoi(p) +
      '<p class="d3-fine d3-foot">First name only. No contact, license or address details are kept in the app. Money figures need the PIN.</p>';
    h.innerHTML = '<div class="d3-bar"><button type="button" class="d3-back" data-p360-close="1" aria-label="Back to Team">Back</button><b>' + esc(p.kick) + '</b><span>' + esc(p.name) + '</span></div><div class="d3-scroll">' + body + '</div>';
    var ns = h.querySelector('.d3-scroll'); if (ns) ns.scrollTop = top;
    var hf = h.querySelector('.d3-hero');
    if (hf && window.BlackRamDriver && window.BlackRamDriver.bindOrbit) window.BlackRamDriver.bindOrbit(hf);
    h.querySelectorAll('[data-tm-jump]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); var t = $(a.getAttribute('data-tm-jump')); if (t && ns) ns.scrollTo({ top: t.offsetTop - 56, behavior: 'smooth' }); });
    });
    h.setAttribute('aria-label', p.kick + ': ' + p.name);
  }
  function stopOrbit(h) {
    var f = h && h.querySelector('.d3-hero');
    if (f && f._orb && f._orb.raf) { cancelAnimationFrame(f._orb.raf); f._orb.raf = 0; }
  }
  function personHost() {
    var h = $('p360-view');
    if (h) return h;
    h = document.createElement('div'); h.id = 'p360-view'; h.className = 'd3-view p360-view'; h.hidden = true;
    h.setAttribute('role', 'dialog'); h.setAttribute('aria-modal', 'true'); h.setAttribute('aria-label', 'Partner 360');
    document.body.appendChild(h);
    h.addEventListener('click', function (e) {
      if (e.target.closest('[data-p360-close]')) { closePerson(); return; }
    });
    h.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-tm-pin]'); if (!f) return;
      e.preventDefault();
      var v = (f.querySelector('input').value || '').trim(); if (!v) return;
      setPin(v); st.fin = null; st.finErr = ''; loadFin(true); renderPerson();
    });
    return h;
  }

  function openCap(name) {
    var Acc = window.BlackRamAccounting;
    if (Acc && Acc.drill) { Acc.drill('cap:' + name); return; }
    var t = T(); if (t) { closePerson(); closeTeam(); t.jump('ac-partners', 'acct'); }
  }

  /* ---------- open / close ---------- */
  function showTeamLayer() {
    var h = teamHost();
    h.hidden = false;
    document.documentElement.classList.add('tm-noscroll');
  }
  function openTeam() {
    st.teamOpen = true;
    st.teamFocus = document.activeElement;
    loadFeed(); loadFin(false);
    showTeamLayer();
    renderTeam();
    var b = teamHost().querySelector('.d3-back'); if (b) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
  }
  function closeTeam() {
    if (st.who) closePerson();
    if (!st.teamOpen) return;
    st.teamOpen = false;
    var h = $('tm-view'); if (h) { h.hidden = true; h.innerHTML = ''; }
    document.documentElement.classList.remove('tm-noscroll');
    if (st.teamFocus && st.teamFocus.focus && document.contains(st.teamFocus)) { try { st.teamFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function openPerson(id) {
    var p = person(id); if (!p) return;
    if (!st.teamOpen) openTeam();
    if (p.driver360) { openMeshach(); return; }
    st.who = p.id;
    st.personFocus = document.activeElement;
    loadFeed(); loadFin(false);
    var h = personHost(); h.hidden = false; renderPerson();
    document.documentElement.classList.add('tm-noscroll');
    var b = h.querySelector('.d3-back'); if (b) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
  }
  function closePerson() {
    if (!st.who) return;
    st.who = null;
    var h = $('p360-view'); if (h) { stopOrbit(h); h.hidden = true; h.innerHTML = ''; }
    if (st.teamOpen) showTeamLayer();
    if (st.personFocus && st.personFocus.focus && document.contains(st.personFocus)) { try { st.personFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function openMeshach() {
    var tm = $('tm-view'); if (tm) tm.hidden = true;
    if (window.BlackRamDriver) window.BlackRamDriver.open();
    watchDriver();
  }
  function watchDriver() {
    if (st.d3watch) { try { st.d3watch.disconnect(); } catch (e) { /* ignore */ } st.d3watch = null; }
    var d = $('d3-view');
    if (!d) { if (st.teamOpen) showTeamLayer(); return; }
    var obs = new MutationObserver(function () {
      if (d.hidden) {
        obs.disconnect(); st.d3watch = null;
        if (st.teamOpen) showTeamLayer();
      }
    });
    obs.observe(d, { attributes: true, attributeFilter: ['hidden'] });
    st.d3watch = obs;
  }

  /* ---------- css: reuse d3-* if Driver 360 already injected it; plus team roster ---------- */
  function ensureD3css() {
    if ($('d3-css')) return;
    if (window.BlackRamDriver && typeof window.BlackRamDriver === 'object') {
      /* Driver 360 inits on DOMContentLoaded and owns #d3-css. If it has not run yet,
         copy is not needed: we wait a tick, then inject a compatible subset if still missing. */
    }
    var s = document.createElement('style'); s.id = 'd3-css';
    s.textContent =
      'html.d3-noscroll,html.d3-noscroll body{overflow:hidden}' +
      '.d3-view{position:fixed;inset:0;z-index:2650;background:var(--c-bg);display:flex;flex-direction:column;color:var(--c-text-1)}' +
      '.d3-bar{display:flex;align-items:center;gap:10px;min-height:52px;padding:calc(env(safe-area-inset-top,0px) + 6px) 12px 6px;background:var(--c-surface-1);border-bottom:1px solid var(--c-line)}.d3-bar b{font-size:16px;font-weight:900}.d3-bar span{margin-left:auto;color:var(--c-text-3);font-size:12px;font-weight:800}' +
      '.d3-back{min-height:40px;min-width:64px;border-radius:var(--radius-pill,999px);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-weight:800;font-size:14px}' +
      '.d3-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 12px calc(env(safe-area-inset-bottom,0px) + var(--bnav-h,64px) + 28px);max-width:560px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:12px}' +
      '.d3-scroll>*{flex-shrink:0}' +
      '.d3-hero{position:relative;margin:0;border-radius:14px;overflow:hidden;border:1px solid var(--c-line);aspect-ratio:3/4;background:#2a1a33}.d3-hero img{display:block;width:100%;height:100%;object-fit:cover}' +
      '.d3-hero figcaption{position:absolute;left:0;right:0;bottom:0;padding:48px 14px 14px;background:linear-gradient(180deg,rgba(15,13,23,0),rgba(15,13,23,.78) 45%,rgba(15,13,23,.95));display:flex;flex-direction:column;gap:2px}' +
      '.d3-kick{font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--c-gold)}.d3-hero figcaption>b{font-size:34px;font-weight:900;line-height:1;letter-spacing:.01em}.d3-role{font-size:13px;font-weight:700;color:var(--c-text-2)}' +
      '.d3-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.d3-chip{font-size:12px;font-weight:800;padding:4px 10px;border-radius:999px;background:rgba(242,201,76,.16);color:var(--c-gold);border:1px solid rgba(242,201,76,.35)}' +
      '.d3-jump{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none}.d3-jump a{flex:0 0 auto;padding:6px 12px;border-radius:999px;background:var(--c-surface-2);border:1px solid var(--c-line);color:var(--c-text-2);font-size:12px;font-weight:800;text-decoration:none}' +
      '.d3-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px}' +
      '.d3-ch{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.d3-ch h3{margin:0;font-size:17px;font-weight:900}.d3-ch span{font-size:12px;font-weight:800;color:var(--c-text-3)}' +
      '.d3-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.d3-g3{grid-template-columns:repeat(3,minmax(0,1fr))}.d3-g2{grid-template-columns:repeat(2,minmax(0,1fr))}' +
      '.d3-t{position:relative;display:flex;flex-direction:column;gap:2px;padding:10px 22px 10px 10px;border-radius:10px;background:var(--c-surface-2);border:1px solid var(--c-line);min-width:0}' +
      '.d3-t span{font-size:11px;font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.04em}.d3-t b{font-size:21px;font-weight:900;line-height:1.1;color:var(--num-yellow,var(--c-gold,#F2C94C))}.d3-t small{font-size:11px;font-weight:700;color:var(--c-text-3);line-height:1.25}' +
      '.d3-g3 .d3-t b{font-size:18px}.d3-t.d3-good b{color:var(--c-take)}.d3-t.d3-bad b{color:#FCA5A5}' +
      '.d3-call{margin:0;padding:8px 10px;border-radius:10px;font-size:13px;line-height:1.35;border-left:3px solid}.d3-call.d3-ok{background:rgba(52,211,153,.08);border-color:var(--c-take)}.d3-call.d3-warn{background:rgba(251,191,36,.08);border-color:var(--c-maybe)}' +
      '.d3-fine{margin:0;font-size:11.5px;line-height:1.4;color:var(--c-text-3)}.d3-foot{text-align:center;padding:4px 8px}' +
      '.d3-cbars{display:flex;flex-direction:column;gap:6px;padding:4px 0}.d3-crow{display:grid;grid-template-columns:70px 1fr 64px;align-items:center;gap:8px;font-size:13px;font-weight:800;color:var(--c-text-2)}.d3-crow b{text-align:right;color:var(--c-text-1)}.d3-ctrack{height:12px;border-radius:999px;background:var(--c-surface-3);overflow:hidden}.d3-ctrack i{display:block;height:100%;background:#6d6787;border-radius:999px}.d3-crow.me{color:var(--c-gold)}.d3-crow.me .d3-ctrack i{background:var(--c-gold)}' +
      '.d3-lock{display:flex;flex-direction:column;gap:8px}.d3-lock p{margin:0;font-size:13px;color:var(--c-text-2)}.d3-err{color:#FCA5A5!important;font-weight:800}.d3-pin{display:flex;gap:8px}.d3-pin input{flex:1;min-width:0;min-height:var(--tap);padding:0 12px;border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-size:16px}.d3-pin .btn{flex:0 0 96px;min-height:var(--tap)}' +
      '.d3-tl{display:flex;flex-direction:column;gap:6px}.d3-ev{position:relative;display:flex;align-items:flex-start;gap:10px;padding:9px 26px 9px 10px;border-radius:10px;background:var(--c-surface-2);border:1px solid var(--c-line)}' +
      '.d3-evd{flex:0 0 38px;font-weight:900;font-size:13px}.d3-evi{flex:0 0 10px;height:10px;border-radius:50%;margin-top:4px}.d3-evi.d3-warn{background:var(--c-maybe)}.d3-evi.d3-unk{background:#6d6787}.d3-evm{display:flex;flex-direction:column;gap:2px;min-width:0}.d3-evm b{font-size:14px}.d3-evm small{font-size:12px;color:var(--c-text-3);line-height:1.3}' +
      '.d3-tchev{font-size:24px;color:var(--c-text-3);line-height:1;margin-left:2px}';
    document.head.appendChild(s);
  }
  function css() {
    ensureD3css();
    if ($('tm-css')) return;
    var s = document.createElement('style'); s.id = 'tm-css';
    s.textContent =
      'html.tm-noscroll,html.tm-noscroll body{overflow:hidden}' +
      '.tm-view{position:fixed;inset:0;z-index:2645;background:var(--c-bg);display:flex;flex-direction:column;color:var(--c-text-1)}' +
      '.p360-view{z-index:2660}' +
      '.tm-intro{display:flex;flex-direction:column;gap:2px;padding:4px 2px 2px}' +
      '.tm-intro>b{font-size:28px;font-weight:900;line-height:1.05;letter-spacing:.01em}' +
      '.tm-cochips{margin-top:10px}' +
      '.tm-h{margin:8px 2px 0;font-size:12px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--c-text-3)}' +
      '.tm-list{display:flex;flex-direction:column;gap:8px}' +
      '.tm-card{display:flex;align-items:center;gap:12px;margin:0;padding:10px 10px;border:1px solid var(--c-line);border-radius:14px;background:var(--c-surface-1);color:var(--c-text-1);text-align:left;width:100%;min-height:88px;box-sizing:border-box}' +
      '.tm-face{flex:0 0 72px;width:72px;height:72px;border-radius:50%;background-repeat:no-repeat;border:2px solid var(--c-gold);box-shadow:0 0 0 2px var(--c-surface-1)}' +
      '.tm-face.is-claudio{background-size:150%;background-position:62% 6%}' +
      '.tm-face.is-ben{background-size:200%;background-position:54% 4%}' +
      '.tm-face.is-meshach{background-size:330%;background-position:31% 13%}' +
      '.tm-face.is-felix{background-size:145%;background-position:50% 6%}' +
      '.tm-meta{display:flex;flex-direction:column;min-width:0;line-height:1.15;flex:1}' +
      '.tm-meta small{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c-gold)}' +
      '.tm-meta b{font-size:20px;font-weight:900}' +
      '.tm-meta span{font-size:12px;color:var(--c-text-3);font-weight:700}' +
      '.tm-cs{display:flex;gap:10px;margin-left:auto;flex:0 0 auto}' +
      '.tm-cs span{display:flex;flex-direction:column;align-items:center;font-size:9.5px;color:var(--c-text-3);font-weight:700;line-height:1.1}' +
      '.tm-cs b{font-size:14px;color:var(--num-yellow,var(--c-gold,#F2C94C));font-weight:900}' +
      '@media (max-width:360px){.tm-cs{display:none}}';
    document.head.appendChild(s);
  }

  function init() {
    css();
    var t = T();
    if (t) {
      t.on('tmacct', function (arg) { var name = String(arg || '').replace(/^cap:/, ''); openCap(name); });
      t.on('tmopen', function (id) { if (id) openPerson(id); else openTeam(); });
    }
    document.addEventListener('blackram:tab', function () { closeTeam(); });
    document.addEventListener('blackram:financials', function () { var c = finCache(); if (c) { st.fin = c; st.finErr = ''; st.fetchedAt = Date.now(); } if (st.teamOpen || st.who) { renderTeam(); renderPerson(); } });
    document.addEventListener('blackram:feed', function () { st.feed = null; loadFeed(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var tl = $('tl-sheet'), dr = $('dr-sheet'), d3 = $('d3-view');
      if (tl && !tl.hidden) return;
      if (dr && !dr.hidden) return;
      if (d3 && !d3.hidden) return;
      if (st.who) { e.stopPropagation(); closePerson(); return; }
      if (st.teamOpen) { e.stopPropagation(); closeTeam(); }
    }, true);
    var feedPoll = 0;
    (function wait() { var A = window.BlackRamApp; if (A && A.getFeed && A.getFeed()) { st.feed = A.getFeed(); renderTeam(); renderPerson(); } else if (feedPoll++ < 30) setTimeout(wait, 500); })();
  }

  window.BlackRamTeam = {
    open: function (who) { if (who && who !== true && who !== 1) { openTeam(); openPerson(who); } else openTeam(); },
    close: closeTeam,
    openPerson: openPerson,
    closePerson: closePerson
  };
  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { team: window.BlackRamTeam });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
