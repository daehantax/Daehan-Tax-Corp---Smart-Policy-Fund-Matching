// 공고에서 「제외 업종」 읽기 (C-12)
//
// 케이스는 전부 **2026-10-29 노출 중인 실제 공고의 첨부 글자에서 가져온 문장**이다.
// 지어낸 문장이 아니다. 실패하면 그 공고가 다시 틀리게 읽힌다는 뜻이다.
//
// 기본값은 **「모른다」(null)** 다. 「제외 업종이 없다」가 아니다.
// 그리고 읽어낸 것은 **경고**로만 쓴다 — 제외(score 0)는 지역·시·군에서만 한다(CLAUDE.md).
import { describe, expect, it } from 'vitest';
import { extractExclusions } from '../scripts/grant-exclusions.mjs';

const tags = (text: string) => extractExclusions(text)?.tags ?? null;

describe('extractExclusions — 읽어내는 것', () => {
  it('「업종명(코드)」 꼴', () => {
    expect(extractExclusions('□ 지원 제외 업종\n - 일반유흥주점업(56211), 부동산임대업'))
      .toEqual({ tags: ['부동산임대', '유흥주점'], ksic: ['56211'], standardList: false });
  });

  it('「코드 업종명」 꼴 — 별표의 표가 이 모양이다', () => {
    expect(extractExclusions([
      '□ 지원 제외 업종',
      '56211 일반유흥주점업',
      '56212 무도유흥주점업',
      '63992 가상자산 매매 및 중개업',
    ].join('\n'))).toEqual({
      tags: ['가상자산', '유흥주점'], ksic: ['56211', '56212', '63992'], standardList: false,
    });
  });

  it('대분류로만 적힌 별표 — 「부동산업 68」', () => {
    expect(tags('□ 융자제외 업종\n부동산업 68 부동산업 전부\n숙박 및 음식점업 55'))
      .toEqual(['부동산임대', '부동산중개']);
  });

  it('표준 제외 목록을 참조하면 표시해 둔다', () => {
    const got = extractExclusions('※ 중소기업 정책자금 융자제외 대상업종 <별첨1>\n□ 지원 제외 업종\n56211 일반유흥주점업');
    expect(got?.standardList).toBe(true);
  });
});

describe('extractExclusions — 오탐(誤探)을 막는 자리', () => {
  it('「단, …은 지원 가능」 — 괄호 안 코드는 허용이지 제외가 아니다', () => {
    // 「금융 및 보험업」 자체는 제외다. 다만 핀테크 66199 만 빠진다
    const got = extractExclusions(
      '□ 융자 제외 업종\n금융 및 보험업 64~66 금융 및 보험업(단, 핀테크 중 금융 지원 서비스업(66199)은 지원 가능)');
    expect(got?.ksic).not.toContain('66199');
  });

  it('허용 목록이 **앞에서** 열려도 그 안의 코드는 가져오지 않는다', () => {
    const got = extractExclusions([
      '□ 지원 제외 업종',
      '68',
      '부동산업',
      '* 단, 아래의 업종은 신청 가능',
      '- 부동산 중개·대리업(68221) 및 부동산 분양 대행업(68224)',
      '91113 경주장 및 동물 경기장 운영업',
    ].join('\n'));
    expect(got?.ksic).toEqual(['91113']);          // 허용된 68221·68224 는 빠진다
    expect(got?.tags).toContain('부동산임대');       // 「부동산업」 자체는 제외다
    expect(got?.tags).toContain('사행도박');         // 목록이 끝난 뒤의 제외는 살아 있다
  });

  it('「유사의료업(86902)은 신청가능」 — 허용이다', () => {
    const got = extractExclusions(
      '□ 지원 제외 업종\n86 보건업 * 단, 보건업(86) 중 유사의료업(86902)은 신청가능\n91113 경주장 및 동물 경기장 운영업');
    expect(got?.ksic).not.toContain('86902');
  });

  it('제조업은 사행시설업이 아니다 — 「도박기계 및 사행성 오락기구 제조업」', () => {
    expect(extractExclusions('□ 융자제외 업종\n제조업 33409 中 도박기계 및 사행성, 불건전 오락기구 제조업'))
      .toBeNull();
  });

  it('매출 기준표는 제외 목록이 아니다 — 「부동산업 … 10억원 이하」', () => {
    expect(extractExclusions('□ 지원 제외 업종\n - 체납기업\n업종별 기준: 부동산업, 전문·과학 및 기술 서비스업 등 10억원 이하'))
      .toBeNull();
  });

  it('지원 대상이기도 하면 버린다 — 부동산 임대업 지원사업', () => {
    expect(extractExclusions('1. 지원대상\n - 부동산 임대업을 영위하는 소상공인\n2. 지원 제외 업종\n - 부동산임대업'))
      .toBeNull();
  });

  it('「지원 제외 대상」은 업종 제외가 아니다 — 서류 미비·중복 수혜가 대부분이다', () => {
    expect(extractExclusions('<지원 제외대상>\n · 서류 미비, 허위사실 제출\n · 과제 중복성에 해당하는 경우'))
      .toBeNull();
  });

  it('제외 문단 밖의 코드는 가져오지 않는다 — 지원 대상 업종일 수 있다', () => {
    expect(extractExclusions('2. 지원대상\n - 환경설비 건설업(41224), 조경 건설업(41226)')).toBeNull();
  });
});

describe('extractExclusions — 기본값은 「모른다」', () => {
  it.each([
    ['', '빈 글'],
    ['   \n  ', '공백뿐'],
    ['부산시 소재 소상공인을 지원합니다', '제외 문단이 없다'],
  ])('%s → null (%s)', (text) => {
    expect(extractExclusions(text)).toBeNull();
  });

  it('null·undefined 도 null 이다', () => {
    expect(extractExclusions(null as unknown as string)).toBeNull();
    expect(extractExclusions(undefined as unknown as string)).toBeNull();
  });

  it('표준 목록만 언급하고 내용이 없으면 모르는 것이다', () => {
    expect(extractExclusions('② 중소기업 정책자금 융자제외 대상업종 <별첨 1>')).toBeNull();
  });
});
