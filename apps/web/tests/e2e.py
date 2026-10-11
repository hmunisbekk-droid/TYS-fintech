"""End-to-end smoke test of the static export in headless Chromium.

    python3 tests/e2e.py http://localhost:8787 /tmp/shots

Loads sample A (PDF statement + certificate + receipt photo), waits for the memo, asserts the verifier
passes, exercises the what-if slider, records a decision, loads a tampered statement, and takes screenshots.
"""
import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8787"
shots = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/shots")
shots.mkdir(parents=True, exist_ok=True)
results = {}

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1380, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(f"{base}/", wait_until="networkidle")
    page.screenshot(path=str(shots / "01_home.png"), full_page=True)
    page.goto(f"{base}/case", wait_until="networkidle")
    page.wait_for_selector("text=Load sample A", timeout=30000)
    t0 = time.time()
    page.click("text=Load sample A")
    page.wait_for_selector("text=5 · Credit memo", timeout=180000)
    # wait for OCR to finish (receipt fields) – the busy tag disappears
    page.wait_for_selector("text=OCR conf", timeout=180000)
    results["sample_a_seconds"] = round(time.time() - t0, 1)
    body = page.inner_text("body")
    results["memo_verified"] = "0 unsourced" in body
    results["has_pdn"] = "DBR" in body
    results["ocr_fields"] = "total" in body and "inn" in body
    page.screenshot(path=str(shots / "02_case_A_full.png"), full_page=True)
    # slider what-if: push amount to 100M and check the recommendation changes text
    slider = page.locator("input[type=range]")
    slider.evaluate("el => { el.value = 100000000; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); }")
    page.wait_for_timeout(500)
    body2 = page.inner_text("body")
    results["whatif_changed"] = ("above 50% cap" in body2) or ("reduced amount" in body2.lower())
    page.screenshot(path=str(shots / "03_whatif.png"), full_page=True)
    slider.evaluate("el => { el.value = 25000000; el.dispatchEvent(new Event('input', {bubbles:true})); }")
    page.wait_for_timeout(300)
    # decision
    page.fill("input[placeholder*='reason']", "Checked receipts in person")
    page.click("text=(as recommended)")
    page.wait_for_selector("text=Recorded:", timeout=10000)
    results["decision_logged"] = "officer_decision" in page.inner_text("body")
    page.screenshot(path=str(shots / "04_decision_audit.png"), full_page=True)
    # tampered statement
    page.click("text=Load tampered statement")
    page.wait_for_selector("b:has-text('B00000_inflate_credit.pdf')", timeout=120000)
    page.wait_for_timeout(500)
    body3 = page.inner_text("body")
    results["tamper_detected"] = "break the balance chain" in body3
    page.screenshot(path=str(shots / "05_tampered.png"), full_page=True)
    # model + about pages
    page.goto(f"{base}/model", wait_until="networkidle")
    page.wait_for_selector("text=ROC-AUC", timeout=30000)
    page.screenshot(path=str(shots / "06_model.png"), full_page=True)
    page.goto(f"{base}/about", wait_until="networkidle")
    page.screenshot(path=str(shots / "07_about.png"), full_page=True)
    results["console_errors"] = [e for e in errors if "favicon" not in e][:10]
    browser.close()

print(json.dumps(results, indent=1, ensure_ascii=False))
ok = results["memo_verified"] and results["has_pdn"] and results["whatif_changed"] and results["decision_logged"] and results["tamper_detected"] and not results["console_errors"]
print("E2E", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
