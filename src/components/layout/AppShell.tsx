import { useState, type ReactNode } from 'react';
import { Box, Container, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Stack } from '@mui/material';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import AppsOutlinedIcon from '@mui/icons-material/AppsOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LibraryBooksOutlinedIcon from '@mui/icons-material/LibraryBooksOutlined';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { TopNav } from './TopNav';
import { MobileTabBar } from './MobileTabBar';
import { Footer } from './Footer';
import { DemoBanner } from '@/components/common/DemoBanner';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@/config/routes';

/**
 * 响应式外壳：顶部导航（桌面/平板）+ 底部 TabBar（手机）。
 *
 * 移动端优先：正文容器左右留白随断点变化，底部为 TabBar 预留安全区。
 */
export function AppShell({ children }: { children?: ReactNode }): JSX.Element {
  const { brand, user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const entries = [
    { label: '首页', to: ROUTES.HOME, icon: <HomeOutlinedIcon /> },
    { label: '生成应用', to: ROUTES.GENERATE, icon: <AutoAwesomeOutlinedIcon /> },
    { label: '应用广场', to: ROUTES.SQUARE, icon: <AppsOutlinedIcon /> },
    { label: '内容库', to: ROUTES.LIBRARY, icon: <LibraryBooksOutlinedIcon /> },
    { label: '我的', to: ROUTES.ME, icon: <PersonOutlineIcon /> },
    { label: '上传优秀案例', to: ROUTES.RESOURCE_UPLOAD, icon: <UploadFileIcon /> },
    ...(isAdmin
      ? [
          { label: '管理员后台', to: ROUTES.ADMIN, icon: <AdminPanelSettingsIcon /> },
          { label: '审核资源', to: ROUTES.ADMIN_RESOURCES, icon: <AdminPanelSettingsIcon /> },
        ]
      : []),
  ];

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <TopNav brand={brand} onOpenMenu={() => setMenuOpen(true)} />

      {/* 演示模式提示条（未连接服务器时醒目展示） */}
      <DemoBanner />

      <Drawer anchor="left" open={menuOpen} onClose={() => setMenuOpen(false)}>
        <Box sx={{ width: 260, pt: 2 }} role="presentation">
          <Stack sx={{ px: 2, pb: 1 }}>
            <Box component="span" sx={{ fontWeight: 700, fontSize: 18 }}>
              {brand.name}
            </Box>
            <Box component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>
              {brand.slogan}
            </Box>
          </Stack>
          <List>
            {entries.map((entry) => (
              <ListItemButton
                key={entry.to}
                selected={location.pathname === entry.to}
                onClick={() => {
                  setMenuOpen(false);
                  navigate(entry.to);
                }}
              >
                <ListItemIcon>{entry.icon}</ListItemIcon>
                <ListItemText primary={entry.label} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>

      <Box component="main" sx={{ flex: 1 }}>
        {/* 底部为移动端 TabBar 预留安全区，避免内容被遮住 */}
        <Container maxWidth="lg" sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 10, sm: 4 } }}>
          {children ?? <Outlet />}
        </Container>
      </Box>

      <Footer />
      <MobileTabBar />
    </Box>
  );
}

export default AppShell;
