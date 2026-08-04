import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Grant, UserSession } from '../types';
import { CsvService } from './csvService';
import { getGrantRegions, getGrantSigungu, matchesInterests, scoreGrant } from './matchingService';
import { EXCLUSIVE_ZONES, resolveAddress } from './geo';

// 저장소에 커밋된 공고 스냅샷(매일 동기화로 갱신됨)으로 매칭 전체를 검증한다.
// 데이터가 매일 바뀌므로 정확한 건수는 단정하지 않고, 깨지면 반드시 버그인 불변식만 본다.

let grants: Grant[] = [];

beforeAll(async () => {
  const csv = readFileSync(path.resolve(__dirname, '../public/data/policy_fund_latest.csv'), 'utf8');
  grants = await CsvService.parseGrantCsv(csv.replace(/^﻿/, ''));
});

const profile = (address: string, bizType: string): UserSession => {
  const r = resolveAddress(address);
  return { type: 'CLIENT', identifier: '-', region: r.region, sigungu: r.sigungu, bizType };
};

const PROFILES: Array<[string, string, string]> = [
  ['풀하우스(경기 성남시·부동산업)', '(13559 ) 경기도 성남시 분당구 성남대로 295', '부동산업'],
  ['서울 강남구·제조업', '서울특별시 강남구 테헤란로 1', '제조업'],
  ['강원 강릉시·숙박음식', '강원특별자치도 강릉시 하슬라로 1', '숙박 및 음식점업'],
  ['세종(시군 없음)·도소매', '세종특별자치시 한누리대로 350', '도매 및 소매업'],
  ['주소 부실(시군 판별 불가)', '(      )', '부동산업'],
];

describe('공고 스냅샷 기본 상태', () => {
  it('충분한 건수가 파싱된다', () => {
    expect(grants.length).toBeGreaterThan(500);
  });

  it('모든 공고가 지역코드를 가진다', () => {
    expect(grants.filter(g => getGrantRegions(g).length === 0)).toHaveLength(0);
  });

  it('전국 공고 비율이 합리적 범위다 (해시태그 17개를 전국으로 접는 규칙이 살아 있어야 한다)', () => {
    const national = grants.filter(g => getGrantRegions(g).includes('전국')).length;
    const ratio = national / grants.length;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.6);
  });

  it('지역코드가 13개 이상인 공고는 없다 (전국으로 접혀야 한다)', () => {
    const wide = grants.filter(g => {
      const r = getGrantRegions(g);
      return !r.includes('전국') && !r.some(x => EXCLUSIVE_ZONES[x]) && r.length >= 13;
    });
    expect(wide).toHaveLength(0);
  });

  it('시·군은 반드시 그 공고의 시도에 속한다', () => {
    const mismatched = grants.filter(g => {
      const regions = getGrantRegions(g);
      if (regions.includes('전국') || regions.some(x => EXCLUSIVE_ZONES[x])) return false;
      return getGrantSigungu(g).length > 0 && regions.length === 0;
    });
    expect(mismatched).toHaveLength(0);
  });
});

describe('스마트태그 — 한 태그가 목록을 지배하지 않아야 한다', () => {
  const TAGS = ['💰 인건비/고용', '🏭 시설/기계구입', '📢 마케팅/홍보', '🧪 기술개발(R&D)', '🚢 수출/해외진출', '💵 저금리 대출'];

  it.each(TAGS)('%s 커버리지가 40% 미만', (tag) => {
    // 예전에 🧪 기술개발이 46%까지 붙어 필터 구실을 못 했다
    const n = grants.filter(g => g.tags?.includes(tag)).length;
    expect(n / grants.length).toBeLessThan(0.4);
  });

  it('공고당 평균 태그 수가 1.5개 미만', () => {
    const avg = grants.reduce((a, g) => a + (g.tags?.length || 0), 0) / grants.length;
    expect(avg).toBeLessThan(1.5);
  });
});

describe.each(PROFILES)('추천 결과 — %s', (_label, address, bizType) => {
  const session = profile(address, bizType);

  it('추천이 비어 있지 않다', () => {
    const rec = grants.filter(g => scoreGrant(g, session, []).score > 0);
    expect(rec.length).toBeGreaterThan(50);
  });

  it('신청 자격이 없는 공고가 추천에 남지 않는다', () => {
    const rec = grants.filter(g => scoreGrant(g, session, []).score > 0);

    // 다른 시도 전용
    const wrongRegion = rec.filter(g => {
      const r = getGrantRegions(g);
      if (r.includes('전국')) return false;
      const zone = r.find(x => EXCLUSIVE_ZONES[x]);
      if (zone) return session.region !== '전체' && EXCLUSIVE_ZONES[zone].includes(session.region!);
      return session.region !== '전체' && !r.includes(session.region!);
    });
    expect(wrongRegion.map(g => g.title)).toEqual([]);

    // 다른 시·군 전용 (우리 시·군을 아는 경우에만 판정 대상)
    if ((session.sigungu || []).length > 0) {
      const wrongSigungu = rec.filter(g => {
        const s = getGrantSigungu(g);
        return s.length > 0 && !s.some(x => session.sigungu!.includes(x));
      });
      expect(wrongSigungu.map(g => g.title)).toEqual([]);
    }
  });
});

describe('키워드를 고르면 그 묶음이 정확해야 한다', () => {
  const session = profile('(13559 ) 경기도 성남시 분당구 성남대로 295', '부동산업');
  const KW = '💵 저금리 대출';

  it('키워드 묶음의 공고는 모두 그 태그를 가진다', () => {
    const rec = grants.filter(g => scoreGrant(g, session, [KW]).score > 0);
    const matched = rec.filter(g => matchesInterests(g, [KW]));
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.filter(g => !g.tags?.includes(KW))).toHaveLength(0);
  });

  it('저금리 대출 묶음은 융자·보증 성격이 대부분이다', () => {
    const rec = grants.filter(g => scoreGrant(g, session, [KW]).score > 0);
    const matched = rec.filter(g => matchesInterests(g, [KW]));
    const loanish = matched.filter(g =>
      ['융자', '보증'].includes((g.subCategory || '').trim())
      || /융자|보증|이차보전|운전자금|저금리/.test(g.title),
    );
    expect(loanish.length / matched.length).toBeGreaterThan(0.7);
  });
});
