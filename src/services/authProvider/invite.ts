import { getSupabase } from '../supabaseClient';
import { AppError } from '../http/errors';
import { isMockMode } from '@/config/env';
import * as mockStore from '../mock/mockStore';
import type { AuthPayload, AuthProvider, AuthResult, PasswordSignUpPayload } from './types';

/**
 * 邀请码注册（学校统一发号，零成本、校内推广友好）。
 *
 * 说明：邀请码不是独立的登录方式，而是**注册时的必填凭证**——
 * 真正的校验发生在服务端 `handle_new_user()` 触发器里（行锁 + 状态校验），
 * 前端只负责收集与透传。邀请码可携带赠送额度（`redemption_codes.credits`）。
 */
export const inviteProvider: AuthProvider = {
  id: 'invite',
  label: '邀请码注册',
  enabled: true,

  async signIn(): Promise<AuthResult> {
    throw new AppError('NOT_ENABLED', '邀请码用于注册，请直接登录或用邮箱注册');
  },

  async signUp(payload: AuthPayload): Promise<AuthResult> {
    const p = payload as PasswordSignUpPayload;
    const code = (p.inviteCode ?? '').trim().toUpperCase();
    if (code.length === 0) {
      throw new AppError('INVITE_REQUIRED', '请填写邀请码');
    }
    if (!p.email || !p.password) {
      throw new AppError('VALIDATE_FAILED', '请输入邮箱和密码');
    }

    if (isMockMode()) {
      await mockStore.load();
      mockStore.signUpLocal(p.nickname || p.email.split('@')[0] || '演示老师');
      const profile = mockStore.current().profile;
      return { userId: profile?.id ?? 'mock-user', email: p.email, nickname: profile?.nickname };
    }

    const sb = getSupabase();
    if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');

    const { data, error } = await sb.auth.signUp({
      email: p.email.trim(),
      password: p.password,
      options: {
        data: {
          nickname: p.nickname || p.email.split('@')[0] || '老师',
          invite_code: code,
          subject: p.subject ?? '',
          grade: p.grade ?? '',
          school: p.school ?? '',
        },
      },
    });

    if (error) {
      const raw = error.message ?? '';
      if (raw.includes('邀请码') || raw.includes('注册需要')) {
        throw new AppError('INVITE_INVALID', raw, error);
      }
      throw new AppError('VALIDATE_FAILED', raw, error);
    }
    if (!data.user) throw new AppError('VALIDATE_FAILED', '注册失败，请重试');
    return { userId: data.user.id, email: data.user.email ?? p.email, nickname: p.nickname };
  },
};
