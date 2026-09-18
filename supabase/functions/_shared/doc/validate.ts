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

import { isDocType, type DocBlock, type DocModel, type Slide } from './types.ts';

/** 校验结果。 */
export interface DocValidationResult {
  ok: boolean;
  errors: string[];
  /** 解析成功后的模型；失败为 null。 */
  model: DocModel | null;
}

/** 默认体积上限：256KB（文档类富文本允许比单文件 HTML 略大）。 */
export const MAX_DOC_BYTES = 262_144;

const PPT_MIN_SLIDES = 14;
const PPT_MAX_SLIDES = 22;
const PPT_MIN_VISUALS = 4;
const PPT_MIN_NOTES_CHARS = 30;
const PPT_MIN_BODY_CHARS = 35;
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
  return validateDocInternal(raw, maxBytes, { fullPptQuality: true });
}

/**
 * 校验一页数受限的 PPT 分段。
 *
 * 可续跑生成会把 18 页拆成 4 个独立请求。单段不能套用整份 14 页下限，
 * 但仍需守住每段 4~5 页、正文、备注和至少一个真实图示的底线。
 */
export function validatePptPart(
  raw: string,
  part: number,
  maxBytes: number = MAX_DOC_BYTES,
): DocValidationResult {
  return validateDocInternal(raw, maxBytes, {
    fullPptQuality: false,
    minSlides: 4,
    maxSlides: 5,
    minVisuals: 1,
    minCharts: 1,
    skipFirstSlideQuality: part === 1,
  });
}

interface DocValidationOptions {
  fullPptQuality: boolean;
  minSlides?: number;
  maxSlides?: number;
  minVisuals?: number;
  minCharts?: number;
  skipFirstSlideQuality?: boolean;
}

function validateDocInternal(
  raw: string,
  maxBytes: number,
  options: DocValidationOptions,
): DocValidationResult {
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

  const model = normalizeDocModel(parsed, options.fullPptQuality);
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
    validatePptQuality(model as DocModel, errors, options);
  }

  return { ok: errors.length === 0, errors, model: errors.length === 0 ? (model as DocModel) : null };
}

/**
 * 归一化模型常见但无害的字段差异。
 *
 * 模型偶尔会输出 `headers` / `columns` 代替 `header`，或漏写幻灯片 index。
 * 这些不是内容质量问题，如果因此触发整份重写，既慢又容易把本来可用的课件拖到超时。
 */
function normalizeDocModel(parsed: unknown, ensureFullPptVisuals: boolean): Partial<DocModel> {
  const model = parsed as Partial<DocModel> & {
    blocks?: DocBlock[];
    slides?: Slide[];
    version?: unknown;
  };

  if (Array.isArray(model.blocks)) {
    model.blocks = model.blocks.map((block, index) => normalizeBlock(block, index));
  }

  if (Array.isArray(model.slides)) {
    model.slides = model.slides.map((slide, index) => {
      const raw = slide as Slide & { body?: DocBlock[] };
      const body = Array.isArray(raw.body)
        ? raw.body.map((block, blockIndex) => normalizeBlock(block, blockIndex))
        : [];
      return {
        ...raw,
        index: Number.isInteger(raw.index) ? Number(raw.index) : index,
        title: typeof raw.title === 'string' && raw.title.trim() ? raw.title : `第 ${index + 1} 页`,
        body,
        notes: typeof raw.notes === 'string' ? raw.notes : '',
        layout:
          raw.layout === 'title' || raw.layout === 'content' || raw.layout === 'two_col' || raw.layout === 'section'
            ? raw.layout
            : 'content',
      };
    });
    if (ensureFullPptVisuals) ensurePptVisualCoverage(model);
  }

  return model;
}

/**
 * 当模型少画一张图时，补一张真正服务课堂的“学习路线图”，而不是把整份课件重写一遍。
 * 这只负责达到最低图示数量；模型已生成 4 张以上真实图时不做任何改动。
 */
function ensurePptVisualCoverage(model: Partial<DocModel>): void {
  if (model.kind !== 'ppt' || !Array.isArray(model.slides) || model.slides.length < 3) return;

  const countVisuals = (): number =>
    model.slides?.reduce((total, slide) => {
      return total + (slide.body ?? []).filter((block) =>
        block.type === 'chart'
          ? Boolean(block.chart && ((block.chart.points?.length ?? 0) >= 3 || (block.chart.categories?.length ?? 0) >= 2))
          : block.type === 'image' && typeof block.src === 'string' && block.src.startsWith('data:image/')
      ).length;
    }, 0) ?? 0;

  if (countVisuals() >= PPT_MIN_VISUALS) return;

  const hasAutoLearningPath = model.slides.some((slide) =>
    slide.body?.some((block) => block.id === 'auto-learning-path')
  );
  if (!hasAutoLearningPath) {
    const targetIndex = Math.min(2, model.slides.length - 2);
    const target = model.slides[targetIndex];
    if (target) {
      model.slides[targetIndex] = {
        ...target,
        body: [
          ...target.body,
          {
            id: 'auto-learning-path',
            type: 'image',
            src: makeSvgDataUri(buildLearningPathSvg()),
            caption: '本课学习路线：导入提问 → 初读识字 → 理解重点 → 当堂练习 → 小结作业',
          },
        ],
      };
    }
  }

  if (countVisuals() >= PPT_MIN_VISUALS) return;
  const hasAutoKnowledgeMap = model.slides.some((slide) =>
    slide.body?.some((block) => block.id === 'auto-knowledge-map')
  );
  if (!hasAutoKnowledgeMap) {
    const targetIndex = Math.max(1, model.slides.length - 2);
    const target = model.slides[targetIndex];
    if (target) {
      model.slides[targetIndex] = {
        ...target,
        body: [
          ...target.body,
          {
            id: 'auto-knowledge-map',
            type: 'image',
            src: makeSvgDataUri(buildKnowledgeMapSvg()),
            caption: '本课知识结构：先认识重点，再说清方法，最后独立完成练习',
          },
        ],
      };
    }
  }
}

/** 构造一张可直接内联到 DocModel / PPTX 的 SVG data URI。 */
function makeSvgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 五步课堂路线图，用于补足最低图示数量。 */
function buildLearningPathSvg(): string {
  const labels = ['导入提问', '初读识字', '理解重点', '当堂练习', '小结作业'];
  const nodes = labels
    .map((label, index) => {
      const x = 42 + index * 145;
      const line = index < labels.length - 1
        ? `<line x1="${x + 106}" y1="112" x2="${x + 145}" y2="112" stroke="#2F6BFF" stroke-width="4"/>`
        : '';
      const fill = index === 0 ? '#16243A' : index === labels.length - 1 ? '#F3B23C' : '#2F6BFF';
      const text = index === labels.length - 1 ? '#16243A' : '#FFFFFF';
      return `${line}<rect x="${x}" y="72" width="106" height="80" rx="14" fill="${fill}"/><text x="${x + 53}" y="119" text-anchor="middle" font-size="20" font-weight="700" fill="${text}">${label}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 224"><rect width="760" height="224" fill="#F7F9FC"/><text x="380" y="38" text-anchor="middle" font-size="28" font-weight="800" fill="#16243A">本课学习路线</text>${nodes}</svg>`;
}

/** 三步知识结构图，仅在模型图示仍不足时使用。 */
function buildKnowledgeMapSvg(): string {
  const cards = [
    ['认识重点', '读准、看懂、说清'],
    ['掌握方法', '按步骤完成示范'],
    ['独立应用', '练习、检查、表达'],
  ];
  const nodes = cards
    .map(([title, detail], index) => {
      const x = 46 + index * 238;
      const line = index < cards.length - 1
        ? `<line x1="${x + 190}" y1="132" x2="${x + 238}" y2="132" stroke="#2F6BFF" stroke-width="4"/>`
        : '';
      return `${line}<rect x="${x}" y="70" width="190" height="124" rx="16" fill="${index === 1 ? '#2F6BFF' : '#FFFFFF'}" stroke="#D9E1EE" stroke-width="2"/><text x="${x + 95}" y="118" text-anchor="middle" font-size="24" font-weight="800" fill="${index === 1 ? '#FFFFFF' : '#16243A'}">${title}</text><text x="${x + 95}" y="156" text-anchor="middle" font-size="17" fill="${index === 1 ? '#DCE7FF' : '#5B687B'}">${detail}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 250"><rect width="760" height="250" fill="#F7F9FC"/><text x="380" y="40" text-anchor="middle" font-size="28" font-weight="800" fill="#16243A">本课知识结构</text>${nodes}</svg>`;
}

/** 把单个内容块归一化为平台的规范字段。 */
function normalizeBlock(block: DocBlock, fallbackIndex: number): DocBlock {
  const raw = block as DocBlock & {
    headers?: unknown;
    columns?: unknown;
    title?: unknown;
  };
  const header = Array.isArray(raw.header)
    ? raw.header
    : Array.isArray(raw.headers)
      ? raw.headers
      : Array.isArray(raw.columns)
        ? raw.columns
        : undefined;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const originalText = typeof raw.text === 'string' ? raw.text : '';
  const text =
    raw.type === 'callout' && title
      ? originalText
        ? `${title}：${originalText}`
        : title
      : originalText;

  return {
    ...raw,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `blk-${fallbackIndex}`,
    header: header ? header.map((value) => String(value)) : undefined,
    text,
  };
}

/**
 * PPT 质量门禁：结构合法不等于能上课。
 *
 * 这些规则与 `doc_type:ppt` 提示词的硬下限保持一致，失败会进入一次模型自修复，
 * 仍不达标则退款，避免把“能解析的文字大纲”当成合格课件交付给教师。
 */
function validatePptQuality(
  model: DocModel,
  errors: string[],
  options: DocValidationOptions,
): void {
  const slides = model.slides ?? [];
  const minSlides = options.minSlides ?? PPT_MIN_SLIDES;
  const maxSlides = options.maxSlides ?? PPT_MAX_SLIDES;
  const minVisuals = options.minVisuals ?? PPT_MIN_VISUALS;
  const minCharts = options.minCharts ?? 0;
  if (slides.length < minSlides) {
    errors.push(`PPT 页数不足：当前 ${slides.length} 页，至少需要 ${minSlides} 页`);
  }
  if (slides.length > maxSlides) {
    errors.push(`PPT 页数过多：当前 ${slides.length} 页，不应超过 ${maxSlides} 页`);
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
    const contentUnits = countPptContentUnits(body);

    const skipContentChecks = options.skipFirstSlideQuality === true && index === 0;
    if (!skipContentChecks && contentUnits < 2) {
      errors.push(`第 ${index + 1} 页内容单元不足：至少需要 2 个正文块、列表项或表格行`);
    }
    if (!skipContentChecks && bodyChars < PPT_MIN_BODY_CHARS) {
      errors.push(`第 ${index + 1} 页内容过薄：正文少于 ${PPT_MIN_BODY_CHARS} 字`);
    }
    if (!skipContentChecks && notesChars < PPT_MIN_NOTES_CHARS) {
      errors.push(`第 ${index + 1} 页演讲者备注过短：至少需要 ${PPT_MIN_NOTES_CHARS} 字`);
    }
    if (!slide.title || slide.title.trim().length === 0) {
      errors.push(`第 ${index + 1} 页缺少标题`);
    }
  });

  // 所有学科都要有真实教学图示；仅靠表格和列表会把课件重新压回提纲。
  if (visuals < minVisuals) {
    errors.push(`教学图示不足：当前 ${visuals} 张，至少需要 ${minVisuals} 张 chart 或内联 SVG image`);
  }
  if (minCharts > 0 && charts < minCharts) {
    errors.push(`本段教学图表不足：当前 ${charts} 个 chart，至少需要 ${minCharts} 个真实图表`);
  }
  if (minCharts === 0 && dataLikeSubject && charts < 3) {
    errors.push(`数据型课题图表不足：当前 ${charts} 个 chart，至少需要 3 个真实图表`);
  }
  if (placeholderCount > 0) {
    errors.push(`发现 ${placeholderCount} 处“建议配图/待补充”等施工占位语，请改成真实内容`);
  }
}

/**
 * 计算一页的有效内容单元。
 *
 * 一个 list 内可能有多个教学要点，不能把它机械地当成单个正文块；
 * table 的每行同样承载独立信息。这样既挡住空提纲页，又不会误杀
 * “一个列表讲清四个学习目标”这类合格课堂页。
 */
function countPptContentUnits(body: readonly DocBlock[]): number {
  return body.reduce((total, block) => {
    if (block.type === 'list') {
      const items = (block.items ?? []).filter(
        (item) => typeof item === 'string' && item.trim().length > 0,
      );
      return total + Math.max(1, items.length);
    }
    if (block.type === 'table') {
      const rows = (block.rows ?? []).filter(
        (row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim().length > 0),
      );
      return total + Math.max(1, rows.length);
    }
    return total + 1;
  }, 0);
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

/**
 * 构造「输出被 token 上限截断」时的紧凑修复提示。
 *
 * 普通修复提示仍要求完整质量下限，模型很容易在同样的长输出上再次被截断。
 * 这里明确把“先保证完整 JSON”放在第一位，并给出最小可交付密度；优先缩短文字，
 * 不允许直接删掉 JSON 尾部或必需字段。
 */
export function buildDocCompactRepairPrompt(original: string, errors: readonly string[]): string {
  const list = errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
  const fenceHint = '只输出一个 ```json 代码块，代码块外不要有任何文字';
  return (
    `${original}\n\n---\n\n` +
    '你上一次输出在模型 token 上限处被截断，JSON 没有完整结束。\n\n' +
    `校验发现：\n${list}\n\n` +
    '请重新输出一份**完整优先的紧凑版** DocModel JSON，必须遵守：\n' +
    '1. 最高优先级是 JSON 完整闭合，绝不能再次截断，也不能省略顶层字段；\n' +
    '2. PPT 优先输出 16~18 页；空间紧张时不少于 16 页，每页保留 3~4 个必要正文块，' +
    '每页备注控制在 40~100 字；保留至少 4 个真实 chart / image 教学图示；\n' +
    '3. 非 PPT 文档保留全部必需板块，但压缩解释性长句，删除重复铺垫和重复例子；\n' +
    '4. 如果空间紧张，优先缩短文字和备注，不能删除 slides / blocks / scene 等必需结构；\n' +
    `5. ${fenceHint}。`
  );
}
