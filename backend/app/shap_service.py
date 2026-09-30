import json
import logging
from typing import Any, Dict, List

import numpy as np
import shap
from xgboost import XGBClassifier

from .config import SHAP_MAPPING_PATH, TARGET_NAMES
from .model_registry import ModelRegistry

logger = logging.getLogger(__name__)


def build_feature_map(preprocessor) -> List[Dict[str, str]]:
    """Map every transformed column to its raw source feature using the fitted ColumnTransformer structure."""
    block_columns = {name: list(cols) for name, _, cols in preprocessor.transformers_}
    rows = []
    for out_name in preprocessor.get_feature_names_out():
        block, rest = out_name.split("__", 1)
        cols = block_columns[block]
        if rest in cols:
            source = rest
        else:  # one-hot output such as "BBB_LBBB" or "VHD_mild"
            source = next(c for c in cols if rest.startswith(c + "_"))
        rows.append({"transformed_feature": out_name, "source_feature": source})
    return rows


class SHAPService:
    """Exact TreeExplainer attributions, aggregated from transformed columns back to the 54 clinical inputs."""

    _instance = None

    def __init__(self):
        self.explainers: Dict[str, Any] = {}
        self.feature_maps: Dict[str, List[Dict[str, str]]] = {}
        self.domains: Dict[str, str] = {}
        self.units: Dict[str, str] = {}
        self.is_initialized: bool = False

    @classmethod
    def get_instance(cls) -> "SHAPService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def initialize(self) -> None:
        if self.is_initialized:
            return
        registry = ModelRegistry.get_instance()
        registry.load_models()

        if not SHAP_MAPPING_PATH.exists():
            raise FileNotFoundError(f"Missing SHAP mapping at {SHAP_MAPPING_PATH}")
        saved_mapping = json.loads(SHAP_MAPPING_PATH.read_text())

        for target in TARGET_NAMES:
            pipe = registry.get_pipeline(target)
            model = pipe.named_steps["model"]
            fmap = build_feature_map(pipe.named_steps["preprocessor"])
            saved = saved_mapping[target]
            if [r["transformed_feature"] for r in saved] != [r["transformed_feature"] for r in fmap] or \
                    [r["source_feature"] for r in saved] != [r["source_feature"] for r in fmap]:
                raise RuntimeError(f"SHAP feature mapping artifact is out of date for {target} (re-run Notebook 6)")
            for r in saved:
                self.domains[r["source_feature"]] = r["clinical_domain"]
            self.feature_maps[target] = fmap
            self.explainers[target] = shap.TreeExplainer(model)
            self.units[target] = "log-odds" if isinstance(model, XGBClassifier) else "probability"

        self.is_initialized = True
        logger.info("SHAPService initialized (structural feature mapping verified against artifact).")

    def explain(self, target: str, X_trans: np.ndarray, raw_values: Dict[str, Any], model_output: float) -> Dict[str, Any]:
        """Explain one transformed row. `model_output` is the native model output (margin for XGBoost, probability for RF)."""
        if not self.is_initialized:
            self.initialize()
        explainer = self.explainers[target]
        shap_raw = explainer.shap_values(X_trans)
        expected = np.atleast_1d(explainer.expected_value)
        if isinstance(shap_raw, list):
            phi, base = np.asarray(shap_raw[1])[0], float(expected[1])
        elif shap_raw.ndim == 3:
            phi, base = shap_raw[0, :, 1], float(expected[1])
        else:
            phi, base = shap_raw[0], float(expected[0])

        if abs(base + phi.sum() - model_output) > 1e-3:
            logger.warning(f"SHAP additivity check failed for {target}: {base + phi.sum():.5f} vs {model_output:.5f}")

        by_source: Dict[str, float] = {}
        for r, value in zip(self.feature_maps[target], phi):
            by_source[r["source_feature"]] = by_source.get(r["source_feature"], 0.0) + float(value)
        total_abs = sum(abs(v) for v in by_source.values()) or 1.0

        contributions = sorted(
            ({
                "feature": source,
                "clinical_domain": self.domains[source],
                "value": raw_values[source],
                "attribution": round(v, 5),
                "relative_contribution_pct": round(100 * abs(v) / total_abs, 2),
                "direction": "raises estimate" if v > 0 else "lowers estimate" if v < 0 else "no effect",
            } for source, v in by_source.items()),
            key=lambda c: abs(c["attribution"]), reverse=True)

        return {
            "target": target,
            "attribution_units": self.units[target],
            "base_value": round(base, 5),
            "model_output": round(model_output, 5),
            "features_increasing_prediction": [c for c in contributions if c["attribution"] > 0][:5],
            "features_decreasing_prediction": [c for c in contributions if c["attribution"] < 0][:5],
            "all_contributions": contributions,
        }
