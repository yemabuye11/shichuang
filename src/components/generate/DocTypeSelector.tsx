import { Box, Stack, Typography } from '@mui/material';
import type { DocType } from '@/types/doc';
import { DOC_TYPES, getDocTypeMeta } from '@/config/constants';

/**
 * 文档类型选择器（UI-2，category='doc' 时显示）。
 *
 * 5 类文档（教案 / PPT / 课件 2D / 课件 3D / 办公文档），卡片网格带说明与积分。
 */
export interface DocTypeSelectorProps {
  /** 当前选中的文档类型。 */
  value: DocType | null;
  /** 选中回调。 */
  onChange: (d: DocType) => void;
  /** 是否显示积分成本。 */
  showCost?: boolean;
  disabled?: boolean;
}

export function DocTypeSelector({
  value,
  onChange,
  showCost = true,
  disabled = false,
}: DocTypeSelectorProps): JSX.Element {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' },
        gap: 1,
      }}
    >
      {DOC_TYPES.map((item) => {
        const selected = item.key === value;
        const meta = getDocTypeMeta(item.key);
        return (
          <Box
            key={item.key}
            component="button"
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(item.key as DocType)}
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
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 0.5,
              }}
            >
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary' }}>
                {meta.label}
              </Typography>
              {showCost ? (
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'warning.main', whiteSpace: 'nowrap' }}>
                  {meta.creditCost} 积分
                </Typography>
              ) : null}
            </Box>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25, lineHeight: 1.5 }}>
              {meta.hint}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

export default DocTypeSelector;
