// =============================================================================
// [조사용] C-1 첨부파일 실태조사 — 1단계: 상세페이지 파싱 + 첨부파일 내려받기
//
// ⚠ 이 스크립트는 조사(research)용이다. 운영 파이프라인에 연결하지 않는다.
//   여기서 나온 숫자로 A-2(수집기)·A-3(추출기)를 설계한다. → docs/WORK_PLAN.md C-1
//
// 사용법:
//   node scripts/research/fetch-attachments.mjs              # 기본 100건
//   SURVEY_N=30 node scripts/research/fetch-attachments.mjs  # 건수 지정
//   SURVEY_OUT=... node scripts/research/fetch-attachments.mjs
//
// 동작:
//   1. public/data/policy_fund_latest.csv 에서 표본을 균등 간격으로 뽑는다
//      (API 응답 순서 = 등록 역순이라 균등 추출하면 부처·분야·시기가 고루 섞인다)
//   2. 각 공고의 상세페이지를 받아 첨부파일 링크를 파싱한다
//   3. 파일을 내려받아 SURVEY_OUT/files/ 에 저장하고 manifest.json 에 기록한다
//
// 예절:
//   · 요청 간격 기본 800ms (SURVEY_DELAY 로 조정). 기업마당 이용약관은 아직 미확인(C-5)이라
//     조사 규모를 100건으로 제한하고 간격을 넉넉히 둔다.
//   · 이미 받은 파일은 건너뛴다 — 중단 후 다시 돌려도 재다운로드하지 않는다.
// =============================================================================

import { writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CSV = path.join(ROOT, 'public/data/policy_fund_latest.csv');
const OUT = path.resolve(process.env.SURVEY_OUT || path.join(ROOT, '.research-data'));
const FILES_DIR = path.join(OUT, 'files');
const MANIFEST = path.join(OUT, 'manifest.json');

const SAMPLE_N = Number(process.env.SURVEY_N || 100);
const DELAY_MS = Number(process.env.SURVEY_DELAY || 800);
const ORIGIN = 'https://www.bizinfo.go.kr';
const UA = 'Mozilla/5.0 (compatible; DaehanTaxResearch/1.0)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 상세페이지 HTML에서 첨부파일 목록을 뽑는다.
 *  실제 마크업 (2026-08-20 확인):
 *    <a href="/cmm/fms/fileDown.do?atchFileId=FILE_...&fileSn=0"
 *       class="... icon_download" title="첨부파일 [붙임2] 동의서.hwp 다운로드">다운로드</a>
 *  href 와 title 사이에 줄바꿈·탭이 들어가므로 [^>]* 로 건너뛴다. */
const ATTACH_RE =
  /href="([^"]*\/cmm\/fms\/fileDown\.do\?[^"]*)"[^>]*title="첨부파일\s*(.*?)\s*다운로드"/g;

function parseAttachments(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(ATTACH_RE)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (seen.has(url)) continue;
    seen.add(url);
    const name = m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
    out.push({ url: url.startsWith('http') ? url : ORIGIN + url, fileName: name });
  }
  return out;
}

/** 파일명에서 확장자. 확장자가 없으면 '(없음)' */
function extOf(fileName) {
  const m = String(fileName).match(/\.([A-Za-z0-9]{1,6})\s*$/);
  return m ? m[1].toLowerCase() : '(없음)';
}

/** 파일 시스템에 안전한 이름으로 변환 (원본 이름은 manifest 에 그대로 남는다) */
function safeName(pblancId, idx, fileName) {
  return `${pblancId}__${String(idx).padStart(2, '0')}.${extOf(fileName)}`;
}

async function fetchWithRetry(url, { binary = false } = {}, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: `${ORIGIN}/` },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) return { ok: false, status: res.status };
      return binary
        ? { ok: true, status: res.status, buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' }
        : { ok: true, status: res.status, text: await res.text() };
    } catch (err) {
      if (i === attempts) return { ok: false, status: 0, error: err.name || String(err) };
      await sleep(3000 * i);
    }
  }
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  const csvText = await readFile(CSV, 'utf8');
  const { data } = Papa.parse(csvText.replace(/^﻿/, ''), { header: true, skipEmptyLines: true });

  const rows = data.filter((r) => (r['공고상세URL'] || '').includes('pblancId='));
  if (rows.length === 0) {
    console.error('[survey] 공고상세URL 이 있는 행이 없습니다. CSV 를 확인하세요.');
    process.exit(1);
  }

  // 균등 간격 추출 — 앞쪽만 자르면 최근 등록 공고에 쏠린다
  const step = Math.max(1, Math.floor(rows.length / SAMPLE_N));
  const sample = [];
  for (let i = 0; i < rows.length && sample.length < SAMPLE_N; i += step) sample.push(rows[i]);

  console.log(`[survey] 전체 ${rows.length}건 중 ${sample.length}건 추출 (간격 ${step})`);
  console.log(`[survey] 저장 위치: ${OUT}`);
  console.log(`[survey] 요청 간격 ${DELAY_MS}ms — 예상 소요 약 ${Math.ceil((sample.length * 3.5 * DELAY_MS) / 60000)}분\n`);

  await mkdir(FILES_DIR, { recursive: true });

  const manifest = [];
  let nDetailFail = 0, nFiles = 0, nFileFail = 0;

  for (const [i, row] of sample.entries()) {
    const detailUrl = row['공고상세URL'];
    const pblancId = (detailUrl.match(/pblancId=([A-Z0-9_]+)/) || [])[1] || `IDX_${i}`;
    const entry = {
      pblancId,
      title: row['공고명'] || '',
      department: row['소관부처'] || '',
      agency: row['사업수행기관'] || '',
      category: row['지원분야'] || '',
      registrationDate: row['등록일자'] || '',
      summaryLength: (row['사업개요'] || '').length,
      detailUrl,
      detailStatus: null,
      attachments: [],
    };

    const page = await fetchWithRetry(detailUrl);
    entry.detailStatus = page.status;
    if (!page.ok) {
      nDetailFail++;
      console.warn(`  [${i + 1}/${sample.length}] ${pblancId} 상세페이지 실패 (${page.status || page.error})`);
      manifest.push(entry);
      await sleep(DELAY_MS);
      continue;
    }

    const attachments = parseAttachments(page.text);
    console.log(`  [${i + 1}/${sample.length}] ${pblancId} 첨부 ${attachments.length}개 — ${entry.title.slice(0, 40)}`);

    for (const [j, att] of attachments.entries()) {
      const local = safeName(pblancId, j, att.fileName);
      const localPath = path.join(FILES_DIR, local);
      const rec = { ...att, ext: extOf(att.fileName), localName: local, status: null, bytes: null, contentType: null };

      if (await exists(localPath)) {
        rec.status = 'cached';
        rec.bytes = (await stat(localPath)).size;
        entry.attachments.push(rec);
        nFiles++;
        continue;
      }

      await sleep(DELAY_MS);
      const dl = await fetchWithRetry(att.url, { binary: true });
      if (dl.ok) {
        await writeFile(localPath, dl.buf);
        rec.status = 'ok';
        rec.bytes = dl.buf.length;
        rec.contentType = dl.type;
        nFiles++;
      } else {
        rec.status = `fail:${dl.status || dl.error}`;
        nFileFail++;
      }
      entry.attachments.push(rec);
    }

    manifest.push(entry);
    await sleep(DELAY_MS);
  }

  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`\n[survey] 완료`);
  console.log(`  공고 ${manifest.length}건 (상세페이지 실패 ${nDetailFail}건)`);
  console.log(`  첨부 ${nFiles}개 확보 (다운로드 실패 ${nFileFail}개)`);
  console.log(`  manifest: ${MANIFEST}`);
  console.log(`\n다음: py scripts/research/extract_survey.py`);
}

main().catch((err) => {
  console.error('[survey] 실패:', err);
  process.exit(1);
});
