// Integrity and plausibility checks on statements and cross-document consistency. Each check is a named
// rule with severity, a plain explanation and evidence pointers (transaction ids / document ids).
import { counterpartyKey } from "./categorize";
import type { ParsedDocument, Transaction } from "./types";

export type Severity = "high" | "medium" | "low" | "info";
export interface Check { id: string; title: string; severity: Severity; passed: boolean; detail: string; evidence: string[] }

const money = (v: number) => Math.round(v).toLocaleString("en-US");

export function runIntegrityChecks(docs: ParsedDocument[], txs: Transaction[], months: string[]): Check[] {
  const checks: Check[] = [];
  const statements = docs.filter((d) => d.kind === "statement");

  // 1. running-balance reconciliation per statement
  for (const d of statements) {
    const rows = d.transactions.filter((t) => t.balance !== null);
    let breaks = 0; const ev: string[] = [];
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1].balance!, b = rows[i].balance!;
      const expected = p + rows[i].credit - rows[i].debit;
      if (Math.abs(expected - b) > 1) { breaks++; if (ev.length < 5) ev.push(rows[i].id); }
    }
    if (rows.length >= 3) checks.push({ id: `balance_chain:${d.id}`, title: `Running balance reconciles (${d.fileName})`, severity: "high",
      passed: breaks === 0, detail: breaks === 0 ? `All ${rows.length} rows chain correctly.` : `${breaks} row(s) break the balance chain — edited or missing lines.`, evidence: ev });
    else if (d.transactions.length) checks.push({ id: `balance_chain:${d.id}`, title: `Running balance reconciles (${d.fileName})`, severity: "info", passed: true, detail: "No balance column to reconcile.", evidence: [] });
  }

  // 1b. direction safety net: rows whose credit/debit direction had to be assumed inflate income
  for (const d of statements) {
    const assumed = d.assumedSignRows ?? 0;
    if (!d.transactions.length) continue;
    const share = assumed / d.transactions.length;
    if (assumed > 0) checks.push({ id: `direction:${d.id}`, title: `Transaction direction is determinable (${d.fileName})`, severity: share > 0.2 || assumed >= 10 ? "high" : "medium", passed: false,
      detail: `${assumed} of ${d.transactions.length} rows have no debit/credit, type or balance information and were counted as inflows — income may be overstated. Ask for an export with a type or balance column; refer, do not approve on this figure.`,
      evidence: d.transactions.filter((t) => t.categoryReason === "direction assumed (credit)").slice(0, 5).map((t) => t.id) });
  }

  // 2. exact duplicates
  const seen = new Map<string, string>(); const dups: Transaction[] = [];
  for (const t of txs) {
    const k = `${t.date}|${t.description}|${t.debit}|${t.credit}`;
    if (seen.has(k)) dups.push(t); else seen.set(k, t.id);
  }
  const bigDups = dups.filter((t) => t.credit >= 500_000);
  checks.push({ id: "duplicates", title: "No duplicated inflow lines", severity: bigDups.length ? "medium" : "low", passed: bigDups.length === 0,
    detail: bigDups.length ? `${bigDups.length} inflow line(s) ≥ 500,000 repeat date, description and amount.` :
      dups.length ? `${dups.length} small repeated line(s) (same day, same amount) — consistent with repeat customers.` : "No duplicates.", evidence: (bigDups.length ? bigDups : dups).slice(0, 5).map((t) => t.id) });

  // 3. coverage of the 12-month window
  const present = new Set(txs.map((t) => t.date.slice(0, 7)));
  const missing = months.filter((m) => !present.has(m));
  checks.push({ id: "coverage", title: "Statements cover the 12 assessment months", severity: missing.length > 3 ? "high" : missing.length ? "medium" : "info",
    passed: missing.length === 0, detail: missing.length ? `Missing months: ${missing.join(", ")}.` : "All 12 months present.", evidence: [] });

  // 4. gaps > 45 days inside the covered period
  const dates = [...new Set(txs.map((t) => t.date))].sort();
  const gaps: string[] = [];
  for (let i = 1; i < dates.length; i++) {
    const g = (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 86400000;
    if (g > 45) gaps.push(`${dates[i - 1]} → ${dates[i]} (${g} days)`);
  }
  checks.push({ id: "gaps", title: "No unexplained gaps in activity", severity: "low", passed: gaps.length === 0,
    detail: gaps.length ? gaps.join("; ") : "Longest gap under 45 days.", evidence: [] });

  // 5. window dressing: round-sum large inflows appearing in the last 45 days at a rate the account never showed before
  if (dates.length) {
    const last = Date.parse(dates[dates.length - 1]), first = Date.parse(dates[0]);
    const spanMonths = Math.max(1, (last - first) / (30 * 86400000));
    const isRound = (t: Transaction) => t.credit >= 1_000_000 && t.credit % 500_000 === 0 && t.category !== "self_transfer_in" && t.category !== "loan_disbursement";
    const recentWin = 45 * 86400000;
    const recent = txs.filter((t) => t.credit > 0 && last - Date.parse(t.date) <= recentWin && t.category !== "self_transfer_in");
    const earlier = txs.filter((t) => t.credit > 0 && last - Date.parse(t.date) > recentWin && t.category !== "self_transfer_in");
    const roundRecent = recent.filter(isRound), roundEarlier = earlier.filter(isRound);
    const earlierMonths = Math.max(0.5, spanMonths - 1.5);
    const roundRate = roundEarlier.length / earlierMonths;              // round large inflows per month, before the window
    const recentSum = recent.reduce((a, t) => a + t.credit, 0);
    const earlierMonthly = earlier.reduce((a, t) => a + t.credit, 0) / earlierMonths;
    const roundSum = roundRecent.reduce((a, t) => a + t.credit, 0);
    const flag = earlier.length > 20 && roundRecent.length >= 2 && roundRecent.length > 2 * roundRate * 1.5 + 1 && roundSum >= 0.25 * earlierMonthly;
    checks.push({ id: "window_dressing", title: "No inflow spike right before the application", severity: "medium", passed: !flag,
      detail: flag ? `${roundRecent.length} round-sum inflows ≥ 1M (${money(roundSum)}) in the last 45 days vs ${roundRate.toFixed(1)} per month before; last-45-day inflows ${money(recentSum)} vs typical month ${money(earlierMonthly)}.` :
        `Last-45-day inflows ${money(recentSum)} vs typical month ${money(earlierMonthly)}; ${roundRecent.length} round-sum inflows ≥ 1M (${roundRate.toFixed(1)} per month before).`, evidence: roundRecent.slice(0, 6).map((t) => t.id) });
  }

  // 6. circular flows: same counterparty in and out within 3 days
  const outs = txs.filter((t) => t.debit > 0 && counterpartyKey(t.description));
  const circ: string[] = []; let excludedPairs = 0;
  for (const o of outs) {
    const k = counterpartyKey(o.description);
    const back = txs.find((t) => t.credit > 0 && counterpartyKey(t.description) === k && Math.abs(Date.parse(t.date) - Date.parse(o.date)) <= 3 * 86400000 && Math.abs(t.credit - o.debit) < 1);
    if (!back) continue;
    if (back.category === "self_transfer_in") excludedPairs++;   // already excluded from income by the categoriser
    else circ.push(o.id, back.id);
  }
  checks.push({ id: "circular", title: "No circular transfers counted as income", severity: "medium", passed: circ.length === 0,
    detail: circ.length ? `${circ.length / 2} round-trip pair(s) still counted as income — review.` :
      excludedPairs ? `${excludedPairs} own-card round-trip pair(s) detected and excluded from income.` : "None found.", evidence: circ.slice(0, 6) });

  // 7. cross-document holder name consistency
  const names = docs.map((d) => d.holderName ?? d.fields.find((f) => f.name === "holder")?.value).filter((n): n is string => !!n).map((n) => n.toUpperCase().replace(/\s+/g, " ").trim());
  if (names.length >= 2) {
    const uniq = [...new Set(names)];
    checks.push({ id: "holder_match", title: "Holder name matches across documents", severity: "high", passed: uniq.length === 1,
      detail: uniq.length === 1 ? `All documents: ${uniq[0]}.` : `Different names: ${uniq.join(" / ")}.`, evidence: [] });
  }

  // 8. opening balance stated vs first row
  for (const d of statements) {
    if (d.openingBalance === null || d.openingBalance === undefined) continue;
    const first = d.transactions.find((t) => t.balance !== null);
    if (!first) continue;
    const implied = first.balance! - first.credit + first.debit;
    checks.push({ id: `opening:${d.id}`, title: `Stated opening balance matches first row (${d.fileName})`, severity: "medium",
      passed: Math.abs(implied - d.openingBalance) <= 1, detail: `Stated ${money(d.openingBalance)}, implied ${money(implied)}.`, evidence: first ? [first.id] : [] });
  }
  // 9. receipts: same tax ID, dates inside the statement window, and business inflows on those days
  const receipts = docs.filter((d) => d.kind === "receipt");
  if (receipts.length) {
    const inns = [...new Set(receipts.map((d) => d.fields.find((f) => f.name === "inn")?.value).filter((v): v is string => !!v))];
    const rdates = receipts.map((d) => d.fields.find((f) => f.name === "date")?.value).filter((v): v is string => !!v);
    const inWindow = rdates.filter((d) => months.includes(d.slice(0, 7)));
    const bizDays = new Set(txs.filter((t) => t.credit > 0 && (t.category === "pos_sale" || t.category === "customer_p2p" || t.category === "marketplace_payout")).map((t) => t.date));
    const corroborated = inWindow.filter((d) => { const t = Date.parse(d); return [-1, 0, 1].some((k) => bizDays.has(new Date(t + k * 86400000).toISOString().slice(0, 10))); });
    checks.push({ id: "receipts_inn", title: "Receipts come from one tax ID (INN/STIR)", severity: "medium", passed: inns.length <= 1,
      detail: inns.length <= 1 ? (inns.length ? `All ${receipts.length} receipt(s) carry INN ${inns[0]}.` : "No INN read from the receipts.") : `${inns.length} different INNs on the receipts: ${inns.join(", ")} — not the same business.`, evidence: [] });
    checks.push({ id: "receipts_corroborate", title: "Receipt dates fall in the window and match business inflows", severity: "low", passed: inWindow.length === rdates.length && corroborated.length === inWindow.length,
      detail: `${inWindow.length}/${rdates.length} receipt date(s) inside the 12-month window; ${corroborated.length}/${inWindow.length} have business inflows on the same day (±1).`, evidence: [] });
  }
  return checks;
}
