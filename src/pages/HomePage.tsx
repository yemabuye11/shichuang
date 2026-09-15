import { useCallback, useMemo, useState } from 'react';
import { alpha } from '@mui/material/styles';
import {
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SchoolIcon from '@mui/icons-material/School';
import { useNavigate } from 'react-router-dom';
import { PromptInput } from '@/components/generate/PromptInput';
import { TypeSelector } from '@/components/generate/TypeSelector';
import { ExampleChips } from '@/components/generate/ExampleChips';
import { AiDisclaimer } from '@/components/common/AiDisclaimer';
import { SystemNoticeBanner } from '@/components/common/SystemNoticeBanner';
import { useAuth } from '@/hooks/useAuth';
import { loginPath, ROUTES } from '@/config/routes';
import { DOC_TYPES, MIN_PROMPT_LENGTH } from '@/config/constants';
import { PRIMARY, SECONDARY } from '@/theme';
import type { AppType } from '@/types/enums';

/**
 * 首页（UI-1）——板块重组后：**只保留生成类功能**。
 *
 * 客户（野马）要求：首页第一板块就是生成入口（一句话生成 / 制作教案 / 课件），
 * 非生成类板块（数据背书条、大家都在用、核心亮点、公开课资源索引等）一律移除；
 * 「每日一练」不进首页，改为独立页面（入口保留在 TopNav / MobileTabBar）。
 *
 * 视觉沿用 haoyue01.cn 的清新校园风：留白充足、圆角、轻渐变、不花哨。
 *
 * 未登录可看（P0-A3 硬性）：首页本身就是生成入口，
 * 点生成会带 `?redirect=` 跳登录，登录后自动回到生成页并保留提示词。
 *
 * 配色沿用现有主题主色（PRIMARY / SECONDARY），不引入冲突新色板。
 */

/** 文档入口图标（UI-1，沿用既有映射）。 */
const DOC_ENTRY_ICONS: Record<
  'lesson_plan' | 'ppt' | 'courseware_2d' | 'courseware_3d' | 'office_doc',
  string
> = {
  lesson_plan: '✍️',
  ppt: '📊',
  courseware_2d: '🖼️',
  courseware_3d: '🧊',
  office_doc: '📄',
};

/** 区块小标题（eyebrow + 主标题）样式，统一各 section 视觉节奏。 */
function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }): JSX.Element {
  return (
    <Stack spacing={0.75} sx={{ mb: { xs: 2, sm: 2.5 } }}>
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

export function HomePage(): JSX.Element {
  const navigate = useNavigate();
  const { user, brand } = useAuth();

  const [prompt, setPrompt] = useState('');
  const [appType, setAppType] = useState<AppType>('auto');
  const [error, setError] = useState('');

  const handleSubmit = useCallback(() => {
    const text = prompt.trim();
    if (text.length < MIN_PROMPT_LENGTH) {
      setError(`请先简单描述一下你要做什么（至少 ${MIN_PROMPT_LENGTH} 个字）`);
      return;
    }
    setError('');

    const params = new URLSearchParams({ prompt: text });
    if (appType !== 'auto') params.set('type', appType);
    const target = `${ROUTES.GENERATE}?${params.toString()}`;

    if (!user) {
      navigate(loginPath(target));
      return;
    }
    navigate(target);
  }, [prompt, appType, user, navigate]);

  /** 跳转生成页（未登录带 redirect）。 */
  const goGenerate = useCallback(() => {
    navigate(user ? ROUTES.GENERATE : loginPath(ROUTES.GENERATE));
  }, [user, navigate]);

  const heroSubtitle = useMemo(
    () =>
      brand.subSlogan ||
      '写教案、做 PPT、3D 课件、办公文档、互动应用——一个 AI 备课台全帮你搞定。',
    [brand.subSlogan],
  );

  return (
    <Box sx={{ py: { xs: 2, sm: 3 } }}>
      <SystemNoticeBanner />

      {/* ================= Hero ================= */}
      <Box
        sx={{
          position: 'relative',
          textAlign: 'center',
          px: { xs: 2, sm: 4 },
          py: { xs: 6, sm: 8 },
          borderRadius: { xs: 4, sm: 6 },
          overflow: 'hidden',
          background: `linear-gradient(180deg, ${alpha(PRIMARY, 0.12)} 0%, ${alpha(
            PRIMARY,
            0.04,
          )} 55%, #FFFFFF 100%)`,
        }}
      >
        <Chip
          icon={<SchoolIcon sx={{ fontSize: 16, color: 'primary.main' }} />}
          label={`${brand.name} · 教师 AI 备课办公台`}
          sx={{
            mb: 2.5,
            height: 34,
            borderRadius: 999,
            bgcolor: 'rgba(255,255,255,0.8)',
            border: '1px solid',
            borderColor: alpha(PRIMARY, 0.3),
            color: 'primary.main',
            fontWeight: 700,
            fontSize: 13,
            boxShadow: `0 2px 10px ${alpha(PRIMARY, 0.12)}`,
            '& .MuiChip-label': { px: 1.5 },
          }}
        />
        <Typography
          component="h1"
          sx={{
            fontSize: { xs: 34, sm: 48, md: 56 },
            fontWeight: 800,
            lineHeight: 1.18,
            letterSpacing: '-0.5px',
            background: `linear-gradient(100deg, ${PRIMARY} 0%, ${SECONDARY} 100%)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            mx: 'auto',
            maxWidth: 760,
          }}
        >
          备课，交给 AI
        </Typography>
        <Typography
          sx={{
            fontSize: { xs: 15, sm: 18 },
            color: 'text.secondary',
            maxWidth: 620,
            mx: 'auto',
            mt: 2,
            lineHeight: 1.7,
          }}
        >
          {heroSubtitle}
        </Typography>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems="center"
          justifyContent="center"
          sx={{ mt: 3.5 }}
        >
          <Button
            variant="contained"
            size="large"
            onClick={goGenerate}
            endIcon={<ArrowForwardIcon />}
            sx={{
              minHeight: 52,
              px: 4,
              fontSize: 17,
              borderRadius: 999,
              width: { xs: '100%', sm: 'auto' },
              boxShadow: `0 10px 24px ${alpha(PRIMARY, 0.32)}`,
            }}
          >
            免费开始备课
          </Button>
        </Stack>
      </Box>

      {/* ================= 第一板块：生成入口 ================= */}
      {/* 客户要求：首页第一板块就是生成入口——一句话生成 / 制作教案 / 课件。 */}
      <Box sx={{ mt: { xs: 4, sm: 5 } }}>
        <SectionHeading eyebrow="GENERATE" title="一句话，开始生成" />

        {/* ---- 一句话生成：大输入框 ---- */}
        <Box
          sx={{
            borderRadius: { xs: 4, sm: 5 },
            border: '1.5px solid',
            borderColor: 'divider',
            bgcolor: '#fff',
            p: { xs: 2, sm: 3 },
            boxShadow: '0 8px 30px rgba(27,31,39,0.06)',
          }}
        >
          <PromptInput
            value={prompt}
            onChange={(v) => {
              setPrompt(v);
              if (error) setError('');
            }}
            minRows={3}
            error={error}
            helper="描述得越具体，效果越好：说清 学科 + 年级 + 玩法 + 题量"
            id="home-prompt"
          />

          <Box sx={{ display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' }, mt: 1.5 }}>
            <Button
              variant="contained"
              size="large"
              onClick={handleSubmit}
              endIcon={<ArrowForwardIcon />}
              sx={{ minHeight: 52, px: 3.5, fontSize: 16, width: { xs: '100%', sm: 'auto' } }}
            >
              一句话生成
            </Button>
          </Box>

          {/* 8 类胶囊 */}
          <Box sx={{ mt: 2.5 }}>
            {/* 营销首页不展示积分数字（积分口径由生成页统一说明） */}
            <TypeSelector value={appType} onChange={setAppType} variant="chips" showCost={false} />
          </Box>

          {/* 示例 chips */}
          <Box sx={{ mt: 2.5 }}>
            <ExampleChips
              onPick={(text, type) => {
                setPrompt(text);
                setAppType(type);
                setError('');
              }}
            />
          </Box>
        </Box>

        {/* ---- 制作教案 / 课件 / 办公文档：文档类一键生成 ---- */}
        <Typography
          sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary', mt: 3, mb: 1.5 }}
        >
          或者，直接选一个要做的物料
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(3, minmax(0, 1fr))',
              md: 'repeat(5, minmax(0, 1fr))',
            },
            gap: 1.5,
          }}
        >
          {DOC_TYPES.map((doc) => {
            const icon = DOC_ENTRY_ICONS[doc.key as keyof typeof DOC_ENTRY_ICONS] ?? '📄';
            const to = `${ROUTES.GENERATE}?type=${encodeURIComponent(doc.key)}&category=doc`;
            return (
              <Box
                key={doc.key}
                component="button"
                type="button"
                onClick={() => navigate(user ? to : loginPath(to))}
                sx={{
                  textAlign: 'left',
                  p: 2,
                  borderRadius: 4,
                  border: '1.5px solid',
                  borderColor: 'divider',
                  bgcolor: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  minHeight: 104,
                  transition: 'border-color .15s, transform .15s, box-shadow .15s',
                  '&:hover': {
                    borderColor: 'primary.main',
                    transform: 'translateY(-2px)',
                    boxShadow: `0 10px 22px ${alpha(PRIMARY, 0.14)}`,
                  },
                }}
              >
                <Typography sx={{ fontSize: 24 }} aria-hidden="true">
                  {icon}
                </Typography>
                <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{doc.label}</Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.45 }}>
                  {doc.hint}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* ================= 底部 CTA ================= */}
      <Box
        sx={{
          mt: { xs: 5, sm: 6 },
          p: { xs: 3.5, sm: 5 },
          borderRadius: { xs: 4, sm: 6 },
          textAlign: 'center',
          background: `linear-gradient(135deg, ${PRIMARY} 0%, ${SECONDARY} 100%)`,
          color: '#fff',
          boxShadow: `0 16px 40px ${alpha(PRIMARY, 0.3)}`,
        }}
      >
        <Typography sx={{ fontSize: { xs: 22, sm: 30 }, fontWeight: 800, lineHeight: 1.3 }}>
          一节课的工夫，备好全部物料
        </Typography>
        <Typography sx={{ fontSize: { xs: 14, sm: 16 }, mt: 1, opacity: 0.9, maxWidth: 560, mx: 'auto' }}>
          写教案、做 PPT、3D 课件、办公文档、互动应用，现在就交给 AI。
        </Typography>
        <Button
          variant="contained"
          size="large"
          onClick={goGenerate}
          startIcon={<AutoAwesomeIcon />}
          sx={{
            mt: 3,
            minHeight: 52,
            px: 4,
            fontSize: 17,
            borderRadius: 999,
            bgcolor: '#fff',
            color: 'primary.main',
            fontWeight: 800,
            boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.92)' },
          }}
        >
          免费开始备课
        </Button>
      </Box>

      <Divider sx={{ my: { xs: 4, sm: 5 }, borderColor: 'divider' }} />

      <Box>
        <AiDisclaimer />
      </Box>
    </Box>
  );
}

export default HomePage;
