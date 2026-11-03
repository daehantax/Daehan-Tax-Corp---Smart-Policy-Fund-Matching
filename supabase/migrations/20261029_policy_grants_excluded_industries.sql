-- policy_grants.excluded_industries — 공고가 제외하는 업종 (WORK_PLAN.md C-12)
--
-- 왜 필요한가 (2026-10-29 실측):
--   C-11 에서 첨부 글자 1,375만 자를 훑었더니 **기준선 숫자는 한 건도** 더 못 읽었는데,
--   제외 업종 목록은 **156건**에서 나왔다. 그리고 이건 우리 거래처에 실제로 걸린다 —
--   영업 중인 1,483곳 중 **377곳(25.4%)** 이 어딘가의 제외 목록에 오르는 업종이다
--   (부동산임대 318 · 부동산중개 45). **거래처 넷 중 하나**가 자격 없는 공고를 받고 있었다.
--
-- ⚠ **왜 conditions(jsonb)에 같이 넣지 않는가**
--   `conditions` 는 동기화(sync-bizinfo.mjs)가 매번 **통째로 덮어쓴다.** 그런데 제외 업종은
--   동기화가 아니라 **첨부 글자를 읽는 별도 단계**(apply-exclusions.mjs)에서 나온다.
--   같은 칸에 두면 동기화가 돌 때마다 지워진다. 그래서 칸을 따로 둔다.
--
-- 담기는 모양:
--   { "tags": ["부동산임대","유흥주점"],   -- scripts/industry-sectors.mjs 의 꼬리표 11종
--     "ksic": ["56211","91113"],          -- 공고가 코드까지 적어 준 경우 (통계청 5자리)
--     "standardList": true }              -- 「중소기업 정책자금 융자제외 대상업종」 참조 여부
--
--   NULL 은 **「제외 업종이 없다」가 아니라 「모른다」** 다. 둘을 섞으면 안 된다.
--
-- ⚠ 이 값으로 공고를 **지우지 않는다.** 제외(score 0)는 지역·시·군에서만 한다
--   (CLAUDE.md 「깨뜨리면 안 되는 것」). 화면에는 **경고**로만 나간다 —
--   공고가 「단, ○○는 가능」 예외를 두거나 우리가 업종을 잘못 읽었을 수 있어서다.
--
-- 채우는 쪽: scripts/apply-exclusions.mjs (.github/workflows/extract-documents.yml)
-- 읽는 쪽:   services/matchingService.ts

alter table public.policy_grants
  add column if not exists excluded_industries jsonb;

comment on column public.policy_grants.excluded_industries is
  '공고가 제외하는 업종의 꼬리표·KSIC 코드. NULL 은 「없다」가 아니라 「모른다」 (WORK_PLAN C-12)';
