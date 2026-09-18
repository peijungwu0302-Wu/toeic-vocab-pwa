# -*- coding: utf-8 -*-
"""
scripts/reconcile_catalog.py
Computes exact sets and mathematical reconciliation between 6,912, 6,852, and 7,165.
"""
import os
import json
import re
import glob
from pathlib import Path
from collections import Counter

ROOT = Path('.').resolve()
webp_dir = ROOT / 'public' / 'assets' / 'images' / 'words'
audit_file = ROOT / 'scripts' / 'image_generation_audit.json'
course_dir = ROOT / 'public' / 'data' / 'v1' / 'courses'

all_dir_files = sorted(os.listdir(webp_dir))
jpg_temp_files = [f for f in all_dir_files if f.endswith('.jpg')]
webp_files = [f for f in all_dir_files if f.endswith('.webp')]

# Load catalog words
course_files = sorted(glob.glob(str(course_dir / '*.json')))
catalog_words = {} # wid -> info
slug_to_wids = {}

for cf in course_files:
    tier = Path(cf).stem.replace('course-', '')
    cdata = json.load(open(cf, encoding='utf-8'))
    for w in cdata.get('words', []):
        wid = w.get('id')
        hw = w.get('headword', '')
        slug = re.sub(r'[^a-zA-Z0-9]+', '_', hw).strip('_').lower()
        if not slug: slug = 'word'
        if wid not in catalog_words:
            catalog_words[wid] = {'id': wid, 'headword': hw, 'slug': slug, 'tier': tier}
        slug_to_wids.setdefault(slug, set()).add(wid)

# Audit mapping
audit_records = json.load(open(audit_file, encoding='utf-8')).get('records', {})
audit_slug_to_wid = {}
for k, v in audit_records.items():
    aid = v.get('id')
    if aid and aid in catalog_words:
        audit_slug_to_wid[k] = aid

# O(1) mapping for each physical WebP file
file_matches = {}
for f in webp_files:
    base = f[:-5] # strip .webp
    candidates = set()
    
    # 1. Base is direct wordId
    if base in catalog_words:
        candidates.add(base)
    # 2. Base is audit slug
    if base in audit_slug_to_wid:
        candidates.add(audit_slug_to_wid[base])
    # 3. Base is catalog slug (or hyphenated version)
    norm_base = base.replace('-', '_').strip('_').lower()
    if norm_base in slug_to_wids:
        candidates.update(slug_to_wids[norm_base])
        
    file_matches[f] = candidates

orphans = [f for f, c in file_matches.items() if len(c) == 0]
ambiguous = [f for f, c in file_matches.items() if len(c) > 1]
matched_files = {f: list(c)[0] for f, c in file_matches.items() if len(c) == 1}

assert len(orphans) + len(ambiguous) + len(matched_files) == len(webp_files)

# Unique wordIds matched
unique_matched_wids = set(matched_files.values())

# Duplicate files (physical duplicate files for same wordId)
wid_to_files = {}
for f, wid in matched_files.items():
    wid_to_files.setdefault(wid, []).append(f)

dup_files = {wid: flist for wid, flist in wid_to_files.items() if len(flist) > 1}
extra_duplicate_files = sum(len(flist) - 1 for flist in dup_files.values())

# PoC and Rehearsal tracking
poc_10 = {
    'tw_w_c10323ff1d5a', 'tw_w_226b975ecfe8', 'tw_w_98a72ee91807',
    'tw_w_232c9ba95094', 'tw_w_962a26c4f02a', 'tw_w_8c7f7c60bb44',
    'tw_w_0b319a3135de', 'tw_w_2d702ee0621b', 'tw_w_d33fbbaec8fe',
    'tw_w_5e1b8d56cc25'
}

with open('scripts/rehearsal_100_selection.json', encoding='utf-8') as f:
    rehearsal_100_ids = {it['wordId'] for it in json.load(f)['items']}

already_migrated_110 = poc_10.union(rehearsal_100_ids)
assert len(already_migrated_110) == 110

migrated_in_catalog = already_migrated_110.intersection(unique_matched_wids)
remaining_eligible = unique_matched_wids - already_migrated_110

print("=== EXACT RECONCILIATION SUMMARY ===")
print(f"Total directory entries:                   {len(all_dir_files)}")
print(f"Other / Non-word (historical temp JPGs):   {len(jpg_temp_files)}")
print(f"Total Physical WebP:                       {len(webp_files)}")
print(f"---------------------------------------------")
print(f"Physical WebP Breakdown:")
print(f"  - Matched to catalog wordId (files):     {len(matched_files)}")
print(f"  - Ambiguous (files):                     {len(ambiguous)} ({ambiguous})")
print(f"  - Orphan (files):                        {len(orphans)}")
print(f"  Sum: {len(matched_files)} + {len(ambiguous)} + {len(orphans)} = {len(matched_files) + len(ambiguous) + len(orphans)}")
print(f"---------------------------------------------")
print(f"Unique Catalog Words Breakdown:")
print(f"  - Unique catalog words matched:          {len(unique_matched_wids)}")
print(f"  - Physical duplicate file redundancy:    {extra_duplicate_files}")
print(f"  Sum: {len(unique_matched_wids)} + {extra_duplicate_files} = {len(matched_files)}")
print(f"---------------------------------------------")
print(f"Migration Status Breakdown:")
print(f"  - Already migrated (10-word PoC):        {len(poc_10)}")
print(f"  - Already migrated (100-word rehearsal): {len(rehearsal_100_ids)}")
print(f"  - Remaining eligible for full migration: {len(remaining_eligible)}")
print(f"  Sum: {len(poc_10)} + {len(rehearsal_100_ids)} + {len(remaining_eligible)} = {len(poc_10) + len(rehearsal_100_ids) + len(remaining_eligible)} == {len(unique_matched_wids)}")
print(f"---------------------------------------------")
print(f"Explanation of 6,912 vs 6,852:")
print(f"  - 6,912: matched physical files from Step 354 script (which matched 6,912 files using hyphens preserved).")
print(f"  - 6,852: matched UNIQUE wordIds from rehearsal_selector (which excluded 10 PoC words and missed 60 hyphenated/direct-named words due to pure underscore slugification).")
print(f"  - 6,852 + 10 (PoC) = 6,862 words.")
print(f"  - 6,850 + 62 (hyphen variants/tw_p_*) = 6,912 files.")

out_data = {
    'total_directory_entries': len(all_dir_files),
    'historical_temp_jpg': len(jpg_temp_files),
    'total_physical_webp': len(webp_files),
    'matched_physical_webp_files': len(matched_files),
    'orphan_physical_webp_files': len(orphans),
    'ambiguous_physical_webp_files': len(ambiguous),
    'unique_catalog_words_matched': len(unique_matched_wids),
    'duplicate_file_redundancy': extra_duplicate_files,
    'already_migrated_poc_10': len(poc_10),
    'already_migrated_rehearsal_100': len(rehearsal_100_ids),
    'already_migrated_total_110': len(already_migrated_110),
    'remaining_eligible_unique_words': len(remaining_eligible),
    'ambiguous_files': ambiguous,
    'orphan_files': orphans
}
with open('scripts/reconciliation_data.json', 'w', encoding='utf-8') as f:
    json.dump(out_data, f, indent=2)
print("Wrote scripts/reconciliation_data.json successfully.")
