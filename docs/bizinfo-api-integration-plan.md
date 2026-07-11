# 기업마당(Bizinfo) 오픈 API 연동 계획서

> 작성일: 2026-07-11
> 목표: 현재 정적 CSV 스냅샷(`public/data/policy_fund_20260205_data.csv`) 기반의 공고 데이터를
> 기업마당 지원사업정보 오픈 API로 대체하여 **자동으로 최신 공고가 갱신**되도록 한다.

---

## 1. 현재 구조 진단

| 항목 | 현재 상태 |
|---|---|
| 앱 형태 | Vite + React **정적 SPA** (GitHub Pages 배포 전제, 별도 백엔드 없음) |
| 데이터 소스 | ① 구글 시트 CSV(미설정) → ② `public/data/*.csv` (2026-02-05 스냅샷) → ③ MOCK_GRANTS |
| 데이터 파이프라인 | `services/csvService.ts`가 CSV 파싱 + 스마트 태깅 → `pages/Dashboard.tsx`에서 필터/매칭 |
| CSV 스키마 | `번호, 소관부처, 사업수행기관, 지원분야, 공고명, 신청시작일자, 신청종료일자, 등록일자, 공고상세URL` |
| 기존 서버 대체재 | Google Apps Script (상담 접수 / 사업자번호 검증에 이미 사용 중) |

**문제점**: 공고 데이터가 2026-02-05에 멈춰 있고, 갱신하려면 CSV를 수동으로 교체해야 함.
대시보드의 "기업마당 공고 데이터가 동기화 되었습니다" 문구도 실제 동기화 없이 하드코딩된 상태.

---

## 2. 기업마당 오픈 API 개요

- **API 명**: 지원사업정보 API (기업마당 > 활용정보 > 정책정보 개방)
- **엔드포인트**: `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do`
- **인증**: 쿼리 파라미터 `crtfcKey` (기업마당 사이트에서 인증키 신청·발급, 신청 시 활용 시스템 URL 또는 IP 기재)
- **포맷**: `dataType=json` 또는 RSS(XML)
- **주요 요청 파라미터** (공식 문서로 최종 확인 필요):

| 파라미터 | 설명 |
|---|---|
| `crtfcKey` | 발급받은 인증키 (필수) |
| `dataType` | `json` / `rss` |
| `searchCnt` | 조회 건수 |
| `searchLclasId` | 지원분야 대분류 코드 (금융/기술/인력/수출/내수/창업/경영/기타) |
| `hashtags` | 지역·키워드 해시태그 필터 (예: `서울,창업`) |

- **주요 응답 필드 → 앱 `Grant` 타입 매핑(안)**:

| API 필드 | 의미 | Grant 필드 |
|---|---|---|
| `pblancId` | 공고 ID (PBLN_...) | `id` |
| `pblancNm` | 공고명 | `title` |
| `jrsdInsttNm` | 소관부처 | `department` |
| `excInsttNm` | 수행기관 | `agency` |
| `pldirSportRealmLclasCodeNm` | 지원분야(대분류) | `category` |
| `reqstBeginEndDe` | 신청기간 (`YYYYMMDD ~ YYYYMMDD`) | `startDate` / `endDate` 분해 |
| `creatPnttm` | 등록일시 | `registrationDate` |
| `pblancUrl` | 상세 URL (상대경로 → `https://www.bizinfo.go.kr` 접두 필요) | `detailUrl` |
| `bsnsSumryCn` | 사업개요 (HTML 포함) | `summary` (태그 제거 후) |
| `hashtags` | 해시태그 | `tags` 보강 |
| `inqireCo` | 실제 조회수 | `views` (현재 랜덤값 대체) |
| `trgetNm` | 지원대상 | (신규 필드 후보) |

> ⚠️ 필드명은 공개 자료 기준이며, 인증키 발급 후 실제 응답 1건을 받아 최종 확인한다.
> (이 계획 작성 환경에서는 bizinfo.go.kr 접속이 차단되어 공식 문서 원문 대조를 하지 못함)

---

## 3. 핵심 제약: 브라우저에서 직접 호출하면 안 되는 이유

1. **CORS**: 기업마당 API는 브라우저 교차출처 호출(CORS 헤더)을 지원하지 않아 SPA에서 `fetch`가 차단됨.
2. **인증키 노출**: 정적 프론트엔드 코드에 `crtfcKey`를 넣으면 누구나 소스에서 키를 볼 수 있음.

→ 따라서 **중간 계층(동기화 배치 또는 프록시)** 이 반드시 필요하다.

---

## 4. 아키텍처 대안 비교

### A안 — GitHub Actions 스케줄 동기화 ✅ (권장)

```
[GitHub Actions (매일 새벽 cron)]
  → 기업마당 API 호출 (키는 GitHub Secrets)
  → 기존 CSV 스키마로 변환 → public/data/ 에 커밋
  → GitHub Pages 자동 재배포
[브라우저] → 지금과 동일하게 정적 CSV 로드 (코드 변경 최소)
```

- 장점: 프론트 변경 거의 없음 / 키 완전 비공개 / 무료 / 실패해도 직전 CSV가 남아 **안전**
- 단점: 실시간이 아닌 일 단위 갱신 (공고 특성상 일 1회면 충분)

### B안 — Google Apps Script 프록시 (준실시간)

- 이미 사용 중인 Apps Script 패턴 재활용. `doGet`에서 API 호출 + `CacheService`(예: 6시간) 캐싱 후 CSV/JSON 반환.
- `csvService.ts`의 `GOOGLE_SHEET_GRANT_URL` 자리에 스크립트 URL만 넣으면 연결됨.
- 장점: 접속 시점 기준 준실시간. 단점: Apps Script 쿼터/응답 지연, 장애 시 진단 어려움.

### C안 — 서버리스 프록시 (Cloudflare Workers / Vercel Functions)

- 가장 유연하지만 현재 스택(백엔드 없음) 대비 과한 인프라. 향후 확장 시 재검토.

**결론: A안을 기본으로 구축하고, 필요 시 B안을 보조(실시간 새로고침 버튼)로 추가.**

---

## 5. 단계별 실행 계획

### 0단계 — 인증키 발급 (사람이 해야 하는 일, 선행 필수)
- [ ] 기업마당(bizinfo.go.kr) 회원가입 → 활용정보 > 정책정보 개방 > **지원사업정보 API** > 인증키 신청
- [ ] 신청서에 활용 목적/시스템 URL 기재 (승인까지 통상 1~2 영업일)
- [ ] 발급된 키로 브라우저에서 1회 테스트 호출하여 실제 응답 필드 확인:
  `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=발급키&dataType=json&searchCnt=5`
- [ ] GitHub 저장소 Settings > Secrets and variables > Actions에 `BIZINFO_API_KEY` 등록

### 1단계 — 동기화 스크립트 작성 (`scripts/sync-bizinfo.mjs`)
- [ ] API 호출 (전 분야, 필요 시 `searchLclasId`별 반복 호출로 전체 수집)
- [ ] 필드 매핑(§2 표) 및 정제:
  - `reqstBeginEndDe` → `신청시작일자`/`신청종료일자` 분해 (`상시`, `예산 소진 시까지` 등 예외 처리)
  - `pblancUrl` 절대경로화, `pblancId` 기준 중복 제거
  - 마감일이 지난 공고 제외(옵션) — 현재 UI가 마감 공고를 별도 처리하지 않으므로 기본 제외 권장
- [ ] 기존 CSV 헤더 그대로 `public/data/policy_fund_latest.csv` 저장
  (+ 선택: `summary`/`hashtags`/`views` 포함 확장 JSON `public/data/grants.json` 병행 생성)
- [ ] **안전장치**: API 실패 또는 결과 0건이면 기존 파일을 덮어쓰지 않고 종료 코드 1 반환

### 2단계 — GitHub Actions 워크플로 (`.github/workflows/sync-bizinfo.yml`)
- [ ] `schedule: cron '0 20 * * *'` (UTC 20시 = KST 새벽 5시) + `workflow_dispatch`(수동 실행)
- [ ] 스크립트 실행 → 변경분 있을 때만 커밋/푸시 → Pages 배포 트리거
- [ ] 실패 시 알림 (Actions 기본 이메일 알림 활용)

### 3단계 — 프론트엔드 보강 (`csvService.ts`, `Dashboard.tsx`)
- [ ] `LOCAL_GRANT_CSV`를 최신 파일명으로 교체 (또는 `grants.json` 우선 로드 추가)
- [ ] `views: Math.floor(Math.random()*1000)` → API의 실제 조회수(`inqireCo`)로 대체
- [ ] `bsnsSumryCn` 기반 `summary` 표시, `hashtags`로 스마트 태깅 보강
- [ ] 배너의 `getLastMonday()` 하드코딩 문구 → 실제 동기화 시각 표시
  (동기화 스크립트가 `public/data/meta.json`에 `syncedAt` 기록)
- [ ] "정렬: 마감임박순" 라벨을 실제 정렬 로직으로 구현

### 4단계 — 검증 및 운영
- [ ] 로컬에서 `BIZINFO_API_KEY=... node scripts/sync-bizinfo.mjs` 실행 → 건수/필드 검수
- [ ] 수동 `workflow_dispatch` 1회 실행 → Pages 반영 확인
- [ ] 1주 운영 후 지역 매핑 정확도 점검 (현재 지역 필터가 `소관부처/공고명` 문자열 포함 방식이라, API의 지역 해시태그를 쓰면 정확도 개선 가능)

---

## 6. 예상 공수

| 작업 | 공수 |
|---|---|
| 인증키 발급 대기 | 1~2 영업일 (작업 아님) |
| 1~2단계 (스크립트 + Actions) | 반나절 |
| 3단계 (프론트 보강) | 반나절 |
| 4단계 (검증) | 1~2시간 |

## 7. 리스크 및 대응

| 리스크 | 대응 |
|---|---|
| 인증키가 IP 제한 방식으로 발급될 경우 GitHub Actions(가변 IP)에서 호출 불가 | 신청 시 "시스템 URL" 방식으로 등록. IP 고정이 강제되면 B안(Apps Script) 또는 고정 IP 프록시로 전환 |
| API 필드명/스펙 상이 | 0단계에서 실제 응답 1건으로 매핑표 검증 후 스크립트 확정 |
| API 장애/응답 0건 | 스크립트가 기존 CSV를 보존(덮어쓰기 금지)하므로 서비스 영향 없음 |
| 공고량 증가에 따른 페이지네이션 | `searchCnt` 상한 확인 후 분야별 분할 호출 또는 페이지 반복 호출 |
