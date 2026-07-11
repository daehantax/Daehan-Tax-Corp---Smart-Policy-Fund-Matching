/**
 * 기업마당 API 중계(릴레이) 스크립트
 * =====================================================================
 * 왜 필요한가?
 *   기업마당 서버가 GitHub Actions(해외 데이터센터 IP)의 직접 접속을
 *   간헐적으로 차단합니다. 이 스크립트를 구글 Apps Script 웹앱으로
 *   배포해두면, GitHub Actions → 구글 → 기업마당 경로로 우회 호출합니다.
 *   (인증키는 이 스크립트에 저장되지 않고 호출 시 전달받아 그대로 전달만 합니다)
 *
 * 배포 방법 (상담 접수 스크립트 배포와 동일한 절차):
 *   1. script.google.com → 새 프로젝트 → 이 파일 내용 전체 붙여넣기
 *   2. 배포 → 새 배포 → 유형: 웹 앱
 *      - 실행 계정: 나
 *      - 액세스 권한: 모든 사용자
 *   3. 발급된 웹 앱 URL(https://script.google.com/macros/s/.../exec)을 복사
 *   4. GitHub 저장소 Settings → Secrets and variables → Actions →
 *      New repository secret → Name: BIZINFO_RELAY_URL, Secret: 복사한 URL
 *
 * 동작 확인 (배포 후 브라우저에서):
 *   <웹앱URL>?crtfcKey=인증키&dataType=json&searchCnt=3
 *   → 기업마당 공고 JSON이 보이면 성공
 */

var BIZINFO_API = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';

function doGet(e) {
  var params = (e && e.parameter) || {};
  var pairs = [];
  for (var key in params) {
    pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
  }
  var url = BIZINFO_API + (pairs.length ? '?' + pairs.join('&') : '');

  try {
    var res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true,
    });
    return ContentService
      .createTextOutput(res.getContentText())
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ relayError: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
