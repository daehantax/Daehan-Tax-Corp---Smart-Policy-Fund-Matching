import { Grant } from '../types';
import { extractRegionCodes, extractSigunguCodes } from './matchingService';

// ==============================================================================
// policy_grants 한 행 → 앱 Grant · 스마트 태깅
//
// 왜 csvService 에서 떼어냈나 (2026-11-12):
//   주간 신규 공고 리포트(`scripts/weekly-report.ts`)가 **같은 변환**을 써야 하는데,
//   csvService 는 `supabaseClient`(브라우저용 `import.meta.env`)와 papaparse 를 끌고 와서
//   Node 스크립트에서 불러올 수가 없다. 그렇다고 변환을 한 벌 더 적으면
//   화면과 리포트가 **서로 다른 공고를 보게 된다** — 지역코드·기준선·제외업종이 다 여기서 정해진다.
//   그래서 브라우저 의존이 없는 이 파일로 옮기고, csvService 는 여기서 가져다 쓴다.
//   (CLAUDE.md 「세 번째 복제본을 만들지 않는다」와 같은 취지다)
//
// 이 파일은 types 와 matchingService 만 의존한다. 새 의존을 들이지 말 것.
// ==============================================================================

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
export function mapSupabaseRow(row: any): Grant {
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
    // 기준선은 동기화 스크립트가 본문에서 읽어 DB 에 넣는다. 아직 채워지지 않은 행은
    // 그냥 없는 채로 둔다 — 앱에서 즉석 계산하지 않는다(본문을 앱으로 내려보내지 않으므로).
    conditions: row.conditions && typeof row.conditions === 'object' && !Array.isArray(row.conditions)
      ? row.conditions
      : undefined,
    // 제외 업종도 마찬가지 — 첨부 글자를 읽는 별도 단계(apply-exclusions.mjs)가 채운다.
    // 꼬리표가 하나도 없으면 없는 것으로 둔다. 빈 배열과 「모른다」를 섞지 않으려는 것이다
    excludedIndustries: row.excluded_industries
      && typeof row.excluded_industries === 'object'
      && Array.isArray(row.excluded_industries.tags)
      && row.excluded_industries.tags.length > 0
      ? row.excluded_industries
      : undefined,
    views: Number(row.views) || 0,
    tags: computeSmartTags({
      title: row.title, category: row.category, subCategory: row.sub_category,
      summary: row.summary, target: row.target, hashtags: hashtags.join(' '),
    }),
  };
}
