import { AppError } from '../http/errors';
import type { AuthPayload, AuthProvider, AuthResult } from './types';

/**
 * 微信扫码登录（**P0 不启用，预留接入点**）。
 *
 * 为什么不做（PRD Q2）：需要企业主体公众号 / 开放平台认证（≈300 元/年），
 * 个人主体无法使用。
 *
 * 如何启用：
 * 1. 在 Supabase Auth 后台配置 WeChat OAuth（需企业主体的 AppID/AppSecret）；
 * 2. 把 `system_config.auth.providers` 加上 `"wechat"`；
 * 3. 把下面两个方法替换为 `sb.auth.signInWithOAuth({ provider: 'wechat' })`
 *    与 code 换 session 的真实实现即可。
 */
export const wechatProvider: AuthProvider = {
  id: 'wechat',
  label: '微信扫码登录',
  enabled: false,

  async signIn(_payload: AuthPayload): Promise<AuthResult> {
    throw new AppError('NOT_ENABLED', '微信登录暂未启用，请先用邮箱 + 密码登录');
  },

  async signUp(_payload: AuthPayload): Promise<AuthResult> {
    throw new AppError('NOT_ENABLED', '微信登录暂未启用，请先用邮箱 + 邀请码注册');
  },
};
