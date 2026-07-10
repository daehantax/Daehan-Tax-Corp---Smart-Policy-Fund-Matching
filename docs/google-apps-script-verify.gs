/**
 * ============================================================================
 * [대한세무법인] 고객사 사업자번호 확인 API — Apps Script 붙여넣기용 코드
 * ============================================================================
 *
 * ■ 설치 방법 (기존 상담접수 스크립트가 있는 프로젝트에 추가)
 *   1. 고객 명단이 들어 있는 "비공개" 구글 스프레드시트를 준비합니다.
 *      - 1행은 반드시 제목(헤더)이어야 합니다.
 *      - 필요한 열: 사업자번호, 회사명, 대표자명, 주소, 업종
 *        (영문 헤더 biz_number / company_name / ceo_name / address / biz_category 도 인식)
 *   2. 스프레드시트 주소창에서 ID를 복사합니다.
 *      예) https://docs.google.com/spreadsheets/d/【이부분이ID】/edit
 *   3. 아래 CLIENT_SHEET_ID 와 CLIENT_SHEET_NAME 을 수정합니다.
 *   4. 이 파일 전체를 기존 Apps Script 코드의 "맨 아래"에 붙여넣습니다.
 *      ※ 주의: 기존 코드에 doGet 함수가 이미 있다면 중복되므로 기존 것을 지우거나
 *              이 코드의 doGet과 합쳐야 합니다. (상담접수는 보통 doPost라 겹치지 않습니다)
 *   5. 배포 → 배포 관리 → 연필(수정) → 버전: "새 버전" → 배포
 *      (웹 앱 URL은 그대로 유지됩니다. 액세스 권한은 "모든 사용자" 유지)
 *
 * ■ 동작 방식
 *   - 웹사이트가  ?action=verify&brn=사업자번호  형태로 조회하면
 *     명단과 대조한 뒤 아래 정보"만" 응답합니다:
 *       회사명, 대표자명, 지역(주소의 첫 어절만), 업종
 *   - 전화번호·상세주소 등 민감한 정보는 절대 응답하지 않습니다.
 *   - 고객 명단 전체가 외부로 나가는 일은 없습니다.
 */

// ▼▼▼ 여기 두 줄을 수정하세요 ▼▼▼
var CLIENT_SHEET_ID = '여기에_고객명단_스프레드시트_ID를_붙여넣으세요';
var CLIENT_SHEET_NAME = '시트1'; // 고객 명단이 있는 시트(탭) 이름

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action === 'verify') {
    return jsonResponse_(verifyClientBrn_(params.brn));
  }
  return jsonResponse_({ error: 'unknown action' });
}

function verifyClientBrn_(brnRaw) {
  var brn = String(brnRaw || '').replace(/[^0-9]/g, '');
  if (brn.length !== 10) {
    return { found: false };
  }

  var sheet = SpreadsheetApp.openById(CLIENT_SHEET_ID).getSheetByName(CLIENT_SHEET_NAME);
  if (!sheet) {
    return { found: false, error: 'sheet not found' };
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    return { found: false };
  }

  var header = data[0].map(function (h) { return String(h).trim(); });
  var col = function (names) {
    for (var i = 0; i < names.length; i++) {
      var idx = header.indexOf(names[i]);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  var iBrn = col(['biz_number', '사업자등록번호', '사업자번호']);
  var iCompany = col(['company_name', '회사명', '상호']);
  var iCeo = col(['ceo_name', '대표자명', '대표자']);
  var iAddr = col(['address', '주소']);
  var iCategory = col(['biz_category', '업종']);

  if (iBrn === -1) {
    return { found: false, error: 'biz_number column not found' };
  }

  for (var r = 1; r < data.length; r++) {
    var rowBrn = String(data[r][iBrn] || '').replace(/[^0-9]/g, '');
    if (rowBrn === brn) {
      // 주소는 첫 어절(예: "서울", "경기")만 응답하여 상세주소 노출을 막습니다.
      var address = iAddr !== -1 ? String(data[r][iAddr] || '') : '';
      var regionHint = address.trim().split(' ')[0] || '';

      return {
        found: true,
        companyName: iCompany !== -1 ? String(data[r][iCompany] || '') : '',
        ceoName: iCeo !== -1 ? String(data[r][iCeo] || '') : '',
        regionHint: regionHint,
        bizCategory: iCategory !== -1 ? String(data[r][iCategory] || '') : ''
      };
    }
  }

  return { found: false };
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
