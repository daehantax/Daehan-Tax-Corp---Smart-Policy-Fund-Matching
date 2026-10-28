// =============================================================================
// 공고 첨부파일 목록 — API 응답에서 이름·주소를 짝지어 꺼낸다 (WORK_PLAN.md A-2)
//
// **상세페이지를 긁지 않는다.** 2026-10-28 조사에서 두 출처 모두 첨부파일 주소를
// API 로 그대로 준다는 것이 확인됐다.
//   · 기업마당   — fileNm/flpthNm 78.0% · printFileNm/printFlpthNm 100%
//                  (flpthNm 은 완전한 https 주소다. 여러 개는 '@' 로 이어진다)
//   · 중소벤처24 — pblancFileNm/pblancFileUrl 93.8% · pblancAttachNm/pblancAttach 78.6%
//
// 그래서 계획서의 옛 A-2(상세페이지 → atchFileId 추출 → fileDown.do)는 필요 없다.
// 긁지 않으니 이용약관 확인(C-5) 부담도 이 경로에는 없다 — API 가 준 자료를 쓸 뿐이다.
//
// 여기서는 **주소만 모은다. 내려받지 않는다.** 내려받기·텍스트 추출은 A-3 의 몫이다.
// =============================================================================

/** 기업마당·중소벤처24 모두 여러 값을 '@' 로 잇는다 */
const SEP = '@';

/** 주소로 쓸 수 있는 값인가 — http(s) 만 받는다. 상대경로·빈값·'-' 는 버린다 */
function usableUrl(v) {
  const s = String(v ?? '').trim();
  return /^https?:\/\/\S+$/.test(s) ? s : null;
}

/** 파일 이름에서 확장자만 뽑는다 (소문자). 없으면 빈 문자열 */
export function extensionOf(name) {
  const m = String(name ?? '').trim().match(/\.([A-Za-z0-9]{1,6})$/);
  return m ? m[1].toLowerCase() : '';
}

/**
 * 이름 목록과 주소 목록을 **자리 순서대로** 짝짓는다.
 *
 * ⚠ 개수가 어긋날 수 있다(이름만 있고 주소가 없는 경우 등). **주소가 기준이다** —
 *   주소 없는 이름은 내려받을 수 없으니 버리고, 이름 없는 주소는 이름을 비워 남긴다.
 *   파일명으로 거르지 않는다 (C-1 결론 1 — 이름만 보고 거르면 26% 를 놓쳤다).
 */
function zipNamesUrls(namesRaw, urlsRaw) {
  const names = String(namesRaw ?? '').split(SEP).map((s) => s.trim());
  const urls = String(urlsRaw ?? '').split(SEP).map((s) => s.trim());
  const out = [];
  for (let i = 0; i < urls.length; i++) {
    const url = usableUrl(urls[i]);
    if (!url) continue;
    const name = names[i] ?? '';
    out.push({ name, url, ext: extensionOf(name) });
  }
  return out;
}

/** 같은 주소가 두 번 들어오면 한 번만 남긴다 (공고문이 첨부에도 들어 있는 경우가 있다) */
function dedupe(list) {
  const seen = new Set();
  return list.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
}

/**
 * 기업마당 응답 한 건 → 첨부파일 목록.
 * printFileNm(공고문 본문)을 **먼저** 둔다 — 자격 조건이 가장 잘 적혀 있는 파일이다.
 */
export function bizinfoAttachments(item) {
  return dedupe([
    ...zipNamesUrls(item?.printFileNm, item?.printFlpthNm),
    ...zipNamesUrls(item?.fileNm, item?.flpthNm),
  ]);
}

/** 중소벤처24 응답 한 건 → 첨부파일 목록 */
export function smes24Attachments(item) {
  return dedupe([
    ...zipNamesUrls(item?.pblancFileNm, item?.pblancFileUrl),
    ...zipNamesUrls(item?.pblancAttachNm, item?.pblancAttach),
  ]);
}

/**
 * 저장할 모양으로 — 빈 목록은 null 로 돌려준다.
 * **없는 것과 「첨부가 0개」를 구분한다**: null 은 「아직 안 봤다/못 읽었다」,
 * 빈 배열은 저장하지 않는다.
 */
export function attachmentsOrNull(list) {
  return Array.isArray(list) && list.length > 0 ? list : null;
}
