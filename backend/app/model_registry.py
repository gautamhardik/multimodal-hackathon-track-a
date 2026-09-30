import hashlib
import json
import logging
from typing import Any, Dict

import joblib
import numpy as np

from .config import MODEL_PATHS, POSTPROCESSING_PATH, TARGET_NAMES

logger = logging.getLogger(__name__)


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def _single_threaded(pipeline):
    """Score one patient per request on one thread. With n_jobs=-1 every call starts and tears down a worker pool,
    which costs ~1 s per request on a single row. Runtime setting only: the fitted trees and outputs are unchanged."""
    params = pipeline.get_params(deep=True)
    pipeline.set_params(**{k: 1 for k, v in params.items() if k.endswith("n_jobs") and v not in (None, 1)})
    return pipeline


class ModelRegistry:
    """Loads the frozen v1 pipelines and the v1.1 development-only post-processing (calibration + thresholds)."""

    _instance = None

    def __init__(self):
        self.pipelines: Dict[str, Any] = {}
        self.postprocessing: Dict[str, Any] = {}
        self.is_loaded: bool = False

    @classmethod
    def get_instance(cls) -> "ModelRegistry":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def load_models(self) -> None:
        if self.is_loaded:
            return
        if not POSTPROCESSING_PATH.exists():
            raise FileNotFoundError(f"Missing v1.1 post-processing artifact at {POSTPROCESSING_PATH} (run Notebook 7)")
        self.postprocessing = json.loads(POSTPROCESSING_PATH.read_text())

        for target in TARGET_NAMES:
            path = MODEL_PATHS[target]
            if not path.exists():
                raise FileNotFoundError(f"Missing model artifact for {target} at {path}")
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            expected = self.postprocessing["targets"][target]["pipeline_sha256"]
            if digest != expected:
                raise RuntimeError(f"{target} pipeline hash {digest[:12]} does not match the calibrated artifact ({expected[:12]})")
            self.pipelines[target] = _single_threaded(joblib.load(path))
            logger.info(f"Loaded {target} pipeline ({digest[:12]})")

        self.is_loaded = True
        logger.info("All 4 frozen pipelines loaded and verified against the v1.1 post-processing artifact.")

    def get_pipeline(self, target: str):
        if not self.is_loaded:
            self.load_models()
        return self.pipelines[target]

    def calibrate(self, target: str, raw_probability: float) -> float:
        """Apply the development-fitted Platt map (monotone, so ranking/ROC-AUC is unchanged)."""
        cal = self.postprocessing["targets"][target]["calibration"]
        z = cal["a"] * _logit(np.array([raw_probability]))[0] + cal["b"]
        return float(1 / (1 + np.exp(-z)))

    def operating_threshold(self, target: str) -> float:
        return float(self.postprocessing["targets"][target]["operating_threshold"])

    def threshold_rule(self, target: str) -> str:
        return self.postprocessing["targets"][target]["threshold_rule"]
