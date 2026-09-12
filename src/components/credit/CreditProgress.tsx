import { Box, LinearProgress, Typography } from '@mui/material';

/**
 * 积分进度条：直观展示「总共获得多少 / 还剩多少」。
 */
export interface CreditProgressProps {
  /** 当前余额。 */
  balance: number;
  /** 累计获得（分母）。 */
  totalEarned: number;
}

export function CreditProgress({ balance, totalEarned }: CreditProgressProps): JSX.Element {
  const total = Math.max(totalEarned, balance, 1);
  const usedRatio = Math.min(Math.max(1 - balance / total, 0), 1);
  const usedPercent = Math.round(usedRatio * 100);

  return (
    <Box>
      <LinearProgress
        variant="determinate"
        value={usedRatio * 100}
        sx={{
          height: 10,
          borderRadius: 999,
          bgcolor: 'rgba(47,107,255,0.12)',
          '& .MuiLinearProgress-bar': {
            borderRadius: 999,
            background: 'linear-gradient(90deg,#2F6BFF,#7A5CFF)',
          },
        }}
      />
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.75 }}>
        已使用 {usedPercent}%
      </Typography>
    </Box>
  );
}

export default CreditProgress;
