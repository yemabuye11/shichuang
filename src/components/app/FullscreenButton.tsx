import { useEffect, useState } from 'react';
import { Button, Tooltip } from '@mui/material';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { onFullscreenChange, requestFullscreen, exitFullscreen, supportsFullscreen } from '@/utils/fullscreen';
import * as trackService from '@/services/trackService';

/**
 * 「全屏上课」按钮（投屏场景）。
 *
 * 不支持全屏 API 的浏览器上隐藏，避免出现点了没反应的按钮。
 */
export interface FullscreenButtonProps {
  /** 要全屏的元素（缺省为整个页面）。 */
  targetRef?: React.RefObject<HTMLElement>;
  /** 关联应用（埋点）。 */
  appId?: string;
  /** 紧凑模式（只显示图标）。 */
  compact?: boolean;
}

export function FullscreenButton({ targetRef, appId, compact = false }: FullscreenButtonProps): JSX.Element | null {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(supportsFullscreen());
    return onFullscreenChange(setActive);
  }, []);

  if (!supported) return null;

  const handleClick = (): void => {
    if (active) {
      exitFullscreen();
      return;
    }
    void requestFullscreen(targetRef?.current ?? null);
    if (appId) trackService.trackShare(appId, 'fullscreen');
  };

  return (
    <Tooltip title={active ? '退出全屏' : '全屏上课（适合投屏）'} arrow>
      <Button
        variant="outlined"
        size="large"
        onClick={handleClick}
        startIcon={active ? <FullscreenExitIcon /> : <FullscreenIcon />}
        aria-label={active ? '退出全屏' : '全屏上课'}
        sx={{
          minHeight: 48,
          flex: compact ? '0 0 auto' : 1,
          borderColor: 'divider',
          color: 'text.primary',
          bgcolor: '#fff',
          fontSize: 15,
        }}
      >
        {active ? '退出' : '全屏'}
      </Button>
    </Tooltip>
  );
}

export default FullscreenButton;
