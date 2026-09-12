import { useCallback } from 'react';
import {
  Box,
  Button,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import NotesIcon from '@mui/icons-material/Notes';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import type { DocBlock, Slide } from '@/types/doc';
import { uid } from '@/utils/uid';

/**
 * 幻灯片编辑器（T08，PPT 在线编辑）。
 *
 * 覆盖 P0-E2 / E3：增删幻灯片、增删文本框、幻灯片排序（上移 / 下移）。
 * 与「一份 DocModel 源」对齐：编辑结果以 `Slide[]` 回调给父组件，由其存为新版本。
 *
 * ⚠️ 由 `DocEditorPage` 经 `React.lazy` 引入，进入独立 chunk。
 */

// ---------------------------------------------------------------------------
// 不可变更新辅助（保持函数式、易回滚）
// ---------------------------------------------------------------------------

/** 重新编排幻灯片序号（index 从 0 递增）。 */
function reindex(slides: Slide[]): Slide[] {
  return slides.map((s, i) => ({ ...s, index: i }));
}

/** 生成一个新的空白幻灯片。 */
function newSlide(index: number): Slide {
  return { index, title: '新幻灯片', body: [], notes: '' };
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/** 幻灯片编辑器属性。 */
export interface SlideEditorProps {
  /** 当前幻灯片序列。 */
  slides: readonly Slide[];
  /** 变化回调（返回新的幻灯片序列）。 */
  onChange: (slides: Slide[]) => void;
}

export function SlideEditor({ slides, onChange }: SlideEditorProps): JSX.Element {
  const list = useCallback((): Slide[] => reindex([...slides]), [slides]);

  const updateSlide = useCallback(
    (idx: number, patch: Partial<Slide>): void => {
      onChange(list().map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    },
    [list, onChange],
  );

  const moveSlide = useCallback(
    (idx: number, dir: -1 | 1): void => {
      const arr = list();
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      onChange(reindex(arr));
    },
    [list, onChange],
  );

  const deleteSlide = useCallback(
    (idx: number): void => {
      onChange(reindex(list().filter((_, i) => i !== idx)));
    },
    [list, onChange],
  );

  const addSlide = useCallback((): void => {
    const arr = list();
    arr.push(newSlide(arr.length));
    onChange(reindex(arr));
  }, [list, onChange]);

  const updateBlock = useCallback(
    (slideIdx: number, blockIdx: number, block: DocBlock): void => {
      const slide = slides[slideIdx];
      if (!slide) return;
      const body = slide.body.map((b, i) => (i === blockIdx ? block : b));
      updateSlide(slideIdx, { body });
    },
    [slides, updateSlide],
  );

  const addBlock = useCallback(
    (slideIdx: number, type: 'paragraph' | 'list'): void => {
      const slide = slides[slideIdx];
      if (!slide) return;
      const block: DocBlock =
        type === 'list'
          ? { id: uid('blk'), type: 'list', ordered: false, items: ['要点一', '要点二'] }
          : { id: uid('blk'), type: 'paragraph', text: '在此输入内容…' };
      updateSlide(slideIdx, { body: [...slide.body, block] });
    },
    [slides, updateSlide],
  );

  const deleteBlock = useCallback(
    (slideIdx: number, blockIdx: number): void => {
      const slide = slides[slideIdx];
      if (!slide) return;
      updateSlide(slideIdx, { body: slide.body.filter((_, i) => i !== blockIdx) });
    },
    [slides, updateSlide],
  );

  const moveBlock = useCallback(
    (slideIdx: number, blockIdx: number, dir: -1 | 1): void => {
      const slide = slides[slideIdx];
      if (!slide) return;
      const arr = [...slide.body];
      const j = blockIdx + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[blockIdx], arr[j]] = [arr[j], arr[blockIdx]];
      updateSlide(slideIdx, { body: arr });
    },
    [slides, updateSlide],
  );

  /** 文本框内容 -> 块（列表按换行拆分）。 */
  const blockTextValue = (b: DocBlock): string =>
    b.type === 'list' ? (b.items ?? []).join('\n') : (b.text ?? '');

  return (
    <Stack spacing={2}>
      {slides.map((slide, idx) => (
        <Box
          key={slide.index}
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2.5,
            bgcolor: '#fff',
            p: 2,
          }}
        >
          {/* 幻灯片头部：序号 + 排序 + 删除 */}
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box
                sx={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: 'white',
                  bgcolor: 'primary.main',
                  px: 1,
                  py: 0.25,
                  borderRadius: 999,
                }}
              >
                第 {idx + 1} 页
              </Box>
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>共 {slides.length} 页</Typography>
            </Stack>
            <Stack direction="row" spacing={0.25}>
              <Tooltip title="上移">
                <IconButton size="small" onClick={() => moveSlide(idx, -1)} disabled={idx === 0}>
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="下移">
                <IconButton size="small" onClick={() => moveSlide(idx, 1)} disabled={idx === slides.length - 1}>
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除本页">
                <IconButton size="small" color="error" onClick={() => deleteSlide(idx)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          {/* 标题 */}
          <TextField
            fullWidth
            size="small"
            label="幻灯片标题"
            value={slide.title}
            onChange={(e) => updateSlide(idx, { title: e.target.value })}
            sx={{ mb: 1.25 }}
          />

          {/* 正文块 */}
          <Stack spacing={1}>
            {slide.body.map((b, bIdx) => (
              <Box
                key={b.id}
                sx={{
                  border: '1px dashed',
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  p: 1,
                  bgcolor: 'rgba(27,31,39,0.015)',
                }}
              >
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'text.secondary' }}>
                    {b.type === 'list' ? '列表' : b.type === 'paragraph' ? '文本框' : b.type}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <IconButton size="small" onClick={() => moveBlock(idx, bIdx, -1)} disabled={bIdx === 0}>
                    <ArrowUpwardIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => moveBlock(idx, bIdx, 1)}
                    disabled={bIdx === slide.body.length - 1}
                  >
                    <ArrowDownwardIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => deleteBlock(idx, bIdx)}>
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Stack>
                <TextField
                  fullWidth
                  size="small"
                  multiline
                  minRows={b.type === 'list' ? 2 : 1}
                  placeholder={b.type === 'list' ? '每行一个要点' : '输入正文'}
                  value={blockTextValue(b)}
                  onChange={(e) => {
                    const text = e.target.value;
                    if (b.type === 'list') {
                      updateBlock(idx, bIdx, { ...b, items: text.split('\n').map((s) => s.trim()).filter((s) => s.length > 0) });
                    } else {
                      updateBlock(idx, bIdx, { ...b, text });
                    }
                  }}
                />
              </Box>
            ))}
          </Stack>

          {/* 添加文本框 / 列表 */}
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button size="small" variant="outlined" startIcon={<TextFieldsIcon />} onClick={() => addBlock(idx, 'paragraph')}>
              添加文本框
            </Button>
            <Button size="small" variant="outlined" startIcon={<FormatListBulletedIcon />} onClick={() => addBlock(idx, 'list')}>
              添加列表
            </Button>
          </Stack>

          <Divider sx={{ my: 1.25 }} />

          {/* 演讲者备注 */}
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <NotesIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 1 }} />
            <TextField
              fullWidth
              size="small"
              multiline
              minRows={1}
              label="演讲者备注"
              value={slide.notes ?? ''}
              onChange={(e) => updateSlide(idx, { notes: e.target.value })}
            />
          </Stack>
        </Box>
      ))}

      {/* 新增幻灯片 */}
      <Button variant="contained" startIcon={<AddIcon />} onClick={addSlide} sx={{ alignSelf: 'flex-start' }}>
        添加幻灯片
      </Button>
    </Stack>
  );
}

export default SlideEditor;
