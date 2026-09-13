/**
 * 几何确定性内核（**只覆盖 `geometry` 一类**）。
 *
 * 背景（客户硬要求，见追加 A）：
 *   `SceneDescriptor.params` 是模型直接输出的，AI 写"底面边长 2"就在模型上标 2，
 *   但画出来的比例可能根本不是 2。这种错误数学/物理老师一眼看穿——
 *   **这不是体验问题，是教学事故**；客户要本人出镜讲这个功能，产物里出一个错的标注就是公开处刑。
 *
 * 方案：**不用 AI 给的数值，自己按 params 确定性算一遍**。
 *   - 能算 → 用计算值生成标注（连公式一起给出，等于把"推导最后一步"摊开给老师看）；
 *   - AI 原标注里的数值与计算值冲突 → **剔除该标注**（宁可不展示，也不展示错的）；
 *   - 正文里出现同一量的不同数值 → 同样**剔除**（三重自检：题干 = 推导末步 = 模型标注）；
 *   - 做不到确定性求解（如形状无法识别）→ **明确降级为"不标注数值"**，不硬标。
 *
 * 约束：纯 JS 实现，**不引 sympy / 任何第三方符号计算库**；
 *       Edge（Deno）侧镜像实现见 `supabase/functions/_shared/doc/geometryKernel.ts`。
 */

/** 支持的确定性几何体形状。 */
export type GeoShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'pyramid';

/** 几何体的确定性尺寸。 */
export interface GeoDims {
  /** 形状。 */
  shape: GeoShape;
  /** 长方体长 / 正方体棱长。 */
  a: number;
  /** 长方体宽（正方体时 = a）。 */
  b: number;
  /** 长方体高（正方体时 = a）。 */
  c: number;
  /** 球 / 圆柱 / 圆锥 的半径。 */
  r: number;
  /** 圆柱 / 圆锥 / 棱锥 的高。 */
  h: number;
  /** 尺寸是否来自 AI 的 params（false = 用了渲染默认值）。 */
  fromParams: boolean;
}

/** 一条确定性事实（公式 + 数值）。 */
export interface GeoFact {
  /** 量的标识。 */
  key: string;
  /** 中文名，如「棱长 a」。 */
  label: string;
  /** 公式，如 `6a²`。 */
  formula: string;
  /** 数值。 */
  value: number;
  /** 是否属于「推导最后一步」（面积 / 体积等复合量）。 */
  derived: boolean;
  /** 与正文交叉校验用的关键词。 */
  keywords: readonly string[];
}

/** 几何自检结果。 */
export interface GeoCheckResult {
  /** 形状。 */
  shape: GeoShape;
  /** 采用的尺寸。 */
  dims: GeoDims;
  /** 全部确定性事实（含被剔除的，便于排查）。 */
  facts: GeoFact[];
  /** **可展示**的标注（全部由计算值生成）。 */
  annotations: string[];
  /** 与计算值冲突、已剔除的 AI 原标注。 */
  droppedAiAnnotations: string[];
  /** 与正文冲突、已剔除的事实 key。 */
  droppedByBody: string[];
  /** 是否发生了自动校正（用于给老师明确提示）。 */
  corrected: boolean;
  /** 无法确定性求解时的降级说明；null 表示可正常求解。 */
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

/** 数值格式化：最多 3 位小数，去掉尾随 0。 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}

/** 取正整数/正浮点数，非法返回 null。 */
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

/** 渲染默认尺寸（AI 没给参数时用，保证"标注的数"与"画出来的形"一致）。 */
const DEFAULT_DIMS: Readonly<Record<GeoShape, Omit<GeoDims, 'shape' | 'fromParams'>>> = {
  box: { a: 1, b: 1, c: 1, r: 1, h: 1 },
  sphere: { a: 1, b: 1, c: 1, r: 1, h: 1 },
  cylinder: { a: 1, b: 1, c: 1, r: 1, h: 2 },
  cone: { a: 1, b: 1, c: 1, r: 1, h: 2 },
  pyramid: { a: 2, b: 2, c: 2, r: 1, h: 1.5 },
};

/**
 * 解析几何体尺寸。AI 给了合法参数就用 AI 的，否则回落到渲染默认值。
 *
 * @param params scene.params。
 * @param shape 形状。
 */
export function resolveDims(params: Record<string, unknown>, shape: GeoShape): GeoDims {
  const d = DEFAULT_DIMS[shape];
  const base: GeoDims = { shape, ...d, fromParams: false };
  const p = params ?? {};

  // 常见的参数名写法都兜一遍
  const a = num(p.a) ?? num(p.length) ?? num(p.edge) ?? num(p.side) ?? num(p.width);
  const b = num(p.b) ?? num(p.width);
  const c = num(p.c) ?? num(p.height) ?? num(p.h);
  const r = num(p.r) ?? num(p.radius) ?? num(p.baseRadius);
  const h = num(p.h) ?? num(p.height);

  switch (shape) {
    case 'box': {
      const ea = a;
      if (ea !== null) {
        return { ...base, a: ea, b: b ?? ea, c: c ?? ea, fromParams: true };
      }
      return base;
    }
    case 'sphere': {
      const er = r ?? (a !== null ? a / 2 : null);
      if (er !== null) return { ...base, a: er * 2, b: er * 2, c: er * 2, r: er, h: er * 2, fromParams: true };
      return base;
    }
    case 'cylinder':
    case 'cone': {
      if (r !== null || h !== null) {
        return { ...base, r: r ?? d.r, h: h ?? d.h, a: (r ?? d.r) * 2, b: (r ?? d.r) * 2, c: h ?? d.h, fromParams: true };
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

/**
 * 按几何关系确定性计算各量（**不依赖 AI 给的数值**）。
 *
 * @param shape 形状。
 * @param dims 尺寸。
 */
export function computeFacts(shape: GeoShape, dims: GeoDims): GeoFact[] {
  const { a, b, c, r, h } = dims;
  switch (shape) {
    case 'box': {
      const isCube = Math.abs(a - b) < 1e-9 && Math.abs(b - c) < 1e-9;
      const facts: GeoFact[] = [
        {
          key: 'edge',
          label: isCube ? '棱长 a' : '长 a',
          formula: isCube ? 'a' : 'a',
          value: a,
          derived: false,
          keywords: ['棱长', '边长', '长为', '长是'],
        },
      ];
      if (!isCube) {
        facts.push({ key: 'width', label: '宽 b', formula: 'b', value: b, derived: false, keywords: ['宽为', '宽是', '宽 b'] });
        facts.push({ key: 'height', label: '高 c', formula: 'c', value: c, derived: false, keywords: ['高为', '高是', '高 c'] });
      }
      facts.push({
        key: 'surfaceArea',
        label: '表面积 S',
        formula: '2(ab+bc+ca)',
        value: 2 * (a * b + b * c + c * a),
        derived: true,
        keywords: ['表面积', '表面积为', '表面积是'],
      });
      facts.push({
        key: 'volume',
        label: '体积 V',
        formula: 'abc',
        value: a * b * c,
        derived: true,
        keywords: ['体积', '体积为', '体积是'],
      });
      return facts;
    }
    case 'sphere': {
      return [
        { key: 'radius', label: '半径 r', formula: 'r', value: r, derived: false, keywords: ['半径', '半径为', '半径是'] },
        { key: 'diameter', label: '直径 d', formula: '2r', value: 2 * r, derived: false, keywords: ['直径', '直径为'] },
        {
          key: 'surfaceArea',
          label: '表面积 S',
          formula: '4πr²',
          value: 4 * Math.PI * r * r,
          derived: true,
          keywords: ['表面积', '表面积为'],
        },
        {
          key: 'volume',
          label: '体积 V',
          formula: '4/3πr³',
          value: (4 / 3) * Math.PI * r * r * r,
          derived: true,
          keywords: ['体积', '体积为'],
        },
      ];
    }
    case 'cylinder': {
      return [
        { key: 'radius', label: '底面半径 r', formula: 'r', value: r, derived: false, keywords: ['底面半径', '半径', '半径为'] },
        { key: 'height', label: '高 h', formula: 'h', value: h, derived: false, keywords: ['高为', '高是', '高 h', '圆柱的高'] },
        {
          key: 'lateralArea',
          label: '侧面积 S侧',
          formula: '2πrh',
          value: 2 * Math.PI * r * h,
          derived: true,
          keywords: ['侧面积', '侧面积为'],
        },
        {
          key: 'surfaceArea',
          label: '表面积 S',
          formula: '2πr(r+h)',
          value: 2 * Math.PI * r * (r + h),
          derived: true,
          keywords: ['表面积', '表面积为'],
        },
        {
          key: 'volume',
          label: '体积 V',
          formula: 'πr²h',
          value: Math.PI * r * r * h,
          derived: true,
          keywords: ['体积', '体积为'],
        },
      ];
    }
    case 'cone': {
      const l = Math.sqrt(r * r + h * h);
      return [
        { key: 'radius', label: '底面半径 r', formula: 'r', value: r, derived: false, keywords: ['底面半径', '半径', '半径为'] },
        { key: 'height', label: '高 h', formula: 'h', value: h, derived: false, keywords: ['高为', '高是', '高 h', '圆锥的高'] },
        { key: 'slant', label: '母线 l', formula: '√(r²+h²)', value: l, derived: true, keywords: ['母线', '母线长'] },
        {
          key: 'volume',
          label: '体积 V',
          formula: '1/3πr²h',
          value: (1 / 3) * Math.PI * r * r * h,
          derived: true,
          keywords: ['体积', '体积为'],
        },
      ];
    }
    case 'pyramid': {
      return [
        { key: 'baseEdge', label: '底面边长 a', formula: 'a', value: a, derived: false, keywords: ['底面边长', '底边长', '棱长为'] },
        { key: 'height', label: '高 h', formula: 'h', value: h, derived: false, keywords: ['高为', '高是', '高 h', '棱锥的高'] },
        {
          key: 'volume',
          label: '体积 V',
          formula: '1/3a²h',
          value: (1 / 3) * a * a * h,
          derived: true,
          keywords: ['体积', '体积为'],
        },
      ];
    }
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
      // 关键词之后 14 个字符内出现的第一个数字视为该量的取值
      const tail = text.slice(idx, idx + kw.length + 14);
      const m = /-?\d+(?:\.\d+)?/.exec(tail);
      if (m) out.push(Number(m[0]));
    }
  }
  return out;
}

/** 数值一致判定（相对容差 0.5%，兼顾四舍五入写法）。 */
function sameValue(a: number, b: number): boolean {
  const tol = Math.max(Math.abs(a) * 0.005, 1e-6);
  return Math.abs(a - b) <= tol;
}

/** AI 原标注里是否含有数字。 */
function hasNumber(s: string): boolean {
  return /\d/.test(s);
}

/**
 * 几何三重自检主入口。
 *
 * 自检口径：**题干里的数值 = 推导最后一步 = 模型上的标注值**，三者必须一致；
 * 不一致时**宁可不展示该标注，也不展示错的**。
 *
 * @param scene 3D 场景描述（仅 geometry 有效）。
 * @param bodyText 文档正文（用于交叉校验；可为空，空则跳过正文校验）。
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
      dims: DEFAULT_DIMS.box as GeoDims,
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

  // ---- 1) 与正文交叉校验：正文出现同一量的不同数值 → 剔除该事实 ----
  const droppedByBody: string[] = [];
  const keptFacts = facts.filter((f) => {
    const nums = findNumbersNear(bodyText, f.keywords);
    if (nums.length === 0) return true; // 正文没提，无从冲突
    if (nums.some((n) => sameValue(n, f.value))) return true; // 至少一处对得上
    droppedByBody.push(f.key);
    return false;
  });

  // ---- 2) 用计算值生成标注（含公式，等于把"推导最后一步"摊开）----
  const annotations = keptFacts.map((f) => {
    const v = fmtNum(f.value);
    return f.derived ? `${f.label} = ${f.formula} ≈ ${v}` : `${f.label} = ${f.formula} = ${v}`;
  });

  // ---- 3) AI 原标注：只保留**不含数字**的定性描述，数值型一律以计算值为准 ----
  const ai = scene?.annotations ?? [];
  const droppedAiAnnotations: string[] = [];
  for (const s of ai) {
    if (hasNumber(String(s ?? ''))) droppedAiAnnotations.push(String(s));
    else if (String(s ?? '').trim()) annotations.push(String(s).trim());
  }

  const corrected = droppedAiAnnotations.length > 0 || droppedByBody.length > 0;

  return {
    shape,
    dims,
    facts,
    annotations,
    droppedAiAnnotations,
    droppedByBody,
    corrected,
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
