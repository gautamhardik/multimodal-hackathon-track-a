import json
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def dev_patient():
    """Raw predictors of the first development patient (tests never read holdout rows)."""
    cfg = json.loads((ROOT / "preprocessing_config.json").read_text())
    df = pd.read_excel(ROOT / "extention of Z-Alizadeh sani dataset.xlsx")
    df = df.drop(columns=["Exertional CP", "Cath", "LAD", "LCX", "RCA"])
    row = df.iloc[cfg["train_indices"][0]].to_dict()
    return {k: (v.item() if hasattr(v, "item") else v) for k, v in row.items()}


# Frozen v1 model outputs for this patient (reproduced from the Notebook 6 pipelines)
EXPECTED_UNCALIBRATED = {"Cath": 0.9337, "LAD": 0.8360, "LCX": 0.6649, "RCA": 0.5837}
