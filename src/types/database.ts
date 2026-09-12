/**
 * Supabase Database 类型（手写，与 `supabase/migrations/0001~0011` 保持一致）。
 *
 * 说明：
 * - 正常情况下该文件由 `supabase gen types typescript` 生成；本项目在客户尚未创建
 *   Supabase 项目前先行开发，故手写一份等价类型，保证 service 层类型安全。
 * - 客户建好项目后，可执行：
 *   `supabase gen types typescript --project-id <ref> > src/types/database.ts`
 *   覆盖本文件（字段名与迁移完全一致，无需改动业务代码）。
 *
 * 命名说明（客户已拍板的口径，与架构文档略有差异）：
 * - `credit_ledger`       → `credit_transactions`（积分流水）
 * - `redeem_codes`        → `redemption_codes`（兑换码，含 invite / credit / membership 三类）
 * - 新增 `membership_plans` / `user_memberships`（会员套餐 + 积分的混合商业模式）
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
// ---------------------------------------------------------------------------
// 枚举（与 Postgres enum 逐字一致）
// ---------------------------------------------------------------------------
export type AppTypeEnum =
  | 'auto'
  | 'teaching_animation'
  | 'edu_tool'
  | 'teaching_game'
  | 'interactive_courseware'
  | 'data_collection'
  | 'ai_item_generation'
  | 'ai_paper_composition'
  | 'ai_lesson_plan';
export type AppStatusEnum = 'draft' | 'published' | 'taken_down';
export type HtmlStatusEnum = 'pending' | 'ready' | 'failed';
export type JobStatusEnum = 'running' | 'succeeded' | 'failed' | 'cancelled';
export type LedgerReasonEnum =
  | 'register_gift'
  | 'generate_spend'
  | 'generate_refund'
  | 'redeem_code'
  | 'admin_adjust'
  | 'publish_reward';
export type RedemptionKindEnum = 'credit' | 'invite' | 'membership';
export type RedemptionStatusEnum = 'unused' | 'used' | 'disabled';
export type UserRoleEnum = 'user' | 'admin';
export type UserStatusEnum = 'active' | 'disabled';
export type ReportStatusEnum = 'pending' | 'handled' | 'dismissed';
export type MembershipStatusEnum = 'active' | 'expired' | 'disabled';
// ---------------------------------------------------------------------------
// 行类型
// ---------------------------------------------------------------------------
export type ProfileRow = {
  id: string;
  nickname: string;
  avatar_seed: string;
  role: UserRoleEnum;
  status: UserStatusEnum;
  subject: string;
  grade: string;
  school: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
};
export type CreditAccountRow = {
  user_id: string;
  balance: number;
  total_earned: number;
  total_used: number;
  updated_at: string;
};
export type CreditTransactionRow = {
  id: number;
  user_id: string;
  delta: number;
  balance_after: number;
  reason: LedgerReasonEnum;
  ref_type: string;
  ref_id: string;
  tokens_in: number;
  tokens_out: number;
  model: string;
  cost_cny: number;
  memo: string;
  operator_id: string | null;
  created_at: string;
};
export type MembershipPlanRow = {
  id: string;
  name: string;
  credits: number;
  duration_days: number;
  price_cny: number;
  description: string;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};
export type UserMembershipRow = {
  user_id: string;
  plan_id: string;
  started_at: string;
  expires_at: string | null;
  status: MembershipStatusEnum;
  created_at: string;
  updated_at: string;
};
export type RedemptionCodeRow = {
  code: string;
  kind: RedemptionKindEnum;
  plan_id: string | null;
  credits: number;
  valid_days: number;
  batch_no: string;
  status: RedemptionStatusEnum;
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  memo: string;
};
export type AppRow = {
  id: string;
  author_id: string;
  title: string;
  summary: string;
  app_type: AppTypeEnum;
  subject: string;
  grade: string;
  textbook: string;
  duration: string;
  difficulty: string;
  prompt_raw: string;
  prompt_enhanced: string;
  model: string;
  prompt_version: string;
  html_url: string | null;
  html_status: HtmlStatusEnum;
  html_size_bytes: number;
  html_sha256: string;
  html_version: number;
  cover_kind: string;
  cover_seed: string;
  cover_url: string | null;
  status: AppStatusEnum;
  published_at: string | null;
  view_count: number;
  like_count: number;
  remix_count: number;
  credits_cost: number;
  tokens_in: number;
  tokens_out: number;
  generation_ms: number;
  parent_app_id: string | null;
  category: string;
  doc_type: string | null;
  doc_json_url: string | null;
  doc_version: number;
  verify_status: string | null;
  textbook_version_id: string | null;
  created_at: string;
  updated_at: string;
};
export type AppLikeRow = {
  app_id: string;
  user_id: string;
  created_at: string;
};
export type ReportRow = {
  id: number;
  app_id: string;
  reporter_id: string | null;
  reporter_hash: string;
  reason: string;
  detail: string;
  status: ReportStatusEnum;
  created_at: string;
  handled_by: string | null;
  handled_at: string | null;
};
export type SystemConfigRow = {
  key: string;
  value: Json;
  description: string;
  updated_at: string;
  updated_by: string | null;
};
export type ModelProfileRow = {
  id: string;
  provider: string;
  model_id: string;
  display_name: string;
  api_base: string;
  pricing: Json;
  max_output_tokens: number;
  credits_per_call: number;
  is_default: boolean;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};
export type AppTypeProfileRow = {
  app_type: AppTypeEnum;
  label: string;
  credit_cost: number;
  model_override: string | null;
  prompt_key: string;
  sort_order: number;
  enabled: boolean;
};
export type GenerationJobRow = {
  id: string;
  user_id: string;
  app_id: string | null;
  app_type: AppTypeEnum;
  model: string;
  status: JobStatusEnum;
  reserved_credits: number;
  tokens_in: number;
  tokens_out: number;
  cost_cny: number;
  prompt_version: string;
  error_code: string;
  error_message: string;
  idempotency_key: string;
  started_at: string;
  finished_at: string | null;
};
export type PublicAuthorRow = {
  id: string;
  nickname: string;
  avatar_seed: string;
};
/** `list_square()` 返回的一行。 */
export type ListSquareRow = {
  id: string;
  title: string;
  summary: string;
  app_type: AppTypeEnum;
  subject: string;
  grade: string;
  cover_kind: string;
  cover_seed: string;
  cover_url: string | null;
  status: AppStatusEnum;
  published_at: string | null;
  view_count: number;
  like_count: number;
  author_id: string;
  author_nickname: string | null;
  author_avatar_seed: string | null;
  liked_by_me: boolean | null;
  total_count: number;
};
/** `admin_list_codes()` 返回的一行。 */
export type AdminCodeRow = {
  code: string;
  kind: RedemptionKindEnum;
  plan_id: string | null;
  credits: number;
  valid_days: number;
  batch_no: string;
  status: RedemptionStatusEnum;
  used_by: string | null;
  used_by_name: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_at: string;
  memo: string;
  total_count: number;
};
/** `admin_list_users()` 返回的一行。 */
export type AdminUserRow = {
  id: string;
  nickname: string;
  role: UserRoleEnum;
  balance: number;
  plan_id: string | null;
  created_at: string;
  total_count: number;
};
/** `admin_list_reports()` 返回的一行。 */
export type AdminReportRow = {
  id: number;
  app_id: string;
  app_title: string | null;
  reason: string;
  detail: string;
  status: ReportStatusEnum;
  created_at: string;
  total_count: number;
};
// ---------------------------------------------------------------------------
// T07（迁移 0013 / 0014 / 0015）：教材版本与沉淀知识点表
//   注意：status / source 用 check 约束（非 Postgres enum 类型），故行类型内联字面量联合。
// ---------------------------------------------------------------------------
export type TextbookVersionRow = {
  id: string;
  owner_id: string;
  year: string;
  version: string;
  publisher: string;
  subject: string;
  grade: string;
  chapter: string | null;
  upload_url: string | null;
  status: 'draft' | 'verified';
  created_at: string;
  updated_at: string;
};
export type TextbookKnowledgeRow = {
  id: string;
  textbook_version_id: string;
  section: string;
  content: string;
  status: 'pending' | 'verified';
  verified_by: string | null;
  source: 'ai' | 'teacher' | 'upload';
  created_at: string;
  updated_at: string;
};
// ---------------------------------------------------------------------------
// Database 聚合类型（supabase-js 泛型入口）
// ---------------------------------------------------------------------------
export type Database = {
  public: {
    Tables: {
      profiles: { Row: ProfileRow; Insert: Partial<ProfileRow> & { id: string }; Update: Partial<ProfileRow>; Relationships: [] };
      credit_accounts: {
        Row: CreditAccountRow;
        Insert: Partial<CreditAccountRow> & { user_id: string };
        Update: Partial<CreditAccountRow>;
        Relationships: [];
      };
      credit_transactions: {
        Row: CreditTransactionRow;
        Insert: Partial<CreditTransactionRow> & { user_id: string; delta: number; reason: LedgerReasonEnum };
        Update: Partial<CreditTransactionRow>;
        Relationships: [];
      };
      membership_plans: {
        Row: MembershipPlanRow;
        Insert: Partial<MembershipPlanRow> & { id: string; name: string };
        Update: Partial<MembershipPlanRow>;
        Relationships: [];
      };
      user_memberships: {
        Row: UserMembershipRow;
        Insert: Partial<UserMembershipRow> & { user_id: string; plan_id: string };
        Update: Partial<UserMembershipRow>;
        Relationships: [];
      };
      redemption_codes: {
        Row: RedemptionCodeRow;
        Insert: Partial<RedemptionCodeRow> & { code: string };
        Update: Partial<RedemptionCodeRow>;
        Relationships: [];
      };
      apps: {
        Row: AppRow;
        Insert: Partial<AppRow> & { author_id: string };
        Update: Partial<AppRow>;
        Relationships: [];
      };
      app_likes: {
        Row: AppLikeRow;
        Insert: Partial<AppLikeRow> & { app_id: string; user_id: string };
        Update: Partial<AppLikeRow>;
        Relationships: [];
      };
      reports: {
        Row: ReportRow;
        Insert: Partial<ReportRow> & { app_id: string; reason: string };
        Update: Partial<ReportRow>;
        Relationships: [];
      };
      system_config: {
        Row: SystemConfigRow;
        Insert: Partial<SystemConfigRow> & { key: string };
        Update: Partial<SystemConfigRow>;
        Relationships: [];
      };
      model_profiles: {
        Row: ModelProfileRow;
        Insert: Partial<ModelProfileRow> & { id: string };
        Update: Partial<ModelProfileRow>;
        Relationships: [];
      };
      app_type_profiles: {
        Row: AppTypeProfileRow;
        Insert: Partial<AppTypeProfileRow> & { app_type: AppTypeEnum };
        Update: Partial<AppTypeProfileRow>;
        Relationships: [];
      };
      generation_jobs: {
        Row: GenerationJobRow;
        Insert: Partial<GenerationJobRow> & { user_id: string };
        Update: Partial<GenerationJobRow>;
        Relationships: [];
      };
      events: {
        Row: { id: number; name: string; user_id: string | null; anon_id: string; app_id: string | null; props: Json; created_at: string };
        Insert: { id?: number; name: string; user_id?: string | null; anon_id?: string | null; app_id?: string | null; props?: Json | null; created_at?: string | null };
        Update: Partial<{ name: string; props: Json }>;
        Relationships: [];
      };
      textbook_versions: {
        Row: TextbookVersionRow;
        Insert: Partial<TextbookVersionRow> & { owner_id: string };
        Update: Partial<TextbookVersionRow>;
        Relationships: [];
      };
      textbook_knowledge: {
        Row: TextbookKnowledgeRow;
        Insert: Partial<TextbookKnowledgeRow> & { textbook_version_id: string; section: string; content: string };
        Update: Partial<TextbookKnowledgeRow>;
        Relationships: [];
      };
    };
    Views: {
      public_authors: { Row: PublicAuthorRow; Relationships: [] };
    };
    Functions: {
      get_public_config: { Args: Record<string, never>; Returns: Json };
      estimate_cost: { Args: { p_app_type?: string | null; p_model?: string | null }; Returns: number };
      check_generation_allowed: { Args: Record<string, never>; Returns: Json };
      reserve_credits: {
        Args: { p_amount: number; p_job_id: string; p_app_type?: string | null; p_model?: string | null };
        Returns: Json;
      };
      settle_generation: {
        Args: {
          p_job_id: string;
          p_tokens_in?: number;
          p_tokens_out?: number;
          p_cost_cny?: number;
          p_model?: string | null;
          p_app_id?: string | null;
          p_ms?: number;
        };
        Returns: undefined;
      };
      refund_generation: {
        Args: { p_job_id: string; p_error_code?: string | null; p_error_message?: string | null };
        Returns: Json;
      };
      redeem_code: { Args: { p_code: string }; Returns: Json };
      publish_app: {
        Args: {
          p_app_id: string;
          p_title?: string | null;
          p_summary?: string | null;
          p_subject?: string | null;
          p_grade?: string | null;
          p_cover_kind?: string | null;
          p_cover_seed?: string | null;
        };
        Returns: Json;
      };
      unpublish_app: { Args: { p_app_id: string }; Returns: Json };
      rename_app: { Args: { p_app_id: string; p_title: string }; Returns: Json };
      delete_app: { Args: { p_app_id: string }; Returns: Json };
      duplicate_app: { Args: { p_app_id: string }; Returns: Json };
      toggle_like: { Args: { p_app_id: string }; Returns: Json };
      report_app: {
        Args: { p_app_id: string; p_reason: string; p_detail?: string | null; p_reporter_hash?: string | null };
        Returns: Json;
      };
      list_square: {
        Args: {
          p_type?: string | null;
          p_subject?: string | null;
          p_grade?: string | null;
          p_sort?: string | null;
          p_q?: string | null;
          p_offset?: number;
          p_limit?: number;
        };
        Returns: ListSquareRow[];
      };
      get_my_summary: { Args: Record<string, never>; Returns: Json };
      track_event: {
        Args: { p_name: string; p_props?: Json | null; p_app_id?: string | null; p_anon_id?: string | null };
        Returns: boolean;
      };
      record_app_view: {
        Args: { p_app_id: string; p_viewer_hash: string; p_day?: string | null };
        Returns: boolean;
      };
      admin_create_codes: {
        Args: {
          p_credits?: number;
          p_count?: number;
          p_batch_no?: string | null;
          p_expires_at?: string | null;
          p_kind?: string | null;
          p_plan_id?: string | null;
          p_valid_days?: number;
          p_prefix?: string | null;
          p_memo?: string | null;
        };
        Returns: { code: string }[];
      };
      admin_list_codes: {
        Args: {
          p_kind?: string | null;
          p_status?: string | null;
          p_batch_no?: string | null;
          p_offset?: number;
          p_limit?: number;
        };
        Returns: AdminCodeRow[];
      };
      admin_disable_code: { Args: { p_code: string }; Returns: Json };
      admin_adjust_credits: { Args: { p_user_id: string; p_delta: number; p_memo?: string | null }; Returns: Json };
      admin_list_users: {
        Args: { p_q?: string | null; p_offset?: number; p_limit?: number };
        Returns: AdminUserRow[];
      };
      admin_upsert_plan: {
        Args: {
          p_id: string;
          p_name: string;
          p_credits: number;
          p_duration_days: number;
          p_price_cny: number;
          p_description?: string | null;
          p_sort_order?: number;
        };
        Returns: Json;
      };
      admin_set_plan_enabled: { Args: { p_id: string; p_enabled: boolean }; Returns: Json };
      admin_upsert_model: {
        Args: {
          p_id: string;
          p_provider: string;
          p_model_id: string;
          p_display_name: string;
          p_api_base?: string | null;
          p_pricing?: Json | null;
          p_max_output_tokens?: number;
          p_credits_per_call?: number;
          p_is_default?: boolean;
          p_enabled?: boolean;
          p_sort_order?: number;
        };
        Returns: Json;
      };
      admin_upsert_app_type: {
        Args: {
          p_app_type: string;
          p_label: string;
          p_credit_cost: number;
          p_model_override?: string | null;
          p_enabled?: boolean;
        };
        Returns: Json;
      };
      admin_takedown: { Args: { p_app_id: string; p_reason?: string | null }; Returns: Json };
      admin_restore: { Args: { p_app_id: string }; Returns: Json };
      admin_list_reports: {
        Args: { p_status?: string | null; p_offset?: number; p_limit?: number };
        Returns: AdminReportRow[];
      };
      admin_handle_report: { Args: { p_report_id: number; p_action?: string | null }; Returns: Json };
      admin_stats: { Args: Record<string, never>; Returns: Json };
    };
    Enums: {
      app_type_enum: AppTypeEnum;
      app_status_enum: AppStatusEnum;
      html_status_enum: HtmlStatusEnum;
      job_status_enum: JobStatusEnum;
      ledger_reason_enum: LedgerReasonEnum;
      redemption_kind_enum: RedemptionKindEnum;
      redemption_status_enum: RedemptionStatusEnum;
      user_role_enum: UserRoleEnum;
      user_status_enum: UserStatusEnum;
      report_status_enum: ReportStatusEnum;
      membership_status_enum: MembershipStatusEnum;
    };
    CompositeTypes: Record<string, never>;
  };
};
