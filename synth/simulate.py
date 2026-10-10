"""Simulate borrowers, 24 months of account transactions, existing loans and outcome labels.

Output is fully synthetic: names are drawn from a small public first/last-name list,
card numbers are random and masked, counterparties are random or public business names.

The simulation is deliberately simple and fully declared:

  * monthly business revenue  R_m = base * season(m) * shock(m) * noise
  * revenue is split into channels: POS, customer P2P, marketplace payouts, cash (invisible)
  * expenses: suppliers (share of revenue), rent (fixed), utilities, telecom, personal, ATM cash
  * optional: side salary, transfers from relatives, own-card self-transfers, existing loans (annuity)
  * default label from a latent score of affordability (see label_default)
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, asdict, field
from datetime import date, timedelta

import numpy as np

from .archetypes import (ARCHETYPES, AVG_WAGE_UZS, BANKS, FIRST_NAMES, FUEL, LAST_NAMES, MARKETPLACES,
                         REGIONS, SUPERMARKETS, SUPPLIER_WORDS, TAXI_APPS, TELECOM, UTILITIES, WALLETS, gender_surname)

# Transaction categories – the same taxonomy is implemented in apps/web/lib/categorize.ts
CATEGORIES = [
    "pos_sale",            # business inflow via POS terminal
    "customer_p2p",        # business inflow via card-to-card from a customer
    "marketplace_payout",  # business inflow from a platform
    "salary",              # non-business inflow
    "pension",             # non-business inflow
    "relative_transfer",   # non-business inflow, recurring from 1-2 counterparties
    "loan_disbursement",   # not income
    "self_transfer_in",    # not income (own card)
    "refund",              # not income
    "cash_deposit",        # ambiguous inflow
    "supplier",            # business outflow
    "rent",
    "utilities",
    "telecom",
    "loan_repayment",      # debt service – feeds ПДН cross-check
    "personal_spend",
    "atm_cash",
    "self_transfer_out",
    "p2p_out",             # outgoing card-to-card to a person (family support, informal purchases)
]


@dataclass
class Loan:
    lender: str
    amount: float
    term_months: int
    annual_rate: float
    start: str                      # ISO date
    monthly_payment: float
    outstanding_principal: float    # at application date
    days_past_due: int = 0


@dataclass
class Borrower:
    borrower_id: str
    full_name: str
    region: str
    archetype: str
    activity_uz: str
    self_employed_since: str
    card_mask: str
    base_monthly_revenue: float
    application_date: str
    requested_amount: float
    requested_term_months: int
    loans: list[Loan] = field(default_factory=list)
    has_side_salary: bool = False
    side_salary: float = 0.0
    has_relative_transfers: bool = False
    shock_months: list[str] = field(default_factory=list)
    # ground-truth monthly series (keys = YYYY-MM)
    true_business_inflow: dict[str, float] = field(default_factory=dict)
    true_regulatory_income: dict[str, float] = field(default_factory=dict)
    # labels
    latent_risk: float = 0.0
    default_12m: int = 0


def _lognormal(rng: random.Random, mean: float, sigma: float) -> float:
    mu = math.log(mean) - sigma ** 2 / 2
    return math.exp(rng.gauss(mu, sigma))


def annuity_payment(amount: float, annual_rate: float, term_months: int) -> float:
    r = annual_rate / 12
    if r == 0:
        return amount / term_months
    return amount * r / (1 - (1 + r) ** (-term_months))


def outstanding_after(amount: float, annual_rate: float, term_months: int, paid_months: int) -> float:
    r = annual_rate / 12
    pmt = annuity_payment(amount, annual_rate, term_months)
    bal = amount
    for _ in range(min(paid_months, term_months)):
        bal = bal * (1 + r) - pmt
    return max(bal, 0.0)


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def make_borrower(rng: random.Random, idx: int, application_date: date) -> Borrower:
    a = rng.choice(ARCHETYPES)
    base = _lognormal(rng, a.income_mult * AVG_WAGE_UZS, a.income_sigma)
    first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
    last = gender_surname(first, last)
    card_mask = f"{rng.choice(['8600', '9860', '5614', '4073'])} **** **** {rng.randint(1000, 9999)}"
    since = application_date - timedelta(days=rng.randint(200, 2000))
    b = Borrower(
        borrower_id=f"B{idx:05d}",
        full_name=f"{first} {last}",
        region=rng.choice(REGIONS),
        archetype=a.key,
        activity_uz=a.activity_uz,
        self_employed_since=since.isoformat(),
        card_mask=card_mask,
        base_monthly_revenue=base,
        application_date=application_date.isoformat(),
        requested_amount=0.0,
        requested_term_months=rng.choice([12, 18, 24, 36, 48, 60]),
    )
    # requested amount scales with the business: 2x..12x monthly revenue, rounded to millions, capped at 100M
    raw_m = min(100, max(3, base * rng.uniform(2.0, 12.0) / 1_000_000))
    step = 5 if raw_m >= 20 else 1
    b.requested_amount = float(max(step, round(raw_m / step) * step) * 1_000_000)
    if rng.random() < a.side_salary_prob:
        b.has_side_salary = True
        b.side_salary = _lognormal(rng, 0.7 * AVG_WAGE_UZS, 0.25)
    b.has_relative_transfers = rng.random() < a.relative_transfer_prob
    # existing loans
    if rng.random() < a.existing_loan_prob:
        n = 1 if rng.random() < 0.75 else 2
        for _ in range(n):
            term = rng.choice([12, 18, 24, 36, 48, 60])
            amount = float(rng.choice([5, 8, 10, 15, 20, 30, 50]) * 1_000_000)
            rate = rng.choice([0.22, 0.24, 0.26, 0.28, 0.30, 0.34])
            started_ago = rng.randint(1, max(2, term - 2))
            start = application_date - timedelta(days=30 * started_ago)
            b.loans.append(Loan(
                lender=rng.choice(BANKS),
                amount=amount, term_months=term, annual_rate=rate, start=start.isoformat(),
                monthly_payment=round(annuity_payment(amount, rate, term), -2),
                outstanding_principal=round(outstanding_after(amount, rate, term, started_ago), -2),
                days_past_due=rng.choice([0, 0, 0, 0, 0, 0, 0, 0, 12, 45]),
            ))
    return b


def _season(a, month: int) -> float:
    # cosine seasonality peaking at a.season_peak_month
    return 1.0 + a.season_amp * math.cos(2 * math.pi * (month - a.season_peak_month) / 12)


def simulate_transactions(rng: random.Random, b: Borrower, months: int = 24) -> list[dict]:
    """Return a list of transaction dicts covering `months` months ending at application date."""
    from .archetypes import ARCHETYPE_BY_KEY
    a = ARCHETYPE_BY_KEY[b.archetype]
    app_date = date.fromisoformat(b.application_date)
    # statements cover `months` complete calendar months ending the month before the application
    app = app_date.replace(day=1)
    start = (app - timedelta(days=1)).replace(day=1)
    for _ in range(months - 1):
        start = (start - timedelta(days=1)).replace(day=1)
    # relatives / customers counterparties
    relatives = [f"{rng.choice(['8600', '9860'])} **** {rng.randint(1000, 9999)}" for _ in range(rng.randint(1, 2))]
    suppliers = [f"{rng.choice(SUPPLIER_WORDS)} {rng.choice(SUPPLIER_WORDS)} MCHJ" for _ in range(rng.randint(1, 3))]
    own_other_card = f"{rng.choice(['8600', '9860'])} **** {rng.randint(1000, 9999)}"
    utilities = rng.sample(UTILITIES, k=2)
    telecom = rng.choice(TELECOM)
    rent = a.rent_share * b.base_monthly_revenue
    buffer_mult = rng.uniform(0.15, 1.2)  # how much of a month's revenue the household keeps on the card
    balance = _lognormal(rng, buffer_mult * b.base_monthly_revenue, 0.5)
    txs: list[dict] = []
    shock_months: list[str] = []

    def ensure(day: date, amt: float) -> None:
        # households top up the card with cash before a fixed payment they cannot skip
        nonlocal balance
        if balance < amt:
            top = round(amt - balance + rng.uniform(50_000, 400_000), -4)
            balance += top
            txs.append(_tx(day, rng, "NAQD PUL KIRITISH BANKOMAT", 0.0, top, balance, "cash_deposit"))

    d = start
    monthly_biz: dict[str, float] = {}
    monthly_reg: dict[str, float] = {}
    cur_month = None
    shock_mult = 1.0
    while d < app:
        mk = month_key(d)
        if mk != cur_month:
            cur_month = mk
            monthly_biz.setdefault(mk, 0.0)
            monthly_reg.setdefault(mk, 0.0)
            shock_mult = 1.0
            if rng.random() < a.shock_prob_per_month:
                shock_mult = rng.uniform(0.35, 0.65)
                shock_months.append(mk)
            # monthly fixed items on day 1..5
            fixed_day = rng.randint(1, 5)
        dow = d.weekday()
        season = _season(a, d.month)
        lam = a.customers_per_month / 30 * season * shock_mult * a.weekly_pattern[dow]
        n_sales = np.random.default_rng(rng.getrandbits(32)).poisson(lam)
        mean_ticket = b.base_monthly_revenue / max(a.customers_per_month, 1)
        for _ in range(int(n_sales)):
            amt = round(_lognormal(rng, mean_ticket, a.ticket_sigma), -3)
            if amt <= 0:
                continue
            u = rng.random()
            if u < a.pos_share:
                cat, desc = "pos_sale", f"POS {b.full_name.split()[0].upper()} {a.activity_uz.split()[0].upper()} TERMINAL"
            elif u < a.pos_share + a.p2p_share:
                cat, desc = "customer_p2p", f"P2P HUMO {rng.choice(['8600', '9860'])} **** {rng.randint(1000, 9999)}"
            elif u < a.pos_share + a.p2p_share + a.marketplace_share:
                continue  # marketplace revenue is paid out weekly below
            else:
                continue  # cash, invisible
            balance += amt
            txs.append(_tx(d, rng, desc, 0.0, amt, balance, cat))
            monthly_biz[mk] += amt
            monthly_reg[mk] += amt
        # weekly marketplace payout (Mondays)
        if a.marketplace_share > 0 and dow == 0:
            weekly_rev = b.base_monthly_revenue * season * shock_mult / 4.3 * a.marketplace_share
            amt = round(_lognormal(rng, weekly_rev, 0.25), -3)
            balance += amt
            txs.append(_tx(d, rng, f"{rng.choice(MARKETPLACES)} PAYOUT", 0.0, amt, balance, "marketplace_payout"))
            monthly_biz[mk] += amt
            monthly_reg[mk] += amt
        # monthly items
        if d.day == fixed_day:
            if b.has_side_salary:
                amt = round(_lognormal(rng, b.side_salary, 0.05), -3)
                balance += amt
                txs.append(_tx(d, rng, "ZARPLATA OYLIK ISH HAQI", 0.0, amt, balance, "salary"))
                monthly_reg[mk] += amt
            if b.has_relative_transfers and rng.random() < 0.8:
                amt = round(_lognormal(rng, 0.25 * AVG_WAGE_UZS, 0.3), -3)
                balance += amt
                txs.append(_tx(d, rng, f"P2P HUMO {rng.choice(relatives)}", 0.0, amt, balance, "relative_transfer"))
                monthly_reg[mk] += amt
            if rent > 0:
                amt = round(rent, -3)
                ensure(d, amt)
                balance -= amt
                txs.append(_tx(d, rng, "IJARA TO'LOVI P2P 8600 **** 2210", amt, 0.0, balance, "rent"))
            for u_name in utilities:
                amt = round(_lognormal(rng, 0.03 * AVG_WAGE_UZS, 0.4), -3)
                ensure(d, amt)
                balance -= amt
                txs.append(_tx(d, rng, f"{u_name} KOMMUNAL", amt, 0.0, balance, "utilities"))
            amt = round(_lognormal(rng, 0.012 * AVG_WAGE_UZS, 0.2), -3)
            ensure(d, amt)
            balance -= amt
            txs.append(_tx(d, rng, f"{telecom} ABONENT", amt, 0.0, balance, "telecom"))
            for ln in b.loans:
                ls = date.fromisoformat(ln.start)
                if ls <= d and (d - ls).days < 30 * ln.term_months:
                    amt = ln.monthly_payment
                    ensure(d, amt)
                    balance -= amt
                    txs.append(_tx(d, rng, f"{ln.lender} KREDIT TO'LOVI", amt, 0.0, balance, "loan_repayment"))
        # loan disbursement on start date
        for ln in b.loans:
            if date.fromisoformat(ln.start) == d:
                balance += ln.amount
                txs.append(_tx(d, rng, f"{ln.lender} KREDIT BERISH", 0.0, ln.amount, balance, "loan_disbursement"))
        # supplier purchases: a few times per month, proportional to revenue
        if rng.random() < 0.18 and a.supplier_share > 0:
            amt = round(_lognormal(rng, b.base_monthly_revenue * a.supplier_share / 5.4, 0.35), -3)
            if amt < balance:
                balance -= amt
                txs.append(_tx(d, rng, f"{rng.choice(suppliers)} TO'LOV", amt, 0.0, balance, "supplier"))
        # personal spend
        if rng.random() < 0.55:
            merchant = rng.choice(SUPERMARKETS + FUEL + TAXI_APPS)
            amt = round(_lognormal(rng, 0.015 * AVG_WAGE_UZS, 0.6), -3)
            if amt < balance:
                balance -= amt
                txs.append(_tx(d, rng, f"{merchant} TOSHKENT", amt, 0.0, balance, "personal_spend"))
        # ATM cash
        if rng.random() < 0.12:
            amt = round(_lognormal(rng, 0.08 * AVG_WAGE_UZS, 0.5), -5)
            if 0 < amt < balance:
                balance -= amt
                txs.append(_tx(d, rng, f"ATM {rng.choice(BANKS)} NAQD", amt, 0.0, balance, "atm_cash"))
        # self transfers (circular)
        if rng.random() < 0.06:
            amt = round(_lognormal(rng, 0.1 * AVG_WAGE_UZS, 0.5), -4)
            if 0 < amt < balance:
                balance -= amt
                txs.append(_tx(d, rng, f"P2P O'ZIGA {own_other_card}", amt, 0.0, balance, "self_transfer_out"))
                if rng.random() < 0.7:
                    balance += amt
                    txs.append(_tx(d, rng, f"P2P HUMO {own_other_card}", 0.0, amt, balance, "self_transfer_in"))
        # household consumption: around the 25th, spend down most of the excess above the buffer
        if d.day == 25:
            target = buffer_mult * b.base_monthly_revenue
            excess = balance - target
            if excess > 200_000:
                spend = excess * rng.uniform(0.6, 0.9)
                parts = rng.randint(2, 4)
                for p in range(parts):
                    amt = round(spend / parts * rng.uniform(0.7, 1.3), -4)
                    if amt <= 0 or amt >= balance:
                        continue
                    u = rng.random()
                    if u < 0.45:
                        desc, cat = f"ATM {rng.choice(BANKS)} NAQD", "atm_cash"
                    elif u < 0.8:
                        desc, cat = f"P2P 8600 **** {rng.randint(1000, 9999)}", "p2p_out"
                    else:
                        desc, cat = f"{rng.choice(SUPERMARKETS)} TOSHKENT", "personal_spend"
                    balance -= amt
                    txs.append(_tx(d + timedelta(days=rng.randint(0, 4)) if d.day + 4 <= 28 else d, rng, desc, amt, 0.0, balance, cat))
        # refund
        if rng.random() < 0.01:
            amt = round(_lognormal(rng, 0.01 * AVG_WAGE_UZS, 0.5), -3)
            balance += amt
            txs.append(_tx(d, rng, f"{rng.choice(SUPERMARKETS)} QAYTARISH", 0.0, amt, balance, "refund"))
        d += timedelta(days=1)

    # keep simulation order within a day (so validated balances stay non-negative), then assign increasing times
    txs.sort(key=lambda t: (t["date"], t["seq"]))
    i = 0
    while i < len(txs):
        j = i
        while j < len(txs) and txs[j]["date"] == txs[i]["date"]:
            j += 1
        times = sorted(rng.randint(7 * 60, 22 * 60 + 59) for _ in range(j - i))
        for k, t in enumerate(txs[i:j]):
            t["time"] = f"{times[k] // 60:02d}:{times[k] % 60:02d}"
            del t["seq"]
        i = j
    # recompute running balance after sort so the statement reconciles exactly
    bal = txs[0]["balance"] - txs[0]["credit"] + txs[0]["debit"] if txs else 0.0
    for t in txs:
        bal = bal + t["credit"] - t["debit"]
        t["balance"] = round(bal, 2)
    b.shock_months = shock_months
    b.true_business_inflow = {k: round(v, 2) for k, v in monthly_biz.items()}
    b.true_regulatory_income = {k: round(v, 2) for k, v in monthly_reg.items()}
    return txs


_SEQ = [0]


def _tx(d: date, rng: random.Random, desc: str, debit: float, credit: float, balance: float, cat: str) -> dict:
    _SEQ[0] += 1
    return {
        "seq": _SEQ[0],
        "date": d.isoformat(),
        "time": f"{rng.randint(7, 22):02d}:{rng.randint(0, 59):02d}",
        "description": desc,
        "debit": round(debit, 2),
        "credit": round(credit, 2),
        "balance": round(balance, 2),
        "category": cat,
    }


def label_default(rng: random.Random, b: Borrower, txs: list[dict]) -> None:
    """Latent affordability score -> default within 12 months after the new loan.

    Declared assumptions: default risk rises with revenue volatility, debt-service ratio
    (existing + requested loan), number of shock months, and falls with income level and
    cash buffer. Noise term keeps the label from being a deterministic function of features.
    """
    months = sorted(b.true_business_inflow)[-12:]
    inc = np.array([b.true_regulatory_income[m] for m in months]) if months else np.array([0.0])
    mean_inc = inc.mean() if inc.size else 1.0
    cv = inc.std() / mean_inc if mean_inc > 0 else 2.0
    new_pmt = annuity_payment(b.requested_amount, 0.28, b.requested_term_months)
    existing = sum(l.monthly_payment for l in b.loans)
    dsr = (new_pmt + existing) / max(mean_inc, 1.0)
    balances = [t["balance"] for t in txs[-120:]] or [0.0]
    buffer_months = (np.percentile(balances, 10)) / max(mean_inc, 1.0)
    z = (0.9 * math.log(max(mean_inc, 1e5) / AVG_WAGE_UZS)
         - 1.8 * cv
         - 3.2 * dsr
         + 1.2 * min(buffer_months, 1.5)
         - 0.35 * len(b.shock_months)
         + rng.gauss(0, 0.6))
    b.latent_risk = round(float(z), 4)
    # threshold tuned so that the population default rate lands near 10% (declared assumption)
    b.default_12m = int(z < DEFAULT_THRESHOLD)


DEFAULT_THRESHOLD = -3.95


def iter_population(n: int, seed: int = 42, application_date: date = date(2026, 9, 30)):
    """Yield (borrower, transactions) one at a time so callers can stream to disk (memory-safe)."""
    rng = random.Random(seed)
    for i in range(n):
        b = make_borrower(rng, i, application_date)
        txs = simulate_transactions(rng, b)
        label_default(rng, b, txs)
        yield b, txs


def simulate_population(n: int, seed: int = 42, application_date: date = date(2026, 9, 30)):
    borrowers: list[Borrower] = []
    all_txs: dict[str, list[dict]] = {}
    for b, txs in iter_population(n, seed, application_date):
        borrowers.append(b)
        all_txs[b.borrower_id] = txs
    return borrowers, all_txs


def borrower_to_dict(b: Borrower) -> dict:
    d = asdict(b)
    return d
