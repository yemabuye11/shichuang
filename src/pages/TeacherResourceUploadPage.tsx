import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useToast } from '@/components/common/ToastHost';
import { SUBJECTS, GRADES } from '@/config/constants';
import {
  RESOURCE_DOC_TYPES,
  listMyResources,
  uploadResource,
  type ResourceItem,
} from '@/services/resourceService';

const STATUS_META: Record<
  ResourceItem['status'],
  { label: string; color: 'warning' | 'success' | 'error' }
> = {
  pending: { label: '待审核', color: 'warning' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已驳回', color: 'error' },
};

/**
 * 教师端：上传优秀教学案例到校本资源库，并查看「我的贡献」与审核状态。
 */
export default function TeacherResourceUploadPage(): JSX.Element {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState<string>(SUBJECTS[0]);
  const [grade, setGrade] = useState<string>(GRADES[0]);
  const [docType, setDocType] = useState<string>(RESOURCE_DOC_TYPES[0].value);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listMyResources());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error('请填写资源标题');
      return;
    }
    if (!file) {
      toast.error('请选择要上传的文件');
      return;
    }
    setSubmitting(true);
    try {
      await uploadResource(file, { title: title.trim(), subject, grade, docType });
      toast.success('上传成功，等待管理员审核');
      setTitle('');
      setFile(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        上传优秀教学案例
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        上传你的优秀教案 / PPT / 课件，管理员审核通过后赠送积分。审核通过的公开资源将进入平台内容沉淀，让
        AI 持续变好。
      </Typography>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Stack component="form" spacing={2} onSubmit={handleSubmit}>
          <TextField
            label="资源标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            fullWidth
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="rs-subject-label">学科</InputLabel>
              <Select
                labelId="rs-subject-label"
                label="学科"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                {SUBJECTS.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="rs-grade-label">年级</InputLabel>
              <Select
                labelId="rs-grade-label"
                label="年级"
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              >
                {GRADES.map((g) => (
                  <MenuItem key={g} value={g}>
                    {g}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="rs-doctype-label">类型</InputLabel>
              <Select
                labelId="rs-doctype-label"
                label="类型"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                {RESOURCE_DOC_TYPES.map((d) => (
                  <MenuItem key={d.value} value={d.value}>
                    {d.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Button
            component="label"
            variant="outlined"
            startIcon={<UploadFileIcon />}
            sx={{ alignSelf: 'flex-start' }}
          >
            {file ? file.name : '选择文件'}
            <input
              hidden
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Button>
          <Box>
            <Button type="submit" variant="contained" disabled={submitting}>
              {submitting ? '上传中…' : '提交审核'}
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Typography variant="h6" fontWeight={700} gutterBottom>
        我的贡献
      </Typography>
      {loading ? (
        <Typography color="text.secondary">加载中…</Typography>
      ) : items.length === 0 ? (
        <Typography color="text.secondary">还没有上传任何资源。</Typography>
      ) : (
        <Stack spacing={2}>
          {items.map((it) => {
            const meta = STATUS_META[it.status];
            return (
              <Paper key={it.id} variant="outlined" sx={{ p: 2 }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  spacing={1}
                >
                  <Box>
                    <Typography fontWeight={600}>{it.title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {it.subject} · {it.grade} · {it.fileName}
                    </Typography>
                  </Box>
                  <Chip label={meta.label} color={meta.color} size="small" />
                </Stack>
                {it.status === 'approved' && it.grantedCredits > 0 && (
                  <Typography variant="body2" color="success.main" sx={{ mt: 1 }}>
                    已赠送 {it.grantedCredits} 积分
                  </Typography>
                )}
                {it.reviewNote && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    审核意见：{it.reviewNote}
                  </Typography>
                )}
              </Paper>
            );
          })}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
        提示：审核通过即赠送积分，公开资源将进入平台内容沉淀。
      </Typography>
    </Container>
  );
}
