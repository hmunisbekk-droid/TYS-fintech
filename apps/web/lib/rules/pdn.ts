// Deterministic rule engine for the CBU debt-burden ratio (қарз юки кўрсаткичи / ПДН).
// Every rule cites the clause it implements. Source texts: lex.uz/docs/4654149 (base regulation)
// and lex.uz/docs/6809992 (Board Resolution 42/16, 2024 amendments). Clause mapping verified 2026-10-10.
// BRV (базовая расчётная величина): 440,000 UZS from 1 September 2026 (previously 412,000) — buxgalter.uz BRV table.
import { annuity } from "../features";
import type { ExistingLoan, LoanRequest } from "../types";

export const RULE_ENGINE_VERSION = "pdn-2026.10.10";
export const BRV_UZS = 440_000; // базовая расчётная величина from 1 Sep 2026 – update when it changes
export const BRV_EFFECTIVE_FROM = "2026-09-01";
export const PDN_CAP = 0.5;

export const CITATIONS = {
  definition: { id: "cl.1", text: "ПДН = average monthly payments on loans/microloans ÷ average monthly income of the borrower (and co-borrower)." },
  scope: { id: "cl.2", text: "Calculated when issuing a loan, raising a limit, extending a term; includes the application under review and all loan agreements with all lenders, plus loans where the applicant is a co-borrower." },
  guarantor: { id: "cl.4", text: "Loans where the applicant is a guarantor count only if payments are more than 30 days overdue at the calculation date (\"улар бўйича 30 кундан ортиқ муддати ўтган тўловлари мавжуд бўлса\")." },
  smallLoan: { id: "cl.2 (2024)", text: "Excluded when the requested amount plus outstanding principal on existing loans does not exceed 50 BRV (\"базавий ҳисоблаш миқдорининг 50 бараваридан ошмаганда\"); for self-employed borrowers at microfinance organisations the threshold is 75 BRV." },
  term36: { id: "cl.4¹", text: "If a loan term exceeds 36 months, total payments are spread evenly over 36 months (\"барча тўловлар 36 ойга тенг миқдорда тақсимланади\")." },
  mortgage180: { id: "cl.4¹", text: "Mortgages over 180 months are spread over 180 months." },
  income12: { id: "cl.7", text: "Average monthly income = arithmetic mean of income received over the last 12 months (\"охирги 12 ой ичида олган даромадлари миқдорининг ўртача арифметик қиймати\"); co-borrower income is added." },
  incomeSources: { id: "cl.9", text: "Income evidence: employer-confirmed salary, pension, funded-pension contributions, income credited to the borrower's bank accounts, taxes paid, interest/dividends/rent. Lenders may use additional data and obtain data independently (credit bureau, other sources)." },
  cap: { id: "cl.10", text: "From 1 January 2025 the ratio must not exceed 50% (\"қарз юки кўрсаткичи 50 фоиздан ошмаслиги керак\"; 60% between 1 July 2024 and 1 January 2025)." },
  familyExempt: { id: "cl.11", text: "Loans issued under family-entrepreneurship development programmes are exempt from the ratio requirement (\"оилавий тадбиркорликни ривожлантириш дастурлари доирасида ажратиладиган кредитларга нисбатан татбиқ этилмайди\")." },
  calcDate: { id: "cl.6", text: "The calculation date must be within 10 calendar days of the loan date." },
  portfolioAllowance: { id: "cl.2 (2024)", text: "Bank-level allowance: up to 15% of the number of a bank's loans and microloans to individuals may be issued outside the ratio requirement (\"микроқарзлар сонининг энг кўпи билан 15 фоизигача бўлган миқдорида\"). A portfolio quota tracked by the bank's risk function, not a per-application rule — Daromad reports the ratio for every application and leaves the quota decision to the bank." },
} as const;

export interface PdnInput {
  monthlyIncome: number[];          // regulatory income for the 12 months, UZS
  coBorrowerMonthlyIncome?: number; // optional, mean monthly
  existingLoans: ExistingLoan[];
  request: LoanRequest;
  brv?: number;
}

export interface PdnLine { label: string; value: number; citation: keyof typeof CITATIONS; note?: string }

export interface PdnResult {
  version: string;
  meanIncome: number;
  coBorrowerIncome: number;
  incomeBase: number;
  existingPayments: PdnLine[];
  newPayment: number;
  totalPayments: number;
  ratio: number;                 // 0..1 (Infinity if no income)
  cap: number;
  exempt: boolean;
  exemptReason?: string;
  exemptCitation?: keyof typeof CITATIONS;
  passes: boolean;               // true if exempt or ratio <= cap
  maxAffordableAmount: number;   // largest amount at the requested term with ratio <= cap (0 if none)
  headroom: number;              // cap - ratio
  citations: (keyof typeof CITATIONS)[];
  brv: number;
  warnings: string[];
}

/** Normalise a monthly payment per cl.4¹ (terms over 36 months spread over 36). */
export function normalisePayment(monthly: number, termMonths: number, isMortgage = false): number {
  if (isMortgage) return termMonths > 180 ? (monthly * termMonths) / 180 : monthly;
  return termMonths > 36 ? (monthly * termMonths) / 36 : monthly;
}

export function computePdn(inp: PdnInput): PdnResult {
  const brv = inp.brv ?? BRV_UZS;
  const warnings: string[] = [];
  const inc = inp.monthlyIncome.filter((x) => Number.isFinite(x));
  if (inc.length < 12) warnings.push(`Only ${inc.length} months of income available; cl.7 asks for a 12-month mean.`);
  const meanIncome = inc.length ? inc.reduce((a, b) => a + b, 0) / Math.max(inc.length, 1) : 0;
  const coInc = inp.coBorrowerMonthlyIncome ?? 0;
  const incomeBase = meanIncome + coInc;

  const existing: PdnLine[] = [];
  let outstanding = 0;
  for (const l of inp.existingLoans) {
    outstanding += l.outstanding_principal || 0;
    if (l.role === "guarantor") {
      if ((l.days_past_due || 0) > 30) {
        existing.push({ label: `${l.lender} (guarantor, ${l.days_past_due} dpd)`, value: normalisePayment(l.monthly_payment, l.term_months), citation: "guarantor", note: "counted: overdue > 30 days" });
      } else {
        existing.push({ label: `${l.lender} (guarantor)`, value: 0, citation: "guarantor", note: "not counted: not overdue" });
      }
      continue;
    }
    const v = normalisePayment(l.monthly_payment, l.term_months);
    existing.push({ label: `${l.lender}${l.role === "co-borrower" ? " (co-borrower)" : ""}`, value: v, citation: l.term_months > 36 ? "term36" : "scope",
      note: l.term_months > 36 ? `term ${l.term_months} m → spread over 36` : undefined });
  }
  const req = inp.request;
  const rawNew = annuity(req.amount, req.annual_rate, req.term_months);
  const newPayment = normalisePayment(rawNew, req.term_months);
  const existingTotal = existing.reduce((a, l) => a + l.value, 0);
  const total = existingTotal + newPayment;
  const ratio = incomeBase > 0 ? total / incomeBase : Number.POSITIVE_INFINITY;

  let exempt = false, exemptReason: string | undefined, exemptCitation: keyof typeof CITATIONS | undefined;
  if (req.product === "family_program") {
    exempt = true; exemptReason = "Family-entrepreneurship programme loan"; exemptCitation = "familyExempt";
  } else if (req.amount + outstanding <= 50 * brv) {
    exempt = true; exemptReason = `Requested amount + outstanding principal ≤ 50 BRV (${(50 * brv).toLocaleString("en-US")} UZS)`; exemptCitation = "smallLoan";
  }

  // max affordable amount at the requested term: ratio(amount) <= cap, monotone in amount → bisection
  let maxAffordable = 0;
  if (incomeBase > 0) {
    const room = PDN_CAP * incomeBase - existingTotal;
    if (room > 0) {
      let lo = 0, hi = 2_000_000_000;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const p = normalisePayment(annuity(mid, req.annual_rate, req.term_months), req.term_months);
        if (p <= room) lo = mid; else hi = mid;
      }
      maxAffordable = Math.floor(lo / 100_000) * 100_000;
    }
  }
  const citations: (keyof typeof CITATIONS)[] = ["definition", "scope", "income12", "incomeSources", "cap"];
  if (existing.some((l) => l.citation === "term36") || req.term_months > 36) citations.push("term36");
  if (existing.some((l) => l.citation === "guarantor")) citations.push("guarantor");
  if (exemptCitation) citations.push(exemptCitation);
  return {
    version: RULE_ENGINE_VERSION, meanIncome, coBorrowerIncome: coInc, incomeBase, existingPayments: existing,
    newPayment, totalPayments: total, ratio, cap: PDN_CAP, exempt, exemptReason, exemptCitation,
    passes: exempt || ratio <= PDN_CAP, maxAffordableAmount: maxAffordable, headroom: PDN_CAP - ratio,
    citations, brv, warnings,
  };
}
