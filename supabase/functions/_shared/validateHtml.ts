/**
 * 产物校验（PRD 3.1.4，与前端 `src/utils/validateHtml.ts` 共享同一套规则）。
 *
 * 5 条校验：
 * 1. 能提取 ```html 代码块；
 * 2. 以 `</html>` 结尾；
 * 3. 包含 `<body`；
 * 4. 体积 ≤ 200KB；
 * 5. 无 ``` 残留、无 `TODO` / `...` 占位。
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  html: string;
}

/** 默认体积上限：200KB。 */
export const MAX_HTML_BYTES = 204800;

/**
 * 从模型输出中提取 ```html 代码块。
 *
 * @param raw 模型原始输出。
 */
export function extractHtml(raw: string): string {
  if (!raw) return '';

  const fence = /```(?:html|HTML)?\s*\n([\s\S]*?)```/;
  const m = fence.exec(raw);
  if (m && m[1]) return m[1].trim();

  // 输出被截断：取最后一个 ```html 之后的内容
  const openIdx = raw.search(/```(?:html|HTML)?\s*\n/);
  if (openIdx >= 0) {
    return raw
      .slice(openIdx)
      .replace(/```(?:html|HTML)?\s*\n/, '')
      .trim();
  }

  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('<!doctype html') || trimmed.startsWith('<html')) {
    return trimmed;
  }
  return '';
}

/**
 * 校验产物。
 *
 * @param raw 模型原始输出。
 * @param maxBytes 体积上限。
 */
export function validateHtml(raw: string, maxBytes: number = MAX_HTML_BYTES): ValidationResult {
  const errors: string[] = [];
  const html = extractHtml(raw);

  if (html.length === 0) {
    return { ok: false, errors: ['没有找到 ```html 代码块，请重新输出'], html: '' };
  }

  if (!html.trimEnd().toLowerCase().endsWith('</html>')) {
    const lineCount = html.split('\n').length;
    errors.push(`输出在第 ${lineCount} 行附近被截断，未以 </html> 结尾，请完整输出`);
  }

  if (!/<body[\s>]/i.test(html)) {
    errors.push('缺少 <body> 标签，请输出完整的 HTML 文档结构');
  }

  const bytes = new TextEncoder().encode(html).length;
  if (bytes > maxBytes) {
    errors.push(
      `单文件体积 ${(bytes / 1024).toFixed(1)}KB 超过 ${Math.round(maxBytes / 1024)}KB 上限，请精简 CSS/JS 后重新输出`,
    );
  }

  if (html.includes('```')) {
    errors.push('HTML 中残留了 ``` 代码块标记，请去掉后再输出');
  }
  if (/\bTODO\b/i.test(html)) {
    errors.push('HTML 中残留 TODO 占位，请补全内容');
  }
  if (/\.{3}\s*<\/(?:div|section|p|ul|li|script|style)>/.test(html)) {
    errors.push('HTML 中存在 `...` 省略占位，请完整写出被省略的代码');
  }

  return { ok: errors.length === 0, errors, html };
}

/**
 * 从 HTML 中抽取 `<title>`（作为应用标题兜底）。
 *
 * @param html HTML 内容。
 */
export function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (m && m[1]) {
    const title = m[1].trim().slice(0, 40);
    if (title.length > 0) return title;
  }
  return '';
}
