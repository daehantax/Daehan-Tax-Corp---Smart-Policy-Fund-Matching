import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ==============================================================================
// [사장님 필독] 수파베이스 연결 설정
//
// 연결 정보는 코드에 직접 쓰지 않고 빌드 시 환경변수로 주입합니다.
//   · 로컬 개발: 프로젝트 루트에 .env.local 파일을 만들고 아래 두 줄 작성
//       VITE_SUPABASE_URL=https://xxxx.supabase.co
//       VITE_SUPABASE_ANON_KEY=eyJ...
//     (값은 수파베이스 대시보드 → Settings → API 에서 확인)
//   · 배포(GitHub Pages): 저장소 Settings → Secrets and variables → Actions 에
//     VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 등록 (deploy-pages.yml이 주입)
//
// ※ anon 키는 공개되어도 되는 키입니다. DB 접근 권한은 서버의 RLS 정책이 통제하며,
//   이 앱이 직접 읽을 수 있는 것은 공개 데이터인 policy_grants(정책자금 공고)뿐입니다.
//   고객 명단(clients)은 Edge Function(verify-brn)을 통해서만 확인됩니다.
// ==============================================================================

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

// 환경변수가 없으면 null — 각 서비스는 이 경우 기존 방식(CSV/구글 스크립트)으로 폴백합니다.
export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

if (!supabase) {
  console.warn('[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 미설정 — 기존 CSV/구글 스크립트 방식으로 동작합니다.');
}
