import { GeneralInquiry, UserSession } from '../types';
import { CsvService } from './csvService';

// Simulated delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ==============================================================================
// [사장님 필독] 구글 Apps Script 연동 URL 설정 (기능별로 분리)
//
// 1) 상담 신청 접수용 (doPost가 있는 기존 스크립트)
const GOOGLE_INQUIRY_URL: string = 'https://script.google.com/macros/s/AKfycbxyuQH8I1fnU1_8tT9c_p9M9NtAhXaNAuyxtKQ65wmQhiYle-b5m2xrcKlF_qmEDxwnjw/exec';
//
// 2) 고객사 사업자번호 확인용 (docs/google-apps-script-verify.gs를 배포한 스크립트)
const GOOGLE_VERIFY_URL: string = 'https://script.google.com/macros/s/AKfycbxx97oQyt2dVIM_5xGMjABa6M3-Ahakj7gYH7xEX17mnfHgJAEQpnlnC8rnmZbPeptEUA/exec';
// ==============================================================================

// 개발/테스트용: 스크립트 URL이 설정되지 않았을 때만 통과되는 테스트 사업자번호
const DEV_TEST_BRN = '1234567890';

export const MockDbService = {
  // 고객사 사업자번호 확인
  // 고객 명단은 서버(Apps Script + 비공개 스프레드시트)에만 존재하며,
  // 브라우저에는 입력한 번호의 일치 여부와 최소 정보만 내려옵니다.
  async verifyClient(inputBrn: string): Promise<UserSession | null> {
    // Normalize input: remove hyphens and spaces
    const normalizedInput = inputBrn.replace(/[^0-9]/g, '');
    if (!normalizedInput) return null;

    // URL이 설정되지 않았을 경우 (개발 모드)
    if (!GOOGLE_VERIFY_URL || GOOGLE_VERIFY_URL.includes('YOUR_SCRIPT_ID')) {
      console.warn('[Verify] 구글 스크립트 URL이 설정되지 않아 테스트 번호만 조회됩니다.');
      await delay(600);
      if (normalizedInput === DEV_TEST_BRN) {
        return {
          type: 'CLIENT',
          identifier: DEV_TEST_BRN,
          companyName: '테스트용 샘플기업',
          ceoName: '김테스트',
          industry: CsvService.mapIndustry('서비스업'),
          region: CsvService.mapRegion('서울특별시 강남구')
        };
      }
      return null;
    }

    try {
      const response = await fetch(
        `${GOOGLE_VERIFY_URL}?action=verify&brn=${encodeURIComponent(normalizedInput)}`
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json();

      if (!result.found) {
        console.warn(`[Verify] No match found for BRN: ${normalizedInput}`);
        return null;
      }

      return {
        type: 'CLIENT',
        identifier: normalizedInput,
        companyName: result.companyName || '',
        ceoName: result.ceoName || '',
        industry: CsvService.mapIndustry(result.bizCategory || ''),
        region: CsvService.mapRegion(result.regionHint || '')
      };
    } catch (error) {
      console.error('[Verify] 사업자번호 확인 중 오류:', error);
      return null;
    }
  },

  // Save general inquiry to Google Sheets
  async submitInquiry(data: GeneralInquiry): Promise<boolean> {
    // 1. URL이 설정되지 않았을 경우 (개발 모드 안내)
    if (!GOOGLE_INQUIRY_URL || GOOGLE_INQUIRY_URL.includes('YOUR_SCRIPT_ID')) {
        console.warn('===========================================================');
        console.warn('[주의] 구글 스크립트 URL이 설정되지 않았습니다!');
        console.warn('services/mockDb.ts 파일의 GOOGLE_INQUIRY_URL 변수를 수정해주세요.');
        console.warn('전송하려던 데이터:', data);
        console.warn('===========================================================');
        await delay(1000); // 가짜 로딩 시간
        return true; // 화면상으로는 성공한 척 처리
    }

    try {
      // 2. 실제 구글 시트로 전송
      // mode: 'no-cors'는 브라우저 보안 정책을 우회하기 위해 필수입니다.
      // 이 모드에서는 응답(response) 내용을 읽을 수 없지만(opaque), 데이터는 전송됩니다.
      await fetch(GOOGLE_INQUIRY_URL, {
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
