"""Example patients for the dashboard, drawn from the development cohort only (labels are never read or exposed)."""
import json
from functools import lru_cache
from typing import Any, Dict, List

import numpy as np
import pandas as pd

from .config import DATA_PATH, PREPROCESSING_CONFIG_PATH, TARGET_NAMES
from .model_registry import ModelRegistry


@lru_cache(maxsize=1)
def example_patients() -> List[Dict[str, Any]]:
    cfg = json.loads(PREPROCESSING_CONFIG_PATH.read_text())
    raw = pd.read_excel(DATA_PATH).drop(columns=cfg["target_columns"] + cfg["dropped_features"])
    X = raw.iloc[cfg["train_indices"]].reset_index(drop=True)
    X["Sex"] = X["Sex"].replace({"Fmale": "Female"})

    registry = ModelRegistry.get_instance()
    registry.load_models()
    p = {}
    for t in TARGET_NAMES:
        raw_p = registry.get_pipeline(t).predict_proba(X)[:, 1]
        p[t] = np.array([registry.calibrate(t, v) for v in raw_p])

    vessels = np.column_stack([p["LAD"], p["LCX"], p["RCA"]])
    high = p["Cath"] > 0.8
    picks = [
        ("Lower estimated probability", "Lowest overall CAD estimate in the development cohort", int(np.argmin(p["Cath"]))),
        ("Intermediate estimate", "Overall CAD estimate closest to 50%", int(np.argmin(np.abs(p["Cath"] - 0.5)))),
        ("LAD-predominant pattern", "High overall estimate with the LAD estimate well above LCX and RCA",
         int(np.argmax(np.where(high, p["LAD"] - np.maximum(p["LCX"], p["RCA"]), -np.inf)))),
        ("RCA-predominant pattern", "High overall estimate with the RCA estimate above LAD and LCX",
         int(np.argmax(np.where(high, p["RCA"] - np.maximum(p["LAD"], p["LCX"]), -np.inf)))),
        ("Multi-vessel pattern", "All three vessel estimates high", int(np.argmax(vessels.min(axis=1)))),
    ]
    out, seen = [], set()
    for title, description, i in picks:
        if i in seen:
            continue
        seen.add(i)
        features = {k: (v.item() if hasattr(v, "item") else v) for k, v in X.iloc[i].to_dict().items()}
        out.append({"id": f"dev-{i}", "title": title, "description": description, "features": features})
    return out
