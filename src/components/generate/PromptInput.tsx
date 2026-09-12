import { Box, TextField, Typography } from '@mui/material';
import { MAX_PROMPT_LENGTH, MIN_PROMPT_LENGTH } from '@/config/constants';

/**
 * 需求输入（UI-1 / UI-2 共用的大输入框）。
 *
 * 移动端优先：正文 17px、3 行起、右下角字数提示。
 */
export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  /** 占位示例文案。 */
  placeholder?: string;
  /** 最小可见行数。 */
  minRows?: number;
  disabled?: boolean;
  /** 错误提示（为空表示无错误）。 */
  error?: string;
  /** 底部提示（含 token 说明）。 */
  helper?: string;
  /** 输入框 id，便于 label 关联。 */
  id?: string;
}

export function PromptInput({
  value,
  onChange,
  placeholder = '说说你想做什么，例如：以《西游记》取经之路为故事线，生成六年级古诗词闯关游戏',
  minRows = 3,
  disabled = false,
  error = '',
  helper = '',
  id = 'prompt-input',
}: PromptInputProps): JSX.Element {
  const length = value.length;
  const tooShort = !error && length > 0 && length < MIN_PROMPT_LENGTH;

  return (
    <Box>
      <TextField
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
        placeholder={placeholder}
        multiline
        minRows={minRows}
        maxRows={10}
        disabled={disabled}
        error={Boolean(error)}
        inputProps={{ 'aria-label': '应用需求描述', maxLength: MAX_PROMPT_LENGTH }}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 3,
            alignItems: 'flex-start',
            backgroundColor: '#fff',
            fontSize: 17,
            lineHeight: 1.7,
            p: 0.5,
          },
          '& textarea': { fontSize: 17, lineHeight: 1.7 },
        }}
      />
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 1,
          mt: 0.75,
          px: 0.5,
        }}
      >
        <Typography
          component="div"
          sx={{ fontSize: 13, color: error ? 'error.main' : 'text.secondary', lineHeight: 1.5 }}
        >
          {error || (tooShort ? `再多写几个字吧（至少 ${MIN_PROMPT_LENGTH} 个字）` : helper)}
        </Typography>
        <Typography
          component="div"
          sx={{
            fontSize: 13,
            color: length >= MAX_PROMPT_LENGTH ? 'warning.main' : 'text.secondary',
            whiteSpace: 'nowrap',
          }}
        >
          {length} / {MAX_PROMPT_LENGTH}
        </Typography>
      </Box>
    </Box>
  );
}

export default PromptInput;
