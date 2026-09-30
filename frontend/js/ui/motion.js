// Optional motion layer (GSAP, from the CDN or the local /vendor copy; see js/deps.js). The final state is always written first; animation only
// interpolates towards it. Every helper is a no-op when GSAP is unavailable or the user prefers reduced motion.
let gsap = null;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const last = new Map();   // key -> last displayed value, so re-renders animate only real changes

export async function initMotion() {
  try {
    const m = await import('gsap');
    gsap = m.gsap || m.default;
  } catch {
    gsap = null;   // library unavailable: the app works without motion
  }
}

const enabled = () => gsap !== null && !reduced.matches && !document.hidden;

/** Show `value` in `el` via fmt(); count from the previously shown value (or 0 the first time). */
export function countUp(el, key, value, fmt) {
  const from = last.has(key) ? last.get(key) : 0;
  last.set(key, value);
  el.textContent = fmt(value);
  if (!enabled() || Math.abs(from - value) < 1e-4) return;
  const o = { v: from };
  gsap.to(o, { v: value, duration: 0.7, ease: 'power2.out', onUpdate: () => { el.textContent = fmt(o.v); } });
}

/** Set a bar's width to `fraction` (0–1), growing from its previously shown width. */
export function growWidth(el, key, fraction) {
  const from = last.has(key) ? last.get(key) : 0;
  last.set(key, fraction);
  el.style.width = `${(fraction * 100).toFixed(1)}%`;
  if (!enabled() || Math.abs(from - fraction) < 1e-4) return;
  gsap.fromTo(el, { width: `${(from * 100).toFixed(1)}%` }, { width: `${(fraction * 100).toFixed(1)}%`, duration: 0.7, ease: 'power2.out' });
}

/** Set a numeric CSS property (in `unit`), gliding from its previously shown value for the same key. */
export function moveTo(el, key, prop, value, unit = '%') {
  const from = last.get(key);
  last.set(key, value);
  el.style[prop] = `${value}${unit}`;
  if (!enabled() || from === undefined || Math.abs(from - value) < 1e-6) return;
  gsap.fromTo(el, { [prop]: `${from}${unit}` }, { [prop]: `${value}${unit}`, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
}

/** Set numeric SVG attributes, gliding from the previously shown values for the same key. */
export function attrTo(el, key, attrs) {
  const from = last.get(key);
  last.set(key, attrs);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (!enabled() || from === undefined) return;
  gsap.fromTo(el, { attr: from }, { attr: attrs, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
}

/** Subtle staggered entrance for newly shown content (e.g. a tab switch). */
export function enter(els) {
  if (!enabled() || !els.length) return;
  gsap.from(els, { opacity: 0, y: 6, duration: 0.3, stagger: 0.035, ease: 'power1.out', clearProps: 'opacity,transform' });
}
