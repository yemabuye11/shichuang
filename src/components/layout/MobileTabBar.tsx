import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import AppsOutlinedIcon from '@mui/icons-material/AppsOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@/config/routes';

/**
 * 移动端底部 TabBar（≥48px 触控高度 + 安全区适配）。
 *
 * 只在 <600px 显示；桌面由 `TopNav` 承担导航。
 *
 * 登录后 `/` 已经是制作页（见 `router.tsx` 的 HomeOrGenerate），因此：
 * - 隐藏「生成」tab，避免和「制作」入口重复打架；
 * - 首个 tab 文案由「首页」改为「制作」，避免误导（它的 value 仍是 `ROUTES.HOME`，
 *   不改动路由常量与指向）。
 * 未登录时保持原样（显示「首页」→ 营销首页 + 「生成」tab）。
 */
export function MobileTabBar(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const isLoggedIn = user !== null;
  const path = location.pathname;
  // 登录后「生成」tab 已隐藏，此时 /generate 与 / 都归到「制作」tab 高亮，
  // 避免出现「没有任何 tab 被选中」的空档。
  const value =
    path.startsWith(ROUTES.SQUARE) || path.startsWith(ROUTES.APP_RUN)
      ? ROUTES.SQUARE
      : path.startsWith('/me')
        ? ROUTES.ME
        : !isLoggedIn && path.startsWith(ROUTES.GENERATE)
          ? ROUTES.GENERATE
          : ROUTES.HOME;

  return (
    <Paper
      component="nav"
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        display: { xs: 'block', sm: 'none' },
        borderTop: '1px solid',
        borderColor: 'divider',
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      <BottomNavigation
        value={value}
        showLabels
        onChange={(_event, next: string) => navigate(next)}
        sx={{ height: 60, '& .MuiBottomNavigationAction-root': { minWidth: 64, minHeight: 56 } }}
      >
        <BottomNavigationAction
          value={ROUTES.HOME}
          label={isLoggedIn ? '制作' : '首页'}
          icon={<HomeOutlinedIcon />}
          aria-label={isLoggedIn ? '制作' : '首页'}
        />
        {/* 已登录时 `/` 已是制作页，隐藏此入口避免重复 */}
        {isLoggedIn ? null : (
          <BottomNavigationAction
            value={ROUTES.GENERATE}
            label="生成"
            icon={<AutoAwesomeOutlinedIcon />}
            aria-label="生成应用"
          />
        )}
        <BottomNavigationAction
          value={ROUTES.SQUARE}
          label="广场"
          icon={<AppsOutlinedIcon />}
          aria-label="应用广场"
        />
        <BottomNavigationAction
          value={ROUTES.ME}
          label="我的"
          icon={<PersonOutlineIcon />}
          aria-label="我的"
        />
      </BottomNavigation>
    </Paper>
  );
}

export default MobileTabBar;
