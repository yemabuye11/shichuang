import { Box, Stack, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { DocModel } from '@/types/doc';

/**
 * AI 生成内容核对横幅（T07）。
 *
 * 固定在文档结果页顶部，红色醒目提示「本内容由 AI 生成，AI 可能编错，请教师核对」，
 * 并把 `verifyHints` 中的「待核对」项逐条高亮，方便教师定位需要确认的事实 / 数据 / 例题。
 *
 * 数据来源：`docService.loadDoc` 返回的 `DocModel.verifyHints`（真实 / mock 一致）。
 * 不接触任何检索密钥——本组件纯展示，密钥只在 Edge Secrets。
 */
export interface VerifyBannerProps {
  /** 待教师核对项（来自 `DocModel.verifyHints`）。 */
  hints?: readonly string[] | null;
  /** 或直接传 `DocModel`（取 `verifyHints`）。 */
  model?: DocModel | null;
}

export function VerifyBanner({ hints, model }: VerifyBannerProps): JSX.Element {
  const items = hints ?? model?.verifyHints ?? [];
  const hasHints = items.length > 0;

  return (
    <Box
      role="alert"
      sx={{
        borderRadius: 2.5,
        border: '1.5px solid',
        borderColor: 'error.main',
        bgcolor: 'rgba(244,67,54,0.08)',
        p: 1.75,
        mb: 2,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <WarningAmberIcon sx={{ fontSize: 22, color: 'error.main' }} aria-hidden="true" />
        <Typography sx={{ fontSize: 15, fontWeight: 800, color: 'error.dark' }}>
          本内容由 AI 生成，AI 可能编错，请教师核对
        </Typography>
      </Stack>

      {hasHints ? (
        <Box component="ul" sx={{ pl: 3, mt: 1, mb: 0 }}>
          {items.map((h, i) => (
            <Typography
              component="li"
              key={i}
              sx={{ fontSize: 13, color: 'error.dark', fontWeight: 600, lineHeight: 1.7 }}
            >
              ⚠️ 待核对：{h}
            </Typography>
          ))}
        </Box>
      ) : (
        <Typography sx={{ fontSize: 13, color: 'error.dark', mt: 0.5, fontWeight: 500, lineHeight: 1.6 }}>
          生成时已尽力对齐教材，但仍请对关键事实、数据、例题与年份进行核对后再用于课堂。
        </Typography>
      )}
    </Box>
  );
}

export default VerifyBanner;
