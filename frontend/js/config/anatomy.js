// Schematic coronary anatomy (right-dominant circulation, the most common pattern).
// Every coloured segment belongs to exactly one model target, so the 3D view always shows the model output for that
// vessel system. The model predicts stenosis *somewhere in the vessel system*, so the whole system shares one colour.
//
// Surface paths use heart coordinates [t, angle]: t = 0 at the atrioventricular groove (base) → 1 at the apex;
// angle in degrees around the long axis: 0 anterior, +90 left lateral (obtuse margin), ±180 inferior/posterior,
// −90 right (acute margin).

export const SYSTEMS = {
  LAD: {
    target: 'LAD', short: 'LAD', name: 'Left anterior descending artery', view: 'anterior',
    course: 'Runs in the anterior interventricular groove towards the apex; gives diagonal branches.',
    territory: 'Anterior wall, anterior two-thirds of the septum and the apex.',
  },
  LCX: {
    target: 'LCX', short: 'LCX', name: 'Left circumflex artery', view: 'lateral',
    course: 'Runs in the left atrioventricular groove; gives obtuse marginal branches.',
    territory: 'Lateral and posterolateral wall of the left ventricle.',
  },
  RCA: {
    target: 'RCA', short: 'RCA', name: 'Right coronary artery', view: 'rao',
    course: 'Runs in the right atrioventricular groove to the crux; gives the acute marginal and posterior descending arteries.',
    territory: 'Right ventricle, inferior wall and posterior septum.',
  },
};

export const SYSTEM_ORDER = ['LAD', 'LCX', 'RCA'];

// r = [proximal radius, distal radius]; `at` = fraction along the parent where a branch leaves it.
export const SEGMENTS = [
  { id: 'LM', system: null, name: 'Left main (not modelled separately)', r: [0.072, 0.066], origin: 'aorta-left', path: [[-0.02, 44]] },
  { id: 'LAD', system: 'LAD', r: [0.064, 0.022], label: 0.42,
    path: [[-0.02, 44], [0.05, 30], [0.14, 22], [0.3, 17], [0.5, 13], [0.7, 9], [0.86, 4], [0.97, -8]] },
  { id: 'D1', system: 'LAD', parent: 'LAD', at: 0.22, r: [0.04, 0.017], path: [[0.32, 36], [0.47, 52], [0.63, 63]] },
  { id: 'D2', system: 'LAD', parent: 'LAD', at: 0.5, r: [0.034, 0.015], path: [[0.58, 30], [0.74, 42]] },
  { id: 'LCX', system: 'LCX', r: [0.058, 0.026], label: 0.55,
    path: [[-0.02, 44], [0.0, 62], [0.015, 85], [0.025, 110], [0.035, 135], [0.05, 155]] },
  { id: 'OM1', system: 'LCX', parent: 'LCX', at: 0.38, r: [0.04, 0.017], path: [[0.2, 94], [0.4, 98], [0.6, 102]] },
  { id: 'OM2', system: 'LCX', parent: 'LCX', at: 0.74, r: [0.034, 0.015], path: [[0.24, 132], [0.45, 138]] },
  { id: 'RCA', system: 'RCA', r: [0.064, 0.03], label: 0.4, origin: 'aorta-right',
    path: [[-0.01, -22], [0.0, -45], [0.015, -75], [0.025, -105], [0.035, -135], [0.05, -160]] },
  { id: 'AM', system: 'RCA', parent: 'RCA', at: 0.46, r: [0.036, 0.015], path: [[0.22, -97], [0.44, -101]] },
  { id: 'PDA', system: 'RCA', parent: 'RCA', at: 1.0, r: [0.044, 0.017], path: [[0.2, -166], [0.43, -169], [0.66, -172]] },
];

// Camera presets: direction from the heart centre (world axes: +x patient's left, +y superior, +z anterior).
export const VIEWS = [
  { id: 'anterior', label: 'Anterior', dir: [0.05, 0.12, 1] },
  { id: 'lateral', label: 'Left lateral', dir: [1, 0.15, 0.25] },
  { id: 'inferior', label: 'Inferior', dir: [0.1, -0.8, -0.6] },
  { id: 'rao', label: 'RAO', dir: [-0.62, 0.1, 0.78] },
  { id: 'posterior', label: 'Posterior', dir: [0.1, 0.1, -1] },
  { id: 'torso', label: 'Chest', dir: [0.25, 0.15, 1], torso: true },
];
