import Link from "next/link";

export default function Home() {
  return (
    <main className="wrap">
      <section className="hero">
        <h1>Income evidence for borrowers who have no payslip.</h1>
        <p className="lead">
          Daromad turns the documents a self-employed or family-business borrower actually has — card and wallet statements,
          fiscal receipts, the Soliq self-employed certificate — into a regulator-compliant 12-month income figure, a debt-burden
          ratio (ПДН) with every clause cited, an integrity report and a credit memo in which every number links to a document line.
        </p>
        <div className="row" style={{ marginTop: "1rem" }}>
          <Link className="btn primary" href="/case">Start a case</Link>
          <Link className="btn" href="/model">See the numbers</Link>
          <Link className="btn" href="/about">How it works</Link>
        </div>
      </section>

      <div className="grid3">
        <div className="card">
          <h2>Why</h2>
          <p>The CBU debt-burden regulation lists what counts as income evidence. For a self-employed borrower, only one item on that list exists:
            <b> income credited to bank accounts</b>. Reading twelve months of statements by hand takes an officer an hour or more per application.
            MKBANK targets ~140,000 micro-projects in 2026.</p>
        </div>
        <div className="card">
          <h2>What</h2>
          <p>Seven components: document parsing and OCR → transaction categoriser → cash-flow reconstruction → rule engine (clause by clause) →
            risk model with explanations → integrity checks → template memo with a faithfulness verifier. One hash-chained audit log.</p>
        </div>
        <div className="card">
          <h2>Where it runs</h2>
          <p>Entirely inside the browser. No API keys, no server, nothing leaves the device. In production the same engine is served from the
            bank&apos;s own server, so customer data never crosses the perimeter — by construction, not by policy.</p>
        </div>
      </div>

      <div className="card">
        <h2>Try it in 60 seconds</h2>
        <ol>
          <li>Open <Link href="/case">New case</Link> and click <b>Load sample A</b> (synthetic hairdresser, one existing loan) — or upload your own PDF / XLSX / CSV statement and a photo of any receipt.</li>
          <li>Watch the statement parse, the income series build, the ПДН formula fill in, the integrity checks run and the memo assemble.</li>
          <li>Drag the <b>requested amount</b> slider: the ratio crosses 50% and the recommendation changes in real time.</li>
          <li>Approve or override; every step lands in the audit log, which you can export with the case.</li>
        </ol>
      </div>
    </main>
  );
}
