import type { DocModel, DocType } from '@/types/doc';

/**
 * 文档类产物校验（前端，与 Edge `_shared/doc/validate.ts` 同一套标准）。
 *
 * 用于 `docService.saveVersion` 落库前校验，以及编辑器保存前的本地自检。
 */

/** 校验结果。 */
export interface DocValidationResult {
  ok: boolean;
  errors: string[];
  /** 解析成功后的模型；失败为 null。 */
  model: DocModel | null;
}

/** 默认体积上限：256KB。 */
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

  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;

  const openIdx = raw.search(/```(?:json|JSON)?\s*\n/);
  if (openIdx >= 0) {
    return raw.slice(openIdx).replace(/```(?:json|JSON)?\s*\n/, '').trim();
  }
  return '';
}

/**
 * 判断是否为合法的文档类型。
 *
 * @param value 待校验的值。
 */
export function isDocType(value: unknown): value is DocType {
  return (
    value === 'lesson_plan' ||
    value === 'ppt' ||
    value === 'courseware_2d' ||
    value === 'courseware_3d' ||
    value === 'office_doc'
  );
}

/**
 * 校验文档产物。
 *
 * @param raw 模型原始输出或已序列化的 JSON 字符串。
 * @param maxBytes 体积上限。
 */
export function validateDoc(raw: string, maxBytes: number = MAX_DOC_BYTES): DocValidationResult {
  const errors: string[] = [];
  const json = extractDocJson(raw);

  if (json.length === 0) {
    return { ok: false, errors: ['没有找到 JSON 内容，请重新输出 DocModel'], model: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [`JSON 解析失败：${msg}`], model: null };
  }

  const model = parsed as Partial<DocModel>;
  if (typeof model !== 'object' || model === null) {
    return { ok: false, errors: ['DocModel 必须是 JSON 对象'], model: null };
  }

  if (!isDocType(model.kind)) {
    errors.push('字段 kind 不是合法的文档类型');
  }
  if (!model.meta || typeof model.meta.title !== 'string' || model.meta.title.trim().length === 0) {
    errors.push('字段 meta.title 缺失或为空');
  }
  // 与 Edge `_shared/doc/validate.ts` 保持一致：ppt 以 slides 为真相源，允许 blocks 为空
  const slidesPresent = Array.isArray(model.slides) && model.slides.length > 0;
  const blocksRequired = !(model.kind === 'ppt' && slidesPresent);
  if (blocksRequired && (!Array.isArray(model.blocks) || model.blocks.length === 0)) {
    errors.push('字段 blocks 必须是非空数组（ppt 类型可为空，但必须输出非空 slides）');
  }
  if (model.kind === 'ppt' && (!Array.isArray(model.slides) || model.slides.length === 0)) {
    errors.push('ppt 类型必须包含非空 slides 数组');
  }
  if (model.kind === 'courseware_3d' && (!model.scene || typeof model.scene !== 'object')) {
    errors.push('courseware_3d 类型必须包含 scene');
  }

  const bytes = new TextEncoder().encode(json).length;
  if (bytes > maxBytes) {
    errors.push(`文档体积 ${(bytes / 1024).toFixed(1)}KB 超过上限`);
  }

  return { ok: errors.length === 0, errors, model: errors.length === 0 ? (model as DocModel) : null };
}
