// Deterministic rule engine for the debt-burden ratio (қарз юки кўрсаткичи / ПДН) of a BANK borrower.
// Source: Regulation "on macroprudential norms set for banks and on the maximum values of payments on loans
// (microloans) issued by them" — CBU Board decision No. 7/3 of 8 April 2025, Ministry of Justice registration
// No. 3618 of 22 April 2025, in force 24 July 2025, as amended by Board decision No. 31/9 of 5 December 2025
// (in force 21 January 2026). Text: https://lex.uz/uz/docs/7491592. Clause mapping checked 11 October 2026.
// (The earlier regulation No. 3205 / lex.uz 4654149 applies since 24 July 2025 to microfinance organisations and
// pawnshops only — it is not used here: MKBANK is a bank.)
import { annuity } from "../features";
import type { ExistingLoan, LoanRequest } from "../types";

export const RULE_ENGINE_VERSION = "pdn-3618-2026.10.11";
export const REGULATION = {
  short: "CBU Regulation No. 3618 (banks)",
  title: "Банкларга ўрнатиладиган макропруденциал нормативлар ҳамда улар томонидан бериладиган кредитлар (микроқарзлар) бўйича тўловларнинг энг юқори қийматларига доир талаблар тўғрисидаги низом",
  decision: "CBU Board decision No. 7/3 of 8 April 2025; registered by the Ministry of Justice on 22 April 2025, No. 3618; in force 24 July 2025; amended by Board decision No. 31/9 of 5 December 2025 (in force 21 January 2026)",
  url: "https://lex.uz/uz/docs/7491592",
} as const;
export const PDN_CAP = 0.5;
export const PDN_QUOTA_CAP = 1.0;       // cl.3 ¶3: up to 15% of a bank's outstanding loans may carry a ratio up to 100%
export const QUOTA_SHARE = 0.15;
export const MIN_INCOME_MONTHS = 6;     // cl.13: at least 6, at most 12 continuous months
export const MAX_INCOME_MONTHS = 12;

export const CITATIONS = {
  definition: { id: "cl.2", text: "Debt-burden ratio = the borrower's average monthly payments on loans (microloans) ÷ average monthly income (\"қарз олувчининг кредит (микроқарзлари) бўйича ўртача ойлик тўловлари миқдорининг … ўртача ойлик даромадига нисбати\")." },
  cap: { id: "cl.3 ¶1", text: "The ratio must not exceed 50% (\"қарз юки кўрсаткичи 50 фоиздан ошмаслиги лозим\")." },
  quota100: { id: "cl.3 ¶3", text: "Up to 15% of the number of the bank's issued-but-outstanding loans (\"берилган, бироқ сўндирилмаган барча кредитлар (микроқарзлар) сонининг энг кўпи билан 15 фоизигача\") may be to borrowers whose ratio is up to 100% (\"уларнинг қарз юки кўрсаткичи 100 фоизгача бўлиши мумкин\"). A portfolio-level quota decided by the bank, not per application — a ratio between 50% and 100% therefore goes to the committee." },
  newSelfEmployed: { id: "cl.3 ¶4", text: "For self-employed persons first registered (\"биринчи марта рўйхатдан ўтганига\") not more than six months before the application date (\"санадан олдинги олти ойдан ошмаган\"), loans for income-generating activity may be issued without taking the ratio into account and/or calculating it (\"инобатга олинмаслиги ва (ёки) ҳисобланмаслиги мумкин\") — again within 15% of the bank's outstanding loans. Daromad still computes the ratio and flags eligibility." },
  exempt: { id: "cl.4", text: "The ratio requirements do not apply (\"татбиқ этилмайди\") to loans to individual entrepreneurs (\"якка тартибдаги тадбиркорларга бериладиган кредитлар\"), loans under family-entrepreneurship development programmes (\"оилавий тадбиркорликни ривожлантириш дастурлари доирасида бериладиган кредитлар\") and education loans (\"таълим кредитлари\")." },
  recalc: { id: "cl.5", text: "The ratio must be calculated when a loan is issued or a limit raised (\"кредит (микроқарз) беришга ёки кредит (микроқарз) лимитини оширишга\"), when payments are raised or the term extended, and when a claim is bought or a loan refinanced." },
  scope: { id: "cl.7", text: "Payments include every loan agreement with every lender (\"барча қарз берувчилар билан тузилган кредит (микроқарз) шартномаси\"), the application under review, and loans where the applicant is a co-borrower." },
  guarantor: { id: "cl.7", text: "Loans where the applicant is a guarantor count only if, at the calculation date, payments on them are more than 30 days overdue (\"агар … 30 кундан ортиқ муддати ўтган тўловлари мавжуд бўлса\")." },
  spreading: { id: "cl.8", text: "Annuity method (\"аннуитет усулида\"): a microloan with a term over 36 months is spread evenly over 36 months (\"36 ойдан ошган тақдирда … 36 ойга тенг миқдорда\"); other loans over 60 months over 60 (revolving lines and credit cards excluded); mortgages over 180 months over 180. Shorter terms use the contract term." },
  existingPayment: { id: "cl.10", text: "Average monthly payment of an existing loan = remaining principal plus interest and fees ÷ months left in the contract; overdue amounts and penalties are added." },
  calcDate: { id: "cl.12", text: "No more than 3 working days may pass between calculating the ratio and issuing the loan (\"вақт оралиғи 3 иш кунидан ошмаслиги керак\")." },
  income: { id: "cl.13", text: "Average monthly income is taken over a continuous period of at least 6 and at most 12 months before the application (\"камида 6 ой учун узлуксиз, бироқ 12 ойдан ошмаган муддат учун\"): one-twelfth of all income of the last 12 months, or one-sixth … one-eleventh when only 6–11 months exist." },
  median: { id: "cl.14", text: "The bank may use the median of the monthly incomes instead of the mean when the median is lower (\"мазкур қиймат ушбу Низомнинг 13-бандида белгиланган арифметик қийматдан кичикроқ бўлса\")." },
  accountInflows: { id: "cl.18", text: "Besides the documents of cl.19, the bank takes into account receipts credited to the bank accounts of the borrower and co-borrower (\"банк ҳисобварақларига тушган тушумларини инобатга олади\"), without counting the same income twice." },
  evidence: { id: "cl.19", text: "Documented income: verified salary information, pension, funded-pension contributions, tax data including the annual income declaration confirmed by the State Tax Service, interest/dividend/rental income — net of taxes. A self-employed borrower has none of these except what shows on the account (cl.18)." },
  otherData: { id: "cl.22", text: "The bank may use information provided by the borrower, its own information systems, credit-bureau reports and other official sources (\"ўзининг ахборот тизимлари, кредит бюроси томонидан тақдим этиладиган ахборотлар\")." },
} as const;

export type PdnStatus = "exempt" | "pass" | "quota" | "fail" | "no_income" | "insufficient_history";
export type LoanKind = "microloan" | "loan" | "mortgage";

export const PRODUCT_KIND: Record<LoanRequest["product"], LoanKind> = { ommabop: "microloan", express: "microloan", business_online: "loan", family_program: "microloan" };

export interface PdnInput {
  monthlyIncome: number[];              // regulatory income for the months of the window (UZS), oldest first
  monthsObserved?: number;              // months with statement coverage in the window (defaults to monthlyIncome.length)
  useMedian?: boolean;                  // cl.14 option
  coBorrowerMonthlyIncome?: number;     // optional, mean monthly
  existingLoans: ExistingLoan[];
  request: LoanRequest;
  selfEmployedRegisteredSince?: string; // ISO date from the self-employed certificate (cl.3 ¶4 eligibility)
  applicationDate?: string;             // ISO date
}

export interface PdnLine { label: string; value: number; citation: keyof typeof CITATIONS; note?: string }

export interface PdnResult {
  version: string;
  regulation: typeof REGULATION;
  meanIncome: number;                   // cl.13 figure actually used (mean, or median when useMedian and lower)
  arithmeticMean: number;
  medianIncome: number;
  medianUsed: boolean;
  monthsUsed: number;
  coBorrowerIncome: number;
  incomeBase: number;
  existingPayments: PdnLine[];
  newPayment: number;
  totalPayments: number;
  ratio: number;                        // 0..1 (Infinity if no income)
  cap: number;
  quotaCap: number;
  status: PdnStatus;
  exempt: boolean;
  exemptReason?: string;
  exemptCitation?: keyof typeof CITATIONS;
  passes: boolean;                      // exempt or ratio <= cap
  withinQuota: boolean;                 // cap < ratio <= 100%: possible only inside the bank's 15% quota (cl.3 ¶3)
  newSelfEmployedEligible: boolean;     // cl.3 ¶4
  maxAffordableAmount: number;          // largest amount at the requested term with ratio <= cap (0 if none)
  headroom: number;                     // cap - ratio
  citations: (keyof typeof CITATIONS)[];
  warnings: string[];
}

/** cl.8: spread the monthly payment of a long loan over 36 (microloan) / 60 (other loan) / 180 (mortgage) months. */
export function normalisePayment(monthly: number, termMonths: number, kind: LoanKind = "microloan"): number {
  const limit = kind === "mortgage" ? 180 : kind === "loan" ? 60 : 36;
  return termMonths > limit ? (monthly * termMonths) / limit : monthly;
}
export function spreadLimit(kind: LoanKind): number { return kind === "mortgage" ? 180 : kind === "loan" ? 60 : 36; }

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00Z"), b = new Date(toIso + "T00:00:00Z");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Number.NaN;
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
}

export function computePdn(inp: PdnInput): PdnResult {
  const warnings: string[] = [];
  const inc = inp.monthlyIncome.filter((x) => Number.isFinite(x));
  const monthsObserved = Math.min(inp.monthsObserved ?? inc.length, MAX_INCOME_MONTHS);
  // cl.13: 1/12 of the last 12 months when 12 months exist; 1/n for 6..11 observed months (the most recent n)
  const used = monthsObserved >= MAX_INCOME_MONTHS ? inc.slice(-MAX_INCOME_MONTHS) : inc.slice(-Math.max(monthsObserved, 0));
  const monthsUsed = monthsObserved >= MAX_INCOME_MONTHS ? MAX_INCOME_MONTHS : monthsObserved;
  const arithmeticMean = monthsUsed > 0 ? used.reduce((a, b) => a + b, 0) / monthsUsed : 0;
  const medianIncome = median(used);
  const medianUsed = !!inp.useMedian && medianIncome < arithmeticMean;
  const meanIncome = medianUsed ? medianIncome : arithmeticMean;
  if (monthsUsed < MIN_INCOME_MONTHS) warnings.push(`Only ${monthsUsed} month(s) of income history: cl.13 requires a continuous period of at least 6 months — the ratio below is indicative only.`);
  else if (monthsUsed < MAX_INCOME_MONTHS) warnings.push(`${monthsUsed} months of income history: cl.13 average taken as one-${monthsUsed === 6 ? "sixth" : monthsUsed === 7 ? "seventh" : monthsUsed === 8 ? "eighth" : monthsUsed === 9 ? "ninth" : monthsUsed === 10 ? "tenth" : "eleventh"} of the income of those months.`);
  if (inp.useMedian && !medianUsed) warnings.push("Median not lower than the arithmetic mean, so cl.14 does not apply; the mean is used.");
  const coInc = inp.coBorrowerMonthlyIncome ?? 0;
  const incomeBase = meanIncome + coInc;

  const existing: PdnLine[] = [];
  for (const l of inp.existingLoans) {
    if (l.role === "guarantor") {
      if ((l.days_past_due || 0) > 30) existing.push({ label: `${l.lender} (guarantor, ${l.days_past_due} dpd)`, value: normalisePayment(l.monthly_payment, l.term_months), citation: "guarantor", note: "counted: overdue > 30 days" });
      else existing.push({ label: `${l.lender} (guarantor)`, value: 0, citation: "guarantor", note: "not counted: not overdue" });
      continue;
    }
    const spread = l.term_months > 36;
    existing.push({ label: `${l.lender}${l.role === "co-borrower" ? " (co-borrower)" : ""}`, value: normalisePayment(l.monthly_payment, l.term_months), citation: spread ? "spreading" : "scope",
      note: spread ? `term ${l.term_months} m → spread over 36` : undefined });
  }
  const req = inp.request;
  const kind = PRODUCT_KIND[req.product] ?? "microloan";
  const rawNew = annuity(req.amount, req.annual_rate, req.term_months);
  const newPayment = normalisePayment(rawNew, req.term_months, kind);
  const existingTotal = existing.reduce((a, l) => a + l.value, 0);
  const total = existingTotal + newPayment;
  const ratio = incomeBase > 0 ? total / incomeBase : Number.POSITIVE_INFINITY;

  let exempt = false, exemptReason: string | undefined, exemptCitation: keyof typeof CITATIONS | undefined;
  if (req.product === "family_program") { exempt = true; exemptReason = "Loan under a family-entrepreneurship development programme — the ratio requirements do not apply"; exemptCitation = "exempt"; }

  // cl.3 ¶4: self-employed first registered within the 6 months before the application
  let newSelfEmployedEligible = false;
  if (inp.selfEmployedRegisteredSince && inp.applicationDate) {
    const m = monthsBetween(inp.selfEmployedRegisteredSince, inp.applicationDate);
    if (Number.isFinite(m) && m >= 0 && m < 6) { newSelfEmployedEligible = true; warnings.push("Self-employed registration is less than 6 months old: for an income-generating loan the bank may issue without the ratio inside its 15% quota (cl.3 ¶4) — eligibility noted, ratio still computed."); }
  }

  // max affordable amount at the requested term: ratio(amount) <= cap, monotone in amount → bisection
  let maxAffordable = 0;
  if (incomeBase > 0) {
    const room = PDN_CAP * incomeBase - existingTotal;
    if (room > 0) {
      let lo = 0, hi = 2_000_000_000;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        const p = normalisePayment(annuity(mid, req.annual_rate, req.term_months), req.term_months, kind);
        if (p <= room) lo = mid; else hi = mid;
      }
      maxAffordable = Math.floor(lo / 100_000) * 100_000;
    }
  }
  const passes = exempt || ratio <= PDN_CAP;
  const withinQuota = !exempt && ratio > PDN_CAP && ratio <= PDN_QUOTA_CAP;
  const status: PdnStatus = exempt ? "exempt" : incomeBase <= 0 ? "no_income" : monthsUsed < MIN_INCOME_MONTHS ? "insufficient_history" : ratio <= PDN_CAP ? "pass" : withinQuota ? "quota" : "fail";
  const citations: (keyof typeof CITATIONS)[] = ["definition", "scope", "income", "accountInflows", "evidence", "cap", "calcDate"];
  if (medianUsed) citations.push("median");
  if (existing.some((l) => l.citation === "spreading") || req.term_months > spreadLimit(kind)) citations.push("spreading");
  if (existing.some((l) => l.citation === "guarantor")) citations.push("guarantor");
  if (exemptCitation) citations.push(exemptCitation);
  if (withinQuota) citations.push("quota100");
  if (newSelfEmployedEligible) citations.push("newSelfEmployed");
  return {
    version: RULE_ENGINE_VERSION, regulation: REGULATION, meanIncome, arithmeticMean, medianIncome, medianUsed, monthsUsed, coBorrowerIncome: coInc, incomeBase,
    existingPayments: existing, newPayment, totalPayments: total, ratio, cap: PDN_CAP, quotaCap: PDN_QUOTA_CAP, status, exempt, exemptReason, exemptCitation,
    passes, withinQuota, newSelfEmployedEligible, maxAffordableAmount: maxAffordable, headroom: PDN_CAP - ratio, citations, warnings,
  };
}
