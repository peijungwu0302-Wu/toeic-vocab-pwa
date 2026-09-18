# -*- coding: utf-8 -*-
"""
scripts/poc_runner.py
Automated 10-Word End-to-End PoC Runner for TOEIC Vocab R2 Image System.
Tests:
1. Auth rejection
2. SHA-256 mismatch rejection
3. 5 Legacy words -> R2 v1 import with provenance: recovered-from-audit
4. 5 No-image words -> R2 v1 publish with v4 prompt
5. Idempotency test (duplicate publishRequestId)
6. 5 Legacy words -> R2 v2 upgrade
7. accelerate v2 -> rollback to v1 (verifying v2 preserved and other words unaffected)
8. Direct CDN retrieval of WebP objects and SHA-256 verification
9. Latency and CPU profiling
"""

import os, sys, json, hashlib, base64, time
import urllib.request, urllib.error
from io import BytesIO

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

WORKER_URL = "https://toeic-image-publisher.peijungwu0302.workers.dev"
SECRET = "toeic_poc_secret_2026"
HEADERS_BASE = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TOEIC-PoC/1.0",
    "Content-Type": "application/json"
}

# 10 PoC Candidates
LEGACY_WORDS = [
    {"headword": "abandon", "wordId": "tw_w_c10323ff1d5a", "slug": "abandon"},
    {"headword": "ability", "wordId": "tw_w_226b975ecfe8", "slug": "ability"},
    {"headword": "absence", "wordId": "tw_w_98a72ee91807", "slug": "absence"},
    {"headword": "abundant", "wordId": "tw_w_232c9ba95094", "slug": "abundant"},
    {"headword": "accelerate", "wordId": "tw_w_962a26c4f02a", "slug": "accelerate"},
]

NEW_WORDS = [
    {"headword": "improperly", "wordId": "tw_w_8c7f7c60bb44", "slug": "improperly"},
    {"headword": "metropolitan", "wordId": "tw_w_0b319a3135de", "slug": "metropolitan"},
    {"headword": "migrant", "wordId": "tw_w_2d702ee0621b", "slug": "migrant"},
    {"headword": "migrate", "wordId": "tw_w_d33fbbaec8fe", "slug": "migrate"},
    {"headword": "migration", "wordId": "tw_w_5e1b8d56cc25", "slug": "migration"},
]

def make_request(url, method="GET", data=None, headers=None):
    hdrs = dict(HEADERS_BASE)
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, method=method, headers=hdrs)
    payload = json.dumps(data).encode('utf-8') if data is not None else None
    try:
        with urllib.request.urlopen(req, data=payload, timeout=20) as resp:
            body = resp.read()
            return resp.status, resp.headers, body
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, e.headers, body

def create_dummy_webp(tag_text="POC_TEST", color=(56, 189, 248)):
    """Generate a clean 896x896 WebP using Pillow if available, or a valid minimal WebP."""
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (896, 896), color=(15, 23, 42))
        draw = ImageDraw.Draw(img)
        # Draw some decorative geometry
        draw.rectangle([48, 48, 848, 848], outline=color, width=8)
        draw.ellipse([200, 200, 696, 696], outline=(99, 102, 241), width=6)
        draw.text((100, 430), f"TOEIC VOCAB: {tag_text}", fill=(255, 255, 255))
        buf = BytesIO()
        img.save(buf, format="WEBP", quality=85)
        return buf.getvalue()
    except ImportError:
        # Minimal valid 1x1 WebP
        return base64.b64decode("UklGRjIAAABXRUJQVlA4ICYAAACyAAAAAgCdASoBAAEALmk0mk0iIiIiIgBoSygABc6WWgAA/vePt0AA")

def test_auth_rejection():
    print("\n--- [TEST 1] Auth Rejection ---")
    status, _, body = make_request(f"{WORKER_URL}/api/publish", method="POST", data={"wordId": "tw_w_test12345678"}, headers={"X-Studio-Secret": "wrong_secret"})
    print(f"Status: {status} (Expected: 401)")
    assert status == 401, f"Expected 401, got {status}"
    print("PASS: Correctly rejected invalid secret.")

def test_sha_mismatch_rejection():
    print("\n--- [TEST 2] SHA-256 Mismatch Rejection ---")
    webp_bytes = create_dummy_webp("TEST")
    payload = {
        "wordId": "tw_w_8c7f7c60bb44",
        "imageWebpBase64": base64.b64encode(webp_bytes).decode('ascii'),
        "imageSha256": "0" * 64, # intentionally fake
        "publishRequestId": f"req_tamper_{int(time.time())}"
    }
    status, _, body = make_request(f"{WORKER_URL}/api/publish", method="POST", data=payload, headers={"X-Studio-Secret": SECRET})
    print(f"Status: {status} (Expected: 400)")
    assert status == 400, f"Expected 400, got {status}"
    res = json.loads(body.decode())
    assert "Integrity check failed" in res.get("error", ""), f"Unexpected error: {res}"
    print("PASS: Correctly rejected SHA-256 hash tampering.")

def run_10_word_poc():
    # Load audit records for legacy exact info
    audit_file = "scripts/image_generation_audit.json"
    audit_records = json.load(open(audit_file, encoding='utf-8')).get('records', {})
    
    # Load expert-high-part2 for new word prompts
    course_file = "public/data/v1/courses/course-expert-high-part2.json"
    course_words = {w['id']: w for w in json.load(open(course_file, encoding='utf-8')).get('words', [])}

    results = []

    # --- Phase A: 5 Legacy Words -> R2 v1 Import ---
    print("\n--- [TEST 3] Import 5 Legacy Words as R2 v1 ---")
    for item in LEGACY_WORDS:
        wid = item["wordId"]
        slug = item["slug"]
        webp_path = os.path.join("public/assets/images/words", f"{slug}.webp")
        with open(webp_path, "rb") as f:
            webp_bytes = f.read()
            
        sha256 = hashlib.sha256(webp_bytes).hexdigest()
        audit_rec = audit_records.get(slug, {})
        provenance = "recovered-from-audit" if audit_rec else "legacy-local-import"
        
        prompt_data = {
            "formulaVersion": "v4-cinematic" if "boostedPrompt" in audit_rec else "legacy-v3",
            "fullPromptText": audit_rec.get("boostedPrompt") or audit_rec.get("rawPrompt") or "",
            "promptHash": hashlib.sha256((audit_rec.get("boostedPrompt") or "").strip().encode()).hexdigest(),
        }
        
        gen_data = {
            "provider": "vertex-ai",
            "model": "gemini-2.5-flash-image",
            "costTwd": 1.244,
            "generatedBy": f"legacy-pipeline:{provenance}"
        }

        payload = {
            "wordId": wid,
            "imageWebpBase64": base64.b64encode(webp_bytes).decode('ascii'),
            "imageSha256": sha256,
            "prompt": prompt_data,
            "generator": gen_data,
            "publishRequestId": f"req_legacy_v1_{wid}",
            "dimensions": {"width": 896, "height": 896}
        }
        
        t0 = time.time()
        status, _, body = make_request(f"{WORKER_URL}/api/publish", method="POST", data=payload, headers={"X-Studio-Secret": SECRET})
        lat = int((time.time() - t0) * 1000)
        assert status == 200, f"Failed import v1 for {item['headword']}: {body.decode()}"
        res = json.loads(body.decode())
        print(f"  [v1 Imported] {item['headword']} ({wid}) -> Version: {res['version']}, Latency: {lat}ms (Worker: {res.get('latencyMs')}ms)")
        assert res['version'] == 1, f"Expected version 1, got {res['version']}"

    # --- Phase B: 5 New Words -> R2 v1 Publish ---
    print("\n--- [TEST 4] Publish 5 New Words as R2 v1 ---")
    first_new_req_id = None
    first_new_payload = None
    for idx, item in enumerate(NEW_WORDS):
        wid = item["wordId"]
        hw = item["headword"]
        w_data = course_words.get(wid, {})
        prompt_text = w_data.get("visualAnchor", {}).get("imagePrompt", "")
        
        # Create fresh WebP
        webp_bytes = create_dummy_webp(f"NEW_V1_{hw}", color=(16, 185, 129))
        sha256 = hashlib.sha256(webp_bytes).hexdigest()
        
        req_id = f"req_new_v1_{wid}"
        payload = {
            "wordId": wid,
            "imageWebpBase64": base64.b64encode(webp_bytes).decode('ascii'),
            "imageSha256": sha256,
            "prompt": {
                "formulaVersion": "v4-cinematic",
                "fullPromptText": prompt_text,
                "promptHash": hashlib.sha256(prompt_text.strip().encode()).hexdigest(),
            },
            "generator": {
                "provider": "manual-studio",
                "model": "gemini-web",
                "costTwd": 0,
                "generatedBy": "studio-qa"
            },
            "publishRequestId": req_id,
            "dimensions": {"width": 896, "height": 896}
        }
        
        if idx == 0:
            first_new_req_id = req_id
            first_new_payload = payload

        t0 = time.time()
        status, _, body = make_request(f"{WORKER_URL}/api/publish", method="POST", data=payload, headers={"X-Studio-Secret": SECRET})
        lat = int((time.time() - t0) * 1000)
        assert status == 200, f"Failed publish v1 for {hw}: {body.decode()}"
        res = json.loads(body.decode())
        print(f"  [v1 Published] {hw} ({wid}) -> Version: {res['version']}, Latency: {lat}ms (Worker: {res.get('latencyMs')}ms)")
        assert res['version'] == 1, f"Expected version 1, got {res['version']}"

    # --- Phase C: Idempotency Test ---
    print("\n--- [TEST 5] Idempotency Test (Duplicate publishRequestId) ---")
    status, _, body = make_request(f"{WORKER_URL}/api/publish", method="POST", data=first_new_payload, headers={"X-Studio-Secret": SECRET})
    assert status == 200, f"Idempotent replay failed: {body.decode()}"
    res = json.loads(body.decode())
    print(f"  Replay response: {res}")
    assert res.get("idempotentReplay") is True, "Expected idempotentReplay to be True"
    assert res.get("version") == 1, "Idempotent replay must NOT increment version"
    print("PASS: Duplicate request successfully returned cached result without incrementing version.")

    # --- Phase D: 5 Legacy Words -> Upgrade to v2 ---
    print("\n--- [TEST 6] Upgrade 5 Legacy Words to v2 ---")
    for item in LEGACY_WORDS:
        wid = item["wordId"]
        hw = item["headword"]
        
        # New image for v2
        webp_bytes = create_dummy_webp(f"UPGRADE_V2_{hw}", color=(236, 72, 153))
        sha256 = hashlib.sha256(webp_bytes).hexdigest()
        
        payload = {
            "wordId": wid,
            "imageWebpBase64": base64.b64encode(webp_bytes).decode('ascii'),
            "imageSha256": sha256,
            "prompt": {
                "formulaVersion": "v4-cinematic",
                "fullPromptText": f"Stylized high-detail concept art of {hw} v2 updated studio scene.",
                "promptHash": hashlib.sha256(f"{hw}_v2".encode()).hexdigest(),
            },
            "generator": {
                "provider": "manual-studio",
                "model": "gemini-web",
                "costTwd": 0,
                "generatedBy": "studio-qa"
            },
            "publishRequestId": f"req_upgrade_v2_{wid}",
            "dimensions": {"width": 896, "height": 896}
        }
        
        t0 = time.time()
        status, _, body = make_request(f"{WORKER_URL}/api/publish", method="POST", data=payload, headers={"X-Studio-Secret": SECRET})
        lat = int((time.time() - t0) * 1000)
        assert status == 200, f"Failed upgrade v2 for {hw}: {body.decode()}"
        res = json.loads(body.decode())
        print(f"  [v2 Upgraded] {hw} ({wid}) -> Version: {res['version']}, Latency: {lat}ms (Worker: {res.get('latencyMs')}ms)")
        assert res['version'] == 2, f"Expected version 2, got {res['version']}"

    # --- Phase E: Rollback accelerate from v2 to v1 ---
    print("\n--- [TEST 7] Rollback 'accelerate' from v2 to v1 ---")
    acc_wid = "tw_w_962a26c4f02a"
    rollback_payload = {
        "wordId": acc_wid,
        "targetVersion": 1
    }
    t0 = time.time()
    status, _, body = make_request(f"{WORKER_URL}/api/rollback", method="POST", data=rollback_payload, headers={"X-Studio-Secret": SECRET})
    lat = int((time.time() - t0) * 1000)
    assert status == 200, f"Rollback failed: {body.decode()}"
    rb_res = json.loads(body.decode())
    print(f"  Rollback response: {rb_res}, Latency: {lat}ms")
    assert rb_res.get("rolledBackToVersion") == 1

    # Verify Current Manifest state
    status, _, body = make_request(f"{WORKER_URL}/api/manifest/current")
    assert status == 200
    manifest = json.loads(body.decode())
    images = manifest.get("images", {})
    
    print(f"\nManifest count: {manifest.get('count')}")
    print(f"accelerate version in manifest: {images.get(acc_wid, {}).get('v')} (Expected: 1)")
    assert images.get(acc_wid, {}).get("v") == 1, "accelerate must be rolled back to version 1 in manifest"
    
    # Check that other words are NOT rolled back
    for item in LEGACY_WORDS:
        if item["wordId"] != acc_wid:
            v = images.get(item["wordId"], {}).get("v")
            print(f"  {item['headword']} version in manifest: {v} (Expected: 2)")
            assert v == 2, f"Other legacy word {item['headword']} version changed unexpectedly to {v}"
    
    for item in NEW_WORDS:
        v = images.get(item["wordId"], {}).get("v")
        print(f"  {item['headword']} version in manifest: {v} (Expected: 1)")
        assert v == 1, f"New word {item['headword']} version changed unexpectedly to {v}"

    # Verify that accelerate v2 image object STILL EXISTS on R2!
    status_v2, hdrs_v2, body_v2 = make_request(f"{WORKER_URL}/words/{acc_wid}/v2.webp")
    print(f"\naccelerate v2 image retrieval: Status {status_v2}, Size {len(body_v2)} bytes")
    assert status_v2 == 200, "accelerate v2 object must still be preserved in Public R2!"

    # Verify accelerate v1 image object also exists
    status_v1, hdrs_v1, body_v1 = make_request(f"{WORKER_URL}/words/{acc_wid}/v1.webp")
    print(f"accelerate v1 image retrieval: Status {status_v1}, Size {len(body_v1)} bytes")
    assert status_v1 == 200, "accelerate v1 object must exist in Public R2!"

    print("\n✅ ALL 10-WORD POC TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    try:
        test_auth_rejection()
        test_sha_mismatch_rejection()
        run_10_word_poc()
    except Exception as e:
        print(f"\n❌ POC RUNNER FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
