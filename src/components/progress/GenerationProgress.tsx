import { useState } from 'react';
import { Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import { StageList } from './StageList';
import { CodeStreamView } from './CodeStreamView';
import { estimateRemainingMs, type GenerateSnapshot } from '@/hooks/useGenerate';
import { REFUND_POLICY_TEXT } from '@/config/creditRules';

/**
 * 生成中的整体进度区（UI-3）。
 *
 * 组成：总体进度条 → 四阶段列表 → 代码流式区 → 预计剩余时间 + 取消。
 */
export interface GenerationProgressProps {
  snapshot: GenerateSnapshot;
  /** 取消生成（不扣积分）。 */
  onCancel: () => void;
}

/** 由阶段完成情况推导 0–1 的总体进度。 */
function progressOf(snapshot: GenerateSnapshot): number {
  const total = snapshot.stages.length || 1;
  const done = snapshot.stages.filter((s) => s.status === 'done').length;
  const running = snapshot.stages.some((s) => s.status === 'running') ? 0.5 : 0;
  return Math.min((done + running) / total, 0.98);
}

export function GenerationProgress({ snapshot, onCancel }: GenerationProgressProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const percent = Math.round(progressOf(snapshot) * 100);
  const remainingSec = Math.max(1, Math.round(estimateRemainingMs(snapshot) / 1000));
  const busy = snapshot.status === 'streaming' || snapshot.status === 'verifying' || snapshot.status === 'storing';

  return (
    <Stack spacing={2.5}>
      <Box>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.75 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.secondary' }}>
            生成进度
          </Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'primary.main' }}>{percent}%</Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={percent}
          sx={{ height: 8, borderRadius: 999, bgcolor: 'rgba(47,107,255,0.12)' }}
        />
      </Box>

      <StageList stages={snapshot.stages} />

      <CodeStreamView
        code={snapshot.code}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        chars={snapshot.chars}
      />

      <Stack spacing={1.25}>
        <Typography
          component="div"
          sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'center', lineHeight: 1.6 }}
        >
          {snapshot.status === 'storing'
            ? '正在保存应用，马上就好…'
            : `预计还需约 ${remainingSec} 秒，生成中请勿关闭页面`}
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="text"
            color="inherit"
            size="large"
            onClick={onCancel}
            disabled={!busy && snapshot.status !== 'checking'}
            sx={{ minHeight: 44, color: 'text.secondary', fontSize: 15 }}
          >
            取消生成（不扣积分）
          </Button>
        </Box>

        <Typography
          component="div"
          sx={{ fontSize: 12.5, color: 'text.secondary', textAlign: 'center', lineHeight: 1.6 }}
        >
          {REFUND_POLICY_TEXT}
        </Typography>
      </Stack>
    </Stack>
  );
}

export default GenerationProgress;
