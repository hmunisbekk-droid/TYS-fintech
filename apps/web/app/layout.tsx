import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daromad — Income Evidence Engine",
  description: "Regulation-native income evidence and debt-burden (ПДН) assessment for thin-file borrowers. Runs entirely in the browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link className="brand" href="/">Daro<span>mad</span></Link>
          <Link className="link" href="/case">New case</Link>
          <Link className="link" href="/model">Model card</Link>
          <Link className="link" href="/about">Architecture &amp; data</Link>
          <span className="spacer" />
          <span className="pill">team TYS · FinTech track · prototype</span>
        </nav>
        {children}
        <div className="footer">Daromad prototype — all processing happens in your browser; uploaded documents are never sent to a server. Synthetic sample data only; no real person is represented.</div>
      </body>
    </html>
  );
}
