// File → ParsedDocument dispatcher (browser only).
import { parseReceiptImage } from "./ocr/receipt";
import { parseCertificatePdf, parseStatementPdf, sniffPdfKind } from "./parse/pdf";
import { parseCsv, parseXlsx } from "./parse/table";
import type { ParsedDocument } from "./types";

let seq = 0;
export const nextDocId = () => `doc${++seq}`;

export async function loadDocument(file: File, onProgress?: (s: string, p: number) => void): Promise<ParsedDocument> {
  const id = nextDocId();
  const name = file.name;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || file.type === "application/pdf") {
    const buf = await file.arrayBuffer();
    const kind = await sniffPdfKind(buf.slice(0));
    if (kind === "certificate") return parseCertificatePdf(id, name, buf);
    const doc = await parseStatementPdf(id, name, buf);
    if (kind === "unknown" && doc.transactions.length === 0) doc.kind = "unknown";
    return doc;
  }
  if (ext === "xlsx" || ext === "xls") return parseXlsx(id, name, await file.arrayBuffer());
  if (ext === "csv" || ext === "txt" || ext === "tsv") return parseCsv(id, name, await file.text());
  if (file.type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "bmp"].includes(ext)) return parseReceiptImage(id, name, file, onProgress);
  return { id, fileName: name, kind: "unknown", mime: file.type, pages: 0, transactions: [], fields: [], warnings: ["Unsupported file type. Use PDF, XLSX, CSV or an image."], parseMs: 0 };
}

export async function fetchAsFile(url: string, name: string): Promise<File> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  const blob = await r.blob();
  return new File([blob], name, { type: blob.type });
}
