// Case orchestration: documents → transactions → categories → series → features → rules → risk → integrity → memo.
import { categorizeAll } from "./categorize";
import { computeFeatures, last12Months, monthlySeries, type Features } from "./features";
import { runIntegrityChecks, type Check } from "./integrity";
import { buildMemo, fmtPct, fmtUZS, type Memo } from "./memo";
import { computePdn, type PdnResult } from "./rules/pdn";
import { attributions, predictProbability, riskBand, type Attribution, type FeatureStats, type RiskModel } from "./risk";
import type { ExistingLoan, LoanRequest, MonthlySeries, ParsedDocument, Transaction } from "./types";

export interface CaseInput {
  applicationDate: string;      // YYYY-MM-DD
  applicantName?: string;
  documents: ParsedDocument[];
  existingLoans: ExistingLoan[];
  request: LoanRequest;
  coBorrowerIncome?: number;
}

export type Recommendation = "approve" | "approve_reduced" | "refer" | "decline";

export interface CaseResult {
  months: string[];
  transactions: Transaction[];
  series: MonthlySeries;
  features: Features;
  pdn: PdnResult;
  probability: number;
  band: ReturnType<typeof riskBand>;
  attributions: Attribution[];
  checks: Check[];
  recommendation: Recommendation;
  recommendationReasons: string[];
  memo: Memo;
  timings: Record<string, number>;
  engineVersions: { rules: string; model: string; categorizer: string };
}

export const CATEGORIZER_VERSION = "rules-2026.10.10";

export function detectedLoansFromStatements(txs: Transaction[], months: string[]): ExistingLoan[] {
  // group loan repayments by lender keyword; estimate monthly payment as median of monthly sums
  const byLender = new Map<string, Map<string, number>>();
  for (const t of txs) {
    if (t.category !== "loan_repayment" || !months.includes(t.date.slice(0, 7))) continue;
    const lender = t.description.replace(/KREDIT.*$|ПОГАШ.*$|LOAN.*$/i, "").trim() || "Lender (statement)";
    const m = byLender.get(lender) ?? new Map<string, number>();
    m.set(t.date.slice(0, 7), (m.get(t.date.slice(0, 7)) ?? 0) + t.debit);
    byLender.set(lender, m);
  }
  const out: ExistingLoan[] = [];
  for (const [lender, m] of byLender) {
    const vals = [...m.values()].sort((a, b) => a - b);
    if (vals.length < 2) continue;
    const med = vals[Math.floor(vals.length / 2)];
    out.push({ id: `stmt:${lender}`, lender: `${lender} (detected in statement)`, monthly_payment: Math.round(med), term_months: 12,
      outstanding_principal: 0, days_past_due: 0, role: "borrower", source: "statement" });
  }
  return out;
}

export function runCase(inp: CaseInput, model: RiskModel, stats: FeatureStats): CaseResult {
  const timings: Record<string, number> = {};
  let t = performance.now();
  const months = last12Months(inp.applicationDate);
  // merge transactions from all statements; categorise per statement (counterparty patterns are per account)
  let txs: Transaction[] = [];
  for (const d of inp.documents) if (d.kind === "statement") txs = txs.concat(categorizeAll(d.transactions));
  txs.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  timings.categorize = performance.now() - t; t = performance.now();

  const inWindow = txs.filter((x) => months.includes(x.date.slice(0, 7)));
  const series = monthlySeries(inWindow, months);
  const features = computeFeatures(inWindow, inp.request.amount, inp.request.term_months, inp.existingLoans, months);
  timings.features = performance.now() - t; t = performance.now();

  const pdn = computePdn({ monthlyIncome: series.regulatoryIncome, coBorrowerMonthlyIncome: inp.coBorrowerIncome,
    existingLoans: inp.existingLoans, request: inp.request });
  timings.rules = performance.now() - t; t = performance.now();

  const probability = predictProbability(model, features);
  const band = riskBand(probability);
  const attr = attributions(model, features, stats);
  timings.risk = performance.now() - t; t = performance.now();

  const checks = runIntegrityChecks(inp.documents, inWindow, months);
  timings.integrity = performance.now() - t; t = performance.now();

  const highFails = checks.filter((c) => !c.passed && c.severity === "high");
  const medFails = checks.filter((c) => !c.passed && c.severity === "medium");
  const reasons: string[] = [];
  let rec: Recommendation;
  if (highFails.length) { rec = "refer"; reasons.push(`High-severity integrity finding: ${highFails.map((c) => c.title).join("; ")}.`); }
  else if (!pdn.passes) {
    rec = pdn.maxAffordableAmount > 0 ? "approve_reduced" : "decline";
    reasons.push(`ПДН ${fmtPct(pdn.ratio)} exceeds the ${fmtPct(pdn.cap)} cap (cl.10). Maximum affordable amount at this term: ${fmtUZS(pdn.maxAffordableAmount)}.`);
  } else if (band.band === "high") { rec = "refer"; reasons.push(`Risk score ${fmtPct(probability)} — above the referral threshold; committee review.`); }
  else if (band.band === "medium" || medFails.length) { rec = "approve"; reasons.push(medFails.length ? `Approve with conditions: ${medFails.map((c) => c.title).join("; ")}.` : "Elevated risk score: approve with standard monitoring."); }
  else { rec = "approve"; reasons.push("ПДН within cap, low risk score, no integrity findings."); }
  if (pdn.exempt) reasons.push(`ПДН cap not applicable: ${pdn.exemptReason} (${pdn.exemptCitation}).`);
  if (features.months_observed < 12) reasons.push(`Only ${features.months_observed} of 12 months observed — request the missing statements before final decision.`);
  // (months_observed is registered as a fact by the memo builder so the verifier accepts it)

  const memo = buildMemo({ inp, months, series, features, pdn, probability, band, attributions: attr, checks, recommendation: rec, reasons });
  timings.memo = performance.now() - t;
  return { months, transactions: txs, series, features, pdn, probability, band, attributions: attr, checks, recommendation: rec,
    recommendationReasons: reasons, memo, timings, engineVersions: { rules: pdn.version, model: model.version, categorizer: CATEGORIZER_VERSION } };
}
