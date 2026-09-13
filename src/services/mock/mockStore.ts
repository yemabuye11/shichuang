import { getMeta, putMeta } from '@/utils/idb';
import { REGISTER_GIFT } from '@/config/creditRules';
import { buildDemoApps, ensureDemoHtml } from './mockSeed';
import type { AppStatus, AppType, HtmlStatus, LedgerReason, ReportStatus, RedemptionStatus } from '@/types/enums';
import type { Category, DocType, TextbookKnowledge, TextbookVersion, VerifyStatus } from '@/types/doc';
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

/** 收款码 + 引导文案（system_config 的 payment key，mock 占位）。 */
export interface MockPaymentConfig {
  wechatQrUrl: string;
  alipayQrUrl: string;
  tip: string;
}

/** 充值请求（mock 内存态）。 */
export interface MockRechargeRequest {
  id: string;
  userId: string;
  planId: string | null;
  planName: string | null;
  amountCny: number;
  payMethod: 'wechat' | 'alipay';
  status: 'pending' | 'approved' | 'rejected';
  proofText: string | null;
  proofImageUrl: string | null;
  createdAt: string;
  nickname: string | null;
  handledAt: string | null;
}

/** 缺省引导文案（与后端种子保持一致）。 */
const DEFAULT_PAYMENT_TIP =
  '选套餐 → 扫下方码付款（备注你的账号名）→ 付款后点“我已付款”提交凭证 → 管理员核对后积分到账';

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
  /** T07：本地教材版本（mock 下供级联选择）。 */
  textbookVersions: TextbookVersion[];
  /** T07：本地教材知识点沉淀（mock 下供缓存命中与教师补写）。 */
  textbookKnowledge: TextbookKnowledge[];
  /** 收款码配置（system_config.payment 的 mock 占位）。 */
  paymentConfig: MockPaymentConfig;
  /** 充值请求（老师端提交，后台确认，mock 内存闭环）。 */
  rechargeRequests: MockRechargeRequest[];
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
    textbookVersions: [],
    textbookKnowledge: [],
    paymentConfig: { wechatQrUrl: '', alipayQrUrl: '', tip: DEFAULT_PAYMENT_TIP },
    rechargeRequests: [],
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

  // 播种示例教材版本（只播一次，供 mock 下级联选择演示）
  if (state.textbookVersions.length === 0) {
    state.textbookVersions = buildSampleTextbookVersions();
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
  /** T07：绑定的教材版本 id（来自生成请求）。 */
  textbookVersionId?: string | null;
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
    textbookVersionId: input.textbookVersionId ?? null,
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

// ---------------------------------------------------------------------------
// T07 教材版本与知识点（mock 本地实现）
// ---------------------------------------------------------------------------

/**
 * 构造示例教材版本（mock 演示用，覆盖常见年级 / 学科 / 出版社组合）。
 */
function buildSampleTextbookVersions(): TextbookVersion[] {
  const now = new Date().toISOString();
  const base = [
    { grade: '九年级', subject: '数学', publisher: '人教版', version: '2024版', year: '2024', chapter: '第二十六章 反比例函数' },
    { grade: '六年级', subject: '语文', publisher: '部编版', version: '2024版', year: '2024', chapter: '第三单元 阅读策略' },
    { grade: '高一', subject: '物理', publisher: '人教版', version: '2019版', year: '2019', chapter: '第三章 相互作用' },
    { grade: '八年级', subject: '英语', publisher: '外研版', version: '2024版', year: '2024', chapter: 'Module 5 Lao She Teahouse' },
  ];
  return base.map((b, i) => ({
    id: `mock-tv-${i + 1}`,
    authorId: state.profile?.id ?? 'mock-user',
    year: b.year,
    version: b.version,
    publisher: b.publisher,
    subject: b.subject,
    grade: b.grade,
    chapter: b.chapter,
    uploadUrl: null,
    status: 'verified' as const,
    createdAt: now,
  }));
}

/** 列出本地教材版本（mock 级联选择）。 */
export function listTextbookVersions(): TextbookVersion[] {
  return state.textbookVersions;
}

/**
 * 新增一个本地教材版本（mock 上传 / 登记）。
 *
 * @param input 版本维度字段。
 * @returns 新版本。
 */
export function addTextbookVersion(input: {
  year: string;
  version: string;
  publisher: string;
  subject: string;
  grade: string;
  chapter?: string | null;
  uploadUrl?: string | null;
}): TextbookVersion {
  const now = new Date().toISOString();
  const v: TextbookVersion = {
    id: `mock-tv-${nextId()}`,
    authorId: state.profile?.id ?? 'mock-user',
    year: input.year,
    version: input.version,
    publisher: input.publisher,
    subject: input.subject,
    grade: input.grade,
    chapter: input.chapter ?? null,
    uploadUrl: input.uploadUrl ?? null,
    status: 'draft',
    createdAt: now,
  };
  state.textbookVersions = [v, ...state.textbookVersions];
  void persist();
  return v;
}

/** 列出某版本的本地知识点（mock 命中缓存判断）。 */
export function listTextbookKnowledge(versionId: string): TextbookKnowledge[] {
  return state.textbookKnowledge.filter((k) => k.textbookVersionId === versionId);
}

/**
 * 沉淀一条教材知识点（mock 教师补写 / 上传电子版）。
 *
 * @param versionId 教材版本 id。
 * @param section 章节 / 小节。
 * @param content 知识点内容。
 * @returns 新知识点。
 */
export function depositTextbookKnowledge(
  versionId: string,
  section: string,
  content: string,
): TextbookKnowledge {
  const now = new Date().toISOString();
  const k: TextbookKnowledge = {
    id: `mock-tk-${nextId()}`,
    textbookVersionId: versionId,
    section,
    content,
    status: 'verified',
    verifiedBy: state.profile?.id ?? 'mock-user',
    source: 'teacher',
    createdAt: now,
  };
  state.textbookKnowledge = [k, ...state.textbookKnowledge];
  void persist();
  return k;
}

// ---------------------------------------------------------------------------
// 收款码配置（system_config.payment 的 mock 占位）
// ---------------------------------------------------------------------------

/** 读取收款码配置（mock 占位，缺图返回空字符串）。 */
export function getPaymentConfig(): MockPaymentConfig {
  return { ...state.paymentConfig };
}

/** 保存收款码配置（mock 占位）。 */
export async function setPaymentConfig(cfg: MockPaymentConfig): Promise<void> {
  state.paymentConfig = { ...cfg };
  await persist();
}

// ---------------------------------------------------------------------------
// 充值请求（老师端提交 / 后台确认，mock 内存闭环保证演示可用）
// ---------------------------------------------------------------------------

/**
 * 老师端提交一条充值请求（mock 内存）。
 *
 * @param input 套餐 / 金额 / 付款方式 / 凭证。
 */
export async function addRechargeRequest(input: {
  planId: string;
  amountCny: number;
  payMethod: 'wechat' | 'alipay';
  proofText: string;
  proofImageUrl: string | null;
}): Promise<MockRechargeRequest> {
  const now = new Date().toISOString();
  const plan = state.plans.find((p) => p.id === input.planId);
  const req: MockRechargeRequest = {
    id: `mock-req-${nextId()}`,
    userId: state.profile?.id ?? 'mock-user',
    planId: input.planId,
    planName: plan?.name ?? null,
    amountCny: input.amountCny,
    payMethod: input.payMethod,
    status: 'pending',
    proofText: input.proofText,
    proofImageUrl: input.proofImageUrl,
    createdAt: now,
    nickname: state.profile?.nickname ?? '演示老师',
    handledAt: null,
  };
  state.rechargeRequests = [req, ...state.rechargeRequests];
  await persist();
  return req;
}

/**
 * 列出充值请求（mock 内存）。
 *
 * @param status 过滤状态；为空表示全部。
 */
export function listRechargeRequests(status: string | null = null): MockRechargeRequest[] {
  const list = status
    ? state.rechargeRequests.filter((r) => r.status === status)
    : state.rechargeRequests;
  return list.map((r) => ({ ...r }));
}

/**
 * 管理员确认 / 拒绝一条充值请求（mock 内存）。
 *
 * 确认时按 plan 查 credits，调用 applyCredit 加积分，保证「提交→确认→积分到账」闭环。
 *
 * @param id 请求 ID。
 * @param ok true=确认到账，false=拒绝。
 */
export async function approveRechargeRequest(id: string, ok: boolean): Promise<void> {
  const req = state.rechargeRequests.find((r) => r.id === id);
  if (!req) return;
  if (ok) {
    const plan = state.plans.find((p) => p.id === req.planId);
    const delta = plan ? plan.credits : 0;
    if (delta > 0) {
      // 与真实 RPC 语义一致：reason='recharge_self', ref_type='recharge'
      applyCredit(delta, 'recharge_self', '自助充值到账（管理员确认）', {
        refType: 'recharge',
        refId: id,
      });
    }
    req.status = 'approved';
  } else {
    req.status = 'rejected';
  }
  req.handledAt = new Date().toISOString();
  await persist();
}
