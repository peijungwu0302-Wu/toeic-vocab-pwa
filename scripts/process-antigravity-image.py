# -*- coding: utf-8 -*-
import os, sys, json, time, argparse
from pathlib import Path
from PIL import Image
import urllib.request

ROOT_DIR = Path(__file__).resolve().parent.parent
WORDS_DIR = ROOT_DIR / "public" / "assets" / "images" / "words"
ORIGINALS_DIR = ROOT_DIR / "public" / "assets" / "images" / "originals"
AUDIT_FILE = ROOT_DIR / "scripts" / "image_generation_audit.json"
LOCAL_WORDS_FILE = ROOT_DIR / "src" / "data" / "localImageWords.json"

WORDS_DIR.mkdir(parents=True, exist_ok=True)
ORIGINALS_DIR.mkdir(parents=True, exist_ok=True)

def slugify(text):
    import re
    return re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()

def process_image(slug, headword, raw_image_path, prompt="", tier="advanced-2500"):
    clean_slug = slugify(slug)
    src_path = Path(raw_image_path)
    if not src_path.exists():
        print(f"Error: Raw image {src_path} does not exist", file=sys.stderr)
        sys.exit(1)

    webp_filename = f"{clean_slug}.webp"
    orig_filename = f"{clean_slug}.jpg"
    webp_path = WORDS_DIR / webp_filename
    orig_path = ORIGINALS_DIR / orig_filename

    tmp_webp = webp_path.with_suffix(".webp.tmp")
    tmp_orig = orig_path.with_suffix(".jpg.tmp")

    with Image.open(src_path) as img:
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.save(tmp_orig, "JPEG", quality=95)
        img.save(tmp_webp, "WEBP", quality=85, method=6)

    tmp_orig.replace(orig_path)
    tmp_webp.replace(webp_path)

    orig_size = orig_path.stat().st_size
    webp_size = webp_path.stat().st_size

    # Update Audit
    audit = {"metadata": {"totalGenerated": 0}, "records": {}}
    if AUDIT_FILE.exists():
        try:
            with open(AUDIT_FILE, "r", encoding="utf-8") as f:
                audit = json.load(f)
        except Exception:
            pass

    audit["records"][clean_slug] = {
        "headword": headword or clean_slug,
        "slug": clean_slug,
        "tier": tier,
        "webpFilename": webp_filename,
        "originalFilename": orig_filename,
        "webpSizeBytes": webp_size,
        "originalSizeBytes": orig_size,
        "imagePrompt": prompt,
        "source": "antigravity",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    audit["metadata"]["totalGenerated"] = len(audit["records"])
    audit["metadata"]["lastUpdated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    tmp_audit = AUDIT_FILE.with_suffix(".json.tmp")
    with open(tmp_audit, "w", encoding="utf-8") as f:
        json.dump(audit, f, ensure_ascii=False, indent=2)
    tmp_audit.replace(AUDIT_FILE)

    # Sync localImageWords
    if LOCAL_WORDS_FILE.exists():
        try:
            with open(LOCAL_WORDS_FILE, "r", encoding="utf-8") as f:
                local_words = json.load(f)
            if clean_slug not in local_words:
                local_words.append(clean_slug)
                tmp_local = LOCAL_WORDS_FILE.with_suffix(".json.tmp")
                with open(tmp_local, "w", encoding="utf-8") as f:
                    json.dump(local_words, f, ensure_ascii=False)
                tmp_local.replace(LOCAL_WORDS_FILE)
        except Exception as e:
            print(f"Warn: could not sync local words: {e}")

    # Auto-link inflections (e.g. jobs -> job)
    try:
        master_file = ROOT_DIR / "public" / "data" / "v1" / f"{tier}.json"
        if master_file.exists():
            with open(master_file, "r", encoding="utf-8") as f:
                mdata = json.load(f)
            for mw in mdata.get("words", []):
                mhw = mw.get("headword", "").lower()
                if mhw != clean_slug and (mhw == clean_slug + "s" or mhw == clean_slug + "es"):
                    inf_slug = slugify(mhw)
                    inf_path = WORDS_DIR / f"{inf_slug}.webp"
                    if not inf_path.exists():
                        import shutil
                        shutil.copyfile(webp_path, inf_path)
                        print(f"Auto-linked inflection: {inf_slug}.webp from {clean_slug}")
    except Exception as e:
        pass

    print(f"SUCCESS: Dual-saved '{clean_slug}' -> WebP ({webp_size // 1024} KB) + JPG ({orig_size // 1024} KB)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--slug", required=True)
    parser.add_argument("--headword", required=True)
    parser.add_argument("--image-path", required=True)
    parser.add_argument("--prompt", default="")
    parser.add_argument("--tier", default="advanced-2500")
    args = parser.parse_args()

    process_image(args.slug, args.headword, args.image_path, args.prompt, args.tier)
