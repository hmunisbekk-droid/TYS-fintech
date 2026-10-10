// Real-world PDF layout the parser was never tuned on: a Russian bank statement with TWO date columns
// (Дата операции / Дата проводки), a document-number column, a 20-digit correspondent-account column, a header
// wrapped over two lines and descriptions wrapped over two lines. Rendered by headless Chromium from a synthetic
// borrower's ground truth (tests/fixtures/statement_twodate.pdf, truth in truth_twodate.json). The CSV twin of the
// same layout is parsed by the table parser. Both must keep the OPERATION date (first date column).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { groupTokens, parseStatementLines } from "../lib/parse/pdf";
import { parseCsv } from "../lib/parse/table";

const here = path.dirname(new URL(import.meta.url).pathname);
const fx = (f: string) => path.join(here, "fixtures", f);
const truth = JSON.parse(fs.readFileSync(fx("truth_twodate.json"), "utf8")) as { n: number; credit: number; debit: number; credit_by_month_op: Record<string, number>; credit_by_month_post: Record<string, number>; differing_dates: number };

async function pdfLines(file: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(here, "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    lines.push(...groupTokens(content.items as { str: string; transform: number[]; width: number }[], p));
  }
  return { lines, pages: doc.numPages };
}

function byMonth(txs: { date: string; credit: number }[]) {
  const m: Record<string, number> = {};
  for (const t of txs) m[t.date.slice(0, 7)] = (m[t.date.slice(0, 7)] ?? 0) + t.credit;
  return m;
}
function chainOk(txs: { debit: number; credit: number; balance: number | null }[]) {
  let bad = 0;
  for (let i = 1; i < txs.length; i++) {
    const p = txs[i - 1].balance, b = txs[i].balance;
    if (p === null || b === null) { bad++; continue; }
    if (Math.abs(p + txs[i].credit - txs[i].debit - b) > 0.01) bad++;
  }
  return bad;
}

describe("two-date-column statement layout (Дата операции / Дата проводки)", () => {
  it("PDF: exact rows and totals, operation date kept, balance chain intact", async () => {
    const { lines, pages } = await pdfLines(fx("statement_twodate.pdf"));
    expect(pages).toBeGreaterThan(10);
    const r = parseStatementLines("pdf2d", lines);
    const credit = r.txs.reduce((a, t) => a + t.credit, 0), debit = r.txs.reduce((a, t) => a + t.debit, 0);
    expect(r.txs.length, r.warnings.join(" | ")).toBe(truth.n);
    expect(Math.abs(credit - truth.credit)).toBeLessThan(1);
    expect(Math.abs(debit - truth.debit)).toBeLessThan(1);
    expect(truth.differing_dates).toBeGreaterThan(100);              // the posting date really differs on many rows
    expect(byMonth(r.txs)).toEqual(truth.credit_by_month_op);         // months follow the operation date …
    expect(byMonth(r.txs)).not.toEqual(truth.credit_by_month_post);   // … not the posting date
    expect(chainOk(r.txs)).toBe(0);
    expect(r.assumedSignRows).toBe(0);
    expect(r.warnings.filter((w) => /skipped|No transaction/.test(w))).toEqual([]);
    expect(r.holder).toMatch(/TESTOV/);
    expect(r.cardMask).toBe("8600 **** **** 1234");
    expect(r.txs.some((t) => /SARTAROSHLIK TERMINAL$/.test(t.description))).toBe(true);   // wrapped description line re-joined
    expect(r.txs.every((t) => !/\d{12,}/.test(String(t.credit)) && t.credit < 1e9 && t.debit < 1e9)).toBe(true);   // identifiers never become amounts
  });

  it("CSV twin: first date column wins", async () => {
    const d = await parseCsv("csv2d", "statement_twodate.csv", fs.readFileSync(fx("statement_twodate.csv"), "utf8"));
    expect(d.transactions.length, d.warnings.join(" | ")).toBe(truth.n);
    expect(Math.abs(d.transactions.reduce((a, t) => a + t.credit, 0) - truth.credit)).toBeLessThan(1);
    expect(Math.abs(d.transactions.reduce((a, t) => a + t.debit, 0) - truth.debit)).toBeLessThan(1);
    expect(byMonth(d.transactions)).toEqual(truth.credit_by_month_op);
    expect(chainOk(d.transactions)).toBe(0);
    expect(d.assumedSignRows ?? 0).toBe(0);
  });
});
