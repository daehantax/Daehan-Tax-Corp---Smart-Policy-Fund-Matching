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
  
  // Optional fields for UI enhancements (can be inferred or AI-generated)
  summary?: string;
  supportAmount?: string;
  views?: number;
  
  // Smart Tags based on analysis
  tags?: string[]; 
}

export interface GeneralInquiry {
  name: string;
  contact: string;
  email: string;
  industry: string;
  requestDetails: string;
}

// Structure matching the provided CSV screenshot
export interface ClientData {
  id: string;
  company_name: string;
  ceo_name: string;
  biz_type: string;     // e.g. 법인, 개인
  biz_number: string;   // e.g. 680-82-00118
  address: string;
  address_detail: string;
  phone: string;
  biz_category: string; // e.g. 서비스업
  biz_item: string;     // e.g. 자원봉사활동
}

export interface UserSession {
  type: 'CLIENT' | 'GUEST';
  identifier: string; // BRN or Email
  industry?: string;
  region?: string;    // Added for auto-filtering
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