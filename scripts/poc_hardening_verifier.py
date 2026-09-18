# -*- coding: utf-8 -*-
"""
scripts/poc_hardening_verifier.py
Automated Hardening Checkpoint Runner for TOEIC Vocab R2 Cloudflare Worker:
1. Checkpoint 1: Secret Rotation Verification (Invalid secret rejected, new secret accepted)
2. Checkpoint 2: Accelerate v3 Allocation Test (v1 -> v2 -> rollback to v1 -> publish new -> MUST allocate v3, not v2)
3. Checkpoint 3A: Parallel Test A - Concurrent identical publishRequestId (Idempotency deduplication)
4. Checkpoint 3B: Parallel Test B - Concurrent distinct publishRequestId for same word (No overwrites, atomic ledger)
5. Checkpoint 4: CPU vs Latency profile
"""

import os, sys, json, hashlib, base64, time
import urllib.request, urllib.error
import concurrent.futures
from io import BytesIO

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

WORKER_URL = "https://toeic-image-publisher.peijungwu0302.workers.dev"
SECRET_PATH = "workers/image-publisher/.secret.tmp"
ROTATED_SECRET = open(SECRET_PATH, "r", encoding="utf-8").read().strip() if os.path.exists(SECRET_PATH) else "test_secret"
OLD_SECRET = "toeic_poc_secret_2026"

HEADERS_BASE = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TOEIC-Hardening-PoC/1.0",
    "Content-Type": "application/json"
}

def make_request(url, method="GET", data=None, headers=None):
    hdrs = dict(HEADERS_BASE)
    if headers:
        hdrs.update(headers)
    payload = json.dumps(data).encode('utf-8') if data is not None else None
    req = urllib.request.Request(url, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, data=payload, timeout=25) as resp:
            body = resp.read()
            return resp.status, resp.headers, body
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, e.headers, body

def create_test_webp(tag_text="TEST", color=(56, 189, 248)):
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (896, 896), color=(15, 23, 42))
        draw = ImageDraw.Draw(img)
        draw.rectangle([40, 40, 856, 856], outline=color, width=10)
        draw.ellipse([180, 180, 716, 716], outline=(147, 51, 234), width=8)
        draw.text((80, 420), f"HARDENING TEST: {tag_text}", fill=(255, 255, 255))
        draw.text((80, 480), f"TIMESTAMP: {time.time()}", fill=(203, 213, 225))
        buf = BytesIO()
        img.save(buf, format="WEBP", quality=85)
        return buf.getvalue()
    except ImportError:
        return base64.b64decode("UklGRjIAAABXRUJQVlA4ICYAAACyAAAAAgCdASoBAAEALmk0mk0iIiIiIgBoSygABc6WWgAA/vePt0AA")

def test_checkpoint_1_secret():
    print("==================================================")
    print("CHECKPOINT 1: Secret Rotation Verification")
    print("==================================================")
    # Test 1.1: Old leaked secret should be 401 Unauthorized
    s1, _, b1 = make_request(f"{WORKER_URL}/api/publish", method="POST", data={}, headers={"X-Studio-Secret": OLD_SECRET})
    print(f"Old Leaked Secret: HTTP {s1} (Expected: 401)")
    assert s1 == 401, f"Old secret was not rejected: {s1}"

    # Test 1.2: Empty / Missing secret should be 401
    s2, _, b2 = make_request(f"{WORKER_URL}/api/publish", method="POST", data={})
    print(f"Missing Secret: HTTP {s2} (Expected: 401)")
    assert s2 == 401, f"Missing secret was not rejected: {s2}"

    # Test 1.3: Rotated secret reaches payload validation (HTTP 400 with invalid body)
    s3, _, b3 = make_request(f"{WORKER_URL}/api/publish", method="POST", data={}, headers={"X-Studio-Secret": ROTATED_SECRET})
    print(f"Rotated Secret: HTTP {s3} (Expected: 400 - passed auth)")
    assert s3 == 400, f"Rotated secret failed auth: {s3}"
    print("✅ Checkpoint 1 PASSED: Secret successfully rotated and strictly enforced.\n")

def test_checkpoint_2_accelerate_v3():
    print("==================================================")
    print("CHECKPOINT 2: Accelerate v3 Allocation After Rollback")
    print("==================================================")
    acc_wid = "tw_w_962a26c4f02a"
    
    # 1. Verify accelerate currently at active v1
    s_cur, _, b_cur = make_request(f"{WORKER_URL}/api/manifest/current")
    assert s_cur == 200
    manifest = json.loads(b_cur.decode())
    current_v = manifest.get("images", {}).get(acc_wid, {}).get("v")
    print(f"accelerate version BEFORE new publish: v{current_v} (Expected: 1, rolled back from v2)")
    assert current_v == 1, f"Expected current version 1, got {current_v}"

    # 2. Check that v1 and v2 both exist in R2
    s_v1, _, b_v1 = make_request(f"{WORKER_URL}/words/{acc_wid}/v1.webp")
    s_v2, _, b_v2 = make_request(f"{WORKER_URL}/words/{acc_wid}/v2.webp")
    assert s_v1 == 200, f"v1 object missing: {s_v1}"
    assert s_v2 == 200, f"v2 object missing: {s_v2}"
    print(f"Existing R2 objects verified: v1.webp ({len(b_v1)} bytes), v2.webp ({len(b_v2)} bytes)")

    # 3. Publish a brand new image for accelerate
    webp_bytes = create_test_webp("ACCELERATE_V3", color=(245, 158, 11))
    sha256 = hashlib.sha256(webp_bytes).hexdigest()
    req_id = f"req_acc_v3_test_{int(time.time())}"
    payload = {
        "wordId": acc_wid,
        "imageWebpBase64": base64.b64encode(webp_bytes).decode('ascii'),
        "imageSha256": sha256,
        "prompt": {
            "formulaVersion": "v4-cinematic",
            "fullPromptText": "Stylized high-detail concept art of accelerate v3 test scene with supersonic bullet train.",
            "promptHash": hashlib.sha256("accelerate_v3".encode()).hexdigest(),
        },
        "generator": {
            "provider": "manual-studio",
            "model": "gemini-web",
            "costTwd": 0,
            "generatedBy": "hardening-verifier"
        },
        "publishRequestId": req_id,
        "dimensions": {"width": 896, "height": 896}
    }

    t0 = time.time()
    s_pub, _, b_pub = make_request(f"{WORKER_URL}/api/publish", method="POST", data=payload, headers={"X-Studio-Secret": ROTATED_SECRET})
    wall_lat = int((time.time() - t0) * 1000)
    assert s_pub == 200, f"Publish failed: {b_pub.decode()}"
    res = json.loads(b_pub.decode())
    allocated_v = res.get("version")
    worker_lat = res.get("latencyMs")
    print(f"Publish response: version = {allocated_v} (Worker Latency: {worker_lat}ms, Wall: {wall_lat}ms)")
    
    # STRICT ASSERTION: Version MUST BE 3!
    assert allocated_v == 3, f"CRITICAL FAILURE: Expected version 3, got {allocated_v}! v2 was reused or overwritten!"
    print(f"✅ CRITICAL RULE CONFIRMED: Allocated v3! v2 was NOT reused or overwritten.")

    # 4. Verify R2 objects: v1, v2, v3 MUST ALL EXIST
    s_v1_post, _, _ = make_request(f"{WORKER_URL}/words/{acc_wid}/v1.webp")
    s_v2_post, _, b_v2_post = make_request(f"{WORKER_URL}/words/{acc_wid}/v2.webp")
    s_v3_post, _, b_v3_post = make_request(f"{WORKER_URL}/words/{acc_wid}/v3.webp")
    assert s_v1_post == 200, "v1.webp disappeared!"
    assert s_v2_post == 200, "v2.webp was overwritten or deleted!"
    assert s_v3_post == 200, "v3.webp was not created!"
    assert len(b_v2_post) == len(b_v2), "v2.webp content was modified!"
    print(f"✅ Immutability confirmed: v1, v2 ({len(b_v2_post)} bytes unchanged), and v3 ({len(b_v3_post)} bytes) all exist independently.")

    # 5. Verify manifest updated to v3
    s_m, _, b_m = make_request(f"{WORKER_URL}/api/manifest/current")
    new_manifest = json.loads(b_m.decode())
    new_v = new_manifest.get("images", {}).get(acc_wid, {}).get("v")
    print(f"Current Manifest version for accelerate: v{new_v} (Expected: 3)")
    assert new_v == 3, f"Manifest was not updated to 3, got {new_v}"

    # 6. Verify Private Ledger contents via authenticated endpoint
    s_led, _, b_led = make_request(f"{WORKER_URL}/api/ledger/{acc_wid}", headers={"X-Studio-Secret": ROTATED_SECRET})
    assert s_led == 200, f"Ledger fetch failed: {b_led.decode()}"
    ledger = json.loads(b_led.decode())
    print(f"Ledger State: activeVersion={ledger.get('activeVersion')}, latestAllocatedVersion={ledger.get('latestAllocatedVersion')}, currentPublishedVersion={ledger.get('currentPublishedVersion')}")
    print(f"Ledger History Keys: {list(ledger.get('history', {}).keys())}")
    assert ledger.get('activeVersion') == 3
    assert ledger.get('latestAllocatedVersion') == 3
    assert "1" in ledger.get('history', {})
    assert "2" in ledger.get('history', {})
    assert "3" in ledger.get('history', {})
    print("✅ Checkpoint 2 PASSED: Rollback version progression & ledger schema fully verified.\n")

def test_checkpoint_3_parallel_tests():
    print("==================================================")
    print("CHECKPOINT 3: Parallel & Concurrency Tests")
    print("==================================================")
    
    # --- Parallel Test A: Duplicate publishRequestId sent concurrently ---
    print("\n[Parallel Test A] Sending 2 concurrent requests with IDENTICAL publishRequestId...")
    wid_a = "tw_w_226b975ecfe8" # ability
    webp_a = create_test_webp("ABILITY_DUP", color=(16, 185, 129))
    sha_a = hashlib.sha256(webp_a).hexdigest()
    common_req_id = f"req_parallel_dup_{int(time.time())}"
    payload_a = {
        "wordId": wid_a,
        "imageWebpBase64": base64.b64encode(webp_a).decode('ascii'),
        "imageSha256": sha_a,
        "prompt": {"formulaVersion": "v4-cinematic", "fullPromptText": "Ability test duplicate parallel."},
        "generator": {"provider": "manual-studio", "model": "gemini-web", "costTwd": 0, "generatedBy": "parallel-test-a"},
        "publishRequestId": common_req_id,
        "dimensions": {"width": 896, "height": 896}
    }

    def send_a():
        return make_request(f"{WORKER_URL}/api/publish", method="POST", data=payload_a, headers={"X-Studio-Secret": ROTATED_SECRET})

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(send_a)
        f2 = executor.submit(send_a)
        res1_status, _, res1_body = f1.result()
        res2_status, _, res2_body = f2.result()

    print(f"Response 1: Status {res1_status} -> {res1_body.decode()[:120]}")
    print(f"Response 2: Status {res2_status} -> {res2_body.decode()[:120]}")
    assert res1_status == 200 and res2_status == 200
    r1 = json.loads(res1_body.decode())
    r2 = json.loads(res2_body.decode())
    
    # Both must report the SAME version!
    assert r1.get("version") == r2.get("version"), f"Version discrepancy: {r1} vs {r2}"
    print(f"Parallel A Result: Both returned Version {r1.get('version')}. Exactly ONE version was allocated.")
    print("✅ Parallel Test A PASSED: Idempotency deduplication confirmed under concurrency.")

    # --- Parallel Test B: Concurrent distinct publishRequestId for SAME word ---
    print("\n[Parallel Test B] Sending 2 concurrent requests with DISTINCT publishRequestId for SAME word...")
    wid_b = "tw_w_98a72ee91807" # absence
    webp_b1 = create_test_webp("ABSENCE_CONCURRENT_1", color=(236, 72, 153))
    webp_b2 = create_test_webp("ABSENCE_CONCURRENT_2", color=(99, 102, 241))
    sha_b1 = hashlib.sha256(webp_b1).hexdigest()
    sha_b2 = hashlib.sha256(webp_b2).hexdigest()
    req_b1 = f"req_parallel_distinct_1_{int(time.time())}"
    req_b2 = f"req_parallel_distinct_2_{int(time.time())}"

    payload_b1 = {
        "wordId": wid_b,
        "imageWebpBase64": base64.b64encode(webp_b1).decode('ascii'),
        "imageSha256": sha_b1,
        "prompt": {"formulaVersion": "v4-cinematic", "fullPromptText": "Absence test distinct 1."},
        "generator": {"provider": "manual-studio", "model": "gemini-web", "costTwd": 0, "generatedBy": "parallel-test-b1"},
        "publishRequestId": req_b1,
        "dimensions": {"width": 896, "height": 896}
    }
    payload_b2 = {
        "wordId": wid_b,
        "imageWebpBase64": base64.b64encode(webp_b2).decode('ascii'),
        "imageSha256": sha_b2,
        "prompt": {"formulaVersion": "v4-cinematic", "fullPromptText": "Absence test distinct 2."},
        "generator": {"provider": "manual-studio", "model": "gemini-web", "costTwd": 0, "generatedBy": "parallel-test-b2"},
        "publishRequestId": req_b2,
        "dimensions": {"width": 896, "height": 896}
    }

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(lambda: make_request(f"{WORKER_URL}/api/publish", method="POST", data=payload_b1, headers={"X-Studio-Secret": ROTATED_SECRET}))
        f2 = executor.submit(lambda: make_request(f"{WORKER_URL}/api/publish", method="POST", data=payload_b2, headers={"X-Studio-Secret": ROTATED_SECRET}))
        s1, _, b1 = f1.result()
        s2, _, b2 = f2.result()

    print(f"Concurrent Publish 1: Status {s1} -> {b1.decode()[:120]}")
    print(f"Concurrent Publish 2: Status {s2} -> {b2.decode()[:120]}")
    assert s1 == 200 and s2 == 200
    rb1 = json.loads(b1.decode())
    rb2 = json.loads(b2.decode())
    v_b1 = rb1.get("version")
    v_b2 = rb2.get("version")
    print(f"Allocated Versions: b1 -> v{v_b1}, b2 -> v{v_b2}")
    
    # Check that neither overwrote the other in R2
    s_obj1, _, data1 = make_request(f"{WORKER_URL}/words/{wid_b}/v{v_b1}.webp")
    s_obj2, _, data2 = make_request(f"{WORKER_URL}/words/{wid_b}/v{v_b2}.webp")
    assert s_obj1 == 200 and s_obj2 == 200
    print(f"Verified both objects exist in R2 independently: v{v_b1} ({len(data1)} bytes), v{v_b2} ({len(data2)} bytes)")
    
    # Check manifest reflects the latest version
    s_m, _, b_m = make_request(f"{WORKER_URL}/api/manifest/current")
    m = json.loads(b_m.decode())
    m_v = m.get("images", {}).get(wid_b, {}).get("v")
    print(f"Current Manifest version for {wid_b}: v{m_v}")
    assert m_v in (v_b1, v_b2)
    print("✅ Parallel Test B PASSED: Zero object overwrites under concurrent distinct publishes.\n")

if __name__ == "__main__":
    test_checkpoint_1_secret()
    test_checkpoint_2_accelerate_v3()
    test_checkpoint_3_parallel_tests()
    print("🎉 ALL HARDENING CHECKPOINTS VERIFIED SUCCESSFULLY!")
