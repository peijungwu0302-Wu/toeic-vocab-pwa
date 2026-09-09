# -*- coding: utf-8 -*-
import json, re, shutil, sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
html_files = [ROOT / 'public' / 'portable_studio.html', ROOT / 'dist' / 'portable_studio.html']

def slugify(text):
    clean = re.sub(r'[^a-zA-Z0-9]+', '_', text).strip('_').lower()
    return clean if clean else 'word'

def sync():
    course_map = {}
    for tier in ['core-1200', 'advanced-2500', 'expert-high-part1', 'expert-high-part2', 'expert-high-part3']:
        p = ROOT / 'public' / 'data' / 'v1' / 'courses' / f'course-{tier}.json'
        if p.exists():
            d = json.load(open(p, encoding='utf-8'))
            course_map[tier] = {w.get('headword'): w.get('visualAnchor', {}).get('imagePrompt') for w in d.get('words', []) if w.get('visualAnchor', {}).get('imagePrompt')}

    words_dir = ROOT / 'public' / 'assets' / 'images' / 'words'

    for h_path in html_files:
        if not h_path.exists():
            continue
        c = open(h_path, encoding='utf-8').read()
        idx = c.find('const DATASET = ')
        if idx == -1:
            continue
        end_idx = c.find(';\n', idx)
        raw_json = c[idx + len('const DATASET = '):end_idx]
        data = json.loads(raw_json)

        updated_prompts = 0
        updated_imgs = 0
        pending_stats = {}

        for tier, items in data.items():
            prompts = course_map.get(tier, {})
            pending_count = 0
            for item in items:
                hw = item.get('headword', '')
                slug = item.get('slug', '')
                norm_slug = slugify(hw)

                if hw in prompts and prompts[hw]:
                    item['prompt'] = prompts[hw]
                    updated_prompts += 1

                webp_norm = words_dir / f'{norm_slug}.webp'
                webp_orig = words_dir / f'{slug}.webp'

                has_file = False
                if webp_norm.exists() and webp_norm.stat().st_size > 1000:
                    has_file = True
                    if not webp_orig.exists():
                        shutil.copyfile(webp_norm, webp_orig)
                elif webp_orig.exists() and webp_orig.stat().st_size > 1000:
                    has_file = True
                    if not webp_norm.exists():
                        shutil.copyfile(webp_orig, webp_norm)

                if has_file:
                    item['hasImage'] = True
                    updated_imgs += 1
                else:
                    item['hasImage'] = False
                    pending_count += 1

            pending_stats[tier] = pending_count

        new_raw_json = json.dumps(data, ensure_ascii=False)
        new_c = c[:idx + len('const DATASET = ')] + new_raw_json + c[end_idx:]
        with open(h_path, 'w', encoding='utf-8') as f:
            f.write(new_c)
        print(f'Updated {h_path.name}: {updated_prompts} prompts, {updated_imgs} images flagged true.')
        print(f'   Pending stats: {pending_stats}')

if __name__ == '__main__':
    sync()
