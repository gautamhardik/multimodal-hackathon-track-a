// Shader add-ons shared by the explorer and the landing scene.
// Every effect is driven by the distance of a fragment from the artery's ostium (measured in the anatomy's own
// frame, so it is unaffected by camera or pose):
//   - pulse:  pressure waves travelling from the ostium outwards, one per heartbeat (blood flow);
//   - glow:   emissive + fresnel halo whose strength follows the calibrated probability (risk);
//   - reveal: the artery is drawn from the ostium outwards up to a distance, with a bright leading tip;
//   - wave:   a single bright ring that sweeps the vessel when a new prediction arrives.
import * as THREE from 'three';

/** Uniforms shared by all vessels of one scene. */
export function createFxUniforms() {
  return { uTime: { value: 0 }, uBeat: { value: 70 / 60 }, uRootInv: { value: new THREE.Matrix4() } };
}

const VERT_PARS = /* glsl */`
uniform mat4 uRootInv;
uniform vec3 uOrigin;
varying float vDist;`;
const VERT_MAIN = /* glsl */`
vDist = length((uRootInv * modelMatrix * vec4(transformed, 1.0)).xyz - uOrigin);`;

/** Patch a MeshStandard/Physical material of one vessel system. Returns its per-system uniforms. */
export function enhanceVessel(material, shared) {
  const own = {
    uOrigin: { value: new THREE.Vector3() }, uScale: { value: 1 }, uGlow: { value: 0 }, uPulse: { value: 0.35 },
    uReveal: { value: 1e6 }, uWave: { value: -1 },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform float uTime, uBeat, uScale, uGlow, uPulse, uReveal, uWave;
        varying float vDist;`)
      .replace('#include <clipping_planes_fragment>', /* glsl */`#include <clipping_planes_fragment>
        if (vDist > uReveal) discard;`)
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        float d = vDist / uScale;
        float ph = fract(uTime * uBeat - d * 1.35);
        float pulse = exp(-ph * 14.0) * smoothstep(0.0, 0.025, ph);
        float wave = uWave >= 0.0 ? exp(-pow((d - uWave) * 6.0, 2.0)) : 0.0;
        float tip = uReveal < 1e5 ? exp(-pow((vDist - uReveal) / (0.035 * uScale), 2.0)) : 0.0;
        totalEmissiveRadiance += diffuseColor.rgb * (uGlow + uPulse * pulse + 1.3 * wave) + vec3(1.0, 0.86, 0.78) * tip * 1.4;`);
  };
  material.customProgramCacheKey = () => 'vessel-fx-v1';
  return own;
}

/** Make any built-in material (e.g. the dark outline shell) respect a vessel's reveal distance. */
export function revealOnly(material, shared, own) {
  const m = material.clone();
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uRootInv: shared.uRootInv, uOrigin: own.uOrigin, uReveal: own.uReveal });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReveal; varying float vDist;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vDist > uReveal) discard;');
  };
  m.customProgramCacheKey = () => 'reveal-only-v1';
  return m;
}

/** Additive fresnel shell around a vessel: the visible "risk glow". Shares the vessel's reveal/origin uniforms. */
export function haloMaterial(shared, own) {
  const uniforms = { ...shared, uOrigin: own.uOrigin, uScale: own.uScale, uReveal: own.uReveal,
    uColor: { value: new THREE.Color('#ff3b2f') }, uIntensity: { value: 0 } };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`${VERT_PARS}
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 transformed = position;
        ${VERT_MAIN}
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uIntensity, uReveal, uTime, uBeat;
      varying float vDist; varying vec3 vN; varying vec3 vV;
      void main() {
        if (vDist > uReveal || uIntensity <= 0.001) discard;
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        float beat = 0.82 + 0.18 * exp(-fract(uTime * uBeat) * 5.0);
        gl_FragColor = vec4(uColor, clamp(f * uIntensity * beat, 0.0, 1.0));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** Subtle warm edge light on the myocardium: reads as translucency at the silhouette (cheap fake subsurface). */
export function enhanceTissue(material, strength = 0.2) {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
      float rimT = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
      totalEmissiveRadiance += vec3(1.0, 0.36, 0.26) * rimT * ${strength.toFixed(3)};`);
  };
  material.customProgramCacheKey = () => `tissue-fx-${strength}`;
  return material;
}

function forEachVertex(meshes, rootInv, fn) {
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    m.multiplyMatrices(rootInv, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) fn(v.fromBufferAttribute(pos, i).applyMatrix4(m));
  }
}

/** Ostium of each system and its farthest reach, in the anatomy root's frame. */
export function vesselGeometry(anatomy) {
  anatomy.root.updateMatrixWorld(true);
  const rootInv = anatomy.root.matrixWorld.clone().invert();
  const out = {};
  let lm = null;
  if (anatomy.neutral.length) {
    const c = new THREE.Vector3(); let n = 0;
    forEachVertex(anatomy.neutral, rootInv, v => { c.add(v); n++; });
    lm = c.divideScalar(Math.max(n, 1));
  }
  for (const [sys, meshes] of Object.entries(anatomy.vessels)) {
    let origin = sys !== 'RCA' && lm ? lm.clone() : null;
    if (!origin) {   // right coronary: its highest point is the ostium in the right aortic sinus
      let best = -Infinity;
      forEachVertex(meshes, rootInv, v => { if (v.y > best) { best = v.y; origin = v.clone(); } });
    }
    let reach = 0;
    forEachVertex(meshes, rootInv, v => { reach = Math.max(reach, v.distanceTo(origin)); });
    out[sys] = { origin, reach };
  }
  return out;
}

/** Copy of `geometry` pushed `d` units outwards along its vertex normals (outline shells and pick proxies). */
export function inflate(geometry, d) {
  const g = geometry.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * d, p.getY(i) + n.getY(i) * d, p.getZ(i) + n.getZ(i) * d);
  p.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/** Wire every effect into a loaded anatomy. `materials` = one MeshStandardMaterial per vessel system. */
export function installVesselFx(anatomy, materials, { haloWidth = 0.05 } = {}) {
  const shared = createFxUniforms();
  const geo = vesselGeometry(anatomy);
  const own = {}, halos = {};
  for (const sys of Object.keys(anatomy.vessels)) {
    own[sys] = enhanceVessel(materials[sys], shared);
    own[sys].uOrigin.value.copy(geo[sys].origin);
    own[sys].uScale.value = geo[sys].reach;
    const outlines = anatomy.outlines?.[sys] || [];
    if (outlines.length) {
      const m = revealOnly(outlines[0].material, shared, own[sys]);
      outlines.forEach(o => { o.material = m; });
    }
    halos[sys] = haloMaterial(shared, own[sys]);
    for (const mesh of anatomy.vessels[sys]) {
      const halo = new THREE.Mesh(inflate(mesh.geometry, haloWidth / mesh.scale.x), halos[sys]);
      halo.position.copy(mesh.position);
      halo.quaternion.copy(mesh.quaternion);
      halo.scale.copy(mesh.scale);
      halo.renderOrder = 2;
      mesh.parent.add(halo);
    }
  }
  return {
    shared, own, halos, reach: Object.fromEntries(Object.entries(geo).map(([k, g]) => [k, g.reach])),
    /** Per frame: time and the anatomy frame (the scene may move/scale the heart). */
    update(t) {
      shared.uTime.value = t;
      anatomy.root.updateMatrixWorld();
      shared.uRootInv.value.copy(anatomy.root.matrixWorld).invert();
    },
    /** Probability -> glow (emissive) and halo strength; low estimates stay matte. */
    setRisk(sys, p) {
      if (!own[sys]) return;
      const k = THREE.MathUtils.smoothstep(p, 0.35, 0.95);
      own[sys].uGlow.value = 0.22 * k;
      halos[sys].uniforms.uIntensity.value = 0.95 * k;
    },
    /** Reveal fraction 0..1 of the artery length (1 = fully drawn). */
    setReveal(sys, f) {
      if (!own[sys]) return;
      own[sys].uReveal.value = f >= 0.999 ? 1e6 : Math.max(0, f) * geo[sys].reach;
    },
  };
}
