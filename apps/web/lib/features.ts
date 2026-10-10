// Port of ml/features.py – must stay in lock-step (tests/features.test.ts replays ml/artifacts/fixture.json).
import type { Category, ExistingLoan, MonthlySeries, Transaction } from "./types";

export const FEATURE_NAMES = [
  "log_income", "biz_share", "income_cv", "income_trend", "min_month_ratio", "zero_months", "nonbiz_share",
  "ambiguous_share", "top5_payer_share", "payers_per_month", "dsr_detected", "balance_floor_ratio",
  "balance_end_ratio", "atm_cash_share", "supplier_share", "new_pmt_ratio", "pdn_total", "months_observed",
] as const;
export type FeatureName = typeof FEATURE_NAMES[number];
export type Features = Record<FeatureName, number>;

export const FEATURE_LABELS: Record<FeatureName, string> = {
  log_income: "Income level (log of mean monthly regulatory income)",
  biz_share: "Share of income that is business revenue",
  income_cv: "Income volatility (coefficient of variation)",
  income_trend: "Income trend over the year",
  min_month_ratio: "Worst month relative to the mean",
  zero_months: "Months with almost no business revenue",
  nonbiz_share: "Share of salary / pension / family transfers",
  ambiguous_share: "Share of inflows that are not income (own transfers, cash deposits, refunds)",
  top5_payer_share: "Customer concentration (largest payers' share)",
  payers_per_month: "Distinct paying customers per month",
  dsr_detected: "Debt service visible in the statement / income",
  balance_floor_ratio: "Cash buffer (lowest-decile balance / income)",
  balance_end_ratio: "Closing balance / income",
  atm_cash_share: "Share of spending withdrawn as cash",
  supplier_share: "Supplier payments / business revenue",
  new_pmt_ratio: "Requested loan payment / income",
  pdn_total: "Debt-burden ratio incl. requested loan (ПДН proxy)",
  months_observed: "Months of data available",
};

export const BUSINESS_IN = new Set<Category>(["pos_sale", "customer_p2p", "marketplace_payout"]);
export const NONBIZ_IN = new Set<Category>(["salary", "pension", "relative_transfer"]);
export const NOT_INCOME_IN = new Set<Category>(["loan_disbursement", "self_transfer_in", "refund", "cash_deposit"]);
export const AMBIGUOUS_IN = new Set<Category>(["cash_deposit", "self_transfer_in", "refund"]);
export const ASSUMED_NEW_LOAN_RATE = 0.28;

export function annuity(amount: number, annualRate: number, term: number): number {
  const r = annualRate / 12;
  return r === 0 ? amount / term : (amount * r) / (1 - Math.pow(1 + r, -term));
}

function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (ys[i] - my); den += (i - mx) ** 2; }
  return den ? num / den : 0;
}

function p10(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const k = (s.length - 1) * 0.1;
  const f = Math.floor(k);
  const c = Math.min(f + 1, s.length - 1);
  return s[f] + (s[c] - s[f]) * (k - f);
}

/** The 12 complete calendar months before the application month, ascending. */
export function last12Months(applicationDate: string): string[] {
  const [y0, m0] = applicationDate.slice(0, 7).split("-").map(Number);
  let y = y0, m = m0;
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out.sort();
}

export function monthlySeries(txs: Transaction[], months: string[]): MonthlySeries {
  const idx = new Map(months.map((m, i) => [m, i]));
  const z = () => months.map(() => 0);
  const s: MonthlySeries = { months, regulatoryIncome: z(), businessInflow: z(), nonBusinessInflow: z(),
    ambiguousInflow: z(), debtService: z(), totalDebits: z() };
  for (const t of txs) {
    const i = idx.get(t.date.slice(0, 7));
    if (i === undefined) continue;
    if (t.credit > 0) {
      if (NOT_INCOME_IN.has(t.category)) { if (AMBIGUOUS_IN.has(t.category)) s.ambiguousInflow[i] += t.credit; }
      else {
        s.regulatoryIncome[i] += t.credit;
        if (BUSINESS_IN.has(t.category)) s.businessInflow[i] += t.credit;
        if (NONBIZ_IN.has(t.category)) s.nonBusinessInflow[i] += t.credit;
      }
    }
    if (t.debit > 0) {
      s.totalDebits[i] += t.debit;
      if (t.category === "loan_repayment") s.debtService[i] += t.debit;
    }
  }
  return s;
}

export function computeFeatures(txs: Transaction[], requestedAmount: number, requestedTerm: number,
  existingLoans: Pick<ExistingLoan, "monthly_payment" | "term_months">[], months: string[]): Features {
  const byMonthReg = new Map<string, number>(), byMonthBiz = new Map<string, number>();
  const byMonthPayers = new Map<string, Set<string>>(), byMonthLoan = new Map<string, number>();
  let credits = 0, debits = 0, nonbiz = 0, ambiguous = 0, atm = 0, supplier = 0;
  const payerAmounts = new Map<string, number>();
  const balances: number[] = [];
  const seen = new Set<string>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    seen.add(m);
    const c = t.credit || 0, d = t.debit || 0, cat = t.category;
    if (t.balance !== null && t.balance !== undefined) balances.push(t.balance);
    if (c > 0) {
      credits += c;
      if (NOT_INCOME_IN.has(cat)) { if (AMBIGUOUS_IN.has(cat)) ambiguous += c; }
      else {
        add(byMonthReg, m, c);
        if (BUSINESS_IN.has(cat)) add(byMonthBiz, m, c);
        if (NONBIZ_IN.has(cat)) nonbiz += c;
        if (cat === "customer_p2p") {
          const key = t.description.slice(-9);
          if (!byMonthPayers.has(m)) byMonthPayers.set(m, new Set());
          byMonthPayers.get(m)!.add(key);
          add(payerAmounts, key, c);
        }
      }
    }
    if (d > 0) {
      debits += d;
      if (cat === "loan_repayment") add(byMonthLoan, m, d);
      else if (cat === "atm_cash") atm += d;
      else if (cat === "supplier") supplier += d;
    }
  }
  const n = Math.max(months.length, 1);
  const reg = months.map((m) => byMonthReg.get(m) ?? 0);
  const biz = months.map((m) => byMonthBiz.get(m) ?? 0);
  const regMean = reg.reduce((a, b) => a + b, 0) / n;
  const bizMean = biz.reduce((a, b) => a + b, 0) / n;
  const safe = Math.max(regMean, 1);
  const regStd = Math.sqrt(reg.reduce((a, x) => a + (x - regMean) ** 2, 0) / n);
  const pa = [...payerAmounts.values()];
  const totalP2p = pa.reduce((a, b) => a + b, 0);
  const top5 = pa.sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const newPmt = annuity(requestedAmount, ASSUMED_NEW_LOAN_RATE, requestedTerm);
  let existingPmt = 0;
  for (const l of existingLoans) {
    let pm = l.monthly_payment || 0;
    const term = l.term_months || 12;
    if (term > 36) pm = (pm * term) / 36;
    existingPmt += pm;
  }
  const sumReg = reg.reduce((a, b) => a + b, 0), sumBiz = biz.reduce((a, b) => a + b, 0);
  const monthsObserved = months.filter((m) => seen.has(m)).length;
  return {
    log_income: Math.log(Math.max(regMean, 1e5)),
    biz_share: bizMean / safe,
    income_cv: regStd / safe,
    income_trend: (slope(reg) * 12) / safe,
    min_month_ratio: reg.length ? Math.min(...reg) / safe : 0,
    zero_months: biz.filter((x) => x < 0.1 * Math.max(bizMean, 1)).length,
    nonbiz_share: nonbiz / Math.max(sumReg, 1),
    ambiguous_share: ambiguous / Math.max(credits, 1),
    top5_payer_share: totalP2p > 0 ? top5 / totalP2p : 0,
    payers_per_month: months.reduce((a, m) => a + (byMonthPayers.get(m)?.size ?? 0), 0) / n,
    dsr_detected: (months.reduce((a, m) => a + (byMonthLoan.get(m) ?? 0), 0) / n) / safe,
    balance_floor_ratio: p10(balances) / safe,
    balance_end_ratio: (balances.length ? balances[balances.length - 1] : 0) / safe,
    atm_cash_share: atm / Math.max(debits, 1),
    supplier_share: supplier / Math.max(sumBiz, 1),
    new_pmt_ratio: newPmt / safe,
    pdn_total: (existingPmt + newPmt) / safe,
    months_observed: monthsObserved,
  };
}

export function featureVector(f: Features): number[] {
  return FEATURE_NAMES.map((k) => f[k]);
}
