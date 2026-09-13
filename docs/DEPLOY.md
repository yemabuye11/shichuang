# 师创 (ShiChuang) — 海外版部署指南

> **版本**：v1.0
> **撰写日期**：2026-09-12
> **适用人群**：野马（非程序员）+ 协作工程师
> **目标**：30 分钟内完成从零到上线的全流程

---

## 一、部署架构总览

```
教师浏览器 ──→ GitHub Pages / Cloudflare Pages (前端静态)
                    │
                    ├──→ Supabase (Auth + Postgres + Storage)  [新加坡 ap-southeast-1]
                    │       ├── Database（11 个 SQL 迁移）
                    │       ├── Edge Functions（generate / serve-app / track-view）
                    │       └── Storage（用户上传、doc_json 源文件）
                    │
                    └──→ AI 模型 API（DeepSeek / 通义 / 豆包）
                              └── 客户自购 Key，通过 Edge Function 调用
```

**零现金支出**：所有用到的服务都有免费层；AI 模型 Key 由最终用户（教师/管理员）自行充值。

---

## 二、准备工作（一次性）

### 2.1 注册账号
| 服务 | 用途 | 费用 |
|---|---|---|
| [Supabase](https://supabase.com) | Auth + DB + Storage + Edge Functions | 免费层（500MB DB + 1GB Storage + 5GB 出网） |
| [GitHub](https://github.com) | 代码托管 + GitHub Pages 静态托管 | 免费 |
| [Cloudflare](https://cloudflare.com) | 域名 DNS + 可选 Pages | 免费 |
| [DeepSeek](https://platform.deepseek.com) | AI 模型 API | 客户自充值（约 ¥1/百万 token） |

### 2.2 创建 Supabase 项目
1. 登录 Supabase → New Project
2. **Region 务必选 `Singapore (ap-southeast-1)`** ⚠️ 创建后不可改
3. 设置强密码（**务必保存到密码管理器**）
4. 等待项目就绪（约 2 分钟）

### 2.3 准备域名（可选）
- 推荐：阿里云/腾讯云买一个 `.cn` 或 `.com` 域名（首年约 ¥30–50）
- 用 GitHub Pages 自带 `*.github.io` 子域名也行（零成本）

---

## 三、部署步骤

### 步骤 1：克隆代码并安装依赖

```bash
git clone <your-repo-url> shichuang
cd shichuang
npm install
```

> 如果 `npm install` 损坏，先 `rm -rf node_modules package-lock.json` 再重试。
> 整个安装过程约 5–10 分钟。

### 步骤 2：配置环境变量

在项目根目录创建 `.env`（参考 `.env.example`）：

```bash
# Supabase（从 Supabase Dashboard → Settings → API 复制）
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Edge Function 调用密钥（从 Supabase Dashboard → Settings → API 复制 service_role key，仅 Edge Function 用）
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> ⚠️ `.env` 不要提交到 Git。`.env` 已在 `.gitignore` 中。

### 步骤 3：运行数据库迁移

在 Supabase Dashboard → SQL Editor，按下面两步执行（Supabase SQL Editor 是**逐句 autocommit**，不是整段事务，失败按"已部分执行"处理，详见 `docs/RESET_DB.sql`）：

1. **一次性粘贴执行**合并文件 `docs/ALL_MIGRATIONS_0001-0029.sql`（已按数字序合并、含分隔注释）。
2. **单独执行** `supabase/migrations/0030_siliconflow_provider.sql`（硅基流动适配器）和 `supabase/migrations/0031_storage_apps_html.sql`（补齐 `apps-html` 桶）。

> ⚠️ 不要一个一个跑旧文件名（`0001_init_enums.sql` … `0011_*` 等）——它们已被合并文件取代，单跑会在同一事务内撞 55P04 / 42P13 错误。

**验证**：在 Table Editor 看到以下表即为成功：
- `profiles`, `apps`, `generations`, `redemption_codes`, `system_config`, `monthly_spend`, `prompt_templates`, `app_type_profiles`, `model_profiles`, `reports`

### 步骤 4：Storage Buckets（无需手动建）

运行上面的合并迁移后，以下两个**公开桶会自动建好**，无需手动创建：

| Bucket 名 | 用途 | 公开 | 由谁创建 |
|---|---|---|---|
| `docs` | 文档 HTML / JSON 渲染产物（作者可读写） | Public | 迁移 0018 |
| `apps-html` | 应用/文档 HTML 影子副本（Edge Function 回源兜底） | Public | 迁移 0031 |

> 旧文档写的 `artifacts` / `doc_json` / `textbook_uploads` 已不再使用，请勿手动创建。
> 教材上传功能（T07）正式启用时会再补 `textbook_uploads`，届时会有专门迁移。

### 步骤 5：配置 Edge Function Secrets

在 Supabase Dashboard → Edge Functions → Manage Secrets（**这些密钥只在服务器端使用，从不下发前端**）：

```bash
# AI 模型 Key（客户自购，至少填一个；当前默认 provider 是硅基流动）
SILICONFLOW_API_KEY=sk-xxxxxxxxxxxx
# 如需改用 DeepSeek 官方，再填下面这个（并跑 0030 底部 UPDATE 切默认）
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx

# 月度支出上限阀（默认 1000 元，已在迁移 0025 改为 1000；此处可覆盖）
MONTHLY_SPEND_LIMIT_CNY=1000
# 可选：track-view 统计加盐（不填则用代码内置默认值）
SECRET_SALT=随便一串字符
```

> ❌ 没有 `ARTIFACT_PROVIDER` / `ARTIFACT_TOKEN` 这类变量——产物走 Supabase Storage（`docs` / `apps-html` 桶），不依赖 GitHub 仓库 token。

### 步骤 6：部署 Edge Functions

```bash
# 安装 Supabase CLI（如未装）
npm install -g supabase

# 登录
supabase login

# 关联项目
supabase link --project-ref <your-project-id>

# 部署所有函数
supabase functions deploy generate
supabase functions deploy serve-app
supabase functions deploy track-view
```

### 步骤 7：部署前端到 GitHub Pages

```bash
# 构建生产包
npm run build

# 推送到 GitHub
git add .
git commit -m "Initial deploy"
git push origin main

# 在 GitHub 仓库 → Settings → Pages
# Source 选 GitHub Actions
# 框架预设选 Vite
# GitHub 会自动构建并部署到 https://<username>.github.io/<repo>/
```

> 如果想用自定义域名：在 Pages 设置里填 Custom domain，并按提示配置 DNS（CNAME 指向 `<username>.github.io`）。

---

## 四、部署后验证清单

打开部署好的网址，**逐项确认**：

- [ ] 首页能正常打开，看到 4 个主入口（写教案/做PPT/3D课件/办公文档）
- [ ] 点击"注册"，任意邮箱+密码（≥8位）+任意邀请码，能注册成功
- [ ] 注册后自动登录，跳到 `/me` 页面，看到初始积分
- [ ] 点击"写教案"入口，能进入生成页
- [ ] 输入主题，点击"生成"，能看到进度（4 个阶段动画）
- [ ] 生成完成后能打开预览，看到结构化内容
- [ ] 退出登录后，仍能打开分享链接（未登录可浏览）
- [ ] 管理员后台 `/admin`：用 admin 角色账号登录，能看到用户列表和看板

---

## 五、日常运维

### 5.1 兑换码发放（管理员）
1. 用管理员账号登录
2. 进入 `/admin` → 兑换码 → 生成
3. 选择积分面额（如 50/200/500）和张数
4. 复制码列表，发给教师
5. 教师在 `/me` → 兑换码 → 输入码 → 充值成功

### 5.2 看月度成本
1. `/admin` → 看板
2. 查看"本月 AI 支出"，超过 ¥80 黄色预警、超过 ¥100 红色降级

### 5.3 处理举报
1. `/admin` → 举报
2. 查看被举报内容，确认违规后点击"下架"

### 5.4 重置月度支出
每月 1 号 0 点自动重置（见 `monthly_spend` 触发器）。无需手动操作。

---

## 六、常见问题

### Q1: 生成时报 "API Key 无效"
当前默认 provider 是硅基流动，先检查 Secrets 中的 `SILICONFLOW_API_KEY` 是否正确且账户有余额；若已切到 DeepSeek，再查 `DEEPSEEK_API_KEY`。

### Q2: 注册时报 "Invalid email or password"
邀请码为空。请确保注册时填了任意非空邀请码（演示模式不校验邀请码有效性，但必须非空）。

### Q3: 生成后看不到预览
检查浏览器控制台报错；检查 Supabase Edge Function 日志（Dashboard → Edge Functions → Logs）。

### Q4: 月度支出超限
在 `system_config.limit.monthly_spend_cny` 调高上限（需 admin 权限 SQL 操作），或等待下月重置。

### Q5: 部署到 GitHub Pages 后刷新 404
GitHub Pages 是纯静态托管，不支持 SPA 路由刷新。已在 `vite.config.ts` 配置 SPA fallback，正常访问即可。

---

## 七、回滚方案

如果新版出问题想回滚：
```bash
git revert HEAD
git push
# GitHub Actions 会自动重新部署旧版
```

Edge Function 回滚：
```bash
supabase functions deploy generate --no-verify-jwt  # 重新部署当前代码
# 如需回滚到旧版，用 git checkout 旧版后重新 deploy
```

---

## 八、升级流程

```bash
git pull
npm install  # 拉新依赖
npm run build  # 本地构建确认无错误
git add .
git commit -m "Upgrade"
git push  # 自动部署
```

数据库迁移新增时（如未来加 T06–T08 的表），在 Supabase SQL Editor 跑新迁移文件即可，**无需重新部署前端**（除非前端代码也变了）。

---

## 九、成本估算（月度）

| 项目 | 用量 | 费用 |
|---|---|---|
| Supabase DB | < 500MB | $0 |
| Supabase Storage | < 1GB | $0 |
| Supabase 出网 | < 10GB | $0 |
| Supabase Edge Functions | < 50 万次 | $0 |
| GitHub Pages | < 100GB 出网 | $0 |
| Cloudflare DNS | 任意 | $0 |
| DeepSeek API | 由客户充值 | ¥0（平台不背成本） |
| **合计** | | **¥0** |

> 月活跃 1000 教师的预估用量仍在免费层内。超过免费层会提前告警（看板）。
