"""Build the 3D anatomy used by the web app from BodyParts3D (PART-OF tree, 99% polygon-reduced OBJ).

    python tools/build_anatomy.py                 # download only the needed parts (~7 MB, HTTP range requests), then build
    python tools/build_anatomy.py SOURCE ELEMENTS # SOURCE = partof_BP3D_4.0_obj_99.zip or a folder of FJ*.obj files,
                                                  # ELEMENTS = partof_element_parts.txt
    add --heart-only to skip the thorax.

Writes frontend/assets/anatomy/heart.glb (heart, great vessels, coronary arteries grouped per model target) and
frontend/assets/anatomy/thorax.glb (ribs, costal cartilages, sternum, thoracic spine) in the viewer's frame:
+x = patient's left, +y = superior, +z = anterior, heart centred at the origin.

Attribution: BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution 4.0 International.
Meshes here are cropped, vertex-clustered and regrouped; no clinical data is involved.
"""
import json
import re
import struct
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np

OUT_DIR = Path(__file__).resolve().parents[1] / 'frontend' / 'assets' / 'anatomy'
CACHE_DIR = Path(__file__).resolve().parent / '.bodyparts3d_cache'
BASE_URL = 'https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/'
ZIP_NAME = 'partof_BP3D_4.0_obj_99.zip'
ATTRIBUTION = ('BodyParts3D, (c) The Database Center for Life Science, licensed under CC Attribution 4.0 International. '
               'Cropped, simplified and regrouped for the Coronary Risk Explorer.')
TARGET_RADIUS = 3.15          # matches the schematic heart, so camera framing is identical

# FMA concept ids (PART-OF tree). Each group is the union of the listed concepts' element meshes.
GROUPS = {
    'vessel_LAD': ['FMA3862', 'FMA3860', 'FMA3868', 'FMA3872', 'FMA3874', 'FMA3876'],
    'vessel_LCX': ['FMA3895'],
    'vessel_RCA': ['FMA3802', 'FMA3815', 'FMA3818', 'FMA3837', 'FMA3840'],
    'vessel_LM': ['FMA3855'],
    'tissue_atria': ['FMA9531', 'FMA9457'],                        # walls of left / right atrium
    'artery_great': ['FMA3736', 'FMA3768', 'FMA8612'],             # ascending aorta, arch, pulmonary trunk
    'vein_great': ['FMA4720', 'FMA10951'],                         # superior / inferior vena cava
    'vein_coronary': ['FMA4706', 'FMA4708', 'FMA4712', 'FMA4716'],  # coronary sinus and cardiac veins
}
CAVITIES = {'LV': 'FMA9466', 'RV': 'FMA9291'}                      # cavities of left / right ventricle
DEFAULT_WALL_MM = {'LV': 9.0, 'RV': 4.5}                           # typical adult wall thickness away from vessels
# Label anchors use the main trunk of each system.
ANCHOR_CONCEPTS = {'LAD': ['FMA3862'], 'LCX': ['FMA3895'], 'RCA': ['FMA3802'], 'LM': ['FMA3855']}
THORAX_PATTERN = re.compile(r'\b(rib|costal cartilage|sternum|manubrium|body of sternum|xiphoid|thoracic vertebra)\b', re.I)
CLUSTER_MM = {'heart': 0.0, 'ventricles': 1.9, 'thorax': 2.2}   # vertex-clustering cell size (0 = keep all vertices)


def read_elements(path):
    concept_elements, names = defaultdict(list), {}
    for line in Path(path).read_text(encoding='utf-8').splitlines()[1:]:
        parts = line.split('\t')
        if len(parts) >= 3:
            concept_elements[parts[0]].append(parts[2].strip())
            names[parts[0]] = parts[1]
    return concept_elements, names


def thorax_concepts(names):
    return [c for c, n in names.items() if THORAX_PATTERN.search(n)]


def fetch_needed_parts(cache=CACHE_DIR):
    """Download the element list, read the zip's central directory from its tail, then fetch only the needed OBJ
    entries with parallel HTTP range requests. Returns (folder of OBJ files, element list path)."""
    import urllib.request
    import zlib
    from concurrent.futures import ThreadPoolExecutor

    def http(url, rng=None):
        for attempt in range(6):
            try:
                req = urllib.request.Request(url, headers={'Range': f'bytes={rng[0]}-{rng[1]}'} if rng else {})
                with urllib.request.urlopen(req, timeout=180) as r:
                    return r.read(), r.headers
            except Exception:  # noqa: BLE001 - flaky archive server; retry
                if attempt == 5:
                    raise
    objs = cache / 'objs'
    objs.mkdir(parents=True, exist_ok=True)
    elements_path = cache / 'partof_element_parts.txt'
    if not elements_path.exists():
        elements_path.write_bytes(http(BASE_URL + 'partof_element_parts.txt')[0])
    concept_elements, names = read_elements(elements_path)
    concepts = [c for cs in GROUPS.values() for c in cs] + list(CAVITIES.values()) + thorax_concepts(names)
    wanted = sorted({e for c in concepts for e in concept_elements.get(c, [])})
    missing = [e for e in wanted if not (objs / f'{e}.obj').exists()]
    if missing:
        _, headers = http(BASE_URL + ZIP_NAME, (0, 0))
        total = int(headers['Content-Range'].split('/')[-1])
        tail = http(BASE_URL + ZIP_NAME, (total - 262144, total - 1))[0]
        base = total - len(tail)
        eocd = tail.rfind(b'PK\x05\x06')
        cd_size, cd_off = struct.unpack('<II', tail[eocd + 12:eocd + 20])
        entries, p = {}, cd_off - base
        while p < cd_off - base + cd_size:
            cs, us, fnl, exl, cml = struct.unpack('<II', tail[p + 20:p + 28]) + struct.unpack('<HHH', tail[p + 28:p + 34])
            method, lho = struct.unpack('<H', tail[p + 10:p + 12])[0], struct.unpack('<I', tail[p + 42:p + 46])[0]
            name = tail[p + 46:p + 46 + fnl].decode()
            entries[Path(name).stem] = (lho, cs, us, method, len(name))
            p += 46 + fnl + exl + cml

        def get(e):
            lho, cs, us, method, nl = entries[e]
            raw = http(BASE_URL + ZIP_NAME, (lho, lho + 30 + nl + 512 + cs))[0]
            fnl, exl = struct.unpack('<HH', raw[26:30])
            data = raw[30 + fnl + exl:30 + fnl + exl + cs]
            data = zlib.decompress(data, -15) if method == 8 else data
            assert len(data) == us, f'{e}: size mismatch'
            (objs / f'{e}.obj').write_bytes(data)

        print(f'fetching {len(missing)} BodyParts3D parts ...')
        with ThreadPoolExecutor(12) as ex:
            list(ex.map(get, missing))
    return objs, elements_path


def parse_obj(text):
    verts, faces = [], []
    for line in text.splitlines():
        if line.startswith('v '):
            verts.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('f '):
            idx = [int(tok.split('/')[0]) for tok in line.split()[1:]]
            for k in range(1, len(idx) - 1):
                faces.append([idx[0], idx[k], idx[k + 1]])
    v = np.asarray(verts, dtype=np.float64)
    f = np.asarray(faces, dtype=np.int64)
    f = np.where(f < 0, f + len(v), f - 1)
    return v, f


class Archive:
    """The BodyParts3D zip, or a folder of its extracted FJ*.obj element files."""

    def __init__(self, path):
        path = Path(path)
        if path.is_dir():
            self.zip = None
            self.index = {p.stem: p for p in path.glob('*.obj')}
        else:
            self.zip = zipfile.ZipFile(path)
            self.index = {Path(n).stem: n for n in self.zip.namelist() if n.lower().endswith('.obj')}

    def mesh(self, element_id):
        name = self.index.get(element_id)
        if name is None:
            return None
        raw = self.zip.read(name) if self.zip else Path(name).read_bytes()
        return parse_obj(raw.decode('utf-8', errors='ignore'))


def merge(meshes):
    vs, fs, off = [], [], 0
    for v, f in meshes:
        vs.append(v)
        fs.append(f + off)
        off += len(v)
    if not vs:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    return np.vstack(vs), np.vstack(fs)


def weld(v, f, cell):
    """Merge vertices closer than `cell` (vertex clustering); cell=0 merges exact duplicates only."""
    key = np.round(v / cell).astype(np.int64) if cell > 0 else np.round(v, 5)
    _, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inverse = inverse.reshape(-1)
    if cell > 0:
        sums = np.zeros((len(first), 3))
        np.add.at(sums, inverse, v)
        counts = np.bincount(inverse, minlength=len(first))[:, None]
        nv = sums / counts
    else:
        nv = v[first]
    nf = inverse[f]
    nf = nf[(nf[:, 0] != nf[:, 1]) & (nf[:, 1] != nf[:, 2]) & (nf[:, 0] != nf[:, 2])]
    _, first_face = np.unique(np.sort(nf, axis=1), axis=0, return_index=True)   # drop duplicate triangles
    return nv, nf[np.sort(first_face)]


def crop(v, f, lo, hi):
    inside = np.all((v >= lo) & (v <= hi), axis=1)
    keep = inside[f].all(axis=1)
    f = f[keep]
    used = np.unique(f)
    remap = -np.ones(len(v), dtype=np.int64)
    remap[used] = np.arange(len(used))
    return v[used], remap[f]


def normals(v, f):
    n = np.zeros_like(v)
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def epicardium(lv, rv, vessels, h=1.2):
    """BodyParts3D models the ventricles as blood cavities without an outer muscle surface. Reconstruct the
    epicardium as the set of points within the local wall thickness of either cavity. Thickness near a coronary
    artery is read from the artery's own distance to the cavity (arteries run on the epicardium); elsewhere it
    falls back to typical left/right ventricular wall thickness. Returns a smoothed marching-cubes surface (mm)."""
    from scipy import ndimage
    from scipy.spatial import cKDTree
    from skimage.measure import marching_cubes

    pts = np.vstack([lv[0], rv[0]])
    lo = pts.min(0) - 16
    shape = np.ceil((pts.max(0) + 16 - lo) / h).astype(int) + 1

    def solid(v, f):
        tri = v[f]
        n = max(2, int(np.ceil(np.linalg.norm(tri[:, 1] - tri[:, 0], axis=1).max() / (h * 0.4))))
        samples = [tri[:, 0] * (1 - a / n - b / n) + tri[:, 1] * (a / n) + tri[:, 2] * (b / n)
                   for a in range(n + 1) for b in range(n + 1 - a)]
        idx = np.clip(np.round((np.vstack(samples) - lo) / h).astype(int), 0, shape - 1)
        m = np.zeros(shape, bool)
        m[tuple(idx.T)] = True
        return ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=1))

    d_lv = ndimage.distance_transform_edt(~solid(*lv)) * h
    d_rv = ndimage.distance_transform_edt(~solid(*rv)) * h
    d = np.minimum(d_lv, d_rv)
    vi = np.clip(np.round((vessels - lo) / h).astype(int), 0, shape - 1)
    wall_at_vessel = d[tuple(vi.T)] - 0.8
    grid = np.stack(np.meshgrid(*[np.arange(s) for s in shape], indexing='ij'), -1).reshape(-1, 3) * h + lo
    dist, near = cKDTree(vessels).query(grid, k=8)
    w_idw = 1 / np.maximum(dist, 1) ** 2
    t_vessel = np.clip((wall_at_vessel[near] * w_idw).sum(1) / w_idw.sum(1), 2.5, 11)
    t_default = np.where(d_lv.reshape(-1) <= d_rv.reshape(-1), DEFAULT_WALL_MM['LV'], DEFAULT_WALL_MM['RV'])
    w = np.exp(-dist[:, 0] / 12)
    thickness = (w * t_vessel + (1 - w) * t_default).reshape(shape)
    verts, faces, _, _ = marching_cubes(ndimage.gaussian_filter(d - thickness, 1.2), 0.0)
    return verts * h + lo, faces.astype(np.int64)


def write_glb(path, meshes, anchors=None):
    """meshes: list of (name, vertices float32 (n,3), faces uint32 (m,3)); anchors: {name: (position, normal)}."""
    blob, views, accessors, gl_meshes, nodes = bytearray(), [], [], [], []

    def add_view(data, target):
        while len(blob) % 4:
            blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data)
        return len(views) - 1

    for name, v, f in meshes:
        v = v.astype(np.float32)
        nrm = normals(v.astype(np.float64), f).astype(np.float32)
        idx = f.astype(np.uint32).reshape(-1)
        pv = add_view(v.tobytes(), 34962)
        nv = add_view(nrm.tobytes(), 34962)
        iv = add_view(idx.tobytes(), 34963)
        accessors += [
            {'bufferView': pv, 'componentType': 5126, 'count': len(v), 'type': 'VEC3', 'min': v.min(0).tolist(), 'max': v.max(0).tolist()},
            {'bufferView': nv, 'componentType': 5126, 'count': len(v), 'type': 'VEC3'},
            {'bufferView': iv, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'},
        ]
        a = len(accessors) - 3
        gl_meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': a, 'NORMAL': a + 1}, 'indices': a + 2}]})
        nodes.append({'name': name, 'mesh': len(gl_meshes) - 1})
    for name, (pos, nrm) in (anchors or {}).items():
        nodes.append({'name': f'anchor_{name}', 'translation': [float(x) for x in pos], 'extras': {'normal': [float(x) for x in nrm]}})
    gltf = {
        'asset': {'version': '2.0', 'generator': 'tools/build_anatomy.py', 'extras': {'attribution': ATTRIBUTION}},
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': gl_meshes,
        'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    blob += b'\0' * (-len(blob) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out)
    return len(out)


def main(zip_path, elements_path, heart_only=False):
    concept_elements, names = read_elements(elements_path)
    arc = Archive(zip_path)
    def load(concepts):
        elements = dict.fromkeys(e for c in concepts for e in concept_elements.get(c, []))
        return merge([m for e in elements if (m := arc.mesh(e)) is not None])

    groups = {g: load(c) for g, c in GROUPS.items()}
    vessel_pts = np.vstack([groups[g][0] for g in ('vessel_LAD', 'vessel_LCX', 'vessel_RCA')])
    groups['tissue_ventricles'] = epicardium(load([CAVITIES['LV']]), load([CAVITIES['RV']]), vessel_pts)
    for g, (v, f) in groups.items():
        source = ', '.join(names.get(c, c) for c in GROUPS[g]) if g in GROUPS else 'reconstructed from the ventricular cavities'
        print(f'{g:18s} {len(v):7d} verts {len(f):7d} tris  ({source})')

    # ---- frame: BodyParts3D is in millimetres; find superior / left / anterior axes from anatomy itself.
    heart_v = np.vstack([groups['tissue_ventricles'][0], groups['tissue_atria'][0]])
    centre = heart_v.mean(0)
    arch = groups['artery_great'][0]
    up_axis = int(np.argmax(np.abs(arch.max(0) - centre)))
    up_sign = np.sign(arch[:, up_axis].max() - centre[up_axis])
    lcx, rca = groups['vessel_LCX'][0].mean(0), groups['vessel_RCA'][0].mean(0)
    rest = [a for a in range(3) if a != up_axis]
    left_axis = max(rest, key=lambda a: abs(lcx[a] - rca[a]))
    left_sign = np.sign(lcx[left_axis] - rca[left_axis])
    ant_axis = [a for a in rest if a != left_axis][0]
    lad = groups['vessel_LAD'][0].mean(0)
    ant_sign = np.sign(lad[ant_axis] - centre[ant_axis])      # the LAD lies on the anterior surface
    print(f'axes: up={up_axis}{"+" if up_sign > 0 else "-"} left={left_axis}{"+" if left_sign > 0 else "-"} anterior={ant_axis}{"+" if ant_sign > 0 else "-"}')

    def to_world(v):
        return np.stack([left_sign * v[:, left_axis], up_sign * v[:, up_axis], ant_sign * v[:, ant_axis]], axis=1)

    hw = to_world(heart_v)
    lo, hi = hw.min(0), hw.max(0)
    size = hi - lo
    crop_lo = lo - size * np.array([0.15, 0.06, 0.15])
    crop_hi = hi + size * np.array([0.15, 0.45, 0.15])
    shift = (lo + hi) / 2

    world = {}
    for g, (v, f) in groups.items():
        v = to_world(v)
        if not g.startswith('vessel_'):
            v, f = crop(v, f, crop_lo, crop_hi)
        v, f = weld(v, f, CLUSTER_MM['ventricles'] if g == 'tissue_ventricles' else CLUSTER_MM['heart'])
        world[g] = (v, f)
    allv = np.vstack([v for v, _ in world.values()]) - shift
    radius = np.linalg.norm(allv, axis=1).max()
    scale = TARGET_RADIUS / radius
    print(f'heart size (mm): {np.round(size, 1)}  scale {scale:.4f} units/mm')

    meshes = [(g, (v - shift) * scale, f) for g, (v, f) in world.items() if len(f)]
    anchors = {}
    hc = np.zeros(3)
    for sys_name, concepts in ANCHOR_CONCEPTS.items():
        tv = (to_world(load(concepts)[0]) - shift) * scale
        mid = tv[np.argmin(np.linalg.norm(tv - tv.mean(0), axis=1))]
        n = mid - hc
        anchors[sys_name] = (mid, n / np.linalg.norm(n))
    size_heart = write_glb(OUT_DIR / 'heart.glb', meshes, anchors)
    print(f'heart.glb {size_heart / 1e6:.2f} MB, {sum(len(f) for _, _, f in meshes)} triangles')
    if heart_only:
        return

    # ---- thorax context
    bones = thorax_concepts(names)
    print(f'thorax concepts: {len(bones)} (e.g. {", ".join(sorted(names[c] for c in bones)[:6])} ...)')
    tv, tf = load(bones)
    tv = to_world(tv)
    tv, tf = weld(tv, tf, CLUSTER_MM['thorax'])
    size_thorax = write_glb(OUT_DIR / 'thorax.glb', [('bone_thorax', (tv - shift) * scale, tf)])
    print(f'thorax.glb {size_thorax / 1e6:.2f} MB, {len(tf)} triangles')


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    source, elements = (args[0], args[1]) if len(args) >= 2 else fetch_needed_parts()
    main(source, elements, heart_only='--heart-only' in sys.argv)
