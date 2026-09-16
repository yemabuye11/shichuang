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

  const model = parsed as Partial<DocModel> & { version?: unknown };
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

  if (typeof model.version === 'string' && /^\d+(?:\.\d+){0,2}$/.test(model.version.trim())) {
    // 部分模型会把版本写成常见的语义版本（例如 `1.0.0`）。
    // 这不是内容质量问题，直接归一化为当前 DocModel 的数字版本，
    // 避免为了一个无害格式差异再次调用模型并把任务拖回 70%。
    model.version = Number.parseInt(model.version, 10) || 1;
  } else if (typeof model.version !== 'number') {
    // 允许缺失，渲染时补 1
    if (model.version !== undefined) {
      errors.push('字段 version 必须是数字或合法语义版本');
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

  if (model.kind === 'ppt' && Array.isArray(model.slides)) {
    validatePptQuality(model as DocModel, errors);
  }

  return { ok: errors.length === 0, errors, model: errors.length === 0 ? (model as DocModel) : null };
}

/**
 * PPT 质量门禁：结构合法不等于能上课。
 *
 * 这些规则与 `doc_type:ppt` 提示词的硬下限保持一致，失败会进入一次模型自修复，
 * 仍不达标则退款，避免把“能解析的文字大纲”当成合格课件交付给教师。
 */
function validatePptQuality(model: DocModel, errors: string[]): void {
  const slides = model.slides ?? [];
  if (slides.length < PPT_MIN_SLIDES) {
    errors.push(`PPT 页数不足：当前 ${slides.length} 页，至少需要 ${PPT_MIN_SLIDES} 页`);
  }
  if (slides.length > PPT_MAX_SLIDES) {
    errors.push(`PPT 页数过多：当前 ${slides.length} 页，不应超过 ${PPT_MAX_SLIDES} 页`);
  }

  let visuals = 0;
  let charts = 0;
  let placeholderCount = 0;
  const subjectText = `${model.meta?.subject ?? ''} ${model.meta?.title ?? ''}`;
  const dataLikeSubject = /数学|物理|化学|生物|地理|科学|信息技术|函数|统计|实验|数据|图像/.test(subjectText);

  slides.forEach((slide, index) => {
    const body = Array.isArray(slide.body) ? slide.body : [];
    const notesChars = (slide.notes ?? '').trim().length;
    const bodyChars = body
      .map((block) => {
        const value = [block.text, block.caption, ...(block.items ?? []), ...(block.header ?? []), ...(block.rows ?? []).flat()]
          .filter(Boolean)
          .join(' ');
        for (const pattern of PPT_PLACEHOLDER_PATTERNS) {
          if (pattern.test(value)) placeholderCount += 1;
        }
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
      })
      .join(' ')
      .trim().length;

    if (index > 0 && body.length < 2) {
      errors.push(`第 ${index + 1} 页正文块不足：至少需要 2 个结构化内容块`);
    }
    if (index > 0 && bodyChars < PPT_MIN_BODY_CHARS) {
      errors.push(`第 ${index + 1} 页内容过薄：正文少于 ${PPT_MIN_BODY_CHARS} 字`);
    }
    if (index > 0 && notesChars < PPT_MIN_NOTES_CHARS) {
      errors.push(`第 ${index + 1} 页演讲者备注过短：至少需要 ${PPT_MIN_NOTES_CHARS} 字`);
    }
    if (!slide.title || slide.title.trim().length === 0) {
      errors.push(`第 ${index + 1} 页缺少标题`);
    }
  });

  if (visuals < PPT_MIN_VISUALS) {
    errors.push(`PPT 真图不足：当前 ${visuals} 张，至少需要 ${PPT_MIN_VISUALS} 张 chart 或内联 SVG image`);
  }
  if (dataLikeSubject && charts < 3) {
    errors.push(`数据型课题图表不足：当前 ${charts} 个 chart，至少需要 3 个真实图表`);
  }
  if (placeholderCount > 0) {
    errors.push(`发现 ${placeholderCount} 处“建议配图/待补充”等施工占位语，请改成真实内容`);
  }
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
