"""Render synthetic documents: statements (PDF with text layer, XLSX, CSV), receipts (PNG), certificates (PDF).

PDF/PNG rendering uses headless Chromium through Playwright so the PDFs carry a real text layer,
exactly like statements exported from banking apps.
"""
from __future__ import annotations

import base64
import io
import json
import random
from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

TEMPLATES = Path(__file__).parent / "templates"
_env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=select_autoescape(["html"]))

LAYOUTS = {
    # two statement layouts with different labels/languages, as banking apps differ
    "bank_ru": dict(bank_name="HUMO CARD STATEMENT", title="Выписка по карте", accent="#1f4e9c",
                    l_holder="Владелец", l_card="Карта", l_period="Период", l_currency="Валюта",
                    l_opening="Входящий остаток", l_date="Дата", l_time="Время", l_desc="Описание операции",
                    l_debit="Расход", l_credit="Приход", l_balance="Остаток",
                    l_total_debit="Итого расход", l_total_credit="Итого приход", l_closing="Исходящий остаток",
                    footer="Выписка сформирована автоматически. Синтетический документ для тестирования ПО."),
    "wallet_uz": dict(bank_name="PAYNET WALLET", title="Karta bo'yicha ko'chirma", accent="#0b8f6e",
                      l_holder="Egasi", l_card="Karta", l_period="Davr", l_currency="Valyuta",
                      l_opening="Boshlang'ich qoldiq", l_date="Sana", l_time="Vaqt", l_desc="Operatsiya tavsifi",
                      l_debit="Chiqim", l_credit="Kirim", l_balance="Qoldiq",
                      l_total_debit="Jami chiqim", l_total_credit="Jami kirim", l_closing="Yakuniy qoldiq",
                      footer="Ko'chirma avtomatik shakllantirildi. Dasturiy ta'minotni sinash uchun sintetik hujjat."),
}


def fmt(n: float) -> str:
    if n == 0:
        return ""
    s = f"{n:,.2f}".replace(",", " ")
    return s


def _qr_b64(payload: str) -> str | None:
    try:
        import qrcode  # type: ignore
    except Exception:
        return None
    img = qrcode.make(payload)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def statement_html(borrower: dict, txs: list[dict], layout: str, period_from: str, period_to: str) -> str:
    rows = [t for t in txs if period_from <= t["date"] <= period_to]
    if not rows:
        raise ValueError("no transactions in period")
    opening = rows[0]["balance"] - rows[0]["credit"] + rows[0]["debit"]
    ctx = dict(LAYOUTS[layout])
    ctx.update(
        holder=borrower["full_name"].upper(), card_mask=borrower["card_mask"],
        period_from=period_from, period_to=period_to, opening_balance=f"{opening:,.2f}".replace(",", " "),
        rows=[dict(t, debit=fmt(t["debit"]), credit=fmt(t["credit"]), balance=f"{t['balance']:,.2f}".replace(",", " ")) for t in rows],
        total_debit=f"{sum(t['debit'] for t in rows):,.2f}".replace(",", " "),
        total_credit=f"{sum(t['credit'] for t in rows):,.2f}".replace(",", " "),
        closing_balance=f"{rows[-1]['balance']:,.2f}".replace(",", " "),
    )
    return _env.get_template("statement.html").render(**ctx)


def statement_xlsx(path: Path, borrower: dict, txs: list[dict], period_from: str, period_to: str) -> None:
    from openpyxl import Workbook
    rows = [t for t in txs if period_from <= t["date"] <= period_to]
    wb = Workbook()
    ws = wb.active
    ws.title = "Statement"
    ws.append(["Card holder", borrower["full_name"].upper()])
    ws.append(["Card", borrower["card_mask"]])
    ws.append(["Period", f"{period_from} - {period_to}"])
    ws.append([])
    ws.append(["Date", "Time", "Description", "Debit", "Credit", "Balance"])
    for t in rows:
        ws.append([t["date"], t["time"], t["description"], t["debit"] or None, t["credit"] or None, t["balance"]])
    wb.save(path)


def statement_csv(path: Path, txs: list[dict], period_from: str, period_to: str) -> None:
    import csv
    rows = [t for t in txs if period_from <= t["date"] <= period_to]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["date", "time", "description", "debit", "credit", "balance"])
        for t in rows:
            w.writerow([t["date"], t["time"], t["description"], t["debit"] or "", t["credit"] or "", t["balance"]])


RECEIPT_ITEMS = {
    "grocer": [("NON OBI 1 dona", 2500), ("SUT 1L", 12000), ("TUXUM 10 dona", 18000), ("GURUCH 1kg", 16000), ("YOG' 1L", 24000), ("SHAKAR 1kg", 11000)],
    "bakery": [("NON 1 dona", 3000), ("SOMSA GO'SHTLI", 9000), ("TORT 1kg", 85000), ("PECHENYE 0.5kg", 22000)],
    "phone_repair": [("EKRAN ALMASHTIRISH", 350000), ("BATAREYA", 120000), ("ZARYADKA KABELI", 25000), ("HIMOYA OYNASI", 30000)],
    "hairdresser": [("SOCH OLISH", 40000), ("SOQOL", 25000), ("BOSH YUVISH", 15000)],
    "default": [("XIZMAT", 50000), ("MAHSULOT", 30000)],
}


def receipt_html(rng: random.Random, borrower: dict, when: date, amount_hint: float | None = None) -> tuple[str, dict]:
    kind = borrower["archetype"] if borrower["archetype"] in RECEIPT_ITEMS else "default"
    menu = RECEIPT_ITEMS[kind]
    n = rng.randint(1, min(4, len(menu)))
    items = []
    total = 0
    for name, price in rng.sample(menu, n):
        qty = rng.randint(1, 3)
        items.append(dict(name=name, qty=qty, price=f"{price:,}".replace(",", " "), total=f"{price*qty:,}".replace(",", " ")))
        total += price * qty
    # one tax ID per business: derived from the borrower id, identical on every receipt of that borrower
    inn = f"3{int(borrower['borrower_id'][1:]) % 100000000:08d}"
    rng.randint(300000000, 399999999)  # keep the random stream aligned with earlier renders
    receipt_no = rng.randint(1000, 99999)
    fm = f"UZ{rng.randint(100000000000, 999999999999)}"
    fp = f"{rng.randint(100000000000, 999999999999)}"
    shop = f"{borrower['full_name'].split()[0].upper()} {borrower['activity_uz'].split()[0].upper()}"
    ctx = dict(shop=shop, address=f"{borrower['region']}, {rng.choice(['Navoiy', 'Amir Temur', 'Mustaqillik', 'Bobur'])} ko'chasi {rng.randint(1, 120)}",
               inn=inn, receipt_no=receipt_no, date=when.strftime("%d.%m.%Y"), time=f"{rng.randint(8, 21):02d}:{rng.randint(0, 59):02d}",
               cashier=borrower["full_name"].split()[0], items=items, total=f"{total:,}".replace(",", " "),
               pay_method=rng.choice(["HUMO", "UZCARD", "NAQD", "PAYME"]), vat=f"{round(total*12/112):,}".replace(",", " "),
               fm=fm, fp=fp, qr=_qr_b64(f"https://ofd.soliq.uz/check?t={fm}&r={receipt_no}&c={when.strftime('%Y%m%d')}&s={total}.00"),
               l_receipt="FISKAL CHEK", l_date="Sana", l_cashier="Kassir", l_total="JAMI", l_paid="To'landi",
               l_thanks="Xaridingiz uchun rahmat!")
    truth = dict(shop=shop, inn=inn, receipt_no=str(receipt_no), date=when.isoformat(), total=float(total),
                 items=[dict(name=i["name"], qty=i["qty"]) for i in items], fm=fm)
    return _env.get_template("receipt.html").render(**ctx), truth


def certificate_html(rng: random.Random, borrower: dict, seed: int) -> tuple[str, dict]:
    pinfl = f"{rng.randint(3, 6)}{rng.randint(100000000000, 999999999999)}"[:14]
    cert_no = f"SZ-{rng.randint(100000, 999999)}"
    ctx = dict(holder=borrower["full_name"].upper(), pinfl=pinfl, activity=borrower["activity_uz"], region=borrower["region"],
               since=date.fromisoformat(borrower["self_employed_since"]).strftime("%d.%m.%Y"), cert_no=cert_no, seed=seed,
               qr=_qr_b64(f"https://my.soliq.uz/selfemployed/verify?no={cert_no}"))
    truth = dict(holder=borrower["full_name"].upper(), pinfl=pinfl, activity=borrower["activity_uz"], since=borrower["self_employed_since"], cert_no=cert_no)
    return _env.get_template("certificate.html").render(**ctx), truth


class ChromiumRenderer:
    """Renders HTML to PDF/PNG with one persistent headless Chromium."""

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch()
        self._page = self._browser.new_page(viewport={"width": 420, "height": 900}, device_scale_factor=2)
        return self

    def __exit__(self, *exc):
        self._browser.close()
        self._pw.stop()

    def pdf(self, html: str, out: Path) -> None:
        self._page.set_content(html, wait_until="load")
        self._page.pdf(path=str(out), format="A4", print_background=True)

    def png(self, html: str, out: Path, selector: str = ".paper") -> None:
        self._page.set_content(html, wait_until="load")
        el = self._page.query_selector(selector)
        el.screenshot(path=str(out))
