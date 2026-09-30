import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.tests.conftest import EXPECTED_UNCALIBRATED


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health_endpoint(client):
    data = client.get("/health").json()
    assert data["status"] == "ok"
    assert data["models_loaded"] is True
    assert set(data["active_targets"]) == {"Cath", "LAD", "LCX", "RCA"}


def test_model_info_endpoint(client):
    data = client.get("/model-info").json()
    cohort = data["v1_frozen_manifest"]["cohort"]
    assert (cohort["total_patients"], cohort["development_patients"], cohort["holdout_patients"]) == (303, 242, 61)
    assert data["v1_1_postprocessing"]["holdout_used"] is False
    assert set(data["v1_1_postprocessing"]["targets"]) == {"Cath", "LAD", "LCX", "RCA"}


def test_global_importance_endpoint(client):
    data = client.get("/global-importance").json()
    features = {row["Source Feature"] for row in data["features"]}
    assert "Typical Chest Pain" in features and len(features) == 54


def test_probability_bands_endpoint(client):
    bands = client.get("/probability-bands").json()["bands"]
    assert {b["target"] for b in bands} == {"Cath", "LAD", "LCX", "RCA"}


def test_predict_endpoint_success(client, dev_patient):
    response = client.post("/predict", json=dev_patient)
    assert response.status_code == 200
    data = response.json()
    assert abs(data["overall_cad"]["uncalibrated_probability"] - EXPECTED_UNCALIBRATED["Cath"]) < 1e-3
    assert set(data["vessels"]) == {"LAD", "LCX", "RCA"}
    for target in ["Cath", "LAD", "LCX", "RCA"]:
        assert data["explanations"][target]["features_increasing_prediction"]
    assert "consistency" in data and "input_warnings" in data
    assert "not a medical diagnostic device" in data["disclaimer"]


def test_predict_rejects_target_leakage(client, dev_patient):
    assert client.post("/predict", json={**dev_patient, "Cath": "CAD"}).status_code == 422


def test_predict_rejects_missing_field(client, dev_patient):
    payload = dict(dev_patient)
    del payload["Age"]
    assert client.post("/predict", json=payload).status_code == 422


def test_predict_rejects_impossible_combination(client, dev_patient):
    bad = {**dev_patient, "Typical Chest Pain": 1, "Atypical": "Y"}
    assert client.post("/predict", json=bad).status_code == 422


def test_performance_endpoint(client):
    data = client.get("/performance").json()
    for t in ["Cath", "LAD", "LCX", "RCA"]:
        assert "ROC-AUC" in data["targets"][t]["holdout_v1_at_0.50"]
        assert data["targets"][t]["discrimination"] in {"good", "moderate", "limited"}
    assert data["probability_bands"]


def test_example_patients_are_valid_inputs_without_labels(client):
    patients = client.get("/example-patients").json()["patients"]
    assert len(patients) >= 3
    for p in patients:
        assert not {"Cath", "LAD", "LCX", "RCA"} & set(p["features"])
        assert p["id"].startswith("dev-")
        assert client.post("/predict", json=p["features"]).status_code == 200


def test_frontend_is_served(client):
    for path in ("/", "/app.html"):
        page = client.get(path)
        assert page.status_code == 200 and "Coronary Risk Explorer" in page.text
        assert "decision support" in page.text.lower()
    for asset in ("/js/app.js", "/js/landing.js", "/js/scene/anatomy-loader.js"):
        assert client.get(asset).status_code == 200


def test_frontend_libraries_cdn_with_offline_fallback(client):
    """Libraries load from the CDN when reachable and from /vendor otherwise (js/deps.js). The CDN files are pinned
    by integrity hashes that must equal the vendored bytes, so both sources are byte-identical."""
    import base64, hashlib, re
    for path in ("/", "/app.html"):
        text = client.get(path).text
        assert 'src="js/deps.js"' in text and "startApp(" in text, path
        assert 'type="importmap"' not in text and 'type="module"' not in text, path   # only deps.js loads modules
    deps = client.get("/js/deps.js").text
    assert "cdn.jsdelivr.net/npm/three@0.170.0/" in deps and "./vendor/three/" in deps and "vendor/fonts/fonts.css" in deps
    blocks = dict(re.findall(r"(three|gsap): \{(.*?)\n    \}", deps, re.S))
    assert set(blocks) == {"three", "gsap"}
    for pkg, block in blocks.items():
        for file, sri in re.findall(r"'([^']+)': '(sha384-[^']+)'", block):
            body = client.get(f"/vendor/{pkg}/{file}")
            assert body.status_code == 200, file
            assert "sha384-" + base64.b64encode(hashlib.sha384(body.content).digest()).decode() == sri, file
    for asset in ("/vendor/fonts/fonts.css", "/vendor/fonts/Geist-normal-latin.woff2"):
        assert client.get(asset).status_code == 200, asset


def test_operating_curves_endpoint(client):
    data = client.get("/operating-curves").json()
    assert "holdout was not used" in data["data"]
    post = client.get("/model-info").json()["v1_1_postprocessing"]["targets"]
    for t in ["Cath", "LAD", "LCX", "RCA"]:
        d = data["targets"][t]
        c = d["curve"]
        assert len(c["threshold"]) == len(c["sensitivity"]) == len(c["specificity"]) == 99
        assert all(a >= b for a, b in zip(c["sensitivity"], c["sensitivity"][1:]))   # monotone in the threshold
        assert abs(d["presets"]["default"]["threshold"] - post[t]["operating_threshold"]) < 1e-3
        assert d["presets"]["high_sensitivity"]["sensitivity"] >= 0.90
