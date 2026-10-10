# Architecture

## One sentence

Daromad is a seven-component pipeline that converts raw borrower documents into a regulator-compliant income
figure, a cited ПДН calculation, an integrity report, an explained risk score and a verified credit memo — and it
runs entirely inside the perimeter, in the prototype literally inside the officer's browser.

## Components

| # | Component | Prototype implementation | Production implementation |
|---|---|---|---|
| 1 | Intake & extraction | pdf.js text layer with coordinates (header-column learning + balance-chain sign inference), SheetJS for XLSX/CSV, tesseract.js (uzb, rus, eng; self-hosted worker/core/data) for receipt photos; per-field confidence; tap-to-confirm under 0.75 | same libraries on a bank web server; scanned-PDF OCR page by page; a local open-weight vision model as fallback for unknown layouts |
| 2 | Categoriser | multilingual keyword rules (Uzbek Latin/Cyrillic, Russian, English) + counterparty patterns (recurring payer → family transfer; a mask that both sends and receives → own card) | lexicon grown on bank data in week one of the pilot; small classifier on merchant strings |
| 3 | Cash-flow reconstruction | 12-month series: regulatory income (cl.18), business revenue, non-business, excluded inflows, debt service; 18 features identical in TypeScript and Python (parity test) | same; statements of MKBANK account holders pulled from the core, not uploaded |
| 4 | Rule engine | ПДН per CBU Regulation No. 3618 for banks (lex.uz/uz/docs/7491592): 50% limit, 50–100% quota band and new-self-employed quota (cl.3), cl.4 exemptions, guarantor-only-if-overdue (cl.7), 36/60/180-month spreading (cl.8), 6–12-month income with median option (cl.13–14), account receipts as income (cl.18); every line cites its clause; maximum affordable amount back-solved | same engine, versioned; limits and quota shares as configuration |
| 5 | Risk model | XGBoost (300 trees, depth 3, monotone constraints) exported to JSON and evaluated in the browser; one-at-a-time attributions vs portfolio medians | retrained on bank history inside the perimeter; SHAP TreeExplainer on the server; champion/challenger |
| 6 | Integrity | running-balance reconciliation, duplicates, 12-month coverage, activity gaps, pre-application inflow spike (round sums), circular transfers counted as income, holder-name match across documents, stated vs implied opening balance | plus PDF metadata/font checks and image forensics; cross-check with credit-bureau obligations |
| 7 | Memo + verifier + audit | template memo assembled from a fact table; the verifier rejects any number not in the table; SHA-256 hash-chained audit log of documents (hashes), engine versions, analysis runs, decisions and overrides | memo narrative optionally drafted by a local LLM constrained to the same fact table and verifier; audit log persisted to the bank DB; SSO identity |

## Data flow

```
documents ──► parse/OCR ──► transactions (+fields) ──► categorise ──► 12-month series ──► features
                                                                      │                    │
                                                                      ▼                    ▼
                                                               rule engine (ПДН)      risk model (+attributions)
                                                                      │                    │
                      integrity checks ◄──────────────────────────────┴────────────────────┘
                                                                      │
                                                            memo (fact table → verifier)
                                                                      │
                                                   officer decision ──► hash-chained audit log ──► export
```

## Perimeter and deployment

- Prototype: static Next.js export on Vercel. The browser downloads ~10 MB of code, model and OCR data once; documents never leave the tab. Nothing is stored server-side; the case exists only until the tab closes or is exported.
- Production: the same bundle served by the bank's web server (Docker, no outbound network), behind SSO; audit log and cases persisted to the bank's database; integrations by REST to core banking (account statements of own customers) and the credit bureau (existing obligations). GPU is optional and only for the narrative LLM.
- Human in the loop: the engine recommends and computes the maximum affordable amount; the officer decides; an override requires a reason which is written into the chain; amounts above the branch limit go to the credit committee with the same memo.
- Explainability: every memo number links to a document line; every ПДН line cites its clause; every risk attribution shows the feature value against the portfolio median; engine versions are stamped on every analysis.

## Speed and cost

Measured in headless Chromium on the sample set: PDF statement parsing 1.2–1.8 s for 500–1,800 rows; receipt OCR 1.6 s mean (first run adds ~3 s to load language data); categorise + features + rules + risk + integrity + memo < 50 ms. Marginal cost per application: zero (static hosting). Production: one small VM; a single on-prem GPU only if the narrative LLM is enabled.

## Known failure cases

Scanned statements without a text layer (prototype asks for the XLSX/CSV export); layouts with one signed amount column and no balance column (signs taken from keywords); mixed-script merchant names outside the lexicon (default category, visible in the table); heavily skewed or dark receipt photos (fields flagged, not guessed); cash-only businesses (nothing to reconstruct — the memo says so); the synthetic-to-real gap of the risk model until retrained.
