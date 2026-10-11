// Builds docs/Daromad_project_explained.docx — the plain-language description of the project.
// Usage: node docs/build_explainer.js [out.docx]
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, ShadingType, LevelFormat, PageNumber, Footer, Header, ExternalHyperlink, TabStopType, PageBreak,
} = require("docx");

const GREEN = "1F4E3D", GOLD = "D98E04", GREY = "595959", LIGHT = "EEF3F0", RULE = "C9D6CF";
const FONT = "Calibri", HFONT = "Cambria";
const OUT = process.argv[2] || path.join(__dirname, "Daromad_project_explained.docx");

// ---------- helpers ----------
const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: 22, ...o });
const P = (parts, o = {}) =>
  new Paragraph({ spacing: { after: 140, line: 300 }, ...o, children: (Array.isArray(parts) ? parts : [parts]).map((x) => (typeof x === "string" ? run(x) : x)) });
const B = (t) => run(t, { bold: true });
const I = (t) => run(t, { italics: true });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 360, after: 160 }, children: [new TextRun({ text: t, font: HFONT, size: 32, bold: true, color: GREEN })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 260, after: 100 }, children: [new TextRun({ text: t, font: HFONT, size: 26, bold: true, color: GREEN })] });
const bullet = (parts) => P(parts, { numbering: { reference: "bullets", level: 0 }, spacing: { after: 80, line: 290 } });
const step = (parts) => P(parts, { numbering: { reference: "steps", level: 0 }, spacing: { after: 100, line: 290 } });
const link = (url, text) => new ExternalHyperlink({ link: url, children: [new TextRun({ text: text || url, font: FONT, size: 22, color: "1A5FB4", underline: {} })] });
const callout = (parts) =>
  P(parts, { shading: { type: ShadingType.CLEAR, fill: LIGHT, color: "auto" }, border: { left: { style: BorderStyle.SINGLE, size: 24, color: GOLD, space: 8 } }, indent: { left: 240, right: 240 }, spacing: { before: 120, after: 200, line: 290 } });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

const TABLE_W = 9026; // A4 width 11906 minus 2 x 1440 margins
function table(headers, rows, widths) {
  const borders = { top: { style: BorderStyle.SINGLE, size: 4, color: RULE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } };
  const cell = (text, w, head) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA }, borders,
      shading: head ? { type: ShadingType.CLEAR, fill: GREEN, color: "auto" } : undefined,
      margins: { top: 70, bottom: 70, left: 100, right: 100 },
      children: (Array.isArray(text) ? text : [text]).map((t) => new Paragraph({ spacing: { after: 0, line: 260 }, children: [new TextRun({ text: String(t), font: FONT, size: 20, bold: head, color: head ? "FFFFFF" : "000000" })] })),
    });
  return new Table({
    width: { size: TABLE_W, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, widths[i], true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], false)) })),
    ],
  });
}
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

// ---------- content ----------
const children = [];

// Title block
children.push(new Paragraph({ spacing: { before: 1200, after: 120 }, children: [new TextRun({ text: "Daromad", font: HFONT, size: 72, bold: true, color: GREEN })] }));
children.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "Income Evidence Engine for thin-file borrowers", font: HFONT, size: 32, color: GREEN })] }));
children.push(new Paragraph({ spacing: { after: 600 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 6 } }, children: [new TextRun({ text: "Our project explained step by step, in simple words", font: FONT, size: 26, color: GREY })] }));
children.push(P([B("Team TYS")]));
children.push(P(["FinTech / AI in Finance hackathon final · Partner product for MKBANK · Uzbekistan, October 2026"]));
children.push(gap());
children.push(P([B("Live prototype: "), link("https://tys-fintech.vercel.app")]));
children.push(P([B("Source code: "), link("https://github.com/hmunisbekk-droid/TYS-fintech")]));
children.push(P([B("Defence deck: "), "deck/Daromad_TYS_deck.pptx (also as PDF) in the repository"]));
children.push(gap());
children.push(callout([B("In one sentence: "), "Daromad reads the documents a self-employed borrower really has — card and wallet statements, receipt photos, the self-employed certificate — and turns them, inside the browser and in under a minute, into a regulator-compliant income figure, a debt-burden ratio with every clause cited, an integrity report, an explained risk score, a credit memo where every number is checked, and a tamper-proof audit log."]));

// How to read this
children.push(P([I("How this document is organised. "), "Part A explains the problem and the idea. Part B lists, step by step, what we did during the final. Part C explains how the system works, screen by screen and then under the hood. Part D gives the measured results, the business case and the honest limits. Part E has the links and a glossary of the technical words."]));

children.push(pageBreak());

// ===== PART A =====
children.push(H1("Part A — The problem and the idea"));
children.push(H2("1. The problem we chose"));
children.push(P("In Uzbekistan a large part of the economy is self-employed people and family businesses: a seamstress, a taxi driver, a small shop, a home bakery. They receive money on bank cards and wallets (Humo, Uzcard, Payme, Click, Uzum) but they have no employer, no salary certificate and, as self-employed, they do not file a tax return. When they ask a bank for a loan, the bank must by law calculate their income and their debt-burden ratio (DBR) — but the only evidence the regulation accepts for them is the money credited to their bank accounts (Central Bank of the Republic of Uzbekistan, 2025, clause 18), in other words their statements."));
children.push(P("Today a credit officer does this by hand: downloads a 12-month statement, scrolls through hundreds of lines, guesses which lines are business income and which are transfers from relatives, adds them up in Excel, divides by 12, and types the result into a memo. It takes about an hour and a half per applicant, it is inconsistent between officers, and a forged statement is hard to notice. MKBANK, the hackathon partner, financed about 48,000 such micro-projects in 2025 and plans about 140,000 projects under its lending programmes in 2026 (Spot, 2026), and close to 800,000 people are registered as self-employed (Yuz.uz, 2021) — so this manual hour is repeated more than a hundred thousand times a year."));
children.push(callout([B("Why this is a good hackathon problem: "), "the rule is written in law (so we can check our answer against the text), the input is messy real-world documents (so AI and parsing add value), the user is clear (the credit officer), and the partner's own figures show the scale."]));

children.push(H2("2. The idea in simple words"));
children.push(P("Instead of the officer reading the statement, the computer reads it — every line, with its date, amount and description. It sorts the lines into categories (business income, family transfers, the borrower's own transfers between their cards, loan repayments, household spending). It takes the last 12 months of business income, computes the average, and applies the Central Bank rule to get the debt-burden ratio and the maximum loan the borrower can afford. At the same time it checks whether the statement itself looks genuine (do the balances add up line by line?), scores the risk with a small machine-learning model, writes a short memo, and records everything in an audit log. The officer sees all of this on one screen, clicks the figures to see the exact lines behind them, and records the decision."));
children.push(P("Two things make the design unusual. First, there is no server and no API: the whole engine runs inside the officer's browser, so the customer's data never leaves the computer and the marginal cost per application is zero. Second, there is no large language model in the product: every component is a deterministic parser, rule or small model that can be audited, and the only text generation is a template whose numbers are checked by a verifier."));

// ===== PART B =====
children.push(H1("Part B — What we did during the final, step by step"));
children.push(P("Everything below was done inside the build window. The list is in the order we actually worked."));
children.push(step([B("Chose the problem. "), "We started from the hackathon brief, compared several ideas (credit scoring for thin-file borrowers, an income-evidence engine, a compliance assistant) and picked the income-evidence engine because it has a legal rule to check against, a clear user, a partner with published figures and a demo that can be run on the jury's own documents."]));
children.push(step([B("Read the regulation. "), "We studied the Central Bank regulation that governs bank lending to individuals since 24 July 2025 — Regulation No. 3618 \"on macroprudential norms set for banks and on the maximum values of payments on loans (microloans) issued by them\" (Central Bank of the Republic of Uzbekistan, 2025) — clause by clause: how the ratio is defined (clause 2), the 50 % limit and the two 15 % quotas (clause 3), which loans are exempt — individual entrepreneurs, family-entrepreneurship programmes, education loans (clause 4), which obligations count and when a guarantor counts — only if the guaranteed loan is more than 30 days late (clause 7), how long loans are spread over 36, 60 or 180 months (clause 8), the 3-working-day window between calculation and issue (clause 12), how income is averaged over 6 to 12 months (clause 13) with the option to use the median when it is lower (clause 14), that receipts on the borrower's bank accounts count as income (clause 18) and what documented evidence looks like (clause 19). We also checked the older regulation No. 3205 (Central Bank of the Republic of Uzbekistan, 2019): since July 2025 it covers only microfinance organisations and pawnshops, so it does not apply to MKBANK. The exact Uzbek wording is in docs/REGULATION_QUOTES.md, so every rule in the code points to a quote."]));
children.push(step([B("Collected public anchors. "), "Average wages from stat.uz, MKBANK's own published figures and product terms (Ommabop 2 up to 50 million, Express and Business Online 2 up to 100 million, the family-entrepreneurship programme), and the licences of every library we planned to use. All of this is in docs/DATA_SOURCES.md."]));
children.push(step([B("Built a synthetic data generator, because real data is not allowed. "), "We wrote a Python program that invents borrowers from ten realistic archetypes (market seller, taxi driver, tailor, tutor, courier and so on), simulates 24 months of daily transactions for each (income, family transfers, own-card transfers, rent, utilities, loan repayments, household spending), and then renders the result as real documents: PDF statements in two bank layouts (Russian and Uzbek labels), Excel and CSV exports, receipt photos passed through a camera model (blur, tilt, shadows), and Soliq-style self-employed certificates with a QR code. It also produces tampered statements of four kinds (an inflated inflow, a deleted debit, a duplicated row, and \"window dressing\" — round-sum deposits just before the application). We generated 2,000 borrowers, 60 rendered statements, 180 receipt photos and 40 tampered statements. Every parameter is in the repository and one command regenerates everything."]));
children.push(step([B("Designed the features and trained the risk model. "), "From each borrower's transactions we compute 18 cash-flow features (income level, stability, trend, share of business income, cash buffer in months, repayment burden, and so on). We trained a gradient-boosted-tree model (XGBoost; Chen and Guestrin, 2016) with monotone constraints — meaning the risk committee can confirm that, for example, more stable income can only lower the score, never raise it. We compared it with logistic regression and with the debt-burden ratio alone, and exported the model as a plain JSON file so that the browser can run it without any server."]));
children.push(step([B("Checked the method on real anonymised data. "), "Because a model trained on our own synthetic population only proves the pipeline, we ran the same 18 features on the public Berka data set (Berka and Sochorová, 1999; a real Czech bank, 443 loans of which 44 went bad). The cash-flow features carry real signal there too (AUC 0.90 versus 0.74 for the ratio alone)."]));
children.push(step([B("Built the web application. "), "A Next.js site exported as static files, with four pages: Home, New case (the working screen), Model card (all measured numbers, read live from JSON files) and About. All the engine code lives in the browser: PDF reading with coordinates, Excel/CSV reading, receipt OCR in Uzbek Latin, Uzbek Cyrillic, Russian and English, the categoriser, the rule engine, the risk model, the integrity checks, the memo with its verifier, and the hash-chained audit log."]));
children.push(step([B("Tested it like a product, not like a demo. "), "22 unit tests (including a 300-scenario sweep that proves the memo never contains an unsourced number), 7 tests on statement layouts the parser had never seen, an end-to-end run through the real deployed app in a headless browser with screenshots, and evaluation scripts that measure statement parsing, tamper detection and receipt OCR through the real app and write the results into JSON files that the Model card page displays."]));
children.push(step([B("Wrote the documentation. "), "README (how to run, deploy and reproduce everything), ARCHITECTURE, DATA_SOURCES with licences, MODEL_CARD, REGULATION_QUOTES, an MIT licence and a GitHub Actions workflow that runs the tests and the build on every push."]));
children.push(step([B("Built the defence deck. "), "Ten slides plus three appendix slides, generated from code so that every number on the slides is read from the same JSON files as the website. Exported as PPTX and PDF, with QR codes to the live site and the repository."]));
children.push(step([B("Published the code and deployed the site. "), "The repository was pushed to GitHub (hmunisbekk-droid/TYS-fintech) and imported into Vercel with the root directory set to apps/web. No environment variables or API keys are needed. The live address (tys-fintech.vercel.app) was then added to the deck and the README."]));
children.push(step([B("Applied two rounds of external review. "), "Round one: fixed the mobile layout, the memo verifier, a ten-fold error in the ROI arithmetic, borrower names and genders in the samples, and made the parsers handle Unicode minus signs, quoted CSV fields and type columns; the receipt fields became part of the integrity checks. Round two: a false \"skipped line\" warning removed, a slide overflow fixed, and a safety net added so that a statement whose rows have no debit/credit direction cannot be counted as pure income — it raises a high-severity finding and goes to the committee."]));
children.push(step([B("Made the parser work on real wallet and bank exports. "), "We tested it locally on genuine wallet exports (a combined date-and-time column, a payment-number column, a +/− type column, no balance column) and on the common Russian bank layout with two date columns (operation date and posting date), document numbers and 20-digit account numbers. The parser was broadened: the first date column is always the transaction date, later date columns are never read as amounts, long digit-only identifiers are never amounts, and numeric columns are mapped to debit/credit/balance by the header column boundaries. A 25-page PDF of that layout is now a test fixture. The real files were used only on our own machine — nothing from them is in the repository, the samples or the deck."]));
children.push(step([B("Closed the security and traceability items. "), "The spreadsheet library was moved from the last npm release (0.18.5, two known advisories) to SheetJS 0.20.3; the production dependency audit is clean. Every audit-log entry now records the versions of the rule engine, the parsers, the categoriser and the model, and those versions are bumped on every change, so an old result can never be confused with a new one."]));
children.push(step([B("Cleaned up and checked the rules. "), "Unimportant files were removed from the folder; we confirmed there is no hard-coded answer anywhere (the jury's own documents work), no real personal data, all libraries are listed with licences, and that after the deadline we only redeploy the submitted commit and push nothing new."]));

children.push(pageBreak());

// ===== PART C =====
children.push(H1("Part C — How the system works"));
children.push(H2("3. What the credit officer sees"));
children.push(P("Open the live site and click New case. The page is one long form, read from top to bottom:"));
children.push(bullet([B("Documents. "), "The officer drops in the borrower's files: a statement (PDF with a text layer, Excel or CSV), the self-employed certificate (PDF) and receipt photos (JPG/PNG). For the demo there are buttons to load three synthetic borrowers (A, B, C), a tampered statement and a window-dressed one. Each document shows what was read from it: period, card number mask, holder name, number of lines, parsing time, and for receipts the OCR fields (total, INN, date, receipt number) with a confidence value — low-confidence fields are marked for the officer to confirm rather than guessed."]));
children.push(bullet([B("The request. "), "Product (Ommabop 2, Express, Business Online 2, family programme), amount, term, rate per annum and a table of existing obligations (what the borrower already pays each month)."]));
children.push(bullet([B("Income. "), "A chart of the last 12 months: business revenue separated from family transfers, with the borrower's own card-to-card transfers excluded. The 12-month average is the regulatory income figure."]));
children.push(bullet([B("Debt-burden ratio (DBR). "), "Monthly payments divided by monthly income, the 50 % cap, the maximum affordable amount, and the exemption status. Every line cites the clause it comes from, and clicking the clause shows the quoted text. A \"what-if\" slider lets the officer drag the requested amount and watch the ratio cross the cap and the recommendation change."]));
children.push(bullet([B("Integrity. "), "The list of checks on the documents, each with a severity (high, medium, low) and a plain-language result. A failed balance chain names the exact line that does not add up."]));
children.push(bullet([B("Risk. "), "A probability of default, a band (low, medium, high) and the five features that pushed the score most, with a sentence each."]));
children.push(bullet([B("Credit memo. "), "A one-page text with the income figure, the ratio, the checks and the recommendation. A badge says how many numbers in the memo were checked and how many were unsourced — the answer is always zero, because the verifier refuses to publish a memo with a number it cannot trace."]));
children.push(bullet([B("Decision and audit. "), "The officer records approve, approve with a reduced amount, refer to committee or decline, with a comment. Every event (document added, engine version, analysis run, decision) is chained with SHA-256 hashes, and the case can be exported as a JSON file with the chain."]));

children.push(H2("4. What happens inside — eight steps"));
children.push(P("When a file is dropped on the page, the following happens, in order, inside the browser."));

children.push(P([B("Step 1 — Reading the documents. ")]));
children.push(P("A PDF statement is opened with pdf.js (Mozilla, 2025), which gives us every word with its position on the page. We find the header row (date, description, debit, credit, balance in Russian, Uzbek or English), then cluster the numbers by their horizontal position so that each column is recognised even in a layout we have never seen. Excel and CSV files are read with SheetJS (SheetJS LLC, 2024); we find the header row by its words, understand many column conventions (separate debit/credit columns, one signed amount column, a type column that says credit/debit, inflow/outflow (in Uzbek or Russian) or +/−), skip failed or cancelled payments, and ignore identifier columns such as payment numbers. Amounts are cleaned of spaces, non-breaking spaces, currency words and Unicode minus signs. Receipt photos go through Tesseract OCR (Smith, 2007) with Uzbek, Russian and English models hosted in our own site; we then pull out the total, the seller's INN, the date and the receipt number with pattern rules. The self-employed certificate is read for the name, INN, registration date and status."));

children.push(P([B("Step 2 — Sorting every line. ")]));
children.push(P("Each transaction gets a category from a rule-based categoriser with keywords in three languages: business revenue (payments from customers, terminal and QR receipts, marketplace payouts), family transfers (named relatives, regular round-sum transfers), own transfers (between the borrower's own cards), loan repayments, utilities and rent, household spending, cash withdrawals. Repeated counterparties are recognised so that a customer who pays every week is counted as revenue, while a relative who sends money every month is not."));

children.push(P([B("Step 3 — Building the income figure. ")]));
children.push(P("We take the months before the application date for which the statement has data — at least 6 and at most 12, as clause 13 requires — add the business-revenue inflows per month and compute the arithmetic mean (one-twelfth of twelve months, or one-sixth to one-eleventh when fewer exist). Receipts on the borrower's own bank accounts are accepted evidence under clause 18. If the median month is lower than the mean, clause 14 lets the bank use the median, and the screen has a switch for that. Family transfers and the borrower's own transfers are shown but not counted. With fewer than 6 months the ratio is only indicative and the case goes to the committee."));

children.push(P([B("Step 4 — The rule engine (DBR). ")]));
children.push(P("Monthly payments of the new loan and of every existing obligation are divided by the income figure. Long loans are spread: a microloan over 36 months is treated as 36, another loan over 60 months as 60, a mortgage over 180 as 180 (clause 8). Co-borrowers always count; guarantors only if the guaranteed loan is more than 30 days overdue (clause 7). The ratio must stay at or below 50 % (clause 3). Between 50 % and 100 % a bank may still lend, but only inside a quota of 15 % of its outstanding loans — a bank-level decision, so the engine sends such a case to the committee. A self-employed person registered less than six months ago may, for an income-generating loan, be financed without the ratio inside another 15 % quota, and the engine flags that eligibility. Loans under family-entrepreneurship programmes, to individual entrepreneurs and for education are exempt (clause 4), and the screen says so. Finally the engine back-solves the maximum amount at which the ratio is exactly at the limit, so the officer immediately sees what can be offered. Every output line carries its clause reference."));

children.push(P([B("Step 5 — Integrity checks. ")]));
children.push(P("Ten checks ask whether the documents are plausible: does the running balance add up line by line (a single edited or deleted row breaks the chain and the check names it); are there duplicated rows; does the statement cover the whole 12 months and are there unexplained gaps; are there unusually large round-sum deposits in the 45 days before the application compared with the earlier rate (window dressing); do the same amounts go out and come back (circular transfers); does the account holder's name match the certificate; does the opening balance match; do the receipts carry the borrower's own INN and do their totals appear in the statement; and — the safety net added after review — could the direction of every row actually be determined, because a statement with no debit/credit information would otherwise look like pure income. A high-severity finding sends the case to the committee instead of an automatic approval."));

children.push(P([B("Step 6 — The risk score. ")]));
children.push(P("The 18 features are computed in the browser with code that is tested line by line against the Python version used in training. The exported XGBoost trees are walked in TypeScript to give a probability of default and a band. Attribution is done one feature at a time (what happens to the score if this feature is set to a typical value), which gives the officer five plain sentences such as \"a cash buffer below one month of income raised the score\"."));

children.push(P([B("Step 7 — The credit memo and its verifier. ")]));
children.push(P("The memo is a template, not a language model. While the engine runs, every figure it produces is registered as a fact with a value, a display string and a source (a document and line, a clause, or a check). The template is filled from those facts only. Before the memo is shown, a verifier scans the text for every number and checks that it matches a registered fact; dates, clause numbers and section numbers are recognised and ignored. If a single number is unsourced the memo is marked and not published. A test runs 300 scenarios (five borrowers, four products, five amounts, three terms, including exemptions, referrals and declines) and confirms zero unsourced numbers."));

children.push(P([B("Step 8 — Decision and audit log. ")]));
children.push(P("Each event is appended to a log in which every entry includes the SHA-256 hash of the previous entry, so no entry can be changed or removed afterwards without breaking the chain. In the prototype the chain lives in the browser; in production the latest hash is written to the bank's database and signed by the officer's login, which turns integrity into provenance."));

children.push(H2("5. Where it runs and why"));
children.push(P("The site is a set of static files on Vercel; there is no backend, no database and no API key anywhere in the product. All parsing, OCR, rules, scoring and memo writing happen in the browser tab, so a customer's statement never leaves the officer's computer, and the cost of one more application is zero. For the bank this is also the production design: the same bundle is served from the bank's own web server, inside its perimeter, and the obligations table becomes a pull from the credit bureau (KATM) while statements of MKBANK's own account holders come straight from the core banking system instead of an upload."));

// ===== PART D =====
children.push(H1("Part D — Results, business case and honest limits"));
children.push(H2("6. How we got data without using any real data"));
children.push(P("The hackathon forbids real personal data, and no partner data was available, so we declared a synthetic population instead of hiding one. The generator anchors incomes to published average wages, uses ten borrower archetypes with different stability and seasonality, simulates two years of daily transactions with realistic descriptions, and renders them through a real browser into the same kinds of files a borrower would bring. The 60 rendered statements, 180 receipt photos and 40 tampered statements are the test set for the parsers and the integrity checks; the 2,000 borrowers are the training set for the risk model. Because a synthetic population can only prove that the pipeline learns the structure we built into it, we additionally ran the same features on the real anonymised Berka data set to show that the method carries signal on real statements. The jury can regenerate the whole data set with one command, and the summary of its parameters is committed in the repository."));

children.push(H2("7. How we checked that it works"));
children.push(P("All figures below are produced by code in the repository and read by the Model card page of the live site."));
children.push(table(
  ["What we measured", "Result", "Where it is"],
  [
    ["Statement parsing on 60 synthetic PDFs (2 layouts, Russian/Uzbek labels)", "Row count exact on 60/60; balance chain reconciles on 60/60; about 1.6 s per 12-month statement", "public/model/statement_eval.json"],
    ["Tamper detection (inflated inflow, deleted debit, duplicated row, window dressing)", "40/40 caught (10/10 for each type); 0 false alarms on the 60 clean statements", "public/model/statement_eval.json"],
    ["Statement layouts the parser had never seen (signed CSV, Kirim/Chiqim Excel, quoted English CSV with type column, Unicode minus, headerless CSV, Russian inflow/outflow TSV, wallet export, Russian bank export with two date columns)", "8/8 exact row counts and credit/debit totals", "public/model/ood_eval.json"],
    ["A 25-page Russian bank PDF with two date columns (operation / posting), document numbers, 20-digit accounts and wrapped lines", "1,346/1,346 rows, totals exact, operation date kept, balance chain intact", "apps/web/tests/pdf_layout.test.ts"],
    ["Receipt OCR on 60 camera-style photos, in the browser", "Total 95 %, INN 100 %, date 97 %, receipt number 98 %; 1.6 s each", "public/model/ocr_eval.json"],
    ["Transaction categoriser against ground truth (10,481 lines)", "99.96 % (on the generator's own vocabulary — will be lower on real data)", "public/model/categorizer_eval.json"],
    ["Risk model on a synthetic hold-out set (500 borrowers)", "ROC-AUC 0.965; logistic regression 0.963; ratio alone 0.948; Brier 0.042", "public/model/metrics.json"],
    ["Same method on real anonymised bank data (Berka, 443 loans, 44 bad, 5-fold)", "ROC-AUC 0.902 (trees), 0.895 (logistic), 0.735 (ratio alone); 95 % interval about 0.86–0.94", "public/model/berka_metrics.json"],
    ["Memo faithfulness, 300-scenario sweep", "0 unsourced numbers", "apps/web/tests/engine.test.ts"],
    ["Cost per application", "Zero marginal cost: static hosting, no API, no GPU", "—"],
  ],
  [3400, 3600, 2026],
));
children.push(gap());
children.push(P([I("How to read the two AUC values. "), "AUC (area under the ROC curve) is a score between 0.5 (coin toss) and 1.0 (perfect) for how well a model ranks bad borrowers above good ones. The 0.965 on synthetic data shows that the pipeline works end to end; it says nothing about the real world. The 0.90 on Berka shows that cash-flow features of the kind we compute carry real signal on real statements. Neither is a production number; the pilot's first job is to retrain on the bank's own outcomes."]));

children.push(H2("8. The business case for MKBANK"));
children.push(P("A three-month pilot in five branches with fifty mahalla agents costs about 190 million UZS: our three people plus one bank analyst, one small virtual machine, no GPU, no licences and no API spend. The value rests on two assumptions that the pilot exists to measure: document handling falls from about 90 to about 25 minutes per application, and about 30 % of MKBANK's 140,000 micro-project applications are addressable (those outside the DBR-exempt family programme; a bank has no small-loan threshold). That gives 42,000 applications a year, about 45,000 officer-hours saved, the work of 23 full-time officers, roughly 4 billion UZS a year at a loaded monthly cost of 15 million per officer. The pilot alone does not pay for itself in five branches; the bank-wide roll-out repays it within its first month, and within two months even if only 10 % of applications are addressable. Every term of this calculation is a slider in the deck."));

children.push(H2("9. What is still missing — said plainly"));
children.push(bullet("The risk model is trained on a declared synthetic population. Its accuracy there proves the pipeline, not real-world performance. Retraining on the bank's own data inside its perimeter is the pilot's first deliverable."));
children.push(bullet("The categoriser's 99.96 % is measured on the generator's own vocabulary; on real descriptions it will be lower and needs the bank's merchant lexicon."));
children.push(bullet("Scanned statements without a text layer (photographed or image-only PDFs) are not OCR'd page by page yet; the Excel or CSV export of the same statement works."));
children.push(bullet("The audit chain in the prototype proves integrity, not provenance; production anchors the latest hash in the bank's database under the officer's login."));
children.push(bullet("The credit-bureau (KATM) pull and the core-banking pull for MKBANK's own account holders are designed but not connected — in the prototype the obligations are typed in and the statements are uploaded."));
children.push(bullet("Statements photographed or scanned without a text layer still need page-by-page OCR; and a bank statement whose columns carry none of the usual header words would fall back to balance-chain inference, which the integrity check flags."));
children.push(gap());
children.push(callout([B("One line to remember: "), "Daromad turns the statements a self-employed borrower already has into a regulator-compliant, tamper-checked, fully traceable credit decision — in the browser, in under a minute, at zero marginal cost."]));

// ===== PART E =====
children.push(H1("Part E — Links and glossary"));
children.push(H2("10. Links and files"));
children.push(bullet([B("Live prototype: "), link("https://tys-fintech.vercel.app"), " — open New case, load a sample or upload your own statement and receipt."]));
children.push(bullet([B("Repository: "), link("https://github.com/hmunisbekk-droid/TYS-fintech"), " — code, tests, documentation, synthetic-data generator, model training, deck."]));
children.push(bullet([B("Model card page: "), link("https://tys-fintech.vercel.app/model/"), " — all measured numbers, read live from the JSON files."]));
children.push(bullet([B("Deck: "), "deck/Daromad_TYS_deck.pptx and .pdf (10 slides + 3 appendix slides), generated by deck/build_deck.js from the same JSON files as the website."]));
children.push(bullet([B("Documentation: "), "README.md, docs/ARCHITECTURE.md, docs/DATA_SOURCES.md (data sources and licences), docs/MODEL_CARD.md, docs/REGULATION_QUOTES.md."]));

children.push(H2("11. Glossary"));
children.push(table(
  ["Term", "What it means"],
  [
    ["debt-burden ratio (DBR)", "Monthly loan payments divided by monthly income. For bank loans the Central Bank limits it to 50 % (Regulation 3618, clause 3)."],
    ["Thin-file borrower", "A person with little or no credit history and no formal income documents — typical for the self-employed."],
    ["15 % quotas", "Two bank-level allowances in clause 3 of Regulation 3618: up to 15 % of a bank's outstanding loans may carry a ratio between 50 % and 100 %, and up to 15 % may go to newly registered self-employed persons without the ratio. Both are decided at bank level, so Daromad refers such cases to the committee instead of approving them."],    ["KATM", "The credit bureau (Credit Information Analytical Centre). It tells a bank what a borrower owes and how they repaid; Daromad tells the bank what the borrower earns. In production the obligations table is a KATM pull."],
    ["DPD", "Days past due — how many days a payment is late. 30+ DPD is the threshold at which a guaranteed loan starts to count against the guarantor (clause 7)."],
    ["Rate p.a.", "Interest rate per annum (per year), used to compute the monthly payment of the requested loan."],
    ["OCR", "Optical character recognition — turning a photo of text into text. We use Tesseract with Uzbek Latin, Uzbek Cyrillic, Russian and English models, hosted on our own site."],
    ["Balance chain", "On a statement, each line's balance must equal the previous balance plus the credit minus the debit. If one line was edited or deleted, the chain breaks at that line."],
    ["Window dressing", "Depositing round sums shortly before applying for a loan to make income look higher. Detected by comparing the last 45 days with the earlier rate."],
    ["AUC", "Area under the ROC curve: a 0.5–1.0 score for how well a model ranks risky borrowers above safe ones."],
    ["Monotone constraints", "A rule given to the model during training: a feature may only push the risk in one direction (for example, more income may only lower the risk). It makes the model acceptable to a risk committee."],
    ["Hash chain", "Each audit record contains the fingerprint (SHA-256 hash) of the previous record, so changing any record afterwards is detectable."],
    ["Static export", "The website is a set of ready files (HTML, JavaScript) with no server-side code, so it can be hosted anywhere, including inside the bank."],
    ["Synthetic data", "Data invented by a program according to declared rules, not taken from real people. Used because real personal data is forbidden in the hackathon."],
  ],
  [2400, 6626],
));
children.push(gap());

children.push(H2("12. References (Westminster Harvard)"));
children.push(P([I("Author–date citations in the text refer to this list; sources are listed alphabetically by author or organisation.")]));
const REFS = JSON.parse(fs.readFileSync(path.join(__dirname, "references.json"), "utf8"));
for (const r of REFS) {
  children.push(new Paragraph({ spacing: { after: 100, line: 276 }, indent: { left: 400, hanging: 400 },
    children: [run(r.a + " " + (r.pre ? r.pre + " " : "")), run(r.it, { italics: true }), run(" " + r.post)] }));
}

// ---------- document ----------
const doc = new Document({
  creator: "Team TYS",
  title: "Daromad — our project explained in simple words",
  description: "Plain-language, step-by-step description of the Daromad prototype built for the FinTech / AI in Finance hackathon final.",
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: HFONT, size: 32, bold: true, color: GREEN }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: HFONT, size: 26, bold: true, color: GREEN }, paragraph: { spacing: { before: 260, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } }, run: { color: GOLD } } }] },
      { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 600, hanging: 420 } }, run: { bold: true, color: GREEN } } }] },
    ],
  },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Daromad · Team TYS · project explained", font: FONT, size: 18, color: GREY })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Page ", font: FONT, size: 18, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: GREY }), new TextRun({ text: " of ", font: FONT, size: 18, color: GREY }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 18, color: GREY })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(OUT, buf); console.log("wrote", OUT, buf.length, "bytes"); });
