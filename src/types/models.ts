import type {
  AppStatus,
  AppType,
  HtmlStatus,
  JobStatus,
  LlmProvider,
  LedgerReason,
  RedemptionKind,
  RedemptionStatus,
  ReportStatus,
  UserRole,
  UserStatus,
} from './enums';
import type { Category, DocType, VerifyStatus } from './doc';

/**
 * 领域模型（前端视图层使用，字段名为 camelCase）。
 *
 * 数据库行（snake_case）→ 领域模型的转换统一在 `src/services/` 内完成，
 * 页面组件只消费这里的类型。
 */

/** 作者公开信息（经 `public_authors` 视图下发，仅 3 列）。 */
export interface Author {
  readonly id: string;
  readonly nickname: string;
  readonly avatarSeed: string;
}

/** 应用元数据（不含 HTML 正文）。 */
export interface App {
  readonly id: string;
  readonly authorId: string;
  readonly title: string;
  readonly summary: string;
  readonly appType: AppType | DocType;
  readonly subject: string;
  readonly grade: string;
  readonly textbook: string;
  readonly duration: string;
  readonly difficulty: string;
  readonly promptRaw: string;
  readonly promptEnhanced: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly htmlUrl: string;
  readonly htmlStatus: HtmlStatus;
  readonly htmlSizeBytes: number;
  readonly htmlSha256: string;
  readonly htmlVersion: number;
  readonly coverKind: string;
  readonly coverSeed: string;
  readonly coverUrl: string;
  readonly status: AppStatus;
  readonly publishedAt: string | null;
  readonly viewCount: number;
  readonly likeCount: number;
  readonly remixCount: number;
  readonly creditsCost: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly generationMs: number;
  readonly parentAppId: string | null;
  /** 产物大类：app（单文件 HTML）或 doc（结构化文档）。 */
  readonly category: Category;
  /** 文档类型（仅 category='doc' 时有效）。 */
  readonly docType?: DocType | null;
  /** 结构化 DocModel 的 Storage 路径（仅 category='doc'）。 */
  readonly docJsonUrl?: string | null;
  /** 文档版本号（仅 category='doc'）。 */
  readonly docVersion?: number | null;
  /** 文档校验状态（仅 category='doc'）。 */
  readonly verifyStatus?: VerifyStatus | null;
  /** 教材版本 id（T07 回填）。 */
  readonly textbookVersionId?: string | null;
  /** MOCK 模式下的本地 DocModel JSON（真实链路从 Storage 读取，不落此字段）。 */
  readonly docJson?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** 作者信息（列表查询时由视图 join 带出，可缺省）。 */
  readonly author?: Author | null;
  /** 当前登录用户是否已点赞（仅登录态下有意义）。 */
  readonly likedByMe?: boolean;
}

/** 应用广场列表项（App 的精简投影）。 */
export interface SquareItem {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly appType: AppType | DocType;
  readonly subject: string;
  readonly grade: string;
  readonly coverKind: string;
  readonly coverSeed: string;
  readonly coverUrl: string;
  readonly status: AppStatus;
  readonly publishedAt: string | null;
  readonly viewCount: number;
  readonly likeCount: number;
  readonly author: Author | null;
  readonly likedByMe: boolean;
}

/** 分页结果。 */
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  /** 是否还有下一页。 */
  readonly hasMore: boolean;
}

/** 积分账户。 */
export interface CreditAccount {
  readonly userId: string;
  readonly balance: number;
  readonly totalEarned: number;
  readonly totalUsed: number;
  readonly updatedAt: string;
}

/** 积分流水条目。 */
export interface LedgerItem {
  readonly id: string;
  readonly userId: string;
  readonly delta: number;
  readonly balanceAfter: number;
  readonly reason: LedgerReason;
  readonly refType: string;
  readonly refId: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly model: string;
  readonly costCny: number;
  readonly memo: string;
  readonly createdAt: string;
  /** 关联的应用标题（列表展示用，可缺省）。 */
  readonly appTitle?: string;
}

/** 生成任务。 */
export interface GenerationJob {
  readonly id: string;
  readonly userId: string;
  readonly appId: string | null;
  readonly appType: AppType;
  readonly model: string;
  readonly status: JobStatus;
  readonly reservedCredits: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costCny: number;
  readonly promptVersion: string;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

/** 会员套餐档位。 */
export interface MembershipPlan {
  readonly id: string;
  readonly name: string;
  readonly credits: number;
  readonly durationDays: number;
  readonly priceCny: number;
  readonly description: string;
  readonly sortOrder: number;
  readonly enabled: boolean;
}

/** 用户当前会员身份。 */
export interface UserMembership {
  readonly userId: string;
  readonly planId: string;
  readonly startedAt: string;
  readonly expiresAt: string | null;
  readonly status: 'active' | 'expired' | 'disabled';
  readonly plan?: MembershipPlan | null;
}

/** 兑换码（管理员视角）。 */
export interface RedemptionCode {
  readonly code: string;
  readonly kind: RedemptionKind;
  readonly planId: string | null;
  readonly credits: number;
  readonly validDays: number;
  readonly batchNo: string;
  readonly status: RedemptionStatus;
  readonly usedBy: string | null;
  readonly usedAt: string | null;
  readonly expiresAt: string | null;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly memo: string;
}

/** 用户资料。 */
export interface Profile {
  readonly id: string;
  readonly nickname: string;
  readonly avatarSeed: string;
  readonly role: UserRole;
  readonly subject: string;
  readonly grade: string;
  readonly school: string;
  readonly status: UserStatus;
  readonly inviteCode: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 已登录用户的聚合视图（资料 + 账户 + 会员）。 */
export interface CurrentUser {
  readonly profile: Profile;
  readonly account: CreditAccount;
  readonly membership: UserMembership | null;
}

/** 模型配置（后台可配）。 */
export interface ModelProfile {
  readonly id: string;
  readonly provider: LlmProvider;
  readonly modelId: string;
  readonly displayName: string;
  readonly pricing: {
    readonly input: number;
    readonly cachedInput: number;
    readonly output: number;
    readonly peakMultiplier: number;
  };
  readonly maxOutputTokens: number;
  readonly creditsPerCall: number;
  readonly isDefault: boolean;
  readonly enabled: boolean;
  readonly sortOrder: number;
}

/** 举报条目（管理员视角）。 */
export interface ReportItem {
  readonly id: string;
  readonly appId: string;
  readonly reason: string;
  readonly detail: string;
  readonly status: ReportStatus;
  readonly createdAt: string;
  readonly handledAt: string | null;
  readonly appTitle?: string;
}

/** 管理员看板数据。 */
export interface AdminStats {
  readonly users: number;
  readonly apps: number;
  readonly published: number;
  readonly gensToday: number;
  readonly spendMonthCny: number;
  readonly topApps: readonly { id: string; title: string; viewCount: number; likeCount: number }[];
}
