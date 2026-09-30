// Procedural, anatomically oriented heart. The ventricles are an analytic surface around the long axis, so coronary
// paths defined in [t, angle] coordinates (see config/anatomy.js) always sit exactly in their grooves.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, s) => Math.exp(-0.5 * (x / s) ** 2);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class HeartFrame {
  constructor() {
    this.base = new THREE.Vector3(0, 0, 0);                        // centre of the atrioventricular (AV) plane
    this.w = new THREE.Vector3(0.52, -0.66, 0.54).normalize();     // long axis: base -> apex (left, inferior, anterior)
    const Z = new THREE.Vector3(0, 0, 1);
    this.u = Z.clone().sub(this.w.clone().multiplyScalar(Z.dot(this.w))).normalize();   // anterior
    this.v = new THREE.Vector3().crossVectors(this.w, this.u);
    if (this.v.x < 0) this.v.negate();                             // left lateral
    this.L = 2.6;                                                  // base-to-apex length
    this.Rb = 1.1;                                                 // basal radius
  }

  aivAngle(t) { return (22 - 14 * t) * DEG; }     // anterior interventricular groove
  pivAngle(t) { return (192 + 6 * t) * DEG; }     // posterior interventricular groove

  radius(t, a) {
    let prof;
    if (t >= 0) {
      const shoulder = 0.9 + 0.1 * Math.sin(Math.min(t / 0.22, 1) * Math.PI / 2);
      prof = shoulder * Math.pow(Math.max(0, 1 - Math.pow(t, 2.1)), 0.52);
    } else {
      const s = t / -0.16;                                         // dome closing the base, hidden by atria/vessels
      prof = 0.9 * Math.sqrt(Math.max(0, 1 - s * s));
    }
    let r = this.Rb * prof;
    r *= 1 + 0.07 * Math.cos(a - 70 * DEG);                        // left-ventricular bulk
    r *= 1 - 0.1 * Math.pow(Math.max(0, Math.cos(a - Math.PI)), 3); // flat diaphragmatic surface
    r *= 1 + 0.012 * Math.sin(3 * a + 7 * t) + 0.008 * Math.sin(5 * a - 11 * t);  // subtle organic irregularity
    const fade = t < 0 ? 0 : smoothstep(0, 0.06, t) * (1 - smoothstep(0.86, 0.99, t));
    r -= 0.05 * fade * (gauss(angDiff(a, this.aivAngle(t)), 7 * DEG) + gauss(angDiff(a, this.pivAngle(t)), 8 * DEG));
    r -= 0.045 * gauss(t, 0.03);                                   // atrioventricular groove
    return r;
  }

  dir(a) { return this.u.clone().multiplyScalar(Math.cos(a) * 0.93).add(this.v.clone().multiplyScalar(Math.sin(a))); }
  axial(t) { return this.base.clone().addScaledVector(this.w, t * this.L); }
  point(t, aDeg, offset = 0) {
    const a = aDeg * DEG;
    return this.axial(t).addScaledVector(this.dir(a), this.radius(t, a) + offset);
  }
}

export function ventricleGeometry(frame, nt = 150, na = 180) {
  const t0 = -0.16;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= nt; i++) {
    const t = t0 + (1 - t0) * i / nt;
    for (let j = 0; j <= na; j++) {
      const p = frame.point(t, 360 * j / na);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < nt; i++) {
    for (let j = 0; j < na; j++) {
      const a = i * (na + 1) + j, b = a + na + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Weld the seam normals (first/last column) so shading is continuous.
  const n = g.attributes.normal;
  for (let i = 0; i <= nt; i++) {
    const a = i * (na + 1), b = a + na;
    const avg = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, avg.x, avg.y, avg.z);
    n.setXYZ(b, avg.x, avg.y, avg.z);
  }
  // The side facing inward at the degenerate apex/dome must still face out.
  const probe = frame.point(0.5, 90);
  const probeDir = probe.clone().sub(frame.axial(0.5));
  const k = Math.round(nt * (0.5 - t0) / (1 - t0)) * (na + 1) + Math.round(na / 4);
  if (new THREE.Vector3(n.getX(k), n.getY(k), n.getZ(k)).dot(probeDir) < 0) {
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const tmp = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = tmp; }
  }
  return g;
}

// Tube whose radius tapers linearly from r0 to r1, with rounded end caps.
export function taperedTube(curve, r0, r1, segments = 96, radial = 14) {
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [], nrm = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    curve.getPointAt(u, P);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= radial; j++) {
      const v = j / radial * Math.PI * 2;
      N.copy(frames.normals[i]).multiplyScalar(-Math.cos(v)).addScaledVector(frames.binormals[i], Math.sin(v)).normalize();
      nrm.push(N.x, N.y, N.z);
      pos.push(P.x + r * N.x, P.y + r * N.y, P.z + r * N.z);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export function ellipsoid(radii, segW = 48, segH = 32) {
  const g = new THREE.SphereGeometry(1, segW, segH);
  g.scale(radii[0], radii[1], radii[2]);
  return g;
}

// Great vessels and atria, positioned relative to the heart frame. Returns named curves / transforms.
export function greatVesselLayout(frame) {
  const Y = new THREE.Vector3(0, 1, 0);
  const add = (p, x, y, z) => p.clone().add(new THREE.Vector3(x, y, z));
  const aortaRoot = frame.axial(-0.1).addScaledVector(frame.dir(-40 * DEG), 0.3);
  const aorta = [aortaRoot, add(aortaRoot, -0.12, 0.8, 0.12), add(aortaRoot, -0.1, 1.55, 0.02), add(aortaRoot, 0.25, 2.1, -0.35),
    add(aortaRoot, 0.72, 2.0, -0.78), add(aortaRoot, 0.9, 1.35, -1.0), add(aortaRoot, 0.92, 0.2, -1.05), add(aortaRoot, 0.92, -1.2, -1.05)];
  const ptRoot = frame.axial(-0.06).addScaledVector(frame.dir(12 * DEG), 0.68);
  const ptBif = add(ptRoot, 0.3, 1.2, -0.45);
  const pulmonaryTrunk = [ptRoot, add(ptRoot, 0.12, 0.6, -0.05), ptBif];
  const lpa = [ptBif, add(ptBif, 0.45, 0.12, -0.25), add(ptBif, 0.95, 0.05, -0.45)];
  const rpa = [ptBif, add(ptBif, -0.5, 0.18, -0.25), add(ptBif, -1.35, 0.1, -0.35)];
  const ra = frame.axial(-0.1).addScaledVector(frame.dir(-100 * DEG), 0.95).addScaledVector(Y, 0.05);
  const la = frame.axial(-0.28).addScaledVector(frame.dir(172 * DEG), 0.55).addScaledVector(Y, 0.12);
  const svc = [add(ra, 0.1, 0.45, -0.05), add(ra, 0.12, 1.2, -0.1), add(ra, 0.12, 2.0, -0.15)];
  const ivc = [add(ra, 0.05, -0.45, -0.15), add(ra, 0.05, -1.2, -0.2)];
  const laa = frame.axial(-0.1).addScaledVector(frame.dir(78 * DEG), 1.02).addScaledVector(Y, 0.12);
  const raa = frame.axial(-0.1).addScaledVector(frame.dir(-50 * DEG), 0.9).addScaledVector(Y, 0.18);
  const pulmonaryVeins = [
    [add(la, 0.45, 0.2, -0.25), add(la, 0.95, 0.35, -0.35)],
    [add(la, 0.45, -0.15, -0.25), add(la, 0.95, -0.2, -0.35)],
    [add(la, -0.4, 0.2, -0.3), add(la, -0.9, 0.3, -0.35)],
    [add(la, -0.4, -0.15, -0.3), add(la, -0.9, -0.2, -0.35)],
  ];
  // Coronary ostia on the aortic root (left and right sinuses).
  const leftOstium = add(aortaRoot, 0.2, 0.18, -0.18);
  const rightOstium = add(aortaRoot, -0.1, 0.16, 0.26);
  return { aortaRoot, aorta, pulmonaryTrunk, lpa, rpa, ra, la, svc, ivc, laa, raa, pulmonaryVeins, leftOstium, rightOstium };
}

// Build a coronary segment's 3D curve from its surface path (and parent / aortic origin when present).
export function coronaryCurves(frame, segments, layout) {
  const out = {};
  const surfaceCurve = pts => new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], 0)), false, 'centripetal');
  const byId = Object.fromEntries(segments.map(s => [s.id, s]));
  const params = {};
  const order = [...segments].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
  for (const seg of order) {
    let ta = seg.path.map(p => [p[0], p[1]]);
    if (seg.parent) {
      const q = params[seg.parent].getPointAt(Math.min(0.999, seg.at));
      ta = [[q.x, q.y], ...ta];
    }
    const offset = (seg.r[0] + seg.r[1]) * 0.35;
    let pts = [];
    if (ta.length > 1) {
      const pc = surfaceCurve(ta);
      params[seg.id] = pc;
      const n = Math.max(24, ta.length * 18);
      for (let i = 0; i <= n; i++) {
        const q = pc.getPointAt(i / n);
        pts.push(frame.point(q.x, q.y, offset));
      }
    } else {
      pts = [frame.point(ta[0][0], ta[0][1], offset)];   // single anchor (e.g. left main ends at the bifurcation)
    }
    if (seg.origin === 'aorta-left') {
      const end = frame.point(ta[0][0], ta[0][1], offset);
      const mid = layout.leftOstium.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.05, 0.12));
      pts = [layout.leftOstium, mid, end];
    } else if (seg.origin === 'aorta-right') {
      const mid = layout.rightOstium.clone().lerp(pts[0], 0.5).add(new THREE.Vector3(-0.05, 0.02, 0.08));
      pts = [layout.rightOstium, mid, ...pts];
    }
    out[seg.id] = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  }
  void byId;
  return out;
}
