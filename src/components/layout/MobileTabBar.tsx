import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import AppsOutlinedIcon from '@mui/icons-material/AppsOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';

/**
 * 移动端底部 TabBar（≥48px 触控高度 + 安全区适配）。
 *
 * 只在 <600px 显示；桌面由 `TopNav` 承担导航。
 */
export function MobileTabBar(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  const path = location.pathname;
  const value =
    path.startsWith(ROUTES.SQUARE) || path.startsWith(ROUTES.APP_RUN)
      ? ROUTES.SQUARE
      : path.startsWith('/me')
        ? ROUTES.ME
        : path.startsWith(ROUTES.GENERATE)
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
          label="首页"
          icon={<HomeOutlinedIcon />}
          aria-label="首页"
        />
        <BottomNavigationAction
          value={ROUTES.GENERATE}
          label="生成"
          icon={<AutoAwesomeOutlinedIcon />}
          aria-label="生成应用"
        />
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
