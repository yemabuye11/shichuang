import { Box, Stack, Typography } from '@mui/material';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import { EXAMPLES, getAppTypeLabel } from '@/config/constants';
import type { AppType } from '@/types/enums';

/**
 * 示例 chips（UI-1「不知道怎么描述？试试」）。
 *
 * 点击即把完整提示词填入输入框并切换到建议类型，
 * 这是把「首次生成成功率」做上去的关键（PRD G1）。
 */
export interface ExampleChipsProps {
  /** 点击某个示例。 */
  onPick: (prompt: string, appType: AppType) => void;
  /** 最多展示几个（默认全部）。 */
  limit?: number;
  disabled?: boolean;
}

export function ExampleChips({ onPick, limit, disabled = false }: ExampleChipsProps): JSX.Element {
  const list = limit ? EXAMPLES.slice(0, limit) : EXAMPLES;

  return (
    <Box>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
        <AutoAwesomeOutlinedIcon sx={{ fontSize: 18, color: 'warning.main' }} aria-hidden="true" />
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.secondary' }}>
          不知道怎么描述？试试这些
        </Typography>
      </Stack>

      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        flexWrap="wrap"
        sx={{ '& > *': { mb: 1 } }}
      >
        {list.map((item) => (
          <Box
            key={item.label}
            component="button"
            type="button"
            disabled={disabled}
            onClick={() => onPick(item.prompt, item.appType)}
            sx={{
              minHeight: 44,
              px: 1.75,
              borderRadius: 999,
              border: '1.5px solid',
              borderColor: 'divider',
              bgcolor: '#fff',
              color: 'text.primary',
              fontSize: 15,
              fontWeight: 600,
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              '&:hover': { borderColor: 'primary.main', color: 'primary.main' },
            }}
          >
            {item.label}
            <Box component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 0.75, fontWeight: 500 }}>
              {getAppTypeLabel(item.appType)}
            </Box>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

export default ExampleChips;
