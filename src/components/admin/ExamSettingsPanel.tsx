import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useToast } from '@/components/common/ToastHost';
import { getSupabase } from '@/services/supabaseClient';
import type { Json } from '@/types/database';

/** 题型（与 `ExamQType` / 迁移 0040 默认配置保持一致）。 */
const QTYPE_ITEMS: readonly { key: string; label: string }[] = [
  { key: 'choice', label: '选择题' },
  { key: 'fill', label: '填空题' },
  { key: 'judge', label: '判断题' },
  { key: 'subjective', label: '主观题' },
] as const;

/** 各题型单题积分默认值（读取失败 / 缺字段时使用）。 */
const DEFAULT_QUESTION_COST: Record<string, number> = {
  choice: 0.1,
  fill: 0.1,
  judge: 0.08,
  subjective: 0.25,
};

/** 题量阶梯折扣默认值（读取失败 / 缺字段时使用）。 */
const DEFAULT_BULK_TIERS: readonly { min: number; discount: number }[] = [
  { min: 1, discount: 1 },
  { min: 20, discount: 0.9 },
  { min: 40, discount: 0.8 },
];

const DEFAULT_MIN_DISCOUNT = 0.6;
const DEFAULT_IMPORT_COST = 0.5;
const DEFAULT_QUESTION_COUNT = 20;

/** 阶梯折扣的一行（min = 达到该题量，discount = 享受的折扣）。 */
interface BulkTierRow {
  min: number;
  discount: number;
}

/**
 * 管理员「组卷配置」面板。
 *
 * 读写 system_config.exam（jsonb），写法与「每日一练配置」完全一致：
 * - 读：get_system_config('exam')；
 * - 写：admin_set_system_config('exam', jsonb)（管理员 SECURITY DEFINER RPC）。
 *
 * 可编辑字段：
 * - questionCost        各题型单题积分；
 * - bulkTiers           题量阶梯折扣（题量达到 min 时享受 discount）；
 * - minDiscount         折扣下限；
 * - importCostCredits   上传原卷 AI 识别的固定积分；
 * - defaultQuestionCount 默认题量。
 */
export function ExamSettingsPanel(): JSX.Element {
  const toast = useToast();

  const [questionCost, setQuestionCost] = useState<Record<string, number>>({ ...DEFAULT_QUESTION_COST });
  const [tiers, setTiers] = useState<BulkTierRow[]>(DEFAULT_BULK_TIERS.map((t) => ({ ...t })));
  const [minDiscount, setMinDiscount] = useState<number>(DEFAULT_MIN_DISCOUNT);
  const [importCostCredits, setImportCostCredits] = useState<number>(DEFAULT_IMPORT_COST);
  const [defaultQuestionCount, setDefaultQuestionCount] = useState<number>(DEFAULT_QUESTION_COUNT);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const sb = getSupabase();
    // 未连接后端：用默认值填充，不让面板空白（与 examPaperService 的回落行为一致）。
    if (!sb) {
      setLoading(false);
      return;
    }
    try {
      const { data, error: rpcError } = await sb.rpc('get_system_config', { p_key: 'exam' });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const obj =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : null;
      if (!obj) return;

      const rawCost =
        obj.questionCost &&
        typeof obj.questionCost === 'object' &&
        !Array.isArray(obj.questionCost)
          ? (obj.questionCost as Record<string, number>)
          : null;
      setQuestionCost(
        QTYPE_ITEMS.reduce<Record<string, number>>((acc, item) => {
          acc[item.key] = typeof rawCost?.[item.key] === 'number'
            ? Number(rawCost[item.key])
            : (DEFAULT_QUESTION_COST[item.key] ?? 0.1);
          return acc;
        }, {}),
      );

      const rawTiers = Array.isArray(obj.bulkTiers)
        ? (obj.bulkTiers as Array<{ min?: number; discount?: number }>).map((t) => ({
            min: Number(t?.min ?? 1),
            discount: Number(t?.discount ?? 1),
          }))
        : [];
      setTiers(rawTiers.length > 0 ? rawTiers : DEFAULT_BULK_TIERS.map((t) => ({ ...t })));

      setMinDiscount(typeof obj.minDiscount === 'number' ? obj.minDiscount : DEFAULT_MIN_DISCOUNT);
      setImportCostCredits(
        typeof obj.importCostCredits === 'number' ? obj.importCostCredits : DEFAULT_IMPORT_COST,
      );
      setDefaultQuestionCount(
        typeof obj.defaultQuestionCount === 'number' ? obj.defaultQuestionCount : DEFAULT_QUESTION_COUNT,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载组卷配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCostChange = (key: string, raw: string): void => {
    const v = Number(raw);
    setQuestionCost((prev) => ({ ...prev, [key]: Number.isFinite(v) ? v : 0 }));
  };

  const handleTierChange = (index: number, field: 'min' | 'discount', raw: string): void => {
    const v = Number(raw);
    setTiers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: Number.isFinite(v) ? v : 0 } : t)),
    );
  };

  const handleAddTier = (): void => {
    setTiers((prev) => {
      const maxMin = prev.reduce((m, t) => Math.max(m, t.min), 0);
      const lastDiscount = prev.length > 0 ? prev[prev.length - 1].discount : 1;
      return [...prev, { min: maxMin + 20, discount: lastDiscount }];
    });
  };

  const handleRemoveTier = (index: number): void => {
    setTiers((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      // 校验 1：各题型单题积分必须 ≥ 0。
      for (const item of QTYPE_ITEMS) {
        const c = questionCost[item.key];
        if (!Number.isFinite(c) || c < 0) {
          throw new Error(`「${item.label}」单题积分不能为负数`);
        }
      }

      // 校验 2：折扣下限 ∈ [0, 1]。
      if (!Number.isFinite(minDiscount) || minDiscount < 0 || minDiscount > 1) {
        throw new Error('折扣下限必须介于 0 与 1 之间');
      }

      // 校验 3：每档阶梯的题量 ≥ 1 且为整数，折扣 ∈ [minDiscount, 1]。
      if (tiers.length === 0) throw new Error('至少要保留一档阶梯折扣');
      const seen = new Set<number>();
      for (const t of tiers) {
        if (!Number.isFinite(t.min) || !Number.isInteger(t.min) || t.min < 1) {
          throw new Error('阶梯「题量达到」必须是 ≥ 1 的整数');
        }
        if (seen.has(t.min)) throw new Error(`阶梯题量 ${t.min} 重复了，请改成不同数值`);
        seen.add(t.min);
        if (!Number.isFinite(t.discount) || t.discount < minDiscount || t.discount > 1) {
          throw new Error(`题量 ${t.min} 的折扣必须介于 ${minDiscount} 与 1 之间`);
        }
      }

      // 校验 4：上传识别积分 / 默认题量。
      if (!Number.isFinite(importCostCredits) || importCostCredits < 0) {
        throw new Error('上传识别积分不能为负');
      }
      if (
        !Number.isFinite(defaultQuestionCount) ||
        !Number.isInteger(defaultQuestionCount) ||
        defaultQuestionCount < 1
      ) {
        throw new Error('默认题量必须是 ≥ 1 的整数');
      }

      const sb = getSupabase();
      if (!sb) throw new Error('还没有连接云端服务，无法保存配置');

      // p_value 是 jsonb，直接传对象即可（database 类型已声明为 Json）。
      const value: Json = {
        questionCost: { ...questionCost },
        bulkTiers: tiers
          .slice()
          .sort((a, b) => a.min - b.min)
          .map((t) => ({ min: t.min, discount: t.discount })),
        minDiscount,
        importCostCredits,
        defaultQuestionCount,
      };
      const { error: rpcError } = await sb.rpc('admin_set_system_config', {
        p_key: 'exam',
        p_value: value,
      });
      if (rpcError) throw new Error(rpcError.message);
      toast.success('组卷配置已保存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [questionCost, tiers, minDiscount, importCostCredits, defaultQuestionCount, toast]);

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 0.5 }}>
        <AssignmentIcon color="primary" sx={{ fontSize: 22 }} aria-hidden="true" />
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>组卷配置</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        配置组卷的积分规则：各题型单题积分、题量阶梯折扣、折扣下限、上传原卷识别积分与默认题量。
        保存后立即生效，老师组卷时的积分预估按这里的数值计算。
      </Typography>

      {error ? (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Box
              component="button"
              type="button"
              onClick={() => void load()}
              style={{ border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}
            >
              重试
            </Box>
          }
        >
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 2 }}>加载中…</Typography>
      ) : (
        <Stack spacing={2.5}>
          {/* ---- 各题型单题积分 ---- */}
          <Box>
            <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 1 }}>
              各题型单题积分（出一道题扣多少积分）
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
              {QTYPE_ITEMS.map((item) => (
                <TextField
                  key={item.key}
                  label={item.label}
                  type="number"
                  value={questionCost[item.key] ?? 0}
                  onChange={(e) => handleCostChange(item.key, e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: 0, step: 0.01 }}
                  sx={{ width: { xs: '100%', sm: 140 } }}
                />
              ))}
            </Stack>
          </Box>

          {/* ---- 题量阶梯折扣 ---- */}
          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
                题量阶梯折扣（题量越多，折扣越低；范围 {minDiscount} ~ 1）
              </Typography>
              <Button
                size="small"
                startIcon={<AddCircleOutlineIcon />}
                onClick={handleAddTier}
                sx={{ minHeight: 36, fontWeight: 700 }}
              >
                加一档
              </Button>
            </Stack>
            <Stack spacing={1.25}>
              {tiers.map((tier, index) => (
                <Stack key={`tier-${index}`} direction="row" spacing={1.25} alignItems="center">
                  <TextField
                    label="题量达到"
                    type="number"
                    value={tier.min}
                    onChange={(e) => handleTierChange(index, 'min', e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ min: 1, step: 1 }}
                    sx={{ width: 130 }}
                  />
                  <TextField
                    label="折扣"
                    type="number"
                    value={tier.discount}
                    onChange={(e) => handleTierChange(index, 'discount', e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    inputProps={{ min: minDiscount, max: 1, step: 0.01 }}
                    sx={{ width: 130 }}
                  />
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', flex: 1 }}>
                    题量 ≥ {tier.min} 题时，按 {tier.discount} 折计费
                  </Typography>
                  <IconButton
                    aria-label={`删除第 ${index + 1} 档`}
                    onClick={() => handleRemoveTier(index)}
                    disabled={tiers.length <= 1}
                    sx={{ color: 'text.secondary' }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          </Box>

          {/* ---- 折扣下限 / 上传识别 / 默认题量 ---- */}
          <TextField
            label="折扣下限 minDiscount"
            type="number"
            value={minDiscount}
            onChange={(e) => setMinDiscount(Number(e.target.value))}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: 0, max: 1, step: 0.01 }}
            helperText="不管题量多大，折扣都不会低于这个值"
            sx={{ maxWidth: 300 }}
          />
          <TextField
            label="上传原卷识别积分 importCostCredits"
            type="number"
            value={importCostCredits}
            onChange={(e) => setImportCostCredits(Number(e.target.value))}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: 0, step: 0.1 }}
            helperText="老师上传一份原卷、用 AI 识别所消耗的固定积分"
            sx={{ maxWidth: 300 }}
          />
          <TextField
            label="默认题量 defaultQuestionCount"
            type="number"
            value={defaultQuestionCount}
            onChange={(e) => setDefaultQuestionCount(Number(e.target.value))}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: 1, step: 1 }}
            helperText="老师进入组卷页时默认出的题目数量"
            sx={{ maxWidth: 300 }}
          />

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={() => void load()} disabled={saving} sx={{ minHeight: 44 }}>
              取消
            </Button>
            <Button
              variant="contained"
              onClick={() => void handleSave()}
              disabled={saving}
              sx={{ minHeight: 44, fontWeight: 700 }}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

export default ExamSettingsPanel;
