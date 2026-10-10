"""Produce tampered statement variants with labels, for the integrity-check evaluation.

Tamper types (each breaks something a careful officer could catch):
  inflate_credit   – one inflow amount multiplied, balances NOT recomputed → running balance breaks
  delete_debit     – a loan repayment or supplier row removed → balance chain breaks, debt service hidden
  duplicate_row    – one inflow row duplicated with a new time → duplicate detection
  window_dressing  – several large round inflows inserted in the last 3 weeks, balances recomputed → plausibility rule
"""
from __future__ import annotations

import copy
import random


def tamper(rng: random.Random, txs: list[dict], kind: str) -> tuple[list[dict], dict]:
    rows = copy.deepcopy(txs)
    label = {"tamper_type": kind}
    credits = [i for i, t in enumerate(rows) if t["credit"] > 0]
    if kind == "inflate_credit":
        i = rng.choice(credits)
        factor = rng.choice([3, 5, 10])
        label.update(row_index=i, original=rows[i]["credit"], factor=factor)
        rows[i]["credit"] = round(rows[i]["credit"] * factor, 2)
    elif kind == "delete_debit":
        cand = [i for i, t in enumerate(rows) if t["category"] in ("loan_repayment", "supplier") and t["debit"] > 0]
        if not cand:
            cand = [i for i, t in enumerate(rows) if t["debit"] > 0]
        i = rng.choice(cand)
        label.update(row_index=i, removed=rows[i])
        del rows[i]
    elif kind == "duplicate_row":
        i = rng.choice(credits)
        dup = copy.deepcopy(rows[i])
        dup["time"] = f"{rng.randint(7, 22):02d}:{rng.randint(0, 59):02d}"
        rows.insert(i + 1, dup)
        label.update(row_index=i)
    elif kind == "window_dressing":
        last = rows[-1]["date"]
        n = rng.randint(3, 6)
        inserted = []
        for _ in range(n):
            amt = float(rng.choice([2, 3, 5, 10]) * 1_000_000)
            d = rows[-rng.randint(1, min(40, len(rows) - 1))]["date"]
            inserted.append(dict(date=d, time=f"{rng.randint(9, 20):02d}:{rng.randint(0, 59):02d}",
                                 description=f"P2P HUMO 8600 **** {rng.randint(1000, 9999)}", debit=0.0, credit=amt,
                                 balance=0.0, category="customer_p2p"))
        rows.extend(inserted)
        rows.sort(key=lambda t: (t["date"], t["time"]))
        bal = rows[0]["balance"] - rows[0]["credit"] + rows[0]["debit"]
        for t in rows:
            bal = bal + t["credit"] - t["debit"]
            t["balance"] = round(bal, 2)
        label.update(inserted=len(inserted), total_inserted=sum(x["credit"] for x in inserted), last_date=last)
    else:
        raise ValueError(kind)
    return rows, label
