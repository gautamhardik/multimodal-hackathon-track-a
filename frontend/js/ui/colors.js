// Sequential "heat" ramp for probability (semantic-heat exception to one-hue sequential; always shown with a
// numeric scale legend). OKLab lightness strictly decreases across the stops (verified), so order survives
// colour-vision deficiency and greyscale.
export const HEAT_STOPS = ['#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'];
export const NEUTRAL_VESSEL = '#c7c6bf';

function hexToRgb(h) {
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
}

export function heatColor(p) {
  const x = Math.min(1, Math.max(0, p)) * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = hexToRgb(HEAT_STOPS[i]);
  const b = hexToRgb(HEAT_STOPS[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

export function heatGradientCss() {
  return `linear-gradient(90deg, ${HEAT_STOPS.map((c, i) => `${c} ${(i / (HEAT_STOPS.length - 1) * 100).toFixed(1)}%`).join(', ')})`;
}

export function pct(p, digits = 0) {
  return `${(p * 100).toFixed(digits)}%`;
}
