import type { ReactNode } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';

/**
 * 空状态（所有列表页必须有三态：loading / empty / error）。
 */
export interface EmptyStateProps {
  /** 图标或 emoji。 */
  icon?: ReactNode;
  /** 主文案。 */
  title: string;
  /** 辅助说明。 */
  description?: string;
  /** 主行动按钮文案。 */
  actionText?: string;
  /** 主行动回调。 */
  onAction?: () => void;
  /** 次行动按钮文案。 */
  secondaryText?: string;
  /** 次行动回调。 */
  onSecondary?: () => void;
}

export function EmptyState({
  icon,
  title,
  description,
  actionText,
  onAction,
  secondaryText,
  onSecondary,
}: EmptyStateProps): JSX.Element {
  return (
    <Stack spacing={2} alignItems="center" sx={{ py: 8, px: 3, textAlign: 'center' }}>
      {icon ? (
        <Box sx={{ fontSize: 48, lineHeight: 1 }} aria-hidden="true">
          {icon}
        </Box>
      ) : null}
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {description ? (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      ) : null}
      {actionText ? (
        <Stack direction="row" spacing={1.5} sx={{ pt: 1 }}>
          <Button variant="contained" size="large" onClick={onAction}>
            {actionText}
          </Button>
          {secondaryText ? (
            <Button variant="text" size="large" onClick={onSecondary}>
              {secondaryText}
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  );
}

export default EmptyState;
