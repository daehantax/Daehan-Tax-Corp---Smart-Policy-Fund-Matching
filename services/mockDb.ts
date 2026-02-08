import { GeneralInquiry, UserSession } from '../types';
import { CsvService } from './csvService';

// Simulated delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// [중요] 구글 스프레드시트 Apps Script 배포 후 생성된 URL을 아래에 입력하세요.
// 예시: 'https://script.google.com/macros/s/AKfycbx.../exec'
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID_HERE/exec'; 

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
    // 1. URL이 설정되지 않았을 경우 (테스트 모드)
    if (GOOGLE_SCRIPT_URL.includes('https://script.google.com/macros/s/AKfycbw2fKGERltWlvNg_2fVEKjpAX6aNKAxhWrqHC02W11bh0rhmCOxvUErRe-wJCG1xBkF0g/exec')) {
        console.warn('[MockDb] Google Script URL이 설정되지 않았습니다. 콘솔에만 출력합니다.');
        console.log('[Data]', data);
        await delay(1000);
        return true; 
    }

    try {
      // 2. 실제 구글 시트로 전송
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors', // 중요: 구글 스크립트로 전송 시 CORS 회피를 위해 no-cors 사용
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });
      
      console.log('[Success] Data sent to Google Sheet');
      return true;

    } catch (error) {
      console.error('Google Sheet Submission Error:', error);
      // 실패하더라도 사용자 경험을 위해 true를 반환하거나 별도 에러 처리를 할 수 있습니다.
      return false;
    }
  }
};