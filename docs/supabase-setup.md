# 수파베이스 연동 설정 가이드

이 문서는 정책자금 매칭 앱을 수파베이스(공용 DB)와 연결하는 절차입니다.
연동 항목은 두 가지입니다.

| 항목 | 데이터 | 방식 |
|---|---|---|
| ① 정책자금 공고 | `policy_grants` 테이블 (공개 데이터) | 앱이 anon 키로 직접 조회 |
| ② 고객사 확인 | `clients` 테이블 (비공개, RLS 잠금 유지) | Edge Function `verify-brn` 경유 |

①(공고 데이터)은 설정 전에도 CSV 폴백으로 동작합니다.
**②(고객사 확인)에는 폴백이 없습니다** — 이 설정이 끝나야 조회가 됩니다.
예전 구글 Apps Script 폴백은 사업자번호 하나로 통과시켜 대표자 성명 2차 확인을
무력화하는 우회로였기 때문에 2026-08-10에 제거했습니다.

---

## 1. 테이블 만들기 (최초 1회)

shared-db 저장소의 `supabase/migrations/0015_policy_grants.sql` 내용을
수파베이스 대시보드 → **SQL Editor** 에 붙여넣고 실행합니다.

- `policy_grants` 테이블 + 인덱스 + "누구나 읽기(active=true만)" RLS 정책이 만들어집니다.
- 기존 테이블(clients 등)은 전혀 건드리지 않습니다.

이어서 이 저장소의 `supabase/migrations/20260810000000_verify_attempts.sql` 도
같은 방법으로 실행합니다.

- 고객사 확인 **호출 제한**(같은 IP 1분 5회)에 쓰는 `verify_attempts` 테이블입니다.
- IP 는 원문이 아니라 해시로만 저장하고 24시간 후 정리됩니다.
- 이 테이블이 없어도 조회 자체는 동작하지만 **호출 제한이 걸리지 않습니다**
  (함수 로그에 실패가 남습니다).

## 2. Edge Function 배포 (최초 1회)

고객사 확인 함수(`supabase/functions/verify-brn/index.ts`)를 배포합니다.
[Supabase CLI](https://supabase.com/docs/guides/cli) 설치 후, 이 저장소 루트에서:

```bash
supabase login                                    # 최초 1회
supabase secrets set VERIFY_IP_SALT=<임의의 긴 문자열> --project-ref <프로젝트REF>
supabase functions deploy verify-brn --project-ref <프로젝트REF>
```

`<프로젝트REF>`는 대시보드 URL의 `https://supabase.com/dashboard/project/여기` 부분입니다.

- 함수 안에서 쓰는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 수파베이스가
  **자동으로 주입**하므로 따로 설정할 것이 없습니다.
- `VERIFY_IP_SALT` 는 접속 IP 를 해시할 때 쓰는 솔트입니다. 미설정이어도 함수는
  동작하지만(로그에 경고) 같은 IP 가 같은 해시로 남으므로 값을 넣어 두는 게 좋습니다.
  대시보드 → Edge Functions → Secrets 에서 넣어도 됩니다.
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
3. 조회 화면에서 실제 고객사 **사업자번호 + 대표자 성명** 입력 → 상호명이 나오면 ② 완료.
4. 같은 번호로 1분에 6번 이상 시도 → "조회 시도가 너무 많습니다" 안내가 나오면 호출 제한 완료.

## 로컬 개발

`.env.example`을 복사해 `.env.local`을 만들고 URL과 anon 키를 채운 뒤 `npm run dev`.

- 공고 데이터는 비워둬도 CSV 폴백으로 보입니다.
- **고객사 조회는 폴백이 없으므로** `.env.local` 없이는 "일시적인 오류"가 표시됩니다
  (정상 동작입니다 — 우회 경로를 없앤 결과입니다).

## 동작 원리 (요약)

- **공고 데이터 흐름**: 기업마당 API → (매일 새벽, GitHub Actions) →
  `policy_grants` 업서트 + CSV 갱신 → 앱은 수파베이스 우선 조회,
  실패 시 구글시트 → CSV 순으로 폴백. 마감된 공고는 삭제 대신 `active=false`로 숨김.
- **고객사 확인 흐름**: 앱(사업자번호 + 대표자 성명) → Edge Function `verify-brn` →
  (서버 안에서만) `clients` 대조 → 일치 여부 + 상호명/업태/종목/주소힌트만 응답.
  고객 명단은 브라우저로 절대 내려가지 않고, `clients`의 RLS 잠금도 그대로입니다.
  수임 해지(`customer_type='해임'`)된 거래처는 고객사로 인정하지 않습니다.
  - **대표자 성명은 응답에 담지 않습니다** — 화면에서 쓰지 않는 개인정보이고,
    이제 입력 대조용으로만 쓰입니다.
  - 공동사업자는 대표자 중 **한 분의 성함만 맞으면** 통과합니다. 이름은 공백을 모두
    지운 뒤 정확히 대조합니다(`홍 길동` = `홍길동`).
  - 번호가 틀렸는지 이름이 틀렸는지 **구분해서 알려주지 않습니다**. 구분해 주면
    "번호는 맞다"는 사실이 새어나가 고객사 명단 확인 수단이 됩니다.
  - **폴백 경로는 없습니다.** 함수 호출이 실패하면 "일시적인 오류" 안내를 띄웁니다.
