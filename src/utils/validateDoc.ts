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

const PPT_MIN_SLIDES = 12;
const PPT_MAX_SLIDES = 22;
const PPT_MIN_VISUALS = 3;
const PPT_MIN_NOTES_CHARS = 30;
const PPT_MIN_BODY_CHARS = 36;
const PPT_PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /建议配图/,
  /此处(?:插入|添加|放置)/,
  /教师可自行补充/,
  /学生自行阅读课本/,
  /待补|待完善|TODO|占位符/i,
  /\b同上\b/,
];

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

  if (model.kind === 'ppt' && Array.isArray(model.slides)) {
    validatePptQuality(model as DocModel, errors);
  }

  const bytes = new TextEncoder().encode(json).length;
  if (bytes > maxBytes) {
    errors.push(`文档体积 ${(bytes / 1024).toFixed(1)}KB 超过上限`);
  }

  return { ok: errors.length === 0, errors, model: errors.length === 0 ? (model as DocModel) : null };
}

/** 与 Edge 侧一致的 PPT 质量门禁，用于编辑保存前提示教师。 */
function validatePptQuality(model: DocModel, errors: string[]): void {
  const slides = model.slides ?? [];
  if (slides.length < PPT_MIN_SLIDES) errors.push(`PPT 页数不足：当前 ${slides.length} 页，至少需要 ${PPT_MIN_SLIDES} 页`);
  if (slides.length > PPT_MAX_SLIDES) errors.push(`PPT 页数过多：当前 ${slides.length} 页，不应超过 ${PPT_MAX_SLIDES} 页`);

  let visuals = 0;
  let charts = 0;
  let placeholderCount = 0;
  const subjectText = `${model.meta?.subject ?? ''} ${model.meta?.title ?? ''}`;
  const dataLikeSubject = /数学|物理|化学|生物|地理|科学|信息技术|函数|统计|实验|数据|图像/.test(subjectText);

  slides.forEach((slide, index) => {
    const body = Array.isArray(slide.body) ? slide.body : [];
    const bodyChars = body.map((block) => {
      const value = [block.text, block.caption, ...(block.items ?? []), ...(block.header ?? []), ...(block.rows ?? []).flat()]
        .filter(Boolean)
        .join(' ');
      for (const pattern of PPT_PLACEHOLDER_PATTERNS) if (pattern.test(value)) placeholderCount += 1;
      if (block.type === 'chart' && block.chart) {
        const hasPoints = (block.chart.points ?? []).length >= 3;
        const hasBars = (block.chart.categories ?? []).length >= 2 && (block.chart.values ?? []).length >= 2;
        if (hasPoints || hasBars) {
          charts += 1;
          visuals += 1;
        }
      } else if (block.type === 'image' && typeof block.src === 'string' && block.src.startsWith('data:image/')) {
        visuals += 1;
      }
      return value;
    }).join(' ').trim().length;

    if (index > 0 && body.length < 2) errors.push(`第 ${index + 1} 页正文块不足：至少需要 2 个结构化内容块`);
    if (index > 0 && bodyChars < PPT_MIN_BODY_CHARS) errors.push(`第 ${index + 1} 页内容过薄：正文少于 ${PPT_MIN_BODY_CHARS} 字`);
    if (index > 0 && (slide.notes ?? '').trim().length < PPT_MIN_NOTES_CHARS) errors.push(`第 ${index + 1} 页演讲者备注过短：至少需要 ${PPT_MIN_NOTES_CHARS} 字`);
    if (!slide.title || slide.title.trim().length === 0) errors.push(`第 ${index + 1} 页缺少标题`);
  });

  // 数据型课题必须有真实图表；非数据课题允许用表格、列表和版式表达。
  if (dataLikeSubject && visuals < PPT_MIN_VISUALS) errors.push(`数据型课题图示不足：当前 ${visuals} 张，至少需要 ${PPT_MIN_VISUALS} 张真实图表`);
  if (dataLikeSubject && charts < 3) errors.push(`数据型课题图表不足：当前 ${charts} 个 chart，至少需要 3 个真实图表`);
  if (placeholderCount > 0) errors.push(`发现 ${placeholderCount} 处“建议配图/待补充”等施工占位语，请改成真实内容`);
}
