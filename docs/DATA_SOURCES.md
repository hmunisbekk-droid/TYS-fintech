# Data sources and licences

| Source | Used for | Licence / terms | Link |
|---|---|---|---|
| **Daromad synthetic data set** — generator in `synth/` (archetypes, 24-month transaction simulation, statement/receipt/certificate rendering, camera augmentation, tampering), seed 42: 2,000 borrowers, 5.69M transactions, 60 rendered statement sets (PDF/XLSX/CSV), 180 receipts (clean + photo), 40 tampered statements, 10.5% default rate | training, evaluation, demo samples | MIT (this repository). Generation method and parameters are declared in `synth/archetypes.py`, `synth/simulate.py` and `data/synthetic/summary.json`. Names are drawn from a short public first/last-name list; card numbers random and masked; counterparties are fictional or public business names. No real person is represented. | this repo |
| **Berka / PKDD'99 Financial data set** (Czech bank, 1993–1998: accounts, ~1.06M transactions, 682 loans with outcome) | offline methodology check: do cash-flow features computed from plain account statements separate good and bad loans on real data? | Academic challenge data; no explicit licence stated by the original authors. Used only for evaluation; **not redistributed** in this repository (downloaded by `ml/berka_validate.py` from the public mirror). | https://sorry.vse.cz/~berka/challenge/pkdd1999/berka.htm · mirror https://github.com/jlacko/berka-dataset |
| **Tesseract language data** (`tessdata_fast`: uzb, uzb_cyrl, rus, eng) | receipt OCR in the browser | Apache 2.0 | https://github.com/tesseract-ocr/tessdata_fast |
| tesseract.js 6, tesseract.js-core | OCR runtime (self-hosted in `apps/web/public/tesseract`) | Apache 2.0 | https://github.com/naptha/tesseract.js |
| pdf.js (pdfjs-dist 4) | PDF text extraction with coordinates | Apache 2.0 | https://github.com/mozilla/pdf.js |
| SheetJS CE 0.20.3 (npm alias `@e965/xlsx`, automated republish of the vendor build) | XLSX/CSV parsing | Apache 2.0 | https://sheetjs.com · https://github.com/e965/sheetjs-npm-publisher |
| Next.js 16, React 19 | application | MIT | https://nextjs.org |
| XGBoost | risk model training | Apache 2.0 | https://xgboost.ai |
| scikit-learn, NumPy, pandas | training and evaluation | BSD-3 | — |
| OpenCV (opencv-python-headless), Pillow | camera-style augmentation of receipt images | Apache 2.0 / MIT-CMU | — |
| Playwright (Chromium) | rendering synthetic PDFs/PNGs; end-to-end evaluation | Apache 2.0 | — |
| Jinja2, qrcode, openpyxl | templates, QR codes, XLSX output | BSD-3 / BSD / MIT | — |
| DejaVu fonts (system) | rendering | Bitstream Vera / public domain | — |
| **CBU Regulation No. 3618** — on macroprudential norms set for banks and on the maximum values of payments on loans (microloans) issued by them (Board decision 7/3 of 8 Apr 2025; registered 22 Apr 2025; in force 24 Jul 2025; amended by decision 31/9 of 5 Dec 2025) | rule engine, clause citations | public legal information | https://lex.uz/uz/docs/7491592 |
| CBU Regulation No. 3205 (debt burden of borrowers of microfinance organisations and pawnshops, as retitled on 21 Apr 2025) | consulted only to confirm it no longer covers banks; not implemented | public legal information | https://lex.uz/docs/4654149 |
| MKBANK product pages, stat.uz wage releases, CBU problem-loan statistics | calibration anchors (`AVG_WAGE_UZS`, default-rate assumption), business case | public information, cited in the deck | mkbank.uz · stat.uz · cbu.uz · buxgalter.uz |

## What is *not* used

No customer records, no non-public bank data, no scraped personal data, no faces, no real statements of any person
(team members' own documents were not used, committed or shown). Kaggle competition data sets with restrictive rules
(e.g. Home Credit) were deliberately not used.

## Declared assumptions in the synthetic generator

- Income anchors are multiples of `AVG_WAGE_UZS` (set from the stat.uz average nominal wage; update and regenerate when the figure changes).
- Ten archetypes with declared seasonality, customer counts, channel mix (POS / customer P2P / marketplace / invisible cash), expense structure, side-salary and family-transfer probabilities (`synth/archetypes.py`).
- Default labels come from a latent affordability score (income level, volatility, debt-service ratio incl. the requested loan, cash buffer, shocks, noise) thresholded to a ~10% population default rate (`synth/simulate.py::label_default`). This is an assumption about structure, not a measurement.
- Tampering types: inflated inflow, deleted debit, duplicated row, window dressing (`synth/tamper.py`).
