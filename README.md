# Coronary Risk Explorer — Track A: Cardiovascular Risk Visualization & Prediction

Predicts **overall CAD (`Cath`)** and **stenosis of the LAD, LCX and RCA** from 54 routine clinical, laboratory, ECG and
echocardiographic variables (UCI *Extension of Z-Alizadeh Sani* dataset, 303 patients). The API serves calibrated,
vessel-specific probabilities with exact SHAP explanations, visualised on an interactive 3D heart and coronary tree.

> **Decision support / education only.** Not a medical device, and not a substitute for clinical assessment or diagnostic imaging.

**Status:** the ML pipeline (Notebooks 1–7), inference API, 3D viewer and clinical dashboard are complete. The written report and demo video are not part of this repository.

## Repository layout

| Path | Purpose |
|---|---|
| `01_Data_Audit_and_EDA.ipynb` | Data audit, schema, leakage & plausibility checks, EDA |
| `02_Preprocessing_and_Validation.ipynb` | Cleaning, 242/61 split (stratified on `Cath`), preprocessing configs, CV design → `preprocessing_config.json` |
| `03_Baseline_Models.ipynb` / `04_Boosting_Models.ipynb` | LR, SVMs, RF, XGBoost, LightGBM under target-stratified 5×5 repeated CV |
| `05_Hyperparameter_Tuning.ipynb` | Nested tuning (outer 5×3, inner 3×2, Optuna) and final model registry |
| `06_Final_Evaluation_and_SHAP.ipynb` | **One-time holdout evaluation** of the frozen v1 models, declared post-hoc CIs, SHAP |
| `07_Development_Only_Improvements.ipynb` | Post-holdout, **development-only**: calibration, operating thresholds, ~30-candidate nested model search |
| `08_Operating_Points.ipynb` | **Development-only** sensitivity/specificity trade-off of the served models at every threshold, with pre-declared presets |
| `ml/dev_search.py` | Library behind Notebook 7 (never loads holdout rows) |
| `backend/` | FastAPI inference service + tests; also serves the web app |
| `frontend/` | Web app: Three.js 3D heart and coronary tree + clinical dashboard (no build step) |
| `artifacts/` | Frozen pipelines, SHAP artifacts, evaluation tables, v1.1 post-processing, figures |

## Quick start

Python **3.13.9** (the `.joblib` pipelines were serialized with the pinned versions).

```bash
pip install -r requirements-notebooks.txt
```

Re-run the notebooks in order (1 → 7). Notebook 6 checks that its replay reproduces the original one-time holdout predictions. Notebooks 5 and 7 take the longest (nested searches).

```bash
jupyter nbconvert --to notebook --execute --inplace 07_Development_Only_Improvements.ipynb
```

Start the web app and API together from the repository root, then open http://localhost:8000:

```bash
uvicorn backend.app.main:app --port 8000
```

Run the tests from the repository root:

```bash
python -m pytest backend/tests -q
```

## Validation design

- **Split:** 242 development / 61 holdout patients, stratified on `Cath`. The holdout was sealed until Notebook 6 and evaluated **once**. No model, feature, hyperparameter or threshold decision used it.
- **Development CV:** target-specific repeated stratified 5-fold CV (5×5), with preprocessing fitted inside folds. Tuning used nested CV. The model-family shortlist was chosen on the same folds, so development estimates for the champions are mildly optimistic.
- **After the holdout (Notebook 7):** everything is development-only nested CV. Monotone Platt calibration leaves ROC-AUC/AP unchanged, so the holdout discrimination estimates still apply to the served v1.1 models. Threshold-dependent v1.1 metrics are development estimates; an unbiased test of them needs new data.

## Results

### Frozen v1 models — one-time holdout (N = 61, threshold 0.50 on uncalibrated output)
Bootstrap 95% CIs (2,000 stratified resamples) were added as a declared post-hoc description of the same predictions.
PR-AUC is average precision, the same definition used in development CV.

| Metric | Cath | LAD | LCX | RCA |
|---|---|---|---|---|
| ROC-AUC | 0.854 [0.74–0.94] | 0.794 [0.67–0.90] | 0.730 [0.59–0.85] | 0.701 [0.56–0.83] |
| PR-AUC (AP) | 0.932 [0.88–0.98] | 0.827 [0.73–0.92] | 0.626 [0.51–0.81] | 0.513 [0.38–0.70] |
| Sensitivity | 0.954 [0.88–1.00] | 0.853 [0.73–0.97] | 0.346 [0.19–0.54] | 0.100 [0.00–0.25] |
| Specificity | 0.500 [0.28–0.72] | 0.593 [0.41–0.78] | 0.914 [0.83–1.00] | 0.951 [0.88–1.00] |
| PPV | 0.820 [0.76–0.89] | 0.725 [0.64–0.83] | 0.750 [0.50–1.00] | 0.500 [0.00–1.00] |
| NPV | 0.818 [0.60–1.00] | 0.762 [0.61–0.93] | 0.653 [0.59–0.73] | 0.684 [0.66–0.73] |
| F1 | 0.882 [0.83–0.93] | 0.784 [0.70–0.87] | 0.474 [0.27–0.65] | 0.167 [0.00–0.39] |
| Balanced Accuracy | 0.727 [0.62–0.85] | 0.723 [0.61–0.83] | 0.630 [0.53–0.74] | 0.526 [0.46–0.61] |
| MCC | 0.538 [0.30–0.76] | 0.466 [0.26–0.68] | 0.324 [0.08–0.54] | 0.097 [-0.16–0.36] |
| Accuracy | 0.820 [0.74–0.90] | 0.738 [0.64–0.84] | 0.672 [0.57–0.77] | 0.672 [0.61–0.74] |
| Brier | 0.139 [0.09–0.19] | 0.185 [0.15–0.22] | 0.215 [0.19–0.24] | 0.206 [0.19–0.22] |

Note that at the 0.50 threshold RCA classification is not distinguishable from chance (MCC CI includes 0), even though its ranking (ROC-AUC) is.

### Served v1.1 — calibration + pre-declared operating thresholds (development nested CV, 5×5)
Operating-threshold rules were declared before running: for **Cath**, the highest threshold keeping sensitivity ≥ 0.90 (rule-out safety); for the **vessels**, Youden's J.

| Metric (development nested CV) | Cath v1 → v1.1 | LAD v1 → v1.1 | LCX v1 → v1.1 | RCA v1 → v1.1 |
|---|---|---|---|---|
| ROC-AUC | 0.928 → 0.928 | 0.856 → 0.856 | 0.745 → 0.745 | 0.721 → 0.721 |
| Brier | 0.096 → 0.096 | 0.162 → 0.151 | 0.204 → 0.199 | 0.214 → 0.207 |
| Calibration slope (ideal 1) | 1.208 → 0.967 | 1.894 → 0.950 | 1.855 → 0.961 | 2.273 → 1.026 |
| Sensitivity | 0.924 → 0.904 | 0.878 → 0.818 | 0.342 → 0.701 | 0.202 → 0.698 |
| Specificity | 0.696 → 0.739 | 0.673 → 0.731 | 0.907 → 0.643 | 0.953 → 0.592 |
| Balanced accuracy | 0.810 → 0.822 | 0.775 → 0.775 | 0.625 → 0.672 | 0.577 → 0.645 |
| MCC | 0.644 → 0.648 | 0.569 → 0.551 | 0.310 → 0.335 | 0.243 → 0.283 |
| F1 | 0.903 → 0.900 | 0.835 → 0.816 | 0.459 → 0.617 | 0.316 → 0.597 |
| Operating threshold (calibrated) | 0.50 → 0.562 | 0.50 → 0.549 | 0.50 → 0.374 | 0.50 → 0.372 |

### How much better can the models get? (development nested CV, ~30 candidates × 10 procedures)
All selection, weighting and calibration happens inside the inner loop. The comparison is paired on 25 identical outer folds, using the Nadeau–Bengio corrected t-test.

| Target | Shipped ROC-AUC | Best procedure | ROC-AUC | Δ | p (corrected) | Folds better |
|---|---|---|---|---|---|---|
| Cath | 0.928 | S4_all_mean | 0.941 | +0.013 | 0.19 | 18/25 |
| LAD | 0.856 | S4_all_mean | 0.864 | +0.008 | 0.35 | 18/25 |
| LCX | 0.745 | S6_greedy_ensemble | 0.760 | +0.015 | 0.36 | 16/25 |
| RCA | 0.721 | S4_all_mean | 0.738 | +0.017 | 0.30 | 18/25 |

Averaging many models adds about 0.01–0.02 ROC-AUC. That is consistent in direction but not statistically significant, and such ensembles cannot be explained exactly in real time. With 242 development patients, data rather than modelling is the binding constraint. Full tables are in `artifacts/dev_search/`.

**Deep learning check (TabPFN v2, a pretrained tabular transformer).** It was run on the same 25 development folds, with default settings and no tuning. The script is `ml/tabpfn_eval.py`; results are in `artifacts/dev_search/tabpfn_v2_fold_results.csv`. A small MLP was already in the search above and did worse than logistic regression.

| Target | Champion | TabPFN | TabPFN + DF | Mean(champion, TabPFN + DF) | Best p (corrected) |
|---|---|---|---|---|---|
| Cath | 0.929 | 0.943 | 0.943 | 0.941 | 0.08 |
| LAD | 0.856 | 0.864 | 0.864 | 0.866 | 0.22 |
| LCX | 0.745 | 0.732 | 0.734 | 0.748 | 0.86 |
| RCA | 0.721 | 0.719 | 0.735 | 0.733 | 0.47 |

TabPFN is no better than averaging all the classical models: none of the differences is significant, and it is worse for LCX. It is therefore not deployed.

### Choosing the operating point (Notebook 8, development nested CV)
A threshold cannot improve discrimination; it only moves along the same curve. The dashboard therefore lets the user choose the trade-off. The presets below are pre-declared rules applied to the mean development curve. The served v1.1 default sits between them.

| Target | Catch more (sensitivity ≥ 0.90) | Default v1.1 | Balanced (Youden) | Fewer false alarms (specificity ≥ 0.90) |
|---|---|---|---|---|
| Cath | 0.56: sens 0.90 / spec 0.76 | 0.56: 0.90 / 0.76 | 0.74: 0.85 / 0.88 | 0.81: 0.80 / 0.91 |
| LAD | 0.43: 0.90 / 0.64 | 0.55: 0.84 / 0.73 | 0.55: 0.84 / 0.74 | 0.81: 0.51 / 0.91 |
| LCX | 0.22: 0.91 / 0.36 | 0.37: 0.72 / 0.63 | 0.35: 0.77 / 0.59 | 0.59: 0.33 / 0.91 |
| RCA | 0.25: 0.91 / 0.33 | 0.37: 0.70 / 0.61 | 0.39: 0.67 / 0.65 | 0.56: 0.29 / 0.91 |

Notebook 8 reproduces the v1.1 fold AUCs of Notebook 7 exactly before computing the curves. The full curves (with PPV, NPV and the range across repeats) are in `artifacts/deployment/operating_curves.json`.

## Web app: 3D visualisation and clinical dashboard

**3D view** (Three.js / WebGL, runs on integrated graphics):
- An anatomically oriented heart shows the atria, auricles, aorta, pulmonary trunk and venae cavae, with the coronary tree in its grooves:
  - LAD with diagonals in the anterior interventricular groove;
  - LCX with obtuse marginals in the left atrioventricular groove;
  - RCA with acute marginal and PDA in the right atrioventricular groove (right-dominant pattern).
- Each vessel system is coloured by its **calibrated** probability on one fixed 0–100% scale, with a numeric legend.
  - The whole system shares one colour, because the model predicts stenosis *somewhere in the vessel*, not a lesion location.
  - The left main and great vessels stay grey ("not modelled").
- **Interaction:**
  - rotate, zoom and pan;
  - camera presets (anterior, left lateral, inferior, RAO, posterior, and a chest view inside an X-ray-style torso with ribs);
  - hover and click to select a vessel system;
  - optional labels and a heartbeat synchronised to the entered pulse rate.
- Colours animate whenever a prediction changes.
- The ramp's OKLab lightness decreases monotonically, so order survives colour-vision deficiency. Every vessel carries a dark outline so pale (low-probability) vessels stay visible.

**Dashboard:**
- **Patient inputs:** grouped inputs with units. BMI and obesity are derived, and chest-pain classes use a single control. Example patients come from the development cohort, with outcomes never shown. Predictions update live, with validation messages next to each field.
- **Results:** the overall CAD estimate, the vessel estimates with operating-threshold markers, the model discrimination per vessel, a Cath/vessel consistency warning, and out-of-range input warnings. A **Decision threshold** panel offers presets, a slider and a sensitivity/specificity chart marking the current patient. It shows development sensitivity, specificity, PPV and NPV at the chosen threshold, and the flags update live. Only the flag changes: probabilities, 3D colours and explanations do not depend on the threshold. Choices are remembered per browser.
- **Why this estimate?:** a diverging SHAP chart (raises vs lowers), contribution by clinical domain, and a sortable physiological breakdown. The breakdown shows each measurement's value, typical adult range and share of the attribution.
- **Model evidence:** holdout metrics with 95% CIs, development metrics for the served v1.1, observed stenosis rate per colour band, and global feature importance.
- A clinical-safety disclaimer is always visible, and the canvas states that it shows model output on a schematic, not an image of the patient.

**Extending it:** vessel paths, branches and camera views are data in `frontend/js/config/anatomy.js`, and input fields are data in `frontend/js/config/features.js`. Adding a vessel system or clinical feature needs no changes to the rendering code.

**Requirement:** the page loads Three.js 0.170 from the jsDelivr CDN, so the browser needs internet access. The anatomy is procedural, so no mesh files are needed.

## What the probabilities mean

**What the number is:**
- A calibrated estimate of the probability of **≥ 50% angiographic stenosis** (for `Cath`: CAD in any vessel).
- It applies to patients like this **single-centre cohort referred for angiography** (CAD prevalence 71%).
- The observed stenosis rate within each 20% probability band is published by `/probability-bands` (development nested CV).

**What the number is not:**
- A population risk score.
- A measure of *how narrowed* a vessel is, or *where* in the vessel narrowing occurs.

**Consistency across targets:** the four models are trained independently. The API flags any case where a vessel estimate exceeds the overall CAD estimate.

## Explainability

- **Method:** exact `shap.TreeExplainer` attributions, aggregated from transformed columns back to each of the 54 clinical inputs.
- **What each attribution includes:** the patient's raw value, its clinical domain, and a unit-free relative contribution (% of that target's total |SHAP|).
- **Units:** native values are log-odds for `Cath` (XGBoost) and probability for the vessel Random Forests.
- **Interpretation:** attributions describe model associations, not causes.
- **Global importance** per target is served by `/global-importance`.

## API

| Endpoint | Returns |
|---|---|
| `GET /health` | Service and model status |
| `GET /model-info` | Frozen v1 manifest (holdout metrics, artifact hashes) + v1.1 post-processing |
| `POST /predict` | Calibrated probabilities, operating-threshold flags, consistency check, per-feature SHAP explanations, input warnings |
| `GET /global-importance` | Share of total mean \|SHAP\| per clinical feature and target |
| `GET /probability-bands` | Observed stenosis rate per calibrated-probability band |
| `GET /operating-curves` | Development sensitivity/specificity/PPV/NPV at every threshold, plus pre-declared presets |

**Input rules:**
- BMI and Obesity are derived from weight and height when omitted.
- These are rejected:
  - physiologically impossible combinations (e.g. more than one chest-pain class, both current and ex-smoker, Lymph + Neut > 100);
  - non-integer discrete codes;
  - target columns.
- Values outside the development cohort's range are accepted with a warning.

## Limitations

- **Sample size:** 303 patients from one centre, about 1.2–1.8 minority-class events per candidate predictor. External validation is needed.
- **Width of the holdout estimates:** the holdout (61 patients; 18–43 per class) gives wide intervals. One patient moves sensitivity or specificity by 2–6 points.
- **Spectrum bias:** Q waves, regional wall-motion abnormality and reduced EF can reflect prior infarction, i.e. already-established disease.
- **Stratification:** the split was stratified on `Cath` only, so vessel prevalence differs between development and holdout.
- **Coverage:** left main disease is not modelled separately.
