"use client";
import { useState } from "react";
import type { MonthlySeries } from "@/lib/types";

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const fmtM = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : `${Math.round(v)}`);

export default function IncomeChart({ s, meanIncome }: { s: MonthlySeries; meanIncome: number }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, padL = 52, padB = 28, padT = 10, padR = 8;
  const n = s.months.length;
  const max = Math.max(1, ...s.regulatoryIncome, ...s.businessInflow);
  const gw = (W - padL - padR) / n;
  const bw = Math.max(4, gw * 0.36);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="legend">
          <span><i style={{ background: "var(--series-1)" }} />Regulatory income (cl.18)</span>
          <span><i style={{ background: "var(--series-2)" }} />of which business revenue</span>
          <span><i style={{ background: "transparent", border: "2px dashed var(--text-2)", width: 10, height: 0 }} />12-month mean</span>
        </div>
        <button className="btn small" onClick={() => setTable(!table)}>{table ? "Chart" : "Table"}</button>
      </div>
      {table ? (
        <div className="srtable"><table>
          <thead><tr><th>Month</th><th className="num">Regulatory income</th><th className="num">Business revenue</th><th className="num">Non-business</th><th className="num">Not income (excluded)</th><th className="num">Debt service</th></tr></thead>
          <tbody>{s.months.map((m, i) => (
            <tr key={m}><td>{m}</td><td className="num">{fmt(s.regulatoryIncome[i])}</td><td className="num">{fmt(s.businessInflow[i])}</td><td className="num">{fmt(s.nonBusinessInflow[i])}</td><td className="num">{fmt(s.ambiguousInflow[i])}</td><td className="num">{fmt(s.debtService[i])}</td></tr>
          ))}</tbody>
        </table></div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly income over the last 12 months" style={{ display: "block" }}>
          {ticks.map((t) => (
            <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={padL - 6} y={y(t) + 4} fontSize={10} textAnchor="end" fill="var(--text-2)">{fmtM(t)}</text></g>
          ))}
          <line x1={padL} x2={W - padR} y1={y(meanIncome)} y2={y(meanIncome)} stroke="var(--text-2)" strokeWidth={1.5} strokeDasharray="4 4" />
          {s.months.map((m, i) => {
            const x0 = padL + i * gw + (gw - 2 * bw - 2) / 2;
            const r = s.regulatoryIncome[i], b = s.businessInflow[i];
            return (
              <g key={m} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={padL + i * gw} y={padT} width={gw} height={H - padT - padB} fill="transparent" />
                <rect x={x0} y={y(r)} width={bw} height={Math.max(0, H - padB - y(r))} rx={3} fill="var(--series-1)" />
                <rect x={x0 + bw + 2} y={y(b)} width={bw} height={Math.max(0, H - padB - y(b))} rx={3} fill="var(--series-2)" />
                <text x={padL + i * gw + gw / 2} y={H - 10} fontSize={10} textAnchor="middle" fill="var(--text-2)">{m.slice(2)}</text>
                {hover === i && (
                  <g>
                    <rect x={Math.min(padL + i * gw, W - 190)} y={padT} width={180} height={44} rx={6} fill="var(--surface)" stroke="var(--border)" />
                    <text x={Math.min(padL + i * gw, W - 190) + 8} y={padT + 16} fontSize={11} fill="var(--text)">{m}: {fmt(r)} UZS</text>
                    <text x={Math.min(padL + i * gw, W - 190) + 8} y={padT + 32} fontSize={11} fill="var(--text-2)">business {fmt(b)} UZS</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
