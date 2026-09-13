import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import { useToast } from '@/components/common/ToastHost';
import * as noticeService from '@/services/noticeService';

/**
 * 管理员「公告设置」：编辑系统公告（标题 / 内容 / 管理员微信号 / 启用开关）。
 *
 * 写入走 SECURITY DEFINER RPC `admin_set_system_config('system_notice', jsonb)`；
 * 老师端读取走 `get_system_config('system_notice')`。
 *
 * 保存后 `updated_at` 自动更新，前端 banner 会按新 key 重新出现。
 */
export function NoticeSettingsPanel(): JSX.Element {
  const toast = useToast();
  const [enabled, setEnabled] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [wechatId, setWechatId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const n = await noticeService.getSystemNotice();
      setEnabled(n?.enabled ?? false);
      setTitle(n?.title ?? '');
      setContent(n?.content ?? '');
      setWechatId(n?.wechat_id ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载公告失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await noticeService.setSystemNotice({
        enabled,
        title,
        content,
        wechat_id: wechatId,
      });
      toast.success('公告已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [enabled, title, content, wechatId, toast]);

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 0.5 }}>
        <CampaignIcon color="primary" sx={{ fontSize: 22 }} aria-hidden="true" />
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>公告设置</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        编辑系统公告与你的微信号，老师登录后会在顶部看到，可按发布时间一次性关闭。
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} action={
          <Box component="button" type="button" onClick={() => void load()}
            style={{ border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
            重试
          </Box>
        }>{error}</Alert>
      ) : null}

      {loading ? (
        <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 2 }}>加载中…</Typography>
      ) : (
        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(_, v) => setEnabled(v)}
                color="primary"
              />
            }
            label={
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                {enabled ? '已启用（老师在顶部看到）' : '已关闭（老师看不到）'}
              </Typography>
            }
          />
          <TextField
            label="公告标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            placeholder="例如：充值后请加管理员微信"
          />
          <TextField
            label="公告内容"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            fullWidth
            multiline
            minRows={3}
            placeholder="充值或使用中遇到问题，可加管理员微信一对一咨询。"
          />
          <TextField
            label="管理员微信号"
            value={wechatId}
            onChange={(e) => setWechatId(e.target.value)}
            fullWidth
            placeholder="例如：yemabuye_001"
            helperText="展示在 banner 上，老师可一键复制"
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={() => void load()} disabled={saving} sx={{ minHeight: 44 }}>取消</Button>
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

export default NoticeSettingsPanel;