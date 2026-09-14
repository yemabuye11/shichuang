import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import * as authService from '@/services/authService';
import { ROUTES } from '@/config/routes';

/**
 * 邮箱 + 密码登录 / 注册表单（P0 默认登录方式）。
 *
 * 注册走「邮箱验证码」两步校验：先填邮箱 → 获取验证码 → 校验通过 →
 * 填写昵称与密码完成注册（前端把 `emailVerified` 意图传给后端触发器）。
 */
export interface PasswordFormProps {
  /** `signin` 登录 / `signup` 注册。 */
  mode: 'signin' | 'signup';
  onModeChange: (mode: 'signin' | 'signup') => void;
  /** 成功回调。 */
  onSuccess: () => void;
}

type SignUpStep = 'email' | 'register';

export function PasswordForm({
  mode,
  onModeChange,
  onSuccess,
}: PasswordFormProps): JSX.Element {
  const isSignUp = mode === 'signup';

  const [step, setStep] = useState<SignUpStep>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');

  const isSubmitting = sending || verifying;
  const cooldownRef = useRef<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    return () => {
      if (cooldownRef.current) {
        clearInterval(cooldownRef.current);
        cooldownRef.current = null;
      }
    };
  }, []);

  // 切到登录时重置两步状态，避免残留
  useEffect(() => {
    if (!isSignUp) {
      setStep('email');
      setEmailSent(false);
      setCode('');
      setDevCode('');
      setConfirmPassword('');
      setCooldownSec(0);
    }
  }, [isSignUp]);

  const startCooldown = (): void => {
    if (cooldownRef.current) {
      clearInterval(cooldownRef.current);
      cooldownRef.current = null;
    }
    setCooldownSec(60);
    cooldownRef.current = window.setInterval(() => {
      setCooldownSec((s) => {
        if (s <= 1) {
          if (cooldownRef.current) {
            clearInterval(cooldownRef.current);
            cooldownRef.current = null;
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

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
      setError(err instanceof Error ? err.message : '发送验证码失败，请重试');
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async (): Promise<void> => {
    setError('');
    if (!code.trim()) {
      setError('请填写验证码');
      return;
    }
    setVerifying(true);
    try {
      await authService.verifyEmailCode(email, code);
      setNickname((n) => n || email.split('@')[0] || '');
      setStep('register');
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码校验失败，请重试');
    } finally {
      setVerifying(false);
    }
  };

  const submitSignIn = async (): Promise<void> => {
    setError('');
    if (!email.trim() || !password) {
      setError('请输入邮箱和密码');
      return;
    }
    try {
      await authService.signIn('password', { email: email.trim(), password });
      setEmail('');
      setPassword('');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试');
    }
  };

  const submitSignUp = async (): Promise<void> => {
    setError('');
    if (password.length < 8) {
      setError('密码至少 8 位，方便的话用「学科+手机号后 6 位」');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    try {
      await authService.signUp('password', {
        email: email.trim(),
        password,
        nickname: nickname.trim() || email.split('@')[0] || '老师',
        emailVerified: true,
      });
      setEmail('');
      setCode('');
      setPassword('');
      setConfirmPassword('');
      setNickname('');
      setEmailSent(false);
      setStep('email');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请重试');
    }
  };

  // 统一由 form 的 submit 事件驱动（而不是给每个按钮挂 onClick），好处：
  //  1. 输入框里按「回车」也能走对应步骤（以前 onSubmit 只有 preventDefault，回车毫无反应，
  //     用户以为没成功，容易误以为"注册没跳到下一步"）；
  //  2. 点击与回车走同一条路径，不会重复触发。
  const handleSubmit = (): void => {
    if (!isSignUp) {
      void submitSignIn();
      return;
    }
    if (step === 'register') {
      void submitSignUp();
      return;
    }
    if (emailSent) {
      void verifyCode();
      return;
    }
    void sendCode();
  };

  return (
    <Stack
      spacing={1.75}
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      {error ? <Alert severity="error">{error}</Alert> : null}

      {isSignUp ? (
        <>
          {step === 'email' ? (
            <>
              <TextField
                label="邮箱"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teacher@school.com"
                inputProps={{ 'aria-label': '邮箱', autoComplete: 'email' }}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
              />
              <Button
                type="submit"
                variant="outlined"
                size="large"
                disabled={sending || cooldownSec > 0}
                sx={{ minHeight: 50 }}
              >
                {sending ? '请稍候…' : cooldownSec > 0 ? `重新获取（${cooldownSec}s）` : '获取验证码'}
              </Button>

              {emailSent ? (
                <>
                  {devCode ? (
                    <Alert severity="info">验证码：{devCode}（已直接显示，无需查收邮件）</Alert>
                  ) : null}
                  <TextField
                    label="6 位验证码"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="查收邮件获取验证码"
                    inputProps={{ 'aria-label': '验证码', inputMode: 'numeric', maxLength: 6 }}
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    size="large"
                    disabled={verifying}
                    sx={{ minHeight: 50 }}
                  >
                    {verifying ? '请稍候…' : '验证'}
                  </Button>
                </>
              ) : null}
            </>
          ) : (
            <>
              <Box sx={{ fontSize: 14, color: 'text.secondary', mb: -0.5 }}>
                验证码已通过，设置一个登录密码：
              </Box>
              <TextField
                label="昵称（选填）"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={email.split('@')[0] || '同学们怎么称呼你'}
                helperText="填个昵称，方便别人知道这是谁的资源（选填）"
                inputProps={{ 'aria-label': '昵称', maxLength: 20 }}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
              />
              <TextField
                label="密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位"
                inputProps={{ 'aria-label': '密码', autoComplete: 'new-password' }}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
              />
              <TextField
                label="确认密码"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再输入一次密码"
                inputProps={{ 'aria-label': '确认密码', autoComplete: 'new-password' }}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={isSubmitting}
                sx={{ minHeight: 50, mt: 0.5 }}
              >
                {isSubmitting ? '请稍候…' : '注册并登录'}
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <TextField
            label="邮箱"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teacher@school.com"
            inputProps={{ 'aria-label': '邮箱', autoComplete: 'email' }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          />
          <TextField
            label="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            inputProps={{ 'aria-label': '密码', autoComplete: 'current-password' }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          />
          <Box sx={{ textAlign: 'right' }}>
            <Button
              type="button"
              variant="text"
              size="small"
              onClick={() => navigate(ROUTES.FORGOT)}
              sx={{ minHeight: 36, color: 'text.secondary', fontSize: 13.5, textTransform: 'none' }}
            >
              忘记密码？
            </Button>
          </Box>

          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={isSubmitting}
            sx={{ minHeight: 50, mt: 0.5 }}
          >
            {isSubmitting ? '请稍候…' : '登录'}
          </Button>
        </>
      )}

      <Box sx={{ textAlign: 'center' }}>
        <Button
          variant="text"
          size="large"
          type="button"
          onClick={() => {
            setError('');
            setStep('email');
            setEmailSent(false);
            setCooldownSec(0);
            onModeChange(isSignUp ? 'signin' : 'signup');
          }}
          sx={{ minHeight: 44, color: 'text.secondary' }}
        >
          {isSignUp ? '已经有账号了，去登录' : '还没有账号，去注册'}
        </Button>
      </Box>
    </Stack>
  );
}

export default PasswordForm;
