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
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
const AdminPage = lazy(() => import('@/pages/AdminPage'));
const RechargePage = lazy(() => import('@/pages/RechargePage'));

/** 懒加载包裹器。 */
function withSuspense(node: JSX.Element): JSX.Element {
  return <Suspense fallback={<InlineLoading />}>{node}</Suspense>;
}

const routes = [
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
      // 公开：找回密码（邮箱验证码式，P0 主用）。同样处于未登录态，
      // 绝不能包 RequireAuth，否则会被踢回登录页、永远改不了密码。
      { path: 'forgot', element: withSuspense(<ForgotPasswordPage />) },
      // 公开：忘记密码的重置页。此时用户处于「未登录的恢复态」，
      // 绝不能包 RequireAuth，否则会被踢回登录页、永远改不了密码。
      { path: 'reset', element: withSuspense(<ResetPasswordPage />) },
      {
        path: 'recharge',
        element: (
          <RequireAuth>{withSuspense(<RechargePage />)}</RequireAuth>
        ),
      },
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
];

// GitHub Pages 项目页部署在 /shichuang/ 子路径下。
// 不传 basename 时，BrowserRouter 会把 URL 的 /shichuang/ 当成路由去匹配，
// 匹配不到任何路由 → 落到 * 显示 404 页（即"打开要先点回首页"的根因）。
// 用 Vite 注入的 BASE_URL（部署时 = /shichuang/，本地 dev = /）作为 basename 即可根治。
// React Router 要求 basename 有前导斜杠、无末尾斜杠，所以 strip 掉末尾的 '/'。
const basename = import.meta.env.BASE_URL?.replace(/\/$/, '') || '/';
export const router = createBrowserRouter(routes, {
  basename,
});

export default router;
