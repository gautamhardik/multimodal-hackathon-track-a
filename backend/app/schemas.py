from enum import Enum
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field, PrivateAttr, field_validator, model_validator


class SexEnum(str, Enum):
    male = "Male"
    female = "Female"


class BBBEnum(str, Enum):
    n = "N"
    lbbb = "LBBB"
    rbbb = "RBBB"


class VHDEnum(str, Enum):
    n = "N"
    mild = "mild"
    moderate = "Moderate"
    severe = "Severe"


class BinaryStrEnum(str, Enum):
    n = "N"
    y = "Y"


BMI_TOLERANCE = 0.5  # kg/m^2; the dataset BMI equals Weight / Height^2 exactly


class PatientInput(BaseModel):
    # Numeric clinical / laboratory / echo features. Hard bounds reject physiologically implausible values;
    # values outside the development cohort's range are accepted but reported in `input_warnings`.
    Age: float = Field(..., ge=18, le=100, description="Age in years (adult cohort)")
    Weight: float = Field(..., ge=30, le=250, description="Weight in kg")
    Length: float = Field(..., ge=120, le=230, description="Height in cm")
    BMI: Optional[float] = Field(None, ge=10, le=70, description="Optional; derived from Weight and Height when omitted")
    BP: float = Field(..., ge=60, le=260, description="Blood Pressure (mmHg)")
    PR: float = Field(..., ge=30, le=220, description="Pulse Rate (bpm)")
    FBS: float = Field(..., ge=20, le=600, description="Fasting Blood Sugar (mg/dL)")
    CR: float = Field(..., ge=0.1, le=20.0, description="Creatinine (mg/dL)")
    TG: float = Field(..., ge=10, le=1500, description="Triglycerides (mg/dL)")
    LDL: float = Field(..., ge=10, le=600, description="Low-Density Lipoprotein (mg/dL)")
    HDL: float = Field(..., ge=5, le=200, description="High-Density Lipoprotein (mg/dL)")
    BUN: float = Field(..., ge=1, le=200, description="Blood Urea Nitrogen (mg/dL)")
    ESR: float = Field(..., ge=0, le=150, description="Erythrocyte Sedimentation Rate (mm/h)")
    HB: float = Field(..., ge=3, le=25, description="Hemoglobin (g/dL)")
    K: float = Field(..., ge=1.0, le=10.0, description="Potassium (mEq/L)")
    Na: float = Field(..., ge=80, le=180, description="Sodium (mEq/L)")
    WBC: float = Field(..., ge=500, le=50000, description="White Blood Cell Count (cells/uL)")
    Lymph: float = Field(..., ge=0, le=100, description="Lymphocyte percentage")
    Neut: float = Field(..., ge=0, le=100, description="Neutrophil percentage")
    PLT: float = Field(..., ge=10, le=1500, description="Platelet count (10^3/uL)")
    EF_TTE: float = Field(..., alias="EF-TTE", ge=5, le=85, description="Ejection Fraction by transthoracic echo (%)")
    Function_Class: int = Field(..., alias="Function Class", ge=0, le=3, description="Functional class as coded in the dataset (0-3)")
    Region_RWMA: int = Field(..., alias="Region RWMA", ge=0, le=4, description="Regional wall motion abnormality code (0-4); not a lesion location")

    # Binary string features
    Obesity: Optional[BinaryStrEnum] = Field(None, description="Optional; derived as BMI >= 25 when omitted")
    CRF: BinaryStrEnum
    CVA: BinaryStrEnum
    Airway_disease: BinaryStrEnum = Field(..., alias="Airway disease")
    Thyroid_Disease: BinaryStrEnum = Field(..., alias="Thyroid Disease")
    CHF: BinaryStrEnum
    DLP: BinaryStrEnum
    Weak_Peripheral_Pulse: BinaryStrEnum = Field(..., alias="Weak Peripheral Pulse")
    Lung_rales: BinaryStrEnum = Field(..., alias="Lung rales")
    Systolic_Murmur: BinaryStrEnum = Field(..., alias="Systolic Murmur")
    Diastolic_Murmur: BinaryStrEnum = Field(..., alias="Diastolic Murmur")
    Dyspnea: BinaryStrEnum
    Atypical: BinaryStrEnum
    Nonanginal: BinaryStrEnum
    LowTH_Ang: BinaryStrEnum = Field(..., alias="LowTH Ang")
    LVH: BinaryStrEnum
    Poor_R_Progression: BinaryStrEnum = Field(..., alias="Poor R Progression")

    # Categorical features
    Sex: SexEnum
    BBB: BBBEnum
    VHD: VHDEnum

    # Binary numeric features (0 or 1)
    DM: int = Field(..., ge=0, le=1, description="Diabetes Mellitus (0 or 1)")
    HTN: int = Field(..., ge=0, le=1, description="Hypertension (0 or 1)")
    Current_Smoker: int = Field(..., alias="Current Smoker", ge=0, le=1)
    EX_Smoker: int = Field(..., alias="EX-Smoker", ge=0, le=1)
    FH: int = Field(..., ge=0, le=1, description="Family History (0 or 1)")
    Edema: int = Field(..., ge=0, le=1)
    Typical_Chest_Pain: int = Field(..., alias="Typical Chest Pain", ge=0, le=1)
    Q_Wave: int = Field(..., alias="Q Wave", ge=0, le=1)
    St_Elevation: int = Field(..., alias="St Elevation", ge=0, le=1)
    St_Depression: int = Field(..., alias="St Depression", ge=0, le=1)
    Tinversion: int = Field(..., ge=0, le=1)

    model_config = {
        "populate_by_name": True,
        "extra": "forbid"  # rejects target fields (Cath, LAD, LCX, RCA) and any unknown attribute
    }

    _warnings: List[str] = PrivateAttr(default_factory=list)

    @field_validator("Sex", mode="before")
    @classmethod
    def normalize_sex(cls, v: Any) -> Any:
        if isinstance(v, str):
            v_clean = v.strip().capitalize()
            if v_clean in ["Fmale", "Female"]:
                return "Female"
            if v_clean == "Male":
                return "Male"
        return v

    @model_validator(mode="after")
    def check_clinical_consistency(self) -> "PatientInput":
        bmi = self.Weight / (self.Length / 100) ** 2
        if self.BMI is not None and abs(self.BMI - bmi) > BMI_TOLERANCE:
            raise ValueError(f"BMI {self.BMI:.1f} is inconsistent with Weight/Height ({bmi:.1f}); omit BMI to derive it")
        self.BMI = bmi

        derived_obesity = BinaryStrEnum.y if bmi >= 25 else BinaryStrEnum.n
        if self.Obesity is None:
            self.Obesity = derived_obesity
        elif self.Obesity != derived_obesity:
            self._warnings.append(f"Obesity='{self.Obesity.value}' does not match BMI {bmi:.2f} (dataset convention: BMI >= 25)")

        chest_pain = [self.Typical_Chest_Pain == 1, self.Atypical == BinaryStrEnum.y, self.Nonanginal == BinaryStrEnum.y]
        if sum(chest_pain) > 1:
            raise ValueError("Typical Chest Pain, Atypical and Nonanginal are mutually exclusive chest-pain categories")
        if self.Current_Smoker == 1 and self.EX_Smoker == 1:
            raise ValueError("Current Smoker and EX-Smoker cannot both be 1")
        if self.Lymph + self.Neut > 100:
            raise ValueError("Lymph + Neut percentages cannot exceed 100")
        return self

    @property
    def input_warnings(self) -> List[str]:
        return list(self._warnings)

    def to_inference_dict(self) -> Dict[str, Any]:
        """Convert input data to the exact original column names of the 54 candidate predictors."""
        return {
            "Age": self.Age, "Weight": self.Weight, "Length": self.Length, "BMI": self.BMI,
            "BP": self.BP, "PR": self.PR, "FBS": self.FBS, "CR": self.CR, "TG": self.TG, "LDL": self.LDL,
            "HDL": self.HDL, "BUN": self.BUN, "ESR": self.ESR, "HB": self.HB, "K": self.K, "Na": self.Na,
            "WBC": self.WBC, "Lymph": self.Lymph, "Neut": self.Neut, "PLT": self.PLT, "EF-TTE": self.EF_TTE,
            "Function Class": self.Function_Class, "Region RWMA": self.Region_RWMA,
            "Obesity": self.Obesity.value, "CRF": self.CRF.value, "CVA": self.CVA.value,
            "Airway disease": self.Airway_disease.value, "Thyroid Disease": self.Thyroid_Disease.value,
            "CHF": self.CHF.value, "DLP": self.DLP.value, "Weak Peripheral Pulse": self.Weak_Peripheral_Pulse.value,
            "Lung rales": self.Lung_rales.value, "Systolic Murmur": self.Systolic_Murmur.value,
            "Diastolic Murmur": self.Diastolic_Murmur.value, "Dyspnea": self.Dyspnea.value,
            "Atypical": self.Atypical.value, "Nonanginal": self.Nonanginal.value, "LowTH Ang": self.LowTH_Ang.value,
            "LVH": self.LVH.value, "Poor R Progression": self.Poor_R_Progression.value,
            "Sex": self.Sex.value, "BBB": self.BBB.value, "VHD": self.VHD.value,
            "DM": self.DM, "HTN": self.HTN, "Current Smoker": self.Current_Smoker, "EX-Smoker": self.EX_Smoker,
            "FH": self.FH, "Edema": self.Edema, "Typical Chest Pain": self.Typical_Chest_Pain, "Q Wave": self.Q_Wave,
            "St Elevation": self.St_Elevation, "St Depression": self.St_Depression, "Tinversion": self.Tinversion
        }


# --- Response Schemas ---

class TargetResult(BaseModel):
    target: str
    label: str
    probability: float = Field(..., description="Calibrated probability (development-only Platt scaling)")
    uncalibrated_probability: float = Field(..., description="Raw frozen-model output, as evaluated on the holdout in Notebook 6")
    operating_threshold: float
    threshold_rule: str
    prediction: str = Field(..., description="Flag at the development-validated operating threshold")


class Contribution(BaseModel):
    feature: str
    clinical_domain: str
    value: Union[float, int, str]
    attribution: float = Field(..., description="Exact SHAP value in `attribution_units`")
    relative_contribution_pct: float = Field(..., description="Share of this target's total |SHAP| (unit-free)")
    direction: str


class TargetExplanation(BaseModel):
    target: str
    attribution_units: str
    base_value: float
    model_output: float
    features_increasing_prediction: List[Contribution]
    features_decreasing_prediction: List[Contribution]
    all_contributions: List[Contribution]


class ConsistencyCheck(BaseModel):
    consistent: bool
    message: str


class PredictionResponse(BaseModel):
    request_id: str
    model_version: str
    probability_definition: str
    overall_cad: TargetResult
    vessels: Dict[str, TargetResult]
    consistency: ConsistencyCheck
    explanations: Dict[str, TargetExplanation]
    derived_inputs: Dict[str, Any]
    input_warnings: List[str]
    disclaimer: str
