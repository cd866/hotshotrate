/* Black Ram Logistics - Insurance tab (v72+).
   Public part (this file): insurer names, coverage types, renewal dates, tire warranty program, accident steps, documents to carry.
   PIN-gated part: limits, deductibles, premiums, payments, drivers, claims, open items. These come from the relay /financials
   payload key "insurance" (built on the box by insurance_build.py, pushed with push_financials.py). Nothing financial is in this repo.
   Policy numbers show the last 4 only. No phones, emails, addresses, VINs, DOBs or license numbers anywhere.
   Uses v51 tokens; extends window.BlackRamApp (never overwrites it). Plain ASCII text. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var FIN_KEY = 'blackram_fin_session_v1';
  var DOC_KEY = 'blackram_ins_docs_v1';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var st = { data: null, loading: false, error: '', fetchedAt: 0 };

  /* public facts (no dollar figures) */
  var OWN = { name: 'Sand Lily Pad policy', insurer: 'Progressive County Mutual', agency: 'TAP Insurance Agency', last4: '4265',
    start: '2026-10-30', end: '2027-10-30', role: 'Our own commercial auto policy on the Ram and the Big Tex trailer',
    types: ['Auto liability', 'Uninsured motorist', 'Injury protection', 'Comprehensive', 'Collision', 'Motor truck cargo'] };
  var TOTNI = { name: 'Totni policy', insurer: 'United Financial Casualty (Progressive)', agency: 'Marquee Insurance Group', last4: '8412',
    start: '2025-12-10', end: '2026-12-10', role: 'Totni liability for loads under MC 1122113. The COI lists our Ram.',
    types: ['Auto liability', 'Motor truck cargo', 'Refrigeration breakdown', 'Injury protection', 'Uninsured motorist'] };
  var TOT_STEPS = [
    ['Call Totni first', 'If you are hauling under MC 1122113, tell Totni dispatch and safety right away, before the other driver leaves if you can. Ask them how they want the claim started.'],
    ['Liability goes through Totni', 'Totni is the named insured on the primary liability policy. Ask Totni and Marquee for the claim number and the adjuster. Do not guess a number.'],
    ['Then our own policy', 'Truck or trailer damage and cargo: also open a claim with Progressive through TAP on our policy and write down that claim number too.'],
    ['Get it in writing', 'Ask Totni for the claim number, who the adjuster is, and whether our cargo or their cargo coverage applies. Post it in the group.'],
    ['New drivers and riders', 'Totni must approve any new driver with its insurer. Passengers need Totni written rider authorization first.'],
    ['Settlements', 'Totni signs any release with us. Read it first. Do not sign anything alone, the 11/6 mirror settlement went through Totni, Meshach and Ben.']
  ];
  var STEPS = [
    ['People first', 'Check everyone. Call 911 if anyone is hurt or the road is blocked.'],
    ['Make it safe', 'Hazards on. Move off the road if the truck can move. Set triangles.'],
    ['Photos and video', 'All four sides of each vehicle, damage close up, plates, the scene, skid marks, the load and the trailer.'],
    ['Other driver', 'Photo of their insurance card, license, plate and company name. Get a witness name. Dash cam clip saved.'],
    ['Police', 'Get an officer and a report number if there is an injury or $1,000 or more of damage (Texas rule). Do not argue fault.'],
    ['Say little', 'Do not admit fault. Do not sign anything or agree to a number on the spot.'],
    ['Call Progressive claims', 'Same day. Use the claims number on the ID card or dec page. Give the policy last 4 and the facts. Write down the claim number and adjuster.'],
    ['Call Totni', 'If you were hauling under MC 1122113, tell Totni dispatch and safety right away, and tell the broker if the load is affected.'],
    ['Tell the partners', 'Post in the Hot Shot Trucking group with photos. Claudio and Ben log it in the app.'],
    ['Cargo or tire', 'Cargo damage: leave the load as is until the adjuster says move it. Tire problem: the shop must call the tire warranty company before any work.'],
    ['Keep every receipt', 'Tow, hotel, rental, repair, tire. Photograph them the same day.']
  ];
  var DOCS = [
    ['Progressive ID card', 'Truck card. Trailer is not listed on it (ask TAP for a trailer card).'],
    ['Totni COI', 'Dated 10/23/2026. Ends 12/10/2026, get the renewal.'],
    ['Truck registration and trailer registration', ''],
    ['Totni lease and authority papers', 'MC 1122113'],
    ['Driver license and medical card', ''],
    ['Load paperwork', 'Rate con and bill of lading for the load on board'],
    ['Tire warranty contract', 'TrailerGard, the repair shop needs the contract info'],
    ['Pen, phone charger, flashlight, triangles', '']
  ];

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function m0(n) { if (n == null || !isFinite(n)) return '-'; return '$' + Math.round(n).toLocaleString('en-US'); }
  function m2(n) { if (n == null || !isFinite(n)) return '-'; return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function ymd(iso) { var p = String(iso).slice(0, 10).split('-'); return MON[Number(p[1]) - 1] + ' ' + Number(p[2]) + ', ' + p[0]; }
  function md(iso) { var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function daysTo(iso) { var a = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)), t = todayIso(); var b = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10)); return Math.round((a - b) / 86400000); }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private mode */ } }
  function root() { return document.getElementById('ins-root'); }

  /* ---------- data (PIN-gated) ---------- */
  function fromCache() {
    try { var c = sessionStorage.getItem(FIN_KEY); if (!c) return null; var j = JSON.parse(c); return j && j.insurance ? j : null; } catch (e) { return null; }
  }
  function fetchData(force) {
    var p = pin();
    if (!p) { st.error = 'nopin'; render(); return; }
    if (st.loading) return;
    if (!force && st.data && Date.now() - st.fetchedAt < 60000) return;
    st.loading = true;
    if (!st.data) render();
    fetch(RELAY + '/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }), cache: 'no-store' })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (resp.ok && j && j.ok && j.data) {
            st.error = ''; st.fetchedAt = Date.now();
            st.data = j.data.insurance ? j.data : null;
            if (!st.data) st.error = 'Insurance details are not on the server yet.';
            try { sessionStorage.setItem(FIN_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ }
          } else if (resp.status === 401) {
            st.error = 'wrongpin'; st.data = null;
            try { sessionStorage.removeItem(FIN_KEY); } catch (e) { /* ignore */ }
          } else {
            st.error = (j && j.error) || ('Could not load (' + resp.status + ')');
          }
        });
      })
      .catch(function () { st.error = 'Offline - showing the last copy if any.'; })
      .then(function () { st.loading = false; render(); });
  }

  /* ---------- pieces ---------- */
  function card(id, title, sub, body) {
    return '<section class="in-card" id="' + id + '"><div class="in-h"><h3>' + title + '</h3>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>' + body + '</section>';
  }
  function pill(cls, t) { return '<span class="in-pill in-pill-' + cls + '">' + esc(t) + '</span>'; }
  function tile(label, big, sub, tone, jump) {
    var T = window.BlackRamTiles, a = jump && T ? T.jumpAttrs('in-jump', jump, label + ' ' + big + '. Go to the details') : '';
    return '<div class="in-tile in-t-' + (tone || 'ok') + (a ? ' tl-tap tl-corner' : '') + '"' + a + '><span>' + esc(label) + '</span><b>' + esc(big) + '</b><small>' + esc(sub) + '</small></div>';
  }
  function countText(iso) {
    var n = daysTo(iso);
    if (n < 0) return 'ended ' + (-n) + ' d ago';
    return n + ' d left';
  }
  function tones(iso) { var n = daysTo(iso); return n < 0 ? 'bad' : (n <= 30 ? 'warn' : 'ok'); }

  function secTiles() {
    return '<div class="in-tiles">' +
      tile('Our policy', 'Active', 'Renews ' + md(OWN.end) + '/' + OWN.end.slice(0, 4) + ' (' + countText(OWN.end) + ')', tones(OWN.end), 'in-pols') +
      tile('Totni policy', countText(TOTNI.end), 'COI ends ' + ymd(TOTNI.end), tones(TOTNI.end), 'in-totni') +
      tile('Trailer tires', '7 yr', 'TrailerGard to Oct 2033', 'ok', 'in-tire') +
      '</div>';
  }
  function chips(arr) { return '<div class="in-chips">' + arr.map(function (t) { return '<span class="in-chip">' + esc(t) + '</span>'; }).join('') + '</div>'; }
  function secPolicies() {
    function one(P) {
      return '<div class="in-pol"><div class="in-pol-h"><b>' + esc(P.name) + '</b>' + pill(tones(P.end) === 'ok' ? 'ok' : 'warn', countText(P.end)) + '</div>' +
        '<div class="in-kv"><span>Insurer</span><b>' + esc(P.insurer) + '</b></div>' +
        '<div class="in-kv"><span>Agency</span><b>' + esc(P.agency) + '</b></div>' +
        '<div class="in-kv"><span>Policy</span><b>...' + esc(P.last4) + '</b></div>' +
        '<div class="in-kv"><span>Term</span><b>' + md(P.start) + '/' + P.start.slice(2, 4) + ' to ' + md(P.end) + '/' + P.end.slice(2, 4) + '</b></div>' +
        '<p class="in-fine">' + esc(P.role) + '</p>' + chips(P.types) + '</div>';
    }
    return card('in-pols', 'Our policy', 'Progressive via TAP', one(OWN));
  }

  /* gated */
  function secPremium(I) {
    var o = I.own, mx = 0; o.premium_split.forEach(function (r) { mx = Math.max(mx, r[1]); });
    var bars = o.premium_split.map(function (r) {
      return '<div class="in-bar"><span>' + esc(r[0]) + '</span><div class="in-bar-t"><i style="width:' + Math.max(r[1] / mx * 100, 2).toFixed(1) + '%"></i></div><b>' + m0(r[1]) + '</b></div>';
    }).join('');
    var veh = o.vehicles.map(function (v) {
      return '<div class="in-veh"><div class="in-veh-h"><b>' + esc(v.name) + '</b><span>Stated ' + m0(v.stated) + '</span></div>' +
        '<div class="in-veh-f"><span>Premium ' + m0(v.total) + '</span><span>Deductibles ' + m0(v.ded) + '</span><span>Loss payee ' + esc(v.payee) + '</span></div></div>';
    }).join('');
    return card('in-prem', 'Premium', m0(o.total) + ' a year',
      '<div class="in-big">' + m2(o.monthly) + '<span>a month, includes a ' + m0(o.installment_fee) + ' installment fee</span></div>' + bars +
      '<p class="in-fine">' + esc(o.note_stated) + '</p>' + veh);
  }
  function limitsRows(rows) {
    return '<div class="in-rows">' + rows.map(function (r) {
      return '<div class="in-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</b></div>';
    }).join('') + '</div>';
  }
  function secLimits(I) {
    var o = I.own;
    return card('in-lim', 'Limits and deductibles', 'From the dec page',
      '<div class="in-sub">Our policy ...' + esc(o.last4) + '</div>' + limitsRows(o.limits) +
      '<p class="in-fine">' + esc(o.cargo_note) + ' Radius ' + esc(o.radius.toLowerCase()) + '. Rated for ' + esc(o.commodities.toLowerCase()) + '.</p>');
  }
  function secPay(I) {
    var o = I.own, paid = {}; (o.paid || []).forEach(function (p) { paid[p[0] || p.date] = 1; });
    var nextIso = null;
    var t = todayIso();
    o.schedule.forEach(function (s) { if (!nextIso && !paid[s[0]] && s[0] >= t) nextIso = s[0]; });
    var dots = ['<div class="in-dot paid" title="Down payment"><i></i><span>' + md(o.down.date) + '</span></div>'].concat(o.schedule.map(function (s) {
      var cls = paid[s[0]] ? 'paid' : (s[0] === nextIso ? 'next' : (s[0] < t ? 'late' : ''));
      return '<div class="in-dot ' + cls + '"><i></i><span>' + md(s[0]) + '</span></div>';
    })).join('');
    var left = o.schedule.filter(function (s) { return !paid[s[0]]; });
    var leftTot = left.reduce(function (a, s) { return a + s[1]; }, 0);
    var nxt = nextIso ? o.schedule.filter(function (s) { return s[0] === nextIso; })[0] : null;
    return card('in-pay', 'Payments', esc(o.plan),
      (nxt ? '<p class="in-call in-call-' + (daysTo(nextIso) <= 5 ? 'bad' : 'ok') + '">Next payment <b>' + m2(nxt[1]) + '</b> due <b>' + ymd(nextIso) + '</b> (' + daysTo(nextIso) + ' d)</p>' : '') +
      '<div class="in-dots">' + dots + '</div>' +
      '<div class="in-rows"><div class="in-row"><span>Down payment ' + md(o.down.date) + '</span><b>' + m2(o.down.amount) + '<small>' + esc(o.down.note) + '</small></b></div>' +
      '<div class="in-row"><span>Left to pay</span><b>' + m2(leftTot) + '<small>' + left.length + ' payments, monthly ones are not tracked as paid yet</small></b></div>' +
      '<div class="in-row"><span>Who pays</span><b>' + esc(o.payer) + '</b></div></div>' +
      '<p class="in-fine">Legend: filled = paid, gold = next, empty = later.</p>');
  }
  function secDrivers(I) {
    var o = I.own;
    var rows = o.drivers.map(function (d) {
      return '<div class="in-row"><span>' + esc(d[0]) + '</span><b class="' + (d[1] === 'EXCLUDED' ? 'in-neg' : '') + '">' + esc(d[1]) + '</b></div>';
    }).join('');
    return card('in-drv', 'Drivers and endorsements', '',
      '<p class="in-call in-call-bad">' + esc(o.driver_warning) + '</p><div class="in-rows">' + rows + '</div>' +
      '<div class="in-sub">Endorsements</div>' + chips(o.endorsements));
  }
  function secClaims(I) {
    var c = (I.claims || []).map(function (x) {
      return '<div class="in-claim"><div class="in-claim-h"><b>' + md(x.date) + ' ' + esc(x.title) + '</b>' + pill('warn', x.status) + '</div>' +
        '<p>' + esc(x.detail) + '</p><p class="in-fine">' + esc(x.status_note) + '</p><p class="in-fine">' + esc(x.progressive) + '</p></div>';
    }).join('');
    return card('in-claims', 'Claim history', '1 incident', c || '<p class="in-fine">No claims on file.</p>');
  }
  function secNeed(I) {
    return card('in-need', 'Still need (' + I.need.length + ')', 'Ours. Totni list is above',
      '<ul class="in-list">' + I.need.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>');
  }
  function lockCard(msg) {
    return '<section class="in-card in-lock" id="in-lock"><div class="in-lock-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></g></svg></div>' +
      '<h3>Limits, premiums and claims are locked</h3><p class="in-fine">' + esc(msg) + '</p>' +
      '<form id="in-pin-form" class="in-pin" autocomplete="off"><input id="in-pin" type="password" inputmode="numeric" placeholder="App PIN" aria-label="App PIN" />' +
      '<button type="submit" class="btn primary">Unlock</button></form></section>';
  }


  /* ---------- Totni section ---------- */
  var TOT_COMPARE_PUB = [
    ['Primary liability (hurts other people or property)', 'Totni primary while hauling under MC 1122113 (lease section 7). Schedule A is blank, so not confirmed in writing.', 'We carry a liability policy too. Unlock for limits.'],
    ['Cargo', 'Cargo coverage on the COI.', 'Cargo coverage with the Cargo Plus endorsement. Which pays first: need from Claudio.'],
    ['Physical damage (Ram and trailer)', 'Not shown on the COI.', 'Comprehensive and collision on both. Ours is the only physical damage on file.'],
    ['Injury protection and uninsured motorist', 'On the COI.', 'On our policy. Which pays first: need from Claudio.'],
    ['Bobtail / non-trucking, occupational accident', 'Not shown on the COI.', 'Not on our policy. Schedule A rows are blank.']
  ];
  var TOT_LEASE = [
    ['Fee', '13% of gross freight. The other 87% is credited to us.'],
    ['What the 13% covers', 'Totni admin: load coordination, dispatch support, billing, collections and settlement. It does not buy our insurance.'],
    ['We pay', 'Maintenance, tires, repairs, fuel, DEF, tolls, parking, and our own physical damage cover.'],
    ['Deductions the lease allows', 'Insurance charges only as listed in Schedule A, fuel advances, repairs Totni paid for us, escrow only if signed, tolls and permits.'],
    ['Settlement', 'Weekly statements. Pay within 15 days of the signed BOL and POD (our revision).'],
    ['Ending it', '30 days written notice. Totni releases plates and refunds unused prepaid registration (our revision). Kansas law.']
  ];
  function pctTerm(P) {
    var a = Date.UTC(+P.start.slice(0, 4), +P.start.slice(5, 7) - 1, +P.start.slice(8, 10)), b = Date.UTC(+P.end.slice(0, 4), +P.end.slice(5, 7) - 1, +P.end.slice(8, 10));
    var t = todayIso(), n = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
    return Math.max(0, Math.min(100, (n - a) / (b - a) * 100));
  }
  function secTotni(I) {
    var T = I && I.totni;
    var n = daysTo(TOTNI.end), tone = tones(TOTNI.end);
    var head = '<div class="in-sechead"><div class="in-kicker">Totni Enterprise LLC | MC 1122113</div><h2>Totni insurance</h2></div>';
    var pol = card('in-totni', 'Totni policy', 'Leased onto Totni at 13%',
      '<div class="in-big in-big-' + tone + '">' + (n < 0 ? 'Expired ' + (-n) + ' d ago' : n + ' days left') + '<span>COI on file ends ' + ymd(TOTNI.end) + '</span></div>' +
      '<div class="in-term"><i style="width:' + pctTerm(TOTNI).toFixed(1) + '%"></i></div>' +
      '<div class="in-term-l"><span>' + md(TOTNI.start) + '/' + TOTNI.start.slice(2, 4) + '</span><span>' + md(TOTNI.end) + '/' + TOTNI.end.slice(2, 4) + '</span></div>' +
      (n <= 30 ? '<p class="in-call in-call-' + (n < 0 ? 'bad' : 'warn') + '">Renewal due. Ask Totni and Marquee for the renewed COI before ' + md(TOTNI.end) + '. Do not run loads on an expired COI.</p>' : '') +
      '<div class="in-pol"><div class="in-kv"><span>Carrier</span><b>' + esc(TOTNI.insurer) + '</b></div><div class="in-kv"><span>Agency</span><b>' + esc(TOTNI.agency) + '</b></div>' +
      '<div class="in-kv"><span>Named insured</span><b>Totni Enterprise LLC</b></div><div class="in-kv"><span>Policy</span><b>...' + esc(TOTNI.last4) + '</b></div></div>' + chips(TOTNI.types) +
      (T ? '<div class="in-sub">Limits and deductibles on the COI</div>' + limitsRows(T.limits) : '<p class="in-fine">Unlock to see limits and deductibles.</p>'));
    var coi = card('in-coi', 'COI status', '10/23/2026 on file',
      '<div class="in-stat">' + pill('ok', 'COI dated 10/23/2026') + pill('ok', 'Our Ram scheduled') + pill('ok', 'We are additional insured') + pill(n <= 30 ? 'warn' : 'ok', 'Ends ' + md(TOTNI.end)) + pill('bad', 'Renewed COI: need') + pill('warn', 'Holder name typo') + '</div>' +
      '<ul class="in-list">' + (T ? T.coi_notes : [
        'Our 2026 Ram 3500 is a scheduled auto on the COI.',
        'Sand Lily Pad is the certificate holder and is marked additional insured.',
        'The holder name is misspelled on the COI. Ask Marquee to fix it.',
        'The COI shows no driver list. Whether Meshach is scheduled is not shown.'
      ]).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<p class="in-fine">Need a COI for a broker? Ask Claudio. The producer on file is Marquee Insurance Group.</p>');
    var lease = card('in-lease', 'Lease with Totni', '13% arrangement',
      '<div class="in-rows">' + TOT_LEASE.map(function (r) { return '<div class="in-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('') + '</div>' +
      '<p class="in-call in-call-warn">' + esc(T ? T.lease.status : 'A revised draft is on the box. A signed copy is not. Need from Claudio.') + '</p>' +
      (T ? '<p class="in-fine">' + esc(T.lease.deductions_seen) + '</p>' : '<p class="in-fine">Unlock to see what deductions show up in settlements.</p>'));
    var cmpRows = T ? T.compare.map(function (r) { return [r.topic, 'Totni: ' + r.totni, 'Ours: ' + r.ours, r.first]; })
      : TOT_COMPARE_PUB.map(function (r) { return [r[0], 'Totni: ' + r[1], 'Ours: ' + r[2], null]; });
    var cmp = card('in-cmp', 'Totni vs our policy', 'Who covers what',
      '<div class="in-cmps">' + cmpRows.map(function (r) {
        return '<div class="in-cmp"><b>' + esc(r[0]) + '</b><p><i class="t"></i>' + esc(r[1]) + '</p><p><i class="o"></i>' + esc(r[2]) + '</p>' +
          (r[3] ? '<p class="in-first"><span>Pays first</span>' + esc(r[3]) + '</p>' : '') + '</div>';
      }).join('') + '</div>' + (T ? '' : '<p class="in-fine">Unlock for limits, deductibles and the pays-first notes.</p>'));
    var pay = T ? card('in-tpay', 'Who pays what', 'Totni side',
      '<div class="in-rows">' + T.who_pays.map(function (r) {
        return '<div class="in-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + (r[2] ? '<small class="' + (r[2] === 'Open' ? 'in-open' : 'in-needtag') + '">' + esc(r[2]) + '</small>' : '') + '</b></div>';
      }).join('') + '</div>') : '';
    var steps = card('in-tsteps', 'If it happens under Totni', 'MC 1122113',
      '<ol class="in-steps">' + TOT_STEPS.map(function (s, i) { return '<li><i>' + (i + 1) + '</i><div><b>' + esc(s[0]) + '</b><p>' + esc(s[1]) + '</p></div></li>'; }).join('') + '</ol>' +
      '<p class="in-fine">Do the general accident steps below first (people, photos, police). Phone numbers are not in this app. Use the numbers on the ID card, the COI or Totni\'s paperwork.</p>');
    var need = T ? card('in-tneed', 'Need from Claudio (' + T.need.length + ')', 'Totni',
      '<ul class="in-list">' + T.need.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul><p class="in-fine">' + esc(T.risk) + '</p>')
      : '<section class="in-card in-lockline"><p class="in-fine">Unlock with the PIN to see the Totni open items, who paid what, and limits.</p></section>';
    return head + pol + coi + lease + cmp + pay + steps + need;
  }

  /* public */
  function secTire(I) {
    var priv = I ? I.tire : null;
    var price = priv ? '<div class="in-kv"><span>Price</span><b>' + m0(priv.price) + '</b></div><div class="in-kv"><span>Deductible</span><b>' + esc(priv.deductible) + '</b></div>' : '';
    var claims = priv ? '<div class="in-sub">Tire events</div>' + priv.claims.map(function (c) {
      return '<div class="in-ev"><span>' + md(c.date) + '</span><p>' + esc(c.text) + '</p></div>';
    }).join('') : '<p class="in-fine">Unlock to see the tire event history and contract price.</p>';
    return card('in-tire', 'Tire warranty', 'Trailer tires and wheels',
      '<div class="in-pol"><div class="in-pol-h"><b>TrailerGard tire and wheel protection</b>' + pill('ok', 'On file') + '</div>' +
      '<div class="in-kv"><span>Provider</span><b>IAS Warranty Services of Florida</b></div>' +
      '<div class="in-kv"><span>Sold by</span><b>All Pro, Jacksonville FL</b></div>' +
      '<div class="in-kv"><span>Bought</span><b>Oct 5, 2026 with the trailer</b></div>' +
      '<div class="in-kv"><span>Term</span><b>7 years, to Oct 5, 2033</b></div>' +
      '<div class="in-kv"><span>Options</span><b>Commercial use, tandem axle dual wheel</b></div>' + price + '</div>' +
      '<div class="in-sub">How to claim</div><ol class="in-ol"><li>Before any tire work, the repair shop must call the warranty company and get instructions. The claims number is printed on the contract.</li>' +
      '<li>Keep the contract, the shop invoice and photos of the tire and the damage.</li></ol>' +
      '<p class="in-call in-call-warn">Only page 1 of 4 of the contract is on file. Mileage or age limits, exclusions, road hazard terms and the full list of what is covered are not known. Send the other pages.</p>' +
      '<div class="in-pol in-miss"><div class="in-pol-h"><b>Ram 3500 tires</b>' + pill('bad', 'Not on file') + '</div>' +
      '<p class="in-fine">Not on file - send the paperwork. No tire warranty, road hazard plan or mileage warranty for the Ram has been found in the records.</p></div>' + claims);
  }
  function secSteps() {
    return card('in-steps', 'After an accident', 'Do these in order',
      '<ol class="in-steps">' + STEPS.map(function (s, i) { return '<li><i>' + (i + 1) + '</i><div><b>' + esc(s[0]) + '</b><p>' + esc(s[1]) + '</p></div></li>'; }).join('') + '</ol>');
  }
  function docState() { try { return JSON.parse(localStorage.getItem(DOC_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function secDocs() {
    var s = docState();
    return card('in-docs', 'Carry in the truck', 'Tap to check off',
      '<div class="in-docs">' + DOCS.map(function (d, i) {
        return '<button type="button" class="in-doc' + (s[i] ? ' on' : '') + '" data-in-doc="' + i + '" aria-pressed="' + (s[i] ? 'true' : 'false') + '"><span class="in-ck" aria-hidden="true"></span><span class="in-dt"><b>' + esc(d[0]) + '</b>' + (d[1] ? '<small>' + esc(d[1]) + '</small>' : '') + '</span></button>';
      }).join('') + '</div>');
  }

  /* ---------- render ---------- */

  function secTheft() {
    return card('in-theft', 'Anti-theft devices', 'On hand; some insurers ask',
      '<ul class="in-list">' +
      '<li><b>S5 Coupler Locks steel box sleeve</b> fits over the Demco yellow gooseneck coupler.</li>' +
      '<li><b>Trimax THP XL puck lock</b> locks the sleeve through the side shroud whenever the trailer is unhooked.</li>' +
      '<li>Remove the sleeve before hitching and stow it in the gooseneck toolbox. Install the sleeve and puck lock at every drop.</li>' +
      '<li>Lube the puck lock on the Maintenance SOP (S5 coupler lock). Keep the working key off the trailer and a spare key at home. Key codes are not stored here.</li>' +
      '</ul>');
  }

  if (window.BlackRamTiles) window.BlackRamTiles.on('in-jump', function (id) { window.BlackRamTiles.jump(id); });
  function render() {
    var el = root(); if (!el) return;
    if (!st.data && st.error !== 'wrongpin') st.data = fromCache();
    var D = st.data, I = D && D.insurance;
    var gated;
    if (I) gated = secPremium(I) + secPay(I) + secLimits(I) + secDrivers(I) + secClaims(I);
    else if (st.error === 'wrongpin') gated = lockCard('Wrong PIN. Try again.');
    else if (st.error === 'nopin') gated = lockCard('Limits, deductibles, premiums, payments, drivers and claim status. Enter the app PIN to see them.');
    else if (st.loading) gated = (window.BlackRamApp && window.BlackRamApp.skeleton) ? window.BlackRamApp.skeleton('Loading insurance') : '<section class="in-card"><p class="in-fine">Loading...</p></section>';
    else gated = lockCard(st.error || 'Loading...');
    var nav = [['in-pols', 'Ours'], ['in-prem', 'Premium'], ['in-pay', 'Payments'], ['in-lim', 'Limits'], ['in-claims', 'Claims'], ['in-totni', 'Totni'], ['in-cmp', 'Who pays first'], ['in-tire', 'Tires'], ['in-theft', 'Anti-theft'], ['in-steps', 'Accident'], ['in-docs', 'Documents']];
    var built = D && D.built_at ? new Date(D.built_at) : null;
    var stamp = built && !isNaN(built.getTime()) ? ' Private data built ' + built.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT.' : '';
    el.innerHTML =
      '<div class="in-top"><div><div class="in-kicker">Sand Lily Pad LLC</div><h2>Insurance</h2></div>' +
      '<div class="in-acts"><button type="button" class="in-btn" id="in-refresh" aria-label="Refresh">' + (st.loading ? '...' : 'Refresh') + '</button></div></div>' +
      secTiles() +
      '<nav class="in-jump">' + nav.map(function (j) { return '<a href="#' + j[0] + '" data-in-jump="' + j[0] + '">' + j[1] + '</a>'; }).join('') + '</nav>' +
      secPolicies() + gated + secTotni(I) + secTire(I) + secTheft() + secSteps() + secDocs() +
      (I ? secNeed(I) : '') +
      '<p class="in-foot">Policy numbers show the last 4 only. Summary of the documents on file, not the policy contract. Check the dec page for the final word.' + esc(stamp) + (st.error && st.error !== 'nopin' && st.error !== 'wrongpin' ? ' ' + esc(st.error) : '') + '</p>';
    bind();
  }
  function bind() {
    var el = root(); if (!el) return;
    var f = document.getElementById('in-pin-form');
    if (f) f.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = (document.getElementById('in-pin').value || '').trim();
      if (!v) return;
      setPin(v); st.error = ''; st.data = null; fetchData(true);
    });
    var r = document.getElementById('in-refresh');
    if (r) r.addEventListener('click', function () { fetchData(true); });
    el.querySelectorAll('[data-in-jump]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); var t = document.getElementById(a.getAttribute('data-in-jump')); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    });
    el.querySelectorAll('[data-in-doc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = docState(), k = b.getAttribute('data-in-doc');
        if (s[k]) delete s[k]; else s[k] = 1;
        try { localStorage.setItem(DOC_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
        b.classList.toggle('on', !!s[k]); b.setAttribute('aria-pressed', s[k] ? 'true' : 'false');
      });
    });
  }

  /* ---------- styles (v51 tokens) ---------- */
  function css() {
    if (document.getElementById('in-css')) return;
    var s = document.createElement('style'); s.id = 'in-css';
    s.textContent =
      '#ins-root{display:flex;flex-direction:column;gap:var(--s-1h);padding-bottom:var(--s-3)}' +
      '.in-top{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--s-1)}' +
      '.in-top h2{margin:0;font-size:var(--fs-2xl);font-weight:var(--fw-black);color:var(--c-text-1);letter-spacing:-.01em}' +
      '.in-kicker{font-size:var(--fs-xs);font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c-accent-hi)}' +
      '.in-btn{min-height:36px;padding:0 14px;border-radius:var(--radius-pill);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-weight:800;font-size:var(--fs-sm);cursor:pointer}' +
      '.in-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s-1)}' +
      '.in-tile{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-md);padding:var(--s-1) var(--s-1);min-width:0;display:flex;flex-direction:column;gap:2px}' +
      '.in-tile span{font-size:11px;font-weight:700;color:var(--c-text-3)}' +
      '.in-tile b{font-size:var(--fs-lg);font-weight:900;color:var(--num-yellow,var(--c-gold,#F2C94C));line-height:1.15}' +
      '.in-tile small{font-size:11px;color:var(--c-text-3);line-height:1.25}' +
      '.in-t-warn b{color:var(--c-maybe)}.in-t-warn{border-color:var(--c-maybe)}.in-t-bad b{color:#FCA5A5}.in-t-bad{border-color:#F87171}' +
      '.in-jump{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:-2px 0}' +
      '.in-jump a{flex:none;font-size:var(--fs-xs);font-weight:700;color:var(--c-text-3);text-decoration:none;padding:4px 10px;border-radius:var(--radius-pill);background:var(--c-surface-1)}' +
      '.in-card{background:var(--c-surface-1);border:1px solid var(--c-line);border-radius:var(--radius-lg);padding:var(--s-2) var(--s-2) var(--s-1h);display:flex;flex-direction:column;gap:var(--s-1h);scroll-margin-top:calc(var(--appbar-h) + 8px)}' +
      '.in-h{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-1);flex-wrap:wrap}' +
      '.in-h h3{margin:0;font-size:var(--fs-lg);font-weight:var(--fw-black);color:var(--c-text-1)}' +
      '.in-h span{font-size:var(--fs-xs);font-weight:700;color:var(--c-text-3)}' +
      '.in-pol{background:var(--c-surface-2);border-radius:var(--radius-md);padding:var(--s-1h);display:flex;flex-direction:column;gap:6px}' +
      '.in-pol-h{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1)}' +
      '.in-pol-h b{font-size:var(--fs-md);font-weight:800;color:var(--c-text-1)}' +
      '.in-miss{border:1px dashed #F87171;background:rgba(248,113,113,.06)}' +
      '.in-pill{flex:none;font-size:11px;font-weight:800;padding:2px 9px;border-radius:var(--radius-pill);white-space:nowrap}' +
      '.in-pill-ok{background:var(--c-take-bg);color:var(--c-take)}.in-pill-warn{background:var(--c-maybe-bg);color:var(--c-maybe)}.in-pill-bad{background:rgba(248,113,113,.14);color:#FCA5A5}' +
      '.in-kv{display:flex;justify-content:space-between;gap:var(--s-1);font-size:var(--fs-sm);color:var(--c-text-3);padding:3px 0;border-bottom:1px solid var(--c-line)}' +
      '.in-kv:last-of-type{border-bottom:0}.in-kv b{color:var(--c-text-1);font-weight:700;text-align:right;min-width:0}' +
      '.in-fine{margin:0;font-size:var(--fs-xs);color:var(--c-text-3);line-height:1.4}' +
      '.in-chips{display:flex;flex-wrap:wrap;gap:6px}' +
      '.in-chip{font-size:11px;font-weight:700;padding:3px 9px;border-radius:var(--radius-pill);background:var(--c-surface-3);color:var(--c-text-2)}' +
      '.in-big{font-size:var(--fs-3xl);font-weight:var(--fw-black);color:var(--num-yellow,var(--c-gold));line-height:1.1}' +
      '.in-big span{display:block;font-size:var(--fs-sm);font-weight:700;color:var(--c-text-3)}' +
      '.in-bar{display:grid;grid-template-columns:104px 1fr 56px;align-items:center;gap:var(--s-1);font-size:12px;color:var(--c-text-2);font-weight:700}' +
      '.in-bar b{text-align:right;color:var(--c-text-1);font-weight:800;font-variant-numeric:tabular-nums}' +
      '.in-bar-t{height:12px;border-radius:var(--radius-pill);background:var(--c-surface-3);overflow:hidden}.in-bar-t i{display:block;height:100%;background:var(--c-accent);border-radius:var(--radius-pill)}' +
      '.in-veh{background:var(--c-surface-2);border-radius:var(--radius-md);padding:var(--s-1) var(--s-1h);display:flex;flex-direction:column;gap:4px}' +
      '.in-veh-h{display:flex;justify-content:space-between;gap:var(--s-1);align-items:baseline}.in-veh-h b{color:var(--c-text-1);font-size:var(--fs-md)}.in-veh-h span{font-size:12px;color:var(--c-gold);font-weight:800}' +
      '.in-veh-f{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px;color:var(--c-text-3);font-weight:600}' +
      '.in-sub{font-size:var(--fs-xs);font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.06em;margin-top:4px}' +
      '.in-rows{display:flex;flex-direction:column}' +
      '.in-row{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--s-1);padding:7px 0;border-bottom:1px solid var(--c-line);font-size:var(--fs-sm);color:var(--c-text-2)}' +
      '.in-row:last-child{border-bottom:0}.in-row>span{flex:0 1 46%;min-width:0}.in-row b{flex:1;text-align:right;font-weight:800;color:var(--c-text-1);min-width:0}' +
      '.in-row b small{display:block;font-size:11px;font-weight:600;color:var(--c-text-3);margin-top:1px}.in-row b.in-neg{color:#FCA5A5}' +
      '.in-call{margin:0;padding:var(--s-1) var(--s-1h);border-radius:var(--radius-sm);font-size:var(--fs-sm);font-weight:600;line-height:1.35}.in-call b{font-weight:800}' +
      '.in-call-ok{background:var(--c-take-bg);color:var(--c-take)}.in-call-warn{background:var(--c-maybe-bg);color:var(--c-maybe)}.in-call-bad{background:rgba(248,113,113,.14);color:#FCA5A5}' +
      '.in-dots{display:grid;grid-template-columns:repeat(11,1fr);gap:2px}' +
      '.in-dot{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0}.in-dot i{width:14px;height:14px;border-radius:50%;border:2px solid var(--c-line-strong);background:transparent}' +
      '.in-dot span{font-size:9px;color:var(--c-text-3);font-weight:700}.in-dot.paid i{background:var(--c-take);border-color:var(--c-take)}' +
      '.in-dot.next i{background:var(--c-gold);border-color:var(--c-gold)}.in-dot.late i{border-color:#F87171;background:rgba(248,113,113,.4)}' +
      '.in-claim{background:var(--c-surface-2);border-radius:var(--radius-md);padding:var(--s-1h);display:flex;flex-direction:column;gap:6px}.in-claim p{margin:0;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.4}' +
      '.in-claim-h{display:flex;justify-content:space-between;gap:var(--s-1);align-items:flex-start;flex-wrap:wrap}.in-claim-h b{font-size:var(--fs-md);color:var(--c-text-1);flex:1;min-width:0}' +
      '.in-ev{display:flex;gap:var(--s-1);padding:6px 0;border-bottom:1px solid var(--c-line)}.in-ev:last-child{border-bottom:0}' +
      '.in-ev span{flex:none;width:38px;font-size:12px;font-weight:700;color:var(--c-text-3)}.in-ev p{margin:0;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.35}' +
      '.in-ol{margin:0;padding-left:20px;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.45}' +
      '.in-list{margin:0;padding-left:18px;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.45;display:flex;flex-direction:column;gap:6px}' +
      '.in-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--s-1)}' +
      '.in-steps li{display:flex;gap:var(--s-1h);align-items:flex-start}' +
      '.in-steps i{flex:none;width:26px;height:26px;border-radius:50%;background:var(--c-accent);color:#14111f;font-style:normal;font-weight:900;font-size:13px;display:grid;place-items:center;margin-top:1px}' +
      '.in-steps b{display:block;font-size:var(--fs-md);color:var(--c-text-1)}.in-steps p{margin:1px 0 0;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.4}' +
      '.in-docs{display:flex;flex-direction:column;gap:6px}' +
      '.in-doc{display:flex;align-items:center;gap:var(--s-1h);min-height:var(--tap);padding:var(--s-1) var(--s-1h);border-radius:var(--radius-md);border:1px solid var(--c-line);background:var(--c-surface-2);color:var(--c-text-1);text-align:left;cursor:pointer;font:inherit}' +
      '.in-ck{flex:none;width:22px;height:22px;border-radius:7px;border:2px solid var(--c-line-strong)}' +
      '.in-doc.on .in-ck{background:var(--c-take);border-color:var(--c-take);box-shadow:inset 0 0 0 4px var(--c-surface-2)}' +
      '.in-dt b{display:block;font-size:var(--fs-sm);font-weight:800}.in-dt small{display:block;font-size:11px;color:var(--c-text-3);margin-top:1px}' +
      '.in-foot{margin:0;font-size:11px;color:var(--c-text-3);text-align:center;line-height:1.4}' +
      '.in-sechead{margin-top:var(--s-2);padding-top:var(--s-2);border-top:2px solid var(--c-line-strong)}' +
      '.in-sechead h2{margin:0;font-size:var(--fs-2xl);font-weight:var(--fw-black);color:var(--c-text-1);letter-spacing:-.01em}' +
      '.in-big-warn{color:var(--c-maybe)}.in-big-bad{color:#FCA5A5}.in-big-ok{color:var(--c-take)}' +
      '.in-term{height:10px;border-radius:var(--radius-pill);background:var(--c-surface-3);overflow:hidden}.in-term i{display:block;height:100%;background:var(--c-accent);border-radius:var(--radius-pill)}' +
      '.in-term-l{display:flex;justify-content:space-between;font-size:11px;color:var(--c-text-3);font-weight:700;margin-top:-6px}' +
      '.in-stat{display:flex;flex-wrap:wrap;gap:6px}' +
      '.in-cmps{display:flex;flex-direction:column;gap:var(--s-1)}' +
      '.in-cmp{background:var(--c-surface-2);border-radius:var(--radius-md);padding:var(--s-1h);display:flex;flex-direction:column;gap:5px}' +
      '.in-cmp>b{font-size:var(--fs-md);color:var(--c-text-1);line-height:1.25}' +
      '.in-cmp p{margin:0;font-size:var(--fs-sm);color:var(--c-text-2);line-height:1.4;display:flex;gap:8px;align-items:flex-start}' +
      '.in-cmp i{flex:none;width:10px;height:10px;border-radius:3px;margin-top:5px}.in-cmp i.t{background:var(--c-gold)}.in-cmp i.o{background:var(--c-accent)}' +
      '.in-cmp .in-first{display:block;border-top:1px solid var(--c-line);padding-top:6px;margin-top:2px;color:var(--c-text-1);font-weight:600}' +
      '.in-first span{display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-take);margin-bottom:2px}' +
      '.in-row b small.in-open{color:var(--c-maybe);font-weight:800}.in-row b small.in-needtag{color:#FCA5A5;font-weight:800}' +
      '.in-lockline{align-items:center;text-align:center}' +
      '.in-lock{align-items:center;text-align:center;padding:var(--s-4) var(--s-2)}' +
      '.in-lock h3{margin:0;font-size:var(--fs-xl);font-weight:800;color:var(--c-text-1)}' +
      '.in-lock-ico{width:56px;height:56px;border-radius:50%;background:var(--c-surface-3);color:var(--c-accent-hi);display:grid;place-items:center}.in-lock-ico svg{width:28px;height:28px}' +
      '.in-pin{display:flex;gap:var(--s-1);width:100%;max-width:320px}' +
      '.in-pin input{flex:1;min-width:0;min-height:var(--tap);padding:0 var(--s-1h);border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-size:var(--fs-base)}';
    document.head.appendChild(s);
  }

  function onShow() { render(); fetchData(false); }
  function init() {
    css();
    document.addEventListener('blackram:tab', function (e) { if (e.detail && e.detail.tab === 'ins') onShow(); });
    if (document.documentElement.getAttribute('data-tab') === 'ins') onShow();
  }
  window.BlackRamInsurance = { render: render, refresh: function () { fetchData(true); } };
  window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { insurance: window.BlackRamInsurance });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
