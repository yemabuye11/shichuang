import { useMemo, useState } from 'react';
import { alpha } from '@mui/material/styles';
import {
  Box,
  Button,
  Chip,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { PRIMARY } from '@/theme';
import { openCourseResources, type OpenCourseResource } from '@/data/openCourseResources';

/** 学科筛选选项（与数据 subject 字段保持一致）。 */
const SUBJECTS = ['数学', '语文', '英语', '物理', '化学'] as const;

/** 区块小标题（eyebrow + 主标题），与首页 SectionHeading 视觉一致。 */
function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }): JSX.Element {
  return (
    <Stack spacing={0.75} sx={{ mb: { xs: 2.5, sm: 3 } }}>
      <Typography
        sx={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 1,
          color: 'primary.main',
          textTransform: 'uppercase',
        }}
      >
        {eyebrow}
      </Typography>
      <Typography sx={{ fontSize: { xs: 22, sm: 28 }, fontWeight: 800, color: 'text.primary' }}>
        {title}
      </Typography>
    </Stack>
  );
}

/** tag → Chip 配色：获奖类用醒目色，其余克制。 */
const TAG_COLOR: Record<OpenCourseResource['tag'], 'error' | 'warning' | 'info' | 'primary' | 'default'> = {
  省级获奖: 'error',
  市级获奖: 'warning',
  示范课: 'info',
  常规优质: 'default',
  AI示范: 'primary',
};

/** type → 展示文案。 */
const TYPE_LABEL: Record<OpenCourseResource['type'], string> = {
  video: '视频',
  doc: '文档',
  courseware: '课件',
};

/** 单张公开课资源卡片（外链卡片，不复用 AppCard）。 */
function CourseCard({ r }: { r: OpenCourseResource }): JSX.Element {
  return (
    <Box
      component="article"
      sx={{
        position: 'relative',
        p: 2,
        borderRadius: { xs: 4, sm: 5 },
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: '#fff',
        boxShadow: '0 2px 12px rgba(27,31,39,0.05)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        transition: 'transform .18s, box-shadow .18s, border-color .18s',
        '&:hover': {
          transform: 'translateY(-3px)',
          borderColor: 'primary.main',
          boxShadow: `0 14px 30px ${alpha(PRIMARY, 0.16)}`,
        },
      }}
    >
      {r.urlUnverified ? (
        <Typography
          component="span"
          sx={{
            position: 'absolute',
            top: 10,
            right: 10,
            fontSize: 11,
            color: 'text.disabled',
            bgcolor: 'rgba(27,31,39,0.04)',
            px: 0.75,
            py: 0.25,
            borderRadius: 1,
          }}
        >
          链接待核实
        </Typography>
      ) : null}

      <Typography
        sx={{
          fontSize: 16,
          fontWeight: 700,
          color: 'text.primary',
          lineHeight: 1.5,
          pr: r.urlUnverified ? 8 : 0,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {r.title}
      </Typography>

      <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.75 }} alignItems="center">
        <Chip label={`${r.subject}·${r.grade}`} size="small" variant="outlined" />
        <Chip label={TYPE_LABEL[r.type]} size="small" variant="outlined" color="primary" />
        <Chip label={r.tag} size="small" color={TAG_COLOR[r.tag]} variant={TAG_COLOR[r.tag] === 'default' ? 'outlined' : 'filled'} />
      </Stack>

      <Typography
        sx={{
          fontSize: 13,
          color: 'text.secondary',
          lineHeight: 1.7,
          mt: 1.25,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {r.note}
      </Typography>

      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1 }}>
        <Typography sx={{ fontSize: 12, color: 'text.disabled', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          来源：{r.source}
        </Typography>
      </Stack>

      <Box sx={{ mt: 'auto', pt: 1.5 }}>
        <Button
          component="a"
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          variant="contained"
          size="small"
          endIcon={<OpenInNewIcon />}
          sx={{
            borderRadius: 999,
            textTransform: 'none',
            fontWeight: 700,
            width: { xs: '100%', sm: 'auto' },
          }}
        >
          打开观摩
        </Button>
      </Box>
    </Box>
  );
}

export function OpenCoursesSection(): JSX.Element {
  const [filter, setFilter] = useState<string>('全部');

  const list = useMemo(
    () => (filter === '全部' ? openCourseResources : openCourseResources.filter((r) => r.subject === filter)),
    [filter],
  );

  return (
    <Box sx={{ mt: { xs: 5, sm: 7 } }}>
      <SectionHeading eyebrow="OPEN COURSES" title="公开课资源 · 精选优质课例" />
      <Typography
        sx={{
          fontSize: 14,
          color: 'text.secondary',
          lineHeight: 1.75,
          mb: 2.5,
          maxWidth: 760,
        }}
      >
        精选公开平台的优质公开课与获奖课例，点开即可观摩学习。资源来自 B站、国家中小学智慧教育平台等公开渠道，仅作索引；老师们也可以把自己的获奖教案上传进来，越积越值钱。
      </Typography>

      <ToggleButtonGroup
        value={filter}
        exclusive
        size="small"
        onChange={(_, v: string | null) => {
          if (v !== null) setFilter(v);
        }}
        sx={{ flexWrap: 'wrap', rowGap: 1, mb: { xs: 3, sm: 3.5 } }}
      >
        <ToggleButton value="全部">全部</ToggleButton>
        {SUBJECTS.map((s) => (
          <ToggleButton key={s} value={s}>
            {s}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
          gap: 2,
          alignItems: 'stretch',
        }}
      >
        {list.map((r) => (
          <CourseCard key={r.url} r={r} />
        ))}
      </Box>
    </Box>
  );
}

export default OpenCoursesSection;
