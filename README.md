# 대한세무법인 — 맞춤형 정책자금 스마트 매칭

고객사가 **사업자등록번호만 입력하면** 회사의 지역·시·군·업종에 맞는 정부지원 공고를
골라 보여주는 고객사 전용 서비스입니다.

- 공고 데이터: 기업마당(Bizinfo) 오픈 API → 매일 새벽 자동 동기화
- 고객사 정보: 공용 DB(`clients`)를 Edge Function으로만 조회 — 고객 명단은 브라우저로 내려가지 않음
- 배포: GitHub Pages (main 브랜치 푸시 시 자동)

## 로컬 실행

```bash
npm install
npm run dev
```

수파베이스에 연결하려면 `.env.example`을 복사해 `.env.local`을 만들고 URL·anon 키를 채우세요.
비워두면 `public/data`의 CSV로 동작합니다. 자세한 연동 절차는 [docs/supabase-setup.md](docs/supabase-setup.md).

## 테스트

```bash
npm test
```

매칭 로직의 회귀 테스트입니다. 케이스는 **실제로 틀렸던 지점**에서 가져왔으므로,
실패하면 그 버그가 돌아온 것입니다.

| 파일 | 지키는 것 |
|---|---|
| `services/geo.test.ts` | 주소 판정(우편번호 접두·축약주소·통합 시도), 권역·비수도권, 동명 시·군 구분 |
| `services/matchingService.test.ts` | 지역·시·군 추출, 자격 없는 공고 제외, 업종 주의 표시 |
| `services/smartTags.test.ts` | 관심 키워드 태그의 오탐 방지 |
| `services/syncParity.test.ts` | **앱(TS)과 동기화 스크립트(JS)의 판정이 일치하는지** + 지원금액 추출 |
| `services/matchingGolden.test.ts` | 커밋된 공고 스냅샷으로 불변식 검증 (부적격 공고 0건 등) |

`syncParity`가 특히 중요합니다. 동기화 스크립트는 Node 단독 실행이라 앱의 TS 모듈을
불러올 수 없어 같은 규칙을 복제해 두고 있는데, 한쪽만 고치면 DB 값과 화면 계산이
조용히 어긋납니다.

배포 워크플로가 빌드 전에 `npm test`를 돌리므로, 새로 동기화된 데이터가 불변식을
깨면 배포가 막히고 알림이 옵니다.

## 구조

```
services/geo.ts              행정구역 판정 (시도·시군구·권역) — 지역 로직의 단일 출처
services/matchingService.ts  매칭 점수·자격 판정
services/csvService.ts       공고 로드(수파베이스 → 구글시트 → CSV 폴백) + 스마트 태깅
services/mockDb.ts           사업자번호 확인 (Edge Function → Apps Script 폴백)
data/administrative-divisions.json  행정구역 사전 (scripts/gen-divisions.mjs 로 생성)
scripts/sync-bizinfo.mjs     기업마당 API → CSV + 수파베이스 업서트 (GitHub Actions)
supabase/functions/verify-brn 사업자번호 대조 Edge Function
```

행정구역이 개편되면 [행정표준코드관리시스템](https://www.code.go.kr/stdcodesrch/codeAllDownloadL.do)에서
**법정동코드 전체자료**를 받아 `node scripts/gen-divisions.mjs`를 다시 실행하면 됩니다.

## 관련 저장소

- 공용 DB 스키마·변경 이력: `shared-db` (`policy_grants` 테이블은 마이그레이션 0015·0016)
