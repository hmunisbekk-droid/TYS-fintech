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

export async function extractLines(data: ArrayBuffer): Promise<{ lines: Line[]; pages: number }> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data }).promise;
  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const toks: Tok[] = [];
    for (const it of content.items as { str: string; transform: number[]; width: number }[]) {
      if (!it.str || !it.str.trim()) continue;
      toks.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width });
    }
    // group by y (within 2.5 units), sort by x
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
      lines.push({ y: curY, toks: merged, text: merged.map((t) => t.str).join("  "), page: p });
      cur = [];
    };
    for (const t of toks) {
      if (Number.isNaN(curY) || Math.abs(t.y - curY) > 2.5) { flush(); curY = t.y; }
      cur.push(t);
    }
    flush();
  }
  return { lines, pages: doc.numPages };
}

/** Column model: header labels (by x order) + numeric-column clusters learned from the data rows. */
interface Columns { debitX?: number; creditX?: number; balanceX?: number; amountX?: number }

function detectHeader(lines: Line[]): { cols: Columns; headerIndex: number; order: { label: string; x: number }[] } {
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const l = lines[i];
    const cols: Columns = {};
    const order: { label: string; x: number }[] = [];
    let hits = 0;
    for (const t of l.toks) {
      const s = t.str.trim();
      const cx = t.x + t.w / 2;
      if (HEADER_WORDS.debit.test(s)) { cols.debitX = cx; order.push({ label: "debit", x: cx }); hits++; }
      else if (HEADER_WORDS.credit.test(s)) { cols.creditX = cx; order.push({ label: "credit", x: cx }); hits++; }
      else if (HEADER_WORDS.balance.test(s)) { cols.balanceX = cx; order.push({ label: "balance", x: cx }); hits++; }
      else if (HEADER_WORDS.amount.test(s)) { cols.amountX = cx; order.push({ label: "amount", x: cx }); hits++; }
      else if (HEADER_WORDS.date.test(s)) hits++;
    }
    if (hits >= 3) return { cols, headerIndex: i, order: order.sort((a, b) => a.x - b.x) };
  }
  return { cols: {}, headerIndex: -1, order: [] };
}

/** Cluster the right edges of numeric tokens on data rows into columns (tolerance 12 units). */
function numericColumns(lines: Line[], headerIndex: number): { right: number; count: number }[] {
  const edges: number[] = [];
  let rows = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i === headerIndex) continue;
    const l = lines[i];
    if (!parseDate(l.text)) continue;
    rows++;
    for (const t of l.toks) {
      const s = t.str.trim();
      if (parseDate(s) || /^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) continue;
      const v = parseAmount(s);
      if (v !== null && s.length >= 3 && !/^\d{4}$/.test(s)) edges.push(t.x + t.w);
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

export function parseStatementLines(docId: string, lines: Line[]): { txs: Transaction[]; holder?: string; cardMask?: string; warnings: string[] } {
  const warnings: string[] = [];
  const { headerIndex, order } = detectHeader(lines);
  const clusters = numericColumns(lines, headerIndex);
  // map clusters → labels: by order when counts match, otherwise nearest header centre; no header → rightmost = balance
  const labelOf = new Map<number, string>();
  if (order.length && clusters.length === order.length) clusters.forEach((c, i) => labelOf.set(i, order[i].label));
  else if (order.length) clusters.forEach((c, i) => { let best = order[0], bd = Infinity; for (const o of order) { const d = Math.abs(c.right - 25 - o.x); if (d < bd) { bd = d; best = o; } } labelOf.set(i, best.label); });
  else clusters.forEach((c, i) => labelOf.set(i, i === clusters.length - 1 && clusters.length >= 2 ? "balance" : "amount"));
  const haveCols = [...labelOf.values()].includes("balance") && ([...labelOf.values()].includes("debit") || [...labelOf.values()].includes("credit"));
  const colOf = (right: number): string => {
    let bi = -1, bd = Infinity;
    clusters.forEach((c, i) => { const d = Math.abs(c.right - right); if (d < bd) { bd = d; bi = i; } });
    return bi >= 0 && bd < 20 ? labelOf.get(bi)! : "unknown";
  };
  const rows: { tx: Transaction; amount: number; signed: boolean }[] = [];
  let holder: string | undefined, cardMask: string | undefined;
  let lineNo = 0, droppedRows = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const text = l.text;
    if (!holder) { const m = text.match(/(Владелец|Egasi|Holder|Card holder|Клиент)\s*:?\s*(.+?)(?:\s{2,}|$)/i); if (m) holder = m[2].trim(); }
    if (!cardMask) { const m = text.match(/(\d{4})\s?\*{4}\s?\*{4}\s?(\d{4})/); if (m) cardMask = `${m[1]} **** **** ${m[2]}`; }
    const date = parseDate(text);
    if (!date || i === headerIndex) continue;
    const nums: { v: number; x: number }[] = [];
    const descParts: string[] = [];
    let time: string | undefined;
    for (const t of l.toks) {
      const s = t.str.trim();
      if (parseDate(s) === date && !time) continue;
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) { time = s; continue; }
      const v = parseAmount(s);
      if (v !== null && /\d/.test(s) && s.length >= 3 && !/^\d{4}$/.test(s)) nums.push({ v, x: t.x + t.w });
      else descParts.push(s);
    }
    if (!nums.length) { droppedRows++; continue; }
    lineNo++;
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
    const desc = descParts.join(" ").replace(/\s+/g, " ").trim();
    rows.push({ tx: makeTx(docId, l.page, lineNo, date, desc, debit, credit, balance, time, text), amount, signed });
  }
  const unsigned = rows.filter((r) => !r.signed);
  if (unsigned.length) {
    const signs = inferSignsFromBalance(rows.map((r) => ({ amount: r.amount, balance: r.tx.balance })));
    rows.forEach((r, i) => {
      if (r.signed) return;
      const s = signs[i];
      const a = Math.abs(r.amount);
      if (s === "credit") r.tx.credit = a; else if (s === "debit") r.tx.debit = a;
      else { r.tx.credit = a; r.tx.categoryReason = "sign assumed (no balance chain)"; }
    });
    if (unsigned.length > rows.length / 2 && !haveCols) warnings.push("Debit/credit columns not found; signs inferred from the balance chain.");
  }
  if (!rows.length) warnings.push("No transaction rows recognised in this PDF.");
  else if (droppedRows > 0) warnings.push(`${droppedRows} dated line(s) had no recognisable amount and were skipped — check the amount format.`);
  return { txs: rows.map((r) => r.tx), holder, cardMask, warnings };
}

export async function parseStatementPdf(docId: string, fileName: string, data: ArrayBuffer): Promise<ParsedDocument> {
  const t0 = performance.now();
  const { lines, pages } = await extractLines(data);
  const { txs, holder, cardMask, warnings } = parseStatementLines(docId, lines);
  const per = periodOf(txs);
  const opening = (() => {
    const l = lines.find((x) => /(Входящий остаток|Boshlang'ich qoldiq|Opening balance)/i.test(x.text));
    if (!l) return null;
    const nums = l.toks.map((t) => parseAmount(t.str.trim())).filter((v): v is number => v !== null && Math.abs(v) >= 1);
    return nums.length ? nums[nums.length - 1] : null;
  })();
  return { id: docId, fileName, kind: "statement", mime: "application/pdf", pages, holderName: holder, cardMask,
    periodFrom: per.from, periodTo: per.to, openingBalance: opening, transactions: txs, fields: [], warnings,
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
