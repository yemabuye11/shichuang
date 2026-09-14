# 每日一练（T10）功能大纲 —— 已拍板版

> 状态：**已拍板，P0 开工中**
> 日期：2026-09-15
> 代号：T10
> 一句话：老师选教材章节（或上传自己的题目）→ 生成一套客观题练习 → 一条链接发给学生 → 学生点开就做（免登录）→ 老师看完成情况与正确率，并能**导出下载记录**作支撑材料。

---

## 零、野马 2026-09-15 拍板结论（不再改动）

| # | 议题 | 拍板 |
|---|---|---|
| 1 | 命名 | **每日一练**（不叫"作业"，合规） |
| 2 | 完成记录 | **可下载导出**（作为练习完成的支撑材料）→ 导出从 P1 提到 **P0** |
| 3 | 折扣 | **下限 6 折** OK，按 5.2 阶梯走 |
| 4 | 题型 | P0 **只做客观题**，**重点是选择题 + 填空题**（判断可有，解答题留 P1） |
| 5 | 学生端 | **免登录**（昵称/学号后 4 位可选填） |
| 6 | 教师反馈（评语） | 按原建议 **放 P1**，P0 只做"完成情况 + 正确率" |
| 7 | 首批学科 | **小学二年级语文**（先做这一个，跑通再扩） |
| 8 | **新增** | 老师**上传题目**入口：提供**可下载的模板**，老师按模板填 → 上传 → **AI 识别**成结构化题目 → 老师预览核对 → 保存 |
| 9 | 识别方式 | **AI 识别**（不要求老师严格按格式）；模板规整时给"不用 AI、直接解析（省积分）"的入口 |

---

## 一、合规：为什么叫"每日一练"而不是"作业"

中小学语境里"布置作业"是敏感词（不得要求家长批改、不得强制在线打卡）。统一口径：**学生自愿的能力提升练习 / 课堂小测**。

| 原来会说 | 改成 |
|---|---|
| 布置作业 | 生成练习 / 发布练习 |
| 交作业 | 提交练习 |
| 今日作业 | 今日一练 |
| 催交、打卡、排名 | 不出现 |

**文案红线（产品里一律不出现）**：请家长督促 / 家长签字 / 必须完成 / 打卡 / 排名 / 未完成名单公示。

**数据最小化**：学生不强制实名（昵称或学号后 4 位，教师可选开）；教师可一键清空某次练习的提交数据；链接可设有效期、可随时关闭作答。

---

## 二、两条出题路径

### 路径 A：AI 生成
教材章节 → 天数 → 题型难度 → 确认积分 → 生成 → 预览核对 → 发布拿链接。
（复用 T07 教材级联选择组件 `src/components/generate/TextbookCascade.tsx`，P0 不扩展组件维度，章节用文本框。）

### 路径 B：老师上传（新增）
1. **下载模板**（页面上按钮，浏览器本地生成 CSV，带 BOM，Excel/WPS 直接打开）
2. 老师按模板填题目（或直接把 Word 里的题目**粘贴进文本框**）
3. 上传 → **AI 识别**成结构化题目
4. **预览核对**（可增删改每一题）→ 保存 → 发布拿链接

### 模板格式（CSV）

```
题型,题干,选项A,选项B,选项C,选项D,答案,解析
单选,"下列加点字读音正确的一项是（ ）","A. 朝霞(zhāo)","B. 应该(yìng)","C. 兴奋(xīng)","D. 长大(cháng)",A,"朝：zhāo"
填空,"照样子写词语：又__又__",,,,,"又大又红|又香又甜","答案不唯一，符合即可"
判断,"《坐井观天》是一则寓言故事。（ ）",,,,,"对",""
```

- **题型**取值：`单选` / `填空` / `判断`（二年级语文以单选 + 填空为主）
- **选项**：填空题、判断题留空
- **答案**：单选填 `A`/`B`/`C`/`D`；判断填 `对`/`错`；填空多个空用 `|` 分隔
- **解析**选填
- 模板第一行是示例题，老师照着改即可；CSV 带 UTF-8 BOM 防 Excel 中文乱码

### AI 识别的成本与省钱
- 题目是老师自己的，AI 只做**结构化**，不创作 → 输入约 1~3k token、输出 1~2k token，谷段成本约 **¥0.002~0.005**
- 定价：**0.5 积分/次**（后台可配，不按天数）
- **模板规整时先本地规则解析，不调模型**（0 成本），页面上给"直接解析（省 0.5 积分）"按钮；解析不出或老师要容错就走 AI

---

## 三、学生端（链接形态）

- 页面路径 **`/p/{slug}`**，是**平台壳渲染**（前端路由 + 读表），不走静态产物托管
- 手机、电脑点开就做，**不注册、不下载、不加群**
- 多天练习按「第 1 天 / 第 2 天…」分段，一次提交一天
- 提交后立刻看到"对了几题" + 每题解析（**未提交前拿不到答案和解析**）
- **答案校验一律在服务端**（RPC 判分），前端不持有答案

---

## 四、教师端看板

- **谁做了**：昵称、提交时间、用时、得分
- **掌握情况**：每题正确率、高频错题
- **导出下载**（P0）：一键导出 CSV（完成名单 + 每题作答明细），带 BOM
- 可随时关闭作答 / 清空提交数据

---

## 五、积分（不能让你亏）

### 5.1 成本基线（沿用实测）

| 项目 | 数值 |
|---|---|
| 单次"教案级"生成成本（谷段） | 约 ¥0.02 |
| 同样生成在高峰 | 约 ¥0.04 |
| 综合每积分成本基准 | ¥0.030（最坏 ¥0.048，最好 ¥0.018） |
| 1 积分对账价 | ¥0.05 |

学生提交与查看**不调模型**，零成本。

### 5.2 AI 生成定价（折扣下限 6 折）

| 天数 | 原价 | 折扣 | 实收 |
|---|---|---|---|
| 1 天 | 1 | 不打折 | **1 积分** |
| 3 天 | 3 | 9 折 | **2.7 积分** |
| 5 天 | 5 | 8.4 折 | **4.2 积分** |
| 10 天 | 10 | 6.8 折 | **6.8 积分** |
| 20 天 | 20 | 6 折 | **12 积分** |

**为什么不亏**：一次生成多天时，教材上下文/系统提示词只算一次且能命中缓存，10 天实际成本约为单天的 3~4 倍（谷段 ¥0.06~0.10，高峰 ¥0.12~0.16），而收入 ¥0.34 → 毛利 50%~80%。天数越多单位成本越低，折扣是踏实的。

### 5.3 上传识别定价
**0.5 积分/次**（与天数无关，后台可配）。成本 ¥0.002~0.005，收入 ¥0.025 → 毛利 80%+。

### 5.4 配置化（不写死代码）
- 新增内容类型 `daily_practice` → 插一行 `app_type_profiles`，现有后台「内容类型积分」Tab 自动出现，可随时改价
- 新增 `system_config` 键 `practice`，结构：
  ```json
  {
    "dayTiers": [1, 3, 5, 10, 20],
    "discountByDays": {"1": 1, "3": 0.9, "5": 0.84, "10": 0.68, "20": 0.6},
    "minDiscount": 0.6,
    "importCostCredits": 0.5
  }
  ```
  后台新增「每日一练」配置 Tab 读写它（复用 `get_system_config` / `admin_set_system_config`）
- **学生提交不扣老师积分**

---

## 六、数据模型（迁移 `0038_practice_daily.sql` + `0038a_enum_daily_practice.sql`，均幂等可重跑）

> ⚠️ **迁移运行顺序（在 Supabase SQL Editor 手动执行）**：
> 1. **先跑 `0038a_enum_daily_practice.sql`** —— 单独向 `app_type_enum` 提交枚举值 `daily_practice`；
> 2. **再跑 `0038_practice_daily.sql`** —— 写入 `app_type_profiles` 定价行 + 建三张表 + RLS + 4 个 RPC；
> 3. **最后跑 `0039_credit_decimal.sql`** —— 把积分字段改 `numeric`（支持小数积分）。
>
> 原因：PostgreSQL 禁止在同一事务内「新增枚举值」后立刻「使用该枚举值」，否则报
> `55P04: unsafe use of new value`。SQL Editor 把整段当单事务，故枚举加值必须拆成独立文件先提交。
> 三个文件都带幂等保护，可反复粘贴运行不报错。

```sql
practices           -- 练习集
  id uuid pk, owner_id uuid, title text, subject text, grade text,
  textbook_version_id uuid null, chapter text, day_count int default 1,
  source text default 'ai',          -- 'ai' | 'upload'
  status text default 'draft',       -- 'draft' | 'published' | 'closed'
  share_slug text unique, credit_cost numeric, created_at timestamptz

practice_questions  -- 题目
  id uuid pk, practice_id uuid, day_no int default 1, seq int,
  qtype text,                        -- 'choice' | 'fill' | 'judge'
  stem text, options jsonb,          -- 选择题：["A. ...","B. ..."]
  answer jsonb,                      -- ["A"] 或 ["又大又红"]
  explanation text null

practice_submissions-- 学生提交
  id uuid pk, practice_id uuid, day_no int, student_name text,
  answers jsonb, score int, total int, duration_ms int, submitted_at timestamptz
```

**RLS**：`practices` / `practice_questions` 仅作者本人 + 管理员 CRUD；`practice_submissions` **不给 anon 任何表级策略**，写入只走 RPC。

**RPC（全部 `security definer` + `set search_path = public`）**：

| RPC | 授权 | 作用 |
|---|---|---|
| `get_practice_for_student(p_slug text)` | anon + authed | 列白名单返回题目，**绝不含 answer / explanation** |
| `submit_practice_answer(p_slug, p_day_no, p_student_name, p_answers)` | anon + authed | 服务端判分、写提交、返回得分与解析 |
| `list_practice_stats(p_practice_id uuid)` | 作者 + 管理员 | 完成名单 + 每题正确率 |
| `clear_practice_submissions(p_practice_id uuid)` | 作者 + 管理员 | 一键清空提交数据 |

**枚举**：`app_type_enum` 加 `daily_practice`（用 `do $$ ... add value if not exists ... exception when others then null end $$` 幂等写法）。

---

## 七、后端

新建 **1 个 Edge Function `supabase/functions/practice/index.ts`**（`action: 'generate' | 'import'`）：
- 骨架照抄 `supabase/functions/verify-email-code/index.ts`（`handleCors` / `jsonOk` / `jsonError` / `Deno.serve`）
- 鉴权 `requireUser(req)`（`_shared/auth.ts:21`）；生成/识别都要求登录（老师端）
- 模型走 `chooseAdapter()`（`_shared/llm/index.ts:48`），可用 `app_type_profiles.model_override` 指定便宜模型
- 提示词：system 段固定（顺序不能变，否则缓存失效，照 `_shared/prompt/compose.ts:12-41` 的做法），动态内容进 user 段
- 输出：要求模型输出 ```` ```json ```` 代码块，用 `_shared/doc/validate.ts` 的思路抽取并校验结构（**LLM 不支持 response_format，只能靠提示词约束**）
- 积分：`reserve_credits` → 成功 `settle_generation` / 失败 `refund_generation`（**必须先插 `generation_jobs` 行并写 `reserved_credits`，否则退不了钱**）

**不动现有 `generate` 函数**（它是核心链路，隔离风险）。

---

## 八、前端契约（工程师按这个写，可并行）

```ts
// src/types/practice.ts
export type PracticeQType = 'choice' | 'fill' | 'judge';
export interface PracticeQuestion {
  dayNo: number; seq: number; qtype: PracticeQType;
  stem: string; options?: string[]; answer: string[]; explanation?: string;
}
export interface PracticeSet {
  id: string; title: string; subject: string; grade: string; chapter: string;
  dayCount: number; status: 'draft' | 'published' | 'closed';
  shareSlug: string; source: 'ai' | 'upload'; questionCount: number; createdAt: string;
}
```

```ts
// src/services/practiceService.ts（对外接口，先定死，各页面并行开发）
generatePractice(input: {
  subject: string; grade: string; chapter: string; textbookVersionId: string | null;
  dayCount: number; questionPerDay: number; qtypes: PracticeQType[]; difficulty: string;
}): Promise<{ questions: PracticeQuestion[] }>

parseQuestionsLocally(csvText: string): PracticeQuestion[]        // 本地规则解析，返回 [] 表示解析不出
importQuestionsWithAi(text: string): Promise<{ questions: PracticeQuestion[] }>  // 走 Edge

savePractice(input: {
  title: string; subject: string; grade: string; chapter: string;
  textbookVersionId: string | null; dayCount: number; source: 'ai' | 'upload';
  questions: PracticeQuestion[];
}): Promise<{ id: string; shareSlug: string }>

listMyPractices(): Promise<PracticeSet[]>
getPracticeForStudent(slug: string): Promise<{
  set: { title: string; grade: string; subject: string; chapter: string; dayCount: number; status: string };
  questions: Array<{ dayNo: number; seq: number; qtype: PracticeQType; stem: string; options?: string[] }>;
}>                                                                 // 去敏，无答案
submitPracticeAnswers(input: {
  slug: string; dayNo: number; studentName: string; answers: string[];
}): Promise<{ score: number; total: number; perQuestion: boolean[]; explanations: string[] }>
getPracticeStats(practiceId: string): Promise<{
  submissions: Array<{ studentName: string; dayNo: number; score: number; total: number; submittedAt: string }>;
  perQuestion: Array<{ dayNo: number; seq: number; stem: string; correctRate: number }>;
}>
closePractice(practiceId: string): Promise<void>
clearSubmissions(practiceId: string): Promise<void>
```

```ts
// src/utils/csv.ts（新建）
downloadCsv(rows: (string | number)[][], fileName: string): void   // 带 UTF-8 BOM
downloadPracticeTemplate(): void                                    // 下载填写模板
exportPracticeRecords(practiceId: string): Promise<void>            // 导出完成名单
```

---

## 九、分期

| 阶段 | 内容 |
|---|---|
| **P0（本次做）** | 建表迁移 + `practice` Edge（生成/识别）+ 教师端向导（AI 生成 + 上传识别 + 模板下载 + 预览核对）+ 学生免登录作答 `/p/:slug` + 服务端判分 + 教师看板（完成名单/正确率）+ **CSV 导出** + 积分与折扣配置 + 二年级语文提示词 |
| **P1** | 教师逐条评语、错题本、AI 讲评（单独计费）、解答题、判断题强化、扩展到其它学段学科 |
| **P2** | 班级/学号管理、**拍照/截图题目 OCR 识别上传**、家长查看（需先过合规评估，我不建议急着做） |

---

## 十、风险与对策

| 风险 | 对策 |
|---|---|
| 合规命名 | 统一"每日一练/课堂小测"，文案红线逐条自查 |
| 学生隐私 | 不强制实名、可匿名、教师一键清空、链接可关闭 |
| 答案外泄 | 答案**只存服务端**，匿名读题走去敏 RPC；判分在服务端 |
| 成本失控 | 折扣参数化 + 错峰生成 + 单次 token 上限 + 模板规整时本地解析不调模型 |
| 刷提交 | RPC 内简单限流（同 slug 同 IP 短时间上限）+ 教师可关闭作答 |
| AI 识别出错 | 必须过"老师预览核对"这一步才入库，绝不能识别完直接发布 |

---

## 十一、验收清单（做完你照这个查）

1. 教师端能进「每日一练」，选 小学/语文/二年级 + 章节 + 3 天 → 看到积分显示 2.7 → 生成出 3 天题目
2. 题目能在预览页增删改，保存后拿到 `/p/xxxx` 链接
3. 手机打开链接（未登录）能做题，提交后看到对了几题 + 解析
4. 未提交前在浏览器里翻源码/接口，**看不到答案**
5. 教师看板看到刚才那位学生的完成记录、每题正确率
6. 点导出能下载 CSV，Excel 打开中文不乱码
7. 下载模板 → 按格式填 2 题 → 上传 → 识别出来能对上
8. 后台「内容类型积分」能看到"每日一练"并可改价；「每日一练」配置 Tab 能改折扣与识别积分
9. 积分确实按折扣扣（3 天扣 2.7，不是 3）
