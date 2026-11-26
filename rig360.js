/* Black Ram Logistics: Our rig 360 spin (v75, trailer view v76, zoom v77).
   A low-poly 3D model of our 2026 Ram 3500 dually crew cab (Diamond Black)
   and the Big Tex 25GN-40 gooseneck (40 ft deck incl. 5 ft dovetail, 102 in
   wide, 34 in deck height), built in code with Three.js r170 (vendored at
   vendor/three/three.module.min.js, MIT). The real photo stays as the poster
   and as the "Photo" toggle. "Trailer" spins the Big Tex 25GN-40D5A-MRBK on
   its own (unhitched, resting on its drop-leg jacks).
   - Three.js only loads after first paint (idle) and once the stage is on screen.
   - Slow auto-spin (about 26 s per turn); drag or swipe to spin by hand;
     auto-spin resumes after 3 s idle.
   - Zoom: pinch (two fingers also pan), mouse wheel or trackpad pinch, or
     the +/- buttons, 1x to 5x; double-tap, double-click or Fit resets.
     Auto-spin waits while zoomed in.
   - prefers-reduced-motion: no auto-spin and no coasting; drag still works.
   - Pauses when the stage is off screen, the tab is hidden, or Photo is on.
   Units in the model are feet. x = length (truck front +x), y = up, z = width. */
(function () {
  'use strict';
  var TURN_SECONDS = 26;
  var IDLE_RESUME_MS = 3000;
  var MODE_KEY = 'blackram_rig_view';
  var THREE_URL = './vendor/three/three.module.min.js';

  var stage, canvasWrap, canvas, toggle, hint;
  var mode = '360';
  var subject = 'rig'; // 'rig' (truck + trailer hitched) or 'trailer' (Big Tex on its own)
  var reduceMotion = false;
  var onScreen = true;
  var started = false;
  var failed = false;
  var view = null; // set once the 3D scene is ready

  function $(sel, root) { return (root || document).querySelector(sel); }

  function setMode(next, save, subj) {
    mode = next === 'photo' ? 'photo' : '360';
    if (subj === 'rig' || subj === 'trailer') subject = subj;
    if (!stage) return;
    stage.setAttribute('data-view', mode);
    stage.setAttribute('data-subject', subject);
    var btns = toggle ? toggle.querySelectorAll('button') : [];
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-view') === mode &&
        (mode === 'photo' || btns[i].getAttribute('data-subject') === subject);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (save) { try { localStorage.setItem(MODE_KEY, mode === 'photo' ? 'photo' : (subject === 'trailer' ? 'trailer' : '360')); } catch (e) { /* ignore */ } }
    if (view) view.setSubject(subject);
    if (mode === '360') maybeStart();
    if (view) view.update();
  }

  function buildUi() {
    stage = $('header.top .rig-stage');
    if (!stage || stage.getAttribute('data-r360')) return false;
    stage.setAttribute('data-r360', '1');
    try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduceMotion = false; }

    canvasWrap = document.createElement('div');
    canvasWrap.className = 'r360-wrap';
    canvasWrap.setAttribute('aria-hidden', 'true');
    canvas = document.createElement('canvas');
    canvas.className = 'r360-canvas';
    canvasWrap.appendChild(canvas);
    stage.appendChild(canvasWrap);

    toggle = document.createElement('div');
    toggle.className = 'r360-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'Rig view');
    toggle.innerHTML = '<button type="button" data-view="360" data-subject="rig" aria-pressed="true" aria-label="Truck and trailer 360">Rig 360</button>' +
      '<button type="button" data-view="360" data-subject="trailer" aria-pressed="false" aria-label="Big Tex trailer 360">Trailer</button>' +
      '<button type="button" data-view="photo" aria-pressed="false">Photo</button>';
    stage.appendChild(toggle);
    toggle.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-view]');
      if (b) setMode(b.getAttribute('data-view'), true, b.getAttribute('data-subject'));
    });

    hint = document.createElement('div');
    hint.className = 'r360-hint';
    hint.textContent = 'Drag to spin. Pinch to zoom';
    stage.appendChild(hint);

    var saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch (e) { saved = null; }
    setMode(saved === 'photo' ? 'photo' : '360', false, saved === 'trailer' ? 'trailer' : 'rig');

    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(function (entries) {
        onScreen = !!(entries[0] && entries[0].isIntersecting);
        if (onScreen) maybeStart();
        if (view) view.update();
      }, { rootMargin: '120px 0px' }).observe(stage);
    }
    document.addEventListener('visibilitychange', function () { if (view) view.update(); });
    document.addEventListener('blackram:tab', function () { setTimeout(function () { maybeStart(); if (view) { view.resize(); view.update(); } }, 30); });
    return true;
  }

  function webglOk() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  function maybeStart() {
    if (started || failed || mode !== '360' || !onScreen || !stage) return;
    if (document.documentElement.getAttribute('data-tab') && document.documentElement.getAttribute('data-tab') !== 'check') return;
    if (!webglOk()) { fail(); return; }
    started = true;
    var go = function () {
      import(THREE_URL).then(function (THREE) {
        view = createView(THREE);
        view.setSubject(subject);
        view.update();
      }).catch(function (err) {
        try { console.warn('rig360', err); } catch (e) { /* ignore */ }
        fail();
      });
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 300);
  }

  function fail() {
    failed = true;
    if (stage) stage.setAttribute('data-r360-failed', '1');
    setMode('photo', false);
  }

  /* ------------------------------------------------------------------ */
  function createView(THREE) {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(24, 2, 1, 400);

    // Soft studio reflections (like RoomEnvironment, built inline).
    var pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(studioEnv(THREE), 0.04).texture;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0xdcd6ff, 0x2a2436, 0.9));
    var fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(0, 12, 60);
    scene.add(fill);
    var key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(45, 22, 35);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0xb9a6ff, 0.9);
    rim.position.set(-40, 25, -50);
    scene.add(rim);

    var turntable = new THREE.Group();
    scene.add(turntable);
    var rig = buildRig(THREE);
    turntable.add(rig.group);
    var floor = buildFloor(THREE);
    scene.add(floor);

    var angle = -0.62; // 3/4 front, passenger side, like the photo
    var velocity = 0;  // rad/s from a flick
    var autoSpeed = (Math.PI * 2) / TURN_SECONDS;
    var lastInput = -1e9;
    var dragging = false;
    var lastX = 0, lastT = 0;
    var raf = 0, lastFrame = 0;
    var shown = false;
    var w = 0, h = 0;

    // Zoom: 1 = whole vehicle in frame, up to ZOOM_MAX. Pan is in world feet
    // along the camera's right/up axes, so zooming stays under the fingers.
    var ZOOM_MAX = 5;
    var zoom = 1, panX = 0, panY = 0, baseDist = 80, halfLen = 33.5;
    var ELEV = THREE.MathUtils.degToRad(11);
    var upAxis = new THREE.Vector3(0, Math.cos(ELEV), -Math.sin(ELEV));

    function applyCamera() {
      var maxX = (halfLen + 2) * Math.min(1, (zoom - 1) * 2), maxY = 5 * Math.min(1, (zoom - 1) * 2);
      panX = Math.max(-maxX, Math.min(maxX, panX));
      panY = Math.max(-maxY, Math.min(maxY, panY));
      if (zoom <= 1.001) { panX = 0; panY = 0; }
      var d = baseDist / zoom;
      var tx = panX + upAxis.x * panY, ty = 4.6 + upAxis.y * panY, tz = upAxis.z * panY;
      camera.position.set(tx, ty - 2.2 + Math.sin(ELEV) * d, tz + Math.cos(ELEV) * d);
      camera.lookAt(tx, ty, tz);
      camera.updateProjectionMatrix();
      stage.toggleAttribute('data-r360-zoomed', zoom > 1.02);
    }

    function feetPerPx() {
      return 2 * (baseDist / zoom) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, h);
    }

    // Zoom to z, keeping the stage point (clientX, clientY) fixed on screen.
    function zoomAt(z, cx, cy) {
      z = Math.max(1, Math.min(ZOOM_MAX, z));
      if (cx != null) {
        var r = canvasWrap.getBoundingClientRect();
        var sx = cx - (r.left + r.width / 2), sy = (r.top + r.height / 2) - cy;
        var before = feetPerPx();
        var after = 2 * (baseDist / z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, h);
        panX += sx * (before - after);
        panY += sy * (before - after);
      }
      zoom = z;
      lastInput = performance.now();
      applyCamera();
      render();
      update();
    }

    function resetZoom() { zoom = 1; panX = 0; panY = 0; lastInput = performance.now(); applyCamera(); render(); update(); }

    function resize() {
      var r = canvasWrap.getBoundingClientRect();
      var nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
      if (nw === w && nh === h) return;
      w = nw; h = nh;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Fit the whole vehicle broadside with a little air, from a low 3/4 view.
      var hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
      halfLen = subject === 'trailer' ? 26.5 : 33.5;
      baseDist = halfLen / Math.tan(hfov / 2) + (subject === 'trailer' ? 11 : 13);
      applyCamera();
    }

    function wantsLoop() {
      if (mode !== '360' || !onScreen || document.hidden) return false;
      if (dragging) return true;
      if (!reduceMotion && Math.abs(velocity) > 0.002) return true;
      if (!reduceMotion && zoom <= 1.02) return true; // auto-spin (paused while zoomed)
      return false;
    }

    function render() {
      turntable.rotation.y = angle;
      renderer.render(scene, camera);
      if (!shown) {
        shown = true;
        stage.setAttribute('data-r360-ready', '1');
      }
    }

    function frame(t) {
      raf = 0;
      var dt = lastFrame ? Math.min(0.05, (t - lastFrame) / 1000) : 0;
      lastFrame = t;
      if (!dragging && !reduceMotion) {
        if (Math.abs(velocity) > 0.002) {
          angle += velocity * dt;
          velocity *= Math.pow(0.04, dt); // coast out a flick
        } else {
          velocity = 0;
          if (zoom <= 1.02 && performance.now() - lastInput > IDLE_RESUME_MS) {
            var ramp = Math.min(1, (performance.now() - lastInput - IDLE_RESUME_MS) / 1200);
            angle += autoSpeed * ramp * dt;
          }
        }
      }
      render();
      if (wantsLoop()) raf = requestAnimationFrame(frame);
      else lastFrame = 0;
    }

    function update() {
      resize();
      if (mode !== '360') return;
      if (wantsLoop()) {
        if (!raf) raf = requestAnimationFrame(frame);
      } else if (!shown || !raf) {
        render();
      }
    }

    // One finger / mouse drag spins. Two fingers pinch to zoom and pan.
    // Double-tap (or double-click) resets the zoom. touch-action: pan-y
    // keeps vertical page scroll and hands pinches to us.
    var pts = {};
    var pinch = null;
    var lastTap = 0, lastTapX = 0, lastTapY = 0;
    function count() { return Object.keys(pts).length; }
    function pinchState() {
      var k = Object.keys(pts), a = pts[k[0]], b = pts[k[1]];
      return { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    function down(ev) {
      if (mode !== '360' || (ev.button != null && ev.button > 0)) return;
      if (ev.target.closest && ev.target.closest('.r360-toggle, .r360-zoom')) return;
      pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      stage.setAttribute('data-r360-touched', '1');
      var now = performance.now();
      lastInput = now;
      velocity = 0;
      if (count() >= 2) {
        dragging = false;
        var ps = pinchState();
        pinch = { d: ps.d, zoom: zoom, x: ps.x, y: ps.y };
        stage.classList.remove('r360-grab');
      } else {
        if (ev.pointerType !== 'mouse' && now - lastTap < 320 && Math.hypot(ev.clientX - lastTapX, ev.clientY - lastTapY) < 30) {
          lastTap = 0;
          resetZoom();
        } else {
          lastTap = now; lastTapX = ev.clientX; lastTapY = ev.clientY;
        }
        dragging = true;
        lastX = ev.clientX; lastT = now;
        stage.classList.add('r360-grab');
      }
      update();
    }
    function move(ev) {
      if (!pts[ev.pointerId]) return;
      pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var now = performance.now();
      if (pinch && count() >= 2) {
        var ps = pinchState();
        // pan with the pinch midpoint, then zoom about it
        var fpp = feetPerPx();
        panX -= (ps.x - pinch.x) * fpp;
        panY += (ps.y - pinch.y) * fpp;
        pinch.x = ps.x; pinch.y = ps.y;
        zoomAt(pinch.zoom * ps.d / pinch.d, ps.x, ps.y);
        return;
      }
      if (!dragging) return;
      var dx = ev.clientX - lastX;
      var da = dx * (Math.PI * 2) / Math.max(320, w * 1.6) / Math.sqrt(zoom);
      angle += da;
      var dtm = Math.max(1, now - lastT);
      velocity = velocity * 0.6 + (da / (dtm / 1000)) * 0.4;
      lastX = ev.clientX; lastT = now; lastInput = now;
      if (Math.abs(dx) > 2) lastTap = 0;
      if (reduceMotion || zoom > 1.02) render();
    }
    function up(ev) {
      if (!pts[ev.pointerId]) return;
      delete pts[ev.pointerId];
      try { stage.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      lastInput = performance.now();
      if (pinch) {
        if (count() < 2) { pinch = null; velocity = 0; }
        // one finger left after a pinch: let it keep spinning from here
        var k = Object.keys(pts)[0];
        if (k) { dragging = true; lastX = pts[k].x; lastT = lastInput; }
        update();
        return;
      }
      if (!dragging) return;
      dragging = false;
      if (lastInput - lastT > 90) velocity = 0;
      velocity = Math.max(-4, Math.min(4, velocity));
      if (zoom > 1.02) velocity = 0;
      stage.classList.remove('r360-grab');
      update();
    }
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('dblclick', function (ev) {
      if (mode !== '360' || (ev.target.closest && ev.target.closest('.r360-toggle, .r360-zoom'))) return;
      resetZoom();
    });
    // Desktop: wheel or trackpad pinch zooms toward the cursor. At full
    // zoom-out, scrolling down falls through to the page.
    stage.addEventListener('wheel', function (ev) {
      if (mode !== '360') return;
      if (!ev.ctrlKey && zoom <= 1.001 && ev.deltaY > 0) return;
      ev.preventDefault();
      var dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      zoomAt(zoom * Math.exp(-dy * (ev.ctrlKey ? 0.01 : 0.0022)), ev.clientX, ev.clientY);
    }, { passive: false });
    // +/- buttons
    var zbar = document.createElement('div');
    zbar.className = 'r360-zoom';
    zbar.setAttribute('role', 'group');
    zbar.setAttribute('aria-label', 'Zoom');
    zbar.innerHTML = '<button type="button" data-z="in" aria-label="Zoom in">+</button>' +
      '<button type="button" data-z="out" aria-label="Zoom out">-</button>' +
      '<button type="button" data-z="reset" class="r360-zreset" aria-label="Reset zoom">Fit</button>';
    stage.appendChild(zbar);
    zbar.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-z]');
      if (!b) return;
      var z = b.getAttribute('data-z');
      if (z === 'reset') resetZoom();
      else zoomAt(zoom * (z === 'in' ? 1.5 : 1 / 1.5));
    });
    stage.addEventListener('keydown', function (ev) {
      if (mode !== '360') return;
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        angle += (ev.key === 'ArrowLeft' ? -1 : 1) * 0.2;
        lastInput = performance.now();
        ev.preventDefault();
        render();
        update();
      }
    });
    window.addEventListener('resize', function () { w = 0; update(); });

    var api = {
      update: update,
      setSubject: function (sub) {
        var t = sub === 'trailer';
        rig.truck.visible = !t;
        rig.group.position.x = t ? rig.trailerOffset : rig.rigOffset;
        zoom = 1; panX = 0; panY = 0;
        w = 0;
        if (shown) { render(); }
        update();
      },
      resize: function () { w = 0; resize(); },
      zoomTo: function (z, cx, cy) { zoomAt(z, cx, cy); },
      resetZoom: resetZoom,
      getZoom: function () { return zoom; },
      getPan: function () { return [panX, panY]; },
      setAngle: function (a) { angle = a; lastInput = performance.now(); render(); },
      getAngle: function () { return angle; },
      info: function () { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, running: !!raf }; },
      pause: function (p) { lastInput = p ? 1e15 : -1e9; update(); }
    };
    window.BlackRamApp = Object.assign(window.BlackRamApp || {}, { rig360: api });
    return api;
  }

  /* ---------------------------- textures ---------------------------- */
  function canvasTex(THREE, w, h, draw, srgb) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    var t = new THREE.CanvasTexture(c);
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  function seeded(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function woodTex(THREE) {
    // Planks run the length of the deck (texture u = deck length).
    var t = canvasTex(THREE, 1024, 256, function (g, w, h) {
      var rnd = seeded(25);
      var rows = 17, rh = h / rows;
      for (var r = 0; r < rows; r++) {
        var x = 0;
        while (x < w) {
          var len = 260 + rnd() * 520;
          var tone = 0.82 + rnd() * 0.3;
          var cr = Math.round(176 * tone), cg = Math.round(138 * tone), cb = Math.round(92 * tone);
          g.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
          g.fillRect(x, r * rh, len, rh);
          for (var k = 0; k < 7; k++) { // grain
            g.fillStyle = 'rgba(70,45,20,' + (0.05 + rnd() * 0.08) + ')';
            g.fillRect(x, r * rh + rnd() * rh, len, 1);
          }
          g.fillStyle = 'rgba(30,20,10,0.65)';
          g.fillRect(x, r * rh, 2, rh);
          x += len;
        }
        g.fillStyle = 'rgba(20,14,8,0.85)';
        g.fillRect(0, r * rh, w, 1.5);
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(35 / 14, 1);
    return t;
  }

  function diamondTex(THREE) {
    var t = canvasTex(THREE, 128, 128, function (g, w, h) {
      g.fillStyle = '#26262b'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(160,160,170,0.35)'; g.lineWidth = 3;
      for (var y = 0; y < 4; y++) for (var x = 0; x < 4; x++) {
        var ox = x * 32 + (y % 2 ? 16 : 0), oy = y * 32;
        g.beginPath(); g.moveTo(ox + 4, oy + 22); g.lineTo(ox + 18, oy + 8); g.stroke();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(5, 6);
    return t;
  }

  function dotTapeTex(THREE) {
    var t = canvasTex(THREE, 256, 16, function (g, w, h) {
      for (var i = 0; i < 16; i++) {
        g.fillStyle = i % 2 ? '#f2f2f2' : '#d0232a';
        g.fillRect(i * 16, 0, 16, h);
      }
    });
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(8, 1);
    return t;
  }

  function logoTex(THREE) {
    return canvasTex(THREE, 512, 128, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.font = 'italic 900 92px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.strokeStyle = '#111';
      g.strokeText('BigTex', w / 2, h / 2 + 4);
      g.fillStyle = '#f4c21b';
      g.fillText('BigTex', w / 2, h / 2 + 4);
    });
  }

  function grilleTex(THREE) {
    return canvasTex(THREE, 512, 256, function (g, w, h) {
      g.fillStyle = '#0c0c0f'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#25252b'; g.lineWidth = 3;
      for (var y = 10; y < h; y += 16) for (var x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) {
        g.strokeRect(x + 2, y + 2, 10, 10);
      }
      g.fillStyle = '#17171b';
      g.fillRect(0, 96, w, 64);
      g.font = '900 64px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#3c3c44';
      g.save(); g.translate(w / 2, 129); g.scale(1.9, 1); g.fillText('R A M', 0, 0); g.restore();
    });
  }

  function blobTex(THREE) {
    return canvasTex(THREE, 256, 64, function (g, w, h) {
      // shadowBlur (works in every Safari) instead of ctx.filter
      g.shadowColor = 'rgba(0,0,0,0.85)';
      g.shadowBlur = 12;
      g.shadowOffsetY = -1000;
      g.fillStyle = '#000';
      g.fillRect(w * 0.08, h * 0.24 + 1000, w * 0.84, h * 0.52);
    }, false);
  }

  function floorTex(THREE) {
    return canvasTex(THREE, 512, 512, function (g, w, h) {
      var r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(167,139,250,0.30)');
      r.addColorStop(0.55, 'rgba(120,100,200,0.14)');
      r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(212,166,42,0.30)'; g.lineWidth = 2;
      g.beginPath(); g.arc(w / 2, h / 2, w * 0.43, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
      g.beginPath(); g.arc(w / 2, h / 2, w * 0.40, 0, Math.PI * 2); g.stroke();
    });
  }

  function studioEnv(THREE) {
    var env = new THREE.Scene();
    var room = new THREE.Mesh(new THREE.BoxGeometry(60, 40, 60), new THREE.MeshBasicMaterial({ color: 0x15131c, side: THREE.BackSide }));
    room.position.y = 7;
    env.add(room);
    function panel(w, h, x, y, z, ry, rx, intensity, color) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color || 0xffffff).multiplyScalar(intensity), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0);
      env.add(m);
    }
    panel(40, 2.5, 0, 24, 6, 0, Math.PI / 2, 0.6);        // overhead strip
    panel(14, 8, 26, 13, 10, -Math.PI / 2, 0, 2.0);      // key softbox
    panel(14, 8, -26, 12, -8, Math.PI / 2, 0, 1.3, 0xc8b8ff);
    panel(30, 4, 0, 16, -28, 0, 0, 1.0);
    panel(30, 4, 0, 16, 28, Math.PI, 0, 0.7);
    // Horizon band: gives the black paint a soft grey reflection line on its sides.
    var band = new THREE.Mesh(new THREE.CylinderGeometry(28, 28, 10, 40, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8a86a0).multiplyScalar(0.55), side: THREE.BackSide }));
    band.position.y = -3;
    env.add(band);
    var line = new THREE.Mesh(new THREE.CylinderGeometry(27.5, 27.5, 0.8, 40, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(1.6), side: THREE.BackSide }));
    line.position.y = -4.2;
    env.add(line);
    var floorM = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x0a0910 }));
    floorM.rotation.x = -Math.PI / 2; floorM.position.y = -12;
    env.add(floorM);
    return env;
  }

  /* ----------------------------- model ------------------------------ */
  function buildRig(THREE) {
    var group = new THREE.Group();
    var M = {
      paint: new THREE.MeshPhysicalMaterial({ color: 0x0c0c10, metalness: 0.6, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.06 }),
      satin: new THREE.MeshStandardMaterial({ color: 0x141418, metalness: 0.3, roughness: 0.55 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0e16, metalness: 0.2, roughness: 0.05, clearcoat: 1 }),
      tire: new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.92, metalness: 0 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x1d1d22, metalness: 0.85, roughness: 0.32 }),
      hub: new THREE.MeshStandardMaterial({ color: 0x8a8a94, metalness: 1, roughness: 0.22 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x101012, metalness: 0.4, roughness: 0.5 }),
      wood: new THREE.MeshStandardMaterial({ map: woodTex(THREE), roughness: 0.85, metalness: 0 }),
      diamond: new THREE.MeshStandardMaterial({ map: diamondTex(THREE), metalness: 0.6, roughness: 0.45 }),
      tape: new THREE.MeshStandardMaterial({ map: dotTapeTex(THREE), roughness: 0.4, emissive: 0x220000, emissiveIntensity: 0.4 }),
      head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf2ff, emissiveIntensity: 1.6 }),
      amber: new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff9a00, emissiveIntensity: 1.8 }),
      red: new THREE.MeshStandardMaterial({ color: 0x9a0f14, emissive: 0xd0141c, emissiveIntensity: 1.1 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xcfd2d8, metalness: 1, roughness: 0.12 }),
      grille: new THREE.MeshStandardMaterial({ map: grilleTex(THREE), metalness: 0.5, roughness: 0.4 }),
      logo: new THREE.MeshBasicMaterial({ map: logoTex(THREE), transparent: true, depthWrite: false })
    };

    function add(mesh, x, y, z, parent) { mesh.position.set(x || 0, y || 0, z || 0); (parent || group).add(mesh); return mesh; }
    function box(lx, ly, lz, mat, x, y, z, parent) { return add(new THREE.Mesh(new THREE.BoxGeometry(lx, ly, lz), mat), x, y, z, parent); }
    function extrude(shape, depth, mat, z, bevel, parent) {
      var geo = new THREE.ExtrudeGeometry(shape, {
        depth: depth, curveSegments: 14, bevelEnabled: !!bevel,
        bevelThickness: bevel || 0, bevelSize: bevel || 0, bevelSegments: 2
      });
      geo.translate(0, 0, -depth / 2);
      return add(new THREE.Mesh(geo, mat), 0, 0, z || 0, parent);
    }
    function shape(pts) {
      var s = new THREE.Shape();
      s.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
      s.closePath();
      return s;
    }
    var tireGeoCache = {};
    function wheel(x, y, z, r, width, outward, dished) {
      var k = r + '_' + width;
      if (!tireGeoCache[k]) {
        tireGeoCache[k] = {
          tire: new THREE.CylinderGeometry(r, r, width, 28, 1),
          side: new THREE.TorusGeometry(r - width * 0.22, width * 0.22, 8, 28),
          rim: new THREE.CylinderGeometry(r * 0.62, r * 0.62, width * 1.02, 24, 1),
          hub: new THREE.CylinderGeometry(r * 0.22, r * 0.28, width * 0.5, 16, 1),
          lugs: new THREE.TorusGeometry(r * 0.4, r * 0.04, 4, 16)
        };
      }
      var G = tireGeoCache[k];
      var w = new THREE.Group();
      var t = new THREE.Mesh(G.tire, M.tire); t.rotation.x = Math.PI / 2; w.add(t);
      var s1 = new THREE.Mesh(G.side, M.tire); s1.position.z = outward * (width / 2 - width * 0.12); w.add(s1);
      var rim = new THREE.Mesh(G.rim, M.rim); rim.rotation.x = Math.PI / 2; w.add(rim);
      var hub = new THREE.Mesh(G.hub, dished ? M.rim : M.hub); hub.rotation.x = Math.PI / 2;
      hub.position.z = outward * (dished ? width * 0.3 : width * 0.62); w.add(hub);
      var lugs = new THREE.Mesh(G.lugs, M.chrome); lugs.position.z = outward * width * 0.53; w.add(lugs);
      w.position.set(x, y, z);
      group.add(w);
      return w;
    }

    /* ---- 2026 Ram 3500 crew cab, 8 ft bed, dually ---- */
    var FX = 7.0, RX = -7.4, TR = 1.36; // front axle, rear axle, tire radius
    // Cab + front clip side profile with front wheel arch.
    var body = new THREE.Shape();
    body.moveTo(10.9, 1.75);
    body.lineTo(10.98, 4.35);
    body.lineTo(10.62, 4.78);
    body.lineTo(4.7, 5.02);
    body.lineTo(-3.05, 4.9);
    body.lineTo(-3.05, 1.5);
    body.lineTo(FX - 1.64, 1.5);
    body.absarc(FX, TR, 1.64, Math.PI, 0, true);
    body.lineTo(10.9, 1.5);
    body.closePath();
    extrude(body, 6.4, M.paint, 0, 0.14);
    // Power-dome hood bulge
    extrude(shape([[9.8, 4.8], [9.6, 5.02], [5.6, 5.14], [5.2, 4.95]]), 2.4, M.paint, 0, 0.08);
    // Greenhouse glass + roof
    extrude(shape([[4.55, 4.98], [2.35, 6.5], [-2.7, 6.55], [-2.95, 4.88]]), 6.0, M.glass, 0);
    extrude(shape([[2.5, 6.44], [2.2, 6.68], [-2.7, 6.7], [-2.85, 6.42]]), 6.15, M.paint, 0, 0.06);
    // Side window frames (A, B, C pillars) on both sides
    var frameShape = shape([[4.62, 4.96], [2.35, 6.56], [-2.75, 6.6], [-3.0, 4.86]]);
    var h1 = new THREE.Path(); h1.moveTo(4.12, 5.12); h1.lineTo(2.42, 6.32); h1.lineTo(0.42, 6.36); h1.lineTo(0.42, 5.12); h1.closePath();
    var h2 = new THREE.Path(); h2.moveTo(0.08, 5.12); h2.lineTo(0.08, 6.36); h2.lineTo(-2.5, 6.4); h2.lineTo(-2.62, 5.12); h2.closePath();
    frameShape.holes.push(h1, h2);
    extrude(frameShape, 0.12, M.paint, 3.06);
    extrude(frameShape, 0.12, M.paint, -3.06);
    // Door seams and handles
    [4.2, 0.25, -3.0].forEach(function (x) {
      box(0.03, 3.1, 6.72, M.frame, x, 3.3, 0);
    });
    [3.25, -0.55].forEach(function (hx) {
      box(0.55, 0.12, 0.08, M.satin, hx, 4.45, 3.38);
      box(0.55, 0.12, 0.08, M.satin, hx, 4.45, -3.38);
    });
    // Grille, headlights, bumper, fogs
    var gr = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.05), M.grille);
    gr.rotation.y = Math.PI / 2; add(gr, 11.12, 3.3, 0);
    [-1, 1].forEach(function (s) {
      box(0.1, 0.42, 1.05, M.head, 11.06, 3.95, s * 2.72);
      box(0.1, 0.1, 1.2, M.head, 11.06, 3.55, s * 2.7);
      box(0.1, 0.55, 0.12, M.head, 11.06, 3.72, s * 3.25);
      box(0.08, 0.2, 0.45, M.head, 11.32, 1.95, s * 2.7); // fog
      // tow mirrors
      box(0.12, 0.12, 0.7, M.satin, 4.0, 5.2, s * 3.6);
      box(0.25, 1.0, 0.18, M.satin, 3.95, 5.45, s * 4.0);
      box(0.06, 0.9, 0.14, M.glass, 3.82, 5.45, s * 4.0);
      // running boards
      box(6.6, 0.18, 0.45, M.satin, 0.6, 1.25, s * 3.55);
      // DRL C bars on the cab marker side
    });
    box(0.55, 1.15, 6.9, M.satin, 11.0, 1.85, 0);
    box(0.3, 0.12, 4.6, M.chrome, 11.15, 2.5, 0);
    // Cab roof marker lights (5 amber)
    for (var i = -2; i <= 2; i++) box(0.18, 0.1, 0.36, M.amber, 2.25, 6.76, i * 1.15);

    // Bed: floor, sides, front wall, tailgate
    var BX0 = -11.0, BX1 = -3.25, BL = BX1 - BX0, BC = (BX0 + BX1) / 2;
    box(BL, 0.15, 6.2, M.satin, BC, 2.95, 0);
    [-1, 1].forEach(function (s) {
      box(BL, 1.95, 0.22, M.paint, BC, 3.9, s * 3.2);
      box(BL, 0.12, 0.34, M.satin, BC, 4.92, s * 3.2); // rail cap
    });
    box(0.22, 1.95, 6.6, M.paint, BX1 + 0.1, 3.9, 0);
    box(0.22, 2.05, 6.6, M.paint, BX0 + 0.1, 3.85, 0);
    box(0.06, 0.35, 2.2, M.satin, BX0 - 0.02, 4.45, 0); // tailgate handle bezel
    [-1, 1].forEach(function (s) {
      box(0.1, 1.05, 0.42, M.red, BX0 - 0.02, 4.15, s * 3.05);
    });
    box(0.5, 0.75, 6.9, M.satin, BX0 - 0.1, 2.35, 0); // rear bumper
    // Dually fender flares (both sides)
    var fl = new THREE.Shape();
    fl.moveTo(RX - 2.35, 2.0);
    fl.lineTo(RX - 2.35, 3.7);
    fl.quadraticCurveTo(RX - 2.25, 4.75, RX - 1.0, 4.85);
    fl.lineTo(RX + 1.0, 4.85);
    fl.quadraticCurveTo(RX + 2.25, 4.75, RX + 2.35, 3.7);
    fl.lineTo(RX + 2.35, 2.0);
    fl.lineTo(RX + 1.7, 2.0);
    fl.absarc(RX, TR, 1.7, 0.36, Math.PI - 0.36, false);
    fl.closePath();
    extrude(fl, 0.78, M.paint, 3.7, 0.1);
    extrude(fl, 0.78, M.paint, -3.7, 0.1);
    // Chassis under the bed
    box(9.5, 0.6, 0.3, M.frame, BC + 1, 1.95, 1.4);
    box(9.5, 0.6, 0.3, M.frame, BC + 1, 1.95, -1.4);
    // Wheels: single front, dual rear
    wheel(FX, TR, 2.87, TR, 0.72, 1, false);
    wheel(FX, TR, -2.87, TR, 0.72, -1, false);
    wheel(RX, TR, 3.6, TR, 0.72, 1, false);
    wheel(RX, TR, 2.82, TR, 0.72, -1, true);
    wheel(RX, TR, -3.6, TR, 0.72, -1, false);
    wheel(RX, TR, -2.82, TR, 0.72, 1, true);
    // CURT gooseneck ball in the bed
    var BALL_X = -6.9;
    add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), M.chrome), BALL_X, 3.12, 0);

    var truckCount = group.children.length;
    /* ---- Big Tex 25GN-40D5A-MRBK: 35 ft main deck + 5 ft dovetail ---- */
    var DECK_Y = 34 / 12, HALF_W = 102 / 24;
    var D0 = -15.6, D1 = D0 - 35, DV = D1 - 5; // deck front, dovetail start, rear
    // Gooseneck neck (side profile), coupler tube, header
    var neck = shape([[-4.9, 5.05], [-4.9, 6.35], [-13.0, 6.35], [D0 - 0.4, DECK_Y], [D0 + 1.3, DECK_Y], [-12.1, 5.05]]);
    extrude(neck, 2.6, M.frame, 0, 0.06);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.95, 14), M.frame), BALL_X, 4.15, 0);
    [-1, 1].forEach(function (s) {
      var lg = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), M.logo);
      if (s < 0) lg.rotation.y = Math.PI;
      add(lg, -8.9, 5.7, s * 1.42);
      // DOT tape along the neck
      var tp = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 0.14), M.tape);
      if (s < 0) tp.rotation.y = Math.PI;
      add(tp, -8.9, 6.22, s * 1.42);
      // drop-leg jacks
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 5.3, 10), M.frame), -13.5, 3.25, s * 1.55);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.0, 10), M.chrome), -13.5, 0.55, s * 1.55);
      box(0.7, 0.08, 0.7, M.frame, -13.5, 0.06, s * 1.55);
    });
    // Toolbox in the neck
    box(2.2, 1.1, 2.7, M.diamond, -11.8, 5.3, 0);
    // Full-width header at the front of the deck
    box(0.45, 1.25, HALF_W * 2, M.frame, D0 - 0.1, DECK_Y - 0.25, 0);
    // Main deck
    var deckMats = [M.frame, M.frame, M.wood, M.frame, M.frame, M.frame];
    add(new THREE.Mesh(new THREE.BoxGeometry(35, 0.16, HALF_W * 2 - 0.3), deckMats), (D0 + D1) / 2, DECK_Y - 0.08, 0);
    // Side rails with DOT tape, main beams
    [-1, 1].forEach(function (s) {
      box(35, 0.72, 0.18, M.frame, (D0 + D1) / 2, DECK_Y - 0.36, s * (HALF_W - 0.09));
      var tp = new THREE.Mesh(new THREE.PlaneGeometry(35, 0.16), M.tape);
      if (s < 0) tp.rotation.y = Math.PI;
      add(tp, (D0 + D1) / 2, DECK_Y - 0.42, s * (HALF_W + 0.005));
      // I-beams (taller up front)
      var beam = shape([[D0, DECK_Y - 0.16], [D1, DECK_Y - 0.16], [D1, DECK_Y - 1.0], [D0 - 10, DECK_Y - 1.25], [D0, DECK_Y - 1.25]]);
      extrude(beam, 0.3, M.frame, s * 1.65);
    });
    // Stake pockets along both rails
    var pocketGeo = new THREE.BoxGeometry(0.28, 0.5, 0.14);
    var pockets = new THREE.InstancedMesh(pocketGeo, M.frame, 34);
    var mtx = new THREE.Matrix4(), n = 0;
    for (var p = 0; p < 17; p++) {
      var px = D0 - 1.2 - p * 2.0;
      mtx.makeTranslation(px, DECK_Y - 0.3, HALF_W + 0.07); pockets.setMatrixAt(n++, mtx);
      mtx.makeTranslation(px, DECK_Y - 0.3, -HALF_W - 0.07); pockets.setMatrixAt(n++, mtx);
    }
    group.add(pockets);
    // Dovetail (5 ft) with the MEGA ramps flipped onto it (diamond plate)
    var dvDrop = 0.95;
    var dvLen = Math.sqrt(25 + dvDrop * dvDrop), dvAng = Math.atan2(dvDrop, 5);
    var dv = new THREE.Group();
    dv.position.set(D1, DECK_Y, 0);
    dv.rotation.z = dvAng; // slopes down toward the rear (-x)
    group.add(dv);
    var dvMats = [M.frame, M.frame, M.diamond, M.frame, M.frame, M.frame];
    add(new THREE.Mesh(new THREE.BoxGeometry(dvLen, 0.16, HALF_W * 2 - 0.3), dvMats), -dvLen / 2, -0.08, 0, dv);
    [-1, 1].forEach(function (s) {
      box(dvLen, 0.6, 0.18, M.frame, -dvLen / 2, -0.32, s * (HALF_W - 0.09), dv);
      var tp = new THREE.Mesh(new THREE.PlaneGeometry(dvLen, 0.16), M.tape);
      if (s < 0) tp.rotation.y = Math.PI;
      add(tp, -dvLen / 2, -0.38, s * (HALF_W + 0.005), dv);
      // ramp hinge springs
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8), M.frame), -dvLen + 0.4, -0.15, s * 2.3, dv).rotation.z = Math.PI / 2;
    });
    // ramp seams across the dovetail plate
    box(dvLen, 0.02, 0.06, M.frame, -dvLen / 2, 0.01, 0, dv);
    // rear end bar with lights
    box(0.3, 0.55, HALF_W * 2, M.frame, -dvLen, -0.3, 0, dv);
    [-1, 1].forEach(function (s) {
      box(0.06, 0.3, 0.55, M.red, -dvLen - 0.17, -0.3, s * 3.4, dv);
    });
    // marker lights along the side rails
    [D0 - 1, (D0 + D1) / 2, D1 + 0.5].forEach(function (x, i) {
      [-1, 1].forEach(function (s) {
        box(0.3, 0.12, 0.05, i < 2 ? M.amber : M.red, x, DECK_Y - 0.2, s * (HALF_W + 0.03));
      });
    });
    // Tandem 12K dual-wheel axles
    var TT = 1.32, AX1 = D1 + 9.6, AX2 = D1 + 5.9;
    [AX1, AX2].forEach(function (ax) {
      box(0.25, 0.25, 7.2, M.frame, ax, TT, 0);
      wheel(ax, TT, 3.58, TT, 0.66, 1, false);
      wheel(ax, TT, 2.88, TT, 0.66, -1, true);
      wheel(ax, TT, -3.58, TT, 0.66, -1, false);
      wheel(ax, TT, -2.88, TT, 0.66, 1, true);
      // spring hangers
      box(3.6, 0.22, 0.2, M.frame, ax, TT + 0.55, 1.65);
      box(3.6, 0.22, 0.2, M.frame, ax, TT + 0.55, -1.65);
    });

    // Center the rig on the turntable. Front of truck +11.3, back of dovetail DV.
    var front = 11.35, back = DV - 0.2;
    var mid = (front + back) / 2;
    var parts = group.children.slice();
    var truck = new THREE.Group(), trailer = new THREE.Group();
    parts.forEach(function (c, i) { (i < truckCount ? truck : trailer).add(c); });
    group.add(truck, trailer);
    // Soft contact shadows, one per vehicle so the trailer can show alone.
    var blob = new THREE.MeshBasicMaterial({ map: blobTex(THREE), transparent: true, depthWrite: false, opacity: 0.85 });
    function shadowUnder(parent, x0, x1, wz) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry((x0 - x1) * 1.12, wz * 1.6), blob);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, 0.02, 0);
      parent.add(m);
    }
    shadowUnder(truck, front, BX0 - 0.4, 8.2);
    shadowUnder(trailer, -12.5, back, HALF_W * 2);
    var trailerFront = -4.9;
    var res = { group: group, truck: truck, trailer: trailer, rigOffset: -mid, trailerOffset: -(trailerFront + back) / 2 };
    group.position.x = res.rigOffset;
    return res;
  }

  function buildFloor(THREE) {
    var m = new THREE.Mesh(new THREE.CircleGeometry(44, 64), new THREE.MeshBasicMaterial({ map: floorTex(THREE), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0;
    m.renderOrder = -1;
    return m;
  }

  function init() {
    if (!buildUi()) return;
    var kick = function () { maybeStart(); };
    if (document.readyState === 'complete') kick();
    else window.addEventListener('load', kick, { once: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
