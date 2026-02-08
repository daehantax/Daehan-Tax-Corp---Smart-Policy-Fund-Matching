import { GeneralInquiry, UserSession } from '../types';
import { CsvService } from './csvService';

// Simulated delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ==============================================================================
// [사장님 필독] 
// 1. 구글 스프레드시트 -> 확장프로그램 -> Apps Script에 접속하세요.
// 2. 배포 -> 새 배포 -> '웹 앱' 선택 -> 액세스 권한: '모든 사용자' -> 배포 클릭
// 3. 생성된 '웹 앱 URL'을 복사해서 아래 따옴표 안에 붙여넣으세요.
// ==============================================================================
const GOOGLE_SCRIPT_URL: string = 'https://script.google.com/macros/s/AKfycbxyuQH8I1fnU1_8tT9c_p9M9NtAhXaNAuyxtKQ65wmQhiYle-b5m2xrcKlF_qmEDxwnjw/exec'; 

export const MockDbService = {
  // Check if the user is a VIP client (Gatekeeping via CSV Data)
  async verifyClient(inputBrn: string): Promise<UserSession | null> {
    await delay(600); // Simulate processing
    
    // Load fresh data from CSV
    const clientDb = await CsvService.getClientData();
    
    // Normalize input: remove hyphens and spaces
    const normalizedInput = inputBrn.replace(/[^0-9]/g, '');

    // Search in the DB
    const matchedClient = clientDb.find(client => {
      const normalizedDbBrn = client.biz_number.replace(/[^0-9]/g, '');
      return normalizedDbBrn === normalizedInput;
    });

    if (matchedClient) {
      // Smart Auto-Mapping for Filters
      const region = CsvService.mapRegion(matchedClient.address);
      const industry = CsvService.mapIndustry(matchedClient.biz_category);

      return {
        type: 'CLIENT',
        identifier: matchedClient.biz_number,
        companyName: matchedClient.company_name,
        ceoName: matchedClient.ceo_name,
        industry: industry, // Auto-mapped industry
        region: region      // Auto-mapped region
      };
    }
    
    return null;
  },

  // Save general inquiry to Google Sheets
  async submitInquiry(data: GeneralInquiry): Promise<boolean> {
    // 1. URL이 설정되지 않았을 경우 (개발 모드 안내)
    if (GOOGLE_SCRIPT_URL.includes('') || GOOGLE_SCRIPT_URL === '') {
        console.warn('===========================================================');
        console.warn('[주의] 구글 스크립트 URL이 설정되지 않았습니다!');
        console.warn('services/mockDb.ts 파일의 GOOGLE_SCRIPT_URL 변수를 수정해주세요.');
        console.warn('전송하려던 데이터:', data);
        console.warn('===========================================================');
        await delay(1000); // 가짜 로딩 시간
        return true; // 화면상으로는 성공한 척 처리
    }

    try {
      // 2. 실제 구글 시트로 전송
      // mode: 'no-cors'는 브라우저 보안 정책을 우회하기 위해 필수입니다.
      // 이 모드에서는 응답(response) 내용을 읽을 수 없지만(opaque), 데이터는 전송됩니다.
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors', 
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      
      console.log('[Success] 상담 신청 데이터가 구글 시트로 전송되었습니다.');
      return true;

    } catch (error) {
      console.error('Google Sheet Submission Error:', error);
      alert('데이터 전송 중 오류가 발생했습니다. 네트워크 상태를 확인해주세요.');
      return false;
    }
  }
};