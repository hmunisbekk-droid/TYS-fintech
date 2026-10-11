// Template-generated credit memo with a fact table and a faithfulness verifier.
// No language model is involved: every sentence is assembled from structured facts, and every number
// in the rendered memo must appear in the fact table (the verifier rejects the memo otherwise).
import type { Features } from "./features";
import { FEATURE_LABELS } from "./features";
import type { Check } from "./integrity";
import { CITATIONS, type PdnResult } from "./rules/pdn";
import type { Attribution } from "./risk";
import type { CaseInput, Recommendation } from "./case";
import type { MonthlySeries } from "./types";

export interface Fact { key: string; value: number | string; display: string; source: string }
export interface MemoSection { title: string; paragraphs: { text: string; sources: string[] }[] }
export interface Memo {
  title: string; generatedAt: string; sections: MemoSection[]; facts: Fact[];
  verification: { ok: boolean; numbersChecked: number; unsourced: string[] };
}

export const fmtUZS = (v: number) => `${Math.round(v).toLocaleString("en-US")} UZS`;
export const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function buildMemo(a: { inp: CaseInput; months: string[]; series: MonthlySeries; features: Features; pdn: PdnResult;
  probability: number; band: { label: string }; attributions: Attribution[]; checks: Check[]; recommendation: Recommendation; reasons: string[] }): Memo {
  const facts: Fact[] = [];
  const F = (key: string, value: number | string, display: string, source: string) => { facts.push({ key, value, display, source }); return display; };
  const stmts = a.inp.documents.filter((d) => d.kind === "statement");
  const stmtSrc = stmts.map((d) => d.id).join(",") || "none";
  const n = a.months.length;
  const meanReg = a.series.regulatoryIncome.reduce((x, y) => x + y, 0) / n;
  const meanBiz = a.series.businessInflow.reduce((x, y) => x + y, 0) / n;
  const meanNonBiz = a.series.nonBusinessInflow.reduce((x, y) => x + y, 0) / n;
  const meanAmb = a.series.ambiguousInflow.reduce((x, y) => x + y, 0) / n;
  const minIdx = a.series.regulatoryIncome.indexOf(Math.min(...a.series.regulatoryIncome));
  const maxIdx = a.series.regulatoryIncome.indexOf(Math.max(...a.series.regulatoryIncome));

  const recLabel: Record<Recommendation, string> = { approve: "APPROVE", approve_reduced: "APPROVE AT A REDUCED AMOUNT", refer: "REFER TO CREDIT COMMITTEE", decline: "DECLINE" };
  const sections: MemoSection[] = [];

  // 1. Applicant and request
  const cert = a.inp.documents.find((d) => d.kind === "certificate");
  const name = a.inp.applicantName || stmts[0]?.holderName || cert?.fields.find((f) => f.name === "holder")?.value || "Applicant";
  const p1: MemoSection = { title: "1. Applicant and request", paragraphs: [] };
  p1.paragraphs.push({ text: `Applicant: ${F("applicant", name, name, stmts[0]?.id ?? cert?.id ?? "input")}. Application date ${F("app_date", a.inp.applicationDate, a.inp.applicationDate, "input")}. ` +
    `Requested ${F("req_amount", a.inp.request.amount, fmtUZS(a.inp.request.amount), "input")} for ${F("req_term", a.inp.request.term_months, `${a.inp.request.term_months} months`, "input")} ` +
    `at ${F("req_rate", a.inp.request.annual_rate, fmtPct(a.inp.request.annual_rate), "input")} p.a. (product: ${a.inp.request.product.replace("_", " ")}).`, sources: ["input"] });
  if (cert) {
    const act = cert.fields.find((f) => f.name === "activity")?.value, since = cert.fields.find((f) => f.name === "registered_since")?.value, st = cert.fields.find((f) => f.name === "status")?.value;
    p1.paragraphs.push({ text: `Self-employed registration: activity "${act ?? "n/a"}", registered ${since ? F("cert_since", since, since, cert.id) : "n/a"}, status ${st ?? "n/a"}.`, sources: [cert.id] });
  }
  a.inp.documents.forEach((d) => F(`file_${d.id}`, d.fileName, d.fileName, d.id));
  p1.paragraphs.push({ text: `Documents reviewed: ${a.inp.documents.map((d) => `${d.fileName} (${d.kind})`).join(", ")}.`, sources: a.inp.documents.map((d) => d.id) });
  sections.push(p1);

  // 2. Income evidence (cl.18 account receipts, cl.13 averaging)
  const p2: MemoSection = { title: "2. Income evidence (regulation cl.13, cl.18)", paragraphs: [] };
  p2.paragraphs.push({ text: `Income credited to the applicant's accounts over ${F("n_months", n, `${n} months`, stmtSrc)} (${a.months[0]} to ${a.months[n - 1]}) averages ` +
    `${F("mean_reg_income", meanReg, fmtUZS(meanReg), stmtSrc)} per month after excluding own-card transfers, loan disbursements, refunds and cash deposits ` +
    `(${F("mean_ambiguous", meanAmb, fmtUZS(meanAmb), stmtSrc)} per month excluded as not income).`, sources: [stmtSrc, "cl.18"] });
  p2.paragraphs.push({ text: `Of this, business revenue (POS, customer transfers, platform payouts) is ${F("mean_biz", meanBiz, fmtUZS(meanBiz), stmtSrc)} per month ` +
    `and salary/pension/family transfers are ${F("mean_nonbiz", meanNonBiz, fmtUZS(meanNonBiz), stmtSrc)} per month. ` +
    `Weakest month ${a.months[minIdx]}: ${F("min_month", a.series.regulatoryIncome[minIdx], fmtUZS(a.series.regulatoryIncome[minIdx]), stmtSrc)}; ` +
    `strongest ${a.months[maxIdx]}: ${F("max_month", a.series.regulatoryIncome[maxIdx], fmtUZS(a.series.regulatoryIncome[maxIdx]), stmtSrc)}. ` +
    `Volatility (CV) ${F("income_cv", a.features.income_cv, a.features.income_cv.toFixed(2), stmtSrc)}; ` +
    `distinct paying customers per month ${F("payers", a.features.payers_per_month, a.features.payers_per_month.toFixed(1), stmtSrc)}.`, sources: [stmtSrc] });
  sections.push(p2);

  // 3. Existing obligations and DBR
  const p3: MemoSection = { title: "3. Debt-burden ratio (DBR)", paragraphs: [] };
  const ex = a.pdn.existingPayments;
  ex.forEach((l, i) => F(`loan_label_${i}`, l.label, l.label, "credit-bureau/input"));
  p3.paragraphs.push({ text: ex.length ? `Existing obligations counted (cl.7, cl.8): ${ex.map((l) => `${l.label} ${F(`loan_${l.label}`, l.value, fmtUZS(l.value), "credit-bureau/input")}`).join("; ")}.` :
    "No existing loan obligations reported (credit bureau / statement).", sources: ["cl.7", "cl.8"] });
  p3.paragraphs.push({ text: `New loan payment ${F("new_pmt", a.pdn.newPayment, fmtUZS(a.pdn.newPayment), "rules")} (annuity${a.inp.request.term_months > 36 ? ", spread per cl.8" : ""}). ` +
    `Total monthly payments ${F("total_pmt", a.pdn.totalPayments, fmtUZS(a.pdn.totalPayments), "rules")} ÷ income base ${F("income_base", a.pdn.incomeBase, fmtUZS(a.pdn.incomeBase), "rules")} ` +
    `(${a.pdn.medianUsed ? "median, cl.14" : "arithmetic mean, cl.13"}${a.pdn.monthsUsed < 12 ? ` over ${F("months_used", a.pdn.monthsUsed, String(a.pdn.monthsUsed), "cl.13")} months` : ""}) ` +
    `= DBR ${F("pdn", a.pdn.ratio, Number.isFinite(a.pdn.ratio) ? fmtPct(a.pdn.ratio) : "n/a", "rules")} against the ${F("cap", a.pdn.cap, fmtPct(a.pdn.cap), "cl.3")} limit (cl.3 ¶1). ` +
    (a.pdn.exempt ? `The requirements do not apply: ${a.pdn.exemptReason} (cl.4). ` : "") +
    (a.pdn.withinQuota ? `The ratio is within ${F("quota_cap", a.pdn.quotaCap, fmtPct(a.pdn.quotaCap), "cl.3")}, so the loan is possible only inside the bank's ${F("quota_share", 15, "15", "cl.3")}% quota (cl.3 ¶3). ` : "") +
    `Maximum affordable amount at the requested term: ${F("max_afford", a.pdn.maxAffordableAmount, fmtUZS(a.pdn.maxAffordableAmount), "rules")}.`, sources: ["rules", "cl.3", "cl.13"] });
  sections.push(p3);

  // 4. Integrity
  const p4: MemoSection = { title: "4. Document integrity", paragraphs: [] };
  const failed = a.checks.filter((c) => !c.passed);
  failed.forEach((c) => F(`check_${c.id}`, c.detail, `${c.title} — ${c.detail}`, c.evidence.join(",") || "integrity"));
  p4.paragraphs.push({ text: failed.length ? `${F("n_checks", a.checks.length, `${a.checks.length} checks`, "integrity")} run; findings: ${failed.map((c) => `${c.title} — ${c.detail}`).join(" | ")}` :
    `${F("n_checks", a.checks.length, `${a.checks.length} checks`, "integrity")} run; no findings.`, sources: failed.flatMap((c) => c.evidence).slice(0, 10) });
  sections.push(p4);

  // 5. Risk score
  const p5: MemoSection = { title: "5. Risk score (model, explained)", paragraphs: [] };
  const top = a.attributions.slice(0, 3);
  p5.paragraphs.push({ text: `Model probability of default within 12 months: ${F("pd", a.probability, fmtPct(a.probability), "model")} (${a.band.label}). ` +
    `Main drivers vs. the portfolio median: ${top.map((t) => `${FEATURE_LABELS[t.feature]} (${t.deltaProb >= 0 ? "+" : ""}${F(`attr_${t.feature}`, t.deltaProb, (t.deltaProb * 100).toFixed(1), "model")} pts)`).join("; ")}. ` +
    `The score is trained on a declared synthetic population and is advisory until retrained on the bank's own history.`, sources: ["model"] });
  sections.push(p5);

  // 6. Recommendation
  F("months_observed", a.features.months_observed, String(a.features.months_observed), stmtSrc);
  // facts used by the recommendation reasons (cl.3 quota, cl.4 exemption, cl.13 history) so the text verifies
  F("quota_share", 15, "15", "cl.3");
  F("quota_cap", a.pdn.quotaCap, fmtPct(a.pdn.quotaCap), "cl.3");
  F("months_used", a.pdn.monthsUsed, String(a.pdn.monthsUsed), "cl.13");
  F("min_months", 6, "6", "cl.13");
  if (a.pdn.exemptReason) F("exempt_reason", a.pdn.exemptReason, a.pdn.exemptReason, a.pdn.exemptCitation ?? "rules");
  const p6: MemoSection = { title: "6. Recommendation", paragraphs: [] };
  p6.paragraphs.push({ text: `${recLabel[a.recommendation]}. ${a.reasons.join(" ")}`, sources: ["rules", "model", "integrity"] });
  p6.paragraphs.push({ text: "Decision rests with the loan officer / credit committee. This memo is advisory; every figure above traces to its source (statement lines, a regulation clause, or the model).", sources: [] });
  sections.push(p6);

  const memo: Memo = { title: `Credit memo — ${name}`, generatedAt: new Date().toISOString(), sections, facts, verification: { ok: true, numbersChecked: 0, unsourced: [] } };
  memo.verification = verifyMemo(memo);
  return memo;
}

/** Every number token in the memo text must correspond to a fact display value (or a month / date / clause id). */
export function verifyMemo(memo: Memo): { ok: boolean; numbersChecked: number; unsourced: string[] } {
  const allowed = new Set<string>();
  for (const f of memo.facts) {
    allowed.add(f.display);
    for (const tok of f.display.match(/-?\d[\d,]*\.?\d*/g) ?? []) allowed.add(tok.replace(/[,.]+$/, ""));
  }
  const unsourced: string[] = [];
  let checked = 0;
  for (const s of memo.sections) for (const p of s.paragraphs) {
    const text = p.text.replace(/\b\d{4}-\d{2}(-\d{2})?\b/g, " ")        // months & dates (ISO)
      .replace(/\b\d{2}\.\d{2}\.\d{4}\b/g, " ")                         // dates (dd.mm.yyyy)
      .replace(/cl\.\d+[¹²]?( ¶\d+)?/g, " ").replace(/\b\d+\. /g, " ")           // clause ids, section numbers
      .replace(/\d+ (checks|months)/g, " ");
    for (const raw of text.match(/-?\d[\d,]*\.?\d*/g) ?? []) {
      const tok = raw.replace(/[,.]+$/, "");
      checked++;
      if (!allowed.has(tok)) unsourced.push(tok);
    }
  }
  return { ok: unsourced.length === 0, numbersChecked: checked, unsourced };
}

export function memoToText(memo: Memo): string {
  return [memo.title, `Generated ${memo.generatedAt}`, "", ...memo.sections.flatMap((s) => [s.title, ...s.paragraphs.map((p) => p.text), ""]),
    `Verification: ${memo.verification.ok ? "PASS" : "FAIL"} — ${memo.verification.numbersChecked} numbers checked, ${memo.verification.unsourced.length} unsourced.`].join("\n");
}

export const CLAUSE_TEXTS = CITATIONS;
