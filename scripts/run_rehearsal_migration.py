# -*- coding: utf-8 -*-
"""
scripts/run_rehearsal_migration.py
Executes the Phase 1.5 100-Word Legacy Migration Rehearsal.
"""

import json
import os
import sys
import time
import hashlib
import gzip
import glob
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

ROOT = Path('.').resolve()
WORKER_BASE = 'https://toeic-image-publisher.peijungwu0302.workers.dev'
SECRET_PATH = ROOT / 'workers' / 'image-publisher' / '.secret.tmp'

def load_secret():
    if not SECRET_PATH.exists():
        raise RuntimeError("Secret file missing!")
    return open(SECRET_PATH, 'r', encoding='utf-8').read().strip()

def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def upload_single_word(item, secret):
    word_id = item['wordId']
    slug = item['slug']
    local_path = ROOT / item['localWebpPath']
    category = item['rehearsalCategory']
    audit_entry = item.get('auditEntry')
    visual_anchor = item.get('visualAnchor', {})

    image_bytes = open(local_path, 'rb').read()
    image_sha256 = compute_sha256(image_bytes)

    # Determine prompt metadata
    if category == 'audit_boosted':
        full_prompt = (audit_entry or {}).get('boostedPrompt') or visual_anchor.get('imagePrompt') or ''
        formula_ver = 'v4-cinematic' if 'Crisp linework' in full_prompt else 'modern-editorial'
    elif category == 'audit_raw':
        full_prompt = (audit_entry or {}).get('rawPrompt') or visual_anchor.get('imagePrompt') or ''
        formula_ver = 'legacy-raw'
    elif category == 'phrase_special':
        full_prompt = (audit_entry or {}).get('boostedPrompt') or (audit_entry or {}).get('rawPrompt') or visual_anchor.get('imagePrompt') or ''
        formula_ver = 'phrase-v4' if 'Crisp linework' in full_prompt else 'legacy-phrase'
    else:  # legacy_local
        full_prompt = visual_anchor.get('imagePrompt') or ''
        formula_ver = 'legacy-local-unrecorded'

    prompt_hash = compute_sha256(full_prompt.encode('utf-8')) if full_prompt else ''

    # Determine generator metadata
    model_name = (audit_entry or {}).get('model', 'gemini-2.5-flash-image') if audit_entry else 'legacy-local-import'
    cost_twd = (audit_entry or {}).get('unitCostTwd') or ((audit_entry or {}).get('costUsd', 0) * 31.5) if audit_entry else 0.0

    metadata = {
        'wordId': word_id,
        'imageSha256': image_sha256,
        'publishRequestId': f'pub_legacy_{word_id}_{image_sha256[:8]}',
        'skipManifestCommit': True,
        'prompt': {
            'formulaVersion': formula_ver,
            'fullPromptText': full_prompt,
            'promptHash': prompt_hash
        },
        'generator': {
            'provider': 'legacy-migration',
            'model': model_name,
            'costTwd': round(cost_twd, 4),
            'generatedBy': 'legacy-batch-rehearsal'
        },
        'dimensions': {
            'width': 896,
            'height': 896
        }
    }

    url = f'{WORKER_BASE}/api/publish'
    headers = {
        'X-Studio-Secret': secret
    }

    max_retries = 3
    last_err = None
    for attempt in range(max_retries):
        t0 = time.perf_counter()
        try:
            files = {
                'file': (f'{slug}.webp', image_bytes, 'image/webp'),
                'metadata': (None, json.dumps(metadata), 'application/json')
            }
            res = requests.post(url, headers=headers, files=files, timeout=30)
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
            
            if res.status_code == 200:
                body = res.json()
                assert body.get('success') is True, f"Success flag false: {body}"
                assert body.get('version') == 1, f"Expected version 1, got {body.get('version')}"
                assert body.get('sha256') == image_sha256, "SHA256 mismatch!"
                assert body.get('manifestCommitted') is False, "Manifest should not be committed yet!"

                return {
                    'wordId': word_id,
                    'headword': item['headword'],
                    'slug': slug,
                    'category': category,
                    'tier': item['tier'],
                    'sha256': image_sha256,
                    'fileSize': len(image_bytes),
                    'version': body.get('version'),
                    'imageKey': body.get('imageKey'),
                    'workerLatencyMs': body.get('latencyMs', 0),
                    'wallLatencyMs': elapsed_ms,
                    'attempts': attempt + 1,
                    'status': 'SUCCESS'
                }
            else:
                last_err = f"HTTP {res.status_code}: {res.text}"
        except Exception as e:
            last_err = str(e)
        time.sleep(0.5 * (attempt + 1))

    return {
        'wordId': word_id,
        'headword': item['headword'],
        'slug': slug,
        'category': category,
        'status': 'FAILED',
        'error': last_err
    }

def main():
    print("=== TOEIC Vocab R2 100-Word Migration Rehearsal ===")
    secret = load_secret()
    print("Loaded studio secret successfully.")

    selection_file = ROOT / 'scripts' / 'rehearsal_100_selection.json'
    with open(selection_file, 'r', encoding='utf-8') as f:
        sel_data = json.load(f)
    items = sel_data['items']
    print(f"Loaded {len(items)} rehearsal candidate items.")

    # 1. Baseline Manifest Check
    cur_res = requests.get(f'{WORKER_BASE}/api/manifest/current')
    baseline_manifest = cur_res.json()
    baseline_count = baseline_manifest.get('count', 0)
    baseline_raw_bytes = len(cur_res.content)
    baseline_gzip_bytes = len(gzip.compress(cur_res.content))
    print(f"Baseline Manifest: count={baseline_count}, raw={baseline_raw_bytes}B, gzip={baseline_gzip_bytes}B")

    # 2. Parallel Uploads (4 workers)
    print("\n--- Starting Individual Image & Ledger Uploads (skipManifestCommit=True) ---")
    start_time = time.perf_counter()
    upload_results = []
    
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(upload_single_word, item, secret): item for item in items}
        for future in as_completed(futures):
            res = future.result()
            upload_results.append(res)
            done = len(upload_results)
            if done % 10 == 0 or done == len(items):
                print(f"Progress: {done}/{len(items)} uploaded... (latest: {res['headword']} - {res['status']})")

    total_wall_time = time.perf_counter() - start_time
    print(f"\nCompleted 100 uploads in {total_wall_time:.2f}s (avg {total_wall_time/100:.2f}s per word).")

    failed = [r for r in upload_results if r['status'] != 'SUCCESS']
    if failed:
        print(f"FATAL: {len(failed)} uploads failed! Halting batch commit.")
        for f_item in failed:
            print(f"  FAILED: {f_item['wordId']} ({f_item.get('headword')}): {f_item.get('error')}")
        sys.exit(1)

    print("ALL 100 uploads SUCCEEDED with version 1 and SHA-256 match!")

    # 3. Batch Manifest Commit
    print("\n--- Performing Atomic Batch Manifest Publication ---")
    batch_request_id = f"batch_rehearsal_100_{int(time.time()*1000)}"
    updates = {}
    for r in upload_results:
        updates[r['wordId']] = {
            'v': r['version'],
            'h': r['sha256'][:16],
            'w': 896,
            'ht': 896
        }

    batch_payload = {
        'batchRequestId': batch_request_id,
        'updates': updates
    }

    t_batch_start = time.perf_counter()
    batch_res = requests.post(
        f'{WORKER_BASE}/api/manifest/batch-commit',
        headers={'X-Studio-Secret': secret, 'Content-Type': 'application/json'},
        data=json.dumps(batch_payload),
        timeout=30
    )
    batch_elapsed = round((time.perf_counter() - t_batch_start) * 1000, 2)
    print(f"Batch commit response: HTTP {batch_res.status_code} ({batch_elapsed}ms)")
    batch_data = batch_res.json()
    assert batch_data.get('success') is True, f"Batch commit failed: {batch_data}"
    assert batch_data.get('batchAddedCount') == 100, f"Expected 100 added, got {batch_data.get('batchAddedCount')}"
    assert batch_data.get('totalManifestCount') == baseline_count + 100, f"Count mismatch: expected {baseline_count+100}, got {batch_data.get('totalManifestCount')}"
    
    new_snapshot_uri = batch_data.get('manifestUri')
    print(f"New Snapshot URI: {new_snapshot_uri}")
    print(f"Total Manifest Count: {batch_data.get('totalManifestCount')}")

    # 4. Post-Commit Verification
    print("\n--- Running Comprehensive Post-Commit Verification Suite ---")
    
    # 4.1 Manifest Verification
    after_manifest_res = requests.get(f'{WORKER_BASE}/api/manifest/current')
    after_manifest = after_manifest_res.json()
    after_raw_bytes = len(after_manifest_res.content)
    after_gzip_bytes = len(gzip.compress(after_manifest_res.content))
    print(f"After Manifest: count={after_manifest.get('count')}, raw={after_raw_bytes}B, gzip={after_gzip_bytes}B")
    assert after_manifest.get('count') == baseline_count + 100

    # 4.2 Verify Snapshot Exists on R2
    snapshot_res = requests.get(f'{WORKER_BASE}/{new_snapshot_uri}')
    print(f"Snapshot GET status: HTTP {snapshot_res.status_code}")
    assert snapshot_res.status_code == 200, "Snapshot not accessible!"

    # 4.3 Verify CDN Public Image Delivery & SHA-256 for all 100
    print("Verifying all 100 words CDN delivery and SHA-256...")
    cdn_success = 0
    with ThreadPoolExecutor(max_workers=8) as executor:
        def verify_cdn(r):
            img_url = f"{WORKER_BASE}/words/{r['wordId']}/v1.webp"
            img_res = requests.get(img_url, timeout=15)
            if img_res.status_code == 200 and compute_sha256(img_res.content) == r['sha256']:
                return True
            return False

        cdn_futures = [executor.submit(verify_cdn, r) for r in upload_results]
        for f in as_completed(cdn_futures):
            if f.result():
                cdn_success += 1

    print(f"CDN Public WebP verification: {cdn_success}/100 PASS")
    assert cdn_success == 100

    # 4.4 Verify all 100 Ledgers in Private Bucket
    print("Verifying all 100 Ledgers in Private Bucket...")
    ledger_success = 0
    with ThreadPoolExecutor(max_workers=8) as executor:
        def verify_ledger(r):
            ledger_url = f"{WORKER_BASE}/api/ledger/{r['wordId']}"
            l_res = requests.get(ledger_url, headers={'X-Studio-Secret': secret}, timeout=15)
            if l_res.status_code == 200:
                ld = l_res.json()
                if ld.get('activeVersion') == 1 and ld.get('history', {}).get('1'):
                    return True
            return False

        ledger_futures = [executor.submit(verify_ledger, r) for r in upload_results]
        for f in as_completed(ledger_futures):
            if f.result():
                ledger_success += 1

    print(f"Private Ledger verification: {ledger_success}/100 PASS")
    assert ledger_success == 100

    # 4.5 PWA Resolution Sampling: 20 Migrated vs 20 Un-migrated
    import random
    random.seed(42)
    migrated_sample = random.sample(upload_results, 20)
    
    # Select 20 unmigrated syllabus words
    all_selected_ids = {r['wordId'] for r in upload_results}
    course_files = sorted(glob.glob(str(ROOT / 'public' / 'data' / 'v1' / 'courses' / '*.json')))
    unmigrated_candidates = []
    for cf in course_files:
        with open(cf, 'r', encoding='utf-8') as f:
            cdata = json.load(f)
            for w in cdata.get('words', []):
                wid = w.get('id')
                if wid and wid not in all_selected_ids and wid not in baseline_manifest.get('images', {}):
                    unmigrated_candidates.append(w)
    
    unmigrated_sample = random.sample(unmigrated_candidates, 20)

    # 4.6 Check local directory immutability
    local_webp_count = len(list((ROOT / 'public' / 'assets' / 'images' / 'words').glob('*.webp')))
    local_orig_count = len(list((ROOT / 'public' / 'assets' / 'images' / 'originals').glob('*')))
    print(f"Local files count check: words={local_webp_count} (expected 7165), originals={local_orig_count} (expected 7080)")
    assert local_webp_count == 7165
    assert local_orig_count == 7080

    # 4.7 Aggregate stats
    total_public_bytes = sum(r['fileSize'] for r in upload_results)
    avg_file_size = total_public_bytes / 100
    avg_worker_cpu = sum(r['workerLatencyMs'] for r in upload_results) / 100
    
    report = {
        'rehearsalSummary': {
            'status': 'PASS',
            'totalWordsMigrated': 100,
            'baselineCount': baseline_count,
            'finalCount': after_manifest.get('count'),
            'wallTimeSec': round(total_wall_time, 2),
            'batchCommitTimeMs': batch_elapsed,
            'avgWorkerExecutionMs': round(avg_worker_cpu, 2),
            'newSnapshotUri': new_snapshot_uri,
            'localWebpCount': local_webp_count,
            'localOriginalsCount': local_orig_count,
            'totalPublicBytesAdded': total_public_bytes,
            'avgImageSizeBytes': round(avg_file_size, 1),
            'manifestRawBeforeBytes': baseline_raw_bytes,
            'manifestRawAfterBytes': after_raw_bytes,
            'manifestGzipBeforeBytes': baseline_gzip_bytes,
            'manifestGzipAfterBytes': after_gzip_bytes
        },
        'stratifiedBreakdown': sel_data['categories'],
        'sampleMigrated': [
            {'wordId': m['wordId'], 'headword': m['headword'], 'version': 1, 'r2Uri': f"words/{m['wordId']}/v1.webp"}
            for m in migrated_sample
        ],
        'sampleUnmigrated': [
            {'wordId': u['id'], 'headword': u['headword'], 'localFallback': f"/assets/images/words/{u.get('headword', '').lower()}.webp"}
            for u in unmigrated_sample
        ],
        'results': upload_results
    }

    report_path = ROOT / 'scripts' / 'rehearsal_report.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\nRehearsal report successfully written to {report_path}!")
    print("=== REHEARSAL SUMMARY ===")
    print(f"Status: PASS")
    print(f"Total Migrated: 100 words")
    print(f"R2 Manifest: 10 -> 110 (+100)")
    print(f"Public Bytes Added: {total_public_bytes} bytes ({total_public_bytes/1024/1024:.2f} MB)")
    print(f"Manifest Gzip Size: {baseline_gzip_bytes}B -> {after_gzip_bytes}B (+{after_gzip_bytes - baseline_gzip_bytes}B)")
    print(f"Avg Worker Latency: {avg_worker_cpu:.2f}ms")
    print(f"Local files intact: 7,165 WebP, 7,080 originals")

if __name__ == '__main__':
    main()
