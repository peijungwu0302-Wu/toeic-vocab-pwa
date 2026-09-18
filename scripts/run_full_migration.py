# -*- coding: utf-8 -*-
"""
scripts/run_full_migration.py
Full Legacy Migration Pipeline (6,750 words) with Resumable Checkpoints,
Strict Provenance, 4-5 Concurrency, and Atomic Single Batch Publication Commit.
"""

import os
import sys
import json
import time
import hashlib
import gzip
import random
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True, encoding='utf-8')

ROOT = Path('.').resolve()
WORKER_BASE = 'https://toeic-image-publisher.peijungwu0302.workers.dev'
SECRET_PATH = ROOT / 'workers' / 'image-publisher' / '.secret.tmp'
CHECKPOINT_PATH = ROOT / 'scripts' / 'full_migration_checkpoint.json'
WORKLIST_PATH = ROOT / 'scripts' / 'full_migration_worklist.json'
REPORT_PATH = ROOT / 'scripts' / 'full_migration_report.json'

BATCH_SIZE = 300
CONCURRENCY = 5

def load_secret():
    if not SECRET_PATH.exists():
        raise RuntimeError("Secret file missing!")
    return open(SECRET_PATH, 'r', encoding='utf-8').read().strip()

def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def save_checkpoint(checkpoint_data):
    tmp_path = CHECKPOINT_PATH.with_suffix('.tmp')
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(checkpoint_data, f, ensure_ascii=False, indent=2)
    tmp_path.replace(CHECKPOINT_PATH)

def upload_single_word(item, secret):
    word_id = item['wordId']
    slug = item['slug']
    local_path = ROOT / item['sourceFile']
    prov = item['provenance']

    image_bytes = open(local_path, 'rb').read()
    image_sha256 = compute_sha256(image_bytes)

    hist_prompt = prov.get('historicalPrompt')
    prompt_hash = compute_sha256(hist_prompt.encode('utf-8')) if hist_prompt else None

    metadata = {
        'wordId': word_id,
        'imageSha256': image_sha256,
        'publishRequestId': f'pub_full_{word_id}_{image_sha256[:8]}',
        'skipManifestCommit': True,
        'prompt': {
            'promptProvenance': prov.get('promptProvenance'),
            'historicalPrompt': hist_prompt,
            'currentDatasetContext': prov.get('currentDatasetContext'),
            'formulaVersion': prov.get('formulaVersion'),
            'fullPromptText': hist_prompt or '',
            'promptHash': prompt_hash
        },
        'generator': {
            'provider': 'legacy-migration',
            'model': prov.get('model', 'gemini-2.5-flash-image'),
            'costTwd': prov.get('costTwd', 0.0),
            'generatedBy': 'legacy-full-migration'
        },
        'dimensions': {
            'width': 896,
            'height': 896
        }
    }

    url = f'{WORKER_BASE}/api/publish'
    headers = {'X-Studio-Secret': secret}

    max_retries = 3
    last_err = None
    for attempt in range(max_retries):
        t0 = time.perf_counter()
        try:
            files = {
                'file': (item['canonicalFileName'], image_bytes, 'image/webp'),
                'metadata': (None, json.dumps(metadata, ensure_ascii=False), 'application/json')
            }
            res = requests.post(url, headers=headers, files=files, timeout=35)
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

            if res.status_code == 200:
                body = res.json()
                assert body.get('success') is True, f"Success flag false: {body}"
                assert body.get('version') == 1, f"Expected v1, got {body.get('version')}"
                assert body.get('sha256') == image_sha256, "SHA256 mismatch!"
                assert body.get('manifestCommitted') is False, "Manifest should be deferred!"

                return {
                    'wordId': word_id,
                    'headword': item['headword'],
                    'sourcePath': item['sourceFile'],
                    'sha256': image_sha256,
                    'r2Key': f"words/{word_id}/v1.webp",
                    'version': 1,
                    'status': 'MIGRATED',
                    'fileSize': len(image_bytes),
                    'workerLatencyMs': body.get('latencyMs', 0),
                    'wallLatencyMs': elapsed_ms,
                    'retryCount': attempt,
                    'formulaVersion': prov.get('formulaVersion'),
                    'promptProvenance': prov.get('promptProvenance')
                }
            else:
                last_err = f"HTTP {res.status_code}: {res.text}"
        except Exception as e:
            last_err = str(e)
        time.sleep(0.5 * (attempt + 1))

    return {
        'wordId': word_id,
        'headword': item['headword'],
        'sourcePath': item['sourceFile'],
        'sha256': image_sha256,
        'status': 'FAILED',
        'error': last_err,
        'retryCount': max_retries
    }

def main():
    print("==========================================================", flush=True)
    print("=== TOEIC Vocab R2 Full Legacy Migration Pipeline (6750) ===", flush=True)
    print("==========================================================", flush=True)

    secret = load_secret()
    print("Loaded studio secret successfully.", flush=True)

    with open(WORKLIST_PATH, 'r', encoding='utf-8') as f:
        worklist_data = json.load(f)
    items = worklist_data['items']
    total_eligible = len(items)
    print(f"Total eligible worklist items: {total_eligible}", flush=True)

    # Load or initialize checkpoint
    checkpoint = {
        'totalEligible': total_eligible,
        'completedCount': 0,
        'failedCount': 0,
        'records': {},
        'batchesProcessed': 0
    }
    if CHECKPOINT_PATH.exists():
        try:
            with open(CHECKPOINT_PATH, 'r', encoding='utf-8') as f:
                checkpoint = json.load(f)
            print(f"Resuming from checkpoint: {len(checkpoint['records'])} items already recorded.", flush=True)
        except Exception as e:
            print(f"Warning: could not read checkpoint: {e}", flush=True)

    completed_records = checkpoint['records']
    pending_items = [it for it in items if it['wordId'] not in completed_records or completed_records[it['wordId']].get('status') != 'MIGRATED']
    print(f"Pending items to migrate: {len(pending_items)} (Already migrated: {total_eligible - len(pending_items)})", flush=True)

    total_wall_start = time.perf_counter()

    # Process in batches
    num_batches = (len(pending_items) + BATCH_SIZE - 1) // BATCH_SIZE if pending_items else 0
    print(f"Processing in {num_batches} batches of up to {BATCH_SIZE} items with concurrency {CONCURRENCY}...", flush=True)

    for b_idx in range(num_batches):
        b_start = b_idx * BATCH_SIZE
        b_end = min(b_start + BATCH_SIZE, len(pending_items))
        batch_items = pending_items[b_start:b_end]

        t_batch_start = time.perf_counter()
        print(f"\n--- Starting Batch {b_idx + 1}/{num_batches} ({len(batch_items)} items) ---", flush=True)

        with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
            futures = {executor.submit(upload_single_word, it, secret): it for it in batch_items}
            for f in as_completed(futures):
                res = f.result()
                wid = res['wordId']
                completed_records[wid] = res
                if res['status'] == 'FAILED':
                    print(f"  [FAILED] {res['headword']} ({wid}): {res.get('error')}", flush=True)

        # Batch summary
        b_elapsed = time.perf_counter() - t_batch_start
        migrated_in_batch = sum(1 for it in batch_items if completed_records[it['wordId']]['status'] == 'MIGRATED')
        failed_in_batch = len(batch_items) - migrated_in_batch
        total_migrated_so_far = sum(1 for r in completed_records.values() if r.get('status') == 'MIGRATED')

        checkpoint['completedCount'] = total_migrated_so_far
        checkpoint['failedCount'] = sum(1 for r in completed_records.values() if r.get('status') == 'FAILED')
        checkpoint['batchesProcessed'] += 1
        save_checkpoint(checkpoint)

        rate = len(batch_items) / b_elapsed if b_elapsed > 0 else 0
        print(f"Batch {b_idx + 1}/{num_batches} completed in {b_elapsed:.1f}s ({rate:.1f} words/s).", flush=True)
        print(f"Progress: {total_migrated_so_far}/{total_eligible} migrated ({total_migrated_so_far/total_eligible*100:.1f}%), Failed: {checkpoint['failedCount']}", flush=True)

        if failed_in_batch > 0:
            print(f"Warning: {failed_in_batch} failures in batch {b_idx + 1}. Checkpoint saved.", flush=True)

    upload_wall_time = time.perf_counter() - total_wall_start
    print(f"\nAll upload batches finished in {upload_wall_time:.1f}s ({upload_wall_time/60:.2f} mins).", flush=True)

    # Check for any remaining failures
    failed_items = [r for r in completed_records.values() if r.get('status') != 'MIGRATED']
    if failed_items:
        print(f"\nFATAL: {len(failed_items)} items failed migration! Halting manifest publication.", flush=True)
        for fi in failed_items[:20]:
            print(f"  FAILED: {fi['wordId']} ({fi.get('headword')}): {fi.get('error')}", flush=True)
        sys.exit(1)

    print(f"\nSUCCESS: All {total_eligible} eligible items uploaded and verified v1 without a single failure!", flush=True)

    # -------------------------------------------------------------
    # Single Atomic Batch Publication Commit
    # -------------------------------------------------------------
    print("\n==========================================================", flush=True)
    print("=== Executing Single Final Atomic Batch Manifest Commit ===", flush=True)
    print("==========================================================", flush=True)

    # Fetch baseline current manifest
    cur_res = requests.get(f'{WORKER_BASE}/api/manifest/current')
    baseline_manifest = cur_res.json()
    baseline_count = baseline_manifest.get('count', 0)
    baseline_raw_bytes = len(cur_res.content)
    baseline_gzip_bytes = len(gzip.compress(cur_res.content))
    print(f"Pre-commit manifest count: {baseline_count}, raw: {baseline_raw_bytes}B, gzip: {baseline_gzip_bytes}B", flush=True)

    # Prepare batch updates for all 6,750 items
    updates = {}
    for wid, r in completed_records.items():
        if r.get('status') == 'MIGRATED':
            updates[wid] = {
                'v': 1,
                'h': r['sha256'][:16],
                'w': 896,
                'ht': 896
            }

    print(f"Built updates dictionary with {len(updates)} entries.", flush=True)
    batch_request_id = f"batch_full_migration_{int(time.time()*1000)}"
    batch_payload = {
        'batchRequestId': batch_request_id,
        'updates': updates
    }

    t_commit_start = time.perf_counter()
    commit_res = requests.post(
        f'{WORKER_BASE}/api/manifest/batch-commit',
        headers={'X-Studio-Secret': secret, 'Content-Type': 'application/json'},
        data=json.dumps(batch_payload, ensure_ascii=False),
        timeout=120
    )
    commit_elapsed_ms = round((time.perf_counter() - t_commit_start) * 1000, 1)
    print(f"Batch commit response: HTTP {commit_res.status_code} ({commit_elapsed_ms}ms)", flush=True)

    assert commit_res.status_code == 200, f"Batch commit failed: {commit_res.text}"
    commit_data = commit_res.json()
    assert commit_data.get('success') is True, f"Batch commit failed payload: {commit_data}"

    new_snapshot_uri = commit_data.get('manifestUri')
    total_manifest_count = commit_data.get('totalManifestCount')
    batch_added_count = commit_data.get('batchAddedCount')

    print(f"Snapshot URI: {new_snapshot_uri}", flush=True)
    print(f"Batch Added Count: {batch_added_count}", flush=True)
    print(f"Total Manifest Count: {total_manifest_count}", flush=True)
    assert total_manifest_count == baseline_count + len(updates), f"Count mismatch: expected {baseline_count + len(updates)}, got {total_manifest_count}"

    # -------------------------------------------------------------
    # Post-Migration Comprehensive Verification Suite
    # -------------------------------------------------------------
    print("\n==========================================================", flush=True)
    print("=== Post-Migration Comprehensive Verification Suite ===", flush=True)
    print("==========================================================", flush=True)

    # 1. Manifest verification
    final_res = requests.get(f'{WORKER_BASE}/api/manifest/current')
    final_manifest = final_res.json()
    final_raw_bytes = len(final_res.content)
    final_gzip_bytes = len(gzip.compress(final_res.content))
    final_images = final_manifest.get('images', {})
    print(f"Final Manifest: count={final_manifest.get('count')}, raw={final_raw_bytes}B, gzip={final_gzip_bytes}B", flush=True)
    assert final_manifest.get('count') == total_manifest_count

    # Verify 0 duplicates in manifest keys
    assert len(final_images) == len(set(final_images.keys())), "Duplicate wordIds detected in manifest!"
    print("Manifest integrity: 0 duplicate wordIds verified.", flush=True)

    # 2. Verify snapshot accessibility
    snap_res = requests.get(f'{WORKER_BASE}/{new_snapshot_uri}')
    assert snap_res.status_code == 200, f"Snapshot inaccessible: {snap_res.status_code}"
    print("Immutable snapshot verified accessible and intact.", flush=True)

    # 3. Random 100 Migrated words: PWA -> R2 CDN HTTP 200 + SHA-256
    print("\nSampling 100 migrated words for R2 delivery and SHA-256 match...", flush=True)
    random.seed(42)
    sample_100_wids = random.sample(list(updates.keys()), 100)
    sample_100_results = []

    with ThreadPoolExecutor(max_workers=8) as executor:
        def check_migrated_word(wid):
            rec = completed_records[wid]
            img_url = f"{WORKER_BASE}/{rec['r2Key']}"
            r = requests.get(img_url, timeout=15)
            if r.status_code == 200 and compute_sha256(r.content) == rec['sha256']:
                return {'wordId': wid, 'status': 'PASS', 'size': len(r.content)}
            return {'wordId': wid, 'status': 'FAIL', 'error': f"HTTP {r.status_code}"}

        futures = [executor.submit(check_migrated_word, wid) for wid in sample_100_wids]
        for f in as_completed(futures):
            sample_100_results.append(f.result())

    migrated_passes = [r for r in sample_100_results if r['status'] == 'PASS']
    print(f"Migrated 100 sample verification: {len(migrated_passes)}/100 PASS", flush=True)
    assert len(migrated_passes) == 100

    # 4. Random 50 non-migrated / orphan words: must NOT point to wrong wordId, fallback intact
    print("\nSampling 50 non-migrated / orphan words for fallback isolation...", flush=True)
    with open('scripts/reconciliation_data.json', encoding='utf-8') as f:
        recon_data = json.load(f)
    orphan_files = recon_data.get('orphan_files', [])
    sample_50_orphans = random.sample(orphan_files, min(50, len(orphan_files)))

    orphan_check_pass = 0
    for of in sample_50_orphans:
        base = of[:-5]
        assert base not in final_images, f"Orphan {of} leaked into manifest!"
        orphan_check_pass += 1
    print(f"Orphan isolation verification: {orphan_check_pass}/50 PASS (0 leaked into manifest)", flush=True)

    # 5. Local storage immutability check
    words_webp_count = len(list((ROOT / 'public' / 'assets' / 'images' / 'words').glob('*.webp')))
    origs_count = len(list((ROOT / 'public' / 'assets' / 'images' / 'originals').glob('*')))
    print(f"Local storage check: WebP={words_webp_count} (expected 7165), Originals={origs_count} (expected 7080)", flush=True)
    assert words_webp_count == 7165, f"Local WebP count changed! {words_webp_count}"
    assert origs_count == 7080, f"Local Originals count changed! {origs_count}"

    # 6. Aggregate storage metrics
    total_public_bytes = sum(r.get('fileSize', 0) for r in completed_records.values() if r.get('status') == 'MIGRATED')
    avg_img_size = total_public_bytes / len(updates) if updates else 0
    est_ledger_bytes = len(updates) * 1350  # ~1.35 KB per ledger

    # Provenance distribution
    prov_dist = {}
    formula_dist = {}
    for r in completed_records.values():
        if r.get('status') == 'MIGRATED':
            pv = r.get('promptProvenance', 'unknown')
            fv = r.get('formulaVersion', 'unknown')
            prov_dist[pv] = prov_dist.get(pv, 0) + 1
            formula_dist[fv] = formula_dist.get(fv, 0) + 1

    report = {
        'fullMigrationSummary': {
            'status': 'PASS',
            'intendedEligibleCount': total_eligible,
            'alreadyMigratedCount': baseline_count,
            'newlyMigratedCount': len(updates),
            'finalTotalManifestCount': total_manifest_count,
            'failedCount': 0,
            'retriedCount': sum(r.get('retryCount', 0) for r in completed_records.values()),
            'uploadWallTimeSec': round(upload_wall_time, 1),
            'uploadWallTimeMin': round(upload_wall_time / 60, 2),
            'batchCommitLatencyMs': commit_elapsed_ms,
            'snapshotUri': new_snapshot_uri,
            'r2PublicBytesAdded': total_public_bytes,
            'r2PublicMbAdded': round(total_public_bytes / 1024 / 1024, 2),
            'estR2PrivateBytesAdded': est_ledger_bytes,
            'avgImageSizeBytes': round(avg_img_size, 1),
            'manifestRawBeforeBytes': baseline_raw_bytes,
            'manifestRawAfterBytes': final_raw_bytes,
            'manifestGzipBeforeBytes': baseline_gzip_bytes,
            'manifestGzipAfterBytes': final_gzip_bytes,
            'manifestGzipDiffBytes': final_gzip_bytes - baseline_gzip_bytes,
            'localWebpCount': words_webp_count,
            'localOriginalsCount': origs_count
        },
        'provenanceBreakdown': {
            'promptProvenance': prov_dist,
            'formulaVersion': formula_dist
        },
        'samplingVerification': {
            'migratedSample100Pass': len(migrated_passes),
            'orphanSample50Pass': orphan_check_pass
        }
    }

    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\nFinal Report successfully saved to: {REPORT_PATH}", flush=True)
    print("=== FULL LEGACY MIGRATION COMPLETED SUCCESSFULLY ===", flush=True)

if __name__ == '__main__':
    main()
