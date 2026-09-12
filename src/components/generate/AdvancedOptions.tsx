import { useState } from 'react';
import {
  Box,
  Collapse,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { DIFFICULTY, DURATIONS, GRADES, SUBJECTS, TEXTBOOKS } from '@/config/constants';

/**
 * 「更多设置（选填）」折叠区（UI-2）。
 *
 * 全部使用下拉选择，不让老师打字（PRD 极简原则）；
 * 未填时由提示词层的 `user_enhance` 模板让模型自行推断合理默认值。
 */
export interface AdvancedOptions {
  subject: string;
  grade: string;
  textbook: string;
  duration: string;
  difficulty: string;
}

/** 空的更多设置（UI 上的「不限/未选」用空串表示）。 */
export const EMPTY_ADVANCED: AdvancedOptions = {
  subject: '',
  grade: '',
  textbook: '',
  duration: '',
  difficulty: '',
};

export interface AdvancedOptionsProps {
  value: AdvancedOptions;
  onChange: (next: AdvancedOptions) => void;
  disabled?: boolean;
}

/** 通用下拉（带「不限」选项）。 */
function SelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  includeBlank = true,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  includeBlank?: boolean;
}): JSX.Element {
  return (
    <TextField
      select
      label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      SelectProps={{ displayEmpty: true }}
      sx={{
        '& .MuiOutlinedInput-root': { borderRadius: 2.5, backgroundColor: '#fff' },
        '& .MuiInputBase-input': { fontSize: 16 },
      }}
    >
      {includeBlank ? (
        <MenuItem value="">
          <em>不限</em>
        </MenuItem>
      ) : null}
      {options.map((opt) => (
        <MenuItem key={opt} value={opt} sx={{ minHeight: 44, fontSize: 16 }}>
          {opt}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function AdvancedOptionsPanel({
  value,
  onChange,
  disabled = false,
}: AdvancedOptionsProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', backgroundColor: '#fff' }}>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={disabled}
        sx={{
          width: '100%',
          minHeight: 52,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <ExpandMoreIcon
          sx={{
            color: 'text.secondary',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform .18s',
          }}
        />
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>更多设置（选填）</Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', ml: 'auto' }}>
          {open ? '收起' : '学科 / 年级 / 教材 / 时长 / 难度'}
        </Typography>
      </Box>

      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 2 }}>
          <Stack spacing={1.5}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                gap: 1.5,
              }}
            >
              <SelectField
                label="学科"
                value={value.subject}
                options={SUBJECTS}
                disabled={disabled}
                onChange={(v) => onChange({ ...value, subject: v })}
              />
              <SelectField
                label="年级"
                value={value.grade}
                options={GRADES}
                disabled={disabled}
                onChange={(v) => onChange({ ...value, grade: v })}
              />
              <SelectField
                label="教材版本"
                value={value.textbook}
                options={TEXTBOOKS}
                disabled={disabled}
                onChange={(v) => onChange({ ...value, textbook: v })}
              />
              <SelectField
                label="课堂时长"
                value={value.duration}
                options={DURATIONS}
                disabled={disabled}
                onChange={(v) => onChange({ ...value, duration: v })}
              />
              <SelectField
                label="难度"
                value={value.difficulty}
                options={DIFFICULTY}
                disabled={disabled}
                onChange={(v) => onChange({ ...value, difficulty: v })}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              不选也可以，AI 会根据你的描述自行判断合适的学科与难度。
            </Typography>
          </Stack>
        </Box>
      </Collapse>
    </Box>
  );
}

export default AdvancedOptionsPanel;
