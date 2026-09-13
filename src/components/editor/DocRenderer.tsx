import { useState } from 'react';
import { Box, Button, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import type { DocBlock, DocModel, Slide } from '@/types/doc';
import { ThreeViewer } from '@/components/editor/ThreeViewer';
import { ChartBlockView } from '@/components/editor/ChartBlockView';
import { blocksToText } from '@/utils/geometryKernel';

/**
 * 文档模型渲染器（一份 DocModel → 网页呈现）。
 *
 * 覆盖三类交付形态：
 * - `scene`：课件 3D（courseware_3d）→ 嵌入 {@link ThreeViewer}；
 * - `slides`：PPT → 分页幻灯片；
 * - `blocks`：教案 / 办公文档 → 富文本块流。
 */
export interface DocRendererProps {
  /** 文档模型。 */
  model: DocModel;
}

export function DocRenderer({ model }: DocRendererProps): JSX.Element {
  return (
    <Box>
      {model.scene ? (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 800, mb: 1 }}>
            {model.scene.title ?? '3D 课件'}
          </Typography>
          {/* bodyText 用于几何三重自检：题干数值 = 推导末步 = 模型标注 */}
          <ThreeViewer scene={model.scene} height={440} bodyText={blocksToText(model.blocks)} />
        </Box>
      ) : null}

      {model.slides && model.slides.length > 0 ? <SlidesView slides={model.slides} /> : null}

      {model.blocks && model.blocks.length > 0 ? (
        <Stack spacing={1.5} sx={{ mt: model.slides ? 3 : 0 }}>
          {model.blocks.map((b) => (
            <BlockView key={b.id} block={b} />
          ))}
        </Stack>
      ) : null}
    </Box>
  );
}

/** 单块渲染。 */
function BlockView({ block }: { block: DocBlock }): JSX.Element {
  switch (block.type) {
    case 'heading': {
      const level = block.level ?? 2;
      const variant = level <= 1 ? 'h5' : level === 2 ? 'h6' : 'subtitle1';
      return (
        <Typography variant={variant} sx={{ fontWeight: 800, mt: level === 1 ? 1 : 0.5 }}>
          {block.text}
        </Typography>
      );
    }
    case 'paragraph':
      return (
        <Typography sx={{ fontSize: 15, lineHeight: 1.85, color: 'text.primary', whiteSpace: 'pre-wrap' }}>
          {block.text}
        </Typography>
      );
    case 'list':
      return (
        <Box component={block.ordered ? 'ol' : 'ul'} sx={{ pl: 3, my: 0.5 }}>
          {(block.items ?? []).map((item, i) => (
            <Typography component="li" key={i} sx={{ fontSize: 15, lineHeight: 1.8 }}>
              {item}
            </Typography>
          ))}
        </Box>
      );
    case 'table': {
      const header = block.header ?? [];
      const rows = block.rows ?? [];
      return (
        <Table size="small" sx={{ border: '1px solid', borderColor: 'divider', fontSize: 14 }}>
          {header.length > 0 ? (
            <TableHead>
              <TableRow>
                {header.map((h, i) => (
                  <TableCell key={i} sx={{ fontWeight: 800, bgcolor: 'rgba(27,31,39,0.03)' }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
          ) : null}
          <TableBody>
            {rows.map((row, ri) => (
              <TableRow key={ri}>
                {row.map((cell, ci) => (
                  <TableCell key={ci}>{cell}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }
    case 'image':
      return (
        <Box sx={{ textAlign: block.align ?? 'center' }}>
          {block.src ? (
            <Box
              component="img"
              src={block.src}
              alt={block.caption ?? ''}
              sx={{ maxWidth: '100%', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}
            />
          ) : null}
          {block.caption ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>{block.caption}</Typography>
          ) : null}
        </Box>
      );
    case 'chart': {
      if (!block.chart) {
        return (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            {block.caption ?? '（图表数据缺失）'}
          </Typography>
        );
      }
      return <ChartBlockView spec={block.chart} caption={block.caption} />;
    }
    case 'callout':
      return (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            p: 1.5,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'warning.light',
            bgcolor: 'rgba(245,158,11,0.08)',
          }}
        >
          <LightbulbIcon sx={{ fontSize: 20, color: 'warning.main', mt: 0.25 }} aria-hidden="true" />
          <Box>
            {block.text ? <Typography sx={{ fontSize: 14.5, lineHeight: 1.7 }}>{block.text}</Typography> : null}
            {block.caption ? (
              <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>{block.caption}</Typography>
            ) : null}
          </Box>
        </Box>
      );
    default:
      return <Box />;
  }
}

/** PPT 幻灯片分页查看器。 */
function SlidesView({ slides }: { slides: readonly Slide[] }): JSX.Element {
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const total = slides.length;

  return (
    <Box sx={{ mb: 2 }}>
      <Box
        sx={{
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#fff',
          p: { xs: 2, sm: 3 },
          minHeight: 280,
        }}
      >
        <Typography sx={{ fontSize: 20, fontWeight: 800 }}>{slide.title}</Typography>
        <Stack spacing={1.25} sx={{ mt: 1.5 }}>
          {slide.body.map((b) => (
            <BlockView key={b.id} block={b} />
          ))}
        </Stack>
        {slide.notes ? (
          <Box
            sx={{
              mt: 2,
              pt: 1.5,
              borderTop: '1px dashed',
              borderColor: 'divider',
            }}
          >
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'text.secondary' }}>演讲者备注</Typography>
            <Typography sx={{ fontSize: 13.5, color: 'text.secondary', lineHeight: 1.7 }}>{slide.notes}</Typography>
          </Box>
        ) : null}
      </Box>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1 }}>
        <IconButton
          size="small"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          aria-label="上一页"
        >
          <ChevronLeftIcon />
        </IconButton>
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
          第 {index + 1} / {total} 页
        </Typography>
        <IconButton
          size="small"
          disabled={index === total - 1}
          onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
          aria-label="下一页"
        >
          <ChevronRightIcon />
        </IconButton>
      </Stack>
      <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
        {slides.map((s, i) => (
          <Button
            key={s.index}
            size="small"
            variant={i === index ? 'contained' : 'outlined'}
            onClick={() => setIndex(i)}
            sx={{ minWidth: 0, px: 1.25, fontSize: 12 }}
          >
            {i + 1}
          </Button>
        ))}
      </Stack>
    </Box>
  );
}

export default DocRenderer;
