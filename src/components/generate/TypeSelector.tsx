import { Box, Stack, Typography } from '@mui/material';
import { APP_TYPES, getAppTypeMeta } from '@/config/constants';
import type { AppType } from '@/types/enums';

/**
 * 8 类应用类型选择器（默认「自动判断」）。
 *
 * 两种形态：
 * - `chips`：胶囊横排可横向滚动（首页 / 广场）；
 * - `grid`：两列可点卡片，带一句话说明与积分（生成页）。
 */
export interface TypeSelectorProps {
  value: AppType;
  onChange: (type: AppType) => void;
  variant?: 'chips' | 'grid';
  /** 是否显示积分成本。 */
  showCost?: boolean;
  disabled?: boolean;
}

export function TypeSelector({
  value,
  onChange,
  variant = 'chips',
  showCost = true,
  disabled = false,
}: TypeSelectorProps): JSX.Element {
  if (variant === 'chips') {
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{
          overflowX: 'auto',
          pb: 0.5,
          // 移动端隐藏滚动条，保持视觉简洁
          '&::-webkit-scrollbar': { display: 'none' },
          scrollbarWidth: 'none',
        }}
      >
        {APP_TYPES.map((item) => {
          const selected = item.key === value;
          return (
            <Box
              key={item.key}
              component="button"
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(item.key as AppType)}
              sx={{
                flex: '0 0 auto',
                minHeight: 44,
                px: 2,
                borderRadius: 999,
                border: '1.5px solid',
                borderColor: selected ? 'primary.main' : 'divider',
                bgcolor: selected ? 'primary.main' : '#fff',
                color: selected ? '#fff' : 'text.primary',
                fontSize: 15,
                fontWeight: 600,
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.6 : 1,
              }}
            >
              {item.label}
              {showCost && !selected ? (
                <Box component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 0.5 }}>
                  {item.creditCost}
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Stack>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' },
        gap: 1,
      }}
    >
      {APP_TYPES.map((item) => {
        const selected = item.key === value;
        return (
          <Box
            key={item.key}
            component="button"
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(item.key as AppType)}
            sx={{
              minHeight: 64,
              p: 1.25,
              textAlign: 'left',
              borderRadius: 2.5,
              border: '1.5px solid',
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? 'rgba(47,107,255,0.06)' : '#fff',
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary' }}>{item.label}</Typography>
              {showCost ? (
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'warning.main', whiteSpace: 'nowrap' }}>
                  {item.creditCost} 积分
                </Typography>
              ) : null}
            </Box>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25, lineHeight: 1.5 }}>
              {item.hint}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/** 当前选中类型的说明文字（生成页底部提示用）。 */
export function TypeHint({ type }: { type: AppType }): JSX.Element {
  const meta = getAppTypeMeta(type);
  return (
    <Typography variant="body2" color="text.secondary">
      {meta.label}：{meta.hint}
    </Typography>
  );
}

export default TypeSelector;
