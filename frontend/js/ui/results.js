import { SYSTEMS, SYSTEM_ORDER } from '../config/anatomy.js';
import { h, icon, clear } from './dom.js';
import { heatColor, pct } from './colors.js';
import { operatingSection, presetName, presetLabel } from './operating.js';

// Elements that depend on the decision threshold carry data-target, so a threshold change updates them in place
// (re-rendering the pane would interrupt a slider drag).
function meter(target, p, label) {
  return h('div', {},
    h('div', { class: 'meter', role: 'img', dataset: { target, role: 'meter' } },
      h('div', { class: 'fill', style: { width: pct(p, 1), background: heatColor(p) } }),
      h('div', { class: 'thr' })),
    h('div', { class: 'meter-scale' }, h('span', {}, '0%'), h('span', { dataset: { target, role: 'scale' } }), h('span', {}, '100%')));
}

function thresholdNote(curves, target, thr) {
  const key = presetName(curves, target, thr);
  if (!key) return 'custom';
  return key === 'default' ? 'default' : presetLabel(curves, key).toLowerCase();
}

/** Update every threshold-dependent element of `target` inside `root`. */
export function applyThreshold(root, { target, probability, thr, curves, label }) {
  const above = probability >= thr;
  const note = thresholdNote(curves, target, thr);
  for (const el of root.querySelectorAll(`[data-target="${target}"]`)) {
    const role = el.dataset.role;
    if (role === 'meter') {
      el.querySelector('.thr').style.left = `calc(${pct(thr, 1)} - 1px)`;
      el.setAttribute('aria-label', `${label}: ${pct(probability)}; decision threshold ${pct(thr)}`);
    } else if (role === 'scale') {
      el.textContent = `threshold ${pct(thr)} (${note})`;
    } else if (role === 'flag') {
      clear(el).append(icon(above ? 'flag' : 'check'),
        above ? `${target === 'Cath' ? 'CAD' : 'Stenosis'} flag: at or above the decision threshold` : 'Below the decision threshold');
    } else if (role === 'vflag') {
      el.textContent = above ? 'Stenosis flagged (≥ 50%)' : 'Below threshold';
    }
  }
}

export function renderResults(el, { prediction, performance, curves, selected, onSelect, getThreshold, setThreshold }) {
  clear(el);
  if (!prediction) {
    el.append(h('p', { class: 'muted' }, 'Enter patient data to see model estimates.'));
    return;
  }
  const cad = prediction.overall_cad;
  const probOf = t => (t === 'Cath' ? cad.probability : prediction.vessels[t].probability);
  const LABEL = { Cath: 'Overall CAD probability', LAD: 'LAD stenosis probability', LCX: 'LCX stenosis probability', RCA: 'RCA stenosis probability' };

  el.append(
    h('div', { class: 'section' },
      h('div', { class: 'hero' },
        h('div', {},
          h('div', { class: 'label' }, 'Overall CAD — estimated probability'),
          h('div', { class: 'value' }, pct(cad.probability)))),
      h('span', { class: 'flag', dataset: { target: 'Cath', role: 'flag' } }),
      meter('Cath', cad.probability, LABEL.Cath),
      h('p', { class: 'small muted' },
        `Default Cath threshold ${pct(cad.operating_threshold, 1)} keeps development sensitivity ≥ 90% (rule-out safety); change it under Decision threshold. `,
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
      meter(sys, v.probability, LABEL[sys]),
      h('div', { class: 'row small' },
        h('span', { class: 'muted', dataset: { target: sys, role: 'vflag' } }),
        auc ? h('span', { class: 'badge', style: { marginLeft: 'auto' }, title: `Holdout ROC-AUC ${auc.estimate.toFixed(2)} ${auc.ci95}` },
          `Model discrimination: ${perf.discrimination} (AUC ${auc.estimate.toFixed(2)})`) : null));
    vessels.append(card);
  }
  el.append(vessels);

  const update = t => applyThreshold(el, { target: t, probability: probOf(t), thr: getThreshold(t), curves, label: LABEL[t] });
  const opTarget = selected in LABEL ? selected : 'Cath';
  el.append(
    operatingSection({
      curves, target: opTarget, patientP: probOf(opTarget),
      getThr: () => getThreshold(opTarget),
      setThr: t => { setThreshold(opTarget, t); update(opTarget); },
      onTarget: onSelect,
    }),
    h('p', { class: 'small muted' },
      'Probabilities are calibrated on development data. They estimate the chance of angiographically significant (≥ 50%) stenosis somewhere in the vessel — not how narrowed it is or where the narrowing sits.'));
  ['Cath', ...SYSTEM_ORDER].forEach(update);
}
