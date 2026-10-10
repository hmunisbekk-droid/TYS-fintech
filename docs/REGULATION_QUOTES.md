# Regulation quotes for the defence (verbatim fragments, Uzbek original)

**Source:** Regulation "on macroprudential norms set for banks and on the maximum values of payments on loans (microloans)
issued by them" — *Банкларга ўрнатиладиган макропруденциал нормативлар ҳамда улар томонидан бериладиган кредитлар
(микроқарзлар) бўйича тўловларнинг энг юқори қийматларига доир талаблар тўғрисидаги низом*. Approved by CBU Board decision
No. 7/3 of 8 April 2025; registered by the Ministry of Justice on 22 April 2025, No. 3618; in force 24 July 2025; amended by
Board decision No. 31/9 of 5 December 2025 (in force 21 January 2026). Text: https://lex.uz/uz/docs/7491592. Checked 11 Oct 2026.

**Why not regulation No. 3205 (lex.uz/docs/4654149)?** Since the amendment of 21 April 2025 (No. 3205-4, in force 24 July
2025) that regulation is titled *"Микромолия ташкилоти ва ломбард томонидан бериладиган кредитлар (микроқарзлар) бўйича қарз
олувчи жисмоний шахсларнинг қарз юкини тартибга солиш тўғрисидаги низом"* and its scope sentence names only non-bank credit
organisations («микромолия ташкилоти ва ломбард (бундан буён матнда нобанк кредит ташкилоти деб юритилади)»). MKBANK is a
bank, so No. 3618 governs. Daromad implements No. 3618 only; no BRV thresholds exist in it.

| Clause | Quote (verbatim fragment) | Daromad implementation |
|---|---|---|
| cl.2 definition | «қарз олувчининг кредит (микроқарзлари) бўйича ўртача ойлик тўловлари миқдорининг … ўртача ойлик даромадига нисбати» | `computePdn`: payments ÷ income base |
| cl.3 ¶1 limit | «қарз юки кўрсаткичи 50 фоиздан ошмаслиги лозим» | pass/fail at 50%; maximum affordable amount back-solved |
| cl.3 ¶2–3 quota up to 100% | base: «берилган, бироқ сўндирилмаган барча кредитлар (микроқарзлар) сонининг»; «энг кўпи билан 15 фоизигача банк томонидан қарз олувчиларга»; «уларнинг қарз юки кўрсаткичи 100 фоизгача бўлиши мумкин» (added by decision 31/9, 2025) | status **quota** when 50% < ratio ≤ 100%: recommendation *refer* — the 15% share of the number of outstanding loans is a bank-level decision |
| cl.3 ¶4 new self-employed | «биринчи марта рўйхатдан ўтганига» … «санадан олдинги олти ойдан ошмаган»; «инобатга олинмаслиги ва (ёки) ҳисобланмаслиги мумкин» — income-generating loans, within 15% of outstanding loans | certificate `registered_since` < 6 months before the application → eligibility badge; the ratio is still computed |
| cl.3 ¶5 | «мазкур Низомнинг 4-бандида кўрсатилган кредитлар … сонини аниқлашда инобатга олинмайди» — cl.4 loans are excluded from the quota base | note |
| cl.4 exemptions | «татбиқ этилмайди»: «якка тартибдаги тадбиркорларга бериладиган кредитлар», «оилавий тадбиркорликни ривожлантириш дастурлари доирасида бериладиган кредитлар», «таълим кредитлари» | product "family programme" → exempt; individual-entrepreneur and education loans are outside the prototype's products |
| cl.5 when | «кредит (микроқарз) беришга ёки кредит (микроқарз) лимитини оширишга» — also when payments are raised, the term extended, a claim bought or a loan refinanced | every analysis run is a calculation; versions logged |
| cl.7 scope | «барча қарз берувчилар билан тузилган кредит (микроқарз) шартномаси»; co-borrower: «биргаликда қарз олувчининг барча қарз берувчилар билан тузилган»; guarantor: «агар … 30 кундан ортиқ муддати ўтган тўловлари мавжуд бўлса» | obligations table (KATM pull in production); `role = guarantor` counted only if DPD > 30 |
| cl.8 spreading | «аннуитет усулида»; microloan: «36 ойдан ошган тақдирда … 36 ойга тенг миқдорда»; other loans over 60 months → 60 (revolving lines and cards excluded); mortgages over 180 → 180 | `normalisePayment(monthly, term, kind)` |
| cl.10 existing payment | average monthly payment = remaining principal + interest + fees ÷ months left; overdue amounts and penalties added | obligations table: monthly payment field |
| cl.12 timing | «вақт оралиғи 3 иш кунидан ошмаслиги керак» | case date on the memo and in the audit log |
| cl.13 income | «камида 6 ой учун узлуксиз, бироқ 12 ойдан ошмаган муддат учун»; 1/12 of 12 months, or 1/6 … 1/11 for 6–11 months | `monthsUsed`; status **insufficient_history** under 6 months |
| cl.14 median | «мазкур қиймат ушбу Низомнинг 13-бандида белгиланган арифметик қийматдан кичикроқ бўлса» | "use the median when lower" switch |
| cl.18 account receipts | «мазкур қарз олувчи ва биргаликда қарз олувчининг банк ҳисобварақларига тушган тушумларини инобатга олади»; no double counting | the statement-based income figure (own transfers, loan proceeds, refunds, cash deposits excluded) |
| cl.19 evidence | salary («иш ҳақи тўғрисидаги тасдиқланган маълумотлар»), pension («пенсия миқдори тўғрисидаги маълумотлар»), funded-pension contributions, tax data incl. «давлат солиқ хизмати органлари томонидан тасдиқланган жисмоний шахснинг жами йиллик даромади тўғрисидаги», interest/dividends/rent; net of taxes | slide 2: a self-employed borrower has none of these — only cl.18 |
| cl.22 other data | «ўзининг ахборот тизимлари, кредит бюроси томонидан тақдим этиладиган ахборотлар» | KATM / core-banking pulls (production design) |

Note: the text on lex.uz includes the amendments in force from 21 January 2026; the quotes above were read on that version.
