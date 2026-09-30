import json

import numpy as np
import pytest
from pydantic import ValidationError

from backend.app.config import POSTPROCESSING_PATH, TARGET_NAMES
from backend.app.inference import InferenceEngine
from backend.app.model_registry import ModelRegistry
from backend.app.schemas import PatientInput
from backend.app.shap_service import SHAPService
from backend.tests.conftest import EXPECTED_UNCALIBRATED

VALID_DOMAINS = {"Demographic", "Clinical History", "Behavioral", "Clinical Status", "Vital Signs", "Physical Exam",
                 "Symptom", "Laboratory", "Echocardiographic", "ECG"}


@pytest.fixture(scope="module")
def engine():
    ModelRegistry.get_instance().load_models()
    SHAPService.get_instance().initialize()
    return InferenceEngine()


@pytest.fixture(scope="module")
def response(engine, dev_patient):
    return engine.predict(PatientInput(**dev_patient))


def _results(resp):
    return {"Cath": resp.overall_cad, **resp.vessels}


def test_frozen_model_outputs_unchanged(response):
    """The raw outputs must equal the frozen v1 pipelines (calibration never alters the models)."""
    for target, expected in EXPECTED_UNCALIBRATED.items():
        assert abs(_results(response)[target].uncalibrated_probability - expected) < 1e-3


def test_calibration_matches_artifact_and_is_monotone(response):
    post = json.loads(POSTPROCESSING_PATH.read_text())["targets"]
    for target, res in _results(response).items():
        a, b = post[target]["calibration"]["a"], post[target]["calibration"]["b"]
        raw = res.uncalibrated_probability
        expected = 1 / (1 + np.exp(-(a * np.log(raw / (1 - raw)) + b)))
        assert a > 0
        assert abs(res.probability - expected) < 1e-3


def test_prediction_uses_operating_threshold(response):
    for target, res in _results(response).items():
        positive = "CAD" if target == "Cath" else "Stenotic"
        assert res.prediction == (positive if res.probability >= res.operating_threshold else "Normal")


def test_shap_mapping_is_clinically_correct(response):
    for target in TARGET_NAMES:
        exp = response.explanations[target]
        features = {c.feature: c for c in exp.all_contributions}
        assert len(features) == 54, "Every raw predictor must receive exactly one aggregated attribution"
        assert all(c.clinical_domain in VALID_DOMAINS for c in exp.all_contributions)
        assert features["Typical Chest Pain"].clinical_domain == "Symptom"
        assert features["LowTH Ang"].clinical_domain == "Symptom"
        assert features["VHD"].clinical_domain == "Echocardiographic"
        assert abs(sum(c.relative_contribution_pct for c in exp.all_contributions) - 100) < 0.5


def test_shap_additivity_in_native_units(response):
    for target in TARGET_NAMES:
        exp = response.explanations[target]
        total = exp.base_value + sum(c.attribution for c in exp.all_contributions)
        assert abs(total - exp.model_output) < 5e-3
    assert response.explanations["Cath"].attribution_units == "log-odds"
    assert response.explanations["LAD"].attribution_units == "probability"


def test_explanations_report_raw_values(response, dev_patient):
    contrib = {c.feature: c for c in response.explanations["Cath"].all_contributions}
    assert contrib["Age"].value == dev_patient["Age"]
    assert contrib["EF-TTE"].value == dev_patient["EF-TTE"]


def test_consistency_flag(response):
    vessels_max = max(v.probability for v in response.vessels.values())
    assert response.consistency.consistent == (response.overall_cad.probability >= vessels_max)


def test_deterministic_predictions(engine, dev_patient):
    r1 = engine.predict(PatientInput(**dev_patient))
    r2 = engine.predict(PatientInput(**dev_patient))
    assert _results(r1)["RCA"].probability == _results(r2)["RCA"].probability
    assert r1.explanations["LAD"].all_contributions == r2.explanations["LAD"].all_contributions


# ------------------------------------------------------------------ input contract
def test_bmi_and_obesity_are_derived(dev_patient):
    payload = {k: v for k, v in dev_patient.items() if k not in ("BMI", "Obesity")}
    p = PatientInput(**payload)
    assert abs(p.BMI - payload["Weight"] / (payload["Length"] / 100) ** 2) < 1e-9
    assert p.Obesity.value == ("Y" if p.BMI >= 25 else "N")


@pytest.mark.parametrize("override", [
    {"BMI": 60.0},                                                   # inconsistent with Weight/Height
    {"Typical Chest Pain": 1, "Atypical": "Y", "Nonanginal": "N"},   # mutually exclusive chest-pain classes
    {"Current Smoker": 1, "EX-Smoker": 1},
    {"Lymph": 60, "Neut": 60},
    {"Function Class": 2.5},                                         # discrete field
    {"Region RWMA": 5},
    {"Age": 5},
    {"BBB": "INVALID"},
    {"Cath": "CAD"},                                                 # target leakage
])
def test_invalid_inputs_rejected(dev_patient, override):
    with pytest.raises(ValidationError):
        PatientInput(**{**dev_patient, **override})


def test_out_of_range_input_warns(engine, dev_patient):
    resp = engine.predict(PatientInput(**{**dev_patient, "Age": 95}))
    assert any(w.startswith("Age=95") for w in resp.input_warnings)
