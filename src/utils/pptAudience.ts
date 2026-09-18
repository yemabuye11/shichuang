import type { ChartSpec } from '@/types/doc';

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
