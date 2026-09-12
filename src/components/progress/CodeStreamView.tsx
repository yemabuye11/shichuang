import { useEffect, useRef } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import { formatBytes } from '@/utils/format';

/**
 * 代码实时流式滚动区（UI-3）。
 *
 * 「确实在干活」的证明 + 一点技术感；可折叠，避免占满手机屏幕。
 * 自动滚动到底部，超出上限的头部内容会被 `useGenerate` 丢弃（防内存膨胀）。
 */
export interface CodeStreamViewProps {
  /** 累积到的代码文本。 */
  code: string;
  /** 是否折叠。 */
  collapsed: boolean;
  /** 切换折叠。 */
  onToggle: () => void;
  /** 已接收字符数（用于体积展示）。 */
  chars?: number;
}

export function CodeStreamView({
  code,
  collapsed,
  onToggle,
  chars = 0,
}: CodeStreamViewProps): JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (collapsed) return;
    const el = boxRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [code, collapsed]);

  const tail = code.length > 4000 ? code.slice(code.length - 4000) : code;

  return (
    <Box sx={{ borderRadius: 2.5, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1.5, py: 1, bgcolor: 'rgba(27,31,39,0.04)' }}
      >
        <CodeIcon sx={{ fontSize: 18, color: 'text.secondary' }} aria-hidden="true" />
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.secondary' }}>
          正在写代码
        </Typography>
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', ml: 'auto' }}>
          {formatBytes(chars)}
        </Typography>
        <Box
          component="button"
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          sx={{
            minHeight: 32,
            px: 1.25,
            borderRadius: 1.5,
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: '#fff',
            fontSize: 13,
            fontWeight: 600,
            color: 'text.primary',
            cursor: 'pointer',
          }}
        >
          {collapsed ? '展开代码' : '收起代码'}
        </Box>
      </Stack>

      {!collapsed ? (
        <Box
          ref={boxRef}
          component="pre"
          sx={{
            m: 0,
            p: 1.5,
            maxHeight: { xs: 180, sm: 240 },
            overflow: 'auto',
            bgcolor: '#0F1420',
            color: '#C8D3E6',
            fontSize: 12.5,
            lineHeight: 1.65,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {tail || '// 等待模型返回…'}
          <Box
            component="span"
            sx={{
              display: 'inline-block',
              width: 8,
              height: 15,
              ml: 0.25,
              verticalAlign: 'text-bottom',
              bgcolor: '#4C8DFF',
              animation: 'sc-blink 1s steps(2, start) infinite',
              '@keyframes sc-blink': { to: { visibility: 'hidden' } },
            }}
            aria-hidden="true"
          />
        </Box>
      ) : null}
    </Box>
  );
}

export default CodeStreamView;
