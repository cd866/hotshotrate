/* Black Ram Logistics - Daily Reports section (v52).
   Lists each nightly PDF report (newest first) and opens it in-app.
   PRIVATE: the PDFs carry partner capital, loans and bank figures, so they are
   NOT in this public repo. They live in Worker KV behind the PIN-gated relay:
     POST /reports {pin}                  -> index
     POST /report  {pin, id, part:'pages'} -> page previews (JPEG, base64)
     POST /report  {pin, id, part:'pdf'}   -> the PDF
   Wrong PIN = 401, no data. The PIN is the same app PIN as Finance. */
(function () {
  'use strict';
  var RELAY = 'https://blackram-relay.sandlilypad.workers.dev';
  var PIN_KEY = 'blackram_relay_pin_v1';
  var IDX_KEY = 'blackram_reports_idx_v1';
  var st = { idx: null, loading: false, error: '', showAll: false, pages: {}, pdf: {}, open: null };

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pin() { try { return (localStorage.getItem(PIN_KEY) || localStorage.getItem('blackram_fresh_pull_code') || '').trim(); } catch (e) { return ''; } }
  function setPin(v) { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch (e) { /* private */ } }
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLabel(iso) {
    var p = String(iso).split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return DOW[d.getUTCDay()] + ' ' + MON[p[1] - 1] + ' ' + p[2];
  }
  function kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }
  function builtText(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
  }

  function post(path, body) {
    return fetch(RELAY + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  }

  function css() {
    if ($('dr-css')) return;
    var s = document.createElement('style');
    s.id = 'dr-css';
    s.textContent = [
      '#dailyreports-root{margin:0 0 18px}',
      '.dr-card{background:var(--c-surface-1,#1a1726);border:1px solid var(--c-line,#2e2940);border-radius:var(--radius-lg,16px);padding:14px;margin:0 0 12px}',
      '.dr-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px}',
      '.dr-head h2{margin:0;font-size:13px;letter-spacing:1.2px;text-transform:uppercase;color:var(--c-gold,#F2C94C);font-weight:800}',
      '.dr-head span{font-size:12px;color:var(--c-text-3,#b9b3cc)}',
      '.dr-latest{display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:start}',
      '.dr-thumb{width:96px;height:124px;border-radius:8px;background:#0b0a12 center/cover no-repeat;border:1px solid var(--c-line,#2e2940);display:flex;align-items:center;justify-content:center;color:var(--c-text-3,#b9b3cc);font-size:11px;text-align:center;padding:4px;cursor:pointer}',
      '.dr-date{font-size:20px;font-weight:800;color:var(--c-text-1,#f2f0f7);margin:0 0 2px}',
      '.dr-meta{font-size:12px;color:var(--c-text-3,#b9b3cc);margin:0 0 6px}',
      '.dr-line{font-size:14px;line-height:1.35;color:var(--c-text-1,#f2f0f7);margin:0 0 6px}',
      '.dr-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 0}',
      '.dr-chip{font-size:11.5px;font-weight:700;border-radius:999px;padding:3px 9px;background:#2a2440;color:var(--c-text-1,#f2f0f7)}',
      '.dr-chip.action,.dr-chip.due{background:var(--bad-bg,#9F1239);color:var(--bad-ink,#FECACA)}',
      '.dr-chip.watch{background:var(--ok-bg,#92400E);color:var(--ok-ink,#FDE68A)}',
      '.dr-chip.good{background:var(--good-bg,#065F46);color:var(--good-ink,#A7F3D0)}',
      '.dr-btns{display:flex;gap:8px;margin:12px 0 0}',
      '.dr-btn{flex:1 1 0;min-height:44px;border-radius:var(--radius-md,12px);border:1px solid var(--c-line,#2e2940);background:var(--c-surface-2,#14111f);color:var(--c-text-1,#f2f0f7);font:700 15px var(--body,system-ui);cursor:pointer}',
      '.dr-btn.pri{background:var(--c-gold,#F2C94C);color:var(--c-gold-ink,#0f0d17);border-color:transparent}',
      '.dr-list{list-style:none;margin:0;padding:0}',
      '.dr-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--c-line,#2e2940)}',
      '.dr-row:first-child{border-top:0}',
      '.dr-row .dr-rt{flex:1 1 auto;min-width:0;cursor:pointer}',
      '.dr-row b{display:block;font-size:15px;color:var(--c-text-1,#f2f0f7)}',
      '.dr-row small{display:block;font-size:12px;color:var(--c-text-3,#b9b3cc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dr-ico{flex:0 0 44px;width:44px;height:44px;border-radius:10px;border:1px solid var(--c-line,#2e2940);background:var(--c-surface-2,#14111f);color:var(--c-gold,#F2C94C);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}',
      '.dr-ico svg{width:20px;height:20px}',
      '.dr-more{width:100%;margin-top:6px}',
      '.dr-lock p{font-size:14px;color:var(--c-text-3,#b9b3cc);margin:0 0 10px}',
      '.dr-pin{display:flex;gap:8px}',
      '.dr-pin input{flex:1;min-height:44px;border-radius:var(--radius-md,12px);border:1px solid var(--c-line,#2e2940);background:#0b0a12;color:var(--c-text-1,#f2f0f7);font-size:16px;padding:0 12px}',
      '.dr-err{color:var(--bad-ink,#FECACA)!important}',
      '.dr-view{position:fixed;inset:0;z-index:2147483000;background:rgba(8,7,14,.97);display:flex;flex-direction:column}',
      '.dr-vbar{display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 8px) 10px 8px;background:var(--c-surface-2,#14111f);border-bottom:1px solid var(--c-line,#2e2940)}',
      '.dr-vbar h3{flex:1;margin:0;font-size:16px;color:var(--c-text-1,#f2f0f7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dr-vbar .dr-btn{flex:0 0 auto;padding:0 12px}',
      '.dr-pages{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:10px 8px calc(env(safe-area-inset-bottom,0px) + 20px)}',
      '.dr-pages img{display:block;width:100%;max-width:820px;margin:0 auto 10px;border-radius:6px;background:#fff}',
      '.dr-pages .dr-pn{text-align:center;font-size:11px;color:var(--c-text-3,#b9b3cc);margin:-6px 0 10px}',
      '.dr-wait{color:var(--c-text-3,#b9b3cc);text-align:center;padding:40px 10px}'
    ].join('');
    document.head.appendChild(s);
  }

  var DL = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></g></svg>';

  function mount() {
    var panel = $('panel-pdfs') || $('panel-reports');
    if (!panel) return null;
    var root = $('dailyreports-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'dailyreports-root';
      var anchor = $('reports-root');
      if (anchor && anchor.parentNode === panel) panel.insertBefore(root, anchor);
      else panel.insertBefore(root, panel.firstChild);
    }
    return root;
  }

  function chipClass(t) {
    var k = String(t).split(':')[0].trim().toLowerCase();
    return k === 'action' ? 'action' : k === 'due' ? 'due' : k === 'watch' ? 'watch' : k === 'good' ? 'good' : '';
  }

  function render() {
    css();
    var root = mount();
    if (!root) return;
    var head = '<div class="dr-head"><h2>Daily PDF reports</h2><span>' +
      (st.idx ? esc(st.idx.reports.length + ' reports') : 'PIN protected') + '</span></div>';
    if (!pin() || st.error === 'wrongpin') {
      root.innerHTML = '<section class="dr-card dr-lock">' + head +
        '<p' + (st.error === 'wrongpin' ? ' class="dr-err"' : '') + '>' +
        (st.error === 'wrongpin' ? 'Wrong PIN. Try again.' : 'The nightly reports include partner capital, loans and bank figures. Enter the app PIN to see them.') + '</p>' +
        '<form class="dr-pin" id="dr-pin-form" autocomplete="off"><input id="dr-pin" type="password" inputmode="numeric" placeholder="App PIN" aria-label="App PIN" />' +
        '<button type="submit" class="dr-btn pri" style="flex:0 0 96px">Unlock</button></form></section>';
      var f = $('dr-pin-form');
      if (f) f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var v = ($('dr-pin').value || '').trim();
        if (!v) return;
        setPin(v); st.error = ''; st.idx = null; load(true);
      });
      return;
    }
    if (!st.idx) {
      root.innerHTML = '<section class="dr-card">' + head + '<p class="dr-meta">' +
        esc(st.loading ? 'Loading reports...' : (st.error || 'Loading reports...')) + '</p></section>';
      return;
    }
    var reps = st.idx.reports || [];
    if (!reps.length) { root.innerHTML = '<section class="dr-card">' + head + '<p class="dr-meta">No reports uploaded yet.</p></section>'; return; }
    var r0 = reps[0];
    var latest = '<section class="dr-card">' + head +
      '<div class="dr-latest"><div class="dr-thumb" id="dr-thumb" data-open="' + esc(r0.id) + '">Tap to open</div><div>' +
      '<p class="dr-date">' + esc(dayLabel(r0.date)) + '</p>' +
      '<p class="dr-meta">' + esc(r0.label + ' - ' + r0.pages + ' pages - ' + kb(r0.pdf_bytes) + (r0.built_at ? ' - built ' + builtText(r0.built_at) : '')) + '</p>' +
      (r0.headline ? '<p class="dr-line">' + esc(r0.headline) + '</p>' : '') +
      '</div></div>' +
      ((r0.callouts || []).length ? '<div class="dr-chips">' + r0.callouts.slice(0, 3).map(function (c) {
        return '<span class="dr-chip ' + chipClass(c) + '">' + esc(c) + '</span>';
      }).join('') + '</div>' : '') +
      '<div class="dr-btns"><button type="button" class="dr-btn pri" data-open="' + esc(r0.id) + '">Open report</button>' +
      '<button type="button" class="dr-btn" data-dl="' + esc(r0.id) + '">Download PDF</button></div></section>';
    var rest = reps.slice(1);
    var shown = st.showAll ? rest : rest.slice(0, 6);
    var list = '<section class="dr-card"><div class="dr-head"><h2>Past reports</h2><span>newest first</span></div><ul class="dr-list">' +
      shown.map(function (r) {
        return '<li class="dr-row"><div class="dr-rt" data-open="' + esc(r.id) + '" role="button" tabindex="0"><b>' + esc(dayLabel(r.date)) +
          (r.label !== 'Daily report' ? ' <span class="dr-chip">' + esc(r.label.replace(' report', '')) + '</span>' : '') + '</b>' +
          '<small>' + esc(r.pages + ' pages - ' + kb(r.pdf_bytes) + (r.today ? ' - ' + r.today : '')) + '</small></div>' +
          '<button type="button" class="dr-ico" data-dl="' + esc(r.id) + '" aria-label="Download ' + esc(r.date) + ' PDF">' + DL + '</button></li>';
      }).join('') + '</ul>' +
      (rest.length > 6 ? '<button type="button" class="dr-btn dr-more" id="dr-more">' + (st.showAll ? 'Show fewer' : 'Show all ' + rest.length) + '</button>' : '') +
      '</section>';
    root.innerHTML = latest + list;
    bind(root);
    thumb(r0.id);
  }

  function bind(root) {
    root.querySelectorAll('[data-open]').forEach(function (el) {
      el.addEventListener('click', function () { openViewer(el.getAttribute('data-open')); });
      el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') openViewer(el.getAttribute('data-open')); });
    });
    root.querySelectorAll('[data-dl]').forEach(function (el) {
      el.addEventListener('click', function () { download(el.getAttribute('data-dl')); });
    });
    var more = $('dr-more');
    if (more) more.addEventListener('click', function () { st.showAll = !st.showAll; render(); });
  }

  function find(id) { return (st.idx && st.idx.reports || []).filter(function (r) { return r.id === id; })[0]; }

  function load(force) {
    if (!pin()) { render(); return; }
    if (st.loading) return;
    if (!st.idx) { try { var c = sessionStorage.getItem(IDX_KEY); if (c) st.idx = JSON.parse(c); } catch (e) { /* ignore */ } }
    if (st.idx && !force && st.fetchedAt && Date.now() - st.fetchedAt < 120000) { render(); return; }
    st.loading = true; render();
    post('/reports', { pin: pin() }).then(function (resp) {
      return resp.json().catch(function () { return null; }).then(function (j) {
        if (resp.ok && j && j.ok) {
          st.idx = j.data; st.error = ''; st.fetchedAt = Date.now();
          try { sessionStorage.setItem(IDX_KEY, JSON.stringify(j.data)); } catch (e) { /* ignore */ }
        } else if (resp.status === 401) {
          st.error = 'wrongpin'; st.idx = null;
          try { sessionStorage.removeItem(IDX_KEY); } catch (e) { /* ignore */ }
        } else {
          st.error = (j && j.error) || ('Could not load reports (' + resp.status + ')');
        }
      });
    }).catch(function () {
      st.error = st.idx ? '' : 'Offline. Reports need a connection.';
    }).then(function () { st.loading = false; render(); });
  }

  function getPages(id) {
    if (st.pages[id]) return Promise.resolve(st.pages[id]);
    return post('/report', { pin: pin(), id: id, part: 'pages' }).then(function (resp) {
      if (resp.status === 401) { st.error = 'wrongpin'; st.idx = null; throw new Error('Wrong PIN'); }
      return resp.json().then(function (j) {
        if (!resp.ok || !j || !j.ok) throw new Error((j && j.error) || ('Error ' + resp.status));
        st.pages[id] = j.data.pages || [];
        return st.pages[id];
      });
    });
  }

  function getPdf(id) {
    if (st.pdf[id]) return Promise.resolve(st.pdf[id]);
    return post('/report', { pin: pin(), id: id, part: 'pdf' }).then(function (resp) {
      if (resp.status === 401) { st.error = 'wrongpin'; st.idx = null; throw new Error('Wrong PIN'); }
      if (!resp.ok) throw new Error('Error ' + resp.status);
      return resp.blob();
    }).then(function (b) {
      var blob = new Blob([b], { type: 'application/pdf' });
      st.pdf[id] = URL.createObjectURL(blob);
      return st.pdf[id];
    });
  }

  function thumb(id) {
    var el = $('dr-thumb');
    if (!el) return;
    getPages(id).then(function (pages) {
      var t = $('dr-thumb');
      if (t && pages[0]) { t.style.backgroundImage = 'url(data:image/jpeg;base64,' + pages[0] + ')'; t.textContent = ''; t.setAttribute('aria-label', 'Open report'); }
    }).catch(function () { /* keep text */ });
  }

  function download(id) {
    var r = find(id);
    getPdf(id).then(function (url) {
      var a = document.createElement('a');
      a.href = url; a.download = 'black-ram-report-' + id + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
    }).catch(function (e) { alert('Could not download: ' + e.message); if (st.error === 'wrongpin') render(); });
    return r;
  }

  function openPdfTab(id) {
    var w = window.open('', '_blank');
    getPdf(id).then(function (url) {
      if (w) w.location.href = url; else window.location.href = url;
    }).catch(function (e) { if (w) w.close(); alert('Could not open PDF: ' + e.message); });
  }

  function closeViewer() {
    var v = $('dr-view');
    if (v) v.remove();
    document.documentElement.classList.remove('sheet-open');
    st.open = null;
  }

  function openViewer(id) {
    var r = find(id);
    if (!r) return;
    closeViewer();
    st.open = id;
    var v = document.createElement('div');
    v.id = 'dr-view'; v.className = 'dr-view';
    v.setAttribute('role', 'dialog'); v.setAttribute('aria-modal', 'true'); v.setAttribute('aria-label', 'Report ' + r.date);
    v.innerHTML = '<div class="dr-vbar"><button type="button" class="dr-btn" id="dr-close" aria-label="Close">Close</button>' +
      '<h3>' + esc(dayLabel(r.date)) + '</h3>' +
      '<button type="button" class="dr-btn" id="dr-pdf">PDF</button>' +
      '<button type="button" class="dr-btn pri" id="dr-dl" aria-label="Download PDF">' + 'Download' + '</button></div>' +
      '<div class="dr-pages" id="dr-pages"><p class="dr-wait">Loading ' + r.pages + ' pages...</p></div>';
    document.body.appendChild(v);
    document.documentElement.classList.add('sheet-open');
    $('dr-close').addEventListener('click', closeViewer);
    $('dr-dl').addEventListener('click', function () { download(id); });
    $('dr-pdf').addEventListener('click', function () { openPdfTab(id); });
    getPages(id).then(function (pages) {
      var box = $('dr-pages');
      if (!box || st.open !== id) return;
      box.innerHTML = pages.map(function (b64, i) {
        return '<img alt="Report ' + esc(r.date) + ' page ' + (i + 1) + '" src="data:image/jpeg;base64,' + b64 + '" loading="lazy" decoding="async"><div class="dr-pn">Page ' + (i + 1) + ' of ' + pages.length + '</div>';
      }).join('');
    }).catch(function (e) {
      var box = $('dr-pages');
      if (box) box.innerHTML = '<p class="dr-wait">' + esc(e.message) + '</p>';
      if (st.error === 'wrongpin') render();
    });
  }

  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && st.open) closeViewer(); });

  function visible() { var p = $('panel-pdfs') || $('panel-reports'); return p && !p.hidden; }
  function onShow() { if (visible()) load(false); }
  function init() {
    var p = $('panel-pdfs') || $('panel-reports');
    if (!p) return;
    document.addEventListener('blackram:tab', function (e) { if (e.detail && (e.detail.tab === 'pdfs' || e.detail.tab === 'reports')) onShow(); });
    new MutationObserver(onShow).observe(p, { attributes: true, attributeFilter: ['hidden'] });
    // app.js rewrites #reports-root; re-insert our block if it ever gets removed.
    new MutationObserver(function () { if (!$('dailyreports-root')) render(); }).observe(p, { childList: true });
    onShow();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.BlackRamReports = { render: render, load: load, open: openViewer };
})();
