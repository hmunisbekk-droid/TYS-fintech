// Shared types for the Daromad browser engine.

export type Category =
  | "pos_sale" | "customer_p2p" | "marketplace_payout" | "salary" | "pension" | "relative_transfer"
  | "loan_disbursement" | "self_transfer_in" | "refund" | "cash_deposit"
  | "supplier" | "rent" | "utilities" | "telecom" | "loan_repayment" | "personal_spend" | "atm_cash"
  | "self_transfer_out" | "p2p_out" | "unknown";

export interface Transaction {
  id: string;            // `${docId}:${lineIndex}` – the citation anchor
  docId: string;
  page: number;          // 1-based page (or sheet row block) in the source document
  line: number;          // line index within the document
  date: string;          // YYYY-MM-DD
  time?: string;
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
  category: Category;
  categoryReason?: string;
  raw?: string;
}

export interface ExtractedField {
  name: string;
  value: string;
  confidence: number;    // 0..1
  source: string;        // citation anchor e.g. "doc3:p1:l4"
  needsConfirmation: boolean;
}

export type DocKind = "statement" | "receipt" | "certificate" | "id" | "unknown";

export interface ParsedDocument {
  id: string;
  fileName: string;
  kind: DocKind;
  mime: string;
  pages: number;
  holderName?: string;
  cardMask?: string;
  periodFrom?: string;
  periodTo?: string;
  openingBalance?: number | null;
  transactions: Transaction[];
  fields: ExtractedField[];
  warnings: string[];
  textSample?: string;
  ocr?: { confidence: number; words: number; langs: string[]; ms: number };
  assumedSignRows?: number;   // rows whose direction (credit/debit) could not be determined and was assumed
  parseMs: number;
}

export interface ExistingLoan {
  id: string;
  lender: string;
  monthly_payment: number;
  term_months: number;
  outstanding_principal: number;
  days_past_due: number;
  role: "borrower" | "co-borrower" | "guarantor";
  source: "credit-bureau" | "statement" | "manual";
}

export interface LoanRequest {
  amount: number;
  term_months: number;
  annual_rate: number;
  product: "ommabop" | "express" | "business_online" | "family_program";
}

export interface MonthlySeries {
  months: string[];                 // YYYY-MM, ascending
  regulatoryIncome: number[];       // clause-9 income credited to accounts (excl. own transfers, loans, refunds, cash deposits)
  businessInflow: number[];         // POS + customer P2P + marketplace payouts
  nonBusinessInflow: number[];      // salary + pension + relatives
  ambiguousInflow: number[];        // cash deposits, self-transfers in, refunds
  debtService: number[];            // detected loan repayments
  totalDebits: number[];
}
