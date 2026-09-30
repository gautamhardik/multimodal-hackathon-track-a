// Cinematic, non-interactive heart for the landing page. Scroll code drives `pose` (position/scale/rotation)
// and `focus` (which artery is emphasised); the scene eases towards them every frame.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SYSTEM_ORDER } from '../config/anatomy.js';
import { heatColor } from '../ui/colors.js';
import { loadAnatomy } from './anatomy-loader.js';
import { installVesselFx } from './vessel-fx.js';

const DIM = new THREE.Color('#5e5052');
const yieldToMain = () => new Promise(r => setTimeout(r, 0));
const TARGET_RADIUS = 1.55;

export class StoryScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.pose = { x: 0.42, y: 0, scale: 1, rotY: 0, rotX: 0.08, spin: 1 };
    this.focus = null;
    this.probs = {};
    this.bpm = 72;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.pointer = new THREE.Vector2();
    this.tilt = new THREE.Vector2();
    this.spinAngle = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    const key = new THREE.DirectionalLight('#ffe6d6', 2.1);
    key.position.set(4, 5, 6);
    const rim = new THREE.DirectionalLight('#ff5a36', 3.2);
    rim.position.set(-5, 1.5, -4);
    const back = new THREE.DirectionalLight('#ff8a5c', 1.2);
    back.position.set(3, -2, -6);
    const fill = new THREE.DirectionalLight('#9db6ff', 0.35);
    fill.position.set(-6, 1, 5);
    this.scene.add(key, rim, back, fill);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, 0, 9.5);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    this.materials = Object.fromEntries(SYSTEM_ORDER.map(s => [s, new THREE.MeshPhysicalMaterial({
      color: heatColor(0.5), roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.3, emissive: new THREE.Color(0),
    })]));
    this.targetColors = Object.fromEntries(SYSTEM_ORDER.map(s => [s, new THREE.Color(heatColor(0.5))]));
    this.emphasis = Object.fromEntries(SYSTEM_ORDER.map(s => [s, 1]));

    window.addEventListener('pointermove', e => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    }, { passive: true });
    window.addEventListener('resize', () => this._resize());
    this._resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this._tick());
  }

  async load() {
    const a = await loadAnatomy();
    await yieldToMain();
    this.anatomy = a;
    const holder = new THREE.Group();
    holder.add(a.root);
    const sphere = new THREE.Box3().setFromObject(a.root).getBoundingSphere(new THREE.Sphere());
    a.root.position.sub(sphere.center);
    holder.scale.setScalar(TARGET_RADIUS / sphere.radius);
    for (const sys of SYSTEM_ORDER) for (const m of a.vessels[sys] || []) m.material = this.materials[sys];
    await yieldToMain();
    this.fx = installVesselFx(a, this.materials, { haloWidth: sphere.radius * 0.018 });
    await yieldToMain();
    this.pivot.add(holder);
    this.paused = true;
    try {
      await Promise.race([this.renderer.compileAsync(this.scene, this.camera), new Promise(r => setTimeout(r, 3000))]);
    } catch { /* compile on first render instead */ }
    this.paused = false;
    return a;
  }

  setProbabilities(probs) {
    this.probs = { ...probs };
    for (const sys of SYSTEM_ORDER) if (probs[sys] !== undefined) this.targetColors[sys].set(heatColor(probs[sys]));
  }

  setFocus(sys) { this.focus = sys; }

  /** Draw an artery from its ostium: f = 0 (hidden) .. 1 (complete). */
  setReveal(sys, f) { this.fx?.setReveal(sys, f); }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Beat timing for the heartbeat sound (scene seconds and rate). */
  beatClock() { return this.paused ? null : { t: this.clock.elapsedTime, bpm: this.bpm }; }

  _tick() {
    if (this.paused) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    const p = this.pose;
    // Horizontal offset is expressed as a fraction of the visible half-width at the heart's depth.
    const halfW = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z * this.camera.aspect;
    this.pivot.position.set(p.x * halfW, p.y * halfW / this.camera.aspect, 0);
    if (!this.reduced) {
      this.spinAngle += dt * 0.16 * p.spin;
      this.tilt.lerp(this.pointer, 0.04);
    }
    const beat = this.reduced ? 0 : (() => {
      const ph = (t * this.bpm / 60) % 1;
      return 0.022 * Math.exp(-(((ph - 0.1) / 0.06) ** 2)) + 0.01 * Math.exp(-(((ph - 0.38) / 0.08) ** 2));
    })();
    this.pivot.scale.setScalar(p.scale * (1 + beat));
    this.pivot.rotation.set(p.rotX + this.tilt.y * 0.12, p.rotY + this.spinAngle + this.tilt.x * 0.2, 0);

    const k = 1 - Math.exp(-dt * 6);
    for (const sys of SYSTEM_ORDER) {
      const want = this.focus && this.focus !== sys ? 0 : 1;
      this.emphasis[sys] += (want - this.emphasis[sys]) * k;
      const m = this.materials[sys];
      m.color.copy(DIM).lerp(this.targetColors[sys], this.emphasis[sys]);
      const glow = this.focus === sys ? 0.3 + 0.25 * beat / 0.022 : 0.06;
      m.emissive.copy(m.color).multiplyScalar(glow * this.emphasis[sys]);
      if (this.fx?.own[sys]) {
        const risk = THREE.MathUtils.smoothstep(this.probs[sys] ?? 0, 0.35, 0.95);
        this.fx.own[sys].uPulse.value = this.reduced ? 0 : 0.5 * this.emphasis[sys];
        this.fx.own[sys].uGlow.value = 0.25 * risk * this.emphasis[sys];
        this.fx.halos[sys].uniforms.uIntensity.value = (0.35 + 0.75 * risk) * this.emphasis[sys];
      }
    }
    if (this.fx) {
      this.fx.shared.uBeat.value = this.bpm / 60;
      this.fx.update(t);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
