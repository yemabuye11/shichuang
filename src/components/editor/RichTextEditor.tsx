import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import {
  Box,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import TitleIcon from '@mui/icons-material/Title';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import ImageIcon from '@mui/icons-material/Image';
import TableChartIcon from '@mui/icons-material/TableChart';
import LinkIcon from '@mui/icons-material/Link';
import type { BloomLevel, DocBlock } from '@/types/doc';
import { uid } from '@/utils/uid';

/**
 * 富文本编辑器（T08，TipTap）。
 *
 * 用于「教案 / 办公文档 / 课件 2D」的在线文字与结构编辑。
 * 与平台「一份 DocModel 源」对齐：编辑器内部用 TipTap 文档，加载时把
 * `DocModel.blocks` 转为 HTML 填充，编辑时把 TipTap HTML 反向解析回
 * `DocBlock[]` 回传给父组件（由父组件统一存为新版本）。
 *
 * ⚠️ 本组件由 `DocEditorPage` 经 `React.lazy` 引入，因此 TipTap 进入独立 chunk，
 * 不进入首屏主包。
 */

// ---------------------------------------------------------------------------
// blocks <-> HTML 双向映射（结构化，非截图）
// ---------------------------------------------------------------------------

/** HTML 转义。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 把 DocModel 块序列渲染为 TipTap 可识别的 HTML。 */
function blocksToHtml(blocks: readonly DocBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const level = b.level ?? 2;
        parts.push(`<h${level}>${escapeHtml(b.text ?? '')}</h${level}>`);
        break;
      }
      case 'paragraph':
        parts.push(`<p>${escapeHtml(b.text ?? '')}</p>`);
        break;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = (b.items ?? []).map((i) => `<li>${escapeHtml(i)}</li>`).join('');
        parts.push(`<${tag}>${items}</${tag}>`);
        break;
      }
      case 'table': {
        const head = (b.header ?? []).map((h) => `<th>${escapeHtml(h)}</th>`).join('');
        const rows = (b.rows ?? [])
          .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
          .join('');
        parts.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
        break;
      }
      case 'image':
        parts.push(
          `<figure><img src="${escapeHtml(b.src ?? '')}" alt="${escapeHtml(b.caption ?? '')}"/>` +
            `<figcaption>${escapeHtml(b.caption ?? '')}</figcaption></figure>`,
        );
        break;
      case 'callout':
        parts.push(
          `<blockquote class="callout"><p>${escapeHtml(b.text ?? '')}</p>` +
            `${b.caption ? `<p class="caption">${escapeHtml(b.caption)}</p>` : ''}</blockquote>`,
        );
        break;
      default:
        break;
    }
  }
  return parts.join('');
}

/**
 * 块的「元数据索引」键：归一化文本。
 *
 * 背景：TipTap（ProseMirror）只保留 schema 里声明过的属性，
 * 写在 HTML 上的 `data-bloom` 会被解析时丢弃，编辑往返会**静默丢掉认知层级**。
 * 因此改为「按归一化文本匹配」回填——教师没改这一节，元数据就不丢。
 */
function metaKey(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 一条块的认知层级 / 互动设计元数据。 */
interface BlockMeta {
  bloom?: BloomLevel;
  interaction?: string;
}

/** 把块序列抽出「文本 → 元数据」索引，供编辑往返回填。 */
function buildMetaIndex(blocks: readonly DocBlock[]): Map<string, BlockMeta> {
  const map = new Map<string, BlockMeta>();
  for (const b of blocks) {
    if (!b.bloom && !b.interaction) continue;
    const key = metaKey(b.text ?? (b.items ?? []).join(' ') ?? '');
    if (!key) continue;
    // 同一文本出现多次时保留首次（教学环节标题通常唯一）
    if (!map.has(key)) map.set(key, { bloom: b.bloom, interaction: b.interaction });
  }
  return map;
}

/** 把 TipTap HTML 解析回 DocBlock 序列（顶层块逐一映射）。 */
function htmlToBlocks(html: string, metaIndex: Map<string, BlockMeta> = new Map()): DocBlock[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: DocBlock[] = [];

  /** 按文本回填认知层级 / 互动设计（教师未改动该节时保留）。 */
  const metaOf = (text: string): BlockMeta => metaIndex.get(metaKey(text)) ?? {};

  const walk = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') {
        const text = child.textContent ?? '';
        blocks.push({
          id: uid('b'),
          type: 'heading',
          level: Number(tag[1]),
          text,
          ...metaOf(text),
        });
      } else if (tag === 'p') {
        const text = child.textContent ?? '';
        blocks.push({ id: uid('b'), type: 'paragraph', text, ...metaOf(text) });
      } else if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(child.querySelectorAll('li'))
          .map((li) => li.textContent ?? '')
          .filter((t) => t.trim().length > 0);
        const joined = items.join(' ');
        blocks.push({
          id: uid('b'),
          type: 'list',
          ordered: tag === 'ol',
          items,
          ...metaOf(joined),
        });
      } else if (tag === 'table') {
        const header = Array.from(child.querySelectorAll('thead th')).map((th) => th.textContent ?? '');
        const rows = Array.from(child.querySelectorAll('tbody tr')).map((tr) =>
          Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? ''),
        );
        blocks.push({ id: uid('b'), type: 'table', header, rows });
      } else if (tag === 'figure') {
        const img = child.querySelector('img');
        const cap = child.querySelector('figcaption');
        blocks.push({
          id: uid('b'),
          type: 'image',
          src: img?.getAttribute('src') ?? '',
          caption: cap?.textContent ?? '',
        });
      } else if (tag === 'blockquote') {
        const ps = Array.from(child.querySelectorAll('p'));
        const caption = child.querySelector('p.caption')?.textContent ?? '';
        const text = ps[0]?.textContent ?? '';
        blocks.push({ id: uid('b'), type: 'callout', text, caption, ...metaOf(text) });
      } else if (tag === 'img') {
        blocks.push({
          id: uid('b'),
          type: 'image',
          src: child.getAttribute('src') ?? '',
          caption: child.getAttribute('alt') ?? '',
        });
      } else {
        // 未知容器：递归展开其子节点，避免内容丢失
        walk(child);
      }
    }
  };

  walk(doc.body);
  return blocks;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/** 富文本编辑器属性。 */
export interface RichTextEditorProps {
  /** 初始块序列（来自 DocModel.blocks）。 */
  blocks: readonly DocBlock[];
  /** 内容变化回调（返回新的块序列）。 */
  onChange: (blocks: DocBlock[]) => void;
}

export function RichTextEditor({ blocks, onChange }: RichTextEditorProps): JSX.Element {
  // 仅在挂载时计算一次初始 HTML（编辑中由 TipTap 内部状态持有）
  const initialHtml = useMemo(() => blocksToHtml(blocks), []); // eslint-disable-line react-hooks/exhaustive-deps

  // 认知层级 / 互动设计的回填索引：教师没改动的块，编辑往返不丢元数据
  const metaIndex = useMemo(() => buildMetaIndex(blocks), [blocks]);
  const metaIndexRef = useRef(metaIndex);
  useEffect(() => {
    metaIndexRef.current = metaIndex;
  }, [metaIndex]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: '在此输入教案 / 办公文档内容…（支持标题、列表、表格、图片）' }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialHtml,
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => {
      onChange(htmlToBlocks(ed.getHTML(), metaIndexRef.current));
    },
  });

  const insertImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('粘贴图片地址（https://…）');
    if (url && url.trim()) {
      editor.chain().focus().setImage({ src: url.trim() }).run();
    }
  }, [editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('粘贴链接地址（https://…）');
    if (url && url.trim()) {
      editor.chain().focus().setLink({ href: url.trim() }).run();
    }
  }, [editor]);

  const ToolBtn = ({
    title,
    onClick,
    active,
    children,
  }: {
    title: string;
    onClick: () => void;
    active?: boolean;
    children: ReactNode;
  }): JSX.Element => (
    <Tooltip title={title}>
      <IconButton size="small" onClick={onClick} color={active ? 'primary' : 'default'} disabled={!editor}>
        {children}
      </IconButton>
    </Tooltip>
  );

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2.5,
        bgcolor: '#fff',
        overflow: 'hidden',
      }}
    >
      {/* 工具栏 */}
      <Stack
        direction="row"
        spacing={0.25}
        alignItems="center"
        sx={{
          flexWrap: 'wrap',
          px: 1,
          py: 0.75,
          borderBottom: '1px solid',
          borderColor: 'divider',
          position: 'sticky',
          top: 0,
          bgcolor: '#fff',
          zIndex: 1,
        }}
      >
        <ToolBtn title="加粗" onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive('bold')}>
          <FormatBoldIcon fontSize="small" />
        </ToolBtn>
        <ToolBtn title="斜体" onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive('italic')}>
          <FormatItalicIcon fontSize="small" />
        </ToolBtn>
        <ToolBtn title="标题" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={editor?.isActive('heading', { level: 2 })}>
          <TitleIcon fontSize="small" />
        </ToolBtn>
        <ToolBtn title="无序列表" onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive('bulletList')}>
          <FormatListBulletedIcon fontSize="small" />
        </ToolBtn>
        <ToolBtn title="有序列表" onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive('orderedList')}>
          <FormatListNumberedIcon fontSize="small" />
        </ToolBtn>
        <ToolBtn title="插入图片" onClick={insertImage}>
          <ImageIcon fontSize="small" />
        </ToolBtn>
        <ToolBtn title="插入表格" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <TableChartIcon fontSize="small" />
        </ToolBtn>
        <ToolBtn title="插入链接" onClick={setLink} active={editor?.isActive('link')}>
          <LinkIcon fontSize="small" />
        </ToolBtn>
      </Stack>

      <Divider />

      {/* 编辑区 */}
      <Box
        sx={{
          p: { xs: 1.5, sm: 2.5 },
          minHeight: 320,
          '& .ProseMirror': {
            outline: 'none',
            fontSize: 15,
            lineHeight: 1.85,
            color: 'text.primary',
            '& h1': { fontSize: 26, fontWeight: 800, mt: 1, mb: 0.5 },
            '& h2': { fontSize: 22, fontWeight: 800, mt: 1, mb: 0.5 },
            '& h3': { fontSize: 18, fontWeight: 800, mt: 1, mb: 0.5 },
            '& h4': { fontSize: 16, fontWeight: 800, mt: 1, mb: 0.5 },
            '& p': { my: 0.75 },
            '& ul, & ol': { pl: 3, my: 0.5 },
            '& img': { maxWidth: '100%', borderRadius: 2, border: '1px solid', borderColor: 'divider' },
            '& figure': { textAlign: 'center', m: 1 },
            '& figcaption': { fontSize: 13, color: 'text.secondary' },
            '& blockquote.callout': {
              borderLeft: '4px solid',
              borderColor: 'warning.main',
              bgcolor: 'rgba(245,158,11,0.08)',
              p: 1.5,
              borderRadius: 1,
              my: 1,
            },
            '& table': { borderCollapse: 'collapse', width: '100%', my: 1 },
            '& th, & td': { border: '1px solid', borderColor: 'divider', p: 1, fontSize: 14 },
            '& th': { bgcolor: 'rgba(27,31,39,0.04)', fontWeight: 800 },
            '& .ProseMirror-selectednode': { outline: '2px solid', outlineColor: 'primary.main' },
            '& p.is-editor-empty:first-of-type::before': {
              content: 'attr(data-placeholder)',
              color: 'text.disabled',
              float: 'left',
              height: 0,
              pointerEvents: 'none',
            },
          },
        }}
      >
        <EditorContent editor={editor} />
      </Box>

      <Typography sx={{ fontSize: 12, color: 'text.disabled', px: 2, py: 1 }}>
        提示：文字改动会实时写入当前文档；点「保存新版本」才会生成可恢复的新版本。
      </Typography>
    </Box>
  );
}

export default RichTextEditor;
