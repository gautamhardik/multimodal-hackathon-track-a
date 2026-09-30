// Synthesised heartbeat ("lub-dub") that follows the 3D heart. No audio files: two short pitched thumps per beat,
// with a second harmonic and a soft thud so they are audible on laptop speakers.
// Off by default; the listener turns it on (browsers only start audio after a user gesture). Beats are scheduled
// on the Web Audio clock from the scene's own beat clock, so each sound lands on the visible pulse.
const KEY = 'heartbeat-sound';
const LUB_PHASE = 0.11;   // where the scenes put the first (larger) contraction peak
const DUB_OFFSET = 0.29;  // second sound, as a fraction of the beat period
const LOOKAHEAD = 0.15;   // seconds of audio scheduled ahead of time

export function soundPreferred() {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

export class HeartbeatSound {
  /** `clock()` returns { t, bpm } of the visible heartbeat (scene seconds), or null while the heart is not beating. */
  constructor(clock, { volume = 0.55 } = {}) {
    this.clock = clock;
    this.volume = volume;
    this.ctx = null;
    this.on = false;
    this.lastLub = -1;
    this.timer = null;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else if (this.on) this.ctx.resume();
    });
  }

  /** Must be called from a user gesture the first time (click, key press). */
  setOn(on) {
    this.on = on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
    if (on) {
      if (!this._ensureContext()) { this.on = false; return false; }
      this.ctx.resume();
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.08);
      if (!this.timer) this.timer = setInterval(() => this._schedule(), 40);
    } else if (this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      clearInterval(this.timer);
      this.timer = null;
      this.lastLub = -1;
    }
    return this.on;
  }

  _ensureContext() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 900;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(tone).connect(comp).connect(ctx.destination);
    const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.12), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    Object.assign(this, { ctx, master, noise });
    return true;
  }

  // One heart sound: a falling low tone, its octave, and a short band-passed thud.
  _thump(at, f0, f1, dur, level) {
    const { ctx, master } = this;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(level, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    env.connect(master);
    for (const [mult, type, amp] of [[1, 'sine', 1], [2, 'triangle', 0.35]]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0 * mult, at);
      osc.frequency.exponentialRampToValueAtTime(f1 * mult, at + dur);
      g.gain.value = amp;
      osc.connect(g).connect(env);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    }
    const src = ctx.createBufferSource();
    const band = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = this.noise;
    band.type = 'bandpass';
    band.frequency.value = 160;
    band.Q.value = 1.2;
    g.gain.value = 0.5;
    src.connect(band).connect(g).connect(env);
    src.start(at);
  }

  _schedule() {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const c = this.clock();
    if (!c || !(c.bpm > 0)) { this.lastLub = -1; return; }
    const now = this.ctx.currentTime;
    const period = 60 / c.bpm;
    const phase = (c.t / period) % 1;
    const onPulse = now + (((LUB_PHASE - phase) % 1 + 1) % 1) * period;   // next lub per the (frame-quantised) scene clock
    let at;
    if (this.lastLub > 0 && now - this.lastLub < 2 * period) {
      // Keep a steady rhythm and phase-lock gently: nudge at most 12 ms per beat towards the visible pulse.
      at = this.lastLub + period;
      let drift = (onPulse - at) % period;
      if (drift > period / 2) drift -= period;
      if (drift < -period / 2) drift += period;
      at += Math.max(-0.012, Math.min(0.012, drift * 0.3));
    } else {
      at = onPulse;
    }
    if (at - now > LOOKAHEAD) return;
    at = Math.max(at, now + 0.005);
    this.lastLub = at;
    this._thump(at, 58, 40, 0.16, 0.9);
    this._thump(at + DUB_OFFSET * period, 72, 50, 0.12, 0.55);
  }
}

/** Speaker toggle button wired to a HeartbeatSound; restores the saved choice on the first user gesture. */
export function soundButton(button, sound, { onEnable } = {}) {
  const ICON_ON = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>';
  const ICON_OFF = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5m0-5-5 5"/>';
  const paint = on => {
    button.setAttribute('aria-pressed', String(on));
    button.title = on ? 'Heartbeat sound: on (S)' : 'Heartbeat sound: off (S)';
    button.querySelector('svg').innerHTML = on ? ICON_ON : ICON_OFF;
  };
  const toggle = () => {
    const on = sound.setOn(!sound.on);
    if (on) onEnable?.();
    paint(on);
  };
  button.addEventListener('click', toggle);
  paint(false);
  if (soundPreferred()) {
    // Audio may only start after a gesture, so a saved "on" resumes at the first click or key press
    // (unless that gesture is the toggle itself or its shortcut, which then turn it on directly).
    const stop = () => {
      window.removeEventListener('pointerdown', resume, true);
      window.removeEventListener('keydown', resume, true);
    };
    const resume = e => {
      stop();
      if (button.contains(e.target) || e.key === 's' || e.key === 'S') return;
      if (!sound.on && sound.setOn(true)) { onEnable?.(); paint(true); }
    };
    window.addEventListener('pointerdown', resume, true);
    window.addEventListener('keydown', resume, true);
    button.title = 'Heartbeat sound: resumes on your first click (S)';
  }
  return { toggle, paint };
}
