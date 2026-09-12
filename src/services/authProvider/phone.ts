import { AppError } from '../http/errors';
import type { AuthPayload, AuthProvider, AuthResult } from './types';

/**
 * 手机号 + 短信验证码登录（**P0 不启用，预留接入点**）。
 *
 * 为什么不做（PRD Q2）：需接国内短信服务商（阿里云/腾讯云），
 * 需要**企业主体 + 签名报备**，且有持续成本（¥0.03–0.05/条）。
 *
 * 如何启用（改动很小）：
 * 1. 在 Supabase Auth 后台启用 Phone Provider 并填入短信服务商配置；
 * 2. 把 `system_config.auth.providers` 加上 `"phone"`；
 * 3. 把下面两个方法替换为 `sb.auth.signInWithOtp({ phone })` /
 *    `sb.auth.verifyOtp({ phone, token, type: 'sms' })` 的真实实现即可。
 *
 * 保持「文件存在 + 接口齐全 + 明确抛错」的形态，是为了让后续接入
 * 不需要改动任何调用方代码。
 */
export const phoneProvider: AuthProvider = {
  id: 'phone',
  label: '手机号验证码',
  enabled: false,

  async signIn(_payload: AuthPayload): Promise<AuthResult> {
    throw new AppError('NOT_ENABLED', '手机号登录暂未启用，请先用邮箱 + 密码登录');
  },

  async signUp(_payload: AuthPayload): Promise<AuthResult> {
    throw new AppError('NOT_ENABLED', '手机号登录暂未启用，请先用邮箱 + 邀请码注册');
  },
};
