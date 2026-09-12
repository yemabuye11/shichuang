import { getMeta, putMeta } from '@/utils/idb';
import { REGISTER_GIFT } from '@/config/creditRules';
import { buildDemoApps, ensureDemoHtml } from './mockSeed';
import type { AppStatus, AppType, HtmlStatus, LedgerReason, ReportStatus, RedemptionStatus } from '@/types/enums';
import type { Category, DocType, VerifyStatus } from '@/types/doc';
import type {
  App,
  CreditAccount,
  LedgerItem,
  MembershipPlan,
  Profile,
  RedemptionCode,
  ReportItem,
  UserMembership,
} from '@/types/models';

/**
 * MOCK 模式的本地账本。
 *
 * 只在「未配置 Supabase」或显式 `VITE_ENABLE_MOCK=true` 时启用，
 * 目的是让「输入 → 流式生成 → 预览 → 扣积分」全链路在没有云端时也可演示。
 *
 * 持久化到 IndexedDB（不可用则退化为内存），刷新页面数据不丢。
 */

const KEY = 'mock-store-v1';

export interface MockState {
  profile: Profile | null;
  account: CreditAccount;
  ledger: LedgerItem[];
  apps: App[];
  membership: UserMembership | null;
  plans: MembershipPlan[];
  /** 演示应用是否已播种（只播一次，用户自己生成的排在前面）。 */
  seeded: boolean;
  /** 本地兑换码（管理员后台演示用）。 */
  codes: RedemptionCode[];
  /** 本地举报（管理员后台演示用）。 */
  reports: ReportItem[];
}

function emptyState(): MockState {
  return {
    profile: null,
    account: { userId: '', balance: 0, totalEarned: 0, totalUsed: 0, updatedAt: new Date().toISOString() },
    ledger: [],
    apps: [],
    membership: null,
    seeded: false,
    codes: [],
    reports: [],
    plans: [
      { id: 'free', name: '体验版', credits: 0, durationDays: 0, priceCny: 0, description: '注册即赠送', sortOrder: 0, enabled: true },
      { id: 'basic', name: '标准版', credits: 200, durationDays: 365, priceCny: 9.9, description: '适合一位老师一学年', sortOrder: 1, enabled: true },
      { id: 'pro', name: '专业版', credits: 600, durationDays: 365, priceCny: 29, description: '适合教研组长', sortOrder: 2, enabled: true },
      { id: 'school', name: '校级版', credits: 3000, durationDays: 365, priceCny: 99, description: '面向教研组共享', sortOrder: 3, enabled: true },
    ],
  };
}

let state: MockState = emptyState();
let loaded = false;

/** 载入本地账本（幂等）。 */
export async function load(): Promise<MockState> {
  if (loaded) return state;
  try {
    const saved = await getMeta<MockState>(KEY);
    if (saved) state = { ...emptyState(), ...saved };
  } catch {
    /* 首次加载或 IndexedDB 不可用：使用空账本 */
  }

  if (!state.seeded) {
    // 播种演示应用（只播一次，用户之后自己生成的应用会排在列表前面）
    const demoIds = new Set(state.apps.map((a) => a.id));
    const demo = buildDemoApps().filter((a) => !demoIds.has(a.id));
    state.apps = [...demo, ...state.apps];
    state.seeded = true;
    await persist();
  }

  loaded = true;
  // 保证演示应用的 HTML 副本存在（IndexedDB 可能被清理，这里补写）
  void ensureDemoHtml();
  return state;
}

/** 持久化本地账本（失败静默，不影响主流程）。 */
export async function persist(): Promise<void> {
  try {
    await putMeta(KEY, state);
  } catch {
    /* 忽略 */
  }
}

/** 读取当前账本（同步；调用前请确保已 `await load()`）。 */
export function current(): MockState {
  return state;
}

/** 重置本地账本（用于「清空演示数据」）。 */
export async function reset(): Promise<void> {
  state = emptyState();
  loaded = true;
  await persist();
}

let seq = 1;

/** 生成一个本地自增 ID（用于流水号）。 */
export function nextId(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

/**
 * 写入一条流水并同步余额（与服务端 `apply_credit()` 语义一致）。
 *
 * @param delta 变动量（正=收入 负=支出）。
 * @param reason 变动原因。
 * @param memo 备注。
 * @param opts 可选的 token 记账字段。
 * @returns 变动后的余额。
 */
export function applyCredit(
  delta: number,
  reason: LedgerReason,
  memo: string,
  opts: { refType?: string; refId?: string; tokensIn?: number; tokensOut?: number; model?: string } = {},
): number {
  const userId = state.profile?.id ?? 'mock-user';
  const balance = state.account.balance + delta;
  if (balance < 0) throw new Error('INSUFFICIENT_CREDITS');

  state.account = {
    userId,
    balance,
    totalEarned: state.account.totalEarned + (delta > 0 ? delta : 0),
    totalUsed: state.account.totalUsed + (delta < 0 ? -delta : 0),
    updatedAt: new Date().toISOString(),
  };

  state.ledger = [
    {
      id: nextId(),
      userId,
      delta,
      balanceAfter: balance,
      reason,
      refType: opts.refType ?? '',
      refId: opts.refId ?? '',
      tokensIn: opts.tokensIn ?? 0,
      tokensOut: opts.tokensOut ?? 0,
      model: opts.model ?? '',
      costCny: 0,
      memo,
      createdAt: new Date().toISOString(),
    },
    ...state.ledger,
  ];

  void persist();
  return balance;
}

/**
 * 注册（MOCK）：发放注册赠送积分并写入流水。
 *
 * @param nickname 昵称。
 * @returns 新用户资料。
 */
export function signUpLocal(nickname: string): Profile {
  const now = new Date().toISOString();
  state.profile = {
    id: 'mock-user',
    nickname: nickname || '演示老师',
    avatarSeed: 'mock',
    role: 'admin', // MOCK 下放开后台，便于演示全部功能
    status: 'active',
    subject: '',
    grade: '',
    school: '',
    inviteCode: 'MOCK',
    createdAt: now,
    updatedAt: now,
  };
  state.account = {
    userId: 'mock-user',
    balance: 0,
    totalEarned: 0,
    totalUsed: 0,
    updatedAt: now,
  };
  applyCredit(REGISTER_GIFT, 'register_gift', '新用户注册赠送（演示数据）');
  void persist();
  return state.profile;
}

/** 退出登录（MOCK）：清空 profile 与账户，保留应用列表便于观察。 */
export function signOutLocal(): void {
  state.profile = null;
  void persist();
}

/**
 * 新增一个本地应用。
 *
 * @param input 应用字段。
 * @returns 新应用。
 */
export function addApp(input: {
  title: string;
  summary: string;
  appType: AppType | DocType;
  promptRaw: string;
  creditsCost: number;
  htmlUrl: string;
  htmlStatus: HtmlStatus;
  html: string;
  subject: string;
  grade: string;
  /** T06：产物大类。 */
  category?: Category;
  /** T06：文档类型。 */
  docType?: DocType | string;
  /** T06：结构化 DocModel 的本地地址（真实链路在 Storage）。 */
  docJsonUrl?: string | null;
  /** T06：MOCK 模式下的本地 DocModel JSON 原文。 */
  docJson?: string | null;
}): App {
  const now = new Date().toISOString();
  const category = input.category ?? 'app';
  const app: App = {
    id: `mock-app-${nextId()}`,
    authorId: state.profile?.id ?? 'mock-user',
    title: input.title,
    summary: input.summary,
    appType: input.appType,
    subject: input.subject,
    grade: input.grade,
    textbook: '',
    duration: '',
    difficulty: '',
    promptRaw: input.promptRaw,
    promptEnhanced: '',
    model: 'mock-adapter',
    promptVersion: 'system_core@1',
    htmlUrl: input.htmlUrl,
    htmlStatus: input.htmlStatus,
    htmlSizeBytes: new TextEncoder().encode(input.html).length,
    htmlSha256: `mock-${input.html.length}`,
    htmlVersion: 1,
    coverKind: 'auto',
    coverSeed: `mock-${nextId()}`,
    coverUrl: '',
    status: 'draft' as AppStatus,
    publishedAt: null,
    viewCount: 0,
    likeCount: 0,
    remixCount: 0,
    creditsCost: input.creditsCost,
    tokensIn: 0,
    tokensOut: 0,
    generationMs: 0,
    parentAppId: null,
    category,
    docType: (category === 'doc' ? (input.docType as DocType) : null) ?? null,
    docJsonUrl: category === 'doc' ? (input.docJsonUrl ?? null) : null,
    docVersion: category === 'doc' ? 1 : null,
    verifyStatus: category === 'doc' ? ('pending' as VerifyStatus) : null,
    textbookVersionId: null,
    docJson: category === 'doc' ? (input.docJson ?? null) : null,
    createdAt: now,
    updatedAt: now,
    likedByMe: false,
  };
  state.apps = [app, ...state.apps];
  void persist();
  return app;
}

/** MOCK 模式是否已登录。 */
export function isSignedIn(): boolean {
  return state.profile !== null;
}

// ---------------------------------------------------------------------------
// 管理员后台的本地替代实现（演示模式下 `/admin` 也要可用）
// ---------------------------------------------------------------------------

/**
 * 追加一批兑换码到本地账本。
 *
 * @param codes 待写入的兑换码。
 */
export async function addCodes(codes: RedemptionCode[]): Promise<void> {
  state.codes = [...codes, ...state.codes];
  await persist();
}

/**
 * 查询本地兑换码。
 *
 * @param status 过滤状态；为空表示全部。
 */
export function listCodes(status: RedemptionStatus | '' = ''): RedemptionCode[] {
  return status ? state.codes.filter((c) => c.status === status) : state.codes;
}

/** 按码查找。 */
export function findCode(code: string): RedemptionCode | null {
  const upper = code.trim().toUpperCase();
  return state.codes.find((c) => c.code === upper) ?? null;
}

/**
 * 更新兑换码状态。
 *
 * @param code 兑换码。
 * @param status 新状态。
 * @param usedBy 使用者（可空）。
 */
export async function setCodeStatus(
  code: string,
  status: RedemptionStatus,
  usedBy: string | null = null,
): Promise<void> {
  const upper = code.trim().toUpperCase();
  state.codes = state.codes.map((c) =>
    c.code === upper ? { ...c, status, usedBy, usedAt: status === 'used' ? new Date().toISOString() : null } : c,
  );
  await persist();
}

/**
 * 追加一条举报。
 *
 * @param appId 被举报应用。
 * @param reason 举报原因。
 * @param detail 补充说明。
 */
export async function addReport(appId: string, reason: string, detail = ''): Promise<ReportItem> {
  const item: ReportItem = {
    id: nextId(),
    appId,
    reason,
    detail,
    status: 'pending',
    createdAt: new Date().toISOString(),
    handledAt: null,
    appTitle: state.apps.find((a) => a.id === appId)?.title ?? '',
  };
  state.reports = [item, ...state.reports];
  await persist();
  return item;
}

/**
 * 查询举报。
 *
 * @param status 过滤状态。
 */
export function listReports(status: ReportStatus | '' = ''): ReportItem[] {
  return status ? state.reports.filter((r) => r.status === status) : state.reports;
}

/**
 * 处理举报。
 *
 * @param reportId 举报 ID。
 * @param status 目标状态。
 */
export async function setReportStatus(reportId: string, status: ReportStatus): Promise<void> {
  state.reports = state.reports.map((r) =>
    r.id === reportId ? { ...r, status, handledAt: new Date().toISOString() } : r,
  );
  await persist();
}

/**
 * 修改应用状态（下架 / 恢复）。
 *
 * @param appId 应用 ID。
 * @param status 目标状态。
 */
export async function setAppStatus(appId: string, status: AppStatus): Promise<void> {
  state.apps = state.apps.map((a) => (a.id === appId ? { ...a, status, updatedAt: new Date().toISOString() } : a));
  await persist();
}

/**
 * 修改应用 HTML 状态（发布中 / 就绪 / 失败）。
 *
 * @param appId 应用 ID。
 * @param htmlStatus 目标状态。
 */
export async function setHtmlStatus(appId: string, htmlStatus: HtmlStatus): Promise<void> {
  state.apps = state.apps.map((a) =>
    a.id === appId ? { ...a, htmlStatus, updatedAt: new Date().toISOString() } : a,
  );
  await persist();
}

/**
 * 保存文档的新版本（MOCK 模式）：递增 `docVersion` 并写入最新 DocModel JSON。
 *
 * 真实模式下版本写入由 Edge Function 完成（写 Storage + publish），此处仅模拟本地落库，
 * 保证「保存新版本」按钮在离线演示时也有真实可感知的效果。
 *
 * @param docId 文档（应用）UUID。
 * @param docJson 最新 DocModel JSON（可空 → 仅递增版本号）。
 * @returns 新版本号。
 */
export async function saveDocVersion(docId: string, docJson: string | null): Promise<number> {
  const app = state.apps.find((a) => a.id === docId);
  if (!app) return 1;
  const version = (app.docVersion ?? 1) + 1;
  state.apps = state.apps.map((a) =>
    a.id === docId ? { ...a, docVersion: version, docJson: docJson ?? a.docJson } : a,
  );
  await persist();
  return version;
}
