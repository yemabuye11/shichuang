/**
 * 认证 Provider 接口（ARCHITECTURE.md §3.6 Q2）。
 *
 * P0 启用：`password`（邮箱 + 密码，注册走「邮箱验证码」两步校验）。
 * 预留未启用：`phone`（需国内短信服务商 + 企业主体 + 签名报备）、
 * `wechat`（需企业主体认证 ≈300 元/年）。
 *
 * 开关只改 `system_config.auth.providers`，前端按数组渲染，不改结构。
 */

export type AuthProviderId = 'password' | 'phone' | 'wechat';

export interface AuthResult {
  /** 用户 UUID。 */
  userId: string;
  /** 邮箱（若使用邮箱密码）。 */
  email?: string;
  /** 昵称（注册时传入）。 */
  nickname?: string;
}

export interface PasswordSignInPayload {
  email: string;
  password: string;
}

export interface PasswordSignUpPayload extends PasswordSignInPayload {
  nickname: string;
  /** 注册前是否已完成邮箱验证码校验（前端意图标记，真实校验由触发器查库）。 */
  emailVerified?: boolean;
  subject?: string;
  grade?: string;
  school?: string;
}

export interface PhoneSignInPayload {
  phone: string;
  code: string;
}

export interface WechatSignInPayload {
  /** 微信 OAuth 回调携带的 code。 */
  code: string;
}

/**
 * 登录 / 注册调用的统一载荷类型。
 *
 * 包含 `PasswordSignUpPayload`（注册时的昵称 + 邮箱验证标记），
 * 各 Provider 内部自行按 `as` 取出所需字段。
 */
export type AuthPayload =
  | PasswordSignInPayload
  | PasswordSignUpPayload
  | PhoneSignInPayload
  | WechatSignInPayload;

/**
 * 认证 Provider 接口。
 *
 * 所有实现必须导出同名对象并满足该接口；未启用的实现在调用时抛
 * `NOT_ENABLED` 错误码（而不是返回 null），便于前端给出明确中文提示。
 */
export interface AuthProvider {
  /** Provider 标识。 */
  readonly id: AuthProviderId;
  /** 中文显示名。 */
  readonly label: string;
  /** 是否启用（由 `system_config.auth.providers` 决定）。 */
  enabled: boolean;
  /** 登录。 */
  signIn(payload: AuthPayload): Promise<AuthResult>;
  /** 注册。 */
  signUp(payload: AuthPayload): Promise<AuthResult>;
}
