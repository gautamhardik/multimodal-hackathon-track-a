import { FIELDS, GROUPS, CHEST_PAIN, outOfReference } from '../config/features.js';
import { h, clear } from './dom.js';

// Typical values used when the form is reset (not a real patient).
export const DEFAULT_PATIENT = {
  Age: 58, Sex: 'Male', Weight: 74, Length: 165, DM: 0, HTN: 0, DLP: 'N', FH: 0, 'Current Smoker': 0, 'EX-Smoker': 0,
  CRF: 'N', CVA: 'N', 'Airway disease': 'N', 'Thyroid Disease': 'N', CHF: 'N',
  'Typical Chest Pain': 0, Atypical: 'N', Nonanginal: 'N', 'LowTH Ang': 'N', Dyspnea: 'N', 'Function Class': 0,
  BP: 130, PR: 72, Edema: 0, 'Weak Peripheral Pulse': 'N', 'Lung rales': 'N', 'Systolic Murmur': 'N', 'Diastolic Murmur': 'N',
  'Q Wave': 0, 'St Elevation': 0, 'St Depression': 0, Tinversion: 0, LVH: 'N', 'Poor R Progression': 'N', BBB: 'N',
  FBS: 98, CR: 1.0, TG: 122, LDL: 100, HDL: 39, BUN: 16, ESR: 15, HB: 13.2, K: 4.2, Na: 141, WBC: 7100, Lymph: 32, Neut: 60,
  PLT: 210, 'EF-TTE': 50, 'Region RWMA': 0, VHD: 'N',
};

// A finding "counts" in a section badge when it is present (yes/abnormal) or outside the typical adult range.
function isFlagged(f, v) {
  if (f.type === 'b01') return v === 1;
  if (f.type === 'yn') return v === 'Y';
  if (f.type === 'num') return outOfReference(f.key, v) !== null;
  if (f.key === 'Function Class' || f.key === 'Region RWMA') return Number(v) > 0;
  if (f.key === 'BBB' || f.key === 'VHD') return v !== 'N';
  return false;
}

export class PatientForm {
  constructor(formEl, onChange, toolsEl = null) {
    this.formEl = formEl;
    this.toolsEl = toolsEl;
    this.onChange = onChange;
    this.values = { ...DEFAULT_PATIENT };
    this.controls = {};
    this.groups = {};
    this.query = '';
    this._render();
  }

  _render() {
    clear(this.formEl);
    for (const g of GROUPS) {
      const fields = FIELDS.filter(f => f.group === g.id);
      const grid = h('div', { class: 'fields' }, fields.map(f => this._field(f)));
      const count = h('span', { class: 'group-count' });
      const details = h('details', { class: 'group', open: g.open, dataset: { group: g.id } },
        h('summary', {}, h('span', {}, g.title), count), grid);
      // Accordion: opening one section closes the others (not while searching, when all matches are shown).
      details.addEventListener('toggle', () => {
        if (details.open && !this.query) for (const o of Object.values(this.groups)) if (o.details !== details) o.details.open = false;
        this._refreshNav();
      });
      this.groups[g.id] = { details, count, fields };
      this.formEl.append(details);
    }
    if (this.toolsEl) this._renderTools();
  }

  _renderTools() {
    const search = h('input', { type: 'search', class: 'form-search', placeholder: 'Find a measurement…', 'aria-label': 'Find a measurement' });
    search.addEventListener('input', () => this.filter(search.value));
    this.chips = GROUPS.map(g => h('button', {
      type: 'button', class: 'nav-chip', dataset: { group: g.id }, onclick: () => { search.value = ''; this.filter(''); this.openGroup(g.id); },
    }, g.short, h('span', { class: 'chip-count' })));
    clear(this.toolsEl).append(
      h('div', { class: 'search-wrap' }, search),
      h('div', { class: 'nav-chips', role: 'group', 'aria-label': 'Jump to section' }, this.chips));
    this.searchEl = search;
  }

  openGroup(id) {
    const g = this.groups[id];
    if (!g) return;
    g.details.open = true;
    g.details.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  filter(q) {
    this.query = q.trim().toLowerCase();
    for (const { details, fields } of Object.values(this.groups)) {
      let any = false;
      for (const f of fields) {
        const el = details.querySelector(`.field[data-key="${CSS.escape(f.key)}"]`);
        const hit = !this.query || `${f.label} ${f.key} ${f.unit || ''}`.toLowerCase().includes(this.query);
        el.hidden = !hit;
        any ||= hit;
      }
      details.hidden = !any;
      if (this.query) details.open = any;
    }
    if (!this.query) {
      const openOnes = Object.values(this.groups).filter(g => g.details.open);
      openOnes.slice(1).forEach(g => { g.details.open = false; });
    }
    this._refreshNav();
  }

  _refreshNav() {
    for (const [id, g] of Object.entries(this.groups)) {
      const n = g.fields.filter(f => f.type === 'chestpain' ? this.values['Typical Chest Pain'] === 1 || this.values.Atypical === 'Y' || this.values.Nonanginal === 'Y' : isFlagged(f, this.values[f.key])).length;
      g.count.textContent = n ? `${n} flagged` : '';
      const chip = this.chips?.find(c => c.dataset.group === id);
      if (chip) {
        chip.querySelector('.chip-count').textContent = n ? String(n) : '';
        chip.setAttribute('aria-pressed', String(g.details.open && !this.query));
        chip.title = n ? `${n} finding${n > 1 ? 's' : ''} present or outside the typical range` : '';
      }
    }
  }

  _field(f) {
    const id = `f-${f.key.replace(/[^a-z0-9]/gi, '_')}`;
    const wrap = h('div', { class: `field${f.wide ? ' wide' : ''}`, dataset: { key: f.key } });
    const emit = () => { this._refreshDerived(); this._refreshNav(); this.onChange(this.payload()); };

    if (f.type === 'num') {
      const input = h('input', { id, class: 'num', type: 'number', min: f.min, max: f.max, step: f.step, inputmode: 'decimal' });
      input.addEventListener('input', () => { this.values[f.key] = input.value === '' ? null : Number(input.value); emit(); });
      this.controls[f.key] = { set: v => { input.value = v ?? ''; } };
      wrap.append(h('label', { class: 'field-label', for: id }, f.label, ' ', h('span', { class: 'unit' }, f.unit ? `(${f.unit})` : '')), input);
    } else if (f.type === 'select') {
      const sel = h('select', { id, class: 'select' }, f.options.map(([v, l]) => h('option', { value: v }, l)));
      sel.addEventListener('change', () => { this.values[f.key] = f.int ? Number(sel.value) : sel.value; emit(); });
      this.controls[f.key] = { set: v => { sel.value = String(v); } };
      wrap.append(h('label', { class: 'field-label', for: id }, f.label), sel);
    } else if (f.type === 'yn' || f.type === 'b01') {
      const cb = h('input', { id, type: 'checkbox' });
      cb.addEventListener('change', () => { this.values[f.key] = f.type === 'yn' ? (cb.checked ? 'Y' : 'N') : (cb.checked ? 1 : 0); emit(); });
      this.controls[f.key] = { set: v => { cb.checked = v === 'Y' || v === 1; } };
      wrap.append(h('label', { class: 'check', for: id }, cb, f.label));
    } else if (f.type === 'chestpain') {
      const row = h('div', { class: 'radio-row', role: 'radiogroup', 'aria-label': f.label });
      const inputs = CHEST_PAIN.map(opt => {
        const r = h('input', { type: 'radio', name: 'chestPain', value: opt.id });
        r.addEventListener('change', () => { Object.assign(this.values, opt.fields); emit(); });
        row.append(h('label', { class: 'chip-radio' }, r, h('span', {}, opt.label)));
        return [opt, r];
      });
      this.controls.chestPain = {
        set: () => {
          const cur = CHEST_PAIN.find(o => Object.entries(o.fields).every(([k, v]) => this.values[k] === v)) || CHEST_PAIN[0];
          inputs.forEach(([o, r]) => { r.checked = o === cur; });
        },
      };
      wrap.append(h('span', { class: 'field-label' }, f.label), row);
    } else if (f.type === 'derived') {
      const out = h('output', { class: 'derived', id, 'aria-live': 'polite' });
      this.controls[f.key] = { derived: out };
      wrap.append(h('label', { class: 'field-label', for: id }, f.label, ' ', h('span', { class: 'unit' }, f.unit ? `(${f.unit})` : '(derived)')), out);
    }
    wrap.append(h('div', { class: 'err', role: 'alert' }));
    return wrap;
  }

  _refreshDerived() {
    const { Weight: w, Length: l } = this.values;
    const bmi = w && l ? w / (l / 100) ** 2 : null;
    this.controls.BMI.derived.textContent = bmi ? bmi.toFixed(1) : '—';
    this.controls.Obesity.derived.textContent = bmi ? (bmi >= 25 ? 'Yes' : 'No') : '—';
  }

  setValues(values) {
    this.values = { ...DEFAULT_PATIENT };
    for (const [k, v] of Object.entries(values)) {
      if (k === 'BMI' || k === 'Obesity') continue;   // derived by the API
      this.values[k] = k === 'Sex' && v === 'Fmale' ? 'Female' : v;
    }
    for (const [k, c] of Object.entries(this.controls)) if (c.set) c.set(this.values[k]);
    this._refreshDerived();
    this._refreshNav();
    this.clearErrors();
  }

  payload() {
    const out = {};
    for (const f of FIELDS) {
      if (f.type === 'derived' || f.type === 'chestpain') continue;
      out[f.key] = this.values[f.key];
    }
    for (const k of ['Typical Chest Pain', 'Atypical', 'Nonanginal']) out[k] = this.values[k];
    return out;
  }

  /** Briefly highlight the input behind a feature (or its section chip when that section is closed). */
  highlight(key) {
    const k = ['Typical Chest Pain', 'Atypical', 'Nonanginal'].includes(key) ? 'chestPain' : key;
    const field = this.formEl.querySelector(`.field[data-key="${CSS.escape(k)}"]`);
    if (!field) return;
    const g = field.closest('details');
    const target = g.open && !field.hidden ? field : this.chips?.find(c => c.dataset.group === g.dataset.group);
    if (!target) return;
    target.classList.remove('hl');
    void target.offsetWidth;   // restart the animation
    target.classList.add('hl');
    if (target === field) field.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  missing() { return Object.entries(this.payload()).filter(([, v]) => v === null || v === undefined || Number.isNaN(v)).map(([k]) => k); }

  clearErrors() {
    this.formEl.querySelectorAll('.field.invalid').forEach(el => el.classList.remove('invalid'));
    this.formEl.querySelectorAll('.field .err').forEach(el => { el.textContent = ''; });
  }

  showFieldError(key, msg) {
    const field = this.formEl.querySelector(`.field[data-key="${CSS.escape(key)}"]`);
    if (!field) return false;
    field.classList.add('invalid');
    field.querySelector('.err').textContent = msg;
    field.hidden = false;
    field.closest('details').hidden = false;
    field.closest('details').open = true;
    return true;
  }
}
