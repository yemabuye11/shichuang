import { Box, Typography } from '@mui/material';
import type { ChartSpec } from '@/types/doc';

/**
 * 图表块渲染器（**纯内联 SVG**，不引第三方图表库）。
 *
 * 背景（docs/QUALITY_BASELINE.md 提交 4）：此前 AI 被要求"需要配图时 `image.src` 留空，
 * 只写一句『建议配图：XX』"——结果导出的 PPT / 课件里**一张真图都没有**，
 * 一节讲函数图像的数学课，课件里没有函数图像。这是当时判 PPT 为 ❌ 的唯一致命伤。
 *
 * 现在新增 `chart` 块：AI 输出结构化数据（采样点 / 分类值），平台用 SVG 画出来。
 * 不引 echarts / chart.js 之类——three 747KB 的教训在前，不为单一功能拖垮首屏。
 */

/** 画布尺寸（viewBox 坐标，实际显示自适应宽度）。 */
const W = 640;
const H = 360;
/** 内边距（给坐标轴文字留位置）。 */
const PAD = { top: 24, right: 24, bottom: 46, left: 56 };

/** 数值格式化（去掉多余小数，图上使用更清爽）。 */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000) return String(Math.round(n));
  if (abs >= 10) return String(Math.round(n * 10) / 10);
  return String(Math.round(n * 100) / 100);
}

/** 取一组"好看"的刻度值（5 段）。 */
function niceTicks(min: number, max: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    const v = Number.isFinite(min) ? min : 0;
    return [v - 2, v - 1, v, v + 1, v + 2];
  }
  const span = max - min;
  const step = span / 4;
  const out: number[] = [];
  for (let i = 0; i <= 4; i += 1) out.push(min + step * i);
  return out;
}

export interface ChartBlockViewProps {
  /** 图表数据。 */
  spec: ChartSpec;
  /** 图注（块级 caption，优先级低于 spec.title）。 */
  caption?: string;
}

/** 把 ChartSpec 渲染为内联 SVG 卡片。 */
export function ChartBlockView({ spec, caption }: ChartBlockViewProps): JSX.Element {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // ---- 收集数值域 ----
  const points = (spec.points ?? []).filter((p) => Array.isArray(p) && p.length >= 2) as number[][];
  const categories = spec.categories ?? [];
  const values = spec.values ?? [];

  const xs = points.map((p) => Number(p[0]));
  const ys = points.map((p) => Number(p[1]));
  const isBar = spec.kind === 'bar';

  let xMin: number;
  let xMax: number;
  let yMin: number;
  let yMax: number;

  if (isBar) {
    xMin = -0.5;
    xMax = Math.max(categories.length - 0.5, 0.5);
    const nums = values.map(Number).filter(Number.isFinite);
    yMin = Math.min(0, ...nums);
    yMax = Math.max(0, ...nums);
  } else if (points.length > 0) {
    xMin = Math.min(...xs);
    xMax = Math.max(...xs);
    yMin = Math.min(...ys);
    yMax = Math.max(...ys);
    if (xMin === xMax) {
      xMin -= 1;
      xMax += 1;
    }
    if (yMin === yMax) {
      yMin -= 1;
      yMax += 1;
    }
    // 函数曲线：Y 轴尽量含 0，读图更直观
    if (spec.kind === 'function') {
      yMin = Math.min(yMin, 0);
      yMax = Math.max(yMax, 0);
    }
  } else {
    xMin = 0;
    xMax = 1;
    yMin = 0;
    yMax = 1;
  }

  // Y 轴留 6% 余量，避免曲线贴边
  const yPad = (yMax - yMin) * 0.06 || 1;
  yMin -= yPad;
  yMax += yPad;

  /** 数据坐标 → 画布坐标。 */
  const sx = (x: number): number => PAD.left + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (y: number): number => PAD.top + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;

  const yTicks = niceTicks(yMin, yMax);
  const xTickCount = isBar ? categories.length : 5;
  const xTickVals = isBar
    ? categories.map((_, i) => i)
    : Array.from({ length: xTickCount }, (_, i) => xMin + ((xMax - xMin) / (xTickCount - 1)) * i);

  // ---- 轴 ----
  const axisColor = '#C9CFD8';
  const gridColor = '#EDEFF3';
  const zeroY = yMin <= 0 && yMax >= 0 ? sy(0) : null;

  // ---- 内容 ----
  let content: JSX.Element;
  if (isBar) {
    const slot = plotW / Math.max(categories.length, 1);
    const barW = Math.min(slot * 0.56, 48);
    content = (
      <g>
        {values.map((v, i) => {
          const nv = Number(v);
          if (!Number.isFinite(nv)) return null;
          const top = sy(Math.max(nv, 0));
          const bottom = sy(Math.min(nv, 0));
          const h = Math.max(bottom - top, 1);
          return (
            <g key={`bar-${i}`}>
              <rect
                x={sx(i) - barW / 2}
                y={top}
                width={barW}
                height={h}
                rx={4}
                fill="#2F6BFF"
                opacity={0.85}
              />
              <text
                x={sx(i)}
                y={top - 6}
                textAnchor="middle"
                fontSize="11"
                fill="#4B5563"
                fontWeight="600"
              >
                {fmt(nv)}
              </text>
            </g>
          );
        })}
      </g>
    );
  } else if (points.length > 0) {
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(Number(p[0])).toFixed(2)},${sy(Number(p[1])).toFixed(2)}`).join(' ');
    content = (
      <g>
        <path d={d} fill="none" stroke="#2F6BFF" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle
            key={`pt-${i}`}
            cx={sx(Number(p[0]))}
            cy={sy(Number(p[1]))}
            r={3}
            fill="#fff"
            stroke="#2F6BFF"
            strokeWidth={2}
          />
        ))}
      </g>
    );
  } else {
    content = (
      <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="13" fill="#9AA4B2">
        （图表数据为空）
      </text>
    );
  }

  return (
    <Box sx={{ my: 1.5 }}>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          bgcolor: '#fff',
          p: { xs: 1, sm: 1.5 },
        }}
      >
        {spec.expression ? (
          <Typography
            sx={{
              fontSize: 14,
              fontWeight: 800,
              color: 'primary.main',
              fontFamily: 'monospace',
              mb: 0.5,
              textAlign: 'center',
            }}
          >
            {spec.expression}
          </Typography>
        ) : null}
        <Box
          component="svg"
          viewBox={`0 0 ${W} ${H}`}
          sx={{ width: '100%', height: 'auto', display: 'block' }}
          role="img"
          aria-label={spec.title ?? spec.expression ?? '图表'}
        >
          {/* 网格 + Y 轴刻度 */}
          {yTicks.map((t, i) => (
            <g key={`y-${i}`}>
              <line x1={PAD.left} y1={sy(t)} x2={W - PAD.right} y2={sy(t)} stroke={gridColor} strokeWidth={1} />
              <text x={PAD.left - 8} y={sy(t) + 4} textAnchor="end" fontSize="11" fill="#6B7280">
                {fmt(t)}
              </text>
            </g>
          ))}
          {/* X 轴刻度 */}
          {xTickVals.map((v, i) => (
            <text
              key={`x-${i}`}
              x={sx(v)}
              y={H - PAD.bottom + 20}
              textAnchor="middle"
              fontSize="11"
              fill="#6B7280"
            >
              {isBar ? String(categories[i] ?? '') : fmt(v)}
            </text>
          ))}
          {/* 坐标轴 */}
          <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} stroke={axisColor} strokeWidth={1.5} />
          <line
            x1={PAD.left}
            y1={H - PAD.bottom}
            x2={W - PAD.right}
            y2={H - PAD.bottom}
            stroke={axisColor}
            strokeWidth={1.5}
          />
          {zeroY !== null && zeroY > PAD.top && zeroY < H - PAD.bottom ? (
            <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} stroke={axisColor} strokeWidth={1.5} />
          ) : null}
          {content}
          {/* 轴名 */}
          {spec.xLabel ? (
            <text x={W / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="#4B5563">
              {spec.xLabel}
            </text>
          ) : null}
          {spec.yLabel ? (
            <text x={14} y={H / 2} textAnchor="middle" fontSize="12" fill="#4B5563" transform={`rotate(-90 14 ${H / 2})`}>
              {spec.yLabel}
            </text>
          ) : null}
        </Box>
      </Box>
      {spec.title ?? caption ? (
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5, textAlign: 'center' }}>
          {spec.title ?? caption}
        </Typography>
      ) : null}
    </Box>
  );
}

export default ChartBlockView;
