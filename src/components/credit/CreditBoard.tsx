import { Box, Button, Stack, Typography } from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import RedeemIcon from '@mui/icons-material/Redeem';
import { CreditProgress } from './CreditProgress';
import { CREDIT_RULE_TEXT, REFUND_POLICY_TEXT } from '@/config/creditRules';
import type { CreditAccount } from '@/types/models';

/**
 * 额度看板（UI-6 核心区）。
 *
 * 「剩余积分」用全站最大字号呈现，教师 2 次点击内一定能看到（PRD G3）。
 */
export interface CreditBoardProps {
  account: CreditAccount | null;
  /** 已生成应用数。 */
  appCount: number;
  /** 点击「兑换码充值」。 */
  onRedeem: () => void;
}

export function CreditBoard({ account, appCount, onRedeem }: CreditBoardProps): JSX.Element {
  const balance = account?.balance ?? 0;
  const totalEarned = account?.totalEarned ?? 0;
  const totalUsed = account?.totalUsed ?? 0;

  return (
    <Box
      sx={{
        borderRadius: 3,
        p: 2.5,
        color: '#fff',
        background: 'linear-gradient(135deg,#2F6BFF 0%, #7A5CFF 100%)',
        boxShadow: '0 8px 24px rgba(47,107,255,0.18)',
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <BoltIcon sx={{ color: '#FFE08A' }} aria-hidden="true" />
          <Typography sx={{ fontSize: 15, fontWeight: 600, opacity: 0.95 }}>剩余积分</Typography>
        </Stack>

        <Stack direction="row" alignItems="baseline" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Typography
            component="div"
            sx={{ fontSize: 48, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.5px' }}
          >
            {balance}
          </Typography>
          <Typography component="div" sx={{ fontSize: 15, opacity: 0.9 }}>
            / 共获得 {totalEarned}
          </Typography>
        </Stack>

        <Box sx={{ '& .MuiLinearProgress-root': { bgcolor: 'rgba(255,255,255,0.24)' } }}>
          <CreditProgress balance={balance} totalEarned={totalEarned} />
        </Box>

        <Typography sx={{ fontSize: 14, opacity: 0.92, lineHeight: 1.7 }}>
          本月已用 {totalUsed} 积分 · 已生成 {appCount} 个应用
        </Typography>

        <Button
          variant="contained"
          size="large"
          startIcon={<RedeemIcon />}
          onClick={onRedeem}
          sx={{
            minHeight: 48,
            bgcolor: '#fff',
            color: 'primary.main',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.92)' },
          }}
        >
          兑换码充值
        </Button>

        <Typography sx={{ fontSize: 12.5, opacity: 0.85, lineHeight: 1.6 }}>
          {CREDIT_RULE_TEXT}
          <br />
          {REFUND_POLICY_TEXT}
        </Typography>
      </Stack>
    </Box>
  );
}

export default CreditBoard;
