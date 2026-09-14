import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useToast } from '@/components/common/ToastHost';
import {
  RESOURCE_DOC_TYPES,
  approveResource,
  getResourcePublicUrl,
  listPendingResources,
  rejectResource,
  type ResourceItem,
} from '@/services/resourceService';

const DOC_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  RESOURCE_DOC_TYPES.map((d) => [d.value, d.label]),
);

/**
 * 管理员端：审核校本资源库中的待审条目，可查看文件、赠送积分、设为公开或驳回。
 */
export default function AdminResourceReviewPage(): JSX.Element {
  const toast = useToast();
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [credits, setCredits] = useState<Record<string, number>>({});
  const [publicMap, setPublicMap] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listPendingResources());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleApprove = async (it: ResourceItem): Promise<void> => {
    setBusyId(it.id);
    try {
      const c = credits[it.id] ?? 0;
      await approveResource(it.id, c, publicMap[it.id] ?? false, notes[it.id] ?? '');
      toast.success(c > 0 ? `已通过审核，赠送 ${c} 积分` : '已通过审核');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (it: ResourceItem): Promise<void> => {
    setBusyId(it.id);
    try {
      await rejectResource(it.id, notes[it.id] ?? '');
      toast.success('已驳回');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        审核校本资源
      </Typography>
      {loading ? (
        <Typography color="text.secondary">加载中…</Typography>
      ) : items.length === 0 ? (
        <Typography color="text.secondary">暂无待审核资源。</Typography>
      ) : (
        <Stack spacing={2}>
          {items.map((it) => (
            <Paper key={it.id} variant="outlined" sx={{ p: 2 }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="flex-start"
                spacing={1}
              >
                <Box>
                  <Typography fontWeight={600}>{it.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {it.subject} · {it.grade} · {DOC_TYPE_LABEL[it.docType] ?? it.docType} ·{' '}
                    {it.fileName}
                  </Typography>
                </Box>
                <Chip label="待审核" color="warning" size="small" />
              </Stack>

              <Button
                size="small"
                endIcon={<OpenInNewIcon />}
                href={getResourcePublicUrl(it.filePath)}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ mt: 1 }}
              >
                查看文件
              </Button>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }} alignItems="center">
                <TextField
                  label="赠送积分"
                  type="number"
                  size="small"
                  value={credits[it.id] ?? 0}
                  onChange={(e) =>
                    setCredits((p) => ({
                      ...p,
                      [it.id]: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  sx={{ width: 140 }}
                />
                <Stack direction="row" spacing={1} alignItems="center">
                  <Switch
                    checked={publicMap[it.id] ?? false}
                    onChange={(e) => setPublicMap((p) => ({ ...p, [it.id]: e.target.checked }))}
                  />
                  <Typography variant="body2">设为公开</Typography>
                </Stack>
              </Stack>

              <TextField
                label="审核意见（可选）"
                size="small"
                fullWidth
                multiline
                minRows={1}
                value={notes[it.id] ?? ''}
                onChange={(e) => setNotes((p) => ({ ...p, [it.id]: e.target.value }))}
                sx={{ mt: 2 }}
              />

              <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<CheckCircleIcon />}
                  disabled={busyId === it.id}
                  onClick={() => void handleApprove(it)}
                >
                  通过
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<CancelIcon />}
                  disabled={busyId === it.id}
                  onClick={() => void handleReject(it)}
                >
                  驳回
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
      <Box sx={{ height: 24 }} />
    </Container>
  );
}
