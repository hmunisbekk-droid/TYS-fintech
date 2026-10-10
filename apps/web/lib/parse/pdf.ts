// Statement / certificate PDF parsing with pdf.js (text layer + positions). Runs in the browser.
import type { ParsedDocument, Transaction } from "../types";
import { HEADER_WORDS, inferSignsFromBalance, makeTx, parseAmount, parseDate, periodOf } from "./common";

interface Tok { str: string; x: number; y: number; w: number }
interface Line { y: number; toks: Tok[]; text: string; page: number }

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  return pdfjs;
}

/** Group pdf.js text items of one page into lines (same y within 2.5 units), tokens sorted by x. Pure; shared with the Node tests. */
export function groupTokens(items: { str: string; transform: number[]; width: number }[], page: number): Line[] {
  const lines: Line[] = [];
  const toks: Tok[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    toks.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width });
  }
  toks.sort((a, b) => b.y - a.y || a.x - b.x);
  let cur: Tok[] = [], curY = Number.NaN;
  const flush = () => {
    if (!cur.length) return;
    cur.sort((a, b) => a.x - b.x);
    // merge tokens that are adjacent into one token (pdf.js splits words sometimes)
    const merged: Tok[] = [];
    for (const t of cur) {
      const last = merged[merged.length - 1];
      const numericT = parseAmount(t.str.trim()) !== null, numericLast = !!last && parseAmount(last.str.trim()) !== null;
      if (last && t.x - (last.x + last.w) < 1.2 && !/^\s/.test(t.str) && !/\s$/.test(last.str) && !numericT && !numericLast) {
        last.str += t.str; last.w = t.x + t.w - last.x;
      } else merged.push({ ...t });
    }
    lines.push({ y: curY, toks: merged, text: merged.map((t) => t.str).join("  "), page });
    cur = [];
  };
  for (const t of toks) {
    if (Number.isNaN(curY) || Math.abs(t.y - curY) > 2.5) { flush(); curY = t.y; }
    cur.push(t);
  }
  flush();
  return lines;
}

export async function extractLines(data: ArrayBuffer): Promise<{ lines: Line[]; pages: number }> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data }).promise;
  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    lines.push(...groupTokens(content.items as { str: string; transform: number[]; width: number }[], p));
  }
  return { lines, pages: doc.numPages };
}

/** Column model: every header token with its label and horizontal span + numeric-column clusters learned from the data rows. */
type ColLabel = "debit" | "credit" | "balance" | "amount" | "date" | "other";
interface HeaderTok { label: ColLabel; left: number; right: number; x: number; str: string }
const VALUE_LABELS: ColLabel[] = ["debit", "credit", "balance", "amount"];

function classifyHeader(s: string): ColLabel {
  if (HEADER_WORDS.debit.test(s)) return "debit";
  if (HEADER_WORDS.credit.test(s)) return "credit";
  if (HEADER_WORDS.balance.test(s)) return "balance";
  if (HEADER_WORDS.amount.test(s)) return "amount";
  if (HEADER_WORDS.date.test(s)) return "date";
  return "other";
}

/** A pure date token ("01.03.2026", "2026-03-01", optionally followed by a time). Dates inside free text are not. */
const DATE_TOKEN = /^(20\d{2}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]20\d{2})(\s+\d{1,2}:\d{2}(:\d{2})?)?$/;
const TIME_TOKEN = /^\d{1,2}:\d{2}(:\d{2})?$/;
/** Digit-only identifiers (account numbers, card numbers, long document ids) are never amounts. */
const IDENTIFIER = /^\d{12,}$/;
const DATE_ANY = /\b(20\d{2}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]20\d{2})\b/g;

function isAmountToken(s: string): boolean {
  if (DATE_TOKEN.test(s) || TIME_TOKEN.test(s) || IDENTIFIER.test(s)) return false;
  return parseAmount(s) !== null && /\d/.test(s) && s.length >= 3 && !/^\d{4}$/.test(s);
}

function detectHeader(lines: Line[]): { headerIndex: number; header: HeaderTok[] } {
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const l = lines[i];
    const header: HeaderTok[] = l.toks.map((t) => ({ label: classifyHeader(t.str.trim()), left: t.x, right: t.x + t.w, x: t.x + t.w / 2, str: t.str.trim() }));
    const hits = header.filter((h) => h.label !== "other").length;
    const hasValue = header.some((h) => h.label === "debit" || h.label === "credit" || h.label === "amount");
    if (hits >= 3 && hasValue) return { headerIndex: i, header: header.sort((a, b) => a.left - b.left) };
  }
  return { headerIndex: -1, header: [] };
}

/** Cluster the right edges of numeric tokens on data rows into columns (tolerance 12 units). */
function numericColumns(lines: Line[], headerIndex: number): { right: number; count: number }[] {
  const edges: number[] = [];
  let rows = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i === headerIndex || (headerIndex >= 0 && i < headerIndex)) continue;
    const l = lines[i];
    if (!parseDate(l.text)) continue;
    rows++;
    for (const t of l.toks) {
      const s = t.str.trim();
      if (isAmountToken(s)) edges.push(t.x + t.w);
    }
  }
  edges.sort((a, b) => a - b);
  const clusters: { right: number; count: number; sum: number }[] = [];
  for (const e of edges) {
    const c = clusters[clusters.length - 1];
    if (c && e - c.right < 12) { c.count++; c.sum += e; c.right = c.sum / c.count; }
    else clusters.push({ right: e, count: 1, sum: e });
  }
  const minCount = Math.max(3, 0.03 * rows);
  return clusters.filter((c) => c.count >= minCount).map((c) => ({ right: c.right, count: c.count }));
}

/**
 * Map numeric clusters to column labels. Primary rule: a right-aligned number belongs to the header column whose
 * left edge is the last one at or left of the number's right edge (column boundaries = header left edges), so extra
 * numeric columns (document numbers, codes) land on their own "other" header and stay out of debit/credit/balance.
 * Fallbacks: by order when the value-column count matches; nearest header centre; no header → rightmost = balance.
 */
function mapClusters(clusters: { right: number }[], header: HeaderTok[]): Map<number, string> {
  const labelOf = new Map<number, string>();
  if (!header.length) { clusters.forEach((c, i) => labelOf.set(i, i === clusters.length - 1 && clusters.length >= 2 ? "balance" : "amount")); return labelOf; }
  const valueCols = header.filter((h) => VALUE_LABELS.includes(h.label));
  const byBoundary = new Map<number, string>();
  clusters.forEach((c, i) => {
    let k = -1;
    for (let j = 0; j < header.length; j++) if (header[j].left - 2 <= c.right) k = j;
    const lab = k >= 0 ? header[k].label : "other";
    byBoundary.set(i, VALUE_LABELS.includes(lab) ? lab : "unknown");
  });
  // a label used twice: keep the cluster nearest to that header's right edge
  for (const lab of VALUE_LABELS) {
    const idx = [...byBoundary.entries()].filter(([, v]) => v === lab).map(([k]) => k);
    if (idx.length > 1) {
      const h = header.find((x) => x.label === lab)!;
      idx.sort((a, b) => Math.abs(clusters[a].right - h.right) - Math.abs(clusters[b].right - h.right));
      idx.slice(1).forEach((k) => byBoundary.set(k, "unknown"));
    }
  }
  const okBoundary = [...byBoundary.values()].some((v) => v === "debit" || v === "credit" || v === "amount");
  if (okBoundary) return byBoundary;
  if (valueCols.length && clusters.length === valueCols.length) { clusters.forEach((c, i) => labelOf.set(i, valueCols[i].label)); return labelOf; }
  clusters.forEach((c, i) => { let best = valueCols[0], bd = Infinity; for (const o of valueCols) { const d = Math.abs(c.right - 25 - o.x); if (d < bd) { bd = d; best = o; } } labelOf.set(i, best ? best.label : "unknown"); });
  return labelOf;
}

export function parseStatementLines(docId: string, lines: Line[]): { txs: Transaction[]; holder?: string; cardMask?: string; warnings: string[]; assumedSignRows: number } {
  const warnings: string[] = [];
  const { headerIndex, header } = detectHeader(lines);
  const clusters = numericColumns(lines, headerIndex);
  const labelOf = mapClusters(clusters, header);
  const haveCols = [...labelOf.values()].includes("balance") && ([...labelOf.values()].includes("debit") || [...labelOf.values()].includes("credit"));
  const colOf = (right: number): string => {
    let bi = -1, bd = Infinity;
    clusters.forEach((c, i) => { const d = Math.abs(c.right - right); if (d < bd) { bd = d; bi = i; } });
    return bi >= 0 && bd < 20 ? labelOf.get(bi)! : "unknown";
  };
  const isHeaderLike = (l: Line) => l.toks.filter((t) => classifyHeader(t.str.trim()) !== "other").length >= 2;
  const rows: { tx: Transaction; amount: number; signed: boolean }[] = [];
  let holder: string | undefined, cardMask: string | undefined;
  let lineNo = 0, droppedRows = 0, lastRowLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const text = l.text;
    if (!holder) { const m = text.match(/(Владелец|Egasi|Holder|Card holder|Клиент)\s*:?\s*(.+?)(?:\s{2,}|$)/i); if (m) holder = m[2].trim(); }
    if (!cardMask) { const m = text.match(/(\d{4})\s?\*{4}\s?\*{4}\s?(\d{4})/); if (m) cardMask = `${m[1]} **** **** ${m[2]}`; }
    const date = parseDate(text);                                             // leftmost date = operation date
    if (!date) {
      // a wrapped description continues the previous row: next line, same page, no numbers, not a header
      if (rows.length && i === lastRowLine + 1 && l.page === rows[rows.length - 1].tx.page && !isHeaderLike(l) && !l.toks.some((t) => isAmountToken(t.str.trim()))) {
        const extra = l.toks.map((t) => t.str.trim()).join(" ").replace(/\s+/g, " ").trim();
        if (extra && extra.length <= 120) { rows[rows.length - 1].tx.description = `${rows[rows.length - 1].tx.description} ${extra}`.trim(); lastRowLine = i; }
      }
      continue;
    }
    if (i === headerIndex) continue;
    if (headerIndex >= 0 && i < headerIndex) continue;                       // meta lines above the table (period, dates)
    const nums: { v: number; x: number }[] = [];
    const descParts: string[] = [];
    let time: string | undefined;
    for (const t of l.toks) {
      const s = t.str.trim();
      if (DATE_TOKEN.test(s)) { const tm = s.match(/(\d{1,2}:\d{2})(:\d{2})?$/); if (tm && !time) time = tm[1]; continue; }   // every date column (operation, posting) is skipped, never an amount
      if (TIME_TOKEN.test(s)) { if (!time) time = s; continue; }
      if (isAmountToken(s)) nums.push({ v: parseAmount(s)!, x: t.x + t.w });
      else descParts.push(s);
    }
    if (!nums.length) { if ((text.match(DATE_ANY) ?? []).length < 2) droppedRows++; continue; }   // "Период: … — …" lines are skipped silently
    let debit = 0, credit = 0, balance: number | null = null, amount = 0, signed = false;
    if (clusters.length) {
      for (const n of nums) {
        const c = colOf(n.x);
        if (c === "balance") balance = n.v;
        else if (c === "debit") { debit = Math.abs(n.v); amount = -Math.abs(n.v); signed = true; }
        else if (c === "credit") { credit = Math.abs(n.v); amount = Math.abs(n.v); signed = true; }
        else if (c === "amount") amount = n.v;
      }
      if (!signed && amount !== 0 && balance === null && !haveCols) { if (amount < 0) { debit = -amount; signed = true; } }
    } else {
      if (nums.length >= 2) { balance = nums[nums.length - 1].v; amount = nums[nums.length - 2].v; }
      else { amount = nums[0].v; }
      if (amount < 0) { debit = -amount; signed = true; }
    }
    if (debit === 0 && credit === 0 && amount === 0) { droppedRows++; continue; }   // only identifiers / unknown columns on this line
    const desc = descParts.join(" ").replace(/\s+/g, " ").trim();
    lineNo++;
    rows.push({ tx: makeTx(docId, l.page, lineNo, date, desc, debit, credit, balance, time, text), amount, signed });
    lastRowLine = i;
  }
  const unsigned = rows.filter((r) => !r.signed);
  let assumedSignRows = 0;
  if (unsigned.length) {
    const signs = inferSignsFromBalance(rows.map((r) => ({ amount: r.amount, balance: r.tx.balance })));
    const signedColumn = rows.some((r) => r.amount < 0);
    rows.forEach((r, i) => {
      if (r.signed) return;
      const s = signs[i];
      const a = Math.abs(r.amount);
      if (s === "credit") r.tx.credit = a; else if (s === "debit") r.tx.debit = a;
      else if (signedColumn) r.tx.credit = a;
      else { r.tx.credit = a; r.tx.categoryReason = "direction assumed (credit)"; assumedSignRows++; }
    });
    if (unsigned.length > rows.length / 2 && !haveCols) warnings.push("Debit/credit columns not found; signs inferred from the balance chain.");
  }
  if (!rows.length) warnings.push("No transaction rows recognised in this PDF.");
  else if (droppedRows > 0) warnings.push(`${droppedRows} dated line(s) had no recognisable amount and were skipped — check the amount format.`);
  if (assumedSignRows > 0) warnings.push(`${assumedSignRows} row(s) have no debit/credit or balance information — direction assumed as credit; the integrity check flags this.`);
  return { txs: rows.map((r) => r.tx), holder, cardMask, warnings, assumedSignRows };
}

export async function parseStatementPdf(docId: string, fileName: string, data: ArrayBuffer): Promise<ParsedDocument> {
  const t0 = performance.now();
  const { lines, pages } = await extractLines(data);
  const { txs, holder, cardMask, warnings, assumedSignRows } = parseStatementLines(docId, lines);
  const per = periodOf(txs);
  const opening = (() => {
    const l = lines.find((x) => /(Входящий остаток|Boshlang'ich qoldiq|Opening balance)/i.test(x.text));
    if (!l) return null;
    const nums = l.toks.map((t) => parseAmount(t.str.trim())).filter((v): v is number => v !== null && Math.abs(v) >= 1);
    return nums.length ? nums[nums.length - 1] : null;
  })();
  return { id: docId, fileName, kind: "statement", mime: "application/pdf", pages, holderName: holder, cardMask,
    periodFrom: per.from, periodTo: per.to, openingBalance: opening, transactions: txs, fields: [], warnings, assumedSignRows,
    textSample: lines.slice(0, 12).map((l) => l.text).join("\n"), parseMs: Math.round(performance.now() - t0) };
}

export async function parseCertificatePdf(docId: string, fileName: string, data: ArrayBuffer): Promise<ParsedDocument> {
  const t0 = performance.now();
  const { lines, pages } = await extractLines(data);
  const text = lines.map((l) => l.text).join("\n");
  const grab = (re: RegExp, name: string, conf = 0.9) => {
    const m = text.match(re);
    return m ? { name, value: m[1].trim(), confidence: conf, source: `${docId}:p1`, needsConfirmation: conf < 0.8 } : null;
  };
  const fields = [
    grab(/F\.I\.Sh\.?:\s*(.+)/i, "holder"),
    grab(/(?:PINFL|JShShIR)[^:]*:\s*(\d{14})/i, "pinfl"),
    grab(/Faoliyat turi:\s*(.+)/i, "activity"),
    grab(/Hudud:\s*(.+)/i, "region"),
    grab(/Ro'yxatdan o'tgan sana:\s*([\d.]+)/i, "registered_since"),
    grab(/Holati:\s*(\w+)/i, "status"),
    grab(/Ma'lumotnoma raqami:\s*([\w-]+)/i, "certificate_no"),
  ].filter((f): f is NonNullable<typeof f> => !!f);
  const warnings = fields.length < 3 ? ["Certificate fields not recognised; please check the document type."] : [];
  return { id: docId, fileName, kind: "certificate", mime: "application/pdf", pages, transactions: [], fields, warnings,
    textSample: text.slice(0, 600), parseMs: Math.round(performance.now() - t0) };
}

export async function sniffPdfKind(data: ArrayBuffer): Promise<"statement" | "certificate" | "unknown"> {
  const { lines } = await extractLines(data.slice(0));
  const text = lines.slice(0, 40).map((l) => l.text).join("\n");
  if (/(O'ZINI O'ZI BAND|самозанят|self-employed|Soliq|JShShIR|PINFL)/i.test(text)) return "certificate";
  if (/(Выписка|ko'chirma|statement|Остаток|Qoldiq|Balance)/i.test(text)) return "statement";
  return "unknown";
}
