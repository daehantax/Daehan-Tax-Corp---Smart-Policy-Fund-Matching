import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// policy_grants.created_at 은 「우리가 그 공고를 처음 본 시각」이다 — 주간 신규 공고 리포트
// (scripts/weekly-report.ts)의 주차 기준이다.
//
// 이 값이 보존되는 이유는 **동기화가 그 칸을 보내지 않기 때문뿐이다.** PostgREST 의
// merge-duplicates 업서트는 보낸 칸만 갱신하므로, 새 공고는 insert 때 default now() 가 찍히고
// 이미 있던 공고는 매일 동기화돼도 처음 값 그대로 남는다. (2026-11-23 실데이터로 확인 — WORK_PLAN §7)
//
// 누군가 업서트 페이로드에 created_at 을 넣는 순간 **모든 공고가 매일 「신규」가 된다.**
// 에러도 없이 조용히. 그래서 공고를 쓰는 스크립트에 이 이름이 나오지 않는지 막는다.

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('created_at(처음 본 날) 보존 — 동기화가 이 칸을 건드리지 않는다', () => {
  it('sync-bizinfo.mjs 에 created_at 이 나오지 않는다', () => {
    expect(read('scripts/sync-bizinfo.mjs')).not.toMatch(/created_at/);
  });

  it('extra-sources.mjs(중소벤처24·수동 등록 → 같은 업서트로 들어간다)에도 나오지 않는다', () => {
    expect(read('scripts/extra-sources.mjs')).not.toMatch(/created_at/);
  });

  it('공고 행을 고치는 다른 스크립트들도 이 칸을 쓰지 않는다', () => {
    for (const f of ['scripts/apply-exclusions.mjs', 'scripts/extract-documents.mjs']) {
      expect(read(f), f).not.toMatch(/created_at/);
    }
  });
});
