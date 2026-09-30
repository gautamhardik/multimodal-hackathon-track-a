"""Development-only model search, calibration and threshold selection (post-holdout).

Everything in this module operates on the 242 development patients only. The holdout
indices are read solely to assert that they never enter a computation.

All selection, weighting, calibration and threshold choices are made inside the inner
cross-validation loop, so the outer-fold estimates stay honest even though many
candidates are tried.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from scipy.stats import rankdata

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / 'extention of Z-Alizadeh sani dataset.xlsx'
CONFIG_PATH = ROOT / 'preprocessing_config.json'
REGISTRY_PATH = ROOT / 'artifacts' / 'notebook5_final_model_registry.json'

OUTER_SPLITS, OUTER_REPEATS, SEED = 5, 5, 42
CATH_MIN_SENSITIVITY = 0.90

# Diamond & Forrester (NEJM 1979) pre-test probability of CAD (%), by symptom class, sex and age band
# (30-39, 40-49, 50-59, 60-69; younger/older patients use the nearest band). A fixed lookup table: nothing is learned.
DIAMOND_FORRESTER = {
    'typical': {'Male': [69.7, 87.3, 92.0, 94.3], 'Female': [25.8, 55.2, 79.4, 90.6]},
    'atypical': {'Male': [21.8, 46.1, 58.9, 67.1], 'Female': [4.2, 13.3, 32.4, 54.4]},
    'nonanginal': {'Male': [5.2, 14.1, 21.5, 28.1], 'Female': [0.8, 2.8, 8.4, 18.6]},
    'asymptomatic': {'Male': [1.9, 5.5, 9.7, 12.3], 'Female': [0.3, 1.0, 3.2, 7.5]},
}

_STATE = {}


# ----------------------------------------------------------------------------- data
def diamond_forrester(row):
    if row['Typical Chest Pain'] == 1 or row['LowTH Ang'] == 'Y':
        symptom = 'typical'
    elif row['Atypical'] == 'Y':
        symptom = 'atypical'
    elif row['Nonanginal'] == 'Y':
        symptom = 'nonanginal'
    else:
        symptom = 'asymptomatic'
    band = 0 if row['Age'] < 40 else 1 if row['Age'] < 50 else 2 if row['Age'] < 60 else 3
    return DIAMOND_FORRESTER[symptom][row['Sex']][band] / 100


def load_development():
    """Return (X_dev with DF_pretest column, y_dev, preprocessing config, model registry)."""
    if _STATE:
        return _STATE['X'], _STATE['y'], _STATE['cfg'], _STATE['reg']
    cfg = json.loads(CONFIG_PATH.read_text())
    reg = json.loads(REGISTRY_PATH.read_text())
    train_idx, holdout_idx = cfg['train_indices'], cfg['holdout_indices']
    assert not set(train_idx) & set(holdout_idx), 'Development and holdout indices overlap'
    df = pd.read_excel(DATA_PATH)
    df['Sex'] = df['Sex'].replace({'Fmale': 'Female'})
    df = df.drop(columns=cfg['dropped_features'])
    targets = cfg['target_columns']
    y = pd.DataFrame({t: df[t].map(cfg['target_mappings'][t]).astype(int) for t in targets})
    X = df.drop(columns=targets)
    X_dev = X.iloc[train_idx].reset_index(drop=True)
    y_dev = y.iloc[train_idx].reset_index(drop=True)
    assert len(X_dev) == 242
    X_dev['DF_pretest'] = X_dev.apply(diamond_forrester, axis=1)
    _STATE.update(X=X_dev, y=y_dev, cfg=cfg, reg=reg)
    return X_dev, y_dev, cfg, reg


# ----------------------------------------------------------------------------- models
def build_preprocessor(mode, feature_set='base'):
    from sklearn.compose import ColumnTransformer
    from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler
    fg = load_development()[2]['feature_groups']
    numeric = list(fg['all_numeric_features']) + (['DF_pretest'] if feature_set == 'df' else [])
    binary_str = fg['binary_str_features']
    vhd_levels = [['N', 'mild', 'Moderate', 'Severe']]
    vhd = (OrdinalEncoder(categories=vhd_levels, handle_unknown='use_encoded_value', unknown_value=-1)
           if mode == 'Config_A_Ordinal' else OneHotEncoder(categories=vhd_levels, handle_unknown='ignore', sparse_output=False))
    return ColumnTransformer([
        ('num', StandardScaler(), numeric),
        ('bin_str', OrdinalEncoder(categories=[['N', 'Y']] * len(binary_str), handle_unknown='use_encoded_value', unknown_value=-1), binary_str),
        ('sex', OrdinalEncoder(categories=[['Female', 'Male']], handle_unknown='use_encoded_value', unknown_value=-1), fg['sex_feature']),
        ('bbb', OneHotEncoder(categories=[['N', 'LBBB', 'RBBB']], handle_unknown='ignore', sparse_output=False), fg['nominal_features']),
        ('vhd', vhd, fg['ordinal_cat_features']),
        ('bin_num', 'passthrough', fg['binary_num_features']),
    ], remainder='drop')


def model_zoo(target):
    """Candidate library: name -> (preprocessing mode, estimator factory). Fixed configurations, no tuning."""
    from catboost import CatBoostClassifier
    from lightgbm import LGBMClassifier
    from sklearn.ensemble import ExtraTreesClassifier, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.neural_network import MLPClassifier
    from sklearn.svm import SVC
    from xgboost import XGBClassifier
    reg = load_development()[3]
    h_champ = dict(reg[target]['hyperparameters'], n_jobs=1)
    h_cath = dict(reg['Cath']['hyperparameters'], n_jobs=1)
    champ = ((lambda: RandomForestClassifier(**h_champ)) if reg[target]['selected_model'] == 'RandomForest'
             else (lambda: XGBClassifier(**h_champ)))
    A = 'Config_A_Ordinal'
    return {
        'lr_l2_C0.03': (A, lambda: LogisticRegression(C=0.03, max_iter=5000)),
        'lr_l2_C0.1': (A, lambda: LogisticRegression(C=0.1, max_iter=5000)),
        'lr_l2_C0.3': (A, lambda: LogisticRegression(C=0.3, max_iter=5000)),
        'lr_l1_C0.3': (A, lambda: LogisticRegression(penalty='l1', solver='liblinear', C=0.3, max_iter=5000)),
        'champ': (reg[target]['preprocessing'], champ),
        'rf': (A, lambda: RandomForestClassifier(n_estimators=500, min_samples_leaf=3, max_features='sqrt', random_state=SEED, n_jobs=1)),
        'rf_bal': (A, lambda: RandomForestClassifier(n_estimators=500, min_samples_leaf=3, max_features='sqrt',
                                                     class_weight='balanced_subsample', random_state=SEED, n_jobs=1)),
        'et': (A, lambda: ExtraTreesClassifier(n_estimators=500, min_samples_leaf=3, max_features='sqrt', random_state=SEED, n_jobs=1)),
        'xgb_shallow': (A, lambda: XGBClassifier(n_estimators=400, learning_rate=0.03, max_depth=2, min_child_weight=2, subsample=0.8,
                                                 colsample_bytree=0.8, reg_lambda=1.0, eval_metric='logloss', random_state=SEED, n_jobs=1)),
        'xgb_cathcfg': ('Config_B_OneHot', lambda: XGBClassifier(**h_cath)),
        'lgbm': (A, lambda: LGBMClassifier(n_estimators=300, learning_rate=0.03, num_leaves=7, min_child_samples=15, subsample=0.8,
                                           subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, random_state=SEED, n_jobs=1, verbosity=-1)),
        'catboost': (A, lambda: CatBoostClassifier(iterations=500, depth=4, learning_rate=0.03, l2_leaf_reg=5, random_seed=SEED,
                                                   verbose=0, thread_count=1, allow_writing_files=False)),
        'svm_rbf': (A, lambda: SVC(C=1.0, probability=True, random_state=SEED)),
        'mlp': (A, lambda: MLPClassifier(hidden_layer_sizes=(16,), alpha=1.0, max_iter=3000, random_state=SEED)),
    }


def fit_predict(target, name, feature_set, train_rows, test_rows):
    """Fit candidate `name` on train_rows and return P(positive) for test_rows (row positions in X_dev)."""
    import warnings
    from sklearn.pipeline import Pipeline
    warnings.filterwarnings('ignore')
    X, Y, _, _ = load_development()
    y = Y[target].values
    if name == 'hier':  # P(vessel) = P(CAD) * P(vessel | CAD): coherent with the Cath model by construction
        cath_mode, cath_make = model_zoo('Cath')['champ']
        v_mode, v_make = model_zoo(target)['champ']
        y_cath = Y['Cath'].values
        p_cad = Pipeline([('p', build_preprocessor(cath_mode, feature_set)), ('m', cath_make())]).fit(
            X.iloc[train_rows], y_cath[train_rows]).predict_proba(X.iloc[test_rows])[:, 1]
        cad_rows = train_rows[y_cath[train_rows] == 1]
        p_cond = Pipeline([('p', build_preprocessor(v_mode, feature_set)), ('m', v_make())]).fit(
            X.iloc[cad_rows], y[cad_rows]).predict_proba(X.iloc[test_rows])[:, 1]
        return p_cad * p_cond
    mode, make = model_zoo(target)[name]
    pipe = Pipeline([('p', build_preprocessor(mode, feature_set)), ('m', make())])
    return pipe.fit(X.iloc[train_rows], y[train_rows]).predict_proba(X.iloc[test_rows])[:, 1]


def candidate_names(target):
    return [f'{n}|{fs}' for n in list(model_zoo(target)) + (['hier'] if target != 'Cath' else []) for fs in ('base', 'df')]


def _outer_task(target, k, train_rows, val_rows):
    from sklearn.model_selection import StratifiedKFold
    _, Y, _, _ = load_development()
    y = Y[target].values
    inner = list(StratifiedKFold(5, shuffle=True, random_state=SEED).split(train_rows, y[train_rows]))
    out = {}
    for cand in candidate_names(target):
        name, fs = cand.split('|')
        oof = np.zeros(len(train_rows))
        for a, b in inner:
            oof[b] = fit_predict(target, name, fs, train_rows[a], train_rows[b])
        out[cand] = (oof, fit_predict(target, name, fs, train_rows, val_rows))
    return target, k, train_rows, val_rows, out


def outer_splits(target):
    from sklearn.model_selection import RepeatedStratifiedKFold
    X, Y, _, _ = load_development()
    cv = RepeatedStratifiedKFold(n_splits=OUTER_SPLITS, n_repeats=OUTER_REPEATS, random_state=SEED)
    return list(cv.split(X, Y[target].values))


def run_search(n_jobs=-1, verbose=5):
    """Nested search over every candidate for every target. Returns raw inner-OOF / outer predictions."""
    from joblib import Parallel, delayed
    X, Y, cfg, _ = load_development()
    jobs = [(t, k, tr, va) for t in cfg['target_columns'] for k, (tr, va) in enumerate(outer_splits(t))]
    return Parallel(n_jobs=n_jobs, verbose=verbose)(delayed(_outer_task)(*j) for j in jobs)


# ----------------------------------------------------------------------------- calibration & thresholds
def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def fit_platt(scores, y):
    """Platt scaling on the logit of the model probability. Returns (a, b) or None if the fit is not increasing."""
    from sklearn.linear_model import LogisticRegression
    lr = LogisticRegression(C=1e6).fit(logit(scores)[:, None], y)
    a, b = float(lr.coef_[0, 0]), float(lr.intercept_[0])
    return (a, b) if a > 0 else None


def apply_platt(scores, ab):
    a, b = ab
    return 1 / (1 + np.exp(-(a * logit(scores) + b)))


def threshold_curve(p, y):
    """Sensitivity, specificity and F1 of the rule `p >= h` for every distinct score h (descending)."""
    order = np.argsort(-p, kind='mergesort')
    ps, ys = p[order], y[order]
    last = np.r_[ps[1:] != ps[:-1], True]
    tp, fp = np.cumsum(ys)[last], np.cumsum(1 - ys)[last]
    pos, neg = ys.sum(), len(ys) - ys.sum()
    return ps[last], tp / pos, 1 - fp / neg, 2 * tp / (2 * tp + fp + (pos - tp))


def operating_threshold(target, p, y):
    """Pre-declared rule. Cath: highest threshold keeping sensitivity >= 0.90. Vessels: Youden's J."""
    ths, sens, spec, _ = threshold_curve(p, y)
    if target == 'Cath':
        return float(ths[sens >= CATH_MIN_SENSITIVITY].max())
    return float(ths[int(np.argmax(sens + spec - 1))])


def f1_threshold(p, y):
    ths, _, _, f1 = threshold_curve(p, y)
    return float(ths[int(np.argmax(f1))])


THRESHOLD_RULES = {
    'Cath': f'highest threshold with development sensitivity >= {CATH_MIN_SENSITIVITY:.2f} (rule-out safety)',
    'LAD': "Youden's J (maximise sensitivity + specificity)",
    'LCX': "Youden's J (maximise sensitivity + specificity)",
    'RCA': "Youden's J (maximise sensitivity + specificity)",
}


# ----------------------------------------------------------------------------- procedures & evaluation
PROCEDURES = {
    'S0_shipped@0.50': 'Frozen v1 champion, uncalibrated, threshold 0.50 (what Notebook 6 evaluated)',
    'S0c_champion+Platt': 'Frozen v1 champion + Platt calibration + pre-declared threshold rule (v1.1)',
    'S1_best_single': 'Candidate with the best inner-CV AUC',
    'S2_top3_mean': 'Mean of the top-3 calibrated candidates (inner AUC), re-calibrated',
    'S3_top5_mean': 'Mean of the top-5 calibrated candidates, re-calibrated',
    'S4_all_mean': 'Mean of all calibrated candidates, re-calibrated',
    'S5_stacking': 'L2 logistic meta-learner on calibrated candidate logits',
    'S6_greedy_ensemble': 'Greedy forward ensemble selection with replacement (inner AUC)',
    'S7_fixed_trio': 'Pre-declared mean of LR(C=0.1) + RF + shallow XGBoost, re-calibrated',
    'S8_champion+DF': 'Frozen champion configuration + Diamond-Forrester pre-test feature + Platt',
}


def fast_auc(y, s):
    r = rankdata(s)
    n1 = y.sum()
    n0 = len(y) - n1
    return (r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)


def evaluate_procedures(raw):
    """Apply every procedure inside each outer fold. Returns per-fold records and pooled out-of-fold predictions."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import StratifiedKFold, cross_val_predict
    _, Y, _, _ = load_development()
    records, pooled = [], {}
    for target, k, tr, va, out in raw:
        y = Y[target].values
        ytr, yva = y[tr], y[va]
        cal = {}
        for c, (oof, pv) in out.items():
            ab = fit_platt(oof, ytr)
            if ab is not None:
                cal[c] = (apply_platt(oof, ab), apply_platt(pv, ab))
        rank = sorted(cal, key=lambda c: fast_auc(ytr, out[c][0]), reverse=True)

        def mean_of(members):
            oo = np.mean([cal[m][0] for m in members], axis=0)
            vv = np.mean([cal[m][1] for m in members], axis=0)
            ab = fit_platt(oo, ytr)
            return (apply_platt(oo, ab), apply_platt(vv, ab)) if ab else (oo, vv)

        P = {'S0_shipped@0.50': (None, out['champ|base'][1]), 'S0c_champion+Platt': cal['champ|base'],
             'S1_best_single': cal[rank[0]], 'S2_top3_mean': mean_of(rank[:3]), 'S3_top5_mean': mean_of(rank[:5]),
             'S4_all_mean': mean_of(rank)}
        Xo = np.column_stack([logit(cal[m][0]) for m in rank])
        Xv = np.column_stack([logit(cal[m][1]) for m in rank])
        meta = LogisticRegression(C=0.1, max_iter=5000)
        meta_oof = cross_val_predict(meta, Xo, ytr, cv=StratifiedKFold(5, shuffle=True, random_state=SEED), method='predict_proba')[:, 1]
        P['S5_stacking'] = (meta_oof, meta.fit(Xo, ytr).predict_proba(Xv)[:, 1])
        bag, best_bag, best = [], None, -1.0
        for _ in range(20):
            nxt = max(rank, key=lambda m: fast_auc(ytr, np.mean([cal[x][0] for x in bag + [m]], axis=0)))
            bag.append(nxt)
            score = fast_auc(ytr, np.mean([cal[x][0] for x in bag], axis=0))
            if score > best:
                best, best_bag = score, list(bag)
        P['S6_greedy_ensemble'] = mean_of(best_bag)
        P['S7_fixed_trio'] = mean_of(['lr_l2_C0.1|base', 'rf|base', 'xgb_shallow|base'])
        P['S8_champion+DF'] = cal['champ|df']
        for proc, (p_inner, p_val) in P.items():
            thr = 0.5 if p_inner is None else operating_threshold(target, p_inner, ytr)
            thr_f1 = 0.5 if p_inner is None else f1_threshold(p_inner, ytr)
            records.append({'target': target, 'fold': k, 'repeat': k // OUTER_SPLITS, 'procedure': proc,
                            'auc': fast_auc(yva, p_val), 'brier': float(np.mean((p_val - yva) ** 2)), 'threshold': thr})
            pooled[(target, k, proc)] = (va, p_val, (p_val >= thr).astype(int), (p_val >= thr_f1).astype(int))
        pooled[(target, k, 'selected_single')] = rank[0]
        for c, (_, pv) in out.items():
            pooled[(target, k, 'candidate', c)] = fast_auc(yva, pv)
    return pd.DataFrame(records), pooled


def corrected_paired_test(diff, test_train_ratio=0.25):
    """Nadeau & Bengio (2003) corrected resampled t-test for repeated k-fold CV differences."""
    diff = np.asarray(diff)
    se = np.sqrt((1 / len(diff) + test_train_ratio) * diff.var(ddof=1))
    t = diff.mean() / se if se > 0 else 0.0
    return diff.mean(), se, 2 * stats.t.sf(abs(t), len(diff) - 1)


def calibration_slope(y, p):
    from sklearn.linear_model import LogisticRegression
    return float(LogisticRegression(C=1e9).fit(logit(p)[:, None], y).coef_[0, 0])


def summarise(fold_df, pooled):
    """Per target x procedure: paired discrimination tests, probability quality and pooled operating-point metrics."""
    from sklearn.metrics import average_precision_score, matthews_corrcoef
    _, Y, cfg, _ = load_development()
    rows = []
    for target in cfg['target_columns']:
        y = Y[target].values
        f = fold_df[fold_df.target == target]
        base = f[f.procedure == 'S0_shipped@0.50'].sort_values('fold')
        base_cal = f[f.procedure == 'S0c_champion+Platt'].sort_values('fold')
        for proc in PROCEDURES:
            d = f[f.procedure == proc].sort_values('fold')
            d_auc, se_auc, p_auc = corrected_paired_test(d.auc.values - base.auc.values)
            d_bri, _, p_bri = corrected_paired_test(d.brier.values - base_cal.brier.values)
            reps = []
            for r in range(OUTER_REPEATS):
                prob, pred, pred_f1 = np.zeros(len(y)), np.zeros(len(y), int), np.zeros(len(y), int)
                for k in range(r * OUTER_SPLITS, (r + 1) * OUTER_SPLITS):
                    va, pv, q, qf = pooled[(target, k, proc)]
                    prob[va], pred[va], pred_f1[va] = pv, q, qf
                tp, fp = (pred & y).sum(), (pred & (1 - y)).sum()
                fn, tn = ((1 - pred) & y).sum(), ((1 - pred) & (1 - y)).sum()
                reps.append({'AP': average_precision_score(y, prob), 'calibration_slope': calibration_slope(y, prob),
                             'sensitivity': tp / (tp + fn), 'specificity': tn / (tn + fp),
                             'PPV': tp / max(tp + fp, 1), 'NPV': tn / max(tn + fn, 1),
                             'balanced_accuracy': (tp / (tp + fn) + tn / (tn + fp)) / 2, 'MCC': matthews_corrcoef(y, pred),
                             'F1': 2 * tp / (2 * tp + fp + fn), 'accuracy': (tp + tn) / len(y),
                             'F1_at_F1_rule': 2 * (pred_f1 & y).sum() / (2 * (pred_f1 & y).sum() + (pred_f1 & (1 - y)).sum() + ((1 - pred_f1) & y).sum())})
            rows.append({'target': target, 'procedure': proc, 'ROC_AUC': d.auc.mean(), 'dAUC_vs_shipped': d_auc, 'SE_dAUC': se_auc,
                         'p_dAUC': p_auc, 'folds_better': int((d.auc.values > base.auc.values + 1e-12).sum()),
                         'Brier': d.brier.mean(), 'dBrier_vs_v1.1': d_bri, 'p_dBrier': p_bri,
                         'mean_threshold': d.threshold.mean(), 'sd_threshold': d.threshold.std(),
                         **pd.DataFrame(reps).mean().to_dict()})
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------- operating points (Notebook 8)
OPERATING_GRID = np.round(np.arange(0.01, 1.0, 0.01), 2)
PRESET_RULES = {
    'high_sensitivity': ('Catch more', 'highest threshold with mean development sensitivity >= 0.90'),
    'balanced': ('Balanced', "Youden's J on the mean development curve (maximise sensitivity + specificity)"),
    'high_specificity': ('Fewer false alarms', 'lowest threshold with mean development specificity >= 0.90'),
}


def _nested_champion_fold(target, k, tr, va):
    """The v1.1 procedure (S0c) on one outer fold: champion fitted on tr, Platt fitted on its inner OOF, applied to va."""
    from sklearn.model_selection import StratifiedKFold
    _, Y, _, _ = load_development()
    y = Y[target].values
    oof = np.zeros(len(tr))
    for a, b in StratifiedKFold(5, shuffle=True, random_state=SEED).split(tr, y[tr]):
        oof[b] = fit_predict(target, 'champ', 'base', tr[a], tr[b])
    ab = fit_platt(oof, y[tr])
    return target, k, va, apply_platt(fit_predict(target, 'champ', 'base', tr, va), ab)


def nested_calibrated_champion(n_jobs=-1):
    """Calibrated v1.1 out-of-fold predictions for every development patient: {target: array (repeats x 242)}.
    Same outer/inner splits as run_search, so fold AUCs reproduce procedure S0c exactly."""
    from joblib import Parallel, delayed
    X, _, cfg, _ = load_development()
    jobs = [(t, k, tr, va) for t in cfg['target_columns'] for k, (tr, va) in enumerate(outer_splits(t))]
    res = Parallel(n_jobs=n_jobs)(delayed(_nested_champion_fold)(*j) for j in jobs)
    out = {t: np.zeros((OUTER_REPEATS, len(X))) for t in cfg['target_columns']}
    for t, k, va, p in res:
        out[t][k // OUTER_SPLITS, va] = p
    return out


def rule_metrics(p, y, h):
    """Metrics of the rule `p >= h` for one set of predictions."""
    q = p >= h
    tp, fp = int((q & (y == 1)).sum()), int((q & (y == 0)).sum())
    fn, tn = int(((~q) & (y == 1)).sum()), int(((~q) & (y == 0)).sum())
    return {'sensitivity': tp / (tp + fn), 'specificity': tn / (tn + fp),
            'PPV': tp / (tp + fp) if tp + fp else np.nan, 'NPV': tn / (tn + fn) if tn + fn else np.nan,
            'flagged': (tp + fp) / len(y)}


def mean_rule_metrics(P, y, h):
    """Mean over repeats of rule_metrics, plus the min-max range of sensitivity and specificity across repeats."""
    reps = pd.DataFrame([rule_metrics(p, y, h) for p in P])
    out = reps.mean().to_dict()
    for m in ('sensitivity', 'specificity'):
        out[f'{m}_range'] = [float(reps[m].min()), float(reps[m].max())]
    return out


def operating_curve(P, y):
    """Mean development metrics over OPERATING_GRID (thresholds on the calibrated probability scale)."""
    return pd.DataFrame([{'threshold': float(h), **mean_rule_metrics(P, y, h)} for h in OPERATING_GRID])


def operating_presets(curve):
    """Apply the pre-declared PRESET_RULES to a mean development curve. A preset is None when no threshold satisfies it."""
    out = {}
    hs = curve[curve.sensitivity >= 0.90]
    out['high_sensitivity'] = float(hs.threshold.max()) if len(hs) else None
    out['balanced'] = float(curve.threshold[int(np.argmax(curve.sensitivity + curve.specificity - 1))])
    sp = curve[curve.specificity >= 0.90]
    out['high_specificity'] = float(sp.threshold.min()) if len(sp) else None
    return out


# ----------------------------------------------------------------------------- final v1.1 post-processing
def frozen_config_oof(target, n_repeats=OUTER_REPEATS):
    """Repeated 5-fold out-of-fold probabilities of the frozen champion configuration on all 242 patients."""
    from sklearn.model_selection import RepeatedStratifiedKFold
    X, Y, _, _ = load_development()
    y = Y[target].values
    rows, scores, labels = np.arange(len(y)), [], []
    for tr, te in RepeatedStratifiedKFold(n_splits=5, n_repeats=n_repeats, random_state=SEED).split(X, y):
        scores.append(fit_predict(target, 'champ', 'base', rows[tr], rows[te]))
        labels.append(y[te])
    return np.concatenate(scores), np.concatenate(labels)
