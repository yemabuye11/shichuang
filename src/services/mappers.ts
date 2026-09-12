import type {
  AdminCodeRow,
  AdminReportRow,
  AdminUserRow,
  AppRow,
  AppTypeEnum,
  CreditAccountRow,
  CreditTransactionRow,
  ListSquareRow,
  MembershipPlanRow,
  ProfileRow,
  UserMembershipRow,
} from '@/types/database';
import type {
  App,
  Author,
  CreditAccount,
  LedgerItem,
  MembershipPlan,
  Profile,
  RedemptionCode,
  ReportItem,
  SquareItem,
  UserMembership,
} from '@/types/models';
import type { AppType, LedgerReason, RedemptionKind, RedemptionStatus } from '@/types/enums';
import type { Category, DocType, VerifyStatus } from '@/types/doc';
import { toFloat, toInt } from '@/utils/format';

/**
 * 数据库行（snake_case）→ 领域模型（camelCase）的统一映射。
 *
 * 集中在一处，避免各 service 各写一份导致字段口径漂移。
 */

/** `profiles` → `Profile`。 */
export function toProfile(row: ProfileRow | null | undefined): Profile | null {
  if (!row) return null;
  return {
    id: row.id,
    nickname: row.nickname ?? '老师',
    avatarSeed: row.avatar_seed ?? '',
    role: row.role ?? 'user',
    status: row.status ?? 'active',
    subject: row.subject ?? '',
    grade: row.grade ?? '',
    school: row.school ?? '',
    inviteCode: row.invite_code ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `credit_accounts` → `CreditAccount`。 */
export function toCreditAccount(row: CreditAccountRow | null | undefined): CreditAccount {
  return {
    userId: row?.user_id ?? '',
    balance: toInt(row?.balance, 0),
    totalEarned: toInt(row?.total_earned, 0),
    totalUsed: toInt(row?.total_used, 0),
    updatedAt: row?.updated_at ?? new Date().toISOString(),
  };
}

/** `credit_transactions` → `LedgerItem`。 */
export function toLedgerItem(row: CreditTransactionRow): LedgerItem {
  return {
    id: String(row.id),
    userId: row.user_id,
    delta: toInt(row.delta, 0),
    balanceAfter: toInt(row.balance_after, 0),
    reason: row.reason as LedgerReason,
    refType: row.ref_type ?? '',
    refId: row.ref_id ?? '',
    tokensIn: toInt(row.tokens_in, 0),
    tokensOut: toInt(row.tokens_out, 0),
    model: row.model ?? '',
    costCny: toFloat(row.cost_cny, 0),
    memo: row.memo ?? '',
    createdAt: row.created_at,
  };
}

/** `apps` → `App`。 */
export function toApp(row: AppRow, author?: Author | null): App {
  return {
    id: row.id,
    authorId: row.author_id,
    title: row.title,
    summary: row.summary ?? '',
    appType: row.app_type as AppType | DocType,
    subject: row.subject ?? '',
    grade: row.grade ?? '',
    textbook: row.textbook ?? '',
    duration: row.duration ?? '',
    difficulty: row.difficulty ?? '',
    promptRaw: row.prompt_raw ?? '',
    promptEnhanced: row.prompt_enhanced ?? '',
    model: row.model ?? '',
    promptVersion: row.prompt_version ?? '',
    htmlUrl: row.html_url ?? '',
    htmlStatus: row.html_status,
    htmlSizeBytes: toInt(row.html_size_bytes, 0),
    htmlSha256: row.html_sha256 ?? '',
    htmlVersion: toInt(row.html_version, 1),
    coverKind: row.cover_kind ?? 'auto',
    coverSeed: row.cover_seed ?? row.id,
    coverUrl: row.cover_url ?? '',
    status: row.status,
    publishedAt: row.published_at,
    viewCount: toInt(row.view_count, 0),
    likeCount: toInt(row.like_count, 0),
    remixCount: toInt(row.remix_count, 0),
    creditsCost: toInt(row.credits_cost, 0),
    tokensIn: toInt(row.tokens_in, 0),
    tokensOut: toInt(row.tokens_out, 0),
    generationMs: toInt(row.generation_ms, 0),
    parentAppId: row.parent_app_id,
    category: (row.category as Category) ?? 'app',
    docType: (row.doc_type as DocType | null) ?? null,
    docJsonUrl: row.doc_json_url ?? null,
    docVersion: toInt(row.doc_version, 1),
    verifyStatus: (row.verify_status as VerifyStatus | null) ?? null,
    textbookVersionId: row.textbook_version_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: author ?? null,
  };
}

/** `list_square()` 的一行 → `SquareItem`。 */
export function toSquareItem(row: ListSquareRow): SquareItem {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? '',
    appType: row.app_type as AppType | DocType,
    subject: row.subject ?? '',
    grade: row.grade ?? '',
    coverKind: row.cover_kind ?? 'auto',
    coverSeed: row.cover_seed ?? row.id,
    coverUrl: row.cover_url ?? '',
    status: row.status,
    publishedAt: row.published_at,
    viewCount: toInt(row.view_count, 0),
    likeCount: toInt(row.like_count, 0),
    author: row.author_id
      ? {
          id: row.author_id,
          nickname: row.author_nickname ?? '老师',
          avatarSeed: row.author_avatar_seed ?? '',
        }
      : null,
    likedByMe: row.liked_by_me === true,
  };
}

/** `membership_plans` → `MembershipPlan`。 */
export function toPlan(row: MembershipPlanRow): MembershipPlan {
  return {
    id: row.id,
    name: row.name,
    credits: toInt(row.credits, 0),
    durationDays: toInt(row.duration_days, 0),
    priceCny: toFloat(row.price_cny, 0),
    description: row.description ?? '',
    sortOrder: toInt(row.sort_order, 0),
    enabled: row.enabled !== false,
  };
}

/** `user_memberships` → `UserMembership`。 */
export function toUserMembership(row: UserMembershipRow | null | undefined): UserMembership | null {
  if (!row) return null;
  return {
    userId: row.user_id,
    planId: row.plan_id,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    status: row.status,
  };
}

/** `admin_list_codes()` 的一行 → `RedemptionCode`。 */
export function toRedemptionCode(row: AdminCodeRow): RedemptionCode {
  return {
    code: row.code,
    kind: row.kind as RedemptionKind,
    planId: row.plan_id,
    credits: toInt(row.credits, 0),
    validDays: toInt(row.valid_days, 0),
    batchNo: row.batch_no ?? '',
    status: row.status as RedemptionStatus,
    usedBy: row.used_by,
    usedAt: row.used_at,
    expiresAt: row.expires_at,
    createdBy: null,
    createdAt: row.created_at,
    memo: row.memo ?? '',
  };
}

/** `admin_list_reports()` 的一行 → `ReportItem`。 */
export function toReportItem(row: AdminReportRow): ReportItem {
  return {
    id: String(row.id),
    appId: row.app_id,
    reason: row.reason ?? '',
    detail: row.detail ?? '',
    status: row.status,
    createdAt: row.created_at,
    handledAt: null,
    appTitle: row.app_title ?? '',
  };
}

/** `admin_list_users()` 的一行 → 精简用户视图。 */
export function toAdminUser(row: AdminUserRow): {
  id: string;
  nickname: string;
  role: string;
  balance: number;
  planId: string | null;
  createdAt: string;
} {
  return {
    id: row.id,
    nickname: row.nickname ?? '老师',
    role: row.role ?? 'user',
    balance: toInt(row.balance, 0),
    planId: row.plan_id,
    createdAt: row.created_at,
  };
}

/** 把可能的枚举字符串收敛为 `AppType`，未知回落 `auto`。 */
export function toAppType(value: string | null | undefined): AppType {
  const VALID: readonly AppTypeEnum[] = [
    'auto',
    'teaching_animation',
    'edu_tool',
    'teaching_game',
    'interactive_courseware',
    'data_collection',
    'ai_item_generation',
    'ai_paper_composition',
    'ai_lesson_plan',
  ];
  return (VALID as readonly string[]).includes(value ?? '') ? (value as AppType) : 'auto';
}
