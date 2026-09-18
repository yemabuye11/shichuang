import { useCallback, useEffect, useState } from 'react';
import { Box, Button, Divider, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import HomeIcon from '@mui/icons-material/Home';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SaveIcon from '@mui/icons-material/Save';
import EditIcon from '@mui/icons-material/Edit';
import { useNavigate, useParams } from 'react-router-dom';
import { DocRenderer } from '@/components/editor/DocRenderer';
import { ExportMenu } from '@/components/export/ExportMenu';
import { EmptyState } from '@/components/common/EmptyState';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { AiDisclaimer } from '@/components/common/AiDisclaimer';
import { useToast } from '@/components/common/ToastHost';
import { docEditPath, docRunPath, ROUTES } from '@/config/routes';
import { getDocTypeLabel } from '@/config/constants';
import * as docService from '@/services/docService';
import {
  getDocLibraryEntry,
  setDocPublic,
} from '@/services/libraryService';
import { useAuth } from '@/hooks/useAuth';
import type { DocModel } from '@/types/doc';

/**
 * 文档运行页（UI：公开）。
 *
 * 路由 `/d/:id`（P0-A3 硬性：未登录必须可打开，对应「打开网页链接即可看」）。
 *
 * 红线：本页是**平台渲染壳**——直接用 React 渲染 DocModel，**不使用 iframe sandbox**
 * （平台内容可信；与 `/app/:id` 的沙箱 iframe 形成对照，后者防第三方 HTML）。
 * 文档内容由 `docService.loadDoc` 加载（MOCK 读本地 / 真实读 Storage JSON）。
 */
type Status = 'loading' | 'ready' | 'notfound';

export function DocRunPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [model, setModel] = useState<DocModel | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  /** 保存新版本后覆盖显示的版本号（本地优先，未保存时回退到模型自带版本）。 */
  const [savedVersion, setSavedVersion] = useState<number | null>(null);

  /** 当前应展示的版本号。 */
  const version = savedVersion ?? model?.version ?? 1;

  /** 当前登录用户是否为该文档作者（决定是否显示编辑 / 保存入口）。 */
  const [canEdit, setCanEdit] = useState(false);
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

  // ---- T09：内容库发布状态（仅作者可见）----
  const [libIsPublic, setLibIsPublic] = useState(false);
  const [libDownloadCount, setLibDownloadCount] = useState(0);
  const [libLoading, setLibLoading] = useState(false);
  const [libToggling, setLibToggling] = useState(false);
  useEffect(() => {
    if (!id || !canEdit) return;
    let alive = true;
    setLibLoading(true);
    void getDocLibraryEntry(id)
      .then((entry) => {
        if (!alive) return;
        setLibIsPublic(entry?.isPublic ?? false);
        setLibDownloadCount(entry?.downloadCount ?? 0);
      })
      .catch(() => {
        if (alive) {
          setLibIsPublic(false);
          setLibDownloadCount(0);
        }
      })
      .finally(() => {
        if (alive) setLibLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, canEdit]);

  /** 切换内容库公开状态。 */
  const handleToggleLibrary = useCallback(async () => {
    if (!id || libToggling) return;
    const next = !libIsPublic;
    setLibToggling(true);
    try {
      await setDocPublic(id, next, model?.meta?.title, user?.profile?.nickname);
      setLibIsPublic(next);
      toast.success(next ? '已发布到内容库，别人现在能下载了' : '已撤下内容库');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      setLibToggling(false);
    }
  }, [id, libIsPublic, libToggling, model?.meta?.title, user?.profile?.nickname, toast]);

  useEffect(() => {
    if (!id) {
      setStatus('notfound');
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const m = await docService.loadDoc(id);
        if (!alive) return;
        if (m) {
          setModel(m);
          setStatus('ready');
        } else {
          setStatus('notfound');
        }
      } catch {
        if (alive) setStatus('notfound');
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const handleCopy = useCallback(() => {
    if (!id) return;
    const url = `${window.location.origin}${docRunPath(id)}`;
    void navigator.clipboard?.writeText(url).then(
      () => toast.success('链接已复制，发到班级群就能看'),
      () => toast.error('复制失败，请手动复制地址栏链接'),
    );
  }, [id, toast]);

  /** 保存新版本：把当前 DocModel 落库并递增版本号（MOCK 本地生效）。 */
  const handleSaveVersion = useCallback(async () => {
    if (!id || !model) return;
    try {
      const res = await docService.saveVersion(id, JSON.stringify(model));
      setSavedVersion(res.version);
      toast.success(`已保存第 ${res.version} 版`);
    } catch {
      toast.error('保存版本失败，请重试');
    }
  }, [id, model, toast]);

  /** 重新生成：带当前主题与文档类型回到生成页，省去重新描述。 */
  const handleRegenerate = useCallback(() => {
    if (!model) return;
    const params = new URLSearchParams({
      prompt: model.meta?.title ?? '',
      type: model.kind,
      category: 'doc',
    });
    navigate(`${ROUTES.GENERATE}?${params.toString()}`);
  }, [model, navigate]);

  if (status === 'loading') {
    return <InlineLoading message="正在打开文档…" />;
  }

  if (status === 'notfound' || !model) {
    return (
      <EmptyState
        icon="📄"
        title="没有找到这篇文档"
        description="文档可能已被删除，或链接不完整。回到首页重新生成一篇吧。"
        actionText="回到首页"
        onAction={() => navigate(ROUTES.HOME)}
      />
    );
  }

  const meta = model.meta ?? { title: '文档' };

  return (
    <Box sx={{ py: { xs: 2, sm: 3.5 }, maxWidth: 820, mx: 'auto' }}>
      {/* 顶部工具条 */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography
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
          </Typography>
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
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>平台渲染 · 教师核对后即可分享</Typography>
        </Stack>
        <Stack direction="row" spacing={1}>
          <ExportMenu docId={id ?? ''} model={model} />
          <Button
            variant="outlined"
            size="small"
            startIcon={<ContentCopyIcon />}
            onClick={handleCopy}
            sx={{ borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
          >
            复制链接
          </Button>
          {canEdit && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<EditIcon />}
            onClick={() => navigate(id ? docEditPath(id) : ROUTES.HOME)}
            sx={{ borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
          >
            编辑
          </Button>
          )}
          <Button
            variant="text"
            size="small"
            startIcon={<HomeIcon />}
            onClick={() => navigate(ROUTES.HOME)}
          >
            首页
          </Button>
        </Stack>
      </Stack>

      {/* 文档标题 */}
      <Typography sx={{ fontSize: { xs: 24, sm: 30 }, fontWeight: 800, lineHeight: 1.35 }}>
        {meta.title}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.75 }}>
        {meta.subject ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>学科：{meta.subject}</Typography>
        ) : null}
        {meta.grade ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>年级：{meta.grade}</Typography>
        ) : null}
        {meta.textbook ? (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>教材：{meta.textbook}</Typography>
        ) : null}
      </Stack>

      {/* ---- T09：内容库发布开关（仅作者可见） ---- */}
      {canEdit ? (
        <Box
          sx={{
            mt: 2,
            borderRadius: 2.5,
            px: 2,
            py: 1.25,
            bgcolor: 'rgba(47,107,255,0.05)',
            border: '1px solid',
            borderColor: 'rgba(47,107,255,0.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={libIsPublic}
                  onChange={() => void handleToggleLibrary()}
                  disabled={libToggling || libLoading}
                  size="small"
                />
              }
              label="发布到内容库"
              sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 14.5, fontWeight: 600 } }}
            />
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
              {libLoading
                ? '正在读取发布状态…'
                : libIsPublic
                  ? `已公开 · 已被下载 ${libDownloadCount} 次`
                  : '未公开 · 公开后别人可下载，你可得一半积分'}
            </Typography>
          </Box>
        </Box>
      ) : null}

      {/* 待核对项已由顶部 VerifyBanner 统一展示 */}

      {/* 正文（一份 DocModel → 三种呈现共用此渲染器） */}
      <Box sx={{ mt: 2.5 }}>
        <DocRenderer model={model} />
      </Box>

      <Divider sx={{ my: 3 }} />

      <Stack direction="row" spacing={1.25}>
        {canEdit && (
        <Button
          variant="outlined"
          size="large"
          startIcon={<EditIcon />}
          onClick={() => navigate(id ? docEditPath(id) : ROUTES.HOME)}
          sx={{ flex: 1, minHeight: 50, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
        >
          在线编辑
        </Button>
        )}
        <Button
          variant="contained"
          size="large"
          startIcon={<OpenInNewIcon />}
          onClick={handleCopy}
          sx={{ flex: 1, minHeight: 50 }}
        >
          复制分享链接
        </Button>
        <Button
          variant="outlined"
          size="large"
          startIcon={<AutoAwesomeIcon />}
          onClick={handleRegenerate}
          sx={{ flex: 1, minHeight: 50, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
        >
          重新生成
        </Button>
      </Stack>

      <Stack direction="row" spacing={1.25}>
        {canEdit && (
        <Button
          variant="outlined"
          size="large"
          startIcon={<SaveIcon />}
          onClick={() => void handleSaveVersion()}
          sx={{ flex: 1, minHeight: 50, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
        >
          保存新版本
        </Button>
        )}
        <Button
          variant="text"
          size="large"
          startIcon={<HomeIcon />}
          onClick={() => navigate(ROUTES.HOME)}
          sx={{ flex: 1, minHeight: 50 }}
        >
          首页
        </Button>
      </Stack>

      <Box sx={{ mt: 3 }}>
        <AiDisclaimer />
      </Box>
    </Box>
  );
}

export default DocRunPage;
