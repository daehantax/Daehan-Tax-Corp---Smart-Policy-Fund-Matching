export interface Grant {
  id: string;          // Maps to '번호' or unique ID
  department: string;  // 소관부처 (e.g., 광주광역시)
  agency: string;      // 사업수행기관 (e.g., 직접수행)
  category: string;    // 지원분야 (e.g., 기술, 내수)
  title: string;       // 공고명
  startDate: string;   // 신청시작일자 (YYYY-MM-DD)
  endDate: string;     // 신청종료일자 (YYYY-MM-DD)
  registrationDate: string; // 등록일자 (YYYY-MM-DD)
  detailUrl: string;   // 공고상세URL
  periodText?: string; // 신청기간 원문 (날짜 파싱 불가 시: '상시', '예산 소진시까지' 등)
  target?: string;      // 지원대상 (예: 중소기업, 창업 7년 미만)
  subCategory?: string; // 지원분야 중분류
  hashtags?: string[];  // 기업마당 해시태그 (지역/분야 정밀 매칭용)
  regionCodes?: string[]; // 표준 지역코드 (전국/서울/…/제주) — DB region_codes 컬럼
  sigunguCodes?: string[]; // 시·군·구 (기초자치단체 전용 사업일 때만. 제목·해시태그에서 계산)
  targetFlags?: string[];  // 자격 조건 태그 (동기화 시 사업개요 원문에서 추출 — DB target_flags 컬럼)
  
  // Optional fields for UI enhancements (can be inferred or AI-generated)
  summary?: string;
  supportAmount?: string;
  views?: number;
  
  // Smart Tags based on analysis
  tags?: string[]; 
}

export interface UserSession {
  type: 'CLIENT' | 'GUEST';
  identifier: string; // BRN or Email
  industry?: string;  // (구) 업태를 지원분야에 매핑한 값 — 매칭에는 쓰지 않는다. 아래 bizType 참고
  clientType?: string; // 사업자 형태 ('법인' | '개인' | '비사업자') — 사업자 형태 전용 사업 판정용
  bizType?: string;   // 업태 원문 (예: '부동산업', '건 설 업') — 업종 적합성 판정·화면 표시용
  bizItem?: string;   // 종목 원문 (예: '배관 및 냉ㆍ난방 공사업') — 산업 분야 판정에 함께 사용
  // 대표자 속성. Edge Function 이 서버에서 계산해 boolean 만 내려준다 —
  // 생년월일·성별 같은 개인정보는 브라우저로 내리지 않는다.
  isYouthOwner?: boolean;   // 대표자가 만 39세 이하
  isFemaleOwner?: boolean;  // 대표자가 여성
  region?: string;    // Added for auto-filtering
  sigungu?: string[]; // 사업장 주소의 시·군·구 (예: ['성남시','분당구']) — 관내 전용 사업 판정용
  companyName?: string; // Added for display
  ceoName?: string;     // Added for display
}

export enum BizCategory {
  ALL = '전체',
  FINANCE = '금융',
  TECHNOLOGY = '기술',
  MANPOWER = '인력',
  EXPORT = '수출',
  DOMESTIC = '내수',
  STARTUP = '창업',
  MANAGEMENT = '경영',
  ETC = '기타',
}

export const BizRegions = [
  '전국', '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', 
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'
] as const;

export type BizRegionType = typeof BizRegions[number];