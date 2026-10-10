"""Validate the cash-flow → default methodology on REAL anonymised bank data (Berka, PKDD'99).

The Berka data set (Czech bank, 1993-1998) contains ~1.06M transactions and 682 loans with an outcome
status. For every loan we take the 12 months of account transactions before the loan date, map the
bank's operation codes to the Daromad category taxonomy, compute the SAME features as ml/features.py,
and measure how well they separate good loans (status A/C) from bad loans (B/D) with 5-fold CV.

This is a methodology check, not a production model: the Czech 1990s retail book is not the Uzbek
self-employed segment. It answers one jury question — "do cash-flow features computed from a plain
account statement carry default signal on real data?"

    python -m ml.berka_validate --data data/berka --out ml/artifacts/berka_metrics.json
Data: mirrored from https://github.com/jlacko/berka-dataset (original: PKDD'99 Discovery Challenge).
"""
from __future__ import annotations

import argparse
import json
import subprocess
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import StandardScaler

from .features import FEATURE_NAMES, MONOTONE, compute_features, feature_vector

FILES = ["trans.asc", "loan.asc", "account.asc"]
MIRROR = "https://raw.githubusercontent.com/jlacko/berka-dataset/master/"


def ensure_data(data: Path) -> None:
    data.mkdir(parents=True, exist_ok=True)
    for f in FILES:
        if not (data / f).exists() or (data / f).stat().st_size < 1000:
            print("downloading", f)
            subprocess.run(["curl", "-sS", "-L", "-o", str(data / f), MIRROR + f], check=True)


def parse_date(v) -> date:
    s = f"{int(v):06d}"
    yy, mm, dd = int(s[:2]), int(s[2:4]), int(s[4:6])
    return date(1900 + yy, mm, dd)


def map_category(row) -> str:
    """Map Berka (type, operation, k_symbol) to the Daromad taxonomy."""
    t, op, k = row["type"], row["operation"], row["k_symbol"]
    if t == "PRIJEM":  # credit
        if op == "VKLAD":
            return "cash_deposit"
        if op == "PREVOD Z UCTU":
            return "customer_p2p" if k != "DUCHOD" else "pension"
        if k == "DUCHOD":
            return "pension"
        if k == "UROK":
            return "refund"  # interest credited: not income from a counterparty
        return "customer_p2p"
    # debits (VYDAJ / VYBER)
    if k == "UVER":
        return "loan_repayment"
    if k in ("SIPO",):
        return "utilities"
    if k == "POJISTNE":
        return "personal_spend"
    if op == "VYBER KARTOU":
        return "personal_spend"
    if op == "VYBER":
        return "atm_cash"
    if op == "PREVOD NA UCET":
        return "p2p_out"
    return "personal_spend"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/berka")
    ap.add_argument("--out", default="ml/artifacts/berka_metrics.json")
    args = ap.parse_args()
    data = Path(args.data)
    ensure_data(data)

    trans = pd.read_csv(data / "trans.asc", sep=";", low_memory=False)
    loans = pd.read_csv(data / "loan.asc", sep=";")
    trans["d"] = trans["date"].map(parse_date)
    trans["k_symbol"] = trans["k_symbol"].fillna("").astype(str).str.strip()
    trans["operation"] = trans["operation"].fillna("").astype(str)
    trans["category"] = trans.apply(map_category, axis=1)
    trans = trans.sort_values(["account_id", "d", "trans_id"])
    by_acc = {a: g for a, g in trans.groupby("account_id")}

    X, y, kept = [], [], 0
    for _, ln in loans.iterrows():
        g = by_acc.get(ln["account_id"])
        if g is None:
            continue
        ld = parse_date(ln["date"])
        start = (ld.replace(day=1) - timedelta(days=1)).replace(day=1)
        for _ in range(11):
            start = (start - timedelta(days=1)).replace(day=1)
        win = g[(g["d"] >= start) & (g["d"] < ld.replace(day=1))]
        if len(win) < 10 or win["d"].min() > start + timedelta(days=62):
            continue  # need at least ~10 months of history
        txs = [dict(date=r.d.isoformat(), description=f"{r.operation} {int(r.account) if pd.notna(r.account) else ''}",
                    debit=float(r.amount) if r.type != "PRIJEM" else 0.0,
                    credit=float(r.amount) if r.type == "PRIJEM" else 0.0,
                    balance=float(r.balance), category=r.category) for r in win.itertuples()]
        months = sorted({t["date"][:7] for t in txs})[-12:]
        # Berka has no explicit list of existing loans; the detected repayments feature captures debt service
        f = compute_features(txs, float(ln["amount"]), int(ln["duration"]), [], months)
        X.append(feature_vector(f))
        y.append(1 if ln["status"] in ("B", "D") else 0)
        kept += 1
    X, y = np.array(X), np.array(y)
    print(f"loans used: {kept}/{len(loans)}, bad rate {y.mean():.3f}")

    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=7)
    mono = "(" + ",".join(str(MONOTONE[f]) for f in FEATURE_NAMES) + ")"
    p_xgb, p_lr, p_pdn = np.zeros(len(y)), np.zeros(len(y)), X[:, FEATURE_NAMES.index("pdn_total")]
    for tr, te in skf.split(X, y):
        m = xgb.XGBClassifier(n_estimators=150, max_depth=2, learning_rate=0.05, subsample=0.9, min_child_weight=5,
                              reg_lambda=5.0, monotone_constraints=mono, base_score=0.5, random_state=7, n_jobs=4)
        m.fit(X[tr], y[tr])
        p_xgb[te] = m.predict_proba(X[te])[:, 1]
        sc = StandardScaler().fit(X[tr])
        lr = LogisticRegression(max_iter=3000, C=0.5).fit(sc.transform(X[tr]), y[tr])
        p_lr[te] = lr.predict_proba(sc.transform(X[te]))[:, 1]
    res = dict(
        dataset="Berka / PKDD'99 Financial (Czech bank 1993-1998), mirrored from github.com/jlacko/berka-dataset",
        loans_used=int(kept), loans_total=int(len(loans)), bad_rate=float(y.mean()),
        features="same 18 features as ml/features.py, computed on the 12 months before each loan",
        cv="5-fold stratified, out-of-fold predictions",
        xgb_auc=float(roc_auc_score(y, p_xgb)), xgb_pr_auc=float(average_precision_score(y, p_xgb)),
        logreg_auc=float(roc_auc_score(y, p_lr)),
        pdn_only_auc=float(roc_auc_score(y, p_pdn)),
        caveat="Methodology check on real anonymised data from a different market and decade; not a performance claim "
               "for Uzbekistan.",
    )
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    json.dump(res, open(args.out, "w"), indent=1)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
