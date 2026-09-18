import { useState } from 'react';
import { Box, Button, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import type { DocBlock, DocModel, Slide } from '@/types/doc';
import { ThreeViewer } from '@/components/editor/ThreeViewer';
import { ChartBlockView } from '@/components/editor/ChartBlockView';
import { BloomChip, PedagogySummary } from '@/components/editor/BloomChip';
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

      {model.slides && model.slides.length > 0 ? (
        <SlidesView slides={model.slides} meta={model.meta} />
      ) : null}

      {/* 认知层级汇总（教案顶部；无数据时不渲染） */}
      <PedagogySummary model={model} />

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

/** 单块渲染（外层负责认知层级 chip / 互动设计的附加展示）。 */
function BlockView({ block }: { block: DocBlock }): JSX.Element {
  const isHeading = block.type === 'heading';
  const inner = renderBlockInner(block);
  // 标题块已在标题行内渲染 chip；非标题块在块上方补一枚
  const chip = block.bloom && !isHeading ? <BloomChip level={block.bloom} compact /> : null;
  const interaction =
    block.interaction && !isHeading ? (
      <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25, lineHeight: 1.7 }}>
        互动设计：{block.interaction}
      </Typography>
    ) : null;

  if (!chip && !interaction) return inner;
  return (
    <Box>
      {chip ? <Box sx={{ mb: 0.5 }}>{chip}</Box> : null}
      {inner}
      {interaction}
    </Box>
  );
}

/** 单块内容渲染。 */
function renderBlockInner(block: DocBlock): JSX.Element {
  switch (block.type) {
    case 'heading': {
      const level = block.level ?? 2;
      const variant = level <= 1 ? 'h5' : level === 2 ? 'h6' : 'subtitle1';
      return (
        <Box>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            <Typography
              variant={variant}
              sx={{ fontWeight: 800, mt: level === 1 ? 1 : 0.5, mb: 0 }}
            >
              {block.text}
            </Typography>
            {/* 环节标题旁标注认知层级：一眼看出这节课是不是全是"背" */}
            {block.bloom ? <BloomChip level={block.bloom} /> : null}
          </Stack>
          {block.interaction ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25, lineHeight: 1.7 }}>
              互动设计：{block.interaction}
            </Typography>
          ) : null}
        </Box>
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

/** 判断块是否是可投屏的真实教学图示。 */
function isSlideVisual(block: DocBlock): boolean {
  return (
    block.type === 'chart' ||
    (block.type === 'image' && typeof block.src === 'string' && block.src.startsWith('data:image/'))
  );
}

/** 判断是否适合用双栏承载。 */
function isTwoColumnSlide(slide: Slide, textBlocks: readonly DocBlock[]): boolean {
  return slide.layout === 'two_col' || (
    slide.layout !== 'title' &&
    slide.layout !== 'section' &&
    textBlocks.length >= 3 &&
    textBlocks.every((block) => block.type !== 'table')
  );
}

/** 提取块文本，供编辑提示和字号判断使用。 */
function slideBlockText(block: DocBlock): string {
  if (block.type === 'list') return (block.items ?? []).join(' ');
  if (block.type === 'table') return [...(block.header ?? []), ...(block.rows ?? []).flat()].join(' ');
  if (block.type === 'chart') return block.caption ?? block.chart?.title ?? block.chart?.expression ?? '';
  if (block.type === 'image') return block.caption ?? '';
  return block.text ?? block.caption ?? '';
}

/** 课堂画布中的单块内容。 */
function SlideBlockContent({ block }: { block: DocBlock }): JSX.Element {
  switch (block.type) {
    case 'heading':
      return (
        <Typography sx={{ fontSize: { xs: 18, md: 22 }, fontWeight: 800, lineHeight: 1.35 }}>
          {block.text}
        </Typography>
      );
    case 'paragraph': {
      const text = block.text ?? '';
      return (
        <Typography
          sx={{
            fontSize: text.length > 130 ? { xs: 14, md: 16 } : { xs: 15, md: 18 },
            lineHeight: 1.65,
            color: '#263247',
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </Typography>
      );
    }
    case 'list':
      return (
        <Stack spacing={0.9}>
          {(block.items ?? []).map((item, i) => (
            <Stack key={`${block.id}-${i}`} direction="row" spacing={1} alignItems="flex-start">
              <Box
                sx={{
                  width: 22,
                  height: 22,
                  flex: '0 0 22px',
                  mt: 0.15,
                  borderRadius: '50%',
                  bgcolor: block.ordered ? '#2F6BFF' : '#E9EFFA',
                  color: block.ordered ? '#fff' : '#2F6BFF',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 11.5,
                  fontWeight: 800,
                }}
              >
                {block.ordered ? i + 1 : '•'}
              </Box>
              <Typography sx={{ fontSize: { xs: 14, md: 17 }, lineHeight: 1.55 }}>{item}</Typography>
            </Stack>
          ))}
        </Stack>
      );
    case 'table': {
      const header = block.header ?? [];
      const rows = block.rows ?? [];
      return (
        <Table
          size="small"
          sx={{
            borderCollapse: 'separate',
            borderSpacing: 0,
            border: '1px solid #D9E1EE',
            borderRadius: 1.5,
            overflow: 'hidden',
            '& th': {
              bgcolor: '#E9F0FF',
              color: '#1D3765',
              fontWeight: 800,
              fontSize: { xs: 12, md: 13.5 },
              borderBottom: '1px solid #C9D7EE',
              py: 0.8,
            },
            '& td': {
              fontSize: { xs: 12, md: 13.5 },
              lineHeight: 1.45,
              borderBottom: '1px solid #E6EBF2',
              py: 0.75,
            },
            '& tr:last-child td': { borderBottom: 0 },
          }}
        >
          {header.length > 0 ? (
            <TableHead>
              <TableRow>
                {header.map((h, i) => (
                  <TableCell key={i}>{h}</TableCell>
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
        <Box sx={{ textAlign: 'center' }}>
          {block.src ? (
            <Box
              component="img"
              src={block.src}
              alt={block.caption ?? ''}
              sx={{ display: 'block', width: '100%', maxHeight: 330, objectFit: 'contain' }}
            />
          ) : null}
          {block.caption ? (
            <Typography sx={{ mt: 0.75, fontSize: 12.5, color: '#5E6B7F', lineHeight: 1.5 }}>
              {block.caption}
            </Typography>
          ) : null}
        </Box>
      );
    case 'chart':
      return block.chart ? (
        <ChartBlockView spec={block.chart} caption={block.caption} />
      ) : (
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          {block.caption ?? '（图表数据缺失）'}
        </Typography>
      );
    case 'callout':
      return (
        <Box
          sx={{
            display: 'flex',
            gap: 1.1,
            px: 1.5,
            py: 1.2,
            borderLeft: '5px solid #F3B23C',
            bgcolor: '#FFF8E7',
          }}
        >
          <LightbulbIcon sx={{ fontSize: 19, color: '#C78300', mt: 0.2 }} />
          <Box>
            <Typography sx={{ fontSize: { xs: 13.5, md: 15.5 }, fontWeight: 700, lineHeight: 1.55 }}>
              {block.text}
            </Typography>
            {block.caption ? (
              <Typography sx={{ mt: 0.25, fontSize: 12.5, color: '#6B5B36' }}>
                {block.caption}
              </Typography>
            ) : null}
          </Box>
        </Box>
      );
    default:
      return <Typography>{slideBlockText(block)}</Typography>;
  }
}

/** PPT 幻灯片分页查看器。 */
function SlidesView({
  slides,
  meta,
}: {
  slides: readonly Slide[];
  meta: DocModel['meta'];
}): JSX.Element {
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const total = slides.length;
  const isCover = slide.layout === 'title' || slide.index === 0;
  const isSection = slide.layout === 'section';
  const visualBlocks = slide.body.filter(isSlideVisual);
  const textBlocks = slide.body.filter((block) => !isSlideVisual(block));
  const twoColumn = isTwoColumnSlide(slide, textBlocks);
  const metaLine = [meta.subject, meta.grade, meta.textbook, meta.duration].filter(Boolean).join(' · ');

  return (
    <Box sx={{ mb: 2 }}>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          maxWidth: 1120,
          mx: 'auto',
          minHeight: { xs: 360, md: 610 },
          borderRadius: 2.5,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: isCover ? '#233A5E' : 'divider',
          bgcolor: isCover ? '#16243A' : isSection ? '#EDF3FF' : '#FFFFFF',
          boxShadow: '0 12px 34px rgba(20,36,58,0.10)',
          p: { xs: 2.25, sm: 3.25, md: 4 },
        }}
      >
        {!isCover ? (
          <>
            <Box sx={{ position: 'absolute', left: 0, top: 0, width: '100%', height: 7, bgcolor: '#2F6BFF' }} />
            <Typography
              sx={{
                position: 'absolute',
                right: { xs: 18, sm: 28 },
                top: { xs: 18, sm: 24 },
                color: '#8290A5',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 0.4,
              }}
            >
              {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </Typography>
          </>
        ) : null}

        {isCover ? (
          <Box sx={{ minHeight: { xs: 300, md: 540 }, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Box sx={{ width: 72, height: 7, bgcolor: '#F3B23C', mb: 3 }} />
            <Typography
              sx={{
                maxWidth: 850,
                color: '#FFF',
                fontSize: { xs: 28, sm: 38, md: 48 },
                fontWeight: 900,
                lineHeight: 1.25,
              }}
            >
              {slide.title}
            </Typography>
            {metaLine ? (
              <Typography sx={{ mt: 2.5, color: '#C8D5EA', fontSize: { xs: 13, md: 16 }, fontWeight: 600 }}>
                {metaLine}
              </Typography>
            ) : null}
            <Stack spacing={1.25} sx={{ mt: 3.25, maxWidth: 860 }}>
              {slide.body.map((block) => (
                <Box
                  key={block.id}
                  sx={{
                    color: '#E9EFFA',
                    '& .MuiTypography-root': { color: '#E9EFFA !important' },
                    '& .b-callout': { bgcolor: 'transparent' },
                  }}
                >
                  <SlideBlockContent block={block} />
                </Box>
              ))}
            </Stack>
          </Box>
        ) : (
          <>
            <Typography
              component={isSection ? 'div' : 'h2'}
              sx={{
                mt: isSection ? { xs: 5, md: 8 } : 0,
                pr: 7,
                color: '#15243C',
                fontSize: isSection
                  ? { xs: 30, sm: 38, md: 46 }
                  : { xs: 22, sm: 26, md: 31 },
                fontWeight: 900,
                lineHeight: 1.25,
              }}
            >
              {slide.title}
            </Typography>
            {isSection ? (
              <Box sx={{ mt: 2, width: 90, height: 6, bgcolor: '#F3B23C' }} />
            ) : (
              <Box sx={{ mt: 1.25, mb: 2, width: 56, height: 4, bgcolor: '#F3B23C' }} />
            )}

            <Box
              sx={{
                mt: isSection ? 3 : 2.2,
                display: 'grid',
                gridTemplateColumns:
                  visualBlocks.length > 0 && textBlocks.length > 0
                    ? { xs: '1fr', md: 'minmax(0, 5fr) minmax(0, 7fr)' }
                    : twoColumn
                      ? { xs: '1fr', md: '1fr 1fr' }
                      : '1fr',
                gap: { xs: 2, md: 3 },
                alignItems: 'start',
              }}
            >
              {visualBlocks.length > 0 && textBlocks.length > 0 ? (
                <>
                  <Stack spacing={1.4}>
                    {textBlocks.map((block) => (
                      <SlideBlockContent key={block.id} block={block} />
                    ))}
                  </Stack>
                  <Stack spacing={1.5}>
                    {visualBlocks.map((block) => (
                      <SlideBlockContent key={block.id} block={block} />
                    ))}
                  </Stack>
                </>
              ) : twoColumn ? (
                (() => {
                  const midpoint = Math.ceil(slide.body.length / 2);
                  const columns = [slide.body.slice(0, midpoint), slide.body.slice(midpoint)];
                  return columns.map((column, columnIndex) => (
                    <Stack
                      key={columnIndex}
                      spacing={1.4}
                      sx={{ pl: columnIndex === 1 ? { md: 2.5 } : 0, borderLeft: columnIndex === 1 ? { md: '1px solid #E1E8F2' } : 0 }}
                    >
                      {column.map((block) => (
                        <SlideBlockContent key={block.id} block={block} />
                      ))}
                    </Stack>
                  ));
                })()
              ) : (
                <Stack spacing={1.45}>
                  {slide.body.map((block) => (
                    <SlideBlockContent key={block.id} block={block} />
                  ))}
                </Stack>
              )}
            </Box>

            <Box sx={{ position: 'absolute', left: { xs: 18, sm: 28 }, bottom: 16, display: 'flex', alignItems: 'center', gap: 0.8 }}>
              <Box sx={{ width: 20, height: 3, bgcolor: '#F3B23C' }} />
              <Typography sx={{ fontSize: 10.5, color: '#8A96A8', fontWeight: 700 }}>师创课堂课件</Typography>
            </Box>
          </>
        )}
      </Box>

      {slide.notes ? (
        <Box
          sx={{
            maxWidth: 1120,
            mx: 'auto',
            mt: 1.25,
            px: { xs: 1.5, sm: 2 },
            py: 1.25,
            bgcolor: '#F5F7FA',
            borderLeft: '4px solid #7D8EA8',
          }}
        >
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#5B687B' }}>教师讲授稿</Typography>
          <Typography sx={{ mt: 0.35, fontSize: 13.5, color: '#58667A', lineHeight: 1.7 }}>{slide.notes}</Typography>
        </Box>
      ) : null}

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ maxWidth: 1120, mx: 'auto', mt: 1 }}>
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
      <Stack direction="row" spacing={0.5} sx={{ maxWidth: 1120, mx: 'auto', mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
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
