/**
 * PPT 课程施工图行为体检。
 *
 * Edge Functions 不在主 tsconfig 内，这里用 Vite 自带的 esbuild 转译单文件后直接
 * 执行断言，覆盖显式页码、Markdown 标题、短大纲补全、无大纲默认流程和超长合并。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'supabase', 'functions', '_shared', 'doc', 'pptPlan.ts');

async function loadEsbuild() {
  const candidates = [
    join(ROOT, 'node_modules', 'vite', 'node_modules', 'esbuild', 'lib', 'main.js'),
    join(ROOT, 'node_modules', 'esbuild', 'lib', 'main.js'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    return await import(pathToFileURL(path).href);
  }
  throw new Error('找不到 esbuild，请先 npm install');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const esbuild = await loadEsbuild();
const transformed = await esbuild.transformSync(readFileSync(SOURCE, 'utf8'), {
  loader: 'ts',
  format: 'esm',
  target: 'es2022',
  sourcefile: 'pptPlan.ts',
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`;
const { buildPptPlan, formatPptPlanOverview, formatPptPlanPart } = await import(moduleUrl);

const explicitPages = Array.from({ length: 12 }, (_, index) => {
  const title = index === 0 ? '我是什么' : `第 ${index + 1} 个学习环节`;
  return `第 ${index + 1} 页｜${title}\n- 核心知识点 ${index + 1}\n- 课堂活动 ${index + 1}`;
}).join('\n');
const explicitPlan = buildPptPlan({
  prompt: '我是什么',
  outlineContent: explicitPages,
  totalPages: 12,
  subject: '语文',
  grade: '二年级',
});
assert(explicitPlan.pages.length === 12, '显式 12 页大纲必须保持 12 页');
assert(explicitPlan.pages[0].title === '我是什么', '首屏标题必须来自大纲');
assert(new Set(explicitPlan.pages.map((page) => page.title)).size === 12, '页面标题不能重复');
assert(explicitPlan.pages.every((page) => page.keyPoints.length > 0), '每页必须有覆盖点');
assert(
  explicitPlan.pages.every((page) => page.visual.includes('童趣')),
  '低年级课件必须使用童趣视觉规则',
);

const bulletPlan = buildPptPlan({
  prompt: '我是什么',
  outlineContent: '我是什么\n- 猜谜导入\n- 读准字音\n- 水的变化\n- 水汽循环',
  totalPages: 6,
  subject: '语文',
  grade: '二年级',
});
assert(bulletPlan.pages.length === 6, '短大纲必须补齐到目标页数');
assert(
  bulletPlan.pages.some((page) => page.title.includes('猜谜导入')),
  '顶层项目符号必须转化为页面计划',
);
assert(
  formatPptPlanPart(bulletPlan, 2).includes('本段只生成'),
  '分段施工图必须声明当前页范围',
);

const defaultPlan = buildPptPlan({
  prompt: '光合作用',
  totalPages: 18,
  subject: '生物',
  grade: '七年级',
});
assert(defaultPlan.pages.length === 18, '无大纲时保持 18 页完整课堂流程');
assert(defaultPlan.pages[0].title === '光合作用', '无大纲时封面使用教师课题');
assert(formatPptPlanOverview(defaultPlan).includes('总页数：18'), '全课施工图必须输出页数');

const mathPlan = buildPptPlan({
  prompt: '分数的初步认识',
  totalPages: 9,
  subject: '数学',
  grade: '七年级',
});
assert(
  mathPlan.pages.some((page) => /chart|表格|示意图/.test(page.visual)),
  '数学课件必须安排真实数据或结构表达',
);

const longOutline = Array.from({ length: 30 }, (_, index) => {
  return `第 ${index + 1} 页｜知识点 ${index + 1}\n- 要点 ${index + 1}`;
}).join('\n');
const mergedPlan = buildPptPlan({
  prompt: '综合复习',
  outlineContent: longOutline,
  totalPages: 12,
});
assert(mergedPlan.pages.length === 12, '超长大纲必须合并到目标页数');
assert(mergedPlan.pages.every((page) => page.page >= 1 && page.page <= 12), '页码必须连续有效');

console.log('[check-ppt-plan] 5 组行为断言通过');
