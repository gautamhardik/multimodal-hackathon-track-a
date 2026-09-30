// Tiny DOM helper. Strings become text nodes (never innerHTML), so API-provided labels can't inject markup.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, x) : (el.style[p] = x);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function icon(name) {
  const paths = {
    warn: 'M12 3 2 20h20L12 3zm0 6v5m0 3h.01',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-11v6m0-9h.01',
    up: 'M12 19V5m-6 6 6-6 6 6',
    down: 'M12 5v14m6-6-6 6-6-6',
    flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
    check: 'M5 12l5 5 9-10',
  };
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', paths[name]);
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const tip = () => document.getElementById('chart-tooltip');
export function showTooltip(evt, build) {
  const t = tip();
  clear(t).append(...build());
  t.hidden = false;
  const r = evt.currentTarget.getBoundingClientRect();
  const x = evt.clientX ?? (r.left + r.width / 2);
  const y = evt.clientY ?? r.top;
  const tw = t.offsetWidth, th = t.offsetHeight;
  t.style.left = `${Math.min(window.innerWidth - tw - 8, x + 12)}px`;
  t.style.top = `${Math.max(8, y - th - 10)}px`;
}
export function hideTooltip() { tip().hidden = true; }

/** Layout-shaped placeholder shown while data loads (no spinner). */
export function skeleton(label = 'Loading…') {
  const bar = (w, hgt = 12) => h('div', { class: 'sk', style: { width: w, height: `${hgt}px` } });
  return h('div', { class: 'skeleton', role: 'status', 'aria-busy': 'true', 'aria-label': label },
    bar('45%', 11), bar('38%', 54), bar('100%', 8), bar('70%', 11),
    h('div', { class: 'sk-card' }, bar('55%', 12), bar('100%', 8)),
    h('div', { class: 'sk-card' }, bar('50%', 12), bar('100%', 8)),
    h('div', { class: 'sk-card' }, bar('60%', 12), bar('100%', 8)));
}
