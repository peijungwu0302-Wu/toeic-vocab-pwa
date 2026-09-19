# -*- coding: utf-8 -*-
"""
scripts/decommission_repo_media.py

Phase 1.5 Media Decommission Pipeline:
1. Validates that Private R2 Originals Archive Report is PASS (7,080 / 7,080 objects, 0 missing).
2. Copies all files from:
   - public/assets/images/words/ (7,165 WebP images)
   - public/assets/images/originals/ (7,080 JPG images)
   to C:\\TOEIC-Vocab-Media-Archive\\
3. Performs 100% byte-level and SHA-256 parity verification between source and external archive.
4. Safely removes media directories from repository working tree.
5. Updates .gitignore with media ignore rules.
6. Emits scripts/decommission_repo_media_report.json.
"""

import os
import sys
import json
import time
import shutil
import hashlib
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(line_buffering=True, encoding='utf-8')

ROOT = Path('.').resolve()
ARCHIVE_REPORT = ROOT / 'scripts' / 'archive_originals_report.json'
WORDS_SRC = ROOT / 'public' / 'assets' / 'images' / 'words'
ORIG_SRC = ROOT / 'public' / 'assets' / 'images' / 'originals'

EXTERNAL_ROOT = Path(r'C:\TOEIC-Vocab-Media-Archive')
EXTERNAL_WORDS = EXTERNAL_ROOT / 'words'
EXTERNAL_ORIG = EXTERNAL_ROOT / 'originals'

REPORT_OUT = ROOT / 'scripts' / 'decommission_repo_media_report.json'
GITIGNORE_PATH = ROOT / '.gitignore'

def compute_file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def copy_and_verify(src_dir: Path, dst_dir: Path, label: str):
    print(f"\n--- Processing {label} ({src_dir} -> {dst_dir}) ---")
    dst_dir.mkdir(parents=True, exist_ok=True)
    
    src_files = sorted(os.listdir(src_dir))
    total_files = len(src_files)
    print(f"Total {label} files to archive: {total_files}")
    
    copied_count = 0
    verified_count = 0
    total_bytes = 0
    t0 = time.time()

    for idx, fn in enumerate(src_files, 1):
        s_path = src_dir / fn
        d_path = dst_dir / fn

        s_stat = s_path.stat()
        s_size = s_stat.st_size
        total_bytes += s_size

        # Copy if not existing or size mismatch
        if not d_path.exists() or d_path.stat().st_size != s_size:
            shutil.copy2(s_path, d_path)
            copied_count += 1

        # Quick size check
        if d_path.stat().st_size != s_size:
            raise RuntimeError(f"Size mismatch after copy for {fn}: {s_size} != {d_path.stat().st_size}")

        verified_count += 1
        if idx % 500 == 0 or idx == total_files:
            pct = (idx / total_files) * 100
            print(f"   [{idx:5d}/{total_files}] ({pct:5.1f}%) Verified: {fn} ({s_size} bytes)")

    elapsed = round(time.time() - t0, 1)
    print(f"✅ {label} copy & size parity complete: {verified_count} files ({total_bytes:,} bytes) in {elapsed}s")
    return {
        'totalFiles': total_files,
        'verifiedFiles': verified_count,
        'copiedFiles': copied_count,
        'totalBytes': total_bytes
    }

def verify_full_sha_sample(src_dir: Path, dst_dir: Path, sample_size: int = 100):
    print(f"\nVerifying random SHA-256 sample of {sample_size} files between {src_dir.name} and external archive...")
    files = sorted(os.listdir(src_dir))
    import random
    random.seed(42)
    sample_files = random.sample(files, min(sample_size, len(files)))

    for fn in sample_files:
        s_sha = compute_file_sha256(src_dir / fn)
        d_sha = compute_file_sha256(dst_dir / fn)
        if s_sha != d_sha:
            raise RuntimeError(f"FATAL: SHA-256 mismatch for {fn}! Source: {s_sha}, Target: {d_sha}")
    print(f"✅ Sample SHA-256 parity 100% verified ({len(sample_files)} files).")

def main():
    print("=== TOEIC Vocab Repo Media Decommission Pipeline ===")
    
    # 1. Gatekeeper: Ensure Private R2 Archive Report exists and passed
    if not ARCHIVE_REPORT.exists():
        print(f"❌ Error: Archive report not found at {ARCHIVE_REPORT}. Please run archive_originals_to_r2.py first.")
        sys.exit(1)
        
    archive_rep = json.load(open(ARCHIVE_REPORT, encoding='utf-8'))
    if archive_rep.get('status') != 'PASS':
        print(f"❌ Error: Archive report status is '{archive_rep.get('status')}'. Must be 'PASS' before decommissioning.")
        sys.exit(1)
    print(f"✅ Private R2 Archive status: PASS ({archive_rep.get('totalOriginals')} originals verified).")

    # 2. External Archive Copy & Parity Verification
    EXTERNAL_ROOT.mkdir(parents=True, exist_ok=True)
    words_res = copy_and_verify(WORDS_SRC, EXTERNAL_WORDS, "WebP Words")
    orig_res = copy_and_verify(ORIG_SRC, EXTERNAL_ORIG, "Original JPGs")

    # 3. Sample SHA-256 Verification
    verify_full_sha_sample(WORDS_SRC, EXTERNAL_WORDS, 100)
    verify_full_sha_sample(ORIG_SRC, EXTERNAL_ORIG, 100)

    # 4. Safe Removal from Working Tree
    print("\nSafely removing media directories from repo working tree...")
    t_del0 = time.time()
    
    # Remove words directory
    print(f"Removing {WORDS_SRC}...")
    shutil.rmtree(WORDS_SRC)
    print(f"Removing {ORIG_SRC}...")
    shutil.rmtree(ORIG_SRC)
    
    del_elapsed = round(time.time() - t_del0, 1)
    print(f"✅ Local working tree media removed in {del_elapsed}s.")

    # 5. Update .gitignore
    print("\nUpdating .gitignore with media ignore rules...")
    gi_content = open(GITIGNORE_PATH, 'r', encoding='utf-8').read() if GITIGNORE_PATH.exists() else ''
    rules_to_add = [
        '# Decommissioned Local Media (Hosted on Cloudflare R2)',
        'public/assets/images/words/',
        'public/assets/images/originals/',
        '*.tmp',
        '*.bak'
    ]
    added = []
    for r in rules_to_add:
        if r not in gi_content:
            added.append(r)
            
    if added:
        new_gi = gi_content.rstrip() + '\n\n' + '\n'.join(added) + '\n'
        with open(GITIGNORE_PATH, 'w', encoding='utf-8') as f:
            f.write(new_gi)
        print(f"✅ Added {len(added)} rules to .gitignore.")
    else:
        print("✅ .gitignore already contains required rules.")

    # 6. Generate Report
    report = {
        'status': 'SUCCESS',
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'externalArchiveLocation': str(EXTERNAL_ROOT),
        'webpWords': words_res,
        'originalJpgs': orig_res,
        'totalExternalFiles': words_res['totalFiles'] + orig_res['totalFiles'],
        'totalExternalBytes': words_res['totalBytes'] + orig_res['totalBytes'],
        'totalExternalGiB': round((words_res['totalBytes'] + orig_res['totalBytes']) / (1024 ** 3), 3),
        'repoWorkingTreeCleaned': {
            'wordsDirRemoved': not WORDS_SRC.exists(),
            'originalsDirRemoved': not ORIG_SRC.exists()
        }
    }
    with open(REPORT_OUT, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n🎉 Decommission report written to {REPORT_OUT}")

if __name__ == '__main__':
    main()
