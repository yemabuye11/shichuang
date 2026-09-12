import { Chip, Stack, Tooltip, useTheme } from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ROUTES } from '@/config/routes';
import { CREDIT_RULE_TEXT } from '@/config/creditRules';

/**
 * 顶部常驻积分徽标（P0-F：「2 次点击内看到剩余额度」）。
 */
export interface CreditBadgeProps {
  /** 当前余额。 */
  balance: number;
  /** 点击回调（默认跳个人中心）。 */
  onClick?: () => void;
  /** 是否显示积分说明 tooltip。 */
  showHint?: boolean;
}

export function CreditBadge({ balance, onClick, showHint = true }: CreditBadgeProps): JSX.Element {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleClick = (): void => {
    if (onClick) {
      onClick();
      return;
    }
    navigate(ROUTES.ME);
  };

  const chip = (
    <Chip
      icon={<BoltIcon sx={{ color: 'warning.main' }} />}
      label={`${balance} 积分`}
      onClick={handleClick}
      sx={{
        height: 36,
        minWidth: 88,
        fontWeight: 600,
        bgcolor: 'rgba(245,158,11,0.10)',
        color: 'text.primary',
        border: `1px solid ${theme.palette.warning.main}33`,
        px: 0.5,
        '& .MuiChip-label': { px: 1 },
      }}
    />
  );

  if (!showHint) return chip;

  return (
    <Stack>
      <Tooltip title={user ? CREDIT_RULE_TEXT : '登录后可见积分'} arrow>
        {chip}
      </Tooltip>
    </Stack>
  );
}

export default CreditBadge;
