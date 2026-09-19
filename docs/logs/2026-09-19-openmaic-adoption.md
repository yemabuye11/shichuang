# 2026-09-19 任务日志：OpenMAIC 式 PPT 两阶段生成适配

- 日期：2026-09-19
- 角色：架构师 / 工程师 / QA
- 任务：分析 OpenMAIC 的可复用能力，并修复导大纲生成 PPT 的失败与质量控制问题。
- 完成内容：确认 OpenMAIC 使用 MIT 许可，可在保留许可声明的前提下修改和商用；未整仓迁移其 Next.js、React 19、Tailwind 4 和 LangGraph 运行时，改为按师创现有 Vite 5、React 18、DocModel 和 pptxgenjs 链路独立实现 Plan → Scene 页面施工图；生成前冻结每页标题、教学功能、版式、覆盖点、视觉表达和课堂动作；每个分段只注入对应三页的施工图；修复短课题大纲被“至少 5 个字”通用校验拦截的线上故障；在线编辑增加自动、封面、内容、双栏/对比、章节过渡版式切换。
- 修改的文件：
  - `supabase/functions/_shared/doc/pptPlan.ts`
  - `supabase/functions/generate/index.ts`
  - `scripts/check-ppt-plan.mjs`
  - `src/components/editor/SlideEditor.tsx`
  - `package.json`
  - `docs/OPENMAIC_ADAPTATION.md`
  - `THIRD_PARTY_NOTICES.md`
- 验证：`npm run typecheck` 通过；`npm run build` 通过；`node scripts/check-functions.mjs` 为 46/46 通过；`npm run check:ppt-plan` 为 5 组行为断言通过；线上使用二年级语文 6 页大纲完成真实生成，73 秒内成功，结果严格为 6 页，低龄图表已转换为童趣图标卡。
- 遗留问题：多智能体课堂、TTS 语音授课和自包含交互 HTML 尚未接入；需要在后续独立评审安全边界、播放引擎和移动端策略。
- 下一步：发布前端版式编辑能力，完成在线编辑、保存新版本和 PPTX 导出回归，并补充真实教师大纲回归集。
