import { useEffect, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PasswordForm } from '@/components/auth/PasswordForm';
import { InviteCodeForm } from '@/components/auth/InviteCodeForm';
import { PhoneForm } from '@/components/auth/PhoneForm';
import { useAuth } from '@/hooks/useAuth';
import { BRAND } from '@/config/brand';
import { ROUTES } from '@/config/routes';
import * as authService from '@/services/authService';
import { isMockMode } from '@/config/env';
import { REGISTER_GIFT } from '@/config/creditRules';
import type { AuthProviderId } from '@/services/authProvider/types';

/**
 * 登录页（`?redirect=` 登录后回跳）。
 *
 * Tab 由 `system_config.auth.providers` 决定，P0 为「邮箱 + 密码」与「邀请码注册」。
 */
export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, refresh, brand } = useAuth();

  const [providers, setProviders] = useState<string[]>(['password', 'invite']);
  const [active, setActive] = useState<AuthProviderId>('password');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  const redirect = params.get('redirect') ?? ROUTES.ME;

  useEffect(() => {
    void (async () => {
      try {
        const enabled = (await authService.getEnabledProviders()).map((p) => p.id);
        const list = enabled.length > 0 ? enabled : ['password'];
        setProviders(list);
        setActive(list[0] as AuthProviderId);
      } catch {
        setProviders(['password']);
      }
    })();
  }, []);

  // 已登录 → 直接回跳
  useEffect(() => {
    if (user) navigate(redirect, { replace: true });
  }, [user, redirect, navigate]);

  const handleSuccess = async (): Promise<void> => {
    await refresh();
    navigate(redirect, { replace: true });
  };

  const tabs = (
    [
      { id: 'password', label: '邮箱 + 密码' },
      { id: 'invite', label: '邀请码注册' },
      { id: 'phone', label: '手机号' },
    ] as { id: AuthProviderId; label: string }[]
  ).filter((t) => providers.includes(t.id));

  return (
    <Box sx={{ py: { xs: 3, sm: 6 }, maxWidth: 420, mx: 'auto' }}>
      <Stack spacing={1} alignItems="center" textAlign="center">
        <Typography sx={{ fontSize: { xs: 24, sm: 28 }, fontWeight: 800 }}>登录 {brand.name}</Typography>
        <Typography sx={{ fontSize: 15, color: 'text.secondary', lineHeight: 1.7 }}>
          登录后才能生成应用；浏览应用广场不需要登录。
        </Typography>
      </Stack>

      {isMockMode() ? (
        <Box
          sx={{
            mt: 2.5,
            borderRadius: 2.5,
            bgcolor: 'rgba(47,107,255,0.06)',
            border: '1px solid rgba(47,107,255,0.16)',
            p: 2,
          }}
        >
          <Typography sx={{ fontSize: 14, color: 'text.secondary', lineHeight: 1.8 }}>
            演示模式下随便填一个邮箱和密码即可注册（密码至少 8 位），
            注册后会赠送 <Box component="span" sx={{ fontWeight: 700, color: 'primary.main' }}>{REGISTER_GIFT} 积分</Box>
            ，方便你把生成流程完整走一遍。
          </Typography>
        </Box>
      ) : null}

      {tabs.length > 1 ? (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ mt: 3, bgcolor: 'rgba(27,31,39,0.04)', p: 0.5, borderRadius: 2.5 }}
        >
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

      <Box sx={{ mt: 2.5 }}>
        {active === 'password' ? (
          <PasswordForm mode={mode} onModeChange={setMode} onSuccess={() => void handleSuccess()} />
        ) : null}
        {active === 'invite' ? (
          <InviteCodeForm
            onSuccess={() => void handleSuccess()}
            onSwitch={() => setActive('password')}
          />
        ) : null}
        {active === 'phone' ? <PhoneForm onSwitch={() => setActive('password')} /> : null}
      </Box>

      <Box sx={{ mt: 3, textAlign: 'center' }}>
        <Button
          variant="text"
          size="large"
          onClick={() => navigate(ROUTES.HOME)}
          sx={{ minHeight: 44, color: 'text.secondary' }}
        >
          先随便看看
        </Button>
        <Typography sx={{ fontSize: 12.5, color: 'text.disabled', mt: 1, lineHeight: 1.7 }}>
          {BRAND.name} · {brand.slogan}
        </Typography>
      </Box>
    </Box>
  );
}

export default LoginPage;
