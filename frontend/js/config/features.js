// Input schema for the 54 model predictors. Keys match the API field names exactly.
// `ref` = approximate typical adult reference range, shown only as context next to the model's attributions.

export const GROUPS = [
  { id: 'demo', title: 'Demographics & body size', short: 'Body', open: true },
  { id: 'history', title: 'History & risk factors', short: 'History' },
  { id: 'symptoms', title: 'Symptoms & examination', short: 'Symptoms' },
  { id: 'ecg', title: 'ECG', short: 'ECG' },
  { id: 'labs', title: 'Laboratory', short: 'Labs' },
  { id: 'echo', title: 'Echocardiography', short: 'Echo' },
];

const yn = (key, label, group) => ({ key, label, group, type: 'yn' });
const b01 = (key, label, group) => ({ key, label, group, type: 'b01' });
const num = (key, label, group, unit, min, max, step, ref) => ({ key, label, group, type: 'num', unit, min, max, step, ref });

export const FIELDS = [
  num('Age', 'Age', 'demo', 'years', 18, 100, 1),
  { key: 'Sex', label: 'Sex', group: 'demo', type: 'select', options: [['Male', 'Male'], ['Female', 'Female']] },
  num('Weight', 'Weight', 'demo', 'kg', 30, 250, 1),
  num('Length', 'Height', 'demo', 'cm', 120, 230, 1),
  { key: 'BMI', label: 'Body-mass index', group: 'demo', type: 'derived', unit: 'kg/m²', ref: [18.5, 24.9] },
  { key: 'Obesity', label: 'Obesity (BMI ≥ 25)', group: 'demo', type: 'derived' },

  b01('DM', 'Diabetes mellitus', 'history'),
  b01('HTN', 'Hypertension', 'history'),
  yn('DLP', 'Dyslipidemia', 'history'),
  b01('FH', 'Family history of CAD', 'history'),
  b01('Current Smoker', 'Current smoker', 'history'),
  b01('EX-Smoker', 'Ex-smoker', 'history'),
  yn('CRF', 'Chronic renal failure', 'history'),
  yn('CVA', 'Prior stroke (CVA)', 'history'),
  yn('Airway disease', 'Airway disease', 'history'),
  yn('Thyroid Disease', 'Thyroid disease', 'history'),
  yn('CHF', 'Congestive heart failure', 'history'),

  { key: 'chestPain', label: 'Chest pain character', group: 'symptoms', type: 'chestpain', wide: true },
  yn('LowTH Ang', 'Low-threshold angina', 'symptoms'),
  yn('Dyspnea', 'Dyspnea', 'symptoms'),
  { key: 'Function Class', label: 'Functional class', group: 'symptoms', type: 'select', options: [[0, '0'], [1, '1'], [2, '2'], [3, '3']], int: true },
  num('BP', 'Systolic blood pressure', 'symptoms', 'mmHg', 60, 260, 1, [90, 129]),
  num('PR', 'Pulse rate', 'symptoms', 'bpm', 30, 220, 1, [60, 100]),
  b01('Edema', 'Edema', 'symptoms'),
  yn('Weak Peripheral Pulse', 'Weak peripheral pulse', 'symptoms'),
  yn('Lung rales', 'Lung rales', 'symptoms'),
  yn('Systolic Murmur', 'Systolic murmur', 'symptoms'),
  yn('Diastolic Murmur', 'Diastolic murmur', 'symptoms'),

  b01('Q Wave', 'Pathological Q wave', 'ecg'),
  b01('St Elevation', 'ST elevation', 'ecg'),
  b01('St Depression', 'ST depression', 'ecg'),
  b01('Tinversion', 'T-wave inversion', 'ecg'),
  yn('LVH', 'Left ventricular hypertrophy', 'ecg'),
  yn('Poor R Progression', 'Poor R-wave progression', 'ecg'),
  { key: 'BBB', label: 'Bundle branch block', group: 'ecg', type: 'select', options: [['N', 'None'], ['LBBB', 'LBBB'], ['RBBB', 'RBBB']] },

  num('FBS', 'Fasting blood sugar', 'labs', 'mg/dL', 20, 600, 1, [70, 99]),
  num('CR', 'Creatinine', 'labs', 'mg/dL', 0.1, 20, 0.1, [0.6, 1.3]),
  num('TG', 'Triglycerides', 'labs', 'mg/dL', 10, 1500, 1, [0, 149]),
  num('LDL', 'LDL cholesterol', 'labs', 'mg/dL', 10, 600, 1, [0, 99]),
  num('HDL', 'HDL cholesterol', 'labs', 'mg/dL', 5, 200, 1, [40, 200]),
  num('BUN', 'Blood urea nitrogen', 'labs', 'mg/dL', 1, 200, 1, [7, 20]),
  num('ESR', 'ESR', 'labs', 'mm/h', 0, 150, 1, [0, 20]),
  num('HB', 'Hemoglobin', 'labs', 'g/dL', 3, 25, 0.1, [12, 17.5]),
  num('K', 'Potassium', 'labs', 'mEq/L', 1, 10, 0.1, [3.5, 5.0]),
  num('Na', 'Sodium', 'labs', 'mEq/L', 80, 180, 1, [135, 145]),
  num('WBC', 'White cell count', 'labs', '/µL', 500, 50000, 100, [4000, 11000]),
  num('Lymph', 'Lymphocytes', 'labs', '%', 0, 100, 1, [20, 40]),
  num('Neut', 'Neutrophils', 'labs', '%', 0, 100, 1, [40, 70]),
  num('PLT', 'Platelets', 'labs', '×10³/µL', 10, 1500, 1, [150, 450]),

  num('EF-TTE', 'Ejection fraction (TTE)', 'echo', '%', 5, 85, 1, [50, 70]),
  { key: 'Region RWMA', label: 'Regional wall-motion abnormality', group: 'echo', type: 'select', options: [[0, '0 (none)'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], int: true, wide: true },
  { key: 'VHD', label: 'Valvular heart disease', group: 'echo', type: 'select', options: [['N', 'None'], ['mild', 'Mild'], ['Moderate', 'Moderate'], ['Severe', 'Severe']] },
];

// Chest-pain classes are mutually exclusive in the dataset; one control maps onto three API fields.
export const CHEST_PAIN = [
  { id: 'none', label: 'None', fields: { 'Typical Chest Pain': 0, Atypical: 'N', Nonanginal: 'N' } },
  { id: 'typical', label: 'Typical angina', fields: { 'Typical Chest Pain': 1, Atypical: 'N', Nonanginal: 'N' } },
  { id: 'atypical', label: 'Atypical', fields: { 'Typical Chest Pain': 0, Atypical: 'Y', Nonanginal: 'N' } },
  { id: 'nonanginal', label: 'Non-anginal', fields: { 'Typical Chest Pain': 0, Atypical: 'N', Nonanginal: 'Y' } },
];

// Display names for every API feature (including the three chest-pain fields and derived BMI/Obesity).
export const LABELS = Object.fromEntries([
  ...FIELDS.filter(f => f.key !== 'chestPain').map(f => [f.key, f.label]),
  ['Typical Chest Pain', 'Typical angina'], ['Atypical', 'Atypical chest pain'], ['Nonanginal', 'Non-anginal chest pain'],
]);
export const UNITS = Object.fromEntries(FIELDS.filter(f => f.unit).map(f => [f.key, f.unit]));
export const REFS = Object.fromEntries(FIELDS.filter(f => f.ref).map(f => [f.key, f.ref]));

export function formatValue(key, value) {
  if (value === 'Y') return 'Yes';
  if (value === 'N') return key === 'BBB' || key === 'VHD' ? 'None' : 'No';
  const field = FIELDS.find(f => f.key === key);
  if (field && field.type === 'b01' || ['Typical Chest Pain'].includes(key)) return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    const s = Number.isInteger(value) ? value.toLocaleString() : value.toFixed(value < 10 ? 2 : 1);
    return UNITS[key] ? `${s} ${UNITS[key]}` : s;
  }
  return String(value);
}

export function outOfReference(key, value) {
  const r = REFS[key];
  if (!r || typeof value !== 'number') return null;
  if (value < r[0]) return 'below';
  if (value > r[1]) return 'above';
  return null;
}
