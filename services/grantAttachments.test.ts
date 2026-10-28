// 공고 첨부파일 목록 파서 (WORK_PLAN A-2)
//
// 값은 2026-10-28 기업마당 API 실제 응답에서 가져왔다.
// 두 출처 모두 첨부 주소를 API 로 그대로 주므로 **상세페이지를 긁지 않는다.**
import { describe, expect, it } from 'vitest';
import {
  attachmentsOrNull,
  bizinfoAttachments,
  extensionOf,
  smes24Attachments,
} from '../scripts/grant-attachments.mjs';

const U = (n: number) => `https://www.bizinfo.go.kr/cmm/fms/getImageFile.do?atchFileId=FILE_${n}&fileSn=1`;

describe('bizinfoAttachments', () => {
  it('공고문 본문 파일이 맨 앞에 온다 — 자격 조건이 가장 잘 적혀 있다', () => {
    const r = bizinfoAttachments({
      fileNm: '신청서류.hwpx', flpthNm: U(1),
      printFileNm: '공고문.pdf', printFlpthNm: U(2),
    });
    expect(r.map((a) => a.name)).toEqual(['공고문.pdf', '신청서류.hwpx']);
  });

  it("여러 개는 '@' 로 이어지고 이름과 주소가 자리순으로 짝이 맞는다", () => {
    const r = bizinfoAttachments({
      fileNm: '신청서류.hwpx@신청서류.pdf@제외업종.hwpx',
      flpthNm: `${U(1)}@${U(2)}@${U(3)}`,
    });
    expect(r).toEqual([
      { name: '신청서류.hwpx', url: U(1), ext: 'hwpx' },
      { name: '신청서류.pdf', url: U(2), ext: 'pdf' },
      { name: '제외업종.hwpx', url: U(3), ext: 'hwpx' },
    ]);
  });

  it('같은 주소가 두 번 오면 한 번만 남는다 — 공고문이 첨부에도 들어 있곤 한다', () => {
    const r = bizinfoAttachments({
      fileNm: '공고문.pdf', flpthNm: U(9),
      printFileNm: '공고문.pdf', printFlpthNm: U(9),
    });
    expect(r).toHaveLength(1);
  });

  it('주소가 없으면 버린다 — 이름만 있으면 내려받을 수 없다', () => {
    expect(bizinfoAttachments({ fileNm: '신청서류.hwpx', flpthNm: '' })).toEqual([]);
    expect(bizinfoAttachments({ fileNm: '신청서류.hwpx', flpthNm: '/cmm/fms/fileDown.do?x=1' })).toEqual([]);
  });

  it('이름이 모자라도 주소가 있으면 남긴다 — 파일명으로 거르지 않는다(C-1)', () => {
    const r = bizinfoAttachments({ fileNm: '첫번째.pdf', flpthNm: `${U(1)}@${U(2)}` });
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ name: '', url: U(2), ext: '' });
  });

  it('첨부가 없는 공고는 빈 목록', () => {
    expect(bizinfoAttachments({})).toEqual([]);
    expect(bizinfoAttachments({ fileNm: null, flpthNm: null })).toEqual([]);
  });
});

describe('smes24Attachments', () => {
  it('pblancFileUrl 과 pblancAttach 를 함께 모은다', () => {
    const r = smes24Attachments({
      pblancFileNm: '공고문.hwp', pblancFileUrl: 'https://portal.smes.go.kr/f/1',
      pblancAttachNm: '서식.xlsx', pblancAttach: 'https://portal.smes.go.kr/f/2',
    });
    expect(r.map((a) => a.ext)).toEqual(['hwp', 'xlsx']);
  });

  it('주소가 아닌 값은 받지 않는다', () => {
    expect(smes24Attachments({ pblancFileNm: 'a.pdf', pblancFileUrl: '-' })).toEqual([]);
  });
});

describe('거드는 함수들', () => {
  it('확장자는 소문자로', () => {
    expect(extensionOf('공고문.PDF')).toBe('pdf');
    expect(extensionOf('붙임 2. 게시자료.zip')).toBe('zip');
    expect(extensionOf('이름만')).toBe('');
    expect(extensionOf(null)).toBe('');
  });

  it('빈 목록은 null 로 — 「없다」와 「아직 안 봤다」를 섞지 않는다', () => {
    expect(attachmentsOrNull([])).toBeNull();
    expect(attachmentsOrNull(null)).toBeNull();
    expect(attachmentsOrNull([{ name: 'a', url: 'u', ext: '' }])).toHaveLength(1);
  });
});

// ── 중소벤처24 의 함정 ─────────────────────────────────────────────────────
// 2026-10-28 첫 동기화에서 실제로 틀렸던 자리. 값은 DB 에 담겼던 그대로다.
describe('중소벤처24 — 이름 자리에 내부 경로가 온다', () => {
  it("'|' 로도 값을 가른다 — 중소벤처24는 '@' 가 아니다", () => {
    const r = smes24Attachments({
      pblancFileNm: 'a.pdf|b.hwp',
      pblancFileUrl: 'https://portal.smes.go.kr/f/1|https://portal.smes.go.kr/f/2',
    });
    expect(r.map((x) => x.name)).toEqual(['a.pdf', 'b.hwp']);
  });

  it('경로처럼 생긴 값은 이름으로 쓰지 않는다 — 주소는 그대로 남긴다', () => {
    const r = smes24Attachments({
      pblancAttachNm: '/save/pbanc/PBLN_000000000105162/attached_files',
      pblancAttach: 'https://www.bizinfo.go.kr/cmm/fms/getImageFile.do?atchFileId=FILE_1&fileSn=1',
    });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('');     // 경로를 파일명으로 찍지 않는다
    expect(r[0].ext).toBe('');      // '.do' 가 확장자로 잡히지 않는다
    expect(r[0].url).toContain('bizinfo.go.kr');
  });

  it("'/aidata/...' 덩어리도 이름으로 쓰지 않는다", () => {
    const blob = '/aidata/save/pbanc/pblanc/20261026/63de0541.do|/aidata/save/pbanc/pblanc/20261026/f1a658e1.do';
    const r = smes24Attachments({
      pblancAttachNm: blob,
      pblancAttach: 'https://www.smes.go.kr/sanhakin/common/fileDownload.do?DOWNLOAD_KEY_IF=7485F3F8',
    });
    expect(r[0].name).toBe('');
    expect(r[0].ext).toBe('');
  });

  it('제대로 된 이름은 그대로 둔다', () => {
    const r = smes24Attachments({
      pblancFileNm: '2025년_중소기업_기술거래_활성화_지원사업_시행계획_공고.hwp',
      pblancFileUrl: 'https://portal.smes.go.kr/home/api/v1/files/download/PB_1/0',
    });
    expect(r[0].ext).toBe('hwp');
    expect(r[0].name).toContain('기술거래');
  });
});
