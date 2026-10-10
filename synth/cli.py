"""Generate the Daromad synthetic dataset.

    python -m synth.cli --out data/synthetic --n 2000 --render 60 --receipts 200 --tamper 40 --seed 42

Outputs
  borrowers.jsonl            one line per borrower (profile, loans, truth series, labels)
  transactions/<id>.json     24 months of transactions with category labels (for all borrowers)
  documents/<id>/...         rendered statements (PDF, XLSX, CSV), certificate PDF, receipts (PNG clean + JPG photo)
  documents/<id>/truth.json  ground truth for every rendered document
  tampered/<id>_<kind>.pdf   tampered statements + labels.jsonl
  summary.json               dataset statistics and generator parameters (declare these in the README)
"""
from __future__ import annotations

import argparse
import json
import random
import time
from datetime import date, timedelta
from pathlib import Path

from .archetypes import ARCHETYPES, AVG_WAGE_UZS, BRV_UZS
from .augment import augment_photo
from .render import ChromiumRenderer, certificate_html, receipt_html, statement_csv, statement_html, statement_xlsx
from .simulate import DEFAULT_THRESHOLD, borrower_to_dict, iter_population
from .tamper import tamper

TAMPER_KINDS = ["inflate_credit", "delete_debit", "duplicate_row", "window_dressing"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/synthetic")
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--render", type=int, default=60, help="borrowers whose statements/certificates are rendered")
    ap.add_argument("--receipts", type=int, default=200)
    ap.add_argument("--tamper", type=int, default=40)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-render", action="store_true")
    args = ap.parse_args()

    t0 = time.time()
    out = Path(args.out)
    (out / "transactions").mkdir(parents=True, exist_ok=True)
    (out / "documents").mkdir(exist_ok=True)
    (out / "tampered").mkdir(exist_ok=True)

    borrowers = []
    n_tx = 0
    with open(out / "borrowers.jsonl", "w", encoding="utf-8") as f:
        for b, txs in iter_population(args.n, seed=args.seed):
            f.write(json.dumps(borrower_to_dict(b), ensure_ascii=False) + "\n")
            with open(out / "transactions" / f"{b.borrower_id}.json", "w", encoding="utf-8") as tf:
                json.dump(txs, tf, ensure_ascii=False)
            n_tx += len(txs)
            borrowers.append(b)
            del txs
    print(f"simulated {len(borrowers)} borrowers, {n_tx:,} transactions in {time.time()-t0:.1f}s")

    def load_txs(bid: str) -> list[dict]:
        with open(out / "transactions" / f"{bid}.json", encoding="utf-8") as tf:
            return json.load(tf)

    rng = random.Random(args.seed + 1)
    rendered = borrowers[: args.render]
    tamper_labels = []
    receipts_done = 0
    if not args.no_render:
        with ChromiumRenderer() as R:
            for k, b in enumerate(rendered):
                bd = borrower_to_dict(b)
                txs = load_txs(b.borrower_id)
                ddir = out / "documents" / b.borrower_id
                ddir.mkdir(exist_ok=True)
                # 12 complete months before application month
                app = date.fromisoformat(b.application_date).replace(day=1)
                p_to = (app - timedelta(days=1)).isoformat()
                p_from = date(app.year - 1, app.month, 1).isoformat()
                layout = "bank_ru" if k % 2 == 0 else "wallet_uz"
                html = statement_html(bd, txs, layout, p_from, p_to)
                R.pdf(html, ddir / "statement.pdf")
                statement_xlsx(ddir / "statement.xlsx", bd, txs, p_from, p_to)
                statement_csv(ddir / "statement.csv", txs, p_from, p_to)
                chtml, ctruth = certificate_html(rng, bd, args.seed)
                R.pdf(chtml, ddir / "certificate.pdf")
                truth = dict(borrower_id=b.borrower_id, statement=dict(layout=layout, period_from=p_from, period_to=p_to,
                             rows=[t for t in txs if p_from <= t["date"] <= p_to]), certificate=ctruth, receipts=[])
                # receipts
                n_rec = max(1, args.receipts // max(1, len(rendered)))
                for j in range(n_rec):
                    when = date.fromisoformat(p_to) - timedelta(days=rng.randint(0, 300))
                    rhtml, rtruth = receipt_html(rng, bd, when)
                    clean = ddir / f"receipt_{j:02d}.png"
                    R.png(rhtml, clean)
                    photo = ddir / f"receipt_{j:02d}_photo.jpg"
                    aug = augment_photo(clean, photo, rng, strength=rng.choice([0.6, 1.0, 1.4]))
                    rtruth.update(file_clean=clean.name, file_photo=photo.name, augmentation=aug)
                    truth["receipts"].append(rtruth)
                    receipts_done += 1
                with open(ddir / "truth.json", "w", encoding="utf-8") as f:
                    json.dump(truth, f, ensure_ascii=False, indent=1)
                # tampered variants
                if k < args.tamper:
                    kind = TAMPER_KINDS[k % len(TAMPER_KINDS)]
                    rows = [t for t in txs if p_from <= t["date"] <= p_to]
                    trows, label = tamper(rng, rows, kind)
                    thtml = statement_html(bd, trows, layout, p_from, p_to)
                    tname = f"{b.borrower_id}_{kind}.pdf"
                    R.pdf(thtml, out / "tampered" / tname)
                    label.update(file=tname, borrower_id=b.borrower_id, layout=layout)
                    tamper_labels.append(label)
                if (k + 1) % 10 == 0:
                    print(f"rendered {k+1}/{len(rendered)} borrowers ({time.time()-t0:.0f}s)")
        with open(out / "tampered" / "labels.jsonl", "w", encoding="utf-8") as f:
            for l in tamper_labels:
                f.write(json.dumps(l, ensure_ascii=False, default=str) + "\n")

    summary = dict(
        generator="daromad.synth", seed=args.seed, n_borrowers=len(borrowers),
        n_transactions=n_tx,
        default_rate=round(sum(b.default_12m for b in borrowers) / len(borrowers), 4),
        default_threshold=DEFAULT_THRESHOLD,
        anchors=dict(AVG_WAGE_UZS=AVG_WAGE_UZS, BRV_UZS=BRV_UZS),
        archetypes={a.key: dict(label=a.label, income_mult=a.income_mult, season_amp=a.season_amp,
                                customers_per_month=a.customers_per_month, pos_share=a.pos_share,
                                p2p_share=a.p2p_share, marketplace_share=a.marketplace_share) for a in ARCHETYPES},
        archetype_counts={a.key: sum(1 for b in borrowers if b.archetype == a.key) for a in ARCHETYPES},
        rendered_borrowers=len(rendered) if not args.no_render else 0,
        receipts=receipts_done, tampered=len(tamper_labels), tamper_kinds=TAMPER_KINDS,
        notes="All names random from a public list; all card numbers random and masked; all businesses fictional or public brands. No real person is represented.",
    )
    with open(out / "summary.json", "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in summary.items() if k not in ("archetypes",)}, ensure_ascii=False, indent=1))
    print(f"done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
