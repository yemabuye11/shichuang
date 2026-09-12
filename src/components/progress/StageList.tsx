import { Box, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import type { StageState } from '@/hooks/useGenerate';

/**
 * 四阶段进度列表（UI-3）。
 *
 * 目的：消除等待焦虑——即使模型在「发呆」，教师也能看到阶段在走。
 */
export interface StageListProps {
  stages: readonly StageState[];
}

const STATUS_TEXT = {
  pending: '等待中',
  running: '进行中',
  done: '已完成',
} as const;

export function StageList({ stages }: StageListProps): JSX.Element {
  return (
    <Stack spacing={0} component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {stages.map((s, index) => {
        const isLast = index === stages.length - 1;
        const color =
          s.status === 'done' ? 'success.main' : s.status === 'running' ? 'primary.main' : 'text.disabled';

        return (
          <Stack key={s.stage} component="li" direction="row" spacing={1.5} sx={{ position: 'relative' }}>
            {/* 连接线 */}
            {!isLast ? (
              <Box
                aria-hidden="true"
                sx={{
                  position: 'absolute',
                  left: '13px',
                  top: 30,
                  bottom: -6,
                  width: 2,
                  bgcolor: s.status === 'done' ? 'success.main' : 'divider',
                  opacity: s.status === 'done' ? 0.5 : 1,
                }}
              />
            ) : null}

            <Box sx={{ pt: '2px', color, lineHeight: 0 }}>
              {s.status === 'done' ? (
                <CheckCircleIcon sx={{ fontSize: 26 }} aria-label="已完成" />
              ) : s.status === 'running' ? (
                <RadioButtonCheckedIcon sx={{ fontSize: 26 }} aria-label="进行中" />
              ) : (
                <RadioButtonUncheckedIcon sx={{ fontSize: 26 }} aria-label="等待中" />
              )}
            </Box>

            <Box sx={{ pb: isLast ? 0 : 2, flex: 1 }}>
              <Typography
                sx={{
                  fontSize: 16,
                  fontWeight: s.status === 'pending' ? 500 : 700,
                  color: s.status === 'pending' ? 'text.secondary' : 'text.primary',
                  lineHeight: 1.6,
                }}
              >
                {s.label}
              </Typography>
              <Typography sx={{ fontSize: 13, color, fontWeight: 600 }}>{STATUS_TEXT[s.status]}</Typography>
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}

export default StageList;
