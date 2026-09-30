// Interactive Three.js scene: orbit/zoom, camera presets, hover + click selection of vessel systems,
// probability-driven colouring with smooth transitions, optional torso context and heartbeat.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SEGMENTS, SYSTEMS, SYSTEM_ORDER, VIEWS } from '../config/anatomy.js';
import { heatColor, NEUTRAL_VESSEL, pct } from '../ui/colors.js';
import { HeartFrame, ventricleGeometry, taperedTube, ellipsoid, greatVesselLayout, coronaryCurves } from './heart-geometry.js';

const TISSUE = '#8e6c70';
const ATRIUM = '#7c5e63';
const ARTERY_WALL = '#c2b6b1';
const VEIN_WALL = '#6d7a90';
const OUTLINE = '#1f1718';

export class HeartScene {
  constructor(container, { onSelect, onHover } = {}) {
    this.container = container;
    this.onSelect = onSelect || (() => {});
    this.onHover = onHover || (() => {});
    this.probabilities = {};
    this.selected = null;
    this.hovered = null;
    this.beat = false;
    this.bpm = 70;
    this.vesselMeshes = [];
    this.systemMaterials = {};
    this.labels = {};
    this.colorAnim = null;
    this.camAnim = null;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._build();
  }

  _build() {
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
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 5, 6);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(-4, 2, -5);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xffffff, 0x2a2020, 0.45));

    this.camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3.5;
    this.controls.maxDistance = 30;
    this.controls.addEventListener('start', () => { this.camAnim = null; });

    this.heart = new THREE.Group();
    this.scene.add(this.heart);
    this._buildHeart();
    this._buildTorso();
    this.setView('anterior', false);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._bindEvents();
    new ResizeObserver(() => this._resize()).observe(this.container);
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  _buildHeart() {
    const frame = new HeartFrame();
    const tissue = new THREE.MeshPhysicalMaterial({ color: TISSUE, roughness: 0.58, clearcoat: 0.35, clearcoatRoughness: 0.5 });
    const atrium = new THREE.MeshPhysicalMaterial({ color: ATRIUM, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.55 });
    const artery = new THREE.MeshStandardMaterial({ color: ARTERY_WALL, roughness: 0.5 });
    const vein = new THREE.MeshStandardMaterial({ color: VEIN_WALL, roughness: 0.55 });

    const anatomy = new THREE.Group();
    anatomy.add(new THREE.Mesh(ventricleGeometry(frame), tissue));

    const L = greatVesselLayout(frame);
    const place = (geo, pos, mat, lookAt) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos);
      if (lookAt) m.lookAt(lookAt);
      anatomy.add(m);
      return m;
    };
    place(ellipsoid([0.62, 0.7, 0.62]), L.ra, atrium);
    place(ellipsoid([0.78, 0.52, 0.6]), L.la, atrium);
    place(ellipsoid([0.2, 0.16, 0.38]), L.laa, atrium, L.aortaRoot);
    place(ellipsoid([0.2, 0.17, 0.36]), L.raa, atrium, L.aortaRoot);
    const tube = (pts, r0, r1, mat) => anatomy.add(new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3(pts), r0, r1, 64, 24), mat));
    tube(L.aorta, 0.32, 0.27, artery);
    tube(L.pulmonaryTrunk, 0.3, 0.27, artery);
    tube(L.lpa, 0.24, 0.2, artery);
    tube(L.rpa, 0.24, 0.2, artery);
    tube(L.svc, 0.22, 0.22, vein);
    tube(L.ivc, 0.24, 0.24, vein);
    L.pulmonaryVeins.forEach(p => tube(p, 0.1, 0.09, vein));
    this.heart.add(anatomy);

    // Coronary tree: one shared material per vessel system so a single colour update recolours the whole system.
    for (const sys of SYSTEM_ORDER) {
      this.systemMaterials[sys] = new THREE.MeshStandardMaterial({ color: heatColor(0), roughness: 0.32, metalness: 0.0, emissive: new THREE.Color(0x000000) });
    }
    const neutral = new THREE.MeshStandardMaterial({ color: NEUTRAL_VESSEL, roughness: 0.4 });
    // Dark back-face shell = crisp outline, so any vessel colour stays distinct from the myocardium.
    const outline = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });
    // Invisible, thicker tubes are the hover/click targets, so thin distal vessels are easy to pick.
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const curves = coronaryCurves(frame, SEGMENTS, L);
    this.curves = curves;
    for (const seg of SEGMENTS) {
      const mat = seg.system ? this.systemMaterials[seg.system] : neutral;
      const mesh = new THREE.Mesh(taperedTube(curves[seg.id], seg.r[0], seg.r[1]), mat);
      this.heart.add(new THREE.Mesh(taperedTube(curves[seg.id], seg.r[0] * 1.3 + 0.008, seg.r[1] * 1.3 + 0.008, 96, 12), outline));
      mesh.userData = { system: seg.system, segment: seg.id };
      if (seg.system) {
        const hit = new THREE.Mesh(taperedTube(curves[seg.id], 0.14, 0.11, 48, 8), hitMat);
        hit.userData = mesh.userData;
        this.heart.add(hit);
        this.vesselMeshes.push(hit);
      }
      const capGeo = new THREE.SphereGeometry(1, 16, 12);
      for (const [u, r] of [[0, seg.r[0]], [1, seg.r[1]]]) {
        const cap = new THREE.Mesh(capGeo, mat);
        cap.scale.setScalar(r);
        cap.position.copy(curves[seg.id].getPointAt(u));
        cap.userData = mesh.userData;
        this.heart.add(cap);
      }
      this.heart.add(mesh);
      if (seg.label !== undefined) this._addLabel(seg, curves[seg.id], frame);
    }
    const lm = SEGMENTS.find(s => s.id === 'LM');
    const lmEl = document.createElement('div');
    lmEl.className = 'vessel-label muted';
    lmEl.textContent = 'Left main · not modelled';
    const lmLabel = new CSS2DObject(lmEl);
    lmLabel.position.copy(curves[lm.id].getPointAt(0.5)).add(new THREE.Vector3(0.1, 0.35, 0.2));
    this.heart.add(lmLabel);
    this.lmLabel = lmLabel;
    this.lmNormal = new THREE.Vector3(0.2, 0.3, 1).normalize();

    // Centre the heart at the origin.
    const box = new THREE.Box3().setFromObject(anatomy.children[0]);
    const c = box.getCenter(new THREE.Vector3());
    this.heart.position.sub(c);
    this.heartCenter = new THREE.Vector3();
  }

  _addLabel(seg, curve, frame) {
    const el = document.createElement('div');
    el.className = 'vessel-label';
    el.innerHTML = '<span class="sw"></span><span class="t"></span>';
    el.querySelector('.t').textContent = SYSTEMS[seg.system].short;
    el.style.pointerEvents = 'auto';
    el.tabIndex = -1;
    el.addEventListener('click', () => this.onSelect(seg.system));
    const obj = new CSS2DObject(el);
    const p = curve.getPointAt(seg.label);
    const rel = p.clone().sub(frame.base);
    const normal = rel.sub(frame.w.clone().multiplyScalar(rel.dot(frame.w))).normalize();   // radial, outward from the long axis
    obj.position.copy(p).addScaledVector(normal, 0.28);
    this.heart.add(obj);
    this.labels[seg.system] = { el, obj, normal };
  }

  _buildTorso() {
    // Context only: an X-ray-style body shell (fresnel rim), rib cage, sternum and spine around the heart.
    this.torso = new THREE.Group();
    const profile = [[0.3, -5.2], [2.2, -5.1], [2.15, -3.6], [2.45, -1.8], [2.6, 0.2], [2.7, 1.9], [2.95, 2.9], [2.6, 3.45],
      [1.2, 3.8], [0.72, 4.1], [0.66, 4.9], [0.3, 5.0]].map(([x, y]) => new THREE.Vector2(x, y));
    const shell = new THREE.LatheGeometry(profile, 72);
    shell.scale(1, 1, 0.56);
    const rimMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color('#8fa3bd') } },
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
        void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(color, 0.02 + 0.42 * f); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.torso.add(new THREE.Mesh(shell, rimMat));

    const bone = new THREE.MeshStandardMaterial({ color: '#d8d0c2', roughness: 0.7, transparent: true, opacity: 0.42, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const y = 2.55 - i * 0.5;
      const a = 1.2 + Math.min(i, 5) * 0.2 - Math.max(0, i - 7) * 0.12;   // half-width grows then narrows
      const b = 0.72 + Math.min(i, 5) * 0.1;
      for (const side of [-1, 1]) {
        const pts = [];
        for (let k = 0; k <= 24; k++) {
          const th = -Math.PI / 2 + (k / 24) * Math.PI * 0.8;           // spine (posterior) -> anterolateral end (cartilage gap)
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
    this.torso.position.set(-0.55, -0.35, -0.1);   // heart sits left of the midline, behind the lower sternum
    this.torso.renderOrder = 10;
    this.torso.visible = false;
    this.scene.add(this.torso);
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
  }

  _setPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.params.Mesh = {};
    const hits = this.raycaster.intersectObjects(this.vesselMeshes, false);
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
      const mat = this.systemMaterials[sys];
      const on = sys === this.selected ? 0.35 : sys === this.hovered ? 0.22 : 0.06;
      mat.emissive.copy(mat.color).multiplyScalar(on);
      const lab = this.labels[sys];
      if (lab) lab.el.classList.toggle('selected', sys === this.selected);
    }
  }

  setProbabilities(probs, animate = true) {
    const from = {}, to = {};
    for (const sys of SYSTEM_ORDER) {
      if (probs[sys] === undefined) continue;
      from[sys] = this.systemMaterials[sys].color.clone();
      to[sys] = new THREE.Color(heatColor(probs[sys]));
      const lab = this.labels[sys];
      if (lab) {
        lab.el.querySelector('.t').textContent = `${SYSTEMS[sys].short} ${pct(probs[sys])}`;
        lab.el.querySelector('.sw').style.background = heatColor(probs[sys]);
      }
    }
    this.probabilities = { ...probs };
    if (!animate || this.reducedMotion) {
      for (const sys in to) this.systemMaterials[sys].color.copy(to[sys]);
      this._refreshEmphasis();
      return;
    }
    this.colorAnim = { from, to, t0: performance.now(), dur: 650 };
  }

  select(sys) {
    this.selected = sys;
    this._refreshEmphasis();
    if (sys && SYSTEMS[sys]) this.setView(SYSTEMS[sys].view);
  }

  setView(id, animate = true) {
    const view = VIEWS.find(v => v.id === id);
    if (!view) return;
    if (view.torso) this.setTorso(true);
    // Portrait canvases (phones) need more distance so the whole heart fits horizontally.
    const fit = this.camera.aspect < 1 ? 1 / Math.max(this.camera.aspect, 0.5) : 1;
    const dist = (view.torso ? 17 : 11) * fit;
    const target = view.torso ? new THREE.Vector3(-0.3, -0.6, 0) : new THREE.Vector3(0, 0.55, 0);
    const pos = new THREE.Vector3(...view.dir).normalize().multiplyScalar(dist).add(target);
    this.currentView = id;
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
    this.lmLabel.visible = on;
  }

  setTorso(on) { this.torso.visible = on; }
  setBeat(on, bpm) { this.beat = on && !this.reducedMotion; if (bpm) this.bpm = bpm; if (!this.beat) this.heart.scale.setScalar(1); }

  // Labels are HTML overlays and are never occluded, so fade the ones whose vessel faces away from the camera.
  _fadeHiddenLabels() {
    const tmp = new THREE.Vector3();
    const fade = (obj, normal, el) => {
      obj.getWorldPosition(tmp);
      const facing = normal.dot(tmp.subVectors(this.camera.position, tmp).normalize());
      const hidden = facing < 0.05;
      el.style.opacity = hidden ? '0.18' : '';
      el.style.pointerEvents = hidden ? 'none' : 'auto';
    };
    for (const k in this.labels) fade(this.labels[k].obj, this.labels[k].normal, this.labels[k].el);
    fade(this.lmLabel, this.lmNormal, this.lmLabel.element);
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
    const now = performance.now();
    if (this.camAnim) {
      const a = this.camAnim, k = Math.min(1, (now - a.start) / a.dur), e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      this.camera.position.lerpVectors(a.p0, a.p1, e);
      this.controls.target.lerpVectors(a.t0c, a.t1, e);
      if (k >= 1) this.camAnim = null;
    }
    if (this.colorAnim) {
      const a = this.colorAnim, k = Math.min(1, (now - a.t0) / a.dur);
      for (const sys in a.to) this.systemMaterials[sys].color.lerpColors(a.from[sys], a.to[sys], k);
      this._refreshEmphasis();
      if (k >= 1) this.colorAnim = null;
    }
    if (this.beat) {
      const ph = (this.clock.getElapsedTime() * this.bpm / 60) % 1;
      const s = 1 + 0.018 * Math.exp(-(((ph - 0.12) / 0.07) ** 2)) + 0.008 * Math.exp(-(((ph - 0.42) / 0.09) ** 2));
      this.heart.scale.setScalar(s);
    }
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
