# -*- coding: utf-8 -*-
"""
scripts/rehearsal_selector.py
Selects exactly 100 stratified words for the Phase 1.5 Legacy Migration Rehearsal.
"""
import json
import os
import re
import glob
from pathlib import Path

ROOT = Path('.').resolve()

def slugify(text: str) -> str:
    clean = re.sub(r'[^a-zA-Z0-9]+', '_', text).strip('_').lower()
    return clean if clean else 'word'

def select_rehearsal_words():
    existing_poc_ids = {
        'tw_w_c10323ff1d5a', 'tw_w_226b975ecfe8', 'tw_w_98a72ee91807',
        'tw_w_232c9ba95094', 'tw_w_962a26c4f02a', 'tw_w_8c7f7c60bb44',
        'tw_w_0b319a3135de', 'tw_w_2d702ee0621b', 'tw_w_d33fbbaec8fe',
        'tw_w_5e1b8d56cc25'
    }

    course_files = sorted(glob.glob(str(ROOT / 'public' / 'data' / 'v1' / 'courses' / '*.json')))
    syllabus = {}
    
    for cf in course_files:
        tier_name = Path(cf).stem.replace('course-', '')
        with open(cf, 'r', encoding='utf-8') as f:
            cdata = json.load(f)
            for w in cdata.get('words', []):
                wid = w.get('id')
                hw = w.get('headword', '')
                slug = slugify(hw)
                if wid and wid not in syllabus:
                    syllabus[wid] = {
                        'id': wid,
                        'headword': hw,
                        'slug': slug,
                        'tier': tier_name,
                        'visualAnchor': w.get('visualAnchor', {}),
                        'en': w.get('en', ''),
                        'zh': w.get('zh', ''),
                        'definitionZh': w.get('definitionZh', '')
                    }

    print(f'Loaded {len(syllabus)} syllabus words across {len(course_files)} courses.')

    audit_file = ROOT / 'scripts' / 'image_generation_audit.json'
    audit_records = {}
    if audit_file.exists():
        with open(audit_file, 'r', encoding='utf-8') as f:
            adata = json.load(f)
            audit_records = adata.get('records', {})
    print(f'Loaded {len(audit_records)} audit records.')

    words_dir = ROOT / 'public' / 'assets' / 'images' / 'words'
    local_files = set(os.listdir(words_dir))

    matched_candidates = []
    for wid, w in syllabus.items():
        if wid in existing_poc_ids:
            continue
        
        slug = w['slug']
        webp_name = f'{slug}.webp'
        if webp_name not in local_files:
            continue

        webp_path = words_dir / webp_name
        if webp_path.stat().st_size < 1000:
            continue

        audit_entry = audit_records.get(slug)
        if not audit_entry and slug.replace('_', '-') in audit_records:
            audit_entry = audit_records[slug.replace('_', '-')]

        matched_candidates.append({
            'wordId': wid,
            'headword': w['headword'],
            'slug': slug,
            'tier': w['tier'],
            'localWebpPath': f'public/assets/images/words/{slug}.webp',
            'localFileSize': webp_path.stat().st_size,
            'auditEntry': audit_entry,
            'visualAnchor': w['visualAnchor'],
            'hasBoosted': bool(audit_entry and audit_entry.get('boostedPrompt')),
            'hasRaw': bool(audit_entry and (audit_entry.get('rawPrompt') or audit_entry.get('prompt')) and not audit_entry.get('boostedPrompt')),
            'isSpecialPhrase': (' ' in w['headword']) or ('-' in w['headword']) or ('_' in slug),
            'hasNoAudit': audit_entry is None
        })

    print(f'Matched {len(matched_candidates)} valid local WebP syllabus candidates.')

    cat_legacy_local = [c for c in matched_candidates if c['hasNoAudit']]
    cat_phrase_special = [c for c in matched_candidates if c['isSpecialPhrase'] and not c['hasNoAudit']]
    cat_boosted = [c for c in matched_candidates if c['hasBoosted'] and not c['isSpecialPhrase']]
    cat_raw = [c for c in matched_candidates if not c['hasBoosted'] and not c['hasNoAudit'] and not c['isSpecialPhrase']]

    print(f'legacy_local: {len(cat_legacy_local)}, phrase_special: {len(cat_phrase_special)}, boosted: {len(cat_boosted)}, raw: {len(cat_raw)}')

    selected_1 = cat_legacy_local[:4]
    
    step_phrase = max(1, len(cat_phrase_special) // 26)
    selected_2 = [cat_phrase_special[i * step_phrase] for i in range(26)]

    step_boosted = max(1, len(cat_boosted) // 40)
    selected_3 = [cat_boosted[i * step_boosted] for i in range(40)]

    step_raw = max(1, len(cat_raw) // 30)
    selected_4 = [cat_raw[i * step_raw] for i in range(30)]

    for c in selected_1: c['rehearsalCategory'] = 'legacy_local'
    for c in selected_2: c['rehearsalCategory'] = 'phrase_special'
    for c in selected_3: c['rehearsalCategory'] = 'audit_boosted'
    for c in selected_4: c['rehearsalCategory'] = 'audit_raw'

    all_selected = selected_1 + selected_2 + selected_3 + selected_4
    assert len(all_selected) == 100, f'Expected 100, got {len(all_selected)}'

    out_file = ROOT / 'scripts' / 'rehearsal_100_selection.json'
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump({
            'totalSelected': len(all_selected),
            'categories': {
                'legacy_local': len(selected_1),
                'phrase_special': len(selected_2),
                'audit_boosted': len(selected_3),
                'audit_raw': len(selected_4)
            },
            'items': all_selected
        }, f, ensure_ascii=False, indent=2)

    print(f'Successfully generated {out_file} with 100 items!')

if __name__ == '__main__':
    select_rehearsal_words()
