import json
import logging
import uuid
from typing import Dict, List, Optional

import pandas as pd
from xgboost import XGBClassifier

from .config import (DISCLAIMER, MODEL_VERSION, PROBABILITY_DEFINITION, TARGET_LABELS, TARGET_NAMES,
                     TRAINING_RANGES_PATH, VESSEL_NAMES)
from .model_registry import ModelRegistry
from .schemas import ConsistencyCheck, PatientInput, PredictionResponse, TargetExplanation, TargetResult
from .shap_service import SHAPService

logger = logging.getLogger(__name__)


class InferenceEngine:
    def __init__(self):
        self.registry = ModelRegistry.get_instance()
        self.shap_service = SHAPService.get_instance()
        self._training_ranges: Optional[Dict] = None

    def _range_warnings(self, patient: Dict) -> List[str]:
        """Flag numeric inputs outside the range observed in the 242 development patients."""
        if self._training_ranges is None:
            self._training_ranges = json.loads(TRAINING_RANGES_PATH.read_text())
        warnings = []
        for feature, r in self._training_ranges.items():
            value = patient[feature]
            if value < r["min"] or value > r["max"]:
                warnings.append(f"{feature}={value:g} is outside the development cohort range [{r['min']:g}, {r['max']:g}]; "
                                "the model has not seen such values and the estimate may be unreliable")
        return warnings

    def predict(self, patient_input: PatientInput, request_id: str = None) -> PredictionResponse:
        request_id = request_id or f"REQ_{uuid.uuid4().hex[:8].upper()}"
        patient = patient_input.to_inference_dict()
        df_input = pd.DataFrame([patient])

        results: Dict[str, TargetResult] = {}
        explanations: Dict[str, TargetExplanation] = {}
        for target in TARGET_NAMES:
            pipeline = self.registry.get_pipeline(target)
            model = pipeline.named_steps["model"]
            X_trans = pipeline.named_steps["preprocessor"].transform(df_input)

            raw = float(model.predict_proba(X_trans)[0, 1])
            calibrated = self.registry.calibrate(target, raw)
            threshold = self.registry.operating_threshold(target)
            positive = "CAD" if target == "Cath" else "Stenotic"
            results[target] = TargetResult(
                target=target,
                label=TARGET_LABELS[target],
                probability=round(calibrated, 4),
                uncalibrated_probability=round(raw, 4),
                operating_threshold=round(threshold, 4),
                threshold_rule=self.registry.threshold_rule(target),
                prediction=positive if calibrated >= threshold else "Normal",
            )

            native_output = float(model.predict(X_trans, output_margin=True)[0]) if isinstance(model, XGBClassifier) else raw
            explanations[target] = TargetExplanation(**self.shap_service.explain(target, X_trans, patient, native_output))

        top_vessel = max(VESSEL_NAMES, key=lambda v: results[v].probability)
        consistent = results["Cath"].probability >= results[top_vessel].probability
        consistency = ConsistencyCheck(
            consistent=consistent,
            message=("Vessel estimates are compatible with the overall CAD estimate." if consistent else
                     f"The {top_vessel} estimate ({results[top_vessel].probability:.0%}) exceeds the overall CAD estimate "
                     f"({results['Cath'].probability:.0%}). The four models are trained independently; interpret with caution.")
        )

        return PredictionResponse(
            request_id=request_id,
            model_version=MODEL_VERSION,
            probability_definition=PROBABILITY_DEFINITION,
            overall_cad=results["Cath"],
            vessels={v: results[v] for v in VESSEL_NAMES},
            consistency=consistency,
            explanations=explanations,
            derived_inputs={"BMI": round(patient["BMI"], 2), "Obesity": patient["Obesity"]},
            input_warnings=patient_input.input_warnings + self._range_warnings(patient),
            disclaimer=DISCLAIMER,
        )
