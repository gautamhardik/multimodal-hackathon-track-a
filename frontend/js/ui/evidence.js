import { LABELS } from '../config/features.js';
import { h, clear } from './dom.js';

const T = ['Cath', 'LAD', 'LCX', 'RCA'];
const NAME = { Cath: 'Overall CAD', LAD: 'LAD', LCX: 'LCX', RCA: 'RCA' };

function metricTable(perf) {
  const hold = m => T.map(t => {
    const x = perf.targets[t]['holdout_v1_at_0.50'][m];
    const [lo, hi] = x.ci95.replace(/[\[\]]/g, '').split(',').map(Number);
    return h('td', { class: 'num' }, x.estimate.toFixed(2), h('div', { class: 'muted' }, `${lo.toFixed(2)}–${hi.toFixed(2)}`));
  });
  const dev = m => T.map(t => h('td', { class: 'num' }, perf.targets[t].development_nested_cv.v1_1_calibrated_at_operating_threshold[m].toFixed(2)));
  const row = (label, cells) => h('tr', {}, h('td', {}, label), cells);
  return h('div', { class: 'table-wrap grow' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Metric'), T.map(t => h('th', { class: 'num' }, NAME[t])))),
    h('tbody', {},
      h('tr', {}, h('td', { colspan: 5 }, h('strong', {}, 'One-time holdout (61 patients), frozen v1 at 0.50 — 95% CI'))),
      row('ROC-AUC', hold('ROC-AUC')), row('PR-AUC (AP)', hold('PR-AUC (AP)')), row('Sensitivity', hold('Sensitivity')),
      row('Specificity', hold('Specificity')), row('Brier score', hold('Brier')),
      h('tr', {}, h('td', { colspan: 5 }, h('strong', {}, 'Served v1.1: calibrated, operating threshold — development nested CV'))),
      row('Sensitivity', dev('sensitivity')), row('Specificity', dev('specificity')), row('Balanced accuracy', dev('balanced_accuracy')),
      row('F1', dev('F1')), row('Calibration slope (ideal 1)', dev('calibration_slope')))));
}

function bandTable(perf, target) {
  const rows = perf.probability_bands.filter(b => b.target === target);
  return h('div', { class: 'table-wrap grow' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Probability band'), h('th', { class: 'num' }, 'Patients'), h('th', { class: 'num' }, 'Mean estimate'), h('th', { class: 'num' }, 'Observed rate'))),
    h('tbody', {}, rows.map(b => h('tr', {},
      h('td', {}, b.band), h('td', { class: 'num' }, b.n_per_repeat.toFixed(0)),
      h('td', { class: 'num' }, `${(b.mean_predicted * 100).toFixed(0)}%`), h('td', { class: 'num' }, `${(b.observed_rate * 100).toFixed(0)}%`))))));
}

function importanceBars(gi, target) {
  const col = `${target}_share_%`;
  const rows = gi.features.map(f => ({ name: f['Source Feature'], v: f[col] })).sort((a, b) => b.v - a.v).slice(0, 10);
  const max = rows[0].v;
  return h('div', {}, rows.map(r => h('div', { class: 'hbar-row' },
    h('span', {}, LABELS[r.name] || r.name),
    h('div', { class: 'hbar-track' }, h('div', { class: 'b', style: { width: `${(r.v / max) * 100}%` } })),
    h('span', { class: 'v' }, `${r.v.toFixed(1)}%`))));
}

export function renderEvidence(el, { performance, globalImportance, target }) {
  clear(el);
  if (!performance) { el.append(h('p', { class: 'muted' }, 'Loading validation evidence…')); return; }
  const t = target || 'Cath';
  el.append(
    h('div', { class: 'section' }, h('h3', {}, 'How well do the models perform?'), metricTable(performance),
      h('ul', { class: 'small muted' }, performance.notes.map(n => h('li', {}, n)))),
    h('div', { class: 'section' }, h('h3', {}, `Does each colour band mean what it says? (${NAME[t]})`), bandTable(performance, t),
      h('p', { class: 'small muted' }, 'Observed stenosis rate among development patients whose calibrated estimate fell in each band (nested cross-validation, averaged over 5 repeats).')),
    globalImportance ? h('div', { class: 'section' }, h('h3', {}, `Most influential measurements overall (${NAME[t]})`), importanceBars(globalImportance, t),
      h('p', { class: 'small muted' }, "Share of the model's total mean |SHAP| across the 242 development patients.")) : null,
    h('div', { class: 'section small muted' },
      h('p', {}, 'Data: UCI Extension of Z-Alizadeh Sani (303 patients, single centre). Models: XGBoost (Cath) and random forests (vessels), trained on 242 patients, with Platt calibration fitted on development data only.'),
      h('p', {}, 'Limitations: small single-centre referral cohort; wide holdout intervals; predictors such as Q waves, wall-motion abnormality and reduced EF can reflect prior infarction; left main disease is not modelled separately.')));
}
