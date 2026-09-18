import type { DocBlock, DocModel, DocType, Slide } from '@/types/doc';

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

  const model = normalizeDocModel(parsed);
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

/** 归一化模型常见但无害的字段差异，避免为了 `headers` / `columns` 重写整份课件。 */
function normalizeDocModel(parsed: unknown): Partial<DocModel> {
  const model = parsed as Partial<DocModel> & {
    blocks?: DocBlock[];
    slides?: Slide[];
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
    ensurePptVisualCoverage(model);
  }

  return model;
}

/** 当模型少画一张图时，补一张学习路线图，避免为了图示数量重写整份课件。 */
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
    slide.body?.some((block: DocBlock) => block.id === 'auto-learning-path')
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
    slide.body?.some((block: DocBlock) => block.id === 'auto-knowledge-map')
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
    const contentUnits = countPptContentUnits(body);

    if (index > 0 && contentUnits < 2) {
      errors.push(`第 ${index + 1} 页内容单元不足：至少需要 2 个正文块、列表项或表格行`);
    }
    if (index > 0 && bodyChars < PPT_MIN_BODY_CHARS) errors.push(`第 ${index + 1} 页内容过薄：正文少于 ${PPT_MIN_BODY_CHARS} 字`);
    if (index > 0 && (slide.notes ?? '').trim().length < PPT_MIN_NOTES_CHARS) errors.push(`第 ${index + 1} 页演讲者备注过短：至少需要 ${PPT_MIN_NOTES_CHARS} 字`);
    if (!slide.title || slide.title.trim().length === 0) errors.push(`第 ${index + 1} 页缺少标题`);
  });

  // 所有学科都要有真实教学图示；仅靠表格和列表会把课件重新压回提纲。
  if (visuals < PPT_MIN_VISUALS) errors.push(`教学图示不足：当前 ${visuals} 张，至少需要 ${PPT_MIN_VISUALS} 张 chart 或内联 SVG image`);
  if (dataLikeSubject && charts < 3) errors.push(`数据型课题图表不足：当前 ${charts} 个 chart，至少需要 3 个真实图表`);
  if (placeholderCount > 0) errors.push(`发现 ${placeholderCount} 处“建议配图/待补充”等施工占位语，请改成真实内容`);
}

/** 与 Edge 侧一致：列表项和表格行都算有效内容单元。 */
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
