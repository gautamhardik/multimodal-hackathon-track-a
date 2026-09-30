// Decision-threshold control: lets the user choose where the flag is raised, and shows the resulting
// development-estimated sensitivity / specificity / PPV / NPV (Notebook 8, holdout not used).
// Only the flag depends on the threshold; probabilities, 3D colours and explanations never change.
import { h, clear, showTooltip, hideTooltip } from './dom.js';
import { pct } from './colors.js';
import { attrTo, countUp } from './motion.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const PRESET_ORDER = ['default', 'high_sensitivity', 'balanced', 'high_specificity'];
const TARGET_NAMES = { Cath: 'Overall CAD', LAD: 'LAD', LCX: 'LCX', RCA: 'RCA' };
const CONDITION = { Cath: 'CAD', LAD: 'LAD stenosis', LCX: 'LCX stenosis', RCA: 'RCA stenosis' };
const SAME = 5e-4;

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** Development metrics of the rule `probability >= thr` (exact for presets, nearest 0.01 grid point otherwise). */
export function metricsAt(curves, target, thr) {
  const d = curves?.targets?.[target];
  if (!d) return null;
  for (const p of Object.values(d.presets)) if (p && Math.abs(p.threshold - thr) < 1e-9) return p;
  const c = d.curve;
  const i = Math.min(c.threshold.length - 1, Math.max(0, Math.round(thr * 100) - 1));
  return { threshold: c.threshold[i], sensitivity: c.sensitivity[i], specificity: c.specificity[i], PPV: c.PPV[i], NPV: c.NPV[i], flagged: c.flagged[i] };
}

export function presetName(curves, target, thr) {
  const d = curves?.targets?.[target];
  const hit = d && PRESET_ORDER.find(k => d.presets[k] && Math.abs(d.presets[k].threshold - thr) < SAME);
  return hit || null;
}

export function presetLabel(curves, key) {
  return key === 'default' ? 'Default (v1.1)' : curves?.preset_rules?.[key]?.label ?? key;
}

function tradeoffChart(d, getThr, patientP, onPick) {
  const W = 360, H = 190, L = 36, R = 82, T = 18, B = 30;
  const x = v => L + v * (W - L - R);
  const y = v => T + (1 - v) * (H - T - B);
  const c = d.curve;
  const line = key => c.threshold.map((t, i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(c[key][i]).toFixed(1)}`).join('');
  const last = c.threshold.length - 1;

  const grid = [0, 0.5, 1].map(v => [
    s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'op-grid' }),
    s('text', { x: L - 6, y: y(v) + 3.5, class: 'op-tick', 'text-anchor': 'end' }, pct(v))]);
  const xt = [0, 0.25, 0.5, 0.75, 1].map(v => s('text', { x: x(v), y: H - B + 15, class: 'op-tick', 'text-anchor': 'middle' }, pct(v)));

  // Direct labels at the right end of each line (line key in the series colour, text in text ink).
  let ySens = y(c.sensitivity[last]), ySpec = y(c.specificity[last]);
  if (Math.abs(ySens - ySpec) < 13) { const m = (ySens + ySpec) / 2; ySens = m + (ySens >= ySpec ? 7 : -7); ySpec = m + (ySens >= ySpec ? -7 : 7); }
  const endLabel = (yy, cls, text) => [
    s('line', { x1: x(1) + 6, x2: x(1) + 16, y1: yy, y2: yy, class: `op-key ${cls}` }),
    s('text', { x: x(1) + 20, y: yy + 3.5, class: 'op-lbl' }, text)];

  const thrLine = s('line', { y1: T - 4, y2: H - B, class: 'op-thr' });
  const thrText = s('text', { y: T - 7, class: 'op-thr-lbl', 'text-anchor': 'middle' });
  const placeThr = () => {
    const t = getThr();
    attrTo(thrLine, `op-line-${d.key}`, { x1: x(t), x2: x(t) });
    attrTo(thrText, `op-text-${d.key}`, { x: Math.min(W - R - 20, Math.max(L + 20, x(t))) });
    thrText.textContent = `threshold ${pct(t)}`;
  };
  placeThr();

  const patient = patientP == null ? [] : [
    s('line', { x1: x(patientP), x2: x(patientP), y1: T, y2: H - B, class: 'op-patient' }),
    s('text', { x: Math.min(W - R - 26, Math.max(L + 26, x(patientP))), y: H - B - 5, class: 'op-patient-lbl', 'text-anchor': 'middle' },
      `patient ${pct(patientP)}`)];

  const hair = s('line', { y1: T, y2: H - B, class: 'op-hair', visibility: 'hidden' });
  const dotA = s('circle', { r: 4, class: 'op-dot sens', visibility: 'hidden' });
  const dotB = s('circle', { r: 4, class: 'op-dot spec', visibility: 'hidden' });
  const hit = s('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent', style: 'cursor:crosshair' });
  const idxAt = evt => {
    const r = hit.getBoundingClientRect();
    const v = (evt.clientX - r.left) / r.width;
    return Math.min(last, Math.max(0, Math.round(v * 100) - 1));
  };
  hit.addEventListener('pointermove', evt => {
    const i = idxAt(evt);
    const t = c.threshold[i];
    for (const el of [hair, dotA, dotB]) el.setAttribute('visibility', 'visible');
    hair.setAttribute('x1', x(t)); hair.setAttribute('x2', x(t));
    dotA.setAttribute('cx', x(t)); dotA.setAttribute('cy', y(c.sensitivity[i]));
    dotB.setAttribute('cx', x(t)); dotB.setAttribute('cy', y(c.specificity[i]));
    showTooltip(evt, () => [
      h('div', { class: 's' }, `Threshold ${pct(t)} · click to use`),
      h('div', { class: 'tip-row' }, h('i', { class: 'tip-key sens' }), h('strong', {}, pct(c.sensitivity[i])), ' sensitivity'),
      h('div', { class: 'tip-row' }, h('i', { class: 'tip-key spec' }), h('strong', {}, pct(c.specificity[i])), ' specificity')]);
  });
  hit.addEventListener('pointerleave', () => { for (const el of [hair, dotA, dotB]) el.setAttribute('visibility', 'hidden'); hideTooltip(); });
  hit.addEventListener('click', evt => onPick(c.threshold[idxAt(evt)]));

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'op-chart', role: 'img',
    'aria-label': 'Development sensitivity and specificity at every decision threshold; the table below gives the values at the chosen threshold.' },
    grid, xt,
    s('text', { x: (L + W - R) / 2, y: H - 2, class: 'op-tick', 'text-anchor': 'middle' }, 'Decision threshold (calibrated probability)'),
    s('path', { d: line('sensitivity'), class: 'op-line sens' }),
    s('path', { d: line('specificity'), class: 'op-line spec' }),
    endLabel(ySens, 'sens', 'Sensitivity'), endLabel(ySpec, 'spec', 'Specificity'),
    patient, thrLine, thrText, hair, dotA, dotB, hit);
  svg.update = placeThr;
  return svg;
}

function statTile(key, label, value, sub) {
  const v = h('div', { class: 'v' });
  if (value == null) v.textContent = '—'; else countUp(v, key, value, x => pct(x));
  return h('div', { class: 'op-stat' }, h('div', { class: 'k' }, label), v, h('div', { class: 's' }, sub));
}

/**
 * Build the decision-threshold section for one target.
 * `getThr()` returns the current threshold; `setThr(t)` stores it and updates dependent flags in place.
 */
export function operatingSection({ curves, target, patientP, getThr, setThr, onTarget }) {
  const d = curves?.targets?.[target];
  if (!d) return h('div', { class: 'section' }, h('h3', {}, 'Decision threshold'), h('p', { class: 'small muted' }, 'Trade-off data unavailable.'));

  const stats = h('div', { class: 'op-stats' });
  const readout = h('p', { class: 'small' });
  const valueEl = h('span', { class: 'op-value' });
  const slider = h('input', {
    type: 'range', min: '0.01', max: '0.99', step: '0.01', class: 'op-slider',
    'aria-label': `Decision threshold for ${TARGET_NAMES[target]}`,
  });
  // A preset that lands within a point of the served default is the same rule in practice: show it once, on the default.
  const twin = d.presets.default && PRESET_ORDER.slice(1).find(k => d.presets[k] && Math.abs(d.presets[k].threshold - d.presets.default.threshold) < 0.01);
  const presetBtns = PRESET_ORDER.filter(k => d.presets[k] && k !== twin).map(k => h('button', {
    type: 'button', dataset: { preset: k },
    title: k === 'default' ? `Served v1.1 rule: ${d.default_rule}${twin ? `; matches “${curves.preset_rules[twin].rule}”` : ''}` : curves.preset_rules[k].rule,
    onclick: () => apply(d.presets[k].threshold),
  }, k === 'default' && twin ? `${presetLabel(curves, k)} · ${presetLabel(curves, twin)}` : presetLabel(curves, k),
  h('span', { class: 'op-pthr' }, ` ${pct(d.presets[k].threshold)}`)));

  const chart = tradeoffChart({ ...d, key: target }, getThr, patientP, t => apply(t));

  function refresh() {
    const t = getThr();
    const m = metricsAt(curves, target, t);
    slider.value = String(t);
    slider.setAttribute('aria-valuetext', pct(t));
    valueEl.textContent = pct(t, t * 100 % 1 ? 1 : 0);
    const hit = presetName(curves, target, t);
    const active = hit === twin ? 'default' : hit;
    for (const b of presetBtns) b.setAttribute('aria-pressed', String(b.dataset.preset === active));
    chart.update();
    clear(stats).append(
      statTile(`op-${target}-sens`, 'Sensitivity', m.sensitivity, `flags ${Math.round(m.sensitivity * 100)} of 100 patients with ${CONDITION[target]}`),
      statTile(`op-${target}-spec`, 'Specificity', m.specificity, `clears ${Math.round(m.specificity * 100)} of 100 patients without it`),
      statTile(`op-${target}-ppv`, 'PPV', m.PPV, 'of flagged patients have it'),
      statTile(`op-${target}-npv`, 'NPV', m.NPV, 'of unflagged patients are free of it'));
    const range = m.sensitivity_range
      ? ` Across the 5 cross-validation repeats: sensitivity ${pct(m.sensitivity_range[0])}–${pct(m.sensitivity_range[1])}, specificity ${pct(m.specificity_range[0])}–${pct(m.specificity_range[1])}.`
      : '';
    readout.textContent = `${pct(m.flagged)} of development patients would be flagged.${range}`;
  }
  function apply(t) { setThr(t); refresh(); }
  slider.addEventListener('input', () => apply(Number(slider.value)));
  refresh();

  return h('div', { class: 'section op-section' },
    h('h3', {}, 'Decision threshold'),
    h('div', { class: 'seg seg-target', role: 'group', 'aria-label': 'Threshold for which estimate' },
      ['Cath', 'LAD', 'LCX', 'RCA'].map(t => h('button', { type: 'button', 'aria-pressed': String(t === target), onclick: () => onTarget(t) }, TARGET_NAMES[t]))),
    h('p', { class: 'small muted' },
      `Choose where the ${TARGET_NAMES[target]} flag is raised. Lower thresholds catch more cases and raise more false alarms. `,
      'Only the flag changes; the probability, 3D colours and explanations stay the same.'),
    h('div', { class: `seg op-presets${presetBtns.length === 3 ? ' three' : ''}`, role: 'group', 'aria-label': 'Preset operating points' }, presetBtns),
    h('div', { class: 'op-slider-row' }, slider, valueEl),
    chart,
    h('div', { class: 'chart-legend', 'aria-hidden': 'true' },
      h('span', {}, h('i', { class: 'line-key sens' }), 'Sensitivity'),
      h('span', {}, h('i', { class: 'line-key spec' }), 'Specificity'),
      patientP == null ? null : h('span', {}, h('i', { class: 'line-key patient' }), 'This patient')),
    stats, readout,
    h('p', { class: 'small muted' },
      `Development nested cross-validation of the served model (${d.n} patients, ${TARGET_NAMES[target]} prevalence ${pct(d.prevalence)}); `,
      'the holdout was not used. PPV and NPV depend on prevalence and reflect this referral cohort.'));
}
