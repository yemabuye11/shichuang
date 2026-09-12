# 师创 · 一句话做出你的教学应用

面向中小学教师的 AI 教学应用生成平台。老师说一句话，平台调用大模型生成**一个完整可运行的单文件网页应用**，拿到独立 URL，一键发给学生、家长、同事。

- 平台名：**师创**（代号 `shichuang`）
- 端形态：网页 + PWA（手机「添加到桌面」）
- 后端：Supabase（Auth + Postgres + Edge Functions）+ 外部静态托管/CDN
- 商业模式：**会员套餐 + 积分，线下人工充值（兑换码），不做在线支付**

---

## 一、快速开始

### 1. 安装依赖

```bash
npm install
```

> Node ≥ 18.18。本项目锁定 Vite 5 / React 18 / MUI v6 / Tailwind v3，
> **不要升级**到 Vite 6 / React 19 / Tailwind v4（见 `docs/ARCHITECTURE.md` §6 踩坑点）。

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

**最小可用（MOCK 模式）**：什么都不填，直接 `npm run dev`。
此时生成链路自动降级为本地示例应用（不调用真实模型、不产生费用），
可以完整跑通「输入 → 流式生成 → 预览 → 扣积分」全链路。

**接云端**：填 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`（见下一节）。

### 3. 本地开发

```bash
npm run dev      # http://localhost:5173
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览构建产物
npm run icons    # 重新生成 PWA 图标
```

---

## 二、部署步骤（客户建好 Supabase 项目后执行）

### 1. 创建 Supabase 项目

- 区域建议选 **`ap-southeast-1`（新加坡）** 或 `ap-northeast-1`（东京），国内延迟相对低；
  ⚠️ **项目创建后区域不可更改**，第一步就要选对。
- 记下 `Project URL` 与 `anon public key`。

### 2. 执行数据库迁移

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>

# 有 Docker：全量重建本地栈并自检
supabase db reset

# 推到云端（推荐，无需本地 Docker）
supabase db push
```

迁移文件（`supabase/migrations/`）：

| 文件 | 内容 |
| --- | --- |
| `0001_extensions_enums.sql` | 扩展 + 全部枚举 |
| `0002_profiles_credit.sql` | 用户 / 积分账户 / **积分流水** / **会员套餐** / **兑换码** / 系统配置 / 注册触发器（邀请码强校验） |
| `0003_apps.sql` | 应用元数据（**不存 HTML 正文**）+ 200KB 硬校验 |
| `0004_social_views_likes_reports.sql` | 点赞 / 浏览去重 / 举报 |
| `0005_prompt_templates_model_profiles.sql` | 提示词版本管理 + 模型配置 + 应用类型配置 |
| `0006_system_config_seed.sql` | 品牌 / 认证 / 积分 / 限额 / 存储 / 套餐 / 模型 种子 |
| `0007_jobs_daily_events.sql` | 生成任务 / 每日计数 / 埋点 |
| `0008_rpc_credit.sql` | 积分原子性：预扣 / 结算 / 退还 / 兑换 / 预估 / 三查 |
| `0009_rpc_apps_social_admin.sql` | 应用 CRUD / 发布 / 点赞 / 广场 / 管理员后台 |
| `0010_rls_policies.sql` | **全表 RLS** + `public_authors` 视图 + 函数授权 |
| `0011_seed_prompt_templates.sql` | **系统提示词 + 8 类子模板 + 自修复模板** |

> 没有 Docker 也可以用 `psql` 直连执行（云数据库的连接串在 Supabase 后台
> Database → Connection string → URI），按顺序执行 0001 → 0011 即可：
> ```bash
> psql "$DATABASE_URL" -f supabase/migrations/0001_extensions_enums.sql
> # ...依次执行到 0011
> ```

### 3. 创建 Storage 桶（影子副本用）

在 Supabase 后台 → Storage 新建桶：

- 名称：**`apps-html`**
- Public：**是**（仅用于 `serve-app` 回源兜底，正常分发走 CDN）

### 4. 配置密钥（Supabase Secrets）

```bash
# 浏览去重哈希盐（必填，任意长随机串）
supabase secrets set SECRET_SALT=$(openssl rand -hex 16)

# 大模型 Key（至少配一家；一家都没配 → 自动降级 MockAdapter）
supabase secrets set DEEPSEEK_API_KEY=sk-xxxxx
supabase secrets set QWEN_API_KEY=sk-xxxxx
# supabase secrets set GLM_API_KEY=xxxxx
# supabase secrets set DOUBAO_API_KEY=xxxxx

# 产物存储：P0 默认 github_pages（零门槛）
supabase secrets set GITHUB_PAGES_TOKEN=github_pat_xxxxx
supabase secrets set GITHUB_PAGES_REPO=owner/repo
supabase secrets set GITHUB_PAGES_BRANCH=main

# 或改用 Cloudflare R2（写入即读 + 出网免费，需 Cloudflare 账号）
# supabase secrets set R2_ACCOUNT_ID=xxxxx
# supabase secrets set R2_ACCESS_KEY_ID=xxxxx
# supabase secrets set R2_SECRET_ACCESS_KEY=xxxxx
# supabase secrets set R2_BUCKET=shichuang-apps
# supabase secrets set R2_PUBLIC_BASE_URL=https://apps.example.com
```

切换存储 provider 只需改数据库配置，**无需改代码**：

```sql
update public.system_config
   set value = jsonb_set(value, '{provider}', '"r2"')
 where key = 'artifact';
```

### 5. 部署 Edge Functions

```bash
supabase functions deploy generate
supabase functions deploy serve-app
supabase functions deploy track-view
```

### 6. 生成数据库类型（可选，覆盖手写版）

```bash
supabase gen types typescript --project-id <ref> > src/types/database.ts
```

手写的 `src/types/database.ts` 与迁移字段完全一致，不覆盖也能正常编译。

### 7. 部署前端

把 `dist/` 推到任意静态托管（Cloudflare Pages / GitHub Pages / Vercel）。
仓库已内置 `.github/workflows/keepalive.yml`（每 3 天唤醒 Supabase，
防「1 周无访问自动暂停」），需要在仓库 Secrets 配置 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY`。

### 8. 建第一位管理员

注册一个账号后，在 Supabase 后台执行：

```sql
update public.profiles set role = 'admin' where id = '<user-uuid>';
```

---

## 三、目录结构

```
src/
├─ config/         品牌 / 环境变量 / 8 类常量 / 积分规则 / 路由常量
├─ types/          领域模型 / API 契约 / Database 类型
├─ services/       ★ 唯一数据访问层（页面禁止直接 import supabaseClient）
│  ├─ authProvider/  password / invite（启用）+ phone / wechat（预留未启用）
│  └─ mock/          MOCK 模式：本地账本 + 伪流式生成 + 示例应用
├─ hooks/          useAuth / useCredits / useSquareList / useMyApps / useDebounce
├─ components/     layout / common /（generate、square、credit、admin 在 T04、T05）
├─ pages/          路由级页面
├─ utils/          format / hash / idb / cover / validateHtml
└─ styles/         Tailwind 指令 + MUI 补充样式

supabase/
├─ migrations/     0001 ~ 0011
└─ functions/
   ├─ _shared/     cors / auth / errors / json / config / supabaseAdmin
   │  ├─ prompt/   loader（60s 缓存）+ compose（固定前缀）
   │  ├─ llm/      types / deepseek / qwen / glm / doubao / mock / pricing / index
   │  ├─ store/    r2 / githubPages / supabaseStorage / index
   │  ├─ validateHtml.ts
   │  └─ cost.ts
   ├─ generate/    SSE 生成主链路
   ├─ serve-app/   回源兜底
   └─ track-view/  浏览计数
```

---

## 四、开发约定（改动前请先读 `docs/ARCHITECTURE.md` §8）

1. **品牌唯一来源**：产品名只能从 `src/config/brand.ts` 读取（运行时由
   `system_config.brand` 覆盖），任何文件不得硬编码产品名。
2. **数据访问唯一出口**：页面组件不得直接 `import { getSupabase }`，一律走 `src/services/`。
3. **积分写操作**：只允许经 `SECURITY DEFINER` RPC（`reserve_credits` / `refund_generation` /
   `redeem_code` / `admin_adjust_credits`），前端**不判断余额是否足够**，只展示预估。
4. **安全红线**：
   - iframe `sandbox="allow-scripts allow-forms allow-popups"`，**绝不出现 `allow-same-origin`**；
   - API Key 只在 Edge Function 进程内，前端 `.env` 只有 URL 与 anon key；
   - 所有表开启 RLS（新表遗漏视为 Bug）；
   - 浏览日志只存 sha256 哈希，不存明文 IP/UA。
5. **提示词调优不用发版**：改 `prompt_templates` 表即可（Edge Function 缓存 60s）。
6. **模型切换不用发版**：改 `model_profiles` 表（模型 ID / 单价 / 峰谷系数 / 按类型路由）。

---

## 五、MOCK 模式说明

当**所有**大模型 API Key 都没配置时：

- Edge Function 侧：`llm/index.ts` 自动降级为 `MockAdapter`，按相同的 SSE 帧格式
  返回一份完整可运行的示例教学应用 HTML，并在日志打印醒目提示；
- 前端侧：未配置 Supabase 时（`VITE_SUPABASE_URL` 为空或 `VITE_ENABLE_MOCK=true`），
  `generateService` 走 `src/services/mock/`，本地账本记录积分预扣与退还。

演示用兑换码：`SC50` / `SC200` / `SC500`（仅 MOCK 模式有效）。

**生产环境请务必删除 `.env.local` 中的 `VITE_ENABLE_MOCK` 或置为 `false`。**

---

## 六、当前进度

- [x] **T01** 项目基础设施与设计系统
- [x] **T02** Supabase 数据层（迁移 + RLS + RPC + 类型 + service 层）
- [x] **T03** Edge Functions 与 AI 生成链路
- [ ] T04 生成主流程页面（首页 / 生成页 / 生成中 / 应用运行页）
- [ ] T05 应用广场 / 我的 / 个人中心 / 管理员后台 + 埋点 + 联调

T04、T05 的路由已搭好，当前为占位页。
