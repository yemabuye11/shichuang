import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAuth } from '@/hooks/useAuth';
import { loginPath } from '@/config/routes';

/**
 * 登录守卫。
 *
 * - 未登录 → 跳 `/login?redirect=<当前路径>`；
 * - `requireAdmin` 为 true 且 `role !== 'admin'` → 跳首页（不暴露后台地址语义）。
 */
export interface RequireAuthProps {
  children: ReactNode;
  /** 是否要求管理员角色。 */
  requireAdmin?: boolean;
}

export function RequireAuth({ children, requireAdmin = false }: RequireAuthProps): JSX.Element {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50dvh' }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (!user) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={loginPath(redirect)} replace />;
  }

  if (requireAdmin && user.profile.role !== 'admin') {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <Typography variant="h6" gutterBottom>
          你没有访问这个页面的权限
        </Typography>
        <Typography variant="body2" color="text.secondary">
          如有需要，请联系平台管理员开通。
        </Typography>
      </Box>
    );
  }

  return <>{children}</>;
}

export default RequireAuth;
