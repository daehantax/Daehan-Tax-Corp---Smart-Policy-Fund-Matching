# =============================================================================
# [조사용] C-6 AI 비용 산정
#
# 입력: .research-data/survey-results.json (C-1 산출물)
# 출력: docs/research/ai-cost-estimate.md
#
# ⚠ 토큰 수는 **추정치**다. 정확한 값은 Anthropic count_tokens 엔드포인트로
#   재야 하는데 이 환경에 자격증명이 없다. 그래서 한국어 글자→토큰 비율을
#   범위로 두고 계산한다. 키가 생기면 --measured 로 실측 비율을 넣어 다시 돌린다.
#
#   py scripts/research/estimate_cost.py
#   py scripts/research/estimate_cost.py --ratio 1.15    # 실측 비율 반영
#
# 단가 출처: Anthropic 공개 가격표 (2026-06-24 기준). 바뀌면 PRICING 을 고칠 것.
# =============================================================================

import argparse
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / ".research-data"
RESULTS = DATA / "survey-results.json"
OUT_MD = ROOT / "docs" / "research" / "ai-cost-estimate.md"

# 모델별 100만 토큰당 단가 (USD). input, output
PRICING = {
    "claude-opus-5":    (5.00, 25.00),
    "claude-sonnet-5":  (3.00, 15.00),   # 2026-08-31까지 도입가 $2.00 / $10.00
    "claude-haiku-4-5": (1.00,  5.00),
}
DEFAULT_MODEL = "claude-opus-5"

# 한국어 글자당 토큰 비율의 불확실 구간.
# 한글은 영어보다 토큰 효율이 낮다. 실측 전까지 세 지점으로 감을 잡는다.
RATIO_RANGE = [("낙관", 0.7), ("중간", 1.0), ("비관", 1.4)]

TOTAL_GRANTS = 1533      # 현재 활성 공고 수
DAILY_NEW = 45           # 하루 신규 공고 (C-1 표본 기간 실측 38~49건)
OUT_CHARS_PER_GRANT = 2500   # 구조화 JSON + evidence 인용. 보수적으로 잡음
PROMPT_OVERHEAD_CHARS = 3000  # 시스템 프롬프트 + 스키마 + 판정 규칙


def money(v):
    return f"${v:,.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ratio", type=float, help="실측 글자당 토큰 비율 (넣으면 이 값만 사용)")
    args = ap.parse_args()

    results = json.loads(RESULTS.read_text(encoding="utf-8"))
    docs = [r for r in results if r["status"] == "성공"]
    elig = [r for r in docs if r["hasEligibility"]]
    n_prog = len({r["pblancId"] for r in results})

    all_chars = sum(r["chars"] for r in docs)
    elig_chars = sum(r["chars"] for r in elig)
    per_grant_all = all_chars / n_prog
    per_grant_elig = elig_chars / n_prog

    ratios = [("실측", args.ratio)] if args.ratio else RATIO_RANGE

    L = []
    w = L.append
    w("# C-6 AI 비용 산정\n")
    w("> `scripts/research/estimate_cost.py` 산출물. C-1 실측 글자수 기반.\n")
    w("> ⚠ **토큰 수는 추정치다.** 정확한 값은 `count_tokens` 엔드포인트로 재야 하는데")
    w("> 이 환경에 자격증명이 없다. 아래는 글자→토큰 비율을 범위로 둔 계산이다.")
    w("> 키가 생기면 `--ratio` 로 실측값을 넣어 다시 돌릴 것.\n")

    w("## 1. 입력 규모 (C-1 실측)\n")
    w("| 항목 | 값 |")
    w("|---|---:|")
    w(f"| 표본 공고 | {n_prog}건 |")
    w(f"| 추출 성공 문서 전체 | {all_chars:,}자 (공고당 {per_grant_all:,.0f}자) |")
    w(f"| **자격 단서로 선별 후** | **{elig_chars:,}자 (공고당 {per_grant_elig:,.0f}자)** |")
    w(f"| 프롬프트 오버헤드 | 공고당 {PROMPT_OVERHEAD_CHARS:,}자 (시스템+스키마+규칙) |")
    w(f"| 출력 예상 | 공고당 {OUT_CHARS_PER_GRANT:,}자 (구조화 JSON + 근거) |")
    w("")
    w(f"→ 선별을 적용하면 투입 글자가 **{100 - 100 * elig_chars / all_chars:.0f}% 줄어든다.** "
      "(C-1 결론: 파일명이 아니라 내용으로 거른다)\n")

    in_chars = per_grant_elig + PROMPT_OVERHEAD_CHARS

    w("## 2. 공고 1건당 토큰 추정\n")
    w("| 시나리오 | 글자당 토큰 | 입력 토큰 | 출력 토큰 |")
    w("|---|---:|---:|---:|")
    for label, ratio in ratios:
        w(f"| {label} | {ratio} | {in_chars * ratio:,.0f} | {OUT_CHARS_PER_GRANT * ratio:,.0f} |")

    w("\n## 3. 비용\n")
    w(f"기본 모델 **`{DEFAULT_MODEL}`** 기준. Batch API 는 **50% 할인**이 적용된다 —")
    w("야간 배치라 지연에 민감하지 않으므로 배치가 맞다.\n")

    for label, ratio in ratios:
        tin = in_chars * ratio
        tout = OUT_CHARS_PER_GRANT * ratio
        w(f"### {label} 시나리오 (글자당 {ratio} 토큰)\n")
        w("| 모델 | 최초 백필 1,533건 | 배치 적용 | 일일 45건 | 월간(배치) |")
        w("|---|---:|---:|---:|---:|")
        for model, (pin, pout) in PRICING.items():
            def cost(n):
                return (n * tin / 1e6) * pin + (n * tout / 1e6) * pout
            backfill = cost(TOTAL_GRANTS)
            daily = cost(DAILY_NEW)
            mark = " ⭐" if model == DEFAULT_MODEL else ""
            w(f"| `{model}`{mark} | {money(backfill)} | {money(backfill / 2)} | "
              f"{money(daily)} | {money(daily / 2 * 30)} |")
        w("")

    w("## 4. 비용을 줄이는 수단 (효과 순)\n")
    w("| 수단 | 효과 | 비고 |")
    w("|---|---|---|")
    w("| **재분석 회피** (`content_hash`) | 일일 비용의 대부분 | 내용이 안 바뀐 공고는 다시 분석하지 않는다. 이게 1순위 |")
    w("| **Batch API** | **50%** | 야간 배치라 지연 무관. 최초 백필에 특히 |")
    w(f"| **내용 선별** | **{100 - 100 * elig_chars / all_chars:.0f}%** | 자격 단서 없는 문서는 AI에 넣지 않는다 |")
    w("| **프롬프트 캐싱** | 시스템 프롬프트 부분 ~90% | 스키마·판정규칙이 전 요청 공통. **Batch 와 병용 가능한지 확인 필요** |")
    w("| `effort` 하향 | 가변 | 정확도와 맞바꾼다. 골든셋(A-4)으로 측정한 뒤 결정 |")
    w("")
    w("> **최초 백필은 1회성이다.** 지속 비용은 일일 증분이고, 재분석 회피가 걸리면")
    w("> 실제로는 신규 공고 약 45건만 분석한다.\n")

    w("## 5. 확정 사항\n")
    w(f"- **모델**: `{DEFAULT_MODEL}` — 자격 조건 추출은 오탐이 곧 매칭 사고이므로 정확도 우선.")
    w("  더 싼 모델로 내리는 결정은 골든셋(A-4) 정확도를 측정한 뒤 GH가 판단한다.")
    w("- **Batch API 사용** — 최초 백필과 일일 증분 모두. 지연 민감도 없음.")
    w("- **재분석 회피** — `content_hash` 가 같으면 건너뛴다 (A-8 버전 관리와 같은 해시 사용).")
    w("- **내용 선별** — 자격 단서가 있는 문서만 AI에 넣는다 (C-1 결론).")
    w("")
    w("## 6. 남은 확인\n")
    w("- [ ] `count_tokens` 로 실제 글자→토큰 비율 측정 → `--ratio` 로 재계산")
    w("- [ ] Batch API 와 프롬프트 캐싱 병용 가능 여부 확인")
    w("- [ ] 출력 토큰 예상치(2,500자)를 골든셋 스키마 확정 후 재산정")

    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"[cost] per-grant input chars: {in_chars:,.0f}")
    print(f"[cost] report: {OUT_MD}")


if __name__ == "__main__":
    main()
