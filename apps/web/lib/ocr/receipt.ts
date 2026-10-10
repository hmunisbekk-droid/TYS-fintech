// Receipt / photo OCR with tesseract.js (self-hosted worker, core and language data → no external calls).
import type { ExtractedField, ParsedDocument } from "../types";
import { parseAmount, parseDate } from "../parse/common";

let workerPromise: Promise<import("tesseract.js").Worker> | null = null;

export async function getOcrWorker(onProgress?: (status: string, progress: number) => void) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const w = await createWorker(["uzb", "rus", "eng"], 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/core",
        langPath: "/tessdata",
        logger: (m) => onProgress?.(m.status, m.progress ?? 0),
      });
      return w;
    })();
  }
  return workerPromise;
}

export interface OcrWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

export async function ocrImage(file: Blob, onProgress?: (s: string, p: number) => void): Promise<{ text: string; words: OcrWord[]; confidence: number; ms: number }> {
  const t0 = performance.now();
  const w = await getOcrWorker(onProgress);
  const res = await w.recognize(file, {}, { text: true, blocks: true });
  const words: OcrWord[] = [];
  for (const b of res.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) for (const wd of l.words)
    words.push({ text: wd.text, confidence: wd.confidence / 100, bbox: wd.bbox });
  return { text: res.data.text, words, confidence: (res.data.confidence ?? 0) / 100, ms: Math.round(performance.now() - t0) };
}

const fix = (s: string) => s.replace(/[|]/g, "1").replace(/O(?=\d)/g, "0");

/** Extract receipt fields from OCR text. Multilingual keywords (Uzbek Latin/Cyrillic, Russian, English). */
export function extractReceiptFields(docId: string, text: string, confidence: number): { fields: ExtractedField[]; warnings: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const fields: ExtractedField[] = [];
  const warnings: string[] = [];
  const mk = (name: string, value: string, conf: number, line: number): ExtractedField =>
    ({ name, value, confidence: conf, source: `${docId}:p1:l${line + 1}`, needsConfirmation: conf < 0.75 });
  // shop: first non-empty line that is not a number
  const shopIdx = lines.findIndex((l) => /[A-Za-zА-Яа-я]{3,}/.test(l));
  if (shopIdx >= 0) fields.push(mk("shop", lines[shopIdx], Math.min(0.95, confidence + 0.1), shopIdx));
  // INN / STIR
  for (let i = 0; i < lines.length; i++) {
    const m = fix(lines[i]).match(/(?:STIR|INN|ИНН|СТИР)[^0-9]{0,6}(\d{9})/i);
    if (m) { fields.push(mk("inn", m[1], 0.9 * confidence + 0.05, i)); break; }
  }
  // receipt number
  for (let i = 0; i < lines.length; i++) {
    const m = fix(lines[i]).match(/(?:CHEK|ЧЕК|CHECK|RECEIPT)\s*(?:№|No\.?|#|N)?\s*(\d{3,8})/i);
    if (m) { fields.push(mk("receipt_no", m[1], 0.85 * confidence + 0.05, i)); break; }
  }
  // date
  for (let i = 0; i < lines.length; i++) {
    const d = parseDate(fix(lines[i]));
    if (d) { fields.push(mk("date", d, 0.9 * confidence + 0.05, i)); break; }
  }
  // total: line with JAMI/ИТОГО/TOTAL/JAMI → largest number on it (or next line)
  let total: { v: number; i: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (/(JAMI|ЖАМИ|ИТОГО|TOTAL|SUMMA|JAM[I1])/i.test(lines[i])) {
      const cands = [lines[i], lines[i + 1] ?? ""].join(" ").match(/\d[\d\s.,]{2,}/g) ?? [];
      const nums = cands.map((c) => parseAmount(c.trim())).filter((v): v is number => v !== null && v > 0);
      if (nums.length) { total = { v: Math.max(...nums), i }; break; }
    }
  }
  if (!total) {
    // fallback: largest number on the receipt
    let best: { v: number; i: number } | null = null;
    lines.forEach((l, i) => { for (const c of l.match(/\d[\d\s.,]{2,}/g) ?? []) { const v = parseAmount(c.trim()); if (v && v > 500 && v < 1e9 && (!best || v > best.v)) best = { v, i }; } });
    if (best) { total = best; warnings.push("Total keyword not found; largest amount used (needs confirmation)."); }
  }
  if (total) fields.push({ name: "total", value: String(total.v), confidence: Math.max(0.3, 0.85 * confidence), source: `${docId}:p1:l${total.i + 1}`, needsConfirmation: confidence < 0.8 });
  // fiscal module / QR hint
  for (let i = 0; i < lines.length; i++) {
    const m = fix(lines[i]).match(/(?:FM|ФМ)\s*:?\s*([A-Z]{2}\d{9,13})/i);
    if (m) { fields.push(mk("fiscal_module", m[1], 0.8 * confidence, i)); break; }
  }
  if (!fields.some((f) => f.name === "total")) warnings.push("No total amount found on the receipt.");
  return { fields, warnings };
}

export async function parseReceiptImage(docId: string, fileName: string, file: Blob, onProgress?: (s: string, p: number) => void): Promise<ParsedDocument> {
  const t0 = performance.now();
  const ocr = await ocrImage(file, onProgress);
  const { fields, warnings } = extractReceiptFields(docId, ocr.text, ocr.confidence);
  return { id: docId, fileName, kind: "receipt", mime: file.type || "image/*", pages: 1, transactions: [], fields, warnings,
    textSample: ocr.text.slice(0, 800), ocr: { confidence: ocr.confidence, words: ocr.words.length, langs: ["uzb", "rus", "eng"], ms: ocr.ms },
    parseMs: Math.round(performance.now() - t0) };
}
