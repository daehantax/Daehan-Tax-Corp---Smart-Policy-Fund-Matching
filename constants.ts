import { Grant, BizCategory } from './types';

// ==============================================================================
// 시·군·구(기초자치단체) 이름 사전
//
// 왜 사전이 필요한가:
//   기업마당 공고는 "[경기] 화성시 2026년 …" 처럼 제목에 시·군을 적고,
//   해시태그에도 "남양주시" 같은 토큰을 넣는다. 이걸 "○○시|군|구" 정규식만으로
//   긁으면 '강소특구', '규제자유특구', '국제공동연구', '고위험산업군' 같은 토큰이
//   시·군·구로 잡혀 해당 공고가 전 고객사에게서 사라지는 사고가 난다.
//   그래서 화이트리스트로만 인정한다. 사전에 없는 시·군은 "필터가 적용되지
//   않는다"(= 부적격 공고가 조금 남는다) 정도로 안전하게 실패한다.
//
// 만든 방법: ① 공고 제목의 "[지역] ○○시" 패턴에서 추출(오탐 0건 확인)
//            ② 실제 고객사 주소에서 추출한 시·군·구
//            ③ 정규식이 못 잡는 2글자 자치구(중구/동구/서구/남구/북구) 보강
// 새 시·군이 필요하면 이 배열에 추가하면 된다 (일반구·행정구도 포함).
// ==============================================================================
export const SIGUNGU_NAMES: string[] = [
  '중구', '동구', '서구', '남구', '북구',
  '가평군', '강남구', '강동구', '강릉시', '강북구', '강서구', '강진군', '거제시',
  '검단구', '경산시', '경주시', '계양구', '고령군', '고성군', '고양시', '고흥군',
  '공주시', '과천시', '관악구', '광명시', '광산구', '광양시', '광주시',
  '광진구', '괴산군', '구례군', '구로구', '구리시', '구미시', '군산시', '군포시',
  '권선구', '금산군', '금정구', '금천구', '기장군', '기흥구', '김제시', '김천시',
  '김포시', '김해시', '남동구', '남양주시', '남원시', '노원구', '단양군', '단원구',
  '달서구', '달성군', '담양군', '당진시', '대덕구', '덕양구', '덕진구', '도봉구',
  '동남구', '동대문구', '동두천시', '동래구', '동안구', '동작구', '동탄구', '동해시',
  '마포구', '만안구', '목포시', '무안군', '무주군', '문경시', '미추홀구',
  '병점구', '보령시', '봉화군', '부산진구', '부안군', '부천시', '부평구', '분당구',
  '사상구', '사천시', '산청군', '삼척시', '상당구', '상록구', '상주시', '서귀포시',
  '서대문구', '서북구', '서초구', '성남시', '성동구', '성북구', '성주군',
  '소사구', '속초시', '송파구', '수성구', '수영구', '수원시', '수정구', '수지구',
  '시흥시', '아산시', '안동시', '안산시', '안성시', '안양시', '양산시', '양양군',
  '양주시', '양천구', '양평군', '여수시', '여주시', '연수구', '연천군', '영덕군',
  '영도구', '영등포구', '영양군', '영월군', '영주시', '영천시', '영통구', '예산군',
  '예천군', '오산시', '오정구', '옥천군', '완도군', '완산구', '완주군', '용산구',
  '용인시', '울릉군', '울주군', '울진군', '원미구', '원주시', '유성구', '은평구',
  '음성군', '의성군', '의왕시', '의정부시', '이천시', '익산시', '인제군', '일산동구',
  '일산서구', '임실군', '장성군', '장수군', '장안구', '장흥군', '전주시', '정선군',
  '정읍시', '제물포구', '제주시', '제천시', '종로구', '중랑구', '중원구', '진안군',
  '진주시', '창녕군', '창원시', '처인구', '천안시', '철원군', '청도군', '청송군',
  '청원구', '청주시', '춘천시', '충주시', '칠곡군', '태백시', '태안군', '통영시',
  '파주시', '팔달구', '평창군', '평택시', '포천시', '포항시', '하남시', '하동군',
  '함안군', '해남군', '해운대구', '홍천군', '화성시', '화순군', '화천군', '횡성군',
  '효행구', '흥덕구',
];

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
