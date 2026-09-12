import { MAX_HTML_BYTES } from '@/config/creditRules';

/**
 * HTML 产物校验（与 Edge Function 端 `supabase/functions/_shared/validateHtml.ts`
 * 共享同一套规则）。
 *
 * 校验项（PRD 3.1.4）：
 * 1. 能提取出 ```html 代码块；
 * 2. 以 `</html>` 结尾；
 * 3. 包含 `<body`；
 * 4. 体积 ≤ 200KB；
 * 5. 无 ``` 残留、无 `TODO` / `...` 省略占位。
 */

export interface ValidationResult {
  /** 是否通过。 */
  ok: boolean;
  /** 失败原因（中文，可直接展示或回传给模型做自修复）。 */
  errors: string[];
  /** 提取出的纯 HTML（校验通过时非空）。 */
  html: string;
}

/**
 * 从模型输出中提取 ```html 代码块内容。
 *
 * 兼容三种常见写法：```html / ```HTML / 直接以 `<!DOCTYPE` 开头（无代码块）。
 *
 * @param raw 模型原始输出。
 * @returns 提取出的 HTML；提取失败返回空串。
 */
export function extractHtml(raw: string): string {
  if (!raw) return '';

  const fence = /```(?:html|HTML)?\s*\n([\s\S]*?)```/;
  const m = fence.exec(raw);
  if (m && m[1]) return m[1].trim();

  // 未闭合的代码块（常见于输出被截断）：取最后一个 ```html 之后的内容
  const openIdx = raw.search(/```(?:html|HTML)?\s*\n/);
  if (openIdx >= 0) {
    return raw.slice(openIdx).replace(/```(?:html|HTML)?\s*\n/, '').trim();
  }

  // 完全没有代码块：若看起来就是 HTML，直接采用
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('<!doctype html') || trimmed.startsWith('<html')) {
    return trimmed;
  }
  return '';
}

/**
 * 校验 HTML 是否满足交付要求。
 *
 * @param raw 模型原始输出（含可能的 Markdown 代码块）。
 * @param maxBytes 体积上限，默认 `MAX_HTML_BYTES`。
 * @returns 校验结果。
 */
export function validateHtml(raw: string, maxBytes: number = MAX_HTML_BYTES): ValidationResult {
  const errors: string[] = [];
  const html = extractHtml(raw);

  if (html.length === 0) {
    return { ok: false, errors: ['没有找到 ```html 代码块，请重新输出'], html: '' };
  }

  // 2. 必须以 </html> 结尾（截断检测）
  if (!html.trimEnd().toLowerCase().endsWith('</html>')) {
    const lineCount = html.split('\n').length;
    errors.push(`输出在第 ${lineCount} 行附近被截断，未以 </html> 结尾，请完整输出`);
  }

  // 3. 必须包含 <body
  if (!/<body[\s>]/i.test(html)) {
    errors.push('缺少 <body> 标签，请输出完整的 HTML 文档结构');
  }

  // 4. 体积上限（按 UTF-8 字节计）
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > maxBytes) {
    errors.push(
      `单文件体积 ${(bytes / 1024).toFixed(1)}KB 超过 ${Math.round(maxBytes / 1024)}KB 上限，请精简 CSS/JS 后重新输出`,
    );
  }

  // 5. 残留标记与占位
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
 * 构造「自修复」提示词：把校验失败的具体原因回传给模型。
 *
 * @param errors 校验失败原因。
 * @returns 追加到第二轮 user 消息的中文提示。
 */
export function buildRepairPrompt(errors: readonly string[]): string {
  const list = errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
  return [
    '你上一次的输出没有通过自动校验，问题如下：',
    list,
    '',
    '请针对上述问题修正后，重新输出**完整**的单文件 HTML（不要只输出修改片段，不要省略任何部分），仍然只输出一个 ```html 代码块。',
  ].join('\n');
}
