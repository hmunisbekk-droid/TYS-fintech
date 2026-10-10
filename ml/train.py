"""Train the Daromad risk model on the synthetic population and export it for the browser engine.

    python -m ml.train --data data/synthetic --out ml/artifacts

Artifacts
  model.json          XGBoost trees (dump) + base margin + feature names, consumed by apps/web/lib/risk.ts
  feature_stats.json  per-feature median/p5/p95 for one-at-a-time attribution and sanity checks
  metrics.json        holdout metrics, calibration bins, feature importance, baseline comparison
  fixture.json        5 borrowers' inputs + expected features/scores for the TypeScript parity test
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time
from datetime import date
from pathlib import Path

import numpy as np
import xgboost as xgb
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.preprocessing import StandardScaler

from .features import FEATURE_NAMES, MONOTONE, compute_features, feature_vector


def last_12_months(application_date: str) -> list[str]:
    app = date.fromisoformat(application_date).replace(day=1)
    months = []
    y, m = app.year, app.month
    for _ in range(12):
        m -= 1
        if m == 0:
            m, y = 12, y - 1
        months.append(f"{y:04d}-{m:02d}")
    return sorted(months)


def load(data: Path):
    borrowers = [json.loads(l) for l in open(data / "borrowers.jsonl", encoding="utf-8")]
    X, y, ids, feats_all = [], [], [], []
    for b in borrowers:
        txs = json.load(open(data / "transactions" / f"{b['borrower_id']}.json", encoding="utf-8"))
        months = last_12_months(b["application_date"])
        txs12 = [t for t in txs if months[0] <= t["date"][:7] <= months[-1]]
        f = compute_features(txs12, b["requested_amount"], b["requested_term_months"], b["loans"], months)
        X.append(feature_vector(f))
        y.append(b["default_12m"])
        ids.append(b["borrower_id"])
        feats_all.append(f)
    return borrowers, np.array(X), np.array(y), ids, feats_all


def calibration_bins(p, y, n_bins=10):
    bins = []
    edges = np.linspace(0, 1, n_bins + 1)
    for i in range(n_bins):
        m = (p >= edges[i]) & (p < edges[i + 1] if i < n_bins - 1 else p <= edges[i + 1])
        if m.sum() == 0:
            continue
        bins.append(dict(lo=float(edges[i]), hi=float(edges[i + 1]), n=int(m.sum()),
                         mean_pred=float(p[m].mean()), frac_pos=float(y[m].mean())))
    return bins


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/synthetic")
    ap.add_argument("--out", default="ml/artifacts")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    borrowers, X, y, ids, feats_all = load(Path(args.data))
    n = len(y)
    rng = np.random.default_rng(args.seed)
    idx = rng.permutation(n)
    n_test = int(0.25 * n)
    test, train = idx[:n_test], idx[n_test:]
    print(f"loaded {n} borrowers, default rate {y.mean():.3f}; train {len(train)} test {len(test)}")

    mono = "(" + ",".join(str(MONOTONE[f]) for f in FEATURE_NAMES) + ")"
    model = xgb.XGBClassifier(
        n_estimators=300, max_depth=3, learning_rate=0.05, subsample=0.9, colsample_bytree=0.9,
        min_child_weight=5, reg_lambda=2.0, monotone_constraints=mono, base_score=0.5,
        objective="binary:logistic", eval_metric="logloss", random_state=args.seed, n_jobs=4,
    )
    model.fit(X[train], y[train], eval_set=[(X[test], y[test])], verbose=False)
    p = model.predict_proba(X[test])[:, 1]
    p_train = model.predict_proba(X[train])[:, 1]

    # baseline: logistic regression on standardised features
    sc = StandardScaler().fit(X[train])
    lr = LogisticRegression(max_iter=2000, C=1.0).fit(sc.transform(X[train]), y[train])
    p_lr = lr.predict_proba(sc.transform(X[test]))[:, 1]

    # the regulatory ratio alone, as the "no model" comparator
    pdn_i = FEATURE_NAMES.index("pdn_total")
    auc_pdn = roc_auc_score(y[test], X[test][:, pdn_i])

    metrics = dict(
        n_train=int(len(train)), n_test=int(len(test)), default_rate_train=float(y[train].mean()),
        default_rate_test=float(y[test].mean()),
        xgb=dict(auc=float(roc_auc_score(y[test], p)), pr_auc=float(average_precision_score(y[test], p)),
                 brier=float(brier_score_loss(y[test], p)), auc_train=float(roc_auc_score(y[train], p_train)),
                 calibration=calibration_bins(p, y[test])),
        logreg_baseline=dict(auc=float(roc_auc_score(y[test], p_lr)), pr_auc=float(average_precision_score(y[test], p_lr))),
        pdn_only_auc=float(auc_pdn),
        feature_importance=sorted(
            [dict(feature=f, gain=float(g)) for f, g in zip(FEATURE_NAMES, model.feature_importances_)],
            key=lambda d: -d["gain"]),
        hyperparameters=dict(n_estimators=300, max_depth=3, learning_rate=0.05, min_child_weight=5, reg_lambda=2.0,
                             monotone_constraints={f: MONOTONE[f] for f in FEATURE_NAMES}),
        training_data="synthetic (data/synthetic, see summary.json); categories are ground-truth labels",
        caveat="Trained and evaluated on a declared synthetic population. AUC on synthetic data measures that the "
               "pipeline learns the declared affordability structure, not real-world performance. Retrain on bank "
               "history inside the perimeter during the pilot.",
        trained_at=time.strftime("%Y-%m-%d %H:%M:%S"),
    )
    # decision thresholds at a few operating points
    for thr in (0.15, 0.25, 0.4):
        pred = (p >= thr).astype(int)
        tp = int(((pred == 1) & (y[test] == 1)).sum()); fp = int(((pred == 1) & (y[test] == 0)).sum())
        fn = int(((pred == 0) & (y[test] == 1)).sum())
        metrics.setdefault("operating_points", []).append(dict(
            threshold=thr, precision=tp / max(tp + fp, 1), recall=tp / max(tp + fn, 1),
            flagged_share=float(pred.mean())))
    json.dump(metrics, open(out / "metrics.json", "w"), indent=1)

    # export trees
    booster = model.get_booster()
    trees = [json.loads(t) for t in booster.get_dump(dump_format="json")]
    cfg = json.loads(booster.save_config())
    bs_raw = str(cfg["learner"]["learner_model_param"]["base_score"]).strip("[]")
    base_score = float(bs_raw)
    base_margin = math.log(base_score / (1 - base_score))
    json.dump(dict(feature_names=FEATURE_NAMES, base_margin=base_margin, n_trees=len(trees), trees=trees,
                   objective="binary:logistic", version=metrics["trained_at"]),
              open(out / "model.json", "w"))

    stats = {f: dict(median=float(np.median(X[:, i])), p5=float(np.percentile(X[:, i], 5)),
                     p95=float(np.percentile(X[:, i], 95)), mean=float(X[:, i].mean()))
             for i, f in enumerate(FEATURE_NAMES)}
    json.dump(stats, open(out / "feature_stats.json", "w"), indent=1)

    # parity fixture for the TypeScript engine (5 borrowers, 12 months of transactions)
    fx = []
    data = Path(args.data)
    for i in sorted(rng.choice(n, 5, replace=False)):
        b = borrowers[i]
        txs = json.load(open(data / "transactions" / f"{b['borrower_id']}.json", encoding="utf-8"))
        months = last_12_months(b["application_date"])
        txs12 = [t for t in txs if months[0] <= t["date"][:7] <= months[-1]]
        f = compute_features(txs12, b["requested_amount"], b["requested_term_months"], b["loans"], months)
        prob = float(model.predict_proba(np.array([feature_vector(f)]))[0, 1])
        fx.append(dict(borrower_id=b["borrower_id"], application_date=b["application_date"], months=months,
                       requested_amount=b["requested_amount"], requested_term_months=b["requested_term_months"],
                       loans=b["loans"], transactions=txs12, expected_features=f, expected_probability=prob))
    json.dump(fx, open(out / "fixture.json", "w"))
    print(json.dumps({k: metrics[k] for k in ("xgb", "logreg_baseline", "pdn_only_auc")}, indent=1)[:1500])
    print("top features:", [d["feature"] for d in metrics["feature_importance"][:6]])
    print(f"done in {time.time()-t0:.1f}s; trees={len(trees)} base_margin={base_margin:.4f}")


if __name__ == "__main__":
    main()
