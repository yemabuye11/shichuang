/**
 * 几何确定性内核（Edge 侧镜像实现，与 `src/utils/geometryKernel.ts` 保持一致）。
 *
 * 背景（客户硬要求，见追加 A）：`SceneDescriptor.params` 由模型直接输出，
 * AI 写"底面边长 2"就标 2，但画出来的比例可能不是 2——数学/物理老师一眼看穿，
 * **属于教学事故**。
 *
 * 方案：不用 AI 给的数值，按 params 确定性重算；
 *   - AI 原标注含数字 → 剔除（以计算值为准）；
 *   - 正文出现同一量的不同数值 → 剔除该标注（三重自检）；
 *   - 形状无法识别 → 明确降级为「不标注数值」。
 *
 * 纯 JS，不引 sympy 之类符号计算库（Deno 环境也装不了）。
 */

/** 支持的确定性几何体形状。 */
export type GeoShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'pyramid';

/** 几何体的确定性尺寸。 */
export interface GeoDims {
  shape: GeoShape;
  a: number;
  b: number;
  c: number;
  r: number;
  h: number;
  fromParams: boolean;
}

/** 一条确定性事实。 */
export interface GeoFact {
  key: string;
  label: string;
  formula: string;
  value: number;
  derived: boolean;
  keywords: readonly string[];
}

/** 几何自检结果。 */
export interface GeoCheckResult {
  shape: GeoShape;
  dims: GeoDims;
  facts: GeoFact[];
  annotations: string[];
  droppedAiAnnotations: string[];
  droppedByBody: string[];
  corrected: boolean;
  degradedReason: string | null;
}

/** 形状中文名。 */
export const GEO_SHAPE_LABEL: Readonly<Record<GeoShape, string>> = {
  box: '长方体',
  sphere: '球',
  cylinder: '圆柱',
  cone: '圆锥',
  pyramid: '正四棱锥',
};

/** 数值格式化：最多 3 位小数。 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return String(Math.round(n * 1000) / 1000);
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 解析形状，无法识别返回 null。 */
export function parseShape(v: unknown): GeoShape | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'box' || s === 'cube' || s === 'cuboid' || s === '长方体' || s === '正方体') return 'box';
  if (s === 'sphere' || s === 'ball' || s === '球') return 'sphere';
  if (s === 'cylinder' || s === '圆柱') return 'cylinder';
  if (s === 'cone' || s === '圆锥') return 'cone';
  if (s === 'pyramid' || s === '棱锥' || s === '四棱锥') return 'pyramid';
  return null;
}

/** 渲染默认尺寸（AI 未给参数时用，保证"标注的数"与"画出来的形"一致）。 */
const DEFAULT_DIMS: Readonly<Record<GeoShape, Omit<GeoDims, 'shape' | 'fromParams'>>> = {
  box: { a: 1, b: 1, c: 1, r: 1, h: 1 },
  sphere: { a: 1, b: 1, c: 1, r: 1, h: 1 },
  cylinder: { a: 1, b: 1, c: 1, r: 1, h: 2 },
  cone: { a: 1, b: 1, c: 1, r: 1, h: 2 },
  pyramid: { a: 2, b: 2, c: 2, r: 1, h: 1.5 },
};

/** 解析几何体尺寸。 */
export function resolveDims(params: Record<string, unknown>, shape: GeoShape): GeoDims {
  const d = DEFAULT_DIMS[shape];
  const base: GeoDims = { shape, ...d, fromParams: false };
  const p = params ?? {};

  const a = num(p.a) ?? num(p.length) ?? num(p.edge) ?? num(p.side) ?? num(p.width);
  const b = num(p.b) ?? num(p.width);
  const c = num(p.c) ?? num(p.height) ?? num(p.h);
  const r = num(p.r) ?? num(p.radius) ?? num(p.baseRadius);
  const h = num(p.h) ?? num(p.height);

  switch (shape) {
    case 'box': {
      if (a !== null) return { ...base, a, b: b ?? a, c: c ?? a, fromParams: true };
      return base;
    }
    case 'sphere': {
      const er = r ?? (a !== null ? a / 2 : null);
      if (er !== null) {
        return { ...base, a: er * 2, b: er * 2, c: er * 2, r: er, h: er * 2, fromParams: true };
      }
      return base;
    }
    case 'cylinder':
    case 'cone': {
      if (r !== null || h !== null) {
        const rr = r ?? d.r;
        return { ...base, r: rr, h: h ?? d.h, a: rr * 2, b: rr * 2, c: h ?? d.h, fromParams: true };
      }
      return base;
    }
    case 'pyramid': {
      const ea = a ?? (r !== null ? r * Math.SQRT2 : null);
      if (ea !== null || h !== null) {
        const side = ea ?? d.a;
        return { ...base, a: side, b: side, c: h ?? d.h, h: h ?? d.h, r: side / Math.SQRT2, fromParams: true };
      }
      return base;
    }
    default:
      return base;
  }
}

/** 按几何关系确定性计算各量。 */
export function computeFacts(shape: GeoShape, dims: GeoDims): GeoFact[] {
  const { a, b, c, r, h } = dims;
  switch (shape) {
    case 'box': {
      const isCube = Math.abs(a - b) < 1e-9 && Math.abs(b - c) < 1e-9;
      const facts: GeoFact[] = [
        { key: 'edge', label: isCube ? '棱长 a' : '长 a', formula: 'a', value: a, derived: false, keywords: ['棱长', '边长', '长为', '长是'] },
      ];
      if (!isCube) {
        facts.push({ key: 'width', label: '宽 b', formula: 'b', value: b, derived: false, keywords: ['宽为', '宽是', '宽 b'] });
        facts.push({ key: 'height', label: '高 c', formula: 'c', value: c, derived: false, keywords: ['高为', '高是', '高 c'] });
      }
      facts.push({
        key: 'surfaceArea', label: '表面积 S', formula: '2(ab+bc+ca)',
        value: 2 * (a * b + b * c + c * a), derived: true, keywords: ['表面积', '表面积为'],
      });
      facts.push({
        key: 'volume', label: '体积 V', formula: 'abc',
        value: a * b * c, derived: true, keywords: ['体积', '体积为'],
      });
      return facts;
    }
    case 'sphere':
      return [
        { key: 'radius', label: '半径 r', formula: 'r', value: r, derived: false, keywords: ['半径', '半径为'] },
        { key: 'diameter', label: '直径 d', formula: '2r', value: 2 * r, derived: false, keywords: ['直径', '直径为'] },
        { key: 'surfaceArea', label: '表面积 S', formula: '4πr²', value: 4 * Math.PI * r * r, derived: true, keywords: ['表面积', '表面积为'] },
        { key: 'volume', label: '体积 V', formula: '4/3πr³', value: (4 / 3) * Math.PI * r * r * r, derived: true, keywords: ['体积', '体积为'] },
      ];
    case 'cylinder':
      return [
        { key: 'radius', label: '底面半径 r', formula: 'r', value: r, derived: false, keywords: ['底面半径', '半径', '半径为'] },
        { key: 'height', label: '高 h', formula: 'h', value: h, derived: false, keywords: ['高为', '高是', '圆柱的高'] },
        { key: 'lateralArea', label: '侧面积 S侧', formula: '2πrh', value: 2 * Math.PI * r * h, derived: true, keywords: ['侧面积', '侧面积为'] },
        { key: 'surfaceArea', label: '表面积 S', formula: '2πr(r+h)', value: 2 * Math.PI * r * (r + h), derived: true, keywords: ['表面积', '表面积为'] },
        { key: 'volume', label: '体积 V', formula: 'πr²h', value: Math.PI * r * r * h, derived: true, keywords: ['体积', '体积为'] },
      ];
    case 'cone':
      return [
        { key: 'radius', label: '底面半径 r', formula: 'r', value: r, derived: false, keywords: ['底面半径', '半径', '半径为'] },
        { key: 'height', label: '高 h', formula: 'h', value: h, derived: false, keywords: ['高为', '高是', '圆锥的高'] },
        { key: 'slant', label: '母线 l', formula: '√(r²+h²)', value: Math.sqrt(r * r + h * h), derived: true, keywords: ['母线', '母线长'] },
        { key: 'volume', label: '体积 V', formula: '1/3πr²h', value: (1 / 3) * Math.PI * r * r * h, derived: true, keywords: ['体积', '体积为'] },
      ];
    case 'pyramid':
      return [
        { key: 'baseEdge', label: '底面边长 a', formula: 'a', value: a, derived: false, keywords: ['底面边长', '底边长', '棱长为'] },
        { key: 'height', label: '高 h', formula: 'h', value: h, derived: false, keywords: ['高为', '高是', '棱锥的高'] },
        { key: 'volume', label: '体积 V', formula: '1/3a²h', value: (1 / 3) * a * a * h, derived: true, keywords: ['体积', '体积为'] },
      ];
    default:
      return [];
  }
}

/** 在正文里找「关键词附近」的数值。 */
function findNumbersNear(text: string, keywords: readonly string[]): number[] {
  const out: number[] = [];
  if (!text) return out;
  for (const kw of keywords) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(kw, from);
      if (idx < 0) break;
      from = idx + kw.length;
      const tail = text.slice(idx, idx + kw.length + 14);
      const m = /-?\d+(?:\.\d+)?/.exec(tail);
      if (m) out.push(Number(m[0]));
    }
  }
  return out;
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(a) * 0.005, 1e-6);
}

function hasNumber(s: string): boolean {
  return /\d/.test(s);
}

/**
 * 几何三重自检主入口：题干数值 = 推导末步 = 模型标注，不一致时宁缺毋错。
 *
 * @param scene 3D 场景描述（仅 geometry 有效）。
 * @param bodyText 文档正文（用于交叉校验）。
 */
export function checkGeometry(
  scene: { type?: string; params?: unknown; annotations?: readonly string[] },
  bodyText = '',
): GeoCheckResult {
  const params = (scene?.params ?? {}) as Record<string, unknown>;
  const shape = parseShape(params.shape ?? (scene as { shape?: unknown }).shape);

  if (!shape) {
    return {
      shape: 'box',
      dims: { shape: 'box', ...DEFAULT_DIMS.box, fromParams: false },
      facts: [],
      annotations: [],
      droppedAiAnnotations: [],
      droppedByBody: [],
      corrected: false,
      degradedReason: '形状参数无法识别，已按「不标注数值」降级处理，避免给出错误数值。',
    };
  }

  const dims = resolveDims(params, shape);
  const facts = computeFacts(shape, dims);

  const droppedByBody: string[] = [];
  const keptFacts = facts.filter((f) => {
    const nums = findNumbersNear(bodyText, f.keywords);
    if (nums.length === 0) return true;
    if (nums.some((n) => sameValue(n, f.value))) return true;
    droppedByBody.push(f.key);
    return false;
  });

  const annotations = keptFacts.map((f) => {
    const v = fmtNum(f.value);
    return f.derived ? `${f.label} = ${f.formula} ≈ ${v}` : `${f.label} = ${f.formula} = ${v}`;
  });

  const droppedAiAnnotations: string[] = [];
  for (const s of scene?.annotations ?? []) {
    if (hasNumber(String(s ?? ''))) droppedAiAnnotations.push(String(s));
    else if (String(s ?? '').trim()) annotations.push(String(s).trim());
  }

  return {
    shape,
    dims,
    facts,
    annotations,
    droppedAiAnnotations,
    droppedByBody,
    corrected: droppedAiAnnotations.length > 0 || droppedByBody.length > 0,
    degradedReason: null,
  };
}

/** 把文档块序列化成纯文本（供交叉校验）。 */
export function blocksToText(
  blocks: readonly { type?: string; text?: string; items?: readonly string[]; caption?: string }[] | undefined,
): string {
  if (!blocks) return '';
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.text) parts.push(String(b.text));
    if (b.items) parts.push(b.items.join(' '));
    if (b.caption) parts.push(String(b.caption));
  }
  return parts.join('\n');
}
