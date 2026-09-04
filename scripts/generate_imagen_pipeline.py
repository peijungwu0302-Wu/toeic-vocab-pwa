# -*- coding: utf-8 -*-
import os, sys, json, time, argparse, io, re
from pathlib import Path
from PIL import Image
from google import genai

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace', line_buffering=True)

DEFAULT_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "project-5dc653c7-c4ff-4154-99e")
DEFAULT_LOCATION = os.environ.get("GCP_LOCATION", "us-central1")
MODEL_NAME = "gemini-2.5-flash-image"

# ==============================================================================
# 💰 財務精確計價與安全熔斷配置 (以新台幣 TWD 為唯一真金白銀基準)
# ==============================================================================
PRICE_PER_IMAGE_TWD = 1.244            # 實測真金白銀成本 (1,493 TWD / 1,200 張)
PRICE_PER_IMAGE_USD = 0.0385           # 對應折算美金
INITIAL_REMAINING_CREDIT_TWD = 8017.0  # 當前剩餘 GCP 試用金總額
DEFAULT_MAX_BATCH_BUDGET_TWD = 3150.0  # 本次批次預算上限 (精準覆蓋 advanced-2500)
SAFETY_CREDIT_FLOOR_TWD = 4500.0       # 帳戶最低安全底限 (剩餘低於此值強制停機)

ROOT_DIR = Path(__file__).resolve().parent.parent
WORDS_DIR = ROOT_DIR / "public" / "assets" / "images" / "words"
ORIGINALS_DIR = ROOT_DIR / "public" / "assets" / "images" / "originals"
AUDIT_FILE = ROOT_DIR / "scripts" / "image_generation_audit.json"
PREVIEW_FILE = ROOT_DIR / "scripts" / "preview_gallery.html"
LOCAL_WORDS_FILE = ROOT_DIR / "src" / "data" / "localImageWords.json"

def slugify(text):
    clean = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return clean if clean else "word"

def ensure_dirs():
    WORDS_DIR.mkdir(parents=True, exist_ok=True)
    ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)

def load_audit_log():
    if AUDIT_FILE.exists():
        try:
            with open(AUDIT_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "metadata": {
            "model": MODEL_NAME,
            "unitCostTwd": PRICE_PER_IMAGE_TWD,
            "unitCostUsd": PRICE_PER_IMAGE_USD,
            "initialCreditTwd": INITIAL_REMAINING_CREDIT_TWD,
            "totalGenerated": 0,
            "totalCostTwd": 0.0,
            "totalCostUsd": 0.0,
            "remainingCreditTwd": INITIAL_REMAINING_CREDIT_TWD,
            "lastUpdated": None
        },
        "records": {}
    }

def atomic_save_json(target_path, data):
    temp_path = target_path.with_suffix(target_path.suffix + ".tmp")
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    temp_path.replace(target_path)

def save_audit_log(audit_data, new_in_this_session=0):
    total_count = len(audit_data["records"])
    audit_data["metadata"]["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    audit_data["metadata"]["totalGenerated"] = total_count
    audit_data["metadata"]["unitCostTwd"] = PRICE_PER_IMAGE_TWD
    audit_data["metadata"]["unitCostUsd"] = PRICE_PER_IMAGE_USD
    
    session_cost_twd = round(new_in_this_session * PRICE_PER_IMAGE_TWD, 1)
    audit_data["metadata"]["sessionCostTwd"] = session_cost_twd
    audit_data["metadata"]["remainingCreditTwd"] = round(INITIAL_REMAINING_CREDIT_TWD - session_cost_twd, 1)
    audit_data["metadata"]["totalCostTwd"] = round(total_count * PRICE_PER_IMAGE_TWD, 1)
    audit_data["metadata"]["totalCostUsd"] = round(total_count * PRICE_PER_IMAGE_USD, 2)

    atomic_save_json(AUDIT_FILE, audit_data)

def sync_local_image_words(slug):
    if not LOCAL_WORDS_FILE.exists():
        return
    try:
        with open(LOCAL_WORDS_FILE, "r", encoding="utf-8") as f:
            words = json.load(f)
        if slug not in words:
            words.append(slug)
            temp_file = LOCAL_WORDS_FILE.with_suffix(".json.tmp")
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(words, f, ensure_ascii=False)
            temp_file.replace(LOCAL_WORDS_FILE)
    except Exception as e:
        print(f"⚠️ Failed to sync localImageWords: {e}", flush=True)

def generate_preview_html(audit_data):
    records = list(audit_data["records"].values())
    meta = audit_data.get("metadata", {})
    total_count = meta.get("totalGenerated", len(records))
    total_cost_twd = meta.get("totalCostTwd", round(total_count * PRICE_PER_IMAGE_TWD, 1))
    total_cost_usd = meta.get("totalCostUsd", round(total_count * PRICE_PER_IMAGE_USD, 2))
    rem_credit_twd = meta.get("remainingCreditTwd", INITIAL_REMAINING_CREDIT_TWD)

    html_cards = []
    for r in reversed(records):
        webp_fn = r.get("webpFilename") or r.get("filename") or ""
        orig_fn = r.get("originalFilename") or webp_fn.replace(".webp", ".jpg")
        rel_img = f"../public/assets/images/words/{webp_fn}"
        orig_img = f"../public/assets/images/originals/{orig_fn}"
        card = f"""
        <div class="card">
            <div class="img-wrapper">
                <img src="{rel_img}" alt="{r.get('headword', '')}" loading="lazy" />
                <span class="badge">{r.get('scenario', '生活具象')}</span>
            </div>
            <div class="info">
                <div class="header">
                    <span class="word">{r.get('headword', '')}</span>
                    <span class="zh">{r.get('definitionZh', '')}</span>
                </div>
                <p class="en-sentence"><strong>例句：</strong>{r.get('en', '')}</p>
                <p class="zh-sentence">{r.get('zh', '')}</p>
                <details>
                    <summary>檢視 1:1 發光看板概念插畫 Prompt</summary>
                    <p class="prompt-text">{r.get('imagePrompt', '')}</p>
                </details>
                <div class="meta">
                    <span>⏱️ {r.get('durationMs', 0)}ms</span>
                    <span>💾 WebP: {r.get('webpSizeBytes', 0) // 1024} KB | <a href="{orig_img}" target="_blank" style="color:#38bdf8;">JPG ({r.get('originalSizeBytes', 0) // 1024} KB)</a></span>
                    <span>💰 ~1.24 TWD</span>
                </div>
            </div>
        </div>
        """
        html_cards.append(card)

    cards_str = "\n".join(html_cards)
    html_content = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TOEIC 多益頂級具象生活插畫審計畫廊</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; }}
        header {{ margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }}
        h1 {{ font-size: 1.5rem; color: #38bdf8; }}
        .stats {{ display: flex; gap: 16px; font-size: 0.95rem; flex-wrap: wrap; }}
        .stat-badge {{ background: #1e293b; padding: 8px 16px; border-radius: 8px; border: 1px solid #475569; }}
        .stat-value {{ font-weight: bold; color: #10b981; }}
        .stat-value-warn {{ font-weight: bold; color: #f59e0b; }}
        .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 24px; }}
        .card {{ background: #1e293b; border-radius: 12px; overflow: hidden; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); transition: transform 0.2s; }}
        .card:hover {{ transform: translateY(-4px); border-color: #38bdf8; }}
        .img-wrapper {{ position: relative; width: 100%; aspect-ratio: 1/1; background: #0b0f19; }}
        .img-wrapper img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
        .badge {{ position: absolute; top: 12px; right: 12px; background: rgba(15,23,42,0.85); color: #38bdf8; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; backdrop-filter: blur(4px); }}
        .info {{ padding: 16px; }}
        .header {{ display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }}
        .word {{ font-size: 1.25rem; font-weight: bold; color: #f1f5f9; }}
        .zh {{ color: #94a3b8; font-size: 0.9rem; }}
        .en-sentence {{ font-size: 0.85rem; color: #cbd5e1; margin-bottom: 4px; line-height: 1.4; }}
        .zh-sentence {{ font-size: 0.8rem; color: #64748b; margin-bottom: 12px; }}
        details {{ font-size: 0.75rem; color: #94a3b8; background: #0f172a; padding: 8px; border-radius: 6px; margin-bottom: 12px; }}
        summary {{ cursor: pointer; color: #38bdf8; }}
        .prompt-text {{ margin-top: 6px; line-height: 1.3; color: #e2e8f0; }}
        .meta {{ display: flex; justify-content: space-between; font-size: 0.75rem; color: #64748b; border-top: 1px solid #334155; padding-top: 8px; }}
    </style>
</head>
<body>
    <header>
        <div>
            <h1>🎨 多益頂級具象生活插畫審計畫廊 (Vertex AI Imagen Quality Booster)</h1>
            <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 4px;">模型: gemini-2.5-flash-image (~1.24 TWD / 張) | 1:1 概念插畫風格（帶發光招牌） | 雙軌存檔 (JPG原圖 + WebP輕量)</p>
        </div>
        <div class="stats">
            <div class="stat-badge">已完成庫存: <span class="stat-value">{total_count} 張</span></div>
            <div class="stat-badge">累計花費: <span class="stat-value">{total_cost_twd} TWD (${total_cost_usd} USD)</span></div>
            <div class="stat-badge">剩餘試用金預估: <span class="stat-value-warn">{rem_credit_twd} TWD</span></div>
        </div>
    </header>
    <div class="grid">
        {cards_str}
    </div>
</body>
</html>"""

    atomic_save_json(PREVIEW_FILE.with_suffix(".tmp.json"), {})  # test
    with open(PREVIEW_FILE, "w", encoding="utf-8") as f:
        f.write(html_content)

def run_pipeline(tier="advanced-2500", limit=0, dry_run=False, budget_twd=DEFAULT_MAX_BATCH_BUDGET_TWD, project_id=DEFAULT_PROJECT_ID, location=DEFAULT_LOCATION, force_regenerate=False):
    ensure_dirs()
    audit_data = load_audit_log()
    
    dataset_file = ROOT_DIR / "public" / "data" / "v1" / f"{tier}.json"
    if not dataset_file.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_file}")

    with open(dataset_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    words = data.get("words", [])

    print(f"\n=================================================================", flush=True)
    print(f"🚀 Vertex AI High-Resilience Generator: [{tier}]", flush=True)
    print(f"💰 Real Unit Cost: {PRICE_PER_IMAGE_TWD} TWD / image", flush=True)
    print(f"🛑 Batch Budget Cap: {budget_twd} TWD (Safety Floor: {SAFETY_CREDIT_FLOOR_TWD} TWD)", flush=True)
    print(f"💳 Initial Remaining Credit: {INITIAL_REMAINING_CREDIT_TWD} TWD", flush=True)
    print(f"🛡️ Power-Cut Proof: Atomic Swap + File Size Gate Active", flush=True)
    print(f"=================================================================\n", flush=True)

    pending_tasks = []
    for w in words:
        wid = w.get("id")
        headword = w.get("headword", "")
        slug = slugify(headword)

        webp_path = WORDS_DIR / f"{slug}.webp"
        # 只要磁碟上存在且大於 10KB 且已收錄在 audit 中，略過
        if not force_regenerate and webp_path.exists() and webp_path.stat().st_size > 10000 and slug in audit_data["records"]:
            continue

        va = w.get("visualAnchor") or {}
        image_prompt = va.get("imagePrompt") or ""
        
        examples = w.get("examples") or []
        ex_1 = examples[0] if len(examples) > 0 else {}
        short_en = ex_1.get("en") or ""
        short_zh = ex_1.get("zh") or w.get("definitionZh", "")
        scenario = ex_1.get("scenario") or "生活具象"

        if not image_prompt:
            continue

        pending_tasks.append({
            "id": wid,
            "headword": headword,
            "slug": slug,
            "definitionZh": w.get("definitionZh", ""),
            "scenario": scenario,
            "en": short_en,
            "zh": short_zh,
            "imagePrompt": image_prompt
        })

    tasks_to_run = pending_tasks[:limit] if limit > 0 else pending_tasks
    print(f"📋 Total pending in [{tier}]: {len(tasks_to_run)} images to generate.", flush=True)

    if len(tasks_to_run) == 0:
        print("🎉 All words in this tier already have verified images on disk and in audit!", flush=True)
        generate_preview_html(audit_data)
        return

    if dry_run:
        print(f"--- [Dry-Run] Estimated Cost for {len(tasks_to_run)} items: ~{len(tasks_to_run) * PRICE_PER_IMAGE_TWD:.1f} TWD ---", flush=True)
        return

    session_generated_count = 0
    client = genai.Client(vertexai=True, project=project_id, location=location)

    for idx, task in enumerate(tasks_to_run, 1):
        # 1. 雙重熔斷檢查
        spent_twd = session_generated_count * PRICE_PER_IMAGE_TWD
        rem_twd = INITIAL_REMAINING_CREDIT_TWD - spent_twd
        if spent_twd >= budget_twd:
            print(f"\n🛑 觸發批次預算熔斷 ({spent_twd:.1f} >= {budget_twd} TWD)！安全停止。", flush=True)
            break
        if rem_twd <= SAFETY_CREDIT_FLOOR_TWD:
            print(f"\n🚨 觸發試用金安全底限 ({rem_twd:.1f} <= {SAFETY_CREDIT_FLOOR_TWD} TWD)！緊急停機。", flush=True)
            break

        slug = task["slug"]
        headword = task["headword"]
        prompt = task["imagePrompt"]

        # 磁碟防重複保護
        webp_path = WORDS_DIR / f"{slug}.webp"
        if not force_regenerate and webp_path.exists() and webp_path.stat().st_size > 10000 and slug in audit_data["records"]:
            continue

        print(f"[{idx}/{len(tasks_to_run)}] Generating image for '{headword}' -> '{slug}.webp'...", flush=True)
        t0 = time.time()
        img_bytes = None

        for attempt in range(3):
            try:
                res = client.models.generate_content(
                    model=MODEL_NAME,
                    contents=prompt
                )
                for cand in res.candidates:
                    for part in cand.content.parts:
                        if hasattr(part, "inline_data") and part.inline_data and part.inline_data.data:
                            img_bytes = part.inline_data.data
                            break
                    if img_bytes:
                        break
                if img_bytes:
                    break
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "quota" in err_str.lower():
                    print(f"  [429 Quota Delay] Waiting 20s before retry...", flush=True)
                    time.sleep(20)
                else:
                    print(f"  Attempt {attempt + 1} error: {err_str[:80]}", flush=True)
                    time.sleep(3)

        if not img_bytes:
            print(f"  ❌ FAILED to generate '{headword}', moving to next.", flush=True)
            continue

        duration_ms = int((time.time() - t0) * 1000)

        # 🛡️ 斷電安全：寫入臨時檔再 Atomic Replace
        try:
            orig_filename = f"{slug}.jpg"
            webp_filename = f"{slug}.webp"
            orig_path = ORIGINALS_DIR / orig_filename
            webp_path = WORDS_DIR / webp_filename

            temp_orig = ORIGINALS_DIR / f"{slug}.jpg.tmp"
            temp_webp = WORDS_DIR / f"{slug}.webp.tmp"

            with Image.open(io.BytesIO(img_bytes)) as pil_img:
                if pil_img.mode in ("RGBA", "P"):
                    pil_img = pil_img.convert("RGB")
                pil_img.save(temp_orig, "JPEG", quality=95)
                pil_img.save(temp_webp, "WEBP", quality=85, method=6)

            temp_orig.replace(orig_path)
            temp_webp.replace(webp_path)

            orig_size = orig_path.stat().st_size
            webp_size = webp_path.stat().st_size

            audit_data["records"][slug] = {
                "id": task["id"],
                "headword": headword,
                "slug": slug,
                "definitionZh": task["definitionZh"],
                "scenario": task["scenario"],
                "en": task["en"],
                "zh": task["zh"],
                "imagePrompt": prompt,
                "originalFilename": orig_filename,
                "webpFilename": webp_filename,
                "originalSizeBytes": orig_size,
                "webpSizeBytes": webp_size,
                "durationMs": duration_ms,
                "costTwd": PRICE_PER_IMAGE_TWD,
                "costUsd": PRICE_PER_IMAGE_USD,
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }
            session_generated_count += 1
            save_audit_log(audit_data, session_generated_count)
            sync_local_image_words(slug)

            # 🌟 每一張生成後「立刻」刷新 preview_gallery.html，讓使用者零延遲看到！
            generate_preview_html(audit_data)

            curr_spent = session_generated_count * PRICE_PER_IMAGE_TWD
            left_credit = INITIAL_REMAINING_CREDIT_TWD - curr_spent
            pct = (idx / len(tasks_to_run)) * 100
            print(f"  ✅ Saved: {webp_filename} ({webp_size // 1024} KB) in {duration_ms}ms | [{idx}/{len(tasks_to_run)}] {pct:.1f}% | Spent: {curr_spent:.1f} TWD | Left: ~{left_credit:.1f} TWD", flush=True)

        except Exception as e:
            print(f"  ❌ File save error for '{headword}': {e}", flush=True)

        # 平滑節奏 (每張間隔約 2 秒，總速率約 5~6 RPM)
        time.sleep(2.0)

    # 差集對帳驗收
    generate_preview_html(audit_data)
    print(f"\n=================================================================", flush=True)
    print(f"🎉 批次任務結束！", flush=True)
    print(f"📊 本次新增生成: {session_generated_count} 張", flush=True)
    print(f"💰 本次花費: {session_generated_count * PRICE_PER_IMAGE_TWD:.1f} TWD", flush=True)
    print(f"💳 預估剩餘試用金: {INITIAL_REMAINING_CREDIT_TWD - (session_generated_count * PRICE_PER_IMAGE_TWD):.1f} TWD", flush=True)
    print(f"=================================================================\n", flush=True)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tier", default="advanced-2500")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--preview-only", action="store_true")
    parser.add_argument("--budget-twd", type=float, default=DEFAULT_MAX_BATCH_BUDGET_TWD)
    parser.add_argument("--project", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--location", default=DEFAULT_LOCATION)
    args = parser.parse_args()

    if args.preview_only:
        audit = load_audit_log()
        generate_preview_html(audit)
    else:
        run_pipeline(
            tier=args.tier,
            limit=args.limit,
            dry_run=args.dry_run,
            budget_twd=args.budget_twd,
            project_id=args.project,
            location=args.location,
            force_regenerate=args.force
        )
