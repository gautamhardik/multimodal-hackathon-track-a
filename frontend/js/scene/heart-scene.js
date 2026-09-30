// Interactive Three.js scene: orbit/zoom, camera presets, hover + click selection of vessel systems,
// probability-driven colouring with smooth transitions, optional thorax context and heartbeat.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SYSTEMS, SYSTEM_ORDER, VIEWS } from '../config/anatomy.js';
import { heatColor, pct } from '../ui/colors.js';
import { loadAnatomy, loadThorax } from './anatomy-loader.js';
import { installVesselFx } from './vessel-fx.js';

const DIM = new THREE.Color('#6f6566');
const yieldToMain = () => new Promise(r => setTimeout(r, 0));   // focus mode: unselected arteries fade towards this

// Camera framing is expressed relative to the anatomy's bounding radius, so both heart sources frame alike.
const VIEW_DISTANCE = 3.5;      // x radius
const CHEST_DISTANCE = 5.4;

export class HeartScene {
  constructor(container, { onSelect, onHover, onBackground } = {}) {
    this.container = container;
    this.onSelect = onSelect || (() => {});
    this.onHover = onHover || (() => {});
    this.onBackground = onBackground || (() => {});
    this.probabilities = {};
    this.selected = null;
    this.hovered = null;
    this.beat = false;
    this.bpm = 70;
    this.pickTargets = [];
    this.labels = {};
    this.camAnim = null;
    this.radius = 2.4;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.systemMaterials = Object.fromEntries(SYSTEM_ORDER.map(sys => [sys,
      new THREE.MeshStandardMaterial({ color: heatColor(0), roughness: 0.32, metalness: 0.0, emissive: new THREE.Color(0x000000) })]));
    // Colour pipeline per system: target (from the probability) -> base (eased) -> shown (dimmed in focus mode).
    this.targetColors = Object.fromEntries(SYSTEM_ORDER.map(sys => [sys, new THREE.Color(heatColor(0))]));
    this.baseColors = Object.fromEntries(SYSTEM_ORDER.map(sys => [sys, new THREE.Color(heatColor(0))]));
    this.emphasis = Object.fromEntries(SYSTEM_ORDER.map(sys => [sys, 1]));
    this.waveStart = null;
    this.introStart = null;
    this._buildRenderer();
    this.ready = this._loadHeart();
  }

  _buildRenderer() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D heart. Drag to rotate, scroll to zoom, click a coronary artery to select it.');
    this.renderer.domElement.setAttribute('role', 'img');

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    this.container.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight(0xfff4ec, 1.8);
    key.position.set(3, 5, 6);
    const rim = new THREE.DirectionalLight(0xffd6cc, 0.9);
    rim.position.set(-4, 2, -5);
    const ember = new THREE.DirectionalLight(0xff5a36, 1.6);   // warm edge light, same look as the landing page
    ember.position.set(-5, 1.5, -3);
    this.scene.add(key, rim, ember, new THREE.HemisphereLight(0xffffff, 0x2a2020, 0.45));

    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.05, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.addEventListener('start', () => { this.camAnim = null; });

    this.heart = new THREE.Group();
    this.scene.add(this.heart);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._bindEvents();
    new ResizeObserver(() => this._resize()).observe(this.container);
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  async _loadHeart() {
    const a = await loadAnatomy();
    await yieldToMain();
    this.anatomy = a;
    this.source = a.source;
    this.heart.add(a.root);
    const sphere = new THREE.Box3().setFromObject(a.root).getBoundingSphere(new THREE.Sphere());
    this.radius = sphere.radius;
    this.center = sphere.center;
    for (const sys of SYSTEM_ORDER) {
      for (const m of a.vessels[sys] || []) m.material = this.systemMaterials[sys];
      this.pickTargets.push(...(a.hits[sys] || []));
    }
    await yieldToMain();
    this.fx = installVesselFx(a, this.systemMaterials, { haloWidth: this.radius * 0.016 });
    await yieldToMain();
    this.introStart = this.reducedMotion ? null : performance.now();
    for (const sys of SYSTEM_ORDER) if (a.anchors[sys]) this._addLabel(sys, a.anchors[sys]);
    if (a.anchors.LM) this._addNeutralLabel(a.anchors.LM);
    this.controls.minDistance = this.radius * 1.4;
    this.controls.maxDistance = this.radius * 14;
    this._buildProceduralTorso();
    if (Object.keys(this.probabilities).length) this.setProbabilities(this.probabilities, false);
    this.setView(this.currentView || 'anterior', false);
    // Compile every shader off the main thread (KHR_parallel_shader_compile) before the first frame draws them.
    this.paused = true;
    try {
      await Promise.race([this.renderer.compileAsync(this.scene, this.camera), new Promise(r => setTimeout(r, 3000))]);
    } catch { /* compile on first render instead */ }
    this.paused = false;
    if (this.introStart !== null) this.introStart = performance.now();
    return a;
  }

  _addLabel(sys, anchor) {
    const el = document.createElement('div');
    el.className = 'vessel-label';
    el.innerHTML = '<span class="sw"></span><span class="t"></span><span class="x"></span>';
    el.querySelector('.t').textContent = SYSTEMS[sys].short;
    el.querySelector('.x').textContent = SYSTEMS[sys].territory;
    el.style.pointerEvents = 'auto';
    el.tabIndex = -1;
    el.addEventListener('click', () => this.onSelect(sys));
    const obj = new CSS2DObject(el);
    obj.position.copy(anchor.position).addScaledVector(anchor.normal, this.radius * 0.1);
    this.heart.add(obj);
    this.labels[sys] = { el, obj, normal: anchor.normal };
  }

  _addNeutralLabel(anchor) {
    const el = document.createElement('div');
    el.className = 'vessel-label muted';
    el.textContent = 'Left main · not modelled';
    const obj = new CSS2DObject(el);
    obj.position.copy(anchor.position).addScaledVector(anchor.normal, this.radius * 0.08);
    this.heart.add(obj);
    this.lmLabel = { el, obj, normal: anchor.normal };
  }

  _buildProceduralTorso() {
    // X-ray-style chest context. With the anatomical heart, the real skeleton (thorax.glb) replaces this on first use.
    this.torso = new THREE.Group();
    const s = this.radius / 2.4;
    const profile = [[0.3, -5.2], [2.2, -5.1], [2.15, -3.6], [2.45, -1.8], [2.6, 0.2], [2.7, 1.9], [2.95, 2.9], [2.6, 3.45],
      [1.2, 3.8], [0.72, 4.1], [0.66, 4.9], [0.3, 5.0]].map(([x, y]) => new THREE.Vector2(x, y));
    const shell = new THREE.LatheGeometry(profile, 72);
    shell.scale(1, 1, 0.56);
    this.torsoShell = new THREE.Mesh(shell, this._rimMaterial());
    this.torso.add(this.torsoShell);
    if (this.source === 'procedural') {
      const bone = new THREE.MeshStandardMaterial({ color: '#d8d0c2', roughness: 0.7, transparent: true, opacity: 0.42, depthWrite: false });
      for (let i = 0; i < 10; i++) {
        const y = 2.55 - i * 0.5;
        const a = 1.2 + Math.min(i, 5) * 0.2 - Math.max(0, i - 7) * 0.12;
        const b = 0.72 + Math.min(i, 5) * 0.1;
        for (const side of [-1, 1]) {
          const pts = [];
          for (let k = 0; k <= 24; k++) {
            const th = -Math.PI / 2 + (k / 24) * Math.PI * 0.8;
            pts.push(new THREE.Vector3(side * a * Math.cos(th), y - 0.55 * (k / 24) ** 1.6, b * Math.sin(th)));
          }
          this.torso.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.045, 6), bone));
        }
      }
      const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.36, 2.5, 0.12), bone);
      sternum.position.set(0, 1.35, 1.36);
      this.torso.add(sternum);
      for (let i = 0; i < 17; i++) {
        const v = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 12), bone);
        v.position.set(0, 3.2 - i * 0.34, -0.95);
        this.torso.add(v);
      }
      this.torso.position.set(-0.55, -0.35, -0.1);
    } else {
      this.torso.scale.setScalar(s);
      this.torso.position.set(-0.5 * s, -0.6 * s, -0.4 * s);
    }
    this.torso.renderOrder = 10;
    this.torso.visible = false;
    this.scene.add(this.torso);
  }

  _rimMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color('#8fa3bd') } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
        void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(color, 0.02 + 0.42 * f); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  async _ensureThorax() {
    if (this.source !== 'bodyparts3d' || this.thoraxRequested) return;
    this.thoraxRequested = true;
    const thorax = await loadThorax();
    if (!thorax) return;
    const bone = new THREE.MeshStandardMaterial({ color: '#e2d9ca', roughness: 0.65, transparent: true, opacity: 0.5, depthWrite: false });
    thorax.traverse(o => { if (o.isMesh) o.material = bone; });
    // Real bones replace the schematic ribs; the fresnel body shell stays as a soft silhouette.
    this.torso.add(thorax);
    thorax.scale.setScalar(1 / this.torso.scale.x);
    thorax.position.copy(this.torso.position).multiplyScalar(-1 / this.torso.scale.x);
    // Fit the translucent body silhouette (lathe: width 5.9, height 10.2, depth 3.3) around the real skeleton.
    this.torso.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(thorax);
    const size = box.getSize(new THREE.Vector3()).divideScalar(this.torso.scale.x);
    const centre = this.torso.worldToLocal(box.getCenter(new THREE.Vector3()));
    this.torsoShell.scale.set(size.x / 5.9 * 1.22, size.y / 10.2 * 1.3, size.z / 3.3 * 1.35);
    this.torsoShell.position.copy(centre).add(new THREE.Vector3(0, -0.05 * size.y, 0));
  }

  _bindEvents() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointermove', e => {
      this._setPointer(e);
      this._pendingHover = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerleave', () => { this._pendingHover = null; this._setHover(null); });
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      this._setPointer(e);
      const hit = this._pick();
      if (hit) this.onSelect(hit);
    });
    el.addEventListener('dblclick', e => {
      this._setPointer(e);
      if (!this._pick()) this.onBackground();
    });
  }

  _setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  _pick() {
    if (!this.pickTargets.length) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickTargets, false);
    return hits.length ? hits[0].object.userData.system : null;
  }

  _setHover(sys, pos) {
    if (sys !== this.hovered) {
      this.hovered = sys;
      this.renderer.domElement.style.cursor = sys ? 'pointer' : 'grab';
      this._refreshEmphasis();
    }
    this.onHover(sys, pos);
  }

  _refreshEmphasis() {
    for (const sys of SYSTEM_ORDER) {
      const lab = this.labels[sys];
      if (!lab) continue;
      lab.el.classList.toggle('selected', sys === this.selected);
      lab.el.classList.toggle('dimmed', !!this.selected && sys !== this.selected);
    }
  }

  setProbabilities(probs, animate = true) {
    for (const sys of SYSTEM_ORDER) {
      if (probs[sys] === undefined) continue;
      this.targetColors[sys].set(heatColor(probs[sys]));
      const lab = this.labels[sys];
      if (lab) {
        lab.el.querySelector('.t').textContent = `${SYSTEMS[sys].short} ${pct(probs[sys])}`;
        lab.el.querySelector('.sw').style.background = heatColor(probs[sys]);
        lab.el.querySelector('.sw').style.color = heatColor(probs[sys]);
      }
    }
    this.probabilities = { ...probs };
    if (!animate || this.reducedMotion) {
      for (const sys of SYSTEM_ORDER) this.baseColors[sys].copy(this.targetColors[sys]);
    } else {
      this.waveStart = performance.now();   // a ring of light sweeps each artery from its ostium
    }
    this._refreshEmphasis();
  }

  select(sys) {
    this.selected = sys;
    this._refreshEmphasis();
    if (sys && SYSTEMS[sys]) this.setView(SYSTEMS[sys].view, true, 0.84);   // focus: turn to the artery and move in
  }

  setView(id, animate = true, zoom = 1) {
    const view = VIEWS.find(v => v.id === id);
    if (!view) return;
    this.currentView = id;
    if (!this.anatomy) return;
    if (view.torso) this.setTorso(true);
    // Narrow canvases need more distance so the whole heart fits horizontally (its projected half-width is
    // up to ~0.6 of the bounding radius, so keep at least 0.95 radius of visible half-width).
    const fit = Math.max(1, 0.95 / Math.max(this.camera.aspect, 0.4));
    const dist = this.radius * (view.torso ? CHEST_DISTANCE : VIEW_DISTANCE) * fit * zoom;
    const target = view.torso ? this.center.clone().lerp(this.torso.position, 0.5) : this.center.clone();
    const pos = new THREE.Vector3(...view.dir).normalize().multiplyScalar(dist).add(target);
    if (!animate || this.reducedMotion) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.camAnim = { p0: this.camera.position.clone(), p1: pos, t0c: this.controls.target.clone(), t1: target, start: performance.now(), dur: 900 };
  }

  setLabels(on) {
    for (const k in this.labels) this.labels[k].obj.visible = on;
    if (this.lmLabel) this.lmLabel.obj.visible = on;
  }

  setTorso(on) {
    if (!this.torso) return;
    this.torso.visible = on;
    if (on) this._ensureThorax();
  }

  setBeat(on, bpm) { this.beatOn = on; this.beat = on && !this.reducedMotion; if (bpm) this.bpm = bpm; }

  /** Beat timing for the heartbeat sound: scene seconds and rate, or null while the heartbeat is off. */
  beatClock() { return this.beatOn && !this.paused ? { t: this.clock.elapsedTime, bpm: this.bpm } : null; }

  // Labels are HTML overlays and are never occluded, so hide the ones whose vessel faces away from the camera
  // (a half-transparent pill over the heart reads as a rendering glitch). The summary chips still reach every vessel.
  _fadeHiddenLabels() {
    const tmp = new THREE.Vector3();
    const fade = lab => {
      lab.obj.getWorldPosition(tmp);
      const facing = lab.normal.dot(tmp.subVectors(this.camera.position, tmp).normalize());
      const hidden = facing < 0.05;
      if (lab.behind !== hidden) { lab.behind = hidden; lab.el.classList.toggle('behind', hidden); }
      lab.el.style.pointerEvents = hidden || lab === this.lmLabel ? 'none' : 'auto';
    };
    for (const k in this.labels) fade(this.labels[k]);
    if (this.lmLabel) fade(this.lmLabel);
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  _tick() {
    if (this.paused) return;
    const now = performance.now();
    if (this.camAnim) {
      const a = this.camAnim, k = Math.min(1, (now - a.start) / a.dur), e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      this.camera.position.lerpVectors(a.p0, a.p1, e);
      this.controls.target.lerpVectors(a.t0c, a.t1, e);
      if (k >= 1) this.camAnim = null;
    }
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const kColor = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    const kFocus = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 6);
    let waveT = this.waveStart === null ? -1 : ((now - this.waveStart) / 1000) * 1.25;
    if (waveT > 1.6) { this.waveStart = null; waveT = -1; }
    for (const sys of SYSTEM_ORDER) {
      const want = !this.selected || this.selected === sys ? 1 : 0.2;
      this.emphasis[sys] += (want - this.emphasis[sys]) * kFocus;
      this.baseColors[sys].lerp(this.targetColors[sys], kColor);
      const mat = this.systemMaterials[sys];
      mat.color.copy(DIM).lerp(this.baseColors[sys], this.emphasis[sys]);
      const glow = sys === this.selected ? 0.3 : sys === this.hovered ? 0.2 : 0.03;
      mat.emissive.copy(mat.color).multiplyScalar(glow);
      if (this.fx?.own[sys]) {
        const p = this.probabilities[sys] ?? 0;
        this.fx.own[sys].uPulse.value = this.reducedMotion ? 0 : (this.beat ? 0.6 : 0.32) * this.emphasis[sys];
        this.fx.own[sys].uWave.value = waveT;
        this.fx.own[sys].uGlow.value = 0.22 * THREE.MathUtils.smoothstep(p, 0.35, 0.95) * this.emphasis[sys];
        this.fx.halos[sys].uniforms.uIntensity.value = 0.95 * THREE.MathUtils.smoothstep(p, 0.35, 0.95) * this.emphasis[sys];
      }
    }
    if (this.fx) {
      this.fx.shared.uBeat.value = this.bpm / 60;
      this.fx.update(t);
    }
    let s = 1;
    if (this.beat) {
      const ph = (t * this.bpm / 60) % 1;
      s = 1 + 0.018 * Math.exp(-(((ph - 0.12) / 0.07) ** 2)) + 0.008 * Math.exp(-(((ph - 0.42) / 0.09) ** 2));
    }
    if (this.introStart !== null) {
      const k = Math.min(1, (now - this.introStart) / 1300), e = 1 - (1 - k) ** 4;
      s *= 0.88 + 0.12 * e;
      this.heart.rotation.y = (1 - e) * 0.9;
      if (k >= 1) { this.introStart = null; this.heart.rotation.y = 0; }
    }
    this.heart.scale.setScalar(s);
    if (this._pendingHover) {
      const p = this._pendingHover;
      this._pendingHover = null;
      this._setHover(this._pick(), p);
    }
    this._fadeHiddenLabels();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
}
