import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useToast } from '@/components/common/ToastHost';
import * as adminService from '@/services/adminService';
import type { AppTypeConfigRow } from '@/services/adminService';

/**
 * 管理员「内容类型积分」面板：直接改各内容类型的单次生成积分消耗。
 *
 * - 列表数值**全部来自云端 `app_type_profiles`**，前端不内置任何价格；
 * - 保存走 SECURITY DEFINER RPC `public.admin_upsert_app_type(...)`
 *   （定义在 `supabase/migrations/0009_rpc_apps_social_admin.sql`），
 *   函数内部校验 `profiles.role='admin'`，非管理员会收到 42501；
 * - 保存后立即生效：老师端生成页的「本次预计消耗」走 `estimate_cost` 读同一张表，
 *   **不需要重新部署、也不需要刷新缓存**。
 */
export function AppTypeCreditsPanel(): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<AppTypeConfigRow[]>([]);
  /** 各类型正在编辑的值（key 为 appType）。 */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await adminService.listAppTypes();
      setRows(list);
      // 用显式循环构造草稿表，避免 Object.fromEntries 的元组推断差异
      const next: Record<string, string> = {};
      for (const r of list) next[r.appType] = String(r.creditCost);
      setDraft(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载积分配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 是否存在未保存的改动。 */
  const dirty = useMemo(
    () => rows.some((r) => (draft[r.appType] ?? '') !== String(r.creditCost)),
    [rows, draft],
  );

  const saveOne = useCallback(
    async (row: AppTypeConfigRow) => {
      const raw = draft[row.appType] ?? '';
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        toast.error('请输入 0 或正整数');
        return;
      }
      setSavingKey(row.appType);
      try {
        await adminService.upsertAppType({
          appType: row.appType,
          label: row.label,
          creditCost: Math.round(n),
          // 以下两项原样回传，避免把已有配置改坏
          modelOverride: row.modelOverride,
          enabled: row.enabled,
        });
        toast.success(`「${row.label}」已改为 ${Math.round(n)} 积分`);
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '保存失败');
      } finally {
        setSavingKey('');
      }
    },
    [draft, toast, load],
  );

  const saveAll = useCallback(async () => {
    const changed = rows.filter((r) => (draft[r.appType] ?? '') !== String(r.creditCost));
    if (changed.length === 0) return;
    for (const row of changed) {
      const n = Number(draft[row.appType]);
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`「${row.label}」请填 0 或正整数`);
        return;
      }
    }
    setSavingKey('__all__');
    let ok = 0;
    try {
      for (const row of changed) {
        await adminService.upsertAppType({
          appType: row.appType,
          label: row.label,
          creditCost: Math.round(Number(draft[row.appType])),
          modelOverride: row.modelOverride,
          enabled: row.enabled,
        });
        ok += 1;
      }
      toast.success(`已保存 ${ok} 项积分设置`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `保存了 ${ok} 项后失败，请重试`);
      await load();
    } finally {
      setSavingKey('');
    }
  }, [rows, draft, toast, load]);

  const docRows = rows.filter((r) => r.group === 'doc');
  const appRows = rows.filter((r) => r.group === 'app');

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 0.5 }}>
        <TuneIcon color="primary" sx={{ fontSize: 22 }} aria-hidden="true" />
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>内容类型积分</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        这里改的是「老师生成一次要花多少积分」。数值全部读自云端配置表，改完<Box component="span" sx={{ fontWeight: 700 }}>立即生效</Box>
        ——生成页的预计消耗会同步更新，不用重新部署。填 0 表示免费。
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
      ) : rows.length === 0 ? (
        <Alert severity="info">
          没有读到任何内容类型。演示模式下积分配置保存在云端，连接真实服务后即可在这里查看和修改。
        </Alert>
      ) : (
        <Stack spacing={2.5}>
          <GroupSection
            title="文档类"
            rows={docRows}
            draft={draft}
            savingKey={savingKey}
            onDraftChange={(key, v) => setDraft((prev) => ({ ...prev, [key]: v }))}
            onSave={(row) => void saveOne(row)}
          />
          <GroupSection
            title="应用类"
            rows={appRows}
            draft={draft}
            savingKey={savingKey}
            onDraftChange={(key, v) => setDraft((prev) => ({ ...prev, [key]: v }))}
            onSave={(row) => void saveOne(row)}
          />

          <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
            <Button
              startIcon={<RefreshIcon />}
              onClick={() => void load()}
              disabled={savingKey !== ''}
              sx={{ minHeight: 44 }}
            >
              重新读取
            </Button>
            <Button
              variant="contained"
              onClick={() => void saveAll()}
              disabled={!dirty || savingKey !== ''}
              sx={{ minHeight: 44, fontWeight: 700 }}
            >
              {savingKey === '__all__' ? '保存中…' : '保存全部改动'}
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

/** 一组（文档类 / 应用类）类型列表。 */
function GroupSection({
  title,
  rows,
  draft,
  savingKey,
  onDraftChange,
  onSave,
}: {
  title: string;
  rows: AppTypeConfigRow[];
  draft: Record<string, string>;
  savingKey: string;
  onDraftChange: (appType: string, value: string) => void;
  onSave: (row: AppTypeConfigRow) => void;
}): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 800 }}>{title}</Typography>
        <Chip label={`${rows.length} 项`} size="small" sx={{ fontSize: 11.5, height: 22 }} />
      </Stack>
      <Stack spacing={1}>
        {rows.map((row) => {
          const value = draft[row.appType] ?? String(row.creditCost);
          const changed = value !== String(row.creditCost);
          return (
            <Stack
              key={row.appType}
              direction="row"
              alignItems="center"
              spacing={1.25}
              sx={{
                p: 1.25,
                borderRadius: 2,
                border: '1px solid',
                borderColor: changed ? 'primary.main' : 'divider',
                bgcolor: changed ? 'rgba(47,107,255,0.04)' : 'transparent',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 14.5, fontWeight: 700 }} noWrap>
                  {row.label}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }} noWrap>
                  {row.appType}
                  {row.enabled ? '' : ' · 已停用'}
                </Typography>
              </Box>
              <TextField
                value={value}
                onChange={(e) => onDraftChange(row.appType, e.target.value.replace(/[^\d]/g, ''))}
                size="small"
                type="text"
                inputProps={{ inputMode: 'numeric', 'aria-label': `${row.label} 积分消耗` }}
                sx={{ width: 96 }}
              />
              <Typography sx={{ fontSize: 13, color: 'text.secondary', width: 34 }}>积分</Typography>
              <Button
                variant={changed ? 'contained' : 'outlined'}
                size="small"
                disabled={!changed || savingKey !== ''}
                onClick={() => onSave(row)}
                sx={{ minHeight: 38, minWidth: 64, fontWeight: 700 }}
              >
                {savingKey === row.appType ? '…' : '保存'}
              </Button>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}

export default AppTypeCreditsPanel;
