import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import * as noticeService from '@/services/noticeService';
import type { SystemNotice } from '@/services/noticeService';

/**
 * 系统公告 + 管理员微信号 banner。
 *
 * - 拉取 system_config.system_notice；
 * - enabled=false 或字段全空 → 不渲染；
 * - 用户关闭后写 localStorage（key=`notice_dismissed_<updated_at>`），再次出现相同
 *   updated_at 的公告时不再展示；后台修改公告（updated_at 变化）后会重新出现；
 * - 内置「复制微信号」按钮（用 navigator.clipboard.writeText）。
 *
 * 极简风格，不抢戏（不遮导航）。可同时被多个页面复用。
 */
export function SystemNoticeBanner(): JSX.Element | null {
  const [notice, setNotice] = useState<SystemNotice | null>(null);
  const [dismissed, setDismissed] = useState(true); // 默认 true，等拉到数据再决定
  const [copyToast, setCopyToast] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const n = await noticeService.getSystemNotice();
      if (!alive) return;
      setNotice(n);
      if (n?.updated_at) {
        try {
          const flag = localStorage.getItem(`notice_dismissed_${n.updated_at}`);
          setDismissed(flag === '1');
        } catch {
          setDismissed(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleDismiss = useCallback(() => {
    if (!notice?.updated_at) return;
    try {
      localStorage.setItem(`notice_dismissed_${notice.updated_at}`, '1');
    } catch {
      /* ignore quota / private mode */
    }
    setDismissed(true);
  }, [notice]);

  const handleCopy = useCallback(async () => {
    if (!notice?.wechat_id) return;
    try {
      await navigator.clipboard.writeText(notice.wechat_id);
    } catch {
      // 退化：使用临时 textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = notice.wechat_id;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopyToast(true);
  }, [notice]);

  if (!notice || dismissed) return null;
  if (!notice.title && !notice.content && !notice.wechat_id) return null;

  return (
    <Box sx={{ mb: 2 }}>
      <Alert
        severity="info"
        icon={<CampaignOutlinedIcon fontSize="small" />}
        sx={{
          alignItems: 'center',
          borderRadius: 2,
          py: 0.75,
          '& .MuiAlert-message': { width: '100%' },
        }}
        action={
          <IconButton
            size="small"
            aria-label="关闭公告"
            onClick={handleDismiss}
            sx={{ color: 'text.secondary' }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        }
      >
        <Stack spacing={0.5}>
          {notice.title ? (
            <Typography sx={{ fontSize: 14.5, fontWeight: 700 }}>
              {notice.title}
            </Typography>
          ) : null}
          {notice.content ? (
            <Typography sx={{ fontSize: 13.5, color: 'text.secondary', lineHeight: 1.7 }}>
              {notice.content}
            </Typography>
          ) : null}
          {notice.wechat_id ? (
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.25 }}>
              <Chip
                size="small"
                label={`加管理员微信：${notice.wechat_id}`}
                sx={{ fontWeight: 700, bgcolor: 'primary.main', color: '#fff' }}
              />
              <Button
                size="small"
                startIcon={<ContentCopyIcon fontSize="small" />}
                onClick={() => void handleCopy()}
                sx={{ minHeight: 32, fontSize: 13 }}
              >
                复制
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </Alert>
      <Snackbar
        open={copyToast}
        autoHideDuration={1800}
        onClose={() => setCopyToast(false)}
        message="已复制微信号"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}

export default SystemNoticeBanner;