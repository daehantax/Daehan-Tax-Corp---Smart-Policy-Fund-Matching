/**
 * ============================================================================
 * ⚠ 더 이상 쓰지 않는 경로입니다 (2026-08-10 폐기)
 * ============================================================================
 *
 * 앱은 이제 고객사 확인을 수파베이스 Edge Function(verify-brn) 으로만 합니다.
 * 이 스크립트로 넘어가던 폴백 경로는 제거했습니다 — 사업자번호 하나로 통과시켜
 * 대표자 성명 2차 확인을 무력화하는 우회로였기 때문입니다.
 * (방문자가 브라우저에서 *.supabase.co 요청을 차단하면 이쪽으로 넘어갔습니다.)
 *
 * ■ 운영자가 반드시 해야 할 일
 *   이미 배포해 둔 웹앱은 코드에서 URL 을 지워도 주소를 아는 사람이 계속 호출할 수
 *   있고, 공개 저장소의 git 히스토리에 URL 이 남아 있습니다.
 *   **Apps Script 배포 자체를 중지하거나 삭제**하세요.
 *   (Apps Script 편집기 → 배포 → 배포 관리 → 아카이브/중지)
 *
 * 아래 코드는 기록 목적으로만 남겨 둡니다. 새로 배포하지 마세요.
 *
 * ============================================================================
 * [대한세무법인] 고객사 사업자번호 확인 API — Apps Script 붙여넣기용 코드 (v2)
 * ============================================================================
 *
 * ■ 설치 방법
 *   1. 고객 명단이 들어 있는 "비공개" 구글 스프레드시트를 준비합니다.
 *   2. 아래 CLIENT_SHEET_ID 와 CLIENT_SHEET_NAME 을 수정합니다.
 *   3. Apps Script 프로젝트에 이 파일 전체를 붙여넣습니다. (기존 doGet과 중복 금지)
 *   4. 배포 → 배포 관리 → 연필(수정) → 버전: "새 버전" → 배포
 *      ※ 액세스 권한은 반드시 "모든 사용자"여야 합니다.
 *
 * ■ 제공 기능
 *   ?action=verify&brn=사업자번호  → 명단 대조 (일치 시 최소 정보만 응답)
 *   ?action=health                → 연결 자가진단 (개인정보 없이 상태만 응답)
 */

// ▼▼▼ 여기 두 줄을 수정하세요 ▼▼▼
var CLIENT_SHEET_ID = '여기에_고객명단_스프레드시트_ID를_붙여넣으세요';
var CLIENT_SHEET_NAME = '시트1'; // 고객 명단이 있는 시트(탭) 이름

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action === 'verify') {
    return jsonResponse_(verifyClientBrn_(params.brn));
  }
  if (params.action === 'health') {
    return jsonResponse_(healthCheck_());
  }
  return jsonResponse_({ error: 'unknown action' });
}

// 연결 자가진단: 시트 연결/헤더/행 수만 확인 (고객 정보는 응답하지 않음)
function healthCheck_() {
  try {
    var ss = SpreadsheetApp.openById(CLIENT_SHEET_ID);
    var sheet = ss.getSheetByName(CLIENT_SHEET_NAME);
    if (!sheet) {
      return {
        ok: false,
        reason: 'sheet(탭)을 찾지 못했습니다. CLIENT_SHEET_NAME을 확인하세요.',
        lookingFor: CLIENT_SHEET_NAME,
        availableSheets: ss.getSheets().map(function (s) { return s.getName(); })
      };
    }
    var data = sheet.getDataRange().getValues();
    var header = (data[0] || []).map(function (h) { return String(h).trim(); });
    var iBrn = findColumn_(header, ['biz_number', '사업자등록번호', '사업자번호']);
    var validBrnRows = 0;
    if (iBrn !== -1) {
      for (var r = 1; r < data.length; r++) {
        var digits = String(data[r][iBrn] || '').replace(/[^0-9]/g, '');
        if (digits.length === 10) validBrnRows++;
      }
    }
    return {
      ok: true,
      sheetName: CLIENT_SHEET_NAME,
      totalRows: data.length - 1,
      headers: header,
      brnColumnFound: iBrn !== -1,
      rowsWithValid10DigitBrn: validBrnRows
    };
  } catch (err) {
    return { ok: false, reason: '스프레드시트를 열지 못했습니다. CLIENT_SHEET_ID를 확인하세요.', detail: String(err) };
  }
}

function verifyClientBrn_(brnRaw) {
  try {
    var brn = String(brnRaw || '').replace(/[^0-9]/g, '');
    if (brn.length !== 10) {
      return { found: false, error: 'brn must be 10 digits, got ' + brn.length };
    }

    var sheet = SpreadsheetApp.openById(CLIENT_SHEET_ID).getSheetByName(CLIENT_SHEET_NAME);
    if (!sheet) {
      return { found: false, error: 'sheet not found: ' + CLIENT_SHEET_NAME };
    }

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return { found: false, error: 'sheet is empty' };
    }

    var header = data[0].map(function (h) { return String(h).trim(); });
    var iBrn = findColumn_(header, ['biz_number', '사업자등록번호', '사업자번호']);
    var iCompany = findColumn_(header, ['company_name', '회사명', '상호']);
    var iCeo = findColumn_(header, ['ceo_name', '대표자명', '대표자']);
    var iAddr = findColumn_(header, ['address', '주소']);
    var iCategory = findColumn_(header, ['biz_category', '업종']);

    if (iBrn === -1) {
      return { found: false, error: 'biz_number column not found', headers: header };
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
  } catch (err) {
    return { found: false, error: String(err) };
  }
}

function findColumn_(header, names) {
  for (var i = 0; i < names.length; i++) {
    var idx = header.indexOf(names[i]);
    if (idx !== -1) return idx;
  }
  return -1;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
