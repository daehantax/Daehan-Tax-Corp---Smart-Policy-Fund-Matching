import Papa from 'papaparse';
import { BizCategory, BizRegionType, BizRegions, Grant } from '../types';
import { MOCK_GRANTS } from '../constants';
import { supabase } from './supabaseClient';
import { extractRegionCodes, extractSigunguCodes } from './matchingService';
import { resolveAddress } from './geo';

// ==============================================================================
// 정책자금(공고) 데이터 소스 설정
// ※ 고객 명단은 개인정보 보호를 위해 이 앱에서 절대 로드하지 않습니다.
//    사업자번호 확인은 services/mockDb.ts를 통해 서버에서 처리됩니다.
// ==============================================================================

// [1순위] 수파베이스 policy_grants 테이블 (실시간 연동)
// - services/supabaseClient.ts 에 연결 정보가 설정되어 있으면 가장 우선 사용합니다.
// - 데이터는 GitHub Actions(scripts/sync-bizinfo.mjs)가 기업마당 API에서 매일 업서트합니다.

// [2순위] 구글 스프레드시트
// - 스프레드시트 '웹에 게시' 링크를 넣으면 수파베이스 실패 시 이 데이터를 사용합니다.
const GOOGLE_SHEET_GRANT_URL = '' as string;

// [3순위] 로컬 파일 (서버 파일)
// - 구글 시트 링크가 없거나 연결 실패 시, public/data 폴더에 있는 파일을 순서대로 시도합니다.
// - policy_fund_latest.csv 는 기업마당 오픈 API 동기화(GitHub Actions)가 매일 갱신하는 파일이며,
//   아직 생성 전이거나 로드 실패 시 기존 스냅샷 파일로 폴백합니다.
// - GitHub Pages처럼 하위 경로로 서빙되는 환경에서도 동작하도록 상대 경로를 사용합니다.
const LOCAL_GRANT_CSV_CANDIDATES = [
  './data/policy_fund_latest.csv',
  './data/policy_fund_20260205_data.csv',
];

let cachedGrantDb: Grant[] | null = null;

// ==============================================================================
// 스마트 태깅 — 사장님이 고르는 관심 키워드 6종을 공고에 붙인다 (수파베이스/CSV 공용)
//
// 예전에는 넓은 단어를 텍스트 전체에서 찾았다(기술|연구|개발|r&d|특허 …). 그 결과
//   · 🧪 기술개발이 전체의 46%(671건)에 붙어 필터로서 의미가 없었다 ('기술' 한 단어로 575건)
//   · "기술자료 임치 수수료 지원"이 '금융'·'보증' 언급 때문에 💵 저금리 대출로 잡혀
//     저금리 대출을 고른 부동산 임대업 고객사의 추천 1위에 올라왔다
//   · '구축'(기반 구축·플랫폼 구축)이 🏭 시설/기계구입으로 잡혔다
//
// 그래서 판정 순서를 바꿨다.
//   1순위 sub_category — 기업마당이 사람 손으로 분류한 중분류. 우리 정규식보다 정확하다.
//   2순위 텍스트 키워드 — 부수 언급에 걸리지 않는 좁은 단어만 남긴다.
//
// 빼기로 한 넓은 단어: 기술 · 구축 · 금융 · 개발 · 해외 · 시설 · 일자리 · 고용창출 · 육성자금
//   ('육성자금'은 인증 혜택 안내로 "중소기업육성자금 우대"라고 적힌 공고까지 끌어왔고,
//    '일자리'·'고용창출'은 "일자리 창출 효과" 같은 부수 문구에 걸렸다)
// ==============================================================================
type TagRule = { sub: string[]; kw: string[] };

const SMART_TAG_RULES: Record<string, TagRule> = {
  '💰 인건비/고용': {
    sub: ['고용유지', '고용환경개선', '국내일반인력', '해외인력', '교육/훈련/연수', '인력지원'],
    kw: ['인건비', '고용장려금', '장려금', '채용지원', '근로자 채용'],
  },
  '🏭 시설/기계구입': {
    sub: ['시설/입지지원', '기술인력/장비지원', '작업환경개선'],
    kw: ['스마트공장', '기계 구입', '장비 구입', '설비투자', '시설자금', '시설개선', '기자재'],
  },
  '📢 마케팅/홍보': {
    // '디자인/상품화/사업화'는 제품 개발·사업화 성격이라 마케팅과 다르므로 넣지 않는다
    sub: ['홍보지원', '온라인', '오프라인', '시장개척'],
    kw: ['마케팅', '판로개척', '전시회', '박람회', '홍보물', '브랜드'],
  },
  '🧪 기술개발(R&D)': {
    sub: ['기술사업화/이전/지도', '공동기술개발', '단독기술개발', '혼합(단독+공동)', '시험/인증'],
    kw: ['연구개발', 'r&d', '기술개발', '특허', '시제품'],
  },
  '🚢 수출/해외진출': {
    sub: ['해외진출', '해외진출준비', 'FTA활용/대응', '보험(수출+무역)', '수출바우처'],
    kw: ['수출바우처', '수출기업', '해외진출', '무역사절단', '해외전시회', '바이어'],
  },
  '💵 저금리 대출': {
    sub: ['융자', '보증'],
    kw: ['이차보전', '운전자금', '융자한도', '저금리', '대출한도', '특례보증'],
  },
};

interface SmartTagInput {
  title?: string;
  category?: string;
  subCategory?: string;
  summary?: string;
  target?: string;
  hashtags?: string;
}

export function computeSmartTags(input: SmartTagInput): string[] {
  const text = [input.title, input.category, input.subCategory, input.summary, input.target, input.hashtags]
    .filter(Boolean).join(' ').toLowerCase();
  const sub = (input.subCategory || '').trim();

  return Object.entries(SMART_TAG_RULES)
    .filter(([, rule]) => rule.sub.includes(sub) || rule.kw.some(k => text.includes(k.toLowerCase())))
    .map(([tag]) => tag);
}

// 수파베이스 policy_grants 한 행 → 앱 Grant 형식 변환
function mapSupabaseRow(row: any): Grant {
  const hashtags: string[] = Array.isArray(row.hashtags) ? row.hashtags : [];
  return {
    id: String(row.pblanc_id || row.id),
    title: row.title || '제목 없음',
    department: row.department || '관계부처',
    agency: row.agency || '',
    category: row.category || '기타',
    startDate: row.start_date || '',
    endDate: row.end_date || '',
    registrationDate: row.registration_date || '',
    detailUrl: row.detail_url || '#',
    periodText: row.period_text || '',
    supportAmount: row.support_amount || '',
    summary: row.summary || '',
    target: row.target || '',
    subCategory: row.sub_category || '',
    hashtags,
    regionCodes: Array.isArray(row.region_codes) && row.region_codes.length > 0
      ? row.region_codes
      : extractRegionCodes(row.department, row.agency, hashtags.join(' '), row.title),
    // 시·군은 동기화 스크립트가 계산해 DB에 넣는다. 아직 채워지지 않은 행(동기화 전)은
    // 앱에서 즉석 계산 — 규칙은 scripts/sync-bizinfo.mjs 와 동일하다.
    sigunguCodes: Array.isArray(row.sigungu_codes) && row.sigungu_codes.length > 0
      ? row.sigungu_codes
      : extractSigunguCodes(row.title, hashtags.join(' ')),
    targetFlags: Array.isArray(row.target_flags) ? row.target_flags : [],
    views: Number(row.views) || 0,
    tags: computeSmartTags({
      title: row.title, category: row.category, subCategory: row.sub_category,
      summary: row.summary, target: row.target, hashtags: hashtags.join(' '),
    }),
  };
}

export const CsvService = {
  // 정책자금 데이터 로드
  async getGrantData(): Promise<Grant[]> {
    if (cachedGrantDb) {
        return cachedGrantDb;
    }

    // [0단계] 수파베이스 시도 (연결 정보가 설정된 경우에만)
    if (supabase) {
      try {
        // PostgREST는 한 번에 최대 1,000행까지만 주므로 페이지 단위로 끝까지 읽는다
        const PAGE = 1000;
        const rows: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await supabase
            .from('policy_grants')
            .select('*')
            .eq('active', true)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < PAGE) break;
        }
        if (rows.length > 0) {
          console.log(`[CsvService] 수파베이스에서 정책자금 ${rows.length}건을 불러왔습니다.`);
          cachedGrantDb = rows.map(mapSupabaseRow);
          return cachedGrantDb;
        }
        console.warn('[CsvService] 수파베이스 공고가 0건 — 구글시트/CSV로 폴백합니다.');
      } catch (e) {
        console.warn('[CsvService] 수파베이스 연결 실패 — 구글시트/CSV로 폴백합니다.', e);
      }
    }

    try {
      let csvText = '';

      // [1단계] 구글 시트 시도
      if (GOOGLE_SHEET_GRANT_URL && GOOGLE_SHEET_GRANT_URL.startsWith('http')) {
        try {
          const response = await fetch(GOOGLE_SHEET_GRANT_URL);
          if (response.ok) {
            csvText = await response.text();
            console.log('[CsvService] 구글 시트에서 정책 자금 데이터를 불러왔습니다.');
          }
        } catch (e) {
             console.warn('[CsvService] 구글 시트 연결 실패, 로컬 파일을 시도합니다.', e);
        }
      }

      // [2단계] 로컬 파일 시도 (최신 동기화 파일 → 스냅샷 순서로 폴백)
      if (!csvText) {
          for (const csvPath of LOCAL_GRANT_CSV_CANDIDATES) {
            try {
              console.log(`[CsvService] 로컬 파일 로딩 시도: ${csvPath}`);
              const response = await fetch(csvPath);
              if (response.ok) {
                csvText = await response.text();
                console.log(`[CsvService] 로컬 파일에서 정책 자금 데이터를 불러왔습니다: ${csvPath}`);
                break;
              } else {
                 console.warn(`[CsvService] 로컬 파일 찾기 실패 (${response.status}): ${csvPath}`);
              }
            } catch (e) {
              console.error(`[CsvService] 로컬 파일 로딩 중 에러 발생 (${csvPath}):`, e);
            }
          }
      }

      // [3단계] 데이터 파싱 (데이터가 없으면 비상용 샘플 데이터 MOCK_GRANTS 반환)
      if (!csvText) {
          console.warn('[CsvService] 데이터를 불러올 수 없어 샘플 데이터를 사용합니다.');
          return MOCK_GRANTS;
      }

      const data = await this.parseGrantCsv(csvText);
      cachedGrantDb = data;
      return data;

    } catch (error) {
      console.error('정책자금 데이터 로드 실패:', error);
      return MOCK_GRANTS;
    }
  },

  // Helper: 정책자금 CSV 파싱 및 스마트 태깅
  parseGrantCsv(csvText: string): Promise<Grant[]> {
    return new Promise((resolve) => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results: any) => {
             const data = results.data.map((row: any, index: number) => {
               const categoryRaw = row['지원분야'] || row['category'] || '기타';
               const title = row['공고명'] || row['title'] || '제목 없음';
               const summary = row['사업개요'] || row['summary'] || '';
               const target = row['지원대상'] || '';
               const subCategory = row['지원분야중분류'] || '';
               const hashtags = String(row['해시태그'] || '')
                 .split(/[,#/\s]+/)
                 .map((t: string) => t.trim())
                 .filter(Boolean);

               // 스마트 태깅 (중분류 우선 + 좁은 키워드 보조 — SMART_TAG_RULES 참고)
               const tags = computeSmartTags({
                 title, category: categoryRaw, subCategory, summary, target, hashtags: hashtags.join(' '),
               });

               const department = row['소관부처'] || row['department'] || '관계부처';
               const agency = row['사업수행기관'] || row['agency'] || '';

               return {
                 id: row['번호'] || row['id'] || `grant_${index}`,
                 title: title,
                 department,
                 agency,
                 category: categoryRaw,
                 startDate: row['신청시작일자'] || row['startDate'] || '',
                 endDate: row['신청종료일자'] || row['endDate'] || '',
                 registrationDate: row['등록일자'] || row['registrationDate'] || '',
                 detailUrl: row['공고상세URL'] || row['detailUrl'] || '#',
                 periodText: row['신청기간'] || row['periodText'] || '',
                 supportAmount: row['지원금액'] || '',
                 summary: summary,
                 target: target,
                 subCategory: subCategory,
                 hashtags: hashtags,
                 regionCodes: extractRegionCodes(department, agency, hashtags.join(' '), title),
                 sigunguCodes: extractSigunguCodes(title, hashtags.join(' ')),
                 views: Number(row['조회수']) || 0,
                 tags: tags
               };
             }) as Grant[];

             resolve(data);
          },
          error: (err: any) => {
             console.error('정책자금 CSV 파싱 에러:', err);
             resolve(MOCK_GRANTS);
          }
        });
      });
  },

  // 고객사 주소 → 표준 지역코드 / 시·군·구.
  // 판정은 services/geo.ts 로 통합했다 (행정구역 공식 목록 기반).
  // 주소 형태가 제각각인 실데이터를 다룬다 — 우편번호 접두, 접미사 없는 옛 지번주소,
  // 시도명과 구가 붙어 있는 표기 등. 자세한 사례는 geo.resolveAddress 주석 참고.
  mapRegion(address: string): BizRegionType | '전체' {
    return resolveAddress(address).region;
  },

  // 관내 기업 전용 사업 판정용. 판별 못 하면 빈 배열 — 그 경우 시·군 축은 적용되지 않는다.
  mapSigungu(address: string): string[] {
    return resolveAddress(address).sigungu;
  },

};
