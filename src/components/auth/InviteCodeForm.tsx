import { useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import * as authService from '@/services/authService';

/**
 * 邀请码注册（P0 默认登录方式之二，校内推广友好）。
 *
 * 走 `authService.signUp('invite', …)`；邀请码的真实性由服务端
 * `handle_new_user()` 触发器校验，前端只负责收集与透传。
 */
export interface InviteCodeFormProps {
  onSuccess: () => void;
  /** 切换到「邮箱 + 密码」。 */
  onSwitch: () => void;
}

export function InviteCodeForm({ onSuccess, onSwitch }: InviteCodeFormProps): JSX.Element {
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    setError('');
    setSubmitting(true);
    try {
      await authService.signUp('invite', {
        nickname: nickname.trim(),
        email: email.trim(),
        password,
        inviteCode: inviteCode.trim(),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack spacing={1.75} component="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Box
        sx={{
          display: 'flex',
          gap: 1.25,
          borderRadius: 2.5,
          bgcolor: 'rgba(47,107,255,0.05)',
          p: 1.5,
          alignItems: 'flex-start',
        }}
      >
        <CardGiftcardIcon color="primary" sx={{ mt: '2px' }} aria-hidden="true" />
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary', lineHeight: 1.7 }}>
          邀请码由学校管理员统一发放，注册后会一起到账赠送积分。
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <TextField
        label="昵称"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        placeholder="例如 王老师"
        inputProps={{ 'aria-label': '昵称', maxLength: 20 }}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
      />
      <TextField
        label="邀请码"
        value={inviteCode}
        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
        placeholder="向管理员索取"
        inputProps={{ 'aria-label': '邀请码', maxLength: 20 }}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 }, '& input': { textTransform: 'uppercase' } }}
      />
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
        placeholder="至少 8 位"
        inputProps={{ 'aria-label': '密码', autoComplete: 'new-password' }}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
      />

      <Button type="submit" variant="contained" size="large" disabled={submitting} sx={{ minHeight: 50, mt: 0.5 }}>
        {submitting ? '请稍候…' : '用邀请码注册'}
      </Button>

      <Box sx={{ textAlign: 'center' }}>
        <Button variant="text" size="large" onClick={onSwitch} sx={{ minHeight: 44, color: 'text.secondary' }}>
          用邮箱 + 密码登录
        </Button>
      </Box>
    </Stack>
  );
}

export default InviteCodeForm;
