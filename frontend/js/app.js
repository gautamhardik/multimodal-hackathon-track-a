import { api } from './api.js';
import { SYSTEMS, SYSTEM_ORDER, VIEWS } from './config/anatomy.js';
import { PatientForm } from './ui/form.js';
import { renderResults, renderThreshold } from './ui/results.js';
import { renderExplain } from './ui/explain.js';
import { renderEvidence } from './ui/evidence.js';
import { h, clear } from './ui/dom.js';
import { heatColor, heatGradientCss, pct } from './ui/colors.js';
import { countUp, enter, initMotion } from './ui/motion.js';

const $ = id => document.getElementById(id);
const state = { prediction: null, performance: null, curves: null, globalImportance: null, examples: [], selected: 'Cath', tab: 'results' };
let scene = null;
let inflight = null;
let debounce = null;

// ---------------------------------------------------------------- theme
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch { /* storage unavailable */ }
  if (saved) document.documentElement.dataset.theme = saved;
  $('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', document.documentElement.dataset.theme); } catch { /* ignore */ }
  });
})();

// ---------------------------------------------------------------- decision thresholds (per viewer, remembered)
const thresholds = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('thresholds') || '{}');
    return Object.fromEntries(Object.entries(saved).filter(([, v]) => Number.isFinite(v) && v >= 0.01 && v <= 0.99));
  } catch { return {}; }
})();
function defaultThreshold(target) {
  const r = target === 'Cath' ? state.prediction?.overall_cad : state.prediction?.vessels?.[target];
  return r?.operating_threshold ?? state.curves?.targets?.[target]?.presets?.default?.threshold ?? 0.5;
}
function getThreshold(target) { return thresholds[target] ?? defaultThreshold(target); }
function setThreshold(target, t) {
  if (Math.abs(t - defaultThreshold(target)) < 5e-4) delete thresholds[target]; else thresholds[target] = t;
  try { localStorage.setItem('thresholds', JSON.stringify(thresholds)); } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------- tabs
const TABS = { results: 'tab-results', threshold: 'tab-threshold', explain: 'tab-explain', evidence: 'tab-evidence' };
function setTab(tab) {
  state.tab = tab;
  for (const [k, id] of Object.entries(TABS)) {
    $(id).setAttribute('aria-selected', String(k === tab));
    $(`pane-${k}`).hidden = k !== tab;
  }
  renderAll();
  enter([...$(`pane-${tab}`).children]);
}
Object.entries(TABS).forEach(([k, id]) => $(id).addEventListener('click', () => setTab(k)));

// ---------------------------------------------------------------- selection
function select(target) {
  state.selected = target;
  if (scene) scene.select(SYSTEMS[target] ? target : null);
  renderAll();
}

// ---------------------------------------------------------------- rendering
function renderLegend() {
  const el = clear($('legend'));
  el.append(
    h('div', { class: 'title' }, 'Estimated probability of ≥ 50% stenosis in the vessel'),
    h('div', { class: 'bar', style: { background: heatGradientCss() } }),
    h('div', { class: 'ticks' }, ['0', '20', '40', '60', '80', '100%'].map(t => h('span', {}, t))),
    h('div', { class: 'nm' }, h('i'), 'Left main & great vessels: not modelled'));
}

function stripValue(sys, v) {
  const el = h('span', { class: 'pr' }, '—');
  if (v) countUp(el, `strip-${sys}`, v.probability, x => pct(x));
  return el;
}

function renderVesselStrip() {
  const el = clear($('vessel-strip'));
  for (const sys of SYSTEM_ORDER) {
    const v = state.prediction?.vessels?.[sys];
    el.append(h('button', {
      type: 'button', class: 'vessel-btn', 'aria-pressed': String(state.selected === sys),
      onclick: () => select(state.selected === sys ? 'Cath' : sys),
    },
      h('span', { class: 'sw', style: { background: v ? heatColor(v.probability) : 'var(--axis)', color: v ? heatColor(v.probability) : 'transparent' } }),
      h('span', {}, h('span', { class: 'nm' }, sys), h('br'), h('span', { class: 'small muted' }, SYSTEMS[sys].name.replace(' artery', ''))),
      stripValue(sys, v)));
  }
}

// Pinned summary above the tabs: every estimate at a glance, flagged ones marked, click to select.
function renderSummary() {
  const el = clear($('summary-strip'));
  const p = state.prediction;
  for (const t of ['Cath', ...SYSTEM_ORDER]) {
    const prob = !p ? null : t === 'Cath' ? p.overall_cad.probability : p.vessels[t].probability;
    const flagged = prob != null && prob >= getThreshold(t);
    const value = h('span', { class: 'sv' }, '—');
    if (prob != null) countUp(value, `sum-${t}`, prob, x => pct(x));
    el.append(h('button', {
      type: 'button', class: `sum-chip${flagged ? ' flagged' : ''}`, 'aria-pressed': String(state.selected === t),
      title: prob == null ? '' : `${t === 'Cath' ? 'Overall CAD' : SYSTEMS[t].name}: ${pct(prob)} — ${flagged ? 'at or above' : 'below'} the decision threshold (${pct(getThreshold(t))})`,
      onclick: () => select(t),
    },
      h('span', { class: 'sd', style: prob == null ? {} : { background: heatColor(prob), color: heatColor(prob) } }),
      h('span', { class: 'sn' }, t === 'Cath' ? 'CAD' : t), value));
  }
}

function renderAll() {
  renderVesselStrip();
  renderSummary();
  const common = { prediction: state.prediction, performance: state.performance };
  if (state.tab === 'results') {
    renderResults($('pane-results'), { ...common, curves: state.curves, selected: state.selected, onSelect: select, getThreshold, setThreshold });
  }
  if (state.tab === 'threshold') {
    renderThreshold($('pane-threshold'), { ...common, curves: state.curves, selected: state.selected, onSelect: select, getThreshold, setThreshold, onChange: renderSummary });
  }
  if (state.tab === 'explain') renderExplain($('pane-explain'), { ...common, target: state.selected, onTarget: select });
  if (state.tab === 'evidence') renderEvidence($('pane-evidence'), { ...common, globalImportance: state.globalImportance, target: state.selected });
}

// ---------------------------------------------------------------- prediction
function setLoading(on) {
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('loading', on));
}

function showErrors(err) {
  const box = $('form-errors');
  form.clearErrors();
  if (!err) { box.hidden = true; return; }
  const general = [];
  const detail = err.body?.detail;
  if (Array.isArray(detail)) {
    for (const d of detail) {
      const key = d.loc?.[d.loc.length - 1];
      const msg = String(d.msg || '').replace(/^Value error, /, '');
      if (!(typeof key === 'string' && key !== 'body' && form.showFieldError(key, msg))) general.push(msg);
    }
  } else {
    general.push(err.status ? `The server rejected the request (${err.status}).` : 'Cannot reach the prediction service. Is the API running?');
  }
  box.hidden = general.length === 0;
  clear(box).append(...general.map(m => h('div', {}, m)));
}

async function runPrediction() {
  const missing = form.missing();
  if (missing.length) {
    showErrors(null);
    for (const k of missing) form.showFieldError(k, 'Required');
    return;
  }
  if (inflight) inflight.abort();
  inflight = new AbortController();
  setLoading(true);
  try {
    const pred = await api.predict(form.payload(), inflight.signal);
    state.prediction = pred;
    showErrors(null);
    if (scene) {
      scene.setProbabilities({ LAD: pred.vessels.LAD.probability, LCX: pred.vessels.LCX.probability, RCA: pred.vessels.RCA.probability });
      scene.setBeat($('toggle-beat').checked, form.values.PR);
    }
    renderAll();
  } catch (err) {
    if (err.name === 'AbortError') return;
    showErrors(err);
  } finally {
    setLoading(false);
  }
}

function schedulePrediction() {
  clearTimeout(debounce);
  debounce = setTimeout(runPrediction, 300);
}

const form = new PatientForm($('patient-form'), schedulePrediction, $('form-tools'));

// ---------------------------------------------------------------- 3D viewer
async function initScene() {
  try {
    const { HeartScene } = await import('./scene/heart-scene.js');
    scene = new HeartScene($('canvas-wrap'), {
      onSelect: sys => select(state.selected === sys ? 'Cath' : sys),
      onBackground: () => select('Cath'),
      onHover: (sys, pos) => {
        const tip = $('vessel-tooltip');
        if (!sys || !pos || !state.prediction) { tip.hidden = true; return; }
        const v = state.prediction.vessels[sys];
        const r = $('canvas-wrap').getBoundingClientRect();
        clear(tip).append(
          h('div', { class: 'v' }, pct(v.probability)),
          h('div', {}, SYSTEMS[sys].name),
          h('div', { class: 's' }, v.probability >= getThreshold(sys) ? 'Stenosis flagged' : `Below decision threshold (${pct(getThreshold(sys))})`),
          h('div', { class: 's' }, 'Click for details'));
        tip.hidden = false;
        tip.style.left = `${Math.min(r.width - tip.offsetWidth - 8, pos.x - r.left + 14)}px`;
        tip.style.top = `${Math.max(8, pos.y - r.top - tip.offsetHeight - 10)}px`;
      },
    });
    await scene.ready;
    $('viewer-loading').remove();
    if (state.prediction) {
      const v = state.prediction.vessels;
      scene.setProbabilities({ LAD: v.LAD.probability, LCX: v.LCX.probability, RCA: v.RCA.probability }, false);
    }
  } catch (e) {
    console.error(e);
    $('viewer-loading').textContent = '3D viewer unavailable (WebGL or the Three.js CDN could not be loaded). All results remain available in the panels.';
  }
}

const viewButtons = $('view-buttons');
let currentView = 'anterior';
function showView(id) {
  const v = VIEWS.find(x => x.id === id);
  if (!v) return;
  currentView = id;
  scene?.setView(id);
  viewButtons.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === id)));
  if (v.torso) $('toggle-torso').checked = true;
}
for (const v of VIEWS) {
  viewButtons.append(h('button', { type: 'button', 'aria-pressed': String(v.id === 'anterior'), dataset: { view: v.id }, onclick: () => showView(v.id) }, v.label));
}

// ---------------------------------------------------------------- full-screen 3D, shortcuts
function setStageMode(on) {
  document.body.classList.toggle('stage-mode', on);
  $('stage-btn').setAttribute('aria-pressed', String(on));
}
$('stage-btn').addEventListener('click', () => setStageMode(!document.body.classList.contains('stage-mode')));
function toggleKeys(force) {
  const pop = $('keys-pop');
  const open = force ?? pop.hidden;
  pop.hidden = !open;
  $('keys-btn').setAttribute('aria-expanded', String(open));
}
$('keys-btn').addEventListener('click', () => toggleKeys());
document.addEventListener('keydown', e => {
  const t = e.target;
  if (e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) {
    if (e.key === 'Escape' && t.classList?.contains('form-search')) t.blur();
    return;
  }
  const targets = { 1: 'Cath', 2: 'LAD', 3: 'LCX', 4: 'RCA' };
  if (targets[e.key]) { select(targets[e.key]); e.preventDefault(); }
  else if (e.key === 'v' || e.key === 'V') { const i = VIEWS.findIndex(v => v.id === currentView); showView(VIEWS[(i + 1) % VIEWS.length].id); }
  else if (e.key === 'f' || e.key === 'F') setStageMode(!document.body.classList.contains('stage-mode'));
  else if (e.key === '/') { e.preventDefault(); setStageMode(false); form.searchEl?.focus(); }
  else if (e.key === '?') toggleKeys();
  else if (e.key === 'Escape') { toggleKeys(false); if (document.body.classList.contains('stage-mode')) setStageMode(false); else select('Cath'); }
});

// Hovering a measurement in the explanation highlights the matching input.
document.addEventListener('feature-hover', e => form.highlight(e.detail));
$('toggle-labels').addEventListener('change', e => scene?.setLabels(e.target.checked));
$('toggle-torso').addEventListener('change', e => scene?.setTorso(e.target.checked));
$('toggle-beat').addEventListener('change', e => scene?.setBeat(e.target.checked, form.values.PR));

// ---------------------------------------------------------------- examples & boot
$('example-select').addEventListener('change', e => {
  const ex = state.examples.find(x => x.id === e.target.value);
  $('example-desc').textContent = ex ? `${ex.description}. Development-cohort patient ${ex.id.replace('dev-', '#')}; outcome not shown.` : '';
  if (ex) { form.setValues(ex.features); runPrediction(); }
});
$('reset-btn').addEventListener('click', () => {
  $('example-select').value = '';
  $('example-desc').textContent = 'Typical values (not a real patient).';
  form.setValues({});
  runPrediction();
});

async function boot() {
  initMotion();
  renderLegend();
  renderVesselStrip();   // placeholders now, so the layout does not shift when estimates arrive
  renderSummary();
  const start = () => (window.requestIdleCallback ? requestIdleCallback(() => initScene(), { timeout: 1200 }) : setTimeout(initScene, 150));
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
  const status = $('api-status');
  try {
    const health = await api.health();
    status.textContent = `API ready · model v${health.model_version}`;
    status.className = 'api-status ok';
  } catch {
    status.textContent = 'API unreachable';
    status.className = 'api-status err';
  }
  const [perf, gi, ex, oc] = await Promise.allSettled([api.performance(), api.globalImportance(), api.examples(), api.operatingCurves()]);
  if (perf.status === 'fulfilled') state.performance = perf.value;
  if (oc.status === 'fulfilled') state.curves = oc.value;
  if (gi.status === 'fulfilled') state.globalImportance = gi.value;
  if (ex.status === 'fulfilled') {
    state.examples = ex.value.patients;
    const sel = $('example-select');
    for (const p of state.examples) sel.append(h('option', { value: p.id }, p.title));
  }
  const first = state.examples.find(p => p.title.startsWith('LAD')) || state.examples[0];
  if (first) {
    $('example-select').value = first.id;
    $('example-select').dispatchEvent(new Event('change'));
  } else {
    form.setValues({});
    runPrediction();
  }
  renderAll();
}

boot();
