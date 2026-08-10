import { UserSession } from '../types';
import { CsvService } from './csvService';
import { supabase } from './supabaseClient';

// ==============================================================================
// [사장님 필독] 고객사 확인 경로 — 수파베이스 Edge Function(verify-brn) 하나뿐이다
//
// 확인 방식: 사업자등록번호 + 대표자 성명 두 개를 서버에서 대조한다.
//   · 고객 명단은 수파베이스 clients 테이블(비공개, RLS 잠금)에만 있고,
//     브라우저에는 일치 여부 + 상호명/업태/주소힌트 등 최소 정보만 내려온다.
//   · 대표자 성명은 입력값으로만 쓰이고 응답에는 담기지 않는다.
//   · 함수 코드: supabase/functions/verify-brn/index.ts (배포 절차는 docs/supabase-setup.md)
//
// 폴백 경로를 두지 않는 이유 (2026-08 제거):
//   예전에는 함수 호출이 실패하면 구글 Apps Script로 폴백했는데, 그 경로는 사업자번호
//   하나로 통과시켰다. 방문자가 브라우저에서 *.supabase.co 요청을 차단하기만 하면
//   폴백으로 넘어가 대표자명 검증이 무력화된다 — 인증 경로가 둘이면 약한 쪽이
//   실제 보안 수준이 된다. 그래서 실패는 조용히 우회하지 않고 오류로 알린다.
// ==============================================================================

/**
 * 고객사 확인 결과.
 * "고객사가 아님"(not_found)과 "시스템 오류"(error)는 화면 문구가 달라야 하므로 구분한다.
 * 오류를 "고객사 아님"으로 보여주면 실제 고객사가 혼란스러워한다.
 */
export type VerifyResult =
  | { status: 'ok'; session: UserSession }
  | { status: 'not_found' }      // 번호·이름 불일치 (어느 쪽이 틀렸는지는 서버도 알려주지 않는다)
  | { status: 'rate_limited' }   // 짧은 시간에 너무 많이 시도 (서버가 429)
  | { status: 'error' };         // 함수 미배포·네트워크 차단·서버 오류

/** 이름 비교용 정규화 — 앞뒤 및 문자열 내부 공백을 모두 제거 ('홍 길동' → '홍길동') */
export function normalizeName(name: string): string {
  return String(name || '').replace(/\s+/g, '');
}

export const MockDbService = {
  // 고객사 사업자번호 + 대표자 성명 확인
  async verifyClient(inputBrn: string, inputCeoName: string): Promise<VerifyResult> {
    const brn = String(inputBrn || '').replace(/[^0-9]/g, '');
    const ceoName = normalizeName(inputCeoName);
    if (!brn || !ceoName) return { status: 'not_found' };

    // 환경변수 미주입 = 함수를 호출할 수 없는 상태. 폴백하지 않고 오류로 알린다.
    if (!supabase) {
      console.error('[Verify] 수파베이스 연결 정보가 없습니다 (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
      return { status: 'error' };
    }

    try {
      const { data, error } = await supabase.functions.invoke('verify-brn', {
        body: { brn, ceoName },
      });

      if (error) {
        // 함수가 2xx 아닌 응답을 주면 invoke 는 error 로 넘긴다. 429(호출 제한)만 따로 구분한다.
        const status = (error as { context?: { status?: number } })?.context?.status;
        if (status === 429) return { status: 'rate_limited' };
        console.error('[Verify] Edge Function 호출 실패:', error);
        return { status: 'error' };
      }

      if (!data?.found) return { status: 'not_found' };

      return {
        status: 'ok',
        session: {
          type: 'CLIENT',
          identifier: brn,
          companyName: data.companyName || '',
          clientType: data.clientType || '',
          bizType: data.bizCategory || '',
          bizItem: data.bizItem || '',
          // 대표자 속성은 Edge Function 이 서버에서 계산한 boolean 만 받는다
          // (생년월일·성별은 브라우저로 내려오지 않는다). 값이 없으면 판단하지 않는다.
          isYouthOwner: typeof data.isYouthOwner === 'boolean' ? data.isYouthOwner : undefined,
          isFemaleOwner: typeof data.isFemaleOwner === 'boolean' ? data.isFemaleOwner : undefined,
          region: CsvService.mapRegion(data.regionHint || ''),
          sigungu: CsvService.mapSigungu(data.regionHint || ''),
        },
      };
    } catch (err) {
      // 네트워크 차단·CORS 실패 등. 이때도 폴백하지 않는다.
      console.error('[Verify] 사업자번호 확인 중 오류:', err);
      return { status: 'error' };
    }
  },
};
