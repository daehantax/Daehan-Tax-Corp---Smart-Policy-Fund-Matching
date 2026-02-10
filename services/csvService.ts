import Papa from 'papaparse';
import { ClientData, BizCategory, BizRegionType, BizRegions, Grant } from '../types';
import { MOCK_CLIENT_DB, MOCK_GRANTS } from '../constants';

// ==============================================================================
// [1순위] 구글 스프레드시트 (실시간 연동)
// - 스프레드시트 '웹에 게시' 링크를 넣으면 가장 우선적으로 이 데이터를 사용합니다.
// ==============================================================================
const GOOGLE_SHEET_CLIENT_URL = '' as string; 
const GOOGLE_SHEET_GRANT_URL = '' as string;  

// ==============================================================================
// [2순위] 로컬 파일 (서버 파일)
// - 구글 시트 링크가 없거나 연결 실패 시, public/data 폴더에 있는 파일을 사용합니다.
// ==============================================================================
// 브라우저는 '/data/...' 로 요청하면 자동으로 public/data 폴더를 찾아갑니다.
const LOCAL_CLIENT_CSV = '/data/dhadress_processed_data_20260125_182336.csv';
const LOCAL_GRANT_CSV = '/data/policy_fund_20260205_data.csv';

let cachedClientDb: ClientData[] | null = null;
let cachedGrantDb: Grant[] | null = null;

export const CsvService = {
  // 1. 고객사 데이터 로드
  async getClientData(): Promise<ClientData[]> {
    if (cachedClientDb) {
      return cachedClientDb;
    }

    try {
      let csvText = '';
      
      // [1단계] 구글 시트 시도
      if (GOOGLE_SHEET_CLIENT_URL && GOOGLE_SHEET_CLIENT_URL.startsWith('http')) {
        try {
          const response = await fetch(GOOGLE_SHEET_CLIENT_URL);
          if (response.ok) {
            csvText = await response.text();
            console.log('[CsvService] 구글 시트에서 고객 데이터를 불러왔습니다.');
          }
        } catch (e) {
          console.warn('[CsvService] 구글 시트 연결 실패, 로컬 파일을 시도합니다.', e);
        }
      }

      // [2단계] 로컬 파일 시도 (구글 시트 실패 또는 미설정 시)
      if (!csvText) {
        try {
          console.log(`[CsvService] 로컬 파일 로딩 시도: ${LOCAL_CLIENT_CSV}`);
          const response = await fetch(LOCAL_CLIENT_CSV);
          if (response.ok) {
            csvText = await response.text();
            console.log('[CsvService] 로컬 파일에서 고객 데이터를 불러왔습니다.');
          } else {
             console.error(`[CsvService] 로컬 파일 찾기 실패 (${response.status}). 경로를 확인해주세요.`);
          }
        } catch (e) {
          console.error('[CsvService] 로컬 파일 로딩 중 에러 발생:', e);
        }
      }
      
      // [3단계] 데이터 파싱 (데이터가 없으면 비상용 샘플 데이터 MOCK_CLIENT_DB 반환)
      if (!csvText) {
          console.warn('[CsvService] 데이터를 불러올 수 없어 샘플 데이터를 사용합니다.');
          return MOCK_CLIENT_DB;
      }

      return new Promise((resolve) => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results: any) => {
             if (results.data && results.data.length > 0) {
                 const data = results.data.map((row: any) => ({
                   id: row.id || Math.random().toString(36).substr(2, 9),
                   company_name: row.company_name || row['회사명'] || '',
                   ceo_name: row.ceo_name || row['대표자명'] || '',
                   biz_type: row.biz_type || row['기업형태'] || '',
                   biz_number: row.biz_number || row['사업자등록번호'] || row['사업자번호'] || '',
                   address: row.address || row['주소'] || '',
                   address_detail: row.address_detail || row['상세주소'] || '',
                   phone: row.phone || row['연락처'] || '',
                   biz_category: row.biz_category || row['업종'] || '',
                   biz_item: row.biz_item || row['종목'] || ''
                 })) as ClientData[];
                 
                 console.log(`[CsvService] 고객 데이터 ${data.length}건 파싱 완료.`);
                 cachedClientDb = data;
                 resolve(data);
             } else {
                 console.warn('[CsvService] CSV 파일이 비어있습니다. 샘플 데이터를 사용합니다.');
                 resolve(MOCK_CLIENT_DB);
             }
          },
          error: (err: any) => {
             console.error('고객 CSV 파싱 에러:', err);
             resolve(MOCK_CLIENT_DB);
          }
        });
      });
    } catch (error) {
      console.error('고객 데이터 로드 실패:', error);
      return MOCK_CLIENT_DB;
    }
  },

  // 2. 정책자금 데이터 로드
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

      // [2단계] 로컬 파일 시도
      if (!csvText) {
          try {
            console.log(`[CsvService] 로컬 파일 로딩 시도: ${LOCAL_GRANT_CSV}`);
            const response = await fetch(LOCAL_GRANT_CSV);
            if (response.ok) {
              csvText = await response.text();
              console.log('[CsvService] 로컬 파일에서 정책 자금 데이터를 불러왔습니다.');
            } else {
               console.error(`[CsvService] 로컬 파일 찾기 실패 (${response.status}). 경로를 확인해주세요.`);
            }
          } catch (e) {
            console.error('[CsvService] 로컬 파일 로딩 중 에러 발생:', e);
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
               
               // 스마트 태깅 로직 (제목과 분야를 분석하여 태그 자동 생성)
               const tags: string[] = [];
               const textToAnalyze = (title + ' ' + categoryRaw).toLowerCase();

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
                 supportAmount: row['지원금액'] || '',
                 views: Math.floor(Math.random() * 1000),
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