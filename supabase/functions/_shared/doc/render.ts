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

/** 渲染 3D 场景（内嵌 SceneDescriptor + 懒加载 three 骨架）。 */
function renderScene(scene: SceneDescriptor): string {
  const json = JSON.stringify(scene);
  return (
    `<div class="scene-wrap" data-scene='${esc(json)}'>` +
    `<div class="scene-head">${esc(scene.title ?? '3D 互动模型')}</div>` +
    `<div class="scene-canvas" id="scene-canvas">` +
    `<div class="scene-fallback">正在加载 3D 查看器…（若长时间未加载，请用平台内置「3D 查看器」打开）</div>` +
    `</div>` +
    `<ul class="scene-anno">${(scene.annotations ?? []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` +
    `</div>`
  );
}

/** 3D 查看器的内联引导脚本（动态 import 同源 three，失败降级）。 */
const SCENE_BOOTSTRAP = `
<script type="module">
(function () {
  var wrap = document.querySelector('.scene-wrap');
  if (!wrap) return;
  var canvas = document.getElementById('scene-canvas');
  var fallback = canvas ? canvas.querySelector('.scene-fallback') : null;
  var scene = null;
  try { scene = JSON.parse(wrap.getAttribute('data-scene') || 'null'); } catch (e) { scene = null; }
  if (!scene) { if (fallback) fallback.textContent = '场景数据缺失'; return; }
  // 懒加载同源 three（self-contained 骨架；真实渲染由平台 ThreeViewer 兜底）
  import('/vendor/three.module.js')
    .then(function (THREE) {
      if (!fallback) return;
      fallback.textContent = '已加载 Three.js，正在构建「' + (scene.title || '模型') + '」…';
      // T08/T07 可在此接入完整渲染逻辑；当前仅占位渲染坐标轴提示
      if (typeof THREE !== 'object') { if (fallback) fallback.textContent = 'Three.js 模块格式异常，请用平台 3D 查看器打开'; }
    })
    .catch(function () {
      if (fallback) fallback.textContent = '本页未内置 Three.js，请用平台内置「3D 查看器」打开此课件。';
    });
})();
</script>`;

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
.scene-canvas{min-height:240px;display:flex;align-items:center;justify-content:center;
  background:#0E1116;border-radius:10px;color:#9AA4B2;font-size:14px;text-align:center;}
.scene-anno{margin:12px 0 0;padding-left:20px;color:var(--sub);font-size:14px;}
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
${model.kind === 'courseware_3d' ? SCENE_BOOTSTRAP : ''}
</body>
</html>`;

  return head;
}
