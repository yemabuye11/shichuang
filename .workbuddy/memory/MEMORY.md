# 项目长期约定：「师创」教师 AI 教学应用生成平台

## 客户与协作方式
- 客户野马：学校教务/教学工作，本人任教九年级，**非程序员**
## 协作偏好（野马明确要求）
- **生成/修改本地文件后必须 `present_files` 展示出来**（他要右键定位文件夹或在右侧直接打开）。历史上有次生成 `0033_email_verification_id.sql` 没展示，他找不到文件。**以后凡产出文件一律展示。**
- 讲方案用业务语言，不甩术语；提方案必须说清代价（要花多少钱、要不要学新东西、要维护什么）
- 核心诉求：**省事 + 能推广**；为保老师用得起来，宁可牺牲一点安全性
- 成本极度敏感，**不能额外花钱**（倾向免费额度起步）

## 产品决策（已定，勿改）
- 平台名「师创」/ 代号 shichuang；产品名只能从 `src/config/brand.ts` 读，禁止硬编码
- 形态：网页 + PWA 先行，架构预留原生 APP / 小程序
- 登录：邮箱 + 密码 + 邀请码（注册必须填邀请码）；不做手机短信、不做微信扫码（P1 再议）
- 大模型：多适配器（DeepSeek 主 + 至少一家备份），Key 由客户自己申请充值
- 商业模式：会员/套餐 + 积分，**线下人工充值，永远不做在线支付**；兑换码 + 管理员后台是客户回收成本的唯一通道
- 积分定价**暂缓**，等客户看清单次成本再定；所有积分数值必须走配置表，代码不得写死
- 部署：先免费海外（GitHub Pages / Cloudflare）跑通，成功后迁国内（阿里云 OSS+CDN 或腾讯云 COS+CDN，需备案）

## 产品定位（2026-09-12 客户重大修正）
- **原定位**：教师"一句话做教学应用"生成平台（复刻飞象老师）
- **现定位**：师的 AI 备课办公台。应用生成只是其中一种；**主轴是教案、PPT课件、3D课件、办公文档模板**
- 客户核心原话：老师更多用教案/PPT/课件生成；生成内容要带 3D 效果方便学生理解；平台最大特点不是做应用而是方便老师办公；要能跟上教材变化（如今年初三数学换新教材）
- 客户拍板四点：① 3D 双形态（伪3D动画 + Three.js 真3D可旋转可拆解模型）；② 输出网页可演示 + 导出PPTX + 导出Word，且生成后支持修改；③ 教材版本机制（多窗口选年份/版本/出版社 → AI联网搜 → 教师核对 → 补写/上传电子版修正）；④ 应用生成降为"应用"标签保留
- 架构未推翻：T01-T05 已实现基座复用，补强 T06（文档/课件生成）、T07（教材版本机制）、T08（导出与在线编辑）。详情见 ARCHITECTURE.md Part C

## 商业决策（2026-09-12 野马拍板）
- **推广节奏**：**本校先行试点**，跑通后（收集完"哪些功能需完善"的反馈）再慢慢发展 3–5 所友校，**不设硬性时间表**，成熟一所签一所
- **推广渠道**：**主攻抖音**（野马本人熟悉、教师覆盖广）；**小红书不做**（不了解、场景不匹配）；B站/视频号作补充
- **定价（利润导向）**：教师个人档**维持不变**（月卡29 / 年卡199，引流价）；教研组**上调**（学期包 999→**1680**，学年包 2980）；**新增学校版**（基础≤50人 6800/学年，标准≤200人 19800/学年，区域版定制）——利润主要来自 B2B
- **国内迁移**：**按客户量触发**（付费用户>500 或 月生成>1万），**数据跟着一起迁不是重建**（账号/生成历史/教材知识/Skill库/内容库全迁移）；但**ICP备案要早办**（免费且需7-20天，不等触发条件）
- **新功能（BR-014/015）**：**内容数据存储 + Skill 沉淀降本**。生成即沉淀入 `doc_library`；同类内容≥100条提炼 Skill；新请求命中 Skill 则"套骨架+局部填空"而非全量生成，**token 成本可降约30%**（命中率40%估算）。这是"涨价保利润"之外的第二条降本路径

## 成本模型与模型采购（2026-09-12 实测定价）
- **半价政策是真的**：DeepSeek 官方 2026-08-17 起**峰谷定价**，空闲时段=高峰**半价**；08-23 起**周六周日全天+法定节假日全天均算空闲**。高峰=工作日 9-12/14-18
- **师创天然吃半价**：教师集中在**晚上+周末**备课，恰好是 DeepSeek 谷段 → 加权约 **79% 时间半价**（教师行为下可达 85-90%）
- **采购策略**：**主力=DeepSeek 官方直连**（谷段窗口最宽、缓存命中最低 ¥0.05/M）；**硅基流动=备份+多模型源**（一个Key调 GLM/Kimi/Qwen 全家，送16元券+首充翻倍+企业95折）。**硅基流动半价窗口仅 02:00-08:00（6h），教师在睡觉，用不上**——三家单价同为峰¥3/¥9、谷¥1.5/¥4.5，差别只在**窗口宽度**（DeepSeek≈79% / 百炼42% / 硅基流动25%）。**不用 OpenRouter**（数据出境合规风险）
- **成本基准**：V4-Flash 主力。单次生成成本（谷段）教案¥0.0205 / PPT¥0.0385 / 3D课件¥0.0476。**综合每积分成本 ¥0.030（基准，含1.3×缓冲覆盖检索+重试）**，最坏全高峰¥0.048，最好（错峰+Skill）¥0.018
- **毛利率（保守按积分用满）**：教师月卡79% / 教师年卡**55%** / 教研组学期73%·学年64% / 学校基础版74%·标准版64%。**最坏情形教师年卡仍28%，不会亏**
- **三大降本杠杆**：① 错峰调度（非实时任务排队到夜间/周末=半价）② 缓存命中（system前缀逐字节稳定，输入降至1/30）③ Skill复用（BR-015，省75%）
- **OPC（One Person Company 一人公司）≠ 技术平台**：是 2026 年各地政府力推的 AI 个体创业扶持政策 + 孵化社区。全国 20 省 106 项专项政策（广东 2026-03 首个省级）。Token/词元券补贴：北京 50%(最高500万)、杭州滨江 60%(年100万)、重庆两江 50%(年3万)、四川 OPC 40%(免申即享)、成都 30%/小微50%(最高200万)、上海联通首购5折(最低1元/百万Token)
- ⚠️ **OPC 补贴对师创现阶段不适用 + 有合规风险**：① 需先注册一人公司+入驻社区，但**野马是在编教师**——《事业单位工作人员处分暂行规定》第十八条禁止事业单位人员违规从事营利性活动（可至开除）；邵阳/颍上官方答复"在编教师不得入股公司"。**例外**：人社部规〔2017〕4号支持事业单位专业技术人员创新创业，**履行审批手续后不违规** → 注册前务必向学校人事/教育局书面确认 ② 当前月 token 成本仅约 ¥126，补贴省 ¥63/月，**远不值注册公司+跑审批+应付分阶段核查的成本**。建议月成本 >¥3000-5000 再评估 ③ 特别注意：**向自己所在学校销售师创**最容易触碰"与履职冲突"红线，校外市场优先
- 详见 `docs/PRICING_PROFIT.md`

## 技术红线
- 应用 HTML 永不过 Supabase 出网（免费层仅 10GB），走静态托管 + CDN
- 单文件 ≤ 200KB；广场封面用程序生成 SVG 渐变（零存储零流量）
- API Key 只在 Edge Function，绝不下发前端
- 生成物 iframe sandbox **绝不出现 allow-same-origin**
- Postgres RLS 全表开启
- Supabase 项目区域创建时选 **ap-southeast-1（新加坡）**，创建后不可改
- 版本锁定：Vite 5 / React 18（不升 19）/ MUI v6 / Tailwind v3（不升 v4）

## 关键文档
- docs/PRD.md —— 产品需求（v2 备课办公台定位）
- docs/ARCHITECTURE.md —— 架构与任务分解（T01~T05 + T06~T08）
- docs/MRD.md —— 市场需求（v1）
- docs/BRD.md —— 业务需求（v1）
- docs/DEPLOY.md —— 海外版从零上线指南（v1）
- docs/DEPLOY_CN.md —— 国内版部署迁移清单（v1）

## 验收自检约定（踩过坑，务必沿用）
- **`npx tsc --noEmit` 不覆盖 `supabase/functions/`**（tsconfig 只 include src）。
  Edge 侧 TS 必须单独做语法体检，否则语法错误能一路带到部署才炸：
  ```
  node -e "用 node_modules/vite/node_modules/esbuild 的 transformSync 遍历 supabase/functions/**/*.ts"
  ```
  （本机无 deno 可用；esbuild 在 `node_modules/vite/node_modules/esbuild/lib/main.js`）
- **模板字符串里千万别直接写 ``` **（如「请输出 ```json 代码块」这类提示语），
  反引号会提前终止模板字符串。用单引号片段拼接。
- **PWA 预缓存会吃掉所有 assets**：新增大依赖（如 three 747KB）必须加 `globIgnores`
  并配 CacheFirst 运行时缓存，否则教师首次访问就被静默下载。
- 演示/冒烟校验要同时覆盖 **Edge `_shared/**` 与 `src/utils/**` 两套同逻辑校验器**，改一处必须同步改另一处。

## 工程状态（截至 2026-09-12）
- git 仓库已初始化（此前无 .git），首 commit `93d798e`（T06-A）
- .gitignore 已排除 `/_*`（根目录临时脚本）、`.pkg-repair/`、`.rollup-repair/`（历史离线 tgz）
- T06（A+B）已完成：文档生成主链路 mock 下端到端可用（93d798e + 2e49ad6）；主页已改版并前置互动/社区板块（a60dc33, cf99b5e）。T07（教材版本机制）已完成（迁移0013/14/15 + Edge搜索适配器 + VerifyBanner + TextbookCascade 接线，4394d2b/fa8b53e，typecheck+build 通过）；T08（导出+在线编辑）已完成（exportService 结构映射导出 PPTX/Word + TipTap 在线编辑 + DocEditorPage + 编辑入口，f21b164…e70faec，typecheck+build 通过）

## 认证与邮件基础设施（截至 2026-09-14）
- **邮箱验证码注册链路打通**：`request-email-code` + `verify-email-code` 两个 Edge Function，验证码存 `email_verifications`（哈希+过期+限流：单邮箱1h≤5），发信走阿里云 DirectMail。
- **阿里云邮件推送已实通**：发信域名 `myshichuang.xyz`（DNS TXT/SPF/DKIM/DMARC+MX 已验证，NS 已切 hichina）；RAM 子用户需 `AliyunDirectMailFullAccess`（Readonly 不能发信）；签名须 **Base64**（非 hex）；发信地址 `noreply@myshichuang.xyz`。密钥经 `supabase secrets set EMAIL_PROVIDER=aliyun ...` 注入，真发信实测 200 `sent:true`。
- **注册「确认密码」**：`PasswordForm` 注册步加确认密码（两次一致才通过），commit `08c3354`。
- **PWA 静默刷新 bug 已修**：`VitePWA registerType` 由 `autoUpdate`→`prompt`（commit `8d56f79`），避免检测到新构建即 `location.reload()` 把填表用户踢回登录、表单数据全丢。
- **忘记密码改为邮箱验证码式**（替代 Supabase 邮件链接）：新增 `reset-password` Edge Function（服务端独立校验码→`auth.admin.updateUserById` 改密→标记 consumed）+ `ForgotPasswordPage`（`/forgot`，邮箱→发码→填码+新密码+确认密码→改密）+ `authService.resetPasswordWithCode`，commit `d9e5f3e`。旧 `/reset` 邮件链接式保留作兜底未删。
- **无密码残留账号结论**：之前野马"注册过一次没输密码"是 PWA 刷新打断、signUp 未执行，**不会留下半个无密码账号**，无需补救。
- ⚠️ 待野马确认：Supabase Redirect URL 须为完整 `/reset`（非曾写的 `/rese`）。

## T06 交付约定（给 T06-B 前端）
- 产物路径：文档 `/d/{yyyy}/{mm}/{id}/v{n}.html`，doc_json `/d/{yyyy}/{mm}/{id}/v{n}.json`；应用仍是 `/a/...`
- `docService` 接口：`loadDoc(docId) => DocModel|null`、`saveVersion(docId,json) => {version,docJsonUrl}`、
  `renderAndPublish(docId) => {renderUrl}`、`depositKnowledge(docId,model)`（T07 占位）
- `src/types/doc.ts` 与 `supabase/functions/_shared/doc/types.ts` 语义一致，改必须同步
- /d/ 是平台可信内容，serve-app **不套** sandbox；/a/ 保持 sandbox 且无 allow-same-origin
