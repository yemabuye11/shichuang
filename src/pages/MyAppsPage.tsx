import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import PublishIcon from '@mui/icons-material/Publish';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/common/EmptyState';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { TypeChip } from '@/components/common/TypeChip';
import { useToast } from '@/components/common/ToastHost';
import { useMyApps } from '@/hooks/useMyApps';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES, appRunPath, docRunPath } from '@/config/routes';
import { copyText } from '@/utils/clipboard';
import { formatRelativeTime } from '@/utils/format';
import * as appService from '@/services/appService';
import * as trackService from '@/services/trackService';
import type { MyAppsFilter } from '@/services/appService';
import type { App } from '@/types/models';

/**
 * 我的应用（列表 + 操作：预览 / 分享 / 改名 / 发布 / 下架 / 复制 / 删除）。
 */
const FILTERS: readonly { key: MyAppsFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'published', label: '已发布' },
  { key: 'draft', label: '未发布' },
];

export function MyAppsPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh: refreshUser } = useAuth();

  const [filter, setFilter] = useState<MyAppsFilter>('all');
  const { items, loading, refresh } = useMyApps(filter);

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [activeApp, setActiveApp] = useState<App | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishSummary, setPublishSummary] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const closeMenu = (): void => {
    setMenuAnchor(null);
  };

  const openPath = (app: App): string =>
    app.category === 'doc' ? docRunPath(app.id) : appRunPath(app.id);

  const openMenu = (event: React.MouseEvent<HTMLElement>, app: App): void => {
    setActiveApp(app);
    setMenuAnchor(event.currentTarget);
  };

  const handleCopyLink = async (app: App): Promise<void> => {
    closeMenu();
    const url = `${window.location.origin}${openPath(app)}`;
    const ok = await copyText(url);
    trackService.trackShare(app.id, 'copy_link');
    toast[ok ? 'success' : 'error'](ok ? '链接已复制' : '复制失败，请手动复制');
  };

  const handleRename = async (): Promise<void> => {
    if (!activeApp) return;
    const title = renameValue.trim();
    if (!title) {
      toast.error('标题不能为空');
      return;
    }
    setBusy(true);
    try {
      await appService.rename(activeApp.id, title);
      toast.success('已改名');
      setRenameOpen(false);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async (): Promise<void> => {
    if (!activeApp) return;
    setBusy(true);
    try {
      await appService.publish(activeApp.id, { summary: publishSummary.trim() || undefined });
      trackService.track('publish', {}, activeApp.id);
      toast.success('已发布到应用广场');
      setPublishOpen(false);
      void refresh();
      void refreshUser();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async (): Promise<void> => {
    if (!activeApp) return;
    closeMenu();
    try {
      await appService.unpublish(activeApp.id);
      toast.success('已下架，广场上看不到了');
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败，请重试');
    }
  };

  const handleDuplicate = async (): Promise<void> => {
    if (!activeApp) return;
    closeMenu();
    try {
      const copy = await appService.duplicate(activeApp.id);
      toast.success('已复制一份到「未发布」');
      void refresh();
      navigate(openPath(copy));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败，请重试');
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!activeApp) return;
    setBusy(true);
    try {
      await appService.remove(activeApp.id);
      toast.success('已删除');
      setDeleteOpen(false);
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ py: { xs: 2, sm: 3 }, maxWidth: 760, mx: 'auto' }}>
      <Button
        variant="text"
        size="large"
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate(ROUTES.ME)}
        sx={{ minHeight: 44, color: 'text.secondary', mb: 1 }}
      >
        返回个人中心
      </Button>

      <Typography sx={{ fontSize: { xs: 21, sm: 24 }, fontWeight: 800 }}>我的应用</Typography>

      <Stack direction="row" spacing={1} sx={{ mt: 2, mb: 2 }}>
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            onClick={() => setFilter(f.key)}
            sx={{
              minHeight: 40,
              px: 1,
              fontSize: 15,
              fontWeight: 600,
              bgcolor: filter === f.key ? 'primary.main' : '#fff',
              color: filter === f.key ? '#fff' : 'text.primary',
              border: '1px solid',
              borderColor: filter === f.key ? 'primary.main' : 'divider',
            }}
          />
        ))}
      </Stack>

      {loading ? (
        <InlineLoading message="正在加载…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="📭"
          title={filter === 'published' ? '还没有发布过应用' : '这里还空着'}
          description="生成后点「发布」，就能出现在应用广场，被同行看到。"
          actionText="去做一个新的"
          onAction={() => navigate(ROUTES.GENERATE)}
          secondaryText="看看广场"
          onSecondary={() => navigate(ROUTES.SQUARE)}
        />
      ) : (
        <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
          {items.map((app, index) => (
            <Box key={app.id}>
              {index > 0 ? <Divider /> : null}
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.5, minHeight: 72 }}>
                <Box
                  sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                  onClick={() => navigate(openPath(app))}
                >
                  <Typography
                    sx={{
                      fontSize: 16,
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {app.title}
                  </Typography>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                    <TypeChip type={app.appType} />
                    <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                      {app.status === 'published'
                        ? '已发布'
                        : app.status === 'taken_down'
                          ? '已下架'
                          : '未发布'}
                      {' · '}
                      {formatRelativeTime(app.createdAt)}
                      {' · '}
                      {app.creditsCost} 积分
                    </Typography>
                  </Stack>
                </Box>

                <IconButton aria-label={`${app.title} 的更多操作`} onClick={(e) => openMenu(e, app)}>
                  <MoreVertIcon />
                </IconButton>
              </Stack>
            </Box>
          ))}
        </Box>
      )}

      {/* ---- 操作菜单 ---- */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem
          sx={{ minHeight: 48, fontSize: 15 }}
          onClick={() => {
            const app = activeApp;
            closeMenu();
            if (app) navigate(openPath(app));
          }}
        >
          <VisibilityOutlinedIcon sx={{ mr: 1.25, fontSize: 20 }} />
          预览 / 打开
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 48, fontSize: 15 }}
          onClick={() => {
            const app = activeApp;
            closeMenu();
            if (app) void handleCopyLink(app);
          }}
        >
          <ContentCopyIcon sx={{ mr: 1.25, fontSize: 20 }} />
          复制链接
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 48, fontSize: 15 }}
          onClick={() => {
            setRenameValue(activeApp?.title ?? '');
            closeMenu();
            setRenameOpen(true);
          }}
        >
          <DriveFileRenameOutlineIcon sx={{ mr: 1.25, fontSize: 20 }} />
          改名
        </MenuItem>
        {activeApp?.status === 'published' ? (
          <MenuItem sx={{ minHeight: 48, fontSize: 15 }} onClick={() => void handleUnpublish()}>
            <RemoveCircleOutlineIcon sx={{ mr: 1.25, fontSize: 20 }} />
            从广场下架
          </MenuItem>
        ) : (
          <MenuItem
            sx={{ minHeight: 48, fontSize: 15 }}
            onClick={() => {
              setPublishSummary(activeApp?.summary ?? '');
              closeMenu();
              setPublishOpen(true);
            }}
          >
            <PublishIcon sx={{ mr: 1.25, fontSize: 20 }} />
            发布到广场
          </MenuItem>
        )}
        <MenuItem sx={{ minHeight: 48, fontSize: 15 }} onClick={() => void handleDuplicate()}>
          <ContentCopyIcon sx={{ mr: 1.25, fontSize: 20 }} />
          复制一份
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 48, fontSize: 15, color: 'error.main' }}
          onClick={() => {
            closeMenu();
            setDeleteOpen(true);
          }}
        >
          <DeleteOutlineIcon sx={{ mr: 1.25, fontSize: 20 }} />
          删除
        </MenuItem>
      </Menu>

      {/* ---- 改名 ---- */}
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>给应用改个名字</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            inputProps={{ 'aria-label': '应用标题', maxLength: 40 }}
            sx={{ '& .MuiOutlinedInput-root': { fontSize: 16 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setRenameOpen(false)} size="large" sx={{ minHeight: 44 }}>
            取消
          </Button>
          <Button onClick={() => void handleRename()} variant="contained" size="large" disabled={busy}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- 发布 ---- */}
      <Dialog open={publishOpen} onClose={() => setPublishOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>发布到应用广场</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: 'text.secondary', mb: 1.5, lineHeight: 1.7 }}>
            发布后其他老师能看到并复用，你会获得发布奖励积分。
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="一句话简介（选填）"
            value={publishSummary}
            onChange={(e) => setPublishSummary(e.target.value)}
            inputProps={{ 'aria-label': '应用简介', maxLength: 80 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={() => setPublishOpen(false)} size="large" sx={{ minHeight: 44 }}>
            取消
          </Button>
          <Button onClick={() => void handlePublish()} variant="contained" size="large" disabled={busy}>
            {busy ? '发布中…' : '确认发布'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        title="删除这个应用？"
        description={`「${activeApp?.title ?? ''}」删除后不能恢复，已经发出去的链接也会失效。`}
        confirmText="确认删除"
        danger
        loading={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
    </Box>
  );
}

export default MyAppsPage;
