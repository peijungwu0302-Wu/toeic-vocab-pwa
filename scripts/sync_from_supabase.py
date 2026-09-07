# -*- coding: utf-8 -*-
"""
scripts/sync_from_supabase.py
從 Supabase 雲端轉運站一鍵將白天在公用電腦/外部設備上傳的圖片同步回本地電腦：
1. 下載 JPG 原始檔至 public/assets/images/originals/<slug>.jpg (永久高畫質珍藏)
2. 壓製輕量 WebP 至 public/assets/images/words/<slug>.webp (供 App 離線秒開)
3. 同步登錄審計日誌與本機清單
4. 即時更新 preview_gallery.html
"""

import os, sys, json, time, io
from pathlib import Path
from PIL import Image
import urllib.request
import urllib.error

ROOT_DIR = Path(__file__).resolve().parent.parent
WORDS_DIR = ROOT_DIR / "public" / "assets" / "images" / "words"
ORIGINALS_DIR = ROOT_DIR / "public" / "assets" / "images" / "originals"
AUDIT_FILE = ROOT_DIR / "scripts" / "image_generation_audit.json"
LOCAL_WORDS_FILE = ROOT_DIR / "src" / "data" / "localImageWords.json"
PREVIEW_FILE = ROOT_DIR / "scripts" / "preview_gallery.html"

WORDS_DIR.mkdir(parents=True, exist_ok=True)
ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)

SUPABASE_URL = "https://hgufhnytbkbmivhofqeu.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhndWZobnl0YmtibWl2aG9mcWV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MDA4MjYsImV4cCI6MjEwNDM3NjgyNn0._yPGhMCGKCmD1XoOeCMWSi9thyA1F_3QQdyX5BVsWXQ"

def load_audit():
    if AUDIT_FILE.exists():
        try:
            with open(AUDIT_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"metadata": {}, "records": {}}

def sync_from_cloud():
    print("=" * 65)
    print("🔄 正在從 Supabase 雲端轉運站同步今日白天產出的圖片...")
    print(f"📡 連線端點: {SUPABASE_URL}")
    print("=" * 65)

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }

    # 1. 查詢 studio_images 資料表
    endpoint = f"{SUPABASE_URL}/rest/v1/studio_images?select=*"
    req = urllib.request.Request(endpoint, headers=headers)

    try:
        with urllib.request.urlopen(req) as resp:
            records = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"❌ 查詢 Supabase 失敗 (HTTP {e.code}): {e.read().decode('utf-8')}")
        print("💡 請確認是否已在 Supabase SQL Editor 執行建表語法！")
        return
    except Exception as e:
        print(f"❌ 連線異常: {e}")
        return

    print(f"📋 雲端共有 {len(records)} 筆單字出圖記錄。")

    if not records:
        print("🎉 雲端目前暫無新圖待拉取！")
        return

    audit = load_audit()
    local_words = []
    if LOCAL_WORDS_FILE.exists():
        try:
            with open(LOCAL_WORDS_FILE, "r", encoding="utf-8") as f:
                local_words = json.load(f)
        except Exception:
            pass

    downloaded_count = 0

    for r in records:
        slug = r.get("slug")
        headword = r.get("headword") or slug
        image_url = r.get("image_url")
        prompt = r.get("prompt") or ""
        tier = r.get("tier") or "portable-studio"

        if not slug or not image_url:
            continue

        orig_file = ORIGINALS_DIR / f"{slug}.jpg"
        webp_file = WORDS_DIR / f"{slug}.webp"

        # 如果已經在本地且大於 10KB，略過下載
        if orig_file.exists() and webp_file.exists() and orig_file.stat().st_size > 10000:
            continue

        print(f"📥 正在下載 '{headword}' ({slug})...", flush=True)

        try:
            # 從 Supabase Storage 下載原始檔案
            img_req = urllib.request.Request(image_url, headers=headers)
            with urllib.request.urlopen(img_req) as img_resp:
                img_bytes = img_resp.read()

            if len(img_bytes) < 1000:
                print(f"  ⚠️ 圖片尺寸異常過小 ({len(img_bytes)} bytes)，略過。")
                continue

            with Image.open(io.BytesIO(img_bytes)) as pil_img:
                if pil_img.mode in ("RGBA", "P"):
                    pil_img = pil_img.convert("RGB")

                # 1. 雙軌存檔：原始高畫質 JPG 珍藏
                pil_img.save(orig_file, "JPEG", quality=95)
                # 2. 輕量 WebP 供 App 離線加載
                pil_img.save(webp_file, "WEBP", quality=85, method=6)

            orig_size = orig_file.stat().st_size
            webp_size = webp_file.stat().st_size

            # 3. 記錄入審計日誌
            audit["records"][slug] = {
                "headword": headword,
                "slug": slug,
                "tier": tier,
                "webpFilename": f"{slug}.webp",
                "originalFilename": f"{slug}.jpg",
                "webpSizeBytes": webp_size,
                "originalSizeBytes": orig_size,
                "source": "portable_studio_cloud",
                "costTwd": 0.0,
                "costUsd": 0.0,
                "imagePrompt": prompt,
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }

            if slug not in local_words:
                local_words.append(slug)

            downloaded_count += 1
            print(f"  ✅ 雙軌落地成功！JPG 原圖珍藏 ({orig_size // 1024} KB) + WebP 網頁版 ({webp_size // 1024} KB)")

        except Exception as e:
            print(f"  ❌ 下載/轉檔失敗: {e}")

    if downloaded_count > 0:
        audit["metadata"]["totalGenerated"] = len(audit["records"])
        audit["metadata"]["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with open(AUDIT_FILE, "w", encoding="utf-8") as f:
            json.dump(audit, f, ensure_ascii=False, indent=2)

        with open(LOCAL_WORDS_FILE, "w", encoding="utf-8") as f:
            json.dump(local_words, f, ensure_ascii=False)

        print(f"\n🎉 成功拉回並落地珍藏 {downloaded_count} 張新圖！")
    else:
        print("\n✨ 所有雲端圖片均已在本地落地珍藏，無新檔需下載。")

if __name__ == "__main__":
    sync_from_cloud()
