// Out-of-distribution statement layouts the parser was never tuned on. Rows come from a fixture borrower
// (ground truth), rendered into six formats a bank or wallet might export. Writes public/model/ood_eval.json.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { parseCsv, parseXlsx } from "../lib/parse/table";

const here = path.dirname(new URL(import.meta.url).pathname);
const fixture = JSON.parse(fs.readFileSync(path.join(here, "fixture.json"), "utf8")) as { transactions: { date: string; description: string; debit: number; credit: number; balance: number }[] }[];
const rows = fixture[1].transactions.slice(0, 400);
const truth = { n: rows.length, credit: rows.reduce((a, r) => a + r.credit, 0), debit: rows.reduce((a, r) => a + r.debit, 0) };
const ru = (v: number) => v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const en = (v: number) => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const dmy = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

const layouts: { name: string; build: () => Promise<{ n: number; credit: number; debit: number; warnings: string[] }> }[] = [
  { name: "RU CSV, one signed amount column + balance (semicolon, comma decimals)", build: async () => {
      const text = ["Дата;Описание операции;Сумма;Остаток", ...rows.map((r) => `${dmy(r.date)};${r.description};${ru(r.credit ? r.credit : -r.debit)};${ru(r.balance)}`)].join("\n");
      return summarise(await parseCsv("ood1", "ru.csv", text)); } },
  { name: "UZ XLSX, Kirim/Chiqim/Qoldiq columns, numeric cells", build: async () => {
      const aoa = [["Sana", "Vaqt", "Tavsif", "Chiqim", "Kirim", "Qoldiq"], ...rows.map((r) => [r.date, "12:00", r.description, r.debit || null, r.credit || null, r.balance])];
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Ko'chirma");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      return summarise(await parseXlsx("ood2", "uz.xlsx", buf)); } },
  { name: "EN CSV, quoted \"1,250,000.00\" amounts + separate Type column (Credit/Debit)", build: async () => {
      const text = ["Date,Description,Type,Amount,Balance", ...rows.map((r) => `${r.date},"${r.description}",${r.credit ? "Credit" : "Debit"},"${en(r.credit || r.debit)}","${en(r.balance)}"`)].join("\n");
      return summarise(await parseCsv("ood3", "en.csv", text)); } },
  { name: "CSV with Unicode minus (U+2212) for debits and no balance column", build: async () => {
      const text = ["date;description;amount", ...rows.map((r) => `${r.date};${r.description};${r.credit ? r.credit.toFixed(0) : "−" + r.debit.toFixed(0)}`)].join("\n");
      return summarise(await parseCsv("ood4", "minus.csv", text)); } },
  { name: "Headerless CSV: date, description, signed amount, balance", build: async () => {
      const text = rows.map((r) => `${r.date};${r.description};${r.credit ? r.credit.toFixed(2) : (-r.debit).toFixed(2)};${r.balance.toFixed(2)}`).join("\n");
      return summarise(await parseCsv("ood5", "headerless.csv", text)); } },
  { name: "TSV with Приход/Расход columns, dd.mm.yyyy dates, nbsp thousands separators", build: async () => {
      const nb = (v: number) => v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
      const text = ["Дата\tНазначение\tРасход\tПриход\tОстаток", ...rows.map((r) => `${dmy(r.date)}\t${r.description}\t${r.debit ? nb(r.debit) : ""}\t${r.credit ? nb(r.credit) : ""}\t${nb(r.balance)}`)].join("\n");
      return summarise(await parseCsv("ood6", "ru.tsv", text)); } },
];
function summarise(d: { transactions: { credit: number; debit: number }[]; warnings: string[] }) {
  return { n: d.transactions.length, credit: d.transactions.reduce((a, t) => a + t.credit, 0), debit: d.transactions.reduce((a, t) => a + t.debit, 0), warnings: d.warnings };
}

describe("out-of-distribution statement layouts", () => {
  it("parses six unseen layouts with exact row counts and totals", async () => {
    const results = [];
    for (const l of layouts) {
      const r = await l.build();
      const exact = r.n === truth.n && Math.abs(r.credit - truth.credit) < 1 && Math.abs(r.debit - truth.debit) < 1;
      results.push({ layout: l.name, rows: r.n, rows_truth: truth.n, credit: Math.round(r.credit), debit: Math.round(r.debit), exact, warnings: r.warnings });
    }
    fs.writeFileSync(path.join(here, "../public/model/ood_eval.json"), JSON.stringify({ truth: { rows: truth.n, credit: Math.round(truth.credit), debit: Math.round(truth.debit) }, layouts: results,
      exact_count: results.filter((r) => r.exact).length, n: results.length,
      note: "Six statement layouts the parser was never tuned on, built from a fixture borrower's ground-truth rows; written by tests/ood.test.ts." }, null, 1));
    for (const r of results) expect(r.exact, `${r.layout}: ${r.rows}/${r.rows_truth} rows, credit ${r.credit} vs ${Math.round(truth.credit)}, debit ${r.debit} vs ${Math.round(truth.debit)} ${r.warnings.join(" | ")}`).toBe(true);
  });
});
