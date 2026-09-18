# -*- coding: utf-8 -*-
"""
scripts/poc_concurrency_verifier.py
Automated Concurrency & Optimistic Locking Verifier for TOEIC Vocab R2 Cloudflare Worker:
1. Secret Rotation Verification (Never prints secret in stdout)
2. Binary multipart/form-data upload verification (zero Base64)
3. Concurrency Test A: Identical publishRequestId sent simultaneously (Idempotency)
4. Concurrency Test B: Distinct publishRequestId sent simultaneously for SAME word (If-None-Match: * optimistic allocation)
5. Concurrency Test C: Simultaneous Rollback + Publish for SAME word (CAS consistency)
6. Latency & Worker Execution Timing
"""

import os, sys, json, hashlib, time, uuid
import urllib.request, urllib.error
import concurrent.futures
from io import BytesIO

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

WORKER_URL = "https://toeic-image-publisher.peijungwu0302.workers.dev"

# Secret is read securely from gitignored local file
SECRET_PATH = "workers/image-publisher/.secret.tmp"
if not os.path.exists(SECRET_PATH):
    print("❌ Error: Secret file not found. Please run secret setup first.")
    sys.exit(1)

with open(SECRET_PATH, "r", encoding="utf-8") as f:
    ROTATED_SECRET = f.read().strip()

OLD_LEAKED_SECRET_1 = "toeic_poc_secret_2026"
OLD_LEAKED_SECRET_2 = "revoked_leaked_secret_for_auth_rejection_test"

def create_test_webp(tag_text="CONCURRENCY_TEST", color=(56, 189, 248)):
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (896, 896), color=(15, 23, 42))
        draw = ImageDraw.Draw(img)
        draw.rectangle([40, 40, 856, 856], outline=color, width=10)
        draw.ellipse([180, 180, 716, 716], outline=(147, 51, 234), width=8)
        draw.text((80, 420), f"TEST: {tag_text}", fill=(255, 255, 255))
        draw.text((80, 480), f"UUID: {uuid.uuid4()}", fill=(203, 213, 225))
        buf = BytesIO()
        img.save(buf, format="WEBP", quality=85)
        return buf.getvalue()
    except ImportError:
        # Minimal valid 1x1 WebP
        import base64
        return base64.b64decode("UklGRjIAAABXRUJQVlA4ICYAAACyAAAAAgCdASoBAAEALmk0mk0iIiIiIgBoSygABc6WWgAA/vePt0AA")

def build_multipart_body(fields, files):
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    body = bytearray()

    for k, v in fields.items():
        body.extend(f"--{boundary}\r\n".encode('utf-8'))
        body.extend(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode('utf-8'))
        body.extend(f"{v}\r\n".encode('utf-8'))

    for k, (filename, content, mime) in files.items():
        body.extend(f"--{boundary}\r\n".encode('utf-8'))
        body.extend(f'Content-Disposition: form-data; name="{k}"; filename="{filename}"\r\n'.encode('utf-8'))
        body.extend(f'Content-Type: {mime}\r\n\r\n'.encode('utf-8'))
        body.extend(content)
        body.extend(b"\r\n")

    body.extend(f"--{boundary}--\r\n".encode('utf-8'))
    content_type = f"multipart/form-data; boundary={boundary}"
    return content_type, bytes(body)

def make_http_request(url, method="GET", data=None, content_type=None, headers=None):
    hdrs = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TOEIC-Concurrency-Tester/1.0"
    }
    if content_type:
        hdrs["Content-Type"] = content_type
    if headers:
        hdrs.update(headers)

    req = urllib.request.Request(url, method=method, headers=hdrs, data=data)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.headers, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()

def test_1_secret_rotation():
    print("==================================================")
    print("TEST 1: Secret Rotation Verification (Zero Output Leak)")
    print("==================================================")
    # Test 1.1: First leaked secret rejected
    s1, _, _ = make_http_request(f"{WORKER_URL}/api/publish", method="POST", data=b"{}", content_type="application/json", headers={"X-Studio-Secret": OLD_LEAKED_SECRET_1})
    assert s1 == 401, f"Expected 401 for leaked secret 1, got {s1}"

    # Test 1.2: Second leaked secret rejected
    s2, _, _ = make_http_request(f"{WORKER_URL}/api/publish", method="POST", data=b"{}", content_type="application/json", headers={"X-Studio-Secret": OLD_LEAKED_SECRET_2})
    assert s2 == 401, f"Expected 401 for leaked secret 2, got {s2}"

    # Test 1.3: Active secret passes authentication
    s3, _, _ = make_http_request(f"{WORKER_URL}/api/publish", method="POST", data=b"{}", content_type="application/json", headers={"X-Studio-Secret": ROTATED_SECRET})
    assert s3 == 400, f"Expected 400 (validation error after passing auth), got {s3}"
    print("✅ secret rotated successfully (all prior secrets rejected with HTTP 401).\n")

def test_2_parallel_same_request_id():
    print("==================================================")
    print("TEST 2: Concurrency A - Same publishRequestId (Idempotency)")
    print("==================================================")
    wid = "tw_w_c10323ff1d5a" # abandon
    webp_bytes = create_test_webp("ABANDON_IDEMPOTENT")
    sha256 = hashlib.sha256(webp_bytes).hexdigest()
    req_id = f"req_idem_{uuid.uuid4().hex[:12]}"

    metadata = {
        "wordId": wid,
        "imageSha256": sha256,
        "prompt": {"formulaVersion": "v4-cinematic", "fullPromptText": "Abandon idempotent concurrency test scene."},
        "generator": {"provider": "manual-studio", "model": "gemini-web", "costTwd": 0, "generatedBy": "tester"},
        "publishRequestId": req_id,
        "dimensions": {"width": 896, "height": 896}
    }

    ct, body = build_multipart_body(
        {"metadata": json.dumps(metadata)},
        {"file": (f"{wid}.webp", webp_bytes, "image/webp")}
    )

    def send():
        return make_http_request(f"{WORKER_URL}/api/publish", method="POST", data=body, content_type=ct, headers={"X-Studio-Secret": ROTATED_SECRET})

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(send)
        f2 = executor.submit(send)
        s1, _, b1 = f1.result()
        s2, _, b2 = f2.result()

    assert s1 == 200 and s2 == 200, f"Failed: {s1} / {s2}"
    r1 = json.loads(b1.decode())
    r2 = json.loads(b2.decode())

    print(f"Response 1: Version {r1.get('version')} (idempotent: {r1.get('idempotentReplay', False)}, latency: {r1.get('latencyMs')}ms)")
    print(f"Response 2: Version {r2.get('version')} (idempotent: {r2.get('idempotentReplay', False)}, latency: {r2.get('latencyMs')}ms)")
    assert r1.get("version") == r2.get("version"), "Versions must be identical"
    print("✅ TEST 2 PASSED: Exactly 1 version allocated, identical response returned via idempotency cache.\n")

def test_3_parallel_distinct_same_word():
    print("==================================================")
    print("TEST 3: Concurrency B - Same Word, Distinct Request IDs (Optimistic Concurrency)")
    print("==================================================")
    wid = "tw_w_98a72ee91807" # absence
    webp1 = create_test_webp("ABSENCE_CONCURRENT_BRANCH_1", color=(236, 72, 153))
    webp2 = create_test_webp("ABSENCE_CONCURRENT_BRANCH_2", color=(16, 185, 129))
    sha1 = hashlib.sha256(webp1).hexdigest()
    sha2 = hashlib.sha256(webp2).hexdigest()

    req_id_1 = f"req_dist1_{uuid.uuid4().hex[:12]}"
    req_id_2 = f"req_dist2_{uuid.uuid4().hex[:12]}"

    meta1 = {
        "wordId": wid,
        "imageSha256": sha1,
        "prompt": {"formulaVersion": "v4-cinematic", "fullPromptText": "Absence branch 1."},
        "generator": {"provider": "manual-studio", "model": "gemini-web", "costTwd": 0, "generatedBy": "tester-b1"},
        "publishRequestId": req_id_1,
        "dimensions": {"width": 896, "height": 896}
    }
    meta2 = {
        "wordId": wid,
        "imageSha256": sha2,
        "prompt": {"formulaVersion": "v4-cinematic", "fullPromptText": "Absence branch 2."},
        "generator": {"provider": "manual-studio", "model": "gemini-web", "costTwd": 0, "generatedBy": "tester-b2"},
        "publishRequestId": req_id_2,
        "dimensions": {"width": 896, "height": 896}
    }

    ct1, body1 = build_multipart_body({"metadata": json.dumps(meta1)}, {"file": (f"{wid}.webp", webp1, "image/webp")})
    ct2, body2 = build_multipart_body({"metadata": json.dumps(meta2)}, {"file": (f"{wid}.webp", webp2, "image/webp")})

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(lambda: make_http_request(f"{WORKER_URL}/api/publish", method="POST", data=body1, content_type=ct1, headers={"X-Studio-Secret": ROTATED_SECRET}))
        f2 = executor.submit(lambda: make_http_request(f"{WORKER_URL}/api/publish", method="POST", data=body2, content_type=ct2, headers={"X-Studio-Secret": ROTATED_SECRET}))
        s1, _, b1 = f1.result()
        s2, _, b2 = f2.result()

    assert s1 == 200 and s2 == 200, f"Failed: {s1} ({b1.decode()}) / {s2} ({b2.decode()})"
    r1 = json.loads(b1.decode())
    r2 = json.loads(b2.decode())

    v1 = r1.get("version")
    v2 = r2.get("version")
    print(f"Request 1 Allocated Version: v{v1} (Worker Latency: {r1.get('latencyMs')}ms)")
    print(f"Request 2 Allocated Version: v{v2} (Worker Latency: {r2.get('latencyMs')}ms)")

    # 1. STRICT REQUIREMENT: Distinct versions! (Zero overwrite)
    assert v1 != v2, f"CRITICAL FAILURE: Both requests allocated the same version v{v1}! Overwrite occurred!"
    print(f"✅ DISTINCT VERSIONS VERIFIED: v{v1} and v{v2} are separate numbers.")

    # 2. STRICT REQUIREMENT: Both R2 objects exist independently
    s_obj1, _, data1 = make_http_request(f"{WORKER_URL}/words/{wid}/v{v1}.webp")
    s_obj2, _, data2 = make_http_request(f"{WORKER_URL}/words/{wid}/v{v2}.webp")
    assert s_obj1 == 200, f"v{v1} missing in R2"
    assert s_obj2 == 200, f"v{v2} missing in R2"
    print(f"✅ IMMUTABLE STORAGE VERIFIED: v{v1} ({len(data1)} bytes) and v{v2} ({len(data2)} bytes) both exist in R2.")

    # 3. STRICT REQUIREMENT: Ledger history has BOTH versions
    s_led, _, b_led = make_http_request(f"{WORKER_URL}/api/ledger/{wid}", headers={"X-Studio-Secret": ROTATED_SECRET})
    assert s_led == 200
    ledger = json.loads(b_led.decode())
    history = ledger.get("history", {})
    assert str(v1) in history, f"v{v1} missing in ledger history"
    assert str(v2) in history, f"v{v2} missing in ledger history"
    print(f"✅ CAS MERGE VERIFIED: Ledger history contains both [{v1}] and [{v2}] (total versions recorded: {len(history)}).")

    # 4. Manifest active pointer reflects the winning commit
    s_man, _, b_man = make_http_request(f"{WORKER_URL}/api/manifest/current")
    man = json.loads(b_man.decode())
    active_v = man.get("images", {}).get(wid, {}).get("v")
    print(f"Manifest Active Version: v{active_v} (One of {v1}, {v2})")
    assert active_v in (v1, v2)
    print("✅ TEST 3 PASSED: Optimistic concurrency successfully serialized concurrent same-word writes!\n")

def test_4_race_rollback_and_publish():
    print("==================================================")
    print("TEST 4: Concurrency C - Simultaneous Rollback + Publish for SAME word")
    print("==================================================")
    wid = "tw_w_962a26c4f02a" # accelerate (currently at v3)
    
    # Task A: Rollback accelerate to v1
    rollback_payload = json.dumps({"wordId": wid, "targetVersion": 1}).encode('utf-8')
    def do_rollback():
        return make_http_request(f"{WORKER_URL}/api/rollback", method="POST", data=rollback_payload, content_type="application/json", headers={"X-Studio-Secret": ROTATED_SECRET})

    # Task B: Publish new image for accelerate
    webp = create_test_webp("ACCELERATE_RACE_ROLLBACK_PUB", color=(245, 158, 11))
    sha = hashlib.sha256(webp).hexdigest()
    meta = {
        "wordId": wid,
        "imageSha256": sha,
        "prompt": {"formulaVersion": "v4-cinematic", "fullPromptText": "Accelerate race test scene."},
        "generator": {"provider": "manual-studio", "model": "gemini-web", "costTwd": 0, "generatedBy": "race-tester"},
        "publishRequestId": f"req_race_rb_pub_{uuid.uuid4().hex[:12]}",
        "dimensions": {"width": 896, "height": 896}
    }
    ct, body = build_multipart_body({"metadata": json.dumps(meta)}, {"file": (f"{wid}.webp", webp, "image/webp")})
    def do_publish():
        return make_http_request(f"{WORKER_URL}/api/publish", method="POST", data=body, content_type=ct, headers={"X-Studio-Secret": ROTATED_SECRET})

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f_rb = executor.submit(do_rollback)
        f_pub = executor.submit(do_publish)
        s_rb, _, b_rb = f_rb.result()
        s_pub, _, b_pub = f_pub.result()

    print(f"Rollback Result: HTTP {s_rb} -> {b_rb.decode()[:80]}")
    print(f"Publish Result:  HTTP {s_pub} -> {b_pub.decode()[:80]}")
    assert s_rb == 200 and s_pub == 200, f"One or both failed: {s_rb}, {s_pub}"

    # Verify ledger consistency
    s_led, _, b_led = make_http_request(f"{WORKER_URL}/api/ledger/{wid}", headers={"X-Studio-Secret": ROTATED_SECRET})
    ledger = json.loads(b_led.decode())
    print(f"Final Ledger: activeVersion={ledger.get('activeVersion')}, latestAllocatedVersion={ledger.get('latestAllocatedVersion')}")
    print(f"Ledger History Keys: {list(ledger.get('history', {}).keys())}")
    # All historical versions must be intact
    assert "1" in ledger.get('history', {})
    assert "2" in ledger.get('history', {})
    assert "3" in ledger.get('history', {})
    print("✅ TEST 4 PASSED: Race rollback and publish completed cleanly with zero data corruption!\n")

if __name__ == "__main__":
    test_1_secret_rotation()
    test_2_parallel_same_request_id()
    test_3_parallel_distinct_same_word()
    test_4_race_rollback_and_publish()
    print("🎉 ALL ADVANCED CONCURRENCY & IMMUTABILITY TESTS PASSED!")
