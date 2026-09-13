# 本次要上传的文件清单（2026-09-14）

> 一句话：**代码不用你挑文件上传，你只需要"粘 7 段 SQL + 部署 1 个函数 + 发布一次前端"。**
> 下面按"传到哪里"分成四类，每类都给了确切文件。**按顺序做，不要跳。**

---

## ⚠️ 先确认一件事：你仓库现在没有绑定远端

我查过了，`git remote -v` 是**空的**——这个项目还没连到 GitHub/Gitee 任何仓库。

所以：
- 如果你说的"上传"是**把代码存到 GitHub 备份** → 看下面 **D 类**（要先建仓库，我给了命令）
- 如果你说的"上传"是**让改动在线上生效、好去试跑** → 看 **A / B / C 类**，这才是你要做的

---

## A 类 · 粘到 Supabase 的 SQL 编辑器

**位置**：`supabase/migrations/`（共 29 个文件）

**做法**：进 Supabase 项目 → 左侧 **SQL Editor** → New query → 把文件内容整段粘进去 → Run。一个文件执行一次。

### ✅ 完整 29 个文件名（严格按此数字顺序粘，别照文件夹显示的顺序）

> ⚠️ **文件夹里文件名排序可能是乱的**（如先显示 0016、0017 才显示 0013、0014、0015），一定要按下面这个数字升序，**否则会报错**。

```
0001_extensions_enums.sql
0002_profiles_credit.sql
0003_apps.sql
0004_social_views_likes_reports.sql
0005_prompt_templates_model_profiles.sql
0006_system_config_seed.sql
0007_jobs_daily_events.sql
0008_rpc_credit.sql
0009_rpc_apps_social_admin.sql
0010_rls_policies.sql
0011_seed_prompt_templates.sql
0012_category_and_docs.sql
0013_textbook_versions.sql
0014_textbook_knowledge.sql
0015_rls_docs_textbook.sql
0016_seed_doc_prompts.sql
0017_doc_library.sql
0018_doc_storage_rls.sql
0019_doc_credit_cost.sql
0020_credit_expiry.sql
0021_admin_users.sql
0022_recharge_self.sql
0023_3d_scope.sql
0024_doc_prompt_fix.sql
0025_generation_guardrails.sql
0026_chart_block.sql
0027_geometry_kernel.sql
0028_lesson_plan_higher_order.sql
0029_credit_cost_double.sql
```

**如果你第一次建库**：上面 29 个**全部**按顺序粘一遍。
**如果你之前已经建过库（跑过 0001–0022）**：只补 **0023 → 0029** 这 7 个（就是上面清单的最后 7 行）。

**顺序不能乱，按顺序粘这 7 个：**

| # | 文件名 | 作用（不跑会怎样） |
|:--:|---|---|
| 1 | `0023_3d_scope.sql` | 3D 只留几何体/分子。**不跑 = 继续出假模型**（sin·cos 曲面 / 蓝方块+橙球） |
| 2 | `0024_doc_prompt_fix.sql` | 拆掉打架的提示词 + 输出量翻倍。**不跑 = 生成失败率高，教案仍是"骨架"** |
| 3 | `0025_generation_guardrails.sql` | 月度阀 ¥100→¥1000 + 拦"整学期"。**不跑 = 约 3300 次就全站停服** |
| 4 | `0026_chart_block.sql` | PPT 出真图。**不跑 = 课件里仍只有"建议配图：XX"** |
| 5 | `0027_geometry_kernel.sql` | 3D 标注按公式重算。**不跑 = 数学数值仍由 AI 编，可能算错** |
| 6 | `0028_lesson_plan_higher_order.sql` | 教案标认知层级 + 高阶占比 ≥1/3。**不跑 = 没有抖音那个画面** |
| 7 | `0029_credit_cost_double.sql` | 积分翻倍（教案 2→4、PPT 3→6、3D 4→8）。**不跑 = 赠送成本控制失效** |

> 📌 **如果是第一次建库**，前面还有 `0001`–`0022`，要**从 0001 一路粘到 0029**，共 29 个文件。
> 已按 `docs/GO_LIVE_CHECKLIST.md` 建过库的，只补 0023–0029 即可。

✅ **跑完立刻生效，不用部署任何东西。**

---

## B 类 · 部署到 Supabase Edge Functions（只需 1 个函数）

**只需要部署 `generate` 这一个函数。**

```bash
supabase functions deploy generate
```

它会自动带上这些被改过的配套模块（**你不用单独传**）：

| 文件 | 说明 |
|---|---|
| `supabase/functions/_shared/doc/geometryKernel.ts` | 🆕 3D 几何计算内核（**这是本次唯一"必须部署"的原因**） |
| `supabase/functions/_shared/doc/render.ts` | 备份 HTML 渲染 |
| `supabase/functions/_shared/doc/types.ts` | 类型 |
| `supabase/functions/_shared/doc/exportMap.ts` | 导出 |
| `supabase/functions/_shared/prompt/compose.ts` | 提示词组装 |
| `supabase/functions/_shared/config.ts` | 配置兜底 |
| `supabase/functions/generate/index.ts` | 生成主流程（含"整学期"拦截） |

> 首次上线的还要额外部署 `serve-app`（负责分享页）：
> ```bash
> supabase functions deploy serve-app
> ```

---

## C 类 · 前端发布（整包，不是挑文件）

前端改动不能单个文件上传，要**整体重新构建再发布**。

```bash
npm run build
```

构建完会生成 `dist/` 文件夹，**把 `dist/` 里的全部内容**传到你用的静态托管（GitHub Pages / Cloudflare Pages）。

**本次前端改动涉及这些文件**（供你核对，不用手动传）：

| 文件 | 说明 |
|---|---|
| `src/components/editor/BloomChip.tsx` | 🆕 认知层级标签 + 「高阶活动占比」大数字 |
| `src/components/editor/ChartBlockView.tsx` | 🆕 函数图像/折线/柱状（纯 SVG，课件终于有图） |
| `src/utils/geometryKernel.ts` | 🆕 浏览器端几何计算内核 |
| `src/components/editor/DocRenderer.tsx` | 渲染接入 |
| `src/components/editor/ThreeViewer.tsx` | 3D 查看器（不支持类型不再加载 747KB） |
| `src/components/editor/RichTextEditor.tsx` | 修"编辑后认知层级丢失"的 bug |
| `src/pages/DocEditorPage.tsx` | 编辑页 |
| `src/pages/GeneratePage.tsx` | 生成页（修"显示 2 分实际扣 3 分"） |
| `src/config/constants.ts` | 积分兜底值同步 |
| `src/types/doc.ts` | 类型 |
| `src/services/exportService.ts` | 导出 |
| `scripts/check-functions.mjs` | 🆕 自检脚本 |

---

## D 类 · 把代码备份到 GitHub（可选，但建议做）

现在**没有远端**，所以代码只在你本机。**建议传一份到 GitHub**，一是防丢，二是 GitHub Pages 可以直接用它发链接。

**第 1 步**：去 github.com 新建一个空仓库（**不要勾 README / .gitignore**，保持全空），记下地址，形如：
`https://github.com/你的用户名/shichuang.git`

**第 2 步**：在本机项目目录跑这三条：

```bash
git remote add origin https://github.com/你的用户名/shichuang.git
git branch -M main
git push -u origin main
```

以后每次改完想备份：
```bash
git push
```

---

## 📋 附：本轮全部改动（8 个提交 / 28 个文件，供你核对）

```
2d30181  fix(3d)     3D 收缩到 geometry/molecule，不支持类型给诚实提示
156e097  feat(prompt) 拆出 doc 专用提示词；输出上限 8000→16000
58f6058  feat(guard)  拦截"整学期/全册"（扣积分前秒回）；月度阀 100→1000
90b4dfa  feat(chart)  新增 chart 块（函数曲线/折线/柱状），课件有图了
ac2b56f  feat(geo)    几何确定性计算内核 + 三重自检，数学不再算错
6f7e257  feat(pedagogy) 教案强制标认知层级 + 高阶占比≥1/3 + 互动设计
6c247aa  feat(credit)  全站积分翻倍（教案4/办公4/PPT6/2D6/3D8，应用类 2×）
3f12031  feat(pedagogy) 教案展示认知层级 chip + 高阶占比；修编辑器丢失 bloom
```

---

## ✅ 上传完，立刻验这 4 件事

| # | 操作 | 应该看到 |
|:--:|---|---|
| 1 | 生成"九年级数学 二次函数图像与性质 第1课时"的 **3D 课件** | 只有几何体/分子，**或**橙色「暂未支持」提示。**不能**再是蓝方块+橙球 |
| 2 | 输入"帮我生成九年级数学整学期的教案" | **秒回**"一次只能生成一节课"，**积分不变** |
| 3 | 生成一份 PPT | 有**真正的函数图像**，不是"建议配图"文字 |
| 4 | 生成一份教案 | 顶部有**「高阶活动占比 XX%」**（← 抖音第一条视频的截图） |

**外加一个**：跑圆柱体（半径 3、高 5）的 3D 课件，看是否显示 `体积 V = πr²h ≈ 141.37`。

---

## 🔧 还有一步：挂每日定时任务

建好库后，在 SQL Editor 执行：

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'void-expired-credits-daily',
  '17 3 * * *',
  $$select public.void_expired_credits(null);$$
);
```

（先手动跑一次 `select public.void_expired_credits(null);` 确认不报错，新库应返回 `0`。）
