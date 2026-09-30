import { SYSTEMS, SYSTEM_ORDER } from '../config/anatomy.js';
import { h, icon, clear } from './dom.js';
import { heatColor, pct } from './colors.js';

function meter(p, threshold, label) {
  return h('div', {},
    h('div', { class: 'meter', role: 'img', 'aria-label': `${label}: ${pct(p)}; operating threshold ${pct(threshold)}` },
      h('div', { class: 'fill', style: { width: pct(p, 1), background: heatColor(p) } }),
      h('div', { class: 'thr', style: { left: `calc(${pct(threshold, 1)} - 1px)` }, title: `Operating threshold ${pct(threshold)}` })),
    h('div', { class: 'meter-scale' }, h('span', {}, '0%'), h('span', {}, `threshold ${pct(threshold)}`), h('span', {}, '100%')));
}

function flag(result, positiveWord) {
  const above = result.prediction !== 'Normal';
  return h('span', { class: 'flag' }, icon(above ? 'flag' : 'check'),
    above ? `${positiveWord} flag: above the operating threshold` : 'Below the operating threshold');
}

export function renderResults(el, { prediction, performance, selected, onSelect }) {
  clear(el);
  if (!prediction) {
    el.append(h('p', { class: 'muted' }, 'Enter patient data to see model estimates.'));
    return;
  }
  const cad = prediction.overall_cad;
  el.append(
    h('div', { class: 'section' },
      h('div', { class: 'hero' },
        h('div', {},
          h('div', { class: 'label' }, 'Overall CAD — estimated probability'),
          h('div', { class: 'value' }, pct(cad.probability)))),
      flag(cad, 'CAD'),
      meter(cad.probability, cad.operating_threshold, 'Overall CAD probability'),
      h('p', { class: 'small muted' },
        `Cath threshold ${pct(cad.operating_threshold)} was set on development data to keep sensitivity ≥ 90% (rule-out safety). `,
        `Uncalibrated model output: ${cad.uncalibrated_probability.toFixed(2)}.`)));

  if (!prediction.consistency.consistent) {
    el.append(h('div', { class: 'notice warn', role: 'status' }, icon('warn'), h('div', {}, h('strong', {}, 'Check consistency. '), prediction.consistency.message)));
  }
  for (const w of prediction.input_warnings) {
    el.append(h('div', { class: 'notice warn', role: 'status' }, icon('warn'), h('div', {}, w)));
  }

  const vessels = h('div', { class: 'section' }, h('h3', {}, 'Vessel-specific estimates'));
  for (const sys of SYSTEM_ORDER) {
    const v = prediction.vessels[sys];
    const perf = performance?.targets?.[sys];
    const auc = perf?.['holdout_v1_at_0.50']?.['ROC-AUC'];
    const card = h('div', {
      class: 'vcard', role: 'button', tabindex: 0, 'aria-pressed': String(selected === sys),
      onclick: () => onSelect(sys), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(sys); } },
    },
      h('div', { class: 'row' },
        h('span', { class: 'nm' }, sys), h('span', { class: 'full' }, SYSTEMS[sys].name),
        h('span', { class: 'pr' }, pct(v.probability))),
      meter(v.probability, v.operating_threshold, `${sys} stenosis probability`),
      h('div', { class: 'row small' },
        h('span', { class: 'muted' }, v.prediction === 'Normal' ? 'Below threshold' : 'Stenosis flagged (≥ 50%)'),
        auc ? h('span', { class: 'badge', style: { marginLeft: 'auto' }, title: `Holdout ROC-AUC ${auc.estimate.toFixed(2)} ${auc.ci95}` },
          `Model discrimination: ${perf.discrimination} (AUC ${auc.estimate.toFixed(2)})`) : null));
    vessels.append(card);
  }
  el.append(vessels,
    h('p', { class: 'small muted' },
      'Probabilities are calibrated on development data. They estimate the chance of angiographically significant (≥ 50%) stenosis somewhere in the vessel — not how narrowed it is or where the narrowing sits.'));
}
