import { Box, Stack } from '@mui/material';
import type { SquareSort } from '@/services/squareService';

/**
 * 排序切换（UI-5）：最新 / 最热 / 点赞最多。
 */
export interface SortTabsProps {
  value: SquareSort;
  onChange: (v: SquareSort) => void;
}

const OPTIONS: readonly { key: SquareSort; label: string }[] = [
  { key: 'latest', label: '最新' },
  { key: 'hottest', label: '最热' },
  { key: 'liked', label: '点赞最多' },
];

export function SortTabs({ value, onChange }: SortTabsProps): JSX.Element {
  return (
    <Stack direction="row" spacing={0.5} role="tablist" aria-label="排序方式">
      {OPTIONS.map((opt) => {
        const selected = opt.key === value;
        return (
          <Box
            key={opt.key}
            component="button"
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(opt.key)}
            sx={{
              minHeight: 44,
              px: 2,
              borderRadius: 999,
              border: '1.5px solid',
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? 'primary.main' : '#fff',
              color: selected ? '#fff' : 'text.primary',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </Box>
        );
      })}
    </Stack>
  );
}

export default SortTabs;
