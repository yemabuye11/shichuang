# 师创 (ShiChuang) — 上线速查卡 / 接手手册

> **用途**：① 野马（非程序员）照着从零上线；② 万一换 agent / 协作者接手，凭本文档即可无缝继续，不必从头问。
> **最后更新**：2026-09-13（首版，含真实踩坑记录）
> **当前状态**：✅ 已上线。线上地址 `https://yemabuye11.github.io/shichuang/`

---

## 0. 接手前必读 · 关键事实

| 项 | 值 |
|---|---|
| 本地仓库根目录 | 师创项目根（含 `src/` `supabase/` `docs/` `.github/`） |
| GitHub 仓库 | `yemabuye11/shichuang`（`https://github.com/yemabuye11/shichuang`） |
| 线上地址（GitHub Pages） | `https://yemabuye11.github.io/shichuang/` |
| Supabase 项目 ref | `mmhoztwicjrxkcjfwrjk` |
| Supabase 区域 | `ap-southeast-1`（新加坡，**创建后不可改**） |
| Supabase 项目 URL | `https://mmhoztwicjrxkcjfwrjk.supabase.co` |
| 默认大模型 provider | **硅基流动（SiliconFlow）**，模型 `deepseek-chat`；密钥 `SILICONFLOW_API_KEY` |
| 后端 Edge Functions | `generate` / `serve-app` / `track-view`（三个，均 ACTIVE） |
| Storage 公开桶 | `docs`（迁移 0018）、`apps-html`（迁移 0031） |
| 数据库迁移 | `0001`–`0031` 共 31 个；合并文件 `docs/ALL_MIGRATIONS_0001-0029.sql`（不含 0030/0031） |
| 前端构建 | Vite + PWA；部署走 GitHub Actions（`deploy.yml`），base 按仓库名自动算 |
| 邀请码 | **注册必须填邀请码**；教师试用前需先在后台生成一批 |

**技术红线（任何改动都别破）**：
- 前端只能出现 `VITE_` 开头的值（URL + anon key）。`service_role`、大模型 API Key **只在 Supabase Secrets**，绝不下前端/仓库。
- `supabase` 命令在用户机器上未全局安装 → 一律用 `npx -y supabase ...`。
- 单文件 ≤ 200KB；`three.module`(~747KB) 已排除出 SW precache。
- Supabase 项目区域 `ap-southeast-1`；PG RLS 全表开启。

---

## 1. 完整上线流程（从零到可访问）

> 以下任一步失败，见第 3 节「踩坑清单」对号入座。

### 1.1 建 Supabase 项目
1. Supabase 官网 → New Project。
2. **Region 选 `Singapore (ap-southeast-1)`**（最便宜+国内访问友好，不可改）。
3. 设强密码存密码管理器。免费层限制：2 个活跃项目/账号（跨组织计）；第 3 个建不了时，新建一个 Free Plan 组织拿额度。

### 1.2 跑数据库迁移（SQL Editor 一次性）
1. Supabase → SQL Editor，粘贴执行 `docs/ALL_MIGRATIONS_0001-0029.sql`（已按数字序合并，逐句 autocommit）。
2. 再单独执行 `supabase/migrations/0030_siliconflow_provider.sql`（硅基流动适配器）和 `0031_storage_apps_html.sql`（补 `apps-html` 桶）。
3. ⚠️ 不要一个一个跑旧文件名（`0001_init_enums.sql`…），会撞 55P04/42P13。失败按"已部分执行"处理 → 见 `docs/RESET_DB.sql` 恢复后重跑。

### 1.3 配置 Edge Function Secrets
Supabase → Edge Functions → Manage Secrets（只在服务器端，绝不下前端）：
```
SILICONFLOW_API_KEY=sk-xxxxxxxxxxxx      # 当前默认 provider，必填
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx        # 可选，切 DeepSeek 时填
MONTHLY_SPEND_LIMIT_CNY=1000            # 月度花费上限，默认 1000
SECRET_SALT=随便一串字符                # 可选，track-view 加盐
```

### 1.4 部署三个 Edge Functions
**必须在项目根目录（有 `supabase/` 的目录）下执行**：
```bash
npx -y supabase functions deploy generate
npx -y supabase functions deploy serve-app
npx -y supabase functions deploy track-view
```
（`npx -y` 自动下载 CLI；首次会让你选项目，Enter 选 `mmhoztwicjrxkcjfwrjk` 即可。`Docker is not running` 警告对 deploy 无害。）

### 1.5 建 GitHub 仓库并推送
1. github.com → New repository，名 `shichuang`，**三个勾选都不要勾**（README/.gitignore/license）。
2. 本地（PowerShell，先 `cd` 到项目根）：
```bash
git remote add origin https://github.com/yemabuye11/shichuang.git
git branch -M main
git push -u origin main
```
（push 需 GitHub Personal Access Token 当密码，详见第 2 节重新认证。）

### 1.6 加两个仓库 Secrets（构建时注入前端）
仓库 → Settings → Secrets and variables → Actions → New repository secret：
| Name | Secret |
|---|---|
| `VITE_SUPABASE_URL` | `https://mmhoztwicjrxkcjfwrjk.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API 的 `anon` `public` key |

### 1.7 开启 Pages
仓库 → Settings → Pages → **Source 选 `GitHub Actions`**（是下拉框，不是蓝色链接）→ Save。
（⚠️ 别点页面里带 "GitHub Actions" 字样的 Enterprise 推广链接，会跳到付费试用页。）

### 1.8 重跑部署工作流
首推时 1.6/1.7 往往还没做，首次 workflow 会红叉。配好后：
仓库 → Actions → 最新的 run → **Re-run all jobs**。绿勾即成功（约 2–3 分钟）。

### 1.9 开第一道门：建首个管理员 + 邀请码（部署后必做，否则谁都登不进）
> ⚠️ **上线时最容易漏的一步**。数据库默认**没有任何账号、没有任何邀请码**；而注册必须填邀请码、邀请码又只能管理员生成 → 卡死。必须先用 SQL 开这第一道门（完整脚本见 `docs/BOOTSTRAP_FIRST_ADMIN.sql`）。
1. Supabase → SQL Editor 跑引导邀请码插入（见 BOOTSTRAP 文件 Step 1：`insert ... 'SHICHUANG'`）。
2. 网站注册（邮箱+密码+邀请码 `SHICHUANG`）→ 建好你的普通账号（初始 100 积分）。若 github.io 打不开，改用 Supabase 后台 Auth → Add user 并在 User Metadata 填 `{"invite_code":"SHICHUANG"}`。
3. Supabase → SQL Editor 把你自己升为管理员（见 BOOTSTRAP 文件 Step 3，邮箱换成你注册的）。
4. 重新登录，后台出现「管理员」入口 → 生成教师邀请码（kind=invite）批量发。

### 1.10 验证（4 项）
- [ ] 首页 `https://yemabuye11.github.io/shichuang/` 正常显示
- [ ] 注册（**需邀请码**，先用后台生成的）
- [ ] 生成一份教案/PPT，是真内容非 mock
- [ ] 生成应用后，未登录打开分享链接能看

---

## 2. 以后怎么更新（git push 流程）

**核心认知**：代码改动**不会自动**上 GitHub。流程是 `改文件 → git commit(本地) → git push(上传) → Actions 自动部署`。只有最后一步"部署"是自动的，且由 push 触发。

### 2.1 常规更新（已配好凭据时）
```bash
git add .
git commit -m "改了什么"
git push
```
push 成功后 GitHub Actions 自动重建并发布，无需手动操作。

### 2.2 重新认证（token 轮换 / 新机器 / 凭据失效）
GitHub 已不支持用登录密码 push，必须用 **Personal Access Token (classic)**，且**必须勾 `repo` + `workflow` 两项权限**（缺 `workflow` 推含 Actions 工作流文件的提交会被 403 拒）。

**方式 A（最省事，绕过凭据缓存）——临时把 token 写进地址：**
```bash
git remote set-url origin https://yemabuye11:<新TOKEN>@github.com/yemabuye11/shichuang.git
git push
git remote set-url origin https://github.com/yemabuye11/shichuang.git   # 推完抹掉 token
```
> ⚠️ `<新TOKEN>` 只填 `ghp_...` 本身，**前后不要带尖括号 `<>`**，也不要留空格。

**方式 B（一劳永逸）——清缓存 + 凭据管理器：**
1. Windows → 控制面板 → 凭据管理器 → Windows 凭据，删掉 `git:https://github.com`。
2. 重新 `git push`，弹窗时用户名填 `yemabuye11`，密码填新 token，凭据管理器会记住。

### 2.3 谁来做 push
- 野马本人在 PowerShell 跑；或让 agent 协助跑（agent 可远程带着执行，但**上传那一下需要有效 token**，token 由野马掌握）。
- agent 能做的：改文件、`git commit`、写命令。agent **不能**在无凭据时偷偷 push。

---

## 3. 踩坑清单（接手 agent 避坑，按症状查）

| # | 症状 | 根因 | 解决 |
|---|---|---|---|
| 1 | `supabase : 无法将"supabase"项识别为 cmdlet` | 用户机器没全局装 CLI | 所有命令前缀 `npx -y supabase`（自动下载） |
| 2 | `unknown switch 'M'` | 多条命令挤在一行粘贴 | **每条命令单独一行、各自回车** |
| 3 | `remote origin already exists` / `你的用户名` 占位符 | remote 残留错误 URL（占位符未替换） | `git remote set-url origin https://github.com/yemabuye11/shichuang.git` |
| 4 | push `403 denied to yemabuye11` | token 缺 `workflow` 权限（仓库含 Actions 工作流文件） | 重新生成 token，勾 `repo`+`workflow` |
| 5 | `Password authentication is not supported` | Windows 凭据管理器缓存了旧**密码** | 把 token 写进 remote URL 强推（方式 A），或清凭据管理器（方式 B） |
| 6 | `Invalid username or token` | 误把占位符尖括号 `<新TOKEN>` 一起粘进 token | 去掉 `<>` 只留 `ghp_...` |
| 7 | `Connection was reset` / `Recv failure` | 国内连 GitHub 网络抖动（首推整仓历史时常见） | `git config --global http.postBuffer 1048576000` 后重试 |
| 8 | Pages 设置页跳到 Enterprise 试用 | 点成了 "GitHub Actions" 推广链接 | 正确做法：Pages 页 **Source 下拉框**选 `GitHub Actions` |
| 9 | 首推 workflow 红叉（`Ensure GitHub Pages has been enabled`） | 首推时 Secrets/Pages 未就绪 | 配好 1.6/1.7 后 Actions → **Re-run all jobs** |
| 10 | 部署后白屏/连不上 Supabase | 两个仓库 Secrets 没加或填错 | 核对 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`（见 1.6） |
| 11 | 注册报 "Invalid email or password" | 邀请码为空 | 注册时填任意非空邀请码（先用后台生成） |

> 历史教训：① 新增枚举值一律在 `0001` 创建时一次带全，别用 `ALTER TYPE ADD VALUE`（会让合并粘贴必炸）② 改返回结构的函数用 `drop+create`，别 `create or replace`（42P13）③ 换服务商=换对应 `<PROVIDER>_API_KEY` 即时生效；换默认模型改 `model_profiles.is_default`（SQL）。

---

## 4. 安全边界（给野马/接手者）

- **密钥安全**：LLM Key、`service_role` 只在 Supabase Secrets，仓库/前端都拿不到。抄代码也动不了用户。
- **公开仓库 vs 私有**：默认 Public（源码可见）。想藏源码 → 仓库 Settings → Danger Zone → Make private（Pages 照常能用，免费账号私有仓库支持）。
- **泄露即 revoke**：任何 token 一旦出现在聊天/截图，立刻去 GitHub → Developer settings → PAT → Revoke，换新。
- **防滥用两闸**：注册需邀请码 + 月度花费上限 ¥1000。

---

## 5. 给老师的试用说明（野马发放前）

1. 先在后台生成一批**邀请码**发给老师（注册必须填）。
2. 把线上地址 `https://yemabuye11.github.io/shichuang/` 发给老师。
3. 老师注册 → 登录 → 选功能（写教案/做PPT/3D课件/办公文档）→ 生成。
4. 收集老师反馈（哪些功能要完善），再决定迭代。

---

## 附：常用命令速查

```bash
# 本地构建预览（不改线上）
npm run build && npm run preview

# 部署 Edge Function（改了 supabase/functions 后）
npx -y supabase functions deploy <函数名>

# 推代码上线
git add . && git commit -m "说明" && git push

# 查看线上部署状态
# 打开 GitHub 仓库 → Actions 标签看最新 run
```
