/**
 * 文档渲染器（T06）：把结构化 DocModel 渲染为**平台可信**的自包含 Web HTML。
 *
 * 约束（ARCHITECTURE.md §C.8 阻塞① B / ②）：
 * - 文档产物走 `/d/` 路径、平台壳渲染、**不使用 iframe sandbox**（内容由平台信任）；
 * - 不引用任何外部资源（离线/校园网可用），图形用 CSS/SVG/内联；
 * - courseware_3d 的 3D 部分采用「内嵌 SceneDescriptor + 懒加载 three」骨架：
 *   从同源 `/vendor/three.module.js` 动态 import，失败则降级提示用平台 3D 查看器打开。
 *
 * 该 HTML 与「编辑态（前端 TipTap）/ 导出态（T08 docx/pptxgenjs）」共享同一 DocModel。
 */

import type { DocBlock, DocModel, SceneDescriptor, Slide } from './types.ts';

/** HTML 转义。 */
function esc(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 在文本中保留基础换行。 */
function nl2br(s: string | undefined): string {
  return esc(s).replace(/\n/g, '<br>');
}

/** 渲染单个富文本块。 */
function renderBlock(block: DocBlock): string {
  const idAttr = ` data-block="${esc(block.id)}"`;
  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(block.level ?? 2), 1), 4);
      const sizeMap: Record<number, string> = { 1: '26px', 2: '21px', 3: '18px', 4: '16px' };
      return `<h${level} class="b-h" style="font-size:${sizeMap[level]}"${idAttr}>${nl2br(block.text)}</h${level}>`;
    }
    case 'paragraph':
      return `<p class="b-p"${idAttr}>${nl2br(block.text)}</p>`;
    case 'list': {
      const ordered = block.ordered === true;
      const tag = ordered ? 'ol' : 'ul';
      const items = (block.items ?? []).map((it) => `<li>${nl2br(it)}</li>`).join('');
      return `<${tag} class="b-list"${idAttr}>${items}</${tag}>`;
    }
    case 'table': {
      const header = (block.header ?? []).map((h) => `<th>${esc(h)}</th>`).join('');
      const rows = (block.rows ?? [])
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('');
      return (
        `<table class="b-table"${idAttr}>` +
        (header ? `<thead><tr>${header}</tr></thead>` : '') +
        `<tbody>${rows}</tbody></table>`
      );
    }
    case 'image': {
      const caption = block.caption ? `<figcaption class="b-cap">${esc(block.caption)}</figcaption>` : '';
      const inner = block.src
        ? `<img src="${esc(block.src)}" alt="${esc(block.caption)}" loading="lazy">`
        : `<div class="b-img-ph">建议配图：${esc(block.caption ?? '（未提供）')}</div>`;
      return `<figure class="b-fig"${idAttr}>${inner}${caption}</figure>`;
    }
    case 'callout': {
      const align = block.align ?? 'left';
      return `<div class="b-callout" style="text-align:${align}"${idAttr}>${nl2br(block.text)}</div>`;
    }
    default:
      return `<p class="b-p"${idAttr}>${nl2br(block.text)}</p>`;
  }
}

/** 渲染幻灯片（PPT）。 */
function renderSlides(slides: readonly Slide[]): string {
  const pages = slides
    .map((s) => {
      const body = s.body.map(renderBlock).join('');
      const notes = s.notes ? `<aside class="s-notes">备注：${nl2br(s.notes)}</aside>` : '';
      return (
        `<section class="slide" data-index="${s.index}">` +
        `<h2 class="s-title">${esc(s.title)}</h2>` +
        `<div class="s-body">${body}</div>${notes}</section>`
      );
    })
    .join('');
  return `<div class="slides">${pages}</div>`;
}

/**
 * 渲染 3D 场景（**静态、诚实**的预览卡片，不引 three）。
 *
 * ⚠️ 历史问题（见 docs/QUALITY_BASELINE.md）：旧实现在这里 `import('/vendor/three.module.js')`
 *    —— 该路径在产物里并不存在，导致教师打开分享页只看到一个黑色空框 + 「本页未内置
 *    Three.js」。而 three 有 747KB，也不该为了一张静态预览把它塞进产物。
 *
 * 现在改为：直接渲染一张包含「场景标题 + 标注要点 + 平台查看指引」的静态卡片，
 * 不加载任何外部资源、不假装能交互。交互版 3D 在平台内 `/d/:id` 由 ThreeViewer 渲染
 * （且只支持 geometry / molecule 两类真模型，其余类型同样给诚实提示而非空壳模型）。
 */
function renderScene(scene: SceneDescriptor): string {
  const supported = scene.type === 'geometry' || scene.type === 'molecule';
  const kindLabel: Record<string, string> = {
    geometry: '几何体',
    molecule: '分子结构',
    function: '函数图像',
    globe: '地球仪',
    circuit: '电路',
    biology: '生物结构',
    physics: '物理装置',
    custom: '自定义模型',
  };
  const label = kindLabel[String(scene.type ?? '')] ?? String(scene.type ?? '模型');
  const head = supported
    ? `3D ${label}（可交互版请在平台内打开）`
    : `3D ${label}：本节暂未支持，已保留完整文字讲解`;
  const notice = supported
    ? '这是一个静态预览。可旋转 / 拆解的交互版请在平台内打开本文档查看。'
    : '平台的 3D 课件目前只支持「几何体」与「分子结构」两类真模型。为避免给出与课堂内容无关的空壳模型，这里不显示 3D，请以上方文字讲解为准。';

  const annos = (scene.annotations ?? []).length
    ? `<ul class="scene-anno">${(scene.annotations ?? [])
        .map((a) => `<li>${esc(a)}</li>`)
        .join('')}</ul>`
    : '';

  return (
    `<div class="scene-wrap${supported ? '' : ' scene-unsupported'}">` +
    `<div class="scene-head">${head}</div>` +
    `<div class="scene-card"><p class="scene-notice">${esc(notice)}</p>${annos}</div>` +
    `</div>`
  );
}

/**
 * 把 DocModel 渲染为自包含 Web HTML。
 *
 * @param model 文档模型。
 * @returns 完整 HTML 字符串。
 */
export function renderDoc(model: DocModel): string {
  const meta = model.meta ?? { title: '未命名文档' };
  const title = esc(meta.title);
  const subtitleBits = [
    meta.subject,
    meta.grade,
    meta.textbook,
    model.kind === 'courseware_3d' ? null : null,
  ]
    .filter(Boolean)
    .map(esc)
    .join(' · ');

  const blocksHtml = (model.blocks ?? []).map(renderBlock).join('');
  const slidesHtml = model.kind === 'ppt' && model.slides ? renderSlides(model.slides) : '';
  const sceneHtml =
    model.kind === 'courseware_3d' && model.scene ? renderScene(model.scene) : '';
  const verifyHtml =
    model.verifyHints && model.verifyHints.length > 0
      ? `<section class="verify"><h3>⚠ 待教师核对</h3><ul>${model.verifyHints
          .map((h) => `<li>${esc(h)}</li>`)
          .join('')}</ul></section>`
      : '';

  const body =
    (model.kind === 'ppt' ? slidesHtml : blocksHtml + sceneHtml) + verifyHtml;

  const css = `
:root{--brand:#2F6BFF;--ink:#1B1F27;--sub:#6B7280;--line:#E5E7EB;--bg:#FFFFFF;}
*{box-sizing:border-box;}
body{margin:0;padding:32px;color:var(--ink);background:var(--bg);
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  font-size:16px;line-height:1.8;}
.doc{max-width:840px;margin:0 auto;}
.doc-title{font-size:30px;font-weight:700;margin:0 0 4px;}
.doc-sub{color:var(--sub);margin:0 0 24px;font-size:15px;}
.b-h{font-weight:700;margin:22px 0 10px;line-height:1.4;}
.b-p{margin:10px 0;}
.b-list{margin:10px 0;padding-left:24px;}
.b-list li{margin:4px 0;}
.b-table{border-collapse:collapse;width:100%;margin:14px 0;font-size:15px;}
.b-table th,.b-table td{border:1px solid var(--line);padding:8px 12px;text-align:left;vertical-align:top;}
.b-table th{background:#F3F5F9;}
.b-fig{margin:14px 0;text-align:center;}
.b-fig img{max-width:100%;border-radius:10px;border:1px solid var(--line);}
.b-img-ph{display:inline-block;padding:28px 18px;border:2px dashed var(--line);border-radius:10px;
  color:var(--sub);background:#FAFBFC;font-size:14px;}
.b-cap{font-size:13px;color:var(--sub);margin-top:6px;}
.b-callout{background:#F0F5FF;border-left:4px solid var(--brand);padding:12px 16px;border-radius:8px;
  margin:14px 0;color:#234;font-size:15px;}
.slides{margin:0;}
.slide{page-break-after:always;border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:24px;}
.s-title{font-size:24px;font-weight:700;margin:0 0 14px;}
.s-body{font-size:16px;}
.s-notes{margin-top:16px;color:var(--sub);font-size:13px;border-top:1px dashed var(--line);padding-top:10px;}
.scene-wrap{margin:18px 0;border:1px solid var(--line);border-radius:12px;padding:16px;}
.scene-head{font-weight:700;font-size:18px;margin-bottom:10px;}
.scene-card{border-radius:10px;padding:14px 16px;background:#F7F9FC;border:1px dashed var(--line);}
.scene-unsupported{border-color:#F2C14E;background:#FFFDF6;}
.scene-unsupported .scene-head{color:#9A6B00;}
.scene-unsupported .scene-card{background:#FFF8E6;border-color:#F2C14E;}
.scene-notice{margin:0;font-size:14px;line-height:1.8;color:#4B5563;}
.scene-unsupported .scene-notice{color:#6B4E00;}
.scene-anno{margin:12px 0 0;padding-left:20px;color:var(--sub);font-size:14px;}
.scene-anno li{margin:3px 0;}
.verify{margin-top:28px;border:1px solid #F2C14E;background:#FFF8E6;border-radius:10px;padding:14px 18px;}
.verify h3{margin:0 0 8px;font-size:16px;color:#9A6B00;}
.verify ul{margin:0;padding-left:20px;}
@media print{body{padding:0;}button{display:none;}.slide{page-break-after:always;}}
`;

  const head = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}</style>
</head>
<body>
<main class="doc">
<h1 class="doc-title">${title}</h1>
${subtitleBits ? `<p class="doc-sub">${subtitleBits}</p>` : ''}
${body}
</main>
</body>
</html>`;

  return head;
}
