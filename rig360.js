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
   - One-finger drag orbits freely (v130: unlimited 360 yaw, tilt from just
     under the truck to straight overhead, polar 5-175 deg) with inertia.
     Pinch zooms; two-finger drag (or right / middle / shift mouse drag) pans.
     Double-tap or double-click resets the view. v130: nothing under the
     stage (photo, reflection) can take the touch: touch-action none, no
     native image drag, pointer capture, touchmove and gesture events
     cancelled. Mouse wheel / trackpad pinch or the +/- buttons zoom
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
   - v135 Night Edition: the truck is rebuilt as our 2026 Ram 3500 Laramie Night
     Edition Mega Cab DRW (6 ft 4 in box) to buyer's-guide proportions; Diamond
     Black clearcoat paint with flake, gloss-black trim, black 17 in wheels, LED
     lamps with glow, soft shadow. 'Hood' opens it (cowl hinge, gas struts) to a
     Cummins 6.7 HO bay. 'Coupler lock' (Trailer view) slides the S5 box off the
     yellow Demco coupler. Toolbox lid now hinges at the rear edge. Spare tire on
     the neck, flat dovetail with MEGA ramps folded on it. 'Specs' shows tap dots
     with compact spec cards (drags that start on a dot still orbit).
     Static meshes are merged per material (fewer draw calls).
   - v137: opens on the full Rig 360 every time; paint reads true Diamond Black
     (envMapIntensity now actually applied); 17 in black DRW wheels with machined
     eyelets like Claudio's photo (WHEEL_IN / NIGHT_BADGE switches); black RAM door
     badge; toolbox lid stops under the neck rails (no clipping); MEGA hold-downs.
   - v142: S5 Coupler Lock rebuilt to Claudio's photos: 6 x 5 x 8 in gloss-black
     box with rounded welds, open top and slotted latch plate, C-shaped 3.5 in
     boss with stacked hasp tabs, chrome TRIMAX THP XL puck (hidden when the box
     is off), brushed 'S5 Coupler Locks' label, two drain holes. Zinc safety
     chains and hairpin; gloss-yellow Demco coupler. No serials.
   - v143: trailer safety chains are cadmium-plated gold-yellow (iridescent
     sheen). S5 boss and puck face the driver's side (left / -z).
   - v144: larger Rig 360 stage (phone ~70vh, desktop ~80vh min 600px).
     ResizeObserver resizes the renderer and camera. Fullscreen / expand
     button (Fullscreen API with a CSS overlay fallback; Esc or the
     button exits). Default framing still fits the truck + 40 ft trailer.
     Landing gear is raised (feet off the ground) when the trailer is
     hitched in Rig 360, and down (pads on the ground) in Trailer view.
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
    Array.prototype.forEach.call(stage.querySelectorAll('img'), function (im) { im.setAttribute('draggable', 'false'); });
    stage.setAttribute('draggable', 'false');
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
    // The view always opens on the full Rig 360 (truck + trailer); the saved choice is not restored.
    setMode('360', false, 'rig');

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
    renderer.toneMappingExposure = 1.12;
    // v135: soft shadow under the rig from one overhead light that turns with
    // the turntable, so the shadow map only re-renders when a part moves.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    var prCap = 2; // pixel-ratio cap; lowered once if frames run slow
    var ftEma = 16.7, ftSlow = 0;

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
    var key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(45, 22, 35);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0xb9a6ff, 0.9);
    rim.position.set(-40, 25, -50);
    scene.add(rim);
    // v130: light from below, faded in as the camera drops under the truck
    var underLight = new THREE.DirectionalLight(0xdcd6ff, 0);
    underLight.position.set(6, -40, 14);
    scene.add(underLight);

    var turntable = new THREE.Group();
    scene.add(turntable);
    var rig = buildRig(THREE);
    turntable.add(rig.group);
    // v137: three r163+ only applies material.envMapIntensity to material.envMap, so
    // give the tuned materials (paint, gloss trim, glass) the studio map explicitly.
    rig.group.traverse(function (o) {
      if (!o.isMesh) return;
      [].concat(o.material).forEach(function (m) { if (m && m.envMapIntensity !== undefined && m.envMapIntensity !== 1 && !m.envMap) { m.envMap = scene.environment; m.needsUpdate = true; } });
    });
    var shadowLight = new THREE.DirectionalLight(0xffffff, 0.35);
    shadowLight.position.set(2, 40, 3);
    shadowLight.target.position.set(0, 0, 0);
    shadowLight.castShadow = true;
    shadowLight.shadow.mapSize.set(2048, 512);
    shadowLight.shadow.camera.left = -36; shadowLight.shadow.camera.right = 36;
    shadowLight.shadow.camera.top = 9; shadowLight.shadow.camera.bottom = -9;
    shadowLight.shadow.camera.near = 20; shadowLight.shadow.camera.far = 60;
    shadowLight.shadow.radius = 6;
    shadowLight.shadow.bias = -0.0008;
    turntable.add(shadowLight, shadowLight.target);
    var catcher = new THREE.Mesh(new THREE.PlaneGeometry(80, 24), new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = 0.012;
    catcher.receiveShadow = true;
    catcher.renderOrder = 0;
    turntable.add(catcher);
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
    var ELEV_MIN = THREE.MathUtils.degToRad(-85), ELEV_MAX = THREE.MathUtils.degToRad(85);
    var ELEV = ELEV0;
    var upAxis = new THREE.Vector3(0, Math.cos(ELEV), -Math.sin(ELEV));
    var held = null; // arrow button being held: { da, de }
    // After a tailgate / toolbox opens, the camera orbits the part in world space.
    var iYaw = 0, iElev = 0, iDist = 18, iPanX = 0, iPanY = 0, iVelY = 0, iVelE = 0;
    var iLook = new THREE.Vector3();
    var I_ELEV_MIN = THREE.MathUtils.degToRad(-85), I_ELEV_MAX = THREE.MathUtils.degToRad(85);

    function applyCamera() {
      ELEV = Math.max(ELEV_MIN, Math.min(ELEV_MAX, ELEV));
      upAxis.set(0, Math.cos(ELEV), -Math.sin(ELEV));
      var maxX = halfLen + 2, maxY = 14;
      panX = Math.max(-maxX, Math.min(maxX, panX));
      panY = Math.max(-maxY, Math.min(maxY, panY));
      var d = baseDist / zoom * (1 + 0.3 * Math.sin(ELEV) * Math.sin(ELEV));
      var below = Math.max(0, Math.min(1, (0.09 - Math.sin(ELEV)) / 0.6));
      underLight.intensity = 5 * below * below;
      var tx = panX + upAxis.x * panY, ty = 4.6 + upAxis.y * panY, tz = upAxis.z * panY;
      camera.position.set(tx, ty - 2.2 + Math.sin(ELEV) * d, tz + Math.cos(ELEV) * d);
      camera.lookAt(tx, ty, tz);
      camera.updateProjectionMatrix();
      stage.toggleAttribute('data-r360-zoomed', zoom > 1.02);
      stage.toggleAttribute('data-r360-adjusted', zoom > 1.02 || Math.abs(ELEV - ELEV0) > 0.01 || Math.abs(panX) > 0.05 || Math.abs(panY) > 0.05 || !!inspectKind);
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
    var TB_OPEN = Math.PI * 0.155; // v137: toolbox lid travel (~28 deg) so it stays under the neck rails and spine
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
      var d = baseDist / zoom * (1 + 0.3 * Math.sin(ELEV) * Math.sin(ELEV));
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
      if (kind === 'hood') {
        // High front-passenger 3/4 looking down into the engine bay.
        return { look: worldAt(6.3, 4.2, 0, ang), cam: worldAt(19.5, 15.5, 12.5, ang), angle: -0.35 };
      }
      if (kind === 'lock') {
        // Tight front-driver 3/4 of the coupler and the S5 box (boss faces -z). As it unlocks,
        // the camera eases down so the empty C-boss, hasp tabs and yellow socket stay in frame.
        var t = inspectKind === 'lock' ? inspectOpen : 0;
        // Locked: tight 3/4 on the box, collar, puck and label. Unlocked: pull back
        // and up so the empty C-boss, hasp, lowered box and yellow socket all fit.
        var L0 = worldAt(rig.ballX + 0.05, 3.7, -0.2, ang), C0 = worldAt(rig.ballX + 2.6, 4.6, -3.1, ang);
        var L1 = worldAt(rig.ballX + 0.1, 2.9, -0.5, ang), C1 = worldAt(rig.ballX + 3.0, 4.0, -2.8, ang);
        return { look: L0.clone().lerp(L1, t), cam: C0.clone().lerp(C1, t), angle: -0.15 };
      }
      var tb = rig.tb;
      // High front-passenger 3/4, well out to the side so the neck is behind
      // the box, looking down onto the lid and into the open chest.
      return { look: worldAt(tb.x + 0.3, tb.y + 0.2, tb.z, ang), cam: worldAt(tb.x + 4.2, tb.y + 5.2, tb.z + 7.6, ang), angle: 0.55 }; // v137: lower, so you see under the ~28 deg lid
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
      if (rig.toolboxLid) rig.toolboxLid.rotation.z = (inspectKind === 'toolbox' ? open : 0) * TB_OPEN; // rear hinge; stops under the neck rails
      if (rig.ballLight) rig.ballLight.intensity = (inspectKind === 'tailgate' ? open : 0) * 2.2;
      setHood(inspectKind === 'hood' ? open : 0);
      setLock(inspectKind === 'lock' ? open : 0);
      renderer.shadowMap.needsUpdate = true;
    }
    var _hp = new THREE.Vector3(), _sd = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
    function setHood(open) {
      var th = open * 1.08; // about 62 deg, front edge up (hinged at the cowl)
      rig.hood.rotation.z = th;
      var c = Math.cos(th), sn = Math.sin(th);
      rig.struts.forEach(function (st) {
        _hp.set(rig.hoodPivot[0] + st.hp.x * c - st.hp.y * sn, rig.hoodPivot[1] + st.hp.x * sn + st.hp.y * c, st.z);
        _sd.copy(_hp).sub(st.a);
        var len = _sd.length();
        st.g.position.copy(st.a);
        st.g.quaternion.setFromUnitVectors(_up, _sd.normalize());
        st.rod.scale.y = len; st.rod.position.y = len / 2;
      });
    }
    function setLock(open) {
      // 0 = locked (S5 box over the coupler, puck in the boss); 1 = box on the ground
      // beside it, puck off, so the empty C-boss and hasp tabs are visible.
      var u = open, dy, dz = 0;
      // Drop just off the coupler (not all the way to the ground) so the empty
      // C-boss, hasp tabs and yellow socket stay in one tight frame.
      var dy1 = -0.55, dy2 = -1.35;
      if (u < 0.4) dy = dy1 * (u / 0.4);
      else { var t = (u - 0.4) / 0.6; dy = dy1 + (dy2 - dy1) * t; dz = -0.62 * t; }
      rig.lock.position.y = rig.lockY0 + dy;
      rig.lock.position.z = dz;
      if (rig.puck) rig.puck.visible = u < 0.12;
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
      stage.toggleAttribute('data-r360-adjusted', zoom > 1.02 || Math.abs(ELEV - ELEV0) > 0.01 || Math.abs(panX) > 0.05 || Math.abs(panY) > 0.05 || !!inspectKind);
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
      if (rig.truck && rig.truck.visible && rig.hood) targets.push(rig.hood);
      if (rig.lock && rig.lock.visible) targets.push(rig.lock);
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, prCap));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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

    var _gw = new THREE.Vector3(), _gn = new THREE.Vector3(), _gc = new THREE.Vector3();
    function render() {
      turntable.rotation.y = angle;
      turntable.updateMatrixWorld();
      // Lamp halos fade out when a lamp faces away from the camera.
      for (var gi = 0; gi < rig.glows.length; gi++) {
        var gl = rig.glows[gi];
        gl.s.getWorldPosition(_gw);
        _gn.copy(gl.n).transformDirection(rig.group.matrixWorld);
        _gc.copy(camera.position).sub(_gw).normalize();
        gl.s.material.opacity = Math.max(0, Math.min(1, (_gn.dot(_gc) - 0.05) * 1.6)) * 0.85;
      }
      renderer.render(scene, camera);
      updateHotspots();
      if (!shown) {
        shown = true;
        stage.setAttribute('data-r360-ready', '1');
      }
    }

    function frame(t) {
      raf = 0;
      var dt = lastFrame ? Math.min(0.05, (t - lastFrame) / 1000) : 0;
      if (lastFrame && t - lastFrame < 200) {
        ftEma = ftEma * 0.95 + (t - lastFrame) * 0.05;
        // Sustained slow frames (under ~42 fps for ~2 s): drop the pixel ratio a step, once per level.
        if (ftEma > 24) { if (++ftSlow > 120 && prCap > 1.25) { prCap = prCap > 1.5 ? 1.5 : 1.25; ftSlow = 0; ftEma = 16.7; w = 0; resize(); } }
        else ftSlow = 0;
      }
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
    var panDrag = false; // mouse right / middle / shift drag pans instead of orbiting
    // v130: the toggle and part buttons cover a big part of the small stage,
    // so a drag that starts on them still orbits (a tap still clicks them).
    var ctlPending = {};
    function down(ev) {
      if (mode !== '360') return;
      if (ev.target.closest && ev.target.closest('.r360-zoom, .r360-pad, .r360-zreset, .r360-fs, .r360-card')) return;
      if (ev.target.closest && ev.target.closest('.r360-toggle, .r360-parts, .r360-hot')) {
        ctlPending[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
        return;
      }
      begin(ev);
    }
    function begin(ev) {
      if (ev.cancelable) ev.preventDefault();
      panDrag = ev.pointerType === 'mouse' && (ev.button === 1 || ev.button === 2 || ev.shiftKey || ev.ctrlKey);
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
        stage._r360dn = 0; lastTap = 0;
        stage.classList.remove('r360-grab');
      } else {
        // v130: a double-tap needs two real taps. A quick second drag near the
        // first must never reset the camera.
        stage._r360dt = ev.pointerType !== 'mouse' && now - lastTap < 320 && Math.hypot(ev.clientX - lastTapX, ev.clientY - lastTapY) < 30;
        stage._r360dn = now;
        dragging = true;
        lastX = ev.clientX; lastY = ev.clientY; lastT = now;
        stage._r360sx = ev.clientX; stage._r360sy = ev.clientY;
        stage.classList.add('r360-grab');
      }
      update();
    }
    function move(ev) {
      var cp = ctlPending[ev.pointerId];
      if (cp && !pts[ev.pointerId]) {
        if (Math.hypot(ev.clientX - cp.x, ev.clientY - cp.y) < 8) return;
        delete ctlPending[ev.pointerId];
        stage._r360noClick = performance.now() + 600;
        ev.cancelable && ev.preventDefault();
        begin({ pointerId: ev.pointerId, pointerType: ev.pointerType, button: ev.button, shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey, clientX: cp.x, clientY: cp.y, target: stage, cancelable: false });
      }
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
      if (ev.cancelable) ev.preventDefault();
      var dx = ev.clientX - lastX;
      var dy = ev.clientY - lastY;
      var dtm = Math.max(1, now - lastT);
      if (panDrag) {
        var fp = feetPerPx();
        if (inspectOrbiting()) { iPanX -= dx * fp; iPanY += dy * fp; applyInspectOrbit(); }
        else { panX -= dx * fp; panY += dy * fp; applyCamera(); }
        lastX = ev.clientX; lastY = ev.clientY; lastT = now; lastInput = now; velocity = 0; elevVel = 0;
        render();
        return;
      }
      var da = dx * (Math.PI * 2) / Math.max(320, w * 1.6) / Math.sqrt(zoom);
      var de = dy * Math.PI / Math.max(300, h * 1.6) / Math.sqrt(zoom); // drag down: camera rises (standard orbit feel)
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
    }
    function up(ev) {
      delete ctlPending[ev.pointerId];
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
      if (tapped && ev.pointerType !== 'mouse' && performance.now() - (stage._r360dn || 0) < 300) {
        if (stage._r360dt) {
          lastTap = 0; velocity = 0; elevVel = 0;
          stage.classList.remove('r360-grab');
          resetZoom();
          return;
        }
        lastTap = performance.now(); lastTapX = ev.clientX; lastTapY = ev.clientY;
      } else lastTap = 0;
      if (tapped && cardHot) {
        closeCard();
        stage.classList.remove('r360-grab');
        update();
        return;
      }
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
    stage.addEventListener('lostpointercapture', function (ev) { if (ev.target === stage && pts[ev.pointerId]) up(ev); });
    // v130: keep every drag inside the 3D view. No native image drag / ghost
    // image, no long-press callout or context menu, no page scroll or iOS
    // page-pinch from a touch that started on the viewer.
    function stopDefault(ev) {
      if (mode !== '360') return;
      if (ev.target.closest && ev.target.closest('.r360-toggle, .r360-zoom, .r360-pad, .r360-zreset, .r360-fs, .r360-parts, .r360-hot, .r360-card')) return;
      if (ev.cancelable) ev.preventDefault();
    }
    ['dragstart', 'selectstart', 'contextmenu', 'gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
      stage.addEventListener(t, stopDefault, { capture: true });
    });
    stage.addEventListener('touchmove', function (ev) { if (mode === '360' && ev.cancelable) ev.preventDefault(); }, { passive: false, capture: true });
    stage.addEventListener('click', function (ev) {
      if (stage._r360noClick && performance.now() < stage._r360noClick) { ev.preventDefault(); ev.stopPropagation(); stage._r360noClick = 0; }
    }, true);
    stage.addEventListener('touchstart', function (ev) { if (ev.touches && ev.touches.length > 1) stopDefault(ev); }, { passive: false, capture: true });
    stage.addEventListener('dblclick', function (ev) {
      if (mode !== '360' || (ev.target.closest && ev.target.closest('.r360-toggle, .r360-zoom, .r360-pad, .r360-zreset, .r360-fs, .r360-parts, .r360-hot, .r360-card'))) return;
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
      '<button type="button" data-part="tailgate" aria-pressed="false">Tailgate</button>' +
      '<button type="button" data-part="toolbox" aria-pressed="false">Toolbox</button>' +
      '<button type="button" data-part="hood" aria-pressed="false" aria-label="Open the hood">Hood</button>' +
      '<button type="button" data-part="lock" aria-pressed="false" aria-label="Coupler lock: take the S5 box off or put it back">Coupler lock</button>' +
      '<button type="button" data-specs aria-pressed="false" aria-label="Show spec dots">Specs</button>';
    stage.appendChild(partsBar);
    partsBar.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-part]');
      if (b) { closeCard(); toggleInspect(b.getAttribute('data-part')); return; }
      if (ev.target.closest('button[data-specs]')) setSpecs(!specsOn, true);
    });
    function updatePartButtons() {
      var truckOn = !(subject === 'trailer');
      var trailOn = !(subject === 'truck');
      var map = { tailgate: truckOn, toolbox: trailOn, hood: truckOn, lock: subject === 'trailer' };
      var btns = partsBar.querySelectorAll('button[data-part]');
      for (var i = 0; i < btns.length; i++) {
        var kind = btns[i].getAttribute('data-part');
        var on = !!map[kind];
        btns[i].hidden = !on;
        var open = inspectKind === kind && inspectOpen > 0.5;
        btns[i].setAttribute('aria-pressed', open ? 'true' : 'false');
        if (kind === 'lock') btns[i].textContent = open ? 'Lock coupler' : 'Coupler lock';
      }
      var sb = partsBar.querySelector('button[data-specs]');
      if (sb) sb.setAttribute('aria-pressed', specsOn ? 'true' : 'false');
    }

    /* v135 spec hotspots: small dots on the rig that open a compact card.
       A drag that starts on a dot still orbits; tap a dot to open, tap
       anywhere else or X to close. 'Specs' shows or hides the dots. */
    var SPECS_KEY = 'blackram_rig_specs';
    var specsOn = true;
    try { specsOn = localStorage.getItem(SPECS_KEY) !== '0'; } catch (e) { specsOn = true; }
    var hotLayer = document.createElement('div');
    hotLayer.className = 'r360-hots';
    stage.appendChild(hotLayer);
    var hots = rig.hotspots.map(function (h) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'r360-hot';
      b.setAttribute('data-hot', h.id);
      b.setAttribute('aria-label', 'Specs: ' + h.t);
      hotLayer.appendChild(b);
      return { h: h, el: b, p: new THREE.Vector3(h.p[0], h.p[1], h.p[2]), n: h.n ? new THREE.Vector3(h.n[0], h.n[1], h.n[2]) : null, x: 0, y: 0, on: false };
    });
    var card = document.createElement('div');
    card.className = 'r360-card';
    card.setAttribute('role', 'dialog');
    card.hidden = true;
    stage.appendChild(card);
    var cardHot = null;
    function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function openCard(id) {
      var hs = null;
      hots.forEach(function (x) { if (x.h.id === id) hs = x; });
      if (!hs) return;
      cardHot = hs;
      card.innerHTML = '<button type="button" class="r360-card-x" aria-label="Close">X</button>' +
        '<div class="r360-card-t">' + esc(hs.h.t) + '</div><ul>' +
        hs.h.l.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
      card.setAttribute('aria-label', hs.h.t);
      card.hidden = false;
      hots.forEach(function (x) { x.el.classList.toggle('is-open', x === hs); });
      placeCard();
    }
    function closeCard() {
      if (!cardHot) return;
      cardHot = null;
      card.hidden = true;
      hots.forEach(function (x) { x.el.classList.remove('is-open'); });
    }
    card.addEventListener('click', function (ev) { if (ev.target.closest('.r360-card-x')) closeCard(); });
    hotLayer.addEventListener('click', function (ev) {
      var b = ev.target.closest('.r360-hot');
      if (!b) return;
      var id = b.getAttribute('data-hot');
      if (cardHot && cardHot.h.id === id) closeCard(); else openCard(id);
    });
    function setSpecs(on, save) {
      specsOn = !!on;
      stage.toggleAttribute('data-r360-specs', specsOn);
      if (!specsOn) closeCard();
      if (save) { try { localStorage.setItem(SPECS_KEY, specsOn ? '1' : '0'); } catch (e) { /* ignore */ } }
      updatePartButtons();
      updateHotspots();
    }
    function hotVisible(h) {
      return h.subj.split(' ').indexOf(subject) >= 0;
    }
    var _hv = new THREE.Vector3(), _hn = new THREE.Vector3(), _cd = new THREE.Vector3();
    function updateHotspots() {
      if (!w || !h) return;
      rig.group.updateMatrixWorld();
      for (var i = 0; i < hots.length; i++) {
        var o = hots[i];
        var vis = specsOn && mode === '360' && hotVisible(o.h);
        if (vis) {
          _hv.copy(o.p); rig.group.localToWorld(_hv);
          if (o.n) {
            _hn.copy(o.n).transformDirection(rig.group.matrixWorld);
            _cd.copy(camera.position).sub(_hv).normalize();
            if (_hn.dot(_cd) < 0.08) vis = false;
          }
          _hv.project(camera);
          if (_hv.z > 1 || _hv.x < -1.05 || _hv.x > 1.05 || _hv.y < -1.05 || _hv.y > 1.05) vis = false;
          o.x = (_hv.x * 0.5 + 0.5) * w;
          o.y = (-_hv.y * 0.5 + 0.5) * h;
        }
        if (vis) o.el.style.transform = 'translate(' + o.x.toFixed(1) + 'px,' + o.y.toFixed(1) + 'px)';
        if (vis !== o.on) { o.on = vis; o.el.classList.toggle('is-on', vis); }
      }
      if (cardHot) {
        if (!cardHot.on) closeCard(); else placeCard();
      }
    }
    function placeCard() {
      if (!cardHot) return;
      var cw = card.offsetWidth, ch = card.offsetHeight;
      var x = cardHot.x + 14, y = cardHot.y - ch / 2;
      if (x + cw > w - 6) x = cardHot.x - cw - 14;
      x = Math.max(6, Math.min(w - cw - 6, x));
      y = Math.max(6, Math.min(h - ch - 6, y));
      card.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
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
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(function () { w = 0; resize(); }).observe(canvasWrap);
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () { w = 0; resize(); });
    }

    // v144 fullscreen: Fullscreen API, CSS overlay fallback, Esc / button to exit.
    var cssFs = false;
    var fsBtn = document.createElement('button');
    fsBtn.type = 'button';
    fsBtn.className = 'r360-fs';
    fsBtn.setAttribute('aria-pressed', 'false');
    fsBtn.setAttribute('aria-label', 'Full screen');
    fsBtn.innerHTML =
      '<svg class="r360-fs-enter" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm12 0h-2v3h-3v2h5v-5zM7 7h3V5H5v5h2V7zm7-2v2h3v3h2V5h-5z"/></svg>' +
      '<svg class="r360-fs-exit" viewBox="0 0 24 24" aria-hidden="true" hidden><path fill="currentColor" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>' +
      '<span class="r360-fs-label" hidden>Exit</span>';
    stage.appendChild(fsBtn);
    function fsNativeEl() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }
    function isFs() {
      return cssFs || fsNativeEl() === stage;
    }
    function applyFsClass() {
      var on = isFs();
      stage.classList.toggle('is-fs', on);
      document.documentElement.classList.toggle('r360-fs-on', on);
      fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      fsBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      var enterI = fsBtn.querySelector('.r360-fs-enter');
      var exitI = fsBtn.querySelector('.r360-fs-exit');
      var lab = fsBtn.querySelector('.r360-fs-label');
      if (enterI) enterI.hidden = on;
      if (exitI) exitI.hidden = !on;
      if (lab) lab.hidden = !on;
      w = 0;
      update();
    }
    function enterFsCss() {
      cssFs = true;
      applyFsClass();
    }
    function exitFsCss() {
      if (!cssFs) return;
      cssFs = false;
      applyFsClass();
    }
    function enterFs() {
      if (isFs()) return;
      var req = stage.requestFullscreen || stage.webkitRequestFullscreen;
      if (typeof req === 'function') {
        try {
          var p = req.call(stage);
          if (p && typeof p.then === 'function') {
            p.catch(function () { enterFsCss(); });
            return;
          }
          return;
        } catch (e) {
          enterFsCss();
          return;
        }
      }
      enterFsCss();
    }
    function exitFs() {
      var el = fsNativeEl();
      if (el) {
        var ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (typeof ex === 'function') {
          try {
            var p = ex.call(document);
            if (p && p.catch) p.catch(function () {});
          } catch (e) { /* ignore */ }
        }
      }
      exitFsCss();
    }
    function toggleFs() {
      if (isFs()) exitFs(); else enterFs();
    }
    fsBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      toggleFs();
    });
    function onFsChange() {
      if (fsNativeEl() === stage) {
        cssFs = false;
        applyFsClass();
      } else if (!cssFs) {
        applyFsClass();
      }
    }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Escape' || ev.key === 'Esc') && isFs()) {
        ev.preventDefault();
        exitFs();
      }
    });

    applyPartPose(0);
    setSpecs(specsOn, false);
    function perf(n) {
      // Average CPU time of n synchronous renders (ms) + draw calls / triangles.
      n = n || 60;
      var t0 = performance.now();
      for (var i = 0; i < n; i++) { angle += 0.01; render(); }
      var gl = renderer.getContext(); var px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      var ms = (performance.now() - t0) / n;
      return { ms: Math.round(ms * 100) / 100, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, pixelRatio: renderer.getPixelRatio(), w: w, h: h, prCap: prCap, ftEma: Math.round(ftEma * 10) / 10 };
    }
    var api = {
      perf: perf,
      toggleHood: function () { toggleInspect('hood'); },
      toggleLock: function () { toggleInspect('lock'); },
      specs: function (on) { setSpecs(on, false); },
      openSpec: function (id) { openCard(id); },
      closeSpec: function () { closeCard(); },
      hotspots: function () { return hots.filter(function (o) { return o.on; }).map(function (o) { return { id: o.h.id, x: Math.round(o.x), y: Math.round(o.y) }; }); },
      update: update,
      setSubject: function (sub) {
        var t = sub === 'trailer', k = sub === 'truck';
        rig.truck.visible = !t;
        rig.trailer.visible = !k;
        rig.group.position.x = t ? rig.trailerOffset : k ? rig.truckOffset : rig.rigOffset;
        // Hitched (Rig): chains and breakaway to the truck. Parked (Trailer): chains
        // hang, cable coiled, S5 lock on the coupler.
        rig.hitchedOnly.forEach(function (o) { o.visible = !t; });
        rig.parkedOnly.forEach(function (o) { o.visible = t; });
        if (rig.jackLegs) {
          var jy = t ? rig.jackYDown : rig.jackYUp;
          rig.jackLegs.forEach(function (d) { d.position.y = jy; });
        }
        if (typeof closeCard === 'function') closeCard();
        renderer.shadowMap.needsUpdate = true;
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
      jackInfo: function () {
        var d = rig.jackLegs && rig.jackLegs[0];
        if (!d) return null;
        return { footY: d.position.y, yDown: rig.jackYDown, yUp: rig.jackYUp, x: d.parent.position.x, z: d.parent.position.z, groupX: rig.group.position.x };
      },
      setView: function (opts) {
        opts = opts || {};
        if (opts.angle != null) angle = opts.angle;
        if (opts.zoom != null) zoom = Math.max(1, Math.min(ZOOM_MAX, opts.zoom));
        if (opts.panX != null) panX = opts.panX;
        if (opts.panY != null) panY = opts.panY;
        if (opts.elev != null) ELEV = THREE.MathUtils.degToRad(opts.elev);
        lastInput = performance.now();
        if (shown) { applyCamera(); render(); }
        update();
      },
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
    var room = new THREE.Mesh(new THREE.BoxGeometry(60, 40, 60), new THREE.MeshBasicMaterial({ color: 0x24222d, side: THREE.BackSide }));
    room.position.y = 7;
    env.add(room);
    function panel(w, h, x, y, z, ry, rx, intensity, color) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color || 0xffffff).multiplyScalar(intensity), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0);
      env.add(m);
    }
    panel(40, 3.5, 0, 24, 6, 0, Math.PI / 2, 1.4);        // overhead strip
    panel(40, 2.0, 0, 24, -8, 0, Math.PI / 2, 0.9);
    panel(16, 9, 26, 13, 10, -Math.PI / 2, 0, 3.2);      // key softbox
    panel(16, 9, -26, 12, -8, Math.PI / 2, 0, 2.0, 0xc8b8ff);
    panel(30, 4, 0, 16, -28, 0, 0, 1.0);
    panel(30, 5, 0, 16, 28, Math.PI, 0, 1.5);
    // Horizon band: gives the black paint a soft grey reflection line on its sides.
    var band = new THREE.Mesh(new THREE.CylinderGeometry(28, 28, 10, 40, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8a86a0).multiplyScalar(0.8), side: THREE.BackSide }));
    band.position.y = -3;
    env.add(band);
    var line = new THREE.Mesh(new THREE.CylinderGeometry(27.5, 27.5, 0.8, 40, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.6), side: THREE.BackSide }));
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

  /* v135 textures: paint flake, tire tread, wheel faces, badges, engine cover, glow */
  function flakeTex(THREE) {
    // Fine metallic flake for Diamond Black: a tangent-space normal map of
    // random tilted specks (averages out at distance, sparkles up close).
    var t = canvasTex(THREE, 256, 256, function (g, w, h) {
      g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, w, h);
      var rnd = seeded(31);
      for (var i = 0; i < 5200; i++) {
        var x = rnd() * w, y = rnd() * h;
        var nx = Math.round(128 + (rnd() - 0.5) * 150), ny = Math.round(128 + (rnd() - 0.5) * 150);
        g.fillStyle = 'rgb(' + nx + ',' + ny + ',235)';
        g.fillRect(x, y, 1.6, 1.6);
      }
    }, false);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    return t;
  }

  function treadTex(THREE) {
    // Bump map: u runs around the tire, v across the profile. Tread blocks
    // only in the middle band (the crown); shoulders and sidewalls stay smooth.
    var t = canvasTex(THREE, 1024, 128, function (g, w, h) {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      var y0 = h * 0.40, y1 = h * 0.60, mid = (y0 + y1) / 2;
      g.fillStyle = '#222';
      // 3 circumferential grooves
      [0.43, 0.5, 0.57].forEach(function (f) { g.fillRect(0, h * f - 1.5, w, 3); });
      // lateral sipes / block edges, staggered
      for (var x = 0; x < w; x += 16) {
        g.fillRect(x, y0, 3, mid - y0 - 2);
        g.fillRect(x + 8, mid + 2, 3, y1 - mid - 2);
      }
    }, false);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(3, 1);
    return t;
  }

  function wheelFaceTex(THREE, kind) {
    // 'night': 17 in black-painted aluminum DRW wheel with machined eyelets (Night Edition WFQ).
    // 'steel': black steel trailer wheel with round holes.
    return canvasTex(THREE, 256, 256, function (g, w, h) {
      var c = w / 2;
      g.clearRect(0, 0, w, h);
      g.fillStyle = kind === 'steel' ? '#151518' : '#0b0b0e';
      g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fill();
      if (kind === 'steel') {
        g.strokeStyle = '#26262b'; g.lineWidth = 6;
        g.beginPath(); g.arc(c, c, c * 0.78, 0, Math.PI * 2); g.stroke();
        for (var i = 0; i < 8; i++) {
          var a = i / 8 * Math.PI * 2;
          g.fillStyle = '#020203';
          g.beginPath(); g.arc(c + Math.cos(a) * c * 0.6, c + Math.sin(a) * c * 0.6, c * 0.1, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = '#1e1e22'; g.beginPath(); g.arc(c, c, c * 0.32, 0, Math.PI * 2); g.fill();
        return;
      }
      // v137: matches Claudio's truck photo: gloss-black face, 10 round windows
      // with bright machined eyelet rims, black hub ring with 8 lugs.
      var grd = g.createRadialGradient(c * 0.8, c * 0.7, c * 0.1, c, c, c);
      grd.addColorStop(0, '#1c1c22'); grd.addColorStop(1, '#060608');
      g.fillStyle = grd; g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2c2c33'; g.lineWidth = 6;
      g.beginPath(); g.arc(c, c, c - 6, 0, Math.PI * 2); g.stroke();
      for (var k = 0; k < 10; k++) {
        var a0 = k / 10 * Math.PI * 2;
        var hx = c + Math.cos(a0) * c * 0.72, hy = c + Math.sin(a0) * c * 0.72;
        g.fillStyle = '#d4d7de'; g.beginPath(); g.arc(hx, hy, c * 0.15, 0, Math.PI * 2); g.fill(); // machined eyelet
        g.fillStyle = '#000'; g.beginPath(); g.arc(hx + 2, hy + 1, c * 0.118, 0, Math.PI * 2); g.fill(); // window
      }
      g.fillStyle = '#0a0a0c'; g.beginPath(); g.arc(c, c, c * 0.5, 0, Math.PI * 2); g.fill();
      for (var j = 0; j < 8; j++) {
        var b = j / 8 * Math.PI * 2 + Math.PI / 8;
        g.fillStyle = '#34343b';
        g.beginPath(); g.arc(c + Math.cos(b) * c * 0.34, c + Math.sin(b) * c * 0.34, c * 0.05, 0, Math.PI * 2); g.fill();
      }
    });
  }

  function textTex(THREE, text, opts) {
    opts = opts || {};
    var W = opts.w || 512, H = opts.h || 128;
    return canvasTex(THREE, W, H, function (g, w, h) {
      g.clearRect(0, 0, w, h);
      g.font = (opts.font || '900 ' + Math.round(h * 0.78) + 'px "Arial Black", Arial, sans-serif');
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (opts.spread) { g.save(); g.translate(w / 2, h / 2 + 2); g.scale(opts.spread, 1); }
      else { g.save(); g.translate(w / 2, h / 2 + 2); }
      if (opts.stroke) { g.lineWidth = opts.stroke; g.strokeStyle = opts.strokeColor || '#000'; g.strokeText(text, 0, 0); }
      g.fillStyle = opts.color || '#fff';
      g.fillText(text, 0, 0);
      g.restore();
    });
  }

  function cumminsTex(THREE) {
    // Engine top cover: black with the red CUMMINS script-style block letters.
    return canvasTex(THREE, 1024, 256, function (g, w, h) {
      g.fillStyle = '#121214'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1b1b1f';
      for (var x = 20; x < w; x += 40) g.fillRect(x, 0, 6, h);
      g.fillStyle = '#c4161c';
      g.fillRect(0, 22, w, 10); g.fillRect(0, h - 32, w, 10);
      g.font = 'italic 900 118px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 10; g.strokeStyle = '#000'; g.strokeText('CUMMINS', w / 2, h / 2 - 8);
      g.fillStyle = '#d7191f'; g.fillText('CUMMINS', w / 2, h / 2 - 8);
      g.font = '700 30px Arial, sans-serif'; g.fillStyle = '#e8e8ea';
      g.fillText('6.7L TURBO DIESEL  HIGH OUTPUT', w / 2, h / 2 + 64);
    });
  }

  function honeycombTex(THREE) {
    var t = canvasTex(THREE, 256, 128, function (g, w, h) {
      g.fillStyle = '#030304'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#1d1d22'; g.lineWidth = 2;
      for (var y = 0; y < h + 12; y += 12) for (var x = (y / 12) % 2 ? 7 : 0; x < w + 14; x += 14) {
        g.beginPath();
        for (var k = 0; k < 6; k++) { var a = k / 6 * Math.PI * 2; g.lineTo(x + Math.cos(a) * 6, y + Math.sin(a) * 6); }
        g.closePath(); g.stroke();
      }
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    return t;
  }

  function glowTex(THREE) {
    return canvasTex(THREE, 128, 128, function (g, w, h) {
      var r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.18, 'rgba(255,255,255,0.55)');
      r.addColorStop(0.5, 'rgba(255,255,255,0.12)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });
  }

  function mergeStatic(THREE, root) {
    // v135: bake every static mesh that shares a material into one mesh, so the
    // rig is ~40 draw calls instead of ~700. Moving parts (userData.part / dyn),
    // multi-material, transparent and invisible hit meshes stay as they are.
    root.updateMatrixWorld(true);
    var inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    var buckets = {}, order = [], remove = [];
    root.traverse(function (o) {
      if (!o.isMesh || o.isInstancedMesh) return;
      for (var p = o; p && p !== root; p = p.parent) if (p.userData && (p.userData.part || p.userData.dyn)) return;
      var mat = o.material;
      if (Array.isArray(mat) || mat.transparent || mat.visible === false) return;
      var src = o.geometry;
      if (!src.attributes.normal || !src.attributes.uv) return;
      var g = src.index ? src.toNonIndexed() : src.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!buckets[mat.uuid]) { buckets[mat.uuid] = { mat: mat, geos: [] }; order.push(mat.uuid); }
      buckets[mat.uuid].geos.push(g);
      remove.push(o);
    });
    remove.forEach(function (o) { o.parent.remove(o); });
    order.forEach(function (k) {
      var b = buckets[k], n = 0;
      b.geos.forEach(function (g) { n += g.attributes.position.count; });
      var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), o3 = 0, o2 = 0;
      b.geos.forEach(function (g) {
        pos.set(g.attributes.position.array, o3);
        nor.set(g.attributes.normal.array, o3);
        uv.set(g.attributes.uv.array, o2);
        o3 += g.attributes.position.count * 3; o2 += g.attributes.position.count * 2;
        g.dispose();
      });
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      root.add(new THREE.Mesh(geo, b.mat));
    });
  }

  /* ----------------------------- model ------------------------------ */
  function buildRig(THREE) {
    var group = new THREE.Group();
    var flake = flakeTex(THREE);
    var M = {
      // Diamond Black Crystal Pearl: near-black base, metallic flake, deep clearcoat.
      paint: new THREE.MeshPhysicalMaterial({ color: 0x010102, metalness: 0.2, roughness: 0.5, specularIntensity: 0.15, normalMap: flake, normalScale: new THREE.Vector2(0.18, 0.18), clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.4 }),
      gloss: new THREE.MeshPhysicalMaterial({ color: 0x040405, metalness: 0.15, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.2 }),
      bchrome: new THREE.MeshStandardMaterial({ color: 0x2a2b31, metalness: 1, roughness: 0.16 }),
      satin: new THREE.MeshStandardMaterial({ color: 0x0f0f12, metalness: 0.2, roughness: 0.62 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x000000, metalness: 0, roughness: 0.04, clearcoat: 0.6, clearcoatRoughness: 0.02, envMapIntensity: 0.45 }),
      mirror: new THREE.MeshStandardMaterial({ color: 0x8b8f99, metalness: 1, roughness: 0.04 }),
      tire: new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.6, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.32, bumpMap: treadTex(THREE), bumpScale: 1.4 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x0c0c0f, metalness: 0.7, roughness: 0.3 }),
      face: new THREE.MeshStandardMaterial({ map: wheelFaceTex(THREE, 'night'), metalness: 0.75, roughness: 0.28, transparent: false, alphaTest: 0.5 }),
      steelFace: new THREE.MeshStandardMaterial({ map: wheelFaceTex(THREE, 'steel'), metalness: 0.5, roughness: 0.45, alphaTest: 0.5 }),
      hub: new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0.3, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x101012, metalness: 0.4, roughness: 0.5 }),
      under: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.2, roughness: 0.8, side: THREE.DoubleSide }),
      wood: new THREE.MeshStandardMaterial({ map: woodTex(THREE), roughness: 0.85, metalness: 0 }),
      diamond: new THREE.MeshStandardMaterial({ map: diamondTex(THREE), metalness: 0.6, roughness: 0.45 }),
      tape: new THREE.MeshStandardMaterial({ map: dotTapeTex(THREE), roughness: 0.4, emissive: 0x220000, emissiveIntensity: 0.4 }),
      head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf2ff, emissiveIntensity: 2.4 }),
      proj: new THREE.MeshPhysicalMaterial({ color: 0x9fb4d8, emissive: 0xcfe0ff, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.05, clearcoat: 1 }),
      fog: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 1.4 }),
      amber: new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff9a00, emissiveIntensity: 1.8 }),
      red: new THREE.MeshStandardMaterial({ color: 0x9a0f14, emissive: 0xff1a22, emissiveIntensity: 1.6 }),
      tail: new THREE.MeshPhysicalMaterial({ color: 0x1a0204, emissive: 0x6a0408, emissiveIntensity: 0.9, metalness: 0.1, roughness: 0.06, clearcoat: 1 }),
      reverse: new THREE.MeshPhysicalMaterial({ color: 0x15161a, emissive: 0x30323a, emissiveIntensity: 0.5, roughness: 0.05, clearcoat: 1 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xcfd2d8, metalness: 1, roughness: 0.12 }),
      alum: new THREE.MeshStandardMaterial({ color: 0xa9adb5, metalness: 0.9, roughness: 0.35 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x3a3330, metalness: 0.6, roughness: 0.65 }),
      block: new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.5, roughness: 0.5 }),
      cummins: new THREE.MeshStandardMaterial({ map: cumminsTex(THREE), metalness: 0.3, roughness: 0.45 }),
      hose: new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.75, metalness: 0 }),
      plastic: new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.7, metalness: 0 }),
      tank: new THREE.MeshPhysicalMaterial({ color: 0xd9d4c4, roughness: 0.45, metalness: 0, transmission: 0, clearcoat: 0.3 }),
      coolant: new THREE.MeshStandardMaterial({ color: 0xf2c400, roughness: 0.4, emissive: 0x3a2a00, emissiveIntensity: 0.3 }),
      washer: new THREE.MeshStandardMaterial({ color: 0x2a6bd8, roughness: 0.4 }),
      batt: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.1 }),
      plus: new THREE.MeshStandardMaterial({ color: 0xc8141a, roughness: 0.5 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xf2c400, roughness: 0.5 }),
      demco: new THREE.MeshPhysicalMaterial({ color: 0xf5c400, metalness: 0.08, roughness: 0.22, clearcoat: 0.85, clearcoatRoughness: 0.12 }),
      zinc: new THREE.MeshStandardMaterial({ color: 0xc5c8ce, metalness: 0.92, roughness: 0.38 }),
      // Safety-chain cadmium plating: warm gold-yellow metal with a slight iridescent sheen
      cadmium: new THREE.MeshPhysicalMaterial({ color: 0xe8c243, metalness: 1, roughness: 0.22, clearcoat: 0.28, clearcoatRoughness: 0.18, iridescence: 0.4, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 380] }),
      steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.85, roughness: 0.32 }),
      gold: new THREE.MeshPhysicalMaterial({ color: 0xf0c53a, metalness: 1, roughness: 0.12, clearcoat: 0.7, clearcoatRoughness: 0.1, emissive: 0x5a3a00, emissiveIntensity: 0.45 }),
      brass: new THREE.MeshPhysicalMaterial({ color: 0xdcbc5a, metalness: 0.7, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2, emissive: 0x7a5a14, emissiveIntensity: 0.55 }),
      puck: new THREE.MeshStandardMaterial({ color: 0x161618, metalness: 0.15, roughness: 0.72 }),
      hole: new THREE.MeshStandardMaterial({ color: 0x050506, metalness: 0.4, roughness: 0.85 }),
      liner: new THREE.MeshStandardMaterial({ map: linerTex(THREE), color: 0xc2c6cb, roughness: 0.9, metalness: 0.03 }),
      grip: new THREE.MeshStandardMaterial({ color: 0x1560d8, roughness: 0.55, metalness: 0.05 }),
      plate: new THREE.MeshStandardMaterial({ color: 0x16161a, metalness: 0.75, roughness: 0.38 }),
      strap: new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.7, metalness: 0.05 }),
      strapOr: new THREE.MeshStandardMaterial({ color: 0xc45a12, roughness: 0.7, metalness: 0.05 }),
      chain: new THREE.MeshStandardMaterial({ color: 0xc9a235, metalness: 0.9, roughness: 0.3 }),
      bar: new THREE.MeshStandardMaterial({ color: 0x7a7a82, metalness: 0.85, roughness: 0.28 }),
      binder: new THREE.MeshStandardMaterial({ color: 0x8a1518, metalness: 0.4, roughness: 0.45 }),
      redGrip: new THREE.MeshStandardMaterial({ color: 0xc8141a, roughness: 0.5, metalness: 0.1 }),
      mesh: new THREE.MeshStandardMaterial({ map: honeycombTex(THREE), metalness: 0.4, roughness: 0.5 }),
      logo: new THREE.MeshBasicMaterial({ map: logoTex(THREE), transparent: true, depthWrite: false })
    };
    function badgeMat(text, opts) {
      return new THREE.MeshStandardMaterial({ map: textTex(THREE, text, opts), color: 0xffffff, metalness: 0.95, roughness: 0.18, alphaTest: 0.45, transparent: false, side: THREE.DoubleSide });
    }

    function add(mesh, x, y, z, parent) { mesh.position.set(x || 0, y || 0, z || 0); (parent || group).add(mesh); return mesh; }
    function box(lx, ly, lz, mat, x, y, z, parent) { return add(new THREE.Mesh(new THREE.BoxGeometry(lx, ly, lz), mat), x, y, z, parent); }
    function cyl(r0, r1, len, seg, mat, axis, x, y, z, parent) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len, seg || 16), mat);
      if (axis === 'x') m.rotation.z = Math.PI / 2;
      else if (axis === 'z') m.rotation.x = Math.PI / 2;
      return add(m, x, y, z, parent);
    }
    function tube(points, r, mat, parent, seg) {
      var curve = new THREE.CatmullRomCurve3(points.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }));
      return add(new THREE.Mesh(new THREE.TubeGeometry(curve, seg || 24, r, 8, false), mat), 0, 0, 0, parent);
    }
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
    function path(pts) {
      var p = new THREE.Path();
      p.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
      p.closePath();
      return p;
    }
    // Lathe tire: rounded shoulders and a bulged sidewall (tread band carries the bump map).
    var tireGeoCache = {};
    function wheel(x, y, z, r, width, outward, kind) {
      var truckW = kind === 'front' || kind === 'rearOuter' || kind === 'rearInner';
      // Rim radius from the wheel size in inches (+ ~0.6 in for the lip/bead).
      var rr = Math.min(r - 0.3, ((truckW ? WHEEL_IN : 16) + 1.2) / 24);
      var k = r + '_' + width + '_' + rr.toFixed(3);
      if (!tireGeoCache[k]) {
        var hw = width / 2, pts = [
          [rr, -hw * 0.84], [rr + 0.05, -hw], [(rr + r) / 2, -hw * 1.06], [r - 0.07, -hw * 0.96], [r, -hw * 0.74],
          [r, hw * 0.74], [r - 0.07, hw * 0.96], [(rr + r) / 2, hw * 1.06], [rr + 0.05, hw], [rr, hw * 0.84]
        ].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
        tireGeoCache[k] = {
          tire: new THREE.LatheGeometry(pts, 40),
          barrel: new THREE.CylinderGeometry(rr, rr, width * 0.86, 28, 1, true),
          face: new THREE.CircleGeometry(rr * 1.01, 32),
          ext: new THREE.CylinderGeometry(r * 0.2, r * 0.33, 0.5, 20),
          cover: new THREE.CylinderGeometry(r * 0.3, r * 0.34, 0.2, 24),
          cap: new THREE.CylinderGeometry(r * 0.12, r * 0.12, 0.05, 16)
        };
      }
      var G = tireGeoCache[k];
      var steel = kind === 'trailer' || kind === 'trailerInner';
      var inner = kind === 'rearInner' || kind === 'trailerInner';
      var w = new THREE.Group();
      var t = new THREE.Mesh(G.tire, M.tire); t.rotation.x = Math.PI / 2; w.add(t);
      var bar = new THREE.Mesh(G.barrel, M.rim); bar.rotation.x = Math.PI / 2; w.add(bar);
      var faceOff = inner ? -width * 0.32 : kind === 'front' ? width * 0.3 : width * 0.18;
      var f = new THREE.Mesh(G.face, steel ? M.steelFace : M.face);
      f.position.z = outward * faceOff;
      if (outward < 0) f.rotation.y = Math.PI;
      w.add(f);
      if (kind === 'front') {
        // DRW front hub extension (gloss black cone) with a center cap
        var e = new THREE.Mesh(G.ext, M.hub); e.rotation.x = outward * Math.PI / 2;
        e.position.z = outward * (faceOff + 0.23); w.add(e);
      } else if (kind === 'rearOuter') {
        var c = new THREE.Mesh(G.cover, M.hub); c.rotation.x = Math.PI / 2;
        c.position.z = outward * (faceOff + 0.1); w.add(c);
        var cp = new THREE.Mesh(G.cap, M.bchrome); cp.rotation.x = Math.PI / 2;
        cp.position.z = outward * (faceOff + 0.21); w.add(cp);
      } else if (kind === 'trailer') {
        var hc = new THREE.Mesh(G.cap, M.chrome); hc.scale.set(1.4, 2, 1.4); hc.rotation.x = Math.PI / 2;
        hc.position.z = outward * (faceOff + 0.06); w.add(hc);
      }
      w.position.set(x, y, z);
      group.add(w);
      return w;
    }

    /* ---- v135: 2026 Ram 3500 Laramie Night Edition, Mega Cab 4x4, 6 ft 4 in box, DRW ----
       Proportions from the 2026 Ram HD buyer's guide (Mega Cab 6'4" DRW): 160.4 in
       wheelbase, 250.0 in long, 96.5 in wide, 78.9 in high, 76.3 in box floor,
       66.4 in box wall to wall, 20.1 in box depth, 67.7 in front / 75.9 in rear track,
       LT235/80R17 E tires (31.8 in). Night Edition: Sport Performance Hood,
       body-color grille surround and bumpers, gloss-black billet grille insert,
       black badges, black mirrors, black headlamp and taillamp bezels, 17 in
       black-painted wheels with machined eyelets (DRW). */
    /* v137 truck config. Claudio confirmed Mega Cab with the 6 ft 4 in box (matches the
       app data); the cab/bed constants below (CAB_F/CAB_R, BX0/BX1) are that layout.
       WHEEL_IN: Ram builds the 3500 DRW Night Edition with 17 in black-painted wheels
       with machined eyelets (WFQ); the 20 in black wheel (WF3) is SRW only, and
       Claudio's truck photo shows the 17s. Set 20 here to preview 20s.
       NIGHT_BADGE: Ram HD Night Edition has blacked-out badges and no NIGHT emblem;
       true adds a black NIGHT badge on the front fenders. */
    var WHEEL_IN = 17, NIGHT_BADGE = false;
    var FX = 5.97, RX = -7.4, TR = 1.325; // front axle, rear axle, tire radius (LT235/80R17 31.8 in)
    var BODY_Y = 1.55, CAB_F = 3.85, CAB_R = -4.1;
    // Cab (full width), Mega Cab length: long rear doors plus a quarter window
    extrude(shape([[CAB_F, BODY_Y], [CAB_F, 4.86], [CAB_R, 4.82], [CAB_R, BODY_Y]]), 6.42, M.paint, 0, 0.12);
    // Front fenders (left and right) with the wheel arch; the engine bay sits between them
    var fender = new THREE.Shape();
    fender.moveTo(CAB_F, BODY_Y);
    fender.lineTo(FX - 1.62, BODY_Y);
    fender.absarc(FX, 1.45, 1.62, Math.PI, 0, true);
    fender.lineTo(9.3, 2.15);
    fender.lineTo(9.32, 4.42);
    fender.quadraticCurveTo(9.3, 4.72, 9.0, 4.76);
    fender.lineTo(CAB_F, 4.88);
    fender.closePath();
    [-1, 1].forEach(function (s) { extrude(fender, 0.62, M.paint, s * 2.98, 0.1); });
    // Wheel-arch liners (black, open half tubes)
    function archLiner(cx, cy, r, z0, z1) {
      var g = new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), 22, 1, true, Math.PI / 2, Math.PI);
      var m = new THREE.Mesh(g, M.under); m.rotation.x = Math.PI / 2;
      add(m, cx, cy, (z0 + z1) / 2);
    }
    [-1, 1].forEach(function (s) {
      archLiner(FX, 1.45, 1.58, s * 2.3, s * 3.35);
      archLiner(RX, TR + 0.05, 1.66, s * 2.2, s * 4.0);
    });
    // Engine bay shell: floor, inner fender aprons, firewall, cowl, radiator + fan
    box(5.3, 0.08, 5.2, M.under, 6.5, 2.05, 0);
    [-1, 1].forEach(function (s) { box(5.1, 2.2, 0.06, M.under, 6.55, 3.3, s * 2.6); });
    box(0.06, 2.75, 5.3, M.under, CAB_F + 0.12, 3.45, 0);
    box(0.55, 0.06, 5.7, M.satin, CAB_F + 0.05, 4.92, 0); // cowl panel
    box(0.18, 1.65, 4.3, M.block, 8.95, 3.3, 0);          // radiator
    cyl(0.85, 0.85, 0.22, 28, M.plastic, 'x', 8.72, 3.25, 0); // fan shroud
    for (var fb = 0; fb < 7; fb++) {
      var blade = box(0.04, 0.7, 0.16, M.hose, 8.6, 3.25, 0);
      blade.rotation.x = fb / 7 * Math.PI;
    }

    /* Cummins 6.7L I-6 HO: block, black top cover with red CUMMINS, intake on the
       driver side (-z), turbo + exhaust on the passenger side (+z). */
    box(3.5, 1.15, 1.25, M.block, 6.55, 2.75, -0.05);          // block
    box(3.45, 0.32, 1.15, M.plastic, 6.55, 3.48, -0.05);        // head
    var cover = box(3.3, 0.18, 1.05, M.plastic, 6.55, 3.72, -0.05); // valve cover
    var cplate = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 0.78), M.cummins);
    cplate.rotation.x = -Math.PI / 2; add(cplate, 6.55, 3.815, -0.05);
    box(3.2, 0.42, 0.42, M.alum, 6.5, 3.35, -0.88);              // intake manifold
    cyl(0.22, 0.22, 0.75, 18, M.alum, 'y', 8.0, 3.75, -0.88);    // intake horn / grid heater
    tube([[8.0, 4.1, -0.88], [8.05, 4.25, -1.35], [7.75, 4.15, -1.85]], 0.17, M.hose);
    box(1.15, 0.85, 0.8, M.plastic, 7.3, 3.75, -2.05);           // air cleaner box
    tube([[7.0, 3.9, -2.05], [5.9, 4.0, -1.4], [5.2, 4.05, 0.3], [5.15, 3.95, 0.95]], 0.17, M.hose, null, 30); // to turbo inlet
    // Variable-geometry turbo (passenger side, rear of the head)
    cyl(0.34, 0.34, 0.34, 22, M.alum, 'z', 5.15, 3.75, 1.1);     // compressor housing
    var turb = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.15, 10, 20), M.iron);
    add(turb, 5.15, 3.75, 1.48);
    box(3.0, 0.3, 0.26, M.iron, 6.55, 3.05, 0.72);               // exhaust manifold
    tube([[5.15, 3.4, 1.15], [5.6, 2.6, 1.35], [8.4, 2.45, 1.6], [8.85, 2.6, 1.2]], 0.13, M.alum, null, 30); // charge pipe to intercooler
    // Oil fill cap and dipstick (yellow), passenger side of the cover
    cyl(0.09, 0.09, 0.08, 14, M.yellow, 'y', 7.6, 3.86, 0.25);
    var dip = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 6, 12), M.yellow);
    add(dip, 5.9, 3.7, 0.7);
    // Coolant (degas) bottle and washer reservoir, passenger side
    box(0.85, 0.5, 0.45, M.tank, 6.9, 3.85, 2.12);
    cyl(0.1, 0.1, 0.08, 14, M.coolant, 'y', 6.9, 4.14, 2.12);
    box(0.6, 0.55, 0.5, M.tank, 7.7, 3.5, 2.1);
    cyl(0.09, 0.09, 0.08, 14, M.washer, 'y', 7.7, 3.82, 2.1);
    // Two batteries (Cummins Ram HD), front corners, red + terminal caps
    [-1, 1].forEach(function (s) {
      box(0.8, 0.62, 0.62, M.batt, 8.45, 3.35, s * 2.07);
      cyl(0.06, 0.06, 0.08, 10, M.plus, 'y', 8.65, 3.7, s * 2.0);
      cyl(0.06, 0.06, 0.08, 10, M.batt, 'y', 8.25, 3.7, s * 2.0);
    });
    // Power distribution center (fuse box), driver side by the firewall
    box(0.9, 0.38, 0.55, M.plastic, 5.0, 3.6, -2.1);
    box(0.85, 0.06, 0.5, M.satin, 5.0, 3.82, -2.1);
    // Brake master cylinder / booster on the driver-side firewall
    cyl(0.4, 0.4, 0.3, 20, M.block, 'x', 4.2, 3.7, -1.35);
    box(0.4, 0.2, 0.22, M.tank, 4.55, 4.0, -1.35);

    // Hood: Sport Performance Hood (Night Edition), hinged at the cowl, front edge lifts.
    var HOOD_PIVOT = [CAB_F + 0.1, 4.92];
    var hood = new THREE.Group();
    hood.position.set(HOOD_PIVOT[0], HOOD_PIVOT[1], 0);
    hood.userData.part = 'hood';
    group.add(hood);
    extrude(shape([[0, -0.02], [0, 0.06], [2.8, 0.03], [5.1, -0.1], [5.38, -0.2], [5.4, -0.32], [5.28, -0.3], [5.1, -0.2], [0.2, -0.08]]), 5.3, M.paint, 0, 0.04, hood);
    extrude(shape([[0.5, 0.04], [0.85, 0.21], [4.05, 0.15], [4.55, -0.03]]), 2.3, M.paint, 0, 0.06, hood); // power dome
    box(0.08, 0.13, 1.5, M.gloss, 4.4, 0.08, 0, hood);   // scoop lip
    box(0.32, 0.1, 1.38, M.hole, 4.26, 0.07, 0, hood);   // scoop opening
    var pad = box(4.8, 0.03, 4.9, M.satin, 2.6, -0.14, 0, hood); // underhood insulation
    pad.rotation.z = -0.03;
    var hoodHit = box(5.5, 0.45, 5.6, new THREE.MeshBasicMaterial({ visible: false }), 2.7, 0, 0, hood);
    hoodHit.userData.part = 'hood';
    // Gas struts (updated with the hood angle)
    var strutMat = M.chrome;
    var struts = [-1, 1].map(function (s) {
      var g = new THREE.Group(); g.userData.dyn = true;
      var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), strutMat);
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 10), M.hose);
      body.position.y = 0.31;
      g.add(rod, body);
      group.add(g);
      return { g: g, rod: rod, a: new THREE.Vector3(CAB_F + 0.7, 4.3, s * 2.5), hp: new THREE.Vector2(1.4, -0.06), z: s * 2.5 };
    });

    // Greenhouse: tinted glass, roof, gloss-black window frames
    extrude(shape([[CAB_F + 0.05, 4.86], [1.95, 6.34], [-3.88, 6.38], [-4.02, 4.8]]), 6.1, M.glass, 0);
    extrude(shape([[2.05, 6.3], [1.8, 6.5], [-3.82, 6.5], [-3.98, 6.3]]), 6.24, M.paint, 0, 0.06);
    var frameShape = shape([[CAB_F + 0.1, 4.84], [1.95, 6.4], [-3.92, 6.44], [-4.08, 4.78]]);
    frameShape.holes.push(
      path([[3.45, 5.0], [1.98, 6.22], [0.2, 6.26], [0.2, 5.0]]),
      path([[-0.12, 5.0], [-0.12, 6.26], [-2.7, 6.28], [-2.7, 5.0]]),
      path([[-2.98, 5.0], [-2.98, 6.28], [-3.72, 6.3], [-3.85, 5.0]])
    );
    extrude(frameShape, 0.1, M.gloss, 3.06);
    extrude(frameShape, 0.1, M.gloss, -3.06);
    // Body-side character line (catches a highlight along the black paint)
    [-1, 1].forEach(function (s) {
      box(CAB_R - CAB_F - 0.1 > 0 ? 0 : CAB_F - CAB_R - 0.1, 0.05, 0.04, M.paint, (CAB_F + CAB_R) / 2, 4.25, s * 3.34);
      box(5.2, 0.05, 0.04, M.paint, 6.5, 4.25, s * 3.4);
    });
    // Wipers
    [-0.9, 1.3].forEach(function (z) { var wp = box(0.05, 0.05, 2.1, M.satin, 3.72, 4.98, z); wp.rotation.x = 0.05; });
    // Door seams and black handles
    [3.78, -0.05, -2.85].forEach(function (x) { box(0.03, 3.2, 6.7, M.frame, x, 3.2, 0); });
    [2.9, -0.95].forEach(function (hx) {
      [-1, 1].forEach(function (s) { box(0.5, 0.11, 0.07, M.gloss, hx, 4.45, s * 3.36); });
    });
    // Running boards (black, cab length)
    [-1, 1].forEach(function (s) {
      box(7.6, 0.12, 0.5, M.satin, -0.15, 1.3, s * 3.58);
      [-3, 0, 3].forEach(function (bx) { box(0.15, 0.22, 0.4, M.frame, bx, 1.42, s * 3.35); });
    });

    // Front: body-color grille surround, gloss-black billets, black RAM letters, LED headlamps
    box(0.3, 0.24, 4.6, M.paint, 9.22, 4.6, 0);
    box(0.3, 0.2, 4.6, M.paint, 9.22, 2.68, 0);
    [-1, 1].forEach(function (s) { box(0.3, 1.9, 0.18, M.paint, 9.22, 3.62, s * 2.2); });
    var gmesh = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 1.75), M.mesh);
    gmesh.rotation.y = Math.PI / 2; add(gmesh, 9.06, 3.62, 0);
    box(0.22, 0.42, 4.3, M.gloss, 9.2, 3.62, 0);   // center crossbar
    var ramBadge = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.36), badgeMat('R A M', { w: 1024, h: 128, color: '#3a3b42', spread: 1.25 }));
    ramBadge.rotation.y = Math.PI / 2; add(ramBadge, 9.315, 3.62, 0);
    [3.98, 4.15, 4.32, 2.95, 3.12, 3.28].forEach(function (y) { box(0.12, 0.06, 4.25, M.gloss, 9.17, y, 0); });
    var glowPts = []; // [x, y, z, nx, nz, color, size]
    [-1, 1].forEach(function (s) {
      box(0.3, 0.72, 0.98, M.gloss, 9.22, 4.1, s * 2.78);                 // black bezel
      cyl(0.13, 0.13, 0.08, 16, M.proj, 'x', 9.38, 4.18, s * 2.52);         // LED projectors
      cyl(0.13, 0.13, 0.08, 16, M.proj, 'x', 9.38, 4.18, s * 2.92);
      box(0.04, 0.05, 0.9, M.head, 9.385, 4.42, s * 2.78);                 // C-shaped DRL
      box(0.04, 0.62, 0.05, M.head, 9.385, 4.12, s * 3.22);
      box(0.04, 0.05, 0.9, M.head, 9.385, 3.82, s * 2.78);
      box(0.04, 0.05, 0.4, M.amber, 9.385, 3.9, s * 2.5);                  // turn signal
      glowPts.push([9.5, 4.15, s * 2.78, 1, 0, 0xdfeaff, 1.5]);
      // Bumper fog lamps (black bezels)
      box(0.05, 0.3, 0.55, M.gloss, 9.57, 1.95, s * 2.55);
      cyl(0.1, 0.1, 0.05, 14, M.fog, 'x', 9.6, 1.95, s * 2.55);
      glowPts.push([9.7, 1.95, s * 2.55, 1, 0, 0xfff2d8, 0.8]);
    });
    // Front bumper (body color per Night Edition), black lower valance and intake
    extrude(shape([[9.05, 1.25], [9.42, 1.3], [9.55, 1.7], [9.55, 2.25], [9.42, 2.62], [9.1, 2.66]]), 6.9, M.paint, 0, 0.06);
    box(0.35, 0.2, 5.6, M.satin, 9.35, 1.18, 0);
    box(0.04, 0.38, 2.5, M.mesh, 9.62, 1.95, 0);
    // Black trailer-tow mirrors (Night Edition) with amber signals
    [-1, 1].forEach(function (s) {
      box(0.12, 0.1, 0.8, M.gloss, 3.45, 5.55, s * 3.62);
      box(0.12, 0.1, 0.8, M.gloss, 3.45, 5.05, s * 3.62);
      box(0.32, 1.05, 0.62, M.gloss, 3.4, 5.4, s * 4.15);
      box(0.02, 0.9, 0.52, M.mirror, 3.235, 5.42, s * 4.15);
      box(0.25, 0.04, 0.45, M.amber, 3.42, 4.86, s * 4.15);
    });
    // Badges (black): LARAMIE on the front doors, 3500 on the front fenders
    var lar = badgeMat('LARAMIE', { w: 1024, h: 128, color: '#4a4b53', font: '700 96px Georgia, "Times New Roman", serif', spread: 1.1 });
    var hd = badgeMat('3500', { w: 512, h: 128, color: '#4a4b53' });
    var ramDoor = badgeMat('RAM', { w: 512, h: 128, color: '#3a3b42', spread: 1.25 });
    var nightB = NIGHT_BADGE ? badgeMat('NIGHT', { w: 512, h: 128, color: '#3a3b42', spread: 1.1 }) : null;
    [-1, 1].forEach(function (s) {
      var b1 = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.16), lar);
      if (s < 0) b1.rotation.y = Math.PI;
      add(b1, 2.75, 2.4, s * 3.345);
      var b2 = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.17), hd);
      if (s < 0) b2.rotation.y = Math.PI;
      add(b2, 4.6, 3.75, s * 3.405);
      // black RAM badge low on the front door (Claudio's truck photo)
      var b3 = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.2), ramDoor);
      if (s < 0) b3.rotation.y = Math.PI;
      add(b3, 2.6, 2.05, s * 3.346);
      if (NIGHT_BADGE) {
        var b4 = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.15), nightB);
        if (s < 0) b4.rotation.y = Math.PI;
        add(b4, 4.6, 3.5, s * 3.405);
      }
    });
    // Cab roof clearance lamps: 3 center ID lamps + 2 outer (DRW group)
    [-0.5, 0, 0.5, -2.45, 2.45].forEach(function (z) {
      box(0.16, 0.08, 0.3, M.amber, 1.95, 6.56, z);
      glowPts.push([2.05, 6.6, z, 1, 0, 0xffa020, 0.45]);
    });
    box(0.06, 0.1, 1.0, M.red, -4.05, 6.42, 0); // 3rd brake light

    // Bed: 6 ft 4 in box, gray spray-in liner, body-color sides, tailgate
    var BX0 = -11.0, BX1 = -4.45, BL = BX1 - BX0, BC = (BX0 + BX1) / 2;
    var FLOOR_Y = 3.03;
    box(BL, 0.15, 6.2, M.satin, BC, 2.95, 0);
    var liner = new THREE.Mesh(new THREE.PlaneGeometry(BL - 0.08, 6.05, 1, 1), M.liner);
    liner.rotation.x = -Math.PI / 2;
    add(liner, BC, FLOOR_Y, 0);
    for (var rz = -2.7; rz <= 2.7; rz += 0.28) {
      box(BL - 0.3, 0.03, 0.16, M.liner, BC, FLOOR_Y + 0.01, rz);
    }
    [-1, 1].forEach(function (s) {
      box(BL, 1.9, 0.22, M.paint, BC, 3.88, s * 3.2);
      box(BL, 0.1, 0.36, M.paint, BC, 4.86, s * 3.2); // rail cap
      box(BL - 0.4, 1.6, 0.04, M.liner, BC, 3.85, s * 3.08); // liner on the inner walls
    });
    box(0.22, 1.9, 6.62, M.paint, BX1 + 0.1, 3.88, 0);
    var TG_HINGE_Y = 2.90;
    var tailgate = new THREE.Group();
    tailgate.position.set(BX0, TG_HINGE_Y, 0);
    tailgate.userData.part = 'tailgate';
    group.add(tailgate);
    box(0.22, 2.0, 6.0, M.paint, 0.12, 3.88 - TG_HINGE_Y, 0, tailgate);
    box(0.06, 0.3, 1.6, M.gloss, -0.02, 4.55 - TG_HINGE_Y, 0, tailgate);      // handle bezel
    var tgRam = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 0.62), badgeMat('R A M', { w: 1024, h: 192, color: '#3c3d44', spread: 1.2 }));
    tgRam.rotation.y = -Math.PI / 2; add(tgRam, -0.002, 3.9 - TG_HINGE_Y, 0, tailgate);
    var tgHit = box(0.9, 2.2, 6.8, new THREE.MeshBasicMaterial({ visible: false }), 0.15, 3.85 - TG_HINGE_Y, 0, tailgate);
    tgHit.userData.part = 'tailgate';
    // Taillamps on the box corners: black bezels, dark-tinted lenses, LED bars
    [-1, 1].forEach(function (s) {
      box(0.22, 1.3, 0.4, M.gloss, BX0 - 0.05, 3.98, s * 3.12);
      box(0.03, 1.15, 0.33, M.tail, BX0 - 0.17, 3.98, s * 3.12);
      [4.42, 4.24, 3.72].forEach(function (y) { box(0.02, 0.05, 0.28, M.red, BX0 - 0.19, y, s * 3.12); });
      box(0.02, 0.22, 0.28, M.reverse, BX0 - 0.19, 3.5, s * 3.12);
      glowPts.push([BX0 - 0.3, 4.1, s * 3.12, -1, 0, 0xff2028, 0.9]);
    });
    // Rear bumper (body color) with black step pads and the receiver
    extrude(shape([[-10.95, 1.75], [-11.25, 1.85], [-11.33, 2.2], [-11.3, 2.62], [-11.0, 2.7]]), 6.9, M.paint, 0, 0.05);
    box(0.3, 0.03, 1.4, M.satin, -11.15, 2.735, 0);
    [-1, 1].forEach(function (s) { box(0.3, 0.03, 0.8, M.satin, -11.15, 2.735, s * 2.6); });
    box(0.35, 0.26, 0.26, M.satin, -11.3, 1.82, 0);
    // Dually rear fenders with LED clearance lamps (amber front, red rear)
    var fl = new THREE.Shape();
    fl.moveTo(RX - 2.35, 2.0);
    fl.lineTo(RX - 2.35, 3.7);
    fl.quadraticCurveTo(RX - 2.25, 4.75, RX - 1.0, 4.85);
    fl.lineTo(RX + 1.0, 4.85);
    fl.quadraticCurveTo(RX + 2.25, 4.75, RX + 2.35, 3.7);
    fl.lineTo(RX + 2.35, 2.0);
    fl.lineTo(RX + 1.72, 2.0);
    fl.absarc(RX, TR + 0.05, 1.72, 0.36, Math.PI - 0.36, false);
    fl.closePath();
    [-1, 1].forEach(function (s) {
      extrude(fl, 0.62, M.paint, s * 3.6, 0.1);
      box(0.08, 0.14, 0.3, M.amber, RX + 2.47, 3.55, s * 3.62);
      box(0.08, 0.14, 0.3, M.red, RX - 2.47, 3.55, s * 3.62);
      glowPts.push([RX + 2.6, 3.55, s * 3.62, 1, 0, 0xffa020, 0.4]);
      glowPts.push([RX - 2.6, 3.55, s * 3.62, -1, 0, 0xff2028, 0.4]);
    });

    // Under the truck: frame rails, axles, 12 in rear diff, driveshaft, tank, exhaust
    [-1, 1].forEach(function (s) { box(19.5, 0.55, 0.28, M.frame, -0.9, 1.8, s * 1.45); });
    box(0.35, 0.35, 5.3, M.frame, FX, TR, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), M.frame), FX, TR, -0.35);
    cyl(0.2, 0.2, 5.6, 12, M.frame, 'z', RX, TR, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 14), M.frame), RX, TR, 0);
    cyl(0.15, 0.15, 9.6, 10, M.frame, 'x', -2.55, 1.55, 0);
    box(2.6, 1.3, 1.5, M.block, 3.6, 2.2, 0);   // transmission
    box(3.0, 0.85, 1.3, M.frame, -1.9, 1.55, -2.3); // fuel tank (driver side)
    cyl(0.32, 0.32, 3.0, 14, M.alum, 'x', -1.0, 1.5, 1.0); // DPF / SCR
    cyl(0.16, 0.16, 8.0, 10, M.alum, 'x', -6.2, 1.45, 1.0);
    tube([[-10.0, 1.45, 1.0], [-10.4, 1.45, 1.6], [-10.5, 1.42, 2.5]], 0.17, M.satin); // black tip, passenger side
    // Wheels: single front with hub extension, dual rear (outer hub cover)
    [-1, 1].forEach(function (s) {
      wheel(FX, TR, s * 2.82, TR, 0.77, s, 'front');
      wheel(RX, TR, s * 3.58, TR, 0.77, s, 'rearOuter');
      wheel(RX, TR, s * 2.74, TR, 0.77, -s, 'rearInner');
    });
    // Bed hardware, from photos of the real Ram bed: 4 black 5th-wheel
    // puck holes in a rectangle, a center CURT gooseneck ball with a blue latch
    // grip, and two gold safety-chain U-loops.
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
    var bedFill = new THREE.PointLight(0xfff6e8, 22, 7.5, 2);
    add(bedFill, BALL_X, FLOOR_Y + 3.4, 0);
    var PUCK_DX = 1.45, PUCK_DZ = 1.72;
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) {
      puckHole(BALL_X + s[0] * PUCK_DX, s[1] * PUCK_DZ, 0.24, 0.15);
    });
    var LOOP_X = BALL_X - 0.85, LOOP_Z = 1.28;
    chainLoop(LOOP_X, LOOP_Z);
    chainLoop(LOOP_X, -LOOP_Z);
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
    // Breakaway cable anchor (its own eye on the bed, passenger side ahead of the ball)
    var BA_ANCHOR = [BALL_X + 0.9, FLOOR_Y + 0.1, 1.55];
    var baEye = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 8, 14), M.chrome);
    add(baEye, BA_ANCHOR[0], BA_ANCHOR[1], BA_ANCHOR[2]);
    var ballLight = new THREE.PointLight(0xffe6a8, 0, 14, 2);
    ballLight.position.set(BALL_X, 4.2, 0);
    group.add(ballLight);

    var truckCount = group.children.length;
    /* ---- Big Tex 25GN-40D5A-MRBK: 35 ft main deck + 5 ft dovetail ---- */
    var DECK_Y = 34 / 12, HALF_W = 102 / 24;
    var D0 = -15.6, D1 = D0 - 35, DV = D1 - 5; // deck front, dovetail start, rear
    // Gooseneck neck (side profile), coupler tube, header
    var neck = shape([[-4.9, 5.05], [-4.9, 6.35], [-13.0, 6.35], [D0 - 0.4, DECK_Y], [D0 + 1.3, DECK_Y], [-12.1, 5.05]]);
    // v135: two side rails (black I-beam risers) and a lower center spine, so
    // the spare can lie flat between the rails over the spine (Claudio's photo).
    [-1, 1].forEach(function (s) { extrude(neck, 0.3, M.frame, s * 1.45, 0.04); });
    extrude(shape([[-4.9, 5.05], [-4.9, 5.72], [-12.75, 5.72], [D0 - 0.4, DECK_Y], [D0 + 1.3, DECK_Y], [-12.1, 5.05]]), 0.7, M.frame, 0, 0.04);
    box(0.3, 1.3, 3.2, M.frame, -5.05, 5.7, 0);                    // front cross plate
    [-6.5, -8.6, -12.4].forEach(function (x) { box(0.25, 0.3, 2.6, M.frame, x, 5.6, 0); }); // cross members
    // v142: yellow Demco 2-5/16 in gooseneck coupler and the S5 Coupler Locks
    // anti-theft box, sized from Claudio's photos (no serial, QR or phone/URL).
    // Box is about 6 x 5 in by 8 in tall, gloss black, open top, rounded welds.
    var CPL_X = BALL_X;
    var IN = 1 / 12;
    box(0.36, 0.85, 0.36, M.frame, CPL_X, 4.68, 0);                     // black gooseneck post
    // Black cast collar of the outer coupler tube, steel pin, zinc hairpin clip
    box(0.50, 0.20, 0.50, M.iron, CPL_X, 4.20, 0);
    cyl(0.038, 0.038, 0.82, 10, M.steel, 'z', CPL_X, 4.20, 0);          // steel hitch pin
    var rclip = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.013, 6, 16, Math.PI * 1.35), M.zinc);
    rclip.rotation.y = Math.PI / 2; add(rclip, CPL_X, 4.12, 0.44);       // zinc hairpin / R-clip
    // Gloss-yellow Demco: square upper tube, round 2-5/16 in socket below
    box(0.30, 0.48, 0.30, M.demco, CPL_X, 3.86, 0);
    cyl(0.155, 0.155, 0.28, 24, M.demco, 'y', CPL_X, 3.50, 0);
    cyl(0.11, 0.11, 0.02, 18, M.hole, 'y', CPL_X, 3.355, 0);            // socket mouth
    var CH_EYES = [-1, 1].map(function (s) {
      var eye = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 8, 14), M.frame);
      eye.rotation.y = Math.PI / 2;
      add(eye, CPL_X - 0.42, 4.1, s * 0.22);
      return new THREE.Vector3(CPL_X - 0.42, 4.04, s * 0.22);
    });
    // S5 box: 5 in (x, boss face) x 6 in (z, label face) x 8 in tall, open top
    var lock = new THREE.Group();
    lock.userData.part = 'lock';
    var LB = { x: 5 * IN, y: 8 * IN, z: 6 * IN, t: 0.22 * IN };
    var LOCK_Y0 = 3.70; // top of the box sits just under the collar, over the yellow tube
    lock.position.set(CPL_X, LOCK_Y0, 0);
    // v143: boss and puck face the driver's side (left / -z in this model), not the front
    lock.rotation.y = Math.PI / 2;
    group.add(lock);
    var cr = 0.42 * IN;
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        cyl(cr, cr, LB.y, 12, M.gloss, 'y', sx * (LB.x / 2 - cr), 0, sz * (LB.z / 2 - cr), lock);
      });
      box(LB.x - 2 * cr, LB.y, LB.t, M.gloss, 0, 0, sx * (LB.z / 2 - LB.t / 2), lock);
      box(LB.t, LB.y, LB.z - 2 * cr, M.gloss, sx * (LB.x / 2 - LB.t / 2), 0, 0, lock);
    });
    box(LB.x - 2 * cr, LB.t, LB.z - 2 * cr, M.gloss, 0, -LB.y / 2 + LB.t / 2, 0, lock);
    // two drain holes in the bottom face
    [-1, 1].forEach(function (s) {
      cyl(0.04 * IN, 0.04 * IN, 0.02, 10, M.hole, 'y', s * 0.9 * IN, -LB.y / 2 - 0.001, 0, lock);
    });
    // Black slotted latch plate just inside the open top (flat tab with a cutout for the tube)
    (function () {
      var pw = LB.x - 2 * LB.t - 0.01, pz = LB.z - 2 * LB.t - 0.01, hw = 0.17, hz = 0.17;
      var sh = new THREE.Shape();
      sh.moveTo(-pw / 2, -pz / 2); sh.lineTo(pw / 2, -pz / 2); sh.lineTo(pw / 2, pz / 2); sh.lineTo(-pw / 2, pz / 2); sh.closePath();
      var hole = new THREE.Path();
      hole.moveTo(-hw, -hz); hole.lineTo(-hw, hz); hole.lineTo(hw, hz); hole.lineTo(hw, -hz); hole.closePath();
      sh.holes.push(hole);
      var g = new THREE.ExtrudeGeometry(sh, { depth: 0.06 * IN, bevelEnabled: false, curveSegments: 1 });
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0, -0.03 * IN);
      add(new THREE.Mesh(g, M.gloss), 0, LB.y / 2 - 0.12 * IN, 0, lock);
    })();
    // Brushed-silver label on the broad face (faces +x / toward the truck after the box is rotated)
    var lbl = new THREE.Mesh(new THREE.PlaneGeometry(3.6 * IN, 1.15 * IN), new THREE.MeshStandardMaterial({
      map: canvasTex(THREE, 768, 240, function (g, w, h) {
        var gr = g.createLinearGradient(0, 0, w, 0);
        gr.addColorStop(0, '#8e939b'); gr.addColorStop(0.45, '#e7eaee'); gr.addColorStop(1, '#9aa0a8');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.globalAlpha = 0.14; for (var y = 0; y < h; y += 2) { g.fillStyle = y % 4 ? '#fff' : '#000'; g.fillRect(0, y, w, 1); }
        g.globalAlpha = 1; g.fillStyle = '#1a1a1e'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = '700 86px Arial, sans-serif'; g.fillText('S5', w / 2, h * 0.36);
        g.font = '600 58px Arial, sans-serif'; g.fillText('Coupler Locks', w / 2, h * 0.70);
      }),
      metalness: 0.8, roughness: 0.35
    }));
    add(lbl, 0, 0.06, LB.z / 2 + 0.002, lock);
    // Short round tubular boss on the local +x face (world -z, driver's side), ~3.5 in dia, sticking out ~1.5 in,
    // bottom cut in a C so it is open at the bottom.
    var BOSS_R = 1.75 * IN, BOSS_L = 1.5 * IN, BOSS_T = 0.16 * IN, BOSS_Y = -0.12 * IN, GAP = 1.7;
    var boss = new THREE.Group();
    boss.position.set(LB.x / 2, BOSS_Y, 0);
    lock.add(boss);
    var bossMat = M.gloss.clone(); bossMat.side = THREE.DoubleSide;
    var haspMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.35, roughness: 0.5 });
    (function () {
      var th0 = Math.PI - GAP / 2, thL = Math.PI * 2 - GAP;
      function cCyl(r, len) {
        var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 32, 1, true, th0, thL), bossMat);
        m.rotation.z = Math.PI / 2;
        m.position.x = len / 2;
        boss.add(m);
        return m;
      }
      cCyl(BOSS_R, BOSS_L);
      cCyl(BOSS_R - BOSS_T, BOSS_L);
      // C-shaped rim at the mouth
      var sh = new THREE.Shape(), n = 28, startA = -Math.PI / 2 + GAP / 2, endA = -Math.PI / 2 - GAP / 2 + Math.PI * 2, i, a;
      for (i = 0; i <= n; i++) { a = startA + (endA - startA) * i / n; (i ? sh.lineTo : sh.moveTo).call(sh, Math.cos(a) * BOSS_R, Math.sin(a) * BOSS_R); }
      for (i = n; i >= 0; i--) { a = startA + (endA - startA) * i / n; sh.lineTo(Math.cos(a) * (BOSS_R - BOSS_T), Math.sin(a) * (BOSS_R - BOSS_T)); }
      sh.closePath();
      var cap = new THREE.Mesh(new THREE.ShapeGeometry(sh), bossMat);
      cap.rotation.y = Math.PI / 2;
      cap.position.x = BOSS_L;
      boss.add(cap);
    })();
    // Two stacked flat black slotted hasp tabs + a small round stud, visible when the puck is out
    (function () {
      var tab = function (y) {
        var sh = new THREE.Shape();
        var w = 1.35 * IN, h = 1.0 * IN;
        sh.moveTo(-w / 2, -h / 2); sh.lineTo(w / 2, -h / 2); sh.lineTo(w / 2, h / 2); sh.lineTo(-w / 2, h / 2); sh.closePath();
        var hole = new THREE.Path();
        var sw = 0.5 * IN, shh = 0.36 * IN;
        hole.moveTo(-sw / 2, -shh / 2); hole.lineTo(-sw / 2, shh / 2); hole.lineTo(sw / 2, shh / 2); hole.lineTo(sw / 2, -shh / 2); hole.closePath();
        sh.holes.push(hole);
        var g = new THREE.ExtrudeGeometry(sh, { depth: 0.1 * IN, bevelEnabled: false });
        g.rotateY(Math.PI / 2);
        var m = new THREE.Mesh(g, haspMat);
        m.position.set(BOSS_L * 0.55, y, 0);
        boss.add(m);
      };
      tab(0.22 * IN); tab(-0.04 * IN);
      cyl(0.08 * IN, 0.08 * IN, 0.28 * IN, 10, M.steel, 'x', BOSS_L * 0.55, -0.62 * IN, 0, boss);
    })();

    // Chrome Trimax THP XL puck: polished face nearly flush with the boss, hidden when unlocked
    var puck = new THREE.Group();
    puck.userData.dyn = true;
    boss.add(puck);
    // Short puck in the mouth of the boss (not a long cylinder that fills the C-cut)
    cyl(1.38 * IN, 1.38 * IN, 0.7 * IN, 28, M.chrome, 'x', BOSS_L - 0.38 * IN, 0, 0, puck);
    var puckFace = new THREE.Mesh(new THREE.CircleGeometry(1.36 * IN, 32), new THREE.MeshStandardMaterial({
      map: canvasTex(THREE, 512, 512, function (g, w, h) {
        var c = w / 2, r = g.createRadialGradient(c * 0.72, c * 0.62, 8, c, c, c);
        r.addColorStop(0, '#ffffff'); r.addColorStop(0.45, '#d8dce2'); r.addColorStop(1, '#8b9098');
        g.fillStyle = r; g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#6a6e76'; g.lineWidth = 10; g.beginPath(); g.arc(c, c, c - 8, 0, Math.PI * 2); g.stroke();
        // Embossed lettering (darker recessed stroke, lighter face)
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = '700 64px Arial, sans-serif';
        g.fillStyle = '#5c6066'; g.fillText('TRIMAX THP XL', c + 2, c + 2);
        g.fillStyle = '#2e3136'; g.fillText('TRIMAX THP XL', c, c);
        g.fillStyle = '#3a3d42'; g.fillRect(c - 36, c + c * 0.42, 72, 12); // key slot
      }),
      metalness: 1, roughness: 0.18
    }));
    puckFace.rotation.y = Math.PI / 2;
    add(puckFace, BOSS_L - 0.01 * IN, 0, 0, puck);
    var lockHit = box(LB.x + BOSS_L + 0.2, LB.y + 0.2, LB.z + 0.2, new THREE.MeshBasicMaterial({ visible: false }), BOSS_L / 2, 0, 0, lock);
    lockHit.userData.part = 'lock';

    // Safety chains: instanced links along a sagging curve
    var linkGeo = new THREE.TorusGeometry(0.042, 0.012, 6, 10);
    function chainSet(curves) {
      var mats = [], q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), sc = new THREE.Vector3(1.55, 1, 1);
      curves.forEach(function (pts) {
        var c = new THREE.CatmullRomCurve3(pts);
        var n = Math.max(6, Math.round(c.getLength() / 0.07));
        for (var i = 0; i < n; i++) {
          var u = i / (n - 1), p = c.getPointAt(u), tg = c.getTangentAt(u).normalize();
          q.setFromUnitVectors(X, tg);
          q2.setFromAxisAngle(tg, (i % 2) * Math.PI / 2);
          mats.push(new THREE.Matrix4().compose(p, q2.multiply(q), sc));
        }
      });
      var im = new THREE.InstancedMesh(linkGeo, M.cadmium, mats.length);
      mats.forEach(function (m, i) { im.setMatrixAt(i, m); });
      im.userData.dyn = true;
      group.add(im);
      return im;
    }
    var V = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    var chainsHitched = chainSet([-1, 1].map(function (s) {
      var a = CH_EYES[s < 0 ? 0 : 1], b = V(LOOP_X, FLOOR_Y + 0.13, -s * LOOP_Z); // crossed under the coupler
      return [a, V((a.x + b.x) / 2 - 0.05, FLOOR_Y + 0.35, (a.z + b.z) / 2 + s * 0.12), b];
    }));
    var chainsParked = chainSet([-1, 1].map(function (s) {
      var a = CH_EYES[s < 0 ? 0 : 1];
      return [a, V(a.x - 0.12, 3.5, s * 0.5), V(a.x - 0.05, 2.75, s * 0.62), V(a.x + 0.25, 3.2, s * 0.6), V(CPL_X - 0.47, 3.9, s * 0.42)];
    }));
    chainsParked.visible = false;
    // Zip breakaway switch on the neck (passenger side) and its coiled cable
    var BA_SW = [CPL_X + 0.9, 5.4, 1.66];
    box(0.34, 0.24, 0.12, M.satin, BA_SW[0], BA_SW[1], BA_SW[2]);
    cyl(0.03, 0.03, 0.12, 8, M.redGrip, 'x', BA_SW[0] - 0.22, BA_SW[1], BA_SW[2] + 0.02);
    function coilCable(p0, p1, sag, turns) {
      var pts = [], N = turns * 10, a = new THREE.Vector3().fromArray(p0), b = new THREE.Vector3().fromArray(p1);
      var dir = b.clone().sub(a).normalize(), side = new THREE.Vector3(0, 1, 0).cross(dir);
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize();
      var up = dir.clone().cross(side).normalize();
      for (var i = 0; i <= N; i++) {
        var u = i / N, p = a.clone().lerp(b, u);
        p.y -= Math.sin(u * Math.PI) * sag;
        var ang = u * turns * Math.PI * 2;
        p.addScaledVector(side, Math.cos(ang) * 0.045).addScaledVector(up, Math.sin(ang) * 0.045);
        pts.push(p);
      }
      var m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N * 2, 0.012, 5, false), M.redGrip);
      m.userData.dyn = true;
      group.add(m);
      return m;
    }

    var cableHitched = coilCable([BA_SW[0] - 0.24, BA_SW[1] - 0.05, BA_SW[2] + 0.02], BA_ANCHOR, 0.5, 26);
    var cableParked = coilCable([BA_SW[0] - 0.24, BA_SW[1] - 0.05, BA_SW[2] + 0.02], [BA_SW[0] - 0.3, 4.2, BA_SW[2] + 0.1], 0.05, 12);
    cableParked.visible = false;
    [-1, 1].forEach(function (s) {
      var lg = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), M.logo);
      if (s < 0) lg.rotation.y = Math.PI;
      add(lg, -8.9, 5.7, s * 1.645);
      // DOT tape along the neck
      var tp = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 0.14), M.tape);
      if (s < 0) tp.rotation.y = Math.PI;
      add(tp, -8.9, 6.22, s * 1.645);
    });
    // v144: telescoping drop-leg landing gear. Raised (feet off the ground)
    // when the trailer is hitched in Rig 360; extended, pads on the ground
    // supporting the gooseneck, in the trailer-only view. userData.dyn so
    // mergeStatic does not bake the moving legs.
    var JACK_X = -13.5, JACK_Z = 1.85;
    var JACK_OUTER_H = 3.2, JACK_OUTER_TOP = 5.9, JACK_INNER_H = 2.7, JACK_FOOT_H = 0.08;
    var JACK_Y_DOWN = JACK_FOOT_H / 2 + 0.02; // 0.06, pads just above the floor
    var JACK_Y_UP = 1.9; // ~23 in off the ground, clearly raised for travel
    var jackLegs = [];
    [-1, 1].forEach(function (s) {
      var jack = new THREE.Group();
      jack.userData.dyn = true;
      jack.position.set(JACK_X, 0, s * JACK_Z);
      group.add(jack);
      var outer = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, JACK_OUTER_H, 10), M.frame);
      outer.position.y = JACK_OUTER_TOP - JACK_OUTER_H / 2;
      jack.add(outer);
      var collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 10), M.frame);
      collar.position.y = JACK_OUTER_TOP - JACK_OUTER_H;
      jack.add(collar);
      var drop = new THREE.Group();
      jack.add(drop);
      drop.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, JACK_FOOT_H, 0.7), M.frame));
      var inner = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, JACK_INNER_H, 10), M.chrome);
      inner.position.y = JACK_FOOT_H / 2 + JACK_INNER_H / 2;
      drop.add(inner);
      drop.position.y = JACK_Y_UP; // default Rig 360 / hitched
      jackLegs.push(drop);
    });
    // Storage toolbox under the gooseneck, in the gap ahead of the deck
    // (behind the truck when hooked up), between the drop-leg jacks and the header.
    // Placement and facing stay as they are; the lid is the top (chest-style).
    var TB = { x: -12.12, y: 3.05, z: 0, lx: 1.9, ly: 1.8, lz: 3.7 }; // v137: rear edge clears the neck slope
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
    // Lid: top face, black diamond plate. v135: hinged at the REAR top edge (-x,
    // toward the deck), so the front edge (toward the truck, with the latch)
    // lifts and the lid swings back over the deck side; the box opens toward the truck.
    var toolboxLid = new THREE.Group();
    toolboxLid.position.set(-TB.lx / 2, TB.ly / 2, 0);
    toolboxLid.userData.part = 'toolbox';
    toolbox.add(toolboxLid);
    box(TB.lx, 0.08, TB.lz, lidMat, TB.lx / 2, 0.04, 0, toolboxLid);
    box(0.4, 0.1, 0.55, M.chrome, TB.lx - 0.42, 0.15, 0, toolboxLid); // latch near the front (truck) edge
    cyl(0.05, 0.05, TB.lz * 0.9, 10, M.chrome, 'z', 0, 0.04, 0, toolboxLid); // hinge barrel
    var tbHit = box(TB.lx + 0.2, 0.55, TB.lz + 0.2, tbInvis, TB.lx / 2, 0.12, 0, toolboxLid);
    tbHit.userData.part = 'toolbox';
    var tbBodyHit = box(TB.lx, TB.ly, TB.lz, tbInvis, 0, 0, 0, toolbox);
    tbBodyHit.userData.part = 'toolbox';
    // Full-width header at the front of the deck
    box(0.45, 1.25, HALF_W * 2, M.frame, D0 - 0.1, DECK_Y - 0.25, 0);
    // Main deck
    var deckMats = [M.frame, M.frame, M.wood, M.frame, M.frame, M.frame];
    add(new THREE.Mesh(new THREE.BoxGeometry(35, 0.16, HALF_W * 2 - 0.3), deckMats), (D0 + D1) / 2, DECK_Y - 0.08, 0);
    // v135 (Claudio's photos): diamond-plate strips on the wood deck: a full-width
    // section at the front by the gooseneck and a center strip down the deck.
    var dpMat = M.diamond.clone(); dpMat.map = M.diamond.map.clone(); dpMat.map.needsUpdate = true;
    dpMat.map.repeat.set(8, 1.2);
    box(3.0, 0.03, HALF_W * 2 - 0.32, dpMat, D0 - 1.5, DECK_Y + 0.012, 0);
    var cs = M.diamond.clone(); cs.map = M.diamond.map.clone(); cs.map.needsUpdate = true; cs.map.repeat.set(60, 1);
    box(32.0, 0.03, 0.85, cs, D0 - 3 - 16, DECK_Y + 0.012, 0);
    // Upright headache-rack style frame where the neck meets the deck
    [-1, 1].forEach(function (s) {
      box(0.3, 3.5, 0.3, M.frame, D0 + 0.15, DECK_Y + 1.75, s * (HALF_W - 0.3));
    });
    [DECK_Y + 1.2, DECK_Y + 2.35, DECK_Y + 3.45].forEach(function (y) { box(0.22, 0.2, HALF_W * 2 - 0.6, M.frame, D0 + 0.15, y, 0); });
    [-1.2, 0, 1.2].forEach(function (z) { box(0.12, 3.4, 0.12, M.frame, D0 + 0.15, DECK_Y + 1.75, z); });
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
    // Dovetail (about 5 ft), v135: only a slight drop from the deck (about 6 in),
    // with the MEGA ramps folded flat on top.
    var dvDrop = 0.5;
    var dvLen = Math.sqrt(25 + dvDrop * dvDrop), dvAng = Math.atan2(dvDrop, 5);
    var dv = new THREE.Group();
    dv.position.set(D1, DECK_Y, 0);
    dv.rotation.z = dvAng; // slopes down toward the rear (-x)
    group.add(dv);
    var dvMats = [M.frame, M.frame, M.frame, M.frame, M.frame, M.frame];
    add(new THREE.Mesh(new THREE.BoxGeometry(dvLen, 0.16, HALF_W * 2 - 0.3), dvMats), -dvLen / 2, -0.08, 0, dv);
    [-1, 1].forEach(function (s) {
      box(dvLen, 0.6, 0.18, M.frame, -dvLen / 2, -0.32, s * (HALF_W - 0.09), dv);
      var tp = new THREE.Mesh(new THREE.PlaneGeometry(dvLen, 0.16), M.tape);
      if (s < 0) tp.rotation.y = Math.PI;
      add(tp, -dvLen / 2, -0.38, s * (HALF_W + 0.005), dv);
      // ramp hinge springs
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8), M.frame), -dvLen + 0.4, -0.15, s * 2.3, dv).rotation.z = Math.PI / 2;
    });
    // MEGA ramps folded flat over the dovetail (its top surface): two side-by-side
    // black diamond-plate panels with rows of round holes, DOT tape on the rear
    // edges, yellow MEGA decal and Big Tex logo on the sides (Claudio's photos).
    var rampMat = new THREE.MeshStandardMaterial({ map: canvasTex(THREE, 256, 256, function (g, w, h) {
      g.fillStyle = '#141417'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(150,150,160,0.32)'; g.lineWidth = 3;
      for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) {
        var ox = x * 32 + (y % 2 ? 16 : 0), oy = y * 32;
        g.beginPath(); g.moveTo(ox + 6, oy + 20); g.lineTo(ox + 16, oy + 10); g.stroke();
      }
      g.fillStyle = '#000';
      for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) { g.beginPath(); g.arc(32 + c * 64, 32 + r * 64, 9, 0, Math.PI * 2); g.fill(); }
    }), metalness: 0.6, roughness: 0.42 });
    rampMat.map.wrapS = rampMat.map.wrapT = THREE.RepeatWrapping;
    rampMat.map.repeat.set(2.5, 2);
    var mega = new THREE.MeshStandardMaterial({ map: textTex(THREE, 'MEGA', { w: 512, h: 128, color: '#f4c21b', stroke: 8, strokeColor: '#111' }), alphaTest: 0.4, roughness: 0.5 });
    [-1, 1].forEach(function (s) {
      var pz = s * (HALF_W / 2 - 0.08);
      box(dvLen - 0.1, 0.1, HALF_W - 0.26, rampMat, -dvLen / 2, 0.05, pz, dv);       // ramp panel (flat)
      var rt = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W - 0.3, 0.1), M.tape);   // DOT tape, rear edge
      rt.rotation.y = -Math.PI / 2; add(rt, -dvLen + 0.04, 0.05, pz, dv);
      var mg = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.36), mega);              // MEGA decal on the side
      if (s < 0) mg.rotation.y = Math.PI;
      add(mg, -dvLen / 2 - 0.6, -0.25, s * (HALF_W + 0.01), dv);
      var lgd = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), M.logo);
      if (s < 0) lgd.rotation.y = Math.PI;
      add(lgd, -dvLen / 2 + 1.2, -0.25, s * (HALF_W + 0.012), dv);
    });
    // Rear: spring-assist bar with coil springs, angled ramp stands hanging down,
    // license plate bracket on the right (blank), red tail lights below.
    cyl(0.07, 0.07, HALF_W * 2 - 0.4, 10, M.frame, 'z', -dvLen + 0.25, -0.72, 0, dv);
    [-2.2, -0.75, 0.75, 2.2].forEach(function (z) {
      var pts = [];
      for (var i = 0; i <= 60; i++) { var u = i / 60, a = u * 9 * Math.PI * 2; pts.push(new THREE.Vector3(-dvLen + 0.25 + Math.cos(a) * 0.13, -0.72 + Math.sin(a) * 0.13, z - 0.35 + u * 0.7)); }
      add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.022, 5, false), M.frame), 0, 0, 0, dv);
    });
    [-2.9, -1.3, 1.3, 2.9].forEach(function (z) {
      var st = box(0.12, 0.95, 0.14, M.frame, -dvLen + 0.55, -0.95, z, dv);
      st.rotation.z = -0.55;
    });
    box(0.05, 0.55, 1.0, M.frame, -dvLen - 0.2, -0.95, 2.55, dv);       // plate bracket
    box(0.04, 0.48, 0.98, M.satin, -dvLen - 0.23, -0.95, 2.55, dv);      // blank plate area
    box(0.06, 0.06, 0.2, M.head, -dvLen - 0.22, -0.66, 2.55, dv);        // plate light
    // v137: MEGA hold-down latches (Big Tex spec sheet): a handle bar and keeper on each
    // ramp's front edge where it meets the deck.
    [-1, 1].forEach(function (s) {
      [s * 0.9, s * 3.0].forEach(function (z) {
        box(0.32, 0.12, 0.34, M.frame, -0.28, 0.14, z, dv);            // keeper block
        box(0.42, 0.05, 0.08, M.chrome, -0.32, 0.23, z, dv);            // latch handle
      });
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
    // Spare tire (ST235/80R16 LR-E, black steel wheel) lying flat on its mount on top of the neck
    var SP = { x: -11.0, y: 5.72 + 0.06 + 0.36 };
    box(1.4, 0.06, 1.4, M.frame, SP.x, 5.75, 0);                 // mount plate on the spine
    var spare = wheel(SP.x, SP.y, 0, 1.29, 0.7, 1, 'trailer');
    spare.rotation.x = -Math.PI / 2;                             // axis up, face up
    cyl(0.05, 0.05, 0.9, 8, M.chrome, 'y', SP.x, SP.y, 0);        // hold-down stud
    cyl(0.16, 0.16, 0.06, 6, M.chrome, 'y', SP.x, SP.y + 0.42, 0); // hold-down nut
    // Tandem 12K dual-wheel axles, ST235/80R16 LR-E on black steel wheels
    var TT = 1.29, AX1 = D1 + 9.6, AX2 = D1 + 5.9;
    [AX1, AX2].forEach(function (ax) {
      box(0.25, 0.25, 7.2, M.frame, ax, TT, 0);
      [-1, 1].forEach(function (s) {
        wheel(ax, TT, s * 3.6, TT, 0.7, s, 'trailer');
        wheel(ax, TT, s * 2.86, TT, 0.7, -s, 'trailerInner');
      });
      box(3.6, 0.22, 0.2, M.frame, ax, TT + 0.55, 1.65);
      box(3.6, 0.22, 0.2, M.frame, ax, TT + 0.55, -1.65);
    });

    // Center the rig on the turntable. Front of truck bumper +9.6, back of dovetail DV.
    var front = 9.62, back = DV - 0.2;
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
    // Lamp glow halos (additive sprites; faded by the view when a lamp faces away)
    var gtex = glowTex(THREE), glows = [];
    glowPts.forEach(function (p) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gtex, color: p[5], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
      sp.scale.set(p[6], p[6], 1);
      sp.position.set(p[0], p[1], p[2]);
      sp.renderOrder = 2;
      truck.add(sp);
      glows.push({ s: sp, n: new THREE.Vector3(p[3], 0, p[4]) });
    });
    // Static meshes merged per material (draw calls), then shadows on.
    mergeStatic(THREE, truck);
    mergeStatic(THREE, trailer);
    group.traverse(function (o) {
      if ((o.isMesh || o.isInstancedMesh) && o.material && !o.material.transparent && o.material.visible !== false) o.castShadow = true;
    });

    // Spec hotspots (group coordinates). Only verified figures; no VIN or plate.
    var hotspots = [
      { id: 'engine', p: [6.6, 5.2, 0], subj: 'truck rig', t: 'Cummins 6.7L HO turbo diesel', l: ['430 hp @ 2,800 rpm, 1,075 lb-ft @ 1,800 rpm', 'TorqueFlite HD 8-speed automatic', 'Oil: every 5,000 mi (our rule; Ram max 15,000 mi / 12 mo)', 'Tap Hood to see the engine bay'] },
      { id: 'wheels', p: [FX, TR + 0.2, 3.55], n: [0, 0, 1], subj: 'truck rig', t: 'Front wheels and tires', l: ['LT235/80R17 E tires, 31.8 in tall', '17 in black-painted aluminum wheels, machined eyelets (Night Edition DRW)', '6,000 lb front axle with hub extension (DRW group)'] },
      { id: 'rear', p: [RX, TR + 0.3, 4.15], n: [0, 0, 1], subj: 'truck rig', t: 'Rear axle and duals', l: ['12.0 in DRW rear axle, Mopar 75W-140 only (OM p. 353)', '4 rear tires LT235/80R17 E', 'GVWR 14,000 lb, GCWR 41,950 lb', 'Max trailer 32,890 lb, max payload 5,380 lb (Ram chart, our config)'] },
      { id: 'hitch', p: [BALL_X, FLOOR_Y + 0.9, 0], subj: 'truck', t: 'Gooseneck hitch', l: ['CURT 60638 ball: 38,000 lb, 9,500 lb pin', 'Ram factory puck system: 37,100 lb trailer, 5,565 lb pin (OM p. 200)', 'The lower rating rules: 37,100 lb', '2 gold safety-chain loops; trailer GVWR 25,900 lb'] },
      { id: 'bed', p: [-9.6, 4.95, -1.6], n: [0, 1, 0], subj: 'truck', t: 'Bed: 6 ft 4 in box', l: ['76.3 in floor length, 66.4 in wall to wall', '51.0 in between the wheel wells, 20.1 in deep', 'Gray spray-in liner, 4 puck holes, 2 chain loops'] },
      { id: 'mirrors', p: [3.4, 6.05, 4.15], subj: 'truck rig', t: 'Mirrors and lights', l: ['Black trailer-tow mirrors (Night Edition)', 'LED headlamps, black headlamp and taillamp bezels', 'LED clearance lamps: 5 on the cab roof, plus box and rear fenders (DRW group)'] },
      { id: 'coupler', p: [CPL_X, 4.75, 0.45], subj: 'rig trailer', t: 'Coupler, chains, breakaway', l: ['Demco 2-5/16 in gooseneck coupler', 'Latch closed and pinned before every trip', '2 safety chains, crossed, hooked to the truck', 'Zip breakaway cable on its own anchor'] },
      { id: 'lock', p: [CPL_X, 3.72, -0.42], n: [0, 0, -1], subj: 'trailer', t: 'S5 Coupler Lock + Trimax THP XL', l: ['S5 Coupler Lock + Trimax THP XL puck lock - blocks the gooseneck coupler when parked/unhooked', 'Steel box over the Demco coupler, puck lock in the side shroud', 'Lube the puck lock every 3 months; keep the key off the trailer'] },
      { id: 'box', p: [TB.x, TB.y + TB.ly / 2 + 0.25, 0], subj: 'rig trailer', t: 'Front storage box', l: ['Lockable mega front storage box with chain holder', 'Hot Shot kit: 10 winch straps 5,400 lb WLL, 6 grade 70 chains 4,700 lb WLL, 6 binders 6,600 lb WLL', 'Tap Toolbox to open it'] },
      { id: 'spare', p: [-11.0, 6.85, 0], subj: 'rig trailer', t: 'Spare tire', l: ['Spare tire and mount (Big Tex 25GN)', 'ST235/80R16 LR-E on a black steel wheel, same as the trailer', '80 psi cold, like the road tires'] },
      { id: 'jacks', p: [-13.5, 2.0, 2.05], n: [0, 0, 1], subj: 'rig trailer', t: 'Landing gear', l: ['Dual 2-speed 50K landing gear', 'Raised when hitched; down, pads on the ground, when the trailer is parked'] },
      { id: 'deck', p: [(D0 + D1) / 2 + 4, DECK_Y + 0.15, 0], n: [0, 1, 0], subj: 'rig trailer', t: 'Big Tex 25GN-40D5A-MRBK', l: ['40 ft deck incl. about 5 ft dovetail', '102 in wide, 34 in deck height, treated wood floor', 'GVWR 25,900 lb: 8,770 lb empty, 17,130 lb capacity', 'Stake pockets, rubrail, sliding winch track'] },
      { id: 'axles', p: [(AX1 + AX2) / 2, TT + 0.85, HALF_W + 0.1], n: [0, 0, 1], subj: 'rig trailer', t: 'Trailer axles', l: ['Tandem 12,000 lb dual-wheel axles', 'Electric brakes, forward self-adjusting', '30K HD adjustable suspension'] },
      { id: 'ttires', p: [AX2, TT, 4.0], n: [0, 0, 1], subj: 'rig trailer', t: 'Trailer tires', l: ['ST235/80R16 LR-E radials on black steel wheels', '80 psi cold', 'TrailerGard warranty to 10/5/2033', 'Spare tire and mount'] },
      { id: 'dovetail', p: [D1 - 2.5, DECK_Y - 0.1, 0], n: [0, 1, 0], subj: 'rig trailer', t: 'Dovetail and ramps', l: ['About 5 ft dovetail', 'MEGA ramps with hold-down latches, folded flat on the dovetail'] }
    ];
    var trailerFront = -4.9;
    var res = {
      group: group, truck: truck, trailer: trailer, tailgate: tailgate, toolbox: toolbox, toolboxLid: toolboxLid,
      hood: hood, struts: struts, hoodPivot: HOOD_PIVOT, lock: lock, lockY0: LOCK_Y0, lockH: LB.y, puck: puck,
      hitchedOnly: [chainsHitched, cableHitched], parkedOnly: [chainsParked, cableParked, lock],
      jackLegs: jackLegs, jackYDown: JACK_Y_DOWN, jackYUp: JACK_Y_UP,
      glows: glows, hotspots: hotspots, ballLight: ballLight, ballX: BALL_X, tb: TB,
      rigOffset: -mid, trailerOffset: -(trailerFront + back) / 2, truckOffset: -(front + BX0 - 0.4) / 2
    };
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
