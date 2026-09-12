/**
 * 基于 Web Crypto 的哈希工具。
 *
 * 用途：
 * - 浏览去重 `viewer_hash`（由 Edge Function 端计算，此处保留同算法以便联调）；
 * - 封面 seed、匿名 ID 的确定性生成。
 */

/**
 * 计算字符串的 SHA-256 十六进制摘要。
 *
 * @param input 输入字符串。
 * @returns 64 位小写十六进制。
 */
export async function sha256(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // 非安全上下文（http 且非 localhost）下的降级：使用 FNV-1a，仅用于展示类场景
    return fnv1aHex(input);
  }
  const data = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * FNV-1a 64 位十六进制（SHA-256 不可用时的降级方案）。
 *
 * ⚠️ 该算法不具备密码学强度，仅用于封面配色等展示场景，**不可用于安全用途**。
 *
 * @param input 输入字符串。
 */
export function fnv1aHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * 由任意字符串确定性地生成一个 0–1 之间的小数。
 *
 * 同一输入永远得到同一输出（用于封面配色的稳定性验收）。
 *
 * @param seed 种子字符串。
 * @param salt 可选盐值，用于同一 seed 派生多个不同值。
 */
export function hashToUnit(seed: string, salt = ''): number {
  const hex = fnv1aHex(`${seed}::${salt}`);
  return parseInt(hex.slice(0, 8), 16) / 0xffffffff;
}

/**
 * 生成一个 10 位大写兑换码（剔除易混字符 0/O/1/I）。
 *
 * 仅用于本地预览展示；**正式的兑换码由服务端 `admin_create_codes()` 生成**。
 *
 * @returns 10 位大写字母数字串。
 */
export function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * 生成 UUID v4（幂等键、本地草稿 ID 等）。
 *
 * @returns 标准 UUID 字符串。
 */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // 降级：基于 getRandomValues 手工拼装 v4
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
