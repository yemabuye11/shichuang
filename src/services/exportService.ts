/**
 * 浏览器端导出服务（T08）。
 *
 * 设计要点（ARCHITECTURE.md §C.8.1 阻塞② 选项 A —— 结构映射）：
 * - PPTX / DOCX **全部在浏览器端**用 `pptxgenjs` / `docx` 逐页 / 逐段映射生成；
 * - **不触服务端、不截图**（零服务端成本，PRD 4.3 红线）；
 * - 映射规则与 Edge 端 `supabase/functions/_shared/doc/exportMap.ts` 保持一致
 *   （同一 DocModel → 三种交付的「export」分支），此处为浏览器端的等价实现；
 * - 3D 课件在 PPTX 内为「静态预览页 + 演讲者备注『建议用网页版查看 3D』」。
 *
 * ⚠️ `pptxgenjs` / `docx` 必须**动态 import**，不进入首屏主包
 * （构建后它们是独立 chunk，网络面板可验证导出前无相关请求）。
 */

import type { ChartSpec, DocBlock, DocModel } from '@/types/doc';

// ---------------------------------------------------------------------------
// 导出选项
// ---------------------------------------------------------------------------

/** 导出参数。 */
export interface ExportOptions {
  /** 网页版访问地址（用于 3D 备注与分享链接拼接）。 */
  renderUrl?: string;
}

// ---------------------------------------------------------------------------
// 映射规则（与 Edge `exportMap.ts` 对齐，浏览器端等价实现）
// ---------------------------------------------------------------------------

/** 文档大纲节点（供 docx 生成）。 */
interface DocxNode {
  /** 段落层级：0=正文, 1~4=标题。 */
  level: number;
  /** 纯文本。 */
  text: string;
  /** 是否为列表项。 */
  list?: boolean;
  /** 是否有序列表。 */
  ordered?: boolean;
}

/** PPT 导出帧（供 pptxgenjs 生成）。 */
interface PptxSlide {
  index: number;
  title: string;
  bullets: string[];
  notes?: string;
}

/** 从单个块抽取纯文本（供映射）。 */
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
    // 图表在网页版是内联 SVG；导出 docx/pptx 时降级为「表达式 + 关键取值」文本，
    // 保证教师离线拿到文件时仍能照着把图画到黑板上。
    return chartToText(block.chart, block.caption);
  }
  if (block.type === 'heading') {
    return block.text ?? '';
  }
  return block.text ?? '';
}

/**
 * 图表 → 可读文本（导出降级用）。
 *
 * @param chart 图表数据。
 * @param caption 图注。
 */
function chartToText(chart: ChartSpec | undefined, caption?: string): string {
  if (!chart) return caption ? `[图] ${caption}` : '[图]';
  const lines: string[] = [];
  if (chart.expression) lines.push(`[图] ${chart.expression}`);
  else if (chart.title) lines.push(`[图] ${chart.title}`);
  else lines.push('[图]');

  if (chart.kind === 'bar') {
    const pairs = (chart.categories ?? []).map((c, i) => `${c}：${chart.values?.[i] ?? ''}`);
    if (pairs.length > 0) lines.push(`取值：${pairs.join('，')}`);
  } else {
    const pts = (chart.points ?? []).filter((p) => Array.isArray(p) && p.length >= 2);
    // 最多列 8 个采样点，避免导出文件被长列表撑爆
    const step = Math.max(1, Math.ceil(pts.length / 8));
    const sampled = pts.filter((_, i) => i % step === 0);
    if (sampled.length > 0) {
      lines.push(`关键点：${sampled.map((p) => `(${p[0]}, ${p[1]})`).join(' ')}`);
    }
  }
  if (caption && !chart.expression) lines.push(caption);
  return lines.join('\n');
}

/** 把 DocModel 映射为 docx 大纲节点序列（对齐 Edge `toDocxOutline`）。 */
function toDocxOutline(model: DocModel): readonly DocxNode[] {
  const nodes: DocxNode[] = [];

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
    } else if (b.type === 'chart') {
      nodes.push({ level: 0, text: chartToText(b.chart, b.caption) });
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

/** 把 PPT 文档模型映射为 PPT 导出帧（对齐 Edge `toPptxSlides`）。 */
function toPptxSlides(model: DocModel): readonly PptxSlide[] {
  if (model.kind !== 'ppt' || !model.slides) return [];
  return model.slides.map((s) => ({
    index: s.index,
    title: s.title,
    bullets: s.body
      .flatMap((b) => (b.type === 'list' ? (b.items ?? []) : [blockText(b)]))
      .filter((t) => t.trim().length > 0),
    notes: s.notes,
  }));
}

/**
 * 把「块文档」（教案 / 办公文档 / 课件 2D）按标题分组映射为 PPT 幻灯片。
 * 非 ppt 类型在导出 PPTX 时复用此函数，保证一份源三种交付内容一致。
 */
function blocksToSlides(model: DocModel): readonly PptxSlide[] {
  const slides: PptxSlide[] = [];
  let cur: { title: string; bullets: string[] } | null = null;
  const flush = (): void => {
    if (cur) slides.push({ index: slides.length, title: cur.title, bullets: cur.bullets });
  };

  for (const b of model.blocks ?? []) {
    if (b.type === 'heading') {
      flush();
      cur = { title: b.text ?? '（节）', bullets: [] };
    } else if (b.type === 'list') {
      if (!cur) cur = { title: model.meta?.title ?? '要点', bullets: [] };
      for (const it of b.items ?? []) cur.bullets.push(it);
    } else if (b.type === 'table') {
      if (!cur) cur = { title: model.meta?.title ?? '表格', bullets: [] };
      const head = (b.header ?? []).join(' / ');
      if (head) cur.bullets.push(head);
      for (const r of b.rows ?? []) cur.bullets.push(r.join(' | '));
    } else if (b.type === 'image') {
      if (!cur) cur = { title: model.meta?.title ?? '图', bullets: [] };
      cur.bullets.push(`[图] ${b.caption ?? ''}`.trim());
    } else {
      const t = blockText(b);
      if (t) {
        if (!cur) cur = { title: model.meta?.title ?? '内容', bullets: [] };
        cur.bullets.push(t);
      }
    }
  }
  flush();

  if (slides.length === 0) {
    slides.push({ index: 0, title: model.meta?.title ?? '文档', bullets: ['（无正文要点）'] });
  }
  return slides;
}

// ---------------------------------------------------------------------------
// 下载辅助
// ---------------------------------------------------------------------------

/** 把文件名清洗为安全的下载文件名（去除路径非法字符）。 */
function safeFileName(title: string): string {
  const base = (title || '师创文档').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60);
  return base || '师创文档';
}

/** 触发浏览器下载（Blob → a[download]）。 */
function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// 导出实现
// ---------------------------------------------------------------------------

/**
 * 导出 PPTX（浏览器端，结构映射）。
 *
 * - ppt 类型：直接映射 `model.slides`；
 * - 其它块文档：按标题分组映射为幻灯片；
 * - 课件 3D：开头插入「静态预览页」，备注「建议用网页版查看 3D」。
 *
 * @param model 文档模型。
 * @param opts 导出选项（含网页版地址）。
 */
export async function exportPptx(model: DocModel, opts: ExportOptions = {}): Promise<void> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.author = '师创';
  pptx.company = '师创';
  pptx.title = model.meta?.title ?? '师创文档';

  const baseSlides: PptxSlide[] =
    model.kind === 'ppt' && model.slides && model.slides.length > 0
      ? [...toPptxSlides(model)]
      : [...blocksToSlides(model)];

  // 课件 3D：开头插一张静态预览页（网页版交互查看提示）
  if (model.kind === 'courseware_3d' && model.scene) {
    baseSlides.unshift({
      index: 0,
      title: `3D 课件：${model.scene.title ?? '三维教学模型'}`,
      bullets: [
        ...(model.scene.annotations && model.scene.annotations.length > 0
          ? (model.scene.annotations as string[])
          : ['可旋转 / 拆解 / 标注的三维教学模型']),
        '（本页为静态预览，建议在网页版交互查看）',
      ],
      notes: `建议用网页版查看 3D：${opts.renderUrl ?? window.location.origin}`,
    });
  }

  for (const s of baseSlides) {
    const slide = pptx.addSlide();
    slide.addText(s.title || '（无标题）', {
      x: 0.4,
      y: 0.3,
      w: 9.2,
      h: 0.7,
      fontSize: 28,
      bold: true,
      color: '1B1F27',
    });

    if (s.bullets.length > 0) {
      slide.addText(
        s.bullets.map((b) => ({ text: b })),
        {
          x: 0.5,
          y: 1.1,
          w: 9.0,
          h: 4.1,
          fontSize: 18,
          bullet: { indent: 20 },
          color: '333333',
          lineSpacingMultiple: 1.2,
        },
      );
    } else {
      slide.addText('（本页无正文要点）', {
        x: 0.5,
        y: 1.2,
        w: 9.0,
        h: 1,
        fontSize: 16,
        italic: true,
        color: '999999',
      });
    }

    if (s.notes) slide.addNotes(s.notes);
  }

  const fileName = `${safeFileName(model.meta?.title)}.pptx`;
  await pptx.writeFile({ fileName });
}

/**
 * 导出 DOCX（浏览器端，结构映射）。
 *
 * 复用 `toDocxOutline` 的映射：标题 → 对应层级标题，列表 → Word 编号/项目符号，
 * 正文 → 段落，表格/图片在结构映射下转写为可读文本（保真度中等，符合阻塞②选项 A）。
 *
 * @param model 文档模型。
 * @param opts 导出选项（保留扩展位，当前未使用）。
 */
export async function exportDocx(model: DocModel, _opts: ExportOptions = {}): Promise<void> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    AlignmentType,
  } = await import('docx');

  const nodes = toDocxOutline(model);
  const children: InstanceType<typeof Paragraph>[] = [];

  children.push(
    new Paragraph({
      text: model.meta?.title || '师创文档',
      heading: HeadingLevel.HEADING_1,
    }),
  );

  const metaLine = [
    model.meta?.subject && `学科：${model.meta.subject}`,
    model.meta?.grade && `年级：${model.meta.grade}`,
    model.meta?.textbook && `教材：${model.meta.textbook}`,
  ]
    .filter(Boolean)
    .join('    ');
  if (metaLine) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: metaLine, color: '666666' })],
        spacing: { after: 200 },
      }),
    );
  }

  const headingByLevel = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
  ];

  for (const node of nodes) {
    if (node.level >= 1 && node.level <= 4) {
      const level = node.level - 1;
      children.push(
        new Paragraph({
          text: node.text,
          heading: headingByLevel[level],
          spacing: { before: 140, after: 80 },
        }),
      );
    } else if (node.list) {
      children.push(
        new Paragraph({
          text: node.text,
          numbering: { reference: node.ordered ? 'shichuang-ordered' : 'shichuang-bullet', level: 0 },
          spacing: { after: 40 },
        }),
      );
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: node.text })],
          spacing: { after: 80 },
        }),
      );
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'shichuang-ordered',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
        {
          reference: 'shichuang-bullet',
          levels: [
            {
              level: 0,
              format: 'bullet',
              text: '•',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, `${safeFileName(model.meta?.title)}.docx`);
}
