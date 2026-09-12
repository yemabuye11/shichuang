/**
 * 文档类产物校验（T06）：从模型输出抽取 DocModel JSON 并做结构校验。
 *
 * 校验规则（与前端 `src/utils/validateDoc.ts` 同一套标准）：
 * 1. 能提取 ```json 代码块（或整体已是 JSON）；
 * 2. 解析为对象，且含必需字段 `kind` / `meta` / `blocks`；
 * 3. `kind` 为合法 DocType；
 * 4. `meta.title` 非空；
 * 5. `ppt` 须含 `slides`；`courseware_3d` 须含 `scene`；
 * 6. `blocks` 为非空数组，每块含 `id` 与 `type`；
 * 7. 体积 ≤ 上限（默认 256KB）。
 *
 * 失败可携带 `errors` 走一次自修复重试（与 HTML 流程一致）。
 */

import { isDocType, type DocModel } from './types.ts';

/** 校验结果。 */
export interface DocValidationResult {
  ok: boolean;
  errors: string[];
  /** 解析成功后的模型；失败为 null。 */
  model: DocModel | null;
}

/** 默认体积上限：256KB（文档类富文本允许比单文件 HTML 略大）。 */
export const MAX_DOC_BYTES = 262_144;

/**
 * 从模型原始输出中抽取 ```json 代码块内容。
 *
 * @param raw 模型原始输出。
 */
export function extractDocJson(raw: string): string {
  if (!raw) return '';

  const fence = /```(?:json|JSON)?\s*\n([\s\S]*?)```/;
  const m = fence.exec(raw);
  if (m && m[1]) return m[1].trim();

  // 无代码块：尝试把整段当作 JSON
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;

  // 找到第一个 ```json 之后的残片（被截断的情况）
  const openIdx = raw.search(/```(?:json|JSON)?\s*\n/);
  if (openIdx >= 0) {
    return raw
      .slice(openIdx)
      .replace(/```(?:json|JSON)?\s*\n/, '')
      .trim();
  }
  return '';
}

/**
 * 校验文档产物。
 *
 * @param raw 模型原始输出。
 * @param maxBytes 体积上限。
 */
export function validateDoc(raw: string, maxBytes: number = MAX_DOC_BYTES): DocValidationResult {
  const errors: string[] = [];
  const json = extractDocJson(raw);

  if (json.length === 0) {
    return { ok: false, errors: ['没有找到 ```json 代码块，请重新输出 DocModel'], model: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [`JSON 解析失败：${msg}，请输出合法 JSON`], model: null };
  }

  const model = parsed as Partial<DocModel>;
  if (typeof model !== 'object' || model === null) {
    return { ok: false, errors: ['DocModel 必须是 JSON 对象'], model: null };
  }

  if (!isDocType(model.kind)) {
    errors.push('字段 kind 不是合法的文档类型（应为 lesson_plan/ppt/courseware_2d/courseware_3d/office_doc）');
  }

  if (!model.meta || typeof model.meta.title !== 'string' || model.meta.title.trim().length === 0) {
    errors.push('字段 meta.title 缺失或为空，请填写文档标题');
  }

  // PPT 的内容真相源是 slides，因此只要 slides 非空就允许 blocks 为空；
  // 其余文档类型必须以非空 blocks 承载正文。
  const slidesPresent = Array.isArray(model.slides) && model.slides.length > 0;
  const blocksRequired = !(model.kind === 'ppt' && slidesPresent);

  if (!Array.isArray(model.blocks) || model.blocks.length === 0) {
    if (blocksRequired) {
      errors.push('字段 blocks 必须是非空数组（ppt 类型可为空，但必须输出非空 slides）');
    }
  } else {
    for (let i = 0; i < model.blocks.length; i++) {
      const b = model.blocks[i] as { id?: unknown; type?: unknown };
      if (!b || typeof b.id !== 'string' || typeof b.type !== 'string') {
        errors.push(`blocks[${i}] 缺少 id 或 type 字段`);
        break;
      }
    }
  }

  if (model.kind === 'ppt') {
    if (!Array.isArray(model.slides) || model.slides.length === 0) {
      errors.push('ppt 类型必须包含非空 slides 数组');
    }
  }

  if (model.kind === 'courseware_3d') {
    if (!model.scene || typeof model.scene !== 'object') {
      errors.push('courseware_3d 类型必须包含 scene（SceneDescriptor）');
    }
  }

  if (typeof model.version !== 'number') {
    // 允许缺失，渲染时补 1
    if (model.version !== undefined) {
      errors.push('字段 version 必须是数字');
    }
  }

  const bytes = new TextEncoder().encode(json).length;
  if (bytes > maxBytes) {
    errors.push(`文档体积 ${(bytes / 1024).toFixed(1)}KB 超过 ${Math.round(maxBytes / 1024)}KB 上限，请精简后重新输出`);
  }

  if (json.includes('```')) {
    errors.push('JSON 中残留了 ``` 代码块标记，请去掉后再输出');
  }
  if (/\bTODO\b/i.test(json)) {
    errors.push('文档中残留 TODO 占位，请补全内容');
  }

  return { ok: errors.length === 0, errors, model: errors.length === 0 ? (model as DocModel) : null };
}

/**
 * 构造「自修复」第二轮 user 消息（仅重试 1 次）。
 *
 * @param original 原始 user 消息。
 * @param errors 校验失败原因。
 */
export function buildDocRepairPrompt(original: string, errors: readonly string[]): string {
  const list = errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
  // ⚠️ 提示语里必须出现 ```json 字面量：用单引号片段拼接，
  //    否则反引号会提前终止模板字符串（整个 Edge Function 会语法错误）。
  const fenceHint = '只输出一个 ```json 代码块，代码块外不要有任何文字';
  return (
    `${original}\n\n---\n\n你上一次输出的 DocModel 没有通过自动校验，具体问题如下：\n\n` +
    `${list}\n\n请针对上述问题逐条修正，然后重新输出**完整**的 DocModel JSON（${fenceHint}）。`
  );
}
