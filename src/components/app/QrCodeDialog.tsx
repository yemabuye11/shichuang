import { Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography, Box } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { QRCodeSVG } from 'qrcode.react';
import { BRAND } from '@/config/brand';

/**
 * 二维码分享弹窗（纯前端生成，零请求零流量）。
 */
export interface QrCodeDialogProps {
  open: boolean;
  onClose: () => void;
  /** 要编码的链接。 */
  url: string;
  /** 应用标题。 */
  title?: string;
}

export function QrCodeDialog({ open, onClose, url, title = '' }: QrCodeDialogProps): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
        扫码打开
        <IconButton
          aria-label="关闭"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} alignItems="center" sx={{ pb: 1 }}>
          {title ? (
            <Typography sx={{ fontSize: 16, fontWeight: 600, textAlign: 'center' }}>{title}</Typography>
          ) : null}

          <Box
            sx={{
              p: 2,
              bgcolor: '#fff',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2.5,
              lineHeight: 0,
            }}
          >
            <QRCodeSVG value={url} size={196} level="M" marginSize={0} />
          </Box>

          <Typography
            sx={{
              fontSize: 13.5,
              color: 'text.secondary',
              textAlign: 'center',
              wordBreak: 'break-all',
              lineHeight: 1.6,
            }}
          >
            用手机相机或微信扫一扫，就能直接打开这个应用。
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.disabled', textAlign: 'center' }}>
            由 {BRAND.name} 生成
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

export default QrCodeDialog;
