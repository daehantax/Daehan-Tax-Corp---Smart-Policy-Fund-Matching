// =============================================================================
// 기업마당(Bizinfo) 지원사업정보 API → 정적 데이터 동기화 스크립트
//
// 사용법:
//   BIZINFO_API_KEY=발급받은키 node scripts/sync-bizinfo.mjs
//
// 동작:
//   1. 기업마당 오픈 API(JSON)를 호출해 최신 공고 목록을 받는다.
//   2. 기존 CSV 스키마(번호,소관부처,...)로 변환해 public/data/policy_fund_latest.csv 저장
//   3. 동기화 시각/건수를 public/data/grants_meta.json 에 기록
//
// 안전장치: API 실패 또는 결과 0건이면 기존 파일을 절대 덮어쓰지 않고 종료코드 1로 끝난다.
//           (GitHub Pages에는 직전 데이터가 그대로 남아 서비스에 영향 없음)
// =============================================================================

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';
const API_KEY = process.env.BIZINFO_API_KEY;
// 기업마당이 GitHub 서버의 직접 접속을 차단할 때 사용하는 우회 경로.
// docs/google-apps-script-bizinfo-relay.gs 를 웹앱으로 배포한 URL을
// 저장소 시크릿 BIZINFO_RELAY_URL 로 등록하면 직접 호출 실패 시 자동 사용된다.
const RELAY_URL = process.env.BIZINFO_RELAY_URL || '';
const SEARCH_CNT = Number(process.env.BIZINFO_SEARCH_CNT || 1000); // 1회 조회 건수
const DROP_EXPIRED = process.env.BIZINFO_KEEP_EXPIRED !== '1';     // 마감 지난 공고 제외(기본)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_CSV = path.join(ROOT, 'public/data/policy_fund_latest.csv');
const OUT_META = path.join(ROOT, 'public/data/grants_meta.json');

// --- 유틸 --------------------------------------------------------------------

/** 여러 후보 키 중 값이 있는 첫 번째를 반환 (API 필드명 변형 대비) */
function pick(item, keys) {
  for (const k of keys) {
    const v = item?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** HTML 태그 제거 + 기본 엔티티 복원 */
function stripHtml(s) {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "20260201 ~ 20260228" / "2026-02-01~2026-02-28" 등에서 시작/종료일 추출 */
function parsePeriod(raw) {
  const digits = (raw || '').match(/\d{4}[-.]?\d{2}[-.]?\d{2}/g) || [];
  const norm = digits.map(d => {
    const n = d.replace(/[-.]/g, '');
    return `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}`;
  });
  return {
    start: norm[0] || '',
    end: norm.length > 1 ? norm[norm.length - 1] : (norm[0] || ''),
    raw: (raw || '').trim(), // '상시', '예산 소진시까지' 등 원문 보존용
  };
}

/** CSV 필드 이스케이프 */
function csvField(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// --- 메인 --------------------------------------------------------------------

async function main() {
  if (!API_KEY) {
    console.error('[sync-bizinfo] 환경변수 BIZINFO_API_KEY가 설정되지 않았습니다.');
    process.exit(1);
  }

  // 일시적 네트워크 오류(접속 타임아웃 등) 대비: 최대 4회, 점점 길게 기다리며 재시도
  async function fetchWithRetry(url, attempts = 4) {
    for (let i = 1; i <= attempts; i++) {
      try {
        return await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        if (i === attempts) throw err;
        const waitSec = 15 * i;
        console.warn(`[sync-bizinfo] 호출 실패(${i}/${attempts}): ${err.cause?.code || err.name}. ${waitSec}초 후 재시도...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
    }
  }

  async function fetchItems(cnt) {
    const query = `crtfcKey=${encodeURIComponent(API_KEY)}&dataType=json&searchCnt=${cnt}`;
    console.log(`[sync-bizinfo] API 호출: ${API_URL} (searchCnt=${cnt})`);

    let res;
    try {
      res = await fetchWithRetry(`${API_URL}?${query}`);
    } catch (err) {
      if (!RELAY_URL) throw err;
      console.warn(`[sync-bizinfo] 직접 호출 실패(${err.cause?.code || err.name}) → 구글 중계(RELAY) 경유로 재시도`);
      const sep = RELAY_URL.includes('?') ? '&' : '?';
      res = await fetchWithRetry(`${RELAY_URL}${sep}${query}`);
    }
    if (!res.ok) {
      console.error(`[sync-bizinfo] API 응답 오류: HTTP ${res.status}`);
      console.error(await res.text().catch(() => ''));
      process.exit(1);
    }

    const bodyText = await res.text();
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      console.error('[sync-bizinfo] JSON 파싱 실패. 응답 앞부분:');
      console.error(bodyText.slice(0, 1000));
      console.error('※ 인증키 오류(HTML 오류 페이지) 또는 dataType 미지원일 수 있습니다.');
      process.exit(1);
    }

    // 응답 구조 방어적 탐색: 문서상 jsonArray 이지만 변형 대비
    const found =
      data?.jsonArray ??
      data?.item ??
      data?.items ??
      data?.body?.items ??
      (Array.isArray(data) ? data : null);

    if (!Array.isArray(found) || found.length === 0) {
      console.error('[sync-bizinfo] 공고 목록을 찾지 못했습니다. 응답 최상위 키:', Object.keys(data ?? {}));
      console.error('응답 앞부분:', bodyText.slice(0, 1000));
      process.exit(1);
    }
    return found;
  }

  let items = await fetchItems(SEARCH_CNT);

  // API가 알려주는 전체 건수(totCnt)가 이번 조회보다 많으면 전체를 다시 조회
  const totCnt = Number(items[0]?.totCnt || 0);
  if (totCnt > items.length) {
    console.log(`[sync-bizinfo] 전체 ${totCnt}건 중 ${items.length}건만 수신 → 전체 재조회`);
    items = await fetchItems(totCnt);
  }

  // 첫 항목의 실제 필드명을 로그로 남겨 스펙 검증에 활용
  console.log(`[sync-bizinfo] 수신 ${items.length}건. 첫 항목 필드:`, Object.keys(items[0]).join(', '));

  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  const rows = [];
  let expired = 0;
  let no = 0;

  for (const item of items) {
    const id = pick(item, ['pblancId', 'pblancSn', 'id']);
    const title = stripHtml(pick(item, ['pblancNm', 'title', 'pblancNmKr']));
    if (!title) continue;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);

    const period = parsePeriod(pick(item, ['reqstBeginEndDe', 'reqstDe', 'rceptEngnHmpgUrl_period']));
    if (DROP_EXPIRED && period.end && period.end < today) { expired++; continue; }

    let detailUrl = pick(item, ['pblancUrl', 'url', 'link']);
    if (detailUrl && detailUrl.startsWith('/')) detailUrl = `https://www.bizinfo.go.kr${detailUrl}`;

    const registered = pick(item, ['creatPnttm', 'creatDe', 'registDe', 'pubDate']).slice(0, 10).replace(/\./g, '-');

    rows.push([
      ++no,                                                                        // 번호
      pick(item, ['jrsdInsttNm', 'jrsdInsttNmKr', 'department']) || '관계부처',    // 소관부처
      pick(item, ['excInsttNm', 'operInsttNm', 'agency']),                         // 사업수행기관
      stripHtml(pick(item, ['pldirSportRealmLclasCodeNm', 'lclasNm', 'category'])) || '기타', // 지원분야
      title,                                                                       // 공고명
      period.start,                                                                // 신청시작일자
      period.end,                                                                  // 신청종료일자
      registered,                                                                  // 등록일자
      detailUrl || '#',                                                            // 공고상세URL
      period.start ? '' : period.raw,                                              // 신청기간(원문) — 날짜 파싱 불가 시 '상시' 등 표시용
      stripHtml(pick(item, ['trgetNm'])),                                          // 지원대상
      stripHtml(pick(item, ['bsnsSumryCn'])).slice(0, 300),                        // 사업개요(요약)
      stripHtml(pick(item, ['hashtags'])),                                         // 해시태그 (지역/분야 정밀 매칭용)
      stripHtml(pick(item, ['pldirSportRealmMlsfcCodeNm'])),                       // 지원분야 중분류
      pick(item, ['inqireCo']),                                                    // 조회수 (기업마당 실제 조회수)
    ]);
  }

  if (rows.length === 0) {
    console.error('[sync-bizinfo] 변환 후 공고가 0건입니다. 필드 매핑을 확인하세요. (기존 파일 유지)');
    process.exit(1);
  }

  const header = ['번호', '소관부처', '사업수행기관', '지원분야', '공고명', '신청시작일자', '신청종료일자', '등록일자', '공고상세URL', '신청기간', '지원대상', '사업개요', '해시태그', '지원분야중분류', '조회수'];
  const csv = '﻿' + [header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';

  await mkdir(path.dirname(OUT_CSV), { recursive: true });
  await writeFile(OUT_CSV, csv, 'utf8');
  await writeFile(
    OUT_META,
    JSON.stringify({ syncedAt: new Date().toISOString(), count: rows.length, expiredDropped: expired, source: 'bizinfo-api' }, null, 2),
    'utf8',
  );

  console.log(`[sync-bizinfo] 완료: ${rows.length}건 저장 (마감 제외 ${expired}건) → ${path.relative(ROOT, OUT_CSV)}`);
}

main().catch(err => {
  console.error('[sync-bizinfo] 실패:', err);
  process.exit(1);
});
