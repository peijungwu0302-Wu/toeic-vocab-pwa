# -*- coding: utf-8 -*-
"""
scripts/sync_audit_to_supabase.py
將本地 image_generation_audit.json 的已完工中繼資料（純文字：slug, headword, tier, generatedAt）
批次（每批 200~300 筆）同步回填至 Supabase studio_images 資料表。
這樣任何外部設備（圖書館公用電腦）打開伴侶網頁時，一點「刷新」就能知道本地全部已完工單字與時間戳！
"""
import os, sys, json, time, urllib.request, urllib.error
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent.parent
AUDIT_FILE = ROOT_DIR / "scripts" / "image_generation_audit.json"

SUPABASE_URL = "https://hgufhnytbkbmivhofqeu.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhndWZobnl0YmtibWl2aG9mcWV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MDA4MjYsImV4cCI6MjEwNDM3NjgyNn0._yPGhMCGKCmD1XoOeCMWSi9thyA1F_3QQdyX5BVsWXQ"

def backfill():
    if not AUDIT_FILE.exists():
        print("❌ 找不到 image_generation_audit.json！")
        return

    with open(AUDIT_FILE, "r", encoding="utf-8") as f:
        audit = json.load(f)

    records = audit.get("records", {})
    total_records = len(records)
    print(f"📊 本地審計日誌共有 {total_records} 筆已完工單字。")

    rows = []
    for slug, r in records.items():
        if slug.startswith("test_"):
            continue
        gen_at = r.get("generatedAt") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        rows.append({
            "slug": slug,
            "headword": r.get("headword", slug),
            "tier": r.get("tier", "gcp-pipeline"),
            "prompt": (r.get("prompt", "") or "")[:200],  # 截短節省空間
            "status": "completed",
            "image_url": "local_gcp",
            "image_size_bytes": r.get("webpSizeBytes", 0),
            "created_at": gen_at,
            "updated_at": gen_at
        })

    batch_size = 300
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }

    url = f"{SUPABASE_URL}/rest/v1/studio_images"
    uploaded = 0

    print(f"🚀 開始分批回填至 Supabase (每批 {batch_size} 筆)...")

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        payload = json.dumps(batch).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers)

        for retry in range(3):
            try:
                with urllib.request.urlopen(req) as resp:
                    if resp.status in (200, 201, 204):
                        uploaded += len(batch)
                        pct = (uploaded / len(rows)) * 100
                        print(f"  ✅ 已同步 [{uploaded}/{len(rows)}] ({pct:.1f}%) 至 Supabase")
                        break
            except Exception as e:
                print(f"  ⚠️ 批次同步警告 (重試 {retry+1}/3): {e}")
                time.sleep(2)
        time.sleep(0.2)

    print(f"\n🎉 恭喜！成功將 {uploaded} 筆單字完工狀態與時間戳回填至 Supabase 雲端！")

if __name__ == "__main__":
    backfill()
