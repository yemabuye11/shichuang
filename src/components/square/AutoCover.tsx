import { Box, Typography } from '@mui/material';
import { coverBackground, coverInitial } from '@/utils/cover';

/**
 * 程序生成封面（ARCHITECTURE.md §2.3：零存储、零流量）。
 *
 * 不上传任何图片，只用 `coverSeed` 确定性地生成渐变 + 标题首字，
 * 保证同一 seed 永远得到同一张封面。
 */
export interface AutoCoverProps {
  /** 封面种子（`apps.cover_seed`）；为空时用标题兜底。 */
  seed: string;
  title: string;
  /** 高度（px）。 */
  height?: number;
  /** 右上角徽标文案（如「热门」）。 */
  badge?: string;
  /** 圆角（px）。 */
  radius?: number;
}

export function AutoCover({
  seed,
  title,
  height = 120,
  badge = '',
  radius = 12,
}: AutoCoverProps): JSX.Element {
  return (
    <Box
      sx={{
        position: 'relative',
        height,
        borderRadius: radius,
        overflow: 'hidden',
        background: coverBackground(seed || title),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <Typography
        sx={{
          fontSize: Math.round(height * 0.36),
          fontWeight: 800,
          color: '#FFFFFF',
          textShadow: '0 2px 8px rgba(0,0,0,0.18)',
          lineHeight: 1,
        }}
      >
        {coverInitial(title)}
      </Typography>

      {badge ? (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            px: 1,
            py: 0.25,
            borderRadius: 999,
            bgcolor: 'rgba(0,0,0,0.42)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.6,
          }}
        >
          {badge}
        </Box>
      ) : null}
    </Box>
  );
}

export default AutoCover;
