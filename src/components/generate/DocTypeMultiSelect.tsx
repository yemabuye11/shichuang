import { Box, Typography } from '@mui/material';
import type { DocType } from '@/types/doc';
import { DOC_TYPES, getDocTypeMeta } from '@/config/constants';

/**
 * 文档类型多选器（野马「一句话做课件」增强）。
 *
 * 替代原单选 {@link DocTypeSelector}：文档类可一次勾选多种格式，
 * 每种格式单独计费（见 {@link GenerateRequest.docTypes}）。至少保留 1 个选中。
 */
export interface DocTypeMultiSelectProps {
  /** 当前选中的文档类型集合。 */
  value: DocType[];
  /** 选中集合变化回调。 */
  onChange: (next: DocType[]) => void;
}

export function DocTypeMultiSelect({ value, onChange }: DocTypeMultiSelectProps): JSX.Element {
  const toggle = (key: DocType): void => {
    if (value.includes(key)) {
      // 至少保留 1 个；取消最后一个时保持选中，避免空选。
      if (value.length <= 1) return;
      onChange(value.filter((v) => v !== key));
    } else {
      onChange([...value, key]);
    }
  };

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' },
        gap: 1,
      }}
    >
      {DOC_TYPES.map((item) => {
        const selected = value.includes(item.key as DocType);
        const meta = getDocTypeMeta(item.key);
        return (
          <Box
            key={item.key}
            component="button"
            type="button"
            aria-pressed={selected}
            onClick={() => toggle(item.key as DocType)}
            sx={{
              minHeight: 64,
              p: 1.25,
              textAlign: 'left',
              borderRadius: 2.5,
              border: '1.5px solid',
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? 'rgba(47,107,255,0.06)' : '#fff',
              cursor: 'pointer',
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
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'warning.main', whiteSpace: 'nowrap' }}>
                {meta.creditCost} 积分
              </Typography>
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

export default DocTypeMultiSelect;
