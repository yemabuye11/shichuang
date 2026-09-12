import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/layout/RequireAuth';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import NotFoundPage from '@/pages/NotFoundPage';
import { ROUTES } from '@/config/routes';

/**
 * 路由表（ARCHITECTURE.md §8.2）。
 *
 * P0-A3 硬性：`/`、`/square`、`/app/:id` 全部免登录；
 * 只有 `/generate`、`/generating`、`/me`、`/me/apps`、`/admin` 需要登录。
 */

// 首屏直接加载（体积极小）
const HomePage = lazy(() => import('@/pages/HomePage'));

// 其余按需加载，控制首屏 JS 体积
const GeneratePage = lazy(() => import('@/pages/GeneratePage'));
const GeneratingPage = lazy(() => import('@/pages/GeneratingPage'));
const AppRunPage = lazy(() => import('@/pages/AppRunPage'));
const DocRunPage = lazy(() => import('@/pages/DocRunPage'));
const DocEditorPage = lazy(() => import('@/pages/DocEditorPage'));
const SquarePage = lazy(() => import('@/pages/SquarePage'));
const MePage = lazy(() => import('@/pages/MePage'));
const MyAppsPage = lazy(() => import('@/pages/MyAppsPage'));
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));

/** 懒加载包裹器。 */
function withSuspense(node: JSX.Element): JSX.Element {
  return <Suspense fallback={<InlineLoading />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: ROUTES.HOME,
    element: <AppShell />,
    children: [
      { index: true, element: withSuspense(<HomePage />) },
      {
        path: 'generate',
        element: (
          <RequireAuth>{withSuspense(<GeneratePage />)}</RequireAuth>
        ),
      },
      {
        path: 'generating/:jobId',
        element: (
          <RequireAuth>{withSuspense(<GeneratingPage />)}</RequireAuth>
        ),
      },
      // 公开：P0-A3 硬性，未登录必须可打开
      { path: 'app/:id', element: withSuspense(<AppRunPage />) },
      // 公开：文档运行页（apps.category='doc' 的网页链接，平台可信壳，无 iframe sandbox）
      { path: 'd/:id', element: withSuspense(<DocRunPage />) },
      // 公开：文档在线编辑页（UI-5 / T08，复用 DocModel 源，编辑后存新版本）
      { path: 'd/:id/edit', element: withSuspense(<DocEditorPage />) },
      { path: 'square', element: withSuspense(<SquarePage />) },
      {
        path: 'me',
        element: <RequireAuth>{withSuspense(<MePage />)}</RequireAuth>,
      },
      {
        path: 'me/apps',
        element: <RequireAuth>{withSuspense(<MyAppsPage />)}</RequireAuth>,
      },
      { path: 'login', element: withSuspense(<LoginPage />) },
      {
        path: 'admin',
        element: (
          <RequireAuth requireAdmin>{withSuspense(<AdminPage />)}</RequireAuth>
        ),
      },
      { path: '404', element: <NotFoundPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export default router;
