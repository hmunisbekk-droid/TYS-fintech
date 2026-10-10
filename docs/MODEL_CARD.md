# Model card — Daromad risk score

The live model card with every number read from the evaluation JSON files is the **Model card** page of the app
(`/model`). This file records what the model is and is not.

**Model.** XGBoost binary classifier, 300 trees, depth 3, learning rate 0.05, min_child_weight 5, L2 = 2, with
monotone constraints on 14 of 18 features (risk rises with volatility, debt service, requested payment, ПДН,
zero-revenue months, customer concentration; falls with income level, trend, worst-month ratio, cash buffer,
distinct payers). Exported as a JSON tree dump and evaluated in the browser (`apps/web/lib/risk.ts`), so the
prototype needs no server. Explanations: one-at-a-time attributions against the portfolio median (SHAP on the
server in production).

**Intended use.** Advisory ranking signal next to the deterministic ПДН rule engine; never the sole basis of a
decision. The loan officer decides; overrides are logged with a reason.

**Training data.** The declared synthetic population (`synth/`, seed 42, 2,000 borrowers, 10.5% default rate).
Ground-truth categories were used for training features; the browser uses the rule-based categoriser.

**Evaluation.** Synthetic holdout (n = 500): ROC-AUC 0.965, PR-AUC 0.76, Brier 0.042; logistic baseline 0.963;
ПДН ratio alone 0.948 — i.e. on synthetic data most of the signal is the affordability ratio by construction.
Real-data methodology check (Berka / PKDD'99, 443 loans, 5-fold out-of-fold, same 18 features):
ROC-AUC 0.902 boosted, 0.895 logistic, 0.735 ratio alone.

**Limitations.** Synthetic-to-real gap; no fairness assessment possible without real data (planned in the pilot:
by region, gender from the certificate is **not** a feature, activity type is not a feature); thresholds
(0.15 / 0.40 for the risk bands) are placeholders to be set with the bank's risk appetite.

**Retraining plan.** Pilot month one in shadow mode collects features + outcomes inside the perimeter; retrain on
the bank's 12-month default history; champion/challenger against the synthetic model; recalibrate bands.
