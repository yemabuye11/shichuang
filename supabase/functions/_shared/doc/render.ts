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

import type { ChartSpec, DocBlock, DocModel, SceneDescriptor, Slide } from './types.ts';
import { blocksToText, checkGeometry } from './geometryKernel.ts';

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

/** 图表画布尺寸与内边距（与前端 `ChartBlockView` 保持一致）。 */
const CHART = { w: 640, h: 360, top: 24, right: 24, bottom: 46, left: 56 } as const;

/** 数值格式化（去掉多余小数）。 */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000) return String(Math.round(n));
  if (abs >= 10) return String(Math.round(n * 10) / 10);
  return String(Math.round(n * 100) / 100);
}

/** 取 5 段刻度。 */
function niceTicks(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const v = Number.isFinite(min) ? min : 0;
    return [v - 2, v - 1, v, v + 1, v + 2];
  }
  const step = (max - min) / 4;
  return [0, 1, 2, 3, 4].map((i) => min + step * i);
}

/**
 * 渲染图表块为**内联 SVG 字符串**（不引第三方图表库）。
 *
 * @param spec 图表数据。
 */
function renderChartSvg(spec: ChartSpec): string {
  const { w, h, top, right, bottom, left } = CHART;
  const plotW = w - left - right;
  const plotH = h - top - bottom;

  const pts = (spec.points ?? []).filter((p) => Array.isArray(p) && p.length >= 2) as number[][];
  const categories = spec.categories ?? [];
  const values = spec.values ?? [];
  const isBar = spec.kind === 'bar';

  let xMin = 0;
  let xMax = 1;
  let yMin = 0;
  let yMax = 1;

  if (isBar) {
    xMin = -0.5;
    xMax = Math.max(categories.length - 0.5, 0.5);
    const nums = values.map(Number).filter(Number.isFinite);
    yMin = Math.min(0, ...nums);
    yMax = Math.max(0, ...nums);
  } else if (pts.length > 0) {
    const xs = pts.map((p) => Number(p[0]));
    const ys = pts.map((p) => Number(p[1]));
    xMin = Math.min(...xs);
    xMax = Math.max(...xs);
    yMin = Math.min(...ys);
    yMax = Math.max(...ys);
    if (xMin === xMax) {
      xMin -= 1;
      xMax += 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    if (spec.kind === 'function') {
      yMin = Math.min(yMin, 0);
      yMax = Math.max(yMax, 0);
    }
  }
  const yPad = (yMax - yMin) * 0.06 || 1;
  yMin -= yPad;
  yMax += yPad;

  const sx = (x: number): number => left + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (y: number): number => top + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

  const parts: string[] = [];
  const gridColor = '#EDEFF3';
  const axisColor = '#C9CFD8';

  for (const t of niceTicks(yMin, yMax)) {
    parts.push(
      `<line x1="${left}" y1="${sy(t).toFixed(2)}" x2="${w - right}" y2="${sy(t).toFixed(2)}" stroke="${gridColor}" stroke-width="1"/>`,
      `<text x="${left - 8}" y="${(sy(t) + 4).toFixed(2)}" text-anchor="end" font-size="11" fill="#6B7280">${esc(fmtNum(t))}</text>`,
    );
  }

  if (isBar) {
    const slot = plotW / Math.max(categories.length, 1);
    const barW = Math.min(slot * 0.56, 48);
    values.forEach((v, i) => {
      const nv = Number(v);
      if (!Number.isFinite(nv)) return;
      const yTop = sy(Math.max(nv, 0));
      const yBottom = sy(Math.min(nv, 0));
      const bh = Math.max(yBottom - yTop, 1);
      parts.push(
        `<rect x="${(sx(i) - barW / 2).toFixed(2)}" y="${yTop.toFixed(2)}" width="${barW.toFixed(2)}" height="${bh.toFixed(2)}" rx="4" fill="#2F6BFF" opacity="0.85"/>`,
        `<text x="${sx(i).toFixed(2)}" y="${(yTop - 6).toFixed(2)}" text-anchor="middle" font-size="11" fill="#4B5563" font-weight="600">${esc(fmtNum(nv))}</text>`,
        `<text x="${sx(i).toFixed(2)}" y="${h - bottom + 20}" text-anchor="middle" font-size="11" fill="#6B7280">${esc(String(categories[i] ?? ''))}</text>`,
      );
    });
  } else if (pts.length > 0) {
    const d = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(Number(p[0])).toFixed(2)},${sy(Number(p[1])).toFixed(2)}`)
      .join(' ');
    parts.push(
      `<path d="${d}" fill="none" stroke="#2F6BFF" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    for (const p of pts) {
      parts.push(
        `<circle cx="${sx(Number(p[0])).toFixed(2)}" cy="${sy(Number(p[1])).toFixed(2)}" r="3" fill="#fff" stroke="#2F6BFF" stroke-width="2"/>`,
      );
    }
    const tickCount = 5;
    for (let i = 0; i < tickCount; i += 1) {
      const v = xMin + ((xMax - xMin) / (tickCount - 1)) * i;
      parts.push(
        `<text x="${sx(v).toFixed(2)}" y="${h - bottom + 20}" text-anchor="middle" font-size="11" fill="#6B7280">${esc(fmtNum(v))}</text>`,
      );
    }
  } else {
    parts.push(
      `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="13" fill="#9AA4B2">（图表数据为空）</text>`,
    );
  }

  const zeroY = yMin <= 0 && yMax >= 0 ? sy(0) : null;
  parts.push(
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${h - bottom}" stroke="${axisColor}" stroke-width="1.5"/>`,
    `<line x1="${left}" y1="${h - bottom}" x2="${w - right}" y2="${h - bottom}" stroke="${axisColor}" stroke-width="1.5"/>`,
  );
  if (zeroY !== null && zeroY > top && zeroY < h - bottom) {
    parts.push(
      `<line x1="${left}" y1="${zeroY.toFixed(2)}" x2="${w - right}" y2="${zeroY.toFixed(2)}" stroke="${axisColor}" stroke-width="1.5"/>`,
    );
  }
  if (spec.xLabel) {
    parts.push(
      `<text x="${w / 2}" y="${h - 8}" text-anchor="middle" font-size="12" fill="#4B5563">${esc(spec.xLabel)}</text>`,
    );
  }
  if (spec.yLabel) {
    parts.push(
      `<text x="14" y="${h / 2}" text-anchor="middle" font-size="12" fill="#4B5563" transform="rotate(-90 14 ${h / 2})">${esc(spec.yLabel)}</text>`,
    );
  }

  const expr = spec.expression
    ? `<div class="b-chart-expr">${esc(spec.expression)}</div>`
    : '';
  const title = spec.title ? `<figcaption class="b-cap">${esc(spec.title)}</figcaption>` : '';

  return (
    `<figure class="b-fig b-chart">${expr}` +
    `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(spec.title ?? spec.expression ?? '图表')}">${parts.join('')}</svg>` +
    `${title}</figure>`
  );
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
    case 'chart': {
      if (!block.chart) {
        return `<p class="b-p"${idAttr}>${esc(block.caption ?? '（图表数据缺失）')}</p>`;
      }
      return `<div${idAttr}>${renderChartSvg(block.chart)}</div>`;
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
function renderScene(scene: SceneDescriptor, bodyText = ''): string {
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

  // ⚠️ 几何体：标注值一律走确定性内核重算，不用 AI 直接给的数值（教学事故防线）
  const geo = scene.type === 'geometry' ? checkGeometry(scene, bodyText) : null;

  const annos = (() => {
    if (geo) return geo.annotations;
    return (scene.annotations ?? []).map((a) => String(a));
  })();

  const annoHtml =
    annos.length > 0 ? `<ul class="scene-anno">${annos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : '';

  const guardHtml =
    geo && geo.degradedReason
      ? `<p class="scene-guard">⚠ ${esc(geo.degradedReason)}</p>`
      : geo && geo.corrected
        ? `<p class="scene-guard">标注已按几何关系自动校正：模型上的数值由平台按几何公式重新计算，不采用 AI 直接给出的数值${
            geo.droppedAiAnnotations.length > 0 ? `；已剔除 ${geo.droppedAiAnnotations.length} 条不一致的原标注` : ''
          }${geo.droppedByBody.length > 0 ? `；另有 ${geo.droppedByBody.length} 个量与正文不一致，已不予展示` : ''}。</p>`
        : '';

  return (
    `<div class="scene-wrap${supported ? '' : ' scene-unsupported'}">` +
    `<div class="scene-head">${head}</div>` +
    `<div class="scene-card"><p class="scene-notice">${esc(notice)}</p>${guardHtml}${annoHtml}</div>` +
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
    model.kind === 'courseware_3d' && model.scene
      ? renderScene(model.scene, blocksToText(model.blocks))
      : '';
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
.b-chart{margin:16px 0;padding:12px;border:1px solid var(--line);border-radius:10px;background:#fff;}
.b-chart svg{display:block;width:100%;height:auto;}
.b-chart-expr{text-align:center;font-weight:700;color:var(--brand);font-family:ui-monospace,Menlo,Consolas,monospace;
  font-size:15px;margin-bottom:6px;}
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
.scene-guard{margin:10px 0 0;padding:8px 12px;border-radius:8px;background:#F0F5FF;
  border-left:4px solid var(--brand);font-size:13px;line-height:1.75;color:#234;}
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
