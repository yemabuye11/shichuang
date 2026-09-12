import { Box, Button, Stack, Typography } from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { BRAND } from '@/config/brand';
import { formatCount } from '@/utils/format';

/**
 * 增长引导条（UI-4 底部，P0-C5 传播引擎）。
 *
 * 「王老师 用【品牌名】制作」+「免费做一个同款」→ 未登录跳登录并预填提示词。
 */
export interface GrowthBarProps {
  /** 作者昵称。 */
  authorName: string;
  /** 使用次数（浏览数）。 */
  viewCount: number;
  /** 点击「免费做一个同款」。 */
  onRemix: () => void;
}

export function GrowthBar({ authorName, viewCount, onRemix }: GrowthBarProps): JSX.Element {
  return (
    <Box
      sx={{
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: '#fff',
        p: 2.5,
        textAlign: 'center',
      }}
    >
      <Stack spacing={1.5} alignItems="center">
        <Box>
          <Typography component="div" sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary' }}>
            {authorName} 用【{BRAND.name}】制作
          </Typography>
          <Typography component="div" sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.25 }}>
            已有 {formatCount(viewCount)} 人使用
          </Typography>
        </Box>

        <Button
          variant="contained"
          size="large"
          startIcon={<AutoAwesomeIcon />}
          onClick={onRemix}
          sx={{ minHeight: 50, px: 3, fontSize: 16 }}
        >
          免费做一个同款
        </Button>
      </Stack>
    </Box>
  );
}

export default GrowthBar;
