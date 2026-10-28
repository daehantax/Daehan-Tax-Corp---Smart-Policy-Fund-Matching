// =============================================================================
// 첨부파일에서 글자만 뽑는다 — PDF · HWPX · DOCX · XLSX · PPTX · ZIP · TXT
// (WORK_PLAN.md A-3)
//
// 왜: 본문만으로는 자격 기준선이 68~96% 밖에 안 읽힌다(C-9). 못 읽은 공고는
//   「별표 참조」·「공고문 참조」로 넘기고, 그 내용은 첨부파일 안에 있다.
//   A-2 로 주소는 다 모았으니(3,142개), 이제 글자를 꺼낸다.
//
// **파일은 남기지 않는다.** 받아서 글자만 뽑고 버린다 —
//   3,142개를 보관할 자리도 필요 없고, 원문이 필요하면 주소가 남아 있으니 다시 받으면 된다.
//
// ⚠ HWP(한글 바이너리)는 **이번에 다루지 않는다.** 2026-10-28 실측 —
//   첨부가 있는 공고 1,497건 중 **70.2%는 pdf·hwpx 같은 쉬운 형식을 하나라도** 갖고 있고,
//   A-3 가 실제로 겨냥하는 대상(조건은 걸렸는데 숫자를 못 읽은 60건)도 39건이 그렇다.
//   hwp 전용은 17건이다. 바이너리 포맷 파서를 붙이는 값에 비해 얻는 것이 작아
//   `unsupported` 로 기록만 남기고 넘어간다. 필요해지면 그때 붙인다.
//
// 모든 추출기는 **실패해도 예외를 던지지 않는다.** { text, status, error } 를 돌려준다 —
// 파일 하나가 깨졌다고 전체 작업이 멈추면 안 된다.
// =============================================================================

import { unzipSync, strFromU8 } from 'fflate';

/** 다룰 수 있는 형식 */
export const SUPPORTED = new Set(['pdf', 'hwpx', 'docx', 'xlsx', 'pptx', 'zip', 'txt', 'csv', 'xml']);
/** 지금은 못 읽는다고 **알고 있는** 형식 — 실패와 구분해 기록한다 */
export const KNOWN_UNSUPPORTED = new Set(['hwp', 'doc', 'xls', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'zip64']);

/** 글자 사이 빈 줄·공백을 정리한다. 추출기마다 결과가 들쭉날쭉해서 한 번에 다듬는다 */
export function tidy(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t 　]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim();
}

// ── ZIP 기반 형식 (hwpx · docx · xlsx · pptx) ───────────────────────────────
// 셋 다 속은 ZIP 안의 XML 이다. 따로 라이브러리를 붙일 필요가 없다.

/**
 * XML 태그를 걷어내고 글자만 남긴다.
 * @param cellBreak 표의 칸마다 줄을 바꾼다. xlsx 전용 —
 *   안 하면 "추천유형분류안전지원사항화재예방형…" 처럼 칸이 전부 붙어 나온다.
 *   docx 는 한 문단이 여러 `<w:t>` 로 쪼개져 있어 칸마다 끊으면 **단어가 깨진다.**
 */
function xmlText(xml, { cellBreak = false } = {}) {
  let s = String(xml);
  if (cellBreak) s = s.replace(/<\/(?:t|v)>/gi, '\n');
  return s
    // 문단·줄바꿈 태그는 줄바꿈으로 바꿔야 글이 붙지 않는다
    .replace(/<\/(?:w:p|p|hp:p|a:p|text:p)>/gi, '\n')
    .replace(/<(?:w:br|br|hp:lineBreak)\b[^>]*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');   // amp 는 마지막에 — 먼저 풀면 다른 엔티티가 두 번 풀린다
}

/** 형식별로 글자가 들어 있는 파일만 고른다. 이미지·스타일·메타데이터는 건너뛴다 */
const ZIP_TEXT_PARTS = {
  hwpx: (n) => /^Contents\/.*\.xml$/i.test(n) || /section\d*\.xml$/i.test(n),
  docx: (n) => /^word\/(document|header\d*|footer\d*)\.xml$/i.test(n),
  pptx: (n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n),
  xlsx: (n) => /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/i.test(n),
};

function fromZipXml(buf, ext) {
  const pick = ZIP_TEXT_PARTS[ext];
  const files = unzipSync(new Uint8Array(buf));
  const names = Object.keys(files).filter(pick).sort();
  if (names.length === 0) return '';
  // xlsx 는 sharedStrings 를 먼저 — 시트는 그 안의 번호만 들고 있다
  const out = [];
  for (const n of names) out.push(xmlText(strFromU8(files[n]), { cellBreak: ext === 'xlsx' }));
  return out.join('\n');
}

/**
 * 압축 파일 안의 한글 이름은 대개 CP949 다. fflate 는 바이트를 그대로 주므로
 * 라틴1로 읽힌 꼴("ÇÊ¼öÁ¦Ãâ")이 된다. 되돌릴 수 있으면 되돌린다.
 * 실패하면 원래 이름을 그대로 쓴다 — 이름이 깨진다고 글자를 못 뽑는 건 아니다.
 */
function fixZipName(name) {
  if (!/[\u0080-ÿ]/.test(name)) return name;
  try {
    const bytes = Uint8Array.from([...name].map((c) => c.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('euc-kr').decode(bytes);
    return /[가-힣]/.test(decoded) ? decoded : name;   // 한글이 나왔을 때만 바꾼다
  } catch {
    return name;
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────────

/**
 * pdfjs 는 페이지마다 글자 조각을 돌려준다. 조각 사이를 그냥 이으면 단어가 붙으므로
 * 줄이 바뀌는 자리(hasEOL)에서 줄바꿈을 넣는다.
 */
async function fromPdf(buf, { maxPages = 60 } = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // 정리는 **로딩 작업** 쪽에서 한다 — 문서 객체에는 destroy 가 없다(pdfjs 6)
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    // 글꼴·이미지는 필요 없다. 네트워크로 나가지 않게 막는다
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  try {
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, maxPages);
    const out = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        line += item.str;
        if (item.hasEOL) { out.push(line); line = ''; }
      }
      if (line) out.push(line);
      page.cleanup();
    }
    return out.join('\n');
  } finally {
    await task.destroy().catch(() => {});
  }
}

// ── ZIP (일반) ───────────────────────────────────────────────────────────────

/** zip 안의 파일을 하나씩 열어 본다. zip 안의 zip 까지는 들어가지 않는다 */
async function fromZip(buf, opts) {
  const files = unzipSync(new Uint8Array(buf));
  const out = [];
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const ext = (name.match(/\.([A-Za-z0-9]{1,6})$/)?.[1] ?? '').toLowerCase();
    if (ext === 'zip' || !SUPPORTED.has(ext)) continue;   // 중첩 zip 은 들어가지 않는다
    const r = await extractText(data.buffer ? Buffer.from(data) : data, ext, opts);
    if (r.text) out.push(`[${fixZipName(name)}]\n${r.text}`);
  }
  return out.join('\n\n');
}

// ── 들머리 ───────────────────────────────────────────────────────────────────

/**
 * 파일 하나에서 글자를 뽑는다.
 *
 * @returns {{ text: string, status: 'ok'|'empty'|'unsupported'|'failed', error?: string }}
 *   - `ok`          글자를 얻었다
 *   - `empty`       형식은 읽었는데 글자가 없다 (스캔한 이미지 PDF 등)
 *   - `unsupported` 못 읽는다고 **알고 있는** 형식 (hwp 등). 실패가 아니다
 *   - `failed`      읽으려다 깨졌다. 사유를 함께 남긴다
 */
export async function extractText(buf, ext, opts = {}) {
  const kind = String(ext ?? '').toLowerCase();
  if (!SUPPORTED.has(kind)) {
    return { text: '', status: 'unsupported', error: KNOWN_UNSUPPORTED.has(kind) ? undefined : `모르는 형식: ${kind || '(없음)'}` };
  }
  try {
    let raw = '';
    if (kind === 'pdf') raw = await fromPdf(buf, opts);
    else if (kind === 'zip') raw = await fromZip(buf, opts);
    else if (ZIP_TEXT_PARTS[kind]) raw = fromZipXml(buf, kind);
    else raw = new TextDecoder('utf-8', { fatal: false }).decode(buf);

    const text = tidy(raw);
    return text ? { text, status: 'ok' } : { text: '', status: 'empty' };
  } catch (err) {
    return { text: '', status: 'failed', error: String(err?.message ?? err).slice(0, 300) };
  }
}
