// Landing page: scroll story around the 3D heart. All numbers come from the API (example development patient,
// one-time holdout metrics), so the page never shows invented values.
import { api } from './api.js';
import { SYSTEMS, SYSTEM_ORDER } from './config/anatomy.js';
import { LABELS, formatValue } from './config/features.js';
import { heatColor, pct } from './ui/colors.js';
import { h, clear } from './ui/dom.js';
import { HeartbeatSound, soundButton } from './ui/heartbeat.js';

const $ = sel => document.querySelector(sel);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => window.matchMedia('(max-width: 980px)').matches;
const TAU = Math.PI * 2;
// Rotation (about the vertical axis) that turns each artery towards the viewer; matches the explorer's camera presets.
const FACING = { LAD: 0, LCX: -1.33, RCA: 0.67 };
const STEP_COPY = {
  LAD: 'Left anterior descending',
  LCX: 'Left circumflex',
  RCA: 'Right coronary',
};

let gsap = null, ScrollTrigger = null, scene = null;
const state = { perf: null, example: null, pred: null, section: 'top' };

async function loadMotion() {
  if (reduced) return;
  // Content stays hidden until the intro runs, so never wait long for the CDN.
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('motion timeout')), 4000));
  try {
    const [core, st] = await Promise.race([Promise.all([import('gsap'), import('gsap/ScrollTrigger.js')]), timeout]);
    gsap = core.gsap;
    ScrollTrigger = st.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);
  } catch (e) {
    window.depsFailed?.(e);
    gsap = null;
    ScrollTrigger = null;
  }
}

function tween(target, vars) {
  if (gsap) return gsap.to(target, { duration: 1.3, ease: 'power3.inOut', overwrite: 'auto', ...vars });
  const { duration, ease, delay, stagger, onComplete, ...rest } = vars;
  Object.assign(target, rest);
  return null;
}

// ---------------------------------------------------------------- 3D stage
async function initStage() {
  try {
    const { StoryScene } = await import('./scene/story-scene.js');
    scene = new StoryScene($('#stage'));
    await scene.load();
    applySection(state.section, true);
    if (gsap) gsap.from(scene.pose, { scale: scene.pose.scale * 0.6, duration: 1.8, ease: 'expo.out' });
    if (state.pred) paintHeart();
  } catch (e) {
    if (window.depsFailed?.(e)) return;   // CDN module failed: the page reloads with the local copies
    console.warn('3D stage unavailable', e);
    $('#stage').remove();
  }
}

function faceSystem(sys) {
  if (!scene) return;
  scene.pose.spin = 0;
  let a = scene.spinAngle % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  scene.spinAngle = a;
  tween(scene, { spinAngle: 0 });
  if (!ScrollTrigger) tween(scene.pose, { rotY: FACING[sys] ?? 0 });
}

const POSES = {
  top: { stage: '', pose: { x: 0.26, y: -0.06, scale: 0.8, rotX: 0.08, rotY: 0 }, spin: 1 },   // between the copy and the example card
  anatomy: { stage: '', pose: { x: 0.4, y: 0, scale: 1.18, rotX: 0.05 }, spin: 0 },
  method: { stage: 'dim', pose: { x: -0.35, y: 0, scale: 0.95, rotX: 0.1, rotY: 0 }, spin: 0.6 },
  explain: { stage: 'dim', pose: { x: 0.35, y: 0, scale: 0.95, rotX: 0.1 }, spin: 0.4 },
  evidence: { stage: 'hidden', pose: { x: 0, y: 0, scale: 0.8 }, spin: 0.3 },
  closing: { stage: 'soft', pose: { x: 0, y: -0.3, scale: 0.85, rotX: 0.05, rotY: 0 }, spin: 1 },
};

// Hero: centre the heart in the free space between the intro paragraph and the example card, measured from the
// layout (the copy column is centred and capped in width while the canvas spans the whole window).
// The heart's on-screen width is about 0.35 x viewport height x pose.scale, so it is scaled down to fit narrow gaps.
const HERO_MAX_SCALE = 1.0;   // the heart grows into the gap between the copy and the card, up to this size

function heroPose() {
  const base = POSES.top.pose;
  const lede = $('.hero .lede')?.getBoundingClientRect();
  const card = $('#readout')?.getBoundingClientRect();
  if (!lede || !card || !card.width) return { x: base.x, scale: base.scale };
  // the copy's right edge: the paragraph, or the headline's text where it runs further (wide screens)
  const copyRight = Math.max(lede.right, ...[...document.querySelectorAll('.hero .display .line > *')].map(el => el.getBoundingClientRect().right));
  if (card.left <= copyRight) return { x: base.x, scale: base.scale };
  const gap = card.left - copyRight;
  return {
    x: ((copyRight + card.left) / 2 / window.innerWidth) * 2 - 1,
    scale: Math.max(0.55, Math.min(HERO_MAX_SCALE, (gap * 0.9) / (0.35 * window.innerHeight))),
  };
}

function applySection(id, instant = false) {
  state.section = id;
  document.querySelectorAll('.nav nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
  const cfg = POSES[id] || POSES.top;
  document.body.dataset.stage = narrow() && !cfg.stage ? 'soft' : cfg.stage;   // phones: text sits over the heart
  if (!scene) return;
  const pose = { ...cfg.pose };
  if (id === 'top' && !narrow()) Object.assign(pose, heroPose());
  if (narrow()) { pose.x = 0; pose.y = id === 'top' ? 0.12 : 0; pose.scale = (pose.scale || 1) * 0.8; }
  if (id !== 'anatomy') scene.setFocus(null);
  scene.pose.spin = reduced ? 0 : cfg.spin;
  if (instant) Object.assign(scene.pose, pose); else tween(scene.pose, pose);
}

function paintHeart() {
  if (!scene || !state.pred) return;
  const v = state.pred.vessels;
  scene.setProbabilities({ LAD: v.LAD.probability, LCX: v.LCX.probability, RCA: v.RCA.probability });
  const bpm = Number(state.example?.features?.PR);
  if (bpm >= 40 && bpm <= 150) scene.bpm = bpm;
}

// ---------------------------------------------------------------- ECG trace (period follows the example's pulse rate)
function drawEcg(bpm = 72) {
  const svg = $('#ecg-svg'), path = $('#ecg-path');
  const beatW = 190, H = 64, base = 42;
  const n = Math.ceil(window.innerWidth / beatW) + 1;
  const pts = [];
  for (let b = 0; b < 2 * n; b++) {
    const o = b * beatW, x = f => (o + f * beatW).toFixed(1);
    pts.push(`${b ? 'L' : 'M'}${x(0)},${base}`, `L${x(0.16)},${base}`,
      `C${x(0.19)},${base - 7} ${x(0.25)},${base - 7} ${x(0.28)},${base}`, `L${x(0.36)},${base}`, `L${x(0.385)},${base + 5}`,
      `L${x(0.415)},${base - 34}`, `L${x(0.445)},${base + 12}`, `L${x(0.47)},${base}`, `L${x(0.58)},${base}`,
      `C${x(0.63)},${base - 12} ${x(0.71)},${base - 12} ${x(0.76)},${base}`, `L${x(1)},${base}`);
  }
  path.setAttribute('d', pts.join(' '));
  svg.setAttribute('viewBox', `0 0 ${2 * n * beatW} ${H}`);
  svg.style.width = `${2 * n * beatW}px`;
  svg.parentElement.style.setProperty('--ecg-period', `${(n * 60) / bpm}s`);
  svg.parentElement.style.setProperty('--beat', `${60 / bpm}s`);
  $('#bpm').textContent = Math.round(bpm);
}

// ---------------------------------------------------------------- content from the API
function renderReadout() {
  const p = state.pred;
  $('#readout-cad').textContent = pct(p.overall_cad.probability);
  const rows = clear($('#readout-rows'));
  for (const sys of SYSTEM_ORDER) {
    const v = p.vessels[sys].probability;
    rows.append(h('li', {},
      h('span', { class: 'nm' }, sys),
      h('span', { class: 'bar' }, h('i', { style: { width: pct(v, 1), background: heatColor(v) } })),
      h('span', { class: 'v' }, pct(v))));
  }
  if (gsap) gsap.from('#readout-rows .bar i', { scaleX: 0, duration: 1.2, stagger: 0.12, ease: 'power3.out', delay: 0.4 });
}

const CHEST = [
  ['none', 'None', { 'Typical Chest Pain': 0, Atypical: 'N', Nonanginal: 'N' }],
  ['typical', 'Typical', { 'Typical Chest Pain': 1, Atypical: 'N', Nonanginal: 'N' }],
  ['atypical', 'Atypical', { 'Typical Chest Pain': 0, Atypical: 'Y', Nonanginal: 'N' }],
  ['nonanginal', 'Non-anginal', { 'Typical Chest Pain': 0, Atypical: 'N', Nonanginal: 'Y' }],
];
let whatIf = null, whatIfTimer = null, whatIfCtl = null, whatIfDirty = false;

function renderTryIt() {
  const base = state.example.features;
  const cur = CHEST.find(([, , f]) => Object.entries(f).every(([k, v]) => base[k] === v)) || CHEST[0];
  whatIf = { chest: cur[0], ef: Number(base['EF-TTE']) || 50 };
  const box = clear($('#tryit'));
  const chips = CHEST.map(([id, label]) => h('button', {
    type: 'button', class: 'try-chip', 'aria-pressed': String(id === whatIf.chest),
    onclick: () => { whatIf.chest = id; chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.id === id))); runWhatIf(); },
    dataset: { id },
  }, label));
  const out = h('output', { class: 'try-val' }, `${whatIf.ef}%`);
  const range = h('input', { type: 'range', min: 15, max: 70, step: 1, value: whatIf.ef, class: 'try-range', 'aria-label': 'Ejection fraction' });
  range.addEventListener('input', () => { whatIf.ef = Number(range.value); out.textContent = `${whatIf.ef}%`; runWhatIf(); });
  const body = h('div', { class: 'try-body', id: 'try-body', hidden: true },
    h('div', { class: 'try-label' }, 'Chest pain'), h('div', { class: 'try-chips', role: 'group', 'aria-label': 'Chest pain' }, chips),
    h('div', { class: 'try-label' }, 'Ejection fraction', out), range);
  const toggle = h('button', {
    type: 'button', class: 'try-toggle', 'aria-expanded': 'false', 'aria-controls': 'try-body',
    onclick: () => { const open = body.hidden; body.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); },
  }, h('span', {}, 'Try it'), h('span', { class: 'muted' }, 'change a measurement'), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
  box.append(toggle, body);
  box.removeAttribute('aria-busy');
}

function runWhatIf() {
  clearTimeout(whatIfTimer);
  whatIfTimer = setTimeout(async () => {
    const chest = CHEST.find(([id]) => id === whatIf.chest)[2];
    const payload = { ...state.example.features, ...chest, 'EF-TTE': whatIf.ef };
    delete payload.BMI; delete payload.Obesity;
    whatIfCtl?.abort();
    whatIfCtl = new AbortController();
    try {
      state.pred = await api.predict(payload, whatIfCtl.signal);
      whatIfDirty = true;
      renderReadout();
      paintHeart();
      renderShap();
    } catch { /* aborted or unavailable: keep the last estimate */ }
  }, 180);
}

function renderSteps() {
  const ol = clear($('#steps'));
  for (const sys of SYSTEM_ORDER) {
    const s = SYSTEMS[sys];
    const prob = state.pred?.vessels?.[sys]?.probability;
    const auc = state.perf?.targets?.[sys]?.['holdout_v1_at_0.50']?.['ROC-AUC'];
    ol.append(h('li', { class: 'step', dataset: { sys } },
      h('div', { class: 'step-card glass' },
        h('div', { class: 'step-top' },
          h('span', { class: 'step-dot', style: { background: prob == null ? 'var(--ink-3)' : heatColor(prob), color: prob == null ? 'transparent' : heatColor(prob) } }),
          h('span', { class: 'step-abbr' }, sys)),
        h('h3', {}, `${STEP_COPY[sys]} artery`),
        h('p', {}, s.course),
        h('p', {}, h('strong', {}, 'Supplies: '), s.territory),
        h('div', { class: 'meta' },
          prob == null ? null : h('span', {}, 'Example estimate ', h('strong', {}, pct(prob))),
          auc ? h('span', {}, 'Holdout ROC-AUC ', h('strong', {}, auc.estimate.toFixed(2))) : null))));
  }
  observeSteps();
}

function renderShap() {
  const p = state.pred;
  const sys = SYSTEM_ORDER.reduce((a, b) => (p.vessels[b].probability > p.vessels[a].probability ? b : a));
  const contribs = [...p.explanations[sys].all_contributions].sort((a, b) => b.relative_contribution_pct - a.relative_contribution_pct).slice(0, 7);
  // Zero sits where the data needs it: one shared scale, room for the % label on each side that has bars
  // (all-raising patients get a plain left-anchored chart instead of an empty left half).
  const peak = sign => Math.max(0, ...contribs.filter(c => (c.attribution > 0) === sign).map(c => c.relative_contribution_pct));
  const up = peak(true), down = peak(false);
  const padL = down ? 10 : 0, padR = up ? 10 : 0;
  const scale = (100 - padL - padR) / (up + down);
  const zero = padL + down * scale;
  $('#explain-caption').textContent =
    `The ${whatIfDirty ? 'adjusted example' : "example patient's"} ${sys} estimate is ${pct(p.vessels[sys].probability)}. These seven measurements carry the largest share of its exact SHAP attribution.`;
  const box = clear($('#shap'));
  for (const c of contribs) {
    const raises = c.attribution > 0;
    const w = c.relative_contribution_pct * scale;
    const at = raises ? { left: `${zero}%` } : { right: `${100 - zero}%` };
    box.append(h('div', { class: 'shap-row', role: 'listitem', 'aria-label': `${LABELS[c.feature] || c.feature}: ${raises ? 'raises' : 'lowers'} the estimate, ${c.relative_contribution_pct.toFixed(0)}% of attribution` },
      h('div', { class: 'name' }, LABELS[c.feature] || c.feature, h('span', { class: 'val' }, formatValue(c.feature, c.value))),
      h('div', { class: 'shap-track', style: { '--zero': `${zero}%` } },
        h('div', { class: `shap-bar ${raises ? 'raise' : 'lower'}`, style: { ...at, width: `${w}%` } }),
        h('div', { class: 'shap-pct', style: raises ? { left: `calc(${zero + w}% + 6px)` } : { right: `calc(${100 - zero + w}% + 6px)` } },
          `${c.relative_contribution_pct.toFixed(0)}%`))));
  }
  box.append(h('p', { class: 'shap-foot' }, 'Share of total attribution for this patient. Explanations describe the model, not biological causes.'));
  if (gsap) {
    gsap.from('#shap .shap-bar', { scaleX: 0, duration: 1, stagger: 0.07, ease: 'power3.out', scrollTrigger: { trigger: '#shap', start: 'top 75%' } });
  }
}

function parseCi(ci) {
  const [lo, hi] = String(ci).replace(/[[\]()]/g, '').split(/[–,-]\s*/).map(Number);
  return [lo, hi];
}

function renderEvidence() {
  const grid = clear($('#evidence-grid'));
  const t = state.perf.targets;
  const x = v => `${((v - 0.5) / 0.5) * 100}%`;
  const cad = t.Cath['holdout_v1_at_0.50']['ROC-AUC'];
  const [clo, chi] = parseCi(cad.ci95);
  const rows = [['Cath', 'Overall CAD'], ['LAD', 'LAD'], ['LCX', 'LCX'], ['RCA', 'RCA']].map(([k, name]) => {
    const auc = t[k]['holdout_v1_at_0.50']['ROC-AUC'];
    const [lo, hi] = parseCi(auc.ci95);
    return h('div', { class: 'fp-row', role: 'listitem', 'aria-label': `${name}: ROC-AUC ${auc.estimate.toFixed(2)}, 95% CI ${lo.toFixed(2)} to ${hi.toFixed(2)}` },
      h('span', { class: 'fp-name' }, name),
      h('div', { class: 'fp-track' },
        h('div', { class: 'fp-ci', style: { left: x(lo), width: `calc(${x(hi)} - ${x(lo)})`, transformOrigin: `${((auc.estimate - lo) / (hi - lo)) * 100}% 50%` } }),
        h('div', { class: 'fp-pt', style: { left: x(auc.estimate) } })),
      h('span', { class: 'fp-val' }, auc.estimate.toFixed(2), h('small', {}, `${lo.toFixed(2)}–${hi.toFixed(2)}`)));
  });
  const ticks = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  grid.append(
    h('article', { class: 'ev glass hero-ev' },
      h('div', { class: 'lbl' }, 'Overall coronary artery disease · holdout ROC-AUC'),
      h('div', { class: 'num', dataset: { count: cad.estimate } }, cad.estimate.toFixed(2)),
      h('div', { class: 'ci' }, `95% CI ${clo.toFixed(2)}–${chi.toFixed(2)} · 61 patients, scored once`)),
    h('article', { class: 'ev glass forest' },
      h('div', { class: 'lbl' }, 'All four models on one scale'),
      h('div', { class: 'fp', role: 'list' },
        h('div', { class: 'fp-grid', 'aria-hidden': 'true' }, ticks.map(v => h('i', { style: { left: x(v) } }))),
        rows,
        h('div', { class: 'fp-axis', 'aria-hidden': 'true' }, h('span', {}), h('div', { class: 'fp-ticks' },
          ticks.map(v => h('span', { style: { left: x(v) } }, v === 0.5 ? '0.5 chance' : v.toFixed(1)))), h('span', {})))),
    h('article', { class: 'ev glass note' },
      h('p', {}, h('strong', {}, 'Calibrated. '), 'Probabilities were recalibrated on development data, which does not change the ranking above; within each colour band the observed stenosis rate tracks the estimate.'),
      h('p', {}, h('strong', {}, 'Honest limits. '), 'Artery-level prediction is harder than overall CAD, and 61 patients give wide intervals. The explorer shows these uncertainties next to every result.')));
  if (gsap) {
    const el = grid.querySelector('.hero-ev .num'), o = { v: 0.5 };
    gsap.to(o, { v: cad.estimate, duration: 1.6, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 85%' }, onUpdate: () => { el.textContent = o.v.toFixed(2); } });
    gsap.from('#evidence-grid .fp-ci', { scaleX: 0, duration: 1.1, stagger: 0.12, ease: 'power3.out', scrollTrigger: { trigger: '.forest', start: 'top 75%' } });
    gsap.from('#evidence-grid .fp-pt', { scale: 0, duration: 0.6, stagger: 0.12, delay: 0.25, ease: 'back.out(2)', scrollTrigger: { trigger: '.forest', start: 'top 75%' } });
    gsap.from('#evidence-grid .ev', { y: 30, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: '#evidence-grid', start: 'top 80%' } });
  }
}

// ---------------------------------------------------------------- scroll structure
function observeSections() {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) applySection(e.target.id || 'closing');
  }, { rootMargin: '-48% 0px -48% 0px' });
  document.querySelectorAll('main > section').forEach(s => io.observe(s));
}

let stepObserver = null;
function observeSteps() {
  stepObserver?.disconnect();
  stepObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const sys = e.target.dataset.sys;
      if (!ScrollTrigger) document.querySelectorAll('.step').forEach(s => s.classList.toggle('active', s === e.target));
      if (!ScrollTrigger && state.section === 'anatomy' && scene) { scene.setFocus(sys); faceSystem(sys); }
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  document.querySelectorAll('.step').forEach(s => stepObserver.observe(s));
}

// Scroll position drives the anatomy story: each third of the section traces one artery from its ostium,
// the heart turns towards it and the others dim. Scrolling back reverses everything.
let storyIndex = -1;
function storyProgress(p) {
  if (!scene) return;
  const i = Math.min(2, Math.floor(p * 3));
  const local = Math.min(1, Math.max(0, p * 3 - i));
  SYSTEM_ORDER.forEach((sys, j) => scene.setReveal(sys, j < i ? 1 : j === i ? Math.min(1, local * 1.7) : 0));
  const sys = SYSTEM_ORDER[i];
  if (i !== storyIndex) {
    storyIndex = i;
    scene.setFocus(sys);
    faceSystem(sys);
    document.querySelectorAll('.step').forEach(s => s.classList.toggle('active', s.dataset.sys === sys));
  }
  gsap.to(scene.pose, { rotY: (FACING[sys] ?? 0) + (local - 0.5) * 0.45, duration: 0.6, ease: 'power2.out', overwrite: 'auto' });
}
function revealAll() {
  storyIndex = -1;
  if (!scene) return;
  SYSTEM_ORDER.forEach(sys => scene.setReveal(sys, 1));
}

function introMotion() {
  if (!gsap) { document.documentElement.classList.add('reduced'); return; }
  ScrollTrigger.create({
    trigger: '#steps', start: 'top 55%', end: 'bottom 45%', scrub: true,
    onUpdate: self => storyProgress(self.progress),
    onLeave: revealAll, onLeaveBack: revealAll,
  });
  for (const el of document.querySelectorAll('.section-head, .timeline li, .closing > *')) {
    gsap.from(el, { opacity: 0, y: 28, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 85%' } });
  }
  gsap.fromTo('.timeline-line path', { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: '.timeline', start: 'top 70%', end: 'bottom 60%', scrub: 0.6 } });
  gsap.utils.toArray('.facts dt').forEach(el => {
    const target = Number(el.dataset.count), o = { v: 0 };
    gsap.to(o, { v: target, duration: 1.4, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 85%' },
      onUpdate: () => { el.textContent = Math.round(o.v); } });
  });
}

async function loadData() {
  const [perf, ex] = await Promise.allSettled([api.performance(), api.examples()]);
  if (perf.status === 'fulfilled') { state.perf = perf.value; renderEvidence(); }
  if (ex.status === 'fulfilled') {
    const list = ex.value.patients;
    state.example = list.find(p => p.title.startsWith('RCA')) || list.find(p => /multi/i.test(p.title)) || list[0];
    try {
      state.pred = await api.predict(state.example.features);
      renderReadout();
      renderShap();
      paintHeart();
      renderTryIt();
      drawEcg(Number(state.example.features.PR) || 72);
      $('#readout-note').textContent = `${state.example.title} · outcome hidden`;
    } catch {
      $('#readout').hidden = true;
    }
  } else {
    $('#readout').hidden = true;
    $('#explain-caption').textContent = 'The prediction service is not reachable, so the example explanation cannot be shown.';
  }
  renderSteps();
  ScrollTrigger?.refresh();
}

// Placeholder rows keep the example card at its final size until the estimates arrive (no layout shift).
function renderReadoutPlaceholder() {
  const rows = clear($('#readout-rows'));
  for (const sys of SYSTEM_ORDER) rows.append(h('li', {}, h('span', { class: 'nm' }, sys), h('span', { class: 'bar' }), h('span', { class: 'v' }, '—')));
}

async function boot() {
  if (reduced) document.documentElement.classList.add('reduced');
  renderReadoutPlaceholder();
  drawEcg(72);
  window.addEventListener('resize', () => {
    drawEcg(Number(state.example?.features?.PR) || 72);
    if (state.section === 'top') applySection('top', true);
  });
  renderSteps();
  observeSections();
  // Heartbeat sound, in time with the 3D heart (rate = the example patient's pulse).
  const soundCtl = soundButton($('#sound-btn'), new HeartbeatSound(() => scene?.beatClock() ?? null, { volume: 0.5 }));
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName)) return;
    if (e.key === 's' || e.key === 'S') soundCtl.toggle();
  });
  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  await loadMotion();
  introMotion();
  loadData();
  // The 3D stage starts once the page is readable and the browser is idle (keeps first paint fast).
  let started = false;
  const start = () => !started && (started = true) && (window.requestIdleCallback ? requestIdleCallback(() => initStage(), { timeout: 1500 }) : setTimeout(initStage, 200));
  if (document.readyState === 'complete') start();
  else { window.addEventListener('load', start, { once: true }); setTimeout(start, 2500); }   // never wait on a slow third party
}

boot();
