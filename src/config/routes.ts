/**
 * 路由路径常量（ARCHITECTURE.md §8.2）。
 *
 * 目的：避免路由字符串散落在各处，改名只改这里。
 */

/** 应用内的所有路由路径。 */
export const ROUTES = {
  /** 首页（公开）。 */
  HOME: '/',
  /** 生成页（需登录，支持 `?remix=&prompt=` 预填）。 */
  GENERATE: '/generate',
  /** 生成中进度页（需登录）。 */
  GENERATING: '/generating',
  /** 应用运行页（公开，P0-A3 硬性）。 */
  APP_RUN: '/app',
  /** 应用广场（公开）。 */
  SQUARE: '/square',
  /** 个人中心（需登录）。 */
  ME: '/me',
  /** 我的应用（需登录）。 */
  MY_APPS: '/me/apps',
  /** 登录页（公开，支持 `?redirect=`）。 */
  LOGIN: '/login',
  /** 重置密码页（公开，旧式邮件链接回跳地址，保留作兜底）。 */
  RESET: '/reset',
  /** 找回密码页（公开，邮箱验证码式，P0 主用流程）。 */
  FORGOT: '/forgot',
  /** 管理员后台（需登录 + role='admin'）。 */
  ADMIN: '/admin',
  /** 自助充值页（需登录，个人收款码 + 后台确认到账）。 */
  RECHARGE: '/recharge',
  /** 文档运行页（公开，对应 apps.category='doc' 的网页链接）。 */
  DOC_RUN: '/d',
  /** 内容市场：公开内容库（需登录，T09）。 */
  LIBRARY: '/library',
  /** 校本资源库：教师上传优秀教学案例（需登录）。 */
  RESOURCE_UPLOAD: '/resources/upload',
  /** 校本资源库：管理员审核台（需登录 + 管理员）。 */
  ADMIN_RESOURCES: '/admin/resources',
  /** 每日一练：教师创建（需登录）。 */
  PRACTICE_NEW: '/practice/new',
  /** 每日一练：教师管理看板（需登录）。 */
  PRACTICE_MANAGE: '/practice',
  /** 每日一练：学生免登录作答（公开）。 */
  PRACTICE_RUN: '/p',
  /** 组卷：教师创建（需登录，T11）。 */
  EXAM_NEW: '/exam/new',
  /** 组卷：教师管理看板（需登录，T11）。 */
  EXAM_MANAGE: '/exam/manage',
  /** 组卷：题库（需登录，T11）。 */
  EXAM_BANK: '/exam/bank',
  /** 组卷：学生免登录作答（公开，T11）。 */
  EXAM_RUN: '/e',
} as const;

/**
 * 拼接应用运行页路径。
 *
 * @param appId 应用 UUID。
 */
export function appRunPath(appId: string): string {
  return `${ROUTES.APP_RUN}/${encodeURIComponent(appId)}`;
}

/**
 * 拼接生成中页路径。
 *
 * @param jobId 生成任务 UUID。
 */
export function generatingPath(jobId: string): string {
  return `${ROUTES.GENERATING}/${encodeURIComponent(jobId)}`;
}

/**
 * 拼接带 redirect 的登录页路径。
 *
 * @param redirect 登录成功后要回跳的目标路径。
 */
export function loginPath(redirect?: string): string {
  if (!redirect) return ROUTES.LOGIN;
  return `${ROUTES.LOGIN}?redirect=${encodeURIComponent(redirect)}`;
}

/**
 * 拼接带 remix 预填的生成页路径。
 *
 * @param remixAppId 被复刻的应用 ID。
 * @param prompt 预填的提示词。
 */
export function remixPath(remixAppId: string, prompt: string): string {
  const params = new URLSearchParams({ remix: remixAppId, prompt });
  return `${ROUTES.GENERATE}?${params.toString()}`;
}

/**
 * 拼接文档运行页路径（公开，未登录可访问）。
 *
 * @param docId 文档（应用）UUID。
 */
export function docRunPath(docId: string): string {
  return `${ROUTES.DOC_RUN}/${encodeURIComponent(docId)}`;
}

/**
 * 拼接文档在线编辑页路径（UI-5，T08）。
 *
 * @param docId 文档（应用）UUID。
 */
export function docEditPath(docId: string): string {
  return `${ROUTES.DOC_RUN}/${encodeURIComponent(docId)}/edit`;
}

/**
 * 拼接每日一练「创建」页路径（需登录）。
 */
export function practiceNewPath(): string {
  return ROUTES.PRACTICE_NEW;
}

/**
 * 拼接每日一练「管理」页路径（需登录）。
 */
export function practiceManagePath(): string {
  return ROUTES.PRACTICE_MANAGE;
}

/**
 * 拼接每日一练「作答」页路径（公开，学生免登录）。
 *
 * @param slug 练习分享 slug。
 */
export function practiceRunPath(slug: string): string {
  return `${ROUTES.PRACTICE_RUN}/${encodeURIComponent(slug)}`;
}

/**
 * 拼接组卷「创建」页路径（需登录）。
 */
export function examNewPath(): string {
  return ROUTES.EXAM_NEW;
}

/**
 * 拼接组卷「管理」页路径（需登录）。
 */
export function examManagePath(): string {
  return ROUTES.EXAM_MANAGE;
}

/**
 * 拼接组卷「题库」页路径（需登录）。
 */
export function examBankPath(): string {
  return ROUTES.EXAM_BANK;
}

/**
 * 拼接组卷「作答」页路径（公开，学生免登录）。
 *
 * @param slug 测验卷分享 slug。
 */
export function examRunPath(slug: string): string {
  return `${ROUTES.EXAM_RUN}/${encodeURIComponent(slug)}`;
}
