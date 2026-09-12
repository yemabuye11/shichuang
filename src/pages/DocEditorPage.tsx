import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useNavigate, useParams } from 'react-router-dom';
import { VerifyBanner } from '@/components/editor/VerifyBanner';
import { ExportMenu } from '@/components/export/ExportMenu';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { EmptyState } from '@/components/common/EmptyState';
import { useToast } from '@/components/common/ToastHost';
import { useDoc } from '@/hooks/useDoc';
import * as docService from '@/services/docService';
import { docRunPath, ROUTES } from '@/config/routes';
import { getDocTypeLabel } from '@/config/constants';
import type { DocBlock, DocModel, Slide } from '@/types/doc';

/**
 * 文档在线编辑页（UI-5，T08）。
 *
 * 路由 `/d/:id/edit`（公开，与 DocRunPage 共用 DocModel 源）。
 *
 * 整合：
 * - 编辑区：PPT 用 `SlideEditor`，其余（教案 / 办公文档 / 课件 2D）用 `RichTextEditor`，
 *   课件 3D 额外展示 `ThreeViewer` 预览；
 * - 核对横幅：复用 T07 的 `VerifyBanner`（不重建）；
 * - 上传修正入口：把「待核对」项或教师补写内容沉淀为教材知识（T07 `depositKnowledge`）；
 * - 导出 / 分享：`ExportMenu`（PPTX / Word / 网页链接）；
 * - 保存：编辑后 `saveVersion` 落新版本（可恢复）。
 *
 * 编辑器经 `React.lazy` 引入，确保 TipTap / 幻灯片编辑器进入独立 chunk，首屏不加载。
 */

// 懒加载编辑器（TipTap / 幻灯片编辑器进入独立 chunk）
const RichTextEditor = lazy(() => import('@/components/editor/RichTextEditor'));
const SlideEditor = lazy(() => import('@/components/editor/SlideEditor'));
const ThreeViewer = lazy(() => import('@/components/editor/ThreeViewer'));

export function DocEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { model, setModel, status, saveVersion } = useDoc(id);

  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [corrOpen, setCorrOpen] = useState(false);
  const [corrText, setCorrText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const version = savedVersion ?? model?.version ?? 1;

  /** 当前登录用户是否为该文档作者（非作者锁定为只读，防止陌生人篡改；作者本人永远可恢复）。 */
  const [canEdit, setCanEdit] = useState<boolean | null>(null);
  useEffect(() => {
    if (!id) {
      setCanEdit(false);
      return;
    }
    let alive = true;
    void docService.isDocAuthor(id).then((ok) => {
      if (alive) setCanEdit(ok);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const handleBlocksChange = useCallback(
    (blocks: DocBlock[]) => {
      setModel((m) => (m ? { ...m, blocks } : m));
    },
    [setModel],
  );

  const handleSlidesChange = useCallback(
    (slides: Slide[]) => {
      setModel((m) => (m ? { ...m, slides } : m));
    },
    [setModel],
  );

  const handleSave = useCallback(async () => {
    if (!id || !model) return;
    try {
      const res = await saveVersion(model);
      setSavedVersion(res.version);
      toast.success(`已保存第 ${res.version} 版`);
    } catch {
      toast.error('保存版本失败，请重试');
    }
  }, [id, model, saveVersion, toast]);

  const openCorrection = useCallback(() => {
    setCorrText((model?.verifyHints ?? []).join('\n'));
    setCorrOpen(true);
  }, [model]);

  const handlePickFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCorrText(String(reader.result ?? ''));
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleDeposit = useCallback(async () => {
    if (!id || !model) return;
    const text = corrText.trim();
    const hints = text ? [text] : model.verifyHints ?? [];
    try {
      const n = await docService.depositKnowledge(id, { ...model, verifyHints: hints });
      toast.success(`已沉淀 ${n} 条教材知识（同版本可复用）`);
      setCorrOpen(false);
      setCorrText('');
    } catch {
      toast.error('沉淀知识失败，请重试');
    }
  }, [id, model, corrText, toast]);

  if (status === 'loading') {
    return <InlineLoading message="正在加载文档…" />;
  }

  if (status === 'notfound' || !model) {
    return (
      <EmptyState
        icon="📝"
        title="没有找到可编辑的文档"
        description="文档可能已被删除，或链接不完整。"
        actionText="回到首页"
        onAction={() => navigate(ROUTES.HOME)}
      />
    );
  }

  if (status === 'ready' && canEdit === null) {
    return <InlineLoading message="正在校验权限…" />;
  }

  if (status === 'ready' && canEdit === false) {
    return (
      <EmptyState
        icon="🔒"
        title="仅作者可编辑"
        description="这篇文档由作者创建，只有作者能修改内容。你可以复制链接分享给老师查看，或返回预览。"
        actionText="返回预览"
        onAction={() => navigate(id ? docRunPath(id) : ROUTES.HOME)}
      />
    );
  }

  const meta = model.meta ?? { title: '文档' };
  const isPpt = model.kind === 'ppt';

  return (
    <Box sx={{ py: { xs: 2, sm: 3.5 }, maxWidth: 860, mx: 'auto' }}>
      {/* 顶部工具条 */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="text"
            size="small"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate(id ? docRunPath(id) : ROUTES.HOME)}
          >
            返回预览
          </Button>
          <Box
            component="span"
            sx={{
              fontSize: 11.5,
              fontWeight: 700,
              color: 'white',
              bgcolor: 'primary.main',
              px: 1,
              py: 0.25,
              borderRadius: 999,
            }}
          >
            {getDocTypeLabel(model.kind)}
          </Box>
          <Box
            component="span"
            sx={{
              fontSize: 11.5,
              fontWeight: 700,
              color: 'text.secondary',
              border: '1px solid',
              borderColor: 'divider',
              px: 1,
              py: 0.25,
              borderRadius: 999,
            }}
          >
            v{version}
          </Box>
        </Stack>
        <ExportMenu docId={id ?? ''} model={model} />
      </Stack>

      {/* 标题 */}
      <Typography sx={{ fontSize: { xs: 22, sm: 28 }, fontWeight: 800, lineHeight: 1.35 }}>
        {meta.title}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.75 }}>
        {meta.subject ? <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>学科：{meta.subject}</Typography> : null}
        {meta.grade ? <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>年级：{meta.grade}</Typography> : null}
        {meta.textbook ? <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>教材：{meta.textbook}</Typography> : null}
      </Stack>

      {/* 核对横幅（复用 T07） */}
      <Box sx={{ mt: 2 }}>
        <VerifyBanner model={model} />
      </Box>

      {/* 课件 3D 预览（网页版可交互；PPTX 导出含静态提示） */}
      {model.kind === 'courseware_3d' && model.scene ? (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 800, mb: 1 }}>3D 课件预览（网页版可交互旋转 / 拆解）</Typography>
          <Suspense fallback={<InlineLoading message="加载 3D 预览…" />}>
            <ThreeViewer scene={model.scene} height={360} />
          </Suspense>
        </Box>
      ) : null}

      {/* 编辑区 */}
      <Box sx={{ mt: 1 }}>
        {isPpt ? (
          <Suspense fallback={<InlineLoading message="加载幻灯片编辑器…" />}>
            <SlideEditor slides={model.slides ?? []} onChange={handleSlidesChange} />
          </Suspense>
        ) : (
          <Suspense fallback={<InlineLoading message="加载富文本编辑器…" />}>
            <RichTextEditor blocks={model.blocks} onChange={handleBlocksChange} />
          </Suspense>
        )}
      </Box>

      <Divider sx={{ my: 3 }} />

      {/* 底部动作 */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
        <Button
          variant="contained"
          size="large"
          startIcon={<SaveIcon />}
          onClick={() => void handleSave()}
          sx={{ flex: 1, minHeight: 50 }}
        >
          保存新版本
        </Button>
        <Button
          variant="outlined"
          size="large"
          startIcon={<UploadFileIcon />}
          onClick={openCorrection}
          sx={{ flex: 1, minHeight: 50, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
        >
          上传 / 补写修正
        </Button>
        <Button
          variant="outlined"
          size="large"
          startIcon={<VisibilityIcon />}
          onClick={() => navigate(id ? docRunPath(id) : ROUTES.HOME)}
          sx={{ flex: 1, minHeight: 50, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
        >
          查看网页版
        </Button>
      </Stack>

      {/* 上传 / 补写修正对话框（沉淀教材知识） */}
      <Dialog open={corrOpen} onClose={() => setCorrOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>补写 / 上传修正（沉淀为教材知识）</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1.5 }}>
            把「待核对」项的正确内容，或上传的电子版文本粘贴到下方。保存后会沉淀为同教材版本可复用的知识，下次生成可命中缓存、不再花钱检索。
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={5}
            placeholder="在此输入正确的知识点 / 例题 / 数据…"
            value={corrText}
            onChange={(e) => setCorrText(e.target.value)}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={<UploadFileIcon />}
            onClick={() => fileInputRef.current?.click()}
            sx={{ mt: 1 }}
          >
            从 .txt / .md 文件读取
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.text"
            hidden
            onChange={handlePickFile}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCorrOpen(false)}>取消</Button>
          <Button variant="contained" onClick={() => void handleDeposit()} disabled={!corrText.trim()}>
            沉淀为知识
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default DocEditorPage;
