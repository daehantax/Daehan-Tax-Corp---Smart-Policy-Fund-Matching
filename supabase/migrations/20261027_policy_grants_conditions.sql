-- policy_grants.conditions — 공고 본문에서 읽어낸 자격 기준선 (WORK_PLAN.md C-9)
--
-- 왜 필요한가:
--   공고에는 지금까지 `조건:매출액` 같은 **꼬리표만** 있고 몇 억인지가 없었다.
--   그래서 화면이 「공고문 확인 필요」라고만 말할 수 있었다.
--   중소벤처24가 구조화된 숫자를 줄 줄 알았으나 전부 빈 칸이었고(C-8),
--   본문을 규칙으로 읽으니 68~96% 가 읽혔다(C-9). 그 값을 여기에 담는다.
--
-- 왜 jsonb 인가:
--   축이 셋(매출·업력·인원)인데 앞으로 늘 수 있고(인증·업종코드), 각 축이 하한·상한
--   두 값을 가진다. 칸을 여섯 개 늘리는 대신 한 칸에 담는다.
--   서버에서 조건으로 거르지 않고 **앱이 전부 받아 화면에서 판정**하므로 인덱스가 필요 없다.
--
-- 모양 (읽어낸 축만 담는다 — **못 읽은 것과 「제한 없음」은 다르다**):
--   {
--     "revenue":   { "min": null,  "max": 300000000 },   -- 원
--     "years":     { "min": 3,     "max": null      },   -- 년 (0.5 = 6개월)
--     "employees": { "min": 5,     "max": 300       }    -- 명
--   }
--
-- 채우는 쪽: scripts/sync-bizinfo.mjs (매일 새벽). 읽는 쪽: services/csvService.ts
-- 판정 규칙: scripts/grant-thresholds.mjs · 비교: services/matchingService.ts
--
-- ⚠ 꼬리표가 있는 축만 담는다. 꼬리표 없이 숫자만 잡힌 공고는 오탐(誤探) 위험이 있다.

alter table public.policy_grants
  add column if not exists conditions jsonb;

comment on column public.policy_grants.conditions is
  '공고 본문에서 읽어낸 자격 기준선. {revenue|years|employees: {min,max}}. 읽어낸 축만 담는다(WORK_PLAN C-9)';
