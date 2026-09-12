import { buildHtmlForType } from './mockSeed';
import { buildSampleDocModel, buildDocPreviewHtml } from './sampleDoc';
import type { AppType } from '@/types/enums';
import type { DocType } from '@/types/doc';
import type { GenerateRequest, GenEvent } from '@/types/api';
import { MAX_STREAM_BUFFER_CHARS } from '@/config/creditRules';
import { getAppTypeCost, getAppTypeLabel, isDocTypeKey } from '@/config/constants';
import { uuid } from '@/utils/hash';

/**
 * MOCK 模式的「伪流式」生成。
 *
 * 事件序列与真实 Edge Function **完全一致**（stage / delta / heartbeat / done），
 * 因此 `useGenerate` 与所有 UI 组件无需区分真假后端。
 *
 * 触发条件：未配置 Supabase 或 `VITE_ENABLE_MOCK=true`。
 */

export interface MockGenerateHandlers {
  /** 收到一个 SSE 事件。 */
  onEvent: (event: GenEvent) => void;
  /** 是否被外部取消。 */
  isCancelled?: () => boolean;
  /** 当前余额（用于计算 done 事件里的 creditsBalance）。 */
  balanceBefore: number;
  /**
   * 落库钩子：在发出 `done` 事件**之前**把应用写入本地库并返回真实 appId。
   * 这样 UI 拿到 done 事件时 `/app/:id` 一定可跳转，避免先发事件再补 id 的竞态。
   */
  persist?: (input: {
    title: string;
    summary: string;
    html: string;
    creditsCost: number;
    docJson?: string | null;
    category?: 'app' | 'doc';
    docType?: string;
    docJsonUrl?: string | null;
  }) => Promise<string>;
}

/** 简易延迟。 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 由提示词推导一个中文标题。
 *
 * @param prompt 教师输入的提示词。
 * @param appType 应用类型。
 */
function deriveTitle(prompt: string, appType: AppType): string {
  const cleaned = prompt.replace(/[，。！？,.!?；;、\s]+/g, ' ').trim();
  const core = cleaned.slice(0, 14);
  const label = getAppTypeLabel(appType);
  if (appType === 'auto') return core.length >= 4 ? `${core}` : '我的课堂小应用';
  return core.length >= 4 ? `${core}·${label}` : `${label}练习`;
}

/** 打印 MOCK 模式的醒目提示（只打印一次）。 */
let warned = false;
function warnOnce(): void {
  if (warned) return;
  warned = true;
  const style = 'color:#fff;background:#F59E0B;font-weight:700;padding:2px 6px;border-radius:4px';
  console.warn(
    `%c[MOCK 模式]%c 未检测到可用的大模型 API Key，` +
      `生成链路已降级为本地示例应用，不会调用任何真实模型、不会产生费用。`,
    style,
    '',
  );
}

/**
 * 执行一次 MOCK 生成。
 *
 * @param req 生成请求。
 * @param handlers 事件回调与余额信息。
 * @returns 完成事件（前端据此写 IndexedDB 与跳转）。
 */
export async function mockGenerate(
  req: GenerateRequest,
  handlers: MockGenerateHandlers,
): Promise<GenEvent | null> {
  warnOnce();
  const { onEvent, isCancelled, balanceBefore, persist: onPersist } = handlers;

  // ---- T06 文档分支（category='doc'）----
  if (req.category === 'doc' && isDocTypeKey(req.docType)) {
    return await runMockDoc(req, handlers, balanceBefore);
  }

  const cost = getAppTypeCost(req.appType);

  const stages: { stage: 'understand' | 'design' | 'code' | 'verify'; label: string }[] = [
    { stage: 'understand', label: '理解教学需求' },
    { stage: 'design', label: '设计应用结构' },
    { stage: 'code', label: '编写应用代码' },
    { stage: 'verify', label: '自检与优化' },
  ];

  for (const s of stages) {
    onEvent({ type: 'stage', data: { ...s, status: 'running' } });
    // 演示节奏：每个阶段约 1 秒，让教师能看清进度流转（真实链路以模型速度为准）
    await sleep(1000);
    if (isCancelled?.()) return null;
    onEvent({ type: 'stage', data: { ...s, status: 'done' } });
  }
  onEvent({ type: 'stage', data: { stage: 'verify', label: '自检与优化', status: 'running' } });

  // ---- 流式吐出代码 ----
  const title = deriveTitle(req.prompt, req.appType as AppType);
  const html = buildHtmlForType(req.appType as AppType, {
    title,
    goal: req.prompt.slice(0, 40),
    subject: req.subject ?? '语文',
    grade: req.grade ?? '六年级',
  });

  const chunkSize = 260;
  for (let i = 0; i < html.length; i += chunkSize) {
    if (isCancelled?.()) return null;
    onEvent({ type: 'delta', data: { text: html.slice(i, i + chunkSize) } });
    await sleep(45);
    if (i % (chunkSize * 12) === 0) {
      onEvent({ type: 'heartbeat', data: { at: Date.now() } });
    }
  }

  if (isCancelled?.()) return null;

  onEvent({ type: 'stage', data: { stage: 'verify', label: '自检与优化', status: 'done' } });

  const summary = `根据「${req.prompt.slice(0, 30)}」生成的${getAppTypeLabel(req.appType)}，打开即可用。`;
  // 先落库拿到真实 appId，再发 done 事件（保证 UI 拿到即可跳转）
  const appId = onPersist
    ? await onPersist({ title, summary, html, creditsCost: cost })
    : uuid();

  const done: GenEvent = {
    type: 'done',
    data: {
      jobId: uuid(),
      appId,
      title,
      summary,
      html,
      htmlUrl: '',
      htmlStatus: 'ready',
      tokensIn: 2100,
      tokensOut: 4300,
      creditsCost: cost,
      creditsBalance: balanceBefore - cost,
      model: 'mock-adapter',
      promptVersion: 'system_core@1',
    },
  };
  onEvent(done);
  return done;
}

/** 代码流式区域的裁剪上限（防内存膨胀）。 */
export const MOCK_STREAM_CAP = MAX_STREAM_BUFFER_CHARS;

/**
 * MOCK 文档生成（T06）：构造示例 DocModel，伪流式吐出 JSON，发 done（含 doc 字段）。
 *
 * @param req 生成请求（category='doc'）。
 * @param handlers 事件回调与余额信息。
 * @param balanceBefore 预扣前的余额。
 * @returns 完成事件；取消时返回 null。
 */
async function runMockDoc(
  req: GenerateRequest,
  handlers: MockGenerateHandlers,
  balanceBefore: number,
): Promise<GenEvent | null> {
  const { onEvent, isCancelled, persist: onPersist } = handlers;
  const docType = req.docType as DocType;
  const cost = getDocTypeCostSafe(docType);
  const hasTextbook = !!req.textbookVersionId;

  const stages: {
    stage: 'understand' | 'textbook_search' | 'design' | 'code' | 'verify';
    label: string;
  }[] = [{ stage: 'understand', label: '理解教学需求' }];
  // T07：绑定教材版本时插入 textbook_search 阶段（mock 下为检索占位）
  if (hasTextbook) {
    stages.push({ stage: 'textbook_search', label: '检索教材内容' });
  }
  stages.push(
    { stage: 'design', label: '设计文档结构' },
    { stage: 'code', label: '生成文档内容' },
    { stage: 'verify', label: '自检与优化' },
  );

  for (const s of stages) {
    onEvent({ type: 'stage', data: { ...s, status: 'running' } });
    await sleep(900);
    if (isCancelled?.()) return null;
    onEvent({ type: 'stage', data: { ...s, status: 'done' } });
  }
  onEvent({ type: 'stage', data: { stage: 'verify', label: '自检与优化', status: 'running' } });

  let model = buildSampleDocModel(docType, req.prompt);
  // T07：绑定教材版本时，强制在待核对项首位标注「已绑定教材、请教师核对」
  if (hasTextbook) {
    const hints = model.verifyHints ? [...model.verifyHints] : [];
    hints.unshift('已绑定教材版本，本内容为 AI 生成示例，请教师核对教材事实、定义与例题（mock 检索占位）');
    model = { ...model, verifyHints: hints };
  }
  const json = JSON.stringify(model, null, 2);
  const html = buildDocPreviewHtml(model);

  // 伪流式吐出 DocModel JSON（与真实链路一致：先 JSON 后 done）
  const chunkSize = 220;
  for (let i = 0; i < json.length; i += chunkSize) {
    if (isCancelled?.()) return null;
    onEvent({ type: 'delta', data: { text: json.slice(i, i + chunkSize) } });
    await sleep(35);
  }
  if (isCancelled?.()) return null;

  onEvent({ type: 'stage', data: { stage: 'verify', label: '自检与优化', status: 'done' } });

  const title = model.meta?.title ?? '文档';
  const summary = `根据「${req.prompt.slice(0, 30)}」生成的${getAppTypeLabel(docType)}，平台内可查看与核对。`;
  const appId = onPersist
    ? await onPersist({
        title,
        summary,
        html,
        creditsCost: cost,
        docJson: json,
        category: 'doc',
        docType,
        docJsonUrl: 'local',
      })
    : uuid();

  const done: GenEvent = {
    type: 'done',
    data: {
      jobId: uuid(),
      appId,
      docId: appId,
      category: 'doc',
      docType,
      title,
      summary,
      html,
      htmlUrl: `/d/${appId}`,
      htmlStatus: 'ready',
      renderUrl: `/d/${appId}`,
      docJsonUrl: 'local',
      tokensIn: 1800,
      tokensOut: 3200,
      creditsCost: cost,
      creditsBalance: balanceBefore - cost,
      model: 'mock-adapter',
      promptVersion: 'system_core@1',
    },
  };
  onEvent(done);
  return done;
}

/** 安全地取文档类型积分成本（带回退）。 */
function getDocTypeCostSafe(docType: DocType): number {
  return getAppTypeCost(docType);
}
