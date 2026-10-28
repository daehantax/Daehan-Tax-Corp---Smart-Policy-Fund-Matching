-- grant_documents — 첨부파일에서 뽑아낸 글자 (WORK_PLAN.md A-3)
--
-- 왜 필요한가:
--   공고 본문만으로는 자격 기준선이 68~96% 밖에 안 읽힌다(C-9). 못 읽은 공고는
--   「별표 참조」·「공고문 참조」로 넘기고, 그 내용은 첨부파일 안에 있다.
--   A-2 로 주소는 다 모았으니(3,142개), 여기에 그 글자를 담는다.
--
-- **파일은 보관하지 않는다.** 받아서 글자만 뽑고 버린다 —
--   보관할 자리도 필요 없고, 원문이 필요하면 policy_grants.attachments 에 주소가 남아 있다.
--
-- 열쇠가 url 인 이유:
--   같은 첨부가 여러 공고에 붙기도 하고(기업마당·중소벤처24 중복), 공고가 바뀌어도
--   파일이 그대로면 다시 받을 이유가 없다. **주소 하나당 한 번만 처리한다.**
--
-- status 값 — 실패와 「원래 못 읽는 것」을 구분한다:
--   ok               글자를 얻었다
--   empty            형식은 읽었는데 글자가 없다 (스캔한 이미지 PDF 등)
--   unsupported      못 읽는다고 **알고 있는** 형식. hwp(한글 바이너리)가 대부분이다
--   failed           읽으려다 깨졌다 (error 에 사유)
--   download_failed  내려받지 못했다
--   too_large        파일이 너무 커서 건너뛰었다
--
-- ⚠ hwp 는 이번에 다루지 않는다. 첨부가 있는 공고 1,497건 중 70.2% 는 pdf·hwpx 같은
--   쉬운 형식을 하나라도 갖고 있다(2026-10-28 실측). hwp 전용은 나중에 본다.
--
-- 채우는 쪽: scripts/extract-documents.mjs (.github/workflows/extract-documents.yml)
-- 추출기:    scripts/document-text.mjs

create table if not exists public.grant_documents (
  url          text primary key,
  pblanc_id    text not null,
  name         text,
  ext          text,
  status       text not null,
  text         text,
  chars        integer,
  bytes        integer,
  truncated    boolean not null default false,
  error        text,
  extracted_at timestamptz not null default now()
);

create index if not exists grant_documents_pblanc_id_idx on public.grant_documents (pblanc_id);
create index if not exists grant_documents_status_idx on public.grant_documents (status);

-- 앱은 이 표를 읽지 않는다. service_role(동기화·추출 스크립트)만 건드린다.
-- RLS 를 켜고 정책을 하나도 두지 않으면 anon 키로는 아무것도 보이지 않는다.
alter table public.grant_documents enable row level security;

comment on table public.grant_documents is
  '공고 첨부파일에서 뽑은 글자. 파일 자체는 보관하지 않는다. 주소 하나당 한 행(WORK_PLAN A-3)';
