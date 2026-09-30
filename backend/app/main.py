import json
import logging
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import (COLOR_BANDS_PATH, DISCLAIMER, FRONTEND_DIR, GLOBAL_IMPORTANCE_PATH, HOLDOUT_CI_PATH, MANIFEST_PATH,
                     OPERATING_CURVES_PATH,
                     MODEL_VERSION, PROBABILITY_DEFINITION, TARGET_NAMES)
from .examples import example_patients
from .inference import InferenceEngine
from .model_registry import ModelRegistry
from .schemas import PatientInput, PredictionResponse
from .shap_service import SHAPService

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("cardio_api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing CardioRisk Multi-Target Inference System...")
    ModelRegistry.get_instance().load_models()
    SHAPService.get_instance().initialize()
    logger.info("CardioRisk Inference System is ready.")
    yield
    logger.info("CardioRisk Inference System shutting down.")


app = FastAPI(
    title="Cardiovascular Risk Visualization & Multi-Target Prediction API",
    description=(
        "Inference service for Track A: overall CAD (Cath) and vessel stenosis (LAD, LCX, RCA) with calibrated "
        "probabilities, development-validated operating thresholds and exact SHAP explanations.\n\n"
        f"**Probability definition**: {PROBABILITY_DEFINITION}\n\n**Disclaimer**: {DISCLAIMER}"
    ),
    version=MODEL_VERSION,
    lifespan=lifespan
)

# Local development frontends; no cookies or credentials are used by this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

@app.middleware("http")
async def revalidate_static(request, call_next):
    """Make browsers revalidate frontend files (ETag) so an updated UI is never served stale from cache."""
    response = await call_next(request)
    if request.method == "GET" and request.url.path.split("/")[1] in ("", "index.html", "js", "css"):
        response.headers["Cache-Control"] = "no-cache"
    return response


engine = InferenceEngine()


def _read_json(path):
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Artifact not found: {path.name}")
    return json.loads(path.read_text())


@app.get("/health", summary="Health Check", tags=["System"])
def health_check():
    registry = ModelRegistry.get_instance()
    return {
        "status": "ok",
        "service": "Cardiovascular Multi-Target Risk API",
        "model_version": MODEL_VERSION,
        "models_loaded": registry.is_loaded,
        "active_targets": list(registry.pipelines.keys()) if registry.is_loaded else []
    }


@app.get("/model-info", summary="Model Metadata & Governance", tags=["Governance"])
def model_info():
    """Frozen v1 manifest (one-time holdout evaluation) plus the v1.1 development-only post-processing."""
    return {
        "model_version": MODEL_VERSION,
        "probability_definition": PROBABILITY_DEFINITION,
        "v1_frozen_manifest": _read_json(MANIFEST_PATH),
        "v1_1_postprocessing": ModelRegistry.get_instance().postprocessing,
        "disclaimer": DISCLAIMER,
    }


@app.get("/global-importance", summary="Global SHAP importance per target", tags=["Explainability"])
def global_importance():
    """Share (%) of each target's total mean |SHAP| attributable to each clinical feature (development cohort)."""
    if not GLOBAL_IMPORTANCE_PATH.exists():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Global importance artifact not found")
    df = pd.read_csv(GLOBAL_IMPORTANCE_PATH)
    return {"units": "percent of each target's total mean |SHAP| (development cohort)", "features": df.to_dict(orient="records")}


@app.get("/probability-bands", summary="Observed stenosis rate per probability band", tags=["Governance"])
def probability_bands():
    """Development nested-CV check that each colour band of the 3D legend means what it says."""
    if not COLOR_BANDS_PATH.exists():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Probability band artifact not found")
    return {"bands": pd.read_csv(COLOR_BANDS_PATH).to_dict(orient="records")}


@app.get("/performance", summary="Validation evidence per target", tags=["Governance"])
def performance():
    """One-time holdout metrics of the frozen v1 models (with declared post-hoc CIs) and v1.1 development nested-CV metrics."""
    if not HOLDOUT_CI_PATH.exists():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Holdout CI artifact not found")
    ci = pd.read_csv(HOLDOUT_CI_PATH).fillna("")
    post = ModelRegistry.get_instance().postprocessing["targets"]
    targets = {}
    for t in TARGET_NAMES:
        rows = ci[ci["Target"] == t]
        holdout = {r["Metric"]: {"estimate": float(r["Estimate"]), "ci95": r["Bootstrap 95% CI"]} for _, r in rows.iterrows()}
        auc = holdout["ROC-AUC"]["estimate"]
        targets[t] = {
            "holdout_v1_at_0.50": holdout,
            "development_nested_cv": post[t]["development_nested_cv"],
            "operating_threshold": post[t]["operating_threshold"],
            "threshold_rule": post[t]["threshold_rule"],
            "discrimination": "good" if auc >= 0.8 else "moderate" if auc >= 0.7 else "limited",
        }
    bands = pd.read_csv(COLOR_BANDS_PATH).to_dict(orient="records") if COLOR_BANDS_PATH.exists() else []
    return {"targets": targets, "probability_bands": bands,
            "notes": ["Holdout: 61 patients evaluated once with the frozen v1 models at threshold 0.50 (uncalibrated).",
                      "Calibration is monotone, so holdout ROC-AUC and AP also apply to v1.1.",
                      "v1.1 operating-point metrics are development nested-CV estimates (242 patients)."]}


@app.get("/operating-curves", summary="Sensitivity/specificity trade-off per threshold", tags=["Governance"])
def operating_curves():
    """Development nested-CV metrics of the served v1.1 models at every calibrated threshold, plus pre-declared presets.
    The threshold only changes the flag; probabilities and SHAP explanations do not depend on it."""
    return _read_json(OPERATING_CURVES_PATH)


@app.get("/example-patients", summary="Example patients from the development cohort", tags=["Inference"])
def get_example_patients():
    """Predictor values of a few development patients chosen by model estimate (outcome labels are never exposed)."""
    return {"patients": example_patients()}


@app.post("/predict", response_model=PredictionResponse, summary="Predict CAD & Vessel Stenosis with SHAP Explanations",
          tags=["Inference"])
def predict_patient(patient: PatientInput):
    """
    Accepts the clinical, laboratory, ECG and echocardiographic predictors (BMI and Obesity are derived when omitted).
    Returns calibrated probabilities, flags at development-validated thresholds, a Cath/vessel consistency check,
    exact per-feature SHAP explanations with raw values, and warnings for inputs outside the training range.
    """
    try:
        return engine.predict(patient)
    except Exception:
        logger.exception("Inference execution failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Inference failed; see server logs.")


# The dashboard + 3D viewer is served from the same origin. Mounted last so API routes take precedence.
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
