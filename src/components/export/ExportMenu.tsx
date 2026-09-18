import { useState } from 'react';
import { Button, Menu, MenuItem } from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import SlideshowIcon from '@mui/icons-material/Slideshow';
import DescriptionIcon from '@mui/icons-material/Description';
import LinkIcon from '@mui/icons-material/Link';
import * as exportService from '@/services/exportService';
import * as docService from '@/services/docService';
import { docRunPath } from '@/config/routes';
import { useToast } from '@/components/common/ToastHost';
import type { DocModel } from '@/types/doc';

/**
 * 导出 / 分享菜单（T08，UI-5）。
 *
 * 三个动作：
 * - 导出 PPTX：浏览器端 `pptxgenjs` 结构映射，零服务端成本；
 * - 导出 Word：浏览器端 `docx` 结构映射；
 * - 复制网页链接：调用 `docService.renderAndPublish` 取分享地址并写入剪贴板。
 *
 * 全部在浏览器完成；导出前 Network 面板无任何上传 / 下载请求（PRD 4.3 红线）。
 */

/** 导出菜单属性。 */
export interface ExportMenuProps {
  /** 文档 id（用于发布链接）。 */
  docId: string;
  /** 当前可编辑的文档模型（导出内容来源）。 */
  model: DocModel | null;
  /** 网页版地址（可选，缺省时按 docRunPath 拼接）。 */
  renderUrl?: string;
}

/** 当前正在进行的导出动作（用于禁用与 loading 态）。 */
type Busy = 'pptx' | 'docx' | 'link' | null;

export function ExportMenu({ docId, model, renderUrl }: ExportMenuProps): JSX.Element {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const toast = useToast();

  const fullRenderUrl = renderUrl ?? `${window.location.origin}${docRunPath(docId)}`;

  const handlePptx = async (): Promise<void> => {
    if (!model) return;
    setBusy('pptx');
    setAnchor(null);
    try {
      await exportService.exportPptx(model, { renderUrl: fullRenderUrl });
      toast.success('PPTX 已生成，开始下载');
    } catch (error) {
      console.error('[ExportMenu] PPTX export failed', error);
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`导出 PPTX 失败：${message}`);
    } finally {
      setBusy(null);
    }
  };

  const handleDocx = async (): Promise<void> => {
    if (!model) return;
    setBusy('docx');
    setAnchor(null);
    try {
      await exportService.exportDocx(model);
      toast.success('Word 已生成，开始下载');
    } catch {
      toast.error('导出 Word 失败，请重试');
    } finally {
      setBusy(null);
    }
  };

  const handleLink = async (): Promise<void> => {
    setBusy('link');
    setAnchor(null);
    try {
      const { renderUrl: path } = await docService.renderAndPublish(docId);
      const url = `${window.location.origin}${path}`;
      await navigator.clipboard?.writeText(url);
      toast.success('网页链接已复制，可发到班级群');
    } catch {
      toast.error('复制链接失败，请手动复制地址栏');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button
        variant="contained"
        size="small"
        startIcon={<FileDownloadIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        disabled={!model}
        sx={{ minHeight: 36 }}
      >
        导出 / 分享
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => void handlePptx()} disabled={busy === 'pptx'}>
          <SlideshowIcon fontSize="small" sx={{ mr: 1 }} />
          导出 PPTX
        </MenuItem>
        <MenuItem onClick={() => void handleDocx()} disabled={busy === 'docx'}>
          <DescriptionIcon fontSize="small" sx={{ mr: 1 }} />
          导出 Word
        </MenuItem>
        <MenuItem onClick={() => void handleLink()} disabled={busy === 'link'}>
          <LinkIcon fontSize="small" sx={{ mr: 1 }} />
          复制网页链接
        </MenuItem>
      </Menu>
    </>
  );
}

export default ExportMenu;
