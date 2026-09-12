import { useState } from 'react';
import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import * as authService from '@/services/authService';

/**
 * 邮箱 + 密码登录 / 注册表单（P0 默认登录方式）。
 *
 * 注册时必填邀请码（走 `handle_new_user()` 触发器校验，零成本防薅）。
 */
export interface PasswordFormProps {
  /** `signin` 登录 / `signup` 注册。 */
  mode: 'signin' | 'signup';
  onModeChange: (mode: 'signin' | 'signup') => void;
  /** 成功回调。 */
  onSuccess: () => void;
  /** 是否要求邀请码（来自 `system_config.auth.requireInviteCode`）。 */
  requireInviteCode?: boolean;
}

interface FormState {
  email: string;
  password: string;
  nickname: string;
  inviteCode: string;
}

const EMPTY: FormState = { email: '', password: '', nickname: '', inviteCode: '' };

export function PasswordForm({
  mode,
  onModeChange,
  onSuccess,
  requireInviteCode = true,
}: PasswordFormProps): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isSignUp = mode === 'signup';

  const submit = async (): Promise<void> => {
    setError('');
    setSubmitting(true);
    try {
      if (isSignUp) {
        await authService.signUp('password', {
          email: form.email.trim(),
          password: form.password,
          nickname: form.nickname.trim(),
          inviteCode: form.inviteCode.trim(),
        });
      } else {
        await authService.signIn('password', {
          email: form.email.trim(),
          password: form.password,
        });
      }
      setForm(EMPTY);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack spacing={1.75} component="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {error ? <Alert severity="error">{error}</Alert> : null}

      {isSignUp ? (
        <TextField
          label="昵称"
          value={form.nickname}
          onChange={(e) => setForm({ ...form, nickname: e.target.value })}
          placeholder="同学们怎么称呼你"
          inputProps={{ 'aria-label': '昵称', maxLength: 20 }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
        />
      ) : null}

      <TextField
        label="邮箱"
        type="email"
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        placeholder="teacher@school.com"
        inputProps={{ 'aria-label': '邮箱', autoComplete: 'email' }}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
      />

      <TextField
        label="密码"
        type="password"
        value={form.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        placeholder={isSignUp ? '至少 8 位' : '请输入密码'}
        inputProps={{ 'aria-label': '密码', autoComplete: isSignUp ? 'new-password' : 'current-password' }}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
      />

      {isSignUp && requireInviteCode ? (
        <TextField
          label="邀请码"
          value={form.inviteCode}
          onChange={(e) => setForm({ ...form, inviteCode: e.target.value.toUpperCase() })}
          placeholder="向管理员索取"
          inputProps={{ 'aria-label': '邀请码', maxLength: 20 }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 }, '& input': { textTransform: 'uppercase' } }}
        />
      ) : null}

      <Button type="submit" variant="contained" size="large" disabled={submitting} sx={{ minHeight: 50, mt: 0.5 }}>
        {submitting ? '请稍候…' : isSignUp ? '注册并登录' : '登录'}
      </Button>

      <Box sx={{ textAlign: 'center' }}>
        <Button
          variant="text"
          size="large"
          onClick={() => {
            setError('');
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
