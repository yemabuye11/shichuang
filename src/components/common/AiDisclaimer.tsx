import { Box, Stack, Typography } from '@mui/material';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

/**
 * AI 生成声明（合规要求 P0-D7，必须显著标注）。
 *
 * @param compact 紧凑模式（用于卡片等窄空间）。
 */
export function AiDisclaimer({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      justifyContent="center"
      sx={{
        py: compact ? 0.5 : 1,
        px: compact ? 1 : 1.5,
        borderRadius: 2,
        bgcolor: 'rgba(27,31,39,0.04)',
        color: 'text.secondary',
        textAlign: 'center',
      }}
    >
      <SmartToyOutlinedIcon sx={{ fontSize: compact ? 16 : 18 }} aria-hidden="true" />
      <Box component="span" sx={{ fontSize: compact ? 12 : 13, lineHeight: 1.5 }}>
        本内容由 AI 生成，请教师审核后使用
      </Box>
    </Stack>
  );
}

/** 带说明的完整版（应用运行页底部）。 */
export function AiDisclaimerBlock(): JSX.Element {
  return (
    <Box sx={{ textAlign: 'center', py: 1 }}>
      <Typography variant="caption" color="text.secondary">
        本内容由 AI 生成，请教师审核后使用 · 应用内不会收集学生姓名、班级等个人信息
      </Typography>
    </Box>
  );
}

export default AiDisclaimer;
