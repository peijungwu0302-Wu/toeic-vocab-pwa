import fs from 'node:fs';

const b64 = Buffer.from(`
# -*- coding: utf-8 -*-
import os, sys, json, time, argparse, io
from pathlib import Path
from PIL import Image

try:
    import vertexai
    from vertexai.preview.vision_models import ImageGenerationModel
    VERTEX_AVAILABLE = True
except ImportError:
    VERTEX_AVAILABLE = False

DEFAULT_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "project-5dc653c7-c4ff-4154-99e")
DEFAULT_LOCATION = os.environ.get("GCP_LOCATION", "us-central1")
MODEL_NAME = "imagen-3.0-fast-generate-001"
PRICE_PER_IMAGE = 0.02
MAX_BUDGET_USD = 250.0

ROOT_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT_DIR / "public" / "assets" / "images" / "words"
AUDIT_FILE = ROOT_DIR / "scripts" / "image_generation_audit.json"
PREVIEW_FILE = ROOT_DIR / "scripts" / "preview_gallery.html"

TEMPLATE_BLACKLIST = [
    "annual strategic summit",
    "senior leadership discussed key initiatives",
    "adhere strictly to safety protocols",
    "maintaining a tangible relationship"
]

def ensure_dirs():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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
            "unitCostUsd": PRICE_PER_IMAGE,
            "totalGenerated": 0,
            "totalCostUsd": 0.0,
            "lastUpdated": None
        },
        "records": {}
    }

def save_audit_log(audit_data):
    audit_data["metadata"]["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    audit_data["metadata"]["totalGenerated"] = len(audit_data["records"])
    audit_data["metadata"]["totalCostUsd"] = round(len(audit_data["records"]) * PRICE_PER_IMAGE, 2)
    with open(AUDIT_FILE, "w", encoding="utf-8") as f:
        json.dump(audit_data, f, ensure_ascii=False, indent=2)

def validate_prompt(word_entry, prompt_data):
    if not prompt_data:
        return False, "Missing prompt data"
    prompt = prompt_data.get("imagePrompt", "").strip()
    if not prompt:
        return False, "imagePrompt is empty"
    if len(prompt) < 35:
        return False, f"imagePrompt too short ({len(prompt)} < 35)"
    p_lower = prompt.lower()
    for bad in TEMPLATE_BLACKLIST:
        if bad.lower() in p_lower:
            return False, f"Prompt contains blacklisted phrase: {bad}"
    en_lower = prompt_data.get("en", "").lower()
    for bad in TEMPLATE_BLACKLIST:
        if bad.lower() in en_lower:
            return False, f"Example sentence contains blacklisted phrase: {bad}"
    return True, "Quality Gate Passed"

def load_dataset_and_prompts(tier="core-1200"):
    dataset_file = ROOT_DIR / "public" / "data" / "v1" / f"{tier}.json"
    cache_file = ROOT_DIR / "scripts" / f".step1_{tier}_cache.json"
    alt_cache_file = ROOT_DIR / "scripts" / ".step1_progress_cache.json"

    if not dataset_file.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_file}")

    with open(dataset_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    words = data.get("words", [])

    cache = {}
    if cache_file.exists():
        with open(cache_file, "r", encoding="utf-8") as f:
            cache.update(json.load(f))
    if alt_cache_file.exists():
        with open(alt_cache_file, "r", encoding="utf-8") as f:
            cache.update(json.load(f))

    print(f"Loaded {len(words)} words from {tier}.json (Prompt cache size: {len(cache)})")
    return words, cache

def generate_preview_html(audit_data):
    records = list(audit_data["records"].values())
    total_cost = audit_data["metadata"]["totalCostUsd"]
    total_count = audit_data["metadata"]["totalGenerated"]

    html_cards = []
    for r in reversed(records):
        rel_img = "../public/assets/images/words/" + str(r['filename'])
        card = f'''
        <div class="card">
            <div class="img-wrapper">
                <img src="{rel_img}" alt="{r['headword']}" loading="lazy" />
                <span class="badge">{r.get('scenario', 'Business')}</span>
            </div>
            <div class="info">
                <div class="header">
                    <span class="word">{r['headword']}</span>
                    <span class="zh">{r.get('definitionZh', '')}</span>
                </div>
                <p class="en-sentence"><strong>Example: </strong>{r.get('en', '')}</p>
                <p class="zh-sentence">{r.get('zh', '')}</p>
                <details>
                    <summary>View 1:1 Prompt</summary>
                    <p class="prompt-text">{r.get('imagePrompt', '')}</p>
                </details>
                <div class="meta">
                    <span>Duration: {r.get('durationMs', 0)}ms</span>
                    <span>Size: {r.get('fileSizeBytes', 0) // 1024} KB (WebP)</span>
                    <span>Cost: ${r.get('costUsd', 0.02)}</span>
                </div>
            </div>
        </div>
        '''
        html_cards.append(card)

    cards_str = "\\n".join(html_cards)
    html_content = f'''<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TOEIC Imagen 3 Image Quality Audit Gallery</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; }}
        header {{ margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }}
        h1 {{ font-size: 1.5rem; color: #38bdf8; }}
        .stats {{ display: flex; gap: 16px; font-size: 0.95rem; }}
        .stat-badge {{ background: #1e293b; padding: 8px 16px; border-radius: 8px; border: 1px solid #475569; }}
        .stat-value {{ font-weight: bold; color: #10b981; }}
        .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }}
        .card {{ background: #1e293b; border-radius: 12px; overflow: hidden; border: 1px solid #334155; }}
        .img-wrapper {{ position: relative; width: 100%; aspect-ratio: 1/1; background: #0b0f19; }}
        .img-wrapper img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
        .badge {{ position: absolute; top: 12px; right: 12px; background: rgba(15,23,42,0.85); color: #38bdf8; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; }}
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
            <h1>TOEIC Imagen 3 Fast Gallery</h1>
            <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 4px;">Model: {MODEL_NAME} ($0.02 / image) | 1:1 Vector Illustration</p>
        </div>
        <div class="stats">
            <div class="stat-badge">Generated: <span class="stat-value">{total_count} images</span></div>
            <div class="stat-badge">Total Cost: <span class="stat-value">${total_cost:.2f} USD</span></div>
        </div>
    </header>
    <div class="grid">
        {cards_str}
    </div>
</body>
</html>'''

    with open(PREVIEW_FILE, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"Generated visual audit preview: {PREVIEW_FILE}")

def run_pipeline(tier="core-1200", limit=5, dry_run=False, project_id=DEFAULT_PROJECT_ID, location=DEFAULT_LOCATION):
    ensure_dirs()
    audit_data = load_audit_log()
    words, cache = load_dataset_and_prompts(tier)

    current_cost = audit_data["metadata"]["totalCostUsd"]
    if current_cost >= MAX_BUDGET_USD:
        print(f"Budget limit reached (${current_cost:.2f} >= ${MAX_BUDGET_USD}).")
        return

    pending_tasks = []
    for w in words:
        wid = w["id"]
        if wid in audit_data["records"]:
            continue
        prompt_data = cache.get(wid)
        is_valid, reason = validate_prompt(w, prompt_data)
        if not is_valid:
            continue
        pending_tasks.append((w, prompt_data))

    print(f"Found {len(pending_tasks)} words that passed Quality Gate.")
    tasks_to_run = pending_tasks[:limit] if limit > 0 else pending_tasks
    print(f"Ready to process {len(tasks_to_run)} items in this run.")

    if dry_run:
        print("--- [Dry-Run Mode] ---")
        for idx, (w, p) in enumerate(tasks_to_run[:5], 1):
            print(f"[{idx}] {w['headword']} (ID: {w['id']})")
            print(f"  En: {p.get('en')[:70]}...")
            print(f"  Prompt: {p.get('imagePrompt')[:80]}...")
        return

    if not VERTEX_AVAILABLE:
        print("vertexai library not available.")
        return

    print(f"Initializing Vertex AI on project {project_id} ({location})...")
    vertexai.init(project=project_id, location=location)
    model = ImageGenerationModel.from_pretrained(MODEL_NAME)

    success_count = 0
    for idx, (w, p) in enumerate(tasks_to_run, 1):
        wid = w["id"]
        headword = w["headword"]
        prompt = p["imagePrompt"]

        current_cost = len(audit_data["records"]) * PRICE_PER_IMAGE
        if current_cost >= MAX_BUDGET_USD:
            print(f"Budget cap reached (${current_cost:.2f}). Stopping.")
            break

        print(f"[{idx}/{len(tasks_to_run)}] Generating image for '{headword}'...")
        t0 = time.time()
        try:
            response = model.generate_images(
                prompt=prompt,
                number_of_images=1,
                aspect_ratio="1:1",
                output_mime_type="image/jpeg"
            )

            img_bytes = response.images[0]._image_bytes
            duration_ms = int((time.time() - t0) * 1000)

            filename = f"{wid}.webp"
            webp_path = OUTPUT_DIR / filename

            with Image.open(io.BytesIO(img_bytes)) as pil_img:
                if pil_img.mode in ("RGBA", "P"):
                    pil_img = pil_img.convert("RGB")
                pil_img.save(webp_path, "WEBP", quality=82, method=6)

            file_size = webp_path.stat().st_size

            audit_data["records"][wid] = {
                "id": wid,
                "headword": headword,
                "definitionZh": w.get("definitionZh", ""),
                "scenario": p.get("scenario", "Business"),
                "en": p.get("en", ""),
                "zh": p.get("zh", ""),
                "imagePrompt": prompt,
                "filename": filename,
                "fileSizeBytes": file_size,
                "durationMs": duration_ms,
                "costUsd": PRICE_PER_IMAGE,
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }

            save_audit_log(audit_data)
            success_count += 1
            print(f"  Saved: {filename} ({file_size // 1024} KB) in {duration_ms}ms. Total cost: ${len(audit_data['records']) * PRICE_PER_IMAGE:.2f}")

        except Exception as e:
            print(f"  Failed for '{headword}': {str(e)}")

        time.sleep(1.0)

    generate_preview_html(audit_data)
    print(f"Batch finished! Successfully generated {success_count} images.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tier", default="core-1200")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--preview-only", action="store_true")
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
            project_id=args.project,
            location=args.location
        )
`, 'utf8');

fs.writeFileSync('scripts/generate_imagen_pipeline.py', b64.toString('utf8'), 'utf8');
console.log('generate_imagen_pipeline.py written successfully!');

def validate_prompt(word_entry, prompt_data):
    if not prompt_data:
        return False, "Missing prompt data"
    prompt = prompt_data.get("imagePrompt", "").strip()
    if not prompt:
        return False, "imagePrompt is empty"
    if len(prompt) < 35:
        return False, f"imagePrompt too short ({len(prompt)} < 35)"
    p_lower = prompt.lower()
    for bad in TEMPLATE_BLACKLIST:
        if bad.lower() in p_lower:
            return False, f"Prompt contains blacklisted phrase: {bad}"
    en_lower = prompt_data.get("en", "").lower()
    for bad in TEMPLATE_BLACKLIST:
        if bad.lower() in en_lower:
            return False, f"Example sentence contains blacklisted phrase: {bad}"
    return True, "Quality Gate Passed"

def load_dataset_and_prompts(tier="core-1200"):
    dataset_file = ROOT_DIR / "public" / "data" / "v1" / f"{tier}.json"
    cache_file = ROOT_DIR / "scripts" / f".step1_{tier}_cache.json"
    alt_cache_file = ROOT_DIR / "scripts" / ".step1_progress_cache.json"

    if not dataset_file.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_file}")

    with open(dataset_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    words = data.get("words", [])

    cache = {}
    if cache_file.exists():
        with open(cache_file, "r", encoding="utf-8") as f:
            cache.update(json.load(f))
    if alt_cache_file.exists():
        with open(alt_cache_file, "r", encoding="utf-8") as f:
            cache.update(json.load(f))

    print(f"📦 Loaded {len(words)} words from {tier}.json (Prompt cache size: {len(cache)})")
    return words, cache

def generate_preview_html(audit_data):
    records = list(audit_data["records"].values())
    total_cost = audit_data["metadata"]["totalCostUsd"]
    total_count = audit_data["metadata"]["totalGenerated"]

    html_cards = []
    for r in reversed(records):
        rel_img = f"../public/assets/images/words/{r['filename']}"
        card = f'''
        <div class="card">
            <div class="img-wrapper">
                <img src="{rel_img}" alt="{r['headword']}" loading="lazy" />
                <span class="badge">{r.get('scenario', '商務')}</span>
            </div>
            <div class="info">
                <div class="header">
                    <span class="word">{r['headword']}</span>
                    <span class="zh">{r.get('definitionZh', '')}</span>
                </div>
                <p class="en-sentence"><strong>例句：</strong>{r.get('en', '')}</p>
                <p class="zh-sentence">{r.get('zh', '')}</p>
                <details>
                    <summary>檢視 1:1 生圖 Prompt</summary>
                    <p class="prompt-text">{r.get('imagePrompt', '')}</p>
                </details>
                <div class="meta">
                    <span>⏱️ {r.get('durationMs', 0)}ms</span>
                    <span>💾 {r.get('fileSizeBytes', 0) // 1024} KB (WebP)</span>
                    <span>💰 \${r.get('costUsd', 0.02)}</span>
                </div>
            </div>
        </div>
        '''
        html_cards.append(card)

    cards_str = '\\n'.join(html_cards)
    html_content = f'''<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TOEIC Imagen 3 生圖品質審計畫廊</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; }}
        header {{ margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }}
        h1 {{ font-size: 1.5rem; color: #38bdf8; }}
        .stats {{ display: flex; gap: 16px; font-size: 0.95rem; }}
        .stat-badge {{ background: #1e293b; padding: 8px 16px; border-radius: 8px; border: 1px solid #475569; }}
        .stat-value {{ font-weight: bold; color: #10b981; }}
        .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }}
        .card {{ background: #1e293b; border-radius: 12px; overflow: hidden; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); }}
        .img-wrapper {{ position: relative; width: 100%; aspect-ratio: 1/1; background: #0b0f19; }}
        .img-wrapper img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
        .badge {{ position: absolute; top: 12px; right: 12px; background: rgba(15,23,42,0.85); color: #38bdf8; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; }}
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
            <h1>🎨 多益 Imagen 3 Fast 生圖品質審計畫廊</h1>
            <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 4px;">模型: {MODEL_NAME} ($0.02 / 張) | 1:1 向量商務插畫風格</p>
        </div>
        <div class="stats">
            <div class="stat-badge">已完成生成: <span class="stat-value">\${total_count} 張</span></div>
            <div class="stat-badge">累計費用: <span class="stat-value">\${total_cost:.2f} USD</span></div>
        </div>
    </header>
    <div class="grid">
        \${cards_str}
    </div>
</body>
</html>'''

    with open(PREVIEW_FILE, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"🖼️ Generated visual audit preview: {PREVIEW_FILE}")

def run_pipeline(tier="core-1200", limit=5, dry_run=False, project_id=DEFAULT_PROJECT_ID, location=DEFAULT_LOCATION):
    ensure_dirs()
    audit_data = load_audit_log()
    words, cache = load_dataset_and_prompts(tier)

    current_cost = audit_data["metadata"]["totalCostUsd"]
    if current_cost >= MAX_BUDGET_USD:
        print(f"🛑 Budget limit reached (${current_cost:.2f} >= ${MAX_BUDGET_USD}).")
        return

    pending_tasks = []
    for w in words:
        wid = w["id"]
        if wid in audit_data["records"]:
            continue
        prompt_data = cache.get(wid)
        is_valid, reason = validate_prompt(w, prompt_data)
        if not is_valid:
            continue
        pending_tasks.append((w, prompt_data))

    print(f"🔍 Found {len(pending_tasks)} words that passed Quality Gate.")
    tasks_to_run = pending_tasks[:limit] if limit > 0 else pending_tasks
    print(f"🎯 Ready to process {len(tasks_to_run)} items in this run.")

    if dry_run:
        print("--- [Dry-Run Mode] ---")
        for idx, (w, p) in enumerate(tasks_to_run[:5], 1):
            print(f"[{idx}] {w['headword']} (ID: {w['id']})")
            print(f"  En: {p.get('en')[:70]}...")
            print(f"  Prompt: {p.get('imagePrompt')[:80]}...")
        return

    if not VERTEX_AVAILABLE:
        print("❌ vertexai library not available.")
        return

    print(f"🔌 Initializing Vertex AI on project {project_id} ({location})...")
    vertexai.init(project=project_id, location=location)
    model = ImageGenerationModel.from_pretrained(MODEL_NAME)

    success_count = 0
    for idx, (w, p) in enumerate(tasks_to_run, 1):
        wid = w["id"]
        headword = w["headword"]
        prompt = p["imagePrompt"]

        current_cost = len(audit_data["records"]) * PRICE_PER_IMAGE
        if current_cost >= MAX_BUDGET_USD:
            print(f"🛑 Budget cap reached (${current_cost:.2f}). Stopping.")
            break

        print(f"🚀 [{idx}/{len(tasks_to_run)}] Generating image for '{headword}'...")
        t0 = time.time()
        try:
            response = model.generate_images(
                prompt=prompt,
                number_of_images=1,
                aspect_ratio="1:1",
                output_mime_type="image/jpeg"
            )

            img_bytes = response.images[0]._image_bytes
            duration_ms = int((time.time() - t0) * 1000)

            filename = f"{wid}.webp"
            webp_path = OUTPUT_DIR / filename

            with Image.open(io.BytesIO(img_bytes)) as pil_img:
                if pil_img.mode in ("RGBA", "P"):
                    pil_img = pil_img.convert("RGB")
                pil_img.save(webp_path, "WEBP", quality=82, method=6)

            file_size = webp_path.stat().st_size

            audit_data["records"][wid] = {
                "id": wid,
                "headword": headword,
                "definitionZh": w.get("definitionZh", ""),
                "scenario": p.get("scenario", "商務"),
                "en": p.get("en", ""),
                "zh": p.get("zh", ""),
                "imagePrompt": prompt,
                "filename": filename,
                "fileSizeBytes": file_size,
                "durationMs": duration_ms,
                "costUsd": PRICE_PER_IMAGE,
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }

            save_audit_log(audit_data)
            success_count += 1
            print(f"  ✅ Saved: {filename} ({file_size // 1024} KB) in {duration_ms}ms. Total cost: ${len(audit_data['records']) * PRICE_PER_IMAGE:.2f}")

        except Exception as e:
            print(f"  ❌ Failed for '{headword}': {str(e)}")

        time.sleep(1.0)

    generate_preview_html(audit_data)
    print(f"🎉 Batch finished! Successfully generated {success_count} images.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tier", default="core-1200")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--preview-only", action="store_true")
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
            project_id=args.project,
            location=args.location
        )
`;

fs.writeFileSync('scripts/generate_imagen_pipeline.py', pyCode, 'utf8');
console.log('✅ generate_imagen_pipeline.py created successfully!');
