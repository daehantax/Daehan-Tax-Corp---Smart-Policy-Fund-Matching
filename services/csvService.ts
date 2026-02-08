import Papa from 'papaparse';
import { ClientData, BizCategory, BizRegionType, BizRegions, Grant } from '../types';
import { MOCK_CLIENT_DB, MOCK_GRANTS } from '../constants';

export const CsvService = {
  // 1. 고객사 데이터 로드 (기존 유지)
  async getClientData(): Promise<ClientData[]> {
    try {
      const response = await fetch('/data/dhadress_processed_data_20260125_182336.csv');
      
      if (!response.ok) {
        console.warn('Customer CSV not found, using internal mock data.');
        return MOCK_CLIENT_DB;
      }

      const csvText = await response.text();
      
      return new Promise((resolve) => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results: any) => {
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
             resolve(data);
          },
          error: (err: any) => {
             console.error('Customer CSV Parse Error:', err);
             resolve(MOCK_CLIENT_DB);
          }
        });
      });
    } catch (error) {
      console.error('Customer CSV Load Failed:', error);
      return MOCK_CLIENT_DB;
    }
  },

  // 2. 정책자금 데이터 로드 (수정됨: 정상 파일명 및 컬럼 매핑)
  async getGrantData(): Promise<Grant[]> {
    try {
      // 정상 파일명으로 수정
      const response = await fetch('/data/policy_fund_20260205_data.csv');
      
      if (!response.ok) {
        console.warn('Policy Fund CSV not found, using internal mock data.');
        return MOCK_GRANTS; 
      }

      const csvText = await response.text();
      return this.parseGrantCsv(csvText);

    } catch (error) {
      console.error('Policy CSV Load Failed:', error);
      return MOCK_GRANTS;
    }
  },

  // Helper to parse grant CSV and apply Smart Tagging
  parseGrantCsv(csvText: string): Promise<Grant[]> {
    return new Promise((resolve) => {
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results: any) => {
             const data = results.data.map((row: any, index: number) => {
               // CSV 헤더와 매핑 (제공해주신 파일 기준)
               const categoryRaw = row['지원분야'] || row['category'] || '기타';
               const title = row['공고명'] || row['title'] || '제목 없음';
               
               // Smart Tagging Logic (Analyzes title & category)
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
                 tags: tags // Add the calculated tags
               };
             }) as Grant[];
             
             resolve(data);
          },
          error: (err: any) => {
             console.error('Policy CSV Parse Error:', err);
             resolve(MOCK_GRANTS);
          }
        });
      });
  },

  // ... (기존 헬퍼 함수들 유지)
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