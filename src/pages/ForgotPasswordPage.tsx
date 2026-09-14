import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { ROUTES } from '@/config/routes';
import * as authService from '@/services/authService';

/**
 * 找回密码页（公开路由 `/forgot`）。
 *
 * 流程（与注册验证码同源，安全由「邮箱持有」保证）：
 * 1. 输入注册邮箱 → 点「获取验证码」→ 调 `requestEmailCode`（复用注册发码，
 *    同一张 `email_verifications` 表、同一套限流与哈希）；
 * 2. 邮箱收到 6 位码 → 填入「验证码」+「新密码」+「确认新密码」；
 * 3. 点「确认修改」→ 调 `resetPasswordWithCode` → 服务端独立校验码、改密、消费码；
 * 4. 成功 → 提示「密码已重置」→ 跳登录页用新密码登录。
 *
 * 全程不离开本页、不点邮件链接，比 Supabase 邮件链接式更顺手。
 * 本页**不包 RequireAuth**——此时用户未登录，拦了就永远改不了密码。
 */

/** 页面状态：填邮箱发码 / 填码改密。 */
type ForgotStep = 'email' | 'reset';

/** 成功提示停留时长（毫秒），让教师看清「密码已重置」再跳走。 */
const REDIRECT_DELAY_MS = 1800;

export function ForgotPasswordPage(): JSX.Element {
  const navigate = useNavigate();

  const [step, setStep] = useState<ForgotStep>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [succeeded, setSucceeded] = useState(false);
  const [devCode, setDevCode] = useState('');
  const cooldownRef = useRef<number | null>(null);
  const redirectTimerRef = useRef<number | null>(null);

  // 卸载时清掉尚未触发的定时器
  useEffect(
    () => () => {
      if (cooldownRef.current !== null) {
        window.clearInterval(cooldownRef.current);
        cooldownRef.current = null;
      }
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    },
    [],
  );

  const startCooldown = (): void => {
    if (cooldownRef.current !== null) {
      window.clearInterval(cooldownRef.current);
      cooldownRef.current = null;
    }
    setCooldownSec(60);
    cooldownRef.current = window.setInterval(() => {
      setCooldownSec((s) => {
        if (s <= 1) {
          if (cooldownRef.current !== null) {
            window.clearInterval(cooldownRef.current);
            cooldownRef.current = null;
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  /** 发验证码：复用注册发码接口（同一张表、同一套限流）。 */
  const sendCode = async (): Promise<void> => {
    setError('');
    setDevCode('');
    if (!email.trim()) {
      setError('请先填写邮箱');
      return;
    }
    setSending(true);
    try {
      const r = await authService.requestEmailCode(email);
      setEmailSent(true);
      if (r.dev && r.devCode) setDevCode(r.devCode);
      startCooldown();
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败，请重试');
    } finally {
      setSending(false);
    }
  };

  /** 校验码 + 改密。 */
  const submitReset = async (): Promise<void> => {
    setError('');
    if (!code.trim()) {
      setError('请填写验证码');
      return;
    }
    if (password.length < 8) {
      setError('新密码至少 8 位，方便的话用「学科+手机号后 6 位」');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致，请重新输入');
      return;
    }

    setSubmitting(true);
    try {
      await authService.resetPasswordWithCode(email.trim(), code, password);
      setSucceeded(true);
      setCode('');
      setPassword('');
      setConfirmPassword('');
      redirectTimerRef.current = window.setTimeout(() => {
        redirectTimerRef.current = null;
        navigate(ROUTES.LOGIN, { replace: true });
      }, REDIRECT_DELAY_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码重置失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  /** 返回登录页。 */
  const goLogin = (): void => {
    navigate(ROUTES.LOGIN, { replace: true });
  };

  const busy = sending || submitting;

  return (
    <Box sx={{ py: { xs: 3, sm: 6 }, maxWidth: 420, mx: 'auto' }}>
      <Stack spacing={1} alignItems="center" textAlign="center">
        <Typography sx={{ fontSize: { xs: 24, sm: 28 }, fontWeight: 800 }}>找回密码</Typography>
        <Typography sx={{ fontSize: 15, color: 'text.secondary', lineHeight: 1.7 }}>
          用注册邮箱接收验证码，验证通过后即可设置新密码。
        </Typography>
      </Stack>

      <Box sx={{ mt: 3 }}>
        {step === 'email' ? (
          <Stack
            spacing={1.75}
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (emailSent) {
                setStep('reset');
              } else {
                void sendCode();
              }
            }}
          >
            {error ? <Alert severity="error">{error}</Alert> : null}

            <TextField
              label="注册邮箱"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teacher@school.com"
              disabled={emailSent}
              inputProps={{ 'aria-label': '注册邮箱', autoComplete: 'email' }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
            />

            {!emailSent ? (
              <Button
                type="submit"
                variant="outlined"
                size="large"
                disabled={sending || cooldownSec > 0}
                sx={{ minHeight: 50 }}
              >
                {sending ? '请稍候…' : cooldownSec > 0 ? `重新获取（${cooldownSec}s）` : '获取验证码'}
              </Button>
            ) : (
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={busy}
                sx={{ minHeight: 50, mt: 0.5 }}
              >
                下一步
              </Button>
            )}

            <Box sx={{ textAlign: 'center' }}>
              <Button
                variant="text"
                size="large"
                type="button"
                onClick={goLogin}
                sx={{ minHeight: 44, color: 'text.secondary' }}
              >
                返回登录
              </Button>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={1.75} component="form" onSubmit={(e) => { e.preventDefault(); void submitReset(); }}>
            {succeeded ? <Alert severity="success">密码已重置，正在跳转到登录页…</Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}

            {devCode ? (
              <Alert severity="info">验证码：{devCode}（演示环境直接显示，无需查收邮件）</Alert>
            ) : null}

            <TextField
              label="6 位验证码"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="查收邮件获取验证码"
              disabled={succeeded}
              inputProps={{ 'aria-label': '验证码', inputMode: 'numeric', maxLength: 6 }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
            />
            <TextField
              label="新密码"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
              disabled={succeeded}
              inputProps={{ 'aria-label': '新密码', autoComplete: 'new-password' }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
            />
            <TextField
              label="确认新密码"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="请再输入一次"
              disabled={succeeded}
              inputProps={{ 'aria-label': '确认新密码', autoComplete: 'new-password' }}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting || succeeded}
              sx={{ minHeight: 50, mt: 0.5 }}
            >
              {submitting ? '提交中…' : '确认修改'}
            </Button>

            <Box sx={{ textAlign: 'center' }}>
              <Button
                variant="text"
                size="large"
                type="button"
                onClick={goLogin}
                sx={{ minHeight: 44, color: 'text.secondary' }}
              >
                返回登录
              </Button>
            </Box>
          </Stack>
        )}
      </Box>
    </Box>
  );
}

export default ForgotPasswordPage;
