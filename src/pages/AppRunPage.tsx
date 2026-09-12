import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Divider, IconButton, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BlockIcon from '@mui/icons-material/Block';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import { useNavigate, useParams } from 'react-router-dom';
import { SafeAppIframe } from '@/components/app/SafeAppIframe';
import { ShareBar } from '@/components/app/ShareBar';
import { GrowthBar } from '@/components/app/GrowthBar';
import { ReportDialog } from '@/components/app/ReportDialog';
import { AiDisclaimer } from '@/components/common/AiDisclaimer';
import { EmptyState } from '@/components/common/EmptyState';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { TypeChip } from '@/components/common/TypeChip';
import { useToast } from '@/components/common/ToastHost';
import { useAuth } from '@/hooks/useAuth';
import { loginPath, remixPath, ROUTES } from '@/config/routes';
import * as appService from '@/services/appService';
import * as squareService from '@/services/squareService';
import * as artifactService from '@/services/artifactService';
import * as trackService from '@/services/trackService';
import { formatCount } from '@/utils/format';
import type { App } from '@/types/models';

/**
 * 应用运行页（UI-4）—— **公开路由，未登录必须可打开**（P0-A3 硬性）。
 *
 * 播放源优先级（ARCHITECTURE.md §2.4）：
 * 本地 IndexedDB 副本（0 延迟）→ CDN `html_url` → `serve-app` 回源 → 友好提示。
 */
export function AppRunPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const [app, setApp] = useState<App | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [from, setFrom] = useState<'local' | 'cdn' | 'fallback' | 'none'>('none');
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [likeState, setLikeState] = useState({ liked: false, likeCount: 0 });
  const [reportOpen, setReportOpen] = useState(false);

  const frameRef = useRef<HTMLDivElement | null>(null);

  // ---- 读取应用元数据 ----
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMissing(false);
    void (async () => {
      try {
        const found = await appService.getById(id);
        if (!alive) return;
        setApp(found);
        setMissing(!found);
        setLikeState({ liked: found?.likedByMe === true, likeCount: found?.likeCount ?? 0 });
      } catch {
        if (alive) setMissing(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // ---- 浏览计数（不阻塞渲染，失败静默）----
  useEffect(() => {
    if (!id) return;
    trackService.trackView(id);
    trackService.track('app_open', {}, id);
  }, [id]);

  // ---- 解析播放源 ----
  useEffect(() => {
    if (!app) return;
    let alive = true;
    void (async () => {
      try {
        const source = await artifactService.resolvePlaySource({
          id: app.id,
          htmlUrl: app.htmlUrl,
          htmlSha256: app.htmlSha256,
          htmlStatus: app.htmlStatus,
          publishedAt: app.publishedAt,
        });
        if (!alive) return;
        setSrc(source.url);
        setFrom(source.from);
      } catch {
        if (alive) setFrom('none');
      }
    })();
    return () => {
      alive = false;
    };
  }, [app]);

  const handleToggleLike = useCallback(async () => {
    if (!user) {
      toast.info('登录后就能给喜欢的应用点赞啦');
      navigate(loginPath(`${ROUTES.APP_RUN}/${id}`));
      return;
    }
    if (!app) return;
    try {
      const res = await squareService.toggleLike(app.id);
      setLikeState({ liked: res.liked, likeCount: res.likeCount });
      toast.success(res.liked ? '已点赞' : '已取消点赞');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败，请重试');
    }
  }, [user, app, navigate, toast, id]);

  const handleRemix = useCallback(() => {
    if (!app) return;
    trackService.track('remix_click', {}, app.id);
    const target = remixPath(app.id, app.promptRaw || app.title);
    navigate(user ? target : loginPath(target));
  }, [app, user, navigate]);

  const handleReport = useCallback(
    async (reason: string, detail: string) => {
      if (!app) return;
      await squareService.report(app.id, reason, detail);
      toast.success('举报已提交，管理员会尽快处理');
    },
    [app, toast],
  );

  // ---- 加载中 ----
  if (loading) {
    return <InlineLoading message="正在打开应用…" />;
  }

  // ---- 不存在 / 已下架 ----
  if (missing || !app) {
    return (
      <EmptyState
        icon={<BlockIcon sx={{ fontSize: 44, color: 'text.disabled' }} />}
        title="这个应用打不开"
        description="它可能已被作者撤下、被管理员下架，或者链接不正确。"
        actionText="去应用广场看看"
        onAction={() => navigate(ROUTES.SQUARE)}
        secondaryText="我也做一个"
        onSecondary={() => navigate(user ? ROUTES.GENERATE : loginPath(ROUTES.GENERATE))}
      />
    );
  }

  const shareUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${ROUTES.APP_RUN}/${app.id}` : '';
  const authorName = app.author?.nickname ?? '匿名老师';
  const publishPending = app.htmlStatus === 'pending';

  return (
    <Box sx={{ pt: { xs: 1.5, sm: 2.5 }, pb: 1 }}>
      {/* ---- 极简顶栏 ---- */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <IconButton aria-label="返回" onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 17,
              fontWeight: 700,
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {app.title}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.25 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>作者：{authorName}</Typography>
            <TypeChip type={app.appType} />
          </Stack>
        </Box>
        <IconButton aria-label="举报" onClick={() => setReportOpen(true)}>
          <FlagOutlinedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </Stack>

      {/* ---- 应用本体（沙箱）---- */}
      <Box ref={frameRef} sx={{ height: { xs: '58vh', sm: '62vh' }, minHeight: 360 }}>
        <SafeAppIframe
          src={src}
          title={app.title}
          loading={false}
          fallbackMessage={
            publishPending
              ? '内容正在发布中，通常 1 分钟内就好，请稍后刷新试试。'
              : '这个应用的内容暂时取不到，请稍后刷新试试。'
          }
          height="100%"
        />
      </Box>

      {from === 'fallback' ? (
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 1, textAlign: 'center' }}>
          正在从备用地址加载，速度会稍慢一点
        </Typography>
      ) : null}

      {/* ---- 教师主操作区 ---- */}
      <Box sx={{ mt: 2 }}>
        <ShareBar
          appId={app.id}
          url={shareUrl}
          likeCount={likeState.likeCount}
          liked={likeState.liked}
          onToggleLike={() => void handleToggleLike()}
          fullscreenRef={frameRef}
        />
      </Box>

      {/* ---- AI 声明 + 举报 ---- */}
      <Box sx={{ mt: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Box sx={{ flex: 1 }}>
            <AiDisclaimer compact />
          </Box>
          <Button
            size="small"
            variant="text"
            onClick={() => setReportOpen(true)}
            sx={{ minHeight: 44, color: 'text.secondary', whiteSpace: 'nowrap', fontSize: 14 }}
          >
            举报
          </Button>
        </Stack>

        <Typography sx={{ fontSize: 13, color: 'text.secondary', textAlign: 'center' }}>
          已有 {formatCount(app.viewCount)} 人使用 · {formatCount(app.likeCount)} 人点赞
        </Typography>
      </Box>

      <Divider sx={{ my: 2.5 }} />

      {/* ---- 增长引导 ---- */}
      <GrowthBar authorName={authorName} viewCount={app.viewCount} onRemix={handleRemix} />

      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} onSubmit={handleReport} />
    </Box>
  );
}

export default AppRunPage;
