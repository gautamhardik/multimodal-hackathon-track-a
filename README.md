# Coronary Risk Explorer — Track A: Cardiovascular Risk Visualization & Prediction

Predicts **overall CAD (`Cath`)** and **stenosis of the LAD, LCX and RCA** from 54 routine clinical, laboratory, ECG and
echocardiographic variables (UCI *Extension of Z-Alizadeh Sani* dataset, 303 patients). The API serves calibrated,
vessel-specific probabilities with exact SHAP explanations, visualised on an interactive 3D heart and coronary tree.

> **Decision support / education only.** Not a medical device, and not a substitute for clinical assessment or diagnostic imaging.

**Status:** the ML pipeline (Notebooks 1–8), inference API, landing page, anatomical 3D viewer and clinical dashboard are complete. The 6-page project documentation is [`docs/Project_Documentation.pdf`](docs/Project_Documentation.pdf) (source: `docs/project_documentation.html`, rebuilt with `python docs/build_pdf.py [video_url]`). The demo video is published separately.

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
| `frontend/` | Web app, no build step: `index.html` scroll-story landing page, `app.html` 3D explorer + clinical dashboard |
| `frontend/assets/anatomy/` | `heart.glb`, `thorax.glb`: anatomical meshes derived from BodyParts3D (CC BY 4.0) |
| `tools/build_anatomy.py` | Rebuilds the `.glb` files from BodyParts3D (fetches only the ~7 MB of parts it needs) |
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

Start the web app and API together from the repository root, then open http://localhost:8000 (overview) or http://localhost:8000/app.html (explorer):

```bash
uvicorn backend.app.main:app --port 8000
```

Run the tests from the repository root:

```bash
python -m pytest backend/tests -q
```

Or run everything in Docker (the same image CI builds and smoke-tests):

```bash
docker build -t coronary-risk-explorer .
docker run -p 8000:8000 coronary-risk-explorer
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

**Landing page** (`/`): a scroll story around the same 3D heart, built with GSAP ScrollTrigger.
- **Hero:** an ECG trace and heartbeat running at the example patient's pulse rate, and a readout of that patient's estimates. A **Try it** control changes chest pain type and ejection fraction and re-runs the real model live, recolouring the heart and updating the explanation.
- **Anatomy (scroll-scrubbed):** each third of the section traces one artery from its ostium outwards, turns the heart towards it and dims the others. The animation follows the scrollbar, so scrolling back reverses it. Each card shows the artery's course, territory, example estimate and holdout ROC-AUC.
- **Method and explanations:** the method timeline, and the example patient's real SHAP explanation.
- **Evidence:** the overall CAD ROC-AUC, and one confidence-interval chart placing all four models on a shared 0.5–1.0 scale.
- **Hand-off:** "Open the explorer" morphs the heart stage into the explorer's viewer, using cross-document view transitions (Chrome and Edge; other browsers navigate normally).
- **Data:** every number on the page comes from the API. Nothing is hard-coded.

**3D view** (Three.js / WebGL, runs on integrated graphics):
- **Real anatomy:** the heart, great vessels and coronary arteries are meshes from **BodyParts3D**, a whole-body anatomical database based on the FMA ontology. Each model target maps to its own mesh group:
  - **LAD:** anterior interventricular branch, with its diagonal, conus and right anterior branches;
  - **LCX:** circumflex branch;
  - **RCA:** trunk, anterior/posterior ventricular and marginal branches, and the posterior interventricular branch.
- **Reconstructed muscle surface:** BodyParts3D models the ventricles only as blood cavities. The outer muscle surface was therefore reconstructed by growing each cavity by the local wall thickness, measured from how far the coronary arteries lie from it (typical 9 mm left-ventricle / 4.5 mm right-ventricle values elsewhere). The arteries end up a median 0.9 mm from the reconstructed surface.
- **Chest view:** loads the real ribs, costal cartilages, sternum and thoracic spine (`thorax.glb`, loaded only when needed), with the heart in its true position.
- **Fallback:** if the model files are missing, the viewer uses the procedural schematic heart.
- Each vessel system is coloured by its **calibrated** probability on one fixed 0–100% scale, with a numeric legend.
  - The whole system shares one colour, because the model predicts stenosis *somewhere in the vessel*, not a lesion location.
  - The left main and great vessels stay grey ("not modelled").
- **Interaction:**
  - rotate, zoom and pan;
  - camera presets (anterior, left lateral, inferior, RAO, posterior, and a chest view with the real skeleton);
  - hover and click to select a vessel system;
  - optional labels and a heartbeat synchronised to the entered pulse rate.
- **Effects** (custom shaders; no post-processing passes):
  - **Blood flow:** pulses travel from each ostium outwards, one per heartbeat.
  - **Risk glow:** arteries glow and gain a halo in proportion to their calibrated probability, so low estimates stay matte.
  - **Prediction wave:** a ring of light sweeps each artery whenever a new prediction arrives.
  - **Muscle surface:** soft sheen and a warm edge light.
- **Focus mode:** selecting an artery turns the camera to it and moves in, dims the other arteries, and expands its label with the territory it supplies. Double-clicking empty space clears the selection.
- **Full-screen 3D:** press **F**, or use the toolbar button, to hide the side panels.
- **Keyboard:** **1–4** select a target, **V** cycles views, **/** finds a measurement, **S** toggles the heartbeat sound, **Esc** clears, **?** lists the shortcuts.
- Colours ease to their new values whenever a prediction changes.
- The ramp's OKLab lightness decreases monotonically, so order survives colour-vision deficiency. Every vessel carries a dark outline so pale (low-probability) vessels stay visible.

**Dashboard:**
- **Patient inputs:** grouped inputs with units. BMI and obesity are derived, and chest-pain classes use a single control. Example patients come from the development cohort, with outcomes never shown. Predictions update live, with validation messages next to each field.
- **Navigation:** the inputs panel has a search box and section chips, which show counts of findings present or out of range. One section is open at a time. The results panel pins a summary strip (CAD · LAD · LCX · RCA, with flagged estimates ringed) above its tabs: Results / Threshold / Explain / Evidence.
- **Heartbeat sound:** the speaker button (or **S**) plays a synthesised "lub-dub" in time with the 3D heart at the patient's pulse rate, on both pages. It is off by default and remembered per browser; in the explorer, turning it on also starts the heartbeat animation.
- **What-if feedback:** after a manual edit, each summary chip shows how many points its estimate moved (for example ▼ 14). Loading an example or resetting clears these.
- **Results:** the overall CAD estimate, the vessel estimates with operating-threshold markers, the model discrimination per vessel, a Cath/vessel consistency warning, and out-of-range input warnings.
- **Threshold:** presets, a slider and a sensitivity/specificity chart marking the current patient. It shows development sensitivity, specificity, PPV and NPV at the chosen threshold, and the flags update live. Only the flag changes: probabilities, 3D colours and explanations do not depend on the threshold. Choices are remembered per browser.
- **Explain:** hovering a measurement highlights its input field (or its section chip when that section is closed). The tab shows a diverging SHAP chart (raises vs lowers), contribution by clinical domain, and a sortable physiological breakdown. The breakdown shows each measurement's value, typical adult range and share of the attribution.
- **Model evidence:** holdout metrics with 95% CIs, development metrics for the served v1.1, observed stenosis rate per colour band, and global feature importance.
- A clinical-safety disclaimer is always visible, and the canvas states that it shows model output on reference anatomy, not an image of the patient.

**Extending it:**
- **New vessel system:** in `tools/build_anatomy.py`, add a group of FMA concepts; the viewer picks up any `vessel_<TARGET>` mesh automatically.
- **Camera views:** data in `frontend/js/config/anatomy.js`.
- **Input fields:** data in `frontend/js/config/features.js`.

**Rebuilding the anatomy:** run the command below. It downloads only the needed parts (about 7 MB, using range requests into the official archive) and rebuilds both `.glb` files in about 3 minutes. It needs `scipy` and `scikit-image`.

```bash
python tools/build_anatomy.py
```

**Anatomy licence:** "BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International", per the archive's licence page (updated 2025-02-27).
- The meshes here are cropped, simplified, regrouped and recoloured.
- The ventricular surface is reconstructed as described above.
- Older OBJ file headers still cite CC BY-SA 2.1 Japan.
- The credit appears in the page footer and inside the `.glb` metadata.

**Requirements:**
- **Libraries: CDN when online, local copies when not.** `frontend/js/deps.js` loads Three.js 0.170, GSAP 3.15 and the Geist and Instrument Serif fonts from jsDelivr and Google Fonts when they are reachable, and otherwise from the vendored copies in `frontend/vendor/` (about 1.4 MB; sources and licences in `frontend/vendor/README.md`). It uses the local copies when the browser is offline, when the CDN does not answer within 1.2 s, or, after a one-time reload, when a CDN file fails mid-load. Integrity hashes pin the CDN files to the vendored bytes, and a test checks that the two are identical.
- Scoring runs single-threaded (`n_jobs=1`, set at load time in `backend/app/model_registry.py`): a worker pool per one-patient request cost about 1–3 s, and a prediction with SHAP now takes about 60 ms. The fitted models and their outputs are unchanged.

**Performance and accessibility checks:**
- **Rendering cost:** measured on integrated Intel Arc graphics with every effect on: 1.7 ms per frame for the explorer (2400×1600) and 0.35 ms for the landing scene (2880×1800), far inside the 60 fps budget of 16.7 ms.
- **Contrast:** every text colour passes WCAG AA (4.5:1) against its background in both themes.
- **Reduced motion:** every animation has a static equivalent.

**Motion (GSAP):** values count up, meters grow, and threshold markers glide to their new positions. The final value is always written first and animation only interpolates towards it. Motion is skipped when the OS asks for reduced motion, when the page is hidden, or when GSAP cannot load; the dashboard then works exactly the same without animation.

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
| `GET /health` | Service and model status (`503` until the models are loaded) |
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

## Deployment and operations

**Container:** `Dockerfile` builds a `python:3.13-slim` image with only the runtime files (models, deployment artifacts, frontend). It runs as a non-root user with 2 uvicorn workers (`WEB_CONCURRENCY`) and has a health check on `/health`.

**Configuration (environment variables):**

| Variable | Default | Meaning |
|---|---|---|
| `CRE_ALLOWED_ORIGINS` | empty | Comma-separated browser origins allowed to call the API cross-site. Empty means same-origin only, which is all the bundled frontend needs. |
| `CRE_PREDICT_RATE_PER_MIN` | `120` | `POST /predict` requests per client IP per minute, per worker (bursts up to a quarter of that). `0` disables the limit. |
| `CRE_MAX_BODY_BYTES` | `65536` | Largest accepted request body; a patient payload is about 2 KB. |
| `CRE_ENABLE_DOCS` | `true` | Serve the interactive API docs at `/docs` and `/redoc`. |
| `CRE_LOG_LEVEL` | `INFO` | Log level. |
| `WEB_CONCURRENCY` | `2` | Worker processes (container only). |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | Address of a trusted reverse proxy, so client IPs and HTTPS are read from `X-Forwarded-*` headers (uvicorn setting). |

**Security measures:**
- **Headers:** every response sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`; HTTPS responses add HSTS.
- **Content-Security-Policy:** the two pages get a per-response nonce. Only the site's own scripts, the pinned CDN (with integrity hashes) and nonce-tagged inline scripts can run; framing and plugins are blocked.
- **Inputs:** strict schema (unknown fields such as outcome labels are rejected), a request-size limit, and a per-client rate limit on predictions (`429` with `Retry-After`).
- **Errors:** unexpected failures return a generic message with a request ID; details go only to the server log.
- **Model integrity:** each pipeline's SHA-256 is checked against the v1.1 artifact before the service starts.

**Logs and tracing:** each request gets an `X-Request-ID` (or keeps a valid one sent by the client), which appears in the access log and in error responses. The access log records method, path, status, duration and request ID only, never request bodies (patient data) or client addresses.

**CI:** `.github/workflows/ci.yml` runs the test suite on every push and pull request, then builds the Docker image and smoke-tests it (health, examples, a prediction and the explorer page).

**Scaling notes:** the rate limit is kept in memory per worker, so the effective limit is (workers × limit); for several hosts, enforce it at the reverse proxy. Put TLS in front of the container (a reverse proxy or load balancer) and point its health check at `/health`, which returns `503` until the models are loaded.

## Limitations

- **Sample size:** 303 patients from one centre, about 1.2–1.8 minority-class events per candidate predictor. External validation is needed.
- **Width of the holdout estimates:** the holdout (61 patients; 18–43 per class) gives wide intervals. One patient moves sensitivity or specificity by 2–6 points.
- **Spectrum bias:** Q waves, regional wall-motion abnormality and reduced EF can reflect prior infarction, i.e. already-established disease.
- **Stratification:** the split was stratified on `Cath` only, so vessel prevalence differs between development and holdout.
- **Coverage:** left main disease is not modelled separately.
- **Reference anatomy:** the 3D heart is one reference anatomy (right-dominant), not the patient's. Its ventricular surface is reconstructed, not scanned.
