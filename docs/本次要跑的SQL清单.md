# 本次要跑的 SQL 清单（照着做就行）

> 打开 Supabase 后台 → 左侧 **SQL Editor** → **New query**
> 把每个文件的内容**整段复制**进去 → 点 **Run**
> 一次跑一个文件，看到 `Success. No rows returned` 就是成功了。

---

## 一、按顺序跑（已经跑过的直接跳过）

| 顺序 | 文件名 | 跑它是为了什么 | 跑完怎么确认成功 |
|:--:|---|---|---|
| 1 | `0038a_enum_daily_practice.sql` | 修您上次报的 `55P04` 枚举错误 | 无报错即可 |
| 2 | `0038_practice_daily.sql` | 每日一练 | 无报错即可 |
| 3 | `0039_credit_decimal.sql` | 支持 2.7 这种小数积分 | 无报错即可 |
| 4 | `0040a_enum_exam_paper.sql` | 组卷（先加枚举，必须单独跑） | 无报错即可 |
| 5 | `0040_exam_paper.sql` | 组卷的三张表 | 无报错即可 |
| 6 | `0041_question_bank.sql` | **题库**（新写的，重点看它） | 无报错即可 |
| 7 | `0042_fix_admin_rpc_id_ambiguity.sql` | 修后台「注册用户」「代充值」报错 | **必须真跑**，只发前端没用 |
| 8 | `0043_doc_prompt_quality.sql` | 教案/课件的质量下限 | 见下方验证 SQL |
| 9 | `0044_credit_cost_quality_v2.sql` | 新的积分价格 | 见下方验证 SQL |
| 10 | `0046_ppt_2d_prompt_visual.sql` | 让课件**真的带图** | 见下方验证 SQL |
| 11 | `0047_textbook_storage.sql` | 创建教材电子版私有存储桶和路径归属函数；策略需在 Storage → Policies 创建 | 见 `docs/0047_textbook_storage_policies.md` |

> ⚠️ **0045 不在这张表里**，它要改邮箱后单独跑，见第三节。

---

## 二、跑完之后，把这三段验证 SQL 各跑一次

### ① 确认新积分价生效（跑 0044 之后）
```sql
select app_type, label, credit_cost
  from public.app_type_profiles
 order by sort_order;
```
**应该看到**：教案 6 / PPT课件 8 / 课件2D 8 / 课件3D 8 / 办公文档 4 /
自动判断 4 / AI教案·大单元 6 / AI组题 4 / 互动课件 5 / 教学游戏 7

### ② 确认课件「必须带图」的规则进去了（跑 0046 之后）
```sql
select key from public.prompt_templates
 where is_active
   and key in ('doc_type:ppt', 'doc_type:courseware_2d')
   and content like '%文科档%' and content like '%数据型档%';
```
**应该返回 2 行**。返回 0 行说明没生效。

### ③ 确认月度花费上限没被改小（跑 0044 之后）
```sql
select value ->> 'monthlySpendCny' as 月度上限元
  from public.system_config where key = 'limit';
```
**应该 ≥ 1000**（约够 3 万次生成才停服）。

---

## 三、给自己补积分（您说"没积分了"）

文件：`0045_owner_credit_grant.sql`

1. 打开文件，**先改这两行**：
   - `v_email` → 改成您的**登录邮箱**（引号别删）
   - `v_amount` → 默认 2000，想多给就改大
2. 粘进 SQL Editor → Run
3. 看到提示 `已给 xxx 补 2000 积分，当前余额 2000` 就成了

**同一个编号只会加一次**，反复粘不会重复加。想再补一次，把 `grant:2026-09-owner` 改成 `grant:2026-09-owner-2`。

日常补积分不用再跑 SQL：**管理后台 → 代充值** 页（报错已修好）。

---

## 四、跑完 SQL 还要做的三件事

1. **把浏览器里的账号退出、重新登录一次**（否则还拿着旧的权限和价格缓存）
2. **等 1 分钟再测试生成** —— Edge 有 60 秒缓存，刚跑完 SQL 立刻生成可能还是老提示词
3. **重新生成一份课件看效果** —— 改提示词**只影响新生成的内容**，之前生成的不会变

代码部分（页面、组卷、题库、后台）已经推送，GitHub Actions 会自动构建发布，
**不用您手动部署**。大概 3~5 分钟后刷新网站就能看到新版面。

---

## 五、报错了怎么办

| 报错原文里含 | 说明 | 怎么办 |
|---|---|---|
| `55P04: unsafe use of new value` | 枚举值要先单独提交 | 一定是漏跑了 `0038a` 或 `0040a`，回去补跑 |
| `42702: column reference "id" is ambiguous` | 多表 id 没写别名 | 确认 `0042` 已经跑完 |
| `42703: column "value" does not exist` | 查提示词时写错了列名 | 提示词内容在 **`content`** 列，不是 `value` |
| `relation "xxx" does not exist` | 前面的表没建 | 检查是不是跳跑了某一步，按顺序补齐 |
| `permission denied` | 权限问题 | SQL Editor 默认有最高权限，换个浏览器或清缓存重试 |

**0041（题库）是这次新写的、没在真实库上跑过**，如果它报错，把完整报错原文贴出来，我马上改。

---

## 六、这次都改了些什么（一句话版）

- **首页**：只剩生成类功能，一句话输入在最上面；每日一练改到独立页面；新增「组卷」页面
- **组卷**：三条出题路子（填规格 / 上传原卷变式 / 题库勾选），学生免登录作答、客观题自动判分、主观题您打分、能导出 CSV
- **题库**：每次出的题自动存进来，越用越厚
- **修了两个后台报错**：注册用户页、代充值页；顺带修好了以前一直空白的举报列表
- **课件质量**：从"不许配图"改成"必须配图"，数学类每页一张、文科每 2 页一张
- **积分调价**：教案 4→6、PPT 6→8、课件2D 6→8（3D 按您说的**没动**，还是 8）
- **收款码**：后台「收款码配置」填一个 https 图片链接就行，详细步骤见 `docs/WECHAT_QR_SETUP.md`
- **兑换码**：界面精简了（最多一次 50 张），发码入口保留——这是您回收成本的唯一通道
