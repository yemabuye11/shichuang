import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { PasswordForm } from './PasswordForm';
import { PhoneForm } from './PhoneForm';
import * as authService from '@/services/authService';
import { BRAND } from '@/config/brand';
import type { AuthProviderId } from '@/services/authProvider/types';

/**
 * 登录 / 注册弹窗。
 *
 * Tab 由 `system_config.auth.providers` 决定（ARCHITECTURE.md §3.6 Q2）：
 * 改配置即可增减登录方式，**不需要改这里的结构**。P0 仅「邮箱 + 密码」
 * （注册走邮箱验证码两步校验），不再展示邀请码。
 */
export interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  /** 登录 / 注册成功。 */
  onSuccess: () => void;
  /** 默认 tab。 */
  defaultProvider?: AuthProviderId;
}

export function AuthDialog({ open, onClose, onSuccess, defaultProvider }: AuthDialogProps): JSX.Element {
  const [providers, setProviders] = useState<string[]>(['password']);
  const [active, setActive] = useState<AuthProviderId>(defaultProvider ?? 'password');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const enabled = (await authService.getEnabledProviders()).map((p) => p.id);
        const list = enabled.length > 0 ? enabled : ['password'];
        setProviders(list);
        setActive((prev) => (list.includes(prev) ? prev : (list[0] as AuthProviderId)));
      } catch {
        setProviders(['password']);
      }
    })();
  }, [open]);

  const handleSuccess = (): void => {
    onSuccess();
    onClose();
  };

  const tabs = (
    [
      { id: 'password', label: '邮箱 + 密码' },
      { id: 'phone', label: '手机号' },
    ] as { id: AuthProviderId; label: string }[]
  ).filter((t) => providers.includes(t.id));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
        登录 {BRAND.name}
        <IconButton aria-label="关闭" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2}>
          <Typography sx={{ fontSize: 14, color: 'text.secondary', lineHeight: 1.7 }}>
            登录后才能生成应用；浏览应用广场不需要登录。
          </Typography>

          {tabs.length > 1 ? (
            <Stack direction="row" spacing={0.5} sx={{ bgcolor: 'rgba(27,31,39,0.04)', p: 0.5, borderRadius: 2.5 }}>
              {tabs.map((t) => {
                const selected = t.id === active;
                return (
                  <Box
                    key={t.id}
                    component="button"
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActive(t.id)}
                    sx={{
                      flex: 1,
                      minHeight: 44,
                      border: 0,
                      borderRadius: 2,
                      bgcolor: selected ? '#fff' : 'transparent',
                      color: selected ? 'primary.main' : 'text.secondary',
                      fontSize: 14.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: selected ? '0 1px 4px rgba(27,31,39,0.08)' : 'none',
                    }}
                  >
                    {t.label}
                  </Box>
                );
              })}
            </Stack>
          ) : null}

          {active === 'password' ? (
            <PasswordForm
              mode={mode}
              onModeChange={setMode}
              onSuccess={handleSuccess}
            />
          ) : null}

          {active === 'phone' ? <PhoneForm onSwitch={() => setActive('password')} /> : null}

          <Button
            variant="text"
            size="large"
            onClick={() => {
              onClose();
            }}
            sx={{ minHeight: 44, color: 'text.secondary' }}
          >
            先随便看看
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

export default AuthDialog;
