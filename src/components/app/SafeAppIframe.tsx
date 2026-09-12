import { forwardRef } from 'react';
import { Box, CircularProgress, Stack, Typography } from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';

/**
 * 安全沙箱 iframe（ARCHITECTURE.md §8.7 红线 1）。
 *
 * ⚠️ 安全红线：`sandbox` **绝不允许出现 `allow-same-origin`**，
 * 一旦加上，生成物（不可信第三方代码）就能读取父页面 DOM、
 * 拿到 `localStorage` 里的登录态，等同于 XSS。
 *
 * 其他约束：
 * - 不使用 `srcdoc` 注入（避免同源注入面）；
 * - `referrerPolicy="no-referrer"`，不泄露来源；
 * - 移动端允许弹窗/表单（`allow-popups` / `allow-forms`），保证生成的应用可用。
 */
export interface SafeAppIframeProps {
  /** iframe 的 src（Blob URL 或 CDN URL）。 */
  src: string | null;
  /** 应用标题（无障碍）。 */
  title: string;
  /** 是否正在加载。 */
  loading?: boolean;
  /** 加载失败/不可播放时的提示文案。 */
  fallbackMessage?: string;
  /** 高度（默认充满容器）。 */
  height?: number | string;
}

/**
 * 沙箱属性值。
 *
 * ⚠️ 修改此处前请先阅读 ARCHITECTURE.md §8.7；**不要新增 `allow-same-origin`**。
 */
export const IFRAME_SANDBOX = 'allow-scripts allow-forms allow-popups';

export const SafeAppIframe = forwardRef<HTMLIFrameElement, SafeAppIframeProps>(function SafeAppIframe(
  { src, title, loading = false, fallbackMessage = '', height = '100%' },
  ref,
): JSX.Element {
  if (!src) {
    return (
      <Stack
        spacing={1.5}
        alignItems="center"
        justifyContent="center"
        sx={{ height, minHeight: 320, bgcolor: '#F7F8FA', borderRadius: 2, px: 3, textAlign: 'center' }}
      >
        <BlockIcon sx={{ fontSize: 40, color: 'text.disabled' }} aria-hidden="true" />
        <Typography sx={{ fontSize: 15, color: 'text.secondary', lineHeight: 1.7 }}>
          {fallbackMessage || '这个应用暂时打不开，可能还在发布中，请稍后刷新试试。'}
        </Typography>
      </Stack>
    );
  }

  return (
    <Box sx={{ position: 'relative', height, width: '100%' }}>
      {loading ? (
        <Stack
          spacing={1.5}
          alignItems="center"
          justifyContent="center"
          sx={{
            position: 'absolute',
            inset: 0,
            bgcolor: '#F7F8FA',
            borderRadius: 2,
            zIndex: 1,
          }}
        >
          <CircularProgress size={26} />
          <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>正在载入应用…</Typography>
        </Stack>
      ) : null}

      <Box
        component="iframe"
        ref={ref}
        src={src}
        title={title}
        // ⚠️ 安全红线：不得包含 allow-same-origin
        sandbox={IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        loading="eager"
        allow="fullscreen"
        style={{
          width: '100%',
          height: '100%',
          minHeight: 320,
          border: 0,
          borderRadius: 12,
          backgroundColor: '#FFFFFF',
          display: 'block',
        }}
      />
    </Box>
  );
});

export default SafeAppIframe;
