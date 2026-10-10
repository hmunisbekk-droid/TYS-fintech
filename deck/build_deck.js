// Builds deck/Daromad_TYS_deck.pptx from the evaluation JSON and screenshots. Run: node build_deck.js [VERCEL_URL]
const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const Fi = require("react-icons/fi");
const { applyTheme } = require(process.env.PPTX_SKILL + "/scripts/apply_theme.js");

const SITE = process.argv[2] || "https://<your-project>.vercel.app";
const REPO = "https://github.com/hmunisbekk-droid/TYS-fintech";
const IMG = path.join(__dirname, "img");
const M = JSON.parse(fs.readFileSync(path.join(__dirname, "../apps/web/public/model/metrics.json")));
const B = JSON.parse(fs.readFileSync(path.join(__dirname, "../apps/web/public/model/berka_metrics.json")));
const O = JSON.parse(fs.readFileSync(path.join(__dirname, "../apps/web/public/model/ocr_eval.json")));
const SE = JSON.parse(fs.readFileSync(path.join(__dirname, "../apps/web/public/model/statement_eval.json")));
const CE = JSON.parse(fs.readFileSync(path.join(__dirname, "../apps/web/public/model/categorizer_eval.json")));
const SUM = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/synthetic/summary.json")));
const OOD = JSON.parse(fs.readFileSync(path.join(__dirname, "../apps/web/public/model/ood_eval.json")));

const THEME = {
  name: "Daromad",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: { dk1: "17201B", lt1: "FFFFFF", dk2: "1F4E3D", lt2: "E9F1EC", accent1: "1F4E3D", accent2: "D98E04", accent3: "2E7D5B",
    accent4: "5C6B63", accent5: "B23A3A", accent6: "8FB8A5", hlink: "1F4E3D", folHlink: "5C6B63" },
};
const HEX = THEME.colors;
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.author = "Team TYS"; pres.title = "Daromad — Income Evidence Engine"; pres.subject = "FinTech / AI in Finance hackathon final";
const C = pres.SchemeColor;

async function icon(name, color, size = 256) {
  const el = React.createElement(Fi[name], { color: "#" + color, size });
  const svg = ReactDOMServer.renderToStaticMarkup(el);
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// ---- layouts
pres.defineSlideMaster({ title: "DARK", background: { color: HEX.dk2 },
  objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.7, y: 2.3, w: 11.9, h: 1.4, fontSize: 44, bold: true, color: HEX.lt1, margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 3.8, w: 11.9, h: 2.4, fontSize: 18, color: HEX.lt2, margin: 0 }, text: "" } },
    { text: { text: "Daromad · team TYS · FinTech / AI in Finance", options: { x: 0.7, y: 7.0, w: 8, h: 0.3, fontSize: 10, color: HEX.accent6, margin: 0 } } }] });
pres.defineSlideMaster({ title: "CONTENT", background: { color: HEX.lt1 },
  objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 28, bold: true, color: HEX.dk2, margin: 0, valign: "top", align: "left" }, text: "" } },
    { text: { text: "Daromad · team TYS", options: { x: 0.6, y: 7.05, w: 4, h: 0.3, fontSize: 9, color: HEX.accent4, margin: 0 } } }],
  slideNumber: { x: 12.3, y: 7.05, w: 0.6, h: 0.3, fontSize: 9, color: HEX.accent4 } });

const notesFor = {};
function slide(master, section, title, notes) {
  const s = pres.addSlide({ masterName: master, sectionTitle: section });
  if (title) s.addText(title, { placeholder: "title" });
  if (notes) s.addNotes(notes);
  return s;
}
function tile(s, x, y, w, h, value, label, opts = {}) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: opts.dark ? HEX.accent1 : HEX.lt2 }, line: { color: opts.dark ? HEX.accent1 : HEX.lt2 }, rectRadius: 0.08, objectName: `tile ${label}` });
  s.addText(value, { x: x + 0.15, y: y + 0.08, w: w - 0.3, h: h * 0.55, fontSize: opts.vsize || 28, bold: true, color: opts.dark ? HEX.lt1 : HEX.dk2, margin: 0, isTextBox: true, valign: "middle", objectName: `tile value ${label}` });
  s.addText(label, { x: x + 0.15, y: y + h * 0.58, w: w - 0.3, h: h * 0.4, fontSize: opts.lsize || 11, color: opts.dark ? HEX.accent6 : HEX.accent4, margin: 0, isTextBox: true, valign: "top", objectName: `tile label ${label}` });
}
function card(s, x, y, w, h, name) {
  s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: HEX.lt2 }, line: { color: HEX.lt2 }, rectRadius: 0.08, objectName: name });
}
function bullets(s, items, x, y, w, h, size = 15, color = HEX.dk1) {
  s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1, paraSpaceAfter: 6 } })),
    { x, y, w, h, fontSize: size, color, margin: 0, isTextBox: true, valign: "top", objectName: "bullets" });
}
const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";

(async () => {
  const ic = {};
  for (const [k, c] of [["FiFileText", HEX.lt1], ["FiTag", HEX.lt1], ["FiTrendingUp", HEX.lt1], ["FiBookOpen", HEX.lt1], ["FiCpu", HEX.lt1], ["FiShield", HEX.lt1], ["FiCheckCircle", HEX.lt1],
    ["FiLock", HEX.dk2], ["FiUsers", HEX.dk2], ["FiCheck", HEX.accent3], ["FiAlertCircle", HEX.accent2], ["FiGlobe", HEX.lt1], ["FiDatabase", HEX.dk2], ["FiLayers", HEX.dk2]]) ic[k] = await icon(k, c);

  // 1 — title
  pres.addSection({ title: "Opening" });
  let s = slide("DARK", "Opening", null, "Daromad, team TYS. Partner product for MKBANK's micro and family-business credit department. We remove the hour an officer spends turning a self-employed borrower's statements into an income figure the regulator accepts. [0:15]");
  s.addText("Daromad", { x: 0.7, y: 1.5, w: 8, h: 1.2, fontSize: 60, bold: true, color: HEX.lt1, margin: 0, isTextBox: true, objectName: "brand" });
  s.addText("Income evidence for borrowers who have no payslip", { x: 0.7, y: 2.7, w: 11, h: 0.8, fontSize: 28, color: HEX.lt2, margin: 0, isTextBox: true, objectName: "tagline" });
  s.addShape(pres.ShapeType.roundRect, { x: 0.7, y: 3.8, w: 7.6, h: 0.6, fill: { color: HEX.accent2 }, line: { color: HEX.accent2 }, rectRadius: 0.1, objectName: "mode pill" });
  s.addText("Mode: Partner product — MKBANK, micro & family-business credit department", { x: 0.85, y: 3.8, w: 7.4, h: 0.6, fontSize: 15, bold: true, color: HEX.dk1, margin: 0, isTextBox: true, valign: "middle", objectName: "mode" });
  s.addText([{ text: "Team TYS  ", options: { bold: true } }, { text: "Munisbek (technical lead) · Jahongir (research & data) · Umida (compliance & business case)" }],
    { x: 0.7, y: 4.7, w: 11.5, h: 0.5, fontSize: 15, color: HEX.lt2, margin: 0, isTextBox: true, objectName: "team" });
  s.addText([{ text: "Live prototype  ", options: { bold: true } }, { text: SITE + "    " }, { text: "Repository  ", options: { bold: true } }, { text: REPO }],
    { x: 0.7, y: 5.3, w: 12, h: 0.5, fontSize: 13, color: HEX.accent6, margin: 0, isTextBox: true, objectName: "links" });
  s.addText("FinTech / AI in Finance · partners MKBANK and the Central Bank of Uzbekistan · final defence, October 2026", { x: 0.7, y: 6.3, w: 11.5, h: 0.4, fontSize: 12, color: HEX.accent6, margin: 0, isTextBox: true, objectName: "event" });

  // 2 — the clause-9 slide
  pres.addSection({ title: "Problem" });
  s = slide("CONTENT", "Problem", "The regulation names the evidence — the self-employed have exactly one line",
    "Show the regulation's list of acceptable income evidence. For a self-employed borrower only one line exists: income credited to bank accounts — no employer, no pension, income untaxed and unfiled. MKBANK targets about 140,000 micro-projects this year, by its own figures. Every one of them needs a documented income assessment, and every one outside the family programme needs a ПДН under 50 percent — for a bank there is no small-loan exclusion — computed from documents like these. Fiscal receipts exist only where the business uses an online cash register; we read them as corroboration, not as the income figure. [0:45]");
  s.addText("CBU regulation on the debt-burden ratio, cl.9 — income a lender may rely on", { x: 0.6, y: 1.4, w: 7.2, h: 0.4, fontSize: 14, bold: true, color: HEX.accent4, margin: 0, isTextBox: true, objectName: "list caption" });
  const ev = [["Employer-confirmed salary", "no employer — the borrower is the business", false], ["Pension", "working-age applicant, not a pensioner", false], ["Funded-pension contributions", "none: contributions come through an employer", false], ["Income credited to the borrower's bank accounts", "the only line a self-employed borrower has", true], ["Taxes paid", "self-employed income is untaxed; no return is filed", false], ["Interest, dividends, rental income", "rarely applicable; easy to document when it is", false]];
  ev.forEach(([t, why, hot], i) => {
    const y = 1.9 + i * 0.68;
    s.addShape(pres.ShapeType.roundRect, { x: 0.6, y, w: 7.2, h: 0.58, fill: { color: hot ? HEX.accent2 : HEX.lt2 }, line: { color: hot ? HEX.accent2 : HEX.lt2 }, rectRadius: 0.08, objectName: `evidence ${i}` });
    s.addImage({ data: hot ? ic.FiCheck : ic.FiAlertCircle, x: 0.75, y: y + 0.14, w: 0.3, h: 0.3, objectName: `evidence icon ${i}` });
    s.addText([{ text: String(t), options: { bold: true } }, { text: `  — ${why}` }], { x: 1.2, y, w: 6.5, h: 0.58, fontSize: hot ? 13.5 : 12, color: HEX.dk1, margin: 0, isTextBox: true, valign: "middle", objectName: `evidence text ${i}` });
  });
  tile(s, 8.3, 1.5, 4.4, 1.15, "50% cap", "ПДН limit for all loans since 1 Jan 2025 (cl.10); 12-month arithmetic mean of income (cl.7)", { dark: true });
  tile(s, 8.3, 2.85, 4.4, 1.15, "~140,000", "micro-projects MKBANK targets in 2026 (47,975 in 2025); 1,062 mahalla agents", { dark: true });
  tile(s, 8.3, 4.2, 4.4, 1.15, "60–90 min", "an officer's manual reading of 12 months of statements per application (our estimate; pilot measures it)", {});
  tile(s, 8.3, 5.55, 4.4, 1.15, "0 lines", "of official income records for ~790k registered self-employed (untaxed, unfiled, no cash register required)", {});
  s.addText("Sources: lex.uz/docs/4654149 and 6809992 (CBU regulation and 2024 amendments) · spot.uz 27 Mar 2026 (MKBANK, bank's own figures) · yuz.uz (self-employed registrations, 2021) · buxgalter.uz", { x: 0.6, y: 6.75, w: 12, h: 0.3, fontSize: 9, color: HEX.accent4, margin: 0, isTextBox: true, objectName: "sources" });

  // 3 — what the officer gets
  pres.addSection({ title: "Product" });
  s = slide("CONTENT", "Product", "What the officer gets in under five seconds",
    "This is the screen after Load sample A. Statement parsed in the browser, twelve months of regulatory income with business revenue separated, ПДН with each line citing its clause, maximum affordable amount, and a what-if slider. [part of demo narration]");
  s.addImage({ path: path.join(IMG, "income_pdn.png"), x: 0.6, y: 1.45, w: 8.6, h: 3.0, objectName: "screenshot income and pdn" });
  s.addImage({ path: path.join(IMG, "memo.png"), x: 0.6, y: 4.6, w: 8.6, h: 2.3, objectName: "screenshot memo" });
  const got = [["FiTrendingUp", "12-month regulatory income", "cl.7 mean, cl.9 definition; own-card transfers, loan proceeds, refunds and cash deposits excluded"],
    ["FiBookOpen", "ПДН with citations", "36-month spreading, guarantor rule, family-programme exemption, lender-type rules (banks: no small-loan exclusion, 15% quota is portfolio-level), 50% cap, maximum affordable amount"],
    ["FiShield", "Integrity report", "balance chain, duplicates, coverage, gaps, pre-application spikes, circular transfers, holder match"],
    ["FiCheckCircle", "Verified memo", "every number traces to its source — statement lines (click to open them), a clause, or the model; the verifier refuses unsourced numbers; hash-chained audit log"]];
  got.forEach(([icn, h, t], i) => {
    const y = 1.45 + i * 1.38;
    s.addShape(pres.ShapeType.ellipse, { x: 9.5, y: y + 0.05, w: 0.5, h: 0.5, fill: { color: HEX.accent1 }, line: { color: HEX.accent1 }, objectName: `got circle ${i}` });
    s.addImage({ data: ic[icn], x: 9.6, y: y + 0.15, w: 0.3, h: 0.3, objectName: `got icon ${i}` });
    s.addText(h, { x: 10.15, y, w: 2.7, h: 0.4, fontSize: 14, bold: true, color: HEX.dk2, margin: 0, isTextBox: true, objectName: `got head ${i}` });
    s.addText(t, { x: 10.15, y: y + 0.42, w: 2.7, h: 0.9, fontSize: 10.5, color: HEX.dk1, margin: 0, isTextBox: true, valign: "top", objectName: `got text ${i}` });
  });

  // 4 — live demo
  s = slide("CONTENT", "Product", "Live demo — on our samples and on anything you upload",
    "Open the public URL. Load sample A. Narrate: statement parsed, certificate read, receipt OCR'd in Uzbek; twelve months of income; ПДН just above 50 percent, so the engine computes the maximum affordable amount; drag the slider under it; integrity checks; the memo badge shows how many numbers were checked and that none is unsourced; click a citation to open the statement lines behind a figure; record the decision; export. If a judge hands you a receipt photo or a statement, upload it. Finish with Load tampered statement (it starts a fresh case): the balance-chain check fails and names the edited line. Keep the backup video open in a second tab. [2:00]");
  s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 1.45, w: 6.1, h: 1.3, fill: { color: HEX.accent1 }, line: { color: HEX.accent1 }, rectRadius: 0.1, objectName: "url box" });
  s.addImage({ data: ic.FiGlobe, x: 0.8, y: 1.85, w: 0.5, h: 0.5, objectName: "globe" });
  s.addText([{ text: "Open on your laptop or phone\n", options: { fontSize: 12, color: HEX.accent6 } }, { text: SITE, options: { fontSize: 18, bold: true, color: HEX.lt1 } }], { x: 1.45, y: 1.5, w: 5.1, h: 1.2, margin: 0, isTextBox: true, valign: "middle", objectName: "url" });
  const steps = ["Load sample A — statement PDF, Soliq certificate, receipt photo parse in the tab (no server, no API)",
    "Income series, ПДН with clause citations, maximum affordable amount; drag the slider to cross the 50% cap",
    "Integrity checks and risk score with drivers; click any evidence link to see the statement line",
    "Memo: verifier badge shows how many numbers were checked and that none is unsourced",
    "Record the decision; export the case with its hash-chained audit log",
    "Then: Load tampered statement — the balance chain breaks at the inflated inflow; upload your own documents"];
  s.addText(steps.map((t, i) => ({ text: `${i + 1}.  ${t}`, options: { breakLine: i < steps.length - 1, paraSpaceAfter: 7 } })), { x: 0.6, y: 2.95, w: 6.1, h: 3.9, fontSize: 12.5, color: HEX.dk1, margin: 0, isTextBox: true, valign: "top", objectName: "demo steps" });
  s.addImage({ path: path.join(IMG, "integrity_risk.png"), x: 7.0, y: 1.45, w: 5.8, h: 2.53, objectName: "screenshot integrity" });
  s.addImage({ path: path.join(IMG, "tamper.png"), x: 7.0, y: 4.15, w: 3.4, h: 1.75, objectName: "screenshot tamper" });
  s.addImage({ path: path.join(IMG, "qr_site.png"), x: 10.6, y: 4.05, w: 2.0, h: 2.0, objectName: "qr site" });
  s.addText("Scan to open the live prototype on your phone (New case → Load sample A)", { x: 7.0, y: 6.1, w: 5.8, h: 0.5, fontSize: 10, color: HEX.accent4, margin: 0, isTextBox: true, objectName: "qr caption" });

  // 5 — architecture
  pres.addSection({ title: "Technology" });
  s = slide("CONTENT", "Technology", "Seven components, one optional language model, zero API keys",
    "This is a system, not a prompt: parsing with coordinates, a multilingual categoriser, cash-flow reconstruction, a rule engine mapped clause by clause, boosted trees with monotone constraints, integrity checks, and a template memo with a verifier. No API key exists in this product. Production is the same bundle on the bank's server — the perimeter is literal. [0:45]");
  const comps = [["FiFileText", "1 · Intake", "pdf.js with coordinates; XLSX/CSV; tesseract.js OCR uzb+rus+eng, self-hosted; field confidence, tap-to-confirm"],
    ["FiTag", "2 · Categoriser", "multilingual rules + counterparty patterns (recurring payer → family; same mask both ways → own card)"],
    ["FiTrendingUp", "3 · Cash-flow", "12-month series; 18 features identical in TypeScript and Python (parity test)"],
    ["FiBookOpen", "4 · Rule engine", "ПДН clause by clause: 36/180-month spreading, guarantor rule, lender-type exclusions, family-programme exemption, 50% cap, back-solved amount"],
    ["FiCpu", "5 · Risk model", "XGBoost, monotone constraints, JSON trees evaluated in the browser; attributions vs portfolio median"],
    ["FiShield", "6 · Integrity", "balance chain, duplicates, coverage, gaps, round-sum spikes, circular transfers, holder match"],
    ["FiCheckCircle", "7 · Memo + audit", "template from a fact table; verifier rejects unsourced numbers; SHA-256 hash-chained log"]];
  comps.forEach(([icn, h, t], i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x = 0.6 + col * 3.1, y = 1.45 + row * 2.2, w = 2.95, hgt = 2.0;
    card(s, x, y, w, hgt, `component ${i}`);
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.15, y: y + 0.15, w: 0.5, h: 0.5, fill: { color: HEX.accent1 }, line: { color: HEX.accent1 }, objectName: `comp circle ${i}` });
    s.addImage({ data: ic[icn], x: x + 0.25, y: y + 0.25, w: 0.3, h: 0.3, objectName: `comp icon ${i}` });
    s.addText(h, { x: x + 0.75, y: y + 0.15, w: w - 0.9, h: 0.5, fontSize: 14, bold: true, color: HEX.dk2, margin: 0, isTextBox: true, valign: "middle", objectName: `comp head ${i}` });
    s.addText(t, { x: x + 0.15, y: y + 0.75, w: w - 0.3, h: hgt - 0.85, fontSize: 10.5, color: HEX.dk1, margin: 0, isTextBox: true, valign: "top", objectName: `comp text ${i}` });
  });
  s.addShape(pres.ShapeType.roundRect, { x: 9.9, y: 3.65, w: 2.95, h: 2.0, fill: { color: HEX.accent1 }, line: { color: HEX.accent1 }, rectRadius: 0.08, objectName: "perimeter card" });
  s.addImage({ data: ic.FiGlobe, x: 10.05, y: 3.8, w: 0.35, h: 0.35, objectName: "perimeter icon" });
  s.addText("Perimeter", { x: 10.5, y: 3.75, w: 2.2, h: 0.45, fontSize: 14, bold: true, color: HEX.lt1, margin: 0, isTextBox: true, valign: "middle", objectName: "perimeter head" });
  s.addText("Prototype: static site, every byte of a document stays in the browser. Production: the same bundle on the bank's server, SSO, audit log in the bank DB, core-banking pull for own customers. LLM optional, narrative only, behind the same verifier.", { x: 10.05, y: 4.25, w: 2.7, h: 1.35, fontSize: 10, color: HEX.lt2, margin: 0, isTextBox: true, valign: "top", objectName: "perimeter text" });
  s.addText("Speed: statement 1.2–1.8 s · receipt OCR 1.6 s · everything else < 50 ms · marginal cost per application: zero", { x: 0.6, y: 5.85, w: 9, h: 0.4, fontSize: 12, bold: true, color: HEX.dk2, margin: 0, isTextBox: true, objectName: "speed" });
  s.addText("Human in the loop: the engine recommends and computes the maximum affordable amount; the officer decides; an override needs a reason, written into the chain.", { x: 0.6, y: 6.25, w: 9, h: 0.5, fontSize: 11, color: HEX.dk1, margin: 0, isTextBox: true, objectName: "hitl" });

  // 6 — numbers
  s = slide("CONTENT", "Technology", "Measured through the real app, not typed into a slide",
    `Measured through the real app: statement parsing exact on ${SE.statements.rows_exact} of ${SE.statements.n} generator PDFs — and, more importantly, exact on ${OOD.exact_count} of ${OOD.n} layouts the parser had never seen: signed-amount CSV, Kirim/Chiqim Excel, quoted English CSV with a type column, Unicode minus, headerless, Приход/Расход TSV, and a Payme-style wallet export with a plus/minus type column and no balance. Tamper recall ${SE.tampered.detected} of ${SE.tampered.n} with no false alarms on clean statements; receipt OCR ${pct(O.total_ok_rate, 0)} on totals, ${pct(O.inn_ok_rate, 0)} on INN. Risk model: AUC ${M.xgb.auc.toFixed(3)} on our declared synthetic population — proves the pipeline, not the world. So we ran the same 18 features on real anonymised bank data, ${B.loans_used} loans from PKDD'99, 44 of them bad: AUC ${B.xgb_auc.toFixed(2)} out-of-fold, confidence interval roughly 0.86 to 0.94, versus ${B.pdn_only_auc.toFixed(2)} for the ratio alone. Logistic regression is close — we keep the trees for monotone constraints and thresholds, not for the last hundredth. [0:45]`);
  const tiles = [[`${SE.statements.rows_exact}/${SE.statements.n}`, "generator PDFs: exact rows, balance chain reconciled (2 layouts, RU/UZ)"],
    [`${OOD.exact_count}/${OOD.n}`, "unseen layouts exact — CSV/XLSX/TSV variants incl. a wallet export (list on the model card)"],
    [`${SE.tampered.detected}/${SE.tampered.n}`, "tampered statements caught, 4 tamper types; 0 false alarms on clean ones"],
    [pct(O.total_ok_rate, 0), `receipt OCR total exact, ${O.n} camera-augmented photos; INN ${pct(O.inn_ok_rate, 0)}, date ${pct(O.date_ok_rate, 0)}`],
    [M.xgb.auc.toFixed(3), `ROC-AUC, synthetic holdout n=${M.n_test}; logistic ${M.logreg_baseline.auc.toFixed(3)}, ratio alone ${M.pdn_only_auc.toFixed(3)}`],
    [B.xgb_auc.toFixed(3), `ROC-AUC, real bank data (Berka, ${B.loans_used} loans, 44 bad; 95% CI ≈ 0.86–0.94); ratio alone ${B.pdn_only_auc.toFixed(3)}`]];
  tiles.forEach(([v, l], i) => tile(s, 0.6 + (i % 3) * 2.45, 1.45 + Math.floor(i / 3) * 1.6, 2.3, 1.48, v, l, { vsize: 24, lsize: 9, dark: i >= 4 }));
  s.addChart(pres.ChartType.bar, [
    { name: "Synthetic holdout", labels: ["Ratio alone (ПДН)", "Logistic regression", "Boosted trees"], values: [M.pdn_only_auc, M.logreg_baseline.auc, M.xgb.auc] },
    { name: "Real data (Berka)", labels: ["Ratio alone (ПДН)", "Logistic regression", "Boosted trees"], values: [B.pdn_only_auc, B.logreg_auc, B.xgb_auc] }],
    { x: 8.1, y: 1.45, w: 4.7, h: 3.2, barDir: "col", chartColors: [HEX.accent6, HEX.accent1], showTitle: true, title: "ROC-AUC: what the model adds over the ratio", titleFontSize: 11, titleColor: HEX.dk2, titleFontFace: "+mn-lt",
      showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.00", dataLabelFontSize: 9, dataLabelColor: HEX.dk1, dataLabelFontFace: "+mn-lt",
      valAxisMinVal: 0.5, valAxisMaxVal: 1.0, valAxisLabelFontSize: 9, valAxisLabelColor: HEX.accent4, valAxisLabelFontFace: "+mn-lt", valGridLine: { color: HEX.lt2, size: 1 },
      catAxisLabelFontSize: 9, catAxisLabelColor: HEX.accent4, catAxisLabelFontFace: "+mn-lt", catGridLine: { style: "none" },
      showLegend: true, legendPos: "b", legendFontSize: 9, legendColor: HEX.accent4, legendFontFace: "+mn-lt" });
  s.addText(`Honest reading: on synthetic data the ratio already carries most of the signal by construction; on real statements the cash-flow features add +0.17 AUC over the ratio, and logistic regression comes close to the trees — we ship the trees for the monotone constraints and non-linear thresholds, not for the last 0.01. Categoriser: ${pct(CE.accuracy, 2)} on ${CE.n.toLocaleString("en-US")} lines of the generator's own vocabulary — will fall on real data. Memo verifier: 0 unsourced numbers across a 300-scenario sweep (amounts × terms × products × borrowers), enforced at run time.`, { x: 0.6, y: 4.75, w: 7.2, h: 1.0, fontSize: 10, color: HEX.dk1, margin: 0, isTextBox: true, objectName: "reading" });
  s.addImage({ path: path.join(IMG, "eval_kpis.png"), x: 0.6, y: 5.75, w: 6.4, h: 1.2, objectName: "screenshot eval" });
  s.addText("All numbers are read from JSON produced by ml/train.py, ml/berka_validate.py, npm test and tests/*_eval.py (see the Model card page).", { x: 8.1, y: 4.75, w: 4.7, h: 0.8, fontSize: 10, color: HEX.accent4, margin: 0, isTextBox: true, objectName: "provenance" });
  s.addText("Caveat on the slide, not in the footnote: the risk score is advisory until retrained on the bank's own history inside the perimeter — that is the pilot's first deliverable.", { x: 8.1, y: 5.6, w: 4.7, h: 1.3, fontSize: 11, bold: true, color: HEX.accent5, margin: 0, isTextBox: true, objectName: "caveat" });

  // 7 — synthetic data
  s = slide("CONTENT", "Technology", "No partner data, so we built a declared generator",
    "Ten archetypes anchored to stat.uz wages, 24 months of daily transactions, rendered to PDFs with a text layer in two layouts, receipts photographed through a camera model, four tamper types. Every parameter is in the repo. The jury can regenerate everything with one command. [0:30]");
  const gen = [["Archetypes", "10 trades (tailor, taxi, dehkan farmer, grocer, reseller, tutor…) with declared seasonality, customer counts, channel mix, expense structure"],
    ["Simulation", `${SUM.n_borrowers.toLocaleString("en-US")} borrowers · ${SUM.n_transactions.toLocaleString("en-US")} transactions · existing loans with annuity schedules · shocks · default label from a latent affordability score (${pct(SUM.default_rate)} rate)`],
    ["Rendering", `${SUM.rendered_borrowers} statement sets as PDF (text layer) + XLSX + CSV in RU and UZ layouts; ${SUM.receipts} fiscal receipts; Soliq-style certificates with QR`],
    ["Camera model", "perspective, rotation, lighting gradient, blur, sensor noise, JPEG — then measured through the same OCR the officer uses"],
    ["Tampering", `${SUM.tampered} statements: inflated inflow, deleted debit, duplicated row, window dressing — labelled for the integrity evaluation`]];
  gen.forEach(([h, t], i) => {
    const y = 1.45 + i * 1.05;
    s.addShape(pres.ShapeType.ellipse, { x: 0.6, y: y + 0.05, w: 0.55, h: 0.55, fill: { color: HEX.accent2 }, line: { color: HEX.accent2 }, objectName: `gen num bg ${i}` });
    s.addText(String(i + 1), { x: 0.6, y: y + 0.05, w: 0.55, h: 0.55, fontSize: 16, bold: true, color: HEX.dk1, align: "center", valign: "middle", margin: 0, isTextBox: true, objectName: `gen num ${i}` });
    s.addText(h, { x: 1.3, y, w: 6.2, h: 0.35, fontSize: 14, bold: true, color: HEX.dk2, margin: 0, isTextBox: true, objectName: `gen head ${i}` });
    s.addText(t, { x: 1.3, y: y + 0.36, w: 6.2, h: 0.65, fontSize: 10.5, color: HEX.dk1, margin: 0, isTextBox: true, valign: "top", objectName: `gen text ${i}` });
  });
  s.addImage({ path: path.join(IMG, "stmt-01.jpg"), x: 7.9, y: 1.45, w: 2.5, h: 3.54, objectName: "statement thumbnail" });
  s.addImage({ path: path.join(IMG, "receipt.jpg"), x: 10.55, y: 1.45, w: 2.25, h: 2.47, objectName: "receipt photo" });
  s.addText("Synthetic statement (Humo-style layout, Russian labels) and a camera-augmented synthetic fiscal receipt. No real person is represented; names come from a short public list, card numbers are random and masked.", { x: 7.9, y: 5.15, w: 4.9, h: 0.9, fontSize: 10, color: HEX.accent4, margin: 0, isTextBox: true, objectName: "image caption" });
  s.addText("Regenerate:  python -m synth.cli --n 2000 --render 60 --receipts 180 --tamper 40 --seed 42", { x: 7.9, y: 6.15, w: 4.9, h: 0.5, fontSize: 10, color: HEX.dk2, fontFace: "Courier New", margin: 0, isTextBox: true, objectName: "regen cmd" });
  s.addText("Also: methodology check on real anonymised bank data (Berka, PKDD'99) — not redistributed, downloaded by script.", { x: 0.6, y: 6.75, w: 7, h: 0.3, fontSize: 9, color: HEX.accent4, margin: 0, isTextBox: true, objectName: "berka note" });

  // 8 — pilot budget and ROI
  pres.addSection({ title: "Business" });
  s = slide("CONTENT", "Business", "Pilot: three months, five branches, fifty mahalla agents",
    "Cost: our three people plus one bank analyst, one small VM — no GPU, no licences, no API spend; marginal cost per application is zero; about 190 million for three months. Value, with two assumptions the pilot exists to measure: document handling falls from about 90 to 25 minutes, and about 30 percent of MKBANK's 140,000 micro-project applications are addressable — those outside the ПДН-exempt family programme; for a bank there is no small-loan threshold. That is 42,000 applications, 45,000 officer-hours, 23 full-time officers, about 4 billion sum a year at a 15-million loaded monthly cost. The pilot does not pay for itself in five branches; the roll-out does, within its first month. Even at a 10 percent addressable share it pays back within two months. Every term is a slider. [1:30]");
  s.addText("Cost to build and run the pilot (assumptions, UZS)", { x: 0.6, y: 1.4, w: 6.2, h: 0.4, fontSize: 14, bold: true, color: HEX.accent4, margin: 0, isTextBox: true, objectName: "cost caption" });
  const costRows = [["Line", "Assumption", "3-month cost"],
    ["Team: 3 engineers/analysts (TYS)", "3 × 3 months × 15M", "135M"],
    ["Bank credit analyst, part-time", "0.5 FTE × 3 months × 15M", "22.5M"],
    ["Infrastructure", "1 VM in the bank DC, no GPU", "≈ 3M"],
    ["Integration (core banking, bureau)", "bank IT, 20 person-days", "≈ 30M"],
    ["Data, licences, API spend", "none — open-source, no external API", "0"],
    ["Total pilot (≈ $15k)", "", "≈ 190M"]];
  s.addTable(costRows.map((r, i) => r.map((c, j) => ({ text: c, options: { bold: i === 0 || i === costRows.length - 1, fontSize: 10.5, color: i === 0 ? HEX.lt1 : HEX.dk1, fill: { color: i === 0 ? HEX.accent1 : i === costRows.length - 1 ? HEX.lt2 : HEX.lt1 }, align: j === 2 ? "right" : "left" } }))),
    { x: 0.6, y: 1.85, w: 6.2, colW: [2.5, 2.6, 1.1], rowH: 0.36, border: { type: "solid", color: HEX.lt2, pt: 0.5 }, objectName: "cost table" });
  s.addText("Running cost per application: zero marginal (static bundle; no API, no GPU). Optional narrative LLM on one on-prem GPU: well under 1 US cent per application.", { x: 0.6, y: 4.75, w: 6.2, h: 0.6, fontSize: 10.5, color: HEX.dk1, margin: 0, isTextBox: true, objectName: "run cost" });
  s.addText("Timeline: month 1 shadow mode (engine runs beside the manual process; we measure minutes and agreement) · months 2–3 assisted mode (officer works from the memo) · success metrics: minutes per application, agreement with committee, override rate, ПДН audit findings, retrained model AUC on bank history.", { x: 0.6, y: 5.45, w: 6.2, h: 1.4, fontSize: 10.5, color: HEX.dk1, margin: 0, isTextBox: true, objectName: "timeline" });
  s.addText("Value — the officer-hours formula (every term is a slider)", { x: 7.1, y: 1.4, w: 5.7, h: 0.4, fontSize: 14, bold: true, color: HEX.accent4, margin: 0, isTextBox: true, objectName: "value caption" });
  tile(s, 7.1, 1.85, 2.75, 1.2, "90 → 25 min", "document handling per application, before → with Daromad (assumption 1; the pilot measures it)", { vsize: 22, lsize: 9.5 });
  tile(s, 10.05, 1.85, 2.75, 1.2, "≈ 42,000 / yr", "addressable applications: 30% of MKBANK's 140,000 micro-projects (bank's own 2026 target) — those outside the ПДН-exempt family programme (assumption 2)", { vsize: 22, lsize: 8.5 });
  tile(s, 7.1, 3.2, 2.75, 1.2, "≈ 45,000 h", "officer-hours saved per year = 42,000 × 65 min ≈ 23 FTE-years at 2,000 h", { vsize: 22, lsize: 9.5, dark: true });
  tile(s, 10.05, 3.2, 2.75, 1.2, "≈ 4.1 bn UZS/yr", "23 FTE × 15M/month × 12 — officer time only; at a 10% addressable share ≈ 1.4 bn", { vsize: 20, lsize: 9.5, dark: true });
  s.addText([{ text: "Payback: ", options: { bold: true } }, { text: "the ≈ 190M pilot itself (5 of 181 branches, 3 months) does not pay back — it measures the two assumptions. After roll-out the saving of ≈ 4.1 bn/yr repays the pilot within its first month; at a 10% addressable share, within two months. Not counted: faster time-to-decision for the borrower, fewer ПДН compliance findings, better risk selection — claimed only after the pilot measures them." }],
    { x: 7.1, y: 4.55, w: 5.7, h: 1.5, fontSize: 10.5, color: HEX.dk1, margin: 0, isTextBox: true, objectName: "payback" });
  s.addText("Who pays: MKBANK (credit department / digital budget). Who owns: micro & family-business credit department; IT deploys; mahalla agents and loan officers use it.", { x: 7.1, y: 6.1, w: 5.7, h: 0.7, fontSize: 10.5, color: HEX.accent4, margin: 0, isTextBox: true, objectName: "owner" });

  // 9 — replication and next steps
  s = slide("CONTENT", "Business", "Hard to copy in a weekend — and what comes next",
    "What another team cannot rebuild in a weekend: the Uzbek layout corpus and parsers, the categoriser lexicon, the clause-mapped rule engine with its exemptions, the verifier that makes unsourced numbers impossible, and the calibrated synthetic population. Next: scanned-statement OCR, core-banking pull for MKBANK's own account holders, retraining inside the perimeter. Thank you. [0:30]");
  card(s, 0.6, 1.45, 6.0, 5.35, "replication card");
  s.addImage({ data: ic.FiLock, x: 0.8, y: 1.65, w: 0.4, h: 0.4, objectName: "lock icon" });
  s.addText("The replication test — what the same LLM tools do not give you", { x: 1.3, y: 1.6, w: 5.1, h: 0.5, fontSize: 14, bold: true, color: HEX.dk2, margin: 0, isTextBox: true, valign: "middle", objectName: "replication head" });
  bullets(s, ["Statement parsers that learn columns from the data rows (two Uzbek layouts today, any text-layer PDF, XLSX, CSV) and reconcile the balance chain",
    "A categoriser lexicon in Uzbek Latin, Cyrillic and Russian with counterparty-pattern rules — and the pilot plan to grow it on bank data",
    "A rule engine mapped clause by clause to the live ПДН regulation, with its exemptions and the back-solved maximum amount",
    "A memo verifier that makes unsourced numbers impossible — zero hallucination by construction, no LLM needed",
    "A declared, calibrated synthetic population with rendered documents, a camera model and labelled tampering — a test bed the bank can keep using",
    "Evaluation through the real app, reproducible with one command each"], 0.8, 2.25, 5.6, 4.4, 11.5);
  card(s, 6.9, 1.45, 5.9, 5.35, "next card");
  s.addImage({ data: ic.FiLayers, x: 7.1, y: 1.65, w: 0.4, h: 0.4, objectName: "layers icon" });
  s.addText("Next steps", { x: 7.6, y: 1.6, w: 5.0, h: 0.5, fontSize: 14, bold: true, color: HEX.dk2, margin: 0, isTextBox: true, valign: "middle", objectName: "next head" });
  bullets(s, ["Week 1–2: scanned-statement OCR page by page; lexicon growth on anonymised bank descriptions; Uzbek/Russian memo templates",
    "Month 1: shadow mode in 5 branches; core-banking pull for MKBANK's own account holders; credit-bureau REST for obligations",
    "Month 2–3: assisted mode; retrain the risk model on bank history inside the perimeter; set risk bands with the bank's risk appetite; fairness review by region",
    "After the pilot: Central Bank conversation — the same engine computes ПДН uniformly for any lender, a supervisory check at zero marginal cost",
    "Product scope today: Ommabop 2, Express, Business Online 2 (ПДН applies) and family-programme loans (exempt from the cap, capacity still assessed)"], 7.1, 2.25, 5.5, 4.4, 11.5);

  // 10 — closing
  pres.addSection({ title: "Closing" });
  s = slide("DARK", "Closing", "Daromad", "Thank you. Questions.");
  s.addText("Income evidence for borrowers who have no payslip — regulation-native, perimeter-native, verified.", { placeholder: "body" });
  s.addText([{ text: "Live:  ", options: { bold: true } }, { text: SITE + "\n" }, { text: "Repo:  ", options: { bold: true } }, { text: REPO + "\n" }, { text: "Team TYS:  ", options: { bold: true } }, { text: "Munisbek · Jahongir · Umida" }],
    { x: 0.7, y: 5.0, w: 11.9, h: 1.5, fontSize: 15, color: HEX.accent6, margin: 0, isTextBox: true, objectName: "closing links" });

  // Appendix
  pres.addSection({ title: "Appendix" });
  s = slide("CONTENT", "Appendix", "Appendix A · ПДН rule engine, clause by clause", null);
  const cl = [["Clause", "Rule as implemented", "Where it shows"],
    ["cl.1", "ПДН = average monthly payments on loans/microloans ÷ average monthly income (borrower + co-borrower)", "formula panel"],
    ["cl.2", "Includes the application under review and all loan agreements with all lenders; co-borrower loans counted. Lender-type reliefs (2024): banks («банк томонидан…») — only a portfolio quota, up to 15% of the number of loans to individuals outside the requirement; MFOs and pawnshops («микромолия ташкилоти ва ломбард томонидан…») — excluded when amount + outstanding principal ≤ 50 BRV; MFOs lending to the self-employed — 75 BRV. Daromad defaults to bank: ratio always computed, quota shown as a note", "lender-type selector, ПДН panel note"],
    ["cl.4", "Guarantor loans count only when payments are more than 30 days overdue («30 кундан ортиқ муддати ўтган тўловлари мавжуд бўлса»)", "obligations table, DPD column"],
    ["cl.4¹", "Terms over 36 months: total payments spread over 36 («барча тўловлар 36 ойга тенг миқдорда тақсимланади»); mortgages over 180 months spread over 180", "per-line note"],
    ["cl.6", "Calculation date within 10 calendar days of the loan date", "case date"],
    ["cl.7", "Average monthly income = arithmetic mean of the last 12 months; co-borrower income added", "income base"],
    ["cl.9", "Evidence: employer salary data, pension, funded-pension contributions, income credited to bank accounts, taxes paid, interest/dividends/rent; other data allowed", "memo section 2"],
    ["cl.10", "Ratio ≤ 50% from 1 January 2025 (60% between 1 July 2024 and 1 January 2025)", "cap, pass/fail"],
    ["cl.11", "Family-entrepreneurship programme loans exempt from the ratio requirement", "exemption badge"]];
  s.addTable(cl.map((r, i) => r.map((c, j) => ({ text: c, options: { bold: i === 0 || j === 0, fontSize: 9, color: i === 0 ? HEX.lt1 : HEX.dk1, fill: { color: i === 0 ? HEX.accent1 : i % 2 ? HEX.lt1 : HEX.lt2 } } }))),
    { x: 0.6, y: 1.45, w: 12.1, colW: [0.9, 8.4, 2.8], rowH: 0.42, border: { type: "solid", color: HEX.lt2, pt: 0.5 }, objectName: "clause table" });
  s.addText("BRV = 440,000 UZS from 1 September 2026 (previously 412,000); 50 BRV = 22,000,000 UZS. Clause mapping checked against lex.uz/docs/4654149 and 6809992 on 10 Oct 2026; quotes verbatim in docs/REGULATION_QUOTES.md.", { x: 0.6, y: 6.55, w: 12, h: 0.4, fontSize: 9, color: HEX.accent4, margin: 0, isTextBox: true, objectName: "brv note" });

  s = slide("CONTENT", "Appendix", "Appendix B · Failure cases, perimeter, human in the loop", null);
  card(s, 0.6, 1.45, 6.0, 5.3, "fail card");
  s.addText("Known failure cases (also on the Model card page)", { x: 0.8, y: 1.6, w: 5.6, h: 0.4, fontSize: 14, bold: true, color: HEX.dk2, margin: 0, isTextBox: true, objectName: "fail head" });
  bullets(s, ["Scanned statements without a text layer: not OCR'd page by page yet — ask for the XLSX/CSV export",
    "One signed amount column and no balance column: signs taken from keywords only",
    "Merchant strings outside the lexicon (mixed scripts, transliteration) → default category, visible in the table",
    "Dark or heavily skewed receipt photos: OCR confidence < 60% → fields flagged for confirmation, never guessed",
    "Cash-only businesses: nothing to reconstruct — the memo says so; the officer attests",
    "Synthetic-to-real gap of the risk score until retrained inside the bank; risk bands are placeholders"], 0.8, 2.1, 5.6, 4.5, 11.5);
  card(s, 6.9, 1.45, 5.9, 5.3, "perimeter card b");
  s.addText("Perimeter, audit, human in the loop", { x: 7.1, y: 1.6, w: 5.5, h: 0.4, fontSize: 14, bold: true, color: HEX.dk2, margin: 0, isTextBox: true, objectName: "perim head" });
  bullets(s, ["Prototype: static site; documents are parsed in the browser and never transmitted; nothing is stored server-side",
    "Production: same bundle on the bank's web server (Docker, no outbound network), SSO identity, audit log and cases in the bank DB",
    "Own customers' statements pulled from core banking; uploads only for other banks' statements and wallets",
    "Every analysis stamped with rule-engine, model and categoriser versions; hash-chained SHA-256 log; export with the case",
    "The engine recommends; the officer decides; overrides require a reason; committee above branch limits",
    "Personal data processed inside the bank with recorded consent; retention per bank policy; no gender or activity-type features in the model"], 7.1, 2.1, 5.5, 4.5, 11.5);

  s = slide("CONTENT", "Appendix", "Appendix C · Data sources and licences", null);
  const ds = [["Source", "Used for", "Licence / terms"],
    ["Daromad synthetic data set (synth/, seed 42)", "training, evaluation, demo samples", "MIT, this repo; generator and parameters declared; no real person"],
    ["Berka / PKDD'99 Financial data set (mirror github.com/jlacko/berka-dataset)", "offline methodology check", "academic challenge data, no licence stated; evaluation only, not redistributed"],
    ["Tesseract tessdata_fast (uzb, uzb_cyrl, rus, eng); tesseract.js", "receipt OCR", "Apache 2.0"],
    ["pdf.js; SheetJS; Next.js; React", "parsing, application", "Apache 2.0 / MIT"],
    ["XGBoost; scikit-learn; NumPy; pandas; OpenCV; Playwright; Jinja2; qrcode", "training, rendering, evaluation", "Apache 2.0 / BSD-3 / MIT"],
    ["CBU regulation texts (lex.uz 4654149, 6809992)", "rule engine, citations", "public legal information"],
    ["stat.uz wages; CBU statistics; MKBANK public pages (sponsored article, bank's own figures)", "calibration anchors, business case", "public information, cited"]];
  s.addTable(ds.map((r, i) => r.map((c) => ({ text: c, options: { bold: i === 0, fontSize: 10.5, color: i === 0 ? HEX.lt1 : HEX.dk1, fill: { color: i === 0 ? HEX.accent1 : i % 2 ? HEX.lt1 : HEX.lt2 } } }))),
    { x: 0.6, y: 1.45, w: 12.1, colW: [5.0, 3.0, 4.1], rowH: 0.55, border: { type: "solid", color: HEX.lt2, pt: 0.5 }, objectName: "data table" });
  s.addText("Rules compliance: no hard-coded answers (every figure computed from uploaded documents at run time); no real personal or confidential data; all code written during the final by team TYS with LLM coding assistance (declared); deployment from the submitted repository; CI on every push.", { x: 0.6, y: 6.0, w: 12.1, h: 0.8, fontSize: 10.5, color: HEX.dk1, margin: 0, isTextBox: true, objectName: "compliance" });

  const out = path.join(__dirname, "Daromad_TYS_deck.pptx");
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log("wrote", out);
})();
