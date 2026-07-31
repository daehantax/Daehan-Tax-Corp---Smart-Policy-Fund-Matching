import { UserSession } from '../types';
import { CsvService } from './csvService';
import { supabase } from './supabaseClient';

// Simulated delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ==============================================================================
// [사장님 필독] 고객사 사업자번호 확인 경로
//
// [1순위] 수파베이스 Edge Function (verify-brn)
//   - services/supabaseClient.ts 에 연결 정보가 설정되어 있으면 이 경로를 사용합니다.
//   - 고객 명단은 수파베이스 clients 테이블(비공개, RLS 잠금)에만 있고,
//     브라우저에는 일치 여부 + 상호명/대표자명 등 최소 정보만 내려옵니다.
//   - 함수 코드: supabase/functions/verify-brn/index.ts (배포 방법은 docs/supabase-setup.md)
//
// [2순위·폴백] 구글 Apps Script 연동 URL
//
// 고객사 사업자번호 확인용 (docs/google-apps-script-verify.gs를 배포한 스크립트)
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

    // [1순위] 수파베이스 Edge Function (verify-brn)
    if (supabase) {
      try {
        const { data, error } = await supabase.functions.invoke('verify-brn', {
          body: { brn: normalizedInput },
        });
        if (error) throw error;

        if (!data?.found) {
          console.warn(`[Verify] 수파베이스에서 일치하는 사업자번호 없음: ${normalizedInput}`);
          return null;
        }
        return {
          type: 'CLIENT',
          identifier: normalizedInput,
          companyName: data.companyName || '',
          ceoName: data.ceoName || '',
          industry: CsvService.mapIndustry(data.bizCategory || ''),
          region: CsvService.mapRegion(data.regionHint || '')
        };
      } catch (error) {
        // 함수 미배포·일시 장애 시에만 기존 Apps Script 경로로 폴백
        console.warn('[Verify] Edge Function 호출 실패 — 구글 스크립트로 폴백합니다.', error);
      }
    }

    // [2순위·폴백] 구글 Apps Script
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
  }
};
