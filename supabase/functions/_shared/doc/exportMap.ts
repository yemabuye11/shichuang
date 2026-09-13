/**
 * 导出映射（T06 骨架；实际文件生成在 T08 用 docx / pptxgenjs 完成）。
 *
 * 本模块只负责**结构化映射**：把 DocModel 转成导出引擎可直接消费的
 * 中间描述（不引入任何第三方库，保持 Edge 轻量）。T08 的 docService
 * 将读取这些映射去生成 .docx / .pptx / 打印 PDF。
 *
 * M1 原则：同一 DocModel → 三种交付（web / edit / export）。这里就是
 * 「export 交付」的映射层。
 */

import type { DocBlock, DocModel, Slide } from './types.ts';

/** 文档大纲节点（供 docx 生成）。 */
export interface DocxNode {
  /** 段落层级：0=正文, 1~4=标题。 */
  readonly level: number;
  /** 纯文本。 */
  readonly text: string;
  /** 是否为列表项。 */
  readonly list?: boolean;
  /** 是否有序列表。 */
  readonly ordered?: boolean;
}

/** PPT 导出帧（供 pptxgenjs 生成）。 */
export interface PptxSlide {
  readonly index: number;
  readonly title: string;
  readonly bullets: readonly string[];
  readonly notes?: string;
}

/** 打印分区（供 PDF / 打印）。 */
export interface PrintSection {
  readonly heading?: string;
  readonly paragraphs: readonly string[];
}

/** 从富文本块抽取纯文本（用于导出）。 */
function blockText(block: DocBlock): string {
  if (block.type === 'list') {
    return (block.items ?? []).join('\n');
  }
  if (block.type === 'table') {
    const head = (block.header ?? []).map((h) => `- ${h}`).join('\n');
    const rows = (block.rows ?? []).map((r) => r.join(' | ')).join('\n');
    return [head, rows].filter(Boolean).join('\n');
  }
  if (block.type === 'image') {
    return block.caption ? `[图] ${block.caption}` : '[图]';
  }
  if (block.type === 'chart') {
    // 图表在网页版是内联 SVG；导出时降级为「表达式 + 关键取值」文本，
    // 保证教师离线拿到文件时仍能照着把图画到黑板上。
    const c = block.chart;
    if (!c) return block.caption ? `[图] ${block.caption}` : '[图]';
    const lines: string[] = [
      c.expression ? `[图] ${c.expression}` : c.title ? `[图] ${c.title}` : '[图]',
    ];
    if (c.kind === 'bar') {
      const pairs = (c.categories ?? []).map((cat, i) => `${cat}：${c.values?.[i] ?? ''}`);
      if (pairs.length > 0) lines.push(`取值：${pairs.join('，')}`);
    } else {
      const pts = (c.points ?? []).filter((p) => Array.isArray(p) && p.length >= 2);
      const step = Math.max(1, Math.ceil(pts.length / 8));
      const sampled = pts.filter((_, i) => i % step === 0);
      if (sampled.length > 0) {
        lines.push(`关键点：${sampled.map((p) => `(${p[0]}, ${p[1]})`).join(' ')}`);
      }
    }
    return lines.join('\n');
  }
  if (block.type === 'heading') {
    return block.text ?? '';
  }
  return block.text ?? '';
}

/**
 * 把 DocModel 映射为 docx 大纲节点序列。
 *
 * @param model 文档模型。
 * @returns 大纲节点数组。
 */
export function toDocxOutline(model: DocModel): readonly DocxNode[] {
  const nodes: DocxNode[] = [];

  // 封面元信息
  nodes.push({ level: 0, text: `标题：${model.meta?.title ?? ''}` });
  if (model.meta?.subject) nodes.push({ level: 0, text: `学科：${model.meta.subject}` });
  if (model.meta?.grade) nodes.push({ level: 0, text: `年级：${model.meta.grade}` });
  if (model.meta?.textbook) nodes.push({ level: 0, text: `教材：${model.meta.textbook}` });

  for (const b of model.blocks ?? []) {
    if (b.type === 'heading') {
      nodes.push({ level: Math.min(Math.max(Number(b.level ?? 2), 1), 4), text: b.text ?? '' });
    } else if (b.type === 'list') {
      for (const it of b.items ?? []) {
        nodes.push({ level: 0, text: it, list: true, ordered: b.ordered === true });
      }
    } else if (b.type === 'image') {
      nodes.push({ level: 0, text: `[图] ${b.caption ?? ''}` });
    } else {
      const t = blockText(b);
      if (t) nodes.push({ level: 0, text: t });
    }
  }

  for (const hint of model.verifyHints ?? []) {
    nodes.push({ level: 0, text: `【待核对】${hint}` });
  }

  return nodes;
}

/**
 * 把 DocModel（ppt）映射为 PPT 导出帧。
 *
 * @param model 文档模型。
 * @returns PPT 帧数组（非 ppt 类型返回空）。
 */
export function toPptxSlides(model: DocModel): readonly PptxSlide[] {
  if (model.kind !== 'ppt' || !model.slides) return [];
  return (model.slides as readonly Slide[]).map((s) => ({
    index: s.index,
    title: s.title,
    bullets: s.body
      .flatMap((b) => (b.type === 'list' ? (b.items ?? []) : [blockText(b)]))
      .filter((t) => t.trim().length > 0),
    notes: s.notes,
  }));
}

/**
 * 把 DocModel 映射为打印分区（正文文档通用）。
 *
 * @param model 文档模型。
 * @returns 打印分区数组。
 */
export function toPrintSections(model: DocModel): readonly PrintSection[] {
  const sections: PrintSection[] = [];
  let current: PrintSection = { paragraphs: [] };

  for (const b of model.blocks ?? []) {
    if (b.type === 'heading') {
      if (current.heading || current.paragraphs.length > 0) {
        sections.push(current);
        current = { paragraphs: [] };
      }
      current.heading = b.text ?? '';
    } else {
      const t = blockText(b);
      if (t) current.paragraphs.push(t);
    }
  }
  if (current.heading || current.paragraphs.length > 0) sections.push(current);

  return sections;
}
