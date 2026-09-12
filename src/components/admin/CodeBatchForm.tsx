import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import * as adminService from '@/services/adminService';
import { copyText } from '@/utils/clipboard';
import { useToast } from '@/components/common/ToastHost';

/**
 * 批量生成兑换码 + 导出（管理员三功能之一）。
 *
 * 生成结果以「一行一个」的形式展示，支持一键复制与下载 .txt。
 */
export interface CodeBatchFormProps {
  /** 套餐档位（演示 / 真实都从 service 读取）。 */
  plans: readonly { id: string; name: string; credits: number }[];
}

const PRESET_CREDITS: readonly number[] = [20, 50, 100, 200, 500];
const PRESET_COUNTS: readonly number[] = [10, 20, 50, 100];

export function CodeBatchForm({ plans }: CodeBatchFormProps): JSX.Element {
  const toast = useToast();
  const [credits, setCredits] = useState(50);
  const [count, setCount] = useState(20);
  const [batchNo, setBatchNo] = useState('');
  const [memo, setMemo] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async (): Promise<void> => {
    setSubmitting(true);
    setError('');
    try {
      const list = await adminService.createCodes({
        credits,
        count,
        batchNo: batchNo.trim() || undefined,
        memo: memo.trim(),
      });
      setCodes(list);
      toast.success(`已生成 ${list.length} 张兑换码`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    const ok = await copyText(codes.join('\n'));
    toast[ok ? 'success' : 'error'](ok ? '已复制全部兑换码' : '复制失败，请手动选中复制');
  };

  const handleDownload = (): void => {
    const blob = new Blob([codes.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `兑换码_${credits}积分_${codes.length}张.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('已导出为 txt 文件');
  };

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Typography sx={{ fontSize: 17, fontWeight: 700, mb: 0.5 }}>批量生成兑换码</Typography>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        生成后可以直接复制或导出成 txt，线下发给老师 / 教研组长。
      </Typography>

      <Stack spacing={2}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          <TextField
            select
            label="单张面额"
            value={String(credits)}
            onChange={(e) => setCredits(Number(e.target.value))}
            SelectProps={{ displayEmpty: true }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          >
            {PRESET_CREDITS.map((c) => (
              <MenuItem key={c} value={c} sx={{ minHeight: 44, fontSize: 15 }}>
                {c} 积分
              </MenuItem>
            ))}
            {plans
              .filter((p) => p.credits > 0 && !PRESET_CREDITS.includes(p.credits))
              .map((p) => (
                <MenuItem key={p.id} value={p.credits} sx={{ minHeight: 44, fontSize: 15 }}>
                  {p.name}（{p.credits} 积分）
                </MenuItem>
              ))}
          </TextField>

          <TextField
            select
            label="生成张数"
            value={String(count)}
            onChange={(e) => setCount(Number(e.target.value))}
            SelectProps={{ displayEmpty: true }}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          >
            {PRESET_COUNTS.map((c) => (
              <MenuItem key={c} value={c} sx={{ minHeight: 44, fontSize: 15 }}>
                {c} 张
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="批次号（选填）"
            value={batchNo}
            onChange={(e) => setBatchNo(e.target.value)}
            placeholder="例如 2026秋季第一批"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          />
          <TextField
            label="备注（选填）"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="例如 发给语文组"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          />
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}

        <Button
          variant="contained"
          size="large"
          onClick={() => void handleGenerate()}
          disabled={submitting}
          sx={{ minHeight: 50 }}
        >
          {submitting ? '生成中…' : `生成 ${count} 张 ${credits} 积分兑换码`}
        </Button>

        {codes.length > 0 ? (
          <Box>
            <Divider sx={{ mb: 2 }} />
            <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
              <Button
                variant="outlined"
                size="large"
                startIcon={<ContentCopyIcon />}
                onClick={() => void handleCopy()}
                sx={{ minHeight: 48, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
              >
                复制全部
              </Button>
              <Button
                variant="outlined"
                size="large"
                startIcon={<FileDownloadIcon />}
                onClick={handleDownload}
                sx={{ minHeight: 48, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
              >
                导出 txt
              </Button>
            </Stack>

            <Box
              sx={{
                maxHeight: 260,
                overflow: 'auto',
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: '#FAFBFC',
                p: 1.5,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: 14,
                lineHeight: 2,
                letterSpacing: 1,
                wordBreak: 'break-all',
              }}
            >
              {codes.map((c) => (
                <Box key={c} component="div">
                  {c}
                </Box>
              ))}
            </Box>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 1 }}>
              共 {codes.length} 张，合计 {codes.length * credits} 积分
            </Typography>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}

export default CodeBatchForm;
