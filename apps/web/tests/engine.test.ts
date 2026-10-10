import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeFeatures, FEATURE_NAMES, last12Months, monthlySeries } from "../lib/features";
import { predictProbability, type FeatureStats, type RiskModel } from "../lib/risk";
import { computePdn, normalisePayment } from "../lib/rules/pdn";
import { categorizeAll, categorizeOne } from "../lib/categorize";
import { parseTableRows } from "../lib/parse/table";
import { parseAmount, parseDate } from "../lib/parse/common";
import { runCase } from "../lib/case";
import { verifyMemo } from "../lib/memo";
import type { ExistingLoan, ParsedDocument, Transaction } from "../lib/types";

const here = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(here, "fixture.json"), "utf8")) as {
  borrower_id: string; application_date: string; months: string[]; requested_amount: number; requested_term_months: number;
  loans: { lender: string; monthly_payment: number; term_months: number; outstanding_principal: number; days_past_due: number }[];
  transactions: { date: string; time: string; description: string; debit: number; credit: number; balance: number; category: string }[];
  expected_features: Record<string, number>; expected_probability: number;
}[];
const model = JSON.parse(fs.readFileSync(path.join(here, "../public/model/model.json"), "utf8")) as RiskModel;
const stats = JSON.parse(fs.readFileSync(path.join(here, "../public/model/feature_stats.json"), "utf8")) as FeatureStats;

const toTx = (t: (typeof fixture)[0]["transactions"][0], i: number): Transaction => ({
  id: `fx:p1:l${i}`, docId: "fx", page: 1, line: i, date: t.date, time: t.time, description: t.description, debit: t.debit, credit: t.credit,
  balance: t.balance, category: t.category as Transaction["category"],
});
const toLoan = (l: (typeof fixture)[0]["loans"][0], i: number): ExistingLoan => ({ id: `l${i}`, lender: l.lender, monthly_payment: l.monthly_payment,
  term_months: l.term_months, outstanding_principal: l.outstanding_principal, days_past_due: l.days_past_due, role: "borrower", source: "credit-bureau" });

describe("feature parity with ml/features.py", () => {
  for (const fx of fixture) {
    it(`matches Python features and XGBoost probability for ${fx.borrower_id}`, () => {
      const txs = fx.transactions.map(toTx);
      const f = computeFeatures(txs, fx.requested_amount, fx.requested_term_months, fx.loans.map(toLoan), fx.months);
      for (const k of FEATURE_NAMES) expect(f[k], k).toBeCloseTo(fx.expected_features[k], 6);
      expect(predictProbability(model, f)).toBeCloseTo(fx.expected_probability, 5);
      expect(last12Months(fx.application_date)).toEqual(fx.months);
    });
  }
});

describe("rule-based categoriser vs ground-truth labels", () => {
  it("reaches ≥ 90% transaction-level accuracy on the fixture statements", () => {
    let ok = 0, n = 0;
    const confusion: Record<string, number> = {};
    for (const fx of fixture) {
      const txs = fx.transactions.map(toTx);
      const pred = categorizeAll(txs.map((t) => ({ ...t, category: "unknown" as const })));
      pred.forEach((p, i) => { n++; if (p.category === txs[i].category) ok++; else { const k = `${txs[i].category}→${p.category}`; confusion[k] = (confusion[k] ?? 0) + 1; } });
    }
    const acc = ok / n;
    fs.writeFileSync(path.join(here, "../public/model/categorizer_eval.json"), JSON.stringify({ accuracy: acc, n, confusion }, null, 1));
    expect(acc).toBeGreaterThan(0.9);
  });
  it("classifies obvious descriptions", () => {
    expect(categorizeOne({ description: "ZARPLATA OYLIK ISH HAQI", debit: 0, credit: 1 }).cat).toBe("salary");
    expect(categorizeOne({ description: "MKBANK KREDIT TO'LOVI", debit: 1, credit: 0 }).cat).toBe("loan_repayment");
    expect(categorizeOne({ description: "ATM AGROBANK NAQD", debit: 1, credit: 0 }).cat).toBe("atm_cash");
    expect(categorizeOne({ description: "P2P HUMO 8600 **** 1234", debit: 0, credit: 1 }).cat).toBe("customer_p2p");
    expect(categorizeOne({ description: "UZUM MARKET PAYOUT", debit: 0, credit: 1 }).cat).toBe("marketplace_payout");
  });
});

describe("ПДН rule engine — CBU Regulation No. 3618 for banks (lex.uz/uz/docs/7491592)", () => {
  const income = Array(12).fill(5_000_000);
  const req = { amount: 30_000_000, term_months: 24, annual_rate: 0.28, product: "express" as const };
  it("computes the ratio against the 50% limit (cl.3 ¶1)", () => {
    const r = computePdn({ monthlyIncome: income, existingLoans: [], request: req });
    expect(r.meanIncome).toBe(5_000_000);
    expect(r.monthsUsed).toBe(12);
    expect(r.ratio).toBeCloseTo(r.newPayment / 5_000_000, 10);
    expect(r.passes).toBe(r.ratio <= 0.5);
    expect(r.status).toBe(r.ratio <= 0.5 ? "pass" : r.ratio <= 1 ? "quota" : "fail");
    expect(r.maxAffordableAmount).toBeGreaterThan(0);
    expect(r.citations).toEqual(expect.arrayContaining(["definition", "cap", "income", "accountInflows", "evidence", "calcDate"]));
  });
  it("spreads long terms over 36 (microloan) / 60 (loan) / 180 (mortgage) months (cl.8)", () => {
    expect(normalisePayment(1_000_000, 48)).toBeCloseTo(1_333_333.33, 0);
    expect(normalisePayment(1_000_000, 36)).toBe(1_000_000);
    expect(normalisePayment(1_000_000, 48, "loan")).toBe(1_000_000);
    expect(normalisePayment(1_000_000, 72, "loan")).toBeCloseTo(1_200_000, 0);
    expect(normalisePayment(1_000_000, 200, "mortgage")).toBeCloseTo(1_111_111.11, 0);
  });
  it("counts guarantor loans only when > 30 days overdue (cl.7)", () => {
    const g = (dpd: number): ExistingLoan => ({ id: "g", lender: "X", monthly_payment: 1_000_000, term_months: 12, outstanding_principal: 5_000_000, days_past_due: dpd, role: "guarantor", source: "manual" });
    const a = computePdn({ monthlyIncome: income, existingLoans: [g(0)], request: req });
    const b = computePdn({ monthlyIncome: income, existingLoans: [g(45)], request: req });
    expect(a.existingPayments[0].value).toBe(0);
    expect(b.existingPayments[0].value).toBe(1_000_000);
    expect(b.ratio).toBeGreaterThan(a.ratio);
  });
  it("has no small-loan or BRV exclusion for a bank; 50–100% is quota-only (cl.3 ¶3); family-programme loans are exempt (cl.4)", () => {
    const inc = Array(12).fill(1_000_000);
    const small = computePdn({ monthlyIncome: inc, existingLoans: [], request: { ...req, amount: 5_000_000, term_months: 12 } });
    expect(small.exempt).toBe(false); expect(small.passes).toBe(small.ratio <= 0.5);
    const mid = computePdn({ monthlyIncome: inc, existingLoans: [], request: { ...req, amount: 8_000_000, term_months: 12 } });
    expect(mid.ratio).toBeGreaterThan(0.5); expect(mid.ratio).toBeLessThanOrEqual(1);
    expect(mid.status).toBe("quota"); expect(mid.withinQuota).toBe(true); expect(mid.passes).toBe(false); expect(mid.citations).toContain("quota100");
    const big = computePdn({ monthlyIncome: inc, existingLoans: [], request: { ...req, amount: 40_000_000, term_months: 12 } });
    expect(big.ratio).toBeGreaterThan(1); expect(big.status).toBe("fail"); expect(big.withinQuota).toBe(false);
    const fam = computePdn({ monthlyIncome: inc, existingLoans: [], request: { ...req, amount: 40_000_000, product: "family_program" } });
    expect(fam.exempt).toBe(true); expect(fam.exemptCitation).toBe("exempt"); expect(fam.status).toBe("exempt"); expect(fam.passes).toBe(true);
  });
  it("flags a self-employed registration under 6 months old for the cl.3 ¶4 quota, and not an older one", () => {
    const young = computePdn({ monthlyIncome: income, existingLoans: [], request: req, selfEmployedRegisteredSince: "2026-06-20", applicationDate: "2026-10-10" });
    expect(young.newSelfEmployedEligible).toBe(true); expect(young.citations).toContain("newSelfEmployed");
    const old = computePdn({ monthlyIncome: income, existingLoans: [], request: req, selfEmployedRegisteredSince: "2025-06-20", applicationDate: "2026-10-10" });
    expect(old.newSelfEmployedEligible).toBe(false);
    const exact = computePdn({ monthlyIncome: income, existingLoans: [], request: req, selfEmployedRegisteredSince: "2026-04-10", applicationDate: "2026-10-10" });
    expect(exact.newSelfEmployedEligible).toBe(false);   // exactly six months is not "less than six months"
  });
  it("averages over 6–11 months when fewer than 12 exist, and marks under 6 as insufficient (cl.13)", () => {
    const nine = computePdn({ monthlyIncome: [0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 3, 3].map((x) => x * 1_000_000), monthsObserved: 9, existingLoans: [], request: req });
    expect(nine.monthsUsed).toBe(9); expect(nine.meanIncome).toBe(3_000_000); expect(nine.status).not.toBe("insufficient_history");
    expect(nine.warnings.some((w) => /one-ninth/.test(w))).toBe(true);
    const four = computePdn({ monthlyIncome: [3_000_000, 3_000_000, 3_000_000, 3_000_000], monthsObserved: 4, existingLoans: [], request: req });
    expect(four.status).toBe("insufficient_history");
  });
  it("uses the median only when asked and only when it is lower than the mean (cl.14)", () => {
    const skewed = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 30].map((x) => x * 1_000_000);
    const mean = computePdn({ monthlyIncome: skewed, existingLoans: [], request: req });
    const med = computePdn({ monthlyIncome: skewed, useMedian: true, existingLoans: [], request: req });
    expect(mean.medianUsed).toBe(false); expect(mean.meanIncome).toBeCloseTo(41_000_000 / 12, 2);
    expect(med.medianUsed).toBe(true); expect(med.meanIncome).toBe(1_000_000); expect(med.ratio).toBeGreaterThan(mean.ratio); expect(med.citations).toContain("median");
    const flat = computePdn({ monthlyIncome: income, useMedian: true, existingLoans: [], request: req });
    expect(flat.medianUsed).toBe(false);
  });
  it("adds co-borrower income to the base (cl.18)", () => {
    const a = computePdn({ monthlyIncome: income, existingLoans: [], request: req });
    const b = computePdn({ monthlyIncome: income, coBorrowerMonthlyIncome: 5_000_000, existingLoans: [], request: req });
    expect(b.ratio).toBeCloseTo(a.ratio / 2, 10);
  });
  it("max affordable amount lands exactly at the 50% limit", () => {
    const r = computePdn({ monthlyIncome: income, existingLoans: [], request: req });
    const at = computePdn({ monthlyIncome: income, existingLoans: [], request: { ...req, amount: r.maxAffordableAmount } });
    expect(at.ratio).toBeLessThanOrEqual(0.5);
    const over = computePdn({ monthlyIncome: income, existingLoans: [], request: { ...req, amount: r.maxAffordableAmount + 200_000 } });
    expect(over.ratio).toBeGreaterThan(0.5);
  });
  it("handles zero income", () => {
    const z = computePdn({ monthlyIncome: [], existingLoans: [], request: req });
    expect(z.ratio).toBe(Number.POSITIVE_INFINITY); expect(z.passes).toBe(false); expect(z.maxAffordableAmount).toBe(0); expect(z.status).toBe("no_income");
  });
});

describe("parsers", () => {
  it("parses amounts in local formats", () => {
    expect(parseAmount("1 234 567.89")).toBeCloseTo(1234567.89);
    expect(parseAmount("1,234,567.89")).toBeCloseTo(1234567.89);
    expect(parseAmount("1234567,89")).toBeCloseTo(1234567.89);
    expect(parseAmount("-12 000")).toBe(-12000);
    expect(parseAmount("P2P HUMO")).toBeNull();
    expect(parseDate("2025-09-01")).toBe("2025-09-01");
    expect(parseDate("01.09.2025")).toBe("2025-09-01");
  });
  it("parses the sample CSV statement and reconciles balances", () => {
    const csv = fs.readFileSync(path.join(here, "../public/samples/A/statement.csv"), "utf8");
    const rows = csv.split(/\r?\n/).filter(Boolean).map((l) => l.split(";").map((c) => (c === "" ? null : c)));
    const r = parseTableRows("csvA", rows);
    expect(r.txs.length).toBeGreaterThan(200);
    let breaks = 0;
    for (let i = 1; i < r.txs.length; i++) {
      const p = r.txs[i - 1].balance!, b = r.txs[i].balance!;
      if (Math.abs(p + r.txs[i].credit - r.txs[i].debit - b) > 1) breaks++;
    }
    expect(breaks).toBe(0);
  });
  it("infers signs from the balance chain when only an amount column exists", () => {
    const rows = [["Date", "Description", "Amount", "Balance"], ["2026-01-02", "P2P HUMO 8600 **** 1111", "100000", "1100000"], ["2026-01-03", "KORZINKA", "40000", "1060000"], ["2026-01-04", "P2P HUMO 8600 **** 2222", "50000", "1110000"]];
    const r = parseTableRows("t", rows);
    expect(r.txs[1].debit).toBe(40000); expect(r.txs[2].credit).toBe(50000);
  });
});

describe("end-to-end case on fixture + memo verifier", () => {
  it("runs a case and produces a memo with zero unsourced numbers", () => {
    const fx = fixture[0];
    const doc: ParsedDocument = { id: "d1", fileName: "statement.pdf", kind: "statement", mime: "application/pdf", pages: 10, holderName: "TEST HOLDER",
      transactions: fx.transactions.map(toTx).map((t) => ({ ...t, category: "unknown" as const })), fields: [], warnings: [], parseMs: 1 };
    const res = runCase({ applicationDate: fx.application_date, documents: [doc], existingLoans: fx.loans.map(toLoan),
      request: { amount: fx.requested_amount, term_months: fx.requested_term_months, annual_rate: 0.28, product: "express" } }, model, stats);
    expect(res.memo.verification.ok, JSON.stringify(res.memo.verification)).toBe(true);
    expect(res.memo.verification.numbersChecked).toBeGreaterThan(10);
    expect(["approve", "approve_reduced", "refer", "decline"]).toContain(res.recommendation);
    expect(verifyMemo({ ...res.memo, sections: [{ title: "x", paragraphs: [{ text: "Income is 999,999 UZS", sources: [] }] }] }).ok).toBe(false);
    const s = monthlySeries(res.transactions, res.months);
    expect(s.regulatoryIncome.length).toBe(12);
  });
});

describe("memo verifier sweep — every scenario must verify", () => {
  it("verifies across amounts, terms, products and borrowers (incl. family-programme exemption, quota band, refer/decline)", () => {
    const products = ["ommabop", "express", "business_online", "family_program"] as const;
    const amounts = [3_000_000, 15_000_000, 25_000_000, 60_000_000, 100_000_000];
    const terms = [12, 36, 60];
    const failures: string[] = [];
    let n = 0;
    for (const fx of fixture) {
      const doc: ParsedDocument = { id: "d1", fileName: "statement.pdf", kind: "statement", mime: "application/pdf", pages: 10, holderName: "TEST HOLDER",
        transactions: fx.transactions.map(toTx).map((t) => ({ ...t, category: "unknown" as const })), fields: [], warnings: [], parseMs: 1 };
      for (const product of products) for (const amount of amounts) for (const term of terms) {
        n++;
        const res = runCase({ applicationDate: fx.application_date, documents: [doc], existingLoans: fx.loans.map(toLoan),
          request: { amount, term_months: term, annual_rate: product === "family_program" ? 0.14 : 0.28, product } }, model, stats);
        if (!res.memo.verification.ok) failures.push(`${fx.borrower_id} ${product} ${amount} ${term}: ${res.memo.verification.unsourced.join(",")} | ${res.recommendation}`);
      }
    }
    expect(failures, failures.slice(0, 5).join("\n")).toEqual([]);
    expect(n).toBe(300);
  });
});


describe("direction safety net", () => {
  it("flags a statement with only positive amounts and no type/balance column as high severity and refers the case", () => {
    const fx = fixture[0];
    const rows = [["Date", "Description", "Amount"], ...fx.transactions.slice(0, 200).map((t) => [t.date, t.description, String(t.credit || t.debit)])];
    const r = parseTableRows("pos", rows);
    expect(r.assumedSignRows).toBe(200);
    const doc: ParsedDocument = { id: "pos", fileName: "positive-only.csv", kind: "statement", mime: "text/csv", pages: 1, transactions: r.txs, fields: [], warnings: r.warnings, assumedSignRows: r.assumedSignRows, parseMs: 1 };
    const res = runCase({ applicationDate: fx.application_date, documents: [doc], existingLoans: [], request: { amount: 5_000_000, term_months: 12, annual_rate: 0.28, product: "express" } }, model, stats);
    const dir = res.checks.find((c) => c.id.startsWith("direction:"));
    expect(dir?.passed).toBe(false); expect(dir?.severity).toBe("high");
    expect(res.recommendation).toBe("refer");
    expect(res.memo.verification.ok).toBe(true);
  });
  it("does not flag a signed-amount column (negatives present)", () => {
    const fx = fixture[0];
    const rows = [["Date", "Description", "Amount"], ...fx.transactions.slice(0, 200).map((t) => [t.date, t.description, String(t.credit ? t.credit : -t.debit)])];
    const r = parseTableRows("sgn", rows);
    expect(r.assumedSignRows).toBe(0);
  });
});
