-- =============================================================================
-- verify_attempts — 고객사 확인(verify-brn) 호출 제한용 시도 기록
--
-- 왜 필요한가:
--   Edge Function 은 호출마다 새로 뜰 수 있어 메모리 변수로는 호출 횟수를 셀 수 없다.
--   같은 IP 로 짧은 시간에 이름을 반복 시도하는 것(특정 회사를 노린 대입)을 막기 위해
--   시도 기록을 DB 에 남기고 1분 내 횟수를 센다.
--
-- 개인정보:
--   IP 원문은 저장하지 않는다. Edge Function 이 VERIFY_IP_SALT 와 함께 SHA-256 해시한
--   값만 넣는다. 보관 기간은 24시간이며 함수 실행 중 확률적으로 정리된다.
--
-- 실행 방법: 수파베이스 대시보드 → SQL Editor 에 이 파일 내용을 붙여넣고 실행.
--   (supabase CLI 를 쓰면 `supabase db push` 로도 적용된다)
-- =============================================================================

create table if not exists public.verify_attempts (
  id           bigserial   primary key,
  ip_hash      text        not null,
  attempted_at timestamptz not null default now()
);

-- 최근 1분 내 같은 IP 의 시도를 세는 쿼리에 맞춘 인덱스
create index if not exists verify_attempts_ip_time_idx
  on public.verify_attempts (ip_hash, attempted_at desc);

-- RLS 전체 잠금 — 정책을 만들지 않으므로 anon/authenticated 는 읽기·쓰기 모두 불가.
-- service_role(Edge Function)만 접근한다. clients 테이블과 같은 원칙이다.
alter table public.verify_attempts enable row level security;

comment on table public.verify_attempts is
  '고객사 확인(verify-brn) 호출 제한용 시도 기록. IP는 해시로만 저장하고 24시간 후 정리된다.';
