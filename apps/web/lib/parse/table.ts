// XLSX / CSV statement parsing (SheetJS). Finds the header row, maps columns by multilingual header names,
// falls back to balance-chain sign inference when only an amount column exists.
import type { ParsedDocument, Transaction } from "../types";
import { FAILED_STATUS, HEADER_WORDS, TYPE_HEADER, excelDateToIso, inferSignsFromBalance, makeTx, parseAmount, parseDate, periodOf, signFromType } from "./common";

type Cell = string | number | null | undefined;

function cellDate(c: Cell): string | null {
  if (typeof c === "number" && c > 20000 && c < 80000) return excelDateToIso(c);
  if (typeof c === "string") return parseDate(c);
  return null;
}
function cellAmount(c: Cell): number | null {
  if (typeof c === "number") return c;
  if (typeof c === "string") return parseAmount(c);
  return null;
}

export function parseTableRows(docId: string, rows: Cell[][]): { txs: Transaction[]; holder?: string; cardMask?: string; warnings: string[] } {
  const warnings: string[] = [];
  let holder: string | undefined, cardMask: string | undefined;
  // header detection
  let hdr = -1;
  const map: Record<string, number> = {};
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const r = rows[i] ?? [];
    const m: Record<string, number> = {};
    r.forEach((c, j) => {
      if (typeof c !== "string") return;
      const s = c.trim();
      if (HEADER_WORDS.date.test(s)) m.date = j;
      else if (HEADER_WORDS.time.test(s)) m.time = j;
      else if (HEADER_WORDS.status.test(s)) m.status = j;
      else if (HEADER_WORDS.debit.test(s)) m.debit = j;
      else if (HEADER_WORDS.credit.test(s)) m.credit = j;
      else if (HEADER_WORDS.balance.test(s)) m.balance = j;
      else if (HEADER_WORDS.amount.test(s)) m.amount = j;
      else if (TYPE_HEADER.test(s)) m.type = j;
      else if (HEADER_WORDS.desc.test(s)) m.desc = j;
    });
    if (m.date !== undefined && (m.debit !== undefined || m.credit !== undefined || m.amount !== undefined)) { hdr = i; Object.assign(map, m); break; }
  }
  for (let i = 0; i < Math.min(rows.length, hdr < 0 ? 10 : hdr); i++) {
    const r = rows[i] ?? [];
    const line = r.filter((c) => c !== null && c !== undefined).map(String).join(" ");
    if (!holder) { const m = line.match(/(Владелец|Egasi|Holder|Card holder|Клиент)\s*:?\s*(.+)/i); if (m) holder = m[2].trim(); }
    if (!cardMask) { const m = line.match(/(\d{4})\s?\*{4}\s?\*{4}\s?(\d{4})/) ?? line.match(/(\d{4})\d{0,2}\*{4,8}(\d{4})/); if (m) cardMask = `${m[1]} **** **** ${m[2]}`; }
  }
  const out: { tx: Transaction; amount: number; signed: boolean }[] = [];
  let n = 0, dropped = 0, skippedFailed = 0;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    let date: string | null = null, dcol = map.date;
    if (dcol !== undefined) date = cellDate(r[dcol]);
    if (!date) { for (let j = 0; j < r.length; j++) { const d = cellDate(r[j]); if (d) { date = d; dcol = j; break; } } }
    if (!date) continue;
    if (map.status !== undefined && typeof r[map.status] === "string" && FAILED_STATUS.test(r[map.status] as string)) { skippedFailed++; continue; }
    n++;
    let time = map.time !== undefined && typeof r[map.time] === "string" ? String(r[map.time]) : undefined;
    if (!time && dcol !== undefined && typeof r[dcol] === "string") { const tm = (r[dcol] as string).match(/(\d{1,2}:\d{2})(:\d{2})?/); if (tm) time = tm[1]; }
    if (!cardMask) { for (const c of r) { if (typeof c === "string") { const m = c.match(/(\d{4})\d{0,2}\*{4,8}(\d{4})/); if (m) { cardMask = `${m[1]} **** **** ${m[2]}`; break; } } } }
    let debit = 0, credit = 0, balance: number | null = null, amount = 0, signed = false;
    if (map.debit !== undefined) { const v = cellAmount(r[map.debit]); if (v) { debit = Math.abs(v); amount = -Math.abs(v); signed = true; } }
    if (map.credit !== undefined) { const v = cellAmount(r[map.credit]); if (v) { credit = Math.abs(v); amount = Math.abs(v); signed = true; } }
    if (map.balance !== undefined) balance = cellAmount(r[map.balance]);
    if (!signed && map.amount !== undefined) {
      const v = cellAmount(r[map.amount]);
      if (v !== null) {
        amount = v;
        const ty = map.type !== undefined ? signFromType(r[map.type]) : null;
        if (ty === "credit") { credit = Math.abs(v); amount = Math.abs(v); signed = true; }
        else if (ty === "debit") { debit = Math.abs(v); amount = -Math.abs(v); signed = true; }
        else if (v < 0) { debit = -v; signed = true; }
      }
    }
    if (hdr < 0) {
      // headerless: numbers right of the date: amount, balance
      const nums = r.map((c, j) => ({ v: cellAmount(c), j })).filter((x) => x.v !== null && x.j !== dcol && Math.abs(x.v as number) < 5e9) as { v: number; j: number }[];
      if (nums.length >= 2) { amount = nums[nums.length - 2].v; balance = nums[nums.length - 1].v; }
      else if (nums.length === 1) amount = nums[0].v;
      if (amount < 0) { debit = -amount; signed = true; }
    }
    const desc = map.desc !== undefined ? String(r[map.desc] ?? "") :
      r.filter((c, j) => j !== dcol && typeof c === "string" && cellAmount(c) === null && !parseDate(c)).map(String).join(" ");
    if (amount === 0 && debit === 0 && credit === 0) { dropped++; continue; }  // a dated row with no recognisable amount
    out.push({ tx: makeTx(docId, 1, n, date, desc, debit, credit, balance, time), amount, signed });
  }
  if (dropped > 0) warnings.push(`${dropped} dated row(s) had no recognisable amount and were skipped — check the amount format.`);
  if (skippedFailed > 0) warnings.push(`${skippedFailed} row(s) with a failed/cancelled status were ignored.`);
  const unsigned = out.filter((o) => !o.signed);
  if (unsigned.length) {
    const signs = inferSignsFromBalance(out.map((o) => ({ amount: o.amount, balance: o.tx.balance })));
    out.forEach((o, i) => {
      if (o.signed) return;
      const a = Math.abs(o.amount);
      if (signs[i] === "credit") o.tx.credit = a; else if (signs[i] === "debit") o.tx.debit = a; else { o.tx.credit = a; }
    });
    if (map.debit === undefined && map.credit === undefined && map.type === undefined) warnings.push("No debit/credit or type columns: negative amounts treated as debits; other signs resolved from the balance chain, or assumed credits when there is no balance column.");
  }
  if (!out.length) warnings.push("No transaction rows recognised in this table.");
  return { txs: out.map((o) => o.tx), holder, cardMask, warnings };
}

export async function parseXlsx(docId: string, fileName: string, data: ArrayBuffer): Promise<ParsedDocument> {
  const t0 = performance.now();
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null });
  const r = parseTableRows(docId, rows);
  const per = periodOf(r.txs);
  return { id: docId, fileName, kind: "statement", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pages: 1,
    holderName: r.holder, cardMask: r.cardMask, periodFrom: per.from, periodTo: per.to, transactions: r.txs, fields: [],
    warnings: r.warnings, textSample: rows.slice(0, 8).map((x) => (x ?? []).join(" | ")).join("\n"), parseMs: Math.round(performance.now() - t0) };
}

export async function parseCsv(docId: string, fileName: string, text: string): Promise<ParsedDocument> {
  const t0 = performance.now();
  // SheetJS handles quoted fields ("1,250,000.00"), embedded delimiters and BOMs; we only pick the delimiter.
  const first = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = { ";": (first.match(/;/g) ?? []).length, "\t": (first.match(/\t/g) ?? []).length, ",": (first.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) ?? []).length };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",") as string;
  const XLSX = await import("xlsx");
  const wb = XLSX.read(text.replace(/^\ufeff/, ""), { type: "string", raw: true, FS: delim });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null }).map((row) => (row ?? []).map((c) => (typeof c === "string" ? (c.trim() === "" ? null : c.trim()) : c)));
  const r = parseTableRows(docId, rows);
  const per = periodOf(r.txs);
  return { id: docId, fileName, kind: "statement", mime: "text/csv", pages: 1, holderName: r.holder, cardMask: r.cardMask,
    periodFrom: per.from, periodTo: per.to, transactions: r.txs, fields: [], warnings: r.warnings,
    textSample: rows.slice(0, 8).map((x) => x.join(" | ")).join("\n"), parseMs: Math.round(performance.now() - t0) };
}
