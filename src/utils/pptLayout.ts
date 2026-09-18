import type { DocBlock, Slide } from '@/types/doc';

export type PptSlideLayout =
  | 'cover'
  | 'section'
  | 'visual'
  | 'compare'
  | 'table'
  | 'steps'
  | 'cards'
  | 'vocabulary'
  | 'focus'
  | 'standard';

function visibleText(block: DocBlock): string {
  if (block.type === 'list') return (block.items ?? []).join(' ');
  if (block.type === 'table') return [...(block.header ?? []), ...(block.rows ?? []).flat()].join(' ');
  if (block.type === 'chart') return [block.caption, block.chart?.title, block.chart?.expression].filter(Boolean).join(' ');
  return [block.text, block.caption].filter(Boolean).join(' ');
}

export function isPptVisualBlock(block: DocBlock): boolean {
  return (
    block.type === 'chart' ||
    (block.type === 'image' && typeof block.src === 'string' && block.src.startsWith('data:image/'))
  );
}

export function getPptListItems(body: readonly DocBlock[]): string[] {
  const listBlock = body.find((block) => block.type === 'list');
  return (listBlock?.items ?? []).map((item) => item.trim()).filter(Boolean);
}

/** 自动判断一页最适合的展示结构，避免每页都把文字缩成同一张大段落。 */
export function getPptSlideLayout(slide: Slide): PptSlideLayout {
  if (slide.layout === 'title' || slide.index === 0) return 'cover';
  if (slide.layout === 'section') return 'section';
  if (slide.body.some((block) => block.type === 'table')) return 'table';
  if (slide.body.some(isPptVisualBlock)) return 'visual';
  if (slide.layout === 'two_col') return 'compare';

  const items = getPptListItems(slide.body);
  if (items.length >= 2 && items.length <= 5) {
    const averageLength = items.reduce((sum, item) => sum + item.length, 0) / items.length;
    if (averageLength <= 4 && items.every((item) => item.length <= 6)) return 'vocabulary';
    if (
      slide.body.some((block) => block.type === 'list' && block.ordered) ||
      /先|再|然后|接着|最后|第一步|第二步|步骤|过程|流程/.test(`${slide.title} ${items.join(' ')}`)
    ) {
      return 'steps';
    }
    return 'cards';
  }

  const textLength = slide.body.map(visibleText).join('').trim().length;
  if (textLength <= 180 && slide.body.some((block) => block.type === 'callout')) return 'focus';
  return 'standard';
}
