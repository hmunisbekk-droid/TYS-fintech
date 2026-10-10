# Daromad — Income Evidence Engine for thin-file borrowers

**Team TYS · FinTech / AI in Finance track · Partner product for MKBANK (micro and family-business lending)**

Daromad turns the documents a self-employed or family-business borrower actually has — card and wallet
statements (PDF / XLSX / CSV), fiscal receipts (photos), the Soliq self-employed certificate — into:

1. a regulator-compliant **12-month income figure** (CBU debt-burden regulation, cl.7 and cl.9),
2. the **debt-burden ratio (ПДН)** with every clause cited and the maximum affordable amount back-solved,
3. an **integrity report** (balance-chain reconciliation, duplicates, coverage, pre-application inflow spikes, circular transfers, cross-document consistency),
4. an explained **risk score** (gradient-boosted trees with monotone constraints, run in the browser),
5. a **credit memo** in which every number is traceable to a document line and checked by a faithfulness verifier,
6. a **hash-chained audit log** of documents, engine versions, analysis runs and the officer's decision.

Everything runs **inside the browser**: no server, no API keys, no customer byte leaves the device. The
production design serves the same bundle from the bank's own server (see `docs/ARCHITECTURE.md`).

- Live prototype: **https://tys-fintech.vercel.app**
- Repository: **https://github.com/hmunisbekk-droid/TYS-fintech**
- Defence deck: `deck/Daromad_TYS_deck.pptx`

## Repository layout

```
apps/web/        Next.js 16 app (static export). All document parsing, OCR, rules, model inference, memo, audit → lib/
  lib/parse/     pdf.js statement/certificate parsing, SheetJS XLSX/CSV parsing, amount/date helpers
  lib/ocr/       tesseract.js receipt OCR (self-hosted worker, core and uzb+rus+eng data in public/)
  lib/categorize.ts   multilingual rule-based transaction categoriser + counterparty patterns
  lib/features.ts     18 cash-flow features (parity-tested against ml/features.py)
  lib/rules/pdn.ts    ПДН rule engine with clause citations
  lib/risk.ts         XGBoost JSON inference + one-at-a-time attributions
  lib/integrity.ts    integrity / plausibility checks
  lib/memo.ts         template memo, fact table, faithfulness verifier
  lib/audit.ts        SHA-256 hash-chained audit log
  public/model/       model.json, feature_stats.json, metrics.json, berka_metrics.json, *_eval.json (read by the Model card page)
  public/samples/     synthetic demo documents (3 borrowers + 4 tampered statements)
  tests/              vitest unit tests (parity, rules, parsers, memo verifier) + Playwright e2e and evaluation scripts
synth/           synthetic data generator (archetypes → 24 months of transactions → PDF/XLSX/CSV statements, receipt photos, certificates, tampered variants)
ml/              feature spec, training (XGBoost), Berka real-data validation, exported artifacts
data/synthetic/  generated data set (summary.json committed; regenerate with one command)
docs/            ARCHITECTURE.md, DATA_SOURCES.md, MODEL_CARD.md, DECK_SCRIPT.md
deck/            defence deck
.github/workflows/ci.yml   tests + build on every push
```

## Run it

### Web app (the prototype)

```bash
cd apps/web
npm ci
npm run dev          # http://localhost:3000
npm test             # vitest: feature parity with Python, rule engine, parsers, memo verifier (also writes public/model/categorizer_eval.json)
npm run build        # static export to apps/web/out
```

Deploy: import the repo in Vercel with **Root Directory = `apps/web`** (framework Next.js, defaults otherwise). No environment variables are needed. Any static host works (`apps/web/out`).

### Reproduce the data and the model (Python 3.11+)

```bash
pip install -r requirements.txt
python -m playwright install chromium          # used only to render synthetic PDFs/PNGs
python -m synth.cli --out data/synthetic --n 2000 --render 60 --receipts 180 --tamper 40 --seed 42
python -m ml.train --data data/synthetic --out ml/artifacts
python -m ml.berka_validate --data data/berka --out ml/artifacts/berka_metrics.json   # downloads the Berka mirror (~70 MB)
cp ml/artifacts/{model.json,feature_stats.json,metrics.json,berka_metrics.json} apps/web/public/model/
cp ml/artifacts/fixture.json apps/web/tests/fixture.json
```

### Evaluation through the real app (headless Chromium)

```bash
cd apps/web && npm run build && python3 -m http.server 8787 --directory out &
python3 tests/e2e.py http://localhost:8787 /tmp/shots                                   # smoke test + screenshots
python3 tests/ocr_eval.py http://localhost:8787 ../../data/synthetic/documents 60 public/model/ocr_eval.json
python3 tests/statement_eval.py http://localhost:8787 ../../data/synthetic 60 public/model/statement_eval.json
```

## What the jury can test live

Open the prototype → **New case** → *Load sample A/B/C* (synthetic borrowers) or upload **your own** statement
(any PDF with a text layer, XLSX or CSV export) and a photo of **any receipt**. Unknown layouts fall back to
balance-chain sign inference; low-confidence OCR fields are flagged for confirmation rather than guessed.
Drag the *requested amount* slider to watch ПДН cross the 50% cap and the recommendation change. Record a decision
and export the case with its audit chain.

## Results (all produced by code in this repo, read by the Model card page)

| What | Result | Where |
|---|---|---|
| Statement parsing, 60 synthetic PDFs (2 layouts, RU/UZ labels) | row count exact on 60/60, balance chain reconciles on 60/60, ~1.6 s per 12-month PDF | `public/model/statement_eval.json` |
| Tamper detection (inflated inflow, deleted debit, duplicated row, window dressing) | 40/40 caught (10/10 per type); 0 false positives on the 60 clean statements | `public/model/statement_eval.json` |
| Receipt OCR on 60 camera-augmented photos (uzb+rus+eng, in-browser) | total 95%, INN 100%, date 97%, receipt № 98%, 1.6 s each | `public/model/ocr_eval.json` |
| Transaction categoriser vs ground truth (10,481 synthetic lines) | 99.96% (synthetic vocabulary — will be lower on real data) | `public/model/categorizer_eval.json` |
| Risk model, synthetic holdout (n=500) | ROC-AUC 0.965, PR-AUC 0.76, Brier 0.042; logistic 0.963; ПДН alone 0.948 | `public/model/metrics.json` |
| Methodology check on real anonymised bank data (Berka, 443 loans, 5-fold) | ROC-AUC 0.902 (boosted), 0.895 (logistic), 0.735 (ratio alone) | `public/model/berka_metrics.json` |
| Memo faithfulness | 0 unsourced numbers on every sample case (verifier enforced at runtime) | e2e |
| Cost per application | zero marginal (static hosting, no API, no GPU) | — |

Honest caveats: the risk model is trained on a **declared synthetic population** (`data/synthetic/summary.json`);
its AUC shows the pipeline learns the declared affordability structure, not real-world performance. The categoriser
accuracy is measured on the generator's own vocabulary. Both are retrained/extended on bank data inside the
perimeter during the pilot — that is the pilot's first deliverable.

## Data sources and licences

See `docs/DATA_SOURCES.md` for the full table. Summary: all borrower data is synthetic (MIT, this repo, generator
declared); the Berka/PKDD'99 data set is used only for an offline methodology check and is not redistributed;
Tesseract language data, tesseract.js, pdf.js, SheetJS, XGBoost, scikit-learn, Next.js and React are Apache-2.0/BSD/MIT;
CBU regulation texts are public legal information (lex.uz).

## Rules compliance

- No hard-coded answers: every number on screen is computed from the uploaded documents at run time; the jury's own documents work.
- No real personal or confidential data anywhere in the repo or the demo. Names are drawn from a public first/last-name list; card numbers are random and masked.
- All code in this repository was written during the final by team TYS with LLM coding assistance (declared); third-party libraries are listed with licences.
- Deployment is from this repository (Vercel Git integration); CI runs tests and the build on every push.

## Team

Munisbek — technical lead (pipeline, model, deployment) · Jahongir — research and data (regulation mapping, synthetic-data calibration, evaluation) · Umida — compliance and business case (ПДН rules, data-protection design, pilot budget and ROI, deck).

MIT License — see `LICENSE`.
