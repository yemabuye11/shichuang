import { Chip } from '@mui/material';
import { getAppTypeMeta } from '@/config/constants';
import type { AppType } from '@/types/enums';

/**
 * 应用类型标签。
 */
export interface TypeChipProps {
  /** 应用类型。 */
  type: AppType | string;
  /** 尺寸。 */
  size?: 'small' | 'medium';
  /** 是否可点击（选中态）。 */
  selected?: boolean;
  onClick?: () => void;
}

export function TypeChip({ type, size = 'small', selected = false, onClick }: TypeChipProps): JSX.Element {
  const meta = getAppTypeMeta(type);
  return (
    <Chip
      label={meta.label}
      size={size}
      onClick={onClick}
      sx={{
        height: size === 'small' ? 26 : 34,
        fontSize: size === 'small' ? 12 : 14,
        fontWeight: 600,
        borderRadius: 999,
        bgcolor: selected ? 'primary.main' : 'rgba(47,107,255,0.08)',
        color: selected ? '#fff' : 'primary.main',
        '&:hover': onClick
          ? { bgcolor: selected ? 'primary.dark' : 'rgba(47,107,255,0.16)' }
          : undefined,
      }}
    />
  );
}

export default TypeChip;
