"""Feature specification shared by the Python trainer and the browser engine (apps/web/lib/features.ts).

The two implementations must agree; `ml/export_fixture.py` writes a fixture that the TypeScript
unit test replays to assert parity.

Input: transactions of the 12 complete months before the application month, each with
  date (YYYY-MM-DD), description, debit, credit, balance, category (see CATEGORY_GROUPS)
plus the requested loan (amount, term) and the list of existing loans (monthly_payment, term, dpd).

All money features are ratios to mean monthly regulatory income so the model is scale-aware
only through log_income.
"""
from __future__ import annotations

import math
from collections import defaultdict

FEATURE_NAMES = [
    "log_income",            # ln(mean monthly regulatory income, UZS)
    "biz_share",             # business inflow / regulatory income
    "income_cv",             # std/mean of monthly regulatory income
    "income_trend",          # OLS slope over months × 12 / mean  (relative yearly trend)
    "min_month_ratio",       # min monthly regulatory income / mean
    "zero_months",           # months with business inflow < 10% of its mean
    "nonbiz_share",          # (salary+pension+relative transfers) / regulatory income
    "ambiguous_share",       # (cash deposits + self-transfers in + refunds) / all credits
    "top5_payer_share",      # share of customer-P2P inflow from the 5 largest counterparties
    "payers_per_month",      # distinct customer-P2P counterparties per month
    "dsr_detected",          # detected loan repayments per month / regulatory income
    "balance_floor_ratio",   # 10th percentile of running balance / regulatory income
    "balance_end_ratio",     # closing balance / regulatory income
    "atm_cash_share",        # ATM withdrawals / all debits
    "supplier_share",        # supplier payments / business inflow
    "new_pmt_ratio",         # annuity payment of the requested loan / regulatory income
    "pdn_total",             # (existing payments + new payment) / regulatory income  (regulatory DBR proxy)
    "months_observed",       # number of months with any transaction (≤ 12)
]

# monotone constraint per feature: +1 risk increases with feature, -1 decreases, 0 free
MONOTONE = {
    "log_income": -1, "biz_share": 0, "income_cv": 1, "income_trend": -1, "min_month_ratio": -1,
    "zero_months": 1, "nonbiz_share": 0, "ambiguous_share": 1, "top5_payer_share": 1, "payers_per_month": -1,
    "dsr_detected": 1, "balance_floor_ratio": -1, "balance_end_ratio": -1, "atm_cash_share": 0,
    "supplier_share": 0, "new_pmt_ratio": 1, "pdn_total": 1, "months_observed": 0,
}

BUSINESS_IN = {"pos_sale", "customer_p2p", "marketplace_payout"}
NONBIZ_IN = {"salary", "pension", "relative_transfer"}
NOT_INCOME_IN = {"loan_disbursement", "self_transfer_in", "refund", "cash_deposit"}
AMBIGUOUS_IN = {"cash_deposit", "self_transfer_in", "refund"}

ASSUMED_NEW_LOAN_RATE = 0.28  # annual, used only for the affordability features (product rate replaces it in the app)


def annuity(amount: float, annual_rate: float, term: int) -> float:
    r = annual_rate / 12
    return amount / term if r == 0 else amount * r / (1 - (1 + r) ** (-term))


def _slope(ys: list[float]) -> float:
    n = len(ys)
    if n < 2:
        return 0.0
    xs = list(range(n))
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = sum((x - mx) ** 2 for x in xs)
    return num / den if den else 0.0


def _p10(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * 0.10
    f = math.floor(k)
    c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


def compute_features(txs: list[dict], requested_amount: float, requested_term: int,
                     existing_loans: list[dict], months: list[str] | None = None) -> dict:
    """txs must carry a 'category'. months: ordered list of YYYY-MM keys to evaluate (default: from data)."""
    by_month_reg: dict[str, float] = defaultdict(float)
    by_month_biz: dict[str, float] = defaultdict(float)
    by_month_payers: dict[str, set] = defaultdict(set)
    by_month_loanpay: dict[str, float] = defaultdict(float)
    credits = debits = 0.0
    nonbiz = ambiguous = atm = supplier = 0.0
    payer_amounts: dict[str, float] = defaultdict(float)
    balances: list[float] = []
    seen_months = set()
    for t in txs:
        m = t["date"][:7]
        seen_months.add(m)
        c, d, cat = float(t["credit"] or 0), float(t["debit"] or 0), t["category"]
        balances.append(float(t["balance"]))
        if c > 0:
            credits += c
            if cat in NOT_INCOME_IN:
                if cat in AMBIGUOUS_IN:
                    ambiguous += c
            else:
                by_month_reg[m] += c
                if cat in BUSINESS_IN:
                    by_month_biz[m] += c
                if cat in NONBIZ_IN:
                    nonbiz += c
                if cat == "customer_p2p":
                    key = t["description"][-9:]  # masked card tail
                    by_month_payers[m].add(key)
                    payer_amounts[key] += c
        if d > 0:
            debits += d
            if cat == "loan_repayment":
                by_month_loanpay[m] += d
            elif cat == "atm_cash":
                atm += d
            elif cat == "supplier":
                supplier += d
    if months is None:
        months = sorted(seen_months)[-12:]
    n = max(len(months), 1)
    reg = [by_month_reg.get(m, 0.0) for m in months]
    biz = [by_month_biz.get(m, 0.0) for m in months]
    reg_mean = sum(reg) / n
    biz_mean = sum(biz) / n
    safe = max(reg_mean, 1.0)
    reg_std = math.sqrt(sum((x - reg_mean) ** 2 for x in reg) / n)
    total_p2p = sum(payer_amounts.values())
    top5 = sum(sorted(payer_amounts.values(), reverse=True)[:5])
    new_pmt = annuity(requested_amount, ASSUMED_NEW_LOAN_RATE, requested_term)
    existing_pmt = 0.0
    for l in existing_loans:
        pm = float(l.get("monthly_payment", 0))
        term = int(l.get("term_months", 12))
        if term > 36:
            pm = pm * term / 36  # clause 4^1 normalisation to 36 months
        existing_pmt += pm
    feats = {
        "log_income": math.log(max(reg_mean, 1e5)),
        "biz_share": biz_mean / safe,
        "income_cv": reg_std / safe,
        "income_trend": _slope(reg) * 12 / safe,
        "min_month_ratio": min(reg) / safe if reg else 0.0,
        "zero_months": float(sum(1 for x in biz if x < 0.1 * max(biz_mean, 1.0))),
        "nonbiz_share": nonbiz / max(sum(reg), 1.0),
        "ambiguous_share": ambiguous / max(credits, 1.0),
        "top5_payer_share": top5 / total_p2p if total_p2p > 0 else 0.0,
        "payers_per_month": sum(len(by_month_payers.get(m, set())) for m in months) / n,
        "dsr_detected": (sum(by_month_loanpay.get(m, 0.0) for m in months) / n) / safe,
        "balance_floor_ratio": _p10(balances) / safe,
        "balance_end_ratio": (balances[-1] if balances else 0.0) / safe,
        "atm_cash_share": atm / max(debits, 1.0),
        "supplier_share": supplier / max(sum(biz), 1.0),
        "new_pmt_ratio": new_pmt / safe,
        "pdn_total": (existing_pmt + new_pmt) / safe,
        "months_observed": float(len(seen_months & set(months))),
    }
    return feats


def feature_vector(feats: dict) -> list[float]:
    return [float(feats[k]) for k in FEATURE_NAMES]
