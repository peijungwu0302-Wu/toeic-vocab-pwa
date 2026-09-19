# -*- coding: utf-8 -*-
"""
scripts/archive_originals_to_r2.py
Archives all 7,080 original images (~2.434 GiB) to Private R2 under archive/legacy-originals/{originalFilename}
with strict metadata, provenance, SHA-256 validation, and 100% post-upload verification.
"""

import os
import sys
import json
import time
import hashlib
import glob
import re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import requests

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True, encoding='utf-8')

ROOT = Path('.').resolve()
WORKER_BASE = 'https://toeic-image-publisher.peijungwu0302.workers.dev'
SECRET_PATH = ROOT / 'workers' / 'image-publisher' / '.secret.tmp'
ORIG_DIR = ROOT / 'public' / 'assets' / 'images' / 'originals'
CHECKPOINT_PATH = ROOT / 'scripts' / 'archive_originals_checkpoint.json'
REPORT_PATH = ROOT / 'scripts' / 'archive_originals_report.json'
AUDIT_PATH = ROOT / 'scripts' / 'image_generation_audit.json'
COURSE_DIR = ROOT / 'public' / 'data' / 'v1' / 'courses'

CONCURRENCY = 10

def load_secret():
    if not SECRET_PATH.exists():
        raise RuntimeError("Secret file missing!")
    return open(SECRET_PATH, 'r', encoding='utf-8').read().strip()

def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def build_inventory_worklist():
    print("Building inventory worklist for 7,080 originals...")
    orig_files = sorted(os.listdir(ORIG_DIR))
    
    # Load catalog
    catalog_words = {}
    slug_to_wid = {}
    course_files = sorted(glob.glob(str(COURSE_DIR / '*.json')))
    for cf in course_files:
        cdata = json.load(open(cf, encoding='utf-8'))
        for w in cdata.get('words', []):
            wid = w.get('id')
            hw = w.get('headword', '')
            slug = re.sub(r'[^a-zA-Z0-9]+', '_', hw).strip('_').lower()
            if not slug:
                slug = 'word'
            if wid and wid not in catalog_words:
                catalog_words[wid] = {'id': wid, 'headword': hw, 'slug': slug}
            if slug not in slug_to_wid and wid:
                slug_to_wid[slug] = wid

    # Load audit
    audit_records = json.load(open(AUDIT_PATH, encoding='utf-8')).get('records', {})
    audit_filename_to_record = {}
    audit_slug_to_record = {}
    for k, v in audit_records.items():
        fn = v.get('originalFilename')
        if fn:
            audit_filename_to_record[fn] = v
        audit_slug_to_record[k] = v

    worklist = []
    for fn in orig_files:
        fpath = ORIG_DIR / fn
        fsize = fpath.stat().st_size
        stem = os.path.splitext(fn)[0].lower()

        # Provenance resolution
        audit_rec = audit_filename_to_record.get(fn) or audit_slug_to_record.get(stem)
        matched_wid = None
        if audit_rec and audit_rec.get('id'):
            matched_wid = audit_rec.get('id')
        elif stem in slug_to_wid:
            matched_wid = slug_to_wid[stem]

        is_orphan = (matched_wid is None and audit_rec is None)

        worklist.append({
            'originalFilename': fn,
            'fileSize': fsize,
            'isOrphan': is_orphan,
            'matchedWordId': matched_wid,
            'hasAudit': audit_rec is not None,
            'auditProvenance': {
                'model': audit_rec.get('model'),
                'timestamp': audit_rec.get('timestamp'),
                'costTwd': audit_rec.get('unitCostTwd') or ((audit_rec.get('costUsd') or 0) * 31.5)
            } if audit_rec else None
        })

    print(f"Inventory built: {len(worklist)} files (Matched: {sum(1 for w in worklist if not w['isOrphan'])}, Orphan: {sum(1 for w in worklist if w['isOrphan'])})")
    return worklist

def load_checkpoint():
    if CHECKPOINT_PATH.exists():
        try:
            return json.load(open(CHECKPOINT_PATH, 'r', encoding='utf-8'))
        except Exception:
            pass
    return {'archived': {}, 'totalCount': 7080}

def save_checkpoint(cp):
    tmp_path = CHECKPOINT_PATH.with_suffix('.tmp')
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(cp, f, ensure_ascii=False, indent=2)
    tmp_path.replace(CHECKPOINT_PATH)

def upload_single_original(item, secret, session):
    fn = item['originalFilename']
    fpath = ORIG_DIR / fn
    fbytes = open(fpath, 'rb').read()
    fsha = compute_sha256(fbytes)

    meta = {
        'originalFilename': fn,
        'sha256': fsha,
        'fileSize': len(fbytes),
        'isOrphan': item['isOrphan'],
        'matchedWordId': item['matchedWordId'],
        'auditProvenance': item['auditProvenance']
    }

    url = f'{WORKER_BASE}/api/archive/original'
    headers = {'X-Studio-Secret': secret}

    for attempt in range(3):
        t0 = time.perf_counter()
        try:
            files = {
                'file': (fn, fbytes, 'image/jpeg'),
                'metadata': (None, json.dumps(meta, ensure_ascii=False), 'application/json')
            }
            res = session.post(url, headers=headers, files=files, timeout=60)
            elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

            if res.status_code == 200:
                data = res.json()
                assert data.get('success') is True, f"Success flag false: {data}"
                return {
                    'originalFilename': fn,
                    'sha256': fsha,
                    'fileSize': len(fbytes),
                    'status': 'ARCHIVED',
                    'latencyMs': elapsed_ms,
                    'isOrphan': item['isOrphan'],
                    'matchedWordId': item['matchedWordId']
                }
            else:
                err = f"HTTP {res.status_code}: {res.text[:200]}"
        except Exception as e:
            err = str(e)
        time.sleep(1 + attempt * 2)

    raise RuntimeError(f"Failed to archive {fn} after 3 attempts: {err}")

def verify_all_batch(secret, worklist):
    print("\nStarting batch verification of all 7,080 objects in Private R2...")
    all_filenames = [w['originalFilename'] for w in worklist]
    batch_size = 300
    batches = [all_filenames[i:i + batch_size] for i in range(0, len(all_filenames), batch_size)]

    url = f'{WORKER_BASE}/api/archive/verify-batch'
    headers = {'X-Studio-Secret': secret, 'Content-Type': 'application/json'}

    verified_results = {}
    total_batches = len(batches)
    session = requests.Session()

    for idx, batch in enumerate(batches, 1):
        t0 = time.perf_counter()
        res = session.post(url, headers=headers, json={'filenames': batch}, timeout=45)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
        if res.status_code != 200:
            raise RuntimeError(f"Batch verify failed on batch {idx}/{total_batches}: {res.status_code} {res.text[:200]}")
        data = res.json()
        results = data.get('results', {})
        verified_results.update(results)
        print(f"   Batch {idx:2d}/{total_batches}: verified {len(batch)} files ({elapsed_ms}ms)")

    return verified_results

def main():
    print("=== TOEIC Vocab Private R2 Originals Archive Pipeline ===")
    secret = load_secret()
    print("Studio Secret loaded safely.")

    worklist = build_inventory_worklist()
    checkpoint = load_checkpoint()
    archived_map = checkpoint['archived']

    pending_items = [w for w in worklist if w['originalFilename'] not in archived_map]
    print(f"Total files: {len(worklist)}, Already archived: {len(archived_map)}, Pending: {len(pending_items)}")

    if pending_items:
        print(f"Uploading {len(pending_items)} files to Private R2 with concurrency={CONCURRENCY}...")
        lock = threading.Lock()
        completed_count = len(archived_map)
        start_time = time.time()
        last_save_time = time.time()

        def worker(item):
            s = requests.Session()
            return upload_single_original(item, secret, s)

        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            futures = {pool.submit(worker, item): item for item in pending_items}
            for fut in as_completed(futures):
                item = futures[fut]
                fn = item['originalFilename']
                try:
                    res = fut.result()
                    with lock:
                        archived_map[fn] = res
                        completed_count += 1
                        if completed_count % 100 == 0 or completed_count == len(worklist):
                            elapsed = time.time() - start_time
                            rate = (completed_count - len(archived_map) + len(pending_items) - len(futures) + completed_count) / max(1, elapsed)
                            pct = (completed_count / len(worklist)) * 100
                            print(f"[{completed_count:4d}/{len(worklist)}] ({pct:5.1f}%) Archived: {fn} ({res['fileSize']} bytes) - {res['latencyMs']}ms")
                        if time.time() - last_save_time > 10:
                            save_checkpoint(checkpoint)
                            last_save_time = time.time()
                except Exception as e:
                    print(f"❌ Error archiving {fn}: {e}")
                    raise

        save_checkpoint(checkpoint)
        print(f"Upload complete! All {len(worklist)} files processed in {round(time.time() - start_time, 1)}s.")

    # Verification phase
    verified_map = verify_all_batch(secret, worklist)
    missing_count = 0
    size_mismatch_count = 0
    sha_mismatch_count = 0
    total_verified_bytes = 0

    local_map = {w['originalFilename']: w for w in worklist}
    for fn, v in verified_map.items():
        if not v.get('exists'):
            missing_count += 1
            continue
        local_w = local_map[fn]
        r2_size = v.get('size', 0)
        local_size = local_w['fileSize']
        total_verified_bytes += r2_size

        if r2_size != local_size:
            size_mismatch_count += 1

        local_sha = archived_map.get(fn, {}).get('sha256')
        r2_sha = v.get('sha256')
        if local_sha and r2_sha and local_sha.lower() != r2_sha.lower():
            sha_mismatch_count += 1

    local_total_bytes = sum(w['fileSize'] for w in worklist)
    print("\n=== Verification Summary ===")
    print(f"Total Objects in Private R2: {len(verified_map)} / {len(worklist)}")
    print(f"Missing in R2: {missing_count}")
    print(f"Size Mismatches: {size_mismatch_count}")
    print(f"SHA-256 Mismatches: {sha_mismatch_count}")
    print(f"Total Verified Bytes in R2: {total_verified_bytes:,} bytes")
    print(f"Total Local Original Bytes: {local_total_bytes:,} bytes")
    print(f"Byte Parity: {'MATCH' if total_verified_bytes == local_total_bytes else 'MISMATCH'}")

    status = 'PASS' if (missing_count == 0 and size_mismatch_count == 0 and sha_mismatch_count == 0 and total_verified_bytes == local_total_bytes) else 'FAIL'
    print(f"\nFinal Archival Status: {status}")

    report = {
        'status': status,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'totalOriginals': len(worklist),
        'matchedOriginals': sum(1 for w in worklist if not w['isOrphan']),
        'orphanOriginals': sum(1 for w in worklist if w['isOrphan']),
        'totalLocalBytes': local_total_bytes,
        'totalVerifiedR2Bytes': total_verified_bytes,
        'totalGiB': round(total_verified_bytes / (1024 ** 3), 3),
        'totalMiB': round(total_verified_bytes / (1024 ** 2), 2),
        'verification': {
            'objectsChecked': len(verified_map),
            'missingCount': missing_count,
            'sizeMismatchCount': size_mismatch_count,
            'shaMismatchCount': sha_mismatch_count,
            'byteParityMatch': total_verified_bytes == local_total_bytes
        }
    }

    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"Report written to {REPORT_PATH}")

if __name__ == '__main__':
    main()
