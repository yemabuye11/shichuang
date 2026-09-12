import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

/**
 * 数字 / 时间 / 积分的格式化工具。
 *
 * 统一收口在这里，避免各页面各自 `toFixed` 导致显示口径不一致。
 */

/**
 * 大数字紧凑显示：1.2k / 3.4w。
 *
 * @param n 原始数字。
 * @returns 紧凑字符串。
 */
export function formatCount(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  if (v < 1000) return String(v);
  if (v < 10000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(v / 10000).toFixed(1).replace(/\.0$/, '')}w`;
}

/**
 * 积分显示（带正负号）。
 *
 * @param delta 积分变动量。
 * @returns 形如 `+100` / `-3`。
 */
export function formatDelta(delta: number): string {
  const v = Math.round(Number(delta ?? 0));
  return v > 0 ? `+${v}` : String(v);
}

/**
 * 金额显示（保留 2 位小数）。
 *
 * @param cny 人民币金额。
 */
export function formatCny(cny: number | null | undefined): string {
  return `¥${Number(cny ?? 0).toFixed(2)}`;
}

/**
 * 相对时间：3 分钟前 / 2 小时前 / 昨天 / 3 天前。
 *
 * @param iso ISO 时间字符串。
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = dayjs(iso);
  if (!d.isValid()) return '';
  return d.fromNow();
}

/**
 * 日期时间：`YYYY-MM-DD HH:mm`。
 *
 * @param iso ISO 时间字符串。
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = dayjs(iso);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '';
}

/**
 * 仅日期：`YYYY-MM-DD`。
 *
 * @param iso ISO 时间字符串。
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = dayjs(iso);
  return d.isValid() ? d.format('YYYY-MM-DD') : '';
}

/**
 * 秒数 → 人类可读时长。
 *
 * @param ms 毫秒数。
 * @returns 形如 `1 分 20 秒`。
 */
export function formatDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(ms ?? 0) / 1000));
  if (total < 60) return `${total} 秒`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`;
}

/**
 * 字节数 → KB/MB。
 *
 * @param bytes 字节数。
 */
export function formatBytes(bytes: number | null | undefined): string {
  const v = Number(bytes ?? 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 百分比（0–1 → 0–100）。
 *
 * @param ratio 0–1 之间的比例。
 * @param digits 小数位数，默认 0。
 */
export function formatPercent(ratio: number, digits = 0): string {
  const v = Number.isFinite(ratio) ? ratio : 0;
  return `${(v * 100).toFixed(digits)}%`;
}

/**
 * 昵称脱敏：保留首字，其余用 · 代替（用于匿名展示场景）。
 *
 * @param nickname 原始昵称。
 */
export function maskNickname(nickname: string | null | undefined): string {
  const s = (nickname ?? '').trim();
  if (s.length <= 1) return s || '匿名老师';
  return `${s[0]}${'·'.repeat(Math.min(s.length - 1, 4))}`;
}

/**
 * 把任意值安全地转成整数（用于 Service 返回的 numeric/string）。
 *
 * @param v 任意值。
 * @param fallback 解析失败时的默认值。
 */
export function toInt(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * 把任意值安全地转成浮点数。
 *
 * @param v 任意值。
 * @param fallback 解析失败时的默认值。
 */
export function toFloat(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
