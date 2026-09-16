# 2026-09-16 任务日志：教材空库入口与生成鉴权修复

- 日期：2026-09-16
- 角色：工程师 / QA / 交付总监
- 任务：修复线上生成请求被判定为未登录的问题，并让空教材库可直接完成教材绑定。
- 完成内容：生成请求会在会话缺失或临近过期时刷新 JWT，并通过 Supabase 官方 `functions.invoke` SSE 通道发送请求；收到 401 时仅刷新并重试一次，避免重复提交生成。定位到 `generate` Edge Function 用 `service_role` 调用依赖 `auth.uid()` 的额度/并发与预扣 RPC，已改为调用方 JWT 客户端，可信写入仍保留 `service_role`。教材级联空库增加常用版本快捷创建，以及手动新建和上传电子教材入口；教材正文仍保持待核对状态。补充了已有数据场景下的常用版本入口、重复版本复用和切换筛选时清除旧绑定，避免“界面筛选已变、请求仍带旧教材 ID”。积分账户和顶部用户信息统一使用 `get_my_summary()` 返回的有效余额，过期体验分不再继续显示。Mock PPT 示例补齐为 12 页、图表、表格和逐页讲者备注，便于无真实模型额度时验收页面与导出链路。
- 修改的文件：
  - `src/services/generateService.ts`
  - `src/components/generate/TextbookCascade.tsx`
  - `src/services/creditService.ts`
  - `src/services/authService.ts`
  - `supabase/functions/_shared/llm/mock.ts`
  - `supabase/functions/generate/index.ts`
  - `docs/logs/2026-09-16-textbook-auth-quality.md`
- 验证：`npm run typecheck` 通过；`npm run build` 通过（Vite 5.4.21，只有既有大 chunk 提醒）；`node scripts/check-functions.mjs` 通过（45/45）；线上已验证空库快捷版本可创建并绑定，当前生成页可读取已创建版本。尚未在本轮消耗真实积分生成 PPT。
- 遗留问题：真实 PPT 生成仍需要账号有可用积分和线上模型 Secrets；教师资源审核通过后尚未自动注入生成检索上下文；Storage `textbooks` 桶仍需按 `docs/0047_textbook_storage_policies.md` 在控制台创建 4 条策略。
- 下一步：运维确认 GitHub Actions 发布本轮前端；QA 在已登录且有可用积分的账号验证教材绑定、生成鉴权、PPT 页数/图表/备注、预览、编辑、PPTX 导出和失败退款；后端评估教师资源审核内容接入检索的范围。
