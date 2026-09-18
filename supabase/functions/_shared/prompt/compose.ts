/**
 * 提示词拼装。
 *
 * ⚠️ 硬约束（ARCHITECTURE.md §5.4）：拼装结果必须**逐字节稳定**，
 * 否则 DeepSeek 的上下文缓存不会命中（未命中 3 元/百万 vs 命中 0.1 元/百万，差 30 倍）。
 * 因此：**禁止**把时间戳、随机数、用户昵称、学科年级等动态内容放进 system 段。
 */

import { getTemplate, versionTag, TEXTBOOK_AWARE_SECTION } from './loader.ts';

/** system 段的固定拼装顺序（顺序变了缓存也会失效，不要随意调整）。 */
const SYSTEM_SECTIONS: readonly string[] = [
  'system_section:role',
  'system_section:output_format',
  'system_section:pedagogy',
  'system_section:safety',
  'system_section:code_quality',
];

/**
 * 文档类 system 段（**文档专用**，与"生成 HTML 应用"彻底拆分）。
 *
 * ⚠️ 历史问题（见 docs/QUALITY_BASELINE.md）：此前这里复用的是 `role` / `output_format` /
 * `code_quality` 三节，它们分别是"单文件网页应用"、"只输出一个 HTML 文件"、
 * "use strict / innerHTML"——与文档类要求的"输出 DocModel JSON"**直接冲突**，
 * 导致模型在两种格式间摇摆，JSON 校验失败率升高，教师频繁看到"生成失败"。
 *
 * 现在换成文档专用的 `doc_role` / `doc_output_format`，只保留通用的 `pedagogy` /
 * `safety` 与教材感知节。`code_quality`（纯前端代码规范）对文档无意义，直接移除，
 * 顺带省下约 400 token 的无效上下文。
 *
 * ⚠️ 改本数组需要重新部署 Edge Function；改**数组里这些模板的内容**则只需改
 * `prompt_templates` 表（60s 内自动生效），不用部署。
 */
const DOC_SYSTEM_SECTIONS: readonly string[] = [
  'system_section:doc_role',
  'system_section:doc_output_format',
  'system_section:pedagogy',
  'system_section:safety',
  TEXTBOOK_AWARE_SECTION,
];

export interface ComposeInput {
  /** 应用类型（用于追加对应的子模板）。 */
  appType: string;
  /** 子模板 key（来自 `app_type_profiles.prompt_key`）。 */
  promptKey: string;
  /** 教师原始需求。 */
  prompt: string;
  /** 结构化字段（全部进 **user** 消息）。 */
  subject?: string;
  grade?: string;
  textbook?: string;
  duration?: string;
  difficulty?: string;
}

export interface ComposeDocInput {
  /** 文档类型（lesson_plan / ppt / courseware_2d / courseware_3d / office_doc）。 */
  docType: string;
  /** 子模板 key（来自 `app_type_profiles.prompt_key`，形如 `doc_type:<kind>`）。 */
  promptKey: string;
  /** 教师原始需求。 */
  prompt: string;
  /** 结构化字段（全部进 **user** 消息）。 */
  subject?: string;
  grade?: string;
  textbook?: string;
  duration?: string;
  difficulty?: string;
  /** T07 教材检索回填的上下文（可能为空，空则不注入）。 */
  textbookContext?: string;
  /** 上传的参考模板正文（教师上传文本模板，截断后注入 user 消息，沿用其章节结构与排版风格）。 */
  templateContent?: string;
  /** 导入的大纲正文（作为最高优先级的页面结构和知识点清单）。 */
  outlineContent?: string;
  /** 参考公开课标题（注入提示词让内容更厚实）。 */
  referenceTitle?: string;
  /** 参考公开课来源。 */
  referenceSource?: string;
}

export interface Composed {
  /** system 消息（固定前缀，逐字节稳定）。 */
  systemPrompt: string;
  /** user 消息（含结构化字段）。 */
  userPrompt: string;
  /** 版本标签，形如 `role@3+output_format@2+...+game@2`。 */
  promptVersion: string;
  /** 实际用到的模板 key（便于排查）。 */
  usedKeys: string[];
}

/**
 * 拼装 system + user 消息。
 *
 * @param input 拼装输入。
 * @returns 拼装结果。
 */
export async function compose(input: ComposeInput): Promise<Composed> {
  const usedKeys: string[] = [];
  const parts: string[] = [];

  for (const key of SYSTEM_SECTIONS) {
    const content = await getTemplate(key);
    if (content.trim().length > 0) {
      parts.push(content.trim());
      usedKeys.push(key);
    }
  }

  // 8 类子模板追加在 system 段末（按类型固定，仍可命中缓存）
  const appTypeKey = input.promptKey || `app_type:${input.appType}`;
  if (input.appType !== 'auto' && appTypeKey) {
    const content = await getTemplate(appTypeKey);
    if (content.trim().length > 0) {
      parts.push(content.trim());
      usedKeys.push(appTypeKey);
    }
  }

  const systemPrompt = parts.join('\n\n');

  // ---- user 消息：结构化字段在这里 ----
  const tpl = await getTemplate('user_enhance:fields');
  const userPrompt = tpl
    ? render(tpl, {
        subject: input.subject?.trim() || '未填写（请你推断合理默认值）',
        grade: input.grade?.trim() || '未填写（请你推断合理默认值）',
        textbook: input.textbook?.trim() || '未填写（请你推断合理默认值）',
        duration: input.duration?.trim() || '未填写（请你推断合理默认值）',
        difficulty: input.difficulty?.trim() || '未填写（请你推断合理默认值）',
        prompt: input.prompt,
      })
    : input.prompt;

  return {
    systemPrompt,
    userPrompt,
    promptVersion: await versionTag([...usedKeys, 'user_enhance:fields']),
    usedKeys,
  };
}

/**
 * 构造「自修复」第二轮 user 消息（仅重试 1 次）。
 *
 * @param original 原始 user 消息。
 * @param errors 校验失败原因。
 */
export async function composeRepair(original: string, errors: readonly string[]): Promise<string> {
  const tpl = await getTemplate('repair:retry');
  const list = errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
  const repair = tpl ? render(tpl, { errors: list }) : `上次输出未通过校验：\n${list}\n请修正后重新输出完整 HTML。`;
  return `${original}\n\n---\n\n${repair}`;
}

/** 简单的 `{placeholder}` 渲染（不引入模板引擎，保证输出稳定）。 */
function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? '');
}

/**
 * 拼装文档类 system + user 消息（T06）。
 *
 * 与 `compose` 的区别：
 * - system 段追加 `textbook_aware`（教材感知）；
 * - 子模板用 `doc_type:<kind>`；
 * - user 消息追加可选 `{textbook_context}`（T07 回填）。
 *
 * ⚠️ 同样要求逐字节稳定：动态内容只进 user 消息。
 *
 * @param input 拼装输入。
 * @returns 拼装结果。
 */
export async function composeDoc(input: ComposeDocInput): Promise<Composed> {
  const usedKeys: string[] = [];
  const parts: string[] = [];

  for (const key of DOC_SYSTEM_SECTIONS) {
    const content = await getTemplate(key);
    if (content.trim().length > 0) {
      parts.push(content.trim());
      usedKeys.push(key);
    }
  }

  // 文档子模板（doc_type:<kind>）
  const docKey = input.promptKey || `doc_type:${input.docType}`;
  if (input.docType && docKey) {
    const content = await getTemplate(docKey);
    if (content.trim().length > 0) {
      parts.push(content.trim());
      usedKeys.push(docKey);
    }
  }

  const systemPrompt = parts.join('\n\n');

  // user 消息：结构化字段 + 教材上下文（T07）+ 原始需求
  const tpl = await getTemplate('user_enhance:fields');
  let userPrompt = tpl
    ? render(tpl, {
        subject: input.subject?.trim() || '未填写（请你推断合理默认值）',
        grade: input.grade?.trim() || '未填写（请你推断合理默认值）',
        textbook: input.textbook?.trim() || '未填写（请你推断合理默认值）',
        duration: input.duration?.trim() || '未填写（请你推断合理默认值）',
        difficulty: input.difficulty?.trim() || '未填写（请你推断合理默认值）',
        prompt: input.prompt,
      })
    : input.prompt;

  if (input.textbookContext && input.textbookContext.trim().length > 0) {
    userPrompt +=
      '\n\n---\n\n' +
      '# 教材上下文（请优先对齐以下教材内容，确保事实、定义、例题、年份、政策与教材一致）\n' +
      input.textbookContext.trim() +
      '\n\n注意：凡涉及教材具体事实、数据、例题、年份或政策的内容，若无法从上方教材上下文确认，' +
      '请在输出 DocModel 的 verifyHints 中逐条列出「待教师核对」的要点，方便教师核对。';
  }

  // 参考模板结构：仅注入 user 消息，system 段必须逐字节稳定以保证 DeepSeek 缓存命中。
  if (input.templateContent && input.templateContent.trim().length > 0) {
    userPrompt +=
      '\n\n---\n\n# 参考模板结构（请尽量沿用其章节结构与排版风格，但内容须针对本次需求重新撰写，不要照抄）\n' +
      input.templateContent.slice(0, 6000);
  }

  // 导入大纲优先级高于参考模板：教师已经给出内容脉络时，模型只负责补齐讲解、
  // 例题、活动和备注，不再自行增删主题或把大纲改写成另一套固定栏目。
  if (input.outlineContent && input.outlineContent.trim().length > 0) {
    userPrompt +=
      '\n\n---\n\n# 导入大纲（最高优先级内容源）\n' +
      '以下内容是本节课的目录和知识点来源。必须保持原有顺序、标题含义、知识结构和关键数字，' +
      '不得另起一套章节，也不得删掉大纲中的例题、活动、练习或作业要求。\n' +
      '请把每个大纲条目扩写成可直接授课的幻灯片内容：补充必要的解释、示范步骤、课堂追问和教师备注；' +
      '内容不足时做教学化补全，内容过多时按知识点合并，不能只把原句复制成页面标题。\n\n' +
      input.outlineContent.slice(0, 24_000);
  }

  // 参考公开课：让内容更厚实（有具体例题、课堂活动与板书/互动设计，达到优质课标准）。
  // 注意：动态内容一律进 user 消息，绝不污染 systemPrompt。
  if (input.referenceTitle && input.referenceTitle.trim().length > 0) {
    userPrompt +=
      '\n\n---\n\n# 参考公开课（让内容更厚实：有具体例题、有课堂活动与板书/互动设计，达到优质课标准）\n' +
      '参考课例：《' + input.referenceTitle + '》' +
      (input.referenceSource && input.referenceSource.trim().length > 0 ? '（来源：' + input.referenceSource + '）' : '') +
      '\n请参照优质公开课的标准，使本节内容详实、有案例，避免空洞。';
  }

  return {
    systemPrompt,
    userPrompt,
    promptVersion: await versionTag([...usedKeys, 'user_enhance:fields']),
    usedKeys,
  };
}
