# 2026-09-16 任务日志：教材空库入口与生成鉴权修复

- 日期：2026-09-16
- 角色：工程师 / QA / 交付总监
- 任务：修复线上生成请求被判定为未登录的问题，并让空教材库可直接完成教材绑定。
- 完成内容：生成请求会在会话缺失或临近过期时刷新 JWT，并通过 Supabase 官方 `functions.invoke` SSE 通道发送请求；收到 401 时仅刷新并重试一次，避免重复提交生成。教材级联空库增加常用版本快捷创建，以及手动新建和上传电子教材入口；教材正文仍保持待核对状态。
- 修改的文件：
  - `src/services/generateService.ts`
  - `src/components/generate/TextbookCascade.tsx`
  - `docs/logs/2026-09-16-textbook-auth-quality.md`
- 验证：`npm run typecheck` 通过；`npm run build` 通过；`node scripts/check-functions.mjs` 通过（45/45）。线上已验证空库快捷版本可创建并绑定；真实 PPT 鉴权回归待本次前端发布完成后执行。
- 遗留问题：尚未在本次发布后完成真实 PPT 生成；教师资源审核通过后尚未自动注入生成检索上下文。
- 下一步：运维发布 GitHub Pages 与 generate Edge Function；QA 在已登录账号验证教材绑定、生成鉴权、PPT 页数/图表/备注、导出和失败退款。
