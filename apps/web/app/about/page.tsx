export default function About() {
  return (
    <main className="wrap">
      <h1>Architecture, perimeter, data</h1>

      <div className="card">
        <h2>Seven components, one language model (optional, not used in the prototype)</h2>
        <div className="arch">
          <div className="box"><b>1 · Intake</b>pdf.js text layer with positions; SheetJS for XLSX/CSV; tesseract.js (uzb + rus + eng, self-hosted) for receipt photos. Field confidences; low-confidence fields need a tap to confirm.</div>
          <div className="box"><b>2 · Categoriser</b>Multilingual keyword rules plus counterparty patterns (recurring payer → family transfer; a mask that both sends and receives → own card).</div>
          <div className="box"><b>3 · Cash-flow</b>12-month series: regulatory income (cl.18), business revenue, non-business, excluded inflows, debt service. 18 features, identical in Python and TypeScript (parity-tested).</div>
          <div className="box"><b>4 · Rule engine</b>DBR clause by clause (CBU Regulation No. 3618 for banks): 50% limit and the 15% quota bands (cl.3), cl.4 exemptions, guarantor-only-if-overdue (cl.7), 36/60/180-month spreading (cl.8), 6–12-month income with the median option (cl.13–14), account receipts as income (cl.18); maximum affordable amount back-solved; every line cites its clause.</div>
          <div className="box"><b>5 · Risk model</b>XGBoost with monotone constraints, exported to JSON and evaluated in the browser; one-at-a-time attributions against the portfolio median.</div>
          <div className="box"><b>6 · Integrity</b>Balance-chain reconciliation, duplicates, coverage, gaps, pre-application inflow spikes, circular transfers, cross-document holder match, stated vs implied opening balance.</div>
          <div className="box"><b>7 · Memo + verifier</b>Template memo from a fact table; the verifier rejects any number not in the table. Hash-chained audit log with engine versions and the officer&apos;s decision.</div>
        </div>
        <p className="small muted" style={{ marginTop: ".6rem" }}>Nothing here is a prompt to a general-purpose model. The production design adds a local open-weight LLM for free-text narrative only, inside the same perimeter, constrained to the fact table by the same verifier.</p>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Perimeter</h2>
          <p className="small">The prototype is a static site: every byte of a customer document is parsed in the officer&apos;s browser and never transmitted. Production is the same bundle served from the bank&apos;s own web server (Docker, no outbound network), with the officer&apos;s identity from the bank&apos;s SSO and the audit log persisted to the bank&apos;s database instead of the browser session. Statements of MKBANK&apos;s own account holders come from the core banking system directly; uploads are only needed for other banks&apos; statements and wallets.</p>
          <p className="small">Human in the loop: the engine recommends, computes the maximum affordable amount and flags; the loan officer decides, and an override requires a reason that is written into the chain.</p>
        </div>
        <div className="card">
          <h2>Regulatory spine</h2>
          <p className="small">CBU Regulation No. 3618 for banks — &quot;on macroprudential norms set for banks and on the maximum values of payments on loans (microloans) issued by them&quot; (Board decision 7/3 of 8 April 2025, registered 22 April 2025, in force 24 July 2025, amended by decision 31/9 of 5 December 2025; lex.uz/uz/docs/7491592): definition (cl.2), 50% limit and the two 15% quotas (cl.3), exemptions for individual entrepreneurs, family-programme and education loans (cl.4), which loans count and the 30-day guarantor rule (cl.7), 36/60/180-month spreading (cl.8), 3-working-day calculation window (cl.12), 6–12-month income averaging (cl.13) with the median option (cl.14), account receipts as income (cl.18), documented evidence (cl.19). The earlier regulation No. 3205 (lex.uz/docs/4654149) applies since 24 July 2025 to microfinance organisations and pawnshops only and is not used. Products referenced: MKBANK Ommabop 2, Express, Business Online 2, family-entrepreneurship programmes (mkbank.uz).</p>
          <p className="small">Personal data: processed inside the bank only, with the borrower&apos;s consent recorded in the case; the public demo deletes nothing because it stores nothing — close the tab and the case is gone unless exported.</p>
        </div>
      </div>

      <div className="card">
        <h2>Data sources and licences</h2>
        <div className="tscroll"><table className="wide"><thead><tr><th>Source</th><th>Used for</th><th>Licence / terms</th></tr></thead><tbody>
          <tr><td>Daromad synthetic generator (<code>synth/</code>, seed 42): 2,000 borrowers, 5.7M transactions, 60 rendered statement sets, 180 receipts, 40 tampered statements</td><td>Training, evaluation, demo samples</td><td>MIT (this repository). Parameters declared in <code>data/synthetic/summary.json</code>. No real person represented.</td></tr>
          <tr><td>Berka / PKDD&apos;99 Financial data set (Czech bank, 1993–98), mirror github.com/jlacko/berka-dataset</td><td>Methodology validation of cash-flow features → default on real anonymised data</td><td>Academic challenge data; no licence stated by the original authors — used for evaluation only, not redistributed in this repo</td></tr>
          <tr><td>Tesseract language data (tessdata_fast: uzb, uzb_cyrl, rus, eng)</td><td>Receipt OCR</td><td>Apache 2.0</td></tr>
          <tr><td>tesseract.js, tesseract.js-core</td><td>OCR runtime</td><td>Apache 2.0</td></tr>
          <tr><td>pdf.js (pdfjs-dist)</td><td>PDF text extraction</td><td>Apache 2.0</td></tr>
          <tr><td>SheetJS CE 0.20.3 (npm alias <code>@e965/xlsx</code>, an automated republish of the vendor build)</td><td>XLSX/CSV parsing</td><td>Apache 2.0</td></tr>
          <tr><td>XGBoost, scikit-learn, NumPy, pandas, OpenCV, Playwright, Jinja2, qrcode</td><td>Training and synthetic rendering</td><td>Apache 2.0 / BSD-3 / MIT (see README)</td></tr>
          <tr><td>Next.js, React</td><td>Application</td><td>MIT</td></tr>
          <tr><td>CBU regulation texts (lex.uz)</td><td>Rule engine, citations</td><td>Public legal information</td></tr>
          <tr><td>stat.uz wage releases; CBU statistics; MKBANK public pages</td><td>Calibration anchors and business case</td><td>Public information, cited in the deck</td></tr>
        </tbody></table></div>
      </div>

    </main>
  );
}
