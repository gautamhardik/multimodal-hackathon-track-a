import os
from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
ARTIFACTS_DIR = BASE_DIR / "artifacts"
MODELS_DIR = ARTIFACTS_DIR / "models"
SHAP_DIR = ARTIFACTS_DIR / "shap"
DEPLOYMENT_DIR = ARTIFACTS_DIR / "deployment"

# Frozen v1 model pipelines (evaluated once on the 61-patient holdout in Notebook 6)
MODEL_PATHS = {
    "Cath": MODELS_DIR / "cath_final_pipeline.joblib",
    "LAD": MODELS_DIR / "lad_final_pipeline.joblib",
    "LCX": MODELS_DIR / "lcx_final_pipeline.joblib",
    "RCA": MODELS_DIR / "rca_final_pipeline.joblib"
}

DATA_PATH = BASE_DIR / "extention of Z-Alizadeh sani dataset.xlsx"
PREPROCESSING_CONFIG_PATH = BASE_DIR / "preprocessing_config.json"
FRONTEND_DIR = BASE_DIR / "frontend"
HOLDOUT_CI_PATH = ARTIFACTS_DIR / "final_evaluation" / "holdout_metrics_with_ci.csv"

SHAP_MAPPING_PATH = SHAP_DIR / "shap_feature_mapping.json"
GLOBAL_IMPORTANCE_PATH = SHAP_DIR / "cross_target_importance_share.csv"
MANIFEST_PATH = ARTIFACTS_DIR / "final_model_manifest.json"

# v1.1 development-only post-processing (Notebook 7): Platt calibration + operating thresholds
POSTPROCESSING_PATH = DEPLOYMENT_DIR / "v1_1_postprocessing.json"
TRAINING_RANGES_PATH = DEPLOYMENT_DIR / "training_ranges.json"
COLOR_BANDS_PATH = DEPLOYMENT_DIR / "probability_band_validity.csv"
OPERATING_CURVES_PATH = DEPLOYMENT_DIR / "operating_curves.json"

MODEL_VERSION = "1.1.0"
TARGET_NAMES = ["Cath", "LAD", "LCX", "RCA"]
VESSEL_NAMES = ["LAD", "LCX", "RCA"]
TARGET_LABELS = {
    "Cath": "Overall CAD",
    "LAD": "Left Anterior Descending",
    "LCX": "Left Circumflex",
    "RCA": "Right Coronary Artery"
}

DISCLAIMER = (
    "For decision-support and educational purposes only. "
    "This model is not a medical diagnostic device and does not replace "
    "formal clinical assessment or diagnostic imaging."
)

PROBABILITY_DEFINITION = (
    "Calibrated model-estimated probability of angiographically significant (>=50%) stenosis "
    "(for Cath: of CAD in any vessel), for patients similar to a single-centre cohort referred for "
    "coronary angiography (CAD prevalence 71%). It is not a population risk score and does not "
    "indicate the degree or location of narrowing within the vessel."
)


# ---------------------------------------------------------------- runtime settings (environment variables)
def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


# Browser origins allowed to call the API cross-site (comma-separated). Empty = same-origin only, which is all the
# bundled frontend needs.
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("CRE_ALLOWED_ORIGINS", "").split(",") if o.strip()]
# POST /predict requests per client IP per minute (per worker process); 0 disables the limit.
PREDICT_RATE_PER_MIN = _env_int("CRE_PREDICT_RATE_PER_MIN", 120)
# Largest accepted request body. A full patient payload is about 2 KB.
MAX_BODY_BYTES = _env_int("CRE_MAX_BODY_BYTES", 64 * 1024)
# Interactive API docs at /docs and /redoc.
ENABLE_DOCS = _env_bool("CRE_ENABLE_DOCS", True)
LOG_LEVEL = os.getenv("CRE_LOG_LEVEL", "INFO").upper()
