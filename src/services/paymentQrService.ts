import { getSupabase } from './supabaseClient';
import { isMockMode } from '@/config/env';
import { AppError } from './http/errors';
import type { Json } from '@/types/database';

/**
 * 收款码配置服务（system_config.payment_qr）。
 *
 * ⚠️ **产品红线：这里只做「展示一张图片」。**
 * 师创的商业模式是「老师线下扫码转账 → 管理员在后台手工加积分」，
 * 系统**永不接入任何在线支付接口 / 支付 SDK / 支付回调**。
 * 本文件只负责读写一个图片链接 + 标题 + 提示语，不做任何资金动作。
 *
 * 数据结构：
 * ```json
 * { "imageUrl": "https://.../wechat-qr.png",
 *   "title": "扫码充值",
 *   "notice": "转账后请联系管理员加积分" }
 * ```
 *
 * - 读：`get_system_config('payment_qr')`（SECURITY DEFINER，匿名可读）；
 * - 写：`admin_set_system_config('payment_qr', jsonb)`（管理员专属）。
 */

/** 收款码配置的默认值（未配置 / 读取失败时使用）。 */
export interface PaymentQrConfig {
  /** 收款码图片的 https 链接；为空表示「管理员还没配」，前台整块不显示。 */
  imageUrl: string;
  /** 展示标题。 */
  title: string;
  /** 展示提示语。 */
  notice: string;
}

export const DEFAULT_PAYMENT_QR: PaymentQrConfig = {
  imageUrl: '',
  title: '扫码充值',
  notice: '转账后请联系管理员加积分',
};

/** mock / 未连接后端时，把配置暂存在浏览器本地，方便演示预览。 */
const MOCK_STORAGE_KEY = 'shichuang.mock.payment_qr';

/** 读取本地暂存的配置（JSON 解析失败时回落默认值）。 */
function readMockConfig(): PaymentQrConfig {
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PAYMENT_QR };
    const parsed = JSON.parse(raw) as Partial<PaymentQrConfig>;
    return {
      imageUrl: typeof parsed.imageUrl === 'string' ? parsed.imageUrl : '',
      title: typeof parsed.title === 'string' ? parsed.title : DEFAULT_PAYMENT_QR.title,
      notice: typeof parsed.notice === 'string' ? parsed.notice : DEFAULT_PAYMENT_QR.notice,
    };
  } catch {
    return { ...DEFAULT_PAYMENT_QR };
  }
}

/** 写入本地暂存的配置。 */
function writeMockConfig(cfg: PaymentQrConfig): void {
  try {
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* 隐私模式下写入失败不影响主流程 */
  }
}

/**
 * 读取收款码配置（老师端与管理员后台共用）。
 *
 * 任何异常都回落默认值，**绝不抛错**，保证前台不会出现破图或白屏。
 *
 * @returns 收款码配置；未配置时 `imageUrl` 为空字符串。
 */
export async function getPaymentQrConfig(): Promise<PaymentQrConfig> {
  if (isMockMode()) return readMockConfig();

  const sb = getSupabase();
  if (!sb) return { ...DEFAULT_PAYMENT_QR };

  try {
    const { data, error } = await sb.rpc('get_system_config', { p_key: 'payment_qr' });
    if (error || data == null) return { ...DEFAULT_PAYMENT_QR };
    const obj = data as unknown as Record<string, unknown>;
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return { ...DEFAULT_PAYMENT_QR };
    }
    return {
      imageUrl: typeof obj.imageUrl === 'string' ? obj.imageUrl : '',
      title: typeof obj.title === 'string' && obj.title.length > 0 ? obj.title : DEFAULT_PAYMENT_QR.title,
      notice: typeof obj.notice === 'string' ? obj.notice : DEFAULT_PAYMENT_QR.notice,
    };
  } catch (err) {
    console.warn('[paymentQr] 读取收款码配置失败，按未配置处理', err);
    return { ...DEFAULT_PAYMENT_QR };
  }
}

/**
 * 管理员：保存收款码配置。
 *
 * @param cfg 图片链接 / 标题 / 提示语。
 * @throws {AppError} 未连接云端、图片链接不合法或没有管理员权限。
 */
export async function savePaymentQrConfig(cfg: PaymentQrConfig): Promise<void> {
  const imageUrl = cfg.imageUrl.trim();
  const title = cfg.title.trim();
  const notice = cfg.notice.trim();

  // 允许「清空」以便暂时下线收款码，但填了就必须是 https 链接。
  if (imageUrl.length > 0 && !/^https:\/\//i.test(imageUrl)) {
    throw new AppError('VALIDATE_FAILED', '图片链接必须以 https:// 开头（http 图片会被浏览器拦截）');
  }
  if (title.length > 30) {
    throw new AppError('VALIDATE_FAILED', '标题最多 30 个字');
  }
  if (notice.length > 200) {
    throw new AppError('VALIDATE_FAILED', '提示语最多 200 个字');
  }

  if (isMockMode()) {
    writeMockConfig({ imageUrl, title: title || DEFAULT_PAYMENT_QR.title, notice });
    return;
  }

  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务，无法保存配置');

  const value: Json = { imageUrl, title: title || DEFAULT_PAYMENT_QR.title, notice };
  const { error } = await sb.rpc('admin_set_system_config', { p_key: 'payment_qr', p_value: value });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
}
