import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { ROUTES } from '@/config/routes';
import * as authService from '@/services/authService';

/**
 * 重置密码页（公开路由 `/reset`）。
 *
 * 教师点击邮件里的重置链接后落到本页。链接有两种形态，都必须兼容：
 * - PKCE：`?code=xxx` → 需 `exchangeCodeForSession()`（服务层已处理）；
 * - Hash：`#access_token=xxx&type=recovery` → Supabase 客户端自动解析（服务层已处理）。
 *
 * 拿到会话才允许改密码；拿不到就提示链接失效并给「返回登录」出口。
 * 本页**不包 RequireAuth**——此时用户是未登录的恢复态，拦了就永远改不了密码。
 */

/** 页面状态：校验链接中 / 可设置新密码 / 链接失效。 */
type ResetStatus = 'checking' | 'ready' | 'invalid';

/** 成功提示停留时长（毫秒），让教师看清「密码已重置」再跳走。 */
const REDIRECT_DELAY_MS = 1800;

export function ResetPasswordPage(): JSX.Element {
  const navigate = useNavigate();

  const [status, setStatus] = useState<ResetStatus>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [succeeded, setSucceeded] = useState(false);
  const redirectTimerRef = useRef<number | null>(null);

  // 挂载时检测恢复会话（只跑一次）
  useEffect(() => {
    let alive = true;
    void (async () => {
      const ok = await authService.restoreRecoverySession();
      if (!alive) return;
      setStatus(ok ? 'ready' : 'invalid');
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 卸载时清掉尚未触发的跳转定时器，避免对已卸载组件继续操作
  useEffect(
    () => () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    },
    [],
  );

  /** 提交新密码。 */
  const submitNewPassword = async (): Promise<void> => {
    setError('');
    if (password.length < 8) {
      setError('密码至少 8 位，方便的话用「学科+手机号后 6 位」');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致，请重新输入');
      return;
    }

    setSubmitting(true);
    try {
      await authService.updatePassword(password);
      setSucceeded(true);
      setPassword('');
      setConfirmPassword('');
      redirectTimerRef.current = window.setTimeout(() => {
        redirectTimerRef.current = null;
        navigate(ROUTES.LOGIN, { replace: true });
      }, REDIRECT_DELAY_MS);
    } catch (err) {
      const message = err instanceof Error ? err.message : '密码修改失败，请稍后重试';
      if (/失效|过期/.test(message)) {
        // 会话已不可用 → 切到失效视图（它自带文案，不用再重复弹错误条）
        setError('');
        setStatus('invalid');
        return;
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  /** 返回登录页。 */
  const goLogin = (): void => {
    navigate(ROUTES.LOGIN, { replace: true });
  };

  return (
    <Box sx={{ py: { xs: 3, sm: 6 }, maxWidth: 420, mx: 'auto' }}>
      <Stack spacing={1} alignItems="center" textAlign="center">
        <Typography sx={{ fontSize: { xs: 24, sm: 28 }, fontWeight: 800 }}>设置新密码</Typography>
        <Typography sx={{ fontSize: 15, color: 'text.secondary', lineHeight: 1.7 }}>
          请输入新的登录密码，设置完成后即可用它登录。
        </Typography>
      </Stack>

      <Box sx={{ mt: 3 }}>
        {status === 'checking' ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
            <InlineLoading />
          </Box>
        ) : null}

        {status === 'invalid' ? (
          <Stack spacing={2}>
            <Alert severity="warning">重置链接已失效或已过期，请重新申请。</Alert>
            <Button
              variant="contained"
              size="large"
              onClick={goLogin}
              sx={{ minHeight: 50 }}
            >
              返回登录
            </Button>
          </Stack>
        ) : null}

        {status === 'ready' ? (
          <Stack
            spacing={1.75}
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitNewPassword();
            }}
          >
            {succeeded ? <Alert severity="success">密码已重置，正在跳转到登录页…</Alert> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}

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
        ) : null}
      </Box>
    </Box>
  );
}

export default ResetPasswordPage;
