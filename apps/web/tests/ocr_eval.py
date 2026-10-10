"""Receipt-OCR field accuracy on synthetic receipt photos, measured through the real app in headless Chromium.

    python3 tests/ocr_eval.py http://localhost:8787 ../../data/synthetic/documents 40 public/model/ocr_eval.json
"""
import glob
import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

base, docs, n_max, out = sys.argv[1], Path(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
items = []
for truth_file in sorted(glob.glob(str(docs / "*" / "truth.json"))):
    t = json.load(open(truth_file, encoding="utf-8"))
    for r in t["receipts"]:
        items.append((Path(truth_file).parent / r["file_photo"], r))
items = items[:n_max]
res = dict(n=0, total_ok=0, inn_ok=0, date_ok=0, receipt_no_ok=0, mean_conf=0.0, mean_ms=0.0, misses=[])
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1380, "height": 900})
    pg.goto(f"{base}/case/", wait_until="networkidle")
    for path, r in items:
        pg.click("text=Clear"); pg.wait_for_timeout(100)
        t0 = time.time()
        pg.set_input_files("input[type=file]", str(path))
        pg.wait_for_selector("text=OCR conf", timeout=180000); pg.wait_for_timeout(100)
        ms = (time.time() - t0) * 1000
        fields = pg.evaluate("""() => { const out={}; document.querySelectorAll('table tr').forEach(tr=>{ const td=tr.querySelectorAll('td'); if(td.length>=2){ const inp=td[1].querySelector('input'); if(inp) out[td[0].innerText.trim()]=inp.value; } }); return out; }""")
        conf = re.search(r"OCR conf (\d+)%", pg.inner_text("body"))
        res["n"] += 1
        tot_ok = fields.get("total") is not None and abs(float(fields["total"]) - r["total"]) < 1
        res["total_ok"] += tot_ok; res["inn_ok"] += fields.get("inn") == r["inn"]; res["date_ok"] += fields.get("date") == r["date"]
        res["receipt_no_ok"] += fields.get("receipt_no") == r["receipt_no"]
        res["mean_conf"] += int(conf.group(1)) if conf else 0; res["mean_ms"] += ms
        if not tot_ok: res["misses"].append(dict(file=str(path.name), truth=r["total"], ocr=fields.get("total"), conf=conf.group(1) if conf else None))
        print(res["n"], path.parent.name, path.name, "conf", conf.group(1) if conf else None, "total", fields.get("total"), "truth", r["total"], "OK" if tot_ok else "MISS", f"{ms:.0f}ms")
    b.close()
for k in ("mean_conf", "mean_ms"): res[k] = round(res[k] / max(res["n"], 1), 1)
for k in ("total_ok", "inn_ok", "date_ok", "receipt_no_ok"): res[k + "_rate"] = round(res[k] / max(res["n"], 1), 4)
res["note"] = "Synthetic receipts rendered to PNG, then camera-augmented (perspective, rotation, lighting, blur, JPEG). Measured through the real app with tesseract.js uzb+rus+eng."
json.dump(res, open(out, "w"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != "misses"}, indent=1))
