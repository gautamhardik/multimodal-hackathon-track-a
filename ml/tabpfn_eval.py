"""Development-only TabPFN v2 comparison on the same 25 outer folds as Notebook 7. Holdout never loaded.
Pre-declared candidates (no tuning): T1 TabPFN on base features, T2 TabPFN + Diamond-Forrester, T3 mean(champion, T2).
Run from the project root: python -m ml.tabpfn_eval   (needs `pip install tabpfn`; v2 weights download without a login)."""
import time
from pathlib import Path

import pandas as pd
from joblib import Parallel, delayed

from ml import dev_search as ds

OUT = Path(__file__).resolve().parents[1] / 'artifacts' / 'dev_search' / 'tabpfn_v2_fold_results.csv'


def task(target, k, tr, va):
    import torch, warnings
    warnings.filterwarnings('ignore')
    torch.set_num_threads(2)
    from tabpfn import TabPFNClassifier
    from tabpfn.constants import ModelVersion
    X, Y, _, _ = ds.load_development()
    y = Y[target].values
    preds = {}
    for fs in ('base', 'df'):
        pre = ds.build_preprocessor('Config_A_Ordinal', fs)
        m = TabPFNClassifier.create_default_for_version(ModelVersion.V2, device='cpu', random_state=ds.SEED)
        m.fit(pre.fit_transform(X.iloc[tr]), y[tr])
        preds[fs] = m.predict_proba(pre.transform(X.iloc[va]))[:, 1]
    champ = ds.fit_predict(target, 'champ', 'base', tr, va)
    yv = y[va]
    return [
        {'target': target, 'fold': k, 'procedure': 'champion (v1/v1.1)', 'auc': ds.fast_auc(yv, champ)},
        {'target': target, 'fold': k, 'procedure': 'T1_tabpfn_base', 'auc': ds.fast_auc(yv, preds['base'])},
        {'target': target, 'fold': k, 'procedure': 'T2_tabpfn_df', 'auc': ds.fast_auc(yv, preds['df'])},
        {'target': target, 'fold': k, 'procedure': 'T3_mean_champ_tabpfn', 'auc': ds.fast_auc(yv, (champ + preds['df']) / 2)},
    ]


if __name__ == '__main__':
    t0 = time.time()
    X, Y, cfg, _ = ds.load_development()
    jobs = [(t, k, tr, va) for t in cfg['target_columns'] for k, (tr, va) in enumerate(ds.outer_splits(t))]
    res = Parallel(n_jobs=10, verbose=5)(delayed(task)(*j) for j in jobs)
    pd.DataFrame([r for rs in res for r in rs]).to_csv(OUT, index=False)
    print('done', round(time.time() - t0), 's')
