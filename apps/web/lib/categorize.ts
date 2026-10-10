// Rule-based transaction categoriser for Uzbek/Russian/English statement descriptions.
// Two passes: (1) keyword rules per transaction, (2) counterparty patterns across the statement
// (recurring same-counterparty inflows → relative/family transfer; mask seen both ways → own card).
import type { Category, Transaction } from "./types";

const norm = (s: string) =>
  s.toUpperCase()
    .replace(/[ʼ’`´‘]/g, "'")
    .replace(/Ё/g, "Е")
    .replace(/\s+/g, " ")
    .trim();

type Rule = { cat: Category; re: RegExp; why: string };

const INFLOW_RULES: Rule[] = [
  { cat: "loan_disbursement", re: /KREDIT BERISH|KREDIT AJRAT|ВЫДАЧА КРЕДИТ|LOAN DISB|MIKROQARZ BERISH|МИКРОЗАЙМ ВЫД/, why: "loan disbursement keyword" },
  { cat: "salary", re: /ZARPLATA|ISH HAQI|OYLIK|ЗАРПЛАТ|ЗАРАБОТН|SALARY|WAGES|MAOSH/, why: "salary keyword" },
  { cat: "pension", re: /PENSIYA|ПЕНСИ|PENSION|NAFAQA/, why: "pension keyword" },
  { cat: "cash_deposit", re: /NAQD PUL KIRITISH|CASH DEPOSIT|ВНЕСЕНИЕ НАЛИЧ|CASH IN|VKLAD|KIRITISH BANKOMAT/, why: "cash deposit keyword" },
  { cat: "refund", re: /QAYTARISH|ВОЗВРАТ|REFUND|CHARGEBACK|OTMENA|ОТМЕНА/, why: "refund keyword" },
  { cat: "marketplace_payout", re: /PAYOUT|UZUM MARKET|YANDEX|OLX|WILDBERRIES|OZON|PARTNER/, why: "platform payout keyword" },
  { cat: "pos_sale", re: /\bPOS\b|TERMINAL|ТЕРМИНАЛ|MERCHANT|EKVAYRING|ЭКВАЙРИНГ|ACQUIR/, why: "POS / acquiring keyword" },
  { cat: "self_transfer_in", re: /O'ZIGA|OZIGA|СВОЙ КАРТ|OWN CARD|SELF/, why: "own-card keyword" },
  { cat: "customer_p2p", re: /P2P|PEREVOD|ПЕРЕВОД|TRANSFER|O'TKAZMA|OTKAZMA|HUMO|UZCARD|\*{4}/, why: "card-to-card transfer" },
];

const OUTFLOW_RULES: Rule[] = [
  { cat: "loan_repayment", re: /KREDIT TO'LOV|KREDIT TOLOV|ПОГАШЕНИЕ|КРЕДИТ|LOAN|QARZ TO'LOV|MIKROQARZ|РАССРОЧК|NASIYA/, why: "loan repayment keyword" },
  { cat: "rent", re: /IJARA|АРЕНД|RENT\b/, why: "rent keyword" },
  { cat: "utilities", re: /KOMMUNAL|КОММУНАЛ|ELEKTR|ISSIQLIK|SUVSOZ|GAZTAMINOT|GAZ |ЭЛЕКТРО|ТЕПЛО|ВОДОКАНАЛ|UTILIT/, why: "utility keyword" },
  { cat: "telecom", re: /BEELINE|UCELL|MOBIUZ|UZMOBILE|UZTELECOM|HUMANS|ABONENT|TELECOM|INTERNET/, why: "telecom keyword" },
  { cat: "atm_cash", re: /\bATM\b|BANKOMAT|БАНКОМАТ|NAQD|НАЛИЧ|CASH OUT|VYBER|ВЫДАЧА НАЛ/, why: "ATM / cash keyword" },
  { cat: "self_transfer_out", re: /O'ZIGA|OZIGA|СВОЙ КАРТ|OWN CARD|SELF/, why: "own-card keyword" },
  { cat: "supplier", re: /MCHJ|OOO|ООО|MChJ|XK|ХК|OPTOM|ОПТОМ|ULGURJI|TEXTIL|MATO|IMPORT|DISTRIB|SAVDO|SUPPLIER|TOVAR|ТОВАР|TO'LOV|TOLOV/, why: "company / wholesale keyword" },
  { cat: "p2p_out", re: /P2P|PEREVOD|ПЕРЕВОД|TRANSFER|O'TKAZMA|\*{4}/, why: "card-to-card transfer out" },
  { cat: "personal_spend", re: /KORZINKA|MAKRO|HAVAS|MAGNUM|BARAKA|APTEKA|АПТЕК|YANDEX GO|MYTAXI|TAXI|PETRO|AZS|АЗС|RESTORAN|CAFE|KAFE|MARKET|DO'KON|MAGAZIN|МАГАЗИН/, why: "retail merchant" },
];

const MASK_RE = /(\d{4})\s?\*{2,4}\s?(?:\*{4}\s?)?(\d{4})/;

export function counterpartyKey(desc: string): string | null {
  const m = norm(desc).match(MASK_RE);
  return m ? `${m[1]}…${m[2]}` : null;
}

export function categorizeOne(t: Pick<Transaction, "description" | "debit" | "credit">): { cat: Category; why: string } {
  const d = norm(t.description);
  const rules = t.credit > 0 ? INFLOW_RULES : OUTFLOW_RULES;
  for (const r of rules) if (r.re.test(d)) return { cat: r.cat, why: r.why };
  return t.credit > 0 ? { cat: "customer_p2p", why: "default inflow" } : { cat: "personal_spend", why: "default outflow" };
}

/** Categorise all transactions of one statement, then refine with cross-transaction patterns. */
export function categorizeAll(txs: Transaction[]): Transaction[] {
  const out = txs.map((t) => { const r = categorizeOne(t); return { ...t, category: r.cat, categoryReason: r.why }; });
  // counterparty statistics
  const inStats = new Map<string, { n: number; months: Set<string>; total: number }>();
  const outKeys = new Set<string>();
  for (const t of out) {
    const k = counterpartyKey(t.description);
    if (!k) continue;
    if (t.credit > 0 && (t.category === "customer_p2p")) {
      const s = inStats.get(k) ?? { n: 0, months: new Set<string>(), total: 0 };
      s.n++; s.months.add(t.date.slice(0, 7)); s.total += t.credit; inStats.set(k, s);
    }
    if (t.debit > 0 && (t.category === "p2p_out" || t.category === "self_transfer_out")) outKeys.add(k);
  }
  for (const t of out) {
    const k = counterpartyKey(t.description);
    if (!k) continue;
    if (t.credit > 0 && t.category === "customer_p2p") {
      if (outKeys.has(k)) { t.category = "self_transfer_in"; t.categoryReason = "same card mask sends and receives → own card"; continue; }
      const s = inStats.get(k)!;
      if (s.months.size >= 6 && s.n <= s.months.size * 2) { t.category = "relative_transfer"; t.categoryReason = `recurring from one counterparty in ${s.months.size} months`; }
    }
    if (t.debit > 0 && t.category === "p2p_out" && inStats.has(k) && outKeys.has(k)) {
      t.category = "self_transfer_out"; t.categoryReason = "same card mask sends and receives → own card";
    }
  }
  return out;
}
