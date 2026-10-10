"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IncomeChart from "@/components/IncomeChart";
import { AuditLog, type AuditEntry } from "@/lib/audit";
import { runCase, type CaseResult, type Recommendation } from "@/lib/case";
import { FEATURE_LABELS } from "@/lib/features";
import { fetchAsFile, loadDocument } from "@/lib/loader";
import { fmtPct, fmtUZS, memoToText } from "@/lib/memo";
import { CITATIONS } from "@/lib/rules/pdn";
import type { FeatureStats, RiskModel } from "@/lib/risk";
import type { ExistingLoan, LoanRequest, ParsedDocument, Transaction } from "@/lib/types";

interface SampleMeta {
  tag: string; borrower_id: string; title: string; description: string; applicant: string; application_date: string;
  requested_amount: number; requested_term_months: number; loans: ExistingLoan[]; files: string[];
}
interface SamplesIndex { samples: SampleMeta[]; tampered: { file: string; borrower_id: string; tamper_type: string }[] }

const PRODUCTS: Record<LoanRequest["product"], { label: string; rate: number }> = {
  ommabop: { label: "Ommabop 2 microloan (online, ≤ 50M)", rate: 0.30 },
  express: { label: "Express microloan (branch, ≤ 100M)", rate: 0.28 },
  business_online: { label: "Business Online 2 (≤ 100M)", rate: 0.26 },
  family_program: { label: "Family-entrepreneurship programme (ПДН-exempt)", rate: 0.14 },
};
const REC_LABEL: Record<Recommendation, { t: string; cls: string }> = {
  approve: { t: "Approve", cls: "good" }, approve_reduced: { t: "Approve at a reduced amount", cls: "warn" },
  refer: { t: "Refer to committee", cls: "warn" }, decline: { t: "Decline", cls: "bad" },
};
const today = () => new Date().toISOString().slice(0, 10);
const sha = async (buf: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");

export default function CasePage() {
  const [model, setModel] = useState<RiskModel | null>(null);
  const [stats, setStats] = useState<FeatureStats | null>(null);
  const [samples, setSamples] = useState<SamplesIndex | null>(null);
  const [applicant, setApplicant] = useState("");
  const [appDate, setAppDate] = useState(today());
  const [request, setRequest] = useState<LoanRequest>({ amount: 25_000_000, term_months: 24, annual_rate: 0.28, product: "express" });
  const [loans, setLoans] = useState<ExistingLoan[]>([]);
  const [coIncome, setCoIncome] = useState(0);
  const [docs, setDocs] = useState<ParsedDocument[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [over, setOver] = useState(false);
  const [evidence, setEvidence] = useState<{ title: string; txs: Transaction[]; text?: string } | null>(null);
  const [decision, setDecision] = useState<{ action: string; reason: string } | null>(null);
  const [reason, setReason] = useState("");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const log = useRef(new AuditLog());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    Promise.all([fetch("/model/model.json").then((r) => r.json()), fetch("/model/feature_stats.json").then((r) => r.json()), fetch("/samples/index.json").then((r) => r.json())])
      .then(([m, s, idx]) => { setModel(m); setStats(s); setSamples(idx); });
    log.current.append("case_created", { ts: Date.now() }, "Case opened in browser").then(() => setAudit([...log.current.entries]));
  }, []);

  const result: CaseResult | null = useMemo(() => {
    if (!model || !stats || !docs.some((d) => d.kind === "statement" && d.transactions.length)) return null;
    try {
      return runCase({ applicationDate: appDate, applicantName: applicant || undefined, documents: docs, existingLoans: loans, request, coBorrowerIncome: coIncome || undefined }, model, stats);
    } catch (e) { console.error(e); return null; }
  }, [model, stats, docs, appDate, applicant, loans, request, coIncome]);

  const lastRunHash = useRef("");
  useEffect(() => {
    if (!result) return;
    const sig = JSON.stringify({ p: result.probability, r: result.pdn.ratio, rec: result.recommendation, a: request.amount, t: request.term_months, n: result.transactions.length });
    if (sig === lastRunHash.current) return;
    lastRunHash.current = sig;
    log.current.append("analysis_run", { features: result.features, pdn: result.pdn.ratio, probability: result.probability, recommendation: result.recommendation, versions: result.engineVersions },
      `Analysis: ПДН ${fmtPct(result.pdn.ratio)}, PD ${fmtPct(result.probability)}, ${REC_LABEL[result.recommendation].t}`).then(() => setAudit([...log.current.entries]));
  }, [result, request.amount, request.term_months]);

  const addFiles = useCallback(async (files: File[]) => {
    for (const f of files) {
      setBusy(`Parsing ${f.name}…`); setProgress("");
      try {
        const doc = await loadDocument(f, (s, p) => setProgress(`${s} ${Math.round(p * 100)}%`));
        const h = await sha(await f.arrayBuffer());
        setDocs((d) => [...d, doc]);
        if (doc.kind === "statement" && !applicant && doc.holderName) setApplicant(doc.holderName);
        await log.current.append("document_added", { file: f.name, sha256: h, kind: doc.kind, rows: doc.transactions.length, fields: doc.fields.length },
          `${f.name} → ${doc.kind}, ${doc.transactions.length} rows, ${doc.fields.length} fields (sha256 ${h.slice(0, 12)}…)`);
        setAudit([...log.current.entries]);
      } catch (e) {
        setToast(`Could not parse ${f.name}: ${(e as Error).message}`);
      }
    }
    setBusy(null); setProgress("");
  }, [applicant]);

  const loadSample = async (s: SampleMeta, useXlsx = false) => {
    setDocs([]); setDecision(null);
    setApplicant(s.applicant); setAppDate(s.application_date);
    setRequest((r) => ({ ...r, amount: s.requested_amount, term_months: s.requested_term_months }));
    setLoans(s.loans);
    const want = [useXlsx ? "statement.xlsx" : "statement.pdf", "certificate.pdf", "receipt_00_photo.jpg"].filter((f) => s.files.includes(f));
    const files = await Promise.all(want.map((f) => fetchAsFile(`/samples/${s.tag}/${f}`, `${s.tag}_${f}`)));
    await addFiles(files);
  };
  const loadTampered = async (file: string) => {
    setAppDate("2026-09-30");
    const f = await fetchAsFile(`/samples/tampered/${file}`, file);
    await addFiles([f]);
  };

  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setOver(false); addFiles([...e.dataTransfer.files]); };
  const removeDoc = (id: string) => setDocs((d) => d.filter((x) => x.id !== id));
  const confirmField = (docId: string, name: string, value: string) => setDocs((d) => d.map((x) => x.id === docId ? { ...x, fields: x.fields.map((f) => f.name === name ? { ...f, value, confidence: 1, needsConfirmation: false } : f) } : x));
  const showEvidence = (ids: string[], title: string) => {
    const txs = result?.transactions.filter((t) => ids.includes(t.id)) ?? [];
    const doc = docs.find((d) => ids.some((i) => i.startsWith(d.id + ":") || i === d.id));
    setEvidence({ title, txs, text: txs.length ? undefined : doc ? `${doc.fileName}\n${doc.textSample ?? ""}` : ids.join(", ") });
  };
  const decide = async (action: string) => {
    if (!result) return;
    const d = { action, reason: reason || (action === result.recommendation ? "Accepted engine recommendation" : "") };
    if (action !== result.recommendation && !reason.trim()) { setToast("An override needs a reason — it goes into the audit log."); return; }
    setDecision(d);
    await log.current.append("officer_decision", { ...d, engine: result.recommendation, pdn: result.pdn.ratio, probability: result.probability }, `Officer: ${REC_LABEL[action as Recommendation]?.t ?? action}${action !== result.recommendation ? " (override)" : ""} — ${d.reason}`);
    setAudit([...log.current.entries]);
  };
  const exportCase = async () => {
    const ok = await log.current.verify();
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), applicant, appDate, request, loans, documents: docs.map((d) => ({ ...d, transactions: undefined })),
      result: result && { ...result, transactions: undefined, memoText: memoToText(result.memo) }, decision, audit: log.current.entries, auditChainValid: ok }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `daromad_case_${Date.now()}.json`; a.click();
  };

  const stmtCount = docs.filter((d) => d.kind === "statement").length;
  const step = (n: number) => (n === 1 ? "active" : stmtCount ? (n === 2 ? "done" : result ? "done" : "active") : "");

  return (
    <main className="wrap">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>New case</h1>
        <div className="row">
          {samples?.samples.map((s) => <button key={s.tag} className="btn small" onClick={() => loadSample(s, s.tag === "C")} title={s.description}>Load sample {s.tag}</button>)}
          {samples && <button className="btn small" onClick={() => loadTampered(samples.tampered[0].file)} title="Statement with one inflated inflow (balance chain breaks)">Load tampered statement</button>}
          {samples && <button className="btn small" onClick={() => loadTampered(samples.tampered[3].file)} title="Statement with inserted round-sum inflows before application">Load window-dressed statement</button>}
          <button className="btn small" onClick={() => { setDocs([]); setLoans([]); setDecision(null); setApplicant(""); }}>Clear</button>
        </div>
      </div>
      <div className="steps">
        <span className={`s ${step(1)}`}>1 · Request &amp; obligations</span>
        <span className={`s ${stmtCount ? "done" : ""}`}>2 · Documents</span>
        <span className={`s ${result ? "done" : ""}`}>3 · Income &amp; ПДН</span>
        <span className={`s ${result ? "done" : ""}`}>4 · Integrity &amp; risk</span>
        <span className={`s ${result ? "done" : ""}`}>5 · Memo</span>
        <span className={`s ${decision ? "done" : ""}`}>6 · Decision &amp; audit</span>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>1 · Applicant and request</h2>
          <div className="row">
            <label className="field">Applicant<input value={applicant} onChange={(e) => setApplicant(e.target.value)} placeholder="from statement" /></label>
            <label className="field">Application date<input type="date" value={appDate} onChange={(e) => setAppDate(e.target.value)} /></label>
            <label className="field">Product<select value={request.product} onChange={(e) => { const p = e.target.value as LoanRequest["product"]; setRequest({ ...request, product: p, annual_rate: PRODUCTS[p].rate }); }}>
              {Object.entries(PRODUCTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          </div>
          <div className="row" style={{ marginTop: ".5rem" }}>
            <label className="field">Amount (UZS)<input type="number" step={1_000_000} value={request.amount} onChange={(e) => setRequest({ ...request, amount: Number(e.target.value) })} /></label>
            <label className="field">Term (months)<select value={request.term_months} onChange={(e) => setRequest({ ...request, term_months: Number(e.target.value) })}>{[6, 12, 18, 24, 36, 48, 60].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            <label className="field">Rate p.a.<input type="number" step={0.01} value={request.annual_rate} onChange={(e) => setRequest({ ...request, annual_rate: Number(e.target.value) })} /></label>
            <label className="field">Co-borrower income / month<input type="number" step={100_000} value={coIncome} onChange={(e) => setCoIncome(Number(e.target.value))} /></label>
          </div>
          <h3 style={{ marginTop: ".8rem" }}>Existing obligations <span className="muted small">(credit bureau in production; editable here)</span></h3>
          <table><thead><tr><th>Lender</th><th className="num">Monthly payment</th><th className="num">Term</th><th className="num">Outstanding</th><th className="num">DPD</th><th>Role</th><th></th></tr></thead>
            <tbody>{loans.map((l, i) => (
              <tr key={l.id}>
                <td><input value={l.lender} onChange={(e) => setLoans(loans.map((x, j) => j === i ? { ...x, lender: e.target.value } : x))} style={{ width: 140 }} /></td>
                <td className="num"><input type="number" value={l.monthly_payment} onChange={(e) => setLoans(loans.map((x, j) => j === i ? { ...x, monthly_payment: Number(e.target.value) } : x))} style={{ width: 120 }} /></td>
                <td className="num"><input type="number" value={l.term_months} onChange={(e) => setLoans(loans.map((x, j) => j === i ? { ...x, term_months: Number(e.target.value) } : x))} style={{ width: 60 }} /></td>
                <td className="num"><input type="number" value={l.outstanding_principal} onChange={(e) => setLoans(loans.map((x, j) => j === i ? { ...x, outstanding_principal: Number(e.target.value) } : x))} style={{ width: 120 }} /></td>
                <td className="num"><input type="number" value={l.days_past_due} onChange={(e) => setLoans(loans.map((x, j) => j === i ? { ...x, days_past_due: Number(e.target.value) } : x))} style={{ width: 55 }} /></td>
                <td><select value={l.role} onChange={(e) => setLoans(loans.map((x, j) => j === i ? { ...x, role: e.target.value as ExistingLoan["role"] } : x))}><option value="borrower">borrower</option><option value="co-borrower">co-borrower</option><option value="guarantor">guarantor</option></select></td>
                <td><button className="btn small" onClick={() => setLoans(loans.filter((_, j) => j !== i))}>×</button></td>
              </tr>))}</tbody></table>
          <button className="btn small" style={{ marginTop: ".4rem" }} onClick={() => setLoans([...loans, { id: `m${Date.now()}`, lender: "Lender", monthly_payment: 500_000, term_months: 24, outstanding_principal: 5_000_000, days_past_due: 0, role: "borrower", source: "manual" }])}>+ Add obligation</button>
        </div>

        <div className="card">
          <h2>2 · Documents</h2>
          <div className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop} onClick={() => fileInput.current?.click()}>
            <input ref={fileInput} type="file" multiple accept=".pdf,.xlsx,.xls,.csv,image/*" style={{ display: "none" }} onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
            <b>Drop or pick files</b> — statements (PDF, XLSX, CSV), Soliq certificate (PDF), receipts (photo). Parsing and OCR run in this tab.
            {busy && <div className="small" style={{ marginTop: ".4rem" }}><span className="tag info">{busy}</span> {progress}</div>}
          </div>
          {docs.map((d) => (
            <div key={d.id} style={{ marginTop: ".7rem", borderTop: "1px solid var(--border)", paddingTop: ".5rem" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div><b>{d.fileName}</b> <span className={`tag ${d.kind === "unknown" ? "bad" : "info"}`}>{d.kind}</span> <span className="muted small">{d.pages ? `${d.pages} p · ` : ""}{d.parseMs} ms{d.ocr ? ` · OCR conf ${(d.ocr.confidence * 100).toFixed(0)}%, ${d.ocr.words} words` : ""}</span></div>
                <button className="btn small" onClick={() => removeDoc(d.id)}>remove</button>
              </div>
              {d.kind === "statement" && <div className="small">{d.transactions.length} transactions · {d.periodFrom} → {d.periodTo}{d.holderName ? ` · holder ${d.holderName}` : ""}{d.cardMask ? ` · ${d.cardMask}` : ""}</div>}
              {d.fields.length > 0 && (
                <table style={{ marginTop: ".3rem", tableLayout: "fixed" }}><tbody>{d.fields.map((f) => (
                  <tr key={f.name} className={f.needsConfirmation ? "hl" : ""}>
                    <td style={{ width: 120 }}>{f.name}</td>
                    <td><input defaultValue={f.value} onBlur={(e) => e.target.value !== f.value && confirmField(d.id, f.name, e.target.value)} style={{ width: "100%" }} /></td>
                    <td className="num" style={{ width: 70 }}><span className={`tag ${f.confidence >= 0.75 ? "good" : "warn"}`}>{(f.confidence * 100).toFixed(0)}%</span></td>
                    <td style={{ width: 90 }}>{f.needsConfirmation ? <button className="btn small" onClick={() => confirmField(d.id, f.name, f.value)}>confirm</button> : <span className="muted small">ok</span>}</td>
                  </tr>))}</tbody></table>
              )}
              {d.warnings.map((w, i) => <div key={i} className="small" style={{ color: "var(--warn)" }}>⚠ {w}</div>)}
              {d.textSample && <details><summary className="small">raw text</summary><pre>{d.textSample}</pre></details>}
            </div>
          ))}
          {!docs.length && <p className="muted small" style={{ marginTop: ".6rem" }}>No documents yet. Load a sample or upload your own — any statement with dates and amounts works; unknown layouts fall back to balance-chain sign inference.</p>}
        </div>
      </div>

      {result && (
        <>
          <div className="card">
            <h2>3 · Income evidence and debt-burden ratio</h2>
            <div className="grid2">
              <div>
                <IncomeChart s={result.series} meanIncome={result.pdn.meanIncome} />
                <div className="row" style={{ marginTop: ".5rem" }}>
                  <div className="kpi"><span className="v">{fmtUZS(result.pdn.meanIncome)}</span><span className="l">mean monthly regulatory income (cl.7)</span></div>
                  <div className="kpi"><span className="v">{fmtPct(result.features.biz_share)}</span><span className="l">business share of income</span></div>
                  <div className="kpi"><span className="v">{result.features.income_cv.toFixed(2)}</span><span className="l">volatility (CV)</span></div>
                  <div className="kpi"><span className="v">{result.features.months_observed}/12</span><span className="l">months observed</span></div>
                </div>
              </div>
              <div>
                <h3>ПДН — <span className={`tag ${result.pdn.exempt ? "info" : result.pdn.passes ? "good" : "bad"}`}>{result.pdn.exempt ? "cap not applicable" : result.pdn.passes ? "within 50% cap" : "above 50% cap"}</span></h3>
                <table><tbody>
                  {result.pdn.existingPayments.map((l, i) => <tr key={i}><td>{l.label} <span className="cite" title={CITATIONS[l.citation].text}>{CITATIONS[l.citation].id}</span>{l.note && <span className="muted small"> {l.note}</span>}</td><td className="num">{fmtUZS(l.value)}</td></tr>)}
                  <tr><td>Requested loan payment <span className="cite" title={CITATIONS.term36.text}>{request.term_months > 36 ? "cl.4¹" : "cl.2"}</span></td><td className="num">{fmtUZS(result.pdn.newPayment)}</td></tr>
                  <tr><th>Total monthly payments</th><th className="num">{fmtUZS(result.pdn.totalPayments)}</th></tr>
                  <tr><td>Income base (12-month mean{coIncome ? " + co-borrower" : ""}) <span className="cite" title={CITATIONS.income12.text}>cl.7</span></td><td className="num">{fmtUZS(result.pdn.incomeBase)}</td></tr>
                  <tr><th>ПДН <span className="cite" title={CITATIONS.cap.text}>cl.10</span></th><th className="num" style={{ fontSize: "1.2rem" }}>{Number.isFinite(result.pdn.ratio) ? fmtPct(result.pdn.ratio) : "n/a"}</th></tr>
                </tbody></table>
                <div className="bar cap" style={{ marginTop: ".5rem" }}><i style={{ width: `${Math.min(100, (result.pdn.ratio / 1) * 100)}%`, background: result.pdn.ratio <= 0.5 ? "var(--good)" : "var(--bad)" }} /></div>
                <div className="small muted">0% ─────────── 50% cap ─────────── 100%</div>
                {result.pdn.exempt && <p className="small"><span className="tag info">{CITATIONS[result.pdn.exemptCitation!].id}</span> {result.pdn.exemptReason}</p>}
                <p className="small">Max affordable at {request.term_months} months: <b>{fmtUZS(result.pdn.maxAffordableAmount)}</b></p>
                <label className="field" style={{ marginTop: ".5rem" }}>What if the requested amount were… <b>{fmtUZS(request.amount)}</b>
                  <input type="range" min={1_000_000} max={100_000_000} step={500_000} value={request.amount} onChange={(e) => setRequest({ ...request, amount: Number(e.target.value) })} />
                </label>
                {result.pdn.warnings.map((w, i) => <div key={i} className="small" style={{ color: "var(--warn)" }}>⚠ {w}</div>)}
              </div>
            </div>
          </div>

          <div className="grid2">
            <div className="card">
              <h2>4a · Integrity checks</h2>
              {result.checks.map((c) => (
                <div key={c.id} className={`check ${c.passed ? "pass" : "fail"}`}>
                  <div className="ic">{c.passed ? "✓" : "✗"}</div>
                  <div><b>{c.title}</b> <span className={`tag ${c.passed ? "good" : c.severity === "high" ? "bad" : c.severity === "medium" ? "warn" : "info"}`}>{c.passed ? "pass" : c.severity}</span>
                    <div className="small">{c.detail} {c.evidence.length > 0 && <span className="cite" onClick={() => showEvidence(c.evidence, c.title)}>evidence ({c.evidence.length})</span>}</div></div>
                </div>))}
            </div>
            <div className="card">
              <h2>4b · Risk score <span className={`tag ${result.band.band === "low" ? "good" : result.band.band === "medium" ? "warn" : "bad"}`}>{result.band.label}</span></h2>
              <div className="row"><div className="kpi"><span className="v">{fmtPct(result.probability)}</span><span className="l">probability of default, 12 m (model)</span></div>
                <div className="kpi"><span className="v">{result.timings.risk.toFixed(1)} ms</span><span className="l">inference + attributions</span></div></div>
              <p className="small muted">Drivers vs. the portfolio median (one-at-a-time attribution). Positive raises risk.</p>
              <table><tbody>{result.attributions.slice(0, 7).map((a) => (
                <tr key={a.feature}><td>{FEATURE_LABELS[a.feature]}</td><td className="num mono small">{a.value.toFixed(2)} <span className="muted">(med {a.reference.toFixed(2)})</span></td>
                  <td className="num" style={{ color: a.deltaProb > 0 ? "var(--bad)" : "var(--good)", width: 70 }}>{a.deltaProb > 0 ? "+" : ""}{(a.deltaProb * 100).toFixed(1)} pts</td></tr>))}</tbody></table>
              <p className="small muted">Model: gradient-boosted trees with monotone constraints, trained on a declared synthetic population; advisory until retrained on bank history. See <a href="/model">model card</a>.</p>
            </div>
          </div>

          <div className="card memo">
            <h2>5 · Credit memo <span className={`tag ${result.memo.verification.ok ? "good" : "bad"}`}>{result.memo.verification.ok ? `verified: ${result.memo.verification.numbersChecked} numbers, 0 unsourced` : `verification failed: ${result.memo.verification.unsourced.join(", ")}`}</span>
              <span className={`tag ${REC_LABEL[result.recommendation].cls}`}>{REC_LABEL[result.recommendation].t}</span></h2>
            {result.memo.sections.map((s) => (
              <div key={s.title}><h3>{s.title}</h3>
                {s.paragraphs.map((p, i) => <p key={i}>{p.text} {p.sources.filter(Boolean).slice(0, 4).map((src) => <span key={src} className="cite" onClick={() => showEvidence(src.split(","), s.title)}>{src.length > 28 ? src.slice(0, 28) + "…" : src}</span>)}</p>)}
              </div>))}
            <details><summary>Fact table ({result.memo.facts.length} facts) — the only source of numbers in the memo</summary>
              <div className="srtable"><table><thead><tr><th>key</th><th>display</th><th>source</th></tr></thead><tbody>{result.memo.facts.map((f) => <tr key={f.key}><td className="mono small">{f.key}</td><td>{f.display}</td><td className="mono small">{f.source}</td></tr>)}</tbody></table></div></details>
            <div className="row" style={{ marginTop: ".6rem" }}>
              <button className="btn small" onClick={() => { navigator.clipboard.writeText(memoToText(result.memo)); setToast("Memo copied"); }}>Copy memo as text</button>
            </div>
          </div>

          <div className="card">
            <h2>6 · Officer decision and audit log</h2>
            <p className="small">Engine recommendation: <span className={`tag ${REC_LABEL[result.recommendation].cls}`}>{REC_LABEL[result.recommendation].t}</span> — {result.recommendationReasons.join(" ")}</p>
            {decision ? <p><b>Recorded:</b> {REC_LABEL[decision.action as Recommendation]?.t ?? decision.action} — {decision.reason}</p> : (
              <div className="row">
                <input placeholder="reason (required for an override)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minWidth: 320 }} />
                {(["approve", "approve_reduced", "refer", "decline"] as Recommendation[]).map((a) => <button key={a} className={`btn small ${a === result.recommendation ? "primary" : ""}`} onClick={() => decide(a)}>{REC_LABEL[a].t}{a === result.recommendation ? " (as recommended)" : ""}</button>)}
              </div>)}
            <h3 style={{ marginTop: ".8rem" }}>Audit log <span className="muted small">hash-chained, SHA-256</span></h3>
            <div className="srtable"><table><thead><tr><th>#</th><th>time</th><th>event</th><th>summary</th><th>hash</th></tr></thead>
              <tbody>{audit.map((e) => <tr key={e.seq}><td>{e.seq}</td><td className="small">{e.ts.slice(11, 19)}</td><td className="mono small">{e.event}</td><td className="small">{e.summary}</td><td className="mono small">{e.hash.slice(0, 10)}…</td></tr>)}</tbody></table></div>
            <div className="row" style={{ marginTop: ".6rem" }}>
              <button className="btn" onClick={exportCase}>Export case + audit (JSON)</button>
              <span className="muted small">Engine versions: rules {result.engineVersions.rules} · model {result.engineVersions.model} · categoriser {result.engineVersions.categorizer} · timings {Object.entries(result.timings).map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join(", ")}</span>
            </div>
          </div>
        </>
      )}

      {evidence && (
        <div className="evidence">
          <div className="row" style={{ justifyContent: "space-between" }}><b>Evidence — {evidence.title}</b><button className="btn small" onClick={() => setEvidence(null)}>close</button></div>
          {evidence.txs.length ? (
            <div className="srtable"><table><thead><tr><th>line</th><th>date</th><th>description</th><th className="num">debit</th><th className="num">credit</th><th className="num">balance</th><th>category</th></tr></thead>
              <tbody>{evidence.txs.map((t) => <tr key={t.id}><td className="mono small">{t.id}</td><td>{t.date}</td><td>{t.description}</td><td className="num">{t.debit ? t.debit.toLocaleString("en-US") : ""}</td><td className="num">{t.credit ? t.credit.toLocaleString("en-US") : ""}</td><td className="num">{t.balance?.toLocaleString("en-US")}</td><td className="small">{t.category}</td></tr>)}</tbody></table></div>
          ) : <pre>{evidence.text}</pre>}
        </div>
      )}
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </main>
  );
}
