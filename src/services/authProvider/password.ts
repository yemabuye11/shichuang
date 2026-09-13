import { getSupabase } from '../supabaseClient';
import { AppError } from '../http/errors';
import { isMockMode } from '@/config/env';
import * as mockStore from '../mock/mockStore';
import type { AuthPayload, AuthProvider, AuthResult, PasswordSignInPayload, PasswordSignUpPayload } from './types';

/**
 * 邮箱 + 密码登录（Supabase Auth 原生，零成本）。
 *
 * P0 说明：注册走「邮箱验证码」两步校验，注册所需的用户元数据
 * 通过 `options.data` 传给 `handle_new_user()` 触发器校验邮箱验证状态。
 */
export const passwordProvider: AuthProvider = {
  id: 'password',
  label: '邮箱 + 密码',
  enabled: true,

  async signIn(payload: AuthPayload): Promise<AuthResult> {
    const p = payload as PasswordSignInPayload;
    if (!p.email || !p.password) {
      throw new AppError('VALIDATE_FAILED', '请输入邮箱和密码');
    }

    if (isMockMode()) {
      await mockStore.load();
      if (!mockStore.isSignedIn()) {
        throw new AppError('UNAUTHORIZED', '演示模式下还没有账号，请先注册');
      }
      const profile = mockStore.current().profile;
      return { userId: profile?.id ?? 'mock-user', nickname: profile?.nickname };
    }

    const sb = getSupabase();
    if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');

    const { data, error } = await sb.auth.signInWithPassword({
      email: p.email.trim(),
      password: p.password,
    });
    if (error) throw new AppError('UNAUTHORIZED', '邮箱或密码不正确，请重试', error);
    if (!data.user) throw new AppError('UNAUTHORIZED', '登录失败，请重试');
    return { userId: data.user.id, email: data.user.email ?? p.email };
  },

  async signUp(payload: AuthPayload): Promise<AuthResult> {
    const p = payload as PasswordSignUpPayload;
    if (!p.email || !p.password) {
      throw new AppError('VALIDATE_FAILED', '请输入邮箱和密码');
    }
    if (p.password.length < 8) {
      throw new AppError('VALIDATE_FAILED', '密码至少 8 位，方便的话用「学科+手机号后 6 位」');
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
          email_verified: p.emailVerified === true,
          subject: p.subject ?? '',
          grade: p.grade ?? '',
          school: p.school ?? '',
        },
      },
    });

    if (error) {
      // 触发器的中文异常会原样透传，优先展示给教师
      const raw = error.message ?? '';
      if (raw.includes('邀请码') || raw.includes('注册需要')) {
        throw new AppError('INVITE_INVALID', raw, error);
      }
      if (raw.includes('邮箱验证') || raw.includes('请先完成邮箱验证')) {
        throw new AppError('INVITE_INVALID', raw, error);
      }
      if (raw.includes('already registered') || raw.includes('已注册')) {
        throw new AppError('VALIDATE_FAILED', '这个邮箱已经注册过了，直接登录试试', error);
      }
      throw new AppError('VALIDATE_FAILED', raw, error);
    }

    if (!data.user) throw new AppError('VALIDATE_FAILED', '注册失败，请重试');
    return { userId: data.user.id, email: data.user.email ?? p.email, nickname: p.nickname };
  },
};
