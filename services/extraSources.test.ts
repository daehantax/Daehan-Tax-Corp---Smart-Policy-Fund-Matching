import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  normalizeTitle,
  dropDuplicates,
  manualToItem,
  loadManualItems,
  smes24ToItem,
  fetchSmes24Items,
  protectedPrefixes,
} from '../scripts/extra-sources.mjs';
import {
  loadDivisions,
  extractRegionCodes,
  extractSigunguCodes,
  extractSupportAmount,
  extractTargetFlags,
  __setSidoOf,
} from '../scripts/sync-bizinfo.mjs';

// 기업마당 외 추가 출처(수동 등록·중소벤처24)를 합칠 때 지켜야 할 것들.
//   · 기업마당과 같은 공고가 두 번 뜨면 안 된다 (기업마당 쪽을 남긴다)
//   · 하루 접속 실패로 그 출처의 공고가 사이트에서 사라지면 안 된다
//   · 수동 등록 공고도 기업마당 공고와 똑같이 지역·시군 판정을 받아야 한다

const MANUAL_FILE = path.resolve(__dirname, '../data/manual-grants.json');
const quiet = { log() {}, warn() {} } as unknown as Console;

beforeAll(() => {
  const divisions = JSON.parse(readFileSync(path.resolve(__dirname, '../data/administrative-divisions.json'), 'utf8'));
  const { sidoOf } = loadDivisions(divisions);
  __setSidoOf(sidoOf);
});

describe('공고명 정규화·중복 제거', () => {
  it('지역 머리말·공백·공고 꼬리를 걷어낸다', () => {
    expect(normalizeTitle('[경기] 성남시 2026년 중소기업육성자금 이차보전금 지원계획 공고'))
      .toBe(normalizeTitle('성남시 2026년 중소기업육성자금 이차보전금 지원계획'));
    expect(normalizeTitle('[경기] 용인시 2026년 해외플랫폼 입점 지원사업 기업 추가 모집 공고'))
      .toBe('용인시2026년해외플랫폼입점지원사업기업추가');
  });

  it('기업마당에 이미 있는 공고는 추가 출처에서 뺀다', () => {
    const base = [{ pblancNm: '[경기] 성남시 2026년 중소기업육성자금 이차보전금 지원계획 공고' }];
    const extra = [
      { pblancNm: '성남시 2026년 중소기업육성자금 이차보전금 지원계획' },     // 같은 공고
      { pblancNm: '[경기] 광주시 2026년 중소기업 특례보증·이차보전 지원 확대' }, // 새 공고
    ];
    const { kept, dropped } = dropDuplicates(base, extra);
    expect(kept.map(k => k.pblancNm)).toEqual(['[경기] 광주시 2026년 중소기업 특례보증·이차보전 지원 확대']);
    expect(dropped).toHaveLength(1);
  });

  it('비슷하지만 다른 공고(특례보증 vs 이차보전)는 남긴다', () => {
    const base = [{ pblancNm: '[경기] 용인시 2026년 중소기업 특례보증 지원계획 공고' }];
    const extra = [{ pblancNm: '[경기] 용인시 2026년 중소기업육성자금 이차보전 지원' }];
    expect(dropDuplicates(base, extra).kept).toHaveLength(1);
  });

  it('추가 출처끼리 겹쳐도 하나만 남긴다', () => {
    const extra = [{ pblancNm: '2026년 스마트공장 구축 지원사업' }, { pblancNm: '2026년 스마트공장 구축 지원사업 공고' }];
    expect(dropDuplicates([], extra).kept).toHaveLength(1);
  });
});

describe('수동 등록 파일', () => {
  it('파일이 올바르게 읽히고 ID에 MANUAL- 접두어가 붙는다', async () => {
    const items = await loadManualItems(MANUAL_FILE, '2026-10-17');
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.pblancId.startsWith('MANUAL-')).toBe(true);
      expect(it.pblancUrl).toMatch(/^https:\/\//);
    }
  });

  it('hideAfter 가 지나면 내려간다', async () => {
    expect(await loadManualItems(MANUAL_FILE, '2027-01-01')).toHaveLength(0);
  });

  it('필수값이 없으면 동기화를 멈춘다 (조용히 빠지면 누락을 모른다)', () => {
    expect(() => manualToItem({ id: 'x', title: '제목만' })).toThrow();
  });

  it('등록된 공고가 경기 + 해당 시로 판정되고 광주광역시로 새지 않는다', async () => {
    const items = await loadManualItems(MANUAL_FILE, '2026-10-17');
    const expectSigungu: Record<string, string> = {
      'MANUAL-gwangju-gg-2026-guarantee': '광주시',
      'MANUAL-yongin-2026-interest-subsidy': '용인시',
    };
    for (const it of items) {
      const regions = extractRegionCodes(it.jrsdInsttNm, it.excInsttNm, it.hashtags, it.pblancNm, it.bsnsSumryCn);
      expect(regions).toEqual(['경기']);
      if (expectSigungu[it.pblancId]) {
        expect(extractSigunguCodes(it.pblancNm, it.hashtags, regions)).toEqual([expectSigungu[it.pblancId]]);
      }
    }
  });

  it('총사업비를 지원금액으로 잘못 뽑지 않는다', async () => {
    const items = await loadManualItems(MANUAL_FILE, '2026-10-17');
    const byId = Object.fromEntries(items.map(it => [it.pblancId, it]));
    expect(extractSupportAmount(byId['MANUAL-gwangju-gg-2026-guarantee'].bsnsSumryCn)).toBeNull();
    expect(extractSupportAmount(byId['MANUAL-yongin-2026-interest-subsidy'].bsnsSumryCn)).toBe('3억원');
    // '여성기업·우수기업 우대'는 여성기업 전용이 아니다
    const y = byId['MANUAL-yongin-2026-interest-subsidy'];
    expect(extractTargetFlags(y.pblancNm, y.trgetNm, y.bsnsSumryCn)).not.toContain('여성기업');
  });
});

describe('중소벤처24', () => {
  it('키가 없으면 건너뛴다(실패 아님)', async () => {
    const r = await fetchSmes24Items({ apiKey: '', url: 'https://example.invalid', log: quiet });
    expect(r).toMatchObject({ ok: true, skipped: true, items: [] });
  });

  it('응답을 기업마당 모양으로 바꾸고 SMES24- 접두어를 붙인다', async () => {
    const fake = async () => new Response(JSON.stringify({ data: [
      { pblancSeq: '123', pblancNm: '2026년 수출바우처 추가 모집', pblancBgnDt: '2026-10-01', pblancEndDt: '2026-10-31', sportInsttNm: '중소벤처기업진흥공단', pblancDtlUrl: 'https://www.smes.go.kr/x' },
      { pblancNm: 'ID 없는 항목' },
    ] }), { status: 200 });
    const r = await fetchSmes24Items({ apiKey: 'k', url: 'https://example.invalid', fetchImpl: fake, log: quiet });
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ pblancId: 'SMES24-123', excInsttNm: '중소벤처기업진흥공단', reqstBeginEndDe: '2026-10-01 ~ 2026-10-31' });
  });

  it('접속 실패해도 예외를 던지지 않고 ok=false', async () => {
    const boom = async () => { throw new Error('ECONNRESET'); };
    const r = await fetchSmes24Items({ apiKey: 'k', url: 'https://example.invalid', fetchImpl: boom, log: quiet });
    expect(r).toMatchObject({ ok: false, items: [] });
  });

  it('실패 이유를 남기되 키는 가린다 (결과 파일이 공개 저장소에 올라간다)', async () => {
    const leak = async () => new Response('invalid token SECRET123', { status: 401 });
    const r = await fetchSmes24Items({ apiKey: 'SECRET123', url: 'https://example.invalid', fetchImpl: leak, log: quiet });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('401');
    expect(r.error).not.toContain('SECRET123');
  });

  it('{resultCd, data:{…배열}} 모양에서도 목록을 찾는다', async () => {
    const nested = async () => new Response(JSON.stringify({ resultCd: '0', resultMsg: 'OK', data: { list: [
      { pblancSeq: '9', pblancNm: '중첩 응답 공고' },
    ] } }), { status: 200 });
    const r = await fetchSmes24Items({ apiKey: 'k', url: 'https://example.invalid', fetchImpl: nested, log: quiet });
    expect(r.items.map(i => i.pblancId)).toEqual(['SMES24-9']);
  });

  it('목록이 없으면 결과 코드·메시지를 실패 이유에 담는다', async () => {
    const empty = async () => new Response(JSON.stringify({ resultCd: '99', resultMsg: '승인되지 않은 키', data: null }), { status: 200 });
    const r = await fetchSmes24Items({ apiKey: 'k', url: 'https://example.invalid', fetchImpl: empty, log: quiet });
    expect(r.error).toContain('resultCd=99');
    expect(r.error).toContain('승인되지 않은 키');
  });

  it('ID·제목이 없는 항목은 버린다', () => {
    expect(smes24ToItem({ pblancNm: '제목만' })).toBeNull();
  });
});

describe('출처별 비활성화 보호', () => {
  it('실패한 출처의 기존 공고는 숨기지 않는다', () => {
    expect(protectedPrefixes({ manual: { ok: true }, smes24: { ok: false } })).toEqual(['SMES24-']);
    expect(protectedPrefixes({ manual: { ok: true }, smes24: { ok: true } })).toEqual([]);
  });
});
