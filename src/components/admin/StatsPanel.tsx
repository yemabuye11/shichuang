import { Box, Divider, Stack, Typography } from '@mui/material';
import { APP_TYPES } from '@/config/constants';
import { CNY_PER_CREDIT } from '@/config/creditRules';
import { formatCount, formatCny } from '@/utils/format';
import type { AdminStats } from '@/types/models';

/**
 * 数据看板（管理员三功能之二）。
 *
 * 指标：用户数 / 应用数 / 已发布 / 今日生成 / 本月支出
 *       + 各应用类型的平均单次成本（积分 + 内部对账折算）。
 *
 * ⚠️ `CNY_PER_CREDIT` 仅供管理员对账，**不向教师展示**（ARCHITECTURE.md §8.3）。
 */
export interface StatsPanelProps {
  stats: AdminStats | null;
  loading?: boolean;
}

interface Metric {
  label: string;
  value: string;
  hint?: string;
}

export function StatsPanel({ stats, loading = false }: StatsPanelProps): JSX.Element {
  const metrics: Metric[] = [
    { label: '用户数', value: stats ? String(stats.users) : '—' },
    { label: '应用数', value: stats ? String(stats.apps) : '—' },
    { label: '已发布', value: stats ? String(stats.published) : '—' },
    { label: '今日生成', value: stats ? String(stats.gensToday) : '—' },
    {
      label: '本月支出',
      value: stats ? formatCny(stats.spendMonthCny) : '—',
      hint: '模型真实花费（内部对账）',
    },
  ];

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Typography sx={{ fontSize: 17, fontWeight: 700, mb: 2 }}>数据看板</Typography>

      {loading || !stats ? (
        <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 2 }}>加载中…</Typography>
      ) : (
        <Stack spacing={2.5}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', sm: 'repeat(5, minmax(0,1fr))' },
              gap: 1.5,
            }}
          >
            {metrics.map((m) => (
              <Box
                key={m.label}
                sx={{
                  borderRadius: 2.5,
                  bgcolor: 'rgba(47,107,255,0.05)',
                  px: 1.5,
                  py: 1.5,
                  textAlign: 'center',
                }}
              >
                <Typography sx={{ fontSize: 24, fontWeight: 800, color: 'primary.main', lineHeight: 1.2 }}>
                  {m.value}
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>{m.label}</Typography>
                {m.hint ? (
                  <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 0.25 }}>{m.hint}</Typography>
                ) : null}
              </Box>
            ))}
          </Box>

          <Divider />

          <Box>
            <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1 }}>
              各应用类型平均单次成本
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Box sx={{ minWidth: 420 }}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1.2fr 0.8fr 1fr',
                    gap: 1,
                    pb: 0.75,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary' }}>类型</Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary', textAlign: 'right' }}>
                    单次积分
                  </Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary', textAlign: 'right' }}>
                    折算成本（对账用）
                  </Typography>
                </Box>
                {APP_TYPES.map((t) => (
                  <Box
                    key={t.key}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: '1.2fr 0.8fr 1fr',
                      gap: 1,
                      py: 0.75,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      alignItems: 'center',
                    }}
                  >
                    <Typography sx={{ fontSize: 14 }}>{t.label}</Typography>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, textAlign: 'right' }}>
                      {t.creditCost} 积分
                    </Typography>
                    <Typography sx={{ fontSize: 14, color: 'text.secondary', textAlign: 'right' }}>
                      {formatCny(t.creditCost * CNY_PER_CREDIT)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
            <Typography sx={{ fontSize: 12, color: 'text.disabled', mt: 1 }}>
              教师侧只看到「积分」，与真实 token 成本解耦；此表仅供平台方对账。
            </Typography>
          </Box>

          {stats.topApps.length > 0 ? (
            <Box>
              <Divider sx={{ mb: 2 }} />
              <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1 }}>热门应用 Top {stats.topApps.length}</Typography>
              <Stack spacing={0.5}>
                {stats.topApps.map((a, i) => (
                  <Stack key={a.id} direction="row" spacing={1} alignItems="center" sx={{ minHeight: 40 }}>
                    <Box
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: 999,
                        bgcolor: i < 3 ? 'primary.main' : 'rgba(27,31,39,0.06)',
                        color: i < 3 ? '#fff' : 'text.secondary',
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </Box>
                    <Typography
                      sx={{
                        fontSize: 14.5,
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {a.title}
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                      👁 {formatCount(a.viewCount)} · 👍 {formatCount(a.likeCount)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      )}
    </Box>
  );
}

export default StatsPanel;
