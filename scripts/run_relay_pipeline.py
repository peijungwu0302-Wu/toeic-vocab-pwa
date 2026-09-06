# -*- coding: utf-8 -*-
"""
Relay Image Pipeline:
Stage 1: expert-high-part2 (5 missing words: wire, wireless, without_a_doubt, without_delay, work_additional_hours)
Stage 2: advanced-2500 (remaining 552 words)
Stage 3: expert-high-part1 (remaining 2,238 words)
"""
import sys, os, time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "scripts"))

from generate_imagen_pipeline import run_pipeline

def main():
    print("=" * 65, flush=True)
    print("🚀 啟動多益單字高畫質插畫【全自動三階段接力生成管線】", flush=True)
    print("   階段 1: 補齊 expert-high-part2 剩餘 5 詞")
    print("   階段 2: 推進 advanced-2500 剩餘 552 詞至全券完工")
    print("   階段 3: 即刻接力啟動 expert-high-part1 (滿分巔峰第一卷，2,238 詞)")
    print("   🛡️ 隨時可喊「暫停」，雙軌原子存檔與試用金熔斷保護全程生效！")
    print("=" * 65, flush=True)

    # 階段 1: expert-high-part2 5 詞 (~6.2 TWD)
    print("\n🌟 [Stage 1/3] 補齊 expert-high-part2 5 個單字...", flush=True)
    run_pipeline(
        tier="expert-high-part2",
        only_slugs=["wire", "wireless", "without_a_doubt", "without_delay", "work_additional_hours"],
        budget_twd=50
    )

    # 階段 2: advanced-2500 剩餘 552 詞 (~686 TWD)
    print("\n🌟 [Stage 2/3] 接力啟動 advanced-2500 批次生成...", flush=True)
    run_pipeline(
        tier="advanced-2500",
        budget_twd=2500
    )

    # 階段 3: expert-high-part1 (~2,780 TWD)
    print("\n🌟 [Stage 3/3] 接力啟動 expert-high-part1 滿分巔峰第一卷...", flush=True)
    run_pipeline(
        tier="expert-high-part1",
        budget_twd=2500
    )

    print("\n🎉🎉 全部三階段接力任務已圓滿執行完畢！", flush=True)

if __name__ == "__main__":
    main()
