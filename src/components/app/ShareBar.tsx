import { useState } from 'react';
import { Box, Button, Stack } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import { QrCodeDialog } from './QrCodeDialog';
import { FullscreenButton } from './FullscreenButton';
import { copyText } from '@/utils/clipboard';
import * as trackService from '@/services/trackService';
import { useToast } from '@/components/common/ToastHost';
import type { RefObject } from 'react';

/**
 * 应用运行页的教师主操作区（UI-4）：复制链接 / 二维码 / 全屏上课 / 点赞。
 */
export interface ShareBarProps {
  appId: string;
  /** 分享链接（绝对地址）。 */
  url: string;
  likeCount: number;
  liked: boolean;
  /** 点赞 / 取消点赞；未登录时由页面引导登录。 */
  onToggleLike: () => void;
  /** 全屏目标元素（应用容器）。 */
  fullscreenRef?: RefObject<HTMLElement>;
  /** 是否禁用交互（如内容发布中）。 */
  disabled?: boolean;
}

export function ShareBar({
  appId,
  url,
  likeCount,
  liked,
  onToggleLike,
  fullscreenRef,
  disabled = false,
}: ShareBarProps): JSX.Element {
  const toast = useToast();
  const [qrOpen, setQrOpen] = useState(false);

  const handleCopy = async (): Promise<void> => {
    const ok = await copyText(url);
    trackService.trackShare(appId, 'copy_link');
    if (ok) toast.success('链接已复制，发到班级群就能用');
    else toast.error('复制失败，请长按地址栏手动复制');
  };

  return (
    <>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          flexWrap: 'wrap',
          gap: 1,
          '& > *': { flexGrow: 1, flexBasis: { xs: 'calc(50% - 4px)', sm: 0 } },
        }}
      >
        <Button
          variant="outlined"
          size="large"
          startIcon={<LinkIcon />}
          onClick={() => void handleCopy()}
          disabled={disabled}
          sx={{ minHeight: 48, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff', fontSize: 15 }}
        >
          复制链接
        </Button>

        <Button
          variant="outlined"
          size="large"
          startIcon={<QrCode2Icon />}
          onClick={() => {
            setQrOpen(true);
            trackService.trackShare(appId, 'qrcode');
          }}
          disabled={disabled}
          sx={{ minHeight: 48, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff', fontSize: 15 }}
        >
          二维码
        </Button>

        <FullscreenButton targetRef={fullscreenRef} appId={appId} />

        <Button
          variant={liked ? 'contained' : 'outlined'}
          size="large"
          startIcon={liked ? <ThumbUpIcon /> : <ThumbUpOutlinedIcon />}
          onClick={onToggleLike}
          aria-pressed={liked}
          sx={{
            minHeight: 48,
            fontSize: 15,
            borderColor: 'divider',
            bgcolor: liked ? undefined : '#fff',
            color: liked ? undefined : 'text.primary',
          }}
        >
          <Box component="span" sx={{ ml: 0.5 }}>
            {likeCount}
          </Box>
        </Button>
      </Stack>

      <QrCodeDialog open={qrOpen} onClose={() => setQrOpen(false)} url={url} />
    </>
  );
}

export default ShareBar;
