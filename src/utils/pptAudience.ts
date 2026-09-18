import type { ChartSpec, DocBlock, DocModel, Slide } from '@/types/doc';

/** 需要童趣图示的低龄课件。 */
export function isEarlyChildhoodPpt(grade?: string): boolean {
  const text = (grade ?? '').replace(/\s+/g, '');
  if (!text) return false;
  if (/幼儿园|学前|(?:一|二|三|[1-3])年级/.test(text)) return true;
  return /小学/.test(text) && !/(?:四|五|六|[4-6])年级/.test(text);
}

/** 从图表数据中提取适合低龄课堂展示的短标签。 */
export function friendlyChartLabels(spec: ChartSpec): string[] {
  const raw = spec.kind === 'bar'
    ? (spec.categories ?? [])
    : (spec.points ?? []).map((point) => String(point[0] ?? ''));
  let labels = raw
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 6);
  if (spec.kind !== 'bar' && labels.every((item) => /^-?\d+(?:\.\d+)?$/.test(item))) {
    labels = [];
  }
  if (labels.length > 0) return labels;

  const fallback = spec.title ?? spec.expression ?? '';
  const parts = fallback
    .split(/[、，,；;|\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 10)
    .slice(0, 4);
  return parts.length > 0 ? parts : ['看一看', '说一说', '做一做'];
}

export type FriendlyVisualKind =
  | 'water'
  | 'cloud'
  | 'snow'
  | 'sun'
  | 'book'
  | 'plant'
  | 'animal'
  | 'star';

/** 根据短标签选择适合低龄课件的图标语义。 */
export function friendlyVisualKind(label: string): FriendlyVisualKind {
  if (/水|雨|滴|河|海|冰/.test(label)) return 'water';
  if (/云|雾|天气/.test(label)) return 'cloud';
  if (/雪|霜|冻/.test(label)) return 'snow';
  if (/太阳|晴|日|光/.test(label)) return 'sun';
  if (/课文|阅读|古诗|字词|识字|书|读|写/.test(label)) return 'book';
  if (/植物|芽|树|花|草|生长/.test(label)) return 'plant';
  if (/动物|猫|狗|鸟|鱼|虫/.test(label)) return 'animal';
  return 'star';
}

const EARLY_PPT_STATISTIC_TEXT = /数据|频率|次数|难度|预估|最多|最少|最高|最低|比例|趋势|统计|排名|其次|较少|较多|更常见|最常|少见|出现得/;

/** 清除低龄课件中误生成的统计图表语义，保留可观察、可表达的短标签。 */
function sanitizeEarlyPptChart(block: DocBlock): DocBlock {
  const chart = block.chart;
  if (block.type !== 'chart' || !chart) return block;

  const rawLabels = chart.kind === 'bar'
    ? (chart.categories ?? [])
    : (chart.points ?? []).map((point) => String(point[0] ?? ''));
  let labels = rawLabels
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0 && !/^-?\d+(?:\.\d+)?$/.test(item))
    .slice(0, 4);

  if (labels.length < 2) {
    labels = (block.caption ?? chart.title ?? '')
      .split(/[、，,；;：:|\s]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && item.length <= 8)
      .slice(0, 4);
  }
  if (labels.length < 2) labels = ['看一看', '说一说', '做一做'];

  const originalTitle = chart.title ?? '看图找一找';
  const title = EARLY_PPT_STATISTIC_TEXT.test(originalTitle) ? '看图找一找' : originalTitle;
  const caption = block.caption && EARLY_PPT_STATISTIC_TEXT.test(block.caption)
    ? `看一看，说一说：${labels.join('、')}`
    : block.caption;

  return {
    ...block,
    caption,
    chart: {
      kind: 'bar',
      title,
      categories: labels,
      values: labels.map(() => 1),
    },
  };
}

/** 低龄课件备注去掉统计结论，避免教师照着讲出数据口径。 */
function sanitizeEarlyPptNotes(value: string | undefined): string | undefined {
  if (!value) return value;
  const fallback = '请学生观察画面，说一说自己的发现；教师继续追问，并帮助学生把话说完整。';
  const cleaned = value
    .split(/(?<=[。！？\n])/)
    .filter((segment) => !EARLY_PPT_STATISTIC_TEXT.test(segment))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length >= 30 ? cleaned : `${cleaned}${fallback}`;
}

function sanitizeEarlyPptSlide(slide: Slide): Slide {
  return {
    ...slide,
    body: slide.body.map(sanitizeEarlyPptChart),
    notes: sanitizeEarlyPptNotes(slide.notes),
  };
}

/**
 * 对已经生成过的低龄课件做加载时净化。
 *
 * 新生成链路已经在 Edge 侧执行同样的清理；这里补上旧版本兼容，保证教师打开、
 * 编辑或导出历史课件时也不会再次看到不合适的柱形图、折线图和统计口径。
 */
export function sanitizeEarlyPptModel(model: DocModel): DocModel {
  if (model.kind !== 'ppt' || !isEarlyChildhoodPpt(model.meta?.grade)) {
    return model;
  }
  return {
    ...model,
    blocks: model.blocks.map(sanitizeEarlyPptChart),
    slides: model.slides?.map(sanitizeEarlyPptSlide),
  };
}
