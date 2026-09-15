import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/layout/RequireAuth';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { useAuth } from '@/hooks/useAuth';
import NotFoundPage from '@/pages/NotFoundPage';
import { ROUTES } from '@/config/routes';

/**
 * 路由表（ARCHITECTURE.md §8.2）。
 *
 * P0-A3 硬性：`/`、`/square`、`/app/:id` 全部免登录；
 * 只有 `/generate`、`/generating`、`/me`、`/me/apps`、`/admin` 需要登录。
 *
 * `/` 首页分流（野马需求：主界面就是制作页）：
 * - 已登录 → 直接渲染制作页 GeneratePage，老师进来就能一句话开工；
 * - 未登录 → 渲染营销首页 HomePage（Hero / 核心亮点 / 底部 CTA），用于对外展示与引流。
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
const TeacherResourceUploadPage = lazy(() => import('@/pages/TeacherResourceUploadPage'));
const AdminResourceReviewPage = lazy(() => import('@/pages/AdminResourceReviewPage'));
const ContentLibraryPage = lazy(() => import('@/pages/ContentLibraryPage'));

// 每日一练：学生免登录作答（公开）/ 教师创建 / 教师管理
const PracticeRunPage = lazy(() => import('@/pages/PracticeRunPage').then((m) => ({ default: m.PracticeRunPage })));
const PracticeCreatePage = lazy(() => import('@/pages/PracticeCreatePage'));
const PracticeManagePage = lazy(() => import('@/pages/PracticeManagePage').then((m) => ({ default: m.PracticeManagePage })));

// 组卷（T11）：学生免登录作答（公开）/ 教师创建 / 教师管理 / 题库
const ExamPaperRunPage = lazy(() => import('@/pages/ExamPaperRunPage').then((m) => ({ default: m.ExamPaperRunPage })));
const ExamPaperCreatePage = lazy(() => import('@/pages/ExamPaperCreatePage'));
const ExamPaperManagePage = lazy(() => import('@/pages/ExamPaperManagePage').then((m) => ({ default: m.ExamPaperManagePage })));
const QuestionBankPage = lazy(() => import('@/pages/QuestionBankPage').then((m) => ({ default: m.QuestionBankPage })));

/** 懒加载包裹器。 */
function withSuspense(node: JSX.Element): JSX.Element {
  return <Suspense fallback={<InlineLoading />}>{node}</Suspense>;
}

/**
 * 首页 `/` 的登录态分流器。
 *
 * - 已登录 → 制作页（GeneratePage）：一句话输入 + 类型选择 + 生成按钮全部可用；
 * - 未登录 → 营销首页（HomePage）：保持 Hero / 核心亮点 / 底部 CTA 不变。
 *
 * 复用同一个 GeneratePage 组件，不复制其代码；`/generate` 路由原样保留，
 * 已有书签 / 分享链接不会失效。
 */
function HomeOrGenerate(): JSX.Element {
  const { user, loading } = useAuth();

  // 登录态尚未确定时先占位，避免已登录用户先闪一下营销首页再跳走。
  if (loading) return <InlineLoading />;

  return user ? withSuspense(<GeneratePage />) : withSuspense(<HomePage />);
}

const routes = [
  {
    path: ROUTES.HOME,
    element: <AppShell />,
    children: [
      { index: true, element: <HomeOrGenerate /> },
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
      // 每日一练：学生免登录作答（公开）
      { path: 'p/:slug', element: withSuspense(<PracticeRunPage />) },
      // 每日一练：教师创建（需登录）
      {
        path: 'practice/new',
        element: (
          <RequireAuth>{withSuspense(<PracticeCreatePage />)}</RequireAuth>
        ),
      },
      // 每日一练：教师管理看板（需登录）
      {
        path: 'practice',
        element: (
          <RequireAuth>{withSuspense(<PracticeManagePage />)}</RequireAuth>
        ),
      },
      // 组卷：学生免登录作答（公开，P0 硬性：不能包 RequireAuth）
      { path: 'e/:slug', element: withSuspense(<ExamPaperRunPage />) },
      // 组卷：教师创建（需登录）
      {
        path: 'exam/new',
        element: (
          <RequireAuth>{withSuspense(<ExamPaperCreatePage />)}</RequireAuth>
        ),
      },
      // 组卷：教师管理看板（需登录）；/exam 也直接落到看板，方便口头告知
      {
        path: 'exam',
        element: (
          <RequireAuth>{withSuspense(<ExamPaperManagePage />)}</RequireAuth>
        ),
      },
      {
        path: 'exam/manage',
        element: (
          <RequireAuth>{withSuspense(<ExamPaperManagePage />)}</RequireAuth>
        ),
      },
      // 组卷：题库（需登录）
      {
        path: 'exam/bank',
        element: (
          <RequireAuth>{withSuspense(<QuestionBankPage />)}</RequireAuth>
        ),
      },
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
      {
        path: 'resources/upload',
        element: (
          <RequireAuth>{withSuspense(<TeacherResourceUploadPage />)}</RequireAuth>
        ),
      },
      {
        path: 'admin/resources',
        element: (
          <RequireAuth requireAdmin>{withSuspense(<AdminResourceReviewPage />)}</RequireAuth>
        ),
      },
      {
        path: 'library',
        element: (
          <RequireAuth>{withSuspense(<ContentLibraryPage />)}</RequireAuth>
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
