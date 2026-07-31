# 수파베이스 연동 설정 가이드

이 문서는 정책자금 매칭 앱을 수파베이스(공용 DB)와 연결하는 절차입니다.
연동 항목은 두 가지입니다.

| 항목 | 데이터 | 방식 |
|---|---|---|
| ① 정책자금 공고 | `policy_grants` 테이블 (공개 데이터) | 앱이 anon 키로 직접 조회 |
| ② 고객사 사업자번호 확인 | `clients` 테이블 (비공개, RLS 잠금 유지) | Edge Function `verify-brn` 경유 |

모든 단계는 **설정 전에도 앱이 기존 방식(CSV/구글 스크립트)으로 정상 동작**하도록
폴백이 들어 있으므로, 순서대로 하나씩 진행하면 됩니다.

---

## 1. 테이블 만들기 (최초 1회)

shared-db 저장소의 `supabase/migrations/0015_policy_grants.sql` 내용을
수파베이스 대시보드 → **SQL Editor** 에 붙여넣고 실행합니다.

- `policy_grants` 테이블 + 인덱스 + "누구나 읽기(active=true만)" RLS 정책이 만들어집니다.
- 기존 테이블(clients 등)은 전혀 건드리지 않습니다.

## 2. Edge Function 배포 (최초 1회)

사업자번호 확인 함수(`supabase/functions/verify-brn/index.ts`)를 배포합니다.
[Supabase CLI](https://supabase.com/docs/guides/cli) 설치 후, 이 저장소 루트에서:

```bash
supabase login                                    # 최초 1회
supabase functions deploy verify-brn --project-ref <프로젝트REF>
```

`<프로젝트REF>`는 대시보드 URL의 `https://supabase.com/dashboard/project/여기` 부분입니다.

- 함수 안에서 쓰는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 수파베이스가
  **자동으로 주입**하므로 따로 설정할 것이 없습니다.
- 배포 후 대시보드 → Edge Functions 에서 `verify-brn`이 보이면 성공입니다.

## 3. GitHub 저장소 Secrets 등록

저장소 Settings → Secrets and variables → **Actions** 에 아래 4개를 등록합니다.
(값은 수파베이스 대시보드 → Settings → API 에서 확인)

| Secret 이름 | 값 | 용도 |
|---|---|---|
| `VITE_SUPABASE_URL` | 프로젝트 URL (`https://xxxx.supabase.co`) | 사이트 빌드(deploy-pages) |
| `VITE_SUPABASE_ANON_KEY` | anon public 키 | 사이트 빌드(deploy-pages) |
| `SUPABASE_URL` | 프로젝트 URL (위와 같은 값) | 공고 동기화(sync-bizinfo) |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role 키 (비밀!)** | 공고 동기화(sync-bizinfo) |

> ⚠ `service_role` 키는 DB 전체 권한을 가진 비밀 키입니다.
> **절대 코드·문서에 붙여넣지 말고 Secrets에만** 저장하세요.
> anon 키는 공개되어도 됩니다 (RLS가 접근을 통제).

## 4. 확인

1. Actions 탭 → **Sync Bizinfo Grants** 워크플로를 수동 실행(workflow_dispatch)
   → 로그에 `수파베이스 policy_grants 업서트 완료: N건`이 나오면 ① 완료.
   수파베이스 대시보드 → Table Editor → `policy_grants`에서 데이터 확인 가능.
2. 사이트 재배포 후 접속 → 브라우저 개발자도구(F12) 콘솔에
   `수파베이스에서 정책자금 N건을 불러왔습니다`가 나오면 앱 연동 완료.
3. 로그인 화면에서 실제 고객사 사업자번호 입력 → 상호명이 나오면 ② 완료.

## 로컬 개발

`.env.example`을 복사해 `.env.local`을 만들고 URL과 anon 키를 채운 뒤 `npm run dev`.
비워두면 기존 CSV/구글 스크립트 방식으로 동작합니다.

## 동작 원리 (요약)

- **공고 데이터 흐름**: 기업마당 API → (매일 새벽, GitHub Actions) →
  `policy_grants` 업서트 + CSV 갱신 → 앱은 수파베이스 우선 조회,
  실패 시 구글시트 → CSV 순으로 폴백. 마감된 공고는 삭제 대신 `active=false`로 숨김.
- **사업자번호 확인 흐름**: 앱 → Edge Function `verify-brn` →
  (서버 안에서만) `clients` 대조 → 일치 여부 + 상호명/대표자명/업태/주소힌트만 응답.
  고객 명단은 브라우저로 절대 내려가지 않고, `clients`의 RLS 잠금도 그대로입니다.
  수임 해지(`customer_type='해임'`)된 거래처는 고객사로 인정하지 않습니다.
  함수 호출 실패 시에만 기존 구글 Apps Script로 폴백합니다.
