// Shared parsing helpers: dates, amounts, header detection, debit/credit inference.
import type { Transaction } from "../types";

export const DATE_RES: { re: RegExp; order: "ymd" | "dmy" }[] = [
  { re: /\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/, order: "ymd" },
  { re: /\b(\d{1,2})[-./](\d{1,2})[-./](20\d{2})\b/, order: "dmy" },
];

export function parseDate(s: string): string | null {
  for (const { re, order } of DATE_RES) {
    const m = s.match(re);
    if (!m) continue;
    const [y, mo, d] = order === "ymd" ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
    const mm = Number(mo), dd = Number(d);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
    return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return null;
}

export function excelDateToIso(v: number): string {
  const d = new Date(Math.round((v - 25569) * 86400 * 1000));
  return d.toISOString().slice(0, 10);
}

/** Parse "1 234 567.89", "1,234,567.89", "1234567,89", "-12 000" → number. Returns null if not amount-like. */
export function parseAmount(s: string): number | null {
  // normalise: non-breaking/thin spaces → space; Unicode minus, en/em dashes → ASCII minus; currency words removed
  let t = s.replace(/[\u00a0\u202f\u2009]/g, " ").replace(/[\u2212\u2013\u2014]/g, "-").trim()
    .replace(/UZS|сум|so'm|som|сўм|sum/gi, "").replace(/^["']|["']$/g, "").trim();
  if (!/^[-+(]?\s?[\d\s.,]+\)?$/.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  t = t.replace(/[()+\-\s]/g, "");
  // decide decimal separator: the last separator is a decimal point when followed by 1-2 digits
  // ("34000.0", "1 234,50"); three digits after it means a thousands separator ("12.000").
  const lastSep = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
  let intPart = t, frac = "";
  const tail = lastSep >= 0 ? t.length - lastSep - 1 : 0;
  if (lastSep >= 0 && (tail === 1 || tail === 2)) { intPart = t.slice(0, lastSep); frac = t.slice(lastSep + 1); }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d+$/.test(intPart)) return null;
  const v = Number(intPart + (frac ? "." + frac : ""));
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

export const TYPE_HEADER = /^(type|тип|turi|tur|operation type|тип операции|dr\/cr|d\/c|direction|вид|вид операции|kirim\/chiqim|приход\/расход)$/i;
export const FAILED_STATUS = /(отмен|ошиб|не провед|fail|cancel|reject|declin|bekor|xato|muvaffaqiyatsiz|error)/i;
export function signFromType(v: unknown): "credit" | "debit" | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (/^(credit|cr|c|k|kirim|приход|зачисление|поступление|income|in|deposit|\+)$/.test(t)) return "credit";
  if (/^(debit|dr|d|ch|chiqim|расход|списание|expense|out|withdrawal|-)$/.test(t)) return "debit";
  return null;
}

export const HEADER_WORDS = {
  date: /(^|[\s/(])(дата|sana|date|день|datetime)([\s/,)]|$)/i,   // "Дата", "Дата и время", "Sana va vaqt", "Date/Time"
  status: /(статус|status|holat)/i,
  time: /^(время|vaqt|time)$/i,
  desc: /(описан|operatsiya|tavsif|description|назнач|details|наименован|контрагент|merchant)/i,
  debit: /(расход|chiqim|debit|дебет|списан|outflow|withdraw|xarajat)/i,
  credit: /(приход|kirim|credit|кредит|зачисл|inflow|deposit|tushum)/i,
  balance: /(остаток|qoldiq|balance|баланс)/i,
  amount: /^(сумма|summa|amount|miqdor)$/i,
};

/** Given consecutive rows with amount+balance but unknown sign, infer debit/credit from the balance chain. */
export function inferSignsFromBalance(rows: { amount: number; balance: number | null }[]): ("debit" | "credit" | null)[] {
  const out: ("debit" | "credit" | null)[] = rows.map(() => null);
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1].balance, b = rows[i].balance, a = Math.abs(rows[i].amount);
    if (p === null || b === null) continue;
    if (Math.abs(p + a - b) < 0.01) out[i] = "credit";
    else if (Math.abs(p - a - b) < 0.01) out[i] = "debit";
  }
  if (rows.length > 1 && out[0] === null && out[1] !== null) {
    // first row: use the second row's chain backwards
    const b0 = rows[0].balance, b1 = rows[1].balance, a1 = Math.abs(rows[1].amount);
    if (b0 !== null && b1 !== null) {
      // nothing to infer about row 0 from row 1 beyond consistency; fall back to sign of amount
      out[0] = rows[0].amount < 0 ? "debit" : null;
    }
    void a1;
  }
  return out;
}

export function makeTx(docId: string, page: number, line: number, date: string, description: string, debit: number, credit: number,
  balance: number | null, time?: string, raw?: string): Transaction {
  return { id: `${docId}:p${page}:l${line}`, docId, page, line, date, time, description: description.trim(), debit, credit, balance,
    category: "unknown", raw };
}

export const MONTH_FULL_RE = /^\d{4}-\d{2}$/;

export function periodOf(txs: Transaction[]): { from?: string; to?: string } {
  if (!txs.length) return {};
  const ds = txs.map((t) => t.date).sort();
  return { from: ds[0], to: ds[ds.length - 1] };
}
