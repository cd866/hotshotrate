/* Black Ram Logistics: Our rig 360 spin (v75–v81, tailgate and toolbox v82, top lid v89).
   A low-poly 3D model of our 2026 Ram 3500 dually crew cab (Diamond Black)
   and the Big Tex 25GN-40 gooseneck (40 ft deck incl. 5 ft dovetail, 102 in
   wide, 34 in deck height), built in code with Three.js r170 (vendored at
   vendor/three/three.module.min.js, MIT). The real photo stays as the poster
   and as the "Photo" toggle. "Truck" spins the Ram alone; "Trailer" spins the
   Big Tex 25GN-40D5A-MRBK on its own (unhitched, on its drop-leg jacks).
   - Three.js only loads after first paint (idle) and once the stage is on screen.
   - Slow auto-spin (about 26 s per turn) starts as soon as the 360 is ready
     on the Rig, Truck and Trailer views. After any touch, drag, arrow, zoom
     or pan, auto-spin always resumes about 3 s later, even if the view is
     still zoomed, panned or tilted (zoom and tilt stay as they are).
   - One-finger drag orbits freely (yaw plus vertical tilt, 2-62 deg) with
     inertia. Pinch zooms; two-finger drag pans. Double-tap or double-click
     resets the view. Mouse wheel / trackpad pinch or the +/- buttons zoom
     1x to 5x. Auto-spin pauses while touching.
   - Arrow pad (v79): left/right rotate, up/down tilt the camera 2-62 deg;
     press and hold keeps moving. Reset puts zoom, pan and tilt back and
     closes an open tailgate or toolbox.
   - Tailgate (Truck and Rig): tap or the 'Tap tailgate' button swings it down
     in 0.6 s and eases the camera to a rear 3/4 of the bed. Once open, the
     same finger controls orbit, tilt, pinch-zoom and pan around the bed
     (auto-spin resumes after idle). The bed has a gray spray-in liner, a
     center gold/brass gooseneck ball with a blue latch grip, two gold
     safety-chain U-loops, and four black 5th-wheel puck holes in a rectangle.
     Tap again or Reset closes it. Double-tap while open resets the bed view.
   - Toolbox (Trailer and Rig): the Big Tex storage box sits under the gooseneck,
     in the gap ahead of the deck, between the uprights. The top is a black
     diamond-plate lid with a latch near the rear edge; it hinges up like a
     chest. Tap or 'Tap toolbox' opens it to show straps, chains, binders and a
     winch bar; the camera eases above the box to look in. Tap again or Reset
     closes it. Taps are raycast and ignored if the pointer dragged.
   - prefers-reduced-motion: no auto-spin and no coasting; openings snap;
     drag still works.
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
  var subject = 'rig'; // 'rig' (hitched), 'truck' (Ram alone), or 'trailer' (Big Tex alone)
  var reduceMotion = false;
  var onScreen = true;
  var started = false;
  var failed = false;
  var view = null; // set once the 3D scene is ready

  function $(sel, root) { return (root || document).querySelector(sel); }

  function setMode(next, save, subj) {
    mode = next === 'photo' ? 'photo' : '360';
    if (subj === 'rig' || subj === 'truck' || subj === 'trailer') subject = subj;
    if (!stage) return;
    stage.setAttribute('data-view', mode);
    stage.setAttribute('data-subject', subject);
    var btns = toggle ? toggle.querySelectorAll('button') : [];
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-view') === mode &&
        (mode === 'photo' || btns[i].getAttribute('data-subject') === subject);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (save) { try { localStorage.setItem(MODE_KEY, mode === 'photo' ? 'photo' : (subject === 'rig' ? '360' : subject)); } catch (e) { /* ignore */ } }
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
      '<button type="button" data-view="360" data-subject="truck" aria-pressed="false" aria-label="Ram 3500 truck 360">Truck</button>' +
      '<button type="button" data-view="360" data-subject="trailer" aria-pressed="false" aria-label="Big Tex trailer 360">Trailer</button>' +
      '<button type="button" data-view="photo" aria-pressed="false">Photo</button>';
    stage.appendChild(toggle);
    toggle.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-view]');
      if (b) setMode(b.getAttribute('data-view'), true, b.getAttribute('data-subject'));
    });

    hint = document.createElement('div');
    hint.className = 'r360-hint';
    hint.textContent = 'Drag to orbit';
    stage.appendChild(hint);

    var saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch (e) { saved = null; }
    setMode(saved === 'photo' ? 'photo' : '360', false, saved === 'truck' ? 'truck' : saved === 'trailer' ? 'trailer' : 'rig');

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
        try { console.warn('rig360', String(err && err.stack || err)); } catch (e) { /* ignore */ }
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
    var lastX = 0, lastY = 0, lastT = 0;
    var elevVel = 0;
    var raf = 0, lastFrame = 0;
    var shown = false;
    var w = 0, h = 0;

    // Zoom: 1 = whole vehicle in frame, up to ZOOM_MAX. Pan is in world feet
    // along the camera's right/up axes, so zooming stays under the fingers.
    var ZOOM_MAX = 5;
    var zoom = 1, panX = 0, panY = 0, baseDist = 80, halfLen = 33.5;
    var ELEV0 = THREE.MathUtils.degToRad(11);
    var ELEV_MIN = THREE.MathUtils.degToRad(2), ELEV_MAX = THREE.MathUtils.degToRad(62);
    var ELEV = ELEV0;
    var upAxis = new THREE.Vector3(0, Math.cos(ELEV), -Math.sin(ELEV));
    var held = null; // arrow button being held: { da, de }
    // After a tailgate / toolbox opens, the camera orbits the part in world space.
    var iYaw = 0, iElev = 0, iDist = 18, iPanX = 0, iPanY = 0, iVelY = 0, iVelE = 0;
    var iLook = new THREE.Vector3();
    var I_ELEV_MIN = THREE.MathUtils.degToRad(12), I_ELEV_MAX = THREE.MathUtils.degToRad(80);

    function applyCamera() {
      ELEV = Math.max(ELEV_MIN, Math.min(ELEV_MAX, ELEV));
      upAxis.set(0, Math.cos(ELEV), -Math.sin(ELEV));
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
      stage.toggleAttribute('data-r360-adjusted', zoom > 1.02 || Math.abs(ELEV - ELEV0) > 0.01 || !!inspectKind);
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
      if (inspectOrbiting()) applyInspectOrbit(); else applyCamera();
      render();
      update();
    }

    function resetZoom() {
      if (inspectOrbiting()) {
        zoom = 1; iPanX = 0; iPanY = 0; iVelY = 0; iVelE = 0;
        syncInspectOrbitFromPose();
        lastInput = performance.now();
        applyInspectOrbit(); render(); update();
        return;
      }
      if (inspectKind) closeInspect(true);
      zoom = 1; panX = 0; panY = 0; ELEV = ELEV0; elevVel = 0;
      lastInput = performance.now();
      applyCamera(); render(); update();
    }

    // Tailgate / toolbox inspect: open the part, ease the camera, pause auto-spin.
    var inspectKind = null; // 'tailgate' | 'toolbox' | null
    var inspectOpen = 0;    // 0 closed .. 1 open (eased)
    var anim = null;
    var camHold = null; // frame a part from the front without opening it
    var raycaster = new THREE.Raycaster();
    var ndc = new THREE.Vector2();
    var _look = new THREE.Vector3();
    var _cam = new THREE.Vector3();
    var _lookA = new THREE.Vector3();
    var _camA = new THREE.Vector3();
    var _lookB = new THREE.Vector3();
    var _camB = new THREE.Vector3();

    function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function wrapDelta(from, to) {
      var d = to - from;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    }
    function worldAt(lx, ly, lz, ang) {
      var px = lx + rig.group.position.x, pz = lz;
      var c = Math.cos(ang), s = Math.sin(ang);
      return new THREE.Vector3(px * c + pz * s, ly, -px * s + pz * c);
    }
    function currentLookAt() {
      return new THREE.Vector3(panX + upAxis.x * panY, 4.6 + upAxis.y * panY, upAxis.z * panY);
    }
    function currentCamPos() {
      var d = baseDist / zoom;
      return new THREE.Vector3(
        panX + upAxis.x * panY,
        4.6 + upAxis.y * panY - 2.2 + Math.sin(ELEV) * d,
        upAxis.z * panY + Math.cos(ELEV) * d
      );
    }
    function inspectOrbiting() { return !!(inspectKind && inspectOpen > 0.99 && !anim); }
    function defaultInspectOrbit(kind) {
      var pose = inspectPose(kind, inspectPose(kind, 0).angle);
      var dx = pose.cam.x - pose.look.x, dy = pose.cam.y - pose.look.y, dz = pose.cam.z - pose.look.z;
      var d = Math.max(4, Math.hypot(dx, dy, dz));
      return { yaw: Math.atan2(dx, dz), elev: Math.asin(Math.max(-1, Math.min(1, dy / d))), dist: d, look: pose.look.clone() };
    }
    function syncInspectOrbitFromPose() {
      var o = defaultInspectOrbit(inspectKind);
      iYaw = o.yaw; iElev = o.elev; iDist = o.dist; iPanX = 0; iPanY = 0; iVelY = 0; iVelE = 0;
      iLook.copy(o.look);
    }
    function applyInspectOrbit() {
      iElev = Math.max(I_ELEV_MIN, Math.min(I_ELEV_MAX, iElev));
      var z = Math.max(1, Math.min(ZOOM_MAX, zoom));
      var d = iDist / z;
      var ce = Math.cos(iElev), se = Math.sin(iElev);
      var sy = Math.sin(iYaw), cy = Math.cos(iYaw);
      var lookX = iLook.x + cy * iPanX, lookY = iLook.y + iPanY, lookZ = iLook.z + (-sy) * iPanX;
      camera.position.set(lookX + sy * ce * d, lookY + se * d, lookZ + cy * ce * d);
      camera.lookAt(lookX, lookY, lookZ);
      camera.updateProjectionMatrix();
      stage.toggleAttribute('data-r360-zoomed', zoom > 1.02);
      stage.toggleAttribute('data-r360-adjusted', true);
    }
    function currentInspectLook() {
      return new THREE.Vector3(iLook.x + Math.cos(iYaw) * iPanX, iLook.y + iPanY, iLook.z + (-Math.sin(iYaw)) * iPanX);
    }
    function inspectPose(kind, ang) {
      // Camera and look-at in world space for a rear / lid-side 3/4 of the part.
      if (kind === 'tailgate') {
        // Well behind the dropped tailgate, up and to the passenger side, looking into the bed at the ball.
        return { look: worldAt(-7.8, 3.4, 0, ang), cam: worldAt(-17.8, 9.6, 7.2, ang), angle: 2.05 };
      }
      var tb = rig.tb;
      // High front-passenger 3/4, well out to the side so the neck is behind
      // the box, looking down onto the lid and into the open chest.
      return { look: worldAt(tb.x, tb.y - 0.2, tb.z, ang), cam: worldAt(tb.x + 4.6, tb.y + 8.0, tb.z + 10.2, ang), angle: 0.55 };
    }
    function applyHeldCam() {
      if (!camHold || anim || inspectKind) return;
      var pose = inspectPose(camHold, inspectPose(camHold, 0).angle);
      angle = pose.angle;
      camera.position.copy(pose.cam);
      camera.lookAt(pose.look);
      camera.updateProjectionMatrix();
    }
    function applyPartPose(open) {
      if (rig.tailgate) rig.tailgate.rotation.z = (inspectKind === 'tailgate' ? open : 0) * (Math.PI / 2);
      if (rig.toolboxLid) rig.toolboxLid.rotation.z = (inspectKind === 'toolbox' ? open : 0) * (-Math.PI * 0.55);
      if (rig.ballLight) rig.ballLight.intensity = (inspectKind === 'tailgate' ? open : 0) * 2.2;
    }
    function applyInspectCamera(open, fromAng, toAng, fromCam, fromLook) {
      var ang = fromAng + wrapDelta(fromAng, toAng) * open;
      angle = ang;
      var pose = inspectPose(inspectKind, ang);
      if (open >= 0.999) {
        camera.position.copy(pose.cam);
        camera.lookAt(pose.look);
      } else {
        camera.position.copy(fromCam).lerp(pose.cam, open);
        _look.copy(fromLook).lerp(pose.look, open);
        camera.lookAt(_look);
      }
      camera.updateProjectionMatrix();
    }
    function setInspectAttr() {
      stage.toggleAttribute('data-r360-inspect', !!inspectKind);
      stage.toggleAttribute('data-r360-adjusted', zoom > 1.02 || Math.abs(ELEV - ELEV0) > 0.01 || !!inspectKind);
      updatePartButtons();
    }
    function startAnim(kind, opening) {
      var dur = reduceMotion ? 80 : 600;
      var from = inspectOpen;
      var to = opening ? 1 : 0;
      var fromAng = angle;
      var toAng = opening ? inspectPose(kind, 0).angle : (anim && anim.restAngle != null ? anim.restAngle : angle);
      // When opening, remember the view to restore; when closing, restore it.
      var rest;
      if (opening) {
        rest = { angle: angle, zoom: zoom, panX: panX, panY: panY, elev: ELEV };
      } else {
        rest = (anim && anim.rest) || { angle: angle, zoom: 1, panX: 0, panY: 0, elev: ELEV0 };
        toAng = rest.angle;
      }
      inspectKind = kind || inspectKind;
      var fromCam = camera.position.clone();
      var fromLook = (inspectKind && inspectOpen > 0.2)
        ? (inspectOrbiting() ? currentInspectLook() : inspectPose(inspectKind, angle).look)
        : currentLookAt();
      anim = {
        start: performance.now(), dur: dur, from: from, to: to, kind: inspectKind,
        fromAng: fromAng, toAng: toAng,
        fromCam: fromCam, fromLook: fromLook,
        rest: rest, restAngle: rest.angle,
        opening: opening
      };
      lastInput = 1e15; // pause auto-spin while open or closing
      setInspectAttr();
      update();
    }
    function stepAnim(now) {
      if (!anim) return;
      var u = Math.min(1, (now - anim.start) / anim.dur);
      var e = easeInOut(u);
      inspectOpen = anim.from + (anim.to - anim.from) * e;
      applyPartPose(inspectOpen);
      var ang = anim.fromAng + wrapDelta(anim.fromAng, anim.toAng) * e;
      angle = ang;
      if (anim.opening) {
        applyInspectCamera(e, anim.fromAng, anim.toAng, anim.fromCam, anim.fromLook);
      } else {
        // lerp inspect camera back to the saved orbit view
        zoom = anim.rest.zoom;
        panX = anim.rest.panX;
        panY = anim.rest.panY;
        ELEV = anim.rest.elev;
        var destCam = currentCamPos(), destLook = currentLookAt();
        camera.position.copy(anim.fromCam).lerp(destCam, e);
        _look.copy(anim.fromLook).lerp(destLook, e);
        camera.lookAt(_look);
        camera.updateProjectionMatrix();
      }
      if (u >= 1) {
        if (!anim.opening) {
          inspectKind = null;
          inspectOpen = 0;
          applyPartPose(0);
          angle = anim.rest.angle;
          zoom = anim.rest.zoom;
          panX = anim.rest.panX;
          panY = anim.rest.panY;
          ELEV = anim.rest.elev;
          lastInput = performance.now(); // auto-spin resumes after idle
          applyCamera();
        } else {
          inspectOpen = 1;
          syncInspectOrbitFromPose();
          applyInspectOrbit();
          lastInput = performance.now();
        }
        anim = null;
        setInspectAttr();
      }
    }
    function toggleInspect(kind) {
      camHold = null;
      if (inspectKind && inspectKind !== kind) {
        // close the other first, then open this one on the next tick of the close? snap-close other.
        if (rig.tailgate) rig.tailgate.rotation.z = 0;
        if (rig.toolboxLid) { rig.toolboxLid.rotation.x = 0; rig.toolboxLid.rotation.z = 0; }
        inspectOpen = 0;
      }
      var opening = !(inspectKind === kind && inspectOpen > 0.5);
      if (!opening) { startAnim(kind, false); return; }
      inspectKind = kind;
      startAnim(kind, true);
    }
    function closeInspect(snap) {
      camHold = null;
      if (!inspectKind && inspectOpen < 0.01) return;
      if (snap || reduceMotion) {
        inspectKind = null;
        inspectOpen = 0;
        anim = null;
        applyPartPose(0);
        lastInput = performance.now();
        setInspectAttr();
        return;
      }
      startAnim(inspectKind, false);
    }
    function partFromObj(obj) {
      while (obj) {
        if (obj.userData && obj.userData.part) return obj.userData.part;
        obj = obj.parent;
      }
      return null;
    }
    function tryPartTap(ev) {
      if (mode !== '360' || !w || !h) return false;
      var r = canvasWrap.getBoundingClientRect();
      ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      var targets = [];
      if (rig.truck && rig.truck.visible && rig.tailgate) targets.push(rig.tailgate);
      if (rig.trailer && rig.trailer.visible && rig.toolbox) targets.push(rig.toolbox);
      if (!targets.length) return false;
      var hits = raycaster.intersectObjects(targets, true);
      if (!hits.length) return false;
      var kind = partFromObj(hits[0].object);
      if (!kind) return false;
      toggleInspect(kind);
      return true;
    }

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
      halfLen = subject === 'trailer' ? 26.5 : subject === 'truck' ? 13 : 33.5;
      baseDist = halfLen / Math.tan(hfov / 2) + (subject === 'trailer' ? 11 : subject === 'truck' ? 9 : 13);
      if (inspectOrbiting()) applyInspectOrbit();
      else if (inspectKind && inspectOpen > 0.5 && !anim) applyInspectCamera(1, angle, angle, camera.position, currentLookAt());
      else if (camHold) applyHeldCam();
      else applyCamera();
    }

    function wantsLoop() {
      if (mode !== '360' || !onScreen || document.hidden) return false;
      if (anim || inspectKind) return true;
      if (dragging || held) return true;
      if (!reduceMotion && (Math.abs(velocity) > 0.002 || Math.abs(elevVel) > 0.002 || Math.abs(iVelY) > 0.002 || Math.abs(iVelE) > 0.002)) return true;
      if (!reduceMotion) return true; // auto-spin, including while zoomed, panned or tilted
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
      if (anim) stepAnim(t);
      if (held) {
        if (inspectOrbiting()) {
          iYaw += held.da * dt;
          if (held.de) iElev += held.de * dt;
          applyInspectOrbit();
        } else {
          angle += held.da * dt;
          if (held.de && !inspectKind) { ELEV += held.de * dt; applyCamera(); }
        }
        lastInput = performance.now();
      } else if (!dragging && !reduceMotion && !anim) {
        if (inspectOrbiting()) {
          if (Math.abs(iVelY) > 0.002) { iYaw += iVelY * dt; iVelY *= Math.pow(0.04, dt); }
          else iVelY = 0;
          if (Math.abs(iVelE) > 0.002) { iElev += iVelE * dt; iVelE *= Math.pow(0.04, dt); }
          else iVelE = 0;
          if (iVelY === 0 && iVelE === 0 && performance.now() - lastInput > IDLE_RESUME_MS) {
            var ramp = Math.min(1, (performance.now() - lastInput - IDLE_RESUME_MS) / 1200);
            iYaw += autoSpeed * ramp * dt;
          }
          applyInspectOrbit();
        } else if (!inspectKind) {
          if (Math.abs(velocity) > 0.002) {
            angle += velocity * dt;
            velocity *= Math.pow(0.04, dt); // coast out a flick
          } else velocity = 0;
          if (Math.abs(elevVel) > 0.002) {
            ELEV += elevVel * dt;
            applyCamera();
            elevVel *= Math.pow(0.04, dt);
          } else elevVel = 0;
          if (velocity === 0 && elevVel === 0 && performance.now() - lastInput > IDLE_RESUME_MS) {
            var ramp = Math.min(1, (performance.now() - lastInput - IDLE_RESUME_MS) / 1200);
            angle += autoSpeed * ramp * dt;
          }
        }
      }
      if (camHold && !inspectKind) {
        applyHeldCam();
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

    // One finger / mouse drag orbits (yaw + tilt) with inertia. Two fingers
    // pinch to zoom and pan. Double-tap (or double-click) resets the view.
    // touch-action: none so a vertical drag can tilt. Same controls apply
    // while the tailgate or toolbox is open (camera orbits the part).
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
      if (ev.target.closest && ev.target.closest('.r360-toggle, .r360-zoom, .r360-pad, .r360-zreset, .r360-parts')) return;
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
        lastX = ev.clientX; lastY = ev.clientY; lastT = now;
        stage._r360sx = ev.clientX; stage._r360sy = ev.clientY;
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
        if (inspectOrbiting()) {
          iPanX -= (ps.x - pinch.x) * fpp;
          iPanY += (ps.y - pinch.y) * fpp;
        } else {
          panX -= (ps.x - pinch.x) * fpp;
          panY += (ps.y - pinch.y) * fpp;
        }
        pinch.x = ps.x; pinch.y = ps.y;
        zoomAt(pinch.zoom * ps.d / pinch.d, ps.x, ps.y);
        return;
      }
      if (!dragging) return;
      var dx = ev.clientX - lastX;
      var dy = ev.clientY - lastY;
      var dtm = Math.max(1, now - lastT);
      var da = dx * (Math.PI * 2) / Math.max(320, w * 1.6) / Math.sqrt(zoom);
      var de = -dy * (Math.PI / 2) / Math.max(220, h * 1.4) / Math.sqrt(zoom);
      if (inspectOrbiting()) {
        iYaw += da;
        iElev += de;
        iVelY = iVelY * 0.6 + (da / (dtm / 1000)) * 0.4;
        iVelE = iVelE * 0.6 + (de / (dtm / 1000)) * 0.4;
        applyInspectOrbit();
        render();
      } else {
        angle += da;
        if (!inspectKind) {
          ELEV += de;
          applyCamera();
          elevVel = elevVel * 0.6 + (de / (dtm / 1000)) * 0.4;
        }
        velocity = velocity * 0.6 + (da / (dtm / 1000)) * 0.4;
        if (reduceMotion || zoom > 1.02 || Math.abs(de) > 0.0005) render();
      }
      lastX = ev.clientX; lastY = ev.clientY; lastT = now; lastInput = now;
      if (Math.hypot(dx, dy) > 2) lastTap = 0;
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
        if (k) { dragging = true; lastX = pts[k].x; lastY = pts[k].y; lastT = lastInput; }
        update();
        return;
      }
      if (!dragging) return;
      dragging = false;
      var moved = Math.hypot(ev.clientX - (stage._r360sx || ev.clientX), ev.clientY - (stage._r360sy || ev.clientY));
      var tapped = moved < 10;
      if (tapped && tryPartTap(ev)) {
        velocity = 0;
        stage.classList.remove('r360-grab');
        update();
        return;
      }
      if (lastInput - lastT > 90) { velocity = 0; elevVel = 0; iVelY = 0; iVelE = 0; }
      velocity = Math.max(-4, Math.min(4, velocity));
      elevVel = Math.max(-2, Math.min(2, elevVel));
      iVelY = Math.max(-4, Math.min(4, iVelY));
      iVelE = Math.max(-2, Math.min(2, iVelE));
      if (reduceMotion) { velocity = 0; elevVel = 0; iVelY = 0; iVelE = 0; }
      stage.classList.remove('r360-grab');
      update();
    }
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('dblclick', function (ev) {
      if (mode !== '360' || (ev.target.closest && ev.target.closest('.r360-toggle, .r360-zoom, .r360-pad, .r360-zreset, .r360-parts'))) return;
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
      '';
    var zreset = document.createElement('button');
    zreset.type = 'button';
    zreset.className = 'r360-zreset';
    zreset.setAttribute('data-z', 'reset');
    zreset.setAttribute('aria-label', 'Reset view (zoom, pan and tilt)');
    zreset.textContent = 'Reset';
    stage.appendChild(zreset);
    zreset.addEventListener('click', function () { resetZoom(); });
    var partsBar = document.createElement('div');
    partsBar.className = 'r360-parts';
    partsBar.setAttribute('role', 'group');
    partsBar.setAttribute('aria-label', 'Open parts');
    partsBar.innerHTML =
      '<button type="button" data-part="tailgate" aria-pressed="false">Tap tailgate</button>' +
      '<button type="button" data-part="toolbox" aria-pressed="false">Tap toolbox</button>';
    stage.appendChild(partsBar);
    partsBar.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-part]');
      if (b) toggleInspect(b.getAttribute('data-part'));
    });
    function updatePartButtons() {
      var truckOn = !(subject === 'trailer');
      var trailOn = !(subject === 'truck');
      var map = { tailgate: truckOn, toolbox: trailOn };
      var btns = partsBar.querySelectorAll('button[data-part]');
      for (var i = 0; i < btns.length; i++) {
        var kind = btns[i].getAttribute('data-part');
        var on = !!map[kind];
        btns[i].hidden = !on;
        var open = inspectKind === kind && inspectOpen > 0.5;
        btns[i].setAttribute('aria-pressed', open ? 'true' : 'false');
        btns[i].textContent = open
          ? (kind === 'tailgate' ? 'Close tailgate' : 'Close toolbox')
          : (kind === 'tailgate' ? 'Tap tailgate' : 'Tap toolbox');
      }
    }
    updatePartButtons();
    stage.appendChild(zbar);
    // Arrow pad: left/right rotate, up/down tilt. Press and hold keeps
    // moving; a tap (or Enter/Space) moves one step. Auto-spin pauses while held, then resumes after idle.
    var ICON = {
      left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', up: 'M5 15l7-7 7 7', down: 'M5 9l7 7 7-7'
    };
    var ROT = 1.5, TILT = THREE.MathUtils.degToRad(32); // per second while held
    var STEP = { left: [-0.26, 0], right: [0.26, 0], up: [0, THREE.MathUtils.degToRad(6)], down: [0, -THREE.MathUtils.degToRad(6)] };
    var pad = document.createElement('div');
    pad.className = 'r360-pad';
    pad.setAttribute('role', 'group');
    pad.setAttribute('aria-label', 'Move view');
    pad.innerHTML = ['left', 'up', 'down', 'right'].map(function (d) {
      var lbl = { left: 'Rotate left', right: 'Rotate right', up: 'Tilt up (look from higher)', down: 'Tilt down (look from lower)' }[d];
      return '<button type="button" data-dir="' + d + '" aria-label="' + lbl + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICON[d] + '" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    }).join('');
    stage.appendChild(pad);
    function rate(d) {
      return { da: d === 'left' ? -ROT : d === 'right' ? ROT : 0, de: d === 'up' ? TILT : d === 'down' ? -TILT : 0 };
    }
    function step(d) {
      if (inspectOrbiting()) {
        iYaw += STEP[d][0];
        iElev += STEP[d][1];
        iVelY = 0; iVelE = 0;
        lastInput = performance.now();
        applyInspectOrbit(); render(); update();
        return;
      }
      angle += STEP[d][0];
      ELEV += STEP[d][1];
      velocity = 0; elevVel = 0;
      lastInput = performance.now();
      applyCamera(); render(); update();
    }
    var holdBtn = null, holdTimer = 0;
    function endHold() {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
      if (holdBtn) holdBtn.classList.remove('is-held');
      holdBtn = null; held = null;
      lastInput = performance.now();
      update();
    }
    pad.addEventListener('pointerdown', function (ev) {
      var b = ev.target.closest('button[data-dir]');
      if (!b || mode !== '360') return;
      ev.preventDefault();
      endHold();
      holdBtn = b; b.classList.add('is-held');
      stage.setAttribute('data-r360-touched', '1');
      try { b.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      var d = b.getAttribute('data-dir');
      step(d); // immediate nudge, then keep moving while held
      holdTimer = setTimeout(function () { holdTimer = 0; if (holdBtn === b) { held = rate(d); update(); } }, 260);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) { pad.addEventListener(t, endHold); });
    pad.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-dir]');
      if (b && ev.detail === 0) step(b.getAttribute('data-dir')); // keyboard
    });
    pad.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) endHold(); });

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
        var t = sub === 'trailer', k = sub === 'truck';
        rig.truck.visible = !t;
        rig.trailer.visible = !k;
        rig.group.position.x = t ? rig.trailerOffset : k ? rig.truckOffset : rig.rigOffset;
        zoom = 1; panX = 0; panY = 0; ELEV = ELEV0;
        closeInspect(true);
        updatePartButtons();
        w = 0;
        if (shown) { render(); }
        update();
      },
      resize: function () { w = 0; resize(); },
      zoomTo: function (z, cx, cy) { zoomAt(z, cx, cy); },
      resetZoom: resetZoom,
      getZoom: function () { return zoom; },
      getTilt: function () { return THREE.MathUtils.radToDeg(ELEV); },
      idleMs: function () { return performance.now() - lastInput; },
      getPan: function () { return [panX, panY]; },
      setAngle: function (a) { angle = a; lastInput = performance.now(); render(); },
      getAngle: function () { return angle; },
      info: function () { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, running: !!raf }; },
      pause: function (p) { lastInput = p ? 1e15 : -1e9; update(); },
      toggleTailgate: function () { toggleInspect('tailgate'); },
      snapInspect: function (kind, yawDeg, elevDeg, z) {
        kind = kind || 'tailgate';
        camHold = null; anim = null;
        inspectKind = kind; inspectOpen = 1;
        applyPartPose(1);
        angle = inspectPose(kind, 0).angle;
        turntable.rotation.y = angle;
        zoom = (z != null) ? Math.max(1, Math.min(ZOOM_MAX, z)) : 1;
        syncInspectOrbitFromPose();
        if (yawDeg != null) iYaw = THREE.MathUtils.degToRad(yawDeg);
        if (elevDeg != null) iElev = THREE.MathUtils.degToRad(elevDeg);
        applyInspectOrbit(); render(); updatePartButtons(); setInspectAttr();
      },
      toggleToolbox: function () { toggleInspect('toolbox'); },
      framePart: function (kind) {
        camHold = kind;
        lastInput = 1e15;
        applyHeldCam();
        render();
      },
      closeInspect: closeInspect,
      inspecting: function () { return inspectKind; },
      inspectOpen: function () { return inspectOpen; }
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


  function linerTex(THREE) {
    // Spray-in bed liner: medium gray, ribs run the length of the bed (u).
    var t = canvasTex(THREE, 512, 512, function (g, w, h) {
      g.fillStyle = '#5f6369';
      g.fillRect(0, 0, w, h);
      var rnd = seeded(77);
      var img = g.getImageData(0, 0, w, h), d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var n = (rnd() - 0.5) * 18;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
      for (var x = 0; x < w; x += 30) {
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x, 0, 6, h);
        g.fillStyle = 'rgba(255,255,255,0.07)';
        g.fillRect(x + 6, 0, 2, h);
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 4);
    return t;
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
      gold: new THREE.MeshPhysicalMaterial({ color: 0xf0c53a, metalness: 1, roughness: 0.12, clearcoat: 0.7, clearcoatRoughness: 0.1, emissive: 0x5a3a00, emissiveIntensity: 0.45 }),
      brass: new THREE.MeshPhysicalMaterial({ color: 0xdcbc5a, metalness: 0.7, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2, emissive: 0x7a5a14, emissiveIntensity: 0.55 }),
      puck: new THREE.MeshStandardMaterial({ color: 0x161618, metalness: 0.15, roughness: 0.72 }),
      hole: new THREE.MeshStandardMaterial({ color: 0x050506, metalness: 0.4, roughness: 0.85 }),
      liner: new THREE.MeshStandardMaterial({ map: linerTex(THREE), color: 0xc2c6cb, roughness: 0.9, metalness: 0.03 }),
      grip: new THREE.MeshStandardMaterial({ color: 0x1560d8, roughness: 0.55, metalness: 0.05 }),
      plate: new THREE.MeshStandardMaterial({ color: 0x16161a, metalness: 0.75, roughness: 0.38 }),
      strap: new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.7, metalness: 0.05 }),
      strapOr: new THREE.MeshStandardMaterial({ color: 0xc45a12, roughness: 0.7, metalness: 0.05 }),
      chain: new THREE.MeshStandardMaterial({ color: 0xb58a22, metalness: 0.85, roughness: 0.35 }),
      bar: new THREE.MeshStandardMaterial({ color: 0x7a7a82, metalness: 0.85, roughness: 0.28 }),
      binder: new THREE.MeshStandardMaterial({ color: 0x8a1518, metalness: 0.4, roughness: 0.45 }),
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

    // Bed: floor (gray spray-in liner), sides, front wall, tailgate
    var BX0 = -11.0, BX1 = -3.25, BL = BX1 - BX0, BC = (BX0 + BX1) / 2;
    var FLOOR_Y = 3.03;
    box(BL, 0.15, 6.2, M.satin, BC, 2.95, 0);
    var liner = new THREE.Mesh(new THREE.PlaneGeometry(BL - 0.08, 6.05, 1, 1), M.liner);
    liner.rotation.x = -Math.PI / 2;
    add(liner, BC, FLOOR_Y, 0);
    // Shallow longitudinal ribs so the liner catches light like the real spray-in
    for (var rz = -2.7; rz <= 2.7; rz += 0.28) {
      box(BL - 0.3, 0.03, 0.16, M.liner, BC, FLOOR_Y + 0.01, rz);
    }
    [-1, 1].forEach(function (s) {
      box(BL, 1.95, 0.22, M.paint, BC, 3.9, s * 3.2);
      box(BL, 0.12, 0.34, M.satin, BC, 4.92, s * 3.2); // rail cap
    });
    box(0.22, 1.95, 6.6, M.paint, BX1 + 0.1, 3.9, 0);
    var TG_HINGE_Y = 2.90;
    var tailgate = new THREE.Group();
    tailgate.position.set(BX0, TG_HINGE_Y, 0);
    tailgate.userData.part = 'tailgate';
    group.add(tailgate);
    box(0.22, 2.05, 6.6, M.paint, 0.12, 3.85 - TG_HINGE_Y, 0, tailgate);
    box(0.06, 0.35, 2.2, M.satin, -0.02, 4.45 - TG_HINGE_Y, 0, tailgate);
    [-1, 1].forEach(function (s) {
      box(0.1, 1.05, 0.42, M.red, -0.02, 4.15 - TG_HINGE_Y, s * 3.05, tailgate);
    });
    var tgHit = box(0.9, 2.2, 6.8, new THREE.MeshBasicMaterial({ visible: false }), 0.15, 3.85 - TG_HINGE_Y, 0, tailgate);
    tgHit.userData.part = 'tailgate';
    box(0.5, 0.75, 6.9, M.satin, BX0 - 0.1, 2.35, 0); // rear bumper stays
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
    // Bed hardware, from photos of the real Ram bed: 4 black 5th-wheel
    // puck holes in a rectangle, a center B&W-style gold/brass gooseneck
    // ball with a blue latch grip, and two gold safety-chain U-loops.
    var BALL_X = -6.9;
    function puckHole(x, z, rOuter, rInner) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(rOuter, rOuter + 0.02, 0.05, 28), M.puck), x, FLOOR_Y + 0.02, z);
      add(new THREE.Mesh(new THREE.CylinderGeometry(rInner, rInner, 0.08, 24), M.hole), x, FLOOR_Y + 0.005, z);
    }
    function chainLoop(x, z) {
      puckHole(x, z, 0.22, 0.14);
      var u = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.032, 10, 18, Math.PI), M.brass);
      u.rotation.z = Math.PI / 2;
      u.rotation.y = Math.PI / 2;
      add(u, x, FLOOR_Y + 0.1, z);
    }
    // Soft overhead fill for the bed only (short range), so the gray liner
    // and brass hardware read like the daylight photos when the gate is open.
    var bedFill = new THREE.PointLight(0xfff6e8, 22, 7.5, 2);
    add(bedFill, BALL_X, FLOOR_Y + 3.4, 0);
    // 5th-wheel pucks: rectangle around the ball (front = toward the cab)
    var PUCK_DX = 1.45, PUCK_DZ = 1.72;
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) {
      puckHole(BALL_X + s[0] * PUCK_DX, s[1] * PUCK_DZ, 0.24, 0.15);
    });
    // Safety-chain U-loops, slightly toward the tailgate, left and right
    chainLoop(BALL_X - 0.85, 1.28);
    chainLoop(BALL_X - 0.85, -1.28);
    // Center gooseneck ball in its puck, latch handle toward the tailgate
    puckHole(BALL_X, 0, 0.30, 0.18);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.125, 0.34, 20), M.brass), BALL_X, FLOOR_Y + 0.22, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20), M.brass), BALL_X, FLOOR_Y + 0.38, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.155, 24, 16), M.brass), BALL_X, FLOOR_Y + 0.52, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8), M.chrome), BALL_X, FLOOR_Y + 0.675, 0);
    var handle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.028, 10, 20, Math.PI * 0.85), M.brass);
    handle.rotation.y = Math.PI / 2;
    handle.rotation.z = Math.PI * 0.12;
    add(handle, BALL_X - 0.18, FLOOR_Y + 0.22, 0.02);
    var grip = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.16, 12), M.grip);
    grip.rotation.z = Math.PI / 2;
    grip.rotation.y = -0.2;
    add(grip, BALL_X - 0.36, FLOOR_Y + 0.18, 0.02);
    var ballLight = new THREE.PointLight(0xffe6a8, 0, 14, 2);
    ballLight.position.set(BALL_X, 4.2, 0);
    group.add(ballLight);

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
    // Storage toolbox under the gooseneck, in the gap ahead of the deck
    // (behind the truck when hooked up), between the drop-leg jacks and the header.
    // Placement and facing stay as they are; the lid is the top (chest-style).
    var TB = { x: -12.35, y: 3.05, z: 0, lx: 1.9, ly: 1.8, lz: 3.7 };
    var bodyMat = M.frame.clone();
    var lidMat = M.diamond.clone();
    lidMat.color.set(0x9a9aa2);
    var toolbox = new THREE.Group();
    toolbox.position.set(TB.x, TB.y, TB.z);
    toolbox.userData.part = 'toolbox';
    group.add(toolbox);
    var tbInvis = new THREE.MeshBasicMaterial({ visible: false });
    // Body: floor, both sides, rear and front walls (black sheet metal). The top is the lid.
    box(TB.lx, 0.08, TB.lz, bodyMat, 0, -TB.ly / 2 + 0.04, 0, toolbox);
    box(TB.lx, TB.ly, 0.08, bodyMat, 0, 0, -TB.lz / 2 + 0.04, toolbox);
    box(TB.lx, TB.ly, 0.08, bodyMat, 0, 0, TB.lz / 2 - 0.04, toolbox);
    box(0.08, TB.ly, TB.lz - 0.08, bodyMat, -TB.lx / 2 + 0.04, 0, 0, toolbox);
    box(0.08, TB.ly, TB.lz - 0.08, bodyMat, TB.lx / 2 - 0.04, 0, 0, toolbox);
    var interior = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.8, metalness: 0.2 });
    box(TB.lx - 0.16, 0.02, TB.lz - 0.16, interior, 0, -TB.ly / 2 + 0.09, 0, toolbox);
    // Contents: rolled straps, chain coils, ratchet binders, winch bar
    function coil(mat, x, z, r, h) {
      var t = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.42, 8, 16), mat);
      t.rotation.x = Math.PI / 2;
      add(t, x, -TB.ly / 2 + 0.18 + h, z, toolbox);
    }
    coil(M.strap, -0.55, -0.45, 0.22, 0.05);
    coil(M.strapOr, -0.15, -0.55, 0.2, 0.05);
    coil(M.strap, 0.28, -0.4, 0.23, 0.05);
    coil(M.strapOr, 0.65, -0.55, 0.18, 0.05);
    coil(M.strap, -0.5, 0.15, 0.2, 0.05);
    coil(M.strapOr, 0.05, 0.2, 0.22, 0.05);
    coil(M.chain, 0.55, 0.15, 0.2, 0.02);
    coil(M.chain, -0.2, 0.55, 0.18, 0.02);
    coil(M.chain, 0.35, 0.55, 0.16, 0.02);
    // ratchet binders (body + two screw stubs)
    function binder(x, z, ry) {
      var g = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.14), M.binder);
      var a = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.28, 8), M.bar);
      a.rotation.z = Math.PI / 2; a.position.x = -0.32;
      var b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.28, 8), M.bar);
      b.rotation.z = Math.PI / 2; b.position.x = 0.32;
      g.add(body, a, b);
      g.position.set(x, -TB.ly / 2 + 0.2, z);
      g.rotation.y = ry || 0;
      toolbox.add(g);
    }
    binder(-0.55, 0.7, 0.3);
    binder(0.15, 0.75, -0.2);
    binder(0.7, 0.55, 0.5);
    // winch bar across the back of the box, visible from above when the lid is open
    var wbar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.2, 8), M.bar);
    wbar.rotation.x = Math.PI / 2;
    add(wbar, -0.55, -TB.ly / 2 + 0.16, 0, toolbox);
    var wcap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.12), M.bar);
    add(wcap, -0.55, -TB.ly / 2 + 0.16, 1.15, toolbox);
    // Lid: top face, black diamond plate, hinged at the front top edge (+x, toward
    // the truck / neck). Latch sits near the rear edge (toward the deck). The lid
    // lifts up so the inside is visible from above.
    var toolboxLid = new THREE.Group();
    toolboxLid.position.set(TB.lx / 2, TB.ly / 2, 0);
    toolboxLid.userData.part = 'toolbox';
    toolbox.add(toolboxLid);
    box(TB.lx, 0.08, TB.lz, lidMat, -TB.lx / 2, 0.04, 0, toolboxLid);
    box(0.4, 0.1, 0.55, M.chrome, -TB.lx + 0.42, 0.15, 0, toolboxLid); // latch near rear (deck) edge
    var tbHit = box(TB.lx + 0.2, 0.55, TB.lz + 0.2, tbInvis, -TB.lx / 2, 0.12, 0, toolboxLid);
    tbHit.userData.part = 'toolbox';
    var tbBodyHit = box(TB.lx, TB.ly, TB.lz, tbInvis, 0, 0, 0, toolbox);
    tbBodyHit.userData.part = 'toolbox';
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
    var res = { group: group, truck: truck, trailer: trailer, tailgate: tailgate, toolbox: toolbox, toolboxLid: toolboxLid, ballLight: ballLight, ballX: BALL_X, tb: TB, rigOffset: -mid, trailerOffset: -(trailerFront + back) / 2, truckOffset: -(front + BX0 - 0.4) / 2 };
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
