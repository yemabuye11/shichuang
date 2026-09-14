import { getPracticeStats } from '@/services/practiceService';
import type { PracticeStats } from '@/types/practice';

/**
 * CSV 工具：本地解析 / 下载 / 每日一练模板 / 完成记录导出。
 *
 * 红线：
 * - 下载的 CSV 必须带 UTF-8 BOM（\uFEFF），否则 Excel / WPS 打开中文乱码；
 * - 字段含逗号 / 引号 / 换行时用双引号包裹并转义内部引号；
 * - 不引入任何新依赖（本机 npm install 跑不通，新增依赖会让 CI 直接失败）。
 */

/**
 * 解析 CSV 文本为二维字符串数组。
 *
 * 支持：
 * - 双引号包裹字段；
 * - 引号包裹字段内可含逗号 / 换行；
 * - 字段内双引号用两个双引号转义（""）。
 *
 * 纯解析、不跳过任何行，也不去 BOM——语义交给上层（如 parseQuestionsLocally）。
 *
 * @param text CSV 文本。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const n = text.length;
  let i = 0;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1;
      if (i < n && text[i] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    if (c === '\n') {
      i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
    i += 1;
  }

  // 末尾未以换行结束的最后一段
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 转义单个 CSV 字段：含逗号 / 引号 / 换行时双引号包裹并转义内部引号。 */
function escapeField(value: string | number): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * 生成 CSV 并触发浏览器下载（带 UTF-8 BOM，防止 Excel 中文乱码）。
 *
 * @param rows 二维数据（含表头）。
 * @param fileName 下载文件名（建议以 .csv 结尾）。
 */
export function downloadCsv(rows: (string | number)[][], fileName: string): void {
  const lines = rows.map((r) => r.map(escapeField).join(','));
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 每日一练题目填写模板（表头 + 一行示例题，照 PLAN §二）。 */
const PRACTICE_TEMPLATE: (string | number)[][] = [
  ['题型', '题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析'],
  ['单选', '下列加点字读音正确的一项是（ ）', 'A. 朝霞(zhāo)', 'B. 应该(yìng)', 'C. 兴奋(xīng)', 'D. 长大(cháng)', 'A', '朝：zhāo'],
  ['填空', '照样子写词语：又__又__', '', '', '', '', '又大又红|又香又甜', '答案不唯一，符合即可'],
  ['判断', '《坐井观天》是一则寓言故事。（ ）', '', '', '', '', '对', ''],
];

/**
 * 下载「每日一练」题目填写模板（浏览器本地生成，带 BOM，Excel/WPS 直接打开）。
 */
export function downloadPracticeTemplate(): void {
  downloadCsv(PRACTICE_TEMPLATE, '每日一练题目模板.csv');
}

/**
 * 导出某次练习的完成记录（完成名单 + 每题正确率）。
 *
 * @param practiceId 练习集 id。
 * @param meta 元信息（标题用于文件名）。
 */
export async function exportPracticeRecords(
  practiceId: string,
  meta: { title: string },
): Promise<void> {
  const stats: PracticeStats = await getPracticeStats(practiceId);
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeTitle = (meta.title || '每日一练').replace(/[\\/:*?"<>|]/g, '_');
  const fileName = `${safeTitle}_完成记录_${dateStr}.csv`;

  const rows: (string | number)[][] = [];
  rows.push(['完成名单']);
  rows.push(['昵称', '天数', '得分', '提交时间']);
  for (const s of stats.submissions) {
    rows.push([s.studentName, s.dayNo, s.score, s.submittedAt]);
  }
  rows.push([]);
  rows.push(['每题正确率']);
  rows.push(['第几天', '题序', '题干', '正确率']);
  for (const p of stats.perQuestion) {
    rows.push([p.dayNo, p.seq, p.stem, `${Math.round(p.correctRate * 1000) / 10}%`]);
  }
  downloadCsv(rows, fileName);
}
