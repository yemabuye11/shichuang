import { useMemo } from 'react';
import { AppBar, Box, Button, IconButton, Stack, Toolbar, Tooltip } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@/config/routes';
import { CreditBadge } from '@/components/common/CreditBadge';
import type { BrandConfig } from '@/config/brand';

/**
 * 桌面 / 平板顶部导航。
 *
 * 结构：Logo + 平台名 | 生成 / 应用广场 / 我的 | 积分 + 头像（未登录显示「登录」）。
 * 移动端（<600px）隐藏中间导航，改由 `MobileTabBar` 承担。
 */

export interface TopNavProps {
  /** 品牌配置（由 AppShell 传入，避免重复读取）。 */
  brand: BrandConfig;
  /** 打开移动端抽屉。 */
  onOpenMenu?: () => void;
}

interface NavItem {
  label: string;
  to: string;
  match: (pathname: string) => boolean;
}

export function TopNav({ brand, onOpenMenu }: TopNavProps): JSX.Element {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const items = useMemo<NavItem[]>(
    () => [
      { label: '生成', to: ROUTES.GENERATE, match: (p) => p.startsWith(ROUTES.GENERATE) },
      { label: '应用广场', to: ROUTES.SQUARE, match: (p) => p.startsWith(ROUTES.SQUARE) },
      { label: '我的', to: ROUTES.ME, match: (p) => p.startsWith('/me') },
    ],
    [],
  );

  return (
    <AppBar
      position="sticky"
      color="inherit"
      elevation={0}
      sx={{
        borderBottom: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'rgba(255,255,255,0.92)',
        backdropFilter: 'saturate(180%) blur(8px)',
      }}
    >
      <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, gap: 1 }}>
        {onOpenMenu ? (
          <IconButton
            edge="start"
            aria-label="打开菜单"
            onClick={onOpenMenu}
            sx={{ display: { xs: 'inline-flex', md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
        ) : null}

        <Stack
          component={RouterLink}
          to={ROUTES.HOME}
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ color: 'text.primary', flexShrink: 0 }}
        >
          <Box
            component="img"
            src={brand.logoUrl}
            alt=""
            sx={{ width: 28, height: 28, borderRadius: 1.5 }}
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <Box component="span" sx={{ fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap' }}>
            {brand.name}
          </Box>
        </Stack>

        <Stack
          direction="row"
          spacing={0.5}
          sx={{ display: { xs: 'none', md: 'flex' }, ml: 2, flex: 1 }}
        >
          {items.map((item) => {
            const active = item.match(location.pathname);
            return (
              <Button
                key={item.to}
                component={RouterLink}
                to={item.to}
                color={active ? 'primary' : 'inherit'}
                sx={{
                  minHeight: 44,
                  fontWeight: active ? 700 : 500,
                  borderRadius: 2,
                  px: 2,
                }}
              >
                {item.label}
              </Button>
            );
          })}
        </Stack>

        <Box sx={{ flex: 1, display: { xs: 'block', md: 'none' } }} />

        <Stack direction="row" alignItems="center" spacing={1}>
          {user ? (
            <>
              <CreditBadge balance={user.account.balance} onClick={() => navigate(ROUTES.ME)} />
              <Tooltip title="做新应用">
                <IconButton
                  component={RouterLink}
                  to={ROUTES.GENERATE}
                  aria-label="做新应用"
                  sx={{ display: { xs: 'inline-flex', md: 'none' } }}
                >
                  <AutoAwesomeIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={user.profile.nickname}>
                <IconButton
                  component={RouterLink}
                  to={ROUTES.ME}
                  aria-label="个人中心"
                  sx={{ bgcolor: 'primary.main', color: '#fff', '&:hover': { bgcolor: 'primary.dark' } }}
                >
                  <Box component="span" sx={{ fontSize: 15, fontWeight: 700 }}>
                    {user.profile.nickname.slice(0, 1)}
                  </Box>
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <Button
              variant="contained"
              size="small"
              onClick={() => navigate(ROUTES.LOGIN)}
              sx={{ minHeight: 40, px: 2.5 }}
            >
              登录 / 注册
            </Button>
          )}
        </Stack>
      </Toolbar>
    </AppBar>
  );
}

export default TopNav;
