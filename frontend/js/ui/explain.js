import { LABELS, formatValue, outOfReference, REFS, UNITS } from '../config/features.js';
import { h, icon, clear, showTooltip, hideTooltip } from './dom.js';

const TARGET_NAMES = { Cath: 'Overall CAD', LAD: 'LAD', LCX: 'LCX', RCA: 'RCA' };
const UNIT_TEXT = { 'log-odds': 'log-odds', probability: 'probability points' };
let tableSort = { key: 'share', dir: -1 };
let domainFilter = '';

function divergingChart(contribs, units) {
  const top = contribs.slice(0, 10);
  const max = Math.max(...top.map(c => c.relative_contribution_pct), 1);
  const rows = top.map(c => {
    const raise = c.attribution > 0;
    const w = (c.relative_contribution_pct / max) * 44;   // % of track width per side (leave room for labels)
    const name = LABELS[c.feature] || c.feature;
    const row = h('div', { class: 'drow', tabindex: 0, 'aria-label': `${name}, ${formatValue(c.feature, c.value)}: ${raise ? 'raises' : 'lowers'} the estimate, ${c.relative_contribution_pct.toFixed(1)}% of total attribution` },
      h('div', { class: 'name' }, name, h('br'), h('span', { class: 'val' }, formatValue(c.feature, c.value))),
      h('div', { class: 'dtrack' },
        h('div', { class: 'axis' }),
        h('div', { class: `bar ${raise ? 'raise' : 'lower'}`, style: { width: `${w}%` } }),
        h('div', { class: 'lbl', style: raise ? { left: `calc(50% + ${w}% + 4px)` } : { right: `calc(50% + ${w}% + 4px)` } }, `${c.relative_contribution_pct.toFixed(0)}%`)));
    const tipBuild = () => [
      h('strong', {}, `${raise ? '+' : '−'}${c.relative_contribution_pct.toFixed(1)}% of total attribution`),
      h('div', {}, `${name}: ${formatValue(c.feature, c.value)}`),
      h('div', { class: 's' }, `${raise ? 'Raises' : 'Lowers'} the estimate · SHAP ${c.attribution > 0 ? '+' : ''}${c.attribution.toFixed(3)} ${UNIT_TEXT[units] || units}`),
      h('div', { class: 's' }, `Domain: ${c.clinical_domain}`)];
    row.addEventListener('pointermove', e => showTooltip(e, tipBuild));
    row.addEventListener('pointerleave', hideTooltip);
    row.addEventListener('focus', e => showTooltip(e, tipBuild));
    row.addEventListener('blur', hideTooltip);
    return row;
  });
  return h('div', { class: 'dchart', role: 'list' }, rows);
}

function domainBars(contribs) {
  const sums = {};
  for (const c of contribs) sums[c.clinical_domain] = (sums[c.clinical_domain] || 0) + c.relative_contribution_pct;
  const entries = Object.entries(sums).sort((a, b) => b[1] - a[1]);
  const max = entries[0][1];
  return h('div', {}, entries.map(([d, v]) => h('div', { class: 'hbar-row' },
    h('span', {}, d),
    h('div', { class: 'hbar-track' }, h('div', { class: 'b', style: { width: `${(v / max) * 100}%` } })),
    h('span', { class: 'v' }, `${v.toFixed(0)}%`))));
}

function refText(key) {
  const r = REFS[key];
  if (!r) return '—';
  const u = UNITS[key] || '';
  if (r[0] === 0) return `< ${r[1] + (Number.isInteger(r[1]) ? 1 : 0)} ${u}`;
  if (r[1] >= 200 && key === 'HDL') return `≥ ${r[0]} ${u}`;
  return `${r[0]}–${r[1]} ${u}`;
}

function breakdownTable(contribs, rerender) {
  const domains = [...new Set(contribs.map(c => c.clinical_domain))].sort();
  const rows = contribs
    .filter(c => !domainFilter || c.clinical_domain === domainFilter)
    .map(c => ({ ...c, share: c.relative_contribution_pct * Math.sign(c.attribution || 0) }));
  const k = tableSort.key;
  rows.sort((a, b) => {
    if (k === 'share') return tableSort.dir * (Math.abs(a.share) - Math.abs(b.share));
    return tableSort.dir * String(LABELS[a.feature] || a.feature).localeCompare(String(LABELS[b.feature] || b.feature));
  });
  const th = (label, key, cls) => {
    if (!key) return h('th', { class: cls || '' }, label);
    const active = tableSort.key === key;
    return h('th', {
      class: `sortable ${cls || ''}`, tabindex: 0, 'aria-sort': active ? (tableSort.dir > 0 ? 'ascending' : 'descending') : 'none',
      onclick: () => { tableSort = { key, dir: active ? -tableSort.dir : (key === 'share' ? -1 : 1) }; rerender(); },
      onkeydown: e => { if (e.key === 'Enter') e.currentTarget.click(); },
    }, label, active ? (tableSort.dir > 0 ? ' ▲' : ' ▼') : '');
  };
  const select = h('select', { class: 'select', 'aria-label': 'Filter by clinical domain', onchange: e => { domainFilter = e.target.value; rerender(); } },
    h('option', { value: '' }, 'All domains'), domains.map(d => h('option', { value: d, selected: d === domainFilter }, d)));
  return h('div', {},
    h('div', { class: 'filter-row' }, h('span', { class: 'muted' }, 'Show'), select, h('span', { class: 'muted' }, `${rows.length} measurements`)),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, th('Measurement', 'name'), th('Patient value', null), th('Typical adult range', null), th('Contribution', 'share', 'num'))),
        h('tbody', {}, rows.map(c => {
          const flagged = outOfReference(c.feature, c.value);
          return h('tr', {},
            h('td', {}, LABELS[c.feature] || c.feature, h('div', { class: 'muted' }, c.clinical_domain)),
            h('td', {}, formatValue(c.feature, c.value),
              flagged ? h('div', { class: 'out-of-range' }, icon('warn'), flagged === 'above' ? 'Above range' : 'Below range') : null),
            h('td', { class: 'muted' }, refText(c.feature)),
            h('td', { class: 'num' },
              h('span', { class: 'dir-key', style: { background: c.attribution > 0 ? 'var(--raise)' : c.attribution < 0 ? 'var(--lower)' : 'var(--axis)' } }),
              `${c.attribution > 0 ? '+' : c.attribution < 0 ? '−' : ''}${c.relative_contribution_pct.toFixed(1)}%`));
        })))));
}

export function renderExplain(el, { prediction, target, onTarget }) {
  clear(el);
  if (!prediction) { el.append(h('p', { class: 'muted' }, 'No prediction yet.')); return; }
  const exp = prediction.explanations[target];
  const rerender = () => renderExplain(el, { prediction, target, onTarget });
  const prob = target === 'Cath' ? prediction.overall_cad.probability : prediction.vessels[target].probability;
  const contribs = exp.all_contributions;
  const ups = exp.features_increasing_prediction.slice(0, 2).map(c => `${LABELS[c.feature] || c.feature} (${formatValue(c.feature, c.value)})`);
  const downs = exp.features_decreasing_prediction.slice(0, 2).map(c => `${LABELS[c.feature] || c.feature} (${formatValue(c.feature, c.value)})`);

  el.append(
    h('div', { class: 'seg seg-target', role: 'group', 'aria-label': 'Explain which estimate' },
      ['Cath', 'LAD', 'LCX', 'RCA'].map(t => h('button', { type: 'button', 'aria-pressed': String(t === target), onclick: () => onTarget(t) }, TARGET_NAMES[t]))),
    h('div', { class: 'section' },
      h('h3', {}, `Why ${TARGET_NAMES[target]} is estimated at ${Math.round(prob * 100)}%`),
      h('p', { class: 'small' },
        ups.length ? `Mainly raised by ${ups.join(' and ')}` : 'No factor raised the estimate',
        downs.length ? `; lowered by ${downs.join(' and ')}.` : '.'),
      h('div', { class: 'chart-legend', 'aria-hidden': 'true' },
        h('span', {}, h('i', { style: { background: 'var(--raise)' } }), 'Raises estimate'),
        h('span', {}, h('i', { style: { background: 'var(--lower)' } }), 'Lowers estimate')),
      divergingChart(contribs, exp.attribution_units),
      h('p', { class: 'small muted' },
        `Bars show each measurement's share of the total SHAP attribution for this patient (top 10 of ${contribs.length}). `,
        `Exact TreeExplainer values are in ${UNIT_TEXT[exp.attribution_units] || exp.attribution_units}; `,
        'they describe what drives the model, not biological causes.')),
    h('div', { class: 'section' }, h('h3', {}, 'Contribution by clinical domain'), domainBars(contribs)),
    h('div', { class: 'section' }, h('h3', {}, 'Physiological breakdown'), breakdownTable(contribs, rerender)));
}
