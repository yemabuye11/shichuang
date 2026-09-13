import { Box, Stack, Tooltip, Typography } from '@mui/material';
import type { BloomLevel, DocBlock, DocModel, DocPedagogy } from '@/types/doc';
import { BLOOM_LABEL, HIGHER_ORDER_BLOOM } from '@/types/doc';

/**
 * 认知层级（布鲁姆六层）展示组件。
 *
 * 业务背景：马萨诸塞大学 Amherst 2025 研究分析了 311 份教案 / 2230 个课堂活动，
 * **约 90% 只停留在「记忆、背诵、复述」这类低阶层级**。
 * 本平台把「每个环节处在哪个认知层级」直接标给老师看——
 * 一节课是不是全是"背"，一眼就能看出来。
 *
 * 视觉规则（关键）：**低阶用浅色描边，高阶用实色填充**，
 * 两种样式差异极大，缩略图 / 视频截图里也能一眼分辨。
 */

/** 每个层级的配色（chip 用）。高阶为实色白字，低阶为浅底深字。 */
export const BLOOM_COLOR: Readonly<Record<BloomLevel, { bg: string; fg: string; border: string }>> = {
  remember: { bg: '#F1F5F9', fg: '#64748B', border: '#E2E8F0' },
  understand: { bg: '#EFF6FF', fg: '#2563EB', border: '#DBEAFE' },
  apply: { bg: '#ECFEFF', fg: '#0E7490', border: '#CFFAFE' },
  analyze: { bg: '#EA580C', fg: '#FFFFFF', border: '#EA580C' },
  evaluate: { bg: '#7C3AED', fg: '#FFFFFF', border: '#7C3AED' },
  create: { bg: '#059669', fg: '#FFFFFF', border: '#059669' },
};

/** 每个层级的条形图配色。 */
const BLOOM_BAR: Readonly<Record<BloomLevel, string>> = {
  remember: '#94A3B8',
  understand: '#60A5FA',
  apply: '#22D3EE',
  analyze: '#F97316',
  evaluate: '#8B5CF6',
  create: '#10B981',
};

/** 层级的一句话解释（鼠标悬停 / 无障碍）。 */
const BLOOM_HINT: Readonly<Record<BloomLevel, string>> = {
  remember: '低阶：回忆、背诵、复述事实',
  understand: '低阶：解释、归纳、举例说明',
  apply: '中阶：把学到的方法用到新题目上',
  analyze: '高阶：比较异同、找因果、辨析易错',
  evaluate: '高阶：判断方案优劣、论证合理性、互评',
  create: '高阶：自编题目、设计实验、改编情境、综合建模',
};

/** 判断某层级是否为高阶（分析及以上）。 */
export function isHigherOrder(level: BloomLevel | undefined | null): boolean {
  return !!level && (HIGHER_ORDER_BLOOM as readonly string[]).includes(level);
}

// ---------------------------------------------------------------------------
// 认知层级 chip
// ---------------------------------------------------------------------------

/** `BloomChip` 属性。 */
export interface BloomChipProps {
  /** 认知层级。 */
  level: BloomLevel;
  /** 是否紧凑（用于段落内）。 */
  compact?: boolean;
}

/**
 * 单个认知层级标签。
 *
 * 高阶（分析/评价/创造）用实色填充 + 白字，低阶用浅底深字，
 * 保证"这节课是不是全是背"在缩略图里也一眼可见。
 */
export function BloomChip({ level, compact = false }: BloomChipProps): JSX.Element {
  const c = BLOOM_COLOR[level];
  const high = isHigherOrder(level);
  return (
    <Tooltip title={BLOOM_HINT[level]} arrow>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.25,
          flexShrink: 0,
          fontSize: compact ? 11 : 11.5,
          fontWeight: 800,
          lineHeight: 1.5,
          color: c.fg,
          bgcolor: c.bg,
          border: '1px solid',
          borderColor: c.border,
          borderRadius: 999,
          px: compact ? 0.75 : 1,
          py: 0.125,
          whiteSpace: 'nowrap',
          ...(high
            ? { boxShadow: '0 1px 4px rgba(15,23,42,0.18)' }
            : null),
        }}
      >
        {BLOOM_LABEL[level]}
        {high ? <Box component="span" sx={{ fontSize: 9.5, opacity: 0.85 }}>高阶</Box> : null}
      </Box>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// 统计
// ---------------------------------------------------------------------------

/** 认知层级统计结果。 */
export interface BloomStats {
  /** 各层级环节数。 */
  distribution: Partial<Record<BloomLevel, number>>;
  /** 已标注层级的环节总数。 */
  total: number;
  /** 高阶环节数。 */
  higherOrderCount: number;
  /** 高阶占比 0~1；无数据返回 0。 */
  higherOrderRatio: number;
  /** 互动设计去重列表。 */
  interactions: string[];
}

/**
 * 统计一份文档的认知层级分布。
 *
 * 优先采用 AI 输出的 `pedagogy` 汇总；缺失时用 `blocks[].bloom` 现算，
 * 保证即使模型没填汇总字段，老师也看得到这层信息。
 */
export function computeBloomStats(
  blocks: readonly DocBlock[] | undefined,
  pedagogy?: DocPedagogy,
): BloomStats {
  const fromBlocks: Partial<Record<BloomLevel, number>> = {};
  const interactions: string[] = [];
  for (const b of blocks ?? []) {
    if (b.bloom) fromBlocks[b.bloom] = (fromBlocks[b.bloom] ?? 0) + 1;
    const it = (b.interaction ?? '').trim();
    if (it && !interactions.includes(it)) interactions.push(it);
  }
  const blockCount = Object.values(fromBlocks).reduce((a, b) => a + (b ?? 0), 0);

  const distribution: Partial<Record<BloomLevel, number>> =
    pedagogy?.bloomDistribution && Object.keys(pedagogy.bloomDistribution).length > 0
      ? { ...pedagogy.bloomDistribution }
      : fromBlocks;

  const total =
    Object.values(distribution).reduce((a, b) => a + (b ?? 0), 0) || blockCount;

  const higherOrderCount = (HIGHER_ORDER_BLOOM as readonly BloomLevel[]).reduce(
    (sum, lv) => sum + (distribution[lv] ?? 0),
    0,
  );

  const higherOrderRatio =
    typeof pedagogy?.higherOrderRatio === 'number' && Number.isFinite(pedagogy.higherOrderRatio)
      ? pedagogy.higherOrderRatio
      : total > 0
        ? higherOrderCount / total
        : 0;

  const merged = interactions.length > 0 ? interactions : (pedagogy?.interactionTypes ?? []).filter(Boolean);

  return { distribution, total, higherOrderCount, higherOrderRatio, interactions: merged };
}

// ---------------------------------------------------------------------------
// 教案顶部汇总
// ---------------------------------------------------------------------------

/** `PedagogySummary` 属性。 */
export interface PedagogySummaryProps {
  /** 文档模型。 */
  model: DocModel;
}

/**
 * 教案顶部的「认知层级 + 高阶占比 + 互动设计」汇总面板。
 *
 * 这个「高阶活动占比 XX%」的数字是给老师看的，
 * 也是产品对外最有说服力的一张画面。
 * 无任何认知层级数据时**完全不渲染**（不占版面）。
 */
export function PedagogySummary({ model }: PedagogySummaryProps): JSX.Element | null {
  const stats = computeBloomStats(model.blocks, model.pedagogy);
  if (stats.total <= 0) return null;

  const pct = Math.round(stats.higherOrderRatio * 100);
  const levels = (Object.keys(BLOOM_LABEL) as BloomLevel[]).filter(
    (lv) => (stats.distribution[lv] ?? 0) > 0,
  );

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2.5,
        bgcolor: '#fff',
        p: { xs: 1.75, sm: 2.25 },
        mb: 2,
      }}
    >
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1.25 }}>
        <Typography sx={{ fontSize: 14.5, fontWeight: 800 }}>
          认知层级分布
        </Typography>
        <Tooltip
          title="布鲁姆六层中「分析 / 评价 / 创造」属于高阶思维。研究显示约 90% 的课堂活动只停留在记忆与复述，本平台把每一环节的认知层级标出来，方便教师自查。"
          arrow
        >
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', cursor: 'help' }}>
            什么是高阶思维？
          </Typography>
        </Tooltip>
      </Stack>

      {/* 高阶占比：最大最有冲击力的数字 */}
      <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mb: 0.75 }}>
        <Typography
          sx={{
            fontSize: 34,
            fontWeight: 900,
            lineHeight: 1,
            color: stats.higherOrderRatio >= 0.34 ? '#059669' : '#EA580C',
          }}
        >
          {pct}%
        </Typography>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: 'text.secondary' }}>
          高阶活动占比
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', ml: 'auto' }}>
          {stats.higherOrderCount} / {stats.total} 个环节
        </Typography>
      </Stack>

      {/* 占比条：低阶灰蓝 / 高阶暖色，一眼看出结构 */}
      <Box
        sx={{
          display: 'flex',
          height: 10,
          borderRadius: 999,
          overflow: 'hidden',
          bgcolor: 'rgba(27,31,39,0.05)',
          mb: 1.5,
        }}
      >
        {levels.map((lv) => {
          const n = stats.distribution[lv] ?? 0;
          return (
            <Tooltip key={lv} title={`${BLOOM_LABEL[lv]}：${n} 个环节`} arrow>
              <Box sx={{ width: `${(n / stats.total) * 100}%`, bgcolor: BLOOM_BAR[lv] }} />
            </Tooltip>
          );
        })}
      </Box>

      {/* 各层级计数 */}
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
        {levels.map((lv) => (
          <BloomChip key={lv} level={lv} compact />
        ))}
      </Stack>

      {/* 课堂互动设计 */}
      {stats.interactions.length > 0 ? (
        <Box sx={{ mt: 1.5, pt: 1.25, borderTop: '1px dashed', borderColor: 'divider' }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: 'text.secondary', mb: 0.5 }}>
            课堂互动设计
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            {stats.interactions.map((it) => (
              <Box
                key={it}
                component="span"
                sx={{
                  fontSize: 12,
                  color: 'text.primary',
                  bgcolor: 'rgba(27,31,39,0.04)',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  px: 0.875,
                  py: 0.25,
                }}
              >
                {it}
              </Box>
            ))}
          </Stack>
        </Box>
      ) : null}
    </Box>
  );
}

export default PedagogySummary;
