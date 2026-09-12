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
 * 文档类 system 段（在应用段基础上追加 `textbook_aware` 教材感知节）。
 * 放在独立数组，避免污染应用类 prompt 的缓存命中。
 */
const DOC_SYSTEM_SECTIONS: readonly string[] = [
  'system_section:role',
  'system_section:output_format',
  'system_section:pedagogy',
  'system_section:safety',
  'system_section:code_quality',
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

  return {
    systemPrompt,
    userPrompt,
    promptVersion: await versionTag([...usedKeys, 'user_enhance:fields']),
    usedKeys,
  };
}
