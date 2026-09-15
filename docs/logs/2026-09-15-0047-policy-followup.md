# 2026-09-15 任务日志：调整 0047 Storage 策略执行方式

- 日期：2026-09-15
- 角色：后端工程师 / 运维
- 任务：处理 0047 迁移在 `storage.objects` 上持续报 `must be owner of table objects` 的问题。
- 完成内容：确认报错来自 `DROP/CREATE POLICY`，不是教材桶创建；将 0047 改为只创建私有 `textbooks` 桶和路径归属函数；补充 Storage 控制台创建 4 条策略的逐步说明和验证 SQL。
- 修改的文件：
  - `supabase/migrations/0047_textbook_storage.sql`
  - `docs/0047_textbook_storage_policies.md`
  - `docs/本次要跑的SQL清单.md`
  - `docs/logs/2026-09-15-0047-policy-followup.md`
- 验证：已对照 `0018_doc_storage_rls.sql`、`0034_teacher_resources.sql` 和当前 0047，确认项目历史迁移也直接操作 `storage.objects`；本次错误说明目标项目的 Storage 表 owner 与 SQL Editor 角色不同。未连接目标 Supabase 执行线上操作。
- 遗留问题：4 条策略需要在 Supabase Storage Policies 页面创建；创建前不要测试真实教材上传。
- 下一步：项目负责人运行修正版 0047；在 Storage → Policies 创建策略；验证桶为私有、策略为 4 条后再进行真实上传。
