import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { useToast } from '@/components/common/ToastHost';
import { getSupabase } from '@/services/supabaseClient';
import type { Json } from '@/types/database';

/** 每日一练的可配置天档（与迁移 0038 / practiceService 默认配置保持一致）。 */
const DAY_TIERS = [1, 3, 5, 10, 20] as const;

/** 各天档的折扣默认值（读取失败 / 缺字段时使用）。 */
const DEFAULT_DISCOUNTS: Record<string, number> = {
  '1': 1,
  '3': 0.9,
  '5': 0.84,
  '10': 0.68,
  '20': 0.6,
};
const DEFAULT_MIN_DISCOUNT = 0.6;
const DEFAULT_IMPORT_COST = 0.5;

/**
 * 管理员「每日一练配置」面板。
 *
 * 读写 system_config.practice（jsonb）：
 * - 读：get_system_config('practice')；
 * - 写：admin_set_system_config('practice', jsonb)（管理员 SECURITY DEFINER RPC）。
 *
 * 编辑字段：各天档折扣 discountByDays、折扣下限 minDiscount、上传识别积分 importCostCredits。
 * 保存时校验「折扣 ∈ [minDiscount, 1]」。
 */
export function PracticeSettingsPanel(): JSX.Element {
  const toast = useToast();

  const [discounts, setDiscounts] = useState<Record<string, number>>({ ...DEFAULT_DISCOUNTS });
  const [minDiscount, setMinDiscount] = useState<number>(DEFAULT_MIN_DISCOUNT);
  const [importCostCredits, setImportCostCredits] = useState<number>(DEFAULT_IMPORT_COST);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const sb = getSupabase();
    // 未连接后端：用默认值填充，不让面板空白（与 practiceService 的回落行为一致）。
    if (!sb) {
      setLoading(false);
      return;
    }
    try {
      const { data, error: rpcError } = await sb.rpc('get_system_config', { p_key: 'practice' });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const obj =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : null;
      if (obj) {
        const rawDiscounts =
          obj.discountByDays &&
          typeof obj.discountByDays === 'object' &&
          !Array.isArray(obj.discountByDays)
            ? (obj.discountByDays as Record<string, number>)
            : null;
        setDiscounts({
          '1': rawDiscounts?.['1'] ?? DEFAULT_DISCOUNTS['1'],
          '3': rawDiscounts?.['3'] ?? DEFAULT_DISCOUNTS['3'],
          '5': rawDiscounts?.['5'] ?? DEFAULT_DISCOUNTS['5'],
          '10': rawDiscounts?.['10'] ?? DEFAULT_DISCOUNTS['10'],
          '20': rawDiscounts?.['20'] ?? DEFAULT_DISCOUNTS['20'],
        });
        setMinDiscount(typeof obj.minDiscount === 'number' ? obj.minDiscount : DEFAULT_MIN_DISCOUNT);
        setImportCostCredits(
          typeof obj.importCostCredits === 'number' ? obj.importCostCredits : DEFAULT_IMPORT_COST,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载每日一练配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDiscountChange = (key: string, raw: string): void => {
    const v = Number(raw);
    setDiscounts((prev) => ({ ...prev, [key]: Number.isFinite(v) ? v : 0 }));
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      // 校验：每个折扣必须在 [minDiscount, 1] 之间。
      for (const tier of DAY_TIERS) {
        const d = discounts[String(tier)];
        if (!Number.isFinite(d) || d < minDiscount || d > 1) {
          throw new Error(`「${tier}天」折扣必须介于 ${minDiscount} 与 1 之间`);
        }
      }
      if (!Number.isFinite(minDiscount) || minDiscount < 0 || minDiscount > 1) {
        throw new Error('折扣下限必须介于 0 与 1 之间');
      }
      if (!Number.isFinite(importCostCredits) || importCostCredits < 0) {
        throw new Error('上传识别积分不能为负');
      }

      const sb = getSupabase();
      if (!sb) throw new Error('还没有连接云端服务，无法保存配置');

      // p_value 是 jsonb，直接传对象即可（database 类型已声明为 Json）。
      const value: Json = {
        dayTiers: [...DAY_TIERS],
        discountByDays: { ...discounts },
        minDiscount,
        importCostCredits,
      };
      const { error: rpcError } = await sb.rpc('admin_set_system_config', {
        p_key: 'practice',
        p_value: value,
      });
      if (rpcError) throw new Error(rpcError.message);
      toast.success('每日一练配置已保存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [discounts, minDiscount, importCostCredits, toast]);

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 0.5 }}>
        <MenuBookIcon color="primary" sx={{ fontSize: 22 }} aria-hidden="true" />
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>每日一练配置</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        配置练习天数对应的折扣、折扣下限与上传识别积分。学生连续作答天数越多，享受的折扣越高。
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
        <Stack spacing={2}>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
            各天档折扣（范围 {minDiscount} ~ 1，保留 2 位小数）
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
            {DAY_TIERS.map((tier) => (
              <TextField
                key={tier}
                label={`${tier} 天`}
                type="number"
                value={discounts[String(tier)] ?? 0}
                onChange={(e) => handleDiscountChange(String(tier), e.target.value)}
                InputLabelProps={{ shrink: true }}
                inputProps={{ min: minDiscount, max: 1, step: 0.01 }}
                sx={{ width: { xs: '100%', sm: 120 } }}
              />
            ))}
          </Stack>

          <TextField
            label="折扣下限 minDiscount"
            type="number"
            value={minDiscount}
            onChange={(e) => setMinDiscount(Number(e.target.value))}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: 0, max: 1, step: 0.01 }}
            helperText="各档折扣不得低于此值"
            sx={{ maxWidth: 260 }}
          />
          <TextField
            label="上传识别积分 importCostCredits"
            type="number"
            value={importCostCredits}
            onChange={(e) => setImportCostCredits(Number(e.target.value))}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: 0, step: 0.1 }}
            helperText="老师上传题目、用 AI 识别所消耗的积分"
            sx={{ maxWidth: 260 }}
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

export default PracticeSettingsPanel;
