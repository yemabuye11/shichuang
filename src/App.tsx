import { CssBaseline, ThemeProvider } from '@mui/material';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ToastHost } from '@/components/common/ToastHost';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { theme } from '@/theme';
import { router } from '@/router';

/**
 * 应用根组件：Providers 组合（Auth → Toast → ErrorBoundary → Theme → Router）。
 *
 * 顺序说明：
 * - `AuthProvider` 在最外层，保证任何页面都能读到登录态与品牌配置；
 * - `ToastHost` 包住路由，使所有页面都能 `useToast()`；
 * - `ErrorBoundary` 兜住渲染异常，避免教师看到白屏。
 */
export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthProvider>
          <ToastHost>
            <RouterProvider router={router} />
          </ToastHost>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
