// Loads the heart used by both 3D scenes. Preferred source: anatomical meshes derived from BodyParts3D
// (assets/anatomy/heart.glb, built by tools/build_anatomy.py). Fallback: the procedural schematic heart, so the
// viewer still works if the model file is missing. Both paths return the same structure:
//   { source, root, vessels: {LAD|LCX|RCA: Mesh[]}, hits: {…: Mesh[]}, neutral: Mesh[], anchors: {LAD|LCX|RCA|LM: {position, normal}}, radius }
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SEGMENTS, SYSTEM_ORDER } from '../config/anatomy.js';
import { NEUTRAL_VESSEL } from '../ui/colors.js';
import { HeartFrame, ventricleGeometry, taperedTube, ellipsoid, greatVesselLayout, coronaryCurves } from './heart-geometry.js';
import { enhanceTissue, inflate } from './vessel-fx.js';

export const ANATOMY_URL = 'assets/anatomy/heart.glb';
export const THORAX_URL = 'assets/anatomy/thorax.glb';
const COLORS = { tissue: '#7f5357', atrium: '#6e4c52', artery: '#c2b6b1', vein: '#6d7a90', coronaryVein: '#5d6a82', outline: '#1f1718' };

function materials() {
  const muscle = (color, roughness, clearcoat) => enhanceTissue(new THREE.MeshPhysicalMaterial({
    color, roughness, clearcoat, clearcoatRoughness: 0.42, sheen: 0.3, sheenColor: new THREE.Color('#d8877a'), sheenRoughness: 0.5,
  }));
  return {
    tissue: muscle(COLORS.tissue, 0.55, 0.45),
    atrium: muscle(COLORS.atrium, 0.6, 0.32),
    artery: new THREE.MeshStandardMaterial({ color: COLORS.artery, roughness: 0.5 }),
    vein: new THREE.MeshStandardMaterial({ color: COLORS.vein, roughness: 0.55 }),
    coronaryVein: new THREE.MeshStandardMaterial({ color: COLORS.coronaryVein, roughness: 0.5 }),
    neutral: new THREE.MeshStandardMaterial({ color: NEUTRAL_VESSEL, roughness: 0.4 }),
    outline: new THREE.MeshBasicMaterial({ color: COLORS.outline, side: THREE.BackSide }),
    hit: new THREE.MeshBasicMaterial({ visible: false }),
  };
}

export async function loadAnatomy({ url = ANATOMY_URL } = {}) {
  try {
    return await loadGlb(url);
  } catch (err) {
    console.warn('Anatomical model unavailable; using the schematic heart.', err);
    return buildProcedural();
  }
}

async function loadGlb(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const M = materials();
  const root = gltf.scene;
  const out = { source: 'bodyparts3d', root, vessels: {}, hits: {}, outlines: {}, neutral: [], anchors: {}, attribution: gltf.asset?.extras?.attribution };
  const matFor = { tissue_ventricles: M.tissue, tissue_atria: M.atrium, artery_great: M.artery, vein_great: M.vein, vein_coronary: M.coronaryVein };
  const vesselNodes = [];
  root.traverse(obj => {
    if (obj.name.startsWith('anchor_')) {
      const n = obj.userData.normal || [0, 0, 1];
      out.anchors[obj.name.slice(7)] = { position: obj.position.clone(), normal: new THREE.Vector3(...n).normalize() };
    }
    if (!obj.isMesh) return;
    if (!obj.geometry.attributes.normal) obj.geometry.computeVertexNormals();   // heart.glb ships normals
    if (matFor[obj.name]) obj.material = matFor[obj.name];
    else if (obj.name.startsWith('vessel_')) vesselNodes.push(obj);
  });
  for (const mesh of vesselNodes) {
    const sys = mesh.name.slice(7);
    const outline = new THREE.Mesh(inflate(mesh.geometry, 0.012), M.outline);
    mesh.parent.add(outline);
    if (SYSTEM_ORDER.includes(sys)) {
      mesh.userData = { system: sys };
      const hit = new THREE.Mesh(inflate(mesh.geometry, 0.07), M.hit);
      hit.userData = { system: sys };
      mesh.parent.add(hit);
      (out.vessels[sys] ||= []).push(mesh);
      (out.hits[sys] ||= []).push(hit);
      (out.outlines[sys] ||= []).push(outline);
    } else {
      mesh.material = M.neutral;
      out.neutral.push(mesh);
    }
  }
  const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere());
  out.radius = sphere.radius;
  return out;
}

/** Optional skeletal context (ribs, sternum, spine) in the same coordinate frame as heart.glb. */
export async function loadThorax(url = THORAX_URL) {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.traverse(o => { if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); });
    return gltf.scene;
  } catch {
    return null;
  }
}

function buildProcedural() {
  const M = materials();
  const frame = new HeartFrame();
  const root = new THREE.Group();
  const anatomy = new THREE.Group();
  anatomy.add(new THREE.Mesh(ventricleGeometry(frame), M.tissue));
  const L = greatVesselLayout(frame);
  const place = (geo, pos, mat, lookAt) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    if (lookAt) m.lookAt(lookAt);
    anatomy.add(m);
  };
  place(ellipsoid([0.62, 0.7, 0.62]), L.ra, M.atrium);
  place(ellipsoid([0.78, 0.52, 0.6]), L.la, M.atrium);
  place(ellipsoid([0.2, 0.16, 0.38]), L.laa, M.atrium, L.aortaRoot);
  place(ellipsoid([0.2, 0.17, 0.36]), L.raa, M.atrium, L.aortaRoot);
  const tube = (pts, r0, r1, mat) => anatomy.add(new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3(pts), r0, r1, 64, 24), mat));
  tube(L.aorta, 0.32, 0.27, M.artery);
  tube(L.pulmonaryTrunk, 0.3, 0.27, M.artery);
  tube(L.lpa, 0.24, 0.2, M.artery);
  tube(L.rpa, 0.24, 0.2, M.artery);
  tube(L.svc, 0.22, 0.22, M.vein);
  tube(L.ivc, 0.24, 0.24, M.vein);
  L.pulmonaryVeins.forEach(p => tube(p, 0.1, 0.09, M.vein));
  root.add(anatomy);

  const out = { source: 'procedural', root, vessels: {}, hits: {}, outlines: {}, neutral: [], anchors: {} };
  const curves = coronaryCurves(frame, SEGMENTS, L);
  const capGeo = new THREE.SphereGeometry(1, 16, 12);
  for (const seg of SEGMENTS) {
    const meshes = [new THREE.Mesh(taperedTube(curves[seg.id], seg.r[0], seg.r[1]), M.neutral)];
    const outline = new THREE.Mesh(taperedTube(curves[seg.id], seg.r[0] * 1.3 + 0.008, seg.r[1] * 1.3 + 0.008, 96, 12), M.outline);
    root.add(outline);
    if (seg.system) (out.outlines[seg.system] ||= []).push(outline);
    for (const [u, r] of [[0, seg.r[0]], [1, seg.r[1]]]) {
      const cap = new THREE.Mesh(capGeo, M.neutral);
      cap.scale.setScalar(r);
      cap.position.copy(curves[seg.id].getPointAt(u));
      meshes.push(cap);
    }
    meshes.forEach(m => root.add(m));
    if (seg.system) {
      meshes.forEach(m => { m.userData = { system: seg.system }; });
      (out.vessels[seg.system] ||= []).push(...meshes);
      const hit = new THREE.Mesh(taperedTube(curves[seg.id], 0.14, 0.11, 48, 8), M.hit);
      hit.userData = { system: seg.system };
      root.add(hit);
      (out.hits[seg.system] ||= []).push(hit);
    } else {
      out.neutral.push(...meshes);
    }
    const radial = p => {
      const rel = p.clone().sub(frame.base);
      return rel.sub(frame.w.clone().multiplyScalar(rel.dot(frame.w))).normalize();
    };
    if (seg.label !== undefined) {
      const p = curves[seg.id].getPointAt(seg.label);
      out.anchors[seg.system] = { position: p, normal: radial(p) };
    }
    if (seg.id === 'LM') {
      out.anchors.LM = { position: curves[seg.id].getPointAt(0.5).add(new THREE.Vector3(0.1, 0.35, 0.2)), normal: new THREE.Vector3(0.2, 0.3, 1).normalize() };
    }
  }
  // Centre on the ventricles (as the original viewer did).
  const c = new THREE.Box3().setFromObject(anatomy.children[0]).getCenter(new THREE.Vector3());
  root.position.sub(c);
  const wrapper = new THREE.Group();
  wrapper.add(root);
  root.updateMatrix();
  for (const a of Object.values(out.anchors)) a.position.applyMatrix4(root.matrix);
  out.root = wrapper;
  // Anchors are now in wrapper space; meshes stay parented under the shifted root.
  out.radius = new THREE.Box3().setFromObject(wrapper).getBoundingSphere(new THREE.Sphere()).radius;
  return out;
}
