/**
 * Edge Functions 侧 TypeScript 体检（tsc --noEmit 不覆盖 supabase/functions 目录）。
 *
 * 用法：
 *   node scripts/check-functions.mjs
 *
 * 遍历 supabase/functions/**\/*.ts，用 esbuild transformSync 做语法+类型转换，
 * 报错即退出码 1。不打包、不产出文件，纯体检。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions');

/** 递归收集 .ts 文件。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 定位 esbuild：本项目 esbuild 装在 vite 内部（node_modules/vite/node_modules/esbuild）。 */
async function loadEsbuild() {
  const candidates = [
    join(ROOT, 'node_modules', 'vite', 'node_modules', 'esbuild', 'lib', 'main.js'),
    join(ROOT, 'node_modules', 'esbuild', 'lib', 'main.js'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    // 用 file URL 直接加载，绕开 vite 的 exports 字段限制
    return await import(pathToFileURL(p).href);
  }
  throw new Error('找不到 esbuild，请先 npm install');
}

const esbuild = await loadEsbuild();
const files = walk(FUNCTIONS_DIR);
let failed = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  try {
    esbuild.transformSync(readFileSync(file, 'utf8'), {
      loader: 'ts',
      target: 'es2022',
      sourcefile: rel,
      format: 'esm',
    });
    console.log(`  OK  ${rel}`);
  } catch (e) {
    failed += 1;
    const msg = (e && e.errors && e.errors[0] && e.errors[0].text) || (e && e.message) || String(e);
    console.error(`FAIL  ${rel}\n      ${msg}`);
  }
}

console.log(`\n[check-functions] ${files.length - failed}/${files.length} 通过`);
if (failed > 0) process.exit(1);
