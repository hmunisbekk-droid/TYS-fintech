# Daromad — Income Evidence Engine for thin-file borrowers

**Team TYS · FinTech / AI in Finance track · Partner product for MKBANK (micro and family-business lending)**

Daromad turns the documents a self-employed or family-business borrower actually has — card and wallet
statements (PDF / XLSX / CSV), fiscal receipts (photos), the Soliq self-employed certificate — into:

1. a regulator-compliant **12-month income figure** (CBU debt-burden regulation, cl.7 and cl.9),
2. the **debt-burden ratio (ПДН)** with every clause cited, lender-type rules (bank by default), and the maximum affordable amount back-solved,
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
docs/            ARCHITECTURE.md, DATA_SOURCES.md, MODEL_CARD.md, REGULATION_QUOTES.md, Daromad_project_explained.docx
deck/            defence deck (build_deck.js reads the evaluation JSON and screenshots)
.github/workflows/ci.yml   tests + build on every push
```

## Run it

### Web app (the prototype)

```bash
cd apps/web
npm ci
npm run dev          # http://localhost:3000
npm test             # vitest: feature parity with Python, rule engine, parsers (incl. a real two-date-column PDF via pdf.js), memo verifier (writes public/model/categorizer_eval.json and ood_eval.json)
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
| **Unseen layouts** (signed-amount RU CSV, Kirim/Chiqim XLSX, quoted EN CSV + Type column, Unicode-minus CSV, headerless CSV, Приход/Расход TSV, Payme-style wallet export with +/− type column, status column and no balance, RU bank CSV with two date columns + document-number and account columns) | 8/8 exact row counts and credit/debit totals | `public/model/ood_eval.json` (written by `tests/ood.test.ts`) |
| **Two-date-column bank PDF** (Дата операции / Дата проводки, № документа, 20-digit correspondent account, header and descriptions wrapped over two lines; 25 pages, 1,346 rows) | rows and totals exact, operation date kept on every row, balance chain intact | `tests/pdf_layout.test.ts` on `tests/fixtures/statement_twodate.pdf` (+ CSV twin) |
| Receipt OCR on 60 camera-augmented photos (uzb+rus+eng, in-browser) | total 95%, INN 100%, date 97%, receipt № 98%, 1.6 s each | `public/model/ocr_eval.json` |
| Transaction categoriser vs ground truth (10,481 synthetic lines) | 99.96% (synthetic vocabulary — will be lower on real data) | `public/model/categorizer_eval.json` |
| Risk model, synthetic holdout (n=500) | ROC-AUC 0.965, PR-AUC 0.76, Brier 0.042; logistic 0.963; ПДН alone 0.948 | `public/model/metrics.json` |
| Methodology check on real anonymised bank data (Berka, 443 loans, 5-fold) | ROC-AUC 0.902 (boosted), 0.895 (logistic), 0.735 (ratio alone) | `public/model/berka_metrics.json` |
| Memo faithfulness | 0 unsourced numbers across a 300-scenario sweep (5 borrowers × 4 products × 5 amounts × 3 terms, incl. 50-BRV and family-programme exemptions, refer/decline) | `tests/engine.test.ts` |
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

## Known items

- `xlsx` resolves to SheetJS CE **0.20.3** through the npm alias `xlsx@npm:@e965/xlsx@0.20.3` (an automated, Apache-2.0 republish of the vendor build, because SheetJS stopped publishing to the npm registry at 0.18.5, which carried two advisories). `npm audit --omit=dev` is clean. If cdn.sheetjs.com is reachable, the official tarball is a drop-in: `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- BRV is a configuration constant (`apps/web/lib/rules/pdn.ts`, `synth/archetypes.py`): 440,000 UZS from 1 Sep 2026.
- Lender type (section 1 of the case page) defaults to **bank**: no small-loan exclusion, the ratio is computed for every application and the bank-level 15% quota is shown as a note. The 50-BRV (MFO/pawnshop) and 75-BRV (MFO + self-employed) exclusions apply only when the lender type is changed.
- Statements with several date columns (operation date / posting date) use the **first** date column; later date columns are never read as amounts. Digit-only identifiers of 12+ digits (accounts, cards) are never amounts; numeric columns are mapped to debit/credit/balance by header column boundaries, so document-number and code columns stay out of the totals. Engine versions (`rules`, `parsers`, `categorizer`, `model`) are written into every audit entry and bumped on every rule or parser change.
- Statements whose rows carry no debit/credit, type or balance information are counted as inflows and raise a high-severity integrity finding ("Transaction direction is determinable"), which sends the case to the committee instead of approving on inflated income.
- Scanned statements without a text layer are not OCR'd page by page (use the XLSX/CSV export).

## Rules compliance

- No hard-coded answers: every number on screen is computed from the uploaded documents at run time; the jury's own documents work.
- No real personal or confidential data anywhere in the repo or the demo. Names are drawn from a public first/last-name list; card numbers are random and masked.
- All code in this repository was written during the final by team TYS with LLM coding assistance (declared); third-party libraries are listed with licences.
- Deployment is from this repository (Vercel Git integration); CI runs tests and the build on every push.

MIT License — see `LICENSE`.
