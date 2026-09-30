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
