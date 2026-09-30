import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import (ALLOWED_ORIGINS, COLOR_BANDS_PATH, DISCLAIMER, ENABLE_DOCS, FRONTEND_DIR, GLOBAL_IMPORTANCE_PATH,
                     HOLDOUT_CI_PATH, LOG_LEVEL, MANIFEST_PATH, MAX_BODY_BYTES, MODEL_VERSION, OPERATING_CURVES_PATH,
                     PREDICT_RATE_PER_MIN, PROBABILITY_DEFINITION, TARGET_NAMES)
from .examples import example_patients
from .inference import InferenceEngine
from .model_registry import ModelRegistry
from .schemas import PatientInput, PredictionResponse
from .security import REQUEST_ID_RE, SECURITY_HEADERS, RateLimiter, add_nonce, new_nonce, page_csp
from .shap_service import SHAPService

logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("cardio_api")
access_log = logging.getLogger("cardio_api.access")


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
    lifespan=lifespan,
    docs_url="/docs" if ENABLE_DOCS else None,
    redoc_url="/redoc" if ENABLE_DOCS else None,
    openapi_url="/openapi.json" if ENABLE_DOCS else None,
)

# The bundled frontend is same-origin, so cross-origin access is off unless CRE_ALLOWED_ORIGINS lists origins.
# No cookies or credentials are used by this API.
if ALLOWED_ORIGINS:
    app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=False,
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Request-ID"])

app.add_middleware(GZipMiddleware, minimum_size=1024)

predict_limiter = RateLimiter(PREDICT_RATE_PER_MIN)


def _error(code: int, detail: str, request_id: str, headers=None) -> JSONResponse:
    return JSONResponse({"detail": detail, "request_id": request_id}, status_code=code, headers=headers)


@app.middleware("http")
async def edge(request: Request, call_next):
    """Request IDs, body-size and rate limits, safe 500s, security and cache headers, and an access log that
    never records request bodies (patient data) or client addresses."""
    start = time.perf_counter()
    incoming = request.headers.get("x-request-id", "")
    request_id = incoming if REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex[:16]
    request.state.request_id = request_id
    path = request.url.path

    response = None
    if request.method == "POST":
        length = request.headers.get("content-length")
        if length is None:
            response = _error(411, "Content-Length required.", request_id)
        elif not length.isdigit() or int(length) > MAX_BODY_BYTES:
            response = _error(413, f"Request body larger than {MAX_BODY_BYTES} bytes.", request_id)
        elif path == "/predict":
            client = request.client.host if request.client else "unknown"
            allowed, retry = predict_limiter.check(client)
            if not allowed:
                response = _error(429, "Too many predictions from this address; try again shortly.", request_id,
                                  {"Retry-After": str(retry)})
    if response is None:
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled error [request_id=%s] %s %s", request_id, request.method, path)
            response = _error(500, "Internal server error.", request_id)

    response.headers["X-Request-ID"] = request_id
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    if request.url.scheme == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    top = path.split("/")[1]
    if request.method == "GET" and top in ("", "index.html", "app.html", "js", "css", "assets"):
        response.headers["Cache-Control"] = "no-cache"   # revalidate (ETag) so an updated UI is never served stale
    elif request.method == "GET" and top == "vendor" and response.status_code == 200:
        response.headers["Cache-Control"] = "public, max-age=604800"   # pinned third-party versions (three 0.170, GSAP 3.15)
    access_log.info("%s %s %d %.0fms request_id=%s", request.method, path, response.status_code,
                    (time.perf_counter() - start) * 1000, request_id)
    return response


engine = InferenceEngine()


def _read_json(path):
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Artifact not found: {path.name}")
    return json.loads(path.read_text())


@app.get("/health", summary="Health Check", tags=["System"])
def health_check():
    """Readiness: 200 once all four verified pipelines are loaded, 503 otherwise (use for load-balancer checks)."""
    registry = ModelRegistry.get_instance()
    if not registry.is_loaded:
        return JSONResponse({"status": "starting", "models_loaded": False}, status_code=503)
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
def predict_patient(patient: PatientInput, request: Request):
    """
    Accepts the clinical, laboratory, ECG and echocardiographic predictors (BMI and Obesity are derived when omitted).
    Returns calibrated probabilities, flags at development-validated thresholds, a Cath/vessel consistency check,
    exact per-feature SHAP explanations with raw values, and warnings for inputs outside the training range.
    """
    request_id = request.state.request_id
    try:
        return engine.predict(patient, request_id=request_id)
    except Exception:
        logger.exception("Inference execution failed [request_id=%s]", request_id)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Inference failed (reference {request_id}).")


# The two pages are served with a per-response CSP nonce on every <script> (the import map is built at runtime by
# js/deps.js, which copies the nonce). Everything else in the frontend is plain static files.
PAGES = {"/": "index.html", "/index.html": "index.html", "/app.html": "app.html"}


def _page(request: Request):
    nonce = new_nonce()
    html = (FRONTEND_DIR / PAGES[request.url.path]).read_text(encoding="utf-8")
    return HTMLResponse(add_nonce(html, nonce), headers={"Content-Security-Policy": page_csp(nonce)})


for _route in PAGES:
    app.add_api_route(_route, _page, methods=["GET"], include_in_schema=False)

# The dashboard + 3D viewer is served from the same origin. Mounted last so API routes take precedence.
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
