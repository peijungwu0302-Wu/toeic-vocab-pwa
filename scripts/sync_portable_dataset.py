# -*- coding: utf-8 -*-
"""Refresh only Portable Studio's embedded vocabulary data, never its behavior."""

import argparse
import json
import os
import re
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TIERS = (
    'core-1200', 'advanced-2500', 'expert-high-part1',
    'expert-high-part2', 'expert-high-part3',
)
DATASET_LINE = re.compile(r'(?m)^    const DATASET = (.+);(\r?\n)')


def slugify(text):
    return re.sub(r'_+', '_', re.sub(r'[^a-z0-9_-]', '_', text.strip().lower())).strip('_')


def sync(html_path, courses_dir, check=False):
    # Preserve the shell's exact line endings as well as its application logic.
    with html_path.open('r', encoding='utf-8', newline='') as source:
        original = source.read()
    matches = list(DATASET_LINE.finditer(original))
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one single-line DATASET declaration in {html_path}; found {len(matches)}')
    match = matches[0]
    previous = json.loads(match.group(1))
    if set(previous) != set(TIERS):
        raise ValueError('Embedded DATASET tier set is unexpected; refusing to alter application shell')

    dataset = {}
    for tier in TIERS:
        course_path = courses_dir / f'course-{tier}.json'
        course = json.loads(course_path.read_text(encoding='utf-8'))
        old_by_id = {item['id']: item for item in previous[tier]}
        items = []
        seen = set()
        for word in course['words']:
            word_id = word['id']
            if not word_id or word_id in seen:
                raise ValueError(f'Missing or duplicate wordId in {course_path}: {word_id}')
            seen.add(word_id)
            old = old_by_id.get(word_id, {})
            anchor = word.get('visualAnchor') or {}
            example = (word.get('examples') or [{}])[0]
            items.append({
                'headword': word['headword'],
                'slug': old.get('slug') or slugify(word['headword']),
                'pos': ', '.join(word.get('partsOfSpeech') or []) or 'n.',
                'zh': word.get('definitionZh') or '',
                'en': anchor.get('shortEn') or example.get('en') or '',
                'enZh': anchor.get('scene') or example.get('zh') or '',
                'theme': anchor.get('domainTheme') or '',
                'prompt': anchor.get('imagePrompt') or '',
                # Legacy display metadata is retained, not inferred from decommissioned local media.
                'hasImage': old.get('hasImage', False),
                'completedAt': old.get('completedAt'),
                'source': old.get('source'),
                'id': word_id,
            })
        dataset[tier] = items

    replacement = json.dumps(dataset, ensure_ascii=False)
    updated = original[:match.start(1)] + replacement + original[match.end(1):]
    if updated == original:
        print(f'{html_path}: up to date')
        return
    if check:
        raise ValueError(f'{html_path}: DATASET is stale; run python scripts/sync_portable_dataset.py')

    # One atomic replacement of the authoritative source; dist is created by Vite.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='', dir=html_path.parent,
                                         prefix=f'.{html_path.name}.', suffix='.tmp', delete=False) as output:
            temporary = Path(output.name)
            output.write(updated)
        os.replace(temporary, html_path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    print(f'{html_path}: updated DATASET only ({sum(map(len, dataset.values()))} words)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path, default=ROOT / 'public' / 'portable_studio.html')
    parser.add_argument('--courses-dir', type=Path, default=ROOT / 'public' / 'data' / 'v1' / 'courses')
    parser.add_argument('--check', action='store_true', help='verify the embedded DATASET without writing')
    args = parser.parse_args()
    sync(args.html, args.courses_dir, args.check)
