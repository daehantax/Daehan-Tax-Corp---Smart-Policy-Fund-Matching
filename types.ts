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
  // 공고 본문에서 읽어낸 자격 기준선 (DB conditions 컬럼 — WORK_PLAN C-9).
  // ⚠ **읽어낸 축만 담긴다. 없는 축은 「제한 없음」이 아니라 「못 읽었다」는 뜻이다.**
  conditions?: GrantConditions;
  
  // Optional fields for UI enhancements (can be inferred or AI-generated)
  summary?: string;
  supportAmount?: string;
  views?: number;
  
  // Smart Tags based on analysis
  tags?: string[]; 
}

/** 기준선 한 축. 한쪽만 있을 수 있다 ("10억원 이하" 는 상한만) */
export interface ConditionRange {
  min: number | null;
  max: number | null;
}

/** 공고가 거는 자격 기준선. 단위 — 매출 원 · 업력 년(0.5=6개월) · 인원 명 */
export interface GrantConditions {
  revenue?: ConditionRange;
  years?: ConditionRange;
  employees?: ConditionRange;
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
  // ── 수치 프로필 (WORK_PLAN A-6) — Edge Function 이 신고자료에서 꺼내 온다 ──
  // ⚠ 매출은 **구간만** 내려온다. 원본 금액은 브라우저에 없다.
  revenueBracket?: string;   // 예: '1~3억'
  revenueMin?: number;       // 구간 하한(원, 포함) — 공고 기준선과 비교할 때 쓴다
  revenueMax?: number;       // 구간 상한(원, 미만). 최상단 구간은 undefined
  revenueYear?: number;      // 어느 해 귀속인가
  // 'partial' = 1기나 2기가 비어 반쪽 금액이다. **판정에 쓰지 말고 「확인 필요」로 표시한다**
  revenueCoverage?: 'full' | 'partial' | 'none';
  revenueBasis?: '신고' | '수기';
  businessYears?: number;    // 업력(만 년). 개업일을 모르면 undefined
  // ⚠ 값이 없는 것은 「직원 0명」이 아니라 **모른다**는 뜻이다. 원천세를 우리가 맡지 않은
  //   거래처가 많다(신고대리 236곳). 0 으로 채우지 않는다.
  employeeCount?: number;
  employeeYear?: number;
  employeeMonth?: number;
  employeeMonths?: number;   // 그 해 기록된 달 수. 1~2달뿐이면 대표값으로 보기 약하다
  industryCode?: string;     // 국세청 업종코드 6자리 ⚠ 공고의 KSIC 5자리와 호환되지 않는다
  // 고객사가 직접 체크한 항목 (WORK_PLAN C-10). 세무 자료에 없는 것들 —
  // 특허·연구소·공장등록·수출실적·인증 등.
  // ⚠ **값이 없는 키는 「아니오」가 아니라 「대답 안 함」이다.** 판정하지 않는다.
  selfCheck?: Partial<Record<string, boolean>>;
  region?: string;    // Added for auto-filtering
  sigungu?: string[]; // 사업장 주소의 시·군·구 (예: ['성남시','분당구']) — 관내 전용 사업 판정용
  companyName?: string; // Added for display
  // 대표자 성명은 담지 않는다 — 화면에서 쓰지 않는 개인정보는 브라우저로 내려보내지 않는다.
  // 2단계 확인(사업자번호 + 대표자 성명)에서 이름은 입력 대조용으로만 쓰인다.
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