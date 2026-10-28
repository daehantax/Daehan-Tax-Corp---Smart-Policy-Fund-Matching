-- policy_grants.attachments — 공고 첨부파일 주소 목록 (WORK_PLAN.md A-2)
--
-- 왜 필요한가:
--   본문만으로는 자격 기준선이 68~96% 밖에 안 읽힌다(C-9). 못 읽은 공고는 대부분
--   「별표 참조」·「공고문 참조」로 넘긴다 — 그 내용은 첨부파일 안에 있다.
--   그 파일을 읽으려면 먼저 **어디 있는지**를 알아야 한다. 이 칸이 그 주소다.
--
-- 긁지 않는다:
--   2026-10-28 조사에서 **두 출처 모두 첨부 주소를 API 로 그대로 준다**는 것이 확인됐다.
--     · 기업마당   fileNm/flpthNm 78.0% · printFileNm/printFlpthNm 100%
--     · 중소벤처24 pblancFileNm/pblancFileUrl 93.8% · pblancAttachNm/pblancAttach 78.6%
--   그래서 계획서의 옛 A-2(상세페이지 → atchFileId 추출)는 필요 없어졌다.
--
-- 모양 — 공고문 본문 파일을 **맨 앞에** 둔다(자격 조건이 가장 잘 적혀 있다):
--   [
--     { "name": "2026 카드수수료 지원사업 공고문.pdf",
--       "url":  "https://www.bizinfo.go.kr/cmm/fms/getImageFile.do?atchFileId=FILE_...&fileSn=1",
--       "ext":  "pdf" }
--   ]
--
-- ⚠ **주소만 담는다. 파일은 내려받지 않는다** — 내려받기·텍스트 추출은 A-3 이다.
-- ⚠ 첨부가 없으면 NULL 이다. 빈 배열은 넣지 않는다 — 「없다」와 「아직 안 봤다」를 섞지 않는다.
--
-- 채우는 쪽: scripts/sync-bizinfo.mjs (매일 새벽) · 파서: scripts/grant-attachments.mjs

alter table public.policy_grants
  add column if not exists attachments jsonb;

comment on column public.policy_grants.attachments is
  '공고 첨부파일 주소 목록 [{name,url,ext}]. 공고문 본문 파일이 맨 앞. 주소만 담고 파일은 받지 않는다(WORK_PLAN A-2)';
