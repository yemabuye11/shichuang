import { Box, Chip, Stack, TextField, Typography } from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import type { TextbookVersion } from '@/types/doc';

/**
 * 教材版本级联选择器（UI-2，category='doc' 时显示）。
 *
 * ⚠️ T06 仅实现 UI 壳：教材库检索与回填逻辑在 T07 落地。
 * 本批：
 * - `versions` 由上层传入（T06 通常为空，展示「教材库即将上线」提示，可跳过）；
 * - 选中某版本后通过 `onSelectVersion(id)` 上报 `textbookVersionId`；
 * - 章节 / 知识点为选填自由文本，通过 `onChapterChange` 上报，T07 会并入 `textbookContext`。
 */
export interface TextbookCascadeProps {
  /** 可选教材版本（T07 接入真实库后填充）。 */
  versions: readonly TextbookVersion[];
  /** 当前选中的版本 id（null = 未绑定）。 */
  selectedVersionId: string | null;
  /** 选中版本回调。 */
  onSelectVersion: (id: string | null) => void;
  /** 章节 / 知识点（选填）。 */
  chapter: string;
  /** 章节文本变化回调。 */
  onChapterChange: (text: string) => void;
}

export function TextbookCascade({
  versions,
  selectedVersionId,
  onSelectVersion,
  chapter,
  onChapterChange,
}: TextbookCascadeProps): JSX.Element {
  return (
    <Box
      sx={{
        borderRadius: 2.5,
        border: '1px dashed',
        borderColor: 'divider',
        bgcolor: 'rgba(27,31,39,0.02)',
        p: 1.75,
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
        <MenuBookIcon sx={{ fontSize: 18, color: 'text.secondary' }} aria-hidden="true" />
        <Typography sx={{ fontSize: 14.5, fontWeight: 700 }}>绑定教材（选填）</Typography>
      </Stack>

      {versions.length === 0 ? (
        <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.6 }}>
          教材库将在后续版本（T07）上线，本批可直接跳过；生成结果仍可直接打印与分享。
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {versions.map((v) => {
            const selected = v.id === selectedVersionId;
            return (
              <Chip
                key={v.id}
                label={`${v.subject}·${v.grade}·${v.version}`}
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                onClick={() => onSelectVersion(selected ? null : v.id)}
                aria-pressed={selected}
              />
            );
          })}
        </Box>
      )}

      <TextField
        value={chapter}
        onChange={(e) => onChapterChange(e.target.value)}
        placeholder="如：第三章 第一节 勾股定理（选填，让生成更贴合你的进度）"
        size="small"
        fullWidth
        multiline
        minRows={1}
        sx={{ mt: 1.25, bgcolor: '#fff' }}
      />
    </Box>
  );
}

export default TextbookCascade;
