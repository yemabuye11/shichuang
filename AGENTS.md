# 师创项目协作规范

## 1. 项目范围

师创（`shichuang`）是面向中小学教师的 AI 备课办公台。产品主轴是教案、PPT/课件、办公文档和教材版本知识；互动小应用、每日一练、组卷和题库是并列能力，不应把首页重新做成应用广场。

当前仓库已经包含 React 前端、Supabase Auth/Postgres/Storage、Edge Functions、模型适配器、文档在线编辑与导出、应用广场、每日一练、组卷/题库、充值和教师资源审核模块。当前阶段是内测前收口，优先保证“登录 -> 选择产物 -> 绑定教材（可选） -> 生成 -> 预览/编辑 -> 导出或分享”闭环可用。

## 2. 技术栈与版本边界

- Node.js `>=18.18.0`
- Vite 5、React 18、TypeScript、React Router 6
- MUI 6 + Tailwind CSS 3
- Supabase Auth、Postgres、RLS、RPC、Storage、Edge Functions（Deno/TypeScript）
- TipTap 在线编辑，`docx` 导出 DOCX，`pptxgenjs` 导出 PPTX，Three.js 仅按需加载
- GitHub Pages + GitHub Actions 为当前部署方式；Supabase Edge Functions 承担生成、检索、存储和安全边界

不要升级到 Vite 6、React 19、Tailwind 4，除非先完成架构评审和完整回归。不要把大模型 API Key、`service_role` 或用户数据放进前端、仓库或日志。

## 3. 目录与职责边界

| 目录 | 约定 |
|---|---|
| `src/pages` | 路由级页面和用户流程；页面不得直接访问 Supabase |
| `src/components` | 可复用 UI；数据读写交给 hooks/services |
| `src/services` | 唯一数据访问出口，负责真实/Mock 双模式适配 |
| `src/hooks` | 页面状态、请求生命周期、生成任务状态 |
| `src/types` | 前后端共享语义；文档模型修改时同步 Edge 侧类型 |
| `supabase/migrations` | 幂等数据库变更；新增枚举值必须单独迁移并先提交 |
| `supabase/functions` | 服务端鉴权、模型调用、检索、积分和产物存储 |
| `docs` | PRD、架构、部署、验收、SQL 执行和项目日志 |
| `docs/logs` | 每次任务完成后的结构化工作日志 |

## 4. 产品与工程红线

1. 根路径首页是生成入口（已登录直接进入生成页）；应用广场只能作为独立导航，不得成为默认首页。
2. 教材绑定必须支持“年份/版本/出版社/学科/年级/章节”选择，并能创建教材版本、上传电子教材或补写知识。只有有数据时才显示版本选项，空数据必须提供明确的新增/上传入口。
3. 生成结果必须显著提示“请教师核对”；失败、超时、校验失败和存储失败必须退还预扣积分。
4. 文档类产物必须能在线查看和编辑，并可导出 DOCX/PPTX；Mock 示例不能被当作真实质量验收结果。
5. 教师上传的校本资源、教材电子版和教材知识沉淀是不同概念，数据表、权限和 UI 不能混用。
6. 所有表开启 RLS；积分写操作只能走 `SECURITY DEFINER` RPC；应用 iframe 禁止 `allow-same-origin`。
7. 生成提示词从数据库配置读取；修改提示词后要记录迁移/SQL 版本、适用范围和验证方式。
8. 删除演示数据必须区分种子数据、当前用户真实数据和线上数据库数据，禁止用清空整个表的方式代替定向清理。

## 5. 构建、检查与部署命令

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm run preview

# Edge Function 语法体检（tsconfig 不包含 supabase/functions）
node scripts/check-functions.mjs

# Supabase（需要已登录并 link 到项目）
npx -y supabase db push
npx -y supabase functions deploy <function-name>

# 发布前
git status --short
git add <明确的文件>
git commit -m "说明本次变更"
git push
```

部署前必须确认 GitHub Actions 的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 已配置，Supabase 迁移和 Edge Functions 已发布，模型密钥只存在 Supabase Secrets。不要把用户提供的 PAT 写入 remote、源码或日志。

## 6. 角色分工

- 产品经理：维护 `docs/PRD_REMAINING.md`，冻结用户故事、P0/P1 范围和验收标准；涉及定价、版权、数据使用先取得确认。
- 架构师/交付总监：维护依赖顺序、迁移顺序、环境清单、回滚方案和内测门禁。
- 前端工程师：负责首页/生成页/教材选择与上传入口、生成进度、文档查看编辑导出；不得改 Edge 业务逻辑。
- 后端工程师：负责教材版本/知识/上传解析、生成 Edge、提示词和 RPC/RLS；不得绕过积分 RPC。
- QA：按 PRD 验收标准做 Mock、真实 Supabase、移动端、分享链接、失败退款和权限回归。
- 运维/发布：负责 Supabase SQL、Secrets、Functions、GitHub Actions、Pages 和上线验证。

同一文件只允许一个明确 owner。跨角色修改必须先在日志记录影响面和回归范围。

## 7. 日志规范

每次任务完成后，在 `docs/logs/` 新建一个 Markdown 日志，文件名使用 `YYYY-MM-DD-<short-slug>.md`。日志必须包含：

```md
# YYYY-MM-DD 任务日志：<标题>

- 日期：YYYY-MM-DD
- 角色：产品经理 / 架构师 / 工程师 / QA / 交付总监 / 运维
- 任务：<目标>
- 完成内容：<事实描述>
- 修改的文件：<逐项列出；若没有写“无”>
- 验证：<命令、结果或未执行原因>
- 遗留问题：<没有写“无”>
- 下一步：<明确动作和 owner>
```

日志只记录事实，不粘贴密钥、完整用户数据或未经脱敏的错误响应。未完成任务也要写清阻塞原因，不能用“已完成”掩盖未验证状态。

