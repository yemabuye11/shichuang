import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Stack,
  Typography,
} from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/common/EmptyState';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { useToast } from '@/components/common/ToastHost';
import { docRunPath, ROUTES } from '@/config/routes';
import { getDocTypeLabel } from '@/config/constants';
import {
  downloadDoc,
  listPublicLibrary,
  type LibraryItem,
} from '@/services/libraryService';

/**
 * 内容市场（T09）—— 内容库首页（需登录）。
 *
 * 展示所有已公开到内容库的文档/课件，老师可花积分下载，原作者得一半积分。
 * 积分数值（downloadCredits / price / reward）全部来自后端返回，前端绝不写死。
 */
type Status = 'loading' | 'ready' | 'error';

export function ContentLibraryPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setStatus('loading');
    setError('');
    void listPublicLibrary()
      .then((list) => {
        setItems(list);
        setStatus('ready');
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '加载内容库失败');
        setStatus('error');
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownload = useCallback(
    async (item: LibraryItem) => {
      if (downloadingId) return;
      setDownloadingId(item.id);
      try {
        const res = await downloadDoc(item.docId);
        toast.success(
          `下载成功，消耗 ${res.price} 积分，作者得 ${res.reward} 积分`,
        );
        // 跳转预览页（平台壳渲染，无需再二次扣费，已在本页结算）。
        navigate(docRunPath(item.docId));
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : '下载失败');
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadingId, navigate, toast],
  );

  const showEmpty = status === 'ready' && items.length === 0;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, sm: 3.5 } }}>
      <Typography sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 800, lineHeight: 1.35 }}>
        内容库
      </Typography>
      <Typography sx={{ fontSize: 15, color: 'text.secondary', mt: 0.75, lineHeight: 1.7 }}>
        老师们公开的好课件都在这里。花积分下载，原作者能得一半——分享越多，回报越多。
      </Typography>

      <Box sx={{ mt: 3 }}>
        {status === 'loading' ? <InlineLoading message="正在加载内容库…" /> : null}

        {status === 'error' ? (
          <EmptyState
            icon="😵"
            title="加载失败了"
            description={error}
            actionText="重新加载"
            onAction={load}
          />
        ) : null}

        {showEmpty ? (
          <EmptyState
            icon="📚"
            title="暂时还没有公开的内容"
            description="去生成一篇课件，勾选「发布到内容库」，就能出现在这里和大家共享。"
            actionText="去生成"
            onAction={() => navigate(ROUTES.GENERATE)}
          />
        ) : null}

        {status === 'ready' && items.length > 0 ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
              gap: 2,
            }}
          >
            {items.map((item) => (
              <Card
                key={item.id}
                variant="outlined"
                sx={{ borderRadius: 3, display: 'flex', flexDirection: 'column' }}
              >
                <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip
                      label={getDocTypeLabel(item.docType)}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                    {item.downloadCount > 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        已下载 {item.downloadCount} 次
                      </Typography>
                    ) : null}
                  </Stack>

                  <Typography sx={{ fontSize: 16.5, fontWeight: 700, lineHeight: 1.5 }}>
                    {item.title}
                  </Typography>

                  <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
                    作者：{item.ownerNickname || '匿名老师'}
                  </Typography>

                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {item.subject ? (
                      <Chip label={item.subject} size="small" variant="outlined" />
                    ) : null}
                    {item.grade ? (
                      <Chip label={item.grade} size="small" variant="outlined" />
                    ) : null}
                  </Stack>

                  <Box sx={{ flex: 1 }} />

                  <Stack
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{ mt: 0.5 }}
                  >
                    <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'primary.main' }}>
                      {item.downloadCredits} 积分
                    </Typography>
                    <Button
                      variant="contained"
                      size="medium"
                      startIcon={<FileDownloadOutlinedIcon />}
                      disabled={downloadingId === item.id}
                      onClick={() => void handleDownload(item)}
                      sx={{ minHeight: 40, borderRadius: 2.5 }}
                    >
                      {downloadingId === item.id ? '下载中…' : '下载'}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>
        ) : null}
      </Box>
    </Container>
  );
}

export default ContentLibraryPage;
