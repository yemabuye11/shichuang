import { Box, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { APP_TYPES, GRADES, SUBJECTS } from '@/config/constants';
import type { AppType } from '@/types/enums';

/**
 * 广场筛选栏（UI-5）：搜索 + 类型 chips + 学科 + 年级。
 *
 * 搜索框只负责收集输入，**防抖由页面用 `useDebounce(300)` 完成**，
 * 避免每敲一个字就发一次请求。
 */
export interface FilterBarProps {
  /** 搜索关键词（受控）。 */
  keyword: string;
  onKeywordChange: (v: string) => void;
  /** 类型筛选。 */
  type: AppType | '';
  onTypeChange: (v: AppType | '') => void;
  /** 学科筛选。 */
  subject: string;
  onSubjectChange: (v: string) => void;
  /** 年级筛选。 */
  grade: string;
  onGradeChange: (v: string) => void;
  /** 结果总数（展示用）。 */
  total?: number;
}

/** 通用下拉（含「全部」）。 */
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      SelectProps={{ displayEmpty: true }}
      sx={{
        minWidth: { xs: 108, sm: 128 },
        '& .MuiOutlinedInput-root': { borderRadius: 2.5, backgroundColor: '#fff' },
        '& .MuiInputBase-input': { fontSize: 15 },
      }}
    >
      <MenuItem value="">
        <em>全部</em>
      </MenuItem>
      {options.map((opt) => (
        <MenuItem key={opt} value={opt} sx={{ minHeight: 44, fontSize: 15 }}>
          {opt}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function FilterBar({
  keyword,
  onKeywordChange,
  type,
  onTypeChange,
  subject,
  onSubjectChange,
  grade,
  onGradeChange,
  total = 0,
}: FilterBarProps): JSX.Element {
  return (
    <Stack spacing={1.5}>
      <TextField
        value={keyword}
        onChange={(e) => onKeywordChange(e.target.value)}
        placeholder="搜索应用、学科、老师…"
        inputProps={{ 'aria-label': '搜索应用' }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ color: 'text.disabled' }} />
            </InputAdornment>
          ),
        }}
        sx={{
          '& .MuiOutlinedInput-root': { borderRadius: 3, backgroundColor: '#fff', fontSize: 16, minHeight: 52 },
        }}
      />

      <Stack
        direction="row"
        spacing={1}
        sx={{
          overflowX: 'auto',
          pb: 0.5,
          '&::-webkit-scrollbar': { display: 'none' },
          scrollbarWidth: 'none',
        }}
      >
        <ChipButton label="全部" selected={type === ''} onClick={() => onTypeChange('')} />
        {APP_TYPES.map((item) => (
          <ChipButton
            key={item.key}
            label={item.label}
            selected={type === item.key}
            onClick={() => onTypeChange(item.key as AppType)}
          />
        ))}
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Select label="学科" value={subject} options={SUBJECTS} onChange={onSubjectChange} />
        <Select label="年级" value={grade} options={GRADES} onChange={onGradeChange} />
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary', ml: 'auto' }}>
          共 {total} 个应用
        </Typography>
      </Stack>
    </Stack>
  );
}

/** 内部胶囊按钮。 */
function ChipButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      sx={{
        flex: '0 0 auto',
        minHeight: 40,
        px: 1.75,
        borderRadius: 999,
        border: '1.5px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'primary.main' : '#fff',
        color: selected ? '#fff' : 'text.primary',
        fontSize: 14.5,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Box>
  );
}

export default FilterBar;
