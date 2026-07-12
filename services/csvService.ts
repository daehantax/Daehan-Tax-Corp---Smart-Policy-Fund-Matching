import Papa from 'papaparse';
import { BizCategory, BizRegionType, BizRegions, Grant } from '../types';
import { MOCK_GRANTS } from '../constants';

// ==============================================================================
// 정책자금(공고) 데이터 소스 설정
// ※ 고객 명단은 개인정보 보호를 위해 이 앱에서 절대 로드하지 않습니다.
//    사업자번호 확인은 services/mockDb.ts를 통해 서버(Apps Script)에서 처리됩니다.
// ==============================================================================

// [1순위] 구글 스프레드시트 (실시간 연동)
// - 스프레드시트 '웹에 게시' 링크를 넣으면 가장 우선적으로 이 데이터를 사용합니다.
const GOOGLE_SHEET_GRANT_URL = '' as string;

// [2순위] 로컬 파일 (서버 파일)
// - 구글 시트 링크가 없거나 연결 실패 시, public/data 폴더에 있는 파일을 순서대로 시도합니다.
// - policy_fund_latest.csv 는 기업마당 오픈 API 동기화(GitHub Actions)가 매일 갱신하는 파일이며,
//   아직 생성 전이거나 로드 실패 시 기존 스냅샷 파일로 폴백합니다.
// - GitHub Pages처럼 하위 경로로 서빙되는 환경에서도 동작하도록 상대 경로를 사용합니다.
const LOCAL_GRANT_CSV_CANDIDATES = [
  './data/policy_fund_latest.csv',
  './data/policy_fund_20260205_data.csv',
];

let cachedGrantDb: Grant[] | null = null;

export const CsvService = {
  // 정책자금 데이터 로드
  async getGrantData(): Promise<Grant[]> {
    if (cachedGrantDb) {
        return cachedGrantDb;
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

               // 스마트 태깅 로직 (제목·분야에 더해 사업개요/지원대상/해시태그까지 분석)
               const tags: string[] = [];
               const textToAnalyze = (title + ' ' + categoryRaw + ' ' + subCategory + ' ' + summary + ' ' + target + ' ' + hashtags.join(' ')).toLowerCase();

               if (textToAnalyze.includes('인력') || textToAnalyze.includes('고용') || textToAnalyze.includes('일자리') || textToAnalyze.includes('채용') || textToAnalyze.includes('청년')) {
                   tags.push('💰 인건비/고용');
               }
               if (textToAnalyze.includes('시설') || textToAnalyze.includes('기계') || textToAnalyze.includes('장비') || textToAnalyze.includes('구축') || textToAnalyze.includes('스마트공장')) {
                   tags.push('🏭 시설/기계구입');
               }
               if (textToAnalyze.includes('마케팅') || textToAnalyze.includes('홍보') || textToAnalyze.includes('판로') || textToAnalyze.includes('전시회') || textToAnalyze.includes('입점')) {
                   tags.push('📢 마케팅/홍보');
               }
               if (textToAnalyze.includes('기술') || textToAnalyze.includes('연구') || textToAnalyze.includes('개발') || textToAnalyze.includes('r&d') || textToAnalyze.includes('특허')) {
                   tags.push('🧪 기술개발(R&D)');
               }
               if (textToAnalyze.includes('수출') || textToAnalyze.includes('해외') || textToAnalyze.includes('무역') || textToAnalyze.includes('글로벌')) {
                   tags.push('🚢 수출/해외진출');
               }
               if (textToAnalyze.includes('융자') || textToAnalyze.includes('대출') || textToAnalyze.includes('보증') || textToAnalyze.includes('금융') || textToAnalyze.includes('운전자금')) {
                   tags.push('💵 저금리 대출');
               }

               return {
                 id: row['번호'] || row['id'] || `grant_${index}`,
                 title: title,
                 department: row['소관부처'] || row['department'] || '관계부처',
                 agency: row['사업수행기관'] || row['agency'] || '',
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

  mapRegion(address: string): BizRegionType | '전체' {
    if (!address) return '전체';
    const normalizedAddr = address.trim();
    const firstWord = normalizedAddr.split(' ')[0];
    for (const region of BizRegions) {
       if (region === '전국') continue;
       if (firstWord.includes(region) || (region.length === 2 && firstWord.substring(0, 2) === region)) {
         return region;
       }
    }
    return '전체';
  },

  mapIndustry(rawIndustry: string): BizCategory {
    if (!rawIndustry) return BizCategory.ETC;
    const term = rawIndustry.trim();
    if (term.includes('제조')) return BizCategory.TECHNOLOGY;
    if (term.includes('소프트웨어') || term.includes('정보') || term.includes('IT')) return BizCategory.TECHNOLOGY;
    if (term.includes('도소매') || term.includes('유통') || term.includes('상사')) return BizCategory.DOMESTIC;
    if (term.includes('수출') || term.includes('무역')) return BizCategory.EXPORT;
    if (term.includes('건설')) return BizCategory.ETC;
    if (term.includes('서비스') || term.includes('용역')) return BizCategory.ETC;
    if (term.includes('부동산업')) return BizCategory.MANAGEMENT;
    return BizCategory.ETC;
  }
};
