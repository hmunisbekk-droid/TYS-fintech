# Regulation quotes for the defence (verbatim, Uzbek original)

Source: CBU regulation on the debt-burden ratio of individual borrowers, lex.uz/docs/4654149, as amended by
Board Resolution 42/16 (lex.uz/docs/6809992, registered 21 Feb 2024, effective 23 Mar 2024). Checked 10 Oct 2026.
BRV (базавий ҳисоблаш миқдори / БРВ) = **440,000 UZS from 1 September 2026** (previously 412,000) → 50 BRV = 22,000,000 UZS.

| Clause | Quote (verbatim) | Daromad implementation |
|---|---|---|
| cl.1 definition | «қарз юки кўрсаткичи — қарз олувчининг кредит ва/ёки микроқарзлари бўйича ўртача ойлик тўловлари миқдорининг … ўртача ойлик даромадига нисбати» | `computePdn`: payments ÷ income base |
| cl.2 scope | «қарз берувчи томонидан кредит (микроқарз) ажратиш тўғрисида кўриб чиқилаётган мурожаат бўйича» — the application under review is included; all loan agreements with all lenders; joint-borrower loans | obligations table + requested loan payment |
| cl.2 (2024) small loans | «базавий ҳисоблаш миқдорининг 50 бараваридан ошмаганда» — excluded when amount + outstanding principal ≤ 50 BRV | exemption badge "smallLoan" |
| cl.2 (2024) self-employed at MFOs | «базавий ҳисоблаш миқдорининг 75 бараваридан ошмаганда ҳисобланмаслиги ёки инобатга олинмаслиги мумкин» | noted in citations; MKBANK is a bank, so the 50-BRV line applies |
| cl.2 (2024) bank allowance | «микроқарзлар сонининг энг кўпи билан 15 фоизигача бўлган миқдорида» — up to 15% of the number of a bank's loans/microloans to individuals may be issued outside the requirement | bank-level quota; Daromad reports the ratio for every application and leaves the quota to the bank's risk function |
| cl.4 guarantors | «улар бўйича 30 кундан ортиқ муддати ўтган тўловлари мавжуд бўлса» — guarantor loans count only when payments are more than 30 days overdue | DPD column; `role = guarantor` counted only if DPD > 30 |
| cl.4¹ long terms | «кредит (микроқарз) бўйича барча тўловлар 36 ойга тенг миқдорда тақсимланади» — terms over 36 months spread evenly over 36 | `normalisePayment` |
| cl.6 date | calculation date within 10 calendar days of the loan date | case date |
| cl.7 income | «охирги 12 ой ичида олган даромадлари миқдорининг ўртача арифметик қиймати сифатида ҳисобланади» | 12-month arithmetic mean; co-borrower income added |
| cl.9 evidence | employer-confirmed salary; pension; funded-pension contributions; «қарз олувчининг банк ҳисобварақларига тушган даромадлари тўғрисидаги маълумотлардан» (income credited to bank accounts); taxes paid; interest/dividends/rent; lenders may use other data | the statement-based income figure |
| cl.10 cap | «қарз юки кўрсаткичи 50 фоиздан ошмаслиги керак» (from 1 Jan 2025; 60% between 1 Jul 2024 and 1 Jan 2025) | pass/fail, maximum affordable amount |
| cl.11 exemption | «оилавий тадбиркорликни ривожлантириш дастурлари доирасида ажратиладиган кредитларга нисбатан татбиқ этилмайди» | product "family programme" → cap not applicable, capacity still assessed |

A press summary of the 2024 amendment said "co-borrowers and guarantors count as borrowers". The regulation text
distinguishes them: co-borrower loans are always counted (cl.2), guarantor loans only when overdue > 30 days (cl.4).
Daromad follows the text.
