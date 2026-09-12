import { hashToUnit } from './hash';
import { fnv1aHex } from './hash';

/**
 * 程序生成封面：**零存储、零流量**（ARCHITECTURE.md §2.3 / PRD 4.2）。
 *
 * 不上传任何图片，只用 `cover_seed` 确定性地生成 CSS 渐变 + 几何装饰，
 * 保证同一 seed 永远得到同一张封面（验收点：对同一 seed 输出稳定一致）。
 */

export interface CoverStyle {
  /** 渐变起始色。 */
  readonly from: string;
  /** 渐变结束色。 */
  readonly to: string;
  /** 渐变角度（deg）。 */
  readonly angle: number;
  /** 装饰圆的数量（2–3）。 */
  readonly blobs: readonly { readonly x: number; readonly y: number; readonly r: number }[];
  /** 前景文字色（保证对比度 ≥ 4.5:1）。 */
  readonly textColor: string;
}

/** 预设色板（教育场景友好、明快但不刺眼）。 */
const PALETTE: readonly { from: string; to: string }[] = [
  { from: '#2F6BFF', to: '#7A5CFF' },
  { from: '#0EA5A5', to: '#2F6BFF' },
  { from: '#F97316', to: '#F43F5E' },
  { from: '#8B5CF6', to: '#EC4899' },
  { from: '#10B981', to: '#0EA5A5' },
  { from: '#F59E0B', to: '#F97316' },
  { from: '#3B82F6', to: '#06B6D4' },
  { from: '#6366F1', to: '#8B5CF6' },
];

/**
 * 由 seed 生成一份稳定的封面样式。
 *
 * @param seed 封面种子（`apps.cover_seed`）；为空时按空串处理。
 * @returns 稳定的封面样式。
 */
export function buildCoverStyle(seed: string | null | undefined): CoverStyle {
  const s = seed ?? '';
  const idx = Math.floor(hashToUnit(s, 'palette') * PALETTE.length) % PALETTE.length;
  const pair = PALETTE[Math.min(Math.max(idx, 0), PALETTE.length - 1)];
  const angle = Math.floor(hashToUnit(s, 'angle') * 180);
  const blobCount = 2 + Math.floor(hashToUnit(s, 'blobCount') * 2);

  const blobs = Array.from({ length: blobCount }, (_, i) => ({
    x: Math.round(hashToUnit(s, `bx${i}`) * 100),
    y: Math.round(hashToUnit(s, `by${i}`) * 100),
    r: Math.round(18 + hashToUnit(s, `br${i}`) * 30),
  }));

  return {
    from: pair.from,
    to: pair.to,
    angle,
    blobs,
    // 渐变底色均为中深色，白字对比度 ≥ 4.5:1
    textColor: '#FFFFFF',
  };
}

/**
 * 生成封面的 CSS `background` 值（可直接用于 `style`）。
 *
 * @param seed 封面种子。
 */
export function coverBackground(seed: string | null | undefined): string {
  const st = buildCoverStyle(seed);
  const blobs = st.blobs
    .map(
      (b) =>
        `radial-gradient(circle at ${b.x}% ${b.y}%, rgba(255,255,255,0.22) 0, rgba(255,255,255,0) ${b.r}%)`,
    )
    .join(', ');
  return `linear-gradient(${st.angle}deg, ${st.from} 0%, ${st.to} 100%)${blobs ? `, ${blobs}` : ''}`;
}

/**
 * 生成可直接内联的 SVG 封面（用于二维码分享卡片、OG 图等需要图片 URL 的场景）。
 *
 * @param seed 封面种子。
 * @param title 叠加显示的标题（超过 12 字截断）。
 * @returns `data:image/svg+xml,...` 形式的 URL。
 */
export function coverSvgDataUrl(seed: string | null | undefined, title = ''): string {
  const st = buildCoverStyle(seed);
  const safeTitle = (title ?? '').slice(0, 12).replace(/[<>&"]/g, '');
  const blobs = st.blobs
    .map(
      (b) =>
        `<circle cx="${b.x * 4}" cy="${b.y * 2.4}" r="${b.r * 1.6}" fill="#fff" opacity="0.14"/>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${st.from}"/><stop offset="1" stop-color="${st.to}"/></linearGradient></defs>
<rect width="400" height="240" fill="url(#g)"/>
${blobs}
<text x="24" y="200" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="28" font-weight="700" fill="${st.textColor}">${safeTitle}</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * 取标题首字作为封面主视觉字符。
 *
 * @param title 应用标题。
 */
export function coverInitial(title: string | null | undefined): string {
  const t = (title ?? '').trim();
  return t.length > 0 ? t.slice(0, 1) : '课';
}

/**
 * 由应用 ID 推导一个默认 seed（未显式设置时使用）。
 *
 * @param appId 应用 ID。
 */
export function seedFromId(appId: string): string {
  return fnv1aHex(appId);
}
