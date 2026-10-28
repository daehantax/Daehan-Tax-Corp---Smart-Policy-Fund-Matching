// 첨부파일 글자 추출 (WORK_PLAN A-3)
//
// 네트워크를 쓰지 않는다 — zip 은 그 자리에서 만들고, 나머지는 형식 판정만 본다.
// 실제 공고 파일로 한 확인은 작업 로그에 남겼다(2026-10-28: pdf·hwpx·xlsx·docx·zip 통과).
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractText, tidy, KNOWN_UNSUPPORTED, SUPPORTED } from '../scripts/document-text.mjs';

const zip = (files: Record<string, string>) =>
  Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));

describe('tidy — 결과 다듬기', () => {
  it('줄 끝 공백과 빈 줄을 정리한다', () => {
    expect(tidy('  가나  \r\n\r\n\r\n다라  ')).toBe('가나\n\n다라');
  });
  it('탭과 전각 공백도 공백으로 본다', () => {
    expect(tidy('가\t나\u3000다')).toBe('가 나 다');
  });
});

describe('hwpx — zip 안의 XML', () => {
  it('Contents 안의 글자를 꺼낸다', () => {
    const buf = zip({
      'Contents/section0.xml': '<hp:p><hp:t>지원대상</hp:t></hp:p><hp:p><hp:t>업력 7년 이내</hp:t></hp:p>',
      'Preview/PrvText.txt': '미리보기는 읽지 않는다',
    });
    return extractText(buf, 'hwpx').then((r) => {
      expect(r.status).toBe('ok');
      expect(r.text).toContain('지원대상');
      expect(r.text).toContain('업력 7년 이내');
      expect(r.text).not.toContain('미리보기');   // 글자가 들어 있는 부분만 고른다
    });
  });

  it('문단이 줄로 갈린다 — 안 그러면 글이 다 붙는다', async () => {
    const buf = zip({ 'Contents/section0.xml': '<hp:p><hp:t>가나</hp:t></hp:p><hp:p><hp:t>다라</hp:t></hp:p>' });
    expect((await extractText(buf, 'hwpx')).text).toBe('가나\n다라');
  });
});

describe('docx / xlsx — 끊는 자리가 다르다', () => {
  it('docx 는 한 문단이 여러 조각으로 쪼개져 있어 조각마다 끊으면 안 된다', async () => {
    // "신청자격" 이 <w:t> 두 개로 쪼개진 경우 — 붙여 읽어야 한다
    const buf = zip({ 'word/document.xml': '<w:p><w:r><w:t>신청</w:t></w:r><w:r><w:t>자격</w:t></w:r></w:p>' });
    expect((await extractText(buf, 'docx')).text).toBe('신청자격');
  });

  it('xlsx 는 칸마다 끊는다 — 안 끊으면 표가 한 덩어리가 된다', async () => {
    const buf = zip({
      'xl/sharedStrings.xml': '<sst><si><t>추천유형</t></si><si><t>분류</t></si></sst>',
    });
    const r = await extractText(buf, 'xlsx');
    expect(r.text).toBe('추천유형\n분류');
  });
});

describe('zip — 안의 파일을 하나씩 본다', () => {
  it('읽을 수 있는 파일만 꺼내고 이름을 붙여 준다', async () => {
    const inner = zip({ 'word/document.xml': '<w:p><w:t>신청서 양식</w:t></w:p>' });
    const outer = Buffer.from(zipSync({
      '신청서.docx': new Uint8Array(inner),
      '로고.png': strToU8('PNG...'),
    }));
    const r = await extractText(outer, 'zip');
    expect(r.status).toBe('ok');
    expect(r.text).toContain('[신청서.docx]');
    expect(r.text).toContain('신청서 양식');
    expect(r.text).not.toContain('로고.png');   // 이미지는 건너뛴다
  });

  it('zip 안의 zip 까지는 들어가지 않는다', async () => {
    const inner = zip({ 'word/document.xml': '<w:p><w:t>깊은 곳</w:t></w:p>' });
    const outer = Buffer.from(zipSync({ '속.zip': new Uint8Array(zipSync({ 'a.docx': new Uint8Array(inner) })) }));
    expect((await extractText(outer, 'zip')).status).toBe('empty');
  });
});

describe('실패와 「원래 못 읽는 것」을 구분한다', () => {
  it('hwp 는 unsupported — 실패가 아니다', async () => {
    const r = await extractText(Buffer.from('아무거나'), 'hwp');
    expect(r.status).toBe('unsupported');
    expect(r.error).toBeUndefined();   // 사유가 없다 = 알고 있는 형식이다
  });

  it('모르는 형식에는 사유를 남긴다', async () => {
    const r = await extractText(Buffer.from('x'), 'xyz');
    expect(r.status).toBe('unsupported');
    expect(r.error).toContain('xyz');
  });

  it('깨진 파일은 failed — 예외를 던지지 않는다', async () => {
    const r = await extractText(Buffer.from('이건 zip 이 아니다'), 'hwpx');
    expect(r.status).toBe('failed');
    expect(r.error).toBeTruthy();
  });

  it('글자가 없으면 empty — 스캔한 이미지 PDF 가 이렇다', async () => {
    const buf = zip({ 'Contents/section0.xml': '<hp:p></hp:p>' });
    expect((await extractText(buf, 'hwpx')).status).toBe('empty');
  });

  it('hwp 는 다룰 수 있는 형식 목록에 없다 (2026-10-28 판단)', () => {
    expect(SUPPORTED.has('hwp')).toBe(false);
    expect(KNOWN_UNSUPPORTED.has('hwp')).toBe(true);
  });
});
