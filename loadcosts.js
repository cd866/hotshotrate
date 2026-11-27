/* Black Ram Logistics - Delivered-load cost breakdown (v52+).
   Self-contained: adds a Net Due tile and a cost-breakdown fold on each delivered or paid load card.
   Public view = expected net due and fuel/DEF estimates only.
   After the app PIN is entered, actual receipt detail comes from the relay /financials
   (KV payload key load_costs). Nothing private is stored in this repo. ASCII text only. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var FIN_KEY = 'blackram_fin_session_v1';
  var MPG = 8, DEF_MI = 0.034, PREMIUM = -0.018, FEE = 13;
  var diesel = null, dieselTried = false;
  var fin = null, finLoading = false, finMsg = '';
  var openIds = {};

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = Number(v); return v != null && v !== '' && isFinite(n) ? n : null; }
  function m2(n) { if (n == null || !isFinite(n)) return '-'; var a = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (n < -0.004 ? '-$' : '$') + a; }
  function m0(n) { if (n == null || !isFinite(n)) return '-'; var a = Math.abs(Math.round(n)).toLocaleString('en-US'); return (n < -0.5 ? '-$' : '$') + a; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function dayTxt(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function loadId(l) {
    if (!l) return '';
    if (l.load_id) return String(l.load_id);
    if (l.load_no) return String(l.load_no);
    return [l.date || '', l.pickup_place || '', l.drop_place || '', l.desc || '', l.lane || ''].join('|');
  }

  /* ---------- data ---------- */
  function feedLoads() {
    var A = window.BlackRamApp, f = A && A.getFeed ? A.getFeed() : null, out = [];
    if (!f || !f.months) return out;
    f.months.forEach(function (m) { (m.loads || []).forEach(function (l) { out.push(l); }); });
    return out;
  }
  function findLoad(id) { var a = feedLoads(); for (var i = 0; i < a.length; i++) if (loadId(a[i]) === id) return a[i]; return null; }
  function feePct() { var A = window.BlackRamApp, f = A && A.getFeed ? A.getFeed() : null; return f && num(f.fee_pct) != null ? Number(f.fee_pct) : FEE; }
  function eligible(l, cardCls) {
    if (!l) return false;
    if (l.status === 'cancelled') return false;
    if (l.status === 'delivered') return true;
    if (l.pay_status === 'paid' || l.pay_status === 'paid_short') return true;
    return /\bload-delivered\b/.test(cardCls || '');
  }
  function ensureDiesel() {
    if (diesel || dieselTried) return Promise.resolve(diesel);
    dieselTried = true;
    return fetch('data/diesel_prices.json?t=' + Date.now(), { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { diesel = j; if (j) { if (num(j.mpg)) MPG = Number(j.mpg); if (num(j.def_per_mi) != null) DEF_MI = Number(j.def_per_mi); if (num(j.pump_premium_usd_gal) != null) PREMIUM = Number(j.pump_premium_usd_gal); } return j; })
      .catch(function () { return null; });
  }
  function pricePerGal(l) {
    var reg = 'US', s2r = diesel && diesel.state_to_region, regs = diesel && diesel.eia && diesel.eia.regions;
    if (s2r) {
      var hits = String(l.pickup_place || l.lane || '').match(/\b[A-Z]{2}\b/g) || [];
      for (var i = 0; i < hits.length; i++) if (s2r[hits[i]]) { reg = s2r[hits[i]]; break; }
    }
    var base = regs && regs[reg] ? Number(regs[reg].usd_gal) : (regs && regs.US ? Number(regs.US.usd_gal) : 5.7);
    return { usd: r2(base + PREMIUM), region: reg };
  }
  function readFinCache() {
    if (fin) return fin;
    try { var c = sessionStorage.getItem(FIN_KEY); if (c) { var j = JSON.parse(c); if (j && j.load_costs) fin = j; } } catch (e) { fin = null; }
    return fin;
  }
  function getPin() { try { var v = localStorage.getItem(PIN_KEY); return v && v.trim() ? v.trim() : ''; } catch (e) { return ''; } }
  function fetchFin(pin) {
    if (finLoading) return Promise.resolve();
    finLoading = true; finMsg = '';
    return fetch(RELAY + '/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pin }), cache: 'no-store' })
      .then(function (resp) {
        return resp.json().catch(function () { return null; }).then(function (j) {
          if (resp.ok && j && j.ok && j.data) {
            fin = j.data; finMsg = '';
            try { sessionStorage.setItem(FIN_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ }
            try { localStorage.setItem(PIN_KEY, pin); } catch (e) { /* ignore */ }
          } else if (resp.status === 401) { finMsg = 'Wrong PIN.'; try { localStorage.removeItem(PIN_KEY); } catch (e) { /* ignore */ } }
          else finMsg = (j && j.error) || ('Could not load (' + resp.status + ')');
        });
      }).catch(function () { finMsg = 'Offline.'; })
      .then(function () { finLoading = false; refreshAll(); });
  }

  /* ---------- model ---------- */
  function compute(l, priv) {
    var gross = num(l.gross) || 0, pct = feePct();
    var fee = r2(gross * pct / 100);
    var loaded = num(l.loaded_mi) || 0;
    var dead = num(l.deadhead_mi); if (dead == null) dead = num(l.empty_mi_est); var deadKnown = dead != null; if (dead == null) dead = 0;
    var mi = loaded + dead;
    var days = num(l.days);
    if (days == null || days < 1) days = 1;
    var px = pricePerGal(l);
    var fuelEst = r2(mi / MPG * px.usd);
    var defEst = r2(mi * DEF_MI);
    var id = loadId(l), rec = priv && priv.loads ? priv.loads[id] : null;
    var recv = num(l.net_received), expectNet = r2(gross - fee);
    var eld = { a: 0, est: false, known: false, label: '' };
    if (rec && rec.eld) { eld = { a: rec.eld.a, est: !!rec.eld.est, known: true }; }
    else if (num(l.eld_fee_withheld)) { eld = { a: Number(l.eld_fee_withheld), est: !!l.eld_fee_est, known: true }; }
    else if (recv != null && recv > 0 && expectNet - recv > 0.004) { eld = { a: r2(expectNet - recv), est: !!l.payment_est, known: true }; }
    var fuel = { a: fuelEst, est: true, estAmt: fuelEst, n: 0 }, def = { a: defEst, est: true, estAmt: defEst, n: 0 }, other = { a: 0, n: 0, items: [] };
    var priceUsed = px.usd;
    if (rec) {
      if (rec.fuel && rec.fuel.length) fuel = { a: r2(rec.fuel.reduce(function (s, r) { return s + r.a; }, 0)), est: false, estAmt: fuelEst, n: rec.fuel.length };
      if (rec.def && rec.def.length) def = { a: r2(rec.def.reduce(function (s, r) { return s + r.a; }, 0)), est: false, estAmt: defEst, n: rec.def.length };
      if (rec.other && rec.other.length) other = { a: r2(rec.other.reduce(function (s, r) { return s + r.a; }, 0)), n: rec.other.length, items: rec.other };
    }
    var costs = fee + eld.a + fuel.a + def.a + other.a;
    var net = r2(gross - costs);
    var mode = rec ? (fuel.est && def.est ? 'est' : 'mixed') : 'est';
    return {
      id: id, gross: gross, pct: pct, fee: fee, eld: eld, fuel: fuel, def: def, other: other, costs: costs, net: net,
      loaded: loaded, dead: dead, deadKnown: deadKnown, mi: mi, days: days,
      perLoaded: loaded > 0 ? gross / loaded : null,
      netPerMi: mi > 0 ? net / mi : null,
      netPerDay: net / days,
      price: priceUsed, region: px.region, mode: mode, rec: rec, recv: recv,
      fuelRatio: (!fuel.est && fuelEst > 0) ? fuel.a / fuelEst : null
    };
  }


  function payFromPriv(l, priv) {
    if (!priv) return null;
    var id = loadId(l);
    if (priv.pay && priv.pay.loads && priv.pay.loads[id]) return priv.pay.loads[id];
    if (priv.loads && priv.loads[id] && priv.loads[id].pay) return priv.loads[id].pay;
    return null;
  }
  function dueOf(l, priv) {
    var gross = num(l.gross) || 0, pct = feePct();
    var fee = r2(gross * pct / 100);
    var eld = 0, eldEst = false, eldKnown = false;
    var recPay = payFromPriv(l, priv);
    var rec = priv && priv.loads ? priv.loads[loadId(l)] : null;
    if (recPay && recPay.eld > 0.004) { eld = recPay.eld; eldEst = !!recPay.eld_est; eldKnown = true; }
    else if (rec && rec.eld) { eld = rec.eld.a; eldEst = !!rec.eld.est; eldKnown = true; }
    else if (num(l.eld_fee_withheld)) { eld = Number(l.eld_fee_withheld); eldEst = !!l.eld_fee_est; eldKnown = true; }
    else if (num(l.net_received) != null && Number(l.net_received) > 0 && r2(gross - fee - Number(l.net_received)) > 0.004) {
      eld = r2(gross - fee - Number(l.net_received)); eldEst = !!l.payment_est; eldKnown = true;
    }
    var expected = r2(gross - fee - eld);
    var kind = 'pend', title = 'Pending', sub = '', pin = !!recPay;
    if (recPay) {
      expected = recPay.expected;
      eld = recPay.eld || 0; eldEst = !!recPay.eld_est; eldKnown = eld > 0.004;
      if (recPay.status === 'pending') {
        kind = 'pend'; title = 'Pending';
        if (recPay.expected_date) sub = 'Expected ' + dayTxt(recPay.expected_date);
      } else if (recPay.status === 'short' && !(recPay.eld > 0.004)) {
        kind = 'short'; title = 'Short by ' + m2(recPay.short);
        if (recPay.deposited != null) sub = (recPay.date ? 'Deposited ' + dayTxt(recPay.date) + ' | ' : 'Deposited ') + m2(recPay.deposited);
      } else {
        kind = recPay.eld > 0.004 ? 'eld' : 'ok';
        title = recPay.eld > 0.004
          ? 'Paid - ELD fees (' + m2(recPay.eld) + ')' + (recPay.eld_est ? ' EST' : '')
          : 'Deposited';
        var bits = [];
        if (recPay.date) bits.push(dayTxt(recPay.date) + ' | ' + m2(recPay.deposited));
        else if (recPay.period) bits.push(recPay.period.replace(/(\d{4})-(\d{2})-(\d{2})/g, function (_, y, m, d) { return Number(m) + '/' + Number(d); }) + ' | ' + m2(recPay.deposited));
        else if (recPay.deposited != null) bits.push(m2(recPay.deposited));
        if (recPay.via) bits.push(recPay.via);
        if (recPay.combined) bits.push('share of ' + m2(recPay.combined.total) + (recPay.combined.est ? ' EST' : ''));
        if (recPay.ledger_est) bits.push('amount EST');
        sub = bits.join(' | ');
      }
    } else {
      var recv = num(l.net_received);
      var unpaid = l.pay_status === 'unpaid' || recv == null || recv <= 0;
      if (unpaid) { kind = 'pend'; title = 'Pending'; }
      else if (eldKnown && eld > 0.004) {
        kind = 'eld'; title = 'Paid - ELD fees (' + m2(eld) + ')' + (eldEst ? ' EST' : '');
      } else { kind = 'ok'; title = 'Deposited'; }
    }
    return { id: loadId(l), expected: expected, kind: kind, title: title, sub: sub, pin: pin, eld: eld, eldEst: eldEst, who: (l.broker || '').replace(' LLC', '').replace(' Inc.', '').split(',')[0].trim() };
  }
  function dueHtml(d) {
    return '<div class="lc-due-main"><span class="lc-due-k">Net due</span><b>' + m2(d.expected) + '</b></div>' +
      '<div class="lc-due-st lc-due-' + d.kind + '">' + esc(d.title) +
      (d.sub ? '<small>' + esc(d.sub) + '</small>' : '') + '</div>';
  }
  function dueRows(priv) {
    priv = priv || (readFinCache() && fin.load_costs);
    return feedLoads().filter(function (l) { return eligible(l, ''); }).map(function (l) { return dueOf(l, priv); });
  }
  /* ---------- view ---------- */
  var SEG = [
    { k: 'net', c: 'var(--c-take)', t: 'Net kept' },
    { k: 'fee', c: 'var(--c-accent)', t: 'Totni fee' },
    { k: 'eld', c: 'var(--c-gold)', t: 'ELD' },
    { k: 'fuel', c: 'var(--c-pass-bad, #F87171)', t: 'Fuel' },
    { k: 'def', c: '#38BDF8', t: 'DEF' },
    { k: 'other', c: 'var(--c-text-3)', t: 'Other' }
  ];
  function segVal(c, k) { return k === 'net' ? Math.max(0, c.net) : k === 'fee' ? c.fee : k === 'eld' ? c.eld.a : k === 'fuel' ? c.fuel.a : k === 'def' ? c.def.a : c.other.a; }
  function bar(c, cls) {
    var total = Math.max(c.gross, c.costs, 1), out = '';
    SEG.forEach(function (s) {
      var v = segVal(c, s.k); if (v <= 0.004) return;
      out += '<i style="width:' + (v / total * 100).toFixed(2) + '%;background:' + s.c + '" title="' + esc(s.t + ' ' + m2(v)) + '"></i>';
    });
    return '<div class="lc-bar ' + (cls || '') + '" role="img" aria-label="Where the gross went">' + out + '</div>';
  }
  function est(on) { return on ? ' <span class="est">EST</span>' : ''; }
  function row(color, label, val, sub, strong) {
    return '<div class="lc-row' + (strong ? ' lc-strong' : '') + '"><span class="lc-sw" style="background:' + color + '"></span>' +
      '<span class="lc-lab">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span><b>' + val + '</b></div>';
  }
  function callout(c) {
    var keep = c.gross > 0 ? Math.round(c.net / c.gross * 100) : 0;
    var items = [['fuel', c.fuel.a, 'Fuel'], ['fee', c.fee, 'Totni fee'], ['eld', c.eld.a, 'ELD'], ['def', c.def.a, 'DEF'], ['other', c.other.a, 'Other costs']];
    items.sort(function (a, b) { return b[1] - a[1]; });
    var top = items[0];
    var tone = c.net < 0 ? 'bad' : keep >= 50 ? 'good' : keep >= 30 ? 'ok' : 'bad';
    var txt = c.net < 0 ? 'Lost ' + m0(-c.net) + ' on this load.' : 'Kept ' + keep + ' cents of every $1 gross.';
    txt += ' Biggest cost: ' + top[2] + ' ' + m0(top[1]) + ' (' + (c.gross > 0 ? Math.round(top[1] / c.gross * 100) : 0) + '%).';
    var warn = '';
    if (c.fuelRatio != null && (c.fuelRatio < 0.6 || c.fuelRatio > 1.6)) warn = ' Fuel receipts are ' + (c.fuelRatio > 1 ? 'well above' : 'well below') + ' the ' + m0(c.fuel.estAmt) + ' estimate. Check the receipt list.';
    return '<p class="lc-call lc-' + tone + '">' + esc(txt + warn) + '</p>';
  }
  function body(c, priv) {
    var h = '';
    var actual = !!c.rec && (!c.fuel.est || !c.def.est || c.other.n);
    h += '<div class="lc-top"><span class="lc-chip ' + (actual ? 'lc-chip-act' : '') + '">' + (actual ? 'Receipts matched' : 'Estimates') + '</span>' +
      '<span class="lc-gross">Gross ' + m2(c.gross) + '</span></div>';
    h += bar(c);
    h += '<div class="lc-legend">';
    h += row('var(--c-accent)', 'Totni ' + c.pct + '% fee', m2(c.fee));
    var eldLabel = c.eld.known ? 'Paid - ELD fees (' + m2(c.eld.a) + ')' : 'ELD fees';
    h += row('var(--c-gold)', esc(eldLabel) + est(c.eld.known && c.eld.est), c.eld.known ? m2(c.eld.a) : m2(0), c.eld.known ? '' : 'none withheld so far');
    var fuelSub = c.fuel.est ? (c.price ? '8 mpg x ' + m2(c.price) + '/gal EIA' : '') : c.fuel.n + ' receipt' + (c.fuel.n === 1 ? '' : 's') + (c.fuel.estAmt ? ' | est would be ' + m0(c.fuel.estAmt) : '');
    h += row('#F87171', 'Fuel' + (c.fuel.est ? est(true) : ' <span class="lc-act">ACTUAL</span>'), m2(c.fuel.a), fuelSub);
    var defSub = c.def.est ? '$' + DEF_MI.toFixed(3) + '/mi' : c.def.n + ' receipt' + (c.def.n === 1 ? '' : 's') + (' | est ' + m0(c.def.estAmt));
    h += row('#38BDF8', 'DEF' + (c.def.est ? est(true) : ' <span class="lc-act">ACTUAL</span>'), m2(c.def.a), defSub);
    if (c.other.a > 0) h += row('var(--c-text-3)', 'Tolls, scales, other', m2(c.other.a), c.other.items.map(function (r) { return esc(r.v) + ' ' + m2(r.a); }).join(' | '));
    h += row(c.net < 0 ? 'var(--c-pass-bad, #F87171)' : 'var(--c-take)', 'Net kept' + (c.fuel.est || c.def.est ? est(true) : ''), m2(c.net), '', true);
    h += '</div>';
    h += callout(c);
    var g = [
      ['$ / loaded mi', c.perLoaded == null ? '-' : m2(c.perLoaded)],
      ['Net / mi', c.netPerMi == null ? '-' : m2(c.netPerMi), c.deadKnown ? 'incl. deadhead' : 'loaded only'],
      ['Net / day', m0(c.netPerDay), c.days + (c.days === 1 ? ' day' : ' days')],
      ['Loaded mi', Math.round(c.loaded).toLocaleString('en-US')],
      ['Deadhead mi', c.deadKnown ? Math.round(c.dead).toLocaleString('en-US') : 'n/a', c.deadKnown ? 'EST' : ''],
      ['Days', String(c.days), 'pickup to drop']
    ];
    h += '<div class="lc-grid">' + g.map(function (x) { return '<div><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span>' + (x[2] ? '<em>' + esc(x[2]) + '</em>' : '') + '</div>'; }).join('') + '</div>';
    if (c.rec) {
      var lines = [].concat(c.rec.fuel || [], c.rec.def || [], c.rec.other || []).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
      if (lines.length) {
        h += '<div class="lc-rec"><div class="lc-rec-h">Receipts on this load</div>' + lines.map(function (r) {
          var tags = [];
          if (r.c === 'def') tags.push('DEF'); else if (r.c !== 'fuel') tags.push(r.c);
          if (r.how === 'dh') tags.push('deadhead before pickup');
          if (r.by === 'partner') tags.push('partner paid');
          if (r.est) tags.push('gallons est');
          if (r.prepay) tags.push('prepay');
          if (r.check) tags.push('verify');
          return '<div class="lc-rr"><span>' + esc(dayTxt(r.d)) + '</span><span class="lc-rv">' + esc(r.v) + (tags.length ? '<small>' + esc(tags.join(' | ')) + '</small>' : '') + '</span><b>' + m2(r.a) + '</b></div>';
        }).join('') + '</div>';
      } else h += '<p class="lc-fine">No fuel receipts posted for these dates yet. Fuel and DEF stay estimates.</p>';
    }
    if (!readFinCache()) {
      h += '<form class="lc-pin" autocomplete="off"><span>Actual receipts are behind the PIN.</span>' +
        '<input type="password" inputmode="numeric" placeholder="App PIN" aria-label="App PIN" />' +
        '<button type="submit" class="btn btn-secondary btn-sm">Unlock</button>' + (finMsg ? '<em>' + esc(finMsg) + '</em>' : '') + '</form>';
    }
    return h;
  }
  function summary(c) {
    return '<span class="lc-s-t">Cost breakdown</span>' + bar(c, 'lc-mini') +
      '<span class="lc-s-n ' + (c.net < 0 ? 'lc-neg' : '') + '">' + m0(c.net) + '</span>';
  }
  function build(card) {
    var id = card.getAttribute('data-load-id'), l = findLoad(id);
    if (!eligible(l, card.className)) return;
    var c = compute(l, readFinCache() && fin.load_costs);
    var wrap = card.querySelector(':scope > details.lc');
    if (!wrap) {
      wrap = document.createElement('details'); wrap.className = 'lc fold'; wrap.setAttribute('data-lc-id', id);
      wrap.innerHTML = '<summary class="lc-sum"></summary><div class="lc-body"></div>';
      var anchor = card.querySelector(':scope > .search-actions');
      if (anchor) card.insertBefore(wrap, anchor); else card.appendChild(wrap);
      wrap.addEventListener('click', function (e) { e.stopPropagation(); });
      wrap.addEventListener('keydown', function (e) { e.stopPropagation(); });
      wrap.addEventListener('toggle', function () {
        if (wrap.open) { openIds[id] = 1; var p = getPin(); if (p && !readFinCache()) fetchFin(p); } else delete openIds[id];
      });
      var form = null;
      wrap.addEventListener('submit', function (e) {
        e.preventDefault();
        var inp = wrap.querySelector('.lc-pin input'); var v = inp && inp.value.trim();
        if (v) fetchFin(v);
      });
      if (openIds[id]) wrap.open = true;
    }
    wrap.setAttribute('data-lc-ver', '1');
    wrap.querySelector('.lc-sum').innerHTML = summary(c);
    var b = wrap.querySelector('.lc-body');
    var keepPin = wrap.querySelector('.lc-pin input'), had = keepPin && keepPin.value;
    b.innerHTML = body(c, fin);
    if (had) { var ni = wrap.querySelector('.lc-pin input'); if (ni) ni.value = had; }
    var d = dueOf(l, readFinCache() && fin.load_costs);
    var due = card.querySelector(':scope > .lc-due');
    if (!due) {
      due = document.createElement('div');
      due.className = 'lc-due';
      due.setAttribute('data-lc-due', id);
      due.addEventListener('click', function (e) { e.stopPropagation(); });
      var lane = card.querySelector(':scope > p.lane') || card.querySelector(':scope > h3');
      if (lane && lane.nextSibling) card.insertBefore(due, lane.nextSibling);
      else card.insertBefore(due, wrap);
    }
    due.innerHTML = dueHtml(d);
    card.setAttribute('data-lc', '1');
  }
  function renderPending() {
    var root = document.getElementById('reports-root');
    if (!root) return;
    var rows = dueRows();
    var pending = rows.filter(function (r) { return r.kind === 'pend'; });
    var total = pending.reduce(function (s, r) { return s + r.expected; }, 0);
    var el = document.getElementById('lc-pend');
    if (!pending.length) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('section'); el.id = 'lc-pend'; el.className = 'lc-pend'; }
    var names = pending.map(function (r) { return (r.who ? r.who + ' ' : '') + '#' + r.id; }).join(' | ');
    el.innerHTML = '<div class="lc-due-main"><span class="lc-due-k">Still to be deposited</span><b>' + m2(total) + '</b></div>' +
      '<p>' + pending.length + (pending.length === 1 ? ' load' : ' loads') + ' expected, not yet in. ' + esc(names) + '.</p>';
    var h2 = null;
    root.querySelectorAll('h2.sec').forEach(function (h) { if (/^Loads/i.test(h.textContent || '')) h2 = h; });
    if (h2) h2.parentNode.insertBefore(el, h2);
    else if (!el.parentNode) root.insertBefore(el, root.firstChild);
  }
  function scan() {
    document.querySelectorAll('article.load[data-load-id]').forEach(function (card) {
      if (card.getAttribute('data-lc') === '1' && card.querySelector(':scope > details.lc') && card.querySelector(':scope > .lc-due')) return;
      build(card);
    });
    renderPending();
  }
  function refreshAll() {
    document.querySelectorAll('article.load[data-load-id]').forEach(function (card) { build(card); });
    renderPending();
  }
  var timer = null;
  function schedule() { if (timer) return; timer = setTimeout(function () { timer = null; ensureDiesel().then(scan); }, 60); }

  /* ---------- styles (tokens from the v51 system) ---------- */
  function css() {
    var s = document.createElement('style'); s.id = 'lc-css';
    s.textContent =
      '.lc{margin:var(--s-1h) 0 var(--s-1);border:1px solid var(--c-line);border-radius:var(--radius-md);background:var(--c-surface-1);overflow:hidden}' +
      '.lc>summary{list-style:none;display:flex;align-items:center;gap:var(--s-1h);min-height:var(--tap);padding:0 var(--s-1h);cursor:pointer;color:var(--c-text-1)}' +
      '.lc>summary::-webkit-details-marker{display:none}' +
      '.lc>summary::after{content:"";flex:0 0 16px;width:16px;height:16px;margin-left:2px;background-color:var(--c-accent-hi);-webkit-mask:var(--caret-svg) center/contain no-repeat;mask:var(--caret-svg) center/contain no-repeat;transition:transform .25s ease}' +
      '.lc[open]>summary::after{transform:rotate(180deg)}@media (prefers-reduced-motion: reduce){.lc>summary::after{transition:none}}' +
      '.lc-s-t{font-size:var(--fs-sm);font-weight:700;color:var(--c-text-2);white-space:nowrap}' +
      '.lc-s-n{font-size:var(--fs-md);font-weight:800;color:var(--c-take);white-space:nowrap;margin-left:auto}' +
      '.lc-s-n.lc-neg{color:#F87171}' +
      '.lc-bar{display:flex;height:22px;border-radius:var(--radius-pill);overflow:hidden;background:var(--c-surface-3);gap:1px}' +
      '.lc-bar i{display:block;height:100%;min-width:2px}' +
      '.lc-bar.lc-mini{flex:1;height:10px;min-width:60px}' +
      '.lc-body{padding:0 var(--s-1h) var(--s-1h);display:flex;flex-direction:column;gap:var(--s-1h)}' +
      '.lc-top{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1)}' +
      '.lc-gross{font-size:var(--fs-md);font-weight:800;color:var(--c-text-1)}' +
      '.lc-chip{font-size:var(--fs-xs);font-weight:700;padding:2px 10px;border-radius:var(--radius-pill);background:var(--c-maybe-bg);color:var(--c-maybe)}' +
      '.lc-chip-act{background:var(--c-take-bg);color:var(--c-take)}' +
      '.lc-legend{display:flex;flex-direction:column;gap:6px}' +
      '.lc-row{display:flex;align-items:flex-start;gap:var(--s-1);font-size:var(--fs-sm);color:var(--c-text-2)}' +
      '.lc-sw{flex:none;width:10px;height:10px;border-radius:3px;margin-top:4px}' +
      '.lc-lab{flex:1;min-width:0;line-height:1.3}' +
      '.lc-lab small{display:block;font-size:var(--fs-xs);color:var(--c-text-3)}' +
      '.lc-row b{font-weight:800;color:var(--c-text-1);white-space:nowrap}' +
      '.lc-strong{border-top:1px solid var(--c-line);padding-top:6px;font-size:var(--fs-md)}' +
      '.lc-strong b{color:var(--c-take)}' +
      '.lc-act{font-size:10px;font-weight:800;letter-spacing:.04em;padding:1px 6px;border-radius:var(--radius-pill);background:var(--c-take-bg);color:var(--c-take)}' +
      '.lc-call{margin:0;padding:var(--s-1) var(--s-1h);border-radius:var(--radius-sm);font-size:var(--fs-sm);font-weight:600;line-height:1.35}' +
      '.lc-good{background:var(--c-take-bg);color:var(--c-take)}.lc-ok{background:var(--c-maybe-bg);color:var(--c-maybe)}.lc-bad{background:rgba(248,113,113,.14);color:#FCA5A5}' +
      '.lc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s-1)}' +
      '.lc-grid div{background:var(--c-surface-2);border-radius:var(--radius-sm);padding:var(--s-1) 6px;text-align:center;min-width:0}' +
      '.lc-grid b{display:block;font-size:var(--fs-md);font-weight:800;color:var(--c-text-1)}' +
      '.lc-grid span{display:block;font-size:11px;color:var(--c-text-3);font-weight:700}' +
      '.lc-grid em{display:block;font-size:10px;color:var(--c-text-3);font-style:normal}' +
      '.lc-rec{border-top:1px solid var(--c-line);padding-top:var(--s-1)}' +
      '.lc-rec-h{font-size:var(--fs-xs);font-weight:800;color:var(--c-text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}' +
      '.lc-rr{display:flex;gap:var(--s-1);font-size:var(--fs-sm);color:var(--c-text-2);padding:3px 0}' +
      '.lc-rr>span:first-child{flex:none;width:34px;color:var(--c-text-3)}' +
      '.lc-rv{flex:1;min-width:0}.lc-rv small{display:block;font-size:11px;color:var(--c-text-3)}' +
      '.lc-rr b{white-space:nowrap;color:var(--c-text-1)}' +
      '.lc-fine{margin:0;font-size:var(--fs-xs);color:var(--c-text-3)}' +
      '.lc-pin{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s-1);font-size:var(--fs-xs);color:var(--c-text-3)}' +
      '.lc-pin span{flex:1 1 100%}' +
      '.lc-pin input{flex:1;min-width:0;min-height:var(--tap);padding:0 var(--s-1h);border-radius:var(--radius-sm);border:1px solid var(--c-line-strong);background:var(--c-surface-2);color:var(--c-text-1);font-size:var(--fs-base)}' +
      '.lc-pin em{flex:1 1 100%;color:#FCA5A5;font-style:normal}' +
      ".lc-due{display:flex;align-items:center;justify-content:space-between;gap:var(--s-1h);margin:var(--s-1) 0 0;padding:var(--s-1h) var(--s-2);border:1px solid var(--c-line-strong);border-radius:var(--radius-md);background:var(--c-surface-2);min-height:var(--tap)}.lc-due-main{display:flex;flex-direction:column;gap:2px;min-width:0}.lc-due-k{font-size:var(--fs-xs);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-text-3)}.lc-due b{font-size:var(--fs-2xl);font-weight:800;line-height:1.05;color:var(--c-gold)}.lc-due-st{flex:none;max-width:58%;text-align:right;font-size:var(--fs-sm);font-weight:800;line-height:1.25;padding:6px 10px;border-radius:var(--radius-sm)}.lc-due-st small{display:block;font-size:11px;font-weight:600;opacity:.9}.lc-due-ok{background:var(--c-take-bg);color:var(--c-take)}.lc-due-pend{background:var(--c-maybe-bg);color:var(--c-maybe)}.lc-due-eld,.lc-due-short{background:var(--c-maybe-bg);color:var(--c-maybe)}.lc-pend{display:flex;flex-direction:column;gap:4px;margin:0 0 var(--s-2);padding:var(--s-1h) var(--s-2);border:1px solid var(--c-line-strong);border-radius:var(--radius-lg);background:var(--c-surface-2)}.lc-pend .lc-due-k{color:var(--c-maybe)}.lc-pend b{font-size:var(--fs-3xl);font-weight:800;line-height:1;color:var(--c-gold)}.lc-pend p{margin:0;font-size:var(--fs-sm);color:var(--c-text-2);font-weight:600}";
    document.head.appendChild(s);
  }

  function init() {
    css();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    schedule();
    window.addEventListener('blackram:tab', schedule);
    var pin = getPin();
    if (pin && !readFinCache()) fetchFin(pin);
  }
  window.BlackRamLoadCosts = {
    compute: compute, dueOf: dueOf, dueRows: dueRows, readFin: readFinCache, ready: ensureDiesel,
    rows: function () { return feedLoads().filter(function (l) { return eligible(l, ''); }).map(function (l) { return compute(l, readFinCache() && fin.load_costs); }); },
    useFin: function (j) { fin = j; refreshAll(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
