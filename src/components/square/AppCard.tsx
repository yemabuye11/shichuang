import { Box, Stack, Typography } from '@mui/material';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import { useNavigate } from 'react-router-dom';
import { AutoCover } from './AutoCover';
import { TypeChip } from '@/components/common/TypeChip';
import { appRunPath, docRunPath } from '@/config/routes';
import { isDocTypeKey } from '@/config/constants';
import { formatCount, formatRelativeTime } from '@/utils/format';
import type { SquareItem } from '@/types/models';

/**
 * 广场 / 首页的应用卡片。
 *
 * 整卡可点（≥44px 触控区），进入应用运行页。
 */
export interface AppCardProps {
  item: SquareItem;
  /** 是否显示「热门」徽标（首页前 4 张）。 */
  hot?: boolean;
  /** 附加点击埋点。 */
  onOpen?: (id: string) => void;
}

export function AppCard({ item, hot = false, onOpen }: AppCardProps): JSX.Element {
  const navigate = useNavigate();

  const handleOpen = (): void => {
    onOpen?.(item.id);
    navigate(isDocTypeKey(item.appType) ? docRunPath(item.id) : appRunPath(item.id));
  };

  return (
    <Box
      component="article"
      role="button"
      tabIndex={0}
      aria-label={`打开应用 ${item.title}`}
      onClick={handleOpen}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
      sx={{
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: '#fff',
        overflow: 'hidden',
        cursor: 'pointer',
        minHeight: 44,
        transition: 'box-shadow .16s, transform .16s',
        '&:hover': { boxShadow: '0 6px 20px rgba(27,31,39,0.08)', transform: 'translateY(-2px)' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      <AutoCover seed={item.coverSeed} title={item.title} badge={hot ? '热门' : ''} />

      <Box sx={{ p: 1.5 }}>
        <Typography
          sx={{
            fontSize: 16,
            fontWeight: 700,
            color: 'text.primary',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 1,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {item.title}
        </Typography>

        <Typography
          sx={{
            fontSize: 13.5,
            color: 'text.secondary',
            mt: 0.5,
            lineHeight: 1.6,
            minHeight: 44,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {item.summary || '这个应用还没有写简介'}
        </Typography>

        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap', gap: 0.75 }}>
          <TypeChip type={item.appType} />
          {item.subject ? (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {item.grade ? `${item.grade}·${item.subject}` : item.subject}
            </Typography>
          ) : null}
        </Stack>

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.25 }}>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
            <PersonOutlineIcon sx={{ fontSize: 15, color: 'text.disabled' }} aria-hidden="true" />
            <Typography
              sx={{
                fontSize: 12.5,
                color: 'text.secondary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.author?.nickname ?? '匿名老师'}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            <Stack direction="row" spacing={0.25} alignItems="center">
              <VisibilityOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled' }} aria-hidden="true" />
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                {formatCount(item.viewCount)}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.25} alignItems="center">
              <ThumbUpOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled' }} aria-hidden="true" />
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                {formatCount(item.likeCount)}
              </Typography>
            </Stack>
          </Stack>
        </Stack>

        {item.publishedAt ? (
          <Typography sx={{ fontSize: 12, color: 'text.disabled', mt: 0.5 }}>
            {formatRelativeTime(item.publishedAt)}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

export default AppCard;
