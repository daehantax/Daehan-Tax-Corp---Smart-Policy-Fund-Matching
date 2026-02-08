import { Grant, BizCategory, ClientData } from './types';

export const MOCK_GRANTS: Grant[] = [
  {
    id: '1',
    department: '광주광역시',
    agency: '직접수행',
    category: BizCategory.ETC,
    title: '[광주] 2026년 상반기 지역활성화 펀드 지원사업',
    startDate: '2026-02-02',
    endDate: '2026-02-12',
    registrationDate: '2026-02-04',
    detailUrl: 'https://www.bizinfo.go.kr',
    views: 120,
    supportAmount: '업체당 5천만원'
  },
  {
    id: '2',
    department: '조달청',
    agency: '한국조달연구원',
    category: BizCategory.TECHNOLOGY,
    title: '2026년 공공혁신수요기반 R&D 신규과제 모집공고',
    startDate: '2026-02-09',
    endDate: '2026-03-03',
    registrationDate: '2026-02-04',
    detailUrl: 'https://www.bizinfo.go.kr',
    views: 450,
    supportAmount: '최대 3억원'
  },
  {
    id: '3',
    department: '경기도',
    agency: '경기대진테크노파크',
    category: BizCategory.TECHNOLOGY,
    title: '[경기] 2026년 가구디자인 고도화 및 마케팅 지원사업',
    startDate: '2026-02-03',
    endDate: '2026-12-31',
    registrationDate: '2026-02-04',
    detailUrl: 'https://www.bizinfo.go.kr',
    views: 89,
    supportAmount: '기업당 1,500만원'
  },
  {
    id: '4',
    department: '강원특별자치도',
    agency: '중소기업중앙회강원지역',
    category: BizCategory.DOMESTIC,
    title: '[강원] 2026년 우수 중소기업 판로개척 지원사업',
    startDate: '2026-02-03',
    endDate: '2026-02-26',
    registrationDate: '2026-02-04',
    detailUrl: 'https://www.bizinfo.go.kr',
    views: 210,
    supportAmount: '부스비 80% 지원'
  },
  {
    id: '5',
    department: '산업통상부',
    agency: '한국산업기술진흥원',
    category: BizCategory.TECHNOLOGY,
    title: '2026년 중견중소기업상생형 기술개발사업 공고',
    startDate: '2026-02-03',
    endDate: '2026-03-04',
    registrationDate: '2026-02-04',
    detailUrl: 'https://www.bizinfo.go.kr',
    views: 1500,
    supportAmount: '최대 5억원'
  },
  {
    id: '6',
    department: '중소벤처기업부',
    agency: '중소벤처기업진흥공단',
    category: BizCategory.FINANCE,
    title: '2026년도 중소기업 정책자금 융자계획 공고',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    registrationDate: '2025-12-28',
    detailUrl: 'https://www.bizinfo.go.kr',
    views: 5200,
    supportAmount: '최대 60억원 융자'
  },
  {
    id: '7',
    department: 'KOTRA',
    agency: 'KOTRA',
    category: BizCategory.EXPORT,
    title: '2026년 수출바우처사업 1차 참여기업 모집',
    startDate: '2026-01-15',
    endDate: '2026-02-28',
    registrationDate: '2026-01-01',
    detailUrl: 'https://www.bizinfo.go.kr',
    views: 3100,
    supportAmount: '3천만원 ~ 1억원 바우처'
  },
  {
    id: '8',
    department: '부산광역시',
    agency: '부산경제진흥원',
    category: BizCategory.STARTUP,
    title: '[부산] 2026년 청년창업지원사업 예비창업자 모집',
    startDate: '2026-02-10',
    endDate: '2026-03-10',
    registrationDate: '2026-02-05',
    detailUrl: 'https://www.bizinfo.go.kr',
    views: 670,
    supportAmount: '사업화자금 2,000만원'
  },
  {
    id: '9',
    department: '고용노동부',
    agency: '근로복지공단',
    category: BizCategory.MANPOWER,
    title: '2026년 일자리 안정자금 지원사업 공고',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    registrationDate: '2025-12-20',
    detailUrl: 'https://www.bizinfo.go.kr',
    views: 8900,
    supportAmount: '인당 월 13만원'
  },
  {
    id: '10',
    department: '서울시',
    agency: '서울신용보증재단',
    category: BizCategory.MANAGEMENT,
    title: '[서울] 소상공인 경영개선 컨설팅 지원사업',
    startDate: '2026-03-01',
    endDate: '2026-06-30',
    registrationDate: '2026-02-20',
    detailUrl: 'https://www.bizinfo.go.kr',
    views: 400,
    supportAmount: '전문가 컨설팅 3회'
  }
];

// 이제 실제 데이터는 public/data/dhadress_processed_data_20260125_182336.csv 파일에서 로드됩니다.
// 이 배열은 CSV 파일 로드 실패 시 테스트용으로 사용되는 비상용(Fallback) 데이터입니다.
export const MOCK_CLIENT_DB: ClientData[] = [
  {
    id: 'fallback_1',
    company_name: '테스트용 샘플기업',
    ceo_name: '김테스트',
    biz_type: '법인',
    biz_number: '123-45-67890',
    address: '서울특별시 강남구 테헤란로',
    address_detail: '123번지',
    phone: '010-0000-0000',
    biz_category: '서비스업',
    biz_item: '소프트웨어 개발'
  }
];