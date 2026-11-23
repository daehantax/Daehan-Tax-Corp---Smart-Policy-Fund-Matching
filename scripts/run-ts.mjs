// =============================================================================
// 타입스크립트 스크립트 실행기 — esbuild 로 한 덩어리로 묶어서 돌린다
//
//   node scripts/run-ts.mjs scripts/weekly-report.ts [인자...]
//
// 왜 필요한가:
//   주간 리포트는 **화면과 똑같은 판정**을 써야 한다 — `services/matchingService.ts`,
//   `services/geo.ts`, `supabase/functions/_shared/companyProfile.ts`. 전부 .ts 다.
//   같은 규칙을 .mjs 로 한 벌 더 적으면 CLAUDE.md 가 막아 둔 「세 번째 복제본」이 된다.
//
// 왜 node --experimental-strip-types 가 아닌가 (둘 다 해 보고 고른 것):
//   · `services/geo.ts` 가 `import divisions from '../data/administrative-divisions.json'`
//     을 쓰는데, 네이티브 타입 제거는 `with { type: 'json' }` 을 요구해서 그대로는 못 읽는다
//   · 번들로 묶으면 json 도 .ts 도 한 번에 풀린다
//
// node_modules 는 묶지 않는다(`packages: 'external'`) — @supabase/supabase-js 는
// 그대로 Node 가 불러오게 둔다. 번들은 쓰고 끝나면 지운다.
//
// ⚠ 번들은 **저장소 안**(node_modules/.cache/run-ts-*)에 쓴다. OS 임시 폴더에 쓰면
//   Node 가 거기서 위로 node_modules 를 찾다가 못 찾아 `ERR_MODULE_NOT_FOUND` 로 죽는다
//   (2026-11-23 실측 — 처음 만든 판이 이렇게 깨져 있었다).
// =============================================================================

import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const entry = process.argv[2];
if (!entry) {
  console.error('쓰는 법: node scripts/run-ts.mjs <스크립트.ts> [인자...]');
  process.exit(1);
}

// 번들 안에서 process.argv 를 그대로 읽을 수 있도록 앞의 두 자리를 걷어낸다.
// (argv[0]=node, argv[1]=run-ts.mjs, argv[2]=대상 스크립트 → 대상 스크립트가 argv[1] 이 되게)
process.argv = [process.argv[0], path.resolve(ROOT, entry), ...process.argv.slice(3)];

const cache = path.join(ROOT, 'node_modules', '.cache');
await mkdir(cache, { recursive: true });
const dir = await mkdtemp(path.join(cache, 'run-ts-'));
const outfile = path.join(dir, 'bundle.mjs');

try {
  await build({
    entryPoints: [path.resolve(ROOT, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    outfile,
    logLevel: 'warning',
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(dir, { recursive: true, force: true });
}
