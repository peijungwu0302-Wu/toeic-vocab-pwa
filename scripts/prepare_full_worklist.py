# -*- coding: utf-8 -*-
"""
scripts/prepare_full_worklist.py
Prepares the complete 6,750-word migration worklist.
Excludes:
- 10 PoC words
- 100 Rehearsal words
- 257 Orphan WebP files
- 2 Ambiguous WebP files (due-date, due_date)
- 13 Temp JPGs
"""

import os
import json
import re
import glob
from pathlib import Path

ROOT = Path('.').resolve()
webp_dir = ROOT / 'public' / 'assets' / 'images' / 'words'
audit_file = ROOT / 'scripts' / 'image_generation_audit.json'
course_dir = ROOT / 'public' / 'data' / 'v1' / 'courses'

# 1. Load already migrated wordIds (110 total)
poc_10 = {
    'tw_w_c10323ff1d5a', 'tw_w_226b975ecfe8', 'tw_w_98a72ee91807',
    'tw_w_232c9ba95094', 'tw_w_962a26c4f02a', 'tw_w_8c7f7c60bb44',
    'tw_w_0b319a3135de', 'tw_w_2d702ee0621b', 'tw_w_d33fbbaec8fe',
    'tw_w_5e1b8d56cc25'
}
with open('scripts/rehearsal_100_selection.json', encoding='utf-8') as f:
    rehearsal_100_ids = {it['wordId'] for it in json.load(f)['items']}

already_migrated_ids = poc_10.union(rehearsal_100_ids)
assert len(already_migrated_ids) == 110

# 2. Load catalog words
course_files = sorted(glob.glob(str(course_dir / '*.json')))
catalog_words = {}
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
            catalog_words[wid] = {
                'id': wid,
                'headword': hw,
                'slug': slug,
                'tier': tier,
                'visualAnchor': w.get('visualAnchor', {}),
                'en': w.get('en', ''),
                'zh': w.get('zh', ''),
                'definitionZh': w.get('definitionZh', '')
            }
        slug_to_wids.setdefault(slug, set()).add(wid)

# 3. Load audit
audit_records = json.load(open(audit_file, encoding='utf-8')).get('records', {})
audit_slug_to_wid = {}
for k, v in audit_records.items():
    aid = v.get('id')
    if aid and aid in catalog_words:
        audit_slug_to_wid[k] = aid

# 4. Map physical WebP files
all_files = sorted(os.listdir(webp_dir))
webp_files = [f for f in all_files if f.endswith('.webp')]

file_matches = {}
for f in webp_files:
    base = f[:-5]
    cands = set()
    if base in catalog_words:
        cands.add(base)
    if base in audit_slug_to_wid:
        cands.add(audit_slug_to_wid[base])
    norm_base = base.replace('-', '_').strip('_').lower()
    if norm_base in slug_to_wids:
        cands.update(slug_to_wids[norm_base])
    file_matches[f] = cands

# Filter 1:1 matched files
matched_files = {f: list(c)[0] for f, c in file_matches.items() if len(c) == 1}

# Group by wordId to choose canonical source file
wid_to_files = {}
for f, wid in matched_files.items():
    wid_to_files.setdefault(wid, []).append(f)

print(f"Total unique catalog wordIds matched by physical files: {len(wid_to_files)}")

# 5. Build eligible worklist (excluding already migrated 110)
worklist = []
for wid, files in sorted(wid_to_files.items()):
    if wid in already_migrated_ids:
        continue
    
    # Pick canonical file: prefer audit slug if present, else largest size
    chosen_file = files[0]
    if len(files) > 1:
        # Sort by file size descending
        files_by_size = sorted(files, key=lambda fn: (webp_dir / fn).stat().st_size, reverse=True)
        chosen_file = files_by_size[0]

    local_path = webp_dir / chosen_file
    cat_entry = catalog_words[wid]
    slug = cat_entry['slug']

    # Audit lookup
    audit_entry = audit_records.get(slug)
    if not audit_entry and slug.replace('_', '-') in audit_records:
        audit_entry = audit_records[slug.replace('_', '-')]
    if not audit_entry and chosen_file[:-5] in audit_records:
        audit_entry = audit_records[chosen_file[:-5]]

    # Determine provenance semantics (STRICT: Never forge historical prompt!)
    visual_anchor = cat_entry.get('visualAnchor', {})
    va_prompt = visual_anchor.get('imagePrompt', '')

    current_dataset_context = {
        'source': 'catalog_visualAnchor',
        'visualAnchorPrompt': va_prompt,
        'exampleEn': cat_entry.get('en', ''),
        'exampleZh': cat_entry.get('zh', '')
    }

    if audit_entry:
        historical_prompt = audit_entry.get('boostedPrompt') or audit_entry.get('rawPrompt')
        prompt_provenance = 'recovered-from-audit'
        formula_ver = 'v4-cinematic' if (historical_prompt and 'Crisp linework' in historical_prompt) else ('modern-editorial' if audit_entry.get('boostedPrompt') else 'legacy-raw')
        model_name = audit_entry.get('model', 'gemini-2.5-flash-image')
        cost_twd = audit_entry.get('unitCostTwd') or (audit_entry.get('costUsd', 0) * 31.5)
        orig_filename = audit_entry.get('originalFilename')
    else:
        historical_prompt = None  # STRICT: null in JSON!
        prompt_provenance = 'legacy-local-unrecorded'
        formula_ver = 'legacy-local-unrecorded'
        model_name = 'unknown-legacy'
        cost_twd = 0.0
        orig_filename = None

    worklist.append({
        'wordId': wid,
        'headword': cat_entry['headword'],
        'slug': slug,
        'tier': cat_entry['tier'],
        'sourceFile': f"public/assets/images/words/{chosen_file}",
        'canonicalFileName': chosen_file,
        'allCandidateFiles': files,
        'fileSize': local_path.stat().st_size,
        'provenance': {
            'promptProvenance': prompt_provenance,
            'historicalPrompt': historical_prompt,
            'currentDatasetContext': current_dataset_context,
            'formulaVersion': formula_ver,
            'model': model_name,
            'costTwd': round(cost_twd, 4),
            'originalFilename': orig_filename
        },
        'status': 'PENDING'
    })

print(f"Total eligible worklist items: {len(worklist)}")
assert len(worklist) == 6750, f"Expected 6750, got {len(worklist)}"

# Provenance distribution in worklist:
prov_counts = {}
for item in worklist:
    pv = item['provenance']['promptProvenance']
    prov_counts[pv] = prov_counts.get(pv, 0) + 1
print("Worklist Provenance Breakdown:", prov_counts)

worklist_file = ROOT / 'scripts' / 'full_migration_worklist.json'
with open(worklist_file, 'w', encoding='utf-8') as f:
    json.dump({
        'totalEligible': len(worklist),
        'alreadyMigratedCount': len(already_migrated_ids),
        'provenanceBreakdown': prov_counts,
        'items': worklist
    }, f, ensure_ascii=False, indent=2)

print(f"Saved {worklist_file} successfully!")
