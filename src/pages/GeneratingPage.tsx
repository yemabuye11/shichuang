import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PublishIcon from '@mui/icons-material/Publish';
import { useNavigate, useParams } from 'react-router-dom';
import { GenerationProgress } from '@/components/progress/GenerationProgress';
import { GenerateErrorPanel } from '@/components/progress/GenerateErrorPanel';
import { SafeAppIframe } from '@/components/app/SafeAppIframe';
import { EmptyState } from '@/components/common/EmptyState';
import { AiDisclaimer } from '@/components/common/AiDisclaimer';
import { useToast } from '@/components/common/ToastHost';
import { useAuth } from '@/hooks/useAuth';
import { useGenerate, useGenerateRun } from '@/hooks/useGenerate';
import { appRunPath, docRunPath, ROUTES } from '@/config/routes';
import { getAppTypeLabel, getDocTypeLabel } from '@/config/constants';
import * as artifactService from '@/services/artifactService';
import * as appService from '@/services/appService';
import * as trackService from '@/services/trackService';
import type { DoneEvent } from '@/types/api';

/**
 * 生成中进度页（UI-3）。
 *
 * 四种状态：
 * - 进行中：四阶段进度 + 代码流式滚动 + 预计剩余 + 取消；
 * - 完成：直接在本页预览生成的应用，并展示本次消耗积分与 token；
 * - 失败 / 取消：明确告知积分是否退还 + 重试 / 换个说法；
 * - 无任务（直接访问或刷新过久）：引导重新描述需求。
 */
export function GeneratingPage(): JSX.Element {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useAuth();

  const { snapshot, cancel, retry, reset } = useGenerate();

  const [src, setSrc] = useState<string | null>(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const resultRef = useRef<DoneEvent | null>(null);

  // 生成结束后刷新积分余额
  const handleDone = useCallback(
    (result: DoneEvent) => {
      resultRef.current = result;
      void refresh();
    },
    [refresh],
  );

  const handleFailed = useCallback(() => {
    void refresh();
  }, [refresh]);

  useGenerateRun(jobId, { onDone: handleDone, onFailed: handleFailed });

  const result = snapshot.result;

  // ---- 完成后解析播放源（本地副本优先 → CDN）----
  useEffect(() => {
    if (!result) return;
    let alive = true;
    setLoadingApp(true);
    void (async () => {
      try {
        const source = await artifactService.resolvePlaySource({
          id: result.appId,
          htmlUrl: result.htmlUrl,
          htmlStatus: result.htmlStatus,
        });
        if (alive) setSrc(source.url);
      } catch {
        if (alive) setSrc(null);
      } finally {
        if (alive) setLoadingApp(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [result]);

  const handlePublish = async (): Promise<void> => {
    if (!result) return;
    setPublishing(true);
    try {
      await appService.publish(result.appId, { title: result.title, summary: result.summary });
      setPublished(true);
      trackService.track('publish', { appType: snapshot.request?.appType ?? 'auto' }, result.appId);
      toast.success('已发布到应用广场');
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败，请重试');
    } finally {
      setPublishing(false);
    }
  };

  /** 复制文档分享链接（doc 类产物）。 */
  const handleCopyDocLink = async (): Promise<void> => {
    if (!result) return;
    const url = `${window.location.origin}${docRunPath(result.appId)}`;
    try {
      await navigator.clipboard?.writeText(url);
      toast.success('文档链接已复制，发到班级群就能看');
    } catch {
      toast.error('复制失败，请手动复制地址栏链接');
    }
  };

  // ---- 无任务（直接访问 / 刷新过久）----
  if (snapshot.status === 'idle') {
    return (
      <EmptyState
        icon="⏳"
        title="这个生成任务已经结束了"
        description="页面刷新过久或链接已失效。重新描述一次需求就好，积分不会白白扣掉。"
        actionText="重新做一个"
        onAction={() => navigate(ROUTES.GENERATE)}
        secondaryText="看看大家做的"
        onSecondary={() => navigate(ROUTES.SQUARE)}
      />
    );
  }

  const busy =
    snapshot.status === 'checking' ||
    snapshot.status === 'streaming' ||
    snapshot.status === 'verifying' ||
    snapshot.status === 'storing';

  return (
    <Box sx={{ py: { xs: 2, sm: 3.5 }, maxWidth: 760, mx: 'auto' }}>
      <Typography sx={{ fontSize: { xs: 19, sm: 22 }, fontWeight: 800, lineHeight: 1.45 }}>
        {busy
          ? '正在为你生成应用'
          : snapshot.status === 'done'
            ? '生成完成！'
            : snapshot.status === 'cancelled'
              ? '已取消生成'
              : '生成没有成功'}
      </Typography>
      {snapshot.request ? (
        <Typography
          sx={{
            fontSize: 14.5,
            color: 'text.secondary',
            mt: 0.75,
            lineHeight: 1.7,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {snapshot.request.prompt}
        </Typography>
      ) : null}

      <Box sx={{ mt: 2.5 }}>
        {busy ? <GenerationProgress snapshot={snapshot} onCancel={cancel} /> : null}

        {snapshot.status === 'done' && result ? (
          snapshot.results.length > 1 ? (
            <Stack spacing={2.5}>
              {/* 多格式产物：同一请求生成了多份文档 */}
              <Box
                sx={{
                  display: 'flex',
                  gap: 1.25,
                  alignItems: 'center',
                  borderRadius: 2.5,
                  bgcolor: 'rgba(18,161,80,0.07)',
                  px: 2,
                  py: 1.5,
                }}
              >
                <CheckCircleIcon color="success" aria-hidden="true" />
                <Typography sx={{ fontSize: 15.5, fontWeight: 700, color: 'success.main' }}>
                  生成了 {snapshot.results.length} 份文档 🎉
                </Typography>
              </Box>

              {/* 总消耗 */}
              <Box
                sx={{
                  borderRadius: 2.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: '#fff',
                  px: 2,
                  py: 1.5,
                }}
              >
                <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                  <Box>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>本次消耗</Typography>
                    <Typography sx={{ fontSize: 20, fontWeight: 800, color: 'primary.main' }}>
                      {snapshot.results.reduce((a, r) => a + (r.creditsCost || 0), 0)} 积分
                    </Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>剩余积分</Typography>
                    <Typography sx={{ fontSize: 20, fontWeight: 800 }}>
                      {snapshot.results[0].creditsBalance}
                    </Typography>
                  </Box>
                </Stack>
              </Box>

              {/* 每份文档一张卡片 */}
              <Stack spacing={1.5}>
                {snapshot.results.map((r) => (
                  <Box
                    key={r.appId}
                    sx={{
                      borderRadius: 2.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: '#fff',
                      p: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1.5,
                    }}
                  >
                    <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
                      {r.docType ? getDocTypeLabel(r.docType) : r.title}
                    </Typography>
                    <Button
                      variant="contained"
                      size="medium"
                      startIcon={<OpenInNewIcon />}
                      onClick={() => navigate(docRunPath(r.appId))}
                      sx={{ minHeight: 42, px: 2.5, flexShrink: 0 }}
                    >
                      查看文档
                    </Button>
                  </Box>
                ))}
              </Stack>

              {/* 再做一个 */}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <Button
                  variant="text"
                  size="large"
                  startIcon={<AutoAwesomeIcon />}
                  onClick={() => {
                    reset();
                    navigate(ROUTES.GENERATE);
                  }}
                  sx={{ flex: 1, minHeight: 50 }}
                >
                  再做一个
                </Button>
              </Stack>

              <Divider />
              <AiDisclaimer />
            </Stack>
          ) : (
            <Stack spacing={2.5}>
            {/* 完成提示 */}
            <Box
              sx={{
                display: 'flex',
                gap: 1.25,
                alignItems: 'center',
                borderRadius: 2.5,
                bgcolor: 'rgba(18,161,80,0.07)',
                px: 2,
                py: 1.5,
              }}
            >
              <CheckCircleIcon color="success" aria-hidden="true" />
              <Typography sx={{ fontSize: 15.5, fontWeight: 700, color: 'success.main' }}>
                {result.title} 已经做好了，可以直接用
              </Typography>
            </Box>

            {/* 预览：文档走平台壳（无 sandbox iframe），应用走沙箱 iframe */}
            {result.category === 'doc' ? (
              <Box
                sx={{
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: '#fff',
                  p: { xs: 2.5, sm: 3 },
                  textAlign: 'center',
                }}
              >
                <Typography sx={{ fontSize: 15, color: 'text.secondary' }}>
                  文档已生成，点击下方按钮进入网页查看、核对并分享链接
                </Typography>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<OpenInNewIcon />}
                  onClick={() => navigate(docRunPath(result.appId))}
                  sx={{ mt: 1.5, minHeight: 50, px: 3 }}
                >
                  查看文档
                </Button>
              </Box>
            ) : (
              <Box
                sx={{
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: 'divider',
                  overflow: 'hidden',
                  bgcolor: '#fff',
                }}
              >
                <Box
                  sx={{
                    px: 2,
                    py: 1,
                    bgcolor: 'rgba(27,31,39,0.03)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                  }}
                >
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: 'text.secondary' }}>
                    预览（{getAppTypeLabel(snapshot.request?.appType ?? 'auto')}）
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>
                    {result.tokensIn + result.tokensOut > 0
                      ? `${((result.tokensIn + result.tokensOut) / 1000).toFixed(1)}k token`
                      : ''}
                  </Typography>
                </Box>
                <Box sx={{ height: { xs: 420, sm: 520 }, p: 0 }}>
                  <SafeAppIframe
                    src={src}
                    title={result.title}
                    loading={loadingApp}
                    fallbackMessage="应用还在保存中，稍后可以在「我的应用」里打开。"
                    height="100%"
                  />
                </Box>
              </Box>
            )}

            {/* 本次消耗 */}
            <Box
              sx={{
                borderRadius: 2.5,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: '#fff',
                px: 2,
                py: 1.5,
              }}
            >
              <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                <Box>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>本次消耗</Typography>
                  <Typography sx={{ fontSize: 20, fontWeight: 800, color: 'primary.main' }}>
                    {result.creditsCost} 积分
                  </Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>剩余积分</Typography>
                  <Typography sx={{ fontSize: 20, fontWeight: 800 }}>
                    {result.creditsBalance}
                  </Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>消耗 token</Typography>
                  <Typography sx={{ fontSize: 20, fontWeight: 800 }}>
                    {((result.tokensIn + result.tokensOut) / 1000).toFixed(1)}k
                  </Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>用时</Typography>
                  <Typography sx={{ fontSize: 20, fontWeight: 800 }}>
                    {Math.max(1, Math.round(snapshot.elapsedMs / 1000))} 秒
                  </Typography>
                </Box>
              </Stack>
            </Box>

            {/* 操作区：文档 vs 应用 分流 */}
            {result.category === 'doc' ? (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<OpenInNewIcon />}
                    onClick={() => navigate(docRunPath(result.appId))}
                    sx={{ flex: 1, minHeight: 50 }}
                  >
                    查看文档
                  </Button>
                  <Button
                    variant="outlined"
                    size="large"
                    startIcon={<ContentCopyIcon />}
                    onClick={() => void handleCopyDocLink()}
                    sx={{ flex: 1, minHeight: 50, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
                  >
                    复制链接
                  </Button>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <Button
                    variant="text"
                    size="large"
                    startIcon={<AutoAwesomeIcon />}
                    onClick={() => {
                      reset();
                      navigate(ROUTES.GENERATE);
                    }}
                    sx={{ flex: 1, minHeight: 50 }}
                  >
                    再写一篇
                  </Button>
                </Stack>
              </>
            ) : (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<PublishIcon />}
                    onClick={() => void handlePublish()}
                    disabled={publishing || published}
                    sx={{ flex: 1, minHeight: 50 }}
                  >
                    {published ? '已发布到广场' : publishing ? '发布中…' : '发布到广场'}
                  </Button>
                  <Button
                    variant="outlined"
                    size="large"
                    startIcon={<OpenInNewIcon />}
                    onClick={() => navigate(appRunPath(result.appId))}
                    sx={{ flex: 1, minHeight: 50, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
                  >
                    打开应用页
                  </Button>
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                  <Button
                    variant="outlined"
                    size="large"
                    startIcon={<ContentCopyIcon />}
                    onClick={() => navigate(appRunPath(result.appId))}
                    sx={{ flex: 1, minHeight: 50, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
                  >
                    复制链接 / 二维码
                  </Button>
                  <Button
                    variant="text"
                    size="large"
                    startIcon={<AutoAwesomeIcon />}
                    onClick={() => {
                      reset();
                      navigate(ROUTES.GENERATE);
                    }}
                    sx={{ flex: 1, minHeight: 50 }}
                  >
                    再做一个
                  </Button>
                </Stack>
              </>
            )}

            <Divider />
            <AiDisclaimer />
          </Stack>
          )
        ) : null}

        {(snapshot.status === 'error' || snapshot.status === 'cancelled') && snapshot.error ? (
          <GenerateErrorPanel
            error={snapshot.error}
            prompt={snapshot.request?.prompt ?? ''}
            onRetry={retry}
            onEdit={(next) => {
              reset();
              navigate(`${ROUTES.GENERATE}?prompt=${encodeURIComponent(next)}`);
            }}
            onBack={() => {
              reset();
              navigate(ROUTES.GENERATE);
            }}
          />
        ) : null}
      </Box>
    </Box>
  );
}

export default GeneratingPage;
